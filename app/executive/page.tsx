"use client";

import React, { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import EscalationTrafficLights from "./EscalationTrafficLights";
import { formatDateUK, formatMonthUK, workingDaysFromNow } from "../lib/dateUtils";
import { RAGStatus, ragColour } from "../lib/SharedUI";
import { UTPL_COMPANY_ID, COMPANIES } from "../lib/constants";
import { useMobile } from "../lib/useMobile";
import MyTasks from "../lib/MyTasks";
import { DEPARTMENT_CONFIGS, getDepartmentHealthStatus } from "../lib/department-config";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";

type Plant = { id: string; name: string; type: string };
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


const NAVY = "#1e293b";
const SLATE = "#64748b";
const BORDER = "#e2e8f0";

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
  const [selectedDate, setSelectedDate] = useState(today);
  const [summaries, setSummaries] = useState<PlantExecutiveSummary[]>([]);
  const [machineIssues, setMachineIssues] = useState<MachineIssue[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);

  type CompanyFinanceData = {
    companyId: string;
    companyName: string;
    cashOpening: OpeningBalance | null;
    cashPlan: MonthlyPlan | null;
    cashPositions: DailyPosition[];
    lastYearReceipts: number | null;
    lastYearPayments: number | null;
    forecast: BudgetRow[];
  };

  const [companyFinance, setCompanyFinance] = useState<CompanyFinanceData[]>([]);
  const [receivableRows, setReceivableRows] = useState<ReceivableCustomerRow[]>([]);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [deptHealth, setDeptHealth] = useState<{ slug: string; title: string; status: "GREEN" | "AMBER" | "RED" }[]>([]);

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
        .select("role, first_name, name")
        .eq("email", user.email)
        .maybeSingle();
      if (memberData) {
        setUserRole(memberData.role);
        setUserName(memberData.first_name || memberData.name || null);
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
      const [cashOpenRes, cashPlanRes, cashPosRes, lyRes, forecastRes] = await Promise.all([
        supabase.from("cash_opening_balance").select("*").eq("company_id", company.id).order("as_of_date", { ascending: true }).limit(1),
        supabase.from("monthly_cash_plan").select("*").eq("company_id", company.id).eq("plan_month", currentMonthForCash).maybeSingle(),
        supabase.from("daily_cash_position").select("*").eq("company_id", company.id).order("position_date", { ascending: false }).limit(30),
        supabase.from("daily_cash_position").select("total_receipts, total_payments").eq("company_id", company.id).gte("position_date", lastYearMonth + "-01").lte("position_date", lastYearMonth + "-31"),
        supabase.from("monthly_budgets").select("category, flow_type, budgeted_amount, budget_month").eq("company_id", company.id).gte("budget_month", currentMonthForCash).order("budget_month", { ascending: true }),
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
    const healthResults: { slug: string; title: string; status: "GREEN" | "AMBER" | "RED" }[] = [];
    for (const deptConfig of DEPARTMENT_CONFIGS) {
      const { data: deptData } = await supabase
        .from(deptConfig.table)
        .select("*")
        .eq("company_id", UTPL_COMPANY_ID);
      const deptRows = (deptData || []) as Record<string, unknown>[];
      healthResults.push({
        slug: deptConfig.slug,
        title: deptConfig.title,
        status: getDepartmentHealthStatus(deptRows, deptConfig),
      });
    }
    setDeptHealth(healthResults);

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

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px", marginBottom: "16px" }}>
          <div>
            <h1 style={{ fontSize: "26px", fontWeight: 800, color: NAVY, margin: 0 }}>{new Date().getHours() < 12 ? "Good Morning" : new Date().getHours() < 17 ? "Good Afternoon" : "Good Evening"}{userName ? ` ${userName}` : ""}</h1>
            <p style={{ color: SLATE, fontSize: "16px", marginTop: "5px", maxWidth: "640px" }}>
              Exceptions surface automatically. If nothing needs your attention, everything is on track.
            </p>
          </div>
          <div style={{ backgroundColor: "white", border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "8px 12px" }}>
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

        {loading ? (
          <p style={{ color: SLATE }}>Loading executive dashboard…</p>
        ) : (
          <>
            {/* ── SECTION 1: NEEDS YOUR ATTENTION ── */}
            {(() => {
              const cashAlerts: { title: string; value: number; color: string }[] = [];
              if (userRole === "Admin") {
                for (const cfd of companyFinance) {
                  const latestDate = cfd.cashPositions[0]?.position_date;
                  const staleDays = latestDate ? Math.floor((Date.now() - new Date(latestDate + "T00:00:00").getTime()) / 86400000) : 999;
                  if (cfd.cashPositions.length === 0) cashAlerts.push({ title: `${cfd.companyName}: No Data`, value: 0, color: "#dc2626" });
                  else if (staleDays > 1) cashAlerts.push({ title: `${cfd.companyName}: Stale`, value: staleDays, color: "#dc2626" });
                  if (!cfd.cashPlan) cashAlerts.push({ title: `${cfd.companyName}: No Plan`, value: 0, color: "#d97706" });
                }
              }
              const hasAttention = overdueTasks.length > 0 || waitingReplies.length > 0 || escalations.length > 0 || missingPlants.length > 0 || downMachines.length > 0 || cashAlerts.length > 0;

              return hasAttention ? (
              <>
                <SectionTitle title="Needs Your Attention" />
                <div style={squareGrid}>
                  {overdueTasks.length > 0 && <Card title="Overdue Tasks" value={overdueTasks.length} color="#dc2626" onClick={() => toggleCard("overdue")} />}
                  {waitingReplies.length > 0 && <Card title="Waiting Replies" value={waitingReplies.length} color="#dc2626" onClick={() => toggleCard("waiting")} />}
                  {escalations.length > 0 && <Card title="Escalations" value={escalations.length} color="#dc2626" onClick={() => toggleCard("escalations")} />}
                  {downMachines.length > 0 && <Card title="Machines Down" value={downMachines.length} color="#b91c1c" onClick={() => toggleCard("machines")} />}
                  {missingPlants.length > 0 && <Card title="Plants Not Reported" value={missingPlants.length} color="#ef4444" onClick={() => toggleCard("missing")} />}
                  {cashAlerts.map((a) => <Card key={a.title} title={a.title} value={a.value} color={a.color} href="/finance" />)}
                  {dueThisWeekTasks.length > 0 && <Card title="Due This Week" value={dueThisWeekTasks.length} color="#d97706" onClick={() => toggleCard("dueweek")} />}
                </div>

                {/* Inline detail panels */}
                {expandedCard === "overdue" && (
                  <DetailPanel title="Overdue Tasks" onClose={() => setExpandedCard(null)} linkHref="/tasks" linkLabel="Open Tasks page">
                    {overdueTasks.map((t) => (
                      <DetailRow key={t.id} primary={t.description} secondary={`${t.assigned_to || "Unassigned"} · Due: ${formatDateUK(t.due_date)}`} badge={t.priority} />
                    ))}
                  </DetailPanel>
                )}
                {expandedCard === "waiting" && (
                  <DetailPanel title="Waiting Replies" onClose={() => setExpandedCard(null)} linkHref="/tasks" linkLabel="Open Tasks page">
                    {waitingReplies.map((t) => (
                      <DetailRow key={t.id} primary={t.description} secondary={`${t.assigned_to || "Unassigned"} · Due: ${formatDateUK(t.due_date)}`} badge={t.priority} />
                    ))}
                  </DetailPanel>
                )}
                {expandedCard === "escalations" && (
                  <DetailPanel title="Escalations" onClose={() => setExpandedCard(null)} linkHref="/exceptions" linkLabel="Open Exceptions page">
                    {escalations.map((e) => (
                      <DetailRow key={e.sourceLabel} primary={`${e.plantName} — ${e.metric}`} secondary={e.detail} />
                    ))}
                  </DetailPanel>
                )}
                {expandedCard === "machines" && (
                  <DetailPanel title="Machines Down" onClose={() => setExpandedCard(null)}>
                    {downMachines.map((m) => (
                      <DetailRow key={m.id} primary={`${m.plant_name} — ${m.machine_name}`} secondary={m.issue_description || "No description"} />
                    ))}
                  </DetailPanel>
                )}
                {expandedCard === "missing" && (
                  <DetailPanel title="Plants Not Reported Today" onClose={() => setExpandedCard(null)} linkHref="/production" linkLabel="Open Daily Entry">
                    {missingPlants.map((s) => (
                      <DetailRow key={s.plant.id} primary={s.plant.name} secondary={`Type: ${s.plant.type}`} />
                    ))}
                  </DetailPanel>
                )}
                {expandedCard === "dueweek" && (
                  <DetailPanel title="Due This Week" onClose={() => setExpandedCard(null)} linkHref="/tasks" linkLabel="Open Tasks page">
                    {dueThisWeekTasks.map((t) => (
                      <DetailRow key={t.id} primary={t.description} secondary={`${t.assigned_to || "Unassigned"} · Due: ${formatDateUK(t.due_date)}`} badge={t.priority} />
                    ))}
                  </DetailPanel>
                )}

                {expandedCard === null && escalations.length > 0 && <EscalationTrafficLights escalations={escalations} />}
              </>
            ) : (
              <div style={{
                border: `1px solid ${BORDER}`,
                borderLeft: "4px solid #16a34a",
                borderRadius: "6px",
                padding: "12px 16px",
                backgroundColor: "white",
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
              <Card title="Dispatched" value={dispatched} color="#7c3aed" href="/dashboard" />
              <Card title="Broken" value={broken} color="#dc2626" href="/dashboard" />
              <Card title="Machine Issues" value={machineIssues.length} color={machineIssues.length > 0 ? "#b91c1c" : "#16a34a"} href="/dashboard" />
              <Card title="Good Stock" value={closingGoodStock} color="#0070f3" href="/dashboard" />
              <Card title="Broken Stock" value={closingBrokenStock} color="#d97706" href="/dashboard" />
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
                <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white" }}>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: NAVY, marginBottom: "10px" }}>
                    Daily Production Trend — This Month
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={dailyOpsData.map((d) => ({ ...d, date: d.date.slice(5) }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{ fontSize: 12, fill: SLATE }} />
                      <YAxis tick={{ fontSize: 12, fill: SLATE }} />
                      <Tooltip />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: "13px" }} />
                      <Line type="monotone" dataKey="produced" stroke="#16a34a" strokeWidth={2} dot={false} name="Produced" />
                      <Line type="monotone" dataKey="dispatched" stroke="#7c3aed" strokeWidth={2} dot={false} name="Dispatched" />
                      <Line type="monotone" dataKey="broken" stroke="#dc2626" strokeWidth={2} dot={false} name="Broken" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Receipts vs Payments monthly bar chart */}
              {(() => {
                const utplFinance = companyFinance.find((c) => c.companyId === UTPL_COMPANY_ID);
                if (!utplFinance || utplFinance.cashPositions.length === 0) return null;
                const monthMap = new Map<string, { month: string; receipts: number; payments: number }>();
                for (const p of utplFinance.cashPositions) {
                  const m = p.position_date.slice(0, 7);
                  if (!monthMap.has(m)) monthMap.set(m, { month: m, receipts: 0, payments: 0 });
                  monthMap.get(m)!.receipts += p.total_receipts;
                  monthMap.get(m)!.payments += p.total_payments;
                }
                const cashData = Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month));
                if (cashData.length === 0) return null;
                return (
                  <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white" }}>
                    <div style={{ fontSize: "16px", fontWeight: 700, color: NAVY, marginBottom: "10px" }}>
                      Receipts vs Payments
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={cashData.map((d) => ({ ...d, month: d.month.slice(5) }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="month" tick={{ fontSize: 12, fill: SLATE }} />
                        <YAxis tick={{ fontSize: 12, fill: SLATE }} tickFormatter={(v) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v} />
                        <Tooltip formatter={(value) => Number(value).toLocaleString()} />
                        <Legend iconType="square" wrapperStyle={{ fontSize: "13px" }} />
                        <Bar dataKey="receipts" fill="#16a34a" name="Money In" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="payments" fill="#dc2626" name="Money Out" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                );
              })()}
            </div>

            {/* Two continuous columns: left = Finance, right = Receivables + Dept Health + Performance */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(380px, 1fr))", gap: "14px", marginTop: "8px", alignItems: "start" }}>
              {/* LEFT COLUMN */}
              <div>
                {userRole === "Admin" && companyFinance.map((cfd) => (
                  <CompanyFinancePanel key={cfd.companyId} data={cfd} />
                ))}
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
                      <Mini label="Total Tracked" value={fmtMoney(recTotal)} color="#0070f3" />
                      <Mini label="On Time" value={fmtMoney(recGreen)} color="#16a34a" />
                      <Mini label="Due Soon" value={fmtMoney(recAmber)} color="#d97706" />
                      <Mini label="Stuck" value={fmtMoney(recRed)} color="#dc2626" />
                    </div>
                    {receivableRows.length > 0 && (
                      <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", width: "100%", marginTop: "12px", minWidth: "420px" }}>
                        <thead>
                          <tr style={{ backgroundColor: "#f8fafc" }}>
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

                <SectionTitle title="Department Health" />
                <div style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: "8px",
                  marginBottom: "14px",
                }}>
                  {deptHealth.map((d) => (
                    <a key={d.slug} href={`/department/${d.slug}`} style={{ textDecoration: "none" }}>
                      <div style={{
                        border: `1px solid ${BORDER}`,
                        borderTop: `3px solid ${d.status === "GREEN" ? "#16a34a" : d.status === "AMBER" ? "#d97706" : "#dc2626"}`,
                        borderRadius: "7px",
                        padding: "8px 10px",
                        backgroundColor: "white",
                        cursor: "pointer",
                        transition: "box-shadow 0.15s",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "none"; }}
                      >
                        <div style={{ fontSize: "15px", color: SLATE, marginBottom: "2px" }}>{d.title} →</div>
                        <div style={{
                          fontSize: "17px",
                          fontWeight: 800,
                          color: d.status === "GREEN" ? "#16a34a" : d.status === "AMBER" ? "#d97706" : "#dc2626",
                        }}>
                          {d.status}
                        </div>
                      </div>
                    </a>
                  ))}
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
    backgroundColor: "white",
    marginBottom: "4px",
  };
}

function panelCardRAG(status: RAGStatus): React.CSSProperties {
  return {
    border: `1px solid ${BORDER}`,
    borderTop: `3px solid ${ragColour(status)}`,
    borderRadius: "8px",
    padding: "12px",
    backgroundColor: "white",
    marginBottom: "4px",
  };
}

function CompanyFinancePanel({ data }: { data: { companyId: string; companyName: string; cashOpening: OpeningBalance | null; cashPlan: MonthlyPlan | null; cashPositions: DailyPosition[]; lastYearReceipts: number | null; lastYearPayments: number | null; forecast: BudgetRow[] } }) {
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
      <span style={{ fontSize: opts?.bold ? "15px" : "14px", fontWeight: opts?.bold ? 700 : 400, color: opts?.color || (opts?.bold ? NAVY : SLATE) }}>{label}</span>
      <span style={{ fontSize: opts?.bold ? "16px" : "14px", fontWeight: opts?.bold ? 700 : 600, color: opts?.color || NAVY }}>{value}</span>
    </div>
  );

  return (
    <>
      <SectionTitle title={`Finance — ${data.companyName}`} />
      {!data.cashPlan && !data.cashOpening && data.cashPositions.length === 0 && data.forecast.length === 0 ? (
        <p style={{ color: SLATE, fontSize: "17px" }}>No finance data yet.</p>
      ) : (
        <div style={panelCardRAG(headline)}>

          {/* ── Where we stand today ── */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <div style={{ fontSize: "16px", fontWeight: 700, color: NAVY }}>
              Today&apos;s Position
            </div>
            {latest && (
              <div style={{ fontSize: "13px", fontWeight: 600, color: staleDays > 1 ? "#dc2626" : SLATE }}>
                {formatDateUK(latest.position_date)}{staleDays > 1 ? " (STALE)" : ""}
              </div>
            )}
          </div>

          {latest ? (
            <div style={{ marginBottom: "12px" }}>
              {fRow("Cash in banks", `PKR ${fmtMoney(latestClosing)}`, { bold: true, color: "#0070f3" })}
              {fRow("Post-dated cheques issued", `PKR ${fmtMoney(latest.post_dated_total)}`, { indent: true })}
              {fRow("Available cash (after cheques)", `PKR ${fmtMoney(latest.closing_after_post_dated)}`, { bold: true, borderTop: true })}
            </div>
          ) : (
            <p style={{ color: SLATE, fontSize: "14px", marginBottom: "12px" }}>No daily position entered yet.</p>
          )}

          {/* ── This month: money in vs money out ── */}
          {(plannedRecv > 0 || plannedPay > 0) && (
            <>
              <div style={{ fontSize: "16px", fontWeight: 700, color: NAVY, marginBottom: "6px" }}>This Month — Actual vs Plan</div>
              <div style={{ marginBottom: "12px" }}>
                {fRow("Money received so far", `PKR ${fmtMoney(actualReceiptsMTD)}`)}
                {fRow("Expected by today (day " + de + " of " + dim + ")", `PKR ${fmtMoney(Math.round(expRecv))}`, { indent: true })}
                {fRow("Receipts on track?", recvStatus === "GREEN" ? "Yes" : recvStatus === "AMBER" ? "Slightly behind" : "Behind — needs attention", { bold: true, color: ragColour(recvStatus) })}

                <div style={{ height: "8px" }} />

                {fRow("Money paid out so far", `PKR ${fmtMoney(actualPaymentsMTD)}`)}
                {fRow("Expected by today", `PKR ${fmtMoney(Math.round(expPay))}`, { indent: true })}
                {fRow("Payments on track?", payStatus === "GREEN" ? "Yes" : payStatus === "AMBER" ? "Slightly over" : "Over budget — needs attention", { bold: true, color: ragColour(payStatus) })}

                {fRow("Projected month-end balance", `PKR ${fmtMoney(projected)}`, { bold: true, borderTop: true, color: projected >= 0 ? "#16a34a" : "#dc2626" })}
              </div>
            </>
          )}

          {/* ── Forecast breakdown ── */}
          {data.forecast.length > 0 && (
            <>
              <div style={{ fontSize: "16px", fontWeight: 700, color: NAVY, marginBottom: "6px" }}>Budgeted Cash Flow — {data.forecast[0]?.budget_month === financeMonth ? "This Month" : formatMonthUK(data.forecast[0]?.budget_month || null)}</div>
              <div style={{ marginBottom: "8px" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#16a34a", marginBottom: "2px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Money In</div>
                {inflows.map((f) => fRow(f.category, `PKR ${fmtMoney(f.budgeted_amount)}`, { indent: true, key: f.category } as any))}
                {fRow("Total budgeted inflows", `PKR ${fmtMoney(forecastTotalIn)}`, { bold: true, color: "#16a34a" })}

                <div style={{ height: "8px" }} />

                <div style={{ fontSize: "13px", fontWeight: 700, color: "#dc2626", marginBottom: "2px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Money Out</div>
                {outflows.map((f) => fRow(f.category, `PKR ${fmtMoney(f.budgeted_amount)}`, { indent: true, key: f.category } as any))}
                {fRow("Total budgeted outflows", `PKR ${fmtMoney(forecastTotalOut)}`, { bold: true, color: "#dc2626" })}

                {fRow("Net cash flow (in minus out)", `PKR ${fmtMoney(forecastNet)}`, { bold: true, borderTop: true, color: forecastNet >= 0 ? "#16a34a" : "#dc2626" })}
              </div>
            </>
          )}

          {/* ── vs Last Year ── */}
          {data.lastYearReceipts !== null && (
            <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: SLATE, marginBottom: "4px" }}>Same Month Last Year</div>
              {fRow("Received last year", `PKR ${fmtMoney(data.lastYearReceipts)}`, { indent: true })}
              {fRow("Received this year", `PKR ${fmtMoney(actualReceiptsMTD)}`, { indent: true })}
              {fRow("Difference", `${actualReceiptsMTD >= data.lastYearReceipts ? "+" : ""}PKR ${fmtMoney(actualReceiptsMTD - data.lastYearReceipts)}`, { bold: true, color: actualReceiptsMTD >= data.lastYearReceipts ? "#16a34a" : "#dc2626" })}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h2 style={{ fontSize: "17px", fontWeight: 700, color: NAVY, margin: "14px 0 8px", paddingLeft: "9px", borderLeft: `3px solid ${NAVY}` }}>
      {title}
    </h2>
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
      backgroundColor: "white",
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
      backgroundColor: "white",
      marginBottom: "14px",
      overflow: "hidden",
    }}>
      <div style={{
        padding: "10px 14px",
        backgroundColor: "#f8fafc",
        borderBottom: `1px solid ${BORDER}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <span style={{ fontSize: "16px", fontWeight: 700, color: NAVY }}>{title}</span>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {linkHref && (
            <a href={linkHref} style={{ fontSize: "14px", color: "#2563eb", fontWeight: 600, textDecoration: "none" }}>
              {linkLabel || "View all"} →
            </a>
          )}
          <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${BORDER}`, borderRadius: "6px", padding: "4px 10px", fontSize: "14px", color: SLATE, cursor: "pointer" }}>
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
        {secondary && <div style={{ fontSize: "14px", color: SLATE, marginTop: "2px" }}>{secondary}</div>}
      </div>
      {badge && (
        <span style={{
          fontSize: "12px", fontWeight: 700, padding: "2px 8px", borderRadius: "10px", whiteSpace: "nowrap", flexShrink: 0,
          backgroundColor: badge === "High" || badge === "Urgent" ? "#dc2626" : badge === "Medium" ? "#0070f3" : "#64748b",
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
      <div style={{ color: SLATE, fontSize: "14px", marginBottom: "1px" }}>{label}</div>
      <div style={{ fontSize: "16px", fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function SlimAlert({ color, text }: { color: string; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", backgroundColor: "white", border: `1px solid ${BORDER}`, borderLeft: `4px solid ${color}`, borderRadius: "6px", padding: "10px 14px", marginBottom: "14px" }}>
      <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: color, flexShrink: 0 }} />
      <span style={{ fontSize: "17px", color: NAVY }}>{text}</span>
    </div>
  );
}

function DrillDownPerformance({ departmentRows, deptPeopleMap }: { departmentRows: PerformanceRow[]; deptPeopleMap: Map<string, PerformanceRow[]> }) {
  const [expandedDept, setExpandedDept] = useState<string | null>(null);

  if (departmentRows.length === 0) return <p style={{ color: SLATE, fontSize: "17px" }}>No task data yet.</p>;

  function trafficDot(count: number, color: string) {
    if (count === 0) return null;
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
        <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: color, display: "inline-block", boxShadow: `0 0 4px ${color}40` }} />
        <span style={{ fontWeight: 700, fontSize: "15px", color }}>{count}</span>
      </span>
    );
  }

  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden", marginBottom: "12px", overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ backgroundColor: "#f8fafc" }}>
            <th style={th}>Department</th>
            <th style={{ ...th, textAlign: "center" }}>Status</th>
            <th style={{ ...th, textAlign: "center", width: "60px" }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {departmentRows.map((dept) => {
            const isExpanded = expandedDept === dept.name;
            const deptPeople = deptPeopleMap.get(dept.name) || [];
            const status = dept.red > 0 ? "RED" : dept.amber > 0 ? "AMBER" : "GREEN";
            const statusColor = status === "RED" ? "#dc2626" : status === "AMBER" ? "#d97706" : "#16a34a";

            return (
              <React.Fragment key={dept.name}>
                <tr
                  onClick={() => setExpandedDept(isExpanded ? null : dept.name)}
                  style={{ cursor: "pointer", borderBottom: isExpanded ? "none" : `1px solid ${BORDER}` }}
                >
                  <td style={{ ...tdBold, borderBottom: isExpanded ? "none" : undefined }}>
                    <span style={{ fontSize: "14px", color: SLATE, marginRight: "6px" }}>{isExpanded ? "▼" : "▶"}</span>
                    {dept.name}
                  </td>
                  <td style={{ ...td, textAlign: "center", borderBottom: isExpanded ? "none" : undefined }}>
                    <div style={{ display: "flex", justifyContent: "center", gap: "12px" }}>
                      {trafficDot(dept.red, "#dc2626")}
                      {trafficDot(dept.amber, "#d97706")}
                      {trafficDot(dept.green, "#16a34a")}
                    </div>
                  </td>
                  <td style={{ ...td, textAlign: "center", fontWeight: 700, color: statusColor, borderBottom: isExpanded ? "none" : undefined }}>
                    {dept.total}
                  </td>
                </tr>
                {isExpanded && deptPeople.filter((p) => p.total > 0).map((person) => (
                  <tr key={person.name} style={{ backgroundColor: "#f8fafc" }}>
                    <td style={{ ...td, paddingLeft: "32px", fontSize: "15px", color: NAVY }}>{person.name}</td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <div style={{ display: "flex", justifyContent: "center", gap: "12px" }}>
                        {trafficDot(person.red, "#dc2626")}
                        {trafficDot(person.amber, "#d97706")}
                        {trafficDot(person.green, "#16a34a")}
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: "center", color: SLATE }}>{person.total}</td>
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PerformanceTable({ rows }: { rows: PerformanceRow[] }) {
  if (rows.length === 0) return <p style={{ color: SLATE, fontSize: "17px" }}>No task data yet.</p>;
  return (
    <div style={{ overflowX: "auto", marginBottom: "12px", backgroundColor: "white", border: `1px solid ${BORDER}`, borderRadius: "8px" }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ backgroundColor: "#f8fafc" }}>
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
  borderBottom: `1px solid #f1f5f9`,
  padding: "6px 8px",
  fontSize: "16px",
};

const tdBold: React.CSSProperties = {
  ...td,
  fontWeight: 700,
  color: NAVY,
};
