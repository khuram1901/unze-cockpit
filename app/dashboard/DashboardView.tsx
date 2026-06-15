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

type PlantSummary = {
  plant: Plant;
  closingGoodStock: SizeTotals;
  closingBrokenStock: SizeTotals;
  todayProduced: SizeTotals;
  todayDispatched: SizeTotals;
  todayBroken: SizeTotals;
  weekProduced: SizeTotals;
  monthProduced: SizeTotals;
  monthlyProductionTarget: number;
  weeklyProductionTarget: number;
  weeklyProductionAchievement: number;
  monthlyProductionAchievement: number;
  productionStatus: "green" | "amber" | "red" | "none";
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

function getMondayFromDate(dateString: string) {
  const d = new Date(dateString);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

function addDays(dateString: string, days: number) {
  const d = new Date(dateString);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function achievementStatus(achievement: number, hasTarget: boolean): "green" | "amber" | "red" | "none" {
  if (!hasTarget) return "none";
  if (achievement >= 95) return "green";
  if (achievement >= 85) return "amber";
  return "red";
}

function statusColor(status: "green" | "amber" | "red" | "none") {
  if (status === "green") return "#16a34a";
  if (status === "amber") return "#d97706";
  if (status === "red") return "#dc2626";
  return "#666";
}

function statusLabel(status: "green" | "amber" | "red" | "none") {
  if (status === "none") return "No Target";
  return status.toUpperCase();
}

export default function DashboardView() {
  const [summaries, setSummaries] = useState<PlantSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAll() {
      const currentMonth = getMonthFromDate(today);
      const monthStart = getMonthStart(today);
      const monthEnd = getMonthEnd(today);
      const weekStart = getMondayFromDate(today);
      const weekEnd = addDays(weekStart, 6);

      const [
        plantsRes,
        openRes,
        brokenOpenRes,
        prodRes,
        dispRes,
        brkRes,
        scrapRes,
        monthlyTargetsRes,
        weekProductionRes,
        monthProductionRes,
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
          .from("production_entries")
          .select("*")
          .gte("entry_date", weekStart)
          .lte("entry_date", weekEnd),
        supabase
          .from("production_entries")
          .select("*")
          .gte("entry_date", monthStart)
          .lte("entry_date", monthEnd),
      ]);

      const plants = plantsRes.data || [];
      const opening = openRes.data || [];
      const brokenOpening = brokenOpenRes.data || [];
      const production = prodRes.data || [];
      const dispatch = dispRes.data || [];
      const breakage = brkRes.data || [];
      const scrap = scrapRes.data || [];
      const monthlyTargets: MonthlyTarget[] = monthlyTargetsRes.data || [];
      const weekProduction = weekProductionRes.data || [];
      const monthProduction = monthProductionRes.data || [];

      function sumFor(rows: any[], plantId: string, onlyToday: boolean): SizeTotals {
        const t = emptyTotals();

        for (const r of rows) {
          if (r.plant_id !== plantId) continue;
          if (onlyToday && r.entry_date !== today) continue;

          t.s31 += r.qty_31 || 0;
          t.s36 += r.qty_36 || 0;
          t.s45 += r.qty_45 || 0;
        }

        return t;
      }

      function openingFor(rows: any[], plantId: string): SizeTotals {
        const t = emptyTotals();

        const forPlant = rows
          .filter((r) => r.plant_id === plantId)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

        if (forPlant.length > 0) {
          const latest = forPlant[0];
          t.s31 = latest.bal_31 || 0;
          t.s36 = latest.bal_36 || 0;
          t.s45 = latest.bal_45 || 0;
        }

        return t;
      }

      const result: PlantSummary[] = plants.map((plant) => {
        const openingGood = openingFor(opening, plant.id);
        const openingBroken = openingFor(brokenOpening, plant.id);

        const totalProduced = sumFor(production, plant.id, false);
        const totalDispatched = sumFor(dispatch, plant.id, false);
        const totalBroken = sumFor(breakage, plant.id, false);
        const totalScrapProcessed = sumFor(scrap, plant.id, false);

        const closingGoodStock: SizeTotals = {
          s31: openingGood.s31 + totalProduced.s31 - totalBroken.s31 - totalDispatched.s31,
          s36: openingGood.s36 + totalProduced.s36 - totalBroken.s36 - totalDispatched.s36,
          s45: openingGood.s45 + totalProduced.s45 - totalBroken.s45 - totalDispatched.s45,
        };

        const closingBrokenStock: SizeTotals = {
          s31: openingBroken.s31 + totalBroken.s31 - totalScrapProcessed.s31,
          s36: openingBroken.s36 + totalBroken.s36 - totalScrapProcessed.s36,
          s45: openingBroken.s45 + totalBroken.s45 - totalScrapProcessed.s45,
        };

        const todayProduced = sumFor(production, plant.id, true);
        const todayDispatched = sumFor(dispatch, plant.id, true);
        const todayBroken = sumFor(breakage, plant.id, true);

        const weekProduced = sumFor(weekProduction, plant.id, false);
        const monthProduced = sumFor(monthProduction, plant.id, false);

        const target = monthlyTargets.find((t) => t.plant_id === plant.id);
        const monthlyProductionTarget = targetTotal(target);
        const weeklyProductionTarget = monthlyProductionTarget > 0 ? Math.round(monthlyProductionTarget / 4) : 0;

        const weeklyActual = total(weekProduced);
        const monthlyActual = total(monthProduced);

        const weeklyProductionAchievement =
          weeklyProductionTarget > 0 ? Math.round((weeklyActual / weeklyProductionTarget) * 100) : 0;

        const monthlyProductionAchievement =
          monthlyProductionTarget > 0 ? Math.round((monthlyActual / monthlyProductionTarget) * 100) : 0;

        const productionStatus = achievementStatus(
          monthlyProductionAchievement,
          monthlyProductionTarget > 0
        );

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
          weekProduced,
          monthProduced,
          monthlyProductionTarget,
          weeklyProductionTarget,
          weeklyProductionAchievement,
          monthlyProductionAchievement,
          productionStatus,
          enteredToday,
        };
      });

      setSummaries(result);
      setLoading(false);
    }

    loadAll();
  }, []);

  if (loading) return <p>Loading dashboard…</p>;

  const totalProducedToday = summaries.reduce((sum, s) => sum + total(s.todayProduced), 0);
  const totalDispatchedToday = summaries.reduce((sum, s) => sum + total(s.todayDispatched), 0);
  const totalBrokenToday = summaries.reduce((sum, s) => sum + total(s.todayBroken), 0);
  const totalClosingGoodStock = summaries.reduce((sum, s) => sum + total(s.closingGoodStock), 0);
  const totalClosingBrokenStock = summaries.reduce((sum, s) => sum + total(s.closingBrokenStock), 0);
  const plantsMissingEntry = summaries.filter((s) => !s.enteredToday);

  return (
    <div>
      <p style={{ color: "#666", fontSize: "14px", marginBottom: "24px" }}>
        Operations snapshot for {today}. Monthly production targets are stored. Weekly targets are derived automatically from monthly targets.
      </p>

      <SectionTitle title="Production KPI" />

      <div style={{ overflowX: "auto", marginBottom: "32px" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "900px" }}>
          <thead>
            <tr style={{ backgroundColor: "#fafafa" }}>
              <th style={tableHeaderStyle}>Plant</th>
              <th style={tableHeaderStyle}>Monthly Target</th>
              <th style={tableHeaderStyle}>Month Actual</th>
              <th style={tableHeaderStyle}>Month Achievement</th>
              <th style={tableHeaderStyle}>Derived Weekly Target</th>
              <th style={tableHeaderStyle}>Week Actual</th>
              <th style={tableHeaderStyle}>Week Achievement</th>
              <th style={tableHeaderStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((s) => {
              const color = statusColor(s.productionStatus);

              return (
                <tr key={s.plant.id}>
                  <td style={tableCellStyle}>
                    <strong>{s.plant.name}</strong>
                  </td>
                  <td style={tableCellStyle}>{s.monthlyProductionTarget.toLocaleString()}</td>
                  <td style={tableCellStyle}>{total(s.monthProduced).toLocaleString()}</td>
                  <td style={{ ...tableCellStyle, color, fontWeight: "bold" }}>
                    {s.monthlyProductionTarget > 0 ? `${s.monthlyProductionAchievement}%` : "No Target"}
                  </td>
                  <td style={tableCellStyle}>{s.weeklyProductionTarget.toLocaleString()}</td>
                  <td style={tableCellStyle}>{total(s.weekProduced).toLocaleString()}</td>
                  <td style={tableCellStyle}>
                    {s.weeklyProductionTarget > 0 ? `${s.weeklyProductionAchievement}%` : "No Target"}
                  </td>
                  <td style={{ ...tableCellStyle, color, fontWeight: "bold" }}>
                    {statusLabel(s.productionStatus)}
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

      <SectionTitle title="Exceptions" />

      <div style={{ marginBottom: "32px" }}>
        {plantsMissingEntry.length === 0 ? (
          <div
            style={{
              border: "1px solid #bbf7d0",
              backgroundColor: "#f0fdf4",
              color: "#166534",
              borderRadius: "10px",
              padding: "16px",
              fontWeight: "bold",
            }}
          >
            All active plants have submitted an entry today.
          </div>
        ) : (
          <div
            style={{
              border: "1px solid #fecaca",
              backgroundColor: "#fef2f2",
              color: "#991b1b",
              borderRadius: "10px",
              padding: "16px",
            }}
          >
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
        {summaries.map((s) => {
          const produced = total(s.todayProduced);
          const broken = total(s.todayBroken);
          const dispatched = total(s.todayDispatched);
          const closingGood = total(s.closingGoodStock);
          const closingBroken = total(s.closingBrokenStock);

          return (
            <div
              key={s.plant.id}
              style={{
                border: "1px solid #e0e0e0",
                borderRadius: "10px",
                padding: "20px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "16px",
                }}
              >
                <div>
                  <h2 style={{ fontSize: "20px", fontWeight: "bold", marginBottom: "4px" }}>
                    {s.plant.name}
                  </h2>
                  <div style={{ fontSize: "13px", color: "#666" }}>
                    {s.plant.type || "Plant"}
                  </div>
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
                  {s.enteredToday ? "Updated today ✓" : "No entry today"}
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: "12px",
                  marginBottom: "20px",
                }}
              >
                <MiniMetric label="Produced" value={produced} color="#16a34a" />
                <MiniMetric label="Broken" value={broken} color="#dc2626" />
                <MiniMetric label="Dispatched" value={dispatched} color="#7c3aed" />
                <MiniMetric label="Closing Good" value={closingGood} color="#0070f3" />
                <MiniMetric label="Closing Broken" value={closingBroken} color="#d97706" />
              </div>
            </div>
          );
        })}
      </div>
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