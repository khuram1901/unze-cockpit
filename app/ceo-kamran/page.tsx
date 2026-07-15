"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import { COLOURS, RADII, StatusBadge, SectionTitle, FreshnessBadge } from "../lib/SharedUI";
import { formatDateUK, workingDaysFromNow } from "../lib/dateUtils";
import { IFPL_COMPANY_ID } from "../lib/constants";
import { useMobile } from "../lib/useMobile";
import { useUserCtx } from "../lib/useUserCtx";
import { isSecondaryCEO } from "../lib/permissions";
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar,
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  Legend, ReferenceLine, LabelList,
} from "recharts";

const {
  NAVY, SLATE, CANVAS, HAIRLINE, CARD_ALT, GREEN, AMBER, RED, BLUE,
  SUCCESS_SOFT, WARNING_SOFT, DANGER_SOFT, CARD,
} = COLOURS;

// ── Helpers ──────────────────────────────────────────────────────
function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.abs(n).toLocaleString("en-GB");
}
function fmtShort(n: number | null | undefined): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// ── Types ─────────────────────────────────────────────────────────
type Task = {
  id: string;
  description: string;
  status: string;
  due_date: string | null;
  assigned_to: string | null;
  assigned_by: string | null;
  priority: string | null;
  project: string | null;
  updated_at: string | null;
};

type KpiRow = {
  total: number;
  open: number;
  overdue: number;
  stuck: number;
  completed_this_month: number;
};

type CashRow = {
  report_date: string;
  closing_balance: number;
  reconciled: boolean;
};

type PdcBucket = {
  week_number: number;
  week_start: string;
  week_end: string;
  pdc_due: number;
  effective_balance: number;
};

type MeetingRow = {
  id: string;
  title: string;
  meeting_date: string;
};

// ── Status colour helper ──────────────────────────────────────────
function statusColour(s: string) {
  if (s === "Completed") return GREEN;
  if (s === "In Progress") return BLUE;
  if (s === "Stuck") return RED;
  if (s === "Pending") return AMBER;
  return SLATE;
}
function priorityColour(p: string | null) {
  if (p === "Critical") return RED;
  if (p === "High") return AMBER;
  if (p === "Medium") return BLUE;
  return SLATE;
}

