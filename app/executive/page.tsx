"use client";

import React, { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import EscalationTrafficLights from "./EscalationTrafficLights";
import { formatDateUK, workingDaysFromNow } from "../lib/dateUtils";
import { RAGStatus, ragColour } from "../lib/SharedUI";
import { UTPL_COMPANY_ID } from "../lib/constants";
import { useMobile } from "../lib/useMobile";
import MyTasks from "../lib/MyTasks";
import { DEPARTMENT_CONFIGS, getDepartmentHealthStatus } from "../lib/department-config";

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

type BankSnapshot = {
  position_date: string;
  cash_at_office: number;
  js_bank_unze_trading: number;
  askari_bank_saving: number;
  allied_bank_unze_trading: number;
  dib_bank: number;
  silk_bank_saving: number;
  mcb_unze_trading: number;
  askari_saving_1489: number;
  askari_saving_unze_trading: number;
  hbl_pf_unze_trading: number;
  meezan_bank_unze_trading: number;
  hbl_unze_trading: number;
  hbl_h_unze_trading: number;
  faysal_bank_unze_trading: number;
  total_available_balance: number;
  post_dated_cheques_total: number;
  reconciled: boolean;
};

const BANK_DISPLAY_NAMES: Record<string, string> = {
  cash_at_office: "Cash at Office",
  js_bank_unze_trading: "JS Bank",
  askari_bank_saving: "Askari Bank Saving",
  allied_bank_unze_trading: "Allied Bank",
  dib_bank: "DIB Bank",
  silk_bank_saving: "Silk Bank Saving",
  mcb_unze_trading: "MCB Bank",
  askari_saving_1489: "Askari Saving 1489",
  askari_saving_unze_trading: "Askari Saving",
  hbl_pf_unze_trading: "HBL PF",
  meezan_bank_unze_trading: "Meezan Bank",
  hbl_unze_trading: "HBL",
  hbl_h_unze_trading: "HBL - H",
  faysal_bank_unze_trading: "Faysal Bank",
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
  const [cashPlanMissing, setCashPlanMissing] = useState(false);

  const [cashOpening, setCashOpening] = useState<OpeningBalance | null>(null);
  const [cashPlan, setCashPlan] = useState<MonthlyPlan | null>(null);
  const [cashPositions, setCashPositions] = useState<DailyPosition[]>([]);
  const [receivableRows, setReceivableRows] = useState<ReceivableCustomerRow[]>([]);
  const [bankSnapshot, setBankSnapshot] = useState<BankSnapshot | null>(null);
  const [bankExpanded, setBankExpanded] = useState(false);
  const [lastYearReceipts, setLastYearReceipts] = useState<number | null>(null);
  const [lastYearPayments, setLastYearPayments] = useState<number | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [deptHealth, setDeptHealth] = useState<{ slug: string; title: string; status: "GREEN" | "AMBER" | "RED" }[]>([]);

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
        .select("role")
        .eq("email", user.email)
        .maybeSingle();
      if (memberData) setUserRole(memberData.role);
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
    const [cashOpenRes, cashPlanRes, cashPosRes] = await Promise.all([
      supabase.from("cash_opening_balance").select("*").eq("company_id", UTPL_COMPANY_ID).order("as_of_date", { ascending: true }).limit(1),
      supabase.from("monthly_cash_plan").select("*").eq("company_id", UTPL_COMPANY_ID).eq("plan_month", currentMonthForCash).maybeSingle(),
      supabase.from("daily_cash_position").select("*").eq("company_id", UTPL_COMPANY_ID).order("position_date", { ascending: false }).limit(30),
    ]);
    setCashOpening(cashOpenRes.data && cashOpenRes.data.length > 0 ? cashOpenRes.data[0] : null);
    setCashPlan(cashPlanRes.data || null);
    setCashPositions(cashPosRes.data || []);
    setCashPlanMissing(!cashPlanRes.data);

    const bankSnapRes = await supabase
      .from("bank_position_snapshots")
      .select("*")
      .eq("company_id", UTPL_COMPANY_ID)
      .order("position_date", { ascending: false })
      .limit(1);
    setBankSnapshot(bankSnapRes.data && bankSnapRes.data.length > 0 ? bankSnapRes.data[0] : null);

    // Historical comparison: same month last year
    const nowForHist = new Date();
    const lastYearMonth = `${nowForHist.getFullYear() - 1}-${String(nowForHist.getMonth() + 1).padStart(2, "0")}`;
    const lyRes = await supabase
      .from("daily_cash_position")
      .select("total_receipts, total_payments")
      .eq("company_id", UTPL_COMPANY_ID)
      .gte("position_date", lastYearMonth + "-01")
      .lte("position_date", lastYearMonth + "-31");
    if (lyRes.data && lyRes.data.length > 0) {
      const lyData = lyRes.data as { total_receipts: number; total_payments: number }[];
      setLastYearReceipts(lyData.reduce((s, r) => s + (r.total_receipts || 0), 0));
      setLastYearPayments(lyData.reduce((s, r) => s + (r.total_payments || 0), 0));
    } else {
      setLastYearReceipts(null);
      setLastYearPayments(null);
    }

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

    // Cash pacing escalation
    const cashMonth = formatDate(new Date()).slice(0, 7);
    const monthCashPos = (cashPosRes.data || []).filter((p: DailyPosition) => p.position_date.slice(0, 7) === cashMonth);
    const recMTD = monthCashPos.reduce((s: number, p: DailyPosition) => s + p.total_receipts, 0);
    const payMTD = monthCashPos.reduce((s: number, p: DailyPosition) => s + p.total_payments, 0);
    const pRecv = cashPlanRes.data?.tentative_receivables || 0;
    const pPay = cashPlanRes.data?.tentative_payouts || 0;
    const nowDate = new Date();
    const dim = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0).getDate();
    const de = nowDate.getDate();
    const expRecv = pRecv > 0 ? (pRecv / dim) * de : 0;
    const recvPct = expRecv > 0 ? (recMTD / expRecv) * 100 : 100;
    const expPay = pPay > 0 ? (pPay / dim) * de : 0;
    const payPct = expPay > 0 ? (payMTD / expPay) * 100 : 100;

    const financeOwnerRes = await supabase
      .from("department_owners")
      .select("department_name, primary_owner_name, primary_owner_email")
      .eq("department_name", "Finance")
      .maybeSingle();
    const financeOwner: DepartmentOwner | null = financeOwnerRes.data || null;

    if (recvPct < 85) {
      await autoCreateCashEscalationTask(
        "cash_receivables",
        `Receivables pacing at ${Math.round(recvPct)}% — actual ${fmtMoney(recMTD)} vs expected ${fmtMoney(Math.round(expRecv))} by day ${de} of ${dim}.`,
        taskData,
        financeOwner
      );
    }
    if (payPct > 115) {
      await autoCreateCashEscalationTask(
        "cash_payouts",
        `Payouts pacing at ${Math.round(payPct)}% — actual ${fmtMoney(payMTD)} vs expected ${fmtMoney(Math.round(expPay))} by day ${de} of ${dim}.`,
        taskData,
        financeOwner
      );
    }

    setSummaries(result);
    setEscalations(foundEscalations);

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

  const financeMonth = formatDate(new Date()).slice(0, 7);
  const monthCashPositions = cashPositions.filter((p) => p.position_date.slice(0, 7) === financeMonth);
  const actualReceiptsMTD = monthCashPositions.reduce((s, p) => s + p.total_receipts, 0);
  const actualPaymentsMTD = monthCashPositions.reduce((s, p) => s + p.total_payments, 0);
  const latestCashPosition = cashPositions[0] || null;
  const plannedRecv = cashPlan?.tentative_receivables || 0;
  const plannedPay = cashPlan?.tentative_payouts || 0;
  const cashOpeningAmount = cashOpening?.opening_amount || 0;
  const projectedClosing = cashOpeningAmount + plannedRecv - plannedPay;
  const latestClosing = latestCashPosition?.closing_balance ?? cashOpeningAmount;

  // Pacing-based three-state traffic lights
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = now.getDate();

  const expectedRecvByToday = plannedRecv > 0 ? (plannedRecv / daysInMonth) * daysElapsed : 0;
  const recvAchievementPct = expectedRecvByToday > 0
    ? (actualReceiptsMTD / expectedRecvByToday) * 100 : 100;
  const recvStatus: RAGStatus =
    recvAchievementPct >= 95 ? "GREEN" : recvAchievementPct >= 85 ? "AMBER" : "RED";

  const expectedPayByToday = plannedPay > 0 ? (plannedPay / daysInMonth) * daysElapsed : 0;
  const payAchievementPct = expectedPayByToday > 0
    ? (actualPaymentsMTD / expectedPayByToday) * 100 : 100;
  const payStatus: RAGStatus =
    payAchievementPct <= 105 ? "GREEN" : payAchievementPct <= 115 ? "AMBER" : "RED";

  const cashHeadlineStatus: RAGStatus =
    recvStatus === "RED" || payStatus === "RED" ? "RED"
    : recvStatus === "AMBER" || payStatus === "AMBER" ? "AMBER"
    : "GREEN";
  const cashHeadlineRed = cashHeadlineStatus !== "GREEN";

  const recGreen = receivableRows.reduce((s, r) => s + r.greenAmount, 0);
  const recAmber = receivableRows.reduce((s, r) => s + r.amberAmount, 0);
  const recRed = receivableRows.reduce((s, r) => s + r.redAmount, 0);
  const recTotal = receivableRows.reduce((s, r) => s + r.totalAmount, 0);
  const recRedCount = receivableRows.reduce((s, r) => s + r.redCount, 0);

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px", marginBottom: "16px" }}>
          <div>
            <h1 style={{ fontSize: "26px", fontWeight: 800, color: NAVY, margin: 0 }}>Good Morning Khuram</h1>
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
              const latestDate = latestCashPosition?.position_date;
              const cashStaleDays = latestDate ? Math.floor((Date.now() - new Date(latestDate + "T00:00:00").getTime()) / 86400000) : 999;
              const cashStale = userRole === "Admin" && cashStaleDays > 1;
              const cashMissing = userRole === "Admin" && cashPositions.length === 0;
              const hasAttention = overdueTasks.length > 0 || waitingReplies.length > 0 || escalations.length > 0 || missingPlants.length > 0 || downMachines.length > 0 || cashStale || cashMissing || cashPlanMissing;

              return hasAttention ? (
              <>
                <SectionTitle title="Needs Your Attention" />
                <div style={squareGrid}>
                  {overdueTasks.length > 0 && <Card title="Overdue Tasks" value={overdueTasks.length} color="#dc2626" onClick={() => toggleCard("overdue")} />}
                  {waitingReplies.length > 0 && <Card title="Waiting Replies" value={waitingReplies.length} color="#dc2626" onClick={() => toggleCard("waiting")} />}
                  {escalations.length > 0 && <Card title="Escalations" value={escalations.length} color="#dc2626" onClick={() => toggleCard("escalations")} />}
                  {downMachines.length > 0 && <Card title="Machines Down" value={downMachines.length} color="#b91c1c" onClick={() => toggleCard("machines")} />}
                  {missingPlants.length > 0 && <Card title="Plants Not Reported" value={missingPlants.length} color="#ef4444" onClick={() => toggleCard("missing")} />}
                  {cashStale && <Card title="Finance Stale" value={cashStaleDays} color="#dc2626" href="/finance" />}
                  {cashMissing && <Card title="No Finance Data" value={0} color="#dc2626" href="/finance" />}
                  {cashPlanMissing && <Card title="Cash Plan Missing" value={0} color="#d97706" href="/finance" />}
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
            {/* Two continuous columns: left = Finance + Department, right = Receivables + People */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(380px, 1fr))", gap: "14px", marginTop: "8px", alignItems: "start" }}>
              {/* LEFT COLUMN */}
              <div>
                {userRole === "Admin" && (
                <>
                <SectionTitle title="Finance — Cash Position" />
                {!cashPlan && !cashOpening && cashPositions.length === 0 ? (
                  <p style={{ color: SLATE, fontSize: "17px" }}>No finance data yet.</p>
                ) : (
                  <>
                    <div style={panelCardRAG(cashHeadlineStatus)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                        <div style={{ fontSize: "17px", fontWeight: 700, color: NAVY }}>
                          Cash Health: <span style={{ color: ragColour(cashHeadlineStatus) }}>
                            {cashHeadlineStatus === "GREEN" ? "ON TRACK" : cashHeadlineStatus === "AMBER" ? "MONITOR" : "ATTENTION"}
                          </span>
                        </div>
                        {latestCashPosition && (
                          <div style={{
                            fontSize: "14px",
                            fontWeight: 600,
                            color: (() => {
                              const lastDate = new Date(latestCashPosition.position_date + "T00:00:00");
                              const diffDays = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
                              return diffDays > 1 ? "#dc2626" : SLATE;
                            })(),
                          }}>
                            Updated: {formatDateUK(latestCashPosition.position_date)}
                            {(() => {
                              const lastDate = new Date(latestCashPosition.position_date + "T00:00:00");
                              const diffDays = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
                              return diffDays > 1 ? " (STALE)" : "";
                            })()}
                          </div>
                        )}
                      </div>

                      {/* Today's Position */}
                      <div style={{ ...miniGrid, marginBottom: "10px" }}>
                        <Mini label="Today's Closing" value={fmtMoney(latestClosing)} color="#0070f3" />
                        <Mini label="Post-dated" value={fmtMoney(latestCashPosition?.post_dated_total ?? 0)} color={SLATE} />
                        <Mini label="Net after Post-dated" value={fmtMoney(latestCashPosition?.closing_after_post_dated ?? latestClosing)} color={NAVY} />
                      </div>

                      {/* Pacing cards */}
                      <div style={{ ...miniGrid, marginBottom: "6px" }}>
                        <Mini label={`Receivables Pace (${Math.round(recvAchievementPct)}%)`} value={`${fmtMoney(actualReceiptsMTD)} / ${fmtMoney(Math.round(expectedRecvByToday))}`} color={ragColour(recvStatus)} />
                        <Mini label={`Payouts Pace (${Math.round(payAchievementPct)}%)`} value={`${fmtMoney(actualPaymentsMTD)} / ${fmtMoney(Math.round(expectedPayByToday))}`} color={ragColour(payStatus)} />
                        <Mini label="Projected Month-End" value={fmtMoney(projectedClosing)} color={NAVY} />
                      </div>
                    </div>

                    {/* Bank Breakdown drill-down */}
                    {bankSnapshot && (
                      <div style={{ marginTop: "4px" }}>
                        <button
                          onClick={() => setBankExpanded(!bankExpanded)}
                          style={{
                            background: "transparent",
                            border: `1px solid ${BORDER}`,
                            borderRadius: "6px",
                            padding: "5px 12px",
                            fontSize: "15px",
                            fontWeight: 600,
                            color: SLATE,
                            cursor: "pointer",
                            width: "100%",
                            textAlign: "left",
                          }}
                        >
                          {bankExpanded ? "▼" : "▶"} Bank Breakdown ({formatDateUK(bankSnapshot.position_date)})
                          {!bankSnapshot.reconciled && (
                            <span style={{ color: "#dc2626", marginLeft: "8px" }}>NOT RECONCILED</span>
                          )}
                        </button>
                        {bankExpanded && (
                          <div style={{
                            border: `1px solid ${BORDER}`,
                            borderTop: "none",
                            borderRadius: "0 0 6px 6px",
                            padding: "8px 12px",
                            backgroundColor: "white",
                          }}>
                            <table style={{ borderCollapse: "collapse", width: "100%" }}>
                              <tbody>
                                {Object.entries(BANK_DISPLAY_NAMES).map(([key, label]) => {
                                  const val = (bankSnapshot as Record<string, unknown>)[key];
                                  const amount = typeof val === "number" ? val : 0;
                                  return (
                                    <tr key={key}>
                                      <td style={{ padding: "3px 6px", fontSize: "15px", color: NAVY }}>{label}</td>
                                      <td style={{ padding: "3px 6px", fontSize: "15px", fontWeight: 600, textAlign: "right", color: amount > 0 ? NAVY : SLATE }}>
                                        {fmtMoney(amount)}
                                      </td>
                                    </tr>
                                  );
                                })}
                                <tr style={{ borderTop: `1px solid ${BORDER}` }}>
                                  <td style={{ padding: "5px 6px", fontSize: "16px", fontWeight: 700, color: NAVY }}>Total Available</td>
                                  <td style={{ padding: "5px 6px", fontSize: "16px", fontWeight: 700, textAlign: "right", color: "#0070f3" }}>
                                    {fmtMoney(bankSnapshot.total_available_balance)}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* Historical: vs same month last year */}
                {lastYearReceipts !== null && (
                  <div style={{
                    border: `1px solid ${BORDER}`,
                    borderRadius: "6px",
                    padding: "8px 12px",
                    backgroundColor: "white",
                    marginTop: "8px",
                    fontSize: "15px",
                  }}>
                    <div style={{ fontWeight: 700, color: NAVY, marginBottom: "6px" }}>
                      vs Same Month Last Year
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                      <div>
                        <div style={{ color: SLATE }}>Receipts (last yr)</div>
                        <div style={{ fontWeight: 700, color: NAVY }}>{fmtMoney(lastYearReceipts)}</div>
                        <div style={{ color: actualReceiptsMTD >= lastYearReceipts ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
                          {actualReceiptsMTD >= lastYearReceipts ? "▲" : "▼"} {fmtMoney(Math.abs(actualReceiptsMTD - lastYearReceipts))}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: SLATE }}>Payments (last yr)</div>
                        <div style={{ fontWeight: 700, color: NAVY }}>{fmtMoney(lastYearPayments ?? 0)}</div>
                        <div style={{ color: actualPaymentsMTD <= (lastYearPayments ?? 0) ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
                          {actualPaymentsMTD <= (lastYearPayments ?? 0) ? "▼" : "▲"} {fmtMoney(Math.abs(actualPaymentsMTD - (lastYearPayments ?? 0)))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                </>
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
                      <table style={{ borderCollapse: "collapse", width: "100%", marginTop: "12px" }}>
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
                      </table>
                    )}
                  </div>
                )}

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
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden", marginBottom: "12px" }}>
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
