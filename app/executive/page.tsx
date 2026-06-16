"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";

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

// One escalation finding for a plant + metric
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

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function formatDateUK(dateString: string | null) {
  if (!dateString) return "—";
  const [year, month, day] = dateString.split("-");
  return `${day}/${month}/${year}`;
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

// Month-quarter logic (Option 1): which quarter-of-month is a date in?
// Q1 = days 1-7, Q2 = 8-14, Q3 = 15-21, Q4 = 22-end.
function getMonthQuarter(dateString: string): 1 | 2 | 3 | 4 {
  const day = Number(dateString.slice(8, 10));
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  return 4;
}

// The last calendar day (within the month) of a given quarter.
function quarterEndDate(monthStart: string, quarter: 1 | 2 | 3 | 4) {
  const [year, month] = monthStart.slice(0, 7).split("-").map(Number);
  if (quarter === 1) return `${monthStart.slice(0, 7)}-07`;
  if (quarter === 2) return `${monthStart.slice(0, 7)}-14`;
  if (quarter === 3) return `${monthStart.slice(0, 7)}-21`;
  const lastDay = new Date(year, month, 0).getDate();
  return `${monthStart.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
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

function achievementStatus(achievement: number, hasTarget: boolean): Status {
  if (!hasTarget) return "none";
  if (achievement >= 95) return "green";
  if (achievement >= 85) return "amber";
  return "red";
}

function breakageStatus(rate: number, produced: number): Status {
  if (produced <= 0) return "none";
  if (rate <= 1) return "green";
  if (rate <= 1.5) return "amber";
  return "red";
}

function statusColor(status: Status) {
  if (status === "green") return "#16a34a";
  if (status === "amber") return "#d97706";
  if (status === "red") return "#dc2626";
  return "#666";
}

function statusLabel(status: Status) {
  if (status === "none") return "No Target";
  return status.toUpperCase();
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

  async function autoCreateEscalationTask(
    esc: Escalation,
    allTasks: Task[],
    owner: DepartmentOwner | null
  ) {
    if (!owner?.primary_owner_name || !owner?.primary_owner_email) return;

    const alreadyExists = allTasks.some(
      (task) =>
        task.source_type === "kpi_escalation" &&
        task.source_label === esc.sourceLabel
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

  async function loadExecutiveData(dateToView: string) {
    setLoading(true);

    const selectedMonth = getMonthFromDate(dateToView);
    const selectedMonthStart = getMonthStartFromDate(dateToView);
    const selectedMonthEnd = getMonthEndFromDate(dateToView);

    const [
      plantsRes,
      openRes,
      brokenOpenRes,
      prodRes,
      dispRes,
      brkRes,
      scrapRes,
      machineIssuesRes,
      tasksRes,
      ownerRes,
      monthlyProductionTargetsRes,
      monthlyDispatchTargetsRes,
      monthlyProductionRes,
      monthlyDispatchRes,
      monthlyBreakageRes,
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

    // Sum a metric for a plant between two dates (inclusive)
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
      const forPlant = rows
        .filter((r) => r.plant_id === plantId)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      if (forPlant.length > 0) {
        const latest = forPlant[0];
        t.s31 = latest.bal_31 || 0;
        t.s36 = latest.bal_36 || 0;
        t.s45 = latest.bal_45 || 0;
        t.meter = latest.bal_meter || 0;
      }
      return t;
    }

    // ---- Plant stock summaries (unchanged behaviour) ----
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
        plant,
        closingGoodStock,
        closingBrokenStock,
        producedOnDate: sumForDate(production, plant.id, true),
        dispatchedOnDate: sumForDate(dispatch, plant.id, true),
        brokenOnDate: sumForDate(breakage, plant.id, true),
        enteredOnDate,
      };
    });

    // ---- Escalation engine (Option 1: month-quarters, cumulative) ----
    const currentQuarter = getMonthQuarter(dateToView);
    const q1End = quarterEndDate(selectedMonthStart, 1);
    const q2End = quarterEndDate(selectedMonthStart, 2);

    const foundEscalations: Escalation[] = [];

    // Helper: is a plant "behind" (under 85%) at a given quarter checkpoint, for a metric?
    function behindAtQuarter(
      entries: any[],
      targetTotalForMonth: number,
      plantId: string,
      quarter: 1 | 2 | 3 | 4,
      checkpointEnd: string
    ): boolean {
      if (targetTotalForMonth <= 0) return false; // no target = can't be behind
      const cumulativeTarget = (targetTotalForMonth / 4) * quarter;
      const cumulativeActual = sumBetween(entries, plantId, selectedMonthStart, checkpointEnd);
      const achievement = cumulativeTarget > 0 ? (cumulativeActual / cumulativeTarget) * 100 : 0;
      return achievement < 85;
    }

    for (const plant of plants) {
      // Production escalation
      const prodTarget = targetTotal(monthlyProductionTargets.find((t) => t.plant_id === plant.id));
      if (prodTarget > 0 && currentQuarter >= 3) {
        const behindQ1 = behindAtQuarter(monthlyProduction, prodTarget, plant.id, 1, q1End);
        const behindQ2 = behindAtQuarter(monthlyProduction, prodTarget, plant.id, 2, q2End);
        if (behindQ1 && behindQ2) {
          const cumActual = sumBetween(monthlyProduction, plant.id, selectedMonthStart, dateToView);
          const cumTargetNow = (prodTarget / 4) * currentQuarter;
          const ach = cumTargetNow > 0 ? Math.round((cumActual / cumTargetNow) * 100) : 0;
          foundEscalations.push({
            plantId: plant.id,
            plantName: plant.name,
            metric: "Production",
            detail: `Behind in Q1 and Q2. Now Q${currentQuarter}: ${cumActual} of ${Math.round(cumTargetNow)} expected (${ach}%).`,
            sourceLabel: `kpi_escalation:production:${plant.id}:${selectedMonth}`,
          });
        }
      }

      // Dispatch escalation
      const dispTarget = targetTotal(monthlyDispatchTargets.find((t) => t.plant_id === plant.id));
      if (dispTarget > 0 && currentQuarter >= 3) {
        const behindQ1 = behindAtQuarter(monthlyDispatch, dispTarget, plant.id, 1, q1End);
        const behindQ2 = behindAtQuarter(monthlyDispatch, dispTarget, plant.id, 2, q2End);
        if (behindQ1 && behindQ2) {
          const cumActual = sumBetween(monthlyDispatch, plant.id, selectedMonthStart, dateToView);
          const cumTargetNow = (dispTarget / 4) * currentQuarter;
          const ach = cumTargetNow > 0 ? Math.round((cumActual / cumTargetNow) * 100) : 0;
          foundEscalations.push({
            plantId: plant.id,
            plantName: plant.name,
            metric: "Dispatch",
            detail: `Behind in Q1 and Q2. Now Q${currentQuarter}: ${cumActual} of ${Math.round(cumTargetNow)} expected (${ach}%).`,
            sourceLabel: `kpi_escalation:dispatch:${plant.id}:${selectedMonth}`,
          });
        }
      }

      // Breakage escalation (rate-band, month-to-date, >1.5% = red + task)
      const producedMTD = sumBetween(monthlyProduction, plant.id, selectedMonthStart, dateToView);
      const brokenMTD = sumBetween(monthlyBreakage, plant.id, selectedMonthStart, dateToView);
      if (producedMTD > 0) {
        const rate = (brokenMTD / producedMTD) * 100;
        if (rate > 1.5) {
          foundEscalations.push({
            plantId: plant.id,
            plantName: plant.name,
            metric: "Breakage",
            detail: `Breakage rate ${rate.toFixed(2)}% (${brokenMTD} broken of ${producedMTD} produced) exceeds 1.5% limit.`,
            sourceLabel: `kpi_escalation:breakage:${plant.id}:${selectedMonth}`,
          });
        }
      }
    }

    // Auto-create tasks for each escalation (guarded against duplicates)
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
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
    (t) =>
      t.status === "Completed" &&
      ((t.updated_at && t.updated_at.slice(0, 10) >= currentMonthStart) ||
        (!t.updated_at && t.created_at && t.created_at.slice(0, 10) >= currentMonthStart))
  );

  const productionEscalations = escalations.filter((e) => e.metric === "Production");
  const dispatchEscalations = escalations.filter((e) => e.metric === "Dispatch");
  const breakageEscalations = escalations.filter((e) => e.metric === "Breakage");

  const departmentRows = buildPerformanceRows(tasks, "department");
  const peopleRows = buildPerformanceRows(tasks, "person");

  const selectedMonth = getMonthFromDate(selectedDate);
  const currentQuarter = getMonthQuarter(selectedDate);

  return (
    <AuthWrapper>
      <main style={{ padding: "40px", fontFamily: "sans-serif" }}>
        <h1 style={{ fontSize: "36px", fontWeight: "bold", marginBottom: "8px" }}>
          Good Morning Khuram
        </h1>

        <p style={{ color: "#666", marginBottom: "20px" }}>
          Executive escalations only surface lagging indicators (Quarter 3 onwards for production and
          dispatch, and breakage over 1.5%). Earlier-quarter issues stay with the operations manager.
        </p>

        <div style={{ marginBottom: "32px" }}>
          <label style={{ fontWeight: "bold", display: "block", marginBottom: "6px" }}>
            View date
          </label>
          <input
            type="date"
            value={selectedDate}
            min={minDate}
            max={today}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{ padding: "10px", border: "1px solid #ccc", borderRadius: "6px", fontSize: "15px" }}
          />
          <div style={{ marginTop: "8px", color: "#666", fontSize: "14px" }}>
            Selected month: <strong>{selectedMonth}</strong> | Month quarter:{" "}
            <strong>Q{currentQuarter}</strong>
          </div>
        </div>

        {loading ? (
          <p>Loading executive dashboard…</p>
        ) : (
          <>
            <SectionTitle title="Executive Escalations (Lagging Indicators)" />

            {escalations.length === 0 ? (
              <div
                style={{
                  border: "1px solid #bbf7d0",
                  backgroundColor: "#f0fdf4",
                  color: "#166534",
                  borderRadius: "10px",
                  padding: "16px",
                  fontWeight: "bold",
                  marginBottom: "32px",
                }}
              >
                No escalations. Nothing has reached executive level this month.
              </div>
            ) : (
              <div style={{ display: "grid", gap: "14px", marginBottom: "32px" }}>
                {productionEscalations.map((e) => (
                  <AlertBox key={e.sourceLabel} type="bad" title={`Production lagging — ${e.plantName}`} text={`${e.detail} An Explanation Required task has been raised with the department owner.`} />
                ))}
                {dispatchEscalations.map((e) => (
                  <AlertBox key={e.sourceLabel} type="bad" title={`Dispatch lagging — ${e.plantName}`} text={`${e.detail} An Explanation Required task has been raised with the department owner.`} />
                ))}
                {breakageEscalations.map((e) => (
                  <AlertBox key={e.sourceLabel} type="bad" title={`Breakage over limit — ${e.plantName}`} text={`${e.detail} An Explanation Required task has been raised with the department owner.`} />
                ))}
              </div>
            )}

            <SectionTitle title="Executive Attention" />
            <div style={gridStyle}>
              <Card title="Overdue Tasks" value={overdueTasks.length} color="#dc2626" />
              <Card title="Waiting Replies" value={waitingReplies.length} color="#dc2626" />
              <Card title="Machines Down" value={downMachines.length} color="#dc2626" />
              <Card title="Plants Missing Updates" value={missingPlants.length} color="#ef4444" />
              <Card title="Escalations" value={escalations.length} color="#dc2626" />
              <Card title="Tasks Due This Week" value={dueThisWeekTasks.length} color="#d97706" />
              <Card title="Completed This Month" value={completedThisMonth.length} color="#16a34a" />
            </div>

            <SectionTitle title="Operations Daily Snapshot" />
            <div style={gridStyle}>
              <Card title="Produced Today" value={produced} color="#16a34a" />
              <Card title="Broken Today" value={broken} color="#dc2626" />
              <Card title="Dispatched Today" value={dispatched} color="#7c3aed" />
              <Card title="Machine Issues" value={machineIssues.length} color="#b91c1c" />
              <Card title="Closing Good Stock" value={closingGoodStock} color="#0070f3" />
              <Card title="Closing Broken Stock" value={closingBrokenStock} color="#d97706" />
            </div>

            <SectionTitle title="Other Alerts" />
            <div style={{ display: "grid", gap: "14px", marginBottom: "32px" }}>
              {missingPlants.length > 0 && (
                <AlertBox type="bad" title={`${missingPlants.length} plant(s) did not update`} text={missingPlants.map((s) => s.plant.name).join(", ")} />
              )}
              {downMachines.length > 0 && (
                <AlertBox type="bad" title={`${downMachines.length} machine(s) down`} text={downMachines.map((i) => `${i.plant_name} - ${i.machine_name}`).join(" | ")} />
              )}
              {partialMachines.length > 0 && (
                <AlertBox type="warning" title={`${partialMachines.length} machine(s) partially working`} text={partialMachines.map((i) => `${i.plant_name} - ${i.machine_name}`).join(" | ")} />
              )}
              {overdueTasks.length > 0 && (
                <AlertBox type="bad" title={`${overdueTasks.length} overdue task(s)`} text={overdueTasks.slice(0, 5).map((t) => `${t.assigned_to || "Unassigned"}: ${t.description}`).join(" | ")} />
              )}
            </div>

            <SectionTitle title="Department Performance" />
            <PerformanceTable rows={departmentRows} />

            <SectionTitle title="People Performance" />
            <PerformanceTable rows={peopleRows} />

            <SectionTitle title="Finance" />
            <div style={gridStyle}>
              <ComingSoonCard title="Cash Received" />
              <ComingSoonCard title="Current Cash Position" />
              <ComingSoonCard title="Cashflow Forecast" />
            </div>
          </>
        )}
      </main>
    </AuthWrapper>
  );
}

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
  gap: "16px",
  marginBottom: "32px",
};

function SectionTitle({ title }: { title: string }) {
  return (
    <h2 style={{ fontSize: "22px", fontWeight: "bold", marginTop: "28px", marginBottom: "14px" }}>
      {title}
    </h2>
  );
}

function Card({ title, value, color, suffix = "" }: { title: string; value: number; color: string; suffix?: string }) {
  return (
    <div style={{ border: "1px solid #e0e0e0", borderTop: `4px solid ${color}`, borderRadius: "10px", padding: "20px" }}>
      <div style={{ color: "#666", fontSize: "14px", marginBottom: "8px" }}>{title}</div>
      <div style={{ fontSize: "34px", fontWeight: "bold", color }}>
        {value.toLocaleString()}
        {suffix}
      </div>
    </div>
  );
}

function ComingSoonCard({ title }: { title: string }) {
  return (
    <div style={{ border: "1px solid #e0e0e0", borderRadius: "10px", padding: "20px", backgroundColor: "#fafafa" }}>
      <div style={{ color: "#666", fontSize: "14px", marginBottom: "8px" }}>{title}</div>
      <div style={{ fontSize: "20px", fontWeight: "bold", color: "#999" }}>Coming Soon</div>
    </div>
  );
}

function AlertBox({ type, title, text }: { type: "good" | "bad" | "warning"; title: string; text: string }) {
  const styles = {
    good: { border: "#bbf7d0", background: "#f0fdf4", color: "#166534" },
    bad: { border: "#fecaca", background: "#fef2f2", color: "#991b1b" },
    warning: { border: "#fed7aa", background: "#fff7ed", color: "#9a3412" },
  };
  const s = styles[type];
  return (
    <div style={{ border: `1px solid ${s.border}`, backgroundColor: s.background, color: s.color, borderRadius: "10px", padding: "16px" }}>
      <strong>{title}</strong>
      <div style={{ marginTop: "6px", fontSize: "14px" }}>{text}</div>
    </div>
  );
}

function PerformanceTable({ rows }: { rows: PerformanceRow[] }) {
  if (rows.length === 0) return <p style={{ color: "#666" }}>No task data yet.</p>;
  return (
    <div style={{ overflowX: "auto", marginBottom: "32px" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "520px" }}>
        <thead>
          <tr style={{ backgroundColor: "#fafafa" }}>
            <th style={tableHeaderStyle}>Name</th>
            <th style={tableHeaderStyle}>Red</th>
            <th style={tableHeaderStyle}>Amber</th>
            <th style={tableHeaderStyle}>Green</th>
            <th style={tableHeaderStyle}>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td style={tableCellStyle}><strong>{r.name}</strong></td>
              <td style={{ ...tableCellStyle, color: "#dc2626", fontWeight: "bold" }}>{r.red}</td>
              <td style={{ ...tableCellStyle, color: "#d97706", fontWeight: "bold" }}>{r.amber}</td>
              <td style={{ ...tableCellStyle, color: "#16a34a", fontWeight: "bold" }}>{r.green}</td>
              <td style={tableCellStyle}>{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const tableHeaderStyle = {
  textAlign: "left" as const,
  border: "1px solid #e0e0e0",
  padding: "10px",
  fontSize: "14px",
};

const tableCellStyle = {
  border: "1px solid #e0e0e0",
  padding: "10px",
  fontSize: "14px",
};
