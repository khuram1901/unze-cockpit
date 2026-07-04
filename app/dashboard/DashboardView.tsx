"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase, loadMyPermissions } from "../lib/supabase";
import TaskStatus from "../tasks/TaskStatus";
import { formatDateUK } from "../lib/dateUtils";
import { useMobile } from "../lib/useMobile";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { downloadCSV } from "../lib/exportUtils";
import MonthlyTargets from "./MonthlyTargets";
import { canSeeAllTasks, type UserCtx, type PermOverrides } from "../lib/permissions";

type Plant = { id: string; name: string; type: string };
type PlantKpiRow = {
  plant_id: string; plant_name: string; plant_type: string;
  opening_good_31: number; opening_good_36: number; opening_good_45: number; opening_good_meter: number;
  opening_broken_31: number; opening_broken_36: number; opening_broken_45: number;
  opening_cutoff_date: string | null; broken_cutoff_date: string | null;
  produced_31: number; produced_36: number; produced_45: number; produced_meter: number;
  dispatched_31: number; dispatched_36: number; dispatched_45: number; dispatched_meter: number;
  broken_31: number; broken_36: number; broken_45: number;
  scrap_31: number; scrap_36: number; scrap_45: number;
  on_date_produced_31: number; on_date_produced_36: number; on_date_produced_45: number; on_date_produced_meter: number;
  on_date_dispatched_31: number; on_date_dispatched_36: number; on_date_dispatched_45: number; on_date_dispatched_meter: number;
  on_date_broken_31: number; on_date_broken_36: number; on_date_broken_45: number;
  mtd_produced: number; mtd_dispatched: number; mtd_broken: number;
  entered_on_date: boolean;
};
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

type StockLetter = {
  id: string; letter_number: string; contractor_name: string;
  qty_31: number; qty_36: number; qty_45: number; qty_meter: number;
  remaining_31: number; remaining_36: number; remaining_45: number; remaining_meter: number;
  expiry_date: string | null;
};
type StockContractor = {
  contractor_id: string; contractor_name: string;
  letters: StockLetter[];
};
type StockPO = {
  po: {
    id: string; customer_name: string; po_number: string; po_label: string;
    ordered_31: number; ordered_36: number; ordered_45: number; ordered_meter: number;
    status: string; is_system_unallocated: boolean;
  };
  produced_31: number; produced_36: number; produced_45: number; produced_meter: number;
  dispatched_31: number; dispatched_36: number; dispatched_45: number; dispatched_meter: number;
  in_stock_31: number; in_stock_36: number; in_stock_45: number; in_stock_meter: number;
  fulfillment_pct: number;
  contractors: StockContractor[];
};
type PlantStock = { plant_id: string; plant_name: string; items: StockPO[] };

const NAVY = "var(--text-primary, #1e293b)";
const SLATE = "var(--text-secondary, #64748b)";
const BORDER = "var(--border-color, #e2e8f0)";

