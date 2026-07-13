"use client";

import React, { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { downloadCSV } from "../lib/exportUtils";
import ImportExportButtons from "../lib/ImportExportButtons";
import { COLOURS, RADII, cardStyle, StatusBadge, PriorityBadge, WARNING_BANNER_STYLE, WARNING_BANNER_INNER, WARNING_TITLE_COLOR, useToast, ErrorBanner, SkeletonRows } from "../lib/SharedUI";
import TeamStats from "./TeamStats";
import TaskDetailPanel from "./TaskDetailPanel";
import TasksBoard from "./TasksBoard";
import RecurringTasksPanel from "./RecurringTasksPanel";

type Task = {
  id: string;
  task_type: string | null;
  description: string;
  project: string | null;
  priority: string | null;
  due_date: string | null;
  original_due_date: string | null;
  assigned_date: string | null;
  assigned_to: string | null;
  assigned_to_email: string | null;
  assigned_by: string | null;
  assigned_by_email: string | null;
  status: string;
  stage: string | null;
  stuck_reason: string | null;
  notes: string | null;
  reply_required: boolean | null;
  reply_text: string | null;
  reply_by: string | null;
  reply_at: string | null;
  corrective_action: string | null;
  recovery_date: string | null;
  impact_on_monthly_target: string | null;
  meeting_id: string | null;
  time_spent_minutes: number | null;
  created_at: string | null;
  completed_at: string | null;
  assigned_to_department: string | null;
  company_id: string | null;
  task_subtasks?: { id: string; is_complete: boolean }[];
};

type CompanyLite = { id: string; name: string; short_code: string | null };

const COMPANY_BADGE_COLOURS: Record<string, { color: string; background: string }> = {
  UTPL: { color: COLOURS.BLUE, background: COLOURS.INFO_SOFT },
  IFPL: { color: COLOURS.GREEN, background: COLOURS.SUCCESS_SOFT },
  BRNH: { color: COLOURS.AMBER, background: COLOURS.WARNING_SOFT },
  HD:   { color: "#6E45B8", background: "#F3EEF9" },
};

type KpiSummary = {
  open_count: number;
  overdue_count: number;
  due_today_count: number;
  waiting_reply_count: number;
  stuck_count: number;
  completed_count: number;
};

type MonthlyChartRow = { month: string; label: string; created: number; completed: number };
type QuarterlyChartRow = { quarter: string; overdue: number; active: number; completed: number };

const todayStr = new Date().toISOString().slice(0, 10);

function isOverdue(task: Task) {
  if (task.status === "Completed" || task.status === "Cancelled") return false;
  if (!task.due_date) return false;
  return task.due_date < todayStr;
}

function daysOverdue(task: Task): number {
  if (!task.due_date || !isOverdue(task)) return 0;
  return Math.floor((Date.now() - new Date(task.due_date + "T00:00:00").getTime()) / 86400000);
}

function getWeekStart(d: Date): string {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  return monday.toISOString().slice(0, 10);
}

// getMonthLabel/getQuarterLabel removed — labels now come straight from
// get_tasks_monthly_chart()/get_tasks_quarterly_chart() (migration 102).

export default function TasksList({ currentRole, canSeeAll, canReview, canDelete, canImport }: { currentRole: string; canSeeAll?: boolean; canReview?: boolean; canDelete?: boolean; canImport?: boolean }) {
  const searchParams = useSearchParams();
  const taskIdFromUrl = searchParams.get("task");
  const toast = useToast();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(taskIdFromUrl);
  const [timeView, setTimeView] = useState<"department" | "weekly" | "monthly" | "quarterly" | "timeline" | "team" | "board" | "recurring">("department");
  const [filter, setFilter] = useState<"all" | "overdue" | "waiting">("all");
  const [bannerOpen, setBannerOpen] = useState(false);
  const [memberPhones, setMemberPhones] = useState<Record<string, string>>({});
  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set());
  const [companies, setCompanies] = useState<CompanyLite[]>([]);
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [kpi, setKpi] = useState<KpiSummary | null>(null);
  const [monthlyData, setMonthlyData] = useState<MonthlyChartRow[]>([]);
  const [quarterlyData, setQuarterlyData] = useState<QuarterlyChartRow[]>([]);

  const isPrivileged = canSeeAll ?? (currentRole === "Admin" || currentRole === "Executive");

  async function loadTasks() {
    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email || null;
    setMyEmail(email);

    let query = supabase
      .from("tasks")
      .select("*, task_subtasks(id, is_complete)")
      .order("created_at", { ascending: false });

    if (!isPrivileged && email) {
      query = query.or(`assigned_to_email.eq.${email},assigned_by_email.eq.${email}`);
    }

    const { data, error } = await query;

    if (error) setErrorMsg(error.message);
    else setTasks(data || []);
    setLoading(false);
  }

  async function loadKpi() {
    const params = companyFilter === "all"
      ? {}
      : companyFilter === "group"
      ? { p_group_only: true }
      : { p_company_id: companyFilter };
    const { data, error } = await supabase.rpc("get_tasks_kpi_summary", params).single();
    if (!error && data) setKpi(data as KpiSummary);
  }

  function resetFilters() {
    setCompanyFilter("all");
    setFilter("all");
  }

  useEffect(() => {
    loadTasks();
    supabase.from("members").select("name, phone_e164").then(({ data }) => {
      const phones: Record<string, string> = {};
      for (const m of (data || [])) { if (m.name && m.phone_e164) phones[m.name] = m.phone_e164; }
      setMemberPhones(phones);
    });
    supabase.from("companies").select("id, name, short_code").then(({ data }) => setCompanies(data || []));
  }, []);

  async function loadCharts() {
    const params = companyFilter === "all"
      ? {}
      : companyFilter === "group"
      ? { p_group_only: true }
      : { p_company_id: companyFilter };
    const [monthlyRes, quarterlyRes] = await Promise.all([
      supabase.rpc("get_tasks_monthly_chart", params),
      supabase.rpc("get_tasks_quarterly_chart", params),
    ]);
    if (!monthlyRes.error) setMonthlyData(monthlyRes.data || []);
    if (!quarterlyRes.error) setQuarterlyData(quarterlyRes.data || []);
  }

  // Re-run the KPI + chart RPCs whenever the Company filter changes, so
  // everything on screen always matches what the Company dropdown shows.
  useEffect(() => {
    loadKpi();
    loadCharts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyFilter]);

  useEffect(() => {
    if (taskIdFromUrl && tasks.length > 0) {
      const task = tasks.find((t) => t.id === taskIdFromUrl);
      if (task) {
        setExpandedTaskId(taskIdFromUrl);
        setTimeout(() => {
          document.getElementById(`task-${taskIdFromUrl}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
      }
    }
  }, [taskIdFromUrl, tasks]);

  if (loading) return <SkeletonRows count={5} height="48px" />;
  if (errorMsg) return <ErrorBanner message={errorMsg} onRetry={loadTasks} />;

  const scopedTasks = companyFilter === "all" ? tasks : tasks.filter((t) => (companyFilter === "group" ? !t.company_id : t.company_id === companyFilter));

  function refreshAll() {
    loadTasks();
    loadKpi();
  }

  function companyBadge(companyId: string | null) {
    if (!companyId) return { label: "Group", color: COLOURS.SLATE, background: COLOURS.HAIRLINE };
    const c = companies.find((co) => co.id === companyId);
    const code = c?.short_code || "";
    const found = COMPANY_BADGE_COLOURS[code] || { color: COLOURS.NAVY, background: COLOURS.HAIRLINE };
    return { label: c?.short_code || c?.name || "—", color: found.color, background: found.background };
  }

  const allOpen = scopedTasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled");
  const overdueTasks = allOpen.filter(isOverdue);
  const waitingReply = allOpen.filter((t) => t.status === "Waiting Reply");
  const completedAll = scopedTasks.filter((t) => t.status === "Completed");

  // ── Weekly grouping ──
  const nextWeekDate = new Date();
  nextWeekDate.setDate(nextWeekDate.getDate() + 7);
  const nextWeekStart = getWeekStart(nextWeekDate);

  function weekGroup(task: Task): string {
    if (!task.due_date) return "No Due Date";
    if (task.due_date < todayStr) return "Overdue";
    if (task.due_date < nextWeekStart) return "This Week";
    const twoWeeks = new Date();
    twoWeeks.setDate(twoWeeks.getDate() + 14);
    if (task.due_date < getWeekStart(twoWeeks)) return "Next Week";
    return "Later";
  }

  const weekGroups = new Map<string, Task[]>();
  const weekOrder = ["Overdue", "This Week", "Next Week", "Later", "No Due Date"];
  for (const t of allOpen) {
    const g = weekGroup(t);
    if (!weekGroups.has(g)) weekGroups.set(g, []);
    weekGroups.get(g)!.push(t);
  }

  // Monthly and Quarterly chart data are no longer computed here — they
  // come from get_tasks_monthly_chart()/get_tasks_quarterly_chart() (see
  // migration 102) via the monthlyData/quarterlyData state above, kept in
  // sync with the Company filter by the loadCharts() effect. Per house
  // rule 0, aggregation belongs in the database, not in a JS loop here.

  // ── Person grouping ──
  const personMap = new Map<string, { total: number; overdue: number }>();
  for (const t of allOpen) {
    const p = t.assigned_to || "Unassigned";
    if (!personMap.has(p)) personMap.set(p, { total: 0, overdue: 0 });
    personMap.get(p)!.total++;
    if (isOverdue(t)) personMap.get(p)!.overdue++;
  }
  const people = Array.from(personMap.entries())
    .map(([name, d]) => ({ name, ...d }))
    .sort((a, b) => b.overdue - a.overdue || b.total - a.total);
  void people; // used indirectly via personMap

  // ── Department grouping ──
  type DeptStats = { dept: string; tasks: Task[]; open: number; overdue: number; waiting: number; stuck: number; completed: number };
  const deptMap = new Map<string, DeptStats>();
  for (const t of scopedTasks) {
    const dept = t.assigned_to_department || t.project || "Unassigned";
    if (!deptMap.has(dept)) deptMap.set(dept, { dept, tasks: [], open: 0, overdue: 0, waiting: 0, stuck: 0, completed: 0 });
    const d = deptMap.get(dept)!;
    d.tasks.push(t);
    if (t.status === "Completed" || t.status === "Cancelled") { if (t.status === "Completed") d.completed++; }
    else {
      d.open++;
      if (isOverdue(t)) d.overdue++;
      if (t.status === "Waiting Reply") d.waiting++;
      if (t.stuck_reason || t.status === "Stuck") d.stuck++;
    }
  }
  const departments = Array.from(deptMap.values()).sort((a, b) => b.overdue - a.overdue || b.open - a.open);

  function toggleDept(dept: string) {
    setCollapsedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept); else next.add(dept);
      return next;
    });
  }

  // ── Filtered task list ──
  let filteredTasks = allOpen;
  if (filter === "overdue") filteredTasks = overdueTasks;
  else if (filter === "waiting") filteredTasks = waitingReply;

  const weekGroupColor = (g: string) =>
    g === "Overdue" ? COLOURS.RED : g === "This Week" ? COLOURS.AMBER : g === "Next Week" ? COLOURS.BLUE : COLOURS.SLATE;

  function TaskRow({ task }: { task: Task }) {
    const isOpen = expandedTaskId === task.id;
    const od = daysOverdue(task);
    const overdue = isOverdue(task);

    return (
      <div id={`task-${task.id}`} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
        <div
          onClick={() => setExpandedTaskId(isOpen ? null : task.id)}
          style={{
            padding: "10px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between",
            alignItems: "center", gap: "8px",
            backgroundColor: overdue ? COLOURS.DANGER_SOFT : isOpen ? COLOURS.CARD_ALT : COLOURS.CARD,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.description}</div>
            <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "3px", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
              <span>{task.assigned_to || "Unassigned"}</span>
              {(() => {
                const badge = companyBadge(task.company_id);
                return (
                  <span style={{ fontSize: "11px", fontWeight: 700, padding: "1px 8px", borderRadius: RADII.PILL, color: badge.color, backgroundColor: badge.background }}>
                    {badge.label}
                  </span>
                );
              })()}
              {task.assigned_to_department && timeView !== "department" && (
                <span style={{ fontSize: "11px", fontWeight: 600, padding: "1px 6px", borderRadius: RADII.XS, color: COLOURS.NAVY, backgroundColor: COLOURS.HAIRLINE }}>
                  {task.assigned_to_department}
                </span>
              )}
              {task.stage && (
                <span style={{ fontSize: "10.5px", fontWeight: 600, padding: "1px 7px", borderRadius: RADII.XS, color: COLOURS.SLATE, border: `1px solid ${COLOURS.HAIRLINE}` }}>
                  → {task.stage}
                </span>
              )}
              {task.task_subtasks && task.task_subtasks.length > 0 && (
                <span style={{ fontSize: "10.5px", fontWeight: 700, padding: "1px 7px", borderRadius: RADII.XS, color: COLOURS.SLATE, backgroundColor: COLOURS.TRACK }}>
                  {task.task_subtasks.filter((s) => s.is_complete).length}/{task.task_subtasks.length}
                </span>
              )}
              {task.due_date && (
                <span style={{ fontFamily: "var(--font-mono,'JetBrains Mono',monospace)", color: overdue ? COLOURS.RED : COLOURS.SLATE, fontWeight: overdue ? 600 : 400 }}>
                  {formatDateUK(task.due_date)}{od > 0 && ` · ${od}d late`}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: "5px", alignItems: "center", flexShrink: 0 }}>
            {task.priority && <PriorityBadge priority={task.priority} />}
            <StatusBadge status={task.status} />
            <span style={{ color: COLOURS.SLATE, fontSize: "13px" }}>{isOpen ? "▼" : "▶"}</span>
          </div>
        </div>

        {isOpen && (
          <TaskDetailPanel
            task={task}
            currentRole={currentRole}
            isPrivileged={isPrivileged}
            canReview={canReview}
            canDelete={canDelete}
            myEmail={myEmail}
            memberPhones={memberPhones}
            onChanged={refreshAll}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      {toast.element}

      {/* ═══ OVERDUE BANNER ═══ */}
      {overdueTasks.length > 0 && (
        <div style={WARNING_BANNER_STYLE}>
          <div onClick={() => setBannerOpen(!bannerOpen)} style={{ padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>⚠</span>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 700, color: WARNING_TITLE_COLOR }}>
                  {overdueTasks.length} overdue task{overdueTasks.length > 1 ? "s" : ""} need attention
                </div>
                <div style={{ fontSize: "12px", color: WARNING_TITLE_COLOR, marginTop: "1px" }}>
                  {overdueTasks.slice(0, 3).map((t) => `${t.assigned_to || "Unassigned"}: ${t.description.slice(0, 30)}${t.description.length > 30 ? "…" : ""}`).join(" · ")}
                  {overdueTasks.length > 3 && ` · +${overdueTasks.length - 3} more`}
                </div>
              </div>
            </div>
            <span style={{ fontSize: "13px", fontWeight: 700, color: WARNING_TITLE_COLOR }}>{bannerOpen ? "▲" : "▼"}</span>
          </div>
          {bannerOpen && (
            <div style={WARNING_BANNER_INNER}>
              {overdueTasks.sort((a, b) => daysOverdue(b) - daysOverdue(a)).map((t) => (
                <div
                  key={t.id}
                  onClick={() => { setExpandedTaskId(t.id); setBannerOpen(false); setTimeout(() => document.getElementById(`task-${t.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 100); }}
                  style={{ padding: "8px 16px 8px 48px", borderBottom: `1px solid ${COLOURS.TRACK}`, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>{t.description}</div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>{t.assigned_to || "Unassigned"}</div>
                  </div>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.RED, flexShrink: 0 }}>{daysOverdue(t)}d late</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ KPI SUMMARY ROW — sourced from get_tasks_kpi_summary() RPC, not client-side counting ═══ */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "8px", flex: 1 }}>
          {[
            { label: "Open",          value: kpi?.open_count ?? allOpen.length,          accent: COLOURS.BLUE },
            { label: "Overdue",       value: kpi?.overdue_count ?? overdueTasks.length,   accent: COLOURS.RED },
            { label: "Due Today",     value: kpi?.due_today_count ?? 0,                   accent: COLOURS.AMBER },
            { label: "Waiting Reply", value: kpi?.waiting_reply_count ?? waitingReply.length, accent: COLOURS.BLUE },
            { label: "Stuck",         value: kpi?.stuck_count ?? 0,                        accent: COLOURS.SLATE },
            { label: "Completed",     value: kpi?.completed_count ?? completedAll.length,  accent: COLOURS.GREEN },
          ].map(({ label, value, accent }) => (
            <div key={label} style={{ ...cardStyle, padding: "10px 14px", borderLeft: `3px solid ${accent}` }}>
              <div style={{ fontSize: "10.5px", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: COLOURS.SLATE, marginBottom: "6px" }}>{label}</div>
              <div style={{ fontFamily: "var(--font-display,'Inter Tight',sans-serif)", fontSize: "22px", fontWeight: 600, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: COLOURS.NAVY }}>{value.toLocaleString()}</div>
            </div>
          ))}
        </div>
        {(canImport ?? isPrivileged) && (
          <ImportExportButtons
            onExport={() => {
              const headers = ["Description", "Assigned To", "Priority", "Due Date", "Status", "Project"];
              const rows = scopedTasks.map((t) => [t.description, t.assigned_to || "—", t.priority || "—", t.due_date || "—", t.status, t.project || "—"]);
              downloadCSV(`tasks-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
            }}
            onImport={async (rows) => {
              const errors: string[] = [];
              const validRows: Record<string, string>[] = [];
              rows.forEach((row, i) => {
                const line = i + 2;
                if (!row["Description"]?.trim()) { errors.push(`Row ${line}: Description is required`); return; }
                if (!row["Assigned To"]?.trim()) { errors.push(`Row ${line}: Assigned To is required`); return; }
                if (!row["Assigned By"]?.trim()) { errors.push(`Row ${line}: Assigned By is required`); return; }
                if (!row["Due Date"]?.trim()) { errors.push(`Row ${line}: Due Date is required`); return; }
                if (!row["Priority"]?.trim()) { errors.push(`Row ${line}: Priority is required`); return; }
                if (!row["Department / Area"]?.trim()) { errors.push(`Row ${line}: Department / Area is required`); return; }
                validRows.push(row);
              });
              if (errors.length > 0) {
                toast.show(`Import validation failed:\n${errors.slice(0, 10).join("\n")}${errors.length > 10 ? `\n...and ${errors.length - 10} more` : ""}`, "error");
                return;
              }
              const { data: allMembers } = await supabase.from("members").select("name, first_name, last_name, email, department, business_unit");
              const memberList = allMembers || [];
              let count = 0;
              for (const row of validRows) {
                const assignedName = row["Assigned To"].trim();
                const member = memberList.find((m) => {
                  const full = `${m.first_name || ""} ${m.last_name || ""}`.trim();
                  return full === assignedName || m.name === assignedName;
                });
                await supabase.from("tasks").insert({
                  description: row["Description"].trim(),
                  assigned_to: assignedName,
                  assigned_to_email: member?.email || null,
                  assigned_to_department: member?.department || row["Department / Area"].trim(),
                  assigned_to_business_unit: member?.business_unit || null,
                  priority: row["Priority"].trim(),
                  due_date: row["Due Date"].trim(),
                  status: row["Starting Status"]?.trim() || "Not Started",
                  project: row["Department / Area"].trim(),
                  notes: row["Notes"]?.trim() || null,
                  task_type: "Task",
                  assigned_by: row["Assigned By"].trim(),
                  assigned_by_email: myEmail,
                  assigned_date: row["Assigned Date"]?.trim() || new Date().toISOString().slice(0, 10),
                });
                count++;
              }
              toast.show(`Successfully imported ${count} task${count !== 1 ? "s" : ""}.`, "success");
              refreshAll();
            }}
            templateHeaders={["Description", "Assigned To", "Assigned By", "Assigned Date", "Due Date", "Priority", "Department / Area", "Starting Status", "Notes"]}
            templateFilename="tasks-import-template.csv"
            exportLabel="Export all tasks as CSV"
            importLabel="Import tasks from CSV"
          />
        )}
      </div>

      {/* ═══ VIEW TOGGLE + FILTER PILLS ═══ */}
      <div style={{
        display: "flex", gap: "4px", marginBottom: "12px", flexWrap: "wrap",
        position: "sticky", top: 0, zIndex: 10,
        backgroundColor: COLOURS.CARD_ALT,
        paddingTop: "6px", paddingBottom: "6px",
      }}>
        {(["board", "department", "weekly", "monthly", "quarterly", "timeline", "team", "recurring"] as const).map((v) => (
          <button key={v} onClick={() => setTimeView(v)} style={{
            backgroundColor: timeView === v ? COLOURS.NAVY : COLOURS.CARD,
            color: timeView === v ? "white" : COLOURS.NAVY,
            border: `1px solid ${timeView === v ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
            borderRadius: RADII.PILL, padding: "6px 14px", fontSize: "13px", fontWeight: 600, cursor: "pointer",
            textTransform: "capitalize",
          }}>{v}</button>
        ))}
        <select
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value)}
          style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, padding: "6px 10px", fontSize: "12.5px", fontWeight: 600, color: COLOURS.NAVY, backgroundColor: COLOURS.CARD }}
        >
          <option value="all">All companies</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.short_code || c.name}</option>)}
          <option value="group">Group / needs review</option>
        </select>
        {(companyFilter !== "all" || filter !== "all") && (
          <button onClick={resetFilters} style={{ background: "none", border: "none", color: COLOURS.RED, fontSize: "12.5px", fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>
            Reset Filters
          </button>
        )}
        <div style={{ flex: 1 }} />
        {(["all", "overdue", "waiting"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{
            backgroundColor: filter === f ? COLOURS.NAVY : COLOURS.CARD,
            color: filter === f ? "white" : COLOURS.NAVY,
            border: `1px solid ${filter === f ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
            borderRadius: RADII.PILL, padding: "6px 12px", fontSize: "13px", fontWeight: 600, cursor: "pointer",
          }}>
            {f === "all" ? "All" : f === "overdue" ? `Overdue (${overdueTasks.length})` : `Waiting (${waitingReply.length})`}
          </button>
        ))}
      </div>

      {/* ═══ DEPARTMENT VIEW ═══ */}
      {timeView === "department" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "14px" }}>
          {departments.length === 0 ? (
            <div style={{ ...cardStyle, padding: "24px", textAlign: "center", color: COLOURS.SLATE }}>No tasks to show.</div>
          ) : departments.map((d) => {
            const isCollapsed = collapsedDepts.has(d.dept);
            const deptFiltered = filter === "overdue" ? d.tasks.filter(isOverdue) : filter === "waiting" ? d.tasks.filter((t) => t.status === "Waiting Reply") : d.tasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled");
            const hasIssues = d.overdue > 0 || d.stuck > 0;

            const personBreakdown = new Map<string, { name: string; total: number; overdue: number; waiting: number }>();
            for (const t of deptFiltered) {
              const p = t.assigned_to || "Unassigned";
              if (!personBreakdown.has(p)) personBreakdown.set(p, { name: p, total: 0, overdue: 0, waiting: 0 });
              const pb = personBreakdown.get(p)!;
              pb.total++;
              if (isOverdue(t)) pb.overdue++;
              if (t.status === "Waiting Reply") pb.waiting++;
            }
            const persons = Array.from(personBreakdown.values()).sort((a, b) => b.overdue - a.overdue || b.total - a.total);

            if (deptFiltered.length === 0 && filter !== "all") return null;

            return (
              <div key={d.dept} style={{
                border: `1px solid ${COLOURS.HAIRLINE}`,
                borderLeft: `4px solid ${hasIssues ? COLOURS.RED : COLOURS.GREEN}`,
                borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD, overflow: "hidden",
              }}>
                {/* Department header */}
                <div
                  onClick={() => toggleDept(d.dept)}
                  style={{
                    padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center",
                    backgroundColor: hasIssues ? COLOURS.DANGER_SOFT : COLOURS.CARD_ALT,
                  }}
                >
                  <div>
                    <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>{d.dept}</div>
                    <div style={{ display: "flex", gap: "12px", marginTop: "4px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "12px", color: COLOURS.BLUE, fontWeight: 600 }}>{d.open} open</span>
                      {d.overdue > 0 && <span style={{ fontSize: "12px", color: COLOURS.RED, fontWeight: 700 }}>{d.overdue} overdue</span>}
                      {d.waiting > 0 && <span style={{ fontSize: "12px", color: COLOURS.AMBER, fontWeight: 600 }}>{d.waiting} waiting</span>}
                      {d.stuck > 0 && <span style={{ fontSize: "12px", color: COLOURS.AMBER, fontWeight: 600 }}>{d.stuck} stuck</span>}
                      <span style={{ fontSize: "12px", color: COLOURS.GREEN, fontWeight: 600 }}>{d.completed} done</span>
                    </div>
                  </div>
                  <span style={{ color: COLOURS.SLATE, fontSize: "13px", flexShrink: 0 }}>{isCollapsed ? "▶" : "▼"}</span>
                </div>

                {/* Person breakdown bar */}
                {!isCollapsed && persons.length > 0 && (
                  <div style={{ padding: "8px 16px", backgroundColor: COLOURS.CARD_ALT, borderTop: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {persons.map((p) => (
                      <div key={p.name} style={{
                        padding: "3px 10px", borderRadius: RADII.PILL, fontSize: "12px", fontWeight: 600,
                        backgroundColor: p.overdue > 0 ? COLOURS.DANGER_SOFT : COLOURS.CARD,
                        border: `1px solid ${p.overdue > 0 ? COLOURS.RED : COLOURS.HAIRLINE}`,
                        color: p.overdue > 0 ? COLOURS.RED : COLOURS.NAVY,
                      }}>
                        {p.name.split(" ")[0]} — {p.total}{p.overdue > 0 && ` (${p.overdue} late)`}{p.waiting > 0 && ` (${p.waiting} wait)`}
                      </div>
                    ))}
                  </div>
                )}

                {/* Tasks list */}
                {!isCollapsed && (
                  <div style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>
                    {deptFiltered.length === 0 ? (
                      <div style={{ padding: "12px 16px", textAlign: "center", color: COLOURS.SLATE, fontSize: "13px" }}>No matching tasks.</div>
                    ) : (
                      deptFiltered.sort((a, b) => daysOverdue(b) - daysOverdue(a) || (a.due_date || "9").localeCompare(b.due_date || "9")).map((t) => <TaskRow key={t.id} task={t} />)
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ WEEKLY VIEW ═══ */}
      {timeView === "weekly" && (
        <div style={{ ...cardStyle, overflow: "hidden", marginBottom: "14px" }}>
          {weekOrder.filter((g) => weekGroups.has(g)).map((group) => {
            const groupTasks = (filter === "overdue" ? weekGroups.get(group)!.filter(isOverdue) : filter === "waiting" ? weekGroups.get(group)!.filter((t) => t.status === "Waiting Reply") : weekGroups.get(group)!);
            if (groupTasks.length === 0) return null;
            return (
              <div key={group}>
                <div style={{ padding: "8px 16px", backgroundColor: COLOURS.CARD_ALT, borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: weekGroupColor(group) }}>{group}</span>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE }}>{groupTasks.length} task{groupTasks.length > 1 ? "s" : ""}</span>
                </div>
                {groupTasks.map((t) => <TaskRow key={t.id} task={t} />)}
              </div>
            );
          })}
          {filteredTasks.length === 0 && (
            <div style={{ padding: "24px", textAlign: "center", color: COLOURS.SLATE }}>No tasks match this filter.</div>
          )}
        </div>
      )}

      {/* ═══ MONTHLY VIEW ═══ */}
      {timeView === "monthly" && (
        <>
          {monthlyData.length > 0 && (
            <div style={{ ...cardStyle, padding: "20px 24px", marginBottom: "14px" }}>
              <div style={{ fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "12px" }}>Tasks Created vs Completed — Last 6 Months</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.TRACK} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLOURS.SLATE }} />
                  <YAxis tick={{ fontSize: 11, fill: COLOURS.SLATE }} allowDecimals={false} />
                  <Tooltip />
                  <Legend iconType="square" wrapperStyle={{ fontSize: "12px" }} />
                  <Bar dataKey="created" fill={COLOURS.BLUE} name="Created" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="completed" fill={COLOURS.GREEN} name="Completed" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div style={{ ...cardStyle, overflow: "hidden", marginBottom: "14px" }}>
            {filteredTasks.length === 0 ? (
              <div style={{ padding: "24px", textAlign: "center", color: COLOURS.SLATE }}>No tasks match this filter.</div>
            ) : (
              filteredTasks.map((t) => <TaskRow key={t.id} task={t} />)
            )}
          </div>
        </>
      )}

      {/* ═══ QUARTERLY VIEW ═══ */}
      {timeView === "quarterly" && (
        <>
          {quarterlyData.length > 0 && (
            <div style={{ ...cardStyle, padding: "20px 24px", marginBottom: "14px" }}>
              <div style={{ fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "12px" }}>Quarterly Overview</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={quarterlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.TRACK} />
                  <XAxis dataKey="quarter" tick={{ fontSize: 11, fill: COLOURS.SLATE }} />
                  <YAxis tick={{ fontSize: 11, fill: COLOURS.SLATE }} allowDecimals={false} />
                  <Tooltip />
                  <Legend iconType="square" wrapperStyle={{ fontSize: "12px" }} />
                  <Bar dataKey="overdue" stackId="a" fill={COLOURS.RED} name="Overdue" />
                  <Bar dataKey="active" stackId="a" fill={COLOURS.BLUE} name="Active" />
                  <Bar dataKey="completed" stackId="a" fill={COLOURS.GREEN} name="Completed" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Quarterly summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px", marginBottom: "14px" }}>
            {quarterlyData.map((q) => (
              <div key={q.quarter} style={{ ...cardStyle, padding: "16px 20px" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "8px" }}>{q.quarter}</div>
                <div style={{ display: "flex", gap: "10px", fontSize: "12px", flexWrap: "wrap" }}>
                  <span style={{ color: COLOURS.RED, fontWeight: 700 }}>{q.overdue} overdue</span>
                  <span style={{ color: COLOURS.BLUE, fontWeight: 600 }}>{q.active} active</span>
                  <span style={{ color: COLOURS.GREEN, fontWeight: 600 }}>{q.completed} done</span>
                </div>
              </div>
            ))}
          </div>

          <div style={{ ...cardStyle, overflow: "hidden", marginBottom: "14px" }}>
            {filteredTasks.length === 0 ? (
              <div style={{ padding: "24px", textAlign: "center", color: COLOURS.SLATE }}>No tasks match this filter.</div>
            ) : (
              filteredTasks.map((t) => <TaskRow key={t.id} task={t} />)
            )}
          </div>
        </>
      )}

      {/* ═══ TIMELINE VIEW ═══ */}
      {timeView === "timeline" && (() => {
        const tasksWithDates = filteredTasks.filter((t) => t.due_date);
        if (tasksWithDates.length === 0) return (
          <div style={{ ...cardStyle, padding: "24px", marginBottom: "14px", textAlign: "center", color: COLOURS.SLATE }}>
            No tasks with due dates to show on timeline.
          </div>
        );

        const sorted = [...tasksWithDates].sort((a, b) => a.due_date!.localeCompare(b.due_date!));
        const today = new Date();
        const minDate = new Date(Math.min(today.getTime(), new Date(sorted[0].due_date! + "T00:00:00").getTime()));
        minDate.setDate(minDate.getDate() - 2);
        const maxDate = new Date(sorted[sorted.length - 1].due_date! + "T00:00:00");
        maxDate.setDate(maxDate.getDate() + 5);
        const range = maxDate.getTime() - minDate.getTime();

        const toX = (dateStr: string) => {
          const d = new Date(dateStr + "T00:00:00").getTime();
          return 60 + ((d - minDate.getTime()) / range) * 680;
        };
        const todayX = 60 + ((today.getTime() - minDate.getTime()) / range) * 680;

        const ROW_H = 28;
        const svgH = Math.max(100, sorted.length * ROW_H + 50);

        const tickDates: string[] = [];
        const tickStep = Math.max(1, Math.round(range / 86400000 / 6));
        const cur = new Date(minDate);
        while (cur <= maxDate) {
          tickDates.push(cur.toISOString().slice(0, 10));
          cur.setDate(cur.getDate() + tickStep);
        }

        return (
          <div style={{ ...cardStyle, padding: "20px 24px", marginBottom: "14px", overflowX: "auto" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>Due Date Timeline — {sorted.length} tasks</div>
            <svg width="780" height={svgH} style={{ display: "block", minWidth: "780px" }}>
              <line x1="60" y1="20" x2="740" y2="20" stroke={COLOURS.HAIRLINE} strokeWidth="1" />
              {tickDates.map((d) => {
                const x = toX(d);
                return (
                  <g key={d}>
                    <line x1={x} y1="16" x2={x} y2={svgH - 10} stroke={COLOURS.TRACK} strokeWidth="1" />
                    <text x={x} y="12" textAnchor="middle" fontSize="11" fill={COLOURS.SLATE}>
                      {new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </text>
                  </g>
                );
              })}
              <line x1={todayX} y1="16" x2={todayX} y2={svgH - 10} stroke={COLOURS.RED} strokeWidth="1.5" strokeDasharray="4 3" />
              <text x={todayX} y={svgH - 2} textAnchor="middle" fontSize="10" fill={COLOURS.RED} fontWeight="700">Today</text>
              {sorted.map((t, i) => {
                const x = toX(t.due_date!);
                const y = 36 + i * ROW_H;
                const od = isOverdue(t);
                const color = od ? COLOURS.RED : t.status === "Waiting Reply" ? COLOURS.AMBER : t.priority === "High" || t.priority === "Urgent" ? COLOURS.AMBER : COLOURS.BLUE;
                const label = t.description.length > 32 ? t.description.slice(0, 30) + "…" : t.description;
                return (
                  <g key={t.id} style={{ cursor: "pointer" }} onClick={() => { setTimeView("weekly"); setExpandedTaskId(t.id); setTimeout(() => document.getElementById(`task-${t.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 100); }}>
                    <circle cx={x} cy={y} r="5" fill={color} />
                    <text x={x + 8} y={y + 4} fontSize="12" fill={COLOURS.NAVY} fontWeight="600">{label}</text>
                    <text x="4" y={y + 4} fontSize="11" fill={COLOURS.SLATE}>{t.assigned_to?.split(" ")[0] || "?"}</text>
                  </g>
                );
              })}
            </svg>
          </div>
        );
      })()}

      {/* ═══ BOARD (KANBAN) VIEW ═══ */}
      {timeView === "board" && (
        <TasksBoard
          tasks={scopedTasks}
          currentRole={currentRole}
          isPrivileged={isPrivileged}
          canReview={canReview}
          canDelete={canDelete}
          myEmail={myEmail}
          memberPhones={memberPhones}
          onChanged={refreshAll}
        />
      )}

      {/* ═══ TEAM VIEW ═══ */}
      {timeView === "team" && <TeamStats />}

      {/* ═══ RECURRING VIEW ═══ */}
      {timeView === "recurring" && <RecurringTasksPanel isPrivileged={isPrivileged} />}

      {scopedTasks.length === 0 && (
        <p style={{ color: COLOURS.SLATE, fontSize: "14px" }}>No tasks yet.</p>
      )}
    </div>
  );
}
