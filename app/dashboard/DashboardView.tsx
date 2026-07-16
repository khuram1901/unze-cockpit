"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase, loadMyPermissions } from "../lib/supabase";
import TaskStatus from "../tasks/TaskStatus";
import { formatDateUK, todayPakistanISO } from "../lib/dateUtils";
import { useMobile } from "../lib/useMobile";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { downloadCSV } from "../lib/exportUtils";
import MonthlyTargets from "./MonthlyTargets";
import { canSeeAllTasks, widgetVisible, type UserCtx, type PermOverrides } from "../lib/permissions";
import { useUserCtx } from "../lib/useUserCtx";
import { achievementStatus, breakageStatus as sharedBreakageStatus, ACHIEVEMENT_AMBER_MIN, BREAKAGE_RED_OVER, type KpiStatus } from "../lib/kpiThresholds";
import {
  COLOURS, RADII, SHADOWS,
  cardStyle, SectionTitle, StatusBadge,
  tableHeaderStyle, tableCellStyle, tableCellBoldStyle,
} from "../lib/SharedUI";

const { NAVY, SLATE, HAIRLINE, TRACK, GREEN, AMBER, RED, BLUE, INK_400,
        SUCCESS_SOFT, WARNING_SOFT, DANGER_SOFT, INFO_SOFT, CARD, CARD_ALT } = COLOURS;

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

type Status = KpiStatus;

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
function kpiStatusColor(s: Status) {
  if (s === "green") return GREEN;
  if (s === "amber") return AMBER;
  if (s === "red") return RED;
  return SLATE;
}
function kpiStatusSoft(s: Status) {
  if (s === "green") return SUCCESS_SOFT;
  if (s === "amber") return WARNING_SOFT;
  if (s === "red") return DANGER_SOFT;
  return HAIRLINE;
}
function statusLabel(s: Status) {
  if (s === "none") return "No Target";
  return s.toUpperCase();
}

// ── Kicker label shared style ──────────────────────────────────────
const kickerStyle: React.CSSProperties = {
  fontFamily:    "var(--font-sans, Inter, sans-serif)",
  fontSize:      "10.5px",
  fontWeight:    500,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color:         SLATE,
  marginBottom:  "10px",
};

// ── Tab strip ──────────────────────────────────────────────────────
const tabstripStyle: React.CSSProperties = {
  display:         "inline-flex",
  background:      CARD_ALT,
  border:          `1px solid ${HAIRLINE}`,
  borderRadius:    RADII.PILL,
  padding:         "3px",
  gap:             "2px",
  marginBottom:    "20px",
  flexWrap:        "wrap",
};

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding:         "6px 16px",
    fontSize:        "13px",
    fontWeight:      active ? 500 : 400,
    borderRadius:    RADII.PILL,
    color:           active ? NAVY : SLATE,
    background:      active ? CARD : "transparent",
    boxShadow:       active ? SHADOWS.HOVER : "none",
    cursor:          "pointer",
    border:          "none",
    whiteSpace:      "nowrap" as const,
  };
}

// ── Progress bar track ─────────────────────────────────────────────
function ProgressBar({ pct, color, height = 6 }: { pct: number; color: string; height?: number }) {
  return (
    <div style={{ flex: 1, height: `${height}px`, borderRadius: RADII.PILL, backgroundColor: TRACK, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: color, borderRadius: RADII.PILL, transition: "width 0.3s" }} />
    </div>
  );
}

