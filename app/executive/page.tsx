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
};

type WeeklyTarget = {
  id: string;
  plant_id: string;
  plant_name: string;
  week_start: string;
  week_end: string;
  target_31: number | null;
  target_36: number | null;
  target_45: number | null;
  target_meter: number | null;
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

type WeeklyProductionRow = {
  plantName: string;
  targetId: string | null;
  target: number;
  actual: number;
  variance: number;
  achievement: number;
  status: Status;
  sourceLabel: string;
};

type MonthlyOperationsRow = {
  plantName: string;
  productionTarget: number;
  productionActual: number;
  productionAchievement: number;
  productionStatus: Status;
  dispatchTarget: number;
  dispatchActual: number;
  dispatchAchievement: number;
  dispatchStatus: Status;
  breakageProduced: number;
  breakageBroken: number;
  breakageRate: number;
  breakageStatus: Status;
  overallStatus: Status;
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

function getMondayFromDate(dateString: string) {
  const d = new Date(dateString);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

function addDays(dateString: string, days: number) {
  const d = new Date(dateString);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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

function targetTotal(t?: MonthlyTarget | WeeklyTarget) {
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
  if (rate <= 1.05) return "amber";
  return "red";
}

function worstStatus(statuses: Status[]): Status {
  if (statuses.includes("red")) return "red";
  if (statuses.includes("amber")) return "amber";
  if (statuses.includes("green")) return "green";
  return "none";
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
  const [weeklyRows, setWeeklyRows] = useState<WeeklyProductionRow[]>([]);
  const [monthlyRows, setMonthlyRows] = useState<MonthlyOperationsRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function autoCreateRedVarianceTasks(
    redRows: WeeklyProductionRow[],
    allTasks: Task[],
    productionOwner: DepartmentOwner | null
  ) {
    if (!productionOwner?.primary_owner_name) return;

    for (const row of redRows) {
      if (!row.targetId) continue;

      const alreadyExists = allTasks.some(
        (task) =>
          task.source_type === "production_variance" &&
          task.source_label === row.sourceLabel
      );

      if (alreadyExists) continue;

      await supabase.from("tasks").insert({
        task_type: "Explanation Required",
        exception_type: "production_variance",
  explanation_required: true,
        description: `Explain weekly production shortfall for ${row.plantName}. Target: ${row.target}, Actual: ${row.actual}, Achievement: ${row.achievement}%.`,
        project: "Unze Pole Production",
        priority: "High",
        status: "Waiting Reply",
        due_date: dueIn48Hours(),
        assigned_date: today,
        assigned_to: productionOwner.primary_owner_name,
        assigned_to_email: productionOwner.primary_owner_email,
        assigned_by: "System",
        notes:`Auto-created because weekly production achievement fell below 85%. Variance: ${row.variance}.`,
        reply_required: true,
        assigned_to_department: "Unze Pole Production",
        assigned_to_business_unit: null,
        source_type: "production_variance",
        source_record_id: row.targetId,
        source_label: row.sourceLabel,
      });
    }
  }

  async function loadExecutiveData(dateToView: string) {
    setLoading(true);

    const weekStart = getMondayFromDate(dateToView);
    const weekEnd = addDays(weekStart, 6);

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
      weeklyTargetsRes,
      weeklyProductionRes,
      productionOwnerRes,
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
      supabase.from("weekly_production_targets").select("*").eq("week_start", weekStart).eq("week_end", weekEnd),
      supabase.from("production_entries").select("*").gte("entry_date", weekStart).lte("entry_date", weekEnd),
      supabase.from("department_owners").select("department_name, primary_owner_name, primary_owner_email").eq("department_name", "Unze Pole Production").single(),
      supabase.from("monthly_production_targets").select("*").eq("target_month", selectedMonth),
      supabase.from("monthly_dispatch_targets").select("*").eq("target_month", selectedMonth),
      supabase.from("production_entries").select("*").gte("entry_date", selectedMonthStart).lte("entry_date", selectedMonthEnd),
      supabase.from("dispatch_entries").select("*").gte("entry_date", selectedMonthStart).lte("entry_date", selectedMonthEnd),
      supabase.from("breakage_entries").select("*").gte("entry_date", selectedMonthStart).lte("entry_date", selectedMonthEnd),
    ]);

    const plants = plantsRes.data || [];
    const opening = openRes.data || [];
    const brokenOpening = brokenOpenRes.data || [];
    const production = prodRes.data || [];
    const dispatch = dispRes.data || [];
    const breakage = brkRes.data || [];
    const scrap = scrapRes.data || [];
    const activeMachineIssues = machineIssuesRes.data || [];
    const taskData: Task[] = tasksRes.data || [];
    const weeklyTargets: WeeklyTarget[] = weeklyTargetsRes.data || [];
    const weeklyProduction = weeklyProductionRes.data || [];
    const productionOwner = productionOwnerRes.data || null;
    const monthlyProductionTargets: MonthlyTarget[] = monthlyProductionTargetsRes.data || [];
    const monthlyDispatchTargets: MonthlyTarget[] = monthlyDispatchTargetsRes.data || [];
    const monthlyProduction = monthlyProductionRes.data || [];
    const monthlyDispatch = monthlyDispatchRes.data || [];
    const monthlyBreakage = monthlyBreakageRes.data || [];

    setMachineIssues(activeMachineIssues);
    setTasks(taskData);

    function sumFor(rows: any[], plantId: string, onlySelectedDate: boolean): SizeTotals {
      const t = emptyTotals();

      for (const r of rows) {
        if (r.plant_id !== plantId) continue;
        if (onlySelectedDate && r.entry_date !== dateToView) continue;

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

    const result: PlantExecutiveSummary[] = plants.map((plant) => {
      const openingGood = openingFor(opening, plant.id);
      const openingBroken = openingFor(brokenOpening, plant.id);

      const totalProducedUntilDate = sumFor(production, plant.id, false);
      const totalDispatchedUntilDate = sumFor(dispatch, plant.id, false);
      const totalBrokenUntilDate = sumFor(breakage, plant.id, false);
      const totalScrapProcessedUntilDate = sumFor(scrap, plant.id, false);

      const closingGoodStock: SizeTotals = {
        s31: openingGood.s31 + totalProducedUntilDate.s31 - totalBrokenUntilDate.s31 - totalDispatchedUntilDate.s31,
        s36: openingGood.s36 + totalProducedUntilDate.s36 - totalBrokenUntilDate.s36 - totalDispatchedUntilDate.s36,
        s45: openingGood.s45 + totalProducedUntilDate.s45 - totalBrokenUntilDate.s45 - totalDispatchedUntilDate.s45,
        meter: openingGood.meter + totalProducedUntilDate.meter - totalDispatchedUntilDate.meter,
      };

      const closingBrokenStock: SizeTotals = {
        s31: openingBroken.s31 + totalBrokenUntilDate.s31 - totalScrapProcessedUntilDate.s31,
        s36: openingBroken.s36 + totalBrokenUntilDate.s36 - totalScrapProcessedUntilDate.s36,
        s45: openingBroken.s45 + totalBrokenUntilDate.s45 - totalScrapProcessedUntilDate.s45,
        meter: 0,
      };

      const producedOnDate = sumFor(production, plant.id, true);
      const dispatchedOnDate = sumFor(dispatch, plant.id, true);
      const brokenOnDate = sumFor(breakage, plant.id, true);

      const enteredOnDate =
        production.some((r) => r.plant_id === plant.id && r.entry_date === dateToView) ||
        dispatch.some((r) => r.plant_id === plant.id && r.entry_date === dateToView) ||
        breakage.some((r) => r.plant_id === plant.id && r.entry_date === dateToView);

      return {
        plant,
        closingGoodStock,
        closingBrokenStock,
        producedOnDate,
        dispatchedOnDate,
        brokenOnDate,
        enteredOnDate,
      };
    });

    const weeklyPerformance: WeeklyProductionRow[] = plants.map((plant) => {
      const target = weeklyTargets.find((t) => t.plant_id === plant.id);
      const targetTotal = targetTotalSafe(target);
      const actualTotal = total(sumFor(weeklyProduction, plant.id, false));
      const variance = actualTotal - targetTotal;
      const achievement = targetTotal > 0 ? Math.round((actualTotal / targetTotal) * 100) : 0;
      const status = achievementStatus(achievement, targetTotal > 0);

      return {
        plantName: plant.name,
        targetId: target?.id || null,
        target: targetTotal,
        actual: actualTotal,
        variance,
        achievement,
        status,
        sourceLabel: `production_variance:${plant.id}:${weekStart}`,
      };
    });

    const monthlyOperations: MonthlyOperationsRow[] = plants.map((plant) => {
      const prodTarget = monthlyProductionTargets.find((t) => t.plant_id === plant.id);
      const dispTarget = monthlyDispatchTargets.find((t) => t.plant_id === plant.id);

      const productionTarget = targetTotal(prodTarget);
      const productionActual = total(sumFor(monthlyProduction, plant.id, false));
      const productionAchievement =
        productionTarget > 0 ? Math.round((productionActual / productionTarget) * 100) : 0;
      const productionStatus = achievementStatus(productionAchievement, productionTarget > 0);

      const dispatchTarget = targetTotal(dispTarget);
      const dispatchActual = total(sumFor(monthlyDispatch, plant.id, false));
      const dispatchAchievement =
        dispatchTarget > 0 ? Math.round((dispatchActual / dispatchTarget) * 100) : 0;
      const dispatchStatus = achievementStatus(dispatchAchievement, dispatchTarget > 0);

      const breakageProduced = productionActual;
      const breakageBroken = total(sumFor(monthlyBreakage, plant.id, false));
      const breakageRate =
        breakageProduced > 0 ? Number(((breakageBroken / breakageProduced) * 100).toFixed(2)) : 0;
      const brkStatus = breakageStatus(breakageRate, breakageProduced);

      const overallStatus = worstStatus([productionStatus, dispatchStatus, brkStatus]);

      return {
        plantName: plant.name,
        productionTarget,
        productionActual,
        productionAchievement,
        productionStatus,
        dispatchTarget,
        dispatchActual,
        dispatchAchievement,
        dispatchStatus,
        breakageProduced,
        breakageBroken,
        breakageRate,
        breakageStatus: brkStatus,
        overallStatus,
      };
    });

    const redRows = weeklyPerformance.filter((r) => r.status === "red");
    await autoCreateRedVarianceTasks(redRows, taskData, productionOwner);

    setSummaries(result);
    setWeeklyRows(weeklyPerformance);
    setMonthlyRows(monthlyOperations);
    setLoading(false);
  }

  useEffect(() => {
    loadExecutiveData(selectedDate);

    const channel = supabase
      .channel("executive-dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "production_entries" }, () => loadExecutiveData(selectedDate))
      .on("postgres_changes", { event: "*", schema: "public", table: "dispatch_entries" }, () => loadExecutiveData(selectedDate))
      .on("postgres_changes", { event: "*", schema: "public", table: "breakage_entries" }, () => loadExecutiveData(selectedDate))
      .on("postgres_changes", { event: "*", schema: "public", table: "scrap_processed_entries" }, () => loadExecutiveData(selectedDate))
      .on("postgres_changes", { event: "*", schema: "public", table: "machine_issues" }, () => loadExecutiveData(selectedDate))
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => loadExecutiveData(selectedDate))
      .on("postgres_changes", { event: "*", schema: "public", table: "weekly_production_targets" }, () => loadExecutiveData(selectedDate))
      .on("postgres_changes", { event: "*", schema: "public", table: "monthly_production_targets" }, () => loadExecutiveData(selectedDate))
      .on("postgres_changes", { event: "*", schema: "public", table: "monthly_dispatch_targets" }, () => loadExecutiveData(selectedDate))
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedDate]);

  function targetTotalSafe(t?: WeeklyTarget) {
    if (!t) return 0;
    return (t.target_31 || 0) + (t.target_36 || 0) + (t.target_45 || 0) + (t.target_meter || 0);
  }

  const produced = summaries.reduce((sum, s) => sum + total(s.producedOnDate), 0);
  const dispatched = summaries.reduce((sum, s) => sum + total(s.dispatchedOnDate), 0);
  const broken = summaries.reduce((sum, s) => sum + total(s.brokenOnDate), 0);
  const closingGoodStock = summaries.reduce((sum, s) => sum + total(s.closingGoodStock), 0);
  const closingBrokenStock = summaries.reduce((sum, s) => sum + total(s.closingBrokenStock), 0);

  const missingPlants = summaries.filter((s) => !s.enteredOnDate);
  const plantsWithBreakage = summaries.filter((s) => total(s.brokenOnDate) > 0);
  const downMachines = machineIssues.filter((i) => i.issue_status === "Down");
  const partialMachines = machineIssues.filter((i) => i.issue_status === "Partially Working");

  const overdueTasks = tasks.filter((t) => isOverdue(t));
  const waitingReplies = tasks.filter((t) => t.status === "Waiting Reply");
  const openExceptions = tasks.filter(
  (t) =>
    t.explanation_required === true &&
    (t.status === "Waiting Reply" || t.status === "Submitted")
);
const awaitingReplyExceptions = tasks.filter(
  (t) =>
    t.explanation_required === true &&
    t.status === "Waiting Reply"
);
const awaitingReviewExceptions = tasks.filter(
  (t) =>
    t.explanation_required === true &&
    t.status === "Submitted"
);
const closedExceptions = tasks.filter(
  (t) =>
    t.explanation_required === true &&
    t.status === "Closed"
);
  const dueThisWeekTasks = tasks.filter((t) => isDueThisWeek(t));
  const completedThisMonth = tasks.filter(
    (t) =>
      t.status === "Completed" &&
      ((t.updated_at && t.updated_at.slice(0, 10) >= currentMonthStart) ||
        (!t.updated_at && t.created_at && t.created_at.slice(0, 10) >= currentMonthStart))
  );

  const weeklyRed = weeklyRows.filter((r) => r.status === "red");
  const weeklyAmber = weeklyRows.filter((r) => r.status === "amber");

  const companyProductionTarget = monthlyRows.reduce((sum, r) => sum + r.productionTarget, 0);
  const companyProductionActual = monthlyRows.reduce((sum, r) => sum + r.productionActual, 0);
  const companyProductionAchievement =
    companyProductionTarget > 0 ? Math.round((companyProductionActual / companyProductionTarget) * 100) : 0;

  const companyDispatchTarget = monthlyRows.reduce((sum, r) => sum + r.dispatchTarget, 0);
  const companyDispatchActual = monthlyRows.reduce((sum, r) => sum + r.dispatchActual, 0);
  const companyDispatchAchievement =
    companyDispatchTarget > 0 ? Math.round((companyDispatchActual / companyDispatchTarget) * 100) : 0;

  const companyBroken = monthlyRows.reduce((sum, r) => sum + r.breakageBroken, 0);
  const companyProducedForBreakage = monthlyRows.reduce((sum, r) => sum + r.breakageProduced, 0);
  const companyBreakageRate =
    companyProducedForBreakage > 0
      ? Number(((companyBroken / companyProducedForBreakage) * 100).toFixed(2))
      : 0;

  const departmentRows = buildPerformanceRows(tasks, "department");
  const peopleRows = buildPerformanceRows(tasks, "person");

  const selectedWeekStart = getMondayFromDate(selectedDate);
  const selectedWeekEnd = addDays(selectedWeekStart, 6);
  const selectedMonth = getMonthFromDate(selectedDate);

  return (
    <AuthWrapper>
      <main style={{ padding: "40px", fontFamily: "sans-serif" }}>
        <h1 style={{ fontSize: "36px", fontWeight: "bold", marginBottom: "8px" }}>
          Good Morning Khuram
        </h1>

        <p style={{ color: "#666", marginBottom: "20px" }}>
          Executive dashboard shows monthly operations KPIs. Weekly performance remains available for operations tracking.
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
            style={{
              padding: "10px",
              border: "1px solid #ccc",
              borderRadius: "6px",
              fontSize: "15px",
            }}
          />
          <div style={{ marginTop: "8px", color: "#666", fontSize: "14px" }}>
            Selected month: <strong>{selectedMonth}</strong> | Selected week:{" "}
            <strong>{formatDateUK(selectedWeekStart)}</strong> to{" "}
            <strong>{formatDateUK(selectedWeekEnd)}</strong>
          </div>
        </div>

        {loading ? (
          <p>Loading executive dashboard…</p>
        ) : (
          <>
            <SectionTitle title="Monthly Operations KPI Scorecard" />

            <div style={gridStyle}>
              <Card
                title="Monthly Production"
                value={companyProductionAchievement}
                suffix="%"
                color={statusColor(achievementStatus(companyProductionAchievement, companyProductionTarget > 0))}
              />
              <Card
                title="Monthly Dispatch"
                value={companyDispatchAchievement}
                suffix="%"
                color={statusColor(achievementStatus(companyDispatchAchievement, companyDispatchTarget > 0))}
              />
              <Card
                title="Monthly Breakage"
                value={companyBreakageRate}
                suffix="%"
                color={statusColor(breakageStatus(companyBreakageRate, companyProducedForBreakage))}
              />
            </div>

            <OperationsKpiTable rows={monthlyRows} />
<SectionTitle title="Exception Management" />
<div style={gridStyle}>
  <Card title="Open Exceptions" value={openExceptions.length} color="#dc2626" />
  <Card title="Awaiting Reply" value={awaitingReplyExceptions.length} color="#dc2626" />
  <Card title="Awaiting Review" value={awaitingReviewExceptions.length} color="#d97706" />
  <Card title="Closed Exceptions" value={closedExceptions.length} color="#16a34a" />
</div>
            <SectionTitle title="Executive Attention" />

            <div style={gridStyle}>
              <Card title="Overdue Tasks" value={overdueTasks.length} color="#dc2626" />
              <Card title="Waiting Replies" value={waitingReplies.length} color="#dc2626" />
              <Card title="Machines Down" value={downMachines.length} color="#dc2626" />
              <Card title="Plants Missing Updates" value={missingPlants.length} color="#ef4444" />
              <Card title="Weekly Production Red" value={weeklyRed.length} color="#dc2626" />
              <Card title="Weekly Production Amber" value={weeklyAmber.length} color="#d97706" />
              <Card title="Tasks Due This Week" value={dueThisWeekTasks.length} color="#d97706" />
              <Card title="Completed This Month" value={completedThisMonth.length} color="#16a34a" />
            </div>

            <SectionTitle title="Weekly Production Target vs Actual" />
            <WeeklyProductionTable rows={weeklyRows} />

            <SectionTitle title="Operations Daily Snapshot" />

            <div style={gridStyle}>
              <Card title="Produced Today" value={produced} color="#16a34a" />
              <Card title="Broken Today" value={broken} color="#dc2626" />
              <Card title="Dispatched Today" value={dispatched} color="#7c3aed" />
              <Card title="Machine Issues" value={machineIssues.length} color="#b91c1c" />
              <Card title="Closing Good Stock" value={closingGoodStock} color="#0070f3" />
              <Card title="Closing Broken Stock" value={closingBrokenStock} color="#d97706" />
            </div>

            <SectionTitle title="Alerts" />

            <div style={{ display: "grid", gap: "14px", marginBottom: "32px" }}>
              {weeklyRed.length > 0 && (
                <AlertBox
                  type="bad"
                  title={`${weeklyRed.length} plant(s) below 85% weekly production target`}
                  text={weeklyRed
                    .map((r) => `${r.plantName}: ${r.achievement}% achieved — task auto-created if not already existing`)
                    .join(" | ")}
                />
              )}

              {weeklyAmber.length > 0 && (
                <AlertBox
                  type="warning"
                  title={`${weeklyAmber.length} plant(s) between 85% and 95% weekly production target`}
                  text={weeklyAmber.map((r) => `${r.plantName}: ${r.achievement}% achieved`).join(" | ")}
                />
              )}

              {overdueTasks.length > 0 && (
                <AlertBox
                  type="bad"
                  title={`${overdueTasks.length} overdue task(s)`}
                  text={overdueTasks
                    .slice(0, 5)
                    .map((t) => `${t.assigned_to || "Unassigned"}: ${t.description}`)
                    .join(" | ")}
                />
              )}

              {waitingReplies.length > 0 && (
                <AlertBox
                  type="bad"
                  title={`${waitingReplies.length} waiting repl${waitingReplies.length === 1 ? "y" : "ies"}`}
                  text={waitingReplies
                    .slice(0, 5)
                    .map((t) => `${t.assigned_to || "Unassigned"}: ${t.description}`)
                    .join(" | ")}
                />
              )}

              {missingPlants.length > 0 && (
                <AlertBox
                  type="bad"
                  title={`${missingPlants.length} plant(s) did not update`}
                  text={missingPlants.map((s) => s.plant.name).join(", ")}
                />
              )}

              {downMachines.length > 0 && (
                <AlertBox
                  type="bad"
                  title={`${downMachines.length} machine(s) down`}
                  text={downMachines.map((i) => `${i.plant_name} - ${i.machine_name}`).join(" | ")}
                />
              )}

              {partialMachines.length > 0 && (
                <AlertBox
                  type="warning"
                  title={`${partialMachines.length} machine(s) partially working`}
                  text={partialMachines.map((i) => `${i.plant_name} - ${i.machine_name}`).join(" | ")}
                />
              )}

              {plantsWithBreakage.length > 0 && (
                <AlertBox
                  type="warning"
                  title={`${plantsWithBreakage.length} plant(s) reported breakage today`}
                  text={plantsWithBreakage.map((s) => `${s.plant.name}: ${total(s.brokenOnDate)}`).join(" | ")}
                />
              )}
            </div>

            <SectionTitle title="Department Performance" />
            <PerformanceTable rows={departmentRows} />

            <SectionTitle title="People Performance" />
            <PerformanceTable rows={peopleRows} />

            {waitingReplies.length > 0 && (
              <>
                <SectionTitle title="Waiting Replies" />
                <TaskList tasks={waitingReplies} />
              </>
            )}

            {overdueTasks.length > 0 && (
              <>
                <SectionTitle title="Overdue Tasks" />
                <TaskList tasks={overdueTasks} />
              </>
            )}

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

function Card({
  title,
  value,
  color,
  suffix = "",
}: {
  title: string;
  value: number;
  color: string;
  suffix?: string;
}) {
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

function AlertBox({
  type,
  title,
  text,
}: {
  type: "good" | "bad" | "warning";
  title: string;
  text: string;
}) {
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

function OperationsKpiTable({ rows }: { rows: MonthlyOperationsRow[] }) {
  if (rows.length === 0) return <p style={{ color: "#666" }}>No monthly operations data yet.</p>;

  return (
    <div style={{ overflowX: "auto", marginBottom: "32px" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "980px" }}>
        <thead>
          <tr style={{ backgroundColor: "#fafafa" }}>
            <th style={tableHeaderStyle}>Plant</th>
            <th style={tableHeaderStyle}>Production</th>
            <th style={tableHeaderStyle}>Dispatch</th>
            <th style={tableHeaderStyle}>Breakage</th>
            <th style={tableHeaderStyle}>Overall</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.plantName}>
              <td style={tableCellStyle}>
                <strong>{r.plantName}</strong>
              </td>
              <KpiCell
                target={r.productionTarget}
                actual={r.productionActual}
                result={`${r.productionAchievement}%`}
                status={r.productionStatus}
              />
              <KpiCell
                target={r.dispatchTarget}
                actual={r.dispatchActual}
                result={`${r.dispatchAchievement}%`}
                status={r.dispatchStatus}
              />
              <KpiCell
                targetText="< 1%"
                actual={r.breakageBroken}
                result={`${r.breakageRate}%`}
                status={r.breakageStatus}
                extraText={`Produced: ${r.breakageProduced}`}
              />
              <td style={{ ...tableCellStyle, color: statusColor(r.overallStatus), fontWeight: "bold" }}>
                {statusLabel(r.overallStatus)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KpiCell({
  target,
  targetText,
  actual,
  result,
  status,
  extraText,
}: {
  target?: number;
  targetText?: string;
  actual: number;
  result: string;
  status: Status;
  extraText?: string;
}) {
  return (
    <td style={{ ...tableCellStyle, color: statusColor(status), fontWeight: "bold" }}>
      <div>Target: {targetText || target?.toLocaleString() || "0"}</div>
      <div>Actual: {actual.toLocaleString()}</div>
      <div>Result: {result}</div>
      {extraText && <div style={{ fontWeight: "normal", color: "#666" }}>{extraText}</div>}
      <div>{statusLabel(status)}</div>
    </td>
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
              <td style={tableCellStyle}>
                <strong>{r.name}</strong>
              </td>
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

function WeeklyProductionTable({ rows }: { rows: WeeklyProductionRow[] }) {
  if (rows.length === 0) return <p style={{ color: "#666" }}>No weekly production data yet.</p>;

  return (
    <div style={{ overflowX: "auto", marginBottom: "32px" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "700px" }}>
        <thead>
          <tr style={{ backgroundColor: "#fafafa" }}>
            <th style={tableHeaderStyle}>Plant</th>
            <th style={tableHeaderStyle}>Target</th>
            <th style={tableHeaderStyle}>Actual</th>
            <th style={tableHeaderStyle}>Variance</th>
            <th style={tableHeaderStyle}>Achievement</th>
            <th style={tableHeaderStyle}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const color = statusColor(r.status);

            return (
              <tr key={r.plantName}>
                <td style={tableCellStyle}>
                  <strong>{r.plantName}</strong>
                </td>
                <td style={tableCellStyle}>{r.target.toLocaleString()}</td>
                <td style={tableCellStyle}>{r.actual.toLocaleString()}</td>
                <td style={{ ...tableCellStyle, color: r.variance < 0 ? "#dc2626" : "#16a34a", fontWeight: "bold" }}>
                  {r.variance.toLocaleString()}
                </td>
                <td style={{ ...tableCellStyle, color, fontWeight: "bold" }}>
                  {r.target > 0 ? `${r.achievement}%` : "No target"}
                </td>
                <td style={{ ...tableCellStyle, color, fontWeight: "bold" }}>
                  {statusLabel(r.status)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TaskList({ tasks }: { tasks: Task[] }) {
  return (
    <div style={{ display: "grid", gap: "12px", marginBottom: "32px" }}>
      {tasks.slice(0, 8).map((task) => (
        <div
          key={task.id}
          style={{
            border: "1px solid #e0e0e0",
            borderRadius: "10px",
            padding: "14px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
            <div>
              <strong>{task.description}</strong>
              <div style={{ color: "#666", fontSize: "13px", marginTop: "4px" }}>
                Assigned to: {task.assigned_to || "—"} | Department:{" "}
                {task.assigned_to_department || "—"} | Due: {task.due_date || "—"}
              </div>
            </div>

            <span
              style={{
                fontSize: "12px",
                fontWeight: "bold",
                padding: "4px 10px",
                borderRadius: "12px",
                color: "white",
                height: "fit-content",
                backgroundColor: isOverdue(task) ? "#dc2626" : "#d97706",
              }}
            >
              {task.status}
            </span>
          </div>
        </div>
      ))}
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