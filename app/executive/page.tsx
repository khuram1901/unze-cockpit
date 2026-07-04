"use client";

import React, { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase, loadMyPermissions } from "../lib/supabase";
import EscalationTrafficLights from "./EscalationTrafficLights";
import { formatDateUK, formatMonthUK, workingDaysFromNow } from "../lib/dateUtils";
import { COLOURS, SectionTitle, RAGStatus, ragColour, FreshnessBadge } from "../lib/SharedUI";
import { UTPL_COMPANY_ID, COMPANIES } from "../lib/constants";
import { useMobile } from "../lib/useMobile";
import { useRequireCapability } from "../lib/useRouteGuard";
import MyTasks from "../lib/MyTasks";
import { DEPARTMENT_CONFIGS, getDepartmentHealthStatus } from "../lib/department-config";
import { canViewFinance, type UserCtx, type PermOverrides } from "../lib/permissions";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import DateInput from "../lib/DateInput";

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
type Status = "red" | "amber" | "green" | "none";

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


const { NAVY, SLATE, BORDER } = COLOURS;

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

// UK display format DD-MM-YYYY

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

function getSevenDaysFromNow() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
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
const sevenDaysFromNow = getSevenDaysFromNow();
const currentMonthStart = getCurrentMonthStart();


function total(t: SizeTotals) {
  return t.s31 + t.s36 + t.s45 + t.meter;
}

function targetTotal(t?: MonthlyTarget) {
  if (!t) return 0;
  return (t.target_31 || 0) + (t.target_36 || 0) + (t.target_45 || 0) + (t.target_meter || 0);
}

function isCompleted(task: Task) {
  return task.status === "Completed";
}

function isOverdue(task: Task) {
  if (isCompleted(task)) return false;
  if (!task.due_date) return false;
  return task.due_date < today;
}

function isDueThisWeek(task: Task) {
  if (isCompleted(task)) return false;
  if (!task.due_date) return false;
  return task.due_date >= today && task.due_date <= sevenDaysFromNow;
}