// ── KPI tile ─────────────────────────────────────────────────────
function KpiTile({
  label, value, colour, soft,
}: { label: string; value: string | number; colour: string; soft: string }) {
  return (
    <div style={{
      backgroundColor: soft, border: `1px solid ${colour}22`,
      borderRadius: "12px", padding: "16px 20px", flex: 1, minWidth: 0,
    }}>
      <div style={{ fontSize: "11px", fontWeight: 600, color: colour, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: "28px", fontWeight: 700, color: colour, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────
export default function CeoKamranPage() {
  const router = useRouter();
  const isMobile = useMobile();
  const userCtx = useUserCtx();

  const [myTasks, setMyTasks] = useState<Task[]>([]);
  const [allOpenTasks, setAllOpenTasks] = useState<Task[]>([]);
  const [kpi, setKpi] = useState<KpiRow | null>(null);
  const [cashHistory, setCashHistory] = useState<CashRow[]>([]);
  const [latestCash, setLatestCash] = useState<CashRow | null>(null);
  const [pdcOutlook, setPdcOutlook] = useState<PdcBucket[]>([]);
  const [upcomingMeetings, setUpcomingMeetings] = useState<MeetingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskFilter, setTaskFilter] = useState<"mine" | "all">("mine");

  // Guard — only Kamran can see this page
  useEffect(() => {
    if (userCtx && !isSecondaryCEO(userCtx)) {
      router.replace("/home");
    }
  }, [userCtx, router]);

  const load = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    const { data: { session } } = await supabase.auth.getSession();
    const email = session?.user?.email ?? "";

    const [
      myTasksRes,
      allTasksRes,
      kpiRes,
      cashRes,
      pdcRes,
      meetingsRes,
    ] = await Promise.all([
      // Tasks assigned to or created by Kamran
      supabase
        .from("tasks")
        .select("id, description, status, due_date, assigned_to, assigned_by, priority, project, updated_at")
        .or(`assigned_to_email.eq.${email},assigned_by.eq.${email}`)
        .not("status", "in", '("Completed","Cancelled")')
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(50),

      // All open tasks — Kamran is CEO so can see everything
      supabase
        .from("tasks")
        .select("id, description, status, due_date, assigned_to, assigned_by, priority, project, updated_at")
        .not("status", "in", '("Completed","Cancelled")')
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(100),

      // Task KPI — all tasks (CEO view)
      supabase.rpc("get_tasks_kpi_summary"),

      // IFPL cash history — rolling 30 days
      supabase
        .from("daily_cash_position")
        .select("report_date, closing_balance, reconciled")
        .eq("company_id", IFPL_COMPANY_ID)
        .gte("report_date", thirtyDaysAgo)
        .order("report_date", { ascending: true }),

      // PDC outlook for IFPL
      supabase.rpc("get_pdc_outlook", {
        p_company_id: IFPL_COMPANY_ID,
        p_today: today,
      }),

      // Upcoming meetings — next 14 days
      supabase
        .from("meetings")
        .select("id, title, meeting_date")
        .gte("meeting_date", today)
        .order("meeting_date", { ascending: true })
        .limit(5),
    ]);

    setMyTasks(myTasksRes.data ?? []);
    setAllOpenTasks(allTasksRes.data ?? []);

    const k = kpiRes.data?.[0];
    if (k) setKpi(k as KpiRow);

    const cash = cashRes.data ?? [];
    setCashHistory(cash);
    if (cash.length > 0) setLatestCash(cash[cash.length - 1]);

    setPdcOutlook(pdcRes.data ?? []);
    setUpcomingMeetings(meetingsRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <AuthWrapper>
        <main style={{ padding: "32px", color: SLATE }}>Loading…</main>
      </AuthWrapper>
    );
  }

  const displayedTasks = taskFilter === "mine" ? myTasks : allOpenTasks;
  const overdueTasks = displayedTasks.filter(t => {
    if (!t.due_date) return false;
    return t.due_date < new Date().toISOString().slice(0, 10);
  });
  const stuckTasks = displayedTasks.filter(t => t.status === "Stuck");

  // PDC chart data — same date-range label logic as FinanceManager
  const pdcChartData = pdcOutlook.map((w) => ({
    xLabel: (() => {
      const [, sm, sd] = w.week_start.split("-");
      const [, em, ed] = w.week_end.split("-");
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const startDay = parseInt(sd, 10);
      const endDay   = parseInt(ed, 10);
      const startMon = months[parseInt(sm, 10) - 1];
      const endMon   = months[parseInt(em, 10) - 1];
      return sm === em
        ? `${startDay}–${endDay} ${endMon}`
        : `${startDay} ${startMon}–${endDay} ${endMon}`;
    })(),
    period: `${formatDateUK(w.week_start)} – ${formatDateUK(w.week_end)}`,
    pdc_due: w.pdc_due,
    effective_balance: w.effective_balance,
  }));

  const PdcXTick = ({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) => (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={12} textAnchor="middle" fill={SLATE} fontSize={10.5} fontFamily="Inter, sans-serif">
        {payload?.value}
      </text>
    </g>
  );

  const gap = isMobile ? "12px" : "16px";
  const col = isMobile ? "1fr" : "1fr 1fr";

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "16px" : "28px 32px", maxWidth: 1280, margin: "0 auto" }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: "24px" }}>
          <div style={{ fontSize: isMobile ? "20px" : "24px", fontWeight: 700, color: NAVY, lineHeight: 1.2 }}>
            CEO Dashboard — Imperial Footwear
          </div>
          <div style={{ fontSize: "13px", color: SLATE, marginTop: "4px" }}>
            {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            {latestCash && (
              <span style={{ marginLeft: 12 }}>
                · Cash position as at {formatDateUK(latestCash.report_date)}:{" "}
                <span style={{ fontWeight: 600, color: latestCash.closing_balance < 0 ? RED : GREEN }}>
                  PKR {fmt(latestCash.closing_balance)}
                </span>
                {" "}<FreshnessBadge dateStr={latestCash.report_date} />
              </span>
            )}
          </div>
        </div>

        {/* ── Task KPI tiles ── */}
        {kpi && (
          <div style={{ display: "flex", gap, flexWrap: "wrap", marginBottom: "24px" }}>
            <KpiTile label="Total Open" value={kpi.open} colour={NAVY} soft={CARD_ALT} />
            <KpiTile label="Overdue" value={kpi.overdue} colour={RED} soft={DANGER_SOFT} />
            <KpiTile label="Stuck" value={kpi.stuck} colour={AMBER} soft={WARNING_SOFT} />
            <KpiTile label="Done This Month" value={kpi.completed_this_month} colour={GREEN} soft={SUCCESS_SOFT} />
          </div>
        )}

        {/* ── Tasks panel ── */}
        <div style={{ border: `1px solid ${HAIRLINE}`, borderRadius: "14px", backgroundColor: CARD, marginBottom: "24px", overflow: "hidden" }}>
          {/* Tasks header + filter toggle */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: `1px solid ${HAIRLINE}` }}>
            <SectionTitle title="Tasks" style={{ margin: 0 }} />
            <div style={{ display: "flex", gap: "6px" }}>
              {(["mine", "all"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setTaskFilter(f)}
                  style={{
                    padding: "5px 14px", borderRadius: "20px", border: "none", cursor: "pointer",
                    fontSize: "12px", fontWeight: 600,
                    backgroundColor: taskFilter === f ? NAVY : HAIRLINE,
                    color: taskFilter === f ? "#fff" : SLATE,
                    transition: "all 0.15s",
                  }}
                >
                  {f === "mine" ? "My Tasks" : "All Tasks"}
                </button>
              ))}
            </div>
          </div>

          {/* Attention banners */}
          {overdueTasks.length > 0 && (
            <div style={{ backgroundColor: DANGER_SOFT, borderBottom: `1px solid ${RED}22`, padding: "10px 20px", fontSize: "12.5px", color: RED, fontWeight: 600 }}>
              ⚠️ {overdueTasks.length} overdue task{overdueTasks.length > 1 ? "s" : ""} — immediate attention required
            </div>
          )}
          {stuckTasks.length > 0 && (
            <div style={{ backgroundColor: WARNING_SOFT, borderBottom: `1px solid ${AMBER}22`, padding: "10px 20px", fontSize: "12.5px", color: AMBER, fontWeight: 600 }}>
              🚧 {stuckTasks.length} stuck task{stuckTasks.length > 1 ? "s" : ""}
            </div>
          )}

          {/* Task list */}
          {displayedTasks.length === 0 ? (
            <div style={{ padding: "32px 20px", textAlign: "center", color: SLATE, fontSize: "13px" }}>
              No open tasks{taskFilter === "mine" ? " assigned to you" : ""}.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ backgroundColor: CARD_ALT }}>
                    {["Task", "Assigned To", "Priority", "Status", "Due"].map(h => (
                      <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: SLATE, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayedTasks.map((t, i) => {
                    const isOverdue = t.due_date && t.due_date < new Date().toISOString().slice(0, 10);
                    const daysAway = t.due_date ? workingDaysFromNow(t.due_date) : null;
                    return (
                      <tr key={t.id} style={{ borderTop: i === 0 ? "none" : `1px solid ${HAIRLINE}`, backgroundColor: isOverdue ? `${RED}08` : "transparent" }}>
                        <td style={{ padding: "10px 16px", color: NAVY, maxWidth: 320 }}>
                          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.description}>{t.description}</div>
                          {t.project && <div style={{ fontSize: "11px", color: SLATE, marginTop: 2 }}>{t.project}</div>}
                        </td>
                        <td style={{ padding: "10px 16px", color: SLATE, whiteSpace: "nowrap" }}>{t.assigned_to || "—"}</td>
                        <td style={{ padding: "10px 16px" }}>
                          {t.priority ? (
                            <span style={{ fontSize: "11px", fontWeight: 600, color: priorityColour(t.priority), backgroundColor: `${priorityColour(t.priority)}18`, padding: "2px 8px", borderRadius: "10px" }}>
                              {t.priority}
                            </span>
                          ) : <span style={{ color: SLATE }}>—</span>}
                        </td>
                        <td style={{ padding: "10px 16px" }}>
                          <StatusBadge status={t.status} />
                        </td>
                        <td style={{ padding: "10px 16px", whiteSpace: "nowrap" }}>
                          {t.due_date ? (
                            <span style={{ color: isOverdue ? RED : daysAway !== null && daysAway <= 2 ? AMBER : SLATE, fontWeight: isOverdue ? 600 : 400 }}>
                              {formatDateUK(t.due_date)}
                              {isOverdue && <span style={{ marginLeft: 4, fontSize: "10px" }}>OVERDUE</span>}
                            </span>
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Bottom two-column grid ── */}
        <div style={{ display: "grid", gridTemplateColumns: col, gap, marginBottom: "24px" }}>

          {/* IFPL Cash History */}
          <div style={{ border: `1px solid ${HAIRLINE}`, borderRadius: "14px", padding: "20px", backgroundColor: CARD }}>
            <SectionTitle title="IFPL Cash — Last 30 Days" style={{ margin: "0 0 4px" }} />
            {latestCash && (
              <div style={{ fontSize: "12.5px", color: SLATE, marginBottom: "12px" }}>
                Latest: <span style={{ fontWeight: 600, color: latestCash.closing_balance < 0 ? RED : GREEN }}>PKR {fmt(latestCash.closing_balance)}</span>
                {" "}as at {formatDateUK(latestCash.report_date)}
              </div>
            )}
            {cashHistory.length === 0 ? (
              <div style={{ color: SLATE, fontSize: "13px" }}>No cash data yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={cashHistory.map(r => ({ date: formatDateUK(r.report_date), balance: r.closing_balance }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: SLATE }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: SLATE }} tickFormatter={v => fmtShort(v)} width={48} />
                  <Tooltip formatter={(v) => [`PKR ${Number(v).toLocaleString()}`, "Balance"]} contentStyle={{ fontSize: "12px", borderRadius: "8px" }} />
                  <ReferenceLine y={0} stroke={RED} strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="balance" stroke={BLUE} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Upcoming meetings */}
          <div style={{ border: `1px solid ${HAIRLINE}`, borderRadius: "14px", padding: "20px", backgroundColor: CARD }}>
            <SectionTitle title="Upcoming Meetings" style={{ margin: "0 0 12px" }} />
            {upcomingMeetings.length === 0 ? (
              <div style={{ color: SLATE, fontSize: "13px" }}>No meetings scheduled.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {upcomingMeetings.map(m => {
                  const daysAway = workingDaysFromNow(m.meeting_date);
                  return (
                    <div key={m.id} style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "10px 14px", backgroundColor: CARD_ALT, borderRadius: "10px", border: `1px solid ${HAIRLINE}` }}>
                      <div style={{ minWidth: 44, textAlign: "center" }}>
                        <div style={{ fontSize: "18px", fontWeight: 700, color: NAVY, lineHeight: 1 }}>
                          {new Date(m.meeting_date).getDate()}
                        </div>
                        <div style={{ fontSize: "10px", color: SLATE, textTransform: "uppercase" }}>
                          {new Date(m.meeting_date).toLocaleString("en-GB", { month: "short" })}
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title}</div>
                        <div style={{ fontSize: "11px", color: daysAway !== null && daysAway <= 1 ? AMBER : SLATE, marginTop: 2 }}>
                          {daysAway === 0 ? "Today" : daysAway === 1 ? "Tomorrow" : `In ${daysAway} days`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── PDC Outlook ── */}
        {pdcOutlook.length > 0 && (
          <div style={{ border: `1px solid ${HAIRLINE}`, borderRadius: "14px", padding: "20px 24px", backgroundColor: CARD, marginBottom: "24px" }}>
            <SectionTitle title="IFPL PDC Outlook — Next 8 Weeks" style={{ margin: "0 0 4px" }} />
            <div style={{ fontSize: "12.5px", color: SLATE, marginBottom: "8px" }}>
              Starting from today&apos;s cash in hand, assuming every scheduled PDC clears on time.
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={pdcChartData} margin={{ top: 24, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                <XAxis dataKey="xLabel" tick={<PdcXTick />} interval={0} height={36} />
                <YAxis tick={{ fontSize: 11, fill: SLATE }} tickFormatter={v => Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : `${(v / 1_000).toFixed(0)}K`} width={52} />
                <Tooltip
                  formatter={(value, name) => [`PKR ${Number(value).toLocaleString()}`, name]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.period || ""}
                  contentStyle={{ fontSize: "12px", borderRadius: "8px", border: `1px solid ${HAIRLINE}` }}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <ReferenceLine y={0} stroke={RED} strokeDasharray="4 4" />
                <Bar dataKey="pdc_due" fill={AMBER} name="PDC Due" radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey="effective_balance" stroke={NAVY} strokeWidth={2} dot={{ r: 3, fill: NAVY }} name="Effective Balance">
                  <LabelList
                    dataKey="effective_balance"
                    position="top"
                    formatter={(v: unknown) => {
                      const n = Number(v);
                      return isNaN(n) ? "" : fmtShort(n);
                    }}
                    style={{ fontSize: 11, fontWeight: 600, fill: NAVY }}
                  />
                </Line>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

      </main>
    </AuthWrapper>
  );
}
