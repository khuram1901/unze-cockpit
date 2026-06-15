"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

type Plant = { id: string; name: string; type: string };

type SizeTotals = { s31: number; s36: number; s45: number };

type MonthlyTarget = {
  id: string;
  plant_id: string;
  plant_name: string;
  target_month: string;
  target_31: number | null;
  target_36: number | null;
  target_45: number | null;
  target_meter: number | null;
};

type Status = "green" | "amber" | "red" | "none";

type MetricKPI = {
  monthlyTarget: number;
  monthActual: number;
  monthAchievement: number;
  quarterTarget: number; // cumulative target up to current month-quarter
  quarterActual: number; // cumulative actual up to today
  quarterAchievement: number;
  status: Status; // overall status (uses month achievement bands)
  behindThisCheckpoint: boolean; // cumulative actual < 85% of cumulative target now
  weekNumber: number; // 1..4 month-quarter
  opsFlag: "none" | "week1" | "week2"; // alert shown to Operations Manager (weeks 1-2)
};

type PlantSummary = {
  plant: Plant;
  closingGoodStock: SizeTotals;
  closingBrokenStock: SizeTotals;
  todayProduced: SizeTotals;
  todayDispatched: SizeTotals;
  todayBroken: SizeTotals;
  production: MetricKPI;
  dispatch: MetricKPI;
  breakageRate: number; // month-to-date broken / produced, as a percentage
  breakageStatus: Status; // <=1% green, 1-1.5% amber, >1.5% red
  enteredToday: boolean;
};

const today = new Date().toISOString().slice(0, 10);

function emptyTotals(): SizeTotals {
  return { s31: 0, s36: 0, s45: 0 };
}

function total(t: SizeTotals) {
  return t.s31 + t.s36 + t.s45;
}

function targetTotal(t?: MonthlyTarget) {
  if (!t) return 0;
  return (t.target_31 || 0) + (t.target_36 || 0) + (t.target_45 || 0) + (t.target_meter || 0);
}

function getMonthFromDate(dateString: string) {
  return dateString.slice(0, 7);
}

function getMonthStart(dateString: string) {
  return `${dateString.slice(0, 7)}-01`;
}

function getMonthEnd(dateString: string) {
  const [year, month] = dateString.slice(0, 7).split("-").map(Number);
  const d = new Date(year, month, 0);
  return d.toISOString().slice(0, 10);
}

// Month-quarter checkpoints: days 1-7 = week1, 8-14 = week2, 15-21 = week3, 22-end = week4
function getMonthWeekNumber(dateString: string): number {
  const day = Number(dateString.slice(8, 10));
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  return 4;
}

function achievementStatus(achievement: number, hasTarget: boolean): Status {
  if (!hasTarget) return "none";
  if (achievement >= 95) return "green";
  if (achievement >= 85) return "amber";
  return "red";
}

function statusColor(status: Status) {
  if (status === "green") return "#16a34a";
  if (status === "amber") return "#d97706";
  if (status === "red") return "#dc2626";
  return "#666";
}

function statusLabel(status: Status) {
  if (status === "none") return "No Target";
  return status.toUpperCase();
}

const THRESHOLD = 85; // % cumulative achievement that counts as "on track"

export default function DashboardView() {
  const [summaries, setSummaries] = useState<PlantSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAll() {
      const currentMonth = getMonthFromDate(today);
      const monthStart = getMonthStart(today);
      const monthEnd = getMonthEnd(today);

      const [
        plantsRes,
        openRes,
        brokenOpenRes,
        prodRes,
        dispRes,
        brkRes,
        scrapRes,
        prodTargetsRes,
        dispTargetsRes,
      ] = await Promise.all([
        supabase.from("plants").select("id, name, type").eq("active", true).order("name"),
        supabase.from("opening_balances").select("*"),
        supabase.from("broken_opening_balances").select("*"),
        supabase.from("production_entries").select("*"),
        supabase.from("dispatch_entries").select("*"),
        supabase.from("breakage_entries").select("*"),
        supabase.from("scrap_processed_entries").select("*"),
        supabase
          .from("monthly_production_targets")
          .select("*")
          .eq("target_month", currentMonth),
        supabase
          .from("monthly_dispatch_targets")
          .select("*")
          .eq("target_month", currentMonth),
      ]);

      const plants = plantsRes.data || [];
      const opening = openRes.data || [];
      const brokenOpening = brokenOpenRes.data || [];
      const production = prodRes.data || [];
      const dispatch = dispRes.data || [];
      const breakage = brkRes.data || [];
      const scrap = scrapRes.data || [];
      const prodTargets: MonthlyTarget[] = prodTargetsRes.data || [];
      const dispTargets: MonthlyTarget[] = dispTargetsRes.data || [];

      const weekNumber = getMonthWeekNumber(today);

      // Returns the as_of_date cutoff for a plant (or null if no opening balance row).
      // We use the LATEST opening balance for the plant.
      function cutoffFor(rows: any[], plantId: string): { cutoff: string | null; bal: SizeTotals } {
        const forPlant = rows
          .filter((r) => r.plant_id === plantId)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

        if (forPlant.length === 0) return { cutoff: null, bal: emptyTotals() };

        const latest = forPlant[0];
        return {
          cutoff: latest.as_of_date || null,
          bal: {
            s31: latest.bal_31 || 0,
            s36: latest.bal_36 || 0,
            s45: latest.bal_45 || 0,
          },
        };
      }

      // Sum entry rows for a plant, with optional date constraints.
      // - cutoff: only count entries dated on/after this date (opening-balance date cutoff)
      // - from/to: only count entries within this inclusive range
      // - onlyToday: only count today's entries
      function sumFor(
        rows: any[],
        plantId: string,
        opts: { cutoff?: string | null; from?: string; to?: string; onlyToday?: boolean } = {}
      ): SizeTotals {
        const t = emptyTotals();

        for (const r of rows) {
          if (r.plant_id !== plantId) continue;
          if (opts.onlyToday && r.entry_date !== today) continue;
          if (opts.cutoff && r.entry_date < opts.cutoff) continue;
          if (opts.from && r.entry_date < opts.from) continue;
          if (opts.to && r.entry_date > opts.to) continue;

          t.s31 += r.qty_31 || 0;
          t.s36 += r.qty_36 || 0;
          t.s45 += r.qty_45 || 0;
        }

        return t;
      }

      // Build a production/dispatch KPI for a metric.
      function buildKPI(
        rows: any[],
        plantId: string,
        target: MonthlyTarget | undefined
      ): MetricKPI {
        const monthlyTarget = targetTotal(target);
        const hasTarget = monthlyTarget > 0;

        // Cumulative month-to-date actual
        const monthActual = total(
          sumFor(rows, plantId, { from: monthStart, to: monthEnd })
        );

        // Cumulative target up to the current month-quarter checkpoint
        const quarterTarget = hasTarget ? Math.round((monthlyTarget / 4) * weekNumber) : 0;
        const quarterActual = monthActual; // month-to-date = cumulative to today

        const monthAchievement = hasTarget
          ? Math.round((monthActual / monthlyTarget) * 100)
          : 0;
        const quarterAchievement = quarterTarget > 0
          ? Math.round((quarterActual / quarterTarget) * 100)
          : 0;

        const behindThisCheckpoint = hasTarget && quarterAchievement < THRESHOLD;

        // Operations-side flag: weeks 1 and 2 are shown to the Ops Manager.
        // Week 3+ behind is handled (and surfaced) by the Executive dashboard.
        let opsFlag: "none" | "week1" | "week2" = "none";
        if (behindThisCheckpoint && weekNumber === 1) opsFlag = "week1";
        else if (behindThisCheckpoint && weekNumber === 2) opsFlag = "week2";

        return {
          monthlyTarget,
          monthActual,
          monthAchievement,
          quarterTarget,
          quarterActual,
          quarterAchievement,
          status: achievementStatus(monthAchievement, hasTarget),
          behindThisCheckpoint,
          weekNumber,
          opsFlag,
        };
      }

      const result: PlantSummary[] = plants.map((plant) => {
        const goodOpen = cutoffFor(opening, plant.id);
        const brokenOpen = cutoffFor(brokenOpening, plant.id);

        // Closing stock counts only entries on/after the opening-balance as_of_date.
        const cut = goodOpen.cutoff;
        const brokenCut = brokenOpen.cutoff;

        const totalProduced = sumFor(production, plant.id, { cutoff: cut });
        const totalDispatched = sumFor(dispatch, plant.id, { cutoff: cut });
        const totalBroken = sumFor(breakage, plant.id, { cutoff: cut });
        const totalScrapProcessed = sumFor(scrap, plant.id, { cutoff: brokenCut });
        const totalBrokenFromBrokenCut = sumFor(breakage, plant.id, { cutoff: brokenCut });

        const closingGoodStock: SizeTotals = {
          s31: goodOpen.bal.s31 + totalProduced.s31 - totalBroken.s31 - totalDispatched.s31,
          s36: goodOpen.bal.s36 + totalProduced.s36 - totalBroken.s36 - totalDispatched.s36,
          s45: goodOpen.bal.s45 + totalProduced.s45 - totalBroken.s45 - totalDispatched.s45,
        };

        const closingBrokenStock: SizeTotals = {
          s31: brokenOpen.bal.s31 + totalBrokenFromBrokenCut.s31 - totalScrapProcessed.s31,
          s36: brokenOpen.bal.s36 + totalBrokenFromBrokenCut.s36 - totalScrapProcessed.s36,
          s45: brokenOpen.bal.s45 + totalBrokenFromBrokenCut.s45 - totalScrapProcessed.s45,
        };

        const todayProduced = sumFor(production, plant.id, { onlyToday: true });
        const todayDispatched = sumFor(dispatch, plant.id, { onlyToday: true });
        const todayBroken = sumFor(breakage, plant.id, { onlyToday: true });

        const prodTarget = prodTargets.find((t) => t.plant_id === plant.id);
        const dispTarget = dispTargets.find((t) => t.plant_id === plant.id);

        const productionKPI = buildKPI(production, plant.id, prodTarget);
        const dispatchKPI = buildKPI(dispatch, plant.id, dispTarget);

        // Breakage rate: month-to-date broken / produced
        const monthProducedTotal = productionKPI.monthActual;
        const monthBrokenTotal = total(
          sumFor(breakage, plant.id, { from: monthStart, to: monthEnd })
        );
        const breakageRate =
          monthProducedTotal > 0 ? (monthBrokenTotal / monthProducedTotal) * 100 : 0;

        let breakageStatus: Status = "green";
        if (monthProducedTotal === 0) breakageStatus = "none";
        else if (breakageRate > 1.5) breakageStatus = "red";
        else if (breakageRate > 1.0) breakageStatus = "amber";

        const enteredToday =
          production.some((r) => r.plant_id === plant.id && r.entry_date === today) ||
          dispatch.some((r) => r.plant_id === plant.id && r.entry_date === today) ||
          breakage.some((r) => r.plant_id === plant.id && r.entry_date === today);

        return {
          plant,
          closingGoodStock,
          closingBrokenStock,
          todayProduced,
          todayDispatched,
          todayBroken,
          production: productionKPI,
          dispatch: dispatchKPI,
          breakageRate,
          breakageStatus,
          enteredToday,
        };
      });

      setSummaries(result);
      setLoading(false);
    }

    loadAll();
  }, []);

  if (loading) return <p>Loading dashboard</p>;

  const totalProducedToday = summaries.reduce((sum, s) => sum + total(s.todayProduced), 0);
  const totalDispatchedToday = summaries.reduce((sum, s) => sum + total(s.todayDispatched), 0);
  const totalBrokenToday = summaries.reduce((sum, s) => sum + total(s.todayBroken), 0);
  const totalClosingGoodStock = summaries.reduce((sum, s) => sum + total(s.closingGoodStock), 0);
  const totalClosingBrokenStock = summaries.reduce((sum, s) => sum + total(s.closingBrokenStock), 0);
  const plantsMissingEntry = summaries.filter((s) => !s.enteredToday);

  // Week 1/2 Operations alerts (production or dispatch behind at this checkpoint)
  const opsAlerts = summaries.filter(
    (s) => s.production.opsFlag !== "none" || s.dispatch.opsFlag !== "none"
  );
  const breakageAlerts = summaries.filter(
    (s) => s.breakageStatus === "amber" || s.breakageStatus === "red"
  );

  const weekNum = summaries.length > 0 ? summaries[0].production.weekNumber : 0;

  return (
    <div>
            <p style={{ color: "#666", fontSize: "14px", marginBottom: "24px" }}>
        {`Operations snapshot for ${today} (month-week ${weekNum} of 4). Weekly targets are derived as monthly / 4, cumulative. Stock counts entries from each plant's opening-balance date onward.`}
      </p>

      {/* Operations alerts: weeks 1-2 behind flags for the Operations Manager */}
      <SectionTitle title="Operations Alerts (Weeks 1-2)" />
      <div style={{ marginBottom: "32px" }}>
        {opsAlerts.length === 0 && breakageAlerts.length === 0 ? (
          <div style={okBoxStyle}>No early-warning alerts. Production, dispatch and breakage are on track.</div>
        ) : (
          <div style={alertBoxStyle}>
            <strong>Attention required:</strong>
            <ul style={{ marginTop: "8px", marginBottom: 0 }}>
              {opsAlerts.map((s) => (
                <li key={`ops-${s.plant.id}`}>
                  {s.plant.name}:
                  {s.production.opsFlag !== "none" &&
                    ` Production behind at week ${s.production.weekNumber} (${s.production.quarterAchievement}% of cumulative target).`}
                  {s.dispatch.opsFlag !== "none" &&
                    ` Dispatch behind at week ${s.dispatch.weekNumber} (${s.dispatch.quarterAchievement}% of cumulative target).`}
                </li>
              ))}
              {breakageAlerts.map((s) => (
                <li key={`brk-${s.plant.id}`}>
                  {s.plant.name}: Breakage at {s.breakageRate.toFixed(2)}%
                  {s.breakageStatus === "red" ? " — exceeds 1.5% limit (red)." : " — above 1% (amber)."}
                </li>
              ))}
            </ul>
            <div style={{ marginTop: "8px", fontSize: "13px", color: "#7f1d1d" }}>
              Week 3+ shortfalls escalate to the Executive dashboard automatically.
            </div>
          </div>
        )}
      </div>

      <SectionTitle title="Production KPI" />
      <KPITable summaries={summaries} metric="production" />

      <SectionTitle title="Dispatch KPI" />
      <KPITable summaries={summaries} metric="dispatch" />

      <SectionTitle title="Breakage KPI" />
      <div style={{ overflowX: "auto", marginBottom: "32px" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "600px" }}>
          <thead>
            <tr style={{ backgroundColor: "#fafafa" }}>
              <th style={tableHeaderStyle}>Plant</th>
              <th style={tableHeaderStyle}>Month Produced</th>
              <th style={tableHeaderStyle}>Breakage Rate</th>
              <th style={tableHeaderStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((s) => {
              const color = statusColor(s.breakageStatus);
              return (
                <tr key={s.plant.id}>
                  <td style={tableCellStyle}><strong>{s.plant.name}</strong></td>
                  <td style={tableCellStyle}>{s.production.monthActual.toLocaleString()}</td>
                  <td style={{ ...tableCellStyle, color, fontWeight: "bold" }}>
                    {s.breakageStatus === "none" ? "—" : `${s.breakageRate.toFixed(2)}%`}
                  </td>
                  <td style={{ ...tableCellStyle, color, fontWeight: "bold" }}>
                    {s.breakageStatus === "none" ? "No Production" : statusLabel(s.breakageStatus)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <SectionTitle title="Today&apos;s Business Snapshot" />
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "32px" }}>
        <HeadlineCard label="Produced Today" value={totalProducedToday} color="#16a34a" />
        <HeadlineCard label="Broken Today" value={totalBrokenToday} color="#dc2626" />
        <HeadlineCard label="Dispatched Today" value={totalDispatchedToday} color="#7c3aed" />
        <HeadlineCard label="Plants Missing Entry" value={plantsMissingEntry.length} color="#ef4444" />
        <HeadlineCard label="Closing Good Stock" value={totalClosingGoodStock} color="#0070f3" />
        <HeadlineCard label="Closing Broken Stock" value={totalClosingBrokenStock} color="#d97706" />
      </div>

      <SectionTitle title="Missing Entries" />
      <div style={{ marginBottom: "32px" }}>
        {plantsMissingEntry.length === 0 ? (
          <div style={okBoxStyle}>All active plants have submitted an entry today.</div>
        ) : (
          <div style={alertBoxStyle}>
            <strong>{plantsMissingEntry.length} plant(s) have not submitted today:</strong>
            <ul style={{ marginTop: "8px", marginBottom: 0 }}>
              {plantsMissingEntry.map((s) => (
                <li key={s.plant.id}>{s.plant.name}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <SectionTitle title="Plant Summary" />
      <div style={{ display: "grid", gap: "20px" }}>
        {summaries.map((s) => (
          <div key={s.plant.id} style={{ border: "1px solid #e0e0e0", borderRadius: "10px", padding: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div>
                <h2 style={{ fontSize: "20px", fontWeight: "bold", marginBottom: "4px" }}>{s.plant.name}</h2>
                <div style={{ fontSize: "13px", color: "#666" }}>{s.plant.type || "Plant"}</div>
              </div>
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: "bold",
                  padding: "4px 12px",
                  borderRadius: "12px",
                  color: "white",
                  backgroundColor: s.enteredToday ? "#16a34a" : "#dc2626",
                }}
              >
                {s.enteredToday ? "Updated today" : "No entry today"}
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: "12px",
              }}
            >
              <MiniMetric label="Produced Today" value={total(s.todayProduced)} color="#16a34a" />
              <MiniMetric label="Broken Today" value={total(s.todayBroken)} color="#dc2626" />
              <MiniMetric label="Dispatched Today" value={total(s.todayDispatched)} color="#7c3aed" />
              <MiniMetric label="Closing Good" value={total(s.closingGoodStock)} color="#0070f3" />
              <MiniMetric label="Closing Broken" value={total(s.closingBrokenStock)} color="#d97706" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KPITable({ summaries, metric }: { summaries: PlantSummary[]; metric: "production" | "dispatch" }) {
  return (
    <div style={{ overflowX: "auto", marginBottom: "32px" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "900px" }}>
        <thead>
          <tr style={{ backgroundColor: "#fafafa" }}>
            <th style={tableHeaderStyle}>Plant</th>
            <th style={tableHeaderStyle}>Monthly Target</th>
            <th style={tableHeaderStyle}>Month Actual</th>
            <th style={tableHeaderStyle}>Month Achievement</th>
            <th style={tableHeaderStyle}>Cumulative Wk Target</th>
            <th style={tableHeaderStyle}>Cumulative Actual</th>
            <th style={tableHeaderStyle}>Wk Achievement</th>
            <th style={tableHeaderStyle}>Status</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((s) => {
            const k = s[metric];
            const color = statusColor(k.status);
            const wkColor = k.behindThisCheckpoint ? "#dc2626" : "#16a34a";
            return (
              <tr key={s.plant.id}>
                <td style={tableCellStyle}><strong>{s.plant.name}</strong></td>
                <td style={tableCellStyle}>{k.monthlyTarget.toLocaleString()}</td>
                <td style={tableCellStyle}>{k.monthActual.toLocaleString()}</td>
                <td style={{ ...tableCellStyle, color, fontWeight: "bold" }}>
                  {k.monthlyTarget > 0 ? `${k.monthAchievement}%` : "No Target"}
                </td>
                <td style={tableCellStyle}>{k.quarterTarget.toLocaleString()}</td>
                <td style={tableCellStyle}>{k.quarterActual.toLocaleString()}</td>
                <td style={{ ...tableCellStyle, color: k.monthlyTarget > 0 ? wkColor : "#666", fontWeight: "bold" }}>
                  {k.monthlyTarget > 0 ? `${k.quarterAchievement}%` : "No Target"}
                </td>
                <td style={{ ...tableCellStyle, color, fontWeight: "bold" }}>
                  {statusLabel(k.status)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h2 style={{ fontSize: "20px", fontWeight: "bold", marginBottom: "16px", marginTop: "8px" }}>
      {title}
    </h2>
  );
}

function HeadlineCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        flex: "1",
        minWidth: "180px",
        border: "1px solid #e0e0e0",
        borderRadius: "10px",
        padding: "20px",
        borderTop: `4px solid ${color}`,
      }}
    >
      <div style={{ fontSize: "13px", color: "#666", marginBottom: "6px" }}>{label}</div>
      <div style={{ fontSize: "30px", fontWeight: "bold", color }}>{value.toLocaleString()}</div>
    </div>
  );
}

function MiniMetric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ border: "1px solid #eee", borderRadius: "8px", padding: "12px", backgroundColor: "#fafafa" }}>
      <div style={{ fontSize: "12px", color: "#666", marginBottom: "4px" }}>{label}</div>
      <div style={{ fontSize: "22px", fontWeight: "bold", color }}>{value.toLocaleString()}</div>
    </div>
  );
}

const tableHeaderStyle = {
  textAlign: "left" as const,
  border: "1px solid #e0e0e0",
  padding: "10px",
  fontSize: "14px",
};

const tableCellStyle = {
  border: "1px solid #e0e0e0",
  padding: "10px",
  fontSize: "14px",
};

const okBoxStyle = {
  border: "1px solid #bbf7d0",
  backgroundColor: "#f0fdf4",
  color: "#166534",
  borderRadius: "10px",
  padding: "16px",
  fontWeight: "bold" as const,
};

const alertBoxStyle = {
  border: "1px solid #fecaca",
  backgroundColor: "#fef2f2",
  color: "#991b1b",
  borderRadius: "10px",
  padding: "16px",
};
