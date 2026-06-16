"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import EscalationTrafficLights from "./EscalationTrafficLights";

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

const NAVY = "#1e293b";
const SLATE = "#64748b";
const BORDER = "#e2e8f0";

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

// UK display format DD-MM-YYYY
function formatDateUK(dateString: string | null) {
  if (!dateString) return "—";
  const [year, month, day] = dateString.slice(0, 10).split("-");
  return `${day}-${month}-${year}`;
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

  async function loadExecutiveData(dateToView: string) {
    setLoading(true);
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
      supabase.from("tasks").select("*").order("created_at", { ascending: false }),
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
      supabase.from("cash_opening_balance").select("*").order("as_of_date", { ascending: true }).limit(1),
      supabase.from("monthly_cash_plan").select("*").eq("plan_month", currentMonthForCash).maybeSingle(),
      supabase.from("daily_cash_position").select("*").order("position_date", { ascending: false }).limit(30),
    ]);
    setCashOpening(cashOpenRes.data && cashOpenRes.data.length > 0 ? cashOpenRes.data[0] : null);
    setCashPlan(cashPlanRes.data || null);
    setCashPositions(cashPosRes.data || []);
    setCashPlanMissing(!cashPlanRes.data);

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

    setSummaries(result);
    setEscalations(foundEscalations);
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

  const selectedMonth = getMonthFromDate(selectedDate);
  const currentQuarter = getMonthQuarter(selectedDate);

  const financeMonth = formatDate(new Date()).slice(0, 7);
  const monthCashPositions = cashPositions.filter((p) => p.position_date.slice(0, 7) === financeMonth);
  const actualReceiptsMTD = monthCashPositions.reduce((s, p) => s + p.total_receipts, 0);
  const actualPaymentsMTD = monthCashPositions.reduce((s, p) => s + p.total_payments, 0);
  const latestCashPosition = cashPositions[0] || null;
  const plannedRecv = cashPlan?.tentative_receivables || 0;
  const plannedPay = cashPlan?.tentative_payouts || 0;
  const recvBehind = plannedRecv > 0 && actualReceiptsMTD < plannedRecv;
  const payOver = plannedPay > 0 && actualPaymentsMTD > plannedPay;
  const cashOpeningAmount = cashOpening?.opening_amount || 0;
  const projectedClosing = cashOpeningAmount + plannedRecv - plannedPay;
  const latestClosing = latestCashPosition?.closing_balance ?? cashOpeningAmount;
  const cashHeadlineRed = recvBehind || payOver;

  const recGreen = receivableRows.reduce((s, r) => s + r.greenAmount, 0);
  const recAmber = receivableRows.reduce((s, r) => s + r.amberAmount, 0);
  const recRed = receivableRows.reduce((s, r) => s + r.redAmount, 0);
  const recTotal = receivableRows.reduce((s, r) => s + r.totalAmount, 0);
  const recRedCount = receivableRows.reduce((s, r) => s + r.redCount, 0);

  return (
    <AuthWrapper>
      <main style={{ padding: "20px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px", marginBottom: "16px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 800, color: NAVY, margin: 0 }}>Good Morning Khuram</h1>
            <p style={{ color: SLATE, fontSize: "12px", marginTop: "5px", maxWidth: "640px" }}>
              Executive escalations surface lagging indicators (Q3+ for production and dispatch, breakage over 1.5%). Earlier issues stay with operations.
            </p>
          </div>
          <div style={{ backgroundColor: "white", border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "8px 12px" }}>
            <label style={{ fontWeight: 700, display: "block", marginBottom: "3px", fontSize: "11px", color: SLATE }}>View date</label>
            <input
              type="date"
              value={selectedDate}
              min={minDate}
              max={today}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{ padding: "6px 9px", border: `1px solid ${BORDER}`, borderRadius: "6px", fontSize: "12px" }}
            />
            <div style={{ marginTop: "5px", color: SLATE, fontSize: "11px" }}>
              {selectedMonth} · Q{currentQuarter}
            </div>
          </div>
        </div>

        {loading ? (
          <p style={{ color: SLATE }}>Loading executive dashboard…</p>
        ) : (
          <>
            {cashPlanMissing && (
              <SlimAlert color="#dc2626" text="This month's cash plan has not been entered. The finance manager needs to set expected receivables and payouts on the Finance page." />
            )}

            <SectionTitle title="Executive Escalations" />
            <EscalationTrafficLights escalations={escalations} />
            {/* Two-column row: Attention (left) + Daily Snapshot (right) */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: "16px", marginTop: "8px" }}>
              <div>
                <SectionTitle title="Executive Attention" />
                <div style={squareGrid}>
                  <Card title="Overdue Tasks" value={overdueTasks.length} color="#dc2626" />
                  <Card title="Waiting Replies" value={waitingReplies.length} color="#dc2626" />
                  <Card title="Machines Down" value={downMachines.length} color="#dc2626" />
                  <Card title="Plants Missing" value={missingPlants.length} color="#ef4444" />
                  <Card title="Escalations" value={escalations.length} color="#dc2626" />
                  <Card title="Due This Week" value={dueThisWeekTasks.length} color="#d97706" />
                  <Card title="Completed (Month)" value={completedThisMonth.length} color="#16a34a" />
                </div>
              </div>

              <div>
                <SectionTitle title="Operations Daily Snapshot" />
                <div style={squareGrid}>
                  <Card title="Produced Today" value={produced} color="#16a34a" />
                  <Card title="Broken Today" value={broken} color="#dc2626" />
                  <Card title="Dispatched Today" value={dispatched} color="#7c3aed" />
                  <Card title="Machine Issues" value={machineIssues.length} color="#b91c1c" />
                  <Card title="Closing Good Stock" value={closingGoodStock} color="#0070f3" />
                  <Card title="Closing Broken Stock" value={closingBrokenStock} color="#d97706" />
                </div>
              </div>
            </div>

            {/* Two-column row: Finance + Receivables side by side on wide screens */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: "14px", marginTop: "8px" }}>
              <div>
                <SectionTitle title="Finance — Cash Position" />
                {!cashPlan && !cashOpening && cashPositions.length === 0 ? (
                  <p style={{ color: SLATE, fontSize: "13px" }}>No finance data yet.</p>
                ) : (
                  <div style={panelCard(cashHeadlineRed)}>
                    <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "10px", color: NAVY }}>
                      Cash Health: <span style={{ color: cashHeadlineRed ? "#dc2626" : "#16a34a" }}>{cashHeadlineRed ? "ATTENTION" : "ON TRACK"}</span>
                    </div>
                    <div style={miniGrid}>
                      <Mini label="Money In (act/plan)" value={`${fmtMoney(actualReceiptsMTD)} / ${fmtMoney(plannedRecv)}`} color={recvBehind ? "#dc2626" : "#16a34a"} />
                      <Mini label="Money Out (act/plan)" value={`${fmtMoney(actualPaymentsMTD)} / ${fmtMoney(plannedPay)}`} color={payOver ? "#dc2626" : "#16a34a"} />
                      <Mini label="Latest Closing" value={fmtMoney(latestClosing)} color="#0070f3" />
                      <Mini label="Projected Month-End" value={fmtMoney(projectedClosing)} color={NAVY} />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <SectionTitle title="Receivables — Bills in Progress" />
                {receivableRows.length === 0 ? (
                  <p style={{ color: SLATE, fontSize: "13px" }}>No receivable bills in progress.</p>
                ) : (
                  <div style={panelCard(recRed > 0)}>
                    <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "10px", color: NAVY }}>
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

            {/* Two-column row: Department + People performance */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: "14px", marginTop: "8px" }}>
              <div>
                <SectionTitle title="Department Performance" />
                <PerformanceTable rows={departmentRows} />
              </div>
              <div>
                <SectionTitle title="People Performance" />
                <PerformanceTable rows={peopleRows} />
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
  gridTemplateColumns: "repeat(4, 1fr)",
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
    marginBottom: "12px",
  };
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h2 style={{ fontSize: "13px", fontWeight: 700, color: NAVY, margin: "14px 0 8px", paddingLeft: "9px", borderLeft: `3px solid ${NAVY}` }}>
      {title}
    </h2>
  );
}

