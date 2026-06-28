"use client";

import { useState, useEffect } from "react";
import { supabase, loadMyPermissions } from "../lib/supabase";
import TaskStatus from "../tasks/TaskStatus";
import { formatDateUK } from "../lib/dateUtils";
import { useMobile } from "../lib/useMobile";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { downloadCSV } from "../lib/exportUtils";
import MonthlyTargets from "./MonthlyTargets";
import { canSeeAllTasks, type UserCtx, type PermOverrides } from "../lib/permissions";

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
  time_spent_minutes: number | null;
};

const NAVY = "var(--text-primary, #1e293b)";
const SLATE = "var(--text-secondary, #64748b)";
const BORDER = "var(--border-color, #e2e8f0)";

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
  return "#64748b";
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
  const isMobile = useMobile();
  const [summaries, setSummaries] = useState<PlantSummary[]>([]);
  const [machineIssues, setMachineIssues] = useState<MachineIssue[]>([]);
  const [myTasks, setMyTasks] = useState<Task[]>([]);
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"production" | "dispatch" | "breakage" | "tasks">("production");

  async function loadAll() {
    const currentMonth = getMonthFromDate(today);
    const monthStart = getMonthStart(today);
    const monthEnd = getMonthEnd(today);

    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email || null;
    setMyEmail(email);

    // Determine role, overrides, and assigned plants
    let role = "Member";
    let assignedPlantIds: Set<string> | null = null;
    let userCtx: UserCtx = { email, role: null };
    if (email) {
      const { data: memberData } = await supabase
        .from("members").select("id, role, department, company").eq("email", email).maybeSingle();
      role = memberData?.role || "Member";
      setMyRole(role);

      let overrides: PermOverrides | null = null;
      const p = await loadMyPermissions();
      if (p) overrides = p as PermOverrides;
      userCtx = { email, role, department: memberData?.department, company: memberData?.company, overrides };

      const seeAll = canSeeAllTasks(userCtx);
      if (!seeAll) {
        if (memberData?.id) {
          const { data: mp } = await supabase
            .from("member_plants").select("plant_id").eq("member_id", memberData.id);
          assignedPlantIds = new Set((mp || []).map((r) => r.plant_id));
        } else {
          assignedPlantIds = new Set();
        }
      }
    }

    const isPriv = canSeeAllTasks(userCtx);

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
      isPriv
        ? supabase.from("tasks").select("*").order("created_at", { ascending: false }).limit(500)
        : supabase.from("tasks").select("*").eq("assigned_to_email", email || "").order("created_at", { ascending: false }),
    ]);

    // Scope plants to user's assigned plants for non-privileged users
    const allPlants = plantsRes.data || [];
    const plants = assignedPlantIds ? allPlants.filter((p) => assignedPlantIds!.has(p.id)) : allPlants;
    const plantIdSet = new Set(plants.map((p) => p.id));

    const opening = openRes.data || [];
    const brokenOpening = brokenOpenRes.data || [];
    const production = prodRes.data || [];
    const dispatch = dispRes.data || [];
    const breakage = brkRes.data || [];
    const scrap = scrapRes.data || [];
    const prodTargets: MonthlyTarget[] = prodTargetsRes.data || [];
    const dispTargets: MonthlyTarget[] = dispTargetsRes.data || [];

    const allMachineIssues = machineRes.data || [];
    setMachineIssues(assignedPlantIds
      ? allMachineIssues.filter((m) => plants.some((p) => p.name === m.plant_name))
      : allMachineIssues);

    const allTasks: Task[] = tasksRes.data || [];
    if (!isPriv) {
      setMyTasks(allTasks);
    } else {
      setMyTasks([]);
    }

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

  const downMachines = machineIssues.filter((m) => m.issue_status === "Down");
  const overdueTaskCount = openTasks.filter((t) => t.due_date && t.due_date < today).length;

  // Banner alerts
  const bannerItems: string[] = [];
  if (downMachines.length > 0) bannerItems.push(`${downMachines.length} machine${downMachines.length > 1 ? "s" : ""} down`);
  if (missingPlants.length > 0) bannerItems.push(`${missingPlants.length} plant${missingPlants.length > 1 ? "s" : ""} not reported`);
  if (overdueTaskCount > 0) bannerItems.push(`${overdueTaskCount} overdue task${overdueTaskCount > 1 ? "s" : ""}`);
  const hasBannerItems = bannerItems.length > 0;
  const hasCritical = downMachines.length > 0 || overdueTaskCount > 0;

  return (
    <div style={{ maxWidth: "100%", overflowX: "hidden" }}>

      {/* ═══ ZONE 1: ALERT BANNER ═══ */}
      {hasBannerItems ? (
        <div style={{
          border: `1px solid ${hasCritical ? "#fecaca" : BORDER}`,
          borderLeft: `4px solid ${hasCritical ? "#dc2626" : "#d97706"}`,
          borderRadius: "8px",
          backgroundColor: hasCritical ? "#fef2f2" : "#fffbeb",
          overflow: "hidden", marginBottom: "14px",
        }}>
          <div onClick={() => setBannerOpen(!bannerOpen)} style={{
            padding: "12px 16px", cursor: "pointer",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>⚠</span>
              <div>
                <div style={{ fontSize: "16px", fontWeight: 700, color: hasCritical ? "#991b1b" : "#92400e" }}>
                  Attention needed — {bannerItems.length} issue{bannerItems.length > 1 ? "s" : ""}
                </div>
                <div style={{ fontSize: "15px", color: hasCritical ? "#991b1b" : "#92400e", marginTop: "1px" }}>
                  {bannerItems.join(" · ")}
                </div>
              </div>
            </div>
            <span style={{ fontSize: "16px", fontWeight: 700, color: hasCritical ? "#991b1b" : "#92400e" }}>{bannerOpen ? "▲" : "▼"}</span>
          </div>

          {bannerOpen && (
            <div style={{ borderTop: `1px solid ${hasCritical ? "#fecaca" : "#fde68a"}`, backgroundColor: "var(--bg-card, #ffffff)" }}>
              {/* Machines Down */}
              {downMachines.length > 0 && (
                <>
                  <div style={{ padding: "8px 16px", fontSize: "15px", fontWeight: 700, color: "#dc2626", borderBottom: `1px solid var(--border-light, #f1f5f9)` }}>Machines Down ({downMachines.length})</div>
                  {machineIssues.filter((m) => m.issue_status === "Down").map((m) => (
                    <div key={m.id} style={{ padding: "7px 16px 7px 48px", borderBottom: `1px solid var(--border-light, #f1f5f9)`, fontSize: "16px" }}>
                      <span style={{ fontWeight: 600, color: NAVY }}>{m.plant_name} — {m.machine_name}</span>
                      <span style={{ color: SLATE, marginLeft: "8px" }}>{m.issue_description || ""}</span>
                    </div>
                  ))}
                </>
              )}
              {/* Missing Plants */}
              {missingPlants.length > 0 && (
                <>
                  <div style={{ padding: "8px 16px", fontSize: "15px", fontWeight: 700, color: "#d97706", borderBottom: `1px solid var(--border-light, #f1f5f9)` }}>Plants Not Reported ({missingPlants.length})</div>
                  {missingPlants.map((s) => (
                    <div key={s.plant.id} style={{ padding: "7px 16px 7px 48px", borderBottom: `1px solid var(--border-light, #f1f5f9)`, fontSize: "16px", display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontWeight: 600, color: NAVY }}>{s.plant.name}</span>
                      <span style={{ color: s.productionDaysMissing >= 3 || s.dispatchDaysMissing >= 3 ? "#dc2626" : "#d97706", fontWeight: 700, fontSize: "15px" }}>
                        {s.productionDaysMissing >= 3 || s.dispatchDaysMissing >= 3 ? "Escalated (3+ days)" : "Chase today"}
                      </span>
                    </div>
                  ))}
                </>
              )}
              {/* Overdue Tasks */}
              {overdueTaskCount > 0 && (
                <>
                  <div style={{ padding: "8px 16px", fontSize: "15px", fontWeight: 700, color: "#dc2626", borderBottom: `1px solid var(--border-light, #f1f5f9)` }}>Overdue Tasks ({overdueTaskCount})</div>
                  {openTasks.filter((t) => t.due_date && t.due_date < today).map((t) => (
                    <a key={t.id} href={`/tasks?task=${t.id}`} style={{ textDecoration: "none", color: "inherit", display: "block", padding: "7px 16px 7px 48px", borderBottom: `1px solid var(--border-light, #f1f5f9)`, fontSize: "16px" }}>
                      <span style={{ fontWeight: 600, color: NAVY }}>{t.description}</span>
                      <span style={{ color: "#dc2626", marginLeft: "8px", fontWeight: 700 }}>Due: {formatDateUK(t.due_date)}</span>
                      <span style={{ color: "#2563eb", marginLeft: "8px", fontSize: "14px" }}>Open →</span>
                    </a>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={{ border: `1px solid ${BORDER}`, borderLeft: "4px solid #16a34a", borderRadius: "6px", padding: "12px 16px", backgroundColor: "var(--bg-card, #ffffff)", fontSize: "16px", color: NAVY, fontWeight: 600, marginBottom: "14px" }}>
          All clear — no machines down, all plants reported, no overdue tasks.
        </div>
      )}

      {/* ═══ SUMMARY CARDS ═══ */}
      <div style={squareGrid}>
        <Card label="Produced Today" value={totalProducedToday} color="#16a34a" />
        <Card label="Dispatched Today" value={totalDispatchedToday} color="#059669" />
        <Card label="Broken Today" value={totalBrokenToday} color="#dc2626" />
        <Card label="Good Stock" value={totalClosingGoodStock} color="#2563eb" />
        <Card label="Broken Stock" value={totalClosingBrokenStock} color="#dc2626" />
        <Card label="Machine Issues" value={machineIssues.length} color={machineIssues.length > 0 ? "#dc2626" : "#16a34a"} />
      </div>

      {/* ═══ ZONE 2: CHARTS ROW ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
        {/* Plant Comparison Chart */}
        {summaries.length > 0 && (
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)" }}>
            <div style={{ fontSize: "16px", fontWeight: 700, color: NAVY, marginBottom: "10px" }}>Plant Comparison — This Month</div>
            <ResponsiveContainer width="100%" height={Math.max(220, summaries.length * 55)}>
              <BarChart
                data={summaries.map((s) => ({
                  name: s.plant.name.replace(" Plant", ""),
                  Produced: s.production.monthActual,
                  Dispatched: s.dispatch.monthActual,
                  Target: s.production.monthlyTarget,
                }))}
                layout="vertical"
                margin={{ left: 5, right: 10, top: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 13, fill: SLATE }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 14, fill: NAVY, fontWeight: 600 }} width={80} />
                <Tooltip formatter={(value) => Number(value).toLocaleString()} />
                <Legend iconType="square" wrapperStyle={{ fontSize: "14px" }} />
                <Bar dataKey="Target" fill="#cbd5e1" name="Target (grey)" radius={[0, 4, 4, 0]} />
                <Bar dataKey="Produced" fill="#16a34a" name="Produced (green)" radius={[0, 4, 4, 0]} />
                <Bar dataKey="Dispatched" fill="#059669" name="Dispatched (teal)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Breakage Rate Gauges */}
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)" }}>
          <div style={{ fontSize: "16px", fontWeight: 700, color: NAVY, marginBottom: "10px" }}>
            Breakage Rate by Plant <span style={{ fontSize: "15px", fontWeight: 400, color: SLATE }}>(limit: 1.5%)</span>
          </div>
          {summaries.map((s) => {
            const rate = s.breakageRate;
            const color = s.breakageStatus === "red" ? "#dc2626" : s.breakageStatus === "amber" ? "#d97706" : "#16a34a";
            const width = s.breakageStatus === "none" ? 0 : Math.min(rate / 3 * 100, 100);
            return (
              <div key={s.plant.id} style={{ marginBottom: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "16px", marginBottom: "4px" }}>
                  <span style={{ fontWeight: 600, color: NAVY }}>{s.plant.name.replace(" Plant", "")}</span>
                  <span style={{ fontWeight: 700, color }}>
                    {s.breakageStatus === "none" ? "No data" : `${rate.toFixed(2)}%`}
                  </span>
                </div>
                <div style={{ height: "10px", backgroundColor: "var(--border-light, #f1f5f9)", borderRadius: "5px", position: "relative" }}>
                  <div style={{ width: `${width}%`, height: "100%", backgroundColor: color, borderRadius: "5px", transition: "width 0.3s" }} />
                  <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: "2px", backgroundColor: "#dc2626", opacity: 0.4 }} title="1.5% limit" />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ ZONE 3: TABBED DETAIL ═══ */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "10px", flexWrap: "wrap", alignItems: "center" }}>
        {([
          { key: "production" as const, label: "Production KPI" },
          { key: "dispatch" as const, label: "Dispatch KPI" },
          { key: "breakage" as const, label: "Breakage" },
          { key: "tasks" as const, label: `My Tasks (${openTasks.length})` },
        ]).map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            backgroundColor: activeTab === tab.key ? NAVY : "var(--bg-card, #ffffff)",
            color: activeTab === tab.key ? "white" : NAVY,
            border: `1px solid ${activeTab === tab.key ? NAVY : BORDER}`,
            borderRadius: "6px", padding: "7px 14px", fontSize: "16px", fontWeight: 600, cursor: "pointer",
          }}>{tab.label}</button>
        ))}
        <div style={{ flex: 1 }} />
        {(activeTab === "production" || activeTab === "dispatch") && summaries.length > 0 && (
          <button onClick={() => {
            const metric = activeTab;
            const headers = ["Plant", "Monthly Target", "Month Actual", "Month %", "Week Target", "Week Actual", "Week %", "Status"];
            const rows = summaries.map((s) => {
              const k = s[metric];
              return [s.plant.name, String(k.monthlyTarget), String(k.monthActual), `${k.monthAchievement}%`, String(k.quarterTarget), String(k.quarterActual), `${k.quarterAchievement}%`, statusLabel(k.status)];
            });
            downloadCSV(`${metric}-kpi-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
          }} style={{ backgroundColor: "var(--bg-card, #ffffff)", color: NAVY, border: `1px solid ${BORDER}`, borderRadius: "6px", padding: "6px 12px", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}>
            Export CSV
          </button>
        )}
      </div>

      <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", backgroundColor: "var(--bg-card, #ffffff)", overflow: "hidden", marginBottom: "14px" }}>
        {activeTab === "production" && <KPITable summaries={summaries} metric="production" />}
        {activeTab === "dispatch" && <KPITable summaries={summaries} metric="dispatch" />}

        {activeTab === "breakage" && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ backgroundColor: "var(--bg-card-hover, #f8fafc)" }}>
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
        )}

        {activeTab === "tasks" && (
          myTasks.length === 0 ? (
            <div style={{ padding: "16px", color: SLATE, textAlign: "center" }}>No tasks assigned to you.</div>
          ) : (
            <>
              {completedCount > 0 && (
                <div style={{ padding: "8px 14px", borderBottom: `1px solid ${BORDER}`, textAlign: "right" }}>
                  <button onClick={() => setShowCompleted((v) => !v)}
                    style={{ fontSize: "14px", fontWeight: 600, color: NAVY, backgroundColor: "var(--bg-card, #ffffff)", border: `1px solid ${BORDER}`, borderRadius: "5px", padding: "4px 10px", cursor: "pointer" }}>
                    {showCompleted ? "Hide completed" : `Show completed (${completedCount})`}
                  </button>
                </div>
              )}
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <tbody>
                    {visibleTasks.map((task) => {
                      const open = expandedTaskId === task.id;
                      return (
                        <FragmentRow key={task.id} task={task} open={open}
                          onToggle={() => setExpandedTaskId(open ? null : task.id)} onChanged={loadAll} />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )
        )}
      </div>

      {/* Monthly Targets */}
      <div style={{ marginTop: "24px" }}>
        <SectionTitle title="Monthly Targets" />
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)" }}>
          <MonthlyTargets />
        </div>
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
      <tr onClick={onToggle} style={{ cursor: "pointer", backgroundColor: open ? "var(--bg-card-hover, #f8fafc)" : "var(--bg-card, #ffffff)" }}>
        <td style={{ ...td, fontWeight: 600, color: NAVY, maxWidth: "420px" }}>{task.description}</td>
        <td style={td}>{task.priority || "—"}</td>
        <td style={td}>{formatDateUK(task.due_date)}</td>
        <td style={td}>
          <span style={{ fontSize: "15px", fontWeight: 700, padding: "3px 9px", borderRadius: "10px", color: "white", backgroundColor: taskBadgeColor(task.status), whiteSpace: "nowrap" }}>
            {task.status}
          </span>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4} style={{ ...td, backgroundColor: "var(--bg-card-hover, #f8fafc)", padding: "14px 16px" }}>
            <div style={{ fontSize: "17px", color: SLATE, marginBottom: "6px" }}>
              Type: <strong>{task.task_type || "Task"}</strong> &nbsp;|&nbsp;
              Assigned by: <strong>{task.assigned_by || "—"}</strong> &nbsp;|&nbsp;
              Assigned: {formatDateUK(task.assigned_date)}
            </div>
            {task.notes && <div style={{ fontSize: "17px", color: SLATE, marginBottom: "8px" }}>Notes: {task.notes}</div>}
            {task.reply_text && (
              <div style={{ padding: "10px 12px", border: "1px solid #bbf7d0", backgroundColor: "#f0fdf4", borderRadius: "8px", color: "#166534", fontSize: "17px", marginBottom: "8px" }}>
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
    case "Cancelled": return "#64748b";
    case "In Progress": return "#d97706";
    default: return "#64748b";
  }
}

function KPITable({ summaries, metric }: { summaries: PlantSummary[]; metric: "production" | "dispatch" }) {
  return (
    <div style={{ overflowX: "auto", marginBottom: "24px" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "0" }}>
        <thead>
          <tr style={{ backgroundColor: "var(--bg-card-hover, #f8fafc)" }}>
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
                <td style={{ ...td, color: k.monthlyTarget > 0 ? wkColor : "var(--text-secondary, #64748b)", fontWeight: 700 }}>{k.monthlyTarget > 0 ? `${k.quarterAchievement}%` : "—"}</td>
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
    <h2 style={{ fontSize: "17px", fontWeight: 700, color: NAVY, margin: "14px 0 8px", paddingLeft: "9px", borderLeft: `3px solid ${NAVY}` }}>
      {title}
    </h2>
  );
}

function Card({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderTop: `3px solid ${color}`, borderRadius: "7px", padding: "10px 12px", backgroundColor: "var(--bg-card, #ffffff)" }}>
      <div style={{ color: SLATE, fontSize: "15px", marginBottom: "3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      <div style={{ fontSize: "22px", fontWeight: 800, color }}>{value.toLocaleString()}</div>
    </div>
  );
}

const squareGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
  gap: "10px",
  marginBottom: "24px",
};

const th: React.CSSProperties = {
  textAlign: "left",
  borderBottom: `1px solid ${BORDER}`,
  padding: "6px 8px",
  fontSize: "15px",
  color: SLATE,
  fontWeight: 700,
};

const td: React.CSSProperties = {
  borderBottom: `1px solid var(--border-light, #f1f5f9)`,
  padding: "8px 10px",
  fontSize: "16px",
  verticalAlign: "top",
};

const tdBold: React.CSSProperties = {
  ...td,
  fontWeight: 700,
  color: NAVY,
};

