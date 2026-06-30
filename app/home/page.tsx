"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase, authFetch, loadMyPermissions } from "../lib/supabase";
import EscalationTrafficLights from "../executive/EscalationTrafficLights";
import { COLOURS, StatusBadge, SectionTitle, RAGStatus, ragColour, FreshnessBadge, WARNING_BANNER_STYLE, WARNING_TITLE_COLOR, displayRole } from "../lib/SharedUI";
import { formatDateUK, formatMonthUK, workingDaysFromNow } from "../lib/dateUtils";
import { UTPL_COMPANY_ID, COMPANIES } from "../lib/constants";
import { useMobile } from "../lib/useMobile";
import { useUserCtx } from "../lib/useUserCtx";
import { isPA, isPrivileged, canCreateAssignments, canViewFinance, isAdminTier, type UserCtx, type PermOverrides } from "../lib/permissions";
import { logAction } from "../lib/audit-log";
import { DEPARTMENT_CONFIGS, getDepartmentHealthStatus } from "../lib/department-config";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";

const { NAVY, SLATE, BORDER } = COLOURS;

/* ───────────────────────── Types ───────────────────────── */

type TaskRow = { id: string; description: string; status: string; due_date: string | null; assigned_to: string | null; assigned_to_email: string | null; assigned_by: string | null; project: string | null; priority: string | null; updated_at: string | null };
type AuditEntry = { id: string; action: string; table_name: string; details: string | null; created_at: string };
type MeetingRow = { id: string; title: string; meeting_date: string };
type WorkloadEntry = { name: string; count: number };
type AttentionItem = { label: string; detail: string; href: string };

type Plant = { id: string; name: string; type: string };
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

type CompanyFinanceData = {
  companyId: string;
  companyName: string;
  cashOpening: OpeningBalance | null;
  cashPlan: MonthlyPlan | null;
  cashPositions: DailyPosition[];
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
  const isExec = !!ctx && isAdminTier(ctx);

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
  const [execLoading, setExecLoading] = useState(true);

  const [companyFinance, setCompanyFinance] = useState<CompanyFinanceData[]>([]);
  const [receivableRows, setReceivableRows] = useState<ReceivableCustomerRow[]>([]);
  const [recAgingTotals, setRecAgingTotals] = useState<{ "0-30": number; "31-60": number; "61-90": number; "90+": number }>({ "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 });
  const [recAgingByCustomer, setRecAgingByCustomer] = useState<{ customer: string; "0-30": number; "31-60": number; "61-90": number; "90+": number; total: number }[]>([]);
  const [showFinance, setShowFinance] = useState(false);
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
  const [dailyOpsData, setDailyOpsData] = useState<DailyOpsPoint[]>([]);

  async function autoCreateEscalationTask(
    esc: Escalation,
    allTasks: Task[],
    owner: DepartmentOwner | null
  ) {
    if (!owner?.primary_owner_name || !owner?.primary_owner_email) return;
    const alreadyExists = allTasks.some(
      (task) => task.source_type === "kpi_escalation" && task.source_label === esc.sourceLabel
    );
    if (alreadyExists) return;
    await supabase.from("tasks").insert({
      task_type: "Explanation Required",
      exception_type: esc.metric.toLowerCase(),
      explanation_required: true,
      description: `Explanation required: ${esc.metric} lagging for ${esc.plantName}. ${esc.detail}`,
      project: "Unze Trading Ops",
      priority: "High",
      status: "Waiting Reply",
      due_date: dueIn48Hours(),
      assigned_date: today,
      assigned_to: owner.primary_owner_name,
      assigned_to_email: owner.primary_owner_email,
      assigned_by: "System",
      assigned_by_email: "khuram1901@gmail.com",
      notes: `Auto-created by the executive escalation engine. ${esc.detail}`,
      reply_required: true,
      assigned_to_department: "Unze Trading Ops",
      assigned_to_business_unit: null,
      source_type: "kpi_escalation",
      source_record_id: null,
      source_label: esc.sourceLabel,
    });
  }

  async function autoCreateReceivableTask(
    bill: Receivable,
    stageName: string,
    allTasks: Task[],
    owner: DepartmentOwner | null
  ) {
    if (!owner?.primary_owner_name || !owner?.primary_owner_email) return;
    const sourceLabel = `receivable_stuck:${bill.id}:${bill.current_stage_order}`;
    const alreadyExists = allTasks.some(
      (task) => task.source_type === "receivable_escalation" && task.source_label === sourceLabel
    );
    if (alreadyExists) return;
    await supabase.from("tasks").insert({
      task_type: "Explanation Required",
      exception_type: "receivable",
      explanation_required: true,
      description: `Receivable stuck: ${bill.utility} bill of ${fmtMoney(bill.amount)} ${bill.currency} is over time at stage "${stageName}".`,
      project: "Unze Trading Ops",
      priority: "High",
      status: "Waiting Reply",
      due_date: dueIn48Hours(),
      assigned_date: today,
      assigned_to: owner.primary_owner_name,
      assigned_to_email: owner.primary_owner_email,
      assigned_by: "System",
      assigned_by_email: "khuram1901@gmail.com",
      notes: `Auto-created by the receivables escalation engine. Bill for ${bill.utility} has exceeded its budgeted working days at stage "${stageName}".`,
      reply_required: true,
      assigned_to_department: "Unze Trading Ops",
      assigned_to_business_unit: null,
      source_type: "receivable_escalation",
      source_record_id: bill.id,
      source_label: sourceLabel,
    });
  }

  async function autoCreateCashEscalationTask(
    exceptionType: "cash_receivables" | "cash_payouts",
    detail: string,
    allTasks: Task[],
    financeOwner: DepartmentOwner | null
  ) {
    if (!financeOwner?.primary_owner_name || !financeOwner?.primary_owner_email) return;
    const month = formatDate(new Date()).slice(0, 7);
    const sourceLabel = `kpi_escalation:${exceptionType}:${month}`;
    const alreadyExists = allTasks.some(
      (task) => task.source_type === "kpi_escalation" && task.source_label === sourceLabel
    );
    if (alreadyExists) return;
    await supabase.from("tasks").insert({
      task_type: "Explanation Required",
      exception_type: exceptionType,
      explanation_required: true,
      description: detail,
      project: "Unze Trading Ops",
      priority: "High",
      status: "Waiting Reply",
      due_date: workingDaysFromNow(3),
      assigned_date: today,
      assigned_to: financeOwner.primary_owner_name,
      assigned_to_email: financeOwner.primary_owner_email,
      assigned_by: "System",
      assigned_by_email: "khuram1901@gmail.com",
      notes: `Auto-created by the executive cash escalation engine. ${detail}`,
      reply_required: true,
      assigned_to_department: "Finance",
      assigned_to_business_unit: null,
      source_type: "kpi_escalation",
      source_record_id: null,
      source_label: sourceLabel,
    });
  }

  async function loadExecutiveData(dateToView: string) {
    setExecLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
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
        setShowFinance(canViewFinance(userCtx));
      }
    }

    const selectedMonth = getMonthFromDate(dateToView);
    const selectedMonthStart = getMonthStartFromDate(dateToView);
    const selectedMonthEnd = getMonthEndFromDate(dateToView);

    const [
      plantsRes, openRes, brokenOpenRes, prodRes, dispRes, brkRes, scrapRes,
      machineIssuesRes, tasksRes, ownerRes, monthlyProductionTargetsRes,
      monthlyDispatchTargetsRes, monthlyProductionRes, monthlyDispatchRes, monthlyBreakageRes,
    ] = await Promise.all([
      supabase.from("plants").select("id, name, type").eq("active", true).order("name"),
      supabase.from("opening_balances").select("*"),
      supabase.from("broken_opening_balances").select("*"),
      supabase.from("production_entries").select("*").lte("entry_date", dateToView),
      supabase.from("dispatch_entries").select("*").lte("entry_date", dateToView),
      supabase.from("breakage_entries").select("*").lte("entry_date", dateToView),
      supabase.from("scrap_processed_entries").select("*").lte("entry_date", dateToView),
      supabase.from("machine_issues").select("*").neq("issue_status", "Resolved").order("created_at", { ascending: false }),
      supabase.from("tasks").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("department_owners").select("department_name, primary_owner_name, primary_owner_email").eq("department_name", "Unze Trading Ops").single(),
      supabase.from("monthly_production_targets").select("*").eq("target_month", selectedMonth),
      supabase.from("monthly_dispatch_targets").select("*").eq("target_month", selectedMonth),
      supabase.from("production_entries").select("*").gte("entry_date", selectedMonthStart).lte("entry_date", selectedMonthEnd),
      supabase.from("dispatch_entries").select("*").gte("entry_date", selectedMonthStart).lte("entry_date", selectedMonthEnd),
      supabase.from("breakage_entries").select("*").gte("entry_date", selectedMonthStart).lte("entry_date", selectedMonthEnd),
    ]);

    const plants: Plant[] = plantsRes.data || [];
    const opening = openRes.data || [];
    const brokenOpening = brokenOpenRes.data || [];
    const production = prodRes.data || [];
    const dispatch = dispRes.data || [];
    const breakage = brkRes.data || [];
    const scrap = scrapRes.data || [];
    const activeMachineIssues = machineIssuesRes.data || [];
    const taskData: Task[] = tasksRes.data || [];
    const owner: DepartmentOwner | null = ownerRes.data || null;
    const monthlyProductionTargets: MonthlyTarget[] = monthlyProductionTargetsRes.data || [];
    const monthlyDispatchTargets: MonthlyTarget[] = monthlyDispatchTargetsRes.data || [];
    const monthlyProduction = monthlyProductionRes.data || [];
    const monthlyDispatch = monthlyDispatchRes.data || [];
    const monthlyBreakage = monthlyBreakageRes.data || [];

    setMachineIssues(activeMachineIssues);
    setTasks(taskData);

    const currentMonthForCash = formatDate(new Date()).slice(0, 7);
    const nowForHist = new Date();
    const lastYearMonth = `${nowForHist.getFullYear() - 1}-${String(nowForHist.getMonth() + 1).padStart(2, "0")}`;

    const allCompanyFinance: CompanyFinanceData[] = [];
    for (const company of COMPANIES) {
      const [cashOpenRes, cashPlanRes, cashPosRes, lyRes, forecastRes, deptBudgetRes] = await Promise.all([
        supabase.from("cash_opening_balance").select("*").eq("company_id", company.id).order("as_of_date", { ascending: true }).limit(1),
        supabase.from("monthly_cash_plan").select("*").eq("company_id", company.id).eq("plan_month", currentMonthForCash).maybeSingle(),
        supabase.from("daily_cash_position").select("*").eq("company_id", company.id).order("position_date", { ascending: false }).limit(30),
        supabase.from("daily_cash_position").select("total_receipts, total_payments").eq("company_id", company.id).gte("position_date", lastYearMonth + "-01").lte("position_date", lastYearMonth + "-31"),
        supabase.from("monthly_budgets").select("category, flow_type, budgeted_amount, budget_month").eq("company_id", company.id).gte("budget_month", currentMonthForCash).order("budget_month", { ascending: true }),
        supabase.from("department_budgets").select("department, category, budgeted_amount, actual_amount").eq("company_id", company.id).eq("budget_month", currentMonthForCash),
      ]);

      let lyReceipts: number | null = null;
      let lyPayments: number | null = null;
      if (lyRes.data && lyRes.data.length > 0) {
        const lyData = lyRes.data as { total_receipts: number; total_payments: number }[];
        lyReceipts = lyData.reduce((s, r) => s + (r.total_receipts || 0), 0);
        lyPayments = lyData.reduce((s, r) => s + (r.total_payments || 0), 0);
      }

      allCompanyFinance.push({
        companyId: company.id,
        companyName: company.name,
        cashOpening: cashOpenRes.data && cashOpenRes.data.length > 0 ? cashOpenRes.data[0] : null,
        cashPlan: cashPlanRes.data || null,
        cashPositions: cashPosRes.data || [],
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

    const [stagesRes, billsRes] = await Promise.all([
      supabase.from("receivable_stages").select("*").order("stage_order"),
      supabase.from("receivables").select("*").neq("status", "Collected"),
    ]);
    const recStages: ReceivableStage[] = stagesRes.data || [];
    const bills: Receivable[] = billsRes.data || [];

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

    const custMap = new Map<string, ReceivableCustomerRow>();
    for (const bill of bills) {
      const key = bill.utility || "Unknown";
      if (!custMap.has(key)) {
        custMap.set(key, { customer: key, greenAmount: 0, amberAmount: 0, redAmount: 0, totalAmount: 0, redCount: 0 });
      }
      const row = custMap.get(key)!;
      const rag = billRagStatus(bill);
      const amt = Number(bill.amount) || 0;
      row.totalAmount += amt;
      if (rag === "green") row.greenAmount += amt;
      else if (rag === "amber") row.amberAmount += amt;
      else { row.redAmount += amt; row.redCount += 1; }
    }
    const recRows = Array.from(custMap.values()).sort(
      (a, b) => b.redAmount - a.redAmount || b.totalAmount - a.totalAmount
    );
    setReceivableRows(recRows);

    const aging = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 } as { "0-30": number; "31-60": number; "61-90": number; "90+": number };
    const nowMs = new Date().setHours(0, 0, 0, 0);
    for (const bill of bills) {
      const startMs = new Date(bill.date_submitted + "T00:00:00").getTime();
      const days = startMs > nowMs ? 0 : Math.floor((nowMs - startMs) / (1000 * 60 * 60 * 24));
      const bucket = days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
      aging[bucket] += Number(bill.amount) || 0;
    }
    setRecAgingTotals(aging);

    const custAgingMap = new Map<string, { customer: string; "0-30": number; "31-60": number; "61-90": number; "90+": number; total: number }>();
    for (const bill of bills) {
      const key = bill.utility || "Unknown";
      if (!custAgingMap.has(key)) custAgingMap.set(key, { customer: key, "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0, total: 0 });
      const row = custAgingMap.get(key)!;
      const startMs = new Date(bill.date_submitted + "T00:00:00").getTime();
      const days = startMs > nowMs ? 0 : Math.floor((nowMs - startMs) / (1000 * 60 * 60 * 24));
      const bucket = days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
      const amt = Number(bill.amount) || 0;
      row[bucket] += amt;
      row.total += amt;
    }
    setRecAgingByCustomer(Array.from(custAgingMap.values()).sort((a, b) => b.total - a.total));

    for (const bill of bills) {
      if (billRagStatus(bill) === "red") {
        await autoCreateReceivableTask(bill, stageNameFor(bill.current_stage_order), taskData, owner);
      }
    }

    function sumBetween(rows: any[], plantId: string, fromDate: string, toDate: string): number {
      let t = 0;
      for (const r of rows) {
        if (r.plant_id !== plantId) continue;
        if (r.entry_date < fromDate || r.entry_date > toDate) continue;
        t += (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0) + (r.qty_meter || 0);
      }
      return t;
    }
    function sumForDate(rows: any[], plantId: string, onlyDate: boolean): SizeTotals {
      const t = emptyTotals();
      for (const r of rows) {
        if (r.plant_id !== plantId) continue;
        if (onlyDate && r.entry_date !== dateToView) continue;
        t.s31 += r.qty_31 || 0;
        t.s36 += r.qty_36 || 0;
        t.s45 += r.qty_45 || 0;
        t.meter += r.qty_meter || 0;
      }
      return t;
    }
    function openingFor(rows: any[], plantId: string): SizeTotals {
      const t = emptyTotals();
      const forPlant = rows.filter((r) => r.plant_id === plantId).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      if (forPlant.length > 0) {
        const latest = forPlant[0];
        t.s31 = latest.bal_31 || 0;
        t.s36 = latest.bal_36 || 0;
        t.s45 = latest.bal_45 || 0;
        t.meter = latest.bal_meter || 0;
      }
      return t;
    }

    const result: PlantExecutiveSummary[] = plants.map((plant) => {
      const openingGood = openingFor(opening, plant.id);
      const openingBroken = openingFor(brokenOpening, plant.id);
      const totalProduced = sumForDate(production, plant.id, false);
      const totalDispatched = sumForDate(dispatch, plant.id, false);
      const totalBroken = sumForDate(breakage, plant.id, false);
      const totalScrap = sumForDate(scrap, plant.id, false);
      const closingGoodStock: SizeTotals = {
        s31: openingGood.s31 + totalProduced.s31 - totalBroken.s31 - totalDispatched.s31,
        s36: openingGood.s36 + totalProduced.s36 - totalBroken.s36 - totalDispatched.s36,
        s45: openingGood.s45 + totalProduced.s45 - totalBroken.s45 - totalDispatched.s45,
        meter: openingGood.meter + totalProduced.meter - totalDispatched.meter,
      };
      const closingBrokenStock: SizeTotals = {
        s31: openingBroken.s31 + totalBroken.s31 - totalScrap.s31,
        s36: openingBroken.s36 + totalBroken.s36 - totalScrap.s36,
        s45: openingBroken.s45 + totalBroken.s45 - totalScrap.s45,
        meter: 0,
      };
      const enteredOnDate =
        production.some((r) => r.plant_id === plant.id && r.entry_date === dateToView) ||
        dispatch.some((r) => r.plant_id === plant.id && r.entry_date === dateToView) ||
        breakage.some((r) => r.plant_id === plant.id && r.entry_date === dateToView);
      return {
        plant, closingGoodStock, closingBrokenStock,
        producedOnDate: sumForDate(production, plant.id, true),
        dispatchedOnDate: sumForDate(dispatch, plant.id, true),
        brokenOnDate: sumForDate(breakage, plant.id, true),
        enteredOnDate,
      };
    });

    const currentQuarter = getMonthQuarter(dateToView);
    const q1End = quarterEndDate(selectedMonthStart, 1);
    const q2End = quarterEndDate(selectedMonthStart, 2);
    const foundEscalations: Escalation[] = [];

    function behindAtQuarter(entries: any[], targetTotalForMonth: number, plantId: string, quarter: 1 | 2 | 3 | 4, checkpointEnd: string): boolean {
      if (targetTotalForMonth <= 0) return false;
      const cumulativeTarget = (targetTotalForMonth / 4) * quarter;
      const cumulativeActual = sumBetween(entries, plantId, selectedMonthStart, checkpointEnd);
      const achievement = cumulativeTarget > 0 ? (cumulativeActual / cumulativeTarget) * 100 : 0;
      return achievement < 85;
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
      const producedMTD = sumBetween(monthlyProduction, plant.id, selectedMonthStart, dateToView);
      const brokenMTD = sumBetween(monthlyBreakage, plant.id, selectedMonthStart, dateToView);
      if (producedMTD > 0) {
        const rate = (brokenMTD / producedMTD) * 100;
        if (rate > 1.5) {
          foundEscalations.push({
            plantId: plant.id, plantName: plant.name, metric: "Breakage",
            detail: `Breakage rate ${rate.toFixed(2)}% (${brokenMTD} broken of ${producedMTD} produced) exceeds 1.5% limit.`,
            sourceLabel: `kpi_escalation:breakage:${plant.id}:${selectedMonth}`,
          });
        }
      }
    }

    for (const esc of foundEscalations) {
      await autoCreateEscalationTask(esc, taskData, owner);
    }

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
          taskData,
          financeOwner
        );
      }
      if (payPct > 115) {
        await autoCreateCashEscalationTask(
          "cash_payouts",
          `${cfd.companyName}: Payouts pacing at ${Math.round(payPct)}% — actual ${fmtMoney(payMTD)} vs expected ${fmtMoney(Math.round(expPay))} by day ${de} of ${dim}.`,
          taskData,
          financeOwner
        );
      }
    }

    setSummaries(result);
    setEscalations(foundEscalations);

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
    setDailyOpsData(Array.from(opsMap.values()).sort((a, b) => a.date.localeCompare(b.date)));

    const [deptOwnersRes] = await Promise.all([
      supabase.from("department_owners").select("department_name, primary_owner_name").eq("active", true),
    ]);
    const ownerMap = new Map((deptOwnersRes.data || []).map((o: { department_name: string; primary_owner_name: string | null }) => [o.department_name, o.primary_owner_name || "—"]));

    const healthResults: { slug: string; title: string; status: "GREEN" | "AMBER" | "RED"; owner: string; detail: string }[] = [];
    for (const deptConfig of DEPARTMENT_CONFIGS) {
      const { data: deptData } = await supabase
        .from(deptConfig.table)
        .select("*")
        .eq("company_id", UTPL_COMPANY_ID);
      const deptRows = (deptData || []) as Record<string, unknown>[];
      const status = getDepartmentHealthStatus(deptRows, deptConfig);
      const openCount = deptRows.filter((r) => {
        const s = (r.status as string) || "";
        return s !== "Completed" && s !== "Cancelled" && s !== "Closed" && s !== "Resolved";
      }).length;
      healthResults.push({
        slug: deptConfig.slug,
        title: deptConfig.title,
        status,
        owner: ownerMap.get(deptConfig.title) || "—",
        detail: `${openCount} open`,
      });
    }
    setDeptHealth(healthResults);

    const [holdingsRes, pricesRes] = await Promise.all([
      supabase.from("holdings").select("ticker, company_name, quantity, buy_price"),
      supabase.from("current_prices").select("ticker, price, as_of_date"),
    ]);
    const hRows = holdingsRes.data || [];
    const pRows = pricesRes.data || [];
    if (hRows.length > 0) {
      const priceMap = new Map(pRows.map((p: { ticker: string; price: number; as_of_date: string }) => [p.ticker, p]));
      const stockMap = new Map<string, { ticker: string; company: string; totalQty: number; totalCost: number; currentPrice: number | null }>();
      for (const h of hRows) {
        if (!stockMap.has(h.ticker)) {
          const cp = priceMap.get(h.ticker);
          stockMap.set(h.ticker, { ticker: h.ticker, company: h.company_name || h.ticker, totalQty: 0, totalCost: 0, currentPrice: cp?.price ?? null });
        }
        const s = stockMap.get(h.ticker)!;
        s.totalQty += h.quantity;
        s.totalCost += h.quantity * h.buy_price;
      }
      let tCost = 0, tValue = 0;
      const invLosers: { ticker: string; company: string; pct: number }[] = [];
      for (const s of stockMap.values()) {
        tCost += s.totalCost;
        if (s.currentPrice !== null) {
          const val = s.totalQty * s.currentPrice;
          tValue += val;
          const pct = ((val - s.totalCost) / s.totalCost) * 100;
          if (pct < -5) invLosers.push({ ticker: s.ticker, company: s.company, pct });
        }
      }
      setInvestmentData({
        totalCost: tCost,
        totalValue: tValue,
        gainLoss: tValue - tCost,
        gainLossPct: tCost > 0 ? ((tValue - tCost) / tCost) * 100 : 0,
        stockCount: stockMap.size,
        losers: invLosers.sort((a, b) => a.pct - b.pct),
        priceDate: pRows[0]?.as_of_date || null,
      });
    }

    setExecLoading(false);
  }

  useEffect(() => {
    if (!isExec) return;
    loadExecutiveData(selectedDate);
    const channel = supabase
      .channel("ceo-dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "production_entries" }, () => loadExecutiveData(selectedDate))
      .on("postgres_changes", { event: "*", schema: "public", table: "dispatch_entries" }, () => loadExecutiveData(selectedDate))
      .on("postgres_changes", { event: "*", schema: "public", table: "breakage_entries" }, () => loadExecutiveData(selectedDate))
      .on("postgres_changes", { event: "*", schema: "public", table: "machine_issues" }, () => loadExecutiveData(selectedDate))
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => loadExecutiveData(selectedDate))
      .on("postgres_changes", { event: "*", schema: "public", table: "monthly_production_targets" }, () => loadExecutiveData(selectedDate))
      .on("postgres_changes", { event: "*", schema: "public", table: "monthly_dispatch_targets" }, () => loadExecutiveData(selectedDate))
      .on("postgres_changes", { event: "*", schema: "public", table: "monthly_cash_plan" }, () => loadExecutiveData(selectedDate))
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_cash_position" }, () => loadExecutiveData(selectedDate))
      .on("postgres_changes", { event: "*", schema: "public", table: "receivables" }, () => loadExecutiveData(selectedDate))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, isExec]);

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
        att.push({ label: t.description, detail: `overdue${t.due_date ? " / due " + t.due_date : ""} · ${t.assigned_to || "Unassigned"}`, href: "/tasks" });
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
      const [cashRes, recRes, prodRes, targRes, completedWeekRes] = await Promise.all([
        supabase.from("daily_cash_position").select("closing_balance, position_date").order("position_date", { ascending: false }).limit(2),
        supabase.from("receivables").select("id").in("current_stage", ["Stage 2", "Stage 3"]).eq("status", "In Progress"),
        supabase.from("production_entries").select("pairs_produced").eq("entry_date", yesterday),
        supabase.from("monthly_production_targets").select("target_pairs").eq("month", today.slice(0, 7)),
        supabase.from("tasks").select("due_date, updated_at, status").gte("due_date", sevenDaysAgo).lte("due_date", today),
      ]);

      const cashRows = cashRes.data || [];
      const cashTotal = cashRows.length > 0 ? cashRows.reduce((s, r) => s + (r.closing_balance || 0), 0) : null;
      const cashDate = cashRows.length > 0 ? cashRows[0].position_date : null;
      const stuckBills = (recRes.data || []).length;

      const prodTotal = (prodRes.data || []).reduce((s, r) => s + (r.pairs_produced || 0), 0);
      const targTotal = (targRes.data || []).reduce((s, r) => s + (r.target_pairs || 0), 0);
      const dailyTarget = targTotal > 0 ? Math.round(targTotal / 26) : 0;
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

        const [prodTodayRes, prodYestRes, targRes2, dispRes, breakRes, machRes, deptTasksRes] = await Promise.all([
          supabase.from("production_entries").select("qty_31, qty_36, qty_45, qty_meter").eq("entry_date", today),
          supabase.from("production_entries").select("qty_31, qty_36, qty_45, qty_meter").eq("entry_date", yesterday),
          supabase.from("monthly_production_targets").select("target_pairs").eq("month", today.slice(0, 7)),
          supabase.from("dispatch_entries").select("qty_31, qty_36, qty_45, qty_meter").gte("entry_date", mStart).lte("entry_date", today),
          supabase.from("breakage_entries").select("qty_31, qty_36, qty_45, qty_meter").gte("entry_date", sevenDaysAgo).lte("entry_date", today),
          supabase.from("machine_issues").select("id, issue_status").neq("issue_status", "Resolved"),
          supabase.from("tasks").select("id, status, due_date").eq("assigned_to_department", "Unze Trading Ops").not("status", "in", '("Completed","Cancelled")'),
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

        const deptOverdue = (deptTasksRes.data || []).filter((t) => t.due_date && t.due_date < today).length;
        const deptOpen = (deptTasksRes.data || []).length;
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

        const [recOpenRes, recStagesRes, deptTasksRes] = await Promise.all([
          supabase.from("receivables").select("id, amount, date_submitted, current_stage_order, current_stage_entered_date, status").neq("status", "Collected"),
          supabase.from("receivable_stages").select("stage_order, stage_name, working_day_budget"),
          supabase.from("tasks").select("id, status, due_date").eq("assigned_to_department", "Finance").not("status", "in", '("Completed","Cancelled")'),
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
        const stages = recStagesRes.data || [];
        const totalOutstanding = openRec.reduce((s, r) => s + (r.amount || 0), 0);
        items.push({ label: "Outstanding receivables", value: `PKR ${totalOutstanding.toLocaleString()} across ${openRec.length} bills`, rag: openRec.length > 10 ? "RED" : openRec.length > 5 ? "AMBER" : "GREEN" });

        let overdueRec = 0;
        for (const bill of openRec) {
          const stage = stages.find((s) => s.stage_order === bill.current_stage_order);
          if (stage && stage.working_day_budget > 0 && bill.current_stage_entered_date) {
            const entered = new Date(bill.current_stage_entered_date + "T00:00:00");
            const daysInStage = Math.floor((Date.now() - entered.getTime()) / 86400000);
            if (daysInStage > stage.working_day_budget) overdueRec++;
          }
        }
        if (overdueRec > 0) {
          items.push({ label: "Overdue receivables", value: `${overdueRec} bill${overdueRec > 1 ? "s" : ""} past stage deadline`, rag: overdueRec > 3 ? "RED" : "AMBER" });
        } else {
          items.push({ label: "Receivable stages", value: "All within deadline", rag: "GREEN" });
        }

        const finOverdue = (deptTasksRes.data || []).filter((t) => t.due_date && t.due_date < today).length;
        const finOpen = (deptTasksRes.data || []).length;
        items.push({ label: "Finance tasks", value: `${finOpen} open${finOverdue > 0 ? `, ${finOverdue} overdue` : ""}`, rag: finOverdue === 0 ? "GREEN" : finOverdue <= 3 ? "AMBER" : "RED" });

        setManagerBriefing(items);
        setManagerBriefingTitle(`Finance Briefing${companyLabel !== "All" ? ` · ${companyLabel}` : ""}`);
      }

      if (userRole === "Admin") {
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
    { name: "Waiting Reply", value: myOpenTasks.filter((t) => t.status === "Waiting Reply").length, color: "#d97706" },
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
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>

        {!allLoading && userName && (
          <div style={{ marginBottom: "4px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <span style={{ fontSize: isMobile ? "18px" : "22px", fontWeight: 800, color: "var(--text-primary)" }}>
              {greetByTime()}, {userName.split(" ")[0]}
            </span>
            {ctx?.role && (
              <span style={{
                fontSize: "13px", fontWeight: 700, padding: "2px 10px", borderRadius: "10px",
                backgroundColor: "var(--border-light)", color: "var(--text-secondary)",
              }}>
                {displayRole(ctx.role, ctx.email)}
              </span>
            )}
          </div>
        )}
        <p style={{ color: "var(--text-secondary)", fontSize: "16px", margin: "0 0 20px" }}>
          {dateStr}
        </p>

        {allLoading ? (
          <HomeSkeleton isMobile={isMobile} />
        ) : isExec ? (
          <ExecutiveDashboardBody
            ctx={ctx}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            summaries={summaries}
            machineIssues={machineIssues}
            tasks={tasks}
            escalations={escalations}
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
            dailyOpsData={dailyOpsData}
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
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1px", backgroundColor: "var(--border-light, #f1f5f9)" }}>
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
                  <span style={{ fontSize: "14px", color: "var(--text-muted)" }}>
                    {completedToday}/{todayTasks.length + completedToday} done
                  </span>
                </div>

                {todayTasks.length === 0 ? (
                  <div style={{ padding: "32px 18px", textAlign: "center", color: "var(--text-muted)", fontSize: "16px" }}>
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
                          fontSize: "13px", color: "var(--text-muted)",
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
                  padding: "10px 18px", fontSize: "14px", color: "var(--text-muted)",
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
                        const urgency = d <= 1 ? COLOURS.RED : d <= 3 ? "#d97706" : "var(--text-secondary)";
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
                      <p style={{ fontSize: "15px", color: "var(--text-muted)", margin: 0 }}>No upcoming meetings scheduled.</p>
                    ) : (
                      meetings.map((m) => (
                        <a key={m.id} href="/meetings" style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          padding: "6px 0", textDecoration: "none", color: "inherit",
                        }}>
                          <span style={{ fontSize: "15px", color: "var(--text-primary)" }}>{m.title}</span>
                          <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>{formatDateUK(m.meeting_date)}</span>
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
                      <span style={{ fontSize: "13px", color: "var(--text-muted)", marginLeft: "auto" }}>open tasks per person</span>
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
                      <div style={{ fontSize: "14px", color: "var(--text-muted)" }}>
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
                          <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>{a.detail}</div>
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
                          backgroundColor: a.action === "Created" ? "#dcfce7" : a.action.startsWith("Updated") ? "#fef3c7" : "#fee2e2",
                          color: a.action === "Created" ? "#16a34a" : a.action.startsWith("Updated") ? "#d97706" : "#dc2626",
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
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
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
  ctx, selectedDate, setSelectedDate, summaries, machineIssues, tasks, escalations,
  companyFinance, receivableRows, recAgingTotals, recAgingByCustomer, showFinance, setShowFinance,
  expandedCard, setExpandedCard, bannerOpen, setBannerOpen, deptHealth, investmentData, dailyOpsData,
  isMobile, quickTaskAction, quickMachineResolve,
}: {
  ctx: UserCtx | null;
  selectedDate: string;
  setSelectedDate: (d: string) => void;
  summaries: PlantExecutiveSummary[];
  machineIssues: MachineIssue[];
  tasks: Task[];
  escalations: Escalation[];
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
  dailyOpsData: DailyOpsPoint[];
  isMobile: boolean;
  quickTaskAction: (taskId: string, newStatus: string) => Promise<void>;
  quickMachineResolve: (issueId: string) => Promise<void>;
}) {
  const userName = ctx?.email ? ctx.email.split("@")[0] : "";
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

  /* Tax urgent-attention: tasks in the Taxation department that are overdue or due this week */
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
      if (cfd.cashPositions.length === 0) cashAlerts.push({ title: `${cfd.companyName}: No Data`, value: 0, color: "#dc2626" });
      else if (staleDays > 1) cashAlerts.push({ title: `${cfd.companyName}: Stale`, value: staleDays, color: "#dc2626" });
      if (!cfd.cashPlan) cashAlerts.push({ title: `${cfd.companyName}: No Plan`, value: 0, color: "#d97706" });
    }
  }
  const hasAttention = overdueTasks.length > 0 || waitingReplies.length > 0 || escalations.length > 0 || missingPlants.length > 0 || downMachines.length > 0 || cashAlerts.length > 0 || taxUrgent.length > 0;

  const hasCritical = overdueTasks.length > 0 || downMachines.length > 0 || escalations.length > 0 || taxOverdue.length > 0 || cashAlerts.length > 0;

  type AttentionItem = { key: string; primary: string; secondary: string; badge?: string | null; taskId?: string; machineId?: string; actionType?: "complete" | "reply" | "resolve" };
  type AttentionRow = { id: string; label: string; count: number; color: string; items: AttentionItem[] };
  const attentionRows: AttentionRow[] = [];
  if (overdueTasks.length > 0) attentionRows.push({
    id: "overdue", label: "Overdue Tasks", count: overdueTasks.length, color: "#dc2626",
    items: overdueTasks.map((t) => ({ key: t.id, primary: t.description, secondary: `${t.assigned_to || "Unassigned"} · Due: ${formatDateUK(t.due_date)}`, badge: t.priority, taskId: t.id, actionType: "complete" as const })),
  });
  if (downMachines.length > 0) attentionRows.push({
    id: "machines", label: "Machines Down", count: downMachines.length, color: "#dc2626",
    items: downMachines.map((m) => ({ key: m.id, primary: `${m.plant_name} — ${m.machine_name}`, secondary: m.issue_description || "No description", machineId: m.id, actionType: "resolve" as const })),
  });
  if (escalations.length > 0) attentionRows.push({
    id: "escalations", label: "Escalations", count: escalations.length, color: "#dc2626",
    items: escalations.map((e) => ({ key: e.sourceLabel, primary: `${e.plantName} — ${e.metric}`, secondary: e.detail })),
  });
  if (waitingReplies.length > 0) attentionRows.push({
    id: "waiting", label: "Waiting Replies", count: waitingReplies.length, color: "#dc2626",
    items: waitingReplies.map((t) => ({ key: t.id, primary: t.description, secondary: `${t.assigned_to || "Unassigned"} · Due: ${formatDateUK(t.due_date)}`, badge: t.priority, taskId: t.id, actionType: "reply" as const })),
  });
  if (missingPlants.length > 0) attentionRows.push({
    id: "missing", label: "Plants Not Reported", count: missingPlants.length, color: "#dc2626",
    items: missingPlants.map((s) => ({ key: s.plant.id, primary: s.plant.name, secondary: `Type: ${s.plant.type}` })),
  });
  if (taxUrgent.length > 0) attentionRows.push({
    id: "tax", label: "Tax — Needs Review", count: taxUrgent.length, color: taxOverdue.length > 0 ? "#dc2626" : "#d97706",
    items: taxUrgent.map((t) => ({ key: t.id, primary: t.description, secondary: `${t.assigned_to || "Unassigned"} · Due: ${formatDateUK(t.due_date)}`, badge: t.priority, taskId: t.id, actionType: "complete" as const })),
  });
  if (dueThisWeekTasks.length > 0) attentionRows.push({
    id: "dueweek", label: "Due This Week", count: dueThisWeekTasks.length, color: "#d97706",
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
            onClick={() => setBannerOpen(!bannerOpen)}
            style={{
              flex: 1, minWidth: "260px", cursor: "pointer",
              border: `1px solid ${hasCritical ? "#fecaca" : "#fde68a"}`,
              borderLeft: `4px solid ${hasCritical ? "#dc2626" : "#d97706"}`,
              borderRadius: "8px",
              backgroundColor: hasCritical ? "#fef2f2" : "#fffbeb",
              padding: "9px 14px",
              display: "flex", alignItems: "center", gap: "10px",
            }}
          >
            <span style={{ fontSize: "17px", flexShrink: 0 }}>⚠</span>
            <span style={{ fontSize: "15px", fontWeight: 700, color: hasCritical ? "#991b1b" : "#92400e", flexShrink: 0 }}>
              {totalAttentionCount} item{totalAttentionCount > 1 ? "s" : ""} need attention
            </span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", flex: 1, minWidth: 0 }}>
              {attentionRows.slice(0, 3).map((row) => (
                <span key={`chip-${row.id}`} style={{
                  display: "inline-flex", alignItems: "center", gap: "4px",
                  fontSize: "12px", fontWeight: 600, color: "white",
                  backgroundColor: row.color, borderRadius: "9px", padding: "1px 8px",
                }}>
                  {row.count} {row.label}
                </span>
              ))}
              {attentionRows.length > 3 && (
                <span style={{ fontSize: "12px", color: hasCritical ? "#991b1b" : "#92400e", fontWeight: 600, alignSelf: "center" }}>
                  +{attentionRows.length - 3} more
                </span>
              )}
            </div>
            <span style={{ fontSize: "13px", color: hasCritical ? "#991b1b" : "#92400e", fontWeight: 700, flexShrink: 0 }}>{bannerOpen ? "▲ Hide" : "▼ Show"}</span>
          </div>
        ) : (
          <p style={{ color: SLATE, fontSize: "15px", margin: 0, maxWidth: "640px" }}>
            Exceptions surface automatically. If nothing needs your attention, everything is on track.
          </p>
        )}
        <div style={{ backgroundColor: "var(--bg-card, #ffffff)", border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "8px 12px", flexShrink: 0 }}>
          <label style={{ fontWeight: 700, display: "block", marginBottom: "3px", fontSize: "15px", color: SLATE }}>View date</label>
          <input
            type="date"
            value={selectedDate}
            min={minDate}
            max={today}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{ padding: "6px 9px", border: `1px solid ${BORDER}`, borderRadius: "6px", fontSize: "16px" }}
          />
          <div style={{ marginTop: "5px", color: SLATE, fontSize: "15px" }}>
            {selectedMonth} · Q{currentQuarter}
          </div>
        </div>
      </div>

      {/* ── SECTION 1: NEEDS YOUR ATTENTION (expanded detail) ── */}
      {hasAttention && bannerOpen ? (
        <div style={{
          border: `1px solid ${hasCritical ? "#fecaca" : BORDER}`,
          borderLeft: `4px solid ${hasCritical ? "#dc2626" : "#d97706"}`,
          borderRadius: "8px",
          backgroundColor: hasCritical ? "#fef2f2" : "#fffbeb",
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
                        backgroundColor: isOpen ? "var(--bg-card, #ffffff)" : "transparent",
                        borderBottom: `1px solid ${hasCritical ? "#fecaca" : "#fde68a"}`,
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
                      <div style={{ backgroundColor: "var(--bg-card, #ffffff)" }}>
                        {row.items.map((item) => {
                          const href = item.taskId ? `/tasks?task=${item.taskId}` : undefined;
                          const inner = (
                            <div style={{
                              padding: "8px 16px 8px 48px",
                              borderBottom: `1px solid var(--border-light, #f1f5f9)`,
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
                                    backgroundColor: item.badge === "High" || item.badge === "Urgent" ? "#dc2626" : item.badge === "Medium" ? "#2563eb" : "#64748b",
                                    color: "white",
                                  }}>{item.badge}</span>
                                )}
                                <span style={{ fontSize: "15px", color: "#2563eb", fontWeight: 600 }}>Open →</span>
                              </div>
                            </div>
                          );
                          return href ? (
                            <a key={item.key} href={href} style={{ textDecoration: "none", color: "inherit", display: "block" }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "var(--bg-card-hover, #f8fafc)"; }}
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

      {/* ── SECTION 2: OPERATIONS STATUS ── */}
      <SectionTitle title="Operations Status — Today" />
      {/* Hero tile: Good Stock is the one number that's always meaningful (a running inventory level, not a daily flow that can legitimately be zero) */}
      <a href="/dashboard" style={{ textDecoration: "none", display: "block", marginBottom: "10px" }}>
        <div style={{
          border: `1px solid ${BORDER}`, borderLeft: "4px solid #2563eb", borderRadius: "8px",
          padding: "16px 20px", backgroundColor: "var(--bg-card, #ffffff)",
          cursor: "pointer", transition: "box-shadow 0.15s",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "none"; }}
        >
          <div>
            <div style={{ color: SLATE, fontSize: "15px", marginBottom: "2px" }}>Good Stock — Closing Inventory</div>
            <div style={{ fontSize: "32px", fontWeight: 800, color: "#2563eb", lineHeight: 1.1 }}>{closingGoodStock.toLocaleString()}</div>
          </div>
          <span style={{ fontSize: "14px", color: "#2563eb", fontWeight: 600 }}>View dashboard →</span>
        </div>
      </a>
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fit, minmax(130px, 1fr))",
        gap: "14px", marginBottom: "14px",
      }}>
        <Card title="Produced" value={produced} color="#16a34a" href="/dashboard" muted={produced === 0} caption="No data submitted yet today" />
        <Card title="Dispatched" value={dispatched} color="#059669" href="/dashboard" muted={dispatched === 0} caption="No data submitted yet today" />
        <Card title="Broken" value={broken} color="#dc2626" href="/dashboard" muted={broken === 0} caption="No data submitted yet today" />
        <Card title="Machine Issues" value={machineIssues.length} color="#dc2626" href="/dashboard" muted={machineIssues.length === 0} caption="No issues reported" />
        <Card title="Broken Stock" value={closingBrokenStock} color="#dc2626" href="/dashboard" muted={closingBrokenStock === 0} />
        <Card title="Completed (Month)" value={completedThisMonth.length} color="#16a34a" href="/tasks" muted={completedThisMonth.length === 0} caption="Nothing completed yet this month" />
      </div>

      {/* ── CHARTS ROW (exactly 2 items so the grid never wraps to a half-empty row) ── */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
        {dailyOpsData.length > 1 && (
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)" }}>
            <div style={{ fontSize: "16px", fontWeight: 700, color: NAVY, marginBottom: "10px" }}>Daily Production Trend — This Month</div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={dailyOpsData.map((d) => ({ ...d, date: d.date.slice(5) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: SLATE }} />
                <YAxis
                  tick={{ fontSize: 12, fill: SLATE }}
                  domain={[0, (max: number) => Math.ceil(max * 1.15)]}
                  tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : `${v}`}
                />
                <Tooltip />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: "13px" }} />
                <Line type="monotone" dataKey="produced" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} name="Produced (solid green)" />
                <Line type="monotone" dataKey="dispatched" stroke="#059669" strokeWidth={2} dot={{ r: 3 }} name="Dispatched (dashed teal)" strokeDasharray="5 3" />
                <Line type="monotone" dataKey="broken" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} name="Broken (red)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {(() => {
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
              <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)" }}>
                <div style={{ fontSize: "16px", fontWeight: 700, color: NAVY, marginBottom: "12px" }}>Monthly Receipts vs Payments</div>
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "14px", height: "220px" }}>
                  {cashData.map((m) => (
                    <div key={m.month}>
                      <div style={{ fontSize: "13px", color: SLATE, marginBottom: "6px", fontWeight: 600 }}>{m.month}</div>
                      <div style={{ display: "flex", gap: "16px" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: "11px", color: SLATE }}>Receipts</div>
                          <div style={{ fontSize: "20px", fontWeight: 800, color: "#16a34a" }}>PKR {fmt(m.receipts)}</div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: "11px", color: SLATE }}>Payments</div>
                          <div style={{ fontSize: "20px", fontWeight: 800, color: "#dc2626" }}>PKR {fmt(m.payments)}</div>
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
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)" }}>
              <div style={{ fontSize: "16px", fontWeight: 700, color: NAVY, marginBottom: "10px" }}>Monthly Receipts vs Payments</div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={cashData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: SLATE }} />
                  <YAxis tick={{ fontSize: 12, fill: SLATE }} tickFormatter={fmt} />
                  <Tooltip formatter={(value) => `PKR ${Number(value).toLocaleString()}`} />
                  <Legend iconType="plainline" wrapperStyle={{ fontSize: "13px" }} />
                  <Line type="monotone" dataKey="receipts" stroke="#16a34a" strokeWidth={2} dot={{ r: 4 }} name="Receipts (green)" />
                  <Line type="monotone" dataKey="payments" stroke="#dc2626" strokeWidth={2} dot={{ r: 4 }} name="Payments (red)" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          );
        })()}
      </div>

      {/* ── CASH FLOW WATERFALL (full-width, separate row so the 2-col charts grid above never wraps) ── */}
      {(() => {
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
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)", marginBottom: "14px" }}>
            <div style={{ fontSize: "16px", fontWeight: 700, color: NAVY, marginBottom: "12px" }}>Cash Flow Waterfall — Latest Day</div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : `repeat(${waterfallData.length}, 1fr)`, gap: "16px" }}>
              {waterfallData.map((w) => {
                const maxVal = Math.max(Math.abs(w.opening), Math.abs(w.receipts), Math.abs(w.payments), Math.abs(w.postDated), Math.abs(w.closing), 1);
                const barHeight = (v: number) => Math.max(4, (Math.abs(v) / maxVal) * 80);
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
                      fontSize: "14px", fontWeight: 600, color: NAVY, marginBottom: "10px",
                      lineHeight: 1.25, minHeight: "35px", display: "flex", alignItems: "flex-end",
                    }}>{w.company}</div>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: "6px", height: "118px" }}>
                      {items.map((item) => (
                        <div key={item.label} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <div style={{
                            fontSize: "10px", fontWeight: 600, color: item.color, marginBottom: "4px",
                            textAlign: "center", lineHeight: 1.2, height: "26px",
                            display: "flex", alignItems: "flex-end", justifyContent: "center",
                            wordBreak: "break-word", width: "100%",
                          }}>
                            {item.value >= 0 ? "" : "−"}{fmtMoney(Math.abs(item.value))}
                          </div>
                          <div style={{ width: "100%", maxWidth: "40px", height: `${barHeight(item.value)}px`, backgroundColor: item.color, borderRadius: "4px 4px 0 0", opacity: 0.8 }} />
                          <div style={{ fontSize: "10px", color: SLATE, marginTop: "4px", textAlign: "center" }}>{item.label}</div>
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

      {/* ── Two continuous columns: left = Finance, right = Receivables + Investments + Department Scorecard ── */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "14px", alignItems: "start" }}>
        {/* LEFT COLUMN */}
        <div>
          {showFinance && companyFinance.length === 2 && (() => {
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
              <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", backgroundColor: "var(--bg-card, #ffffff)", padding: "14px", marginBottom: "14px" }}>
                <div style={{ fontSize: "15px", fontWeight: 700, color: NAVY, marginBottom: "10px" }}>Company Comparison</div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#2563eb" }}>{a.companyName.split(" ")[0]}</span>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#16a34a" }}>{b.companyName.split(" ")[0]}</span>
                </div>
                {metrics.map((m) => {
                  const pctA = maxVal > 0 ? (Math.abs(m.a) / maxVal) * 100 : 0;
                  const pctB = maxVal > 0 ? (Math.abs(m.b) / maxVal) * 100 : 0;
                  return (
                    <div key={m.label} style={{ marginBottom: "8px" }}>
                      <div style={{ fontSize: "12px", color: SLATE, textAlign: "center", marginBottom: "2px" }}>{m.label}</div>
                      <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                        <span style={{ fontSize: "12px", color: "#2563eb", width: "70px", textAlign: "right" }}>{fmtMoney(m.a)}</span>
                        <div style={{ flex: 1, display: "flex", height: "14px", gap: "2px" }}>
                          <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
                            <div style={{ width: `${pctA}%`, backgroundColor: "#2563eb", borderRadius: "3px 0 0 3px", minWidth: pctA > 0 ? "2px" : 0 }} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ width: `${pctB}%`, backgroundColor: "#16a34a", borderRadius: "0 3px 3px 0", minWidth: pctB > 0 ? "2px" : 0 }} />
                          </div>
                        </div>
                        <span style={{ fontSize: "12px", color: "#16a34a", width: "70px" }}>{fmtMoney(m.b)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          {showFinance && companyFinance.map((cfd) => (
            <CompanyFinancePanel key={cfd.companyId} data={cfd} />
          ))}
        </div>

        {/* RIGHT COLUMN */}
        <div>
          <SectionTitle title="Receivables — Bills in Progress" style={{ marginTop: 0 }} />
          {receivableRows.length === 0 ? (
            <p style={{ color: SLATE, fontSize: "17px" }}>No receivable bills in progress.</p>
          ) : (
            <div style={panelCard(recRed > 0)}>
              <div style={{ fontSize: "17px", fontWeight: 700, marginBottom: "10px", color: NAVY }}>
                Receivables: <span style={{ color: recRed > 0 ? "#dc2626" : "#16a34a" }}>{recRed > 0 ? `${recRedCount} BILL(S) STUCK` : "ALL ON TRACK"}</span>
              </div>
              <div style={miniGrid}>
                <Mini label="Total Tracked" value={fmtMoney(recTotal)} color="#2563eb" />
                <Mini label="On Time" value={fmtMoney(recGreen)} color="#16a34a" />
                <Mini label="Due Soon" value={fmtMoney(recAmber)} color="#d97706" />
                <Mini label="Stuck" value={fmtMoney(recRed)} color="#dc2626" />
              </div>
              <div style={{ fontSize: "15px", color: NAVY, marginTop: "4px", marginBottom: "8px", lineHeight: "1.6" }}>
                <span style={{ fontWeight: 700 }}>Aging:</span>{" "}
                <span style={{ color: "#16a34a" }}>PKR {fmtMoney(recAgingTotals["0-30"])} (0-30d)</span>{" · "}
                <span style={{ color: "#d97706" }}>PKR {fmtMoney(recAgingTotals["31-60"])} (31-60d)</span>{" · "}
                <span style={{ color: "#dc2626" }}>PKR {fmtMoney(recAgingTotals["61-90"])} (61-90d)</span>{" · "}
                <span style={{ color: "#991b1b", fontWeight: 700 }}>PKR {fmtMoney(recAgingTotals["90+"])} (90+d)</span>
              </div>
              {recAgingByCustomer.length > 0 && (
                <div style={{ overflowX: "auto", marginBottom: "8px" }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "380px" }}>
                    <thead>
                      <tr style={{ backgroundColor: "var(--bg-card-hover, #f8fafc)" }}>
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
                              const bgColor = bucket === "0-30" ? `rgba(22,163,74,${intensity})` : bucket === "31-60" ? `rgba(217,119,6,${intensity})` : `rgba(220,38,38,${intensity})`;
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
                    <tr style={{ backgroundColor: "var(--bg-card-hover, #f8fafc)" }}>
                      <th style={th}>Customer</th><th style={th}>On Time</th><th style={th}>Due Soon</th><th style={th}>Stuck</th><th style={th}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receivableRows.map((r) => (
                      <tr key={r.customer}>
                        <td style={tdBold}>{r.customer}</td>
                        <td style={{ ...td, color: "#16a34a" }}>{fmtMoney(r.greenAmount)}</td>
                        <td style={{ ...td, color: "#d97706" }}>{fmtMoney(r.amberAmount)}</td>
                        <td style={{ ...td, color: "#dc2626" }}>{fmtMoney(r.redAmount)}</td>
                        <td style={td}>{fmtMoney(r.totalAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </div>
          )}

          {investmentData && (
            <>
              <SectionTitle title="Investments — PSX Portfolio" />
              <a href="/investments" style={{ textDecoration: "none", display: "block" }}>
                <div style={{
                  border: `1px solid ${BORDER}`,
                  borderLeft: `4px solid ${investmentData.gainLoss >= 0 ? "#16a34a" : "#dc2626"}`,
                  borderRadius: "8px", padding: "14px 16px",
                  backgroundColor: "var(--bg-card, #ffffff)", marginBottom: "14px",
                  cursor: "pointer", transition: "box-shadow 0.15s",
                }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "none"; }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginBottom: investmentData.losers.length > 0 ? "10px" : "0" }}>
                    <div>
                      <div style={{ fontSize: "14px", color: SLATE }}>Invested</div>
                      <div style={{ fontSize: "16px", fontWeight: 800, color: NAVY }}>Rs {fmtMoney(investmentData.totalCost)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "14px", color: SLATE }}>Current Value</div>
                      <div style={{ fontSize: "16px", fontWeight: 800, color: "#2563eb" }}>Rs {fmtMoney(investmentData.totalValue)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "14px", color: SLATE }}>Gain/Loss</div>
                      <div style={{ fontSize: "16px", fontWeight: 800, color: investmentData.gainLoss >= 0 ? "#16a34a" : "#dc2626" }}>
                        {investmentData.gainLoss >= 0 ? "+" : ""}Rs {fmtMoney(Math.abs(investmentData.gainLoss))}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "14px", color: SLATE }}>Return</div>
                      <div style={{ fontSize: "16px", fontWeight: 800, color: investmentData.gainLossPct >= 0 ? "#16a34a" : "#dc2626" }}>
                        {investmentData.gainLossPct >= 0 ? "+" : ""}{investmentData.gainLossPct.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                  {investmentData.losers.length > 0 && (
                    <div style={{ borderTop: `1px solid #fecaca`, paddingTop: "8px", fontSize: "15px", color: "#991b1b" }}>
                      <span style={{ fontWeight: 700 }}>{investmentData.losers.length} stock{investmentData.losers.length > 1 ? "s" : ""} down &gt;5%:</span>{" "}
                      {investmentData.losers.map((l, i) => (
                        <span key={l.ticker}>{i > 0 ? ", " : ""}{l.ticker} ({l.pct.toFixed(1)}%)</span>
                      ))}
                    </div>
                  )}
                  {investmentData.priceDate && (
                    <div style={{ fontSize: "13px", color: SLATE, marginTop: "6px" }}>
                      {investmentData.stockCount} stocks · Prices as of {investmentData.priceDate} · Click to view portfolio →
                    </div>
                  )}
                </div>
              </a>
            </>
          )}

          {/* ── Department Scorecard — merges Department Health + Performance into one view ── */}
          <SectionTitle title="Department Scorecard" />
          <div style={{
            border: `1px solid ${BORDER}`, borderRadius: "8px",
            backgroundColor: "var(--bg-card, #ffffff)", overflow: "hidden", marginBottom: "14px",
          }}>
            {scorecardRows.map((d, i) => {
              const statusColor = d.status === "GREEN" ? "#16a34a" : d.status === "AMBER" ? "#d97706" : "#dc2626";
              const isLegalStub = d.title === "Legal" && d.owner === "Not yet built";
              const hasPerf = !!d.perf && d.perf.total > 0;
              const inner = (
                <div style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "10px 14px",
                  borderBottom: i < scorecardRows.length - 1 ? `1px solid var(--border-light, #f1f5f9)` : "none",
                }}>
                  <span style={{
                    width: "10px", height: "10px", borderRadius: "50%",
                    backgroundColor: statusColor, flexShrink: 0,
                    boxShadow: `0 0 4px ${statusColor}40`,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary, #1e293b)" }}>{d.title}</div>
                  </div>
                  <span style={{ fontSize: "13px", color: SLATE, flexShrink: 0, fontWeight: hasPerf ? 700 : 400, width: "150px", textAlign: "right" }}>
                    {hasPerf
                      ? <>
                          <span style={{ color: d.perf!.red > 0 ? "#dc2626" : SLATE }}>{d.perf!.red} overdue</span>
                          {" / "}
                          <span style={{ color: d.perf!.amber > 0 ? "#d97706" : SLATE }}>{d.perf!.amber} active</span>
                        </>
                      : d.detail}
                  </span>
                  <span style={{
                    fontSize: "12px", fontWeight: 700, color: statusColor, flexShrink: 0, minWidth: "54px", textAlign: "center",
                    padding: "2px 8px", borderRadius: "10px", backgroundColor: `${statusColor}1a`,
                  }}>{d.status}</span>
                </div>
              );
              return isLegalStub ? (
                <div key={d.slug} style={{ opacity: 0.6 }}>{inner}</div>
              ) : (
                <a key={d.slug} href={`/department/${d.slug}`} style={{ textDecoration: "none", color: "inherit", display: "block", transition: "background-color 0.1s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-card-hover, #f8fafc)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                >{inner}</a>
              );
            })}
          </div>

          <DrillDownPerformance departmentRows={departmentRows} deptPeopleMap={deptPeopleMap} />
        </div>
      </div>
    </>
  );
}

/* ───────────────────────── Shared style constants ───────────────────────── */

const miniGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(105px, 1fr))",
  gap: "9px",
};

function panelCard(red: boolean): React.CSSProperties {
  return {
    border: `1px solid ${BORDER}`,
    borderTop: `3px solid ${red ? "#dc2626" : "#16a34a"}`,
    borderRadius: "8px",
    padding: "12px",
    backgroundColor: "var(--bg-card, #ffffff)",
    marginBottom: "4px",
  };
}

function panelCardRAG(status: RAGStatus): React.CSSProperties {
  return {
    border: `1px solid ${BORDER}`,
    borderTop: `3px solid ${ragColour(status)}`,
    borderRadius: "8px",
    padding: "12px",
    backgroundColor: "var(--bg-card, #ffffff)",
    marginBottom: "4px",
  };
}
void panelCardRAG;

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
  padding: "6px 8px",
  fontSize: "16px",
};

const tdBold: React.CSSProperties = {
  ...td,
  fontWeight: 700,
  color: NAVY,
};

/* ───────────────────────── Small shared components ───────────────────────── */

function Card({ title, value, color, onClick, href, muted, caption }: { title: string; value: number; color: string; onClick?: () => void; href?: string; muted?: boolean; caption?: string }) {
  const isClickable = !!(onClick || href);
  const isZero = value === 0;
  const effectiveMuted = !!muted;
  const displayColor = effectiveMuted ? SLATE : color;
  const content = (
    <div style={{
      border: `1px solid ${BORDER}`,
      borderTop: effectiveMuted ? `3px solid ${BORDER}` : `3px solid ${color}`,
      borderRadius: "7px",
      padding: "8px 10px",
      backgroundColor: effectiveMuted ? "var(--bg-card-hover, #f8fafc)" : "var(--bg-card, #ffffff)",
      cursor: isClickable ? "pointer" : "default",
      transition: "box-shadow 0.15s",
    }}
    onClick={onClick}
    onMouseEnter={isClickable ? (e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)"; } : undefined}
    onMouseLeave={isClickable ? (e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "none"; } : undefined}
    >
      <div style={{ color: SLATE, fontSize: "15px", marginBottom: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {title} {isClickable && <span style={{ fontSize: "12px" }}>→</span>}
      </div>
      <div style={{ fontSize: "19px", fontWeight: 800, color: displayColor }}>{value.toLocaleString()}</div>
      {caption && isZero && (
        <div style={{ fontSize: "11px", color: SLATE, marginTop: "2px", fontStyle: "italic" }}>{caption}</div>
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
      border: `1px solid ${BORDER}`,
      borderRadius: "8px",
      backgroundColor: "var(--bg-card, #ffffff)",
      marginBottom: "14px",
      overflow: "hidden",
    }}>
      <div style={{
        padding: "10px 14px",
        backgroundColor: "var(--bg-card-hover, #f8fafc)",
        borderBottom: `1px solid ${BORDER}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <span style={{ fontSize: "16px", fontWeight: 700, color: NAVY }}>{title}</span>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {linkHref && (
            <a href={linkHref} style={{ fontSize: "16px", color: "#2563eb", fontWeight: 600, textDecoration: "none" }}>
              {linkLabel || "View all"} →
            </a>
          )}
          <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${BORDER}`, borderRadius: "6px", padding: "4px 10px", fontSize: "16px", color: SLATE, cursor: "pointer" }}>
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
    <div style={{ padding: "9px 14px", borderBottom: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "15px", fontWeight: 600, color: NAVY }}>{primary}</div>
        {secondary && <div style={{ fontSize: "16px", color: SLATE, marginTop: "2px" }}>{secondary}</div>}
      </div>
      {badge && (
        <span style={{
          fontSize: "12px", fontWeight: 700, padding: "2px 8px", borderRadius: "10px", whiteSpace: "nowrap", flexShrink: 0,
          backgroundColor: badge === "High" || badge === "Urgent" ? "#dc2626" : badge === "Medium" ? "#2563eb" : "#64748b",
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
      <div style={{ color: SLATE, fontSize: "16px", marginBottom: "1px" }}>{label}</div>
      <div style={{ fontSize: "16px", fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function SlimAlert({ color, text }: { color: string; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", backgroundColor: "var(--bg-card, #ffffff)", border: `1px solid ${BORDER}`, borderLeft: `4px solid ${color}`, borderRadius: "6px", padding: "10px 14px", marginBottom: "14px" }}>
      <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: color, flexShrink: 0 }} />
      <span style={{ fontSize: "17px", color: NAVY }}>{text}</span>
    </div>
  );
}
void SlimAlert;

function DrillDownPerformance({ departmentRows, deptPeopleMap }: { departmentRows: PerformanceRow[]; deptPeopleMap: Map<string, PerformanceRow[]> }) {
  const [selectedDept, setSelectedDept] = useState<string | null>(null);

  if (departmentRows.length === 0) return <p style={{ color: SLATE, fontSize: "17px" }}>No task data yet.</p>;

  const chartData = departmentRows.map((d) => ({
    name: d.name.length > 16 ? d.name.slice(0, 14) + "…" : d.name,
    fullName: d.name,
    Overdue: d.red,
    "In Progress": d.amber,
    Completed: d.green,
  }));

  const selectedPeople = selectedDept ? (deptPeopleMap.get(selectedDept) || []).filter((p) => p.total > 0) : [];

  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", backgroundColor: "var(--bg-card, #ffffff)", overflow: "hidden", marginBottom: "12px" }}>
      <div style={{ padding: "14px" }}>
        <div style={{ fontSize: "16px", fontWeight: 700, color: NAVY, marginBottom: "10px" }}>Task Load by Department — click a bar to see people</div>
        <div style={{ minHeight: "180px" }}>
        <ResponsiveContainer width="100%" height={Math.max(180, departmentRows.length * 38)}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20, top: 0, bottom: 0 }} onClick={(state: unknown) => { const s = state as { activePayload?: { payload?: { fullName?: string } }[] }; const fn = s?.activePayload?.[0]?.payload?.fullName; if (fn) setSelectedDept(selectedDept === fn ? null : fn); }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 12, fill: SLATE }} />
            <YAxis dataKey="name" type="category" tick={{ fontSize: 13, fill: NAVY, fontWeight: 600 }} width={130} />
            <Tooltip />
            <Legend iconType="square" wrapperStyle={{ fontSize: "13px" }} />
            <Bar dataKey="Overdue" stackId="a" fill="#dc2626" radius={[0, 0, 0, 0]} cursor="pointer" name="Overdue (red)" />
            <Bar dataKey="In Progress" stackId="a" fill="#d97706" cursor="pointer" name="In Progress (amber)" />
            <Bar dataKey="Completed" stackId="a" fill="#16a34a" radius={[0, 4, 4, 0]} cursor="pointer" name="Completed (green)" />
          </BarChart>
        </ResponsiveContainer>
        </div>
      </div>

      {selectedDept && selectedPeople.length > 0 && (
        <div style={{ borderTop: `1px solid ${BORDER}`, padding: "10px 14px", backgroundColor: "var(--bg-card-hover, #f8fafc)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "15px", fontWeight: 700, color: NAVY }}>{selectedDept} — People</span>
            <button onClick={() => setSelectedDept(null)} style={{ background: "transparent", border: `1px solid ${BORDER}`, borderRadius: "5px", padding: "3px 10px", fontSize: "15px", color: SLATE, cursor: "pointer" }}>Close</button>
          </div>
          {selectedPeople.map((person) => (
            <div key={person.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: `1px solid ${BORDER}` }}>
              <span style={{ fontSize: "16px", fontWeight: 600, color: NAVY }}>{person.name}</span>
              <div style={{ display: "flex", gap: "10px", fontSize: "15px", fontWeight: 700 }}>
                {person.red > 0 && <span style={{ color: "#dc2626" }}>{person.red} overdue</span>}
                {person.amber > 0 && <span style={{ color: "#d97706" }}>{person.amber} active</span>}
                {person.green > 0 && <span style={{ color: "#16a34a" }}>{person.green} done</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PerformanceTable({ rows }: { rows: PerformanceRow[] }) {
  if (rows.length === 0) return <p style={{ color: SLATE, fontSize: "17px" }}>No task data yet.</p>;
  return (
    <div style={{ overflowX: "auto", marginBottom: "12px", backgroundColor: "var(--bg-card, #ffffff)", border: `1px solid ${BORDER}`, borderRadius: "8px" }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ backgroundColor: "var(--bg-card-hover, #f8fafc)" }}>
            <th style={th}>Name</th><th style={th}>Red</th><th style={th}>Amber</th><th style={th}>Green</th><th style={th}>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td style={tdBold}>{r.name}</td>
              <td style={{ ...td, color: "#dc2626", fontWeight: 700 }}>{r.red}</td>
              <td style={{ ...td, color: "#d97706", fontWeight: 700 }}>{r.amber}</td>
              <td style={{ ...td, color: "#16a34a", fontWeight: 700 }}>{r.green}</td>
              <td style={td}>{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
void PerformanceTable;

function CompanyFinancePanel({ data }: { data: CompanyFinanceData }) {
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
      borderTop: opts?.borderTop ? `1px solid ${BORDER}` : undefined,
      marginTop: opts?.borderTop ? "4px" : undefined,
      paddingTop: opts?.borderTop ? "6px" : undefined,
    }}>
      <span style={{ fontSize: opts?.bold ? "15px" : "16px", fontWeight: opts?.bold ? 700 : 400, color: opts?.color || (opts?.bold ? NAVY : SLATE) }}>{label}</span>
      <span style={{ fontSize: opts?.bold ? "16px" : "16px", fontWeight: opts?.bold ? 700 : 600, color: opts?.color || NAVY }}>{value}</span>
    </div>
  );

  const [showDetail, setShowDetail] = useState<string | null>(null);
  const toggleDetail = (key: string) => setShowDetail(showDetail === key ? null : key);

  const summaryCard = (label: string, value: string, sub: string, color: string, opts?: { primary?: boolean; freshnessDate?: string | null }) => (
    <div style={{
      borderRadius: "8px",
      padding: opts?.primary ? "14px 16px" : "10px 12px",
      backgroundColor: "var(--bg-card, #ffffff)",
      border: `1px solid ${BORDER}`,
      borderTop: `3px solid ${color}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "2px" }}>
        <div style={{ fontSize: "15px", color: SLATE }}>{label}</div>
        {opts?.freshnessDate !== undefined && <FreshnessBadge date={opts.freshnessDate} />}
      </div>
      <div style={{ fontSize: opts?.primary ? "24px" : "18px", fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: "14px", color: SLATE, marginTop: "2px" }}>{sub}</div>
    </div>
  );

  const expandSection = (key: string, title: string, children: React.ReactNode) => (
    <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: "8px" }}>
      <div onClick={() => toggleDetail(key)} style={{ padding: "8px 0", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "16px", fontWeight: 700, color: NAVY }}>{title}</span>
        <span style={{ fontSize: "15px", color: SLATE }}>{showDetail === key ? "▲ Hide" : "▼ Show"}</span>
      </div>
      {showDetail === key && <div style={{ paddingBottom: "6px" }}>{children}</div>}
    </div>
  );

  return (
    <>
      <SectionTitle title={`Finance — ${data.companyName}`} />
      {!data.cashPlan && !data.cashOpening && data.cashPositions.length === 0 && data.forecast.length === 0 ? (
        <p style={{ color: SLATE, fontSize: "17px" }}>No finance data yet.</p>
      ) : (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "12px", backgroundColor: "var(--bg-card, #ffffff)", marginBottom: "8px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "8px", marginBottom: "8px" }}>
            {summaryCard(
              "Cash Available",
              latest ? `PKR ${fmtMoney(latest.closing_after_post_dated)}` : "—",
              latest ? `Updated ${formatDateUK(latest.position_date)}` : "No data",
              !latest ? "#2563eb" : latest.closing_after_post_dated < 0 ? "#dc2626" : "#16a34a",
              { primary: true, freshnessDate: latest ? latest.position_date : null }
            )}
            {summaryCard(
              "Money In (MTD)",
              `PKR ${fmtMoney(actualReceiptsMTD)}`,
              plannedRecv > 0 ? `${Math.round(recvPct)}% of expected` : "No plan set",
              plannedRecv > 0 ? (recvStatus === "RED" ? "#dc2626" : recvStatus === "AMBER" ? "#d97706" : "#16a34a") : "#2563eb"
            )}
            {summaryCard(
              "Money Out (MTD)",
              `PKR ${fmtMoney(actualPaymentsMTD)}`,
              plannedPay > 0 ? `${Math.round(payPct)}% of expected` : "No plan set",
              plannedPay > 0 ? (payStatus === "RED" ? "#dc2626" : payStatus === "AMBER" ? "#d97706" : "#16a34a") : "#2563eb"
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 4px", fontSize: "16px" }}>
            <span style={{ color: SLATE }}>Projected month-end</span>
            <span style={{ fontWeight: 700, color: projected >= 0 ? "#16a34a" : "#dc2626" }}>PKR {fmtMoney(projected)}</span>
          </div>
          {data.forecast.length > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 4px 6px", fontSize: "16px" }}>
              <span style={{ color: SLATE }}>Forecast net cash flow</span>
              <span style={{ fontWeight: 700, color: forecastNet >= 0 ? "#16a34a" : "#dc2626" }}>PKR {fmtMoney(forecastNet)}</span>
            </div>
          )}

          {(plannedRecv > 0 || plannedPay > 0) && expandSection("plan", "Actual vs Plan Details", (
            <div style={{ fontSize: "16px" }}>
              {fRow("Received so far", `PKR ${fmtMoney(actualReceiptsMTD)}`)}
              {fRow(`Expected by day ${de} of ${dim}`, `PKR ${fmtMoney(Math.round(expRecv))}`, { indent: true })}
              {fRow("Receipts status", recvStatus === "GREEN" ? "On track" : recvStatus === "AMBER" ? "Slightly behind" : "Behind", { bold: true, color: ragColour(recvStatus) })}
              <div style={{ height: "6px" }} />
              {fRow("Paid out so far", `PKR ${fmtMoney(actualPaymentsMTD)}`)}
              {fRow(`Expected by day ${de} of ${dim}`, `PKR ${fmtMoney(Math.round(expPay))}`, { indent: true })}
              {fRow("Payments status", payStatus === "GREEN" ? "On track" : payStatus === "AMBER" ? "Slightly over" : "Over budget", { bold: true, color: ragColour(payStatus) })}
            </div>
          ))}

          {data.forecast.length > 0 && expandSection("forecast", `Forecast Breakdown — ${data.forecast[0]?.budget_month === financeMonth ? "This Month" : formatMonthUK(data.forecast[0]?.budget_month || null)}`, (
            <div style={{ fontSize: "16px" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#16a34a", marginBottom: "2px", textTransform: "uppercase" }}>Money In</div>
              {inflows.map((f) => fRow(f.category, `PKR ${fmtMoney(f.budgeted_amount)}`, { indent: true }))}
              {fRow("Total inflows", `PKR ${fmtMoney(forecastTotalIn)}`, { bold: true, color: "#16a34a" })}
              <div style={{ height: "6px" }} />
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#dc2626", marginBottom: "2px", textTransform: "uppercase" }}>Money Out</div>
              {outflows.map((f) => fRow(f.category, `PKR ${fmtMoney(f.budgeted_amount)}`, { indent: true }))}
              {fRow("Total outflows", `PKR ${fmtMoney(forecastTotalOut)}`, { bold: true, color: "#dc2626" })}
              {fRow("Net", `PKR ${fmtMoney(forecastNet)}`, { bold: true, borderTop: true, color: forecastNet >= 0 ? "#16a34a" : "#dc2626" })}
            </div>
          ))}

          {data.lastYearReceipts !== null && expandSection("lastyear", "vs Same Month Last Year", (
            <div style={{ fontSize: "16px" }}>
              {fRow("Received last year", `PKR ${fmtMoney(data.lastYearReceipts)}`)}
              {fRow("Received this year", `PKR ${fmtMoney(actualReceiptsMTD)}`)}
              {fRow("Difference", `${actualReceiptsMTD >= data.lastYearReceipts! ? "+" : ""}PKR ${fmtMoney(actualReceiptsMTD - data.lastYearReceipts!)}`, { bold: true, color: actualReceiptsMTD >= data.lastYearReceipts! ? "#16a34a" : "#dc2626" })}
            </div>
          ))}

          {data.deptBudgets.length > 0 && (() => {
            const totalB = data.deptBudgets.reduce((s, b) => s + b.budgeted_amount, 0);
            const totalA = data.deptBudgets.reduce((s, b) => s + b.actual_amount, 0);
            const over = totalA > totalB;
            return expandSection("deptbudget", `Department Budgets — ${over ? "Over" : "Under"} by PKR ${fmtMoney(Math.abs(totalB - totalA))}`, (
              <div style={{ fontSize: "16px" }}>
                {data.deptBudgets.map((b, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: `1px solid ${BORDER}` }}>
                    <span style={{ color: SLATE }}>{b.department} — {b.category}</span>
                    <span style={{ fontWeight: 600, color: b.actual_amount > b.budgeted_amount ? "#dc2626" : "#16a34a" }}>
                      PKR {fmtMoney(b.actual_amount)} / {fmtMoney(b.budgeted_amount)}
                    </span>
                  </div>
                ))}
                {fRow("Total Budget", `PKR ${fmtMoney(totalB)}`, { bold: true, borderTop: true })}
                {fRow("Total Actual", `PKR ${fmtMoney(totalA)}`, { bold: true, color: over ? "#dc2626" : "#16a34a" })}
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
      backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
      borderRadius: "8px", padding: "10px 12px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
        <span style={{ fontSize: "15px", opacity: 0.8 }}>{icon}</span>
        <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{label}</span>
      </div>
      <div style={{
        fontSize: "22px", fontWeight: 800, lineHeight: 1,
        color: alert ? COLOURS.RED : "var(--text-primary)",
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
