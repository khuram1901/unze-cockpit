"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase, authFetch, loadMyPermissions } from "../lib/supabase";
import EscalationTrafficLights from "../lib/EscalationTrafficLights";
import { COLOURS, RADII, StatusBadge, SectionTitle, RAGStatus, ragColour, FreshnessBadge, WARNING_BANNER_STYLE, WARNING_TITLE_COLOR, displayRole } from "../lib/SharedUI";
import { formatDateUK, formatMonthUK, workingDaysFromNow } from "../lib/dateUtils";
import { UTPL_COMPANY_ID, IFPL_COMPANY_ID, DIR_COMPANY_ID, COMPANIES, FINANCE_COMPANIES as ALL_FINANCE_COMPANIES } from "../lib/constants";
import { useMobile } from "../lib/useMobile";
import { useUserCtx } from "../lib/useUserCtx";
import { isPA, isPrivileged, canCreateAssignments, canViewFinance, isAdminTier, canViewExecutiveDashboard, widgetVisible, financeCompanies, type UserCtx, type PermOverrides } from "../lib/permissions";
import { achievementStatus, breakageStatus, BREAKAGE_RED_OVER } from "../lib/kpiThresholds";
import { logAction } from "../lib/audit-log";
import { DEPARTMENT_CONFIGS, getDepartmentHealthStatus } from "../lib/department-config";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import DateInputWithCalendar from "../lib/DateInputWithCalendar";
import TaxComplianceSummary from "../accounts-tax/TaxComplianceSummary";

const { NAVY, SLATE, BORDER, CANVAS, HAIRLINE, CARD_ALT, INK_700, INK_400, GREEN, AMBER, RED, BLUE, SUCCESS_SOFT, WARNING_SOFT, DANGER_SOFT } = COLOURS;

// Same company grouping as the Folder-it page's "By Company" grid
// (Baranh + Haute Dolci merged into one Restaurant row, Directors shown
// as Family Documents, Almahar left out for now) — brief labels + a
// distinct colour per company for the executive summary card below.
type FolderitHomeCardCompany = { groupKey: string; label: string; colour: string };
const FOLDERIT_HOME_CARD_COMPANIES: FolderitHomeCardCompany[] = [
  { groupKey: UTPL_COMPANY_ID, label: "UTPL", colour: BLUE },
  { groupKey: IFPL_COMPANY_ID, label: "IFPL", colour: GREEN },
  { groupKey: "restaurants", label: "Restaurant", colour: AMBER },
  { groupKey: DIR_COMPANY_ID, label: "Family Documents", colour: NAVY },
];

/* ───────────────────────── Types ───────────────────────── */

type TaskRow = { id: string; description: string; status: string; due_date: string | null; assigned_to: string | null; assigned_to_email: string | null; assigned_by: string | null; project: string | null; priority: string | null; updated_at: string | null };
type AuditEntry = { id: string; action: string; table_name: string; details: string | null; created_at: string };
type MeetingRow = { id: string; title: string; meeting_date: string };
type WorkloadEntry = { name: string; count: number };
type AttentionItem = { label: string; detail: string; href: string };

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
type SizeTotals = { s31: number; s36: number; s45: number; meter: number };

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
  description: string;
  project: string | null;
  priority: string | null;
  due_date: string | null;
  assigned_to: string | null;
  assigned_by: string | null;
  assigned_date: string | null;
  status: string;
  task_type: string | null;
  reply_required: boolean | null;
  reply_text: string | null;
  assigned_to_department: string | null;
  assigned_to_business_unit: string | null;
  created_at: string | null;
  updated_at: string | null;
  source_type: string | null;
  source_record_id: string | null;
  source_label: string | null;
  exception_type: string | null;
  explanation_required: boolean | null;
};

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

type DepartmentOwner = {
  department_name: string;
  primary_owner_name: string | null;
  primary_owner_email: string | null;
};

type PlantExecutiveSummary = {
  plant: Plant;
  closingGoodStock: SizeTotals;
  closingBrokenStock: SizeTotals;
  producedOnDate: SizeTotals;
  dispatchedOnDate: SizeTotals;
  brokenOnDate: SizeTotals;
  enteredOnDate: boolean;
};

type Escalation = {
  plantId: string;
  plantName: string;
  metric: "Production" | "Dispatch" | "Breakage";
  detail: string;
  sourceLabel: string;
};

type GuaranteeAlertItem = {
  id: string;
  customer_name: string;
  guarantee_number: string;
  bank_name: string;
  guarantee_type: string;
  amount: number;
  due_date: string | null;
  days_overdue?: number;
  days_left?: number;
};

type PerformanceRow = {
  name: string;
  red: number;
  amber: number;
  green: number;
  total: number;
};

type OpeningBalance = {
  id: string;
  as_of_date: string;
  opening_amount: number;
  currency: string;
};

type MonthlyPlan = {
  id: string;
  plan_month: string;
  tentative_receivables: number;
  tentative_payouts: number;
};

type DailyPosition = {
  id: string;
  position_date: string;
  opening_balance: number;
  total_receipts: number;
  total_payments: number;
  closing_balance: number;
  post_dated_total: number;
  closing_after_post_dated: number;
};

type ReceivableStage = {
  id: string;
  stage_order: number;
  stage_name: string;
  working_day_budget: number;
};

type Receivable = {
  id: string;
  utility: string;
  plant_id: string;
  invoice_ref: string | null;
  amount: number;
  currency: string;
  date_submitted: string;
  current_stage_order: number;
  current_stage_entered_date: string;
  status: string;
};

type ReceivableCustomerRow = {
  customer: string;
  greenAmount: number;
  amberAmount: number;
  redAmount: number;
  totalAmount: number;
  redCount: number;
};

type BudgetRow = {
  category: string;
  flow_type: string;
  budgeted_amount: number;
  budget_month?: string;
};

type DeptBudgetRow = { department: string; category: string; budgeted_amount: number; actual_amount: number };

type PdcWeek = { week_number: number; week_start: string; week_end: string; pdc_due: number; effective_balance: number };

type CompanyFinanceData = {
  companyId: string;
  companyName: string;
  cashOpening: OpeningBalance | null;
  cashPlan: MonthlyPlan | null;
  cashPositions: DailyPosition[];
  pdcOutlook: PdcWeek[];
  lastYearReceipts: number | null;
  lastYearPayments: number | null;
  forecast: BudgetRow[];
  deptBudgets: DeptBudgetRow[];
};

type InvestmentSummary = {
  totalCost: number;
  totalValue: number;
  gainLoss: number;
  gainLossPct: number;
  stockCount: number;
  losers: { ticker: string; company: string; pct: number }[];
  priceDate: string | null;
  dividendCount: number;
};

type DailyOpsPoint = { date: string; produced: number; dispatched: number; broken: number };

const STATUS_DOT: Record<string, string> = {
  "In Progress": COLOURS.AMBER,
  "Waiting Reply": COLOURS.RED,
  "Not Started": COLOURS.SLATE,
  "Approved": COLOURS.GREEN,
  "To do": COLOURS.SLATE,
  "Blocked": COLOURS.RED,
};

const todayStr = new Date().toISOString().slice(0, 10);

function isOverdueRow(t: TaskRow) {
  if (t.status === "Completed" || t.status === "Cancelled") return false;
  return !!t.due_date && t.due_date < todayStr;
}

function daysOverdue(t: TaskRow): number {
  if (!t.due_date || !isOverdueRow(t)) return 0;
  return Math.floor((Date.now() - new Date(t.due_date + "T00:00:00").getTime()) / 86400000);
}

function daysUntil(dateStr: string): number {
  return Math.floor((new Date(dateStr + "T00:00:00").getTime() - Date.now()) / 86400000);
}

/* ───────────────────────── Executive helpers ───────────────────────── */

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function getMonthFromDate(dateString: string) {
  return dateString.slice(0, 7);
}

function getMonthStartFromDate(dateString: string) {
  return `${dateString.slice(0, 7)}-01`;
}

function getMonthEndFromDate(dateString: string) {
  const [year, month] = dateString.slice(0, 7).split("-").map(Number);
  const d = new Date(year, month, 0);
  return d.toISOString().slice(0, 10);
}

function getMonthQuarter(dateString: string): 1 | 2 | 3 | 4 {
  const day = Number(dateString.slice(8, 10));
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  return 4;
}

