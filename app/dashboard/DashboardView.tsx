"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import TaskStatus from "../tasks/TaskStatus";
import { formatDateUK } from "../lib/dateUtils";

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
  quarterTarget: number;
  quarterActual: number;
  quarterAchievement: number;
  status: Status;
  behindThisCheckpoint: boolean;
  weekNumber: number;
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
  breakageRate: number;
  breakageStatus: Status;
  enteredProductionToday: boolean;
  enteredDispatchToday: boolean;
  productionDaysMissing: number;
  dispatchDaysMissing: number;
};

type MachineIssue = {
  id: string;
  plant_name: string;
  machine_name: string;
  issue_status: string;
  expected_resolution: string | null;
  issue_description: string | null;
  action_taken: string | null;
  created_at: string;
};

type Task = {
  id: string;
  task_type: string | null;
  description: string;
  project: string | null;
  priority: string | null;
  due_date: string | null;
  assigned_date: string | null;
  assigned_to: string | null;
  assigned_to_email: string | null;
  assigned_by: string | null;
  status: string;
  stuck_reason: string | null;
  notes: string | null;
  reply_required: boolean | null;
  reply_text: string | null;
  reply_by: string | null;
  reply_at: string | null;
  corrective_action: string | null;
  recovery_date: string | null;
  impact_on_monthly_target: string | null;
};

const NAVY = "#1e293b";
const SLATE = "#64748b";
const BORDER = "#e2e8f0";

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
function getMonthFromDate(d: string) {
  return d.slice(0, 7);
}
function getMonthStart(d: string) {
  return `${d.slice(0, 7)}-01`;
}
function getMonthEnd(d: string) {
  const [y, m] = d.slice(0, 7).split("-").map(Number);
  return new Date(y, m, 0).toISOString().slice(0, 10);
}
function getMonthWeekNumber(d: string): number {
  const day = Number(d.slice(8, 10));
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  return 4;
}
function achievementStatus(a: number, hasTarget: boolean): Status {
  if (!hasTarget) return "none";
  if (a >= 95) return "green";
  if (a >= 85) return "amber";
  return "red";
}
function statusColor(s: Status) {
  if (s === "green") return "#16a34a";
  if (s === "amber") return "#d97706";
  if (s === "red") return "#dc2626";
  return "#666";
}
function statusLabel(s: Status) {
  if (s === "none") return "No Target";
  return s.toUpperCase();
}

// Working days (Mon-Fri) between two dates, exclusive of start, inclusive of end.
function workingDaysBetween(fromDate: string, toDate: string): number {
  const start = new Date(fromDate + "T00:00:00");
  const end = new Date(toDate + "T00:00:00");
  if (start >= end) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}