const today = new Date().toISOString().slice(0, 10);

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
  const [dailyTrend, setDailyTrend] = useState<{ date: string; produced: number; target: number }[]>([]);

  // Stock by PO
  const [plantStocks, setPlantStocks] = useState<PlantStock[]>([]);
  const [stockLoading, setStockLoading] = useState(true);
  const [expandedPOs, setExpandedPOs] = useState<Set<string>>(new Set());
  const [showClosedPOs, setShowClosedPOs] = useState(false);

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

    const ENTRY_COLS = "plant_id, entry_date, qty_31, qty_36, qty_45, qty_meter";
    const TASK_COLS = "id, task_type, description, project, priority, due_date, assigned_date, assigned_to, assigned_to_email, assigned_by, status, stuck_reason, notes, reply_required, reply_text, reply_by, reply_at, corrective_action, recovery_date, impact_on_monthly_target, time_spent_minutes";

    const [
      plantKpisRes, prodTargetsRes, dispTargetsRes, machineRes, tasksRes, trendProdRes,
    ] = await Promise.all([
      // Single RPC replaces 7 raw table fetches — returns one row per active plant
      supabase.rpc("get_plant_kpis", {
        as_of_date: today,
        month_start: monthStart,
        month_end: monthEnd,
      }),
      supabase.from("monthly_production_targets").select("id, plant_id, plant_name, target_month, target_31, target_36, target_45, target_meter").eq("target_month", currentMonth),
      supabase.from("monthly_dispatch_targets").select("id, plant_id, plant_name, target_month, target_31, target_36, target_45, target_meter").eq("target_month", currentMonth),
      supabase.from("machine_issues").select("id, plant_name, machine_name, issue_status, expected_resolution, issue_description, action_taken, created_at").neq("issue_status", "Resolved").order("created_at", { ascending: false }),
      isPriv
        ? supabase.from("tasks").select(TASK_COLS).order("created_at", { ascending: false }).limit(200)
        : supabase.from("tasks").select(TASK_COLS).eq("assigned_to_email", email || "").order("created_at", { ascending: false }),
      // Monthly production kept for the 30-day trend chart (per-day breakdown needed)
      supabase.from("production_entries").select(ENTRY_COLS).gte("entry_date", monthStart).lte("entry_date", today),
    ]);

    const allPlantKpis = (plantKpisRes.data || []) as PlantKpiRow[];
    // Scope to user's assigned plants for non-privileged users
    const plantKpis = assignedPlantIds
      ? allPlantKpis.filter((r) => assignedPlantIds!.has(r.plant_id))
      : allPlantKpis;
    const plants: Plant[] = plantKpis.map((r) => ({ id: r.plant_id, name: r.plant_name, type: r.plant_type }));
    const plantIdSet = new Set(plants.map((p) => p.id));

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

    // Build plant summaries from RPC rows — no JS loops over raw entries needed
    const result: PlantSummary[] = plantKpis.map((r) => {
      const closingGoodStock: SizeTotals = {
        s31: r.opening_good_31 + r.produced_31 - r.broken_31 - r.dispatched_31,
        s36: r.opening_good_36 + r.produced_36 - r.broken_36 - r.dispatched_36,
        s45: r.opening_good_45 + r.produced_45 - r.broken_45 - r.dispatched_45,
      };
      const closingBrokenStock: SizeTotals = {
        s31: r.opening_broken_31 + r.broken_31 - r.scrap_31,
        s36: r.opening_broken_36 + r.broken_36 - r.scrap_36,
        s45: r.opening_broken_45 + r.broken_45 - r.scrap_45,
      };

      const prodTarget = prodTargets.find((t) => t.plant_id === r.plant_id);
      const dispTarget = dispTargets.find((t) => t.plant_id === r.plant_id);
      const monthlyProdTarget = targetTotal(prodTarget);
      const monthlyDispTarget = targetTotal(dispTarget);

      const buildKPI = (mtdActual: number, monthlyTarget: number): MetricKPI => {
        const hasTarget = monthlyTarget > 0;
        const quarterTarget = hasTarget ? Math.round((monthlyTarget / 4) * weekNumber) : 0;
        const monthAchievement = hasTarget ? Math.round((mtdActual / monthlyTarget) * 100) : 0;
        const quarterAchievement = quarterTarget > 0 ? Math.round((mtdActual / quarterTarget) * 100) : 0;
        return {
          monthlyTarget, monthActual: mtdActual, monthAchievement,
          quarterTarget, quarterActual: mtdActual, quarterAchievement,
          status: achievementStatus(monthAchievement, hasTarget),
          behindThisCheckpoint: hasTarget && quarterAchievement < THRESHOLD,
          weekNumber,
        };
      };

      const breakageRate = r.mtd_produced > 0 ? (r.mtd_broken / r.mtd_produced) * 100 : 0;
      let breakageStatus: Status = "green";
      if (r.mtd_produced === 0) breakageStatus = "none";
      else if (breakageRate > 1.5) breakageStatus = "red";
      else if (breakageRate > 1.0) breakageStatus = "amber";

      return {
        plant: { id: r.plant_id, name: r.plant_name, type: r.plant_type },
        closingGoodStock,
        closingBrokenStock,
        todayProduced:   { s31: r.on_date_produced_31,   s36: r.on_date_produced_36,   s45: r.on_date_produced_45 },
        todayDispatched: { s31: r.on_date_dispatched_31, s36: r.on_date_dispatched_36, s45: r.on_date_dispatched_45 },
        todayBroken:     { s31: r.on_date_broken_31,     s36: r.on_date_broken_36,     s45: r.on_date_broken_45 },
        production: buildKPI(r.mtd_produced, monthlyProdTarget),
        dispatch:   buildKPI(r.mtd_dispatched, monthlyDispTarget),
        breakageRate, breakageStatus,
        enteredProductionToday: r.entered_on_date,
        enteredDispatchToday:   r.entered_on_date,
        productionDaysMissing: r.entered_on_date ? 0 : 1,
        dispatchDaysMissing:   r.entered_on_date ? 0 : 1,
      };
    });

    setSummaries(result);

    // Build 30-day production trend from the monthly fetch (per-day breakdown needed for chart)
    const trendProd = trendProdRes.data || [];
    const dailyMap = new Map<string, number>();
    for (const r of trendProd) {
      if (!plantIdSet.has(r.plant_id)) continue;
      const d = r.entry_date;
      dailyMap.set(d, (dailyMap.get(d) || 0) + (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0));
    }
    const totalMonthlyTarget = prodTargets.filter((t) => plantIdSet.has(t.plant_id)).reduce((s, t) => s + targetTotal(t), 0);
    const dailyTarget = totalMonthlyTarget > 0 ? Math.round(totalMonthlyTarget / 26) : 0;
    const trendArr = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, produced]) => ({ date: date.slice(5), produced, target: dailyTarget }));
    setDailyTrend(trendArr);

    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  const loadStock = useCallback(async () => {
    setStockLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      // Single request for all plants — was one request per plant
      const res = await fetch("/api/stock/summary", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      const summary = json.summary || [];

      type ApiEntry = {
        po: {
          id: string; plant_id: string; plant_name: string;
          customer_name: string; po_number: string; po_label: string;
          ordered_31: number; ordered_36: number; ordered_45: number; ordered_meter: number;
          status: string; is_system_unallocated: boolean;
          produced_31: number; produced_36: number; produced_45: number; produced_meter: number;
          dispatched_31: number; dispatched_36: number; dispatched_45: number; dispatched_meter: number;
          in_stock_31: number; in_stock_36: number; in_stock_45: number; in_stock_meter: number;
          fulfillment_pct: number;
        };
        contractors: {
          contractor_id: string; contractor_name: string;
          letters: {
            id: string; letter_number: string; contractor_name: string;
            qty_31: number; qty_36: number; qty_45: number; qty_meter: number;
            remaining_31: number; remaining_36: number; remaining_45: number; remaining_meter: number;
            expiry_date: string | null;
          }[];
        }[];
      };

      // Group by plant using plant_id/plant_name from the PO data
      const plantMap = new Map<string, PlantStock>();
      for (const entry of summary as ApiEntry[]) {
        const { plant_id, plant_name } = entry.po;
        if (!plantMap.has(plant_id)) {
          plantMap.set(plant_id, { plant_id, plant_name, items: [] });
        }
        plantMap.get(plant_id)!.items.push({
          po: {
            id: entry.po.id,
            customer_name: entry.po.customer_name,
            po_number: entry.po.po_number,
            po_label: entry.po.po_label,
            ordered_31: entry.po.ordered_31,
            ordered_36: entry.po.ordered_36,
            ordered_45: entry.po.ordered_45,
            ordered_meter: entry.po.ordered_meter,
            status: entry.po.status,
            is_system_unallocated: entry.po.is_system_unallocated,
          },
          produced_31: entry.po.produced_31,
          produced_36: entry.po.produced_36,
          produced_45: entry.po.produced_45,
          produced_meter: entry.po.produced_meter,
          dispatched_31: entry.po.dispatched_31,
          dispatched_36: entry.po.dispatched_36,
          dispatched_45: entry.po.dispatched_45,
          dispatched_meter: entry.po.dispatched_meter,
          in_stock_31: entry.po.in_stock_31,
          in_stock_36: entry.po.in_stock_36,
          in_stock_45: entry.po.in_stock_45,
          in_stock_meter: entry.po.in_stock_meter,
          fulfillment_pct: entry.po.fulfillment_pct ?? 0,
          contractors: (entry.contractors || []).map((c) => ({
            contractor_id: c.contractor_id,
            contractor_name: c.contractor_name,
            letters: (c.letters || []).map((l) => ({
              id: l.id,
              letter_number: l.letter_number,
              contractor_name: l.contractor_name,
              qty_31: l.qty_31,
              qty_36: l.qty_36,
              qty_45: l.qty_45,
              qty_meter: l.qty_meter,
              remaining_31: l.remaining_31,
              remaining_36: l.remaining_36,
              remaining_45: l.remaining_45,
              remaining_meter: l.remaining_meter,
              expiry_date: l.expiry_date || null,
            })),
          })),
        });
      }

      const results = Array.from(plantMap.values()).sort((a, b) => a.plant_name.localeCompare(b.plant_name));
      setPlantStocks(results);
    } finally {
      setStockLoading(false);
    }
  }, []);

  useEffect(() => { loadStock(); }, [loadStock]);

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
        <Card label="Dispatched Today" value={totalDispatchedToday} color="#2563eb" />
        <Card label="Broken Today" value={totalBrokenToday} color="#dc2626" />
        <Card label="Good Stock" value={totalClosingGoodStock} color="#7c3aed" />
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
                <Bar dataKey="Dispatched" fill="#2563eb" name="Dispatched (blue)" radius={[0, 4, 4, 0]} />
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

      {/* ═══ ZONE 2b: STOCK BY CUSTOMER PO ═══ */}
      <div style={{ marginBottom: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
          <div style={{ paddingLeft: "9px", borderLeft: `3px solid ${NAVY}` }}>
            <div style={{ fontSize: "16px", fontWeight: 700, color: NAVY }}>Stock by Customer PO</div>
            <div style={{ fontSize: "13px", color: SLATE }}>Produced · Dispatched · In Stock · Fulfillment</div>
          </div>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <button onClick={() => setShowClosedPOs(v => !v)} style={{ fontSize: "12px", fontWeight: 600, padding: "4px 12px", borderRadius: "6px", border: `1px solid ${BORDER}`, backgroundColor: "var(--bg-card,#fff)", color: SLATE, cursor: "pointer" }}>
              {showClosedPOs ? "Hide Closed" : "Show Closed"}
            </button>
            <a href="/stock" style={{ fontSize: "12px", fontWeight: 600, padding: "4px 12px", borderRadius: "6px", border: `1px solid ${BORDER}`, backgroundColor: "var(--bg-card,#fff)", color: NAVY, cursor: "pointer", textDecoration: "none" }}>
              Full View →
            </a>
          </div>
        </div>

        {stockLoading ? (
          <div style={{ padding: "14px", color: SLATE, fontSize: "14px" }}>Loading stock data…</div>
        ) : plantStocks.length === 0 ? (
          <div style={{ padding: "14px", color: SLATE, fontSize: "14px", border: `1px solid ${BORDER}`, borderRadius: "8px", backgroundColor: "var(--bg-card,#fff)" }}>
            No stock data yet. <a href="/stock/manage" style={{ color: NAVY, fontWeight: 600 }}>Add the first PO →</a>
          </div>
        ) : plantStocks.map((ps) => {
          const visibleItems = ps.items.filter(i =>
            !i.po.is_system_unallocated && (showClosedPOs || i.po.status === "Active")
          );
          if (visibleItems.length === 0) return null;
          return (
            <div key={ps.plant_id} style={{ marginBottom: "10px" }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: SLATE, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>{ps.plant_name}</div>
              {visibleItems.map((item) => {
                const ordered = item.po.ordered_31 + item.po.ordered_36 + item.po.ordered_45 + item.po.ordered_meter;
                const produced = item.produced_31 + item.produced_36 + item.produced_45 + item.produced_meter;
                const dispatched = item.dispatched_31 + item.dispatched_36 + item.dispatched_45 + item.dispatched_meter;
                const inStock = item.in_stock_31 + item.in_stock_36 + item.in_stock_45 + item.in_stock_meter;
                const pct = item.fulfillment_pct;
                const isClosed = item.po.status === "Closed";
                const isExpanded = expandedPOs.has(item.po.id);
                const pctColor = pct >= 90 ? "#16a34a" : pct >= 60 ? "#d97706" : "#dc2626";

                // Letter balance warnings — any letter with < 10% remaining
                const allLetters = item.contractors.flatMap(c => c.letters);
                const nearlyExhausted = allLetters.filter(l => {
                  const auth = l.qty_31 + l.qty_36 + l.qty_45 + l.qty_meter;
                  const rem = l.remaining_31 + l.remaining_36 + l.remaining_45 + l.remaining_meter;
                  return auth > 0 && rem / auth < 0.1;
                });
                // Expiry warnings
                const today_str = new Date().toISOString().slice(0, 10);
                const expiringLetters = allLetters.filter(l => {
                  if (!l.expiry_date) return false;
                  const diffDays = Math.ceil((new Date(l.expiry_date).getTime() - new Date(today_str).getTime()) / 86400000);
                  return diffDays <= 14;
                }).map(l => {
                  const diffDays = Math.ceil((new Date(l.expiry_date!).getTime() - new Date(today_str).getTime()) / 86400000);
                  return { ...l, diffDays };
                });

                return (
                  <div key={item.po.id} style={{ border: `1px solid ${BORDER}`, borderLeft: `4px solid ${isClosed ? "#94a3b8" : NAVY}`, borderRadius: "8px", backgroundColor: "var(--bg-card,#fff)", marginBottom: "6px", opacity: isClosed ? 0.65 : 1 }}>
                    {/* PO header row */}
                    <div
                      onClick={() => setExpandedPOs(prev => { const s = new Set(prev); s.has(item.po.id) ? s.delete(item.po.id) : s.add(item.po.id); return s; })}
                      style={{ padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "14px", fontWeight: 700, color: NAVY }}>
                          {item.po.customer_name}
                          <span style={{ fontWeight: 400, color: SLATE, marginLeft: "6px" }}>PO #{item.po.po_number}</span>
                          {item.po.po_label && <span style={{ fontSize: "11px", marginLeft: "6px", padding: "1px 7px", borderRadius: "10px", backgroundColor: "#eff6ff", color: "#2563eb", fontWeight: 600 }}>{item.po.po_label}</span>}
                          {isClosed && <span style={{ fontSize: "11px", marginLeft: "6px", padding: "1px 7px", borderRadius: "10px", backgroundColor: "#f1f5f9", color: SLATE, fontWeight: 700 }}>CLOSED</span>}
                        </div>
                        {ordered > 0 && (
                          <div style={{ marginTop: "5px", display: "flex", alignItems: "center", gap: "6px" }}>
                            <div style={{ flex: 1, height: "6px", borderRadius: "3px", backgroundColor: "#e2e8f0", overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, backgroundColor: pctColor, borderRadius: "3px", transition: "width 0.3s" }} />
                            </div>
                            <span style={{ fontSize: "12px", fontWeight: 700, color: pctColor, whiteSpace: "nowrap" }}>{pct.toFixed(0)}%</span>
                          </div>
                        )}
                      </div>
                      {/* Stats strip */}
                      <div style={{ display: "flex", gap: "14px", flexShrink: 0 }}>
                        {[
                          { label: "Ordered", value: ordered, color: SLATE },
                          { label: "Produced", value: produced, color: "#2563eb" },
                          { label: "Dispatched", value: dispatched, color: "#7c3aed" },
                          { label: "In Stock", value: inStock, color: inStock > 0 ? "#16a34a" : SLATE },
                        ].map(s => (
                          <div key={s.label} style={{ textAlign: "center" }}>
                            <div style={{ fontSize: "11px", color: SLATE, fontWeight: 600 }}>{s.label}</div>
                            <div style={{ fontSize: "15px", fontWeight: 800, color: s.color }}>{s.value.toLocaleString()}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ fontSize: "16px", color: SLATE }}>{isExpanded ? "▲" : "▼"}</div>
                    </div>

                    {/* Letter warnings */}
                    {(nearlyExhausted.length > 0 || expiringLetters.length > 0) && (
                      <div style={{ padding: "4px 14px 8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {nearlyExhausted.map(l => (
                          <span key={l.id} style={{ fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "10px", backgroundColor: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>
                            ⚠ Letter {l.letter_number} nearly exhausted
                          </span>
                        ))}
                        {expiringLetters.map(l => (
                          <span key={`exp-${l.id}`} style={{ fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "10px", backgroundColor: l.diffDays < 0 ? "#fef2f2" : "#fffbeb", color: l.diffDays < 0 ? "#dc2626" : "#d97706", border: `1px solid ${l.diffDays < 0 ? "#fecaca" : "#fde68a"}` }}>
                            {l.diffDays < 0 ? "EXPIRED" : `Expires in ${l.diffDays}d`}: Letter {l.letter_number}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Expanded: contractors + letters */}
                    {isExpanded && (
                      <div style={{ borderTop: `1px solid ${BORDER}`, padding: "10px 14px" }}>
                        {item.contractors.length === 0 ? (
                          <div style={{ fontSize: "13px", color: SLATE }}>No authority letters issued yet.</div>
                        ) : item.contractors.map(c => (
                          <div key={c.contractor_id} style={{ marginBottom: "10px" }}>
                            <div style={{ fontSize: "13px", fontWeight: 700, color: NAVY, marginBottom: "4px" }}>{c.contractor_name}</div>
                            {c.letters.map(l => {
                              const auth = l.qty_31 + l.qty_36 + l.qty_45 + l.qty_meter;
                              const rem = l.remaining_31 + l.remaining_36 + l.remaining_45 + l.remaining_meter;
                              const collected = auth - rem;
                              const remPct = auth > 0 ? (rem / auth) * 100 : 0;
                              const remColor = remPct > 30 ? "#16a34a" : remPct > 10 ? "#d97706" : "#dc2626";
                              return (
                                <div key={l.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "5px 0", borderBottom: `1px solid var(--border-light,#f1f5f9)`, flexWrap: "wrap" }}>
                                  <div style={{ fontSize: "12px", fontWeight: 600, color: SLATE, minWidth: "110px" }}>Letter {l.letter_number}</div>
                                  <div style={{ flex: 1, height: "5px", borderRadius: "3px", backgroundColor: "#e2e8f0", minWidth: "60px" }}>
                                    <div style={{ height: "100%", width: `${Math.min(100, 100 - remPct)}%`, backgroundColor: "#7c3aed", borderRadius: "3px" }} />
                                  </div>
                                  <div style={{ fontSize: "12px", color: SLATE, whiteSpace: "nowrap" }}>{collected} of {auth} collected</div>
                                  <div style={{ fontSize: "12px", fontWeight: 700, color: remColor, whiteSpace: "nowrap" }}>{rem} left</div>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
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

      {activeTab === "production" && dailyTrend.length > 0 && (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", backgroundColor: "var(--bg-card, #ffffff)", padding: "14px", marginBottom: "14px" }}>
          <div style={{ fontSize: "15px", fontWeight: 700, color: NAVY, marginBottom: "8px" }}>30-Day Production Trend</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dailyTrend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={isMobile ? 4 : 2} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => Number(v).toLocaleString()} />
              <Bar dataKey="produced" fill="#16a34a" radius={[2, 2, 0, 0]} name="Produced" />
              <Bar dataKey="target" fill="#e2e8f0" radius={[2, 2, 0, 0]} name="Daily Target" />
              <Legend />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", backgroundColor: "var(--bg-card, #ffffff)", overflow: "hidden", marginBottom: "14px" }}>
        {activeTab === "production" && <KPITable summaries={summaries} metric="production" />}
        {activeTab === "dispatch" && <KPITable summaries={summaries} metric="dispatch" />}

        {activeTab === "breakage" && (() => {
          const sorted = [...summaries].filter((s) => s.breakageStatus !== "none").sort((a, b) => b.breakageRate - a.breakageRate);
          const maxRate = Math.max(...sorted.map((s) => s.breakageRate), 1);
          return (
            <div>
              {sorted.length > 0 && (
                <div style={{ padding: "12px 14px", borderBottom: `1px solid ${BORDER}` }}>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: NAVY, marginBottom: "8px" }}>Breakage by Plant (Pareto)</div>
                  {sorted.map((s) => {
                    const color = statusColor(s.breakageStatus);
                    return (
                      <div key={s.plant.id} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                        <span style={{ fontSize: "13px", fontWeight: 600, color: NAVY, width: "100px", flexShrink: 0 }}>{s.plant.name}</span>
                        <div style={{ flex: 1, height: "18px", backgroundColor: "#f1f5f9", borderRadius: "4px", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${(s.breakageRate / maxRate) * 100}%`, backgroundColor: color, borderRadius: "4px", transition: "width 0.3s" }} />
                        </div>
                        <span style={{ fontSize: "13px", fontWeight: 700, color, width: "50px", textAlign: "right" }}>{s.breakageRate.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                </div>
              )}
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
            </div>
          );
        })()}

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