function quarterEndDate(monthStart: string, quarter: 1 | 2 | 3 | 4) {
  const [year, month] = monthStart.slice(0, 7).split("-").map(Number);
  if (quarter === 1) return `${monthStart.slice(0, 7)}-07`;
  if (quarter === 2) return `${monthStart.slice(0, 7)}-14`;
  if (quarter === 3) return `${monthStart.slice(0, 7)}-21`;
  const lastDay = new Date(year, month, 0).getDate();
  return `${monthStart.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
}

function fmtMoney(n: number) {
  return n.toLocaleString();
}

function workingDaysSince(dateStr: string): number {
  const start = new Date(dateStr + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (start > now) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur <= now) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(0, count - 1);
}

const today = formatDate(new Date());

function getThirtyDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return formatDate(d);
}

function getCurrentMonthStart() {
  const d = new Date();
  d.setDate(1);
  return formatDate(d);
}

function dueIn48Hours() {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  return d.toISOString().slice(0, 10);
}

const minDate = getThirtyDaysAgo();
const currentMonthStart = getCurrentMonthStart();

function emptyTotals(): SizeTotals {
  return { s31: 0, s36: 0, s45: 0, meter: 0 };
}

function total(t: SizeTotals) {
  return t.s31 + t.s36 + t.s45 + t.meter;
}

function targetTotal(t?: MonthlyTarget) {
  if (!t) return 0;
  return (t.target_31 || 0) + (t.target_36 || 0) + (t.target_45 || 0) + (t.target_meter || 0);
}

function isCompletedTask(task: Task) {
  return task.status === "Completed";
}

function isOverdueTask(task: Task) {
  if (isCompletedTask(task)) return false;
  if (!task.due_date) return false;
  return task.due_date < today;
}

function isDueThisWeekTask(task: Task) {
  if (isCompletedTask(task)) return false;
  if (!task.due_date) return false;
  const sevenDaysFromNow = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return formatDate(d); })();
  return task.due_date >= today && task.due_date <= sevenDaysFromNow;
}

function taskColor(task: Task): "red" | "amber" | "green" {
  if (isCompletedTask(task)) return "green";
  if (isOverdueTask(task)) return "red";
  return "amber";
}

function buildPerformanceRows(tasks: Task[], groupBy: "department" | "person"): PerformanceRow[] {
  const map = new Map<string, PerformanceRow>();
  for (const task of tasks) {
    const key =
      groupBy === "department"
        ? task.assigned_to_department || "Unassigned Department"
        : task.assigned_to || "Unassigned Person";
    if (!map.has(key)) {
      map.set(key, { name: key, red: 0, amber: 0, green: 0, total: 0 });
    }
    const row = map.get(key)!;
    const color = taskColor(task);
    row[color] += 1;
    row.total += 1;
  }
  return Array.from(map.values()).sort((a, b) => {
    if (b.red !== a.red) return b.red - a.red;
    if (b.amber !== a.amber) return b.amber - a.amber;
    return a.name.localeCompare(b.name);
  });
}

/* ───────────────────────── Main Page ───────────────────────── */

export default function HomePage() {
  const router = useRouter();
  const isMobile = useMobile();
  const { ctx, loading: ctxLoading } = useUserCtx();
  const [loading, setLoading] = useState(true);
  const isExec = !!ctx && canViewExecutiveDashboard(ctx);

  useEffect(() => {
    if (!ctxLoading && ctx && isPA(ctx)) {
      router.replace("/pa");
    }
  }, [ctxLoading, ctx, router]);

  /* ── Member-view state ── */
  const [kpis, setKpis] = useState({ tasksDueToday: 0, activeTasks: 0, machinesDown: 0, openTasks: 0 });
  const [todayTasks, setTodayTasks] = useState<TaskRow[]>([]);
  const [completedToday, setCompletedToday] = useState(0);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [workload, setWorkload] = useState<WorkloadEntry[]>([]);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [recentActivity, setRecentActivity] = useState<AuditEntry[]>([]);

  const [myOpenTasks, setMyOpenTasks] = useState<TaskRow[]>([]);
  const [myOverdueTasks, setMyOverdueTasks] = useState<TaskRow[]>([]);
  const [myDueThisWeek, setMyDueThisWeek] = useState<TaskRow[]>([]);
  const [assignedByMe, setAssignedByMe] = useState<TaskRow[]>([]);
  const [myCompletedMonth, setMyCompletedMonth] = useState(0);
  const [userName, setUserName] = useState("");

  const [briefing, setBriefing] = useState<{ cashTotal: number | null; prodPct: number | null; stuckBills: number; cashDate: string | null }>({ cashTotal: null, prodPct: null, stuckBills: 0, cashDate: null });
  const [sparklines, setSparklines] = useState<{ dueByDay: number[]; completedByDay: number[] }>({ dueByDay: [], completedByDay: [] });
  const [toast, setToast] = useState<string | null>(null);

  type ManagerBriefingItem = { label: string; value: string; rag: "GREEN" | "AMBER" | "RED" };
  const [managerBriefing, setManagerBriefing] = useState<ManagerBriefingItem[]>([]);
  const [managerBriefingTitle, setManagerBriefingTitle] = useState("");
  const [cronHealth, setCronHealth] = useState<{ name: string; hoursAgo: number | null; status: string }[]>([]);
  const [briefingOpen, setBriefingOpen] = useState(false);

  async function quickAction(taskId: string, action: "complete" | "chase", task: TaskRow) {
    if (action === "complete") {
      await supabase.from("tasks").update({ status: "Completed" }).eq("id", taskId);
      logAction("Updated", "tasks", `Completed: ${task.description}`);
      setAssignedByMe((prev) => prev.filter((t) => t.id !== taskId));
      setToast("Task marked complete");
    } else if (action === "chase" && task.assigned_to_email) {
      await authFetch("/api/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "task_chase", taskId, recipientEmail: task.assigned_to_email }),
      });
      setToast(`Chase sent to ${task.assigned_to}`);
    }
    setTimeout(() => setToast(null), 3000);
  }

  /* ── Executive-view state ── */
  const [selectedDate, setSelectedDate] = useState(today);
  const [summaries, setSummaries] = useState<PlantExecutiveSummary[]>([]);
  const [machineIssues, setMachineIssues] = useState<MachineIssue[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  // Stuck receivables are deliberately an alert, not a task — see
  // TASK_NOTIFICATION_AUDIT.md. The department already watches its own
  // receivables page; this just surfaces the same exception on the
  // executive "Needs Your Attention" banner without creating a task.
  const [stuckReceivables, setStuckReceivables] = useState<{ key: string; primary: string; secondary: string }[]>([]);
  const [execLoading, setExecLoading] = useState(true);
  // Khuram (17/07/2026): "every refresh or fetching data it should update
  // the date and time, so we know when was fetched to measure accuracy."
  // Set from the real fetch time on a fresh load, or from the cache
  // entry's own timestamp on a cache-hit (so it reflects when the data
  // actually came from the database, not just when this render happened).
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [companyFinance, setCompanyFinance] = useState<CompanyFinanceData[]>([]);
  const [receivableRows, setReceivableRows] = useState<ReceivableCustomerRow[]>([]);
  const [recAgingTotals, setRecAgingTotals] = useState<{ "0-30": number; "31-60": number; "61-90": number; "90+": number }>({ "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 });
  const [recAgingByCustomer, setRecAgingByCustomer] = useState<{ customer: string; "0-30": number; "31-60": number; "61-90": number; "90+": number; total: number }[]>([]);
  const [showFinance, setShowFinance] = useState(false);
  const [facilitySynopsis, setFacilitySynopsis] = useState<{ bank_name: string; bank_total_limit: number; bank_seized: number; bank_available: number; bank_utilisation_pct: number; active_guarantees: number; overdue_count: number }[]>([]);
  const [guaranteeAlerts, setGuaranteeAlerts] = useState<GuaranteeAlertItem[]>([]);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [actioningTask, setActioningTask] = useState<string | null>(null);

  async function quickTaskAction(taskId: string, newStatus: string) {
    setActioningTask(taskId);
    await supabase.from("tasks").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", taskId);
    await loadExecutiveData(selectedDate);
    setActioningTask(null);
  }

  async function quickMachineResolve(issueId: string) {
    setActioningTask(issueId);
    await supabase.from("machine_issues").update({ issue_status: "Resolved" }).eq("id", issueId);
    await loadExecutiveData(selectedDate);
    setActioningTask(null);
  }

  const [deptHealth, setDeptHealth] = useState<{ slug: string; title: string; status: "GREEN" | "AMBER" | "RED"; owner: string; detail: string }[]>([]);
  const [investmentData, setInvestmentData] = useState<InvestmentSummary | null>(null);
  const [pensionSummary, setPensionSummary] = useState<{ gbp: number; pkr: number; netGain: number; totalReturn: number; contributed: number; feesPaid: number } | null>(null);
  const [folderitSummary, setFolderitSummary] = useState<{ pendingApproval: number; companyInbox: number; hrInbox: number } | null>(null);
  const [folderitCompanyBreakdown, setFolderitCompanyBreakdown] = useState<{ group_key: string; inbox_count: number; inbox_oldest_days: number | null }[]>([]);
  const [dailyOpsData, setDailyOpsData] = useState<DailyOpsPoint[]>([]);
  const [taxOverdueCount, setTaxOverdueCount] = useState(0);
  const [taxTier2Alerts, setTaxTier2Alerts] = useState<{ alert_type: string; period_key: string; overdue_count: number; alert_message: string; tax_year: string }[]>([]);
  const [taxScheduleEntries, setTaxScheduleEntries] = useState<Map<string, "Not Started" | "In Progress" | "External Auditors" | "Completed">>(new Map());
  const [taxReturnFilings, setTaxReturnFilings] = useState<Map<string, boolean>>(new Map());
  const [taxSummaryYear, setTaxSummaryYear] = useState("");
  const [taxScheduleEntries2, setTaxScheduleEntries2] = useState<Map<string, "Not Started" | "In Progress" | "External Auditors" | "Completed">>(new Map());
  const [taxReturnFilings2, setTaxReturnFilings2] = useState<Map<string, boolean>>(new Map());
  const [taxSummaryYear2, setTaxSummaryYear2] = useState("");
  const [taxSignoffs, setTaxSignoffs] = useState<Map<string, boolean>>(new Map());
  const [taxSignoffs2, setTaxSignoffs2] = useState<Map<string, boolean>>(new Map());

  // KPI escalations (production/dispatch/breakage lagging) and stuck
  // receivables were previously auto-created as "Explanation Required"
  // tasks here. Per Khuram's review (14/07/2026, see
  // TASK_NOTIFICATION_AUDIT.md), both are reclassified as alerts, not
  // tasks: the underlying exception is already visible on the department's
  // own pages, and the "Escalations" / "Stuck Receivables" rows on this
  // dashboard's attention banner already surface it without needing a
  // tracked, emailed task. See the loops below (foundEscalations /
  // foundStuckReceivables) — detection logic stayed, task-creation didn't.
  //
  // Cash escalation is the one exception Khuram asked to keep as a task
  // (a specific written explanation from Finance is wanted, tracked to
  // completion) — it now routes through the shared /api/tasks/create
  // gate instead of inserting directly, so it gets a company tag and an
  // actual notification email (previously silent).
  async function autoCreateCashEscalationTask(
    exceptionType: "cash_receivables" | "cash_payouts",
    detail: string,
    companyId: string,
    financeOwner: DepartmentOwner | null
  ) {
    if (!financeOwner?.primary_owner_name || !financeOwner?.primary_owner_email) return;
    const month = formatDate(new Date()).slice(0, 7);
    const sourceLabel = `kpi_escalation:${exceptionType}:${month}`;
    try {
      await authFetch("/api/tasks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskType: "Explanation Required",
          exceptionType,
          explanationRequired: true,
          description: detail,
          companyId,
          project: "Unze Trading Ops",
          priority: "High",
          status: "Waiting Reply",
          dueDate: workingDaysFromNow(3),
          assignedTo: financeOwner.primary_owner_name,
          assignedToEmail: financeOwner.primary_owner_email,
          assignedToDepartment: "Finance",
          notes: `Auto-created by the executive cash escalation engine. ${detail}`,
          replyRequired: true,
          sourceType: "kpi_escalation",
          sourceLabel,
          notificationStyle: "escalation",
          systemActor: "System",
        }),
      });
    } catch (e) {
      console.error("Failed to create cash escalation task", e);
    }
  }

  async function loadExecutiveData(dateToView: string) {
    setExecLoading(true);

    const cacheKey = `exec_home_${dateToView}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        const { ts, payload } = JSON.parse(cached);
        if (Date.now() - ts < 2 * 60 * 1000 && payload.investmentData) {
          setSummaries(payload.summaries);
          setMachineIssues(payload.machineIssues);
          setTasks(payload.tasks);
          setEscalations(payload.escalations);
          setStuckReceivables(payload.stuckReceivables || []);
          setCompanyFinance(payload.companyFinance);
          setReceivableRows(payload.receivableRows);
          setRecAgingTotals(payload.recAgingTotals);
          setRecAgingByCustomer(payload.recAgingByCustomer);
          setShowFinance(payload.showFinance);
          setDeptHealth(payload.deptHealth);
          setInvestmentData(payload.investmentData);
          setDailyOpsData(payload.dailyOpsData);
          if (payload.pensionSummary) setPensionSummary(payload.pensionSummary);
          if (payload.folderitSummary) setFolderitSummary(payload.folderitSummary);
          if (payload.folderitCompanyBreakdown) setFolderitCompanyBreakdown(payload.folderitCompanyBreakdown);
          if (payload.taxSummaryYear) {
            setTaxScheduleEntries(new Map(payload.taxScheduleEntries));
            setTaxReturnFilings(new Map(payload.taxReturnFilings));
            setTaxSummaryYear(payload.taxSummaryYear);
            setTaxSignoffs(new Map(payload.taxSignoffs ?? []));
            setTaxScheduleEntries2(new Map(payload.taxScheduleEntries2));
            setTaxReturnFilings2(new Map(payload.taxReturnFilings2));
            setTaxSummaryYear2(payload.taxSummaryYear2 ?? "");
            setTaxSignoffs2(new Map(payload.taxSignoffs2 ?? []));
          }
          setLastUpdated(new Date(ts));
          setExecLoading(false);
          return;
        }
      } catch {
        sessionStorage.removeItem(cacheKey);
      }
    }

    const { data: { user } } = await supabase.auth.getUser();
    let showFinanceForUser = false;
    let scopeForUser: "both" | "UTPL" | "IFPL" | "none" = "none";
    if (user?.email) {
      const { data: memberData } = await supabase
        .from("members")
        .select("id, role, first_name, name, department, company")
        .eq("email", user.email)
        .maybeSingle();
      if (memberData) {
        let overrides: PermOverrides | null = null;
        const p = await loadMyPermissions();
        if (p) overrides = p as PermOverrides;
        const userCtx: UserCtx = { email: user.email, role: memberData.role, department: memberData.department, company: memberData.company, overrides };
        showFinanceForUser = canViewFinance(userCtx);
        setShowFinance(showFinanceForUser);
        scopeForUser = financeCompanies(userCtx);
      }
    }

    const selectedMonth = getMonthFromDate(dateToView);
    const selectedMonthStart = getMonthStartFromDate(dateToView);
    const selectedMonthEnd = getMonthEndFromDate(dateToView);
    // 90-day window anchored to the selected date, not today — so historical date views
    // always fetch a full window of context around the chosen date.
    const ninetyDaysAgo = new Date(new Date(dateToView).getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const ENTRY_COLS = "plant_id, entry_date, qty_31, qty_36, qty_45, qty_meter";
    const [
      plantKpisRes, machineIssuesRes, tasksRes, ownerRes,
      monthlyProductionTargetsRes, monthlyDispatchTargetsRes,
      monthlyProductionRes, monthlyDispatchRes, monthlyBreakageRes,
    ] = await Promise.all([
      // Single RPC replaces 7 raw table fetches (opening_balances, broken_opening_balances,
      // production_entries x2, dispatch_entries x2, breakage_entries x2, scrap_processed_entries)
      supabase.rpc("get_plant_kpis", {
        as_of_date: dateToView,
        month_start: selectedMonthStart,
        month_end: selectedMonthEnd,
      }),
      supabase.from("machine_issues").select("id, plant_name, machine_name, issue_status, expected_resolution, issue_description, action_taken, created_at").neq("issue_status", "Resolved").order("created_at", { ascending: false }),
      // Found during the 15 Jul 2026 full-app audit: this used to be
      // `.order("created_at", {ascending:false}).limit(200)` — on an
      // exception/management-by-exception dashboard, a plain "most
      // recently created" cap silently drops the OLDEST, most-neglected
      // open tasks first (exactly the ones this page exists to surface)
      // once the table passes 200 rows. Fetches every task that still
      // needs attention (not Completed/Cancelled), regardless of age,
      // plus Completed tasks from the current month only (all that's
      // needed for the completedThisMonth stat below) — no arbitrary cap.
      supabase.from("tasks").select("id, description, project, priority, due_date, assigned_to, assigned_by, assigned_date, status, task_type, reply_required, reply_text, assigned_to_department, assigned_to_business_unit, created_at, updated_at, source_type, source_record_id, source_label, exception_type, explanation_required").or(`status.not.in.(Completed,Cancelled),and(status.eq.Completed,updated_at.gte.${currentMonthStart})`).order("created_at", { ascending: false }),
      supabase.from("department_owners").select("department_name, primary_owner_name, primary_owner_email").eq("department_name", "Unze Trading Ops").single(),
      supabase.from("monthly_production_targets").select("id, plant_id, plant_name, target_month, target_31, target_36, target_45, target_meter").eq("target_month", selectedMonth),
      supabase.from("monthly_dispatch_targets").select("id, plant_id, plant_name, target_month, target_31, target_36, target_45, target_meter").eq("target_month", selectedMonth),
      // Monthly entries kept for the daily ops chart (per-day breakdown needed)
      supabase.from("production_entries").select(ENTRY_COLS).gte("entry_date", selectedMonthStart).lte("entry_date", selectedMonthEnd),
      supabase.from("dispatch_entries").select(ENTRY_COLS).gte("entry_date", selectedMonthStart).lte("entry_date", selectedMonthEnd),
      supabase.from("breakage_entries").select(ENTRY_COLS).gte("entry_date", selectedMonthStart).lte("entry_date", selectedMonthEnd),
    ]);

    const plantKpis = (plantKpisRes.data || []) as PlantKpiRow[];
    // Reconstruct a plants array from the RPC result (same shape as before)
    const plants: Plant[] = plantKpis.map((r) => ({ id: r.plant_id, name: r.plant_name, type: r.plant_type }));
    const activeMachineIssues = machineIssuesRes.data || [];
    const taskData: Task[] = tasksRes.data || [];
    const owner: DepartmentOwner | null = ownerRes.data || null;
    void owner; // no longer used to create tasks (KPI/receivable escalations are alert-only now) — kept for a possible future alert-owner display
    const monthlyProductionTargets: MonthlyTarget[] = monthlyProductionTargetsRes.data || [];
    const monthlyDispatchTargets: MonthlyTarget[] = monthlyDispatchTargetsRes.data || [];
    const monthlyProduction = monthlyProductionRes.data || [];
    const monthlyDispatch = monthlyDispatchRes.data || [];
    const monthlyBreakage = monthlyBreakageRes.data || [];

    setMachineIssues(activeMachineIssues);
    setTasks(taskData);

    const currentMonthForCash = dateToView.slice(0, 7);
    const nowForHist = new Date(dateToView);
    const lastYearMonth = `${nowForHist.getFullYear() - 1}-${String(nowForHist.getMonth() + 1).padStart(2, "0")}`;

    const allCompanyFinance: CompanyFinanceData[] = [];
    // Scoped to whichever compan(ies) this viewer is allowed to see — see
    // financeCompanies() in lib/permissions.ts. A "both"-scope CEO gets
    // UTPL + IFPL; someone matrix-scoped to one company (e.g. Kamran →
    // IFPL) only ever fetches/sees that one, so Company Comparison and the
    // multi-company sections below naturally reduce to a single company
    // instead of needing a separate dashboard page per person.
    const FINANCE_COMPANIES = ALL_FINANCE_COMPANIES.filter(c => {
      if (scopeForUser === "both") return true;
      if (scopeForUser === "UTPL") return c.shortCode === "UTPL";
      if (scopeForUser === "IFPL") return c.shortCode === "IFPL";
      return false;
    });
    for (const company of FINANCE_COMPANIES) {
      const [cashOpenRes, cashPlanRes, cashPosRes, pdcRes, lyRes, forecastRes, deptBudgetRes] = await Promise.all([
        supabase.from("cash_opening_balance").select("id, as_of_date, opening_amount, currency").eq("company_id", company.id).order("as_of_date", { ascending: true }).limit(1),
        supabase.from("monthly_cash_plan").select("id, plan_month, tentative_receivables, tentative_payouts").eq("company_id", company.id).eq("plan_month", currentMonthForCash).maybeSingle(),
        // Rolling last 30 calendar days ending at dateToView (not real "today" —
        // this page can view a past date), and not a row-count limit — see
        // FinanceManager.tsx for why (gaps in the data used to make a plain
        // .limit(30) reach back well past a month).
        supabase.from("daily_cash_position").select("id, position_date, opening_balance, total_receipts, total_payments, closing_balance, post_dated_total, closing_after_post_dated").eq("company_id", company.id).lte("position_date", dateToView).gte("position_date", new Date(new Date(dateToView).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)).order("position_date", { ascending: false }),
        supabase.rpc("get_pdc_outlook", { p_company_id: company.id, p_today: dateToView }),
        supabase.rpc("get_company_cash_yearly_comparison", { p_company_id: company.id, p_month: currentMonthForCash }),
        supabase.from("monthly_budgets").select("category, flow_type, budgeted_amount, budget_month").eq("company_id", company.id).gte("budget_month", currentMonthForCash).order("budget_month", { ascending: true }),
        supabase.from("department_budgets").select("department, category, budgeted_amount, actual_amount").eq("company_id", company.id).eq("budget_month", currentMonthForCash),
      ]);

      const lyRow = (lyRes.data as { last_year_receipts: number; last_year_payments: number }[] | null)?.[0];
      const lyReceipts: number | null = lyRow ? Number(lyRow.last_year_receipts) : null;
      const lyPayments: number | null = lyRow ? Number(lyRow.last_year_payments) : null;

      allCompanyFinance.push({
        companyId: company.id,
        companyName: company.name,
        cashOpening: cashOpenRes.data && cashOpenRes.data.length > 0 ? cashOpenRes.data[0] : null,
        cashPlan: cashPlanRes.data || null,
        cashPositions: cashPosRes.data || [],
        pdcOutlook: (pdcRes.data || []) as PdcWeek[],
        lastYearReceipts: lyReceipts,
        lastYearPayments: lyPayments,
        forecast: (() => {
          const all = (forecastRes.data || []) as BudgetRow[];
          if (all.length === 0) return [];
          const firstMonth = all[0].budget_month;
          return all.filter((r) => r.budget_month === firstMonth);
        })(),
        deptBudgets: (deptBudgetRes.data || []) as DeptBudgetRow[],
      });
    }
    setCompanyFinance(allCompanyFinance);

    // Three RPCs replace two full-table fetches + three JS aggregation loops.
    // A slim bills fetch is kept only for the escalation engine (needs per-bill id/utility/amount).
    const [stagesRes, billsRes, ragRes, agingTotalsRes, agingByCustRes] = await Promise.all([
      supabase.from("receivable_stages").select("stage_order, stage_name, working_day_budget").order("stage_order"),
      supabase.from("receivables").select("id, utility, amount, currency, current_stage_order, current_stage_entered_date").neq("status", "Collected"),
      supabase.rpc("get_receivable_rag_by_customer"),
      supabase.rpc("get_receivable_aging_totals"),
      supabase.rpc("get_receivable_aging_by_customer"),
    ]);
    const recStages: ReceivableStage[] = (stagesRes.data || []) as ReceivableStage[];
    const bills: Receivable[] = (billsRes.data || []) as Receivable[];

    function stageBudget(order: number) {
      return recStages.find((s) => s.stage_order === order)?.working_day_budget || 0;
    }
    function stageNameFor(order: number) {
      return recStages.find((s) => s.stage_order === order)?.stage_name || `Stage ${order}`;
    }
    function billRagStatus(bill: Receivable): "green" | "amber" | "red" {
      const budget = stageBudget(bill.current_stage_order);
      const elapsed = workingDaysSince(bill.current_stage_entered_date);
      if (budget <= 0) return "green";
      if (elapsed >= budget) return "red";
      if (elapsed >= budget - 1) return "amber";
      return "green";
    }

    // RAG by customer — from RPC, already sorted by red_amount desc
    const recRows: ReceivableCustomerRow[] = (ragRes.data || []).map((r: { customer: string; green_amount: number; amber_amount: number; red_amount: number; total_amount: number; red_count: number }) => ({
      customer: r.customer,
      greenAmount: Number(r.green_amount) || 0,
      amberAmount: Number(r.amber_amount) || 0,
      redAmount:   Number(r.red_amount)   || 0,
      totalAmount: Number(r.total_amount) || 0,
      redCount:    Number(r.red_count)    || 0,
    }));
    setReceivableRows(recRows);

    // Aging totals — from RPC, map bucket labels to the expected shape
    const aging = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 } as { "0-30": number; "31-60": number; "61-90": number; "90+": number };
    for (const r of (agingTotalsRes.data || []) as { bucket: string; total: number }[]) {
      if (r.bucket in aging) (aging as Record<string, number>)[r.bucket] = Number(r.total) || 0;
    }
    setRecAgingTotals(aging);

    // Aging by customer — from RPC, map column names to the expected shape
    const recAgingByCust = (agingByCustRes.data || []).map((r: { customer: string; b0_30: number; b31_60: number; b61_90: number; b90_plus: number; total: number }) => ({
      customer:  r.customer,
      "0-30":    Number(r.b0_30)    || 0,
      "31-60":   Number(r.b31_60)   || 0,
      "61-90":   Number(r.b61_90)   || 0,
      "90+":     Number(r.b90_plus) || 0,
      total:     Number(r.total)    || 0,
    }));
    setRecAgingByCustomer(recAgingByCust);

    // Stuck receivables — alert only, not a task (see note above the
    // auto-create functions). Still needs per-bill data, but slim fetch
    // above covers it.
    const foundStuckReceivables: { key: string; primary: string; secondary: string }[] = [];
    for (const bill of bills) {
      if (billRagStatus(bill) === "red") {
        const stageName = stageNameFor(bill.current_stage_order);
        foundStuckReceivables.push({
          key: `receivable_stuck:${bill.id}:${bill.current_stage_order}`,
          primary: `${bill.utility} — ${fmtMoney(bill.amount)} ${bill.currency}`,
          secondary: `Stuck at stage "${stageName}"`,
        });
      }
    }

    // Build plant summaries directly from RPC rows — no JS loops over raw entries needed.
    const result: PlantExecutiveSummary[] = plantKpis.map((r) => {
      const closingGoodStock: SizeTotals = {
        s31:   r.opening_good_31   + r.produced_31   - r.broken_31   - r.dispatched_31,
        s36:   r.opening_good_36   + r.produced_36   - r.broken_36   - r.dispatched_36,
        s45:   r.opening_good_45   + r.produced_45   - r.broken_45   - r.dispatched_45,
        meter: r.opening_good_meter + r.produced_meter - r.dispatched_meter,
      };
      const closingBrokenStock: SizeTotals = {
        s31:   r.opening_broken_31 + r.broken_31 - r.scrap_31,
        s36:   r.opening_broken_36 + r.broken_36 - r.scrap_36,
        s45:   r.opening_broken_45 + r.broken_45 - r.scrap_45,
        meter: 0,
      };
      return {
        plant: { id: r.plant_id, name: r.plant_name, type: r.plant_type },
        closingGoodStock,
        closingBrokenStock,
        producedOnDate:   { s31: r.on_date_produced_31,   s36: r.on_date_produced_36,   s45: r.on_date_produced_45,   meter: r.on_date_produced_meter },
        dispatchedOnDate: { s31: r.on_date_dispatched_31, s36: r.on_date_dispatched_36, s45: r.on_date_dispatched_45, meter: r.on_date_dispatched_meter },
        brokenOnDate:     { s31: r.on_date_broken_31,     s36: r.on_date_broken_36,     s45: r.on_date_broken_45,     meter: 0 },
        enteredOnDate: r.entered_on_date,
      };
    });

    // sumBetween still needed for quarterly escalation checks (uses monthlyProduction/Dispatch)
    function sumBetween(rows: any[], plantId: string, fromDate: string, toDate: string): number {
      let t = 0;
      for (const r of rows) {
        if (r.plant_id !== plantId) continue;
        if (r.entry_date < fromDate || r.entry_date > toDate) continue;
        t += (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0) + (r.qty_meter || 0);
      }
      return t;
    }

    const currentQuarter = getMonthQuarter(dateToView);
    const q1End = quarterEndDate(selectedMonthStart, 1);
    const q2End = quarterEndDate(selectedMonthStart, 2);
    const foundEscalations: Escalation[] = [];

    function behindAtQuarter(entries: any[], targetTotalForMonth: number, plantId: string, quarter: 1 | 2 | 3 | 4, checkpointEnd: string): boolean {
      if (targetTotalForMonth <= 0) return false;
      const cumulativeTarget = (targetTotalForMonth / 4) * quarter;
      const cumulativeActual = sumBetween(entries, plantId, selectedMonthStart, checkpointEnd);
      const achievement = cumulativeTarget > 0 ? (cumulativeActual / cumulativeTarget) * 100 : 0;
      // Shared with DashboardView.tsx's per-plant status badges (lib/kpiThresholds.ts) so the
      // two screens can never disagree about what counts as "behind" (15 Jul 2026 audit fix).
      return achievementStatus(achievement, cumulativeTarget > 0) === "red";
    }

    for (const plant of plants) {
      const prodTarget = targetTotal(monthlyProductionTargets.find((t) => t.plant_id === plant.id));
      if (prodTarget > 0 && currentQuarter >= 3) {
        const behindQ1 = behindAtQuarter(monthlyProduction, prodTarget, plant.id, 1, q1End);
        const behindQ2 = behindAtQuarter(monthlyProduction, prodTarget, plant.id, 2, q2End);
        if (behindQ1 && behindQ2) {
          const cumActual = sumBetween(monthlyProduction, plant.id, selectedMonthStart, dateToView);
          const cumTargetNow = (prodTarget / 4) * currentQuarter;
          const ach = cumTargetNow > 0 ? Math.round((cumActual / cumTargetNow) * 100) : 0;
          foundEscalations.push({
            plantId: plant.id, plantName: plant.name, metric: "Production",
            detail: `Behind in Q1 and Q2. Now Q${currentQuarter}: ${cumActual} of ${Math.round(cumTargetNow)} expected (${ach}%).`,
            sourceLabel: `kpi_escalation:production:${plant.id}:${selectedMonth}`,
          });
        }
      }
      const dispTarget = targetTotal(monthlyDispatchTargets.find((t) => t.plant_id === plant.id));
      if (dispTarget > 0 && currentQuarter >= 3) {
        const behindQ1 = behindAtQuarter(monthlyDispatch, dispTarget, plant.id, 1, q1End);
        const behindQ2 = behindAtQuarter(monthlyDispatch, dispTarget, plant.id, 2, q2End);
        if (behindQ1 && behindQ2) {
          const cumActual = sumBetween(monthlyDispatch, plant.id, selectedMonthStart, dateToView);
          const cumTargetNow = (dispTarget / 4) * currentQuarter;
          const ach = cumTargetNow > 0 ? Math.round((cumActual / cumTargetNow) * 100) : 0;
          foundEscalations.push({
            plantId: plant.id, plantName: plant.name, metric: "Dispatch",
            detail: `Behind in Q1 and Q2. Now Q${currentQuarter}: ${cumActual} of ${Math.round(cumTargetNow)} expected (${ach}%).`,
            sourceLabel: `kpi_escalation:dispatch:${plant.id}:${selectedMonth}`,
          });
        }
      }
      const kpiRow = plantKpis.find((k) => k.plant_id === plant.id);
      const producedMTD = kpiRow?.mtd_produced ?? sumBetween(monthlyProduction, plant.id, selectedMonthStart, dateToView);
      const brokenMTD = kpiRow?.mtd_broken ?? sumBetween(monthlyBreakage, plant.id, selectedMonthStart, dateToView);
      if (producedMTD > 0) {
        const rate = (brokenMTD / producedMTD) * 100;
        // Shared with DashboardView.tsx's per-plant breakage badges (lib/kpiThresholds.ts) —
        // same reasoning as behindAtQuarter above (15 Jul 2026 audit fix).
        if (breakageStatus(rate, producedMTD > 0) === "red") {
          foundEscalations.push({
            plantId: plant.id, plantName: plant.name, metric: "Breakage",
            detail: `Breakage rate ${rate.toFixed(2)}% (${brokenMTD} broken of ${producedMTD} produced) exceeds ${BREAKAGE_RED_OVER}% limit.`,
            sourceLabel: `kpi_escalation:breakage:${plant.id}:${selectedMonth}`,
          });
        }
      }
    }

    // KPI escalations (foundEscalations) are alert-only — see note above
    // the auto-create functions. No task-creation loop needed here
    // anymore; setEscalations(foundEscalations) below still feeds the
    // "Escalations" attention row exactly as before.

    const cashMonth = formatDate(new Date()).slice(0, 7);
    const financeOwnerRes = await supabase
      .from("department_owners")
      .select("department_name, primary_owner_name, primary_owner_email")
      .eq("department_name", "Finance")
      .maybeSingle();
    const financeOwner: DepartmentOwner | null = financeOwnerRes.data || null;

    for (const cfd of allCompanyFinance) {
      const monthCashPos = cfd.cashPositions.filter((p) => p.position_date.slice(0, 7) === cashMonth);
      const recMTD = monthCashPos.reduce((s, p) => s + p.total_receipts, 0);
      const payMTD = monthCashPos.reduce((s, p) => s + p.total_payments, 0);
      const pRecv = cfd.cashPlan?.tentative_receivables || 0;
      const pPay = cfd.cashPlan?.tentative_payouts || 0;
      const nowDate = new Date();
      const dim = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0).getDate();
      const de = nowDate.getDate();
      const expRecv = pRecv > 0 ? (pRecv / dim) * de : 0;
      const recvPct = expRecv > 0 ? (recMTD / expRecv) * 100 : 100;
      const expPay = pPay > 0 ? (pPay / dim) * de : 0;
      const payPct = expPay > 0 ? (payMTD / expPay) * 100 : 100;

      if (recvPct < 85) {
        await autoCreateCashEscalationTask(
          "cash_receivables",
          `${cfd.companyName}: Receivables pacing at ${Math.round(recvPct)}% — actual ${fmtMoney(recMTD)} vs expected ${fmtMoney(Math.round(expRecv))} by day ${de} of ${dim}.`,
          cfd.companyId,
          financeOwner
        );
      }
      if (payPct > 115) {
        await autoCreateCashEscalationTask(
          "cash_payouts",
          `${cfd.companyName}: Payouts pacing at ${Math.round(payPct)}% — actual ${fmtMoney(payMTD)} vs expected ${fmtMoney(Math.round(expPay))} by day ${de} of ${dim}.`,
          cfd.companyId,
          financeOwner
        );
      }
    }

    setSummaries(result);
    setEscalations(foundEscalations);
    setStuckReceivables(foundStuckReceivables);

    const opsMap = new Map<string, DailyOpsPoint>();
    for (const r of monthlyProduction) {
      const d = r.entry_date;
      if (!opsMap.has(d)) opsMap.set(d, { date: d, produced: 0, dispatched: 0, broken: 0 });
      opsMap.get(d)!.produced += (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0) + (r.qty_meter || 0);
    }
    for (const r of monthlyDispatch) {
      const d = r.entry_date;
      if (!opsMap.has(d)) opsMap.set(d, { date: d, produced: 0, dispatched: 0, broken: 0 });
      opsMap.get(d)!.dispatched += (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0) + (r.qty_meter || 0);
    }
    for (const r of monthlyBreakage) {
      const d = r.entry_date;
      if (!opsMap.has(d)) opsMap.set(d, { date: d, produced: 0, dispatched: 0, broken: 0 });
      opsMap.get(d)!.broken += (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0) + (r.qty_meter || 0);
    }
    const computedDailyOpsData = Array.from(opsMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    setDailyOpsData(computedDailyOpsData);

    // Per-department KPI counts (migration 130) — replaces fetching every department's
    // raw rows and filtering/counting them in JS. This also fixes a real bug: the old
    // fetch filtered every department's table by company_id only, so for admin/it/ops
    // (all backed by "tasks") it never filtered by assigned_to_department — Admin, IT,
    // and Ops health cards were all silently computed from the exact same unfiltered
    // set of UTPL tasks. The RPC filters tasks-backed departments by department name.
    const [deptOwnersRes, ...deptCountsResults] = await Promise.all([
      supabase.from("department_owners").select("department_name, primary_owner_name").eq("active", true),
      ...DEPARTMENT_CONFIGS.map((cfg) =>
        supabase.rpc("get_department_kpi_counts", {
          p_slug: cfg.slug,
          p_department_name: cfg.departmentName,
          p_company_id: UTPL_COMPANY_ID,
          p_today: todayStr,
        })
      ),
    ]);
    const ownerMap = new Map((deptOwnersRes.data || []).map((o: { department_name: string; primary_owner_name: string | null }) => [o.department_name, o.primary_owner_name || "—"]));

    // "Open" count shown in each card's subtitle — the KPI id(s) that best represent
    // outstanding work for that department's own status vocabulary.
    const OPEN_COUNT_KEYS: Record<string, string[]> = {
      audit: ["planned", "in_progress"],
      hr: ["open"],
      taxation: ["pending"],
      admin: ["open"],
      it: ["open"],
      ops: ["open"],
    };

    const healthResults: { slug: string; title: string; status: "GREEN" | "AMBER" | "RED"; owner: string; detail: string }[] = [];
    for (let i = 0; i < DEPARTMENT_CONFIGS.length; i++) {
      const deptConfig = DEPARTMENT_CONFIGS[i];
      const counts = (deptCountsResults[i].data || {}) as Record<string, number>;
      const status = getDepartmentHealthStatus(counts, deptConfig);
      const openCount = (OPEN_COUNT_KEYS[deptConfig.slug] || []).reduce((s, key) => s + (counts[key] || 0), 0);
      healthResults.push({
        slug: deptConfig.slug,
        title: deptConfig.title,
        status,
        owner: ownerMap.get(deptConfig.title) || "—",
        detail: `${openCount} open`,
      });
    }
    setDeptHealth(healthResults);

    // Single RPC returns totals, per-ticker rows, losers, and dividend count — no JS aggregation.
    const { data: summaryData } = await supabase.rpc("get_portfolio_summary_full", {
      p_as_of: dateToView, p_alert_pct: -3, p_div_days: 7,
    });
    const summary = summaryData as {
      totals: { total_cost: number; total_value: number; gain_loss: number; gain_loss_pct: number; stock_count: number; price_date: string | null; dividend_count: number };
      losers: { ticker: string; company_name: string; gain_loss_pct: number; gain_loss: number }[];
    } | null;
    let computedInvestmentData: InvestmentSummary | null = null;
    if (summary?.totals && summary.totals.stock_count > 0) {
      computedInvestmentData = {
        totalCost:     summary.totals.total_cost,
        totalValue:    summary.totals.total_value,
        gainLoss:      summary.totals.gain_loss,
        gainLossPct:   summary.totals.gain_loss_pct,
        stockCount:    summary.totals.stock_count,
        priceDate:     summary.totals.price_date,
        dividendCount: summary.totals.dividend_count,
        losers: (summary.losers ?? []).map((l) => ({
          ticker:  l.ticker,
          company: l.company_name,
          pct:     l.gain_loss_pct,
        })),
      };
      setInvestmentData(computedInvestmentData);
    }

    // UK Pension summary for Executive Dashboard — aggregation done in Postgres
    let computedPensionSummary: { gbp: number; pkr: number; netGain: number; totalReturn: number; contributed: number; feesPaid: number } | null = null;
    try {
      const { data: pensionData } = await supabase.rpc("get_pension_summary");
      const pensionRow = (pensionData as { total_value_gbp: number; net_gain_gbp: number; return_pct: number; contributed_gbp: number; fees_gbp: number }[] | null)?.[0];
      if (pensionRow && pensionRow.total_value_gbp > 0) {
        let pkrRate = 356;
        try {
          const fxRes = await fetch("/api/fx/gbp-pkr");
          const fxData = await fxRes.json();
          pkrRate = fxData?.rate ?? 356;
        } catch { /* non-fatal */ }
        computedPensionSummary = {
          gbp: pensionRow.total_value_gbp,
          pkr: pensionRow.total_value_gbp * pkrRate,
          netGain: pensionRow.net_gain_gbp ?? 0,
          totalReturn: pensionRow.return_pct ?? 0,
          contributed: pensionRow.contributed_gbp ?? 0,
          feesPaid: pensionRow.fees_gbp ?? 0,
        };
        setPensionSummary(computedPensionSummary);
      }
    } catch { /* non-fatal — pension card is additive */ }

    // Folderit summary for Executive Dashboard — aggregation done in Postgres
    let computedFolderitSummary: { pendingApproval: number; companyInbox: number; hrInbox: number } | null = null;
    try {
      const folderitRes = await authFetch("/api/folderit/summary");
      if (folderitRes.ok) {
        const f = await folderitRes.json();
        computedFolderitSummary = {
          pendingApproval: f.pending_approval_count ?? 0,
          companyInbox: f.company_inbox_count ?? 0,
          hrInbox: f.hr_inbox_count ?? 0,
        };
        setFolderitSummary(computedFolderitSummary);
      }
    } catch { /* non-fatal — Folderit card is additive */ }

    // Per-company "not yet filed" breakdown for the same card — Khuram:
    // "a long card just like the investment size, where you show me
    // number of approvals outstanding, company name and number of
    // documents not filed keep it brief and within one card." Admin-only
    // RPC (get_folderit_company_breakdown), safe here since this whole
    // function only runs for exec/admin users (see isExec guard below).
    let computedFolderitCompanyBreakdown: { group_key: string; inbox_count: number; inbox_oldest_days: number | null }[] = [];
    try {
      const breakdownRes = await authFetch("/api/folderit/company-breakdown");
      if (breakdownRes.ok) {
        const b = await breakdownRes.json();
        computedFolderitCompanyBreakdown = b.companies ?? [];
        setFolderitCompanyBreakdown(computedFolderitCompanyBreakdown);
      }
    } catch { /* non-fatal — Folderit card is additive */ }

    // Tax deadline alerts — read pre-computed tier 2 across all years (no client-side calculation)
    const { data: tier2AlertData } = await supabase
      .from("tax_deadline_alerts")
      .select("alert_type, period_key, overdue_count, alert_message, tax_year")
      .eq("tier", 2)
      .eq("resolved", false)
      .order("tax_year", { ascending: false });
    const tier2Alerts = tier2AlertData ?? [];
    setTaxOverdueCount(tier2Alerts.length);
    setTaxTier2Alerts(tier2Alerts);

    // Tax compliance summary — fetch both current and previous fiscal year
    const taxNow = (() => {
      const now = new Date();
      const m = now.getMonth() + 1;
      const y = now.getFullYear();
      if (m >= 7) return `${y}-${String(y + 1).slice(2)}`;
      return `${y - 1}-${String(y).slice(2)}`;
    })();
    const taxPrevYear = (() => {
      const s = parseInt(taxNow.split("-")[0], 10);
      return `${s - 1}-${String(s).slice(2)}`;
    })();

    const [{ data: schedCurr }, { data: schedPrev }, { data: filingCurr }, { data: filingPrev }, { data: signoffCurr }, { data: signoffPrev }] = await Promise.all([
      supabase.from("tax_schedule_entries").select("section, step_index, entity_key, status").eq("tax_year", taxNow),
      supabase.from("tax_schedule_entries").select("section, step_index, entity_key, status").eq("tax_year", taxPrevYear),
      supabase.from("tax_return_filings").select("return_type, entity_key, period_key, filed").eq("tax_year", taxNow),
      supabase.from("tax_return_filings").select("return_type, entity_key, period_key, filed").eq("tax_year", taxPrevYear),
      supabase.from("tax_accounts_signoffs").select("section, entity_key, signed_off").eq("tax_year", taxNow),
      supabase.from("tax_accounts_signoffs").select("section, entity_key, signed_off").eq("tax_year", taxPrevYear),
    ]);

    function buildSchedMap(rows: { section: string; step_index: number; entity_key: string; status: string }[] | null, year: string) {
      const m = new Map<string, "Not Started" | "In Progress" | "External Auditors" | "Completed">();
      for (const r of rows ?? []) {
        m.set(`${year}:${r.section}:${r.step_index}:${r.entity_key}`, r.status as "Not Started" | "In Progress" | "External Auditors" | "Completed");
      }
      return m;
    }
    function buildFilingMap(rows: { return_type: string; entity_key: string; period_key: string; filed: boolean }[] | null, year: string) {
      const m = new Map<string, boolean>();
      for (const r of rows ?? []) {
        m.set(`${year}:${r.return_type}:${r.entity_key}:${r.period_key}`, r.filed);
      }
      return m;
    }
    function buildSignoffMap(rows: { section: string; entity_key: string; signed_off: boolean }[] | null, year: string) {
      const m = new Map<string, boolean>();
      for (const r of rows ?? []) {
        m.set(`${year}:${r.section}:${r.entity_key}`, r.signed_off);
      }
      return m;
    }

    const smCurr = buildSchedMap(schedCurr, taxNow);
    const smPrev = buildSchedMap(schedPrev, taxPrevYear);
    const fmCurr = buildFilingMap(filingCurr, taxNow);
    const fmPrev = buildFilingMap(filingPrev, taxPrevYear);
    const sofCurr = buildSignoffMap(signoffCurr, taxNow);
    const sofPrev = buildSignoffMap(signoffPrev, taxPrevYear);

    function countFiled(fm: Map<string, boolean>): number {
      let n = 0;
      fm.forEach((v) => { if (v) n++; });
      return n;
    }

    function schedCompletePct(sm: Map<string, "Not Started" | "In Progress" | "External Auditors" | "Completed">): number {
      // 4 quarters × 5 steps × 4 entities = 80 slots
      const TOTAL_SCHED = 4 * 5 * 4;
      let done = 0;
      sm.forEach((v) => { if (v === "Completed") done++; });
      return TOTAL_SCHED > 0 ? Math.round((done / TOTAL_SCHED) * 100) : 0;
    }

    function hasPendingItems(sm: Map<string, "Not Started" | "In Progress" | "External Auditors" | "Completed">, fm: Map<string, boolean>, year: string): boolean {
      const MONTHLY_ENTITIES: Record<string, string[]> = {
        FBR_SALES_TAX: ["UT", "IMP"],
        PRA_TAX: ["UT", "IMP", "BARANH", "HD"],
      };
      const start = parseInt(year.split("-")[0], 10);
      const months = [
        `${start}-07`, `${start}-08`, `${start}-09`,
        `${start}-10`, `${start}-11`, `${start}-12`,
        `${start + 1}-01`, `${start + 1}-02`, `${start + 1}-03`,
        `${start + 1}-04`, `${start + 1}-05`, `${start + 1}-06`,
      ];
      const todayNow = new Date();
      for (const [rt, entities] of Object.entries(MONTHLY_ENTITIES)) {
        for (const period of months) {
          const due = new Date(`${period}-15T00:00:00`);
          if (todayNow <= due) continue;
          for (const ek of entities) {
            if (!fm.get(`${year}:${rt}:${ek}:${period}`)) return true;
          }
        }
      }
      // Also check if any schedule entry is not Completed
      let anyIncomplete = false;
      sm.forEach((v) => { if (v !== "Completed") anyIncomplete = true; });
      return anyIncomplete;
    }

    const TOTAL_FILINGS = 88; // 24 FBR + 48 PRA + 16 Income Tax
    const prevComplete = countFiled(fmPrev) >= TOTAL_FILINGS && schedCompletePct(smPrev) === 100;
    const currHasItems = hasPendingItems(smCurr, fmCurr, taxNow);

    if (prevComplete) {
      setTaxScheduleEntries(smCurr);
      setTaxReturnFilings(fmCurr);
      setTaxSummaryYear(taxNow);
      setTaxSignoffs(sofCurr);
      setTaxScheduleEntries2(new Map());
      setTaxReturnFilings2(new Map());
      setTaxSummaryYear2("");
      setTaxSignoffs2(new Map());
    } else if (!currHasItems) {
      setTaxScheduleEntries(smPrev);
      setTaxReturnFilings(fmPrev);
      setTaxSummaryYear(taxPrevYear);
      setTaxSignoffs(sofPrev);
      setTaxScheduleEntries2(new Map());
      setTaxReturnFilings2(new Map());
      setTaxSummaryYear2("");
      setTaxSignoffs2(new Map());
    } else {
      // Both years have pending items — show prev first, current second
      setTaxScheduleEntries(smPrev);
      setTaxReturnFilings(fmPrev);
      setTaxSummaryYear(taxPrevYear);
      setTaxSignoffs(sofPrev);
      setTaxScheduleEntries2(smCurr);
      setTaxReturnFilings2(fmCurr);
      setTaxSummaryYear2(taxNow);
      setTaxSignoffs2(sofCurr);
    }

    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({
        ts: Date.now(),
        payload: {
          summaries: result,
          machineIssues: activeMachineIssues,
          tasks: taskData,
          escalations: foundEscalations,
          stuckReceivables: foundStuckReceivables,
          companyFinance: allCompanyFinance,
          receivableRows: recRows,
          recAgingTotals: aging,
          recAgingByCustomer: recAgingByCust,
          showFinance: showFinanceForUser,
          deptHealth: healthResults,
          investmentData: computedInvestmentData ?? undefined,
          pensionSummary: computedPensionSummary ?? undefined,
          folderitSummary: computedFolderitSummary ?? undefined,
          folderitCompanyBreakdown: computedFolderitCompanyBreakdown,
          dailyOpsData: computedDailyOpsData,
          taxSummaryYear: prevComplete ? taxNow : taxPrevYear,
          taxScheduleEntries: Array.from((prevComplete ? smCurr : smPrev).entries()),
          taxReturnFilings: Array.from((prevComplete ? fmCurr : fmPrev).entries()),
          taxSignoffs: Array.from((prevComplete ? sofCurr : sofPrev).entries()),
          taxScheduleEntries2: Array.from(((!prevComplete && currHasItems) ? smCurr : new Map()).entries()),
          taxReturnFilings2: Array.from(((!prevComplete && currHasItems) ? fmCurr : new Map()).entries()),
          taxSummaryYear2: (!prevComplete && currHasItems) ? taxNow : "",
          taxSignoffs2: Array.from(((!prevComplete && currHasItems) ? sofCurr : new Map()).entries()),
        },
      }));
    } catch {
      // sessionStorage full — skip cache
    }

    setLastUpdated(new Date());
    setExecLoading(false);
  }

  useEffect(() => {
    if (!isExec) return;
    loadExecutiveData(selectedDate);
    const channel = supabase
      .channel("ceo-dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "production_entries" }, () => { sessionStorage.removeItem(`exec_home_${selectedDate}`); loadExecutiveData(selectedDate); })
      .on("postgres_changes", { event: "*", schema: "public", table: "dispatch_entries" }, () => { sessionStorage.removeItem(`exec_home_${selectedDate}`); loadExecutiveData(selectedDate); })
      .on("postgres_changes", { event: "*", schema: "public", table: "breakage_entries" }, () => { sessionStorage.removeItem(`exec_home_${selectedDate}`); loadExecutiveData(selectedDate); })
      .on("postgres_changes", { event: "*", schema: "public", table: "machine_issues" }, () => { sessionStorage.removeItem(`exec_home_${selectedDate}`); loadExecutiveData(selectedDate); })
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => { sessionStorage.removeItem(`exec_home_${selectedDate}`); loadExecutiveData(selectedDate); })
      .on("postgres_changes", { event: "*", schema: "public", table: "monthly_production_targets" }, () => { sessionStorage.removeItem(`exec_home_${selectedDate}`); loadExecutiveData(selectedDate); })
      .on("postgres_changes", { event: "*", schema: "public", table: "monthly_dispatch_targets" }, () => { sessionStorage.removeItem(`exec_home_${selectedDate}`); loadExecutiveData(selectedDate); })
      .on("postgres_changes", { event: "*", schema: "public", table: "monthly_cash_plan" }, () => { sessionStorage.removeItem(`exec_home_${selectedDate}`); loadExecutiveData(selectedDate); })
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_cash_position" }, () => { sessionStorage.removeItem(`exec_home_${selectedDate}`); loadExecutiveData(selectedDate); })
      .on("postgres_changes", { event: "*", schema: "public", table: "receivables" }, () => { sessionStorage.removeItem(`exec_home_${selectedDate}`); loadExecutiveData(selectedDate); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, isExec]);

  useEffect(() => {
    async function loadSynopsis() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch("/api/finance/facility-synopsis", {
          headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
        });
        if (res.ok) {
          const json = await res.json();
          setFacilitySynopsis(json.banks || []);
        }
      } catch { /* silent */ }
    }
    loadSynopsis();
  }, []);

  useEffect(() => {
    async function loadGuaranteeAlerts() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch("/api/finance/guarantee-alerts", {
          headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
        });
        if (res.ok) {
          const json = await res.json();
          setGuaranteeAlerts(json.overdue ?? []);
        }
      } catch { /* silent */ }
    }
    loadGuaranteeAlerts();
  }, []);

  /* ── Member-view data loader (non-CEO logins) ── */
  useEffect(() => {
    if (ctxLoading) return;
    if (isExec) { setLoading(false); return; }

    async function loadDashboard() {
      const today = todayStr;
      const month = today.slice(0, 7);
      const weekFromNow = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

      const { data: { user } } = await supabase.auth.getUser();
      const email = user?.email || "";
      let fullName = email;

      const { data: memberData } = await supabase.from("members").select("first_name, last_name, name, role, department, company").eq("email", email).maybeSingle();
      if (memberData) {
        fullName = `${memberData.first_name || ""} ${memberData.last_name || ""}`.trim() || memberData.name || email;
        setUserName(fullName);
      }

      const [
        tasksRes, machinesRes, meetingsRes,
        myTasksRes, assignedByMeRes, auditRes,
      ] = await Promise.all([
        supabase.from("tasks").select("id, description, status, due_date, assigned_to, assigned_to_email, assigned_by, project, priority, updated_at").in("status", ["Not Started", "In Progress", "Waiting Reply"]),
        supabase.from("machine_issues").select("id").eq("issue_status", "Down"),
        supabase.from("meetings").select("id, title, meeting_date").gte("meeting_date", today).order("meeting_date", { ascending: true }).limit(5),
        supabase.from("tasks").select("id, description, status, due_date, assigned_to, assigned_to_email, assigned_by, project, priority, updated_at").or(`assigned_to_email.eq.${email},assigned_to.eq.${fullName}`).order("created_at", { ascending: false }),
        supabase.from("tasks").select("id, description, status, due_date, assigned_to, assigned_to_email, assigned_by, project, priority, updated_at").eq("assigned_by", fullName).neq("assigned_to", fullName).order("created_at", { ascending: false }).limit(20),
        supabase.from("audit_log").select("id, action, table_name, details, created_at").eq("user_email", email).order("created_at", { ascending: false }).limit(8),
      ]);

      const taskRows = tasksRes.data || [] as TaskRow[];
      const overdue = taskRows.filter((t) => t.due_date && t.due_date < today);
      const dueToday = taskRows.filter((t) => t.due_date === today);

      const { count: doneToday } = await supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "Completed").gte("updated_at", today + "T00:00:00");

      setKpis({
        tasksDueToday: dueToday.length,
        activeTasks: taskRows.length,
        machinesDown: (machinesRes.data || []).length,
        openTasks: taskRows.length,
      });
      setCompletedToday(doneToday || 0);

      const todayAndOverdue = taskRows
        .filter((t) => t.due_date && t.due_date <= today)
        .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));
      const upcoming = taskRows
        .filter((t) => t.due_date && t.due_date > today && t.due_date <= weekFromNow)
        .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));
      setTodayTasks([...todayAndOverdue, ...upcoming].slice(0, 15));

      setMeetings(meetingsRes.data || []);

      const countMap: Record<string, number> = {};
      for (const t of taskRows) {
        const name = t.assigned_to || "Unassigned";
        countMap[name] = (countMap[name] || 0) + 1;
      }
      const wl = Object.entries(countMap)
        .map(([name, count]) => ({ name: name.split(" ")[0] + (name.split(" ")[1] ? " " + name.split(" ")[1][0] + "." : ""), count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);
      setWorkload(wl);

      const att: AttentionItem[] = [];
      for (const t of overdue) {
        att.push({ label: t.description, detail: `overdue${t.due_date ? " / due " + formatDateUK(t.due_date) : ""} · ${t.assigned_to || "Unassigned"}`, href: "/tasks" });
        if (att.length >= 5) break;
      }
      const blocked = taskRows.filter((t) => t.status === "Waiting Reply");
      for (const t of blocked) {
        if (att.length >= 5) break;
        att.push({ label: t.description, detail: `waiting reply · ${t.assigned_to || "Unassigned"}`, href: "/tasks" });
      }
      setAttention(att);

      const myAll = myTasksRes.data || [];
      const myOpen = myAll.filter((t) => t.status !== "Completed" && t.status !== "Cancelled");
      const myOD = myOpen.filter(isOverdueRow);
      const myDTW = myOpen.filter((t) => t.due_date && t.due_date >= today && daysUntil(t.due_date) <= 7).sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));
      setMyOpenTasks(myOpen);
      setMyOverdueTasks(myOD);
      setMyDueThisWeek(myDTW);
      setAssignedByMe((assignedByMeRes.data || []).filter((t) => t.status !== "Completed" && t.status !== "Cancelled"));
      setRecentActivity(auditRes.data || []);
      setMyCompletedMonth(myAll.filter((t) => t.status === "Completed" && t.updated_at && t.updated_at.slice(0, 7) === month).length);

      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const [cashRes, recRes, prodSummaryRes, completedWeekRes] = await Promise.all([
        supabase.from("daily_cash_position").select("closing_balance, position_date").order("position_date", { ascending: false }).limit(2),
        supabase.from("receivables").select("id").in("current_stage", ["Stage 2", "Stage 3"]).eq("status", "In Progress"),
        supabase.rpc("get_production_summary", { p_date: yesterday, p_month: today.slice(0, 7) }),
        supabase.from("tasks").select("due_date, updated_at, status").gte("due_date", sevenDaysAgo).lte("due_date", today),
      ]);

      const cashRows = cashRes.data || [];
      const cashTotal = cashRows.length > 0 ? cashRows.reduce((s, r) => s + (r.closing_balance || 0), 0) : null;
      const cashDate = cashRows.length > 0 ? cashRows[0].position_date : null;
      const stuckBills = (recRes.data || []).length;

      const prodTotal = prodSummaryRes.data?.[0]?.prod_total_yesterday ?? 0;
      const targTotal = prodSummaryRes.data?.[0]?.targ_total_month ?? 0;
      const dailyTarget = prodSummaryRes.data?.[0]?.daily_target ?? 0;
      const prodPct = dailyTarget > 0 ? Math.round((prodTotal / dailyTarget) * 100) : null;

      setBriefing({ cashTotal, prodPct, stuckBills, cashDate });

      const allWeekTasks = completedWeekRes.data || [];
      const dueByDay: number[] = [];
      const completedByDay: number[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        dueByDay.push(allWeekTasks.filter((t) => t.due_date === d).length);
        completedByDay.push(allWeekTasks.filter((t) => t.status === "Completed" && t.updated_at && t.updated_at.slice(0, 10) === d).length);
      }
      setSparklines({ dueByDay, completedByDay });

      const userRole = memberData?.role || "";
      const userDept = memberData?.department || "";

      if (userRole === "Manager" && userDept === "Unze Trading Ops") {
        const items: ManagerBriefingItem[] = [];
        const mStart = today.slice(0, 7) + "-01";

        const [prodTodayRes, prodYestRes, targRes2, dispRes, breakRes, machRes, deptOpenRes, deptOverdueRes] = await Promise.all([
          supabase.from("production_entries").select("qty_31, qty_36, qty_45, qty_meter").eq("entry_date", today),
          supabase.from("production_entries").select("qty_31, qty_36, qty_45, qty_meter").eq("entry_date", yesterday),
          supabase.from("monthly_production_targets").select("target_pairs").eq("month", today.slice(0, 7)),
          supabase.from("dispatch_entries").select("qty_31, qty_36, qty_45, qty_meter").gte("entry_date", mStart).lte("entry_date", today),
          supabase.from("breakage_entries").select("qty_31, qty_36, qty_45, qty_meter").gte("entry_date", sevenDaysAgo).lte("entry_date", today),
          supabase.from("machine_issues").select("id, issue_status").neq("issue_status", "Resolved"),
          supabase.from("tasks").select("id", { count: "exact", head: true }).eq("assigned_to_department", "Unze Trading Ops").not("status", "in", '("Completed","Cancelled")'),
          supabase.from("tasks").select("id", { count: "exact", head: true }).eq("assigned_to_department", "Unze Trading Ops").not("status", "in", '("Completed","Cancelled")').lt("due_date", today),
        ]);

        const sumQty = (rows: { qty_31?: number; qty_36?: number; qty_45?: number; qty_meter?: number }[]) =>
          rows.reduce((s, r) => s + (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0) + (r.qty_meter || 0), 0);

        const todayProd = sumQty(prodTodayRes.data || []);
        const yesterdayProd = sumQty(prodYestRes.data || []);
        const monthTarget = (targRes2.data || []).reduce((s, r) => s + (r.target_pairs || 0), 0);
        const dailyTarget2 = monthTarget > 0 ? Math.round(monthTarget / 26) : 0;

        if (todayProd === 0 && yesterdayProd === 0) {
          items.push({ label: "No production entered", value: "No data for today or yesterday", rag: "RED" });
        } else if (todayProd === 0) {
          items.push({ label: "No production today yet", value: `Yesterday: ${yesterdayProd.toLocaleString()} pairs`, rag: "AMBER" });
        } else {
          const pct = dailyTarget2 > 0 ? Math.round((todayProd / dailyTarget2) * 100) : 100;
          items.push({ label: "Today's production", value: `${todayProd.toLocaleString()} pairs (${pct}% of daily target)`, rag: pct >= 90 ? "GREEN" : pct >= 70 ? "AMBER" : "RED" });
        }

        const monthProdRes = await supabase.from("production_entries").select("qty_31, qty_36, qty_45, qty_meter").gte("entry_date", mStart).lte("entry_date", today);
        const monthProd = sumQty(monthProdRes.data || []);
        const dayOfMonth = new Date().getDate();
        const expectedPct = monthTarget > 0 ? Math.round((dayOfMonth / 26) * 100) : 0;
        const actualPct = monthTarget > 0 ? Math.round((monthProd / monthTarget) * 100) : 100;
        if (monthTarget > 0) {
          const onTrack = actualPct >= expectedPct - 10;
          items.push({ label: "Month-to-date", value: `${monthProd.toLocaleString()} of ${monthTarget.toLocaleString()} (${actualPct}%)`, rag: onTrack ? "GREEN" : actualPct >= expectedPct - 20 ? "AMBER" : "RED" });
        }

        const monthDisp = sumQty(dispRes.data || []);
        const dispatchRatio = monthProd > 0 ? Math.round((monthDisp / monthProd) * 100) : 100;
        items.push({ label: "Dispatch ratio", value: `${monthDisp.toLocaleString()} dispatched (${dispatchRatio}% of produced)`, rag: dispatchRatio >= 85 ? "GREEN" : dispatchRatio >= 70 ? "AMBER" : "RED" });

        const weekBreakage = sumQty(breakRes.data || []);
        const weekProdForBreak = yesterdayProd * 7;
        const breakPct = weekProdForBreak > 0 ? Math.round((weekBreakage / weekProdForBreak) * 100) : 0;
        items.push({ label: "Breakage (7-day)", value: `${weekBreakage.toLocaleString()} pairs (${breakPct}% rate)`, rag: breakPct <= 2 ? "GREEN" : breakPct <= 5 ? "AMBER" : "RED" });

        const machDown = (machRes.data || []).filter((m) => m.issue_status === "Down").length;
        const machPartial = (machRes.data || []).filter((m) => m.issue_status === "Partially Working").length;
        if (machDown > 0) {
          items.push({ label: "Machines down", value: `${machDown} down${machPartial > 0 ? `, ${machPartial} partial` : ""}`, rag: "RED" });
        } else if (machPartial > 0) {
          items.push({ label: "Machine issues", value: `${machPartial} partially working`, rag: "AMBER" });
        } else {
          items.push({ label: "All machines", value: "Running normally", rag: "GREEN" });
        }

        const deptOpen = deptOpenRes.count ?? 0;
        const deptOverdue = deptOverdueRes.count ?? 0;
        items.push({ label: "Ops tasks", value: `${deptOpen} open${deptOverdue > 0 ? `, ${deptOverdue} overdue` : ""}`, rag: deptOverdue === 0 ? "GREEN" : deptOverdue <= 3 ? "AMBER" : "RED" });

        setManagerBriefing(items);
        setManagerBriefingTitle("Operations Briefing");
      }

      if (userRole === "Manager" && userDept === "Finance") {
        const items: ManagerBriefingItem[] = [];

        const userCompany = memberData?.company || "";
        const matchedCompany = COMPANIES.find((c) => c.name === userCompany || userCompany.startsWith(c.name.split(" ")[0]));
        const companyIds = matchedCompany ? [matchedCompany.id] : COMPANIES.map((c) => c.id);
        const companyLabel = matchedCompany ? matchedCompany.shortCode : "All";

        const [recOpenRes, recOverdueRes, finOpenRes, finOverdueRes] = await Promise.all([
          supabase.from("receivables").select("id, amount").neq("status", "Collected"),
          supabase.rpc("get_receivable_rag_by_customer"),
          supabase.from("tasks").select("id", { count: "exact", head: true }).eq("assigned_to_department", "Finance").not("status", "in", '("Completed","Cancelled")'),
          supabase.from("tasks").select("id", { count: "exact", head: true }).eq("assigned_to_department", "Finance").not("status", "in", '("Completed","Cancelled")').lt("due_date", today),
        ]);

        for (const cId of companyIds) {
          const comp = COMPANIES.find((c) => c.id === cId);
          const tag = comp?.shortCode || "?";

          const [cashPosRes, budgetRes] = await Promise.all([
            supabase.from("daily_cash_position").select("closing_balance, total_receipts, total_payments, position_date").eq("company_id", cId).order("position_date", { ascending: false }).limit(7),
            supabase.from("monthly_budgets").select("category, flow_type, budgeted_amount, budget_month").eq("company_id", cId).eq("budget_month", today.slice(0, 7)),
          ]);

          const cashRowsC = cashPosRes.data || [];
          if (cashRowsC.length === 0) {
            items.push({ label: `${tag} cash position`, value: "No data entered", rag: "RED" });
          } else {
            const latest = cashRowsC[0];
            const latestDate = latest.position_date;
            const daysSinceEntry = Math.floor((Date.now() - new Date(latestDate + "T00:00:00").getTime()) / 86400000);
            if (daysSinceEntry > 1) {
              items.push({ label: `${tag} cash stale`, value: `Last entry ${daysSinceEntry} days ago (${latestDate})`, rag: daysSinceEntry > 3 ? "RED" : "AMBER" });
            } else {
              items.push({ label: `${tag} cash position`, value: `PKR ${(latest.closing_balance || 0).toLocaleString()}`, rag: "GREEN" });
            }

            if (cashRowsC.length >= 3) {
              const declining = cashRowsC[0].closing_balance < cashRowsC[1].closing_balance && cashRowsC[1].closing_balance < cashRowsC[2].closing_balance;
              if (declining) {
                items.push({ label: `${tag} cash trend`, value: "Declining 3 days straight", rag: "RED" });
              }
            }

            const weekReceipts = cashRowsC.reduce((s, r) => s + (r.total_receipts || 0), 0);
            const weekPayments = cashRowsC.reduce((s, r) => s + (r.total_payments || 0), 0);
            const netFlow = weekReceipts - weekPayments;
            items.push({ label: `${tag} net flow (7d)`, value: `PKR ${netFlow.toLocaleString()} (in: ${weekReceipts.toLocaleString()}, out: ${weekPayments.toLocaleString()})`, rag: netFlow >= 0 ? "GREEN" : "RED" });

            if (netFlow < 0 && cashRowsC.length >= 3) {
              const dailyBurn = Math.abs(netFlow) / cashRowsC.length;
              const currentBalance = cashRowsC[0].closing_balance || 0;
              const runwayDays = dailyBurn > 0 ? Math.floor(currentBalance / dailyBurn) : Infinity;
              if (runwayDays < 30) {
                items.push({ label: `${tag} runway`, value: `${runwayDays} days at current burn rate`, rag: runwayDays < 14 ? "RED" : "AMBER" });
              }
            }
          }

          const budgets = budgetRes.data || [];
          if (budgets.length > 0) {
            const totalBudget = budgets.reduce((s, r) => s + (r.budgeted_amount || 0), 0);
            items.push({ label: `${tag} monthly budget`, value: `PKR ${totalBudget.toLocaleString()} across ${budgets.length} categories`, rag: "GREEN" });
          }
        }

        const openRec = recOpenRes.data || [];
        const totalOutstanding = openRec.reduce((s, r) => s + (r.amount || 0), 0);
        items.push({ label: "Outstanding receivables", value: `PKR ${totalOutstanding.toLocaleString()} across ${openRec.length} bills`, rag: openRec.length > 10 ? "RED" : openRec.length > 5 ? "AMBER" : "GREEN" });

        // red_count from RAG RPC: red = past stage deadline
        const overdueRec = ((recOverdueRes.data || []) as { red_count: number }[]).reduce((s, r) => s + (r.red_count || 0), 0);
        if (overdueRec > 0) {
          items.push({ label: "Overdue receivables", value: `${overdueRec} bill${overdueRec > 1 ? "s" : ""} past stage deadline`, rag: overdueRec > 3 ? "RED" : "AMBER" });
        } else {
          items.push({ label: "Receivable stages", value: "All within deadline", rag: "GREEN" });
        }

        const finOpen = finOpenRes.count ?? 0;
        const finOverdue = finOverdueRes.count ?? 0;
        items.push({ label: "Finance tasks", value: `${finOpen} open${finOverdue > 0 ? `, ${finOverdue} overdue` : ""}`, rag: finOverdue === 0 ? "GREEN" : finOverdue <= 3 ? "AMBER" : "RED" });

        // Tax deadline alerts — Tier 1 (HOD alert)
        const taxYearForBriefing = (() => {
          const m = new Date().getMonth() + 1;
          const y = new Date().getFullYear();
          return m >= 7 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
        })();
        const { data: tier1AlertData } = await supabase
          .from("tax_deadline_alerts")
          .select("alert_message, overdue_count")
          .eq("tier", 1)
          .eq("resolved", false)
          .eq("tax_year", taxYearForBriefing);
        if (tier1AlertData && tier1AlertData.length > 0) {
          const totalItems = tier1AlertData.reduce((s, a) => s + a.overdue_count, 0);
          items.push({
            label: "Tax deadlines overdue",
            value: `${tier1AlertData.length} deadline${tier1AlertData.length > 1 ? "s" : ""} missed — ${totalItems} item${totalItems > 1 ? "s" : ""} pending`,
            rag: "RED",
          });
        }

        setManagerBriefing(items);
        setManagerBriefingTitle(`Finance Briefing${companyLabel !== "All" ? ` · ${companyLabel}` : ""}`);
      }

      if (userRole === "Admin" || userRole === "CEO") {
        authFetch("/api/admin/cron-health")
          .then((r) => r.json())
          .then((d) => { if (d.checks) setCronHealth(d.checks); })
          .catch(() => {});
      }

      setLoading(false);
    }

    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxLoading, isExec]);

  const allLoading = ctxLoading || (isExec ? execLoading : loading);

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const now = new Date();
  const dateStr = `${dayNames[now.getDay()]}, ${now.getDate()} ${monthNames[now.getMonth()]} ${now.getFullYear()}`;

  const isTeamLead = ctx ? isPrivileged(ctx) || canCreateAssignments(ctx) : false;
  const maxWorkload = workload.length > 0 ? Math.max(...workload.map((w) => w.count)) : 1;

  const donutData = [
    { name: "Overdue", value: myOverdueTasks.length, color: COLOURS.RED },
    { name: "Waiting Reply", value: myOpenTasks.filter((t) => t.status === "Waiting Reply").length, color: COLOURS.AMBER },
    { name: "In Progress", value: myOpenTasks.filter((t) => t.status === "In Progress").length, color: COLOURS.BLUE },
    { name: "Not Started", value: myOpenTasks.filter((t) => t.status === "Not Started").length, color: COLOURS.SLATE },
  ].filter((d) => d.value > 0);

  function greetByTime() {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }

  const myTotalMonth = myOpenTasks.length + myCompletedMonth;
  const progressPct = myTotalMonth > 0 ? Math.round((myCompletedMonth / myTotalMonth) * 100) : 0;

  if (!ctxLoading && ctx && isPA(ctx)) {
    return <AuthWrapper><main style={{ padding: "14px 18px" }}><p style={{ color: "var(--text-secondary)" }}>Redirecting...</p></main></AuthWrapper>;
  }

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "16px 20px" : "32px 40px", maxWidth: "100%", minWidth: 0, backgroundColor: CANVAS, fontFamily: "var(--font-sans, Inter, sans-serif)" }}>

        {!allLoading && userName && (
          <div style={{ marginBottom: "28px" }}>
            <div style={{
              fontFamily: "var(--font-display, 'Inter Tight', sans-serif)",
              fontSize: isMobile ? "28px" : "44px",
              fontWeight: 600,
              color: NAVY,
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
              marginBottom: "8px",
            }}>
              {greetByTime()}, {userName.split(" ")[0]}.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "13px", color: SLATE }}>{dateStr}</span>
              {ctx?.role && (
                <span style={{
                  fontSize: "11px", fontWeight: 500, padding: "2px 8px",
                  borderRadius: "999px",
                  backgroundColor: COLOURS.HAIRLINE, color: SLATE,
                  letterSpacing: "0.06em", textTransform: "uppercase",
                }}>
                  {displayRole(ctx.role, ctx.email)}
                </span>
              )}
            </div>
          </div>
        )}

        {allLoading ? (
          <HomeSkeleton isMobile={isMobile} />
        ) : isExec ? (
          <ExecutiveDashboardBody
            ctx={ctx}
            lastUpdated={lastUpdated}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            summaries={summaries}
            machineIssues={machineIssues}
            tasks={tasks}
            escalations={escalations}
            stuckReceivables={stuckReceivables}
            companyFinance={companyFinance}
            receivableRows={receivableRows}
            recAgingTotals={recAgingTotals}
            recAgingByCustomer={recAgingByCustomer}
            showFinance={showFinance}
            setShowFinance={setShowFinance}
            expandedCard={expandedCard}
            setExpandedCard={setExpandedCard}
            bannerOpen={bannerOpen}
            setBannerOpen={setBannerOpen}
            deptHealth={deptHealth}
            investmentData={investmentData}
            pensionSummary={pensionSummary}
            folderitSummary={folderitSummary}
            folderitCompanyBreakdown={folderitCompanyBreakdown}
            dailyOpsData={dailyOpsData}
            facilitySynopsis={facilitySynopsis}
            guaranteeAlerts={guaranteeAlerts}
            taxOverdueCount={taxOverdueCount}
            taxTier2Alerts={taxTier2Alerts}
            taxScheduleEntries={taxScheduleEntries}
            taxReturnFilings={taxReturnFilings}
            taxSummaryYear={taxSummaryYear}
            taxScheduleEntries2={taxScheduleEntries2}
            taxReturnFilings2={taxReturnFilings2}
            taxSummaryYear2={taxSummaryYear2}
            taxSignoffs={taxSignoffs}
            taxSignoffs2={taxSignoffs2}
            isMobile={isMobile}
            quickTaskAction={quickTaskAction}
            quickMachineResolve={quickMachineResolve}
          />
        ) : (
          <>
            {/* ── Overdue banner ── */}
            {myOverdueTasks.length > 0 && (
              <div style={{ ...WARNING_BANNER_STYLE, padding: "10px 16px", marginBottom: "16px", display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "18px" }}>⚠</span>
                <div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: WARNING_TITLE_COLOR }}>
                    {myOverdueTasks.length} overdue task{myOverdueTasks.length > 1 ? "s" : ""} assigned to you
                  </div>
                  <div style={{ fontSize: "14px", color: WARNING_TITLE_COLOR, marginTop: "1px" }}>
                    {myOverdueTasks.slice(0, 3).map((t) => t.description.slice(0, 35)).join(" · ")}
                  </div>
                </div>
              </div>
            )}

            {/* ── Morning Briefing ── */}
            {isTeamLead && (briefing.cashTotal !== null || briefing.prodPct !== null || myOverdueTasks.length > 0 || briefing.stuckBills > 0) && (
              <div style={{
                backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                borderLeft: `4px solid ${myOverdueTasks.length > 2 || briefing.stuckBills > 2 ? COLOURS.RED : myOverdueTasks.length > 0 || briefing.stuckBills > 0 ? COLOURS.AMBER : COLOURS.GREEN}`,
                borderRadius: "8px", padding: "14px 18px", marginBottom: "16px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>Morning Briefing</span>
                  {briefing.cashDate && <FreshnessBadge date={briefing.cashDate} label="Finance" />}
                </div>
                <div style={{ fontSize: "15px", color: "var(--text-secondary)", lineHeight: 1.7 }}>
                  {briefing.cashTotal !== null && (
                    <span>Cash position: <strong style={{ color: "var(--text-primary)" }}>PKR {(briefing.cashTotal / 1000000).toFixed(1)}M</strong> across companies. </span>
                  )}
                  {myOverdueTasks.length > 0 && (
                    <span style={{ color: COLOURS.RED }}><strong>{myOverdueTasks.length} task{myOverdueTasks.length > 1 ? "s" : ""} overdue</strong>. </span>
                  )}
                  {myOverdueTasks.length === 0 && <span style={{ color: COLOURS.GREEN }}>No overdue tasks. </span>}
                  {briefing.prodPct !== null && (
                    <span>Yesterday&apos;s production: <strong style={{ color: briefing.prodPct >= 90 ? COLOURS.GREEN : briefing.prodPct >= 70 ? COLOURS.AMBER : COLOURS.RED }}>{briefing.prodPct}%</strong> of daily target. </span>
                  )}
                  {briefing.stuckBills > 0 && (
                    <span><strong>{briefing.stuckBills}</strong> receivable bill{briefing.stuckBills > 1 ? "s" : ""} stuck at Stage 2/3. </span>
                  )}
                </div>
              </div>
            )}

            {/* ── Manager Briefing (Ops / Finance) — collapsible ── */}
            {managerBriefing.length > 0 && (
              <div style={{
                backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                borderRadius: "8px", overflow: "hidden", marginBottom: "16px",
              }}>
                <div
                  onClick={() => setBriefingOpen(!briefingOpen)}
                  style={{
                    padding: "12px 18px",
                    display: "flex", alignItems: "center", gap: "8px",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontSize: "15px" }}>{managerBriefingTitle.startsWith("Finance") ? "💰" : "🏭"}</span>
                  <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary)" }}>
                    {managerBriefingTitle}
                  </span>
                  <span style={{
                    fontSize: "12px", fontWeight: 600, padding: "2px 8px",
                    borderRadius: "8px", color: "white",
                    backgroundColor: managerBriefing.some((i) => i.rag === "RED") ? COLOURS.RED : managerBriefing.some((i) => i.rag === "AMBER") ? COLOURS.AMBER : COLOURS.GREEN,
                  }}>
                    {managerBriefing.filter((i) => i.rag === "RED").length > 0
                      ? `${managerBriefing.filter((i) => i.rag === "RED").length} alert${managerBriefing.filter((i) => i.rag === "RED").length > 1 ? "s" : ""}`
                      : managerBriefing.some((i) => i.rag === "AMBER") ? "Needs attention" : "All clear"}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)" }}>
                    {briefingOpen ? "▲ Hide" : "▼ Show"}
                  </span>
                </div>
                {briefingOpen && managerBriefing.map((item, i) => (
                  <div key={i} style={{
                    padding: "10px 18px",
                    borderTop: i === 0 ? "1px solid var(--border-color)" : "none",
                    borderBottom: i < managerBriefing.length - 1 ? "1px solid var(--border-light)" : "none",
                    display: "flex", alignItems: "center", gap: "10px",
                  }}>
                    <span style={{
                      width: "10px", height: "10px", borderRadius: "50%", flexShrink: 0,
                      backgroundColor: item.rag === "GREEN" ? COLOURS.GREEN : item.rag === "AMBER" ? COLOURS.AMBER : COLOURS.RED,
                      boxShadow: `0 0 4px ${item.rag === "GREEN" ? COLOURS.GREEN : item.rag === "AMBER" ? COLOURS.AMBER : COLOURS.RED}40`,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>{item.label}</div>
                      <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{item.value}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Cron Health (Admin only) ── */}
            {cronHealth.length > 0 && (
              <div style={{
                backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                borderRadius: "8px", overflow: "hidden", marginBottom: "16px",
              }}>
                <div style={{
                  padding: "10px 18px", borderBottom: "1px solid var(--border-color)",
                  display: "flex", alignItems: "center", gap: "8px",
                }}>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>Integration Health</span>
                  <span style={{
                    marginLeft: "auto", fontSize: "12px", fontWeight: 600, padding: "2px 8px",
                    borderRadius: "8px", color: "white",
                    backgroundColor: cronHealth.some((c) => c.status === "error") ? COLOURS.RED : cronHealth.some((c) => c.status === "warning") ? COLOURS.AMBER : COLOURS.GREEN,
                  }}>
                    {cronHealth.filter((c) => c.status === "error").length > 0
                      ? `${cronHealth.filter((c) => c.status === "error").length} failing`
                      : cronHealth.some((c) => c.status === "warning") ? "Delayed" : "All healthy"}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1px", backgroundColor: HAIRLINE }}>
                  {cronHealth.map((c) => (
                    <div key={c.name} style={{ padding: "8px 14px", backgroundColor: "var(--bg-card)" }}>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "2px" }}>{c.name}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{
                          width: "8px", height: "8px", borderRadius: "50%",
                          backgroundColor: c.status === "healthy" ? COLOURS.GREEN : c.status === "warning" ? COLOURS.AMBER : c.status === "error" ? COLOURS.RED : COLOURS.SLATE,
                        }} />
                        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>
                          {c.hoursAgo === null ? "Never" : c.hoursAgo < 1 ? "< 1h ago" : `${c.hoursAgo}h ago`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── KPI Cards ── */}
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)",
              gap: "8px", marginBottom: "14px",
            }}>
              <KPICard icon="📋" value={kpis.tasksDueToday} label="Tasks due today" sparkline={sparklines.dueByDay} />
              <KPICard icon="📂" value={myOpenTasks.length} label="My open tasks" />
              <KPICard icon="🏭" value={kpis.machinesDown} label={kpis.machinesDown === 0 ? "All machines up" : "Machines down"} alert={kpis.machinesDown > 0} />
              <KPICard icon="✅" value={completedToday} label="Completed today" sparkline={sparklines.completedByDay} />
            </div>

            {/* ── Two-column body ── */}
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "1fr minmax(280px, 340px)",
              gap: "14px", marginBottom: "14px",
            }}>
              {/* Left — Today's Tasks */}
              <div style={{
                backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                borderRadius: "12px", overflow: "hidden",
              }}>
                <div style={{
                  padding: "14px 18px", borderBottom: "1px solid var(--border-color)",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "15px" }}>📋</span>
                    <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary)" }}>Today&apos;s Tasks</span>
                  </div>
                  <span style={{ fontSize: "14px", color: COLOURS.INK_400 }}>
                    {completedToday}/{todayTasks.length + completedToday} done
                  </span>
                </div>

                {todayTasks.length === 0 ? (
                  <div style={{ padding: "32px 18px", textAlign: "center", color: COLOURS.INK_400, fontSize: "16px" }}>
                    No tasks due today or this week. You&apos;re all clear!
                  </div>
                ) : (
                  todayTasks.map((task) => (
                    <a
                      key={task.id}
                      href="/tasks"
                      style={{
                        display: "flex", alignItems: "center", gap: "10px",
                        padding: "10px 18px",
                        borderBottom: "1px solid var(--border-light)",
                        textDecoration: "none", color: "inherit",
                        transition: "background-color 0.1s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-card-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                    >
                      <span style={{
                        width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0,
                        backgroundColor: STATUS_DOT[task.status] || COLOURS.SLATE,
                      }} />
                      <span style={{
                        flex: 1, fontSize: "15px", color: "var(--text-primary)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {task.description}
                      </span>
                      {task.project && (
                        <span style={{
                          fontSize: "13px", color: COLOURS.INK_400,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          maxWidth: "120px",
                        }}>
                          {task.project}
                        </span>
                      )}
                      {task.due_date && task.due_date < todayStr && (
                        <span style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.RED, whiteSpace: "nowrap" }}>
                          due {task.due_date.slice(5)}
                        </span>
                      )}
                      <span style={{
                        fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap",
                        color: STATUS_DOT[task.status] || COLOURS.SLATE,
                      }}>
                        {task.status}
                      </span>
                    </a>
                  ))
                )}

                <div style={{
                  padding: "10px 18px", fontSize: "14px", color: COLOURS.INK_400,
                  borderTop: "1px solid var(--border-light)",
                }}>
                  Tasks you scheduled for today, plus anything overdue or due this week.
                </div>
              </div>

              {/* Right — Widgets */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {donutData.length > 0 && (
                  <div style={{
                    backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                    borderRadius: "12px", overflow: "hidden",
                  }}>
                    <div style={{
                      padding: "12px 16px", borderBottom: "1px solid var(--border-color)",
                      display: "flex", alignItems: "center", gap: "8px",
                    }}>
                      <span style={{ fontSize: "16px" }}>📊</span>
                      <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>My Task Status</span>
                    </div>
                    <div style={{ padding: "12px 16px" }}>
                      <ResponsiveContainer width="100%" height={130}>
                        <PieChart>
                          <Pie data={donutData} cx="50%" cy="50%" innerRadius={32} outerRadius={50} dataKey="value" paddingAngle={2}>
                            {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                          </Pie>
                          <Tooltip formatter={(value, name) => [`${value} task${Number(value) > 1 ? "s" : ""}`, name]} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" }}>
                        {donutData.map((d) => (
                          <div key={d.name} style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "13px", color: "var(--text-secondary)" }}>
                            <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: d.color }} /> {d.name} ({d.value})
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {myDueThisWeek.length > 0 && (
                  <div style={{
                    backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                    borderRadius: "12px", overflow: "hidden",
                  }}>
                    <div style={{
                      padding: "12px 16px", borderBottom: "1px solid var(--border-color)",
                      display: "flex", alignItems: "center", gap: "8px",
                    }}>
                      <span style={{ fontSize: "16px" }}>📅</span>
                      <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>Due This Week ({myDueThisWeek.length})</span>
                    </div>
                    <div>
                      {myDueThisWeek.slice(0, 5).map((t) => {
                        const d = daysUntil(t.due_date!);
                        const urgency = d <= 1 ? COLOURS.RED : d <= 3 ? COLOURS.AMBER : COLOURS.SLATE;
                        return (
                          <a key={t.id} href="/tasks" style={{
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                            padding: "8px 16px", borderBottom: "1px solid var(--border-light)",
                            textDecoration: "none", color: "inherit",
                          }}>
                            <span style={{ flex: 1, fontSize: "15px", color: "var(--text-primary)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                              {t.description}
                            </span>
                            <span style={{ fontSize: "14px", fontWeight: 700, color: urgency, flexShrink: 0, marginLeft: "8px" }}>
                              {d === 0 ? "Today" : d === 1 ? "Tomorrow" : `${d}d`}
                            </span>
                          </a>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div style={{
                  backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                  borderRadius: "12px", overflow: "hidden",
                }}>
                  <div style={{
                    padding: "12px 16px", borderBottom: "1px solid var(--border-color)",
                    display: "flex", alignItems: "center", gap: "8px",
                  }}>
                    <span style={{ fontSize: "16px" }}>🗓️</span>
                    <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>Meetings</span>
                  </div>
                  <div style={{ padding: "12px 16px" }}>
                    {meetings.length === 0 ? (
                      <p style={{ fontSize: "15px", color: COLOURS.INK_400, margin: 0 }}>No upcoming meetings scheduled.</p>
                    ) : (
                      meetings.map((m) => (
                        <a key={m.id} href="/meetings" style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          padding: "6px 0", textDecoration: "none", color: "inherit",
                        }}>
                          <span style={{ fontSize: "15px", color: "var(--text-primary)" }}>{m.title}</span>
                          <span style={{ fontSize: "13px", color: COLOURS.INK_400 }}>{formatDateUK(m.meeting_date)}</span>
                        </a>
                      ))
                    )}
                  </div>
                </div>

                {isTeamLead ? (
                  <div style={{
                    backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                    borderRadius: "12px", overflow: "hidden",
                  }}>
                    <div style={{
                      padding: "12px 16px", borderBottom: "1px solid var(--border-color)",
                      display: "flex", alignItems: "center", gap: "8px",
                    }}>
                      <span style={{ fontSize: "16px" }}>👥</span>
                      <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>Team Workload</span>
                      <span style={{ fontSize: "13px", color: COLOURS.INK_400, marginLeft: "auto" }}>open tasks per person</span>
                    </div>
                    <div style={{ padding: "12px 16px" }}>
                      {workload.map((w) => (
                        <div key={w.name} style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                          <span style={{
                            fontSize: "14px", color: "var(--text-primary)", width: "90px",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0,
                          }}>
                            {w.name}
                          </span>
                          <div style={{
                            flex: 1, height: "8px", backgroundColor: "var(--border-light)", borderRadius: "4px", overflow: "hidden",
                          }}>
                            <div style={{
                              height: "100%", borderRadius: "4px",
                              width: `${(w.count / maxWorkload) * 100}%`,
                              backgroundColor: COLOURS.BLUE,
                              transition: "width 0.3s ease",
                            }} />
                          </div>
                          <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", width: "20px", textAlign: "right" }}>
                            {w.count}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{
                    backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                    borderRadius: "12px", overflow: "hidden",
                  }}>
                    <div style={{
                      padding: "12px 16px", borderBottom: "1px solid var(--border-color)",
                      display: "flex", alignItems: "center", gap: "8px",
                    }}>
                      <span style={{ fontSize: "16px" }}>📊</span>
                      <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>My Progress This Month</span>
                    </div>
                    <div style={{ padding: "16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px" }}>
                        <span style={{ fontSize: "28px", fontWeight: 800, color: "var(--text-primary)" }}>{myCompletedMonth}</span>
                        <span style={{ fontSize: "15px", color: "var(--text-secondary)" }}>of {myTotalMonth} tasks</span>
                      </div>
                      <div style={{
                        height: "10px", backgroundColor: "var(--border-light)", borderRadius: "5px", overflow: "hidden", marginBottom: "8px",
                      }}>
                        <div style={{
                          height: "100%", borderRadius: "5px",
                          width: `${progressPct}%`,
                          backgroundColor: progressPct >= 80 ? COLOURS.GREEN : progressPct >= 50 ? COLOURS.AMBER : COLOURS.BLUE,
                          transition: "width 0.3s ease",
                        }} />
                      </div>
                      <div style={{ fontSize: "14px", color: COLOURS.INK_400 }}>
                        {progressPct}% completed {myOpenTasks.length > 0 ? `· ${myOpenTasks.length} still open` : ""}
                      </div>
                    </div>
                  </div>
                )}

                {isTeamLead && attention.length > 0 && (
                  <div style={{
                    backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                    borderRadius: "12px", overflow: "hidden",
                  }}>
                    <div style={{
                      padding: "12px 16px", borderBottom: "1px solid var(--border-color)",
                      display: "flex", alignItems: "center", gap: "8px",
                    }}>
                      <span style={{ fontSize: "16px" }}>⚠️</span>
                      <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>Needs Attention</span>
                    </div>
                    <div style={{ padding: "8px 16px" }}>
                      {attention.map((a, i) => (
                        <a key={i} href={a.href} style={{
                          display: "block", padding: "6px 0",
                          textDecoration: "none", color: "inherit",
                          borderBottom: i < attention.length - 1 ? "1px solid var(--border-light)" : "none",
                        }}>
                          <div style={{ fontSize: "15px", color: "var(--text-primary)", fontWeight: 500 }}>{a.label}</div>
                          <div style={{ fontSize: "13px", color: COLOURS.INK_400 }}>{a.detail}</div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {isTeamLead && assignedByMe.length > 0 && (
              <div style={{
                backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                borderRadius: "12px", overflow: "hidden", marginBottom: "20px",
              }}>
                <div style={{
                  padding: "12px 18px", borderBottom: "1px solid var(--border-color)",
                  display: "flex", alignItems: "center", gap: "8px",
                }}>
                  <span style={{ fontSize: "16px" }}>📤</span>
                  <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>Tasks I Assigned ({assignedByMe.length} open)</span>
                </div>
                {assignedByMe.slice(0, 10).map((t) => (
                  <a key={t.id} href="/tasks" style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "8px 18px", borderBottom: "1px solid var(--border-light)",
                    textDecoration: "none", color: "inherit",
                    transition: "background-color 0.1s",
                  }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-card-hover)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.description}
                      </div>
                      <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>
                        {t.assigned_to || "Unassigned"}{t.due_date && ` · Due: ${formatDateUK(t.due_date)}`}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "5px", alignItems: "center", flexShrink: 0 }}>
                      {isOverdueRow(t) && <span style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.RED }}>{daysOverdue(t)}d late</span>}
                      <StatusBadge status={t.status} />
                      <button
                        title="Mark complete"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); quickAction(t.id, "complete", t); }}
                        style={{ background: "none", border: `1px solid ${COLOURS.GREEN}`, borderRadius: "6px", padding: "6px 12px", fontSize: "13px", fontWeight: 700, color: COLOURS.GREEN, cursor: "pointer", marginLeft: "4px", minHeight: "36px", minWidth: "44px" }}
                      >
                        Done
                      </button>
                      {t.assigned_to_email && (
                        <button
                          title="Send chase email"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); quickAction(t.id, "chase", t); }}
                          style={{ background: "none", border: `1px solid ${COLOURS.AMBER}`, borderRadius: "6px", padding: "6px 12px", fontSize: "13px", fontWeight: 700, color: COLOURS.AMBER, cursor: "pointer", minHeight: "36px", minWidth: "44px" }}
                        >
                          Chase
                        </button>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            )}

            {recentActivity.length > 0 && (
              <div style={{
                backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                borderRadius: "12px", overflow: "hidden", marginBottom: "20px",
              }}>
                <div style={{
                  padding: "12px 18px", borderBottom: "1px solid var(--border-color)",
                  display: "flex", alignItems: "center", gap: "8px",
                }}>
                  <span style={{ fontSize: "16px" }}>🕐</span>
                  <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>Recent Activity</span>
                </div>
                {recentActivity.map((a) => (
                  <div key={a.id} style={{
                    padding: "8px 18px", borderBottom: "1px solid var(--border-light)",
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "15px", color: "var(--text-primary)" }}>
                        <span style={{
                          fontSize: "13px", fontWeight: 700, padding: "1px 6px", borderRadius: "6px", marginRight: "6px",
                          backgroundColor: a.action === "Created" ? SUCCESS_SOFT : a.action.startsWith("Updated") ? WARNING_SOFT : DANGER_SOFT,
                          color: a.action === "Created" ? GREEN : a.action.startsWith("Updated") ? AMBER : RED,
                        }}>{a.action}</span>
                        {a.table_name}{a.details && ` — ${a.details.slice(0, 60)}`}
                      </div>
                    </div>
                    <div style={{ fontSize: "14px", color: "var(--text-secondary)", whiteSpace: "nowrap", flexShrink: 0 }}>
                      {formatDateUK(a.created_at.slice(0, 10))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Purpose Statement ── */}
            <div style={{
              backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
              borderLeft: "4px solid var(--text-primary)",
              borderRadius: "8px", padding: isMobile ? "10px 12px" : "12px 18px",
              fontSize: isMobile ? "14px" : "16px", color: "var(--text-primary)",
              lineHeight: 1.7, fontStyle: "italic", fontWeight: 600,
            }}>
              &ldquo;Through service and sustainable business growth, we create opportunities that enhance the lifestyle of our employees, customers, and the community we operate in.&rdquo;
            </div>
          </>
        )}
        {toast && (
          <div style={{
            position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)",
            backgroundColor: COLOURS.NAVY, color: "white", padding: "10px 20px",
            borderRadius: "8px", fontSize: "14px", fontWeight: 600, zIndex: 1000,
            boxShadow: "0 4px 12px rgba(15,23,32,0.15)",
          }}>
            {toast}
          </div>
        )}
      </main>
    </AuthWrapper>
  );
}

/* ───────────────────────── Executive Dashboard Body (CEO-only) ───────────────────────── */

function ExecutiveDashboardBody({
  ctx, lastUpdated, selectedDate, setSelectedDate, summaries, machineIssues, tasks, escalations, stuckReceivables,
  companyFinance, receivableRows, recAgingTotals, recAgingByCustomer, showFinance, setShowFinance,
  expandedCard, setExpandedCard, bannerOpen, setBannerOpen, deptHealth, investmentData, pensionSummary, folderitSummary, folderitCompanyBreakdown, dailyOpsData,
  facilitySynopsis, guaranteeAlerts, taxOverdueCount, taxTier2Alerts, taxScheduleEntries, taxReturnFilings, taxSummaryYear,
  taxScheduleEntries2, taxReturnFilings2, taxSummaryYear2, taxSignoffs, taxSignoffs2, isMobile, quickTaskAction, quickMachineResolve,
}: {
  ctx: UserCtx | null;
  lastUpdated: Date | null;
  selectedDate: string;
  setSelectedDate: (d: string) => void;
  summaries: PlantExecutiveSummary[];
  machineIssues: MachineIssue[];
  tasks: Task[];
  escalations: Escalation[];
  stuckReceivables: { key: string; primary: string; secondary: string }[];
  companyFinance: CompanyFinanceData[];
  receivableRows: ReceivableCustomerRow[];
  recAgingTotals: { "0-30": number; "31-60": number; "61-90": number; "90+": number };
  recAgingByCustomer: { customer: string; "0-30": number; "31-60": number; "61-90": number; "90+": number; total: number }[];
  showFinance: boolean;
  setShowFinance: (v: boolean) => void;
  expandedCard: string | null;
  setExpandedCard: (v: string | null) => void;
  bannerOpen: boolean;
  setBannerOpen: (v: boolean) => void;
  deptHealth: { slug: string; title: string; status: "GREEN" | "AMBER" | "RED"; owner: string; detail: string }[];
  investmentData: InvestmentSummary | null;
  pensionSummary: { gbp: number; pkr: number; netGain: number; totalReturn: number; contributed: number; feesPaid: number } | null;
  folderitSummary: { pendingApproval: number; companyInbox: number; hrInbox: number } | null;
  folderitCompanyBreakdown: { group_key: string; inbox_count: number; inbox_oldest_days: number | null }[];
  dailyOpsData: DailyOpsPoint[];
  isMobile: boolean;
  facilitySynopsis: { bank_name: string; bank_total_limit: number; bank_seized: number; bank_available: number; bank_utilisation_pct: number; active_guarantees: number; overdue_count: number }[];
  guaranteeAlerts: GuaranteeAlertItem[];
  taxOverdueCount: number;
  taxTier2Alerts: { alert_type: string; period_key: string; overdue_count: number; alert_message: string; tax_year: string }[];
  taxScheduleEntries: Map<string, "Not Started" | "In Progress" | "External Auditors" | "Completed">;
  taxReturnFilings: Map<string, boolean>;
  taxSummaryYear: string;
  taxScheduleEntries2: Map<string, "Not Started" | "In Progress" | "External Auditors" | "Completed">;
  taxReturnFilings2: Map<string, boolean>;
  taxSummaryYear2: string;
  taxSignoffs: Map<string, boolean>;
  taxSignoffs2: Map<string, boolean>;
  quickTaskAction: (taskId: string, newStatus: string) => Promise<void>;
  quickMachineResolve: (issueId: string) => Promise<void>;
}) {
  const userName = ctx?.email ? ctx.email.split("@")[0] : "";
  // Widget-level visibility (see app/lib/widgetRegistry.ts) — falls back to
  // hiding the widget if ctx somehow isn't loaded yet, rather than showing it.
  const wv = (key: string, defaultVisible: boolean) => !!ctx && widgetVisible(ctx, key, defaultVisible);
  const today = todayStr;
  const minDate = getThirtyDaysAgo();
  const selectedMonth = getMonthFromDate(selectedDate);
  const currentQuarter = getMonthQuarter(selectedDate);

  const produced = summaries.reduce((sum, s) => sum + total(s.producedOnDate), 0);
  const dispatched = summaries.reduce((sum, s) => sum + total(s.dispatchedOnDate), 0);
  const broken = summaries.reduce((sum, s) => sum + total(s.brokenOnDate), 0);
  const closingGoodStock = summaries.reduce((sum, s) => sum + total(s.closingGoodStock), 0);
  const closingBrokenStock = summaries.reduce((sum, s) => sum + total(s.closingBrokenStock), 0);

  const missingPlants = summaries.filter((s) => !s.enteredOnDate);
  const downMachines = machineIssues.filter((i) => i.issue_status === "Down");

  const overdueTasks = tasks.filter((t) => isOverdueTask(t));
  const waitingReplies = tasks.filter((t) => t.status === "Waiting Reply");
  const dueThisWeekTasks = tasks.filter((t) => isDueThisWeekTask(t));
  const completedThisMonth = tasks.filter(
    (t) => t.status === "Completed" &&
      ((t.updated_at && t.updated_at.slice(0, 10) >= currentMonthStart) ||
        (!t.updated_at && t.created_at && t.created_at.slice(0, 10) >= currentMonthStart))
  );

  const departmentRows = buildPerformanceRows(tasks, "department");

  const deptPeopleMap = new Map<string, PerformanceRow[]>();
  for (const task of tasks) {
    const dept = task.assigned_to_department || "Unassigned Department";
    const person = task.assigned_to || "Unassigned Person";
    if (!deptPeopleMap.has(dept)) deptPeopleMap.set(dept, []);
    const rows = deptPeopleMap.get(dept)!;
    let row = rows.find((r) => r.name === person);
    if (!row) {
      row = { name: person, red: 0, amber: 0, green: 0, total: 0 };
      rows.push(row);
    }
    const color = taskColor(task);
    row[color] += 1;
    row.total += 1;
  }
  for (const rows of deptPeopleMap.values()) {
    rows.sort((a, b) => b.red - a.red || b.amber - a.amber || a.name.localeCompare(b.name));
  }

  const recGreen = receivableRows.reduce((s, r) => s + r.greenAmount, 0);
  const recAmber = receivableRows.reduce((s, r) => s + r.amberAmount, 0);
  const recRed = receivableRows.reduce((s, r) => s + r.redAmount, 0);
  const recTotal = receivableRows.reduce((s, r) => s + r.totalAmount, 0);
  const recRedCount = receivableRows.reduce((s, r) => s + r.redCount, 0);

  /* Tax urgent-attention: tasks in the Tax Notices department that are overdue or due this week */
  const taxTasks = tasks.filter((t) => (t.assigned_to_department || "") === "Taxation");
  const taxOverdue = taxTasks.filter((t) => isOverdueTask(t));
  const taxDueThisWeek = taxTasks.filter((t) => isDueThisWeekTask(t));
  const taxUrgent = [...taxOverdue, ...taxDueThisWeek];

  /* Department Scorecard — merges Department Health (config-based RAG) with Performance (task counts) per dept.
     Legal has no config yet (dashboard to be built later) so it falls back to task-only performance. */
  const configuredSlugs = new Set(deptHealth.map((d) => d.slug));
  const scorecardRows = deptHealth.map((d) => {
    const perf = departmentRows.find((r) => r.name.toLowerCase() === d.title.toLowerCase()
      || r.name.toLowerCase().includes(d.slug.toLowerCase()));
    return { slug: d.slug, title: d.title, status: d.status, owner: d.owner, detail: d.detail, perf: perf || null, hasConfig: true };
  });
  const unconfiguredDeptNames = Array.from(new Set(departmentRows.map((r) => r.name)))
    .filter((name) => !Array.from(configuredSlugs).some((slug) => name.toLowerCase().includes(slug.toLowerCase())));
  for (const name of unconfiguredDeptNames) {
    const perf = departmentRows.find((r) => r.name === name);
    if (!perf || perf.total === 0) continue;
    const status: "GREEN" | "AMBER" | "RED" = perf.red > 0 ? "RED" : perf.amber > 0 ? "AMBER" : "GREEN";
    scorecardRows.push({
      slug: name.toLowerCase().replace(/\s+/g, "-"), title: name, status,
      owner: "—", detail: `${perf.total} task${perf.total === 1 ? "" : "s"}`, perf, hasConfig: false,
    });
  }
  if (!scorecardRows.some((r) => r.title.toLowerCase() === "legal")) {
    scorecardRows.push({ slug: "legal", title: "Legal", status: "GREEN", owner: "Not yet built", detail: "Dashboard pending", perf: null, hasConfig: false });
  }
  /* RED departments surface first so the worst problems are seen without scrolling; Legal (no dashboard yet) always pinned last. */
  const statusRank: Record<"RED" | "AMBER" | "GREEN", number> = { RED: 0, AMBER: 1, GREEN: 2 };
  scorecardRows.sort((a, b) => {
    const aLegal = a.title === "Legal" && a.owner === "Not yet built";
    const bLegal = b.title === "Legal" && b.owner === "Not yet built";
    if (aLegal !== bLegal) return aLegal ? 1 : -1;
    return statusRank[a.status] - statusRank[b.status];
  });

  const cashAlerts: { title: string; value: number; color: string }[] = [];
  if (showFinance) {
    for (const cfd of companyFinance) {
      const latestDate = cfd.cashPositions[0]?.position_date;
      const staleDays = latestDate ? Math.floor((Date.now() - new Date(latestDate + "T00:00:00").getTime()) / 86400000) : 999;
      if (cfd.cashPositions.length === 0) cashAlerts.push({ title: `${cfd.companyName}: No Data`, value: 0, color: RED });
      else if (staleDays > 1) cashAlerts.push({ title: `${cfd.companyName}: Stale`, value: staleDays, color: RED });
      if (!cfd.cashPlan) cashAlerts.push({ title: `${cfd.companyName}: No Plan`, value: 0, color: AMBER });
    }
  }
  const overdueGuarantees = showFinance ? guaranteeAlerts : [];

  const hasAttention = wv("home.attention_banner", true) && (overdueTasks.length > 0 || waitingReplies.length > 0 || escalations.length > 0 || stuckReceivables.length > 0 || missingPlants.length > 0 || downMachines.length > 0 || cashAlerts.length > 0 || taxUrgent.length > 0 || overdueGuarantees.length > 0);

  const hasCritical = overdueTasks.length > 0 || downMachines.length > 0 || escalations.length > 0 || stuckReceivables.length > 0 || taxOverdue.length > 0 || cashAlerts.length > 0 || overdueGuarantees.length > 0;

  type AttentionItem = { key: string; primary: string; secondary: string; badge?: string | null; taskId?: string; machineId?: string; actionType?: "complete" | "reply" | "resolve" };
  type AttentionRow = { id: string; label: string; count: number; color: string; items: AttentionItem[] };
  const attentionRows: AttentionRow[] = [];
  if (overdueTasks.length > 0) attentionRows.push({
    id: "overdue", label: "Overdue Tasks", count: overdueTasks.length, color: RED,
    items: overdueTasks.map((t) => ({ key: t.id, primary: t.description, secondary: `${t.assigned_to || "Unassigned"} · Due: ${formatDateUK(t.due_date)}`, badge: t.priority, taskId: t.id, actionType: "complete" as const })),
  });
  if (downMachines.length > 0) attentionRows.push({
    id: "machines", label: "Machines Down", count: downMachines.length, color: RED,
    items: downMachines.map((m) => ({ key: m.id, primary: `${m.plant_name} — ${m.machine_name}`, secondary: m.issue_description || "No description", machineId: m.id, actionType: "resolve" as const })),
  });
  if (escalations.length > 0) attentionRows.push({
    id: "escalations", label: "Escalations", count: escalations.length, color: RED,
    items: escalations.map((e) => ({ key: e.sourceLabel, primary: `${e.plantName} — ${e.metric}`, secondary: e.detail })),
  });
  if (stuckReceivables.length > 0) attentionRows.push({
    id: "stuck-receivables", label: "Stuck Receivables", count: stuckReceivables.length, color: RED,
    items: stuckReceivables.map((r) => ({ key: r.key, primary: r.primary, secondary: r.secondary })),
  });
  if (overdueGuarantees.length > 0) attentionRows.push({
    id: "guarantees", label: "Guarantees Overdue", count: overdueGuarantees.length, color: RED,
    items: overdueGuarantees.map((g) => ({
      key: g.id,
      primary: `${g.customer_name} — ${g.guarantee_number} (${g.bank_name})`,
      secondary: `${g.guarantee_type} · PKR ${Math.round(g.amount).toLocaleString()}${g.due_date ? ` · ${g.days_overdue}d overdue` : ""}`,
    })),
  });
  if (waitingReplies.length > 0) attentionRows.push({
    id: "waiting", label: "Waiting Replies", count: waitingReplies.length, color: RED,
    items: waitingReplies.map((t) => ({ key: t.id, primary: t.description, secondary: `${t.assigned_to || "Unassigned"} · Due: ${formatDateUK(t.due_date)}`, badge: t.priority, taskId: t.id, actionType: "reply" as const })),
  });
  if (missingPlants.length > 0) attentionRows.push({
    id: "missing", label: "Plants Not Reported", count: missingPlants.length, color: RED,
    items: missingPlants.map((s) => ({ key: s.plant.id, primary: s.plant.name, secondary: `Type: ${s.plant.type}` })),
  });
  if (taxUrgent.length > 0) attentionRows.push({
    id: "tax", label: "Tax — Needs Review", count: taxUrgent.length, color: taxOverdue.length > 0 ? RED : AMBER,
    items: taxUrgent.map((t) => ({ key: t.id, primary: t.description, secondary: `${t.assigned_to || "Unassigned"} · Due: ${formatDateUK(t.due_date)}`, badge: t.priority, taskId: t.id, actionType: "complete" as const })),
  });
  if (dueThisWeekTasks.length > 0) attentionRows.push({
    id: "dueweek", label: "Due This Week", count: dueThisWeekTasks.length, color: AMBER,
    items: dueThisWeekTasks.map((t) => ({ key: t.id, primary: t.description, secondary: `${t.assigned_to || "Unassigned"} · Due: ${formatDateUK(t.due_date)}`, badge: t.priority, taskId: t.id, actionType: "complete" as const })),
  });
  for (const a of cashAlerts) {
    attentionRows.push({ id: `cash-${a.title}`, label: a.title, count: a.value, color: a.color, items: [] });
  }
  const totalAttentionCount = attentionRows.reduce((s, r) => s + r.count, 0);
  void quickTaskAction;
  void quickMachineResolve;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "stretch", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
        {hasAttention ? (
          <div
            style={{
              flex: 1, minWidth: "260px",
              border: `1px solid ${hasCritical ? DANGER_SOFT : WARNING_SOFT}`,
              borderLeft: `4px solid ${hasCritical ? RED : AMBER}`,
              borderRadius: "8px",
              backgroundColor: hasCritical ? DANGER_SOFT : WARNING_SOFT,
              overflow: "hidden",
            }}
          >
            {/* Row 1 — alerts */}
            <div
              onClick={() => setBannerOpen(!bannerOpen)}
              style={{
                padding: "9px 14px", cursor: "pointer",
                display: "flex", alignItems: "center", gap: "10px",
              }}
            >
              <span style={{ fontSize: "17px", flexShrink: 0 }}>⚠</span>
              <span style={{ fontSize: "15px", fontWeight: 700, color: hasCritical ? RED : AMBER, flexShrink: 0 }}>
                {totalAttentionCount} item{totalAttentionCount > 1 ? "s" : ""} need attention
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", flex: 1, minWidth: 0 }}>
                {attentionRows.slice(0, 3).map((row) => {
                  const isRed = row.color === RED;
                  const softBg = isRed ? COLOURS.DANGER_SOFT : COLOURS.WARNING_SOFT;
                  return (
                  <span key={`chip-${row.id}`} style={{
                    display: "inline-flex", alignItems: "center", gap: "4px",
                    fontSize: "12px", fontWeight: 600, color: row.color,
                    backgroundColor: softBg, borderRadius: "999px", padding: "2px 8px",
                  }}>
                    {row.count} {row.label}
                  </span>
                  );
                })}
                {attentionRows.length > 3 && (
                  <span style={{ fontSize: "12px", color: hasCritical ? RED : AMBER, fontWeight: 600, alignSelf: "center" }}>
                    +{attentionRows.length - 3} more
                  </span>
                )}
              </div>
              <span style={{ fontSize: "13px", color: hasCritical ? RED : AMBER, fontWeight: 700, flexShrink: 0 }}>{bannerOpen ? "▲ Hide" : "▼ Show"}</span>
            </div>
            {/* Row 2 — ops strip */}
            <div style={{
              borderTop: `1px solid ${HAIRLINE}`,
              backgroundColor: CARD_ALT,
              padding: "8px 16px",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 0 }}>
                <span style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: SLATE, marginRight: "14px", flexShrink: 0 }}>OPS TODAY</span>
                <span style={{ fontSize: "11px", color: SLATE }}>Good stock</span>
                <span style={{ fontSize: "14px", fontWeight: 600, fontFamily: "var(--font-mono)", color: NAVY, marginLeft: "4px" }}>{closingGoodStock.toLocaleString()}</span>
                <span style={{ fontSize: "11px", color: HAIRLINE, marginLeft: "12px", marginRight: "4px" }}>·</span>
                <span style={{ fontSize: "11px", color: SLATE }}>Produced</span>
                <span style={{ fontSize: "14px", fontWeight: 600, fontFamily: "var(--font-mono)", color: NAVY, marginLeft: "4px" }}>{produced.toLocaleString()}</span>
                <span style={{ fontSize: "11px", color: HAIRLINE, marginLeft: "12px", marginRight: "4px" }}>·</span>
                <span style={{ fontSize: "11px", color: SLATE }}>Dispatched</span>
                <span style={{ fontSize: "14px", fontWeight: 600, fontFamily: "var(--font-mono)", color: NAVY, marginLeft: "4px" }}>{dispatched.toLocaleString()}</span>
                <span style={{ fontSize: "11px", color: HAIRLINE, marginLeft: "12px", marginRight: "4px" }}>·</span>
                <span style={{ fontSize: "11px", color: SLATE }}>Breakage</span>
                <span style={{ fontSize: "14px", fontWeight: 600, fontFamily: "var(--font-mono)", color: broken > 0 ? RED : NAVY, marginLeft: "4px" }}>{broken.toLocaleString()}</span>
              </div>
              <a href="/dashboard" style={{ fontSize: "11px", color: BLUE, fontWeight: 500, textDecoration: "none", cursor: "pointer", flexShrink: 0, marginLeft: "16px" }}>
                View dashboard →
              </a>
            </div>
          </div>
        ) : (
          <p style={{ color: SLATE, fontSize: "15px", margin: 0, maxWidth: "640px" }}>
            Exceptions surface automatically. If nothing needs your attention, everything is on track.
          </p>
        )}
        <div style={{ backgroundColor: COLOURS.CARD, border: `1px solid ${HAIRLINE}`, borderRadius: RADII.SM, padding: "8px 12px", flexShrink: 0 }}>
          <label style={{ fontWeight: 700, display: "block", marginBottom: "3px", fontSize: "15px", color: SLATE }}>View date</label>
          <DateInputWithCalendar
            value={selectedDate}
            min={minDate}
            max={today}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{ padding: "6px 9px", border: `1px solid ${BORDER}`, borderRadius: "6px", fontSize: "16px" }}
          />
          <div style={{ marginTop: "5px", color: SLATE, fontSize: "15px" }}>
            {selectedMonth} · Q{currentQuarter}
          </div>
          {lastUpdated && (
            <div style={{ marginTop: "5px", color: SLATE, fontSize: "11px" }}>
              Data fetched {formatDateUK(lastUpdated.toISOString().slice(0, 10))} at {lastUpdated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            </div>
          )}
        </div>
      </div>

      {/* ── SECTION 1: NEEDS YOUR ATTENTION (expanded detail) ── */}
      {hasAttention && bannerOpen ? (
        <div style={{
          border: `1px solid ${hasCritical ? DANGER_SOFT : WARNING_SOFT}`,
          borderLeft: `4px solid ${hasCritical ? RED : AMBER}`,
          borderRadius: "8px",
          backgroundColor: hasCritical ? DANGER_SOFT : WARNING_SOFT,
          overflow: "hidden",
          marginBottom: "14px",
        }}>
          <div>
            {attentionRows.map((row) => {
                const isOpen = expandedCard === row.id;
                return (
                  <div key={row.id}>
                    <div
                      onClick={() => row.items.length > 0 ? setExpandedCard(isOpen ? null : row.id) : undefined}
                      style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "9px 16px", cursor: row.items.length > 0 ? "pointer" : "default",
                        backgroundColor: isOpen ? COLOURS.CARD : "transparent",
                        borderBottom: `1px solid ${hasCritical ? DANGER_SOFT : WARNING_SOFT}`,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{
                          width: "24px", height: "24px", borderRadius: "50%",
                          backgroundColor: row.color, color: "white",
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          fontSize: "12px", fontWeight: 700, flexShrink: 0,
                        }}>{row.count}</span>
                        <span style={{ fontSize: "16px", fontWeight: 600, color: NAVY }}>{row.label}</span>
                      </div>
                      {row.items.length > 0 && (
                        <span style={{ fontSize: "15px", color: SLATE }}>{isOpen ? "▼" : "▶"}</span>
                      )}
                    </div>
                    {isOpen && row.items.length > 0 && (
                      <div style={{ backgroundColor: COLOURS.CARD }}>
                        {row.items.map((item) => {
                          const href = item.taskId ? `/tasks?task=${item.taskId}` : undefined;
                          const inner = (
                            <div style={{
                              padding: "8px 16px 8px 48px",
                              borderBottom: `1px solid ${HAIRLINE}`,
                              display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
                              cursor: href ? "pointer" : "default",
                            }}>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontSize: "16px", fontWeight: 600, color: NAVY }}>{item.primary}</div>
                                <div style={{ fontSize: "14px", color: SLATE, marginTop: "1px" }}>{item.secondary}</div>
                              </div>
                              <div style={{ display: "flex", gap: "5px", alignItems: "center", flexShrink: 0 }}>
                                {item.badge && (
                                  <span style={{
                                    fontSize: "11px", fontWeight: 700, padding: "2px 7px", borderRadius: "8px",
                                    backgroundColor: item.badge === "High" || item.badge === "Urgent" ? RED : item.badge === "Medium" ? BLUE : SLATE,
                                    color: "white",
                                  }}>{item.badge}</span>
                                )}
                                <span style={{ fontSize: "15px", color: BLUE, fontWeight: 600 }}>Open →</span>
                              </div>
                            </div>
                          );
                          return href ? (
                            <a key={item.key} href={href} style={{ textDecoration: "none", color: "inherit", display: "block" }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = COLOURS.CARD_ALT; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "transparent"; }}
                            >{inner}</a>
                          ) : (
                            <div key={item.key}>{inner}</div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      ) : null}

      {/* ── CHARTS ROW (exactly 2 items so the grid never wraps to a half-empty row) ── */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
        {dailyOpsData.length > 1 && wv("home.production_trend_chart", true) && (
          <div style={{ ...execCard(NAVY), padding: "14px" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: NAVY, marginBottom: "10px" }}>Daily Production Trend — This Month</div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={dailyOpsData.map((d) => ({ ...d, date: d.date.slice(5) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: SLATE }} />
                <YAxis
                  tick={{ fontSize: 12, fill: SLATE }}
                  domain={[0, (max: number) => Math.ceil(max * 1.15)]}
                  tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : `${v}`}
                />
                <Tooltip />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: "13px" }} />
                <Line type="monotone" dataKey="produced" stroke={GREEN} strokeWidth={2} dot={{ r: 3 }} name="Produced" />
                <Line type="monotone" dataKey="dispatched" stroke={INK_700} strokeWidth={2} dot={{ r: 3 }} name="Dispatched" strokeDasharray="5 3" />
                <Line type="monotone" dataKey="broken" stroke={RED} strokeWidth={2} dot={{ r: 3 }} name="Broken" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {wv("home.receipts_payments_chart", true) && (() => {
          const monthMap = new Map<string, { month: string; receipts: number; payments: number }>();
          for (const cfd of companyFinance) {
            for (const p of cfd.cashPositions) {
              const m = p.position_date.slice(0, 7);
              if (!monthMap.has(m)) monthMap.set(m, { month: m, receipts: 0, payments: 0 });
              monthMap.get(m)!.receipts += p.total_receipts;
              monthMap.get(m)!.payments += p.total_payments;
            }
          }
          const cashData = Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month));
          if (cashData.length === 0) return null;
          const fmt = (v: number) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : `${v}`;

          if (cashData.length < 3) {
            return (
              <div style={{ ...execCard(NAVY), padding: "14px" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: NAVY, marginBottom: "12px" }}>Monthly Receipts vs Payments</div>
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "14px", height: "220px" }}>
                  {cashData.map((m) => (
                    <div key={m.month}>
                      <div style={{ fontSize: "13px", color: SLATE, marginBottom: "6px", fontWeight: 600 }}>{m.month}</div>
                      <div style={{ display: "flex", gap: "16px" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: "11px", color: SLATE }}>Receipts</div>
                          <div style={{ fontSize: "24px", fontWeight: 600, color: GREEN, lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>PKR {fmt(m.receipts)}</div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: "11px", color: SLATE }}>Payments</div>
                          <div style={{ fontSize: "24px", fontWeight: 600, color: RED, lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>PKR {fmt(m.payments)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div style={{ fontSize: "12px", color: SLATE, fontStyle: "italic" }}>Chart appears once 3+ months of data are available.</div>
                </div>
              </div>
            );
          }

          return (
            <div style={{ ...execCard(NAVY), padding: "14px" }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: NAVY, marginBottom: "10px" }}>Monthly Receipts vs Payments</div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={cashData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: SLATE }} />
                  <YAxis tick={{ fontSize: 12, fill: SLATE }} tickFormatter={fmt} />
                  <Tooltip formatter={(value) => `PKR ${Number(value).toLocaleString()}`} />
                  <Legend iconType="plainline" wrapperStyle={{ fontSize: "13px" }} />
                  <Line type="monotone" dataKey="receipts" stroke={GREEN} strokeWidth={2} dot={{ r: 4 }} name="Receipts" />
                  <Line type="monotone" dataKey="payments" stroke={RED} strokeWidth={2} dot={{ r: 4 }} name="Payments" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          );
        })()}
      </div>

      {/* ── CASH FLOW WATERFALL (full-width, separate row so the 2-col charts grid above never wraps) ── */}
      {wv("home.cash_flow_waterfall", true) && (() => {
        const waterfallData: { company: string; opening: number; receipts: number; payments: number; postDated: number; closing: number }[] = [];
        for (const cfd of companyFinance) {
          const latest = cfd.cashPositions[0];
          if (!latest) continue;
          waterfallData.push({
            company: cfd.companyName, opening: latest.opening_balance, receipts: latest.total_receipts,
            payments: latest.total_payments, postDated: latest.post_dated_total, closing: latest.closing_balance,
          });
        }
        if (waterfallData.length === 0) return null;
        return (
          <div style={{ ...execCard(NAVY), padding: "24px", marginBottom: "12px" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 500, color: SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "16px", fontFamily: "var(--font-sans, Inter, sans-serif)" }}>Cash Flow Waterfall — Latest Day</div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : `repeat(${waterfallData.length}, 1fr)`, gap: "24px" }}>
              {waterfallData.map((w) => {
                const maxVal = Math.max(Math.abs(w.opening), Math.abs(w.receipts), Math.abs(w.payments), Math.abs(w.postDated), Math.abs(w.closing), 1);
                const barHeight = (v: number) => Math.max(6, (Math.abs(v) / maxVal) * 120);
                const items = [
                  { label: "Opening", value: w.opening, color: COLOURS.BLUE },
                  { label: "Receipts", value: w.receipts, color: COLOURS.GREEN },
                  { label: "Payments", value: -w.payments, color: COLOURS.RED },
                  { label: "Post-dated", value: -w.postDated, color: COLOURS.AMBER },
                  { label: "Closing", value: w.closing, color: COLOURS.NAVY },
                ];
                return (
                  <div key={w.company}>
                    <div style={{
                      fontSize: "13px", fontWeight: 500, color: NAVY, marginBottom: "14px",
                      lineHeight: 1.25, minHeight: "20px",
                    }}>{w.company}</div>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: "8px", height: "160px" }}>
                      {items.map((item) => (
                        <div key={item.label} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <div style={{
                            fontSize: "9.5px", fontWeight: 500, color: item.color, marginBottom: "4px",
                            textAlign: "center", lineHeight: 1.2, height: "26px",
                            display: "flex", alignItems: "flex-end", justifyContent: "center",
                            wordBreak: "break-word", width: "100%",
                          }}>
                            {item.value >= 0 ? "" : "−"}{fmtMoney(Math.abs(item.value))}
                          </div>
                          <div style={{ width: "100%", maxWidth: "40px", height: `${barHeight(item.value)}px`, backgroundColor: item.color, borderRadius: "4px 4px 0 0", opacity: 0.55 }} />
                          <div style={{ fontSize: "9.5px", color: SLATE, marginTop: "6px", textAlign: "center" }}>{item.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── FINANCE ── */}
      {showFinance && companyFinance.length === 2 && wv("home.company_comparison", true) && (() => {
        const [a, b] = companyFinance;
        const latestA = a.cashPositions[0];
        const latestB = b.cashPositions[0];
        const metrics = [
          { label: "Cash Balance", a: latestA?.closing_balance ?? 0, b: latestB?.closing_balance ?? 0 },
          { label: "Today Receipts", a: latestA?.total_receipts ?? 0, b: latestB?.total_receipts ?? 0 },
          { label: "Today Payments", a: latestA?.total_payments ?? 0, b: latestB?.total_payments ?? 0 },
        ];
        const maxVal = Math.max(...metrics.map((m) => Math.max(Math.abs(m.a), Math.abs(m.b))), 1);
        return (
          <div style={{ ...execCard(NAVY), padding: "24px", marginBottom: "12px" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 500, color: SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "16px", fontFamily: "var(--font-sans, Inter, sans-serif)" }}>Company Comparison</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
              <span style={{ fontSize: "12px", fontWeight: 600, color: BLUE }}>{a.companyName.split(" ")[0]}</span>
              <span style={{ fontSize: "12px", fontWeight: 600, color: GREEN }}>{b.companyName.split(" ")[0]}</span>
            </div>
            {metrics.map((m) => {
              const pctA = maxVal > 0 ? (Math.abs(m.a) / maxVal) * 100 : 0;
              const pctB = maxVal > 0 ? (Math.abs(m.b) / maxVal) * 100 : 0;
              return (
                <div key={m.label} style={{ marginBottom: "12px" }}>
                  <div style={{ fontSize: "10.5px", color: SLATE, textAlign: "center", marginBottom: "6px", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 500 }}>{m.label}</div>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <span style={{ fontSize: "12px", color: BLUE, width: "70px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(m.a)}</span>
                    <div style={{ flex: 1, display: "flex", height: "18px", gap: "2px" }}>
                      <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
                        <div style={{ width: `${pctA}%`, backgroundColor: BLUE, borderRadius: "4px 0 0 4px", minWidth: pctA > 0 ? "3px" : 0, opacity: 0.7 }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ width: `${pctB}%`, backgroundColor: GREEN, borderRadius: "0 4px 4px 0", minWidth: pctB > 0 ? "3px" : 0, opacity: 0.7 }} />
                      </div>
                    </div>
                    <span style={{ fontSize: "12px", color: GREEN, width: "70px", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(m.b)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}
      {showFinance && wv("home.finance_by_company", true) && companyFinance.map((cfd) => (
        <CompanyFinancePanel key={cfd.companyId} data={cfd} ctx={ctx} />
      ))}

      {/* ── RECEIVABLES ── */}
      {/* Receivable bills are tied to a production plant_id, which only
          exists for Unze Trading (UTPL) — Imperial Footwear has no
          equivalent, so this is scope-gated rather than a toggle default. */}
      {!!ctx && (financeCompanies(ctx) === "both" || financeCompanies(ctx) === "UTPL") && wv("home.receivables", true) && (<>
      <SectionTitle title="Receivables — Bills in Progress" />
      {receivableRows.length === 0 ? (
        <p style={{ color: SLATE, fontSize: "13px" }}>No receivable bills in progress.</p>
      ) : (
        <div style={panelCard(recRed > 0)}>
          <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "10px", color: NAVY }}>
            Receivables: <span style={{ color: recRed > 0 ? RED : GREEN }}>{recRed > 0 ? `${recRedCount} BILL(S) STUCK` : "ALL ON TRACK"}</span>
          </div>
          <div style={miniGrid}>
            <Mini label="Total Tracked" value={fmtMoney(recTotal)} color={BLUE} />
            <Mini label="On Time" value={fmtMoney(recGreen)} color={GREEN} />
            <Mini label="Due Soon" value={fmtMoney(recAmber)} color={AMBER} />
            <Mini label="Stuck" value={fmtMoney(recRed)} color={RED} />
          </div>
          <div style={{ fontSize: "13px", color: NAVY, marginTop: "4px", marginBottom: "8px", lineHeight: "1.6" }}>
            <span style={{ fontWeight: 700 }}>Aging:</span>{" "}
            <span style={{ color: GREEN }}>PKR {fmtMoney(recAgingTotals["0-30"])} (0-30d)</span>{" · "}
            <span style={{ color: AMBER }}>PKR {fmtMoney(recAgingTotals["31-60"])} (31-60d)</span>{" · "}
            <span style={{ color: RED }}>PKR {fmtMoney(recAgingTotals["61-90"])} (61-90d)</span>{" · "}
            <span style={{ color: RED, fontWeight: 700 }}>PKR {fmtMoney(recAgingTotals["90+"])} (90+d)</span>
          </div>
          {recAgingByCustomer.length > 0 && (
            <div style={{ overflowX: "auto", marginBottom: "8px" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "380px" }}>
                <thead>
                  <tr>
                    <th style={th}>Customer</th>
                    <th style={{ ...th, textAlign: "right" }}>0-30d</th>
                    <th style={{ ...th, textAlign: "right" }}>31-60d</th>
                    <th style={{ ...th, textAlign: "right" }}>61-90d</th>
                    <th style={{ ...th, textAlign: "right" }}>90+d</th>
                  </tr>
                </thead>
                <tbody>
                  {recAgingByCustomer.map((r) => {
                    const maxAmt = Math.max(...recAgingByCustomer.map((c) => Math.max(c["0-30"], c["31-60"], c["61-90"], c["90+"])), 1);
                    return (
                      <tr key={r.customer}>
                        <td style={tdBold}>{r.customer}</td>
                        {(["0-30", "31-60", "61-90", "90+"] as const).map((bucket) => {
                          const amt = r[bucket];
                          const intensity = amt > 0 ? Math.max(0.08, Math.min(0.5, amt / maxAmt)) : 0;
                          const bgColor = bucket === "0-30" ? `rgba(15,123,95,${intensity})` : bucket === "31-60" ? `rgba(180,121,31,${intensity})` : `rgba(179,38,30,${intensity})`;
                          return (
                            <td key={bucket} style={{ ...td, textAlign: "right", backgroundColor: amt > 0 ? bgColor : "transparent", fontWeight: amt > 0 ? 600 : 400 }}>
                              {amt > 0 ? fmtMoney(amt) : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {receivableRows.length > 0 && (
            <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", width: "100%", marginTop: "12px", minWidth: "420px" }}>
              <thead>
                <tr>
                  <th style={th}>Customer</th><th style={th}>On Time</th><th style={th}>Due Soon</th><th style={th}>Stuck</th><th style={th}>Total</th>
                </tr>
              </thead>
              <tbody>
                {receivableRows.map((r) => (
                  <tr key={r.customer}>
                    <td style={tdBold}>{r.customer}</td>
                    <td style={{ ...td, color: GREEN }}>{fmtMoney(r.greenAmount)}</td>
                    <td style={{ ...td, color: AMBER }}>{fmtMoney(r.amberAmount)}</td>
                    <td style={{ ...td, color: RED }}>{fmtMoney(r.redAmount)}</td>
                    <td style={td}>{fmtMoney(r.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}
      </>)}

      {/* ── BANK FACILITIES ── */}
      {showFinance && facilitySynopsis.length > 0 && wv("home.bank_facilities", true) && (
        <>
          <SectionTitle title="Bank Facilities" />
          <div style={{ border: `1px solid ${HAIRLINE}`, borderRadius: "14px", overflow: "hidden", marginBottom: "12px", backgroundColor: COLOURS.CARD }}>
            {facilitySynopsis.map((b, bi) => {
              const pct = b.bank_utilisation_pct;
              const barColor = pct >= 90 ? RED : pct >= 70 ? AMBER : GREEN;
              return (
                <div key={b.bank_name} style={{
                  padding: "24px",
                  borderBottom: bi < facilitySynopsis.length - 1 ? `1px solid ${HAIRLINE}` : "none",
                }}>
                  {/* Bank name + overdue chip */}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
                    <div style={{ fontSize: "10.5px", fontWeight: 500, color: SLATE, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "var(--font-sans, Inter, sans-serif)" }}>{b.bank_name}</div>
                    {b.overdue_count > 0 && (
                      <span style={{ fontSize: "10.5px", fontWeight: 600, color: RED, backgroundColor: DANGER_SOFT, padding: "2px 8px", borderRadius: "999px" }}>
                        {b.overdue_count} overdue
                      </span>
                    )}
                  </div>
                  {/* Utilisation figure */}
                  <div style={{ display: "flex", gap: "24px", marginBottom: "14px", flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: "10px", color: SLATE, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500, marginBottom: "4px" }}>Utilisation</div>
                      <div style={{ fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontSize: "36px", fontWeight: 600, color: barColor, lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{pct}%</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "10px", color: SLATE, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500, marginBottom: "4px" }}>Available</div>
                      <div style={{ fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontSize: "36px", fontWeight: 600, color: GREEN, lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>PKR {Math.round(b.bank_available).toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "10px", color: SLATE, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500, marginBottom: "4px" }}>Seized</div>
                      <div style={{ fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontSize: "36px", fontWeight: 600, color: RED, lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>PKR {Math.round(b.bank_seized).toLocaleString()}</div>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div style={{ height: "6px", borderRadius: "3px", backgroundColor: COLOURS.HAIRLINE, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, backgroundColor: barColor, borderRadius: "3px" }} />
                  </div>
                  <div style={{ fontSize: "11px", color: SLATE, marginTop: "6px" }}>
                    Limit: PKR {Math.round(b.bank_total_limit).toLocaleString()} · {b.active_guarantees} active guarantee{b.active_guarantees !== 1 ? "s" : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── TAX COMPLIANCE SUMMARY ── */}
      {taxSummaryYear !== "" && wv("home.tax_compliance", true) && (
        <>
          <SectionTitle title="Tax Compliance" />
          <TaxComplianceSummary
          scheduleEntries={taxScheduleEntries}
          returnFilings={taxReturnFilings}
          selectedYear={taxSummaryYear}
          signoffs={taxSignoffs.size > 0 ? taxSignoffs : undefined}
          scheduleEntries2={taxScheduleEntries2.size > 0 ? taxScheduleEntries2 : undefined}
          returnFilings2={taxReturnFilings2.size > 0 ? taxReturnFilings2 : undefined}
          selectedYear2={taxSummaryYear2 || undefined}
          signoffs2={taxSignoffs2.size > 0 ? taxSignoffs2 : undefined}
          onClick={() => { window.location.href = "/accounts-tax"; }}
        />
        </>
      )}

      {/* ── INVESTMENTS ── */}
      {investmentData && wv("home.investments", true) && (
        <>
          <SectionTitle title="Investments — PSX Portfolio" />
          <a href="/investments" style={{ textDecoration: "none", display: "block" }}>
            <div style={{
              ...execCard(investmentData.gainLoss >= 0 ? GREEN : RED),
              marginBottom: "12px",
              cursor: "pointer",
            }}
            >
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: "16px", marginBottom: investmentData.losers.length > 0 ? "16px" : "0" }}>
                <div>
                  <div style={{ fontSize: "10.5px", color: SLATE, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px", fontFamily: "var(--font-sans, Inter, sans-serif)" }}>Invested</div>
                  <div style={{ fontSize: "28px", fontWeight: 600, color: NAVY, lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>Rs {fmtMoney(investmentData.totalCost)}</div>
                </div>
                <div>
                  <div style={{ fontSize: "10.5px", color: SLATE, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px", fontFamily: "var(--font-sans, Inter, sans-serif)" }}>Current Value</div>
                  <div style={{ fontSize: "28px", fontWeight: 600, color: BLUE, lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>Rs {fmtMoney(investmentData.totalValue)}</div>
                </div>
                <div>
                  <div style={{ fontSize: "10.5px", color: SLATE, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px", fontFamily: "var(--font-sans, Inter, sans-serif)" }}>Gain / Loss</div>
                  <div style={{ fontSize: "28px", fontWeight: 600, color: investmentData.gainLoss >= 0 ? GREEN : RED, lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>
                    {investmentData.gainLoss >= 0 ? "+" : ""}Rs {fmtMoney(Math.abs(investmentData.gainLoss))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "10.5px", color: SLATE, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px", fontFamily: "var(--font-sans, Inter, sans-serif)" }}>Return</div>
                  <div style={{ fontSize: "28px", fontWeight: 600, color: investmentData.gainLossPct >= 0 ? GREEN : RED, lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>
                    {investmentData.gainLossPct >= 0 ? "+" : ""}{investmentData.gainLossPct.toFixed(2)}%
                  </div>
                </div>
              </div>
              {investmentData.losers.length > 0 && (
                <div style={{ borderTop: `1px solid ${DANGER_SOFT}`, paddingTop: "8px", fontSize: "13px", color: RED }}>
                  <span style={{ fontWeight: 700 }}>{investmentData.losers.length} stock{investmentData.losers.length > 1 ? "s" : ""} down &gt;5%:</span>{" "}
                  {investmentData.losers.map((l, i) => (
                    <span key={l.ticker}>{i > 0 ? ", " : ""}{l.ticker} ({l.pct.toFixed(1)}%)</span>
                  ))}
                </div>
              )}
              <div style={{ fontSize: "13px", color: SLATE, marginTop: "6px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                {investmentData.priceDate && (
                  <span>{investmentData.stockCount} stocks · Prices as of {formatDateUK(investmentData.priceDate)} · Click to view portfolio →</span>
                )}
                {investmentData.dividendCount > 0 && (
                  <span style={{
                    fontSize: "12px", fontWeight: 700,
                    backgroundColor: COLOURS.AMBER, color: "white",
                    padding: "2px 9px", borderRadius: "10px",
                  }}>
                    {investmentData.dividendCount} dividend{investmentData.dividendCount > 1 ? "s" : ""} due this week
                  </span>
                )}
              </div>
            </div>
          </a>
        </>
      )}

      {/* ── UK PENSION — AVIVA ── */}
      {pensionSummary && wv("home.uk_pension", true) && (
        <div
          onClick={() => { window.location.href = "/investments"; }}
          style={{
            backgroundColor: COLOURS.CARD,
            border: `1px solid ${HAIRLINE}`,
            borderTop: `3px solid ${NAVY}`,
            borderRadius: RADII.CARD,
            padding: "14px 18px",
            cursor: "pointer",
            marginBottom: "12px",
          }}
        >
          <div style={{ fontSize: "10.5px", fontWeight: 500, color: SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" }}>
            UK Pension — Aviva
          </div>
          <div style={{ fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontSize: "28px", fontWeight: 600, color: NAVY, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", lineHeight: 1, marginBottom: "4px" }}>
            £{pensionSummary.gbp.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </div>
          <div style={{ fontSize: "12px", color: SLATE, marginBottom: "12px" }}>
            PKR {Math.round(pensionSummary.pkr).toLocaleString("en-PK")} · 2 Aviva funds
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "10px" }}>
            {/* Row 1: Net gain */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: "11px", color: SLATE }}>Net gain</div>
              <div style={{ fontSize: "13px", fontWeight: 600, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", color: pensionSummary.netGain >= 0 ? COLOURS.GREEN : COLOURS.RED }}>
                {pensionSummary.netGain >= 0 ? "+" : ""}£{Math.abs(pensionSummary.netGain).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </div>
            </div>
            {/* Row 2: Total return */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: "11px", color: SLATE }}>Total return</div>
              <div style={{ fontSize: "13px", fontWeight: 600, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", color: pensionSummary.totalReturn >= 0 ? COLOURS.GREEN : COLOURS.RED }}>
                {pensionSummary.totalReturn >= 0 ? "+" : ""}{pensionSummary.totalReturn.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
              </div>
            </div>
            {/* Row 3: Contributed */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: "11px", color: SLATE }}>Contributed</div>
              <div style={{ fontSize: "13px", fontWeight: 600, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", color: COLOURS.NAVY }}>
                £{pensionSummary.contributed.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </div>
            </div>
            {/* Row 4: Fees paid */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: "11px", color: SLATE }}>Fees paid</div>
              <div style={{ fontSize: "13px", fontWeight: 600, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", color: COLOURS.RED }}>
                £{pensionSummary.feesPaid.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── FOLDER-IT ── */}
      {/* Khuram: "a long card just like the investment size, where you
          show me number of approvals outstanding, company name and
          number of documents not filed keep it brief and within one
          card." Same execCard shell as Investments — one stat up top
          (approvals outstanding, personal), then a brief per-company
          "not filed" breakdown below it, all in a single card. */}
      {folderitSummary && wv("home.folderit", true) && (
        <>
          <SectionTitle title="Folder-it" />
          <a href="/folderit" style={{ textDecoration: "none", display: "block" }}>
            <div style={{ ...execCard(AMBER), marginBottom: "12px", cursor: "pointer" }}>
              <div style={{ fontSize: "10.5px", color: SLATE, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px", fontFamily: "var(--font-sans, Inter, sans-serif)" }}>
                Pending My Approval
              </div>
              <div style={{ fontSize: "28px", fontWeight: 600, color: folderitSummary.pendingApproval > 0 ? AMBER : SLATE, lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>
                {folderitSummary.pendingApproval}
              </div>

              {folderitCompanyBreakdown.length > 0 && (
                <div style={{ borderTop: `1px solid ${HAIRLINE}`, marginTop: "16px", paddingTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  {FOLDERIT_HOME_CARD_COMPANIES.map((c) => {
                    const row = folderitCompanyBreakdown.find((r) => r.group_key === c.groupKey);
                    const count = row?.inbox_count ?? 0;
                    return (
                      <div key={c.groupKey} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: c.colour, flexShrink: 0 }} />
                          <span style={{ fontSize: "13px", color: NAVY, fontWeight: 500 }}>{c.label}</span>
                        </div>
                        <span style={{ fontSize: "13px", fontWeight: 600, color: count > 0 ? c.colour : SLATE, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)" }}>
                          {count} not filed
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ fontSize: "13px", color: SLATE, marginTop: "12px" }}>Click to view Folder-it →</div>
            </div>
          </a>
        </>
      )}

      {/* ── DEPARTMENT SCORECARD ── */}
      {wv("home.department_scorecard", true) && (<>
      <SectionTitle title="Department Scorecard" />
      <div style={{ border: `1px solid ${HAIRLINE}`, borderRadius: "14px", overflow: "hidden", marginBottom: "12px", backgroundColor: COLOURS.CARD }}>
        {scorecardRows.map((d, i) => {
          const statusColor = d.status === "GREEN" ? GREEN : d.status === "AMBER" ? AMBER : RED;
          const softBg = d.status === "GREEN" ? COLOURS.SUCCESS_SOFT : d.status === "AMBER" ? COLOURS.WARNING_SOFT : COLOURS.DANGER_SOFT;
          const isLegalStub = d.title === "Legal" && d.owner === "Not yet built";
          const hasPerf = !!d.perf && d.perf.total > 0;
          const inner = (
            <div style={{
              display: "flex", alignItems: "center", gap: "12px",
              padding: "12px 16px",
              borderBottom: i < scorecardRows.length - 1 ? `1px solid ${HAIRLINE}` : "none",
            }}>
              {/* Left status dot */}
              <span style={{
                width: "8px", height: "8px", borderRadius: "50%",
                backgroundColor: statusColor, flexShrink: 0,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13px", fontWeight: 500, color: NAVY }}>{d.title}</div>
                {d.owner && d.owner !== "—" && (
                  <div style={{ fontSize: "11px", color: SLATE, marginTop: "2px" }}>{d.owner}</div>
                )}
              </div>
              {/* Task counts */}
              {hasPerf && (
                <span style={{ fontSize: "12px", color: SLATE, flexShrink: 0 }}>
                  <span style={{ color: d.perf!.red > 0 ? RED : SLATE }}>{d.perf!.red}↑</span>
                  {" / "}
                  <span style={{ color: d.perf!.amber > 0 ? AMBER : SLATE }}>{d.perf!.amber} active</span>
                </span>
              )}
              {/* Right soft chip */}
              <span style={{
                fontSize: "10.5px", fontWeight: 600, color: statusColor, flexShrink: 0,
                padding: "3px 8px", borderRadius: "999px", backgroundColor: softBg,
                letterSpacing: "0.04em",
              }}>{d.status}</span>
            </div>
          );
          return isLegalStub ? (
            <div key={d.slug} style={{ opacity: 0.55 }}>{inner}</div>
          ) : (
            <a key={d.slug} href={`/department/${d.slug}`} style={{ textDecoration: "none", color: "inherit", display: "block", transition: "background-color 0.12s" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = COLOURS.CARD_ALT; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
            >{inner}</a>
          );
        })}
      </div>

      <DrillDownPerformance departmentRows={departmentRows} deptPeopleMap={deptPeopleMap} />
      </>)}
    </>
  );
}

/* ───────────────────────── Design system — exec dashboard ───────────────────────── */
// Type scale: title=13px/700, headline=24px/800, body=13px/400, caption=11px/400
// Card style: white bg, 1px border, 3px colour top accent, 8px radius, 12px 14px padding
// All gaps: 12px. Operations grid: 3-col desktop, 2-col mobile.

function execCard(accentColor: string, extra?: React.CSSProperties): React.CSSProperties {
  return {
    border: `1px solid ${HAIRLINE}`,
    borderTop: `3px solid ${accentColor}`,
    borderRadius: "14px",
    padding: "24px",
    backgroundColor: COLOURS.CARD,
    ...extra,
  };
}

const miniGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: "16px",
  marginBottom: "8px",
};

function panelCard(red: boolean): React.CSSProperties {
  return execCard(red ? RED : GREEN, { marginBottom: "4px" });
}

function panelCardRAG(status: RAGStatus): React.CSSProperties {
  return execCard(ragColour(status), { marginBottom: "4px" });
}
void panelCardRAG;

const th: React.CSSProperties = {
  textAlign: "left",
  borderBottom: `1px solid ${HAIRLINE}`,
  padding: "10px 16px",
  fontSize: "10.5px",
  fontWeight: 500,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: SLATE,
  backgroundColor: CARD_ALT,
  fontFamily: "var(--font-sans, Inter, sans-serif)",
};

const td: React.CSSProperties = {
  borderBottom: `1px solid ${HAIRLINE}`,
  padding: "10px 16px",
  fontSize: "13px",
  fontVariantNumeric: "tabular-nums",
  fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
};

const tdBold: React.CSSProperties = {
  ...td,
  fontWeight: 500,
  color: NAVY,
  fontFamily: "var(--font-sans, Inter, sans-serif)",
};

/* ───────────────────────── Small shared components ───────────────────────── */

function Card({ title, value, color, onClick, href, muted, caption }: { title: string; value: number; color: string; onClick?: () => void; href?: string; muted?: boolean; caption?: string }) {
  const isClickable = !!(onClick || href);
  const isZero = value === 0;
  const effectiveMuted = !!muted;
  const displayColor = effectiveMuted ? SLATE : color;
  const content = (
    <div style={{
      ...execCard(effectiveMuted ? HAIRLINE : color),
      backgroundColor: effectiveMuted ? COLOURS.CARD_ALT : COLOURS.CARD,
      cursor: isClickable ? "pointer" : "default",
      transition: "box-shadow 0.15s",
    }}
    onClick={onClick}
    onMouseEnter={isClickable ? (e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 8px rgba(15,23,32,0.08)"; } : undefined}
    onMouseLeave={isClickable ? (e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "none"; } : undefined}
    >
      <div style={{ color: SLATE, fontSize: "10.5px", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "10px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "var(--font-sans, Inter, sans-serif)" }}>
        {title} {isClickable && <span>→</span>}
      </div>
      <div style={{ fontSize: "44px", fontWeight: 600, color: displayColor, lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>{value.toLocaleString()}</div>
      {caption && isZero && (
        <div style={{ fontSize: "11px", color: SLATE, marginTop: "6px" }}>{caption}</div>
      )}
    </div>
  );

  if (href) {
    return <a href={href} style={{ textDecoration: "none" }}>{content}</a>;
  }
  return content;
}

function DetailPanel({ title, children, onClose, linkHref, linkLabel }: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  linkHref?: string;
  linkLabel?: string;
}) {
  return (
    <div style={{
      border: `1px solid ${HAIRLINE}`,
      borderRadius: RADII.CARD,
      backgroundColor: COLOURS.CARD,
      marginBottom: "14px",
      overflow: "hidden",
    }}>
      <div style={{
        padding: "10px 14px",
        backgroundColor: COLOURS.CARD_ALT,
        borderBottom: `1px solid ${HAIRLINE}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <span style={{ fontSize: "16px", fontWeight: 700, color: NAVY }}>{title}</span>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {linkHref && (
            <a href={linkHref} style={{ fontSize: "16px", color: BLUE, fontWeight: 600, textDecoration: "none" }}>
              {linkLabel || "View all"} →
            </a>
          )}
          <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${HAIRLINE}`, borderRadius: RADII.XS, padding: "4px 10px", fontSize: "16px", color: SLATE, cursor: "pointer" }}>
            Close
          </button>
        </div>
      </div>
      <div style={{ maxHeight: "300px", overflowY: "auto" }}>
        {children}
      </div>
    </div>
  );
}
void DetailPanel;

function DetailRow({ primary, secondary, badge }: { primary: string; secondary?: string; badge?: string | null }) {
  return (
    <div style={{ padding: "9px 14px", borderBottom: `1px solid ${HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "15px", fontWeight: 600, color: NAVY }}>{primary}</div>
        {secondary && <div style={{ fontSize: "16px", color: SLATE, marginTop: "2px" }}>{secondary}</div>}
      </div>
      {badge && (
        <span style={{
          fontSize: "12px", fontWeight: 700, padding: "2px 8px", borderRadius: "10px", whiteSpace: "nowrap", flexShrink: 0,
          backgroundColor: badge === "High" || badge === "Urgent" ? RED : badge === "Medium" ? BLUE : SLATE,
          color: "white",
        }}>
          {badge}
        </span>
      )}
    </div>
  );
}
void DetailRow;

function Mini({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ color: SLATE, fontSize: "10.5px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px", fontFamily: "var(--font-sans, Inter, sans-serif)" }}>{label}</div>
      <div style={{ fontSize: "24px", fontWeight: 600, color, lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>{value}</div>
    </div>
  );
}

function SlimAlert({ color, text }: { color: string; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", backgroundColor: COLOURS.CARD, border: `1px solid ${HAIRLINE}`, borderTop: `3px solid ${color}`, borderRadius: RADII.CARD, padding: "10px 14px", marginBottom: "12px" }}>
      <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: color, flexShrink: 0 }} />
      <span style={{ fontSize: "13px", color: NAVY }}>{text}</span>
    </div>
  );
}
void SlimAlert;

function DrillDownPerformance({ departmentRows, deptPeopleMap }: { departmentRows: PerformanceRow[]; deptPeopleMap: Map<string, PerformanceRow[]> }) {
  const [selectedDept, setSelectedDept] = useState<string | null>(null);

  if (departmentRows.length === 0) return <p style={{ color: SLATE, fontSize: "13px" }}>No task data yet.</p>;

  const chartData = departmentRows.map((d) => ({
    name: d.name.length > 16 ? d.name.slice(0, 14) + "…" : d.name,
    fullName: d.name,
    Overdue: d.red,
    "In Progress": d.amber,
    Completed: d.green,
  }));

  const selectedPeople = selectedDept ? (deptPeopleMap.get(selectedDept) || []).filter((p) => p.total > 0) : [];

  return (
    <div style={{ ...execCard(NAVY), overflow: "hidden", marginBottom: "12px", padding: 0 }}>
      <div style={{ padding: "24px" }}>
        <div style={{ fontSize: "10.5px", fontWeight: 500, color: SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "16px", fontFamily: "var(--font-sans, Inter, sans-serif)" }}>Task Load by Department — click a bar to drill down</div>
        <div style={{ minHeight: "220px" }}>
        <ResponsiveContainer width="100%" height={Math.max(220, departmentRows.length * 46)}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20, top: 0, bottom: 0 }} onClick={(state: unknown) => { const s = state as { activePayload?: { payload?: { fullName?: string } }[] }; const fn = s?.activePayload?.[0]?.payload?.fullName; if (fn) setSelectedDept(selectedDept === fn ? null : fn); }}>
            <CartesianGrid strokeDasharray="3 3" stroke={HAIRLINE} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 12, fill: SLATE }} />
            <YAxis dataKey="name" type="category" tick={{ fontSize: 12, fill: SLATE, fontWeight: 500 }} width={130} />
            <Tooltip />
            <Legend iconType="square" wrapperStyle={{ fontSize: "12px", color: SLATE }} />
            <Bar dataKey="Overdue" stackId="a" fill={RED} radius={[0, 0, 0, 0]} cursor="pointer" name="Overdue" opacity={0.75} />
            <Bar dataKey="In Progress" stackId="a" fill={AMBER} cursor="pointer" name="In Progress" opacity={0.75} />
            <Bar dataKey="Completed" stackId="a" fill={GREEN} radius={[0, 4, 4, 0]} cursor="pointer" name="Completed" opacity={0.75} />
          </BarChart>
        </ResponsiveContainer>
        </div>
      </div>

      {selectedDept && selectedPeople.length > 0 && (
        <div style={{ borderTop: `1px solid ${HAIRLINE}`, padding: "10px 14px", backgroundColor: COLOURS.CARD_ALT }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "13px", fontWeight: 700, color: NAVY }}>{selectedDept} — People</span>
            <button onClick={() => setSelectedDept(null)} style={{ background: "transparent", border: `1px solid ${HAIRLINE}`, borderRadius: RADII.XS, padding: "3px 10px", fontSize: "13px", color: SLATE, cursor: "pointer" }}>Close</button>
          </div>
          {selectedPeople.map((person) => (
            <div key={person.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: `1px solid ${HAIRLINE}` }}>
              <span style={{ fontSize: "13px", fontWeight: 700, color: NAVY }}>{person.name}</span>
              <div style={{ display: "flex", gap: "10px", fontSize: "13px", fontWeight: 700 }}>
                {person.red > 0 && <span style={{ color: RED }}>{person.red} overdue</span>}
                {person.amber > 0 && <span style={{ color: AMBER }}>{person.amber} active</span>}
                {person.green > 0 && <span style={{ color: GREEN }}>{person.green} done</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PerformanceTable({ rows }: { rows: PerformanceRow[] }) {
  if (rows.length === 0) return <p style={{ color: SLATE, fontSize: "13px" }}>No task data yet.</p>;
  return (
    <div style={{ overflowX: "auto", marginBottom: "12px", backgroundColor: COLOURS.CARD, border: `1px solid ${HAIRLINE}`, borderRadius: RADII.CARD }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={th}>Name</th><th style={th}>Red</th><th style={th}>Amber</th><th style={th}>Green</th><th style={th}>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td style={tdBold}>{r.name}</td>
              <td style={{ ...td, color: RED, fontWeight: 700 }}>{r.red}</td>
              <td style={{ ...td, color: AMBER, fontWeight: 700 }}>{r.amber}</td>
              <td style={{ ...td, color: GREEN, fontWeight: 700 }}>{r.green}</td>
              <td style={td}>{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
void PerformanceTable;

function CompanyFinancePanel({ data, ctx }: { data: CompanyFinanceData; ctx: UserCtx | null }) {
  // Per-company widget visibility — see app/lib/widgetRegistry.ts
  // (perCompany: true entries). Same base key across every company, keyed
  // by companyId at the call site so one entry in the registry covers
  // UTPL, IFPL, and any company added later with no code change.
  const wv = (baseKey: string, defaultVisible: boolean) =>
    !!ctx && widgetVisible(ctx, `${baseKey}.${data.companyId}`, defaultVisible);
  const financeMonth = formatDate(new Date()).slice(0, 7);
  const monthPositions = data.cashPositions.filter((p) => p.position_date.slice(0, 7) === financeMonth);
  const actualReceiptsMTD = monthPositions.reduce((s, p) => s + p.total_receipts, 0);
  const actualPaymentsMTD = monthPositions.reduce((s, p) => s + p.total_payments, 0);
  const latest = data.cashPositions[0] || null;
  const plannedRecv = data.cashPlan?.tentative_receivables || 0;
  const plannedPay = data.cashPlan?.tentative_payouts || 0;
  const openAmt = data.cashOpening?.opening_amount || 0;
  const projected = openAmt + plannedRecv - plannedPay;

  const now = new Date();
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const de = now.getDate();
  const expRecv = plannedRecv > 0 ? (plannedRecv / dim) * de : 0;
  const recvPct = expRecv > 0 ? (actualReceiptsMTD / expRecv) * 100 : 100;
  const recvStatus: RAGStatus = recvPct >= 95 ? "GREEN" : recvPct >= 85 ? "AMBER" : "RED";
  const expPay = plannedPay > 0 ? (plannedPay / dim) * de : 0;
  const payPct = expPay > 0 ? (actualPaymentsMTD / expPay) * 100 : 100;
  const payStatus: RAGStatus = payPct <= 105 ? "GREEN" : payPct <= 115 ? "AMBER" : "RED";

  const inflows = data.forecast.filter((f) => f.flow_type === "inflow");
  const outflows = data.forecast.filter((f) => f.flow_type === "outflow");
  const forecastTotalIn = inflows.reduce((s, f) => s + f.budgeted_amount, 0);
  const forecastTotalOut = outflows.reduce((s, f) => s + f.budgeted_amount, 0);
  const forecastNet = forecastTotalIn - forecastTotalOut;

  const fRow = (label: string, value: string, opts?: { bold?: boolean; color?: string; indent?: boolean; borderTop?: boolean }) => (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: opts?.indent ? "3px 0 3px 14px" : "4px 0",
      borderTop: opts?.borderTop ? `1px solid ${HAIRLINE}` : undefined,
      marginTop: opts?.borderTop ? "4px" : undefined,
      paddingTop: opts?.borderTop ? "6px" : undefined,
    }}>
      <span style={{ fontSize: "13px", fontWeight: opts?.bold ? 700 : 400, color: opts?.color || (opts?.bold ? NAVY : SLATE) }}>{label}</span>
      <span style={{ fontSize: "13px", fontWeight: opts?.bold ? 700 : 600, color: opts?.color || NAVY }}>{value}</span>
    </div>
  );

  const [showDetail, setShowDetail] = useState<string | null>(null);
  const toggleDetail = (key: string) => setShowDetail(showDetail === key ? null : key);

  const summaryCard = (label: string, value: string, sub: string, color: string, opts?: { primary?: boolean; freshnessDate?: string | null }) => (
    <div style={execCard(color)}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
        <div style={{ fontSize: "10.5px", fontWeight: 500, color: SLATE, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "var(--font-sans, Inter, sans-serif)" }}>{label}</div>
        {opts?.freshnessDate !== undefined && <FreshnessBadge date={opts.freshnessDate} />}
      </div>
      <div style={{ fontSize: "28px", fontWeight: 600, color, lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>{value}</div>
      <div style={{ fontSize: "11px", color: SLATE, marginTop: "6px" }}>{sub}</div>
    </div>
  );

  const expandSection = (key: string, title: string, children: React.ReactNode) => (
    <div style={{ borderTop: `1px solid ${HAIRLINE}`, marginTop: "8px" }}>
      <div onClick={() => toggleDetail(key)} style={{ padding: "8px 0", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "13px", fontWeight: 700, color: NAVY }}>{title}</span>
        <span style={{ fontSize: "13px", color: SLATE }}>{showDetail === key ? "▲ Hide" : "▼ Show"}</span>
      </div>
      {showDetail === key && <div style={{ paddingBottom: "6px" }}>{children}</div>}
    </div>
  );

  return (
    <>
      <SectionTitle title={`Finance — ${data.companyName}`} />
      {!data.cashPlan && !data.cashOpening && data.cashPositions.length === 0 && data.forecast.length === 0 ? (
        <p style={{ color: SLATE, fontSize: "13px" }}>No finance data yet.</p>
      ) : (
        <div style={{ ...execCard(NAVY), padding: "12px", marginBottom: "8px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "8px", marginBottom: "8px" }}>
            {/* 15 Jul 2026, per Khuram: cash in hand and PDC are two
                different things — a PDC he's issued isn't out of his hand
                yet, so it can't be silently blended into the headline cash
                figure. This card used to show closing_after_post_dated
                (cash minus every outstanding PDC); it's now the plain
                actual closing balance, with PDC Outstanding broken out as
                its own card next to it. */}
            {wv("finance.cash_in_hand", true) && summaryCard(
              "Cash in Hand",
              latest ? `PKR ${fmtMoney(latest.closing_balance)}` : "—",
              latest ? `Updated ${formatDateUK(latest.position_date)}` : "No data",
              !latest ? BLUE : latest.closing_balance < 0 ? RED : GREEN,
              { primary: true, freshnessDate: latest ? latest.position_date : null }
            )}
            {wv("finance.pdc_outstanding", true) && summaryCard(
              "PDC Outstanding",
              latest ? `PKR ${fmtMoney(latest.post_dated_total)}` : "—",
              "Issued, not yet cleared",
              AMBER
            )}
            {wv("finance.money_in", true) && summaryCard(
              "Money In (MTD)",
              `PKR ${fmtMoney(actualReceiptsMTD)}`,
              plannedRecv > 0 ? `${Math.round(recvPct)}% of expected` : "No plan set",
              plannedRecv > 0 ? (recvStatus === "RED" ? RED : recvStatus === "AMBER" ? AMBER : GREEN) : SLATE
            )}
            {wv("finance.money_out", true) && summaryCard(
              "Money Out (MTD)",
              `PKR ${fmtMoney(actualPaymentsMTD)}`,
              plannedPay > 0 ? `${Math.round(payPct)}% of expected` : "No plan set",
              plannedPay > 0 ? (payStatus === "RED" ? RED : payStatus === "AMBER" ? AMBER : GREEN) : SLATE
            )}
          </div>

          {/* PDC due soon — sum of the first 4 weeks of get_pdc_outlook()
              (migration 132). Only shown when there's something to flag,
              same "management by exception" pattern as the rest of this
              page — a clean outlook is silent, not a reassuring zero. */}
          {wv("finance.pdc_due_alert", true) && (() => {
            const dueWithin4Weeks = data.pdcOutlook.filter((w) => w.week_number <= 4).reduce((s, w) => s + w.pdc_due, 0);
            if (dueWithin4Weeks <= 0) return null;
            return (
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 10px", marginBottom: "6px", borderRadius: "8px",
                backgroundColor: "var(--bg-warning-soft, #FBF0DF)",
              }}>
                <span style={{ fontSize: "12.5px", fontWeight: 600, color: AMBER }}>⚠ PDC due within 4 weeks</span>
                <span style={{ fontSize: "12.5px", fontWeight: 700, color: AMBER }}>PKR {fmtMoney(dueWithin4Weeks)}</span>
              </div>
            );
          })()}

          {wv("finance.forecast", true) && (
            <>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 4px", fontSize: "13px" }}>
            <span style={{ color: SLATE }}>Projected month-end</span>
            <span style={{ fontWeight: 700, color: projected >= 0 ? GREEN : RED }}>PKR {fmtMoney(projected)}</span>
          </div>
          {data.forecast.length > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 4px 6px", fontSize: "13px" }}>
              <span style={{ color: SLATE }}>Forecast net cash flow</span>
              <span style={{ fontWeight: 700, color: forecastNet >= 0 ? GREEN : RED }}>PKR {fmtMoney(forecastNet)}</span>
            </div>
          )}
          {data.forecast.length > 0 && expandSection("forecast", `Forecast Breakdown — ${data.forecast[0]?.budget_month === financeMonth ? "This Month" : formatMonthUK(data.forecast[0]?.budget_month || null)}`, (
            <div style={{ fontSize: "13px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: GREEN, marginBottom: "2px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Money In</div>
              {inflows.map((f) => fRow(f.category, `PKR ${fmtMoney(f.budgeted_amount)}`, { indent: true }))}
              {fRow("Total inflows", `PKR ${fmtMoney(forecastTotalIn)}`, { bold: true, color: GREEN })}
              <div style={{ height: "6px" }} />
              <div style={{ fontSize: "11px", fontWeight: 700, color: RED, marginBottom: "2px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Money Out</div>
              {outflows.map((f) => fRow(f.category, `PKR ${fmtMoney(f.budgeted_amount)}`, { indent: true }))}
              {fRow("Total outflows", `PKR ${fmtMoney(forecastTotalOut)}`, { bold: true, color: RED })}
              {fRow("Net", `PKR ${fmtMoney(forecastNet)}`, { bold: true, borderTop: true, color: forecastNet >= 0 ? GREEN : RED })}
            </div>
          ))}
            </>
          )}

          {wv("finance.plan_details", true) && (plannedRecv > 0 || plannedPay > 0) && expandSection("plan", "Actual vs Plan Details", (
            <div style={{ fontSize: "13px" }}>
              {fRow("Received so far", `PKR ${fmtMoney(actualReceiptsMTD)}`)}
              {fRow(`Expected by day ${de} of ${dim}`, `PKR ${fmtMoney(Math.round(expRecv))}`, { indent: true })}
              {fRow("Receipts status", recvStatus === "GREEN" ? "On track" : recvStatus === "AMBER" ? "Slightly behind" : "Behind", { bold: true, color: ragColour(recvStatus) })}
              <div style={{ height: "6px" }} />
              {fRow("Paid out so far", `PKR ${fmtMoney(actualPaymentsMTD)}`)}
              {fRow(`Expected by day ${de} of ${dim}`, `PKR ${fmtMoney(Math.round(expPay))}`, { indent: true })}
              {fRow("Payments status", payStatus === "GREEN" ? "On track" : payStatus === "AMBER" ? "Slightly over" : "Over budget", { bold: true, color: ragColour(payStatus) })}
            </div>
          ))}

          {wv("finance.vs_last_year", true) && data.lastYearReceipts !== null && expandSection("lastyear", "vs Same Month Last Year", (
            <div style={{ fontSize: "13px" }}>
              {fRow("Received last year", `PKR ${fmtMoney(data.lastYearReceipts)}`)}
              {fRow("Received this year", `PKR ${fmtMoney(actualReceiptsMTD)}`)}
              {fRow("Difference", `${actualReceiptsMTD >= data.lastYearReceipts! ? "+" : ""}PKR ${fmtMoney(actualReceiptsMTD - data.lastYearReceipts!)}`, { bold: true, color: actualReceiptsMTD >= data.lastYearReceipts! ? GREEN : RED })}
            </div>
          ))}

          {data.deptBudgets.length > 0 && (() => {
            const totalB = data.deptBudgets.reduce((s, b) => s + b.budgeted_amount, 0);
            const totalA = data.deptBudgets.reduce((s, b) => s + b.actual_amount, 0);
            const over = totalA > totalB;
            return expandSection("deptbudget", `Department Budgets — ${over ? "Over" : "Under"} by PKR ${fmtMoney(Math.abs(totalB - totalA))}`, (
              <div style={{ fontSize: "13px" }}>
                {data.deptBudgets.map((b, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: `1px solid ${HAIRLINE}` }}>
                    <span style={{ color: SLATE }}>{b.department} — {b.category}</span>
                    <span style={{ fontWeight: 600, color: b.actual_amount > b.budgeted_amount ? RED : GREEN }}>
                      PKR {fmtMoney(b.actual_amount)} / {fmtMoney(b.budgeted_amount)}
                    </span>
                  </div>
                ))}
                {fRow("Total Budget", `PKR ${fmtMoney(totalB)}`, { bold: true, borderTop: true })}
                {fRow("Total Actual", `PKR ${fmtMoney(totalA)}`, { bold: true, color: over ? RED : GREEN })}
              </div>
            ));
          })()}
        </div>
      )}
    </>
  );
}

/* ───────────────────────── Member-view helper components ───────────────────────── */

function KPICard({ icon, value, label, alert, sparkline }: { icon: string; value: number; label: string; alert?: boolean; sparkline?: number[] }) {
  return (
    <div style={{
      backgroundColor: COLOURS.CARD, border: `1px solid ${HAIRLINE}`,
      borderRadius: RADII.CARD, padding: "24px",
    }}>
      <div style={{ fontSize: "10.5px", fontWeight: 500, color: SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px", fontFamily: "var(--font-sans, Inter, sans-serif)" }}>
        {icon} {label}
      </div>
      <div style={{
        fontSize: "44px", fontWeight: 600, lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums",
        fontFamily: "var(--font-display, 'Inter Tight', sans-serif)",
        color: alert ? COLOURS.RED : NAVY,
      }}>
        {value}
      </div>
      {sparkline && sparkline.length > 1 && <MiniSparkline data={sparkline} color={alert ? COLOURS.RED : COLOURS.BLUE} />}
    </div>
  );
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1);
  const w = 80;
  const h = 24;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * (h - 4) - 2}`).join(" ");
  const lastX = w;
  const lastY = h - (data[data.length - 1] / max) * (h - 4) - 2;
  return (
    <svg width={w} height={h} style={{ marginTop: "6px", display: "block" }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity={0.5} />
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
    </svg>
  );
}

function SkeletonPulse({ width, height, borderRadius = "6px", style }: { width: string; height: string; borderRadius?: string; style?: React.CSSProperties }) {
  return (
    <div style={{
      width, height, borderRadius,
      background: "linear-gradient(90deg, var(--border-color) 25%, var(--border-light) 50%, var(--border-color) 75%)",
      backgroundSize: "200% 100%",
      animation: "shimmer 1.5s ease-in-out infinite",
      ...style,
    }} />
  );
}

function HomeSkeleton({ isMobile }: { isMobile: boolean }) {
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: "14px", marginBottom: "24px" }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: "12px", padding: "16px 18px" }}>
            <SkeletonPulse width="24px" height="24px" borderRadius="6px" />
            <div style={{ marginTop: "10px" }}><SkeletonPulse width="50px" height="28px" /></div>
            <div style={{ marginTop: "6px" }}><SkeletonPulse width="80px" height="13px" /></div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr minmax(280px, 340px)", gap: "20px" }}>
        <div style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: "12px", padding: "16px 18px" }}>
          <SkeletonPulse width="120px" height="16px" />
          <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
            {[1, 2, 3, 4, 5].map((i) => <SkeletonPulse key={i} width="100%" height="14px" />)}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {[1, 2].map((i) => (
            <div key={i} style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: "12px", padding: "16px" }}>
              <SkeletonPulse width="90px" height="14px" />
              <div style={{ marginTop: "12px" }}><SkeletonPulse width="100%" height="10px" /></div>
              <div style={{ marginTop: "8px" }}><SkeletonPulse width="70%" height="10px" /></div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