export default function DashboardView() {
  const isMobile = useMobile();
  const { ctx } = useUserCtx();
  // Widget-level visibility (see app/lib/widgetRegistry.ts).
  const wv = (key: string, defaultVisible: boolean) => !!ctx && widgetVisible(ctx, key, defaultVisible);
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
      supabase.from("production_entries").select(ENTRY_COLS).gte("entry_date", monthStart).lte("entry_date", today),
    ]);

    const allPlantKpis = (plantKpisRes.data || []) as PlantKpiRow[];
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
          behindThisCheckpoint: hasTarget && quarterAchievement < ACHIEVEMENT_AMBER_MIN,
          weekNumber,
        };
      };

      const breakageRate = r.mtd_produced > 0 ? (r.mtd_broken / r.mtd_produced) * 100 : 0;
      const plantBreakageStatus = sharedBreakageStatus(breakageRate, r.mtd_produced > 0);

      return {
        plant: { id: r.plant_id, name: r.plant_name, type: r.plant_type },
        closingGoodStock,
        closingBrokenStock,
        todayProduced:   { s31: r.on_date_produced_31,   s36: r.on_date_produced_36,   s45: r.on_date_produced_45 },
        todayDispatched: { s31: r.on_date_dispatched_31, s36: r.on_date_dispatched_36, s45: r.on_date_dispatched_45 },
        todayBroken:     { s31: r.on_date_broken_31,     s36: r.on_date_broken_36,     s45: r.on_date_broken_45 },
        production: buildKPI(r.mtd_produced, monthlyProdTarget),
        dispatch:   buildKPI(r.mtd_dispatched, monthlyDispTarget),
        breakageRate, breakageStatus: plantBreakageStatus,
        enteredProductionToday: r.entered_on_date,
        enteredDispatchToday:   r.entered_on_date,
        productionDaysMissing: r.entered_on_date ? 0 : 1,
        dispatchDaysMissing:   r.entered_on_date ? 0 : 1,
      };
    });

    setSummaries(result);

    const trendProd = trendProdRes.data || [];
    const dailyMap = new Map<string, number>();
    for (const r of trendProd) {
      if (!plantIdSet.has(r.plant_id)) continue;
      const d = r.entry_date;
      dailyMap.set(d, (dailyMap.get(d) || 0) + (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0));
    }
    const { data: prodSummary } = await supabase.rpc("get_production_summary", { p_month: currentMonth });
    const totalMonthlyTarget = prodSummary?.[0]?.targ_total_month ?? 0;
    const dailyTarget = prodSummary?.[0]?.daily_target ?? 0;
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

  if (loading) return <p style={{ color: SLATE, fontFamily: "var(--font-sans, Inter, sans-serif)", fontSize: "14px" }}>Loading dashboard…</p>;

  const totalProducedToday = summaries.reduce((s, x) => s + total(x.todayProduced), 0);
  const totalDispatchedToday = summaries.reduce((s, x) => s + total(x.todayDispatched), 0);
  const totalBrokenToday = summaries.reduce((s, x) => s + total(x.todayBroken), 0);
  const totalClosingGoodStock = summaries.reduce((s, x) => s + total(x.closingGoodStock), 0);
  const totalClosingBrokenStock = summaries.reduce((s, x) => s + total(x.closingBrokenStock), 0);

  const missingPlants = summaries.filter((s) => !s.enteredProductionToday || !s.enteredDispatchToday);
  const weekNum = summaries.length > 0 ? summaries[0].production.weekNumber : 0;

  const openTasks = myTasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled");
  const completedCount = myTasks.filter((t) => t.status === "Completed").length;
  const visibleTasks = showCompleted ? myTasks : openTasks;

  const downMachines = machineIssues.filter((m) => m.issue_status === "Down");
  const overdueTaskCount = openTasks.filter((t) => t.due_date && t.due_date < today).length;

  const bannerItems: string[] = [];
  if (downMachines.length > 0) bannerItems.push(`${downMachines.length} machine${downMachines.length > 1 ? "s" : ""} down`);
  if (missingPlants.length > 0) bannerItems.push(`${missingPlants.length} plant${missingPlants.length > 1 ? "s" : ""} not reported`);
  if (overdueTaskCount > 0) bannerItems.push(`${overdueTaskCount} overdue task${overdueTaskCount > 1 ? "s" : ""}`);
  const hasBannerItems = bannerItems.length > 0;
  const hasCritical = downMachines.length > 0 || overdueTaskCount > 0;

  const bannerBg   = hasCritical ? DANGER_SOFT  : WARNING_SOFT;
  const bannerBdr  = hasCritical ? "#EDB5B2"    : "#F1D9A9";
  const bannerAcct = hasCritical ? RED          : AMBER;
  const bannerText = hasCritical ? RED          : AMBER;

  return (
    <div style={{ maxWidth: "100%", overflowX: "hidden" }}>

      {/* ═══ ZONE 1: ALERT BANNER ═══ */}
      {wv("dashboard.attention_banner", true) && (hasBannerItems ? (
        <div style={{
          background:    bannerBg,
          border:        `1px solid ${bannerBdr}`,
          borderRadius:  RADII.CARD,
          overflow:      "hidden",
          marginBottom:  "24px",
        }}>
          <div
            onClick={() => setBannerOpen(!bannerOpen)}
            style={{ padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "flex-start", gap: "14px" }}
          >
            {/* Icon mark — matches Genspark alert pattern */}
            <div style={{
              width: "30px", height: "30px", borderRadius: "8px",
              background: bannerAcct, color: "#fff",
              display: "grid", placeItems: "center", flexShrink: 0,
            }}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 2L14.5 13H1.5L8 2Z" />
                <line x1="8" y1="7" x2="8" y2="10" />
                <circle cx="8" cy="12" r="0.5" fill="currentColor" />
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: NAVY }}>
                Attention needed — {bannerItems.length} issue{bannerItems.length > 1 ? "s" : ""}
              </div>
              <div style={{ fontSize: "12.5px", color: COLOURS.INK_700, marginTop: "3px" }}>
                {bannerItems.join(" · ")}
              </div>
            </div>
            <span style={{ fontSize: "12px", color: SLATE, marginTop: "2px" }}>{bannerOpen ? "▲" : "▼"}</span>
          </div>

          {bannerOpen && (
            <div style={{ borderTop: `1px solid ${bannerBdr}`, background: CARD }}>
              {downMachines.length > 0 && (
                <>
                  <div style={{ padding: "8px 18px", fontSize: "10.5px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: RED, borderBottom: `1px solid ${HAIRLINE}` }}>
                    Machines Down ({downMachines.length})
                  </div>
                  {machineIssues.filter((m) => m.issue_status === "Down").map((m) => (
                    <div key={m.id} style={{ padding: "10px 18px 10px 52px", borderBottom: `1px solid ${HAIRLINE}`, fontSize: "13px" }}>
                      <span style={{ fontWeight: 600, color: NAVY }}>{m.plant_name} — {m.machine_name}</span>
                      <span style={{ color: SLATE, marginLeft: "8px" }}>{m.issue_description || ""}</span>
                    </div>
                  ))}
                </>
              )}
              {missingPlants.length > 0 && (
                <>
                  <div style={{ padding: "8px 18px", fontSize: "10.5px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: AMBER, borderBottom: `1px solid ${HAIRLINE}` }}>
                    Plants Not Reported ({missingPlants.length})
                  </div>
                  {missingPlants.map((s) => (
                    <div key={s.plant.id} style={{ padding: "10px 18px 10px 52px", borderBottom: `1px solid ${HAIRLINE}`, fontSize: "13px", display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontWeight: 600, color: NAVY }}>{s.plant.name}</span>
                      <span style={{ color: s.productionDaysMissing >= 3 || s.dispatchDaysMissing >= 3 ? RED : AMBER, fontWeight: 600, fontSize: "12px" }}>
                        {s.productionDaysMissing >= 3 || s.dispatchDaysMissing >= 3 ? "Escalated (3+ days)" : "Chase today"}
                      </span>
                    </div>
                  ))}
                </>
              )}
              {overdueTaskCount > 0 && (
                <>
                  <div style={{ padding: "8px 18px", fontSize: "10.5px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: RED, borderBottom: `1px solid ${HAIRLINE}` }}>
                    Overdue Tasks ({overdueTaskCount})
                  </div>
                  {openTasks.filter((t) => t.due_date && t.due_date < today).map((t) => (
                    <a key={t.id} href={`/tasks?task=${t.id}`} style={{ textDecoration: "none", color: "inherit", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 18px 10px 52px", borderBottom: `1px solid ${HAIRLINE}`, fontSize: "13px" }}>
                      <span style={{ fontWeight: 600, color: NAVY }}>{t.description}</span>
                      <span style={{ color: RED, fontWeight: 600, fontSize: "12px", marginLeft: "12px", whiteSpace: "nowrap" }}>
                        Due {formatDateUK(t.due_date)} →
                      </span>
                    </a>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={{
          background:    SUCCESS_SOFT,
          border:        `1px solid #A8D5C2`,
          borderRadius:  RADII.CARD,
          padding:       "14px 18px",
          display:       "flex",
          alignItems:    "center",
          gap:           "12px",
          marginBottom:  "24px",
        }}>
          <div style={{ width: "30px", height: "30px", borderRadius: "8px", background: GREEN, color: "#fff", display: "grid", placeItems: "center", flexShrink: 0 }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 8 6.5 11.5 13 5" />
            </svg>
          </div>
          <span style={{ fontSize: "13px", fontWeight: 600, color: GREEN }}>All clear — no machines down, all plants reported, no overdue tasks.</span>
        </div>
      ))}

      {/* ═══ HERO + KPI CARDS ═══ */}
      {/* Good Stock hero (dark card) + 5 compact KPIs */}
      {wv("dashboard.hero_kpi_cards", true) && (
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "minmax(200px, 1.4fr) repeat(5, 1fr)",
        gap: "12px",
        marginBottom: "32px",
      }}>
        {/* Hero */}
        <div style={{
          background:   NAVY,
          borderRadius: RADII.LG,
          padding:      "24px",
          color:        "#fff",
          display:      "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          minHeight:    "120px",
        }}>
          <div style={{ fontSize: "10.5px", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>
            Good Stock
          </div>
          <div style={{
            fontFamily:         "var(--font-display, 'Inter Tight', sans-serif)",
            fontSize:           isMobile ? "36px" : "44px",
            fontWeight:         600,
            letterSpacing:      "-0.025em",
            fontVariantNumeric: "tabular-nums",
            lineHeight:         1,
            marginTop:          "10px",
          }}>
            {totalClosingGoodStock.toLocaleString()}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "20px", paddingTop: "14px", borderTop: "1px solid rgba(255,255,255,0.1)", fontSize: "11.5px", color: "rgba(255,255,255,0.6)" }}>
            <span>Across {summaries.length} plant{summaries.length !== 1 ? "s" : ""}</span>
            <span>Broken {totalClosingBrokenStock.toLocaleString()} · Issues {machineIssues.length}</span>
          </div>
        </div>

        {/* 5 compact KPI cards */}
        <KpiCard label="Produced Today"   value={totalProducedToday}     color={SLATE}  />
        <KpiCard label="Dispatched Today" value={totalDispatchedToday}   color={SLATE}  />
        <KpiCard label="Broken Today"     value={totalBrokenToday}       color={totalBrokenToday > 0 ? AMBER : SLATE} />
        <KpiCard label="Broken Stock"     value={totalClosingBrokenStock} color={totalClosingBrokenStock > 0 ? RED : SLATE} />
        <KpiCard label="Machine Issues"   value={machineIssues.length}   color={machineIssues.length > 0 ? RED : GREEN} />
      </div>
      )}

      {/* ═══ ZONE 2: CHARTS ROW ═══ */}
      {wv("dashboard.this_month_charts", true) && (<>
      <SectionTitle title="This Month" style={{ marginTop: 0 }} />
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.4fr 1fr", gap: "16px", marginBottom: "16px" }}>

        {/* Plant Comparison Chart */}
        {summaries.length > 0 && (
          <div style={{ ...cardStyle, padding: "22px 24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
              <div style={{ fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontSize: "15px", fontWeight: 600, color: NAVY }}>Plant comparison</div>
              <span style={{ fontSize: "11px", color: SLATE, marginLeft: "auto" }}>Produced · Dispatched · Target</span>
            </div>
            <ResponsiveContainer width="100%" height={Math.max(200, summaries.length * 55)}>
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
                <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: SLATE, fontFamily: "var(--font-mono)" }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 12, fill: NAVY, fontWeight: 500 }} width={80} />
                <Tooltip formatter={(value) => Number(value).toLocaleString()} />
                <Legend iconType="square" wrapperStyle={{ fontSize: "12px" }} />
                <Bar dataKey="Target"     fill={COLOURS.INK_300} name="Target"     radius={[0, 4, 4, 0]} />
                <Bar dataKey="Produced"   fill={GREEN}           name="Produced"   radius={[0, 4, 4, 0]} />
                <Bar dataKey="Dispatched" fill={BLUE}            name="Dispatched" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Breakage Rate */}
        <div style={{ ...cardStyle, padding: "22px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: "16px" }}>
            <div style={{ fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontSize: "15px", fontWeight: 600, color: NAVY }}>Breakage rate by plant</div>
            <span style={{ fontSize: "11px", color: SLATE, marginLeft: "auto" }}>Limit {BREAKAGE_RED_OVER}%</span>
          </div>
          {summaries.map((s) => {
            const rate = s.breakageRate;
            const color = kpiStatusColor(s.breakageStatus);
            const chartScale = BREAKAGE_RED_OVER * 2;
            const barWidth = s.breakageStatus === "none" ? 0 : Math.min(rate / chartScale * 100, 100);
            return (
              <div key={s.plant.id} style={{ display: "grid", gridTemplateColumns: "100px 1fr 80px", gap: "12px", alignItems: "center", padding: "12px 0", borderBottom: `1px solid ${HAIRLINE}` }}>
                <span style={{ fontSize: "12.5px", color: NAVY, fontWeight: 500 }}>{s.plant.name.replace(" Plant", "")}</span>
                <div style={{ position: "relative", height: "4px", background: TRACK, borderRadius: "999px", overflow: "hidden" }}>
                  <div style={{ position: "absolute", inset: 0, width: `${barWidth}%`, background: color, borderRadius: "999px" }} />
                  {/* Threshold marker sits at BREAKAGE_RED_OVER on this 2x-BREAKAGE_RED_OVER scale, i.e. always 50% */}
                  <div style={{ position: "absolute", top: "-4px", bottom: "-4px", left: `${(BREAKAGE_RED_OVER / chartScale) * 100}%`, width: "1px", background: RED, opacity: 0.4 }} />
                </div>
                <span style={{
                  fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                  fontSize: "11px",
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                  color: s.breakageStatus === "none" ? INK_400 : color,
                  fontWeight: s.breakageStatus === "none" ? 400 : 600,
                }}>
                  {s.breakageStatus === "none" ? "No data" : `${rate.toFixed(2)}%`}
                </span>
              </div>
            );
          })}
          <div style={{ marginTop: "12px", paddingTop: "10px", fontSize: "11px", color: SLATE, display: "flex", justifyContent: "space-between" }}>
            <span>Vertical mark = {BREAKAGE_RED_OVER}% limit</span>
            <span>Below limit is <span style={{ color: GREEN, fontWeight: 500 }}>healthy</span></span>
          </div>
        </div>
      </div>
      </>)}

      {/* ═══ ZONE 2b: STOCK BY CUSTOMER PO ═══ */}
      {wv("dashboard.stock_by_customer_po", true) && (
      <div style={{ marginBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexWrap: "wrap", gap: "8px" }}>
          <SectionTitle title="Stock by Customer PO" style={{ margin: 0 }} />
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <button onClick={() => setShowClosedPOs(v => !v)} style={{
              fontSize: "12px", fontWeight: 500, padding: "6px 14px",
              borderRadius: RADII.PILL, border: `1px solid ${HAIRLINE}`,
              background: CARD, color: SLATE, cursor: "pointer",
            }}>
              {showClosedPOs ? "Hide Closed" : "Show Closed"}
            </button>
            <a href="/stock" style={{
              fontSize: "12px", fontWeight: 500, padding: "6px 14px",
              borderRadius: RADII.PILL, border: `1px solid ${HAIRLINE}`,
              background: CARD, color: NAVY, cursor: "pointer", textDecoration: "none",
            }}>
              Full View →
            </a>
          </div>
        </div>
        <div style={{ fontSize: "13px", color: SLATE, marginTop: "-12px", marginBottom: "16px" }}>Produced · Dispatched · In Stock · Fulfilment</div>

        {stockLoading ? (
          <div style={{ ...cardStyle, padding: "20px 24px", color: SLATE, fontSize: "13px" }}>Loading stock data…</div>
        ) : plantStocks.length === 0 ? (
          <div style={{ ...cardStyle, padding: "40px 24px", textAlign: "center" }}>
            <div style={{ fontSize: "13px", color: COLOURS.INK_700, marginBottom: "4px" }}>No stock data yet.</div>
            <a href="/stock/manage" style={{ fontSize: "12px", color: BLUE, fontWeight: 500 }}>Add the first PO →</a>
          </div>
        ) : plantStocks.map((ps) => {
          const visibleItems = ps.items.filter(i =>
            !i.po.is_system_unallocated && (showClosedPOs || i.po.status === "Active")
          );
          if (visibleItems.length === 0) return null;
          return (
            <div key={ps.plant_id} style={{ marginBottom: "12px" }}>
              <div style={{ ...kickerStyle, marginBottom: "6px" }}>{ps.plant_name}</div>
              {visibleItems.map((item) => {
                const ordered = item.po.ordered_31 + item.po.ordered_36 + item.po.ordered_45 + item.po.ordered_meter;
                const produced = item.produced_31 + item.produced_36 + item.produced_45 + item.produced_meter;
                const dispatched = item.dispatched_31 + item.dispatched_36 + item.dispatched_45 + item.dispatched_meter;
                const inStock = item.in_stock_31 + item.in_stock_36 + item.in_stock_45 + item.in_stock_meter;
                const pct = item.fulfillment_pct;
                const isClosed = item.po.status === "Closed";
                const isExpanded = expandedPOs.has(item.po.id);
                const pctColor = pct >= 90 ? GREEN : pct >= 60 ? AMBER : RED;

                const allLetters = item.contractors.flatMap(c => c.letters);
                const nearlyExhausted = allLetters.filter(l => {
                  const auth = l.qty_31 + l.qty_36 + l.qty_45 + l.qty_meter;
                  const rem = l.remaining_31 + l.remaining_36 + l.remaining_45 + l.remaining_meter;
                  return auth > 0 && rem / auth < 0.1;
                });
                // Found during the 15 Jul 2026 audit: was UTC "today"
                // (new Date().toISOString()) — anchored to Pakistan
                // local time now, same as the other letter-expiry fixes.
                const today_str = todayPakistanISO();
                const expiredWithBalance = allLetters.filter(l => {
                  if (!l.expiry_date || l.expiry_date >= today_str) return false;
                  return (l.remaining_31 + l.remaining_36 + l.remaining_45 + l.remaining_meter) > 0;
                }).map(l => ({
                  ...l,
                  diffDays: Math.ceil((new Date(l.expiry_date!).getTime() - new Date(today_str).getTime()) / 86400000),
                }));
                const expiringSoon = allLetters.filter(l => {
                  if (!l.expiry_date) return false;
                  const diff = Math.ceil((new Date(l.expiry_date).getTime() - new Date(today_str).getTime()) / 86400000);
                  return diff >= 0 && diff <= 14 && (l.remaining_31 + l.remaining_36 + l.remaining_45 + l.remaining_meter) > 0;
                }).map(l => ({
                  ...l,
                  diffDays: Math.ceil((new Date(l.expiry_date!).getTime() - new Date(today_str).getTime()) / 86400000),
                }));

                return (
                  <div key={item.po.id} style={{
                    ...cardStyle,
                    padding: 0,
                    marginBottom: "8px",
                    borderLeft: `3px solid ${isClosed ? COLOURS.INK_300 : NAVY}`,
                    opacity: isClosed ? 0.7 : 1,
                  }}>
                    <div
                      onClick={() => setExpandedPOs(prev => { const s = new Set(prev); s.has(item.po.id) ? s.delete(item.po.id) : s.add(item.po.id); return s; })}
                      style={{ padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: NAVY }}>
                          {item.po.customer_name}
                          <span style={{ fontWeight: 400, color: SLATE, marginLeft: "6px" }}>PO #{item.po.po_number}</span>
                          {item.po.po_label && (
                            <span style={{ fontSize: "11px", marginLeft: "6px", padding: "2px 8px", borderRadius: RADII.PILL, background: INFO_SOFT, color: BLUE, fontWeight: 600 }}>
                              {item.po.po_label}
                            </span>
                          )}
                          {isClosed && (
                            <span style={{ fontSize: "11px", marginLeft: "6px", padding: "2px 8px", borderRadius: RADII.PILL, background: HAIRLINE, color: SLATE, fontWeight: 600 }}>
                              CLOSED
                            </span>
                          )}
                        </div>
                        {ordered > 0 && (
                          <div style={{ marginTop: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
                            <ProgressBar pct={pct} color={pctColor} height={5} />
                            <span style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: "11px", fontWeight: 600, color: pctColor, whiteSpace: "nowrap" }}>{pct.toFixed(0)}%</span>
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: "16px", flexShrink: 0 }}>
                        {[
                          { label: "Ordered",    value: ordered,    color: SLATE },
                          { label: "Produced",   value: produced,   color: BLUE },
                          { label: "Dispatched", value: dispatched, color: NAVY },
                          { label: "In Stock",   value: inStock,    color: inStock > 0 ? GREEN : SLATE },
                        ].map(s => (
                          <div key={s.label} style={{ textAlign: "center" }}>
                            <div style={{ ...kickerStyle, marginBottom: "4px" }}>{s.label}</div>
                            <div style={{
                              fontFamily: "var(--font-display, 'Inter Tight', sans-serif)",
                              fontSize: "15px", fontWeight: 600, color: s.color,
                              fontVariantNumeric: "tabular-nums",
                            }}>{s.value.toLocaleString()}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ fontSize: "12px", color: SLATE }}>{isExpanded ? "▲" : "▼"}</div>
                    </div>

                    {(nearlyExhausted.length > 0 || expiredWithBalance.length > 0 || expiringSoon.length > 0) && (
                      <div style={{ padding: "4px 18px 10px", display: "flex", flexDirection: "column", gap: "8px" }}>
                        {nearlyExhausted.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                            {nearlyExhausted.map(l => (
                              <span key={l.id} style={{ fontSize: "11px", fontWeight: 600, padding: "2px 10px", borderRadius: RADII.PILL, background: DANGER_SOFT, color: RED, border: `1px solid #EDB5B2` }}>
                                ⚠ Letter {l.letter_number} nearly exhausted
                              </span>
                            ))}
                          </div>
                        )}
                        {expiredWithBalance.length > 0 && (
                          <div style={{ backgroundColor: DANGER_SOFT, border: `1px solid ${RED}`, borderLeft: `4px solid ${RED}`, borderRadius: RADII.SM, padding: "10px 14px" }}>
                            <div style={{ fontSize: "12px", fontWeight: 700, color: RED, marginBottom: "6px" }}>
                              ⛔ {expiredWithBalance.length} expired letter{expiredWithBalance.length > 1 ? "s" : ""} with uncollected balance — dispatch now blocked
                            </div>
                            {expiredWithBalance.map((l, i) => (
                              <div key={i} style={{ fontSize: "11px", color: RED, marginBottom: "2px" }}>
                                Letter #{l.letter_number} · {l.contractor_name} · Expired {formatDateUK(l.expiry_date!)} ·{" "}
                                {[
                                  l.remaining_31 > 0 ? `${l.remaining_31}×31ft` : null,
                                  l.remaining_36 > 0 ? `${l.remaining_36}×36ft` : null,
                                  l.remaining_45 > 0 ? `${l.remaining_45}×45ft` : null,
                                  l.remaining_meter > 0 ? `${l.remaining_meter}×Mtr` : null,
                                ].filter(Boolean).join(", ")} uncollected
                              </div>
                            ))}
                          </div>
                        )}
                        {expiringSoon.length > 0 && (
                          <div style={{ backgroundColor: WARNING_SOFT, border: `1px solid ${AMBER}`, borderLeft: `4px solid ${AMBER}`, borderRadius: RADII.SM, padding: "10px 14px" }}>
                            <div style={{ fontSize: "12px", fontWeight: 700, color: AMBER, marginBottom: "6px" }}>
                              ⚠ {expiringSoon.length} letter{expiringSoon.length > 1 ? "s" : ""} expiring within 14 days — action required
                            </div>
                            {expiringSoon.map((l, i) => (
                              <div key={i} style={{ fontSize: "11px", color: AMBER, marginBottom: "2px" }}>
                                Letter #{l.letter_number} · {l.contractor_name} · Expires {formatDateUK(l.expiry_date!)}{" "}
                                ({l.diffDays === 0 ? "today" : `${l.diffDays} day${l.diffDays > 1 ? "s" : ""}`}) ·{" "}
                                {[
                                  l.remaining_31 > 0 ? `${l.remaining_31}×31ft` : null,
                                  l.remaining_36 > 0 ? `${l.remaining_36}×36ft` : null,
                                  l.remaining_45 > 0 ? `${l.remaining_45}×45ft` : null,
                                  l.remaining_meter > 0 ? `${l.remaining_meter}×Mtr` : null,
                                ].filter(Boolean).join(", ")} remaining
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {isExpanded && (
                      <div style={{ borderTop: `1px solid ${HAIRLINE}`, padding: "14px 18px" }}>
                        {item.contractors.length === 0 ? (
                          <div style={{ fontSize: "13px", color: SLATE }}>No authority letters issued yet.</div>
                        ) : item.contractors.map(c => (
                          <div key={c.contractor_id} style={{ marginBottom: "12px" }}>
                            <div style={{ fontSize: "12px", fontWeight: 600, color: NAVY, marginBottom: "6px" }}>{c.contractor_name}</div>
                            {c.letters.map(l => {
                              const auth = l.qty_31 + l.qty_36 + l.qty_45 + l.qty_meter;
                              const rem = l.remaining_31 + l.remaining_36 + l.remaining_45 + l.remaining_meter;
                              const collected = auth - rem;
                              const remPct = auth > 0 ? (rem / auth) * 100 : 0;
                              const remColor = remPct > 30 ? GREEN : remPct > 10 ? AMBER : RED;
                              return (
                                <div key={l.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 0", borderBottom: `1px solid ${HAIRLINE}`, flexWrap: "wrap" }}>
                                  <div style={{ ...kickerStyle, minWidth: "110px", marginBottom: 0 }}>Letter {l.letter_number}</div>
                                  <div style={{ flex: 1, minWidth: "60px" }}>
                                    <ProgressBar pct={100 - remPct} color={BLUE} height={5} />
                                  </div>
                                  <div style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: "11px", color: SLATE, whiteSpace: "nowrap" }}>{collected} of {auth} collected</div>
                                  <div style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: "11px", fontWeight: 600, color: remColor, whiteSpace: "nowrap" }}>{rem} left</div>
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
      )}

      {/* ═══ ZONE 3: TABBED KPI DETAIL ═══ */}
      {wv("dashboard.kpis_table", true) && (<>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "0", flexWrap: "wrap" }}>
        <SectionTitle title="KPIs" style={{ margin: "32px 0 0" }} />
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
          }} style={{
            marginTop: "28px",
            background: CARD, color: NAVY, border: `1px solid ${HAIRLINE}`,
            borderRadius: RADII.PILL, padding: "6px 14px", fontSize: "12px", fontWeight: 500, cursor: "pointer",
          }}>
            Export CSV
          </button>
        )}
      </div>

      <div style={tabstripStyle}>
        {([
          { key: "production" as const, label: "Production KPI" },
          { key: "dispatch"   as const, label: "Dispatch KPI" },
          { key: "breakage"   as const, label: "Breakage" },
          { key: "tasks"      as const, label: `My Tasks (${openTasks.length})` },
        ]).map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={tabStyle(activeTab === tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* 30-day trend chart (production tab only) */}
      {activeTab === "production" && dailyTrend.length > 0 && (
        <div style={{ ...cardStyle, padding: "22px 24px", marginBottom: "16px" }}>
          <div style={{ fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontSize: "15px", fontWeight: 600, color: NAVY, marginBottom: "14px" }}>
            30-day production trend
            <span style={{ fontSize: "11px", fontWeight: 400, color: SLATE, marginLeft: "8px" }}>All plants combined</span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={dailyTrend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: SLATE, fontFamily: "var(--font-mono)" }} interval={isMobile ? 4 : 2} />
              <YAxis tick={{ fontSize: 10, fill: SLATE, fontFamily: "var(--font-mono)" }} />
              <Tooltip formatter={(v) => Number(v).toLocaleString()} />
              <Bar dataKey="produced" fill={GREEN}           radius={[2, 2, 0, 0]} name="Produced" />
              <Bar dataKey="target"   fill={COLOURS.INK_300} radius={[2, 2, 0, 0]} name="Daily Target" />
              <Legend wrapperStyle={{ fontSize: "12px" }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* KPI table card */}
      <div style={{ ...cardStyle, padding: 0, overflow: "hidden", marginBottom: "16px" }}>
        {activeTab === "production" && <KPITable summaries={summaries} metric="production" />}
        {activeTab === "dispatch"   && <KPITable summaries={summaries} metric="dispatch" />}

        {activeTab === "breakage" && (() => {
          const sorted = [...summaries].filter((s) => s.breakageStatus !== "none").sort((a, b) => b.breakageRate - a.breakageRate);
          const maxRate = Math.max(...sorted.map((s) => s.breakageRate), 1);
          return (
            <div>
              {sorted.length > 0 && (
                <div style={{ padding: "20px 24px", borderBottom: `1px solid ${HAIRLINE}` }}>
                  <div style={{ ...kickerStyle, marginBottom: "12px" }}>Breakage by plant (pareto)</div>
                  {sorted.map((s) => {
                    const color = kpiStatusColor(s.breakageStatus);
                    return (
                      <div key={s.plant.id} style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                        <span style={{ fontSize: "12px", fontWeight: 500, color: NAVY, width: "100px", flexShrink: 0 }}>{s.plant.name}</span>
                        <div style={{ flex: 1, height: "16px", background: TRACK, borderRadius: RADII.XS, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${(s.breakageRate / maxRate) * 100}%`, background: color, borderRadius: RADII.XS, transition: "width 0.3s" }} />
                        </div>
                        <span style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: "12px", fontWeight: 600, color, width: "48px", textAlign: "right" }}>
                          {s.breakageRate.toFixed(1)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={tableHeaderStyle}>Plant</th>
                      <th style={{ ...tableHeaderStyle, textAlign: "right" }}>Month Produced</th>
                      <th style={{ ...tableHeaderStyle, textAlign: "right" }}>Breakage Rate</th>
                      <th style={{ ...tableHeaderStyle, textAlign: "right" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaries.map((s) => {
                      const color = kpiStatusColor(s.breakageStatus);
                      return (
                        <tr key={s.plant.id}>
                          <td style={tableCellBoldStyle}>{s.plant.name}</td>
                          <td style={{ ...tableCellStyle, textAlign: "right", fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)" }}>
                            {s.production.monthActual.toLocaleString()}
                          </td>
                          <td style={{ ...tableCellStyle, textAlign: "right", fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", color, fontWeight: 600 }}>
                            {s.breakageStatus === "none" ? "—" : `${s.breakageRate.toFixed(2)}%`}
                          </td>
                          <td style={{ ...tableCellStyle, textAlign: "right" }}>
                            <span style={{ display: "inline-block", fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: RADII.PILL, color, background: kpiStatusSoft(s.breakageStatus) }}>
                              {s.breakageStatus === "none" ? "No Production" : statusLabel(s.breakageStatus)}
                            </span>
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
            <div style={{ padding: "24px", color: SLATE, textAlign: "center", fontSize: "13px" }}>No tasks assigned to you.</div>
          ) : (
            <>
              {completedCount > 0 && (
                <div style={{ padding: "10px 20px", borderBottom: `1px solid ${HAIRLINE}`, textAlign: "right" }}>
                  <button onClick={() => setShowCompleted((v) => !v)}
                    style={{ fontSize: "12px", fontWeight: 500, color: NAVY, background: CARD, border: `1px solid ${HAIRLINE}`, borderRadius: RADII.PILL, padding: "5px 14px", cursor: "pointer" }}>
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
      </>)}

      {/* Monthly Targets */}
      {wv("dashboard.monthly_targets", true) && (
      <>
      <SectionTitle title="Monthly Targets" />
      <div style={{ ...cardStyle, padding: "22px 24px" }}>
        <MonthlyTargets />
      </div>
      </>
      )}
    </div>
  );
}

function FragmentRow({
  task, open, onToggle, onChanged,
}: {
  task: Task; open: boolean; onToggle: () => void; onChanged: () => void;
}) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer", background: open ? COLOURS.CARD_ALT : CARD }}>
        <td style={{ ...tableCellBoldStyle, maxWidth: "420px" }}>{task.description}</td>
        <td style={tableCellStyle}>{task.priority || "—"}</td>
        <td style={{ ...tableCellStyle, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)" }}>
          {formatDateUK(task.due_date)}
        </td>
        <td style={tableCellStyle}>
          <StatusBadge status={task.status} />
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4} style={{ ...tableCellStyle, background: COLOURS.CARD_ALT, padding: "16px 20px" }}>
            <div style={{ fontSize: "13px", color: SLATE, marginBottom: "8px" }}>
              Type: <strong style={{ color: NAVY }}>{task.task_type || "Task"}</strong>
              {" "}&nbsp;·&nbsp;{" "}
              Assigned by: <strong style={{ color: NAVY }}>{task.assigned_by || "—"}</strong>
              {" "}&nbsp;·&nbsp;{" "}
              <span style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)" }}>
                Assigned: {formatDateUK(task.assigned_date)}
              </span>
            </div>
            {task.notes && <div style={{ fontSize: "13px", color: SLATE, marginBottom: "10px" }}>Notes: {task.notes}</div>}
            {task.reply_text && (
              <div style={{
                padding: "12px 14px", border: `1px solid #A8D5C2`,
                background: COLOURS.SUCCESS_SOFT, borderRadius: RADII.SM,
                color: COLOURS.GREEN, fontSize: "13px", marginBottom: "10px",
              }}>
                <strong>Your explanation:</strong> {task.reply_text}
                {task.corrective_action && <div style={{ marginTop: "5px" }}><strong>Corrective action:</strong> {task.corrective_action}</div>}
                {task.recovery_date && (
                  <div style={{ marginTop: "5px" }}>
                    <strong>Expected recovery:</strong>{" "}
                    <span style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)" }}>{formatDateUK(task.recovery_date)}</span>
                  </div>
                )}
              </div>
            )}
            <TaskStatus task={task} currentRole="Manager" onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  );
}

function KPITable({ summaries, metric }: { summaries: PlantSummary[]; metric: "production" | "dispatch" }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "640px" }}>
        <thead>
          <tr>
            <th style={tableHeaderStyle}>Plant</th>
            <th style={{ ...tableHeaderStyle, textAlign: "right" }}>Monthly Target</th>
            <th style={{ ...tableHeaderStyle, textAlign: "right" }}>Month Actual</th>
            <th style={{ ...tableHeaderStyle, textAlign: "right" }}>Month %</th>
            <th style={{ ...tableHeaderStyle, textAlign: "right" }}>Cum. Wk Target</th>
            <th style={{ ...tableHeaderStyle, textAlign: "right" }}>Cum. Actual</th>
            <th style={{ ...tableHeaderStyle, textAlign: "right" }}>Wk %</th>
            <th style={{ ...tableHeaderStyle, textAlign: "right" }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((s) => {
            const k = s[metric];
            const color = kpiStatusColor(k.status);
            const wkColor = k.behindThisCheckpoint ? RED : GREEN;
            const mono: React.CSSProperties = { fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontVariantNumeric: "tabular-nums" };
            return (
              <tr key={s.plant.id}>
                <td style={tableCellBoldStyle}>{s.plant.name}</td>
                <td style={{ ...tableCellStyle, textAlign: "right", ...mono }}>{k.monthlyTarget.toLocaleString()}</td>
                <td style={{ ...tableCellStyle, textAlign: "right", ...mono }}>{k.monthActual.toLocaleString()}</td>
                <td style={{ ...tableCellStyle, textAlign: "right", ...mono, color, fontWeight: 600 }}>
                  {k.monthlyTarget > 0 ? `${k.monthAchievement}%` : "—"}
                </td>
                <td style={{ ...tableCellStyle, textAlign: "right", ...mono }}>{k.quarterTarget.toLocaleString()}</td>
                <td style={{ ...tableCellStyle, textAlign: "right", ...mono }}>{k.quarterActual.toLocaleString()}</td>
                <td style={{ ...tableCellStyle, textAlign: "right", ...mono, color: k.monthlyTarget > 0 ? wkColor : SLATE, fontWeight: 600 }}>
                  {k.monthlyTarget > 0 ? `${k.quarterAchievement}%` : "—"}
                </td>
                <td style={{ ...tableCellStyle, textAlign: "right" }}>
                  <span style={{ display: "inline-block", fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: RADII.PILL, color, background: kpiStatusSoft(k.status) }}>
                    {statusLabel(k.status)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Compact KPI card — 26px number, kicker label above, hairline border all round
function KpiCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ ...cardStyle, padding: "16px 18px" }}>
      <div style={kickerStyle}>{label}</div>
      <div style={{
        fontFamily:         "var(--font-display, 'Inter Tight', sans-serif)",
        fontSize:           "26px",
        fontWeight:         600,
        letterSpacing:      "-0.02em",
        fontVariantNumeric: "tabular-nums",
        color,
        lineHeight:         1,
      }}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