function Card({ title, value, color }: { title: string; value: number; color: string }) {
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderTop: `3px solid ${color}`, borderRadius: "7px", padding: "8px 10px", backgroundColor: "white" }}>
      <div style={{ color: SLATE, fontSize: "11px", marginBottom: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
      <div style={{ fontSize: "19px", fontWeight: 800, color }}>{value.toLocaleString()}</div>
    </div>
  );
}

function Mini({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ color: SLATE, fontSize: "10px", marginBottom: "1px" }}>{label}</div>
      <div style={{ fontSize: "14px", fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function SlimAlert({ color, text }: { color: string; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", backgroundColor: "white", border: `1px solid ${BORDER}`, borderLeft: `4px solid ${color}`, borderRadius: "6px", padding: "10px 14px", marginBottom: "14px" }}>
      <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: color, flexShrink: 0 }} />
      <span style={{ fontSize: "13px", color: NAVY }}>{text}</span>
    </div>
  );
}

function PerformanceTable({ rows }: { rows: PerformanceRow[] }) {
  if (rows.length === 0) return <p style={{ color: SLATE, fontSize: "13px" }}>No task data yet.</p>;
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
  fontSize: "11px",
  color: SLATE,
  fontWeight: 700,
};

const td: React.CSSProperties = {
  borderBottom: `1px solid #f1f5f9`,
  padding: "6px 8px",
  fontSize: "12px",
};

const tdBold: React.CSSProperties = {
  ...td,
  fontWeight: 700,
  color: NAVY,
};
