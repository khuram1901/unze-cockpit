"use client";

import React, { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabase";
import TaskStatus from "./TaskStatus";
import { formatDateUK } from "../lib/dateUtils";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { downloadCSV } from "../lib/exportUtils";
import ImportExportButtons from "../lib/ImportExportButtons";

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
  meeting_id: string | null;
  created_at: string | null;
};

const NAVY = "#1e293b";
const SLATE = "#64748b";
const BORDER = "#e2e8f0";

function statusColor(status: string) {
  switch (status) {
    case "Completed": return "#16a34a";
    case "Submitted": return "#2563eb";
    case "Waiting Reply": return "#dc2626";
    case "Cancelled": return SLATE;
    case "In Progress": return "#d97706";
    default: return SLATE;
  }
}

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

function getMonthLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function getQuarterLabel(dateStr: string): string {
  const [y, m] = dateStr.slice(0, 7).split("-").map(Number);
  const q = Math.ceil(m / 3);
  return `Q${q} ${y}`;
}

export default function TasksList({ currentRole }: { currentRole: string }) {
  const searchParams = useSearchParams();
  const taskIdFromUrl = searchParams.get("task");

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(taskIdFromUrl);
  const [timeView, setTimeView] = useState<"weekly" | "monthly" | "quarterly">("weekly");
  const [filter, setFilter] = useState<"all" | "overdue" | "waiting" | "person">("all");
  const [bannerOpen, setBannerOpen] = useState(false);

  const isPrivileged = currentRole === "Admin" || currentRole === "Executive";

  async function loadTasks() {
    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email || null;
    setMyEmail(email);

    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) setErrorMsg(error.message);
    else setTasks(data || []);
    setLoading(false);
  }

  useEffect(() => { loadTasks(); }, []);

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

  if (loading) return <p style={{ color: SLATE }}>Loading tasks…</p>;
  if (errorMsg) return <p style={{ color: "#dc2626" }}>Error: {errorMsg}</p>;

  const scopedTasks = isPrivileged
    ? tasks
    : tasks.filter((t) => t.assigned_to_email && t.assigned_to_email === myEmail);

  const allOpen = scopedTasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled");
  const overdueTasks = allOpen.filter(isOverdue);
  const waitingReply = allOpen.filter((t) => t.status === "Waiting Reply");
  const completedAll = scopedTasks.filter((t) => t.status === "Completed");

  // ── Weekly grouping ──
  const thisWeekStart = getWeekStart(new Date());
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

  // ── Monthly chart data ──
  const monthMap = new Map<string, { month: string; label: string; created: number; completed: number }>();
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  const cutoff = sixMonthsAgo.toISOString().slice(0, 7);

  for (const t of scopedTasks) {
    const createdMonth = t.created_at?.slice(0, 7) || "";
    if (createdMonth >= cutoff) {
      if (!monthMap.has(createdMonth)) monthMap.set(createdMonth, { month: createdMonth, label: getMonthLabel(createdMonth + "-01"), created: 0, completed: 0 });
      monthMap.get(createdMonth)!.created++;
    }
  }
  for (const t of completedAll) {
    const createdMonth = t.created_at?.slice(0, 7) || "";
    if (createdMonth >= cutoff) {
      if (!monthMap.has(createdMonth)) monthMap.set(createdMonth, { month: createdMonth, label: getMonthLabel(createdMonth + "-01"), created: 0, completed: 0 });
      monthMap.get(createdMonth)!.completed++;
    }
  }
  const monthlyData = Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month));

  // ── Quarterly chart data ──
  const qMap = new Map<string, { quarter: string; overdue: number; active: number; completed: number }>();
  for (const t of scopedTasks) {
    const dt = t.due_date || t.created_at?.slice(0, 10) || todayStr;
    const q = getQuarterLabel(dt);
    if (!qMap.has(q)) qMap.set(q, { quarter: q, overdue: 0, active: 0, completed: 0 });
    const row = qMap.get(q)!;
    if (t.status === "Completed") row.completed++;
    else if (isOverdue(t)) row.overdue++;
    else if (t.status !== "Cancelled") row.active++;
  }
  const quarterlyData = Array.from(qMap.values()).sort((a, b) => a.quarter.localeCompare(b.quarter));

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

  // ── Filtered task list ──
  let filteredTasks = allOpen;
  if (filter === "overdue") filteredTasks = overdueTasks;
  else if (filter === "waiting") filteredTasks = waitingReply;

  const weekGroupColor = (g: string) => g === "Overdue" ? "#dc2626" : g === "This Week" ? "#d97706" : g === "Next Week" ? "#2563eb" : SLATE;

  function TaskRow({ task }: { task: Task }) {
    const isOpen = expandedTaskId === task.id;
    const od = daysOverdue(task);
    const overdue = isOverdue(task);

    return (
      <div id={`task-${task.id}`} style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div onClick={() => setExpandedTaskId(isOpen ? null : task.id)}
          style={{ padding: "9px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", backgroundColor: overdue ? "#fef2f2" : isOpen ? "#f8fafc" : "white" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "14px", fontWeight: 600, color: NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.description}</div>
            <div style={{ fontSize: "12px", color: SLATE, marginTop: "2px", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
              <span>{task.assigned_to || "Unassigned"}</span>
              {task.due_date && (
                <span style={{ color: overdue ? "#dc2626" : SLATE, fontWeight: overdue ? 700 : 400 }}>
                  {formatDateUK(task.due_date)}{od > 0 && ` (${od}d late)`}
                </span>
              )}
              {task.priority && (
                <span style={{ fontSize: "11px", fontWeight: 700, padding: "1px 6px", borderRadius: "6px", color: "white",
                  backgroundColor: task.priority === "High" || task.priority === "Urgent" ? "#dc2626" : task.priority === "Medium" ? "#2563eb" : SLATE }}>
                  {task.priority}
                </span>
              )}
              <span style={{ fontSize: "11px", fontWeight: 700, padding: "1px 6px", borderRadius: "6px", color: "white", backgroundColor: statusColor(task.status) }}>
                {task.status}
              </span>
            </div>
          </div>
          <span style={{ color: SLATE, fontSize: "13px", flexShrink: 0 }}>{isOpen ? "▼" : "▶"}</span>
        </div>

        {isOpen && (
          <div style={{ padding: "10px 14px", backgroundColor: "#f8fafc", borderTop: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: "13px", color: SLATE, marginBottom: "6px" }}>
              Type: <strong>{task.task_type || "Task"}</strong> · Assigned by: <strong>{task.assigned_by || "—"}</strong> · Date: {formatDateUK(task.assigned_date)} · Project: {task.project || "—"}
              {task.meeting_id && (
                <span> · <a href={`/my-minutes?meeting=${task.meeting_id}`} style={{ color: "#2563eb", fontWeight: 600, textDecoration: "none" }}>View Minutes →</a></span>
              )}
            </div>
            {task.notes && <div style={{ fontSize: "13px", color: SLATE, marginBottom: "6px" }}>Notes: {task.notes}</div>}
            {task.reply_text && (
              <div style={{ padding: "8px 10px", border: "1px solid #bbf7d0", backgroundColor: "#f0fdf4", borderRadius: "6px", color: "#166534", fontSize: "13px", marginBottom: "8px" }}>
                <strong>Explanation:</strong> {task.reply_text}
                {task.corrective_action && <div style={{ marginTop: "4px" }}><strong>Corrective action:</strong> {task.corrective_action}</div>}
                {task.recovery_date && <div style={{ marginTop: "4px" }}><strong>Expected recovery:</strong> {formatDateUK(task.recovery_date)}</div>}
                <div style={{ marginTop: "4px", fontSize: "12px" }}>By {task.reply_by || "unknown"} {task.reply_at ? `on ${formatDateUK(task.reply_at)}` : ""}</div>
              </div>
            )}
            <TaskStatus task={task} currentRole={currentRole} onChanged={loadTasks} />
            {isPrivileged && (
              <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: `1px solid ${BORDER}`, display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={async () => {
                    if (!confirm(`Delete task "${task.description}"? This cannot be undone.`)) return;
                    await supabase.from("tasks").delete().eq("id", task.id);
                    loadTasks();
                  }}
                  style={{
                    backgroundColor: "white", color: "#dc2626", border: "1px solid #dc2626",
                    borderRadius: "5px", padding: "4px 12px", fontSize: "12px", fontWeight: 700, cursor: "pointer",
                  }}
                  title="Permanently delete this task"
                >
                  Delete Task
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* ═══ OVERDUE BANNER ═══ */}
      {overdueTasks.length > 0 && (
        <div style={{
          border: "1px solid #fecaca", borderLeft: "4px solid #dc2626", borderRadius: "8px",
          backgroundColor: "#fef2f2", overflow: "hidden", marginBottom: "14px",
        }}>
          <div onClick={() => setBannerOpen(!bannerOpen)} style={{
            padding: "12px 16px", cursor: "pointer",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>⚠</span>
              <div>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "#991b1b" }}>
                  {overdueTasks.length} overdue task{overdueTasks.length > 1 ? "s" : ""} need attention
                </div>
                <div style={{ fontSize: "13px", color: "#991b1b", marginTop: "1px" }}>
                  {overdueTasks.slice(0, 3).map((t) => `${t.assigned_to || "Unassigned"}: ${t.description.slice(0, 30)}${t.description.length > 30 ? "…" : ""}`).join(" · ")}
                  {overdueTasks.length > 3 && ` · +${overdueTasks.length - 3} more`}
                </div>
              </div>
            </div>
            <span style={{ fontSize: "14px", fontWeight: 700, color: "#991b1b" }}>{bannerOpen ? "▲" : "▼"}</span>
          </div>
          {bannerOpen && (
            <div style={{ borderTop: "1px solid #fecaca", backgroundColor: "white" }}>
              {overdueTasks.sort((a, b) => daysOverdue(b) - daysOverdue(a)).map((t) => (
                <div key={t.id} onClick={() => { setExpandedTaskId(t.id); setBannerOpen(false); setTimeout(() => document.getElementById(`task-${t.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 100); }}
                  style={{ padding: "8px 16px 8px 48px", borderBottom: "1px solid #f1f5f9", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "#fef2f2"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "white"; }}>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: NAVY }}>{t.description}</div>
                    <div style={{ fontSize: "12px", color: SLATE }}>{t.assigned_to || "Unassigned"}</div>
                  </div>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#dc2626", flexShrink: 0 }}>{daysOverdue(t)}d late</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ SUMMARY ROW ═══ */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "8px", flex: 1 }}>
          <MiniCard label="Open" value={allOpen.length} color="#2563eb" />
          <MiniCard label="Overdue" value={overdueTasks.length} color="#dc2626" />
          <MiniCard label="Waiting Reply" value={waitingReply.length} color="#d97706" />
          <MiniCard label="Completed" value={completedAll.length} color="#16a34a" />
        </div>
        {isPrivileged && (
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
                alert(`Import validation failed:\n\n${errors.slice(0, 10).join("\n")}${errors.length > 10 ? `\n...and ${errors.length - 10} more` : ""}`);
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
                  assigned_date: row["Assigned Date"]?.trim() || new Date().toISOString().slice(0, 10),
                });
                count++;
              }
              alert(`Successfully imported ${count} task${count !== 1 ? "s" : ""}.`);
              loadTasks();
            }}
            templateHeaders={["Description", "Assigned To", "Assigned By", "Assigned Date", "Due Date", "Priority", "Department / Area", "Starting Status", "Notes"]}
            templateFilename="tasks-import-template.csv"
            exportLabel="Export all tasks as CSV"
            importLabel="Import tasks from CSV"
          />
        )}
      </div>

      {/* ═══ TIME VIEW TOGGLE ═══ */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "12px", flexWrap: "wrap" }}>
        {(["weekly", "monthly", "quarterly"] as const).map((v) => (
          <button key={v} onClick={() => setTimeView(v)} style={{
            backgroundColor: timeView === v ? NAVY : "white",
            color: timeView === v ? "white" : NAVY,
            border: `1px solid ${timeView === v ? NAVY : BORDER}`,
            borderRadius: "6px", padding: "7px 16px", fontSize: "14px", fontWeight: 600, cursor: "pointer",
            textTransform: "capitalize",
          }}>{v}</button>
        ))}
        <div style={{ flex: 1 }} />
        {/* Filters */}
        {(["all", "overdue", "waiting"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{
            backgroundColor: filter === f ? (f === "overdue" ? "#dc2626" : f === "waiting" ? "#d97706" : NAVY) : "white",
            color: filter === f ? "white" : NAVY,
            border: `1px solid ${filter === f ? "transparent" : BORDER}`,
            borderRadius: "6px", padding: "6px 12px", fontSize: "13px", fontWeight: 600, cursor: "pointer",
          }}>{f === "all" ? "All" : f === "overdue" ? `Overdue (${overdueTasks.length})` : `Waiting (${waitingReply.length})`}</button>
        ))}
      </div>

      {/* ═══ WEEKLY VIEW ═══ */}
      {timeView === "weekly" && (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden", marginBottom: "14px" }}>
          {weekOrder.filter((g) => weekGroups.has(g)).map((group) => {
            const groupTasks = (filter === "overdue" ? weekGroups.get(group)!.filter(isOverdue) : filter === "waiting" ? weekGroups.get(group)!.filter((t) => t.status === "Waiting Reply") : weekGroups.get(group)!);
            if (groupTasks.length === 0) return null;
            return (
              <div key={group}>
                <div style={{ padding: "8px 14px", backgroundColor: "#f8fafc", borderBottom: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: weekGroupColor(group) }}>{group}</span>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: SLATE }}>{groupTasks.length} task{groupTasks.length > 1 ? "s" : ""}</span>
                </div>
                {groupTasks.map((t) => <TaskRow key={t.id} task={t} />)}
              </div>
            );
          })}
          {filteredTasks.length === 0 && (
            <div style={{ padding: "16px", textAlign: "center", color: SLATE }}>No tasks match this filter.</div>
          )}
        </div>
      )}

      {/* ═══ MONTHLY VIEW ═══ */}
      {timeView === "monthly" && (
        <>
          {monthlyData.length > 0 && (
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white", marginBottom: "14px" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: NAVY, marginBottom: "8px" }}>Tasks Created vs Completed — Last 6 Months</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: SLATE }} />
                  <YAxis tick={{ fontSize: 12, fill: SLATE }} allowDecimals={false} />
                  <Tooltip />
                  <Legend iconType="square" wrapperStyle={{ fontSize: "13px" }} />
                  <Bar dataKey="created" fill="#2563eb" name="Created (blue)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="completed" fill="#16a34a" name="Completed (green)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden", marginBottom: "14px" }}>
            {filteredTasks.length === 0 ? (
              <div style={{ padding: "16px", textAlign: "center", color: SLATE }}>No tasks match this filter.</div>
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
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white", marginBottom: "14px" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: NAVY, marginBottom: "8px" }}>Quarterly Overview</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={quarterlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="quarter" tick={{ fontSize: 12, fill: SLATE }} />
                  <YAxis tick={{ fontSize: 12, fill: SLATE }} allowDecimals={false} />
                  <Tooltip />
                  <Legend iconType="square" wrapperStyle={{ fontSize: "13px" }} />
                  <Bar dataKey="overdue" stackId="a" fill="#dc2626" name="Overdue (red)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="active" stackId="a" fill="#2563eb" name="Active (blue)" />
                  <Bar dataKey="completed" stackId="a" fill="#16a34a" name="Completed (green)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Quarterly summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px", marginBottom: "14px" }}>
            {quarterlyData.map((q) => (
              <div key={q.quarter} style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "12px", backgroundColor: "white" }}>
                <div style={{ fontSize: "16px", fontWeight: 700, color: NAVY, marginBottom: "6px" }}>{q.quarter}</div>
                <div style={{ display: "flex", gap: "12px", fontSize: "14px" }}>
                  <span style={{ color: "#dc2626", fontWeight: 700 }}>{q.overdue} overdue</span>
                  <span style={{ color: "#2563eb", fontWeight: 700 }}>{q.active} active</span>
                  <span style={{ color: "#16a34a", fontWeight: 700 }}>{q.completed} done</span>
                </div>
              </div>
            ))}
          </div>

          <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden", marginBottom: "14px" }}>
            {filteredTasks.length === 0 ? (
              <div style={{ padding: "16px", textAlign: "center", color: SLATE }}>No tasks match this filter.</div>
            ) : (
              filteredTasks.map((t) => <TaskRow key={t.id} task={t} />)
            )}
          </div>
        </>
      )}

      {scopedTasks.length === 0 && (
        <p style={{ color: SLATE, fontSize: "16px" }}>No tasks yet.</p>
      )}
    </div>
  );
}

function MiniCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderTop: `3px solid ${color}`, borderRadius: "7px", padding: "8px 10px", backgroundColor: "white" }}>
      <div style={{ color: SLATE, fontSize: "13px", marginBottom: "1px" }}>{label}</div>
      <div style={{ fontSize: "20px", fontWeight: 800, color }}>{value}</div>
    </div>
  );
}