function taskColor(task: Task): "red" | "amber" | "green" {
  if (isCompleted(task)) return "green";
  if (isOverdue(task)) return "red";
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

export default function ExecutiveDashboardPage() {
  const isMobile = useMobile();
  const { checking } = useRequireCapability("executive");
  const [selectedDate, setSelectedDate] = useState(today);
  const [summaries, setSummaries] = useState<PlantExecutiveSummary[]>([]);
  const [machineIssues, setMachineIssues] = useState<MachineIssue[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);

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

  const [companyFinance, setCompanyFinance] = useState<CompanyFinanceData[]>([]);
  const [facilitySynopsis, setFacilitySynopsis] = useState<{ bank_name: string; bank_total_limit: number; bank_seized: number; bank_available: number; bank_utilisation_pct: number; active_guarantees: number; overdue_count: number }[]>([]);
  const [receivableRows, setReceivableRows] = useState<ReceivableCustomerRow[]>([]);
  const [recAgingTotals, setRecAgingTotals] = useState<{ "0-30": number; "31-60": number; "61-90": number; "90+": number }>({ "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 });
  const [recAgingByCustomer, setRecAgingByCustomer] = useState<{ customer: string; "0-30": number; "31-60": number; "61-90": number; "90+": number; total: number }[]>([]);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
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

  type InvestmentSummary = {
    totalCost: number;
    totalValue: number;
    gainLoss: number;
    gainLossPct: number;
    stockCount: number;
    losers: { ticker: string; company: string; pct: number }[];
    priceDate: string | null;
  };
  const [investmentData, setInvestmentData] = useState<InvestmentSummary | null>(null);

  type DailyOpsPoint = { date: string; produced: number; dispatched: number; broken: number };
  const [dailyOpsData, setDailyOpsData] = useState<DailyOpsPoint[]>([]);

  function toggleCard(card: string) {
    setExpandedCard((prev) => prev === card ? null : card);
  }

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
    setLoading(true);

    // Fetch current user role for PA view filtering
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.email) {
      const { data: memberData } = await supabase
        .from("members")
        .select("id, role, first_name, name, department, company")
        .eq("email", user.email)
        .maybeSingle();
      if (memberData) {
        setUserRole(memberData.role);
        setUserName(memberData.first_name || memberData.name || null);
        let overrides: PermOverrides | null = null;
        const p = await loadMyPermissions();
        if (p) overrides = p as PermOverrides;
        const ctx: UserCtx = { email: user.email, role: memberData.role, department: memberData.department, company: memberData.company, overrides };
        setShowFinance(canViewFinance(ctx));
      }
    }

    const selectedMonth = getMonthFromDate(dateToView);
    const selectedMonthStart = getMonthStartFromDate(dateToView);
    const selectedMonthEnd = getMonthEndFromDate(dateToView);

    const ENTRY_COLS = "plant_id, entry_date, qty_31, qty_36, qty_45, qty_meter";
    const TASK_COLS = "id, description, project, priority, due_date, assigned_to, assigned_by, assigned_date, status, task_type, reply_required, reply_text, assigned_to_department, assigned_to_business_unit, created_at, updated_at, source_type, source_record_id, source_label, exception_type, explanation_required";
    const [
      plantKpisRes, machineIssuesRes, tasksRes, ownerRes,
      monthlyProductionTargetsRes, monthlyDispatchTargetsRes,
      monthlyProductionRes, monthlyDispatchRes, monthlyBreakageRes,
    ] = await Promise.all([
      // Single RPC replaces 7 raw table fetches (opening balances + 90-day entry dumps)
      supabase.rpc("get_plant_kpis", {
        as_of_date: dateToView,
        month_start: selectedMonthStart,
        month_end: selectedMonthEnd,
      }),
      supabase.from("machine_issues").select("id, plant_name, machine_name, issue_status, expected_resolution, issue_description, action_taken, created_at").neq("issue_status", "Resolved").order("created_at", { ascending: false }),
      supabase.from("tasks").select(TASK_COLS).order("created_at", { ascending: false }).limit(200),
      supabase.from("department_owners").select("department_name, primary_owner_name, primary_owner_email").eq("department_name", "Unze Trading Ops").single(),
      supabase.from("monthly_production_targets").select("id, plant_id, plant_name, target_month, target_31, target_36, target_45, target_meter").eq("target_month", selectedMonth),
      supabase.from("monthly_dispatch_targets").select("id, plant_id, plant_name, target_month, target_31, target_36, target_45, target_meter").eq("target_month", selectedMonth),
      // Monthly entries kept for daily ops chart (per-day breakdown needed) and quarterly escalation checks
      supabase.from("production_entries").select(ENTRY_COLS).gte("entry_date", selectedMonthStart).lte("entry_date", selectedMonthEnd),
      supabase.from("dispatch_entries").select(ENTRY_COLS).gte("entry_date", selectedMonthStart).lte("entry_date", selectedMonthEnd),
      supabase.from("breakage_entries").select(ENTRY_COLS).gte("entry_date", selectedMonthStart).lte("entry_date", selectedMonthEnd),
    ]);

    const plantKpis = (plantKpisRes.data || []) as PlantKpiRow[];
    const plants: Plant[] = plantKpis.map((r) => ({ id: r.plant_id, name: r.plant_name, type: r.plant_type }));
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

    // Facility synopsis — direct RPC call
    const { data: synData, error: synErr } = await supabase.rpc("get_facility_synopsis");
    if (synErr) console.error("get_facility_synopsis error:", synErr);
    // RPC returns jsonb scalar; Supabase JS gives us the parsed value directly
    const synArray = Array.isArray(synData) ? synData : [];
    setFacilitySynopsis(synArray as typeof facilitySynopsis);

    // Three RPCs replace two full-table fetches + three JS aggregation loops.
    // Slim bills fetch kept only for escalation engine (needs per-bill id/utility/amount/currency).
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

    // Aging totals — from RPC
    const aging = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 } as { "0-30": number; "31-60": number; "61-90": number; "90+": number };
    for (const r of (agingTotalsRes.data || []) as { bucket: string; total: number }[]) {
      if (r.bucket in aging) (aging as Record<string, number>)[r.bucket] = Number(r.total) || 0;
    }
    setRecAgingTotals(aging);

    // Aging by customer — from RPC
    setRecAgingByCustomer((agingByCustRes.data || []).map((r: { customer: string; b0_30: number; b31_60: number; b61_90: number; b90_plus: number; total: number }) => ({
      customer: r.customer,
      "0-30":   Number(r.b0_30)    || 0,
      "31-60":  Number(r.b31_60)   || 0,
      "61-90":  Number(r.b61_90)   || 0,
      "90+":    Number(r.b90_plus) || 0,
      total:    Number(r.total)    || 0,
    })));

    // Escalation engine — slim bills fetch above covers the fields needed
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

    // Build plant summaries directly from RPC rows — no JS loops over raw entries needed
    const result: PlantExecutiveSummary[] = plantKpis.map((r) => ({
      plant: { id: r.plant_id, name: r.plant_name, type: r.plant_type },
      closingGoodStock: {
        s31:   r.opening_good_31   + r.produced_31   - r.broken_31   - r.dispatched_31,
        s36:   r.opening_good_36   + r.produced_36   - r.broken_36   - r.dispatched_36,
        s45:   r.opening_good_45   + r.produced_45   - r.broken_45   - r.dispatched_45,
        meter: r.opening_good_meter + r.produced_meter - r.dispatched_meter,
      },
      closingBrokenStock: {
        s31:   r.opening_broken_31 + r.broken_31 - r.scrap_31,
        s36:   r.opening_broken_36 + r.broken_36 - r.scrap_36,
        s45:   r.opening_broken_45 + r.broken_45 - r.scrap_45,
        meter: 0,
      },
      producedOnDate:   { s31: r.on_date_produced_31,   s36: r.on_date_produced_36,   s45: r.on_date_produced_45,   meter: r.on_date_produced_meter },
      dispatchedOnDate: { s31: r.on_date_dispatched_31, s36: r.on_date_dispatched_36, s45: r.on_date_dispatched_45, meter: r.on_date_dispatched_meter },
      brokenOnDate:     { s31: r.on_date_broken_31,     s36: r.on_date_broken_36,     s45: r.on_date_broken_45,     meter: 0 },
      enteredOnDate:    r.entered_on_date,
    }));

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
      const kpiRow = plantKpis.find((k) => k.plant_id === plant.id);
      const producedMTD = kpiRow?.mtd_produced ?? sumBetween(monthlyProduction, plant.id, selectedMonthStart, dateToView);
      const brokenMTD = kpiRow?.mtd_broken ?? sumBetween(monthlyBreakage, plant.id, selectedMonthStart, dateToView);
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

    // Cash pacing escalation (per company)
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

    // Aggregate daily production/dispatch/breakage for the line chart
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

    // Department Health roll-up
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

    // Investment portfolio summary — uses today's date since executive page
    // always shows current prices (no historical date selector).
    const today = new Date().toISOString().slice(0, 10);
    const { data: portfolioRows } = await supabase.rpc("get_portfolio_summary_as_of", { as_of: today });
    const pRows = (portfolioRows || []) as {
      ticker: string; company_name: string;
      total_qty: number; total_cost: number; avg_cost: number;
      current_price: number | null; price_date: string | null;
      current_value: number | null; gain_loss: number | null; gain_loss_pct: number | null;
    }[];
    if (pRows.length > 0) {
      let tCost = 0, tValue = 0;
      const invLosers: { ticker: string; company: string; pct: number }[] = [];
      for (const r of pRows) {
        tCost += r.total_cost || 0;
        if (r.current_price !== null && r.current_value !== null) {
          tValue += r.current_value;
          if ((r.gain_loss_pct ?? 0) < -5) {
            invLosers.push({ ticker: r.ticker, company: r.company_name || r.ticker, pct: r.gain_loss_pct! });
          }
        }
      }
      const priceDate = pRows.find(r => r.price_date)?.price_date ?? null;
      setInvestmentData({
        totalCost: tCost,
        totalValue: tValue,
        gainLoss: tValue - tCost,
        gainLossPct: tCost > 0 ? ((tValue - tCost) / tCost) * 100 : 0,
        stockCount: pRows.length,
        losers: invLosers.sort((a, b) => a.pct - b.pct),
        priceDate,
      });
    }

    setLoading(false);
  }

  useEffect(() => {
    loadExecutiveData(selectedDate);
    const channel = supabase
      .channel("executive-dashboard-live")
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
  }, [selectedDate]);

  const produced = summaries.reduce((sum, s) => sum + total(s.producedOnDate), 0);
  const dispatched = summaries.reduce((sum, s) => sum + total(s.dispatchedOnDate), 0);
  const broken = summaries.reduce((sum, s) => sum + total(s.brokenOnDate), 0);
  const closingGoodStock = summaries.reduce((sum, s) => sum + total(s.closingGoodStock), 0);
  const closingBrokenStock = summaries.reduce((sum, s) => sum + total(s.closingBrokenStock), 0);

  const missingPlants = summaries.filter((s) => !s.enteredOnDate);
  const downMachines = machineIssues.filter((i) => i.issue_status === "Down");
  const partialMachines = machineIssues.filter((i) => i.issue_status === "Partially Working");

  const overdueTasks = tasks.filter((t) => isOverdue(t));
  const waitingReplies = tasks.filter((t) => t.status === "Waiting Reply");
  const dueThisWeekTasks = tasks.filter((t) => isDueThisWeek(t));
  const completedThisMonth = tasks.filter(
    (t) => t.status === "Completed" &&
      ((t.updated_at && t.updated_at.slice(0, 10) >= currentMonthStart) ||
        (!t.updated_at && t.created_at && t.created_at.slice(0, 10) >= currentMonthStart))
  );

  const departmentRows = buildPerformanceRows(tasks, "department");
  const peopleRows = buildPerformanceRows(tasks, "person");

  // Build department → people mapping for drill-down
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

  const selectedMonth = getMonthFromDate(selectedDate);
  const currentQuarter = getMonthQuarter(selectedDate);

  const recGreen = receivableRows.reduce((s, r) => s + r.greenAmount, 0);
  const recAmber = receivableRows.reduce((s, r) => s + r.amberAmount, 0);
  const recRed = receivableRows.reduce((s, r) => s + r.redAmount, 0);
  const recTotal = receivableRows.reduce((s, r) => s + r.totalAmount, 0);
  const recRedCount = receivableRows.reduce((s, r) => s + r.redCount, 0);

  const anyCashPlanMissing = companyFinance.some((cfd) => !cfd.cashPlan);

  if (checking) return null;

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "14px 18px", maxWidth: "100%", minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px", marginBottom: "16px" }}>
          <div>
            <p style={{ color: SLATE, fontSize: "15px", marginTop: "2px", maxWidth: "640px" }}>
              {new Date().getHours() < 12 ? "Good Morning" : new Date().getHours() < 17 ? "Good Afternoon" : "Good Evening"}{userName ? ` ${userName}` : ""} — exceptions surface automatically. If nothing needs your attention, everything is on track.
            </p>
          </div>
          <div style={{ backgroundColor: "var(--bg-card, #ffffff)", border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "8px 12px" }}>
            <label style={{ fontWeight: 700, display: "block", marginBottom: "3px", fontSize: "15px", color: SLATE }}>View date</label>
            <DateInput
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

        {loading ? (
          <p style={{ color: SLATE }}>Loading executive dashboard…</p>
        ) : (
          <>
            {/* ── SECTION 1: NEEDS YOUR ATTENTION ── */}
            {(() => {
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
              const hasAttention = overdueTasks.length > 0 || waitingReplies.length > 0 || escalations.length > 0 || missingPlants.length > 0 || downMachines.length > 0 || cashAlerts.length > 0;

              const criticalItems: string[] = [];
              if (overdueTasks.length > 0) criticalItems.push(`${overdueTasks.length} overdue task${overdueTasks.length > 1 ? "s" : ""}`);
              if (downMachines.length > 0) criticalItems.push(`${downMachines.length} machine${downMachines.length > 1 ? "s" : ""} down`);
              if (escalations.length > 0) criticalItems.push(`${escalations.length} escalation${escalations.length > 1 ? "s" : ""}`);
              if (waitingReplies.length > 0) criticalItems.push(`${waitingReplies.length} waiting repl${waitingReplies.length > 1 ? "ies" : "y"}`);
              if (missingPlants.length > 0) criticalItems.push(`${missingPlants.length} plant${missingPlants.length > 1 ? "s" : ""} not reported`);
              const hasCritical = overdueTasks.length > 0 || downMachines.length > 0 || escalations.length > 0;

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
              if (dueThisWeekTasks.length > 0) attentionRows.push({
                id: "dueweek", label: "Due This Week", count: dueThisWeekTasks.length, color: "#d97706",
                items: dueThisWeekTasks.map((t) => ({ key: t.id, primary: t.description, secondary: `${t.assigned_to || "Unassigned"} · Due: ${formatDateUK(t.due_date)}`, badge: t.priority, taskId: t.id, actionType: "complete" as const })),
              });
              for (const a of cashAlerts) {
                attentionRows.push({ id: `cash-${a.title}`, label: a.title, count: a.value, color: a.color, items: [] });
              }

              const totalAttentionCount = attentionRows.reduce((s, r) => s + r.count, 0);

              const actionBtn = (label: string, color: string, onClick: () => void, disabled: boolean) => (
                <button onClick={(e) => { e.stopPropagation(); onClick(); }} disabled={disabled} style={{
                  backgroundColor: color, color: "white", border: "none", borderRadius: "5px",
                  padding: "4px 10px", fontSize: "12px", fontWeight: 700, cursor: disabled ? "wait" : "pointer",
                  opacity: disabled ? 0.5 : 1, whiteSpace: "nowrap",
                }}>{label}</button>
              );

              return hasAttention ? (
              <>
                {/* Single collapsible banner — everything hidden inside */}
                <div style={{
                  border: `1px solid ${hasCritical ? "#fecaca" : BORDER}`,
                  borderLeft: `4px solid ${hasCritical ? "#dc2626" : "#d97706"}`,
                  borderRadius: "8px",
                  backgroundColor: hasCritical ? "#fef2f2" : "#fffbeb",
                  overflow: "hidden",
                  marginBottom: "14px",
                }}>
                  {/* Banner header — always visible, click to expand */}
                  <div
                    onClick={() => setBannerOpen(!bannerOpen)}
                    style={{
                      padding: "12px 16px",
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ fontSize: "20px", flexShrink: 0 }}>⚠</span>
                      <div>
                        <div style={{ fontSize: "16px", fontWeight: 700, color: hasCritical ? "#991b1b" : "#92400e" }}>
                          Action needed today — {totalAttentionCount} item{totalAttentionCount > 1 ? "s" : ""}
                        </div>
                        <div style={{ fontSize: "16px", color: hasCritical ? "#991b1b" : "#92400e", marginTop: "2px" }}>
                          {criticalItems.join(" · ")}
                        </div>
                      </div>
                    </div>
                    <span style={{ fontSize: "16px", color: hasCritical ? "#991b1b" : "#92400e", fontWeight: 700 }}>{bannerOpen ? "▲ Hide" : "▼ Show"}</span>
                  </div>

                  {/* Expanded content — categories then items then actions */}
                  {bannerOpen && (
                    <div style={{ borderTop: `1px solid ${hasCritical ? "#fecaca" : "#fde68a"}` }}>
                      {attentionRows.map((row) => {
                        const isOpen = expandedCard === row.id;
                        return (
                          <div key={row.id}>
                            {/* Category row */}
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

                            {/* Expanded items — click to open task detail */}
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
                  )}
                </div>
              </>
            ) : (
              <div style={{
                border: `1px solid ${BORDER}`,
                borderLeft: "4px solid #16a34a",
                borderRadius: "6px",
                padding: "12px 16px",
                backgroundColor: "var(--bg-card, #ffffff)",
                fontSize: "16px",
                color: NAVY,
                fontWeight: 600,
                marginBottom: "14px",
              }}>
                All clear — no items require your attention right now.
              </div>
            );
            })()}

            {/* ── SECTION 2: OPERATIONS STATUS ── */}
            <SectionTitle title="Operations Status — Today" />
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fit, minmax(130px, 1fr))",
              gap: "8px",
              marginBottom: "14px",
            }}>
              <Card title="Produced" value={produced} color="#16a34a" href="/dashboard" />
              <Card title="Dispatched" value={dispatched} color="#059669" href="/dashboard" />
              <Card title="Broken" value={broken} color="#dc2626" href="/dashboard" />
              <Card title="Machine Issues" value={machineIssues.length} color={machineIssues.length > 0 ? "#dc2626" : "#16a34a"} href="/dashboard" />
              <Card title="Good Stock" value={closingGoodStock} color="#2563eb" href="/dashboard" />
              <Card title="Broken Stock" value={closingBrokenStock} color="#dc2626" href="/dashboard" />
              <Card title="Completed (Month)" value={completedThisMonth.length} color="#16a34a" href="/tasks" />
            </div>
            {/* ── CHARTS ROW ── */}
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
              gap: "14px",
              marginBottom: "14px",
            }}>
              {/* Production / Dispatch / Breakage daily trend */}
              {dailyOpsData.length > 1 && (
                <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)" }}>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: NAVY, marginBottom: "10px" }}>
                    Daily Production Trend — This Month
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={dailyOpsData.map((d) => ({ ...d, date: d.date.slice(5) }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{ fontSize: 12, fill: SLATE }} />
                      <YAxis tick={{ fontSize: 12, fill: SLATE }} />
                      <Tooltip />
                      <Legend iconType="plainline" wrapperStyle={{ fontSize: "13px" }} />
                      <Line type="monotone" dataKey="produced" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} name="Produced (solid green)" />
                      <Line type="monotone" dataKey="dispatched" stroke="#059669" strokeWidth={2} dot={{ r: 3, strokeDasharray: "" }} name="Dispatched (dashed teal)" strokeDasharray="5 3" />
                      <Line type="monotone" dataKey="broken" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} name="Broken (red)" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Receipts vs Payments monthly line chart */}
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
                return (
                  <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)" }}>
                    <div style={{ fontSize: "16px", fontWeight: 700, color: NAVY, marginBottom: "10px" }}>
                      Monthly Receipts vs Payments
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={cashData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="month" tick={{ fontSize: 12, fill: SLATE }} />
                        <YAxis tick={{ fontSize: 12, fill: SLATE }} tickFormatter={(v) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v} />
                        <Tooltip formatter={(value) => `PKR ${Number(value).toLocaleString()}`} />
                        <Legend iconType="plainline" wrapperStyle={{ fontSize: "13px" }} />
                        <Line type="monotone" dataKey="receipts" stroke="#16a34a" strokeWidth={2} dot={{ r: 4 }} name="Receipts (green)" />
                        <Line type="monotone" dataKey="payments" stroke="#dc2626" strokeWidth={2} dot={{ r: 4 }} name="Payments (red)" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                );
              })()}

              {/* Cash Flow Waterfall — latest day */}
              {(() => {
                const waterfallData: { company: string; opening: number; receipts: number; payments: number; postDated: number; closing: number }[] = [];
                for (const cfd of companyFinance) {
                  const latest = cfd.cashPositions[0];
                  if (!latest) continue;
                  waterfallData.push({
                    company: cfd.companyName,
                    opening: latest.opening_balance,
                    receipts: latest.total_receipts,
                    payments: latest.total_payments,
                    postDated: latest.post_dated_total,
                    closing: latest.closing_balance,
                  });
                }
                if (waterfallData.length === 0) return null;
                return (
                  <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)", marginTop: "14px" }}>
                    <div style={{ fontSize: "16px", fontWeight: 700, color: NAVY, marginBottom: "12px" }}>
                      Cash Flow Waterfall — Latest Day
                    </div>
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
                            <div style={{ fontSize: "14px", fontWeight: 600, color: NAVY, marginBottom: "10px" }}>{w.company}</div>
                            <div style={{ display: "flex", alignItems: "flex-end", gap: "6px", height: "100px" }}>
                              {items.map((item) => (
                                <div key={item.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                                  <div style={{ fontSize: "11px", fontWeight: 600, color: item.color, marginBottom: "4px", whiteSpace: "nowrap" }}>
                                    {item.value >= 0 ? "" : "−"}{fmtMoney(Math.abs(item.value))}
                                  </div>
                                  <div style={{
                                    width: "100%", maxWidth: "40px",
                                    height: `${barHeight(item.value)}px`,
                                    backgroundColor: item.color,
                                    borderRadius: "4px 4px 0 0",
                                    opacity: 0.8,
                                  }} />
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
            </div>

            {/* Two continuous columns: left = Finance, right = Receivables + Dept Health + Performance */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "14px", marginTop: "8px", alignItems: "start" }}>
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

                {/* ── Bank Facility Synopsis ── */}
                {showFinance && facilitySynopsis.length > 0 && (
                  <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", backgroundColor: "var(--bg-card,#ffffff)", padding: "14px", marginBottom: "14px" }}>
                    <div style={{ fontSize: "15px", fontWeight: 700, color: NAVY, marginBottom: "12px" }}>Bank Facilities</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      {facilitySynopsis.map((b) => {
                        const pct = b.bank_utilisation_pct;
                        const barColor = pct >= 90 ? "#dc2626" : pct >= 70 ? "#d97706" : "#16a34a";
                        return (
                          <div key={b.bank_name}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                              <div>
                                <span style={{ fontSize: "13px", fontWeight: 700, color: NAVY }}>{b.bank_name}</span>
                                {b.overdue_count > 0 && (
                                  <span style={{ marginLeft: "6px", fontSize: "11px", fontWeight: 700, color: "#dc2626", backgroundColor: "#fef2f2", padding: "1px 6px", borderRadius: "8px" }}>
                                    ⚠ {b.overdue_count} overdue
                                  </span>
                                )}
                              </div>
                              <span style={{ fontSize: "13px", fontWeight: 800, color: barColor }}>{pct}%</span>
                            </div>
                            <div style={{ height: "8px", borderRadius: "4px", backgroundColor: "#e2e8f0", marginBottom: "4px", overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, backgroundColor: barColor, borderRadius: "4px" }} />
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                              <span style={{ color: "#dc2626" }}>Seized: PKR {Math.round(b.bank_seized).toLocaleString()}</span>
                              <span style={{ color: "#16a34a" }}>Available: PKR {Math.round(b.bank_available).toLocaleString()}</span>
                            </div>
                            <div style={{ fontSize: "11px", color: SLATE, marginTop: "1px" }}>
                              Limit: PKR {Math.round(b.bank_total_limit).toLocaleString()} · {b.active_guarantees} active guarantee{b.active_guarantees !== 1 ? "s" : ""}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT COLUMN */}
              <div>
                <SectionTitle title="Receivables — Bills in Progress" />
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
                            <div style={{
                              fontSize: "16px", fontWeight: 800,
                              color: investmentData.gainLossPct >= 0 ? "#16a34a" : "#dc2626",
                            }}>
                              {investmentData.gainLossPct >= 0 ? "+" : ""}{investmentData.gainLossPct.toFixed(2)}%
                            </div>
                          </div>
                        </div>
                        {investmentData.losers.length > 0 && (
                          <div style={{
                            borderTop: `1px solid #fecaca`, paddingTop: "8px",
                            fontSize: "15px", color: "#991b1b",
                          }}>
                            <span style={{ fontWeight: 700 }}>{investmentData.losers.length} stock{investmentData.losers.length > 1 ? "s" : ""} down &gt;5%:</span>{" "}
                            {investmentData.losers.map((l, i) => (
                              <span key={l.ticker}>{i > 0 ? ", " : ""}{l.ticker} ({l.pct.toFixed(1)}%)</span>
                            ))}
                          </div>
                        )}
                        {investmentData.priceDate && (
                          <div style={{ fontSize: "13px", color: SLATE, marginTop: "6px" }}>
                            {investmentData.stockCount} stocks · Prices as of {formatDateUK(investmentData.priceDate)} · Click to view portfolio →
                          </div>
                        )}
                      </div>
                    </a>
                  </>
                )}

                <SectionTitle title="Department Health" />
                <div style={{
                  border: `1px solid ${BORDER}`, borderRadius: "8px",
                  backgroundColor: "var(--bg-card, #ffffff)", overflow: "hidden",
                  marginBottom: "14px",
                }}>
                  {deptHealth.map((d, i) => {
                    const statusColor = d.status === "GREEN" ? "#16a34a" : d.status === "AMBER" ? "#d97706" : "#dc2626";
                    return (
                      <a key={d.slug} href={`/department/${d.slug}`} style={{
                        display: "flex", alignItems: "center", gap: "10px",
                        padding: "10px 14px", textDecoration: "none", color: "inherit",
                        borderBottom: i < deptHealth.length - 1 ? `1px solid var(--border-light, #f1f5f9)` : "none",
                        transition: "background-color 0.1s",
                      }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-card-hover, #f8fafc)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                      >
                        <span style={{
                          width: "10px", height: "10px", borderRadius: "50%",
                          backgroundColor: statusColor, flexShrink: 0,
                          boxShadow: `0 0 4px ${statusColor}40`,
                        }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary, #1e293b)" }}>{d.title}</div>
                          <div style={{ fontSize: "13px", color: SLATE }}>{d.owner}</div>
                        </div>
                        <span style={{ fontSize: "13px", color: SLATE, flexShrink: 0 }}>{d.detail}</span>
                        <span style={{ fontSize: "14px", fontWeight: 700, color: statusColor, flexShrink: 0, minWidth: "50px", textAlign: "right" }}>{d.status}</span>
                      </a>
                    );
                  })}
                </div>

                <SectionTitle title="Performance by Department" />
                <DrillDownPerformance departmentRows={departmentRows} deptPeopleMap={deptPeopleMap} />
              </div>
            </div>
          </>
        )}
      </main>
    </AuthWrapper>
  );
}

const cardGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))",
  gap: "8px",
  marginBottom: "18px",
};
const squareGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))",
  gap: "8px",
  marginBottom: "18px",
};

const miniGrid = {
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

function CompanyFinancePanel({ data }: { data: { companyId: string; companyName: string; cashOpening: OpeningBalance | null; cashPlan: MonthlyPlan | null; cashPositions: DailyPosition[]; lastYearReceipts: number | null; lastYearPayments: number | null; forecast: BudgetRow[]; deptBudgets: { department: string; category: string; budgeted_amount: number; actual_amount: number }[] } }) {
  const financeMonth = formatDate(new Date()).slice(0, 7);
  const monthPositions = data.cashPositions.filter((p) => p.position_date.slice(0, 7) === financeMonth);
  const actualReceiptsMTD = monthPositions.reduce((s, p) => s + p.total_receipts, 0);
  const actualPaymentsMTD = monthPositions.reduce((s, p) => s + p.total_payments, 0);
  const latest = data.cashPositions[0] || null;
  const plannedRecv = data.cashPlan?.tentative_receivables || 0;
  const plannedPay = data.cashPlan?.tentative_payouts || 0;
  const openAmt = data.cashOpening?.opening_amount || 0;
  const projected = openAmt + plannedRecv - plannedPay;
  const latestClosing = latest?.closing_balance ?? openAmt;

  const now = new Date();
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const de = now.getDate();
  const expRecv = plannedRecv > 0 ? (plannedRecv / dim) * de : 0;
  const recvPct = expRecv > 0 ? (actualReceiptsMTD / expRecv) * 100 : 100;
  const recvStatus: RAGStatus = recvPct >= 95 ? "GREEN" : recvPct >= 85 ? "AMBER" : "RED";
  const expPay = plannedPay > 0 ? (plannedPay / dim) * de : 0;
  const payPct = expPay > 0 ? (actualPaymentsMTD / expPay) * 100 : 100;
  const payStatus: RAGStatus = payPct <= 105 ? "GREEN" : payPct <= 115 ? "AMBER" : "RED";
  const headline: RAGStatus = recvStatus === "RED" || payStatus === "RED" ? "RED" : recvStatus === "AMBER" || payStatus === "AMBER" ? "AMBER" : "GREEN";

  const staleDays = latest ? Math.floor((Date.now() - new Date(latest.position_date + "T00:00:00").getTime()) / 86400000) : 999;

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

  const summaryCard = (label: string, value: string, sub: string, color: string) => (
    <div style={{ borderRadius: "8px", padding: "10px 12px", backgroundColor: "var(--bg-card, #ffffff)", border: `1px solid ${BORDER}`, borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: "15px", color: SLATE, marginBottom: "2px" }}>{label}</div>
      <div style={{ fontSize: "18px", fontWeight: 800, color }}>{value}</div>
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

          {/* ── Summary cards row ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "8px", marginBottom: "8px" }}>
            {summaryCard(
              "Cash Available",
              latest ? `PKR ${fmtMoney(latest.closing_after_post_dated)}` : "—",
              latest ? `Updated ${formatDateUK(latest.position_date)}${staleDays > 1 ? " (STALE)" : ""}` : "No data",
              !latest ? "#2563eb" : latest.closing_after_post_dated < 0 ? "#dc2626" : "#16a34a"
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

          {/* ── Projected + net ── */}
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

          {/* ── Expandable sections ── */}
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

function Card({ title, value, color, onClick, href }: { title: string; value: number; color: string; onClick?: () => void; href?: string }) {
  const isClickable = !!(onClick || href);
  const content = (
    <div style={{
      border: `1px solid ${BORDER}`,
      borderTop: `3px solid ${color}`,
      borderRadius: "7px",
      padding: "8px 10px",
      backgroundColor: "var(--bg-card, #ffffff)",
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
      <div style={{ fontSize: "19px", fontWeight: 800, color }}>{value.toLocaleString()}</div>
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