function lastEntryDate(rows: { plant_id: string; entry_date: string }[], plantId: string): string | null {
  const dates = rows.filter((r) => r.plant_id === plantId).map((r) => r.entry_date).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

const THRESHOLD = 85;

export default function DashboardView() {
  const [summaries, setSummaries] = useState<PlantSummary[]>([]);
  const [machineIssues, setMachineIssues] = useState<MachineIssue[]>([]);
  const [myTasks, setMyTasks] = useState<Task[]>([]);
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    const currentMonth = getMonthFromDate(today);
    const monthStart = getMonthStart(today);
    const monthEnd = getMonthEnd(today);

    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email || null;
    setMyEmail(email);

    const [
      plantsRes, openRes, brokenOpenRes, prodRes, dispRes, brkRes, scrapRes,
      prodTargetsRes, dispTargetsRes, machineRes, tasksRes,
    ] = await Promise.all([
      supabase.from("plants").select("id, name, type").eq("active", true).order("name"),
      supabase.from("opening_balances").select("*"),
      supabase.from("broken_opening_balances").select("*"),
      supabase.from("production_entries").select("*"),
      supabase.from("dispatch_entries").select("*"),
      supabase.from("breakage_entries").select("*"),
      supabase.from("scrap_processed_entries").select("*"),
      supabase.from("monthly_production_targets").select("*").eq("target_month", currentMonth),
      supabase.from("monthly_dispatch_targets").select("*").eq("target_month", currentMonth),
      supabase.from("machine_issues").select("*").neq("issue_status", "Resolved").order("created_at", { ascending: false }),
      supabase.from("tasks").select("*").order("created_at", { ascending: false }),
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

    setMachineIssues(machineRes.data || []);

    // Only the logged-in manager's own assigned tasks
    const allTasks: Task[] = tasksRes.data || [];
    setMyTasks(email ? allTasks.filter((t) => t.assigned_to_email === email) : []);

    const weekNumber = getMonthWeekNumber(today);

    function cutoffFor(rows: any[], plantId: string): { cutoff: string | null; bal: SizeTotals } {
      const forPlant = rows.filter((r) => r.plant_id === plantId).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      if (forPlant.length === 0) return { cutoff: null, bal: emptyTotals() };
      const latest = forPlant[0];
      return { cutoff: latest.as_of_date || null, bal: { s31: latest.bal_31 || 0, s36: latest.bal_36 || 0, s45: latest.bal_45 || 0 } };
    }

    function sumFor(rows: any[], plantId: string, opts: { cutoff?: string | null; from?: string; to?: string; onlyToday?: boolean } = {}): SizeTotals {
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

    function buildKPI(rows: any[], plantId: string, target: MonthlyTarget | undefined): MetricKPI {
      const monthlyTarget = targetTotal(target);
      const hasTarget = monthlyTarget > 0;
      const monthActual = total(sumFor(rows, plantId, { from: monthStart, to: monthEnd }));
      const quarterTarget = hasTarget ? Math.round((monthlyTarget / 4) * weekNumber) : 0;
      const quarterActual = monthActual;
      const monthAchievement = hasTarget ? Math.round((monthActual / monthlyTarget) * 100) : 0;
      const quarterAchievement = quarterTarget > 0 ? Math.round((quarterActual / quarterTarget) * 100) : 0;
      const behindThisCheckpoint = hasTarget && quarterAchievement < THRESHOLD;
      return {
        monthlyTarget, monthActual, monthAchievement, quarterTarget, quarterActual,
        quarterAchievement, status: achievementStatus(monthAchievement, hasTarget),
        behindThisCheckpoint, weekNumber,
      };
    }

    const result: PlantSummary[] = plants.map((plant) => {
      const goodOpen = cutoffFor(opening, plant.id);
      const brokenOpen = cutoffFor(brokenOpening, plant.id);
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

      const productionKPI = buildKPI(production, plant.id, prodTargets.find((t) => t.plant_id === plant.id));
      const dispatchKPI = buildKPI(dispatch, plant.id, dispTargets.find((t) => t.plant_id === plant.id));

      const monthProducedTotal = productionKPI.monthActual;
      const monthBrokenTotal = total(sumFor(breakage, plant.id, { from: monthStart, to: monthEnd }));
      const breakageRate = monthProducedTotal > 0 ? (monthBrokenTotal / monthProducedTotal) * 100 : 0;
      let breakageStatus: Status = "green";
      if (monthProducedTotal === 0) breakageStatus = "none";
      else if (breakageRate > 1.5) breakageStatus = "red";
      else if (breakageRate > 1.0) breakageStatus = "amber";

      const enteredProductionToday = production.some((r) => r.plant_id === plant.id && r.entry_date === today);
      const enteredDispatchToday = dispatch.some((r) => r.plant_id === plant.id && r.entry_date === today);
      const lastProd = lastEntryDate(production, plant.id);
      const lastDisp = lastEntryDate(dispatch, plant.id);
      const productionDaysMissing = lastProd ? workingDaysBetween(lastProd, today) : 999;
      const dispatchDaysMissing = lastDisp ? workingDaysBetween(lastDisp, today) : 999;

      return {
        plant, closingGoodStock, closingBrokenStock, todayProduced, todayDispatched, todayBroken,
        production: productionKPI, dispatch: dispatchKPI, breakageRate, breakageStatus,
        enteredProductionToday, enteredDispatchToday, productionDaysMissing, dispatchDaysMissing,
      };
    });

    setSummaries(result);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  if (loading) return <p style={{ color: SLATE }}>Loading dashboard…</p>;

  const totalProducedToday = summaries.reduce((s, x) => s + total(x.todayProduced), 0);
  const totalDispatchedToday = summaries.reduce((s, x) => s + total(x.todayDispatched), 0);
  const totalBrokenToday = summaries.reduce((s, x) => s + total(x.todayBroken), 0);
  const totalClosingGoodStock = summaries.reduce((s, x) => s + total(x.closingGoodStock), 0);
  const totalClosingBrokenStock = summaries.reduce((s, x) => s + total(x.closingBrokenStock), 0);

  const missingPlants = summaries.filter((s) => !s.enteredProductionToday || !s.enteredDispatchToday);
  const weekNum = summaries.length > 0 ? summaries[0].production.weekNumber : 0;

  // Manager's tasks
  const openTasks = myTasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled");
  const completedCount = myTasks.filter((t) => t.status === "Completed").length;
  const visibleTasks = showCompleted ? myTasks : openTasks;

  return (
    <div>
      <p style={{ color: SLATE, fontSize: "13px", marginBottom: "16px" }}>
        {`Operations command centre for ${today} (month-week ${weekNum} of 4). Today's snapshot, open issues, your tasks and KPIs in one place.`}
      </p>

      {/* ===== TODAY'S SNAPSHOT ===== */}
      <SectionTitle title="Today's Snapshot" />
      <div style={squareGrid}>
        <Card label="Produced Today" value={totalProducedToday} color="#16a34a" />
        <Card label="Broken Today" value={totalBrokenToday} color="#dc2626" />
        <Card label="Dispatched Today" value={totalDispatchedToday} color="#7c3aed" />
        <Card label="Plants Missing" value={missingPlants.length} color="#ef4444" />
        <Card label="Closing Good Stock" value={totalClosingGoodStock} color="#0070f3" />
        <Card label="Closing Broken Stock" value={totalClosingBrokenStock} color="#d97706" />
      </div>

      {/* ===== MACHINE ISSUES ===== */}
      <SectionTitle title={`Machine Issues · ${machineIssues.length} open`} />
      <div style={{ marginBottom: "24px" }}>
        {machineIssues.length === 0 ? (
          <div style={okBoxStyle}>No open machine issues across any plant.</div>
        ) : (
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ backgroundColor: "#f8fafc" }}>
                  <th style={th}>Plant</th>
                  <th style={th}>Machine</th>
                  <th style={th}>Status</th>
                  <th style={th}>Expected fix</th>
                  <th style={th}>Issue</th>
                </tr>
              </thead>
              <tbody>
                {machineIssues.map((m) => (
                  <tr key={m.id}>
                    <td style={tdBold}>{m.plant_name}</td>
                    <td style={td}>{m.machine_name}</td>
                    <td style={{ ...td, color: m.issue_status === "Down" ? "#dc2626" : "#d97706", fontWeight: 700 }}>
                      {m.issue_status}
                    </td>
                    <td style={td}>{m.expected_resolution || "—"}</td>
                    <td style={{ ...td, color: SLATE }}>{m.issue_description || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ===== MISSING ENTRIES — chase list ===== */}
      <SectionTitle title="Missing Entries — Chase List" />
      <div style={{ marginBottom: "24px" }}>
        {missingPlants.length === 0 ? (
          <div style={okBoxStyle}>All active plants have submitted both production and dispatch today.</div>
        ) : (
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ backgroundColor: "#f8fafc" }}>
                  <th style={th}>Plant</th>
                  <th style={th}>Production today</th>
                  <th style={th}>Dispatch today</th>
                  <th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {missingPlants.map((s) => {
                  const escalated = s.productionDaysMissing >= 3 || s.dispatchDaysMissing >= 3;
                  return (
                    <tr key={s.plant.id}>
                      <td style={tdBold}>{s.plant.name}</td>
                      <td style={{ ...td, color: s.enteredProductionToday ? "#16a34a" : "#dc2626", fontWeight: 700 }}>
                        {s.enteredProductionToday ? "✓ In" : `Missing (${s.productionDaysMissing >= 999 ? "—" : s.productionDaysMissing} wd behind)`}
                      </td>
                      <td style={{ ...td, color: s.enteredDispatchToday ? "#16a34a" : "#dc2626", fontWeight: 700 }}>
                        {s.enteredDispatchToday ? "✓ In" : `Missing (${s.dispatchDaysMissing >= 999 ? "—" : s.dispatchDaysMissing} wd behind)`}
                      </td>
                      <td style={td}>
                        {escalated ? (
                          <span style={{ fontSize: "11px", fontWeight: 700, color: "white", backgroundColor: "#dc2626", borderRadius: "10px", padding: "2px 8px" }}>
                            3+ days — escalated to Executive
                          </span>
                        ) : (
                          <span style={{ fontSize: "11px", fontWeight: 700, color: "#d97706" }}>Chase today</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ===== MY TASKS — accountability items assigned to me ===== */}
      <SectionTitle title={`My Tasks · ${openTasks.length} outstanding`} />
      <div style={{ marginBottom: "24px" }}>
        {myTasks.length === 0 ? (
          <div style={okBoxStyle}>No tasks assigned to you. Nothing outstanding.</div>
        ) : (
          <>
            {completedCount > 0 && (
              <div style={{ textAlign: "right", marginBottom: "8px" }}>
                <button
                  onClick={() => setShowCompleted((v) => !v)}
                  style={{ fontSize: "12px", fontWeight: 600, color: NAVY, backgroundColor: "white", border: `1px solid ${BORDER}`, borderRadius: "6px", padding: "5px 11px", cursor: "pointer" }}
                >
                  {showCompleted ? "Hide completed" : `Show completed (${completedCount})`}
                </button>
              </div>
            )}
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <tbody>
                  {visibleTasks.map((task) => {
                    const open = expandedTaskId === task.id;
                    return (
                      <FragmentRow
                        key={task.id}
                        task={task}
                        open={open}
                        onToggle={() => setExpandedTaskId(open ? null : task.id)}
                        onChanged={loadAll}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ===== KPI TABLES (reference) ===== */}
      <SectionTitle title="Production KPI" />
      <KPITable summaries={summaries} metric="production" />

      <SectionTitle title="Dispatch KPI" />
      <KPITable summaries={summaries} metric="dispatch" />

      <SectionTitle title="Breakage KPI" />
      <div style={{ overflowX: "auto", marginBottom: "24px" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "0" }}>
          <thead>
            <tr style={{ backgroundColor: "#f8fafc" }}>
              <th style={th}>Plant</th>
              <th style={th}>Month Produced</th>
              <th style={th}>Breakage Rate</th>
              <th style={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((s) => {
              const color = statusColor(s.breakageStatus);
              return (
                <tr key={s.plant.id}>
                  <td style={tdBold}>{s.plant.name}</td>
                  <td style={td}>{s.production.monthActual.toLocaleString()}</td>
                  <td style={{ ...td, color, fontWeight: 700 }}>
                    {s.breakageStatus === "none" ? "—" : `${s.breakageRate.toFixed(2)}%`}
                  </td>
                  <td style={{ ...td, color, fontWeight: 700 }}>
                    {s.breakageStatus === "none" ? "No Production" : statusLabel(s.breakageStatus)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// One task row + its expandable detail with the shared TaskStatus reply controls.
function FragmentRow({
  task, open, onToggle, onChanged,
}: {
  task: Task; open: boolean; onToggle: () => void; onChanged: () => void;
}) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer", backgroundColor: open ? "#f8fafc" : "white" }}>
        <td style={{ ...td, fontWeight: 600, color: NAVY, maxWidth: "420px" }}>{task.description}</td>
        <td style={td}>{task.priority || "—"}</td>
        <td style={td}>{formatDateUK(task.due_date)}</td>
        <td style={td}>
          <span style={{ fontSize: "11px", fontWeight: 700, padding: "3px 9px", borderRadius: "10px", color: "white", backgroundColor: taskBadgeColor(task.status), whiteSpace: "nowrap" }}>
            {task.status}
          </span>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4} style={{ ...td, backgroundColor: "#f8fafc", padding: "14px 16px" }}>
            <div style={{ fontSize: "13px", color: SLATE, marginBottom: "6px" }}>
              Type: <strong>{task.task_type || "Task"}</strong> &nbsp;|&nbsp;
              Assigned by: <strong>{task.assigned_by || "—"}</strong> &nbsp;|&nbsp;
              Assigned: {formatDateUK(task.assigned_date)}
            </div>
            {task.notes && <div style={{ fontSize: "13px", color: SLATE, marginBottom: "8px" }}>Notes: {task.notes}</div>}
            {task.reply_text && (
              <div style={{ padding: "10px 12px", border: "1px solid #bbf7d0", backgroundColor: "#f0fdf4", borderRadius: "8px", color: "#166534", fontSize: "13px", marginBottom: "8px" }}>
                <strong>Your explanation:</strong> {task.reply_text}
                {task.corrective_action && <div style={{ marginTop: "5px" }}><strong>Corrective action:</strong> {task.corrective_action}</div>}
                {task.recovery_date && <div style={{ marginTop: "5px" }}><strong>Expected recovery:</strong> {formatDateUK(task.recovery_date)}</div>}
              </div>
            )}
            <TaskStatus task={task} currentRole="Manager" onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  );
}

function taskBadgeColor(status: string) {
  switch (status) {
    case "Completed": return "#16a34a";
    case "Submitted": return "#d97706";
    case "Waiting Reply": return "#dc2626";
    case "Cancelled": return "#888";
    case "In Progress": return "#0070f3";
    default: return "#64748b";
  }
}

function KPITable({ summaries, metric }: { summaries: PlantSummary[]; metric: "production" | "dispatch" }) {
  return (
    <div style={{ overflowX: "auto", marginBottom: "24px" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "0" }}>
        <thead>
          <tr style={{ backgroundColor: "#f8fafc" }}>
            <th style={th}>Plant</th>
            <th style={th}>Monthly Target</th>
            <th style={th}>Month Actual</th>
            <th style={th}>Month %</th>
            <th style={th}>Cum. Wk Target</th>
            <th style={th}>Cum. Actual</th>
            <th style={th}>Wk %</th>
            <th style={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((s) => {
            const k = s[metric];
            const color = statusColor(k.status);
            const wkColor = k.behindThisCheckpoint ? "#dc2626" : "#16a34a";
            return (
              <tr key={s.plant.id}>
                <td style={tdBold}>{s.plant.name}</td>
                <td style={td}>{k.monthlyTarget.toLocaleString()}</td>
                <td style={td}>{k.monthActual.toLocaleString()}</td>
                <td style={{ ...td, color, fontWeight: 700 }}>{k.monthlyTarget > 0 ? `${k.monthAchievement}%` : "—"}</td>
                <td style={td}>{k.quarterTarget.toLocaleString()}</td>
                <td style={td}>{k.quarterActual.toLocaleString()}</td>
                <td style={{ ...td, color: k.monthlyTarget > 0 ? wkColor : "#666", fontWeight: 700 }}>{k.monthlyTarget > 0 ? `${k.quarterAchievement}%` : "—"}</td>
                <td style={{ ...td, color, fontWeight: 700 }}>{statusLabel(k.status)}</td>
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
    <h2 style={{ fontSize: "13px", fontWeight: 700, color: NAVY, margin: "14px 0 8px", paddingLeft: "9px", borderLeft: `3px solid ${NAVY}` }}>
      {title}
    </h2>
  );
}

function Card({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderTop: `3px solid ${color}`, borderRadius: "7px", padding: "8px 10px", backgroundColor: "white" }}>
      <div style={{ color: SLATE, fontSize: "11px", marginBottom: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      <div style={{ fontSize: "19px", fontWeight: 800, color }}>{value.toLocaleString()}</div>
    </div>
  );
}

const squareGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))",
  gap: "8px",
  marginBottom: "24px",
};

const th: React.CSSProperties = {
  textAlign: "left",
  borderBottom: `1px solid ${BORDER}`,
  padding: "6px 8px",
  fontSize: "11px",
  color: SLATE,
  fontWeight: 700,
};

const td: React.CSSProperties = {
  borderBottom: `1px solid #f1f5f9`,
  padding: "8px 10px",
  fontSize: "12px",
  verticalAlign: "top",
};

const tdBold: React.CSSProperties = {
  ...td,
  fontWeight: 700,
  color: NAVY,
};

const okBoxStyle = {
  border: "1px solid #bbf7d0",
  backgroundColor: "#f0fdf4",
  color: "#166534",
  borderRadius: "8px",
  padding: "12px 14px",
  fontWeight: "bold" as const,
  fontSize: "13px",
};
