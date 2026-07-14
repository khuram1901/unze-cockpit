"use client";

// HARD RULE: This page must NEVER display cash, financial figures, or finance-related data.

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase, authFetch } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import DateInput from "../lib/DateInput";
import { useMobile } from "../lib/useMobile";
import { logAction } from "../lib/audit-log";
import {
  COLOURS,
  SectionTitle,
  StatusBadge,
  PriorityBadge,
  useConfirm,
  TASK_DESCRIPTION_LIMIT,
  TASK_COMPANY_CODES,
} from "../lib/SharedUI";
import { whatsappLink, taskChaseMessage } from "../lib/whatsapp";
import { useRequireCapability } from "../lib/useRouteGuard";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";

type Task = {
  id: string;
  description: string;
  project: string | null;
  priority: string | null;
  due_date: string | null;
  assigned_to: string | null;
  assigned_to_email: string | null;
  assigned_by: string | null;
  status: string;
  source_type: string | null;
  exception_type: string | null;
  assigned_to_department: string | null;
  reply_text: string | null;
  notes: string | null;
  created_at: string | null;
};

type MeetingRequest = {
  id: string;
  requested_by_name: string | null;
  meeting_title: string;
  requested_date: string | null;
  priority: string | null;
  status: string | null;
};

type Member = {
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  email: string | null;
  department: string | null;
  phone_e164: string | null;
};

type Company = { id: string; name: string; short_code: string | null };

type PaDividend = {
  id: string;
  ticker: string;
  ex_dividend_date: string;
  payment_date: string | null;
  days_to_ex: number;
};

const today = new Date().toISOString().slice(0, 10);
const STATUSES = ["Not Started", "In Progress", "Waiting Reply", "Completed", "Cancelled"];
const PRIORITIES = ["Low", "Normal", "High", "Urgent"];

function sevenDaysFromNow() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

function isOverdue(task: Task): boolean {
  if (task.status === "Completed" || task.status === "Cancelled") return false;
  return !!task.due_date && task.due_date < today;
}

function daysOverdue(task: Task): number {
  if (!task.due_date || !isOverdue(task)) return 0;
  return Math.floor((Date.now() - new Date(task.due_date + "T00:00:00").getTime()) / 86400000);
}

function daysUntil(dateStr: string): number {
  return Math.floor((new Date(dateStr + "T00:00:00").getTime() - Date.now()) / 86400000);
}

function memberName(m: Member): string {
  return `${m.first_name || ""} ${m.last_name || ""}`.trim() || m.name || "";
}

export default function PADashboardPage() {
  const { checking } = useRequireCapability("pa_dashboard");
  const isMobile = useMobile();
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [meetingRequests, setMeetingRequests] = useState<MeetingRequest[]>([]);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [viewPerson, setViewPerson] = useState<string | null>(null);
  const [bannerOpen, setBannerOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<"upcoming" | "people" | "all">("upcoming");
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState(false);
  const [quickNote, setQuickNote] = useState<{ taskId: string; text: string } | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const dlg = useConfirm();

  // New task form
  const [showNewTask, setShowNewTask] = useState(false);
  const [newDesc, setNewDesc] = useState("");
  const [newAssignTo, setNewAssignTo] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newPriority, setNewPriority] = useState("Normal");
  const [newProject, setNewProject] = useState("");
  const [newCompanyId, setNewCompanyId] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [savingTask, setSavingTask] = useState(false);
  const [taskError, setTaskError] = useState("");
  const [paDividends, setPaDividends] = useState<PaDividend[]>([]);

  useEffect(() => { loadData(); loadPaDividends(); }, []);

  async function loadData() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const email = user?.email || null;
    setCurrentUserEmail(email);

    if (email) {
      const { data: member } = await supabase
        .from("members").select("first_name, last_name, name")
        .eq("email", email).maybeSingle();
      if (member) setCurrentUserName(`${member.first_name || ""} ${member.last_name || ""}`.trim() || member.name || email);
    }

    const TASK_COLS = "id, description, project, priority, due_date, assigned_to, assigned_to_email, assigned_by, status, source_type, exception_type, assigned_to_department, reply_text, notes, created_at";
    const [tasksRes, meetingsRes, membersRes, companiesRes] = await Promise.all([
      supabase.from("tasks").select(TASK_COLS).order("created_at", { ascending: false }).limit(300),
      supabase.from("meeting_requests").select("id, requested_by_name, meeting_title, requested_date, priority, status").eq("status", "Pending").order("created_at", { ascending: false }),
      supabase.from("members").select("first_name, last_name, name, email, department, phone_e164").eq("is_active", true),
      supabase.from("companies").select("id, name, short_code").in("short_code", TASK_COMPANY_CODES).order("name", { ascending: true }),
    ]);

    setTasks(tasksRes.data || []);
    setMeetingRequests(meetingsRes.data || []);
    setMembers(membersRes.data || []);
    setCompanies(companiesRes.data || []);
    setLoading(false);
  }

  async function loadPaDividends() {
    try {
      const res = await supabase.rpc("get_upcoming_dividends", { p_days_ahead: 14 });
      // Only show confirmed dividends to PA — no unconfirmed data
      const confirmed = (res.data ?? []).filter((d: { confirmed: boolean }) => d.confirmed);
      setPaDividends(confirmed.map((d: { id: string; ticker: string; ex_dividend_date: string; payment_date: string | null; days_to_ex: number }) => ({
        id: d.id,
        ticker: d.ticker,
        ex_dividend_date: d.ex_dividend_date,
        payment_date: d.payment_date,
        days_to_ex: d.days_to_ex,
      })));
    } catch { /* dividends are optional — don't crash PA page */ }
  }

  function showMsg(text: string) { setMessage(text); setTimeout(() => setMessage(""), 3000); }

  async function updateTask(id: string, updates: Record<string, unknown>) {
    await supabase.from("tasks").update({ ...updates, updated_at: new Date().toISOString() }).eq("id", id);
    logAction("Updated", "tasks", `PA updated ${Object.keys(updates).join(", ")}`, id);
    loadData();
  }

  async function closeTask(id: string) {
    await updateTask(id, { status: "Completed" });
    showMsg("Task closed.");
  }

  async function chaseTask(task: Task) {
    if (task.assigned_to_email) {
      authFetch("/api/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "task_assigned", taskId: task.id, recipientEmail: task.assigned_to_email }),
      }).catch(() => {});
    }
    showMsg(`Chase sent to ${task.assigned_to || "assignee"}.`);
  }

  function toggleSelect(taskId: string) {
    setSelectedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  }

  async function bulkComplete() {
    if (selectedTasks.size === 0) return;
    if (!await dlg.confirm(`Mark ${selectedTasks.size} task${selectedTasks.size > 1 ? "s" : ""} as Completed?`)) return;
    const ids = Array.from(selectedTasks);
    await supabase.from("tasks").update({ status: "Completed", updated_at: new Date().toISOString() }).in("id", ids);
    logAction("Updated", "tasks", `Bulk completed ${ids.length} tasks`);
    setSelectedTasks(new Set());
    showMsg(`${ids.length} tasks completed.`);
    loadData();
  }

  async function bulkReassign(newPerson: string) {
    if (selectedTasks.size === 0 || !newPerson) return;
    const member = members.find((m) => memberName(m) === newPerson);
    const previousAssignees = new Set<string>();
    for (const id of selectedTasks) {
      const task = tasks.find((t) => t.id === id);
      if (task?.assigned_to) previousAssignees.add(task.assigned_to);
      await supabase.from("tasks").update({
        assigned_to: newPerson, assigned_to_email: member?.email || null,
        assigned_to_department: member?.department || null,
        notes: `Reassigned from ${task?.assigned_to || "unassigned"} to ${newPerson} by ${currentUserName || "PA"}`,
        updated_at: new Date().toISOString(),
      }).eq("id", id);
    }
    logAction("Updated", "tasks", `Bulk reassigned ${selectedTasks.size} tasks to ${newPerson} (from: ${Array.from(previousAssignees).join(", ")})`);
    setSelectedTasks(new Set());
    showMsg(`${selectedTasks.size} tasks reassigned to ${newPerson}.`);
    loadData();
  }

  async function saveQuickNote() {
    if (!quickNote?.taskId || !quickNote.text.trim()) return;
    setSavingNote(true);
    const task = tasks.find((t) => t.id === quickNote.taskId);
    const existing = task?.notes || "";
    const timestamp = new Date().toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const newNote = `[${timestamp} — ${currentUserName || "PA"}] ${quickNote.text.trim()}`;
    const updated = existing ? `${existing}\n${newNote}` : newNote;
    await supabase.from("tasks").update({ notes: updated, updated_at: new Date().toISOString() }).eq("id", quickNote.taskId);
    logAction("Updated", "tasks", `Added note to task`, quickNote.taskId);
    setSavingNote(false);
    setQuickNote(null);
    showMsg("Note added.");
    loadData();
  }

  async function approveMeeting(id: string) {
    await supabase.from("meeting_requests").update({
      status: "Approved", approved_by: currentUserName || currentUserEmail || "PA",
    }).eq("id", id);
    logAction("Updated", "meeting_requests", "Approved on CEO's behalf", id);
    loadData();
  }

  async function createNewTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newDesc.trim() || !newAssignTo || !newDueDate || !newCompanyId) return;
    setSavingTask(true);
    setTaskError("");

    const assignedMember = members.find((m) => memberName(m) === newAssignTo);

    // Routes through the shared task-creation gate (see
    // TASK_NOTIFICATION_AUDIT.md) instead of inserting directly — this is
    // what now enforces the company tag and the character limit here too,
    // not just on the main New Task form.
    const res = await authFetch("/api/tasks/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: newDesc,
        companyId: newCompanyId,
        assignedTo: newAssignTo,
        assignedToEmail: assignedMember?.email || null,
        assignedToDepartment: assignedMember?.department || null,
        dueDate: newDueDate || null,
        priority: newPriority,
        project: newProject || null,
        status: "Not Started",
        taskType: "Task",
      }),
    });
    const result = await res.json().catch(() => ({}));

    if (!res.ok || result?.error) {
      setSavingTask(false);
      setTaskError(result?.error || "Couldn't create the task. Please try again.");
      return;
    }

    logAction("Created", "tasks", `PA assigned: ${newDesc} → ${newAssignTo}`);

    setSavingTask(false);
    setNewDesc(""); setNewAssignTo(""); setNewDueDate(""); setNewPriority("Normal"); setNewProject(""); setNewCompanyId("");
    setShowNewTask(false);
    showMsg(`Task assigned to ${newAssignTo}.`);
    loadData();
  }

  if (checking) return <AuthWrapper><main style={{ padding: "14px 18px" }}><p style={{ color: `var(--text-secondary, ${COLOURS.SLATE})` }}>Checking permissions...</p></main></AuthWrapper>;

  const openTasks = tasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled");
  const completedTasks = tasks.filter((t) => t.status === "Completed");
  const overdueTasks = openTasks.filter(isOverdue);
  const waitingReply = openTasks.filter((t) => t.status === "Waiting Reply");
  const inProgress = openTasks.filter((t) => t.status === "In Progress");
  const notStarted = openTasks.filter((t) => t.status === "Not Started");
  const escalations = openTasks.filter((t) => t.source_type === "kpi_escalation" || t.source_type === "receivable_escalation");
  const next7 = sevenDaysFromNow();
  const upcomingTasks = openTasks.filter((t) => t.due_date && t.due_date >= today && t.due_date <= next7).sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));

  // Person breakdown
  const personMap = new Map<string, Task[]>();
  for (const t of openTasks) {
    const person = t.assigned_to || "Unassigned";
    if (!personMap.has(person)) personMap.set(person, []);
    personMap.get(person)!.push(t);
  }
  const people = Array.from(personMap.entries())
    .map(([name, tks]) => ({ name, total: tks.length, overdue: tks.filter(isOverdue).length, waiting: tks.filter((t) => t.status === "Waiting Reply").length }))
    .sort((a, b) => b.overdue - a.overdue || b.total - a.total);

  const viewTasks = viewPerson ? (personMap.get(viewPerson) || []) : null;

  // Banner items
  const bannerItems: { label: string; count: number; color: string }[] = [];
  if (overdueTasks.length > 0) bannerItems.push({ label: `${overdueTasks.length} overdue task${overdueTasks.length > 1 ? "s" : ""}`, count: overdueTasks.length, color: COLOURS.RED });
  if (waitingReply.length > 0) bannerItems.push({ label: `${waitingReply.length} waiting repl${waitingReply.length > 1 ? "ies" : "y"}`, count: waitingReply.length, color: COLOURS.RED });
  if (escalations.length > 0) bannerItems.push({ label: `${escalations.length} escalation${escalations.length > 1 ? "s" : ""}`, count: escalations.length, color: COLOURS.AMBER });
  if (meetingRequests.length > 0) bannerItems.push({ label: `${meetingRequests.length} meeting${meetingRequests.length > 1 ? "s" : ""} to approve`, count: meetingRequests.length, color: COLOURS.BLUE });
  const hasCritical = overdueTasks.length > 0 || escalations.length > 0;

  function TaskCard({ task }: { task: Task }) {
    const isExpanded = expandedTask === task.id;
    const od = daysOverdue(task);
    return (
      <div style={{ borderBottom: `1px solid ${COLOURS.BORDER}`, backgroundColor: isOverdue(task) ? "#fef2f2" : "var(--bg-card, #ffffff)" }}>
        <div style={{ padding: "9px 14px", display: "flex", alignItems: "center", gap: "8px" }}>
          {bulkAction && (
            <input type="checkbox" checked={selectedTasks.has(task.id)} onChange={() => toggleSelect(task.id)}
              style={{ width: "16px", height: "16px", flexShrink: 0, cursor: "pointer" }} />
          )}
          <div onClick={() => setExpandedTask(isExpanded ? null : task.id)} style={{ flex: 1, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "16px", fontWeight: 600, color: `var(--text-primary, ${COLOURS.NAVY})`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.description}</div>
            <div style={{ fontSize: "14px", color: `var(--text-secondary, ${COLOURS.SLATE})`, marginTop: "2px", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
              <span>{task.assigned_to || "Unassigned"}</span>
              {task.due_date && (
                <span style={{ color: isOverdue(task) ? COLOURS.RED : COLOURS.SLATE, fontWeight: isOverdue(task) ? 700 : 400 }}>
                  {formatDateUK(task.due_date)}{od > 0 && ` (${od}d late)`}
                </span>
              )}
              <PriorityBadge priority={task.priority} />
              <StatusBadge status={task.status} />
            </div>
          </div>
          <span style={{ color: `var(--text-secondary, ${COLOURS.SLATE})`, fontSize: "15px", flexShrink: 0 }}>{isExpanded ? "▼" : "▶"}</span>
          </div>
        </div>

        {isExpanded && (
          <div style={{ padding: "8px 14px 12px", backgroundColor: "var(--bg-card-hover, #f8fafc)", borderTop: `1px solid ${COLOURS.BORDER}` }}>
            {task.reply_text && (
              <div style={{ marginBottom: "8px", padding: "8px 10px", backgroundColor: "#dcfce7", border: `1px solid ${COLOURS.GREEN}`, borderRadius: "6px", fontSize: "13px", color: "#166534" }}>
                <strong>Reply:</strong> {task.reply_text}
              </div>
            )}
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "8px" }}>
              <select value={task.status} onChange={(e) => updateTask(task.id, { status: e.target.value })} style={controlStyle}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
              <select value={task.priority || "Normal"} onChange={(e) => updateTask(task.id, { priority: e.target.value })} style={controlStyle}>
                {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
              </select>
              <DateInput value={task.due_date || ""} onChange={(e) => updateTask(task.id, { due_date: e.target.value || null })} style={controlStyle} />
              <select value={task.assigned_to || ""} onChange={(e) => {
                const m = members.find((mem) => memberName(mem) === e.target.value);
                const prevOwner = task.assigned_to || "unassigned";
                const newOwner = e.target.value;
                const delegationNote = `Reassigned from ${prevOwner} to ${newOwner} by ${currentUserName || "PA"}`;
                const existingNotes = task.notes || "";
                updateTask(task.id, {
                  assigned_to: newOwner, assigned_to_email: m?.email || null, assigned_to_department: m?.department || null,
                  notes: existingNotes ? `${existingNotes}\n[${new Date().toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}] ${delegationNote}` : delegationNote,
                });
              }} style={controlStyle}>
                <option value="">Reassign...</option>
                {members.map((m) => { const n = memberName(m); return <option key={n} value={n}>{n}</option>; })}
              </select>
            </div>
            {/* Quick note */}
            {quickNote?.taskId === task.id ? (
              <div style={{ display: "flex", gap: "6px", marginBottom: "8px", alignItems: "center" }}>
                <input type="text" placeholder="Add a note..." value={quickNote.text} onChange={(e) => setQuickNote({ ...quickNote, text: e.target.value })}
                  style={{ flex: 1, padding: "5px 8px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "13px" }}
                  onKeyDown={(e) => { if (e.key === "Enter") saveQuickNote(); }} autoFocus />
                <button onClick={saveQuickNote} disabled={savingNote || !quickNote.text.trim()} style={actionBtn(COLOURS.GREEN)}>{savingNote ? "..." : "Save"}</button>
                <button onClick={() => setQuickNote(null)} style={actionBtn(COLOURS.SLATE)}>Cancel</button>
              </div>
            ) : (
              task.notes && <div style={{ fontSize: "14px", color: `var(--text-secondary, ${COLOURS.SLATE})`, marginBottom: "6px", padding: "6px 8px", backgroundColor: "var(--border-light, #f1f5f9)", borderRadius: "4px", whiteSpace: "pre-line" }}>{task.notes}</div>
            )}
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <button onClick={() => chaseTask(task)} style={actionBtn(COLOURS.BLUE)} title="Send chase email notification">Chase</button>
              {(() => {
                const m = members.find((mem) => memberName(mem) === task.assigned_to);
                const waLink = m ? whatsappLink(m.phone_e164, taskChaseMessage(task.description, task.assigned_to, task.due_date ? formatDateUK(task.due_date) : null)) : null;
                return waLink ? (
                  <a href={waLink} target="_blank" rel="noopener noreferrer" style={{ ...actionBtn(COLOURS.GREEN), textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "3px" }} title="Send WhatsApp reminder">
                    WA
                  </a>
                ) : null;
              })()}
              <button onClick={() => closeTask(task.id)} style={actionBtn(COLOURS.GREEN)} title="Mark as completed">Complete</button>
              <button onClick={() => setQuickNote({ taskId: task.id, text: "" })} style={actionBtn(COLOURS.PURPLE)} title="Add a note to this task">Note</button>
              <button onClick={async () => {
                if (!await dlg.confirm(`Delete "${task.description}"? This cannot be undone.`, true)) return;
                await supabase.from("tasks").delete().eq("id", task.id);
                showMsg("Task deleted.");
                loadData();
              }} style={{ ...actionBtn(COLOURS.RED), backgroundColor: "var(--bg-card, #ffffff)", color: COLOURS.RED, border: `1px solid ${COLOURS.RED}` }} title="Delete this task">Delete</button>
            </div>
            <div style={{ fontSize: "13px", color: `var(--text-secondary, ${COLOURS.SLATE})`, marginTop: "6px" }}>
              By: {task.assigned_by || "—"} · Dept: {task.assigned_to_department || "—"} · Project: {task.project || "—"}
            </div>
          </div>
        )}
      </div>
    );
  }

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const now = new Date();
  const dateStr = `${dayNames[now.getDay()]}, ${now.getDate()} ${monthNames[now.getMonth()]} ${now.getFullYear()}`;
  function greetByTime() {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }

  const donutData = [
    { name: "Overdue", value: overdueTasks.length, color: COLOURS.RED },
    { name: "Waiting Reply", value: waitingReply.length, color: COLOURS.AMBER },
    { name: "In Progress", value: inProgress.length, color: COLOURS.BLUE },
    { name: "Not Started", value: notStarted.length, color: COLOURS.SLATE },
  ].filter((d) => d.value > 0);

  const completedThisMonth = completedTasks.filter((t) => {
    const m = new Date().toISOString().slice(0, 7);
    return t.created_at && t.created_at.slice(0, 7) === m;
  }).length;

  return (
    <AuthWrapper>
        {dlg.element}
        <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>

          {/* ── Greeting ── */}
          {!loading && currentUserName && (
            <div style={{ marginBottom: "4px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <span style={{ fontSize: isMobile ? "18px" : "22px", fontWeight: 800, color: "var(--text-primary)" }}>
                {greetByTime()}, {currentUserName.split(" ")[0]}
              </span>
              <span style={{
                fontSize: "11px", fontWeight: 700, padding: "2px 10px", borderRadius: "10px",
                backgroundColor: "var(--border-light)", color: "var(--text-secondary)",
              }}>
                PA Command Centre
              </span>
            </div>
          )}
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", margin: "0 0 20px" }}>
            {dateStr}
          </p>

          {message && (
            <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderLeft: `4px solid ${COLOURS.GREEN}`, borderRadius: "6px", padding: "10px 14px", marginBottom: "14px", backgroundColor: "var(--bg-card, #ffffff)", fontSize: "15px", color: `var(--text-primary, ${COLOURS.NAVY})` }}>
              {message}
            </div>
          )}

          {/* ── New task form ── */}
          {showNewTask && (
            <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)", marginBottom: "14px" }}>
              <SectionTitle title="Assign a New Task" />
              <form onSubmit={createNewTask}>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "8px" }}>
                  <label style={labelStyle}>Task <input value={newDesc} onChange={(e) => setNewDesc(e.target.value.slice(0, TASK_DESCRIPTION_LIMIT))} maxLength={TASK_DESCRIPTION_LIMIT} placeholder="What needs to be done" required style={inputStyle} />
                    <span style={{ fontSize: "10.5px", color: newDesc.length > TASK_DESCRIPTION_LIMIT - 20 ? COLOURS.AMBER : COLOURS.SLATE }}>{newDesc.length}/{TASK_DESCRIPTION_LIMIT}</span>
                  </label>
                  <label style={labelStyle}>Assign To
                    <select value={newAssignTo} onChange={(e) => setNewAssignTo(e.target.value)} required style={inputStyle}>
                      <option value="">Select person...</option>
                      {members.map((m) => { const n = memberName(m); return <option key={n} value={n}>{n}</option>; })}
                    </select>
                  </label>
                  <label style={labelStyle}>Company
                    <select value={newCompanyId} onChange={(e) => setNewCompanyId(e.target.value)} required style={inputStyle}>
                      <option value="">Select company...</option>
                      {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                  <label style={labelStyle}>Due Date <DateInput value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} required style={inputStyle} /></label>
                  <label style={labelStyle}>Priority
                    <select value={newPriority} onChange={(e) => setNewPriority(e.target.value)} style={inputStyle}>
                      {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
                    </select>
                  </label>
                  <label style={labelStyle}>Project <input value={newProject} onChange={(e) => setNewProject(e.target.value)} placeholder="Optional" style={inputStyle} /></label>
                </div>
                {taskError && <div style={{ color: COLOURS.RED, fontSize: "12.5px", marginTop: "8px" }}>{taskError}</div>}
                <button type="submit" disabled={savingTask} style={{
                  backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px",
                  padding: "9px 18px", fontSize: "15px", fontWeight: 700, cursor: "pointer", marginTop: "8px",
                  opacity: savingTask ? 0.5 : 1,
                }}>{savingTask ? "Assigning..." : "Assign Task"}</button>
              </form>
            </div>
          )}

          {loading ? (
            <PASkeleton isMobile={isMobile} />
          ) : (
            <>
              {/* ═══ KPI CARDS + DONUT — two-column overview ═══ */}
              <div style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "1fr minmax(200px, 280px)",
                gap: "16px", marginBottom: "20px",
              }}>
                {/* Left: KPI grid */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "10px",
                }}>
                  <KPICard value={overdueTasks.length} label="Overdue" color={overdueTasks.length > 0 ? COLOURS.RED : COLOURS.GREEN} />
                  <KPICard value={waitingReply.length} label="Waiting Reply" color={waitingReply.length > 0 ? COLOURS.AMBER : COLOURS.GREEN} />
                  <KPICard value={escalations.length} label="Escalations" color={escalations.length > 0 ? COLOURS.AMBER : COLOURS.GREEN} />
                  <KPICard value={upcomingTasks.length} label="Due This Week" color={COLOURS.BLUE} />
                  <KPICard value={openTasks.length} label="Open Tasks" color={COLOURS.NAVY} />
                  <KPICard value={meetingRequests.length} label="To Approve" color={meetingRequests.length > 0 ? COLOURS.BLUE : COLOURS.GREEN} />
                </div>

                {/* Right: Donut + quick stats */}
                <div style={{
                  backgroundColor: "var(--bg-card, white)", border: `1px solid var(--border-color, ${COLOURS.HAIRLINE})`,
                  borderRadius: "12px", overflow: "hidden",
                }}>
                  <div style={{
                    padding: "12px 16px", borderBottom: `1px solid var(--border-color, ${COLOURS.HAIRLINE})`,
                    display: "flex", alignItems: "center", gap: "8px",
                  }}>
                    <span style={{ fontSize: "14px" }}>📊</span>
                    <span style={{ fontSize: "14px", fontWeight: 700, color: `var(--text-primary, ${COLOURS.NAVY})` }}>Task Breakdown</span>
                  </div>
                  <div style={{ padding: "12px 16px" }}>
                    {donutData.length > 0 ? (
                      <>
                        <ResponsiveContainer width="100%" height={120}>
                          <PieChart>
                            <Pie data={donutData} cx="50%" cy="50%" innerRadius={30} outerRadius={48} dataKey="value" paddingAngle={2}>
                              {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                            </Pie>
                            <Tooltip formatter={(value, name) => [`${value} task${Number(value) > 1 ? "s" : ""}`, name]} />
                          </PieChart>
                        </ResponsiveContainer>
                        <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap", marginTop: "4px" }}>
                          {donutData.map((d) => (
                            <div key={d.name} style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "11px", color: `var(--text-secondary, ${COLOURS.SLATE})` }}>
                              <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: d.color }} /> {d.name} ({d.value})
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div style={{ textAlign: "center", padding: "20px 0", color: COLOURS.GREEN, fontSize: "14px", fontWeight: 600 }}>
                        All tasks completed!
                      </div>
                    )}
                    <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: `1px solid var(--border-color, ${COLOURS.HAIRLINE})`, display: "flex", justifyContent: "space-between", fontSize: "12px", color: `var(--text-secondary, ${COLOURS.SLATE})` }}>
                      <span>Completed this month</span>
                      <span style={{ fontWeight: 700, color: COLOURS.GREEN }}>{completedThisMonth}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Assign Task button ── */}
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "14px" }}>
                <button onClick={() => setShowNewTask(!showNewTask)} style={{
                  backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px",
                  padding: "10px 18px", fontSize: "15px", fontWeight: 700, cursor: "pointer",
                }}>
                  {showNewTask ? "Cancel" : "+ Assign Task"}
                </button>
              </div>

              {/* ═══ ACTION BANNER — overdue/waiting/escalations/approvals ═══ */}
              {bannerItems.length > 0 ? (
                <div style={{
                  border: `1px solid ${hasCritical ? "#fecaca" : COLOURS.BORDER}`,
                  borderLeft: `4px solid ${hasCritical ? COLOURS.RED : COLOURS.AMBER}`,
                  borderRadius: "8px",
                  backgroundColor: hasCritical ? "#fef2f2" : "#fffbeb",
                  overflow: "hidden", marginBottom: "14px",
                }}>
                  <div onClick={() => setBannerOpen(!bannerOpen)} style={{
                    padding: "12px 16px", cursor: "pointer",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ fontSize: "20px" }}>⚠</span>
                      <div>
                        <div style={{ fontSize: "16px", fontWeight: 700, color: hasCritical ? "#991b1b" : "#92400e" }}>
                          {bannerItems.reduce((s, b) => s + b.count, 0)} items need attention
                        </div>
                        <div style={{ fontSize: "13px", color: hasCritical ? "#991b1b" : "#92400e", marginTop: "1px" }}>
                          {bannerItems.map((b) => b.label).join(" · ")}
                        </div>
                      </div>
                    </div>
                    <span style={{ fontSize: "14px", fontWeight: 700, color: hasCritical ? "#991b1b" : "#92400e" }}>{bannerOpen ? "▲" : "▼"}</span>
                  </div>

                  {bannerOpen && (
                    <div style={{ borderTop: `1px solid ${hasCritical ? "#fecaca" : "#fde68a"}` }}>
                      {overdueTasks.length > 0 && (
                        <BannerSection title={`Overdue (${overdueTasks.length})`} color={COLOURS.RED}>
                          {overdueTasks.sort((a, b) => daysOverdue(b) - daysOverdue(a)).map((t) => (
                            <BannerItem key={t.id} href={`/tasks?task=${t.id}`} primary={t.description} secondary={`${t.assigned_to || "Unassigned"} · ${daysOverdue(t)}d late`} badge={t.priority} />
                          ))}
                        </BannerSection>
                      )}
                      {waitingReply.length > 0 && (
                        <BannerSection title={`Waiting Reply (${waitingReply.length})`} color={COLOURS.RED}>
                          {waitingReply.map((t) => (
                            <BannerItem key={t.id} href={`/tasks?task=${t.id}`} primary={t.description} secondary={`${t.assigned_to || "Unassigned"} · Due: ${formatDateUK(t.due_date)}`} badge={t.priority} />
                          ))}
                        </BannerSection>
                      )}
                      {escalations.length > 0 && (
                        <BannerSection title={`Escalations (${escalations.length})`} color={COLOURS.AMBER}>
                          {escalations.map((t) => (
                            <BannerItem key={t.id} href={`/tasks?task=${t.id}`} primary={t.description} secondary={t.assigned_to || "Unassigned"} />
                          ))}
                        </BannerSection>
                      )}
                      {meetingRequests.length > 0 && (
                        <BannerSection title={`Meetings to Approve (${meetingRequests.length})`} color={COLOURS.BLUE}>
                          {meetingRequests.map((r) => (
                            <div key={r.id} style={{ padding: "8px 16px 8px 48px", borderBottom: "1px solid var(--border-light, #f1f5f9)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div>
                                <div style={{ fontSize: "16px", fontWeight: 600, color: `var(--text-primary, ${COLOURS.NAVY})` }}>{r.meeting_title}</div>
                                <div style={{ fontSize: "14px", color: `var(--text-secondary, ${COLOURS.SLATE})` }}>{r.requested_by_name || "—"} · {formatDateUK(r.requested_date)}</div>
                              </div>
                              <button onClick={() => approveMeeting(r.id)} style={actionBtn(COLOURS.GREEN)}>Approve</button>
                            </div>
                          ))}
                        </BannerSection>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderLeft: `4px solid ${COLOURS.GREEN}`, borderRadius: "6px", padding: "12px 16px", backgroundColor: "var(--bg-card, #ffffff)", fontSize: "16px", color: `var(--text-primary, ${COLOURS.NAVY})`, fontWeight: 600, marginBottom: "14px" }}>
                  All clear — nothing needs your attention right now.
                </div>
              )}

              {/* ═══ TASK MANAGEMENT ═══ */}
              {/* Bulk action bar */}
              {bulkAction && selectedTasks.size > 0 && (
                <div style={{ display: "flex", gap: "6px", alignItems: "center", padding: "10px 14px", backgroundColor: "var(--bg-card-hover, #f8fafc)", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", marginBottom: "10px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "16px", fontWeight: 700, color: `var(--text-primary, ${COLOURS.NAVY})` }}>{selectedTasks.size} selected</span>
                  <button onClick={bulkComplete} style={actionBtn(COLOURS.GREEN)} title="Complete all selected">Complete All</button>
                  <select onChange={(e) => { if (e.target.value) bulkReassign(e.target.value); e.target.value = ""; }}
                    style={{ padding: "5px 8px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "13px" }}>
                    <option value="">Reassign to...</option>
                    {members.map((m) => { const n = memberName(m); return <option key={n} value={n}>{n}</option>; })}
                  </select>
                  <button onClick={() => { setSelectedTasks(new Set()); setBulkAction(false); }} style={actionBtn(COLOURS.SLATE)}>Cancel</button>
                </div>
              )}

              {/* Tab bar */}
              <div style={{ display: "flex", gap: "4px", marginBottom: "10px", flexWrap: "wrap", alignItems: "center" }}>
                {([
                  { key: "upcoming" as const, label: `Due This Week (${upcomingTasks.length})` },
                  { key: "people" as const, label: `By Person (${people.length})` },
                  { key: "all" as const, label: `All Open (${openTasks.length})` },
                ]).map((tab) => (
                  <button key={tab.key} onClick={() => { setActiveTab(tab.key); setViewPerson(null); }} style={{
                    backgroundColor: activeTab === tab.key ? COLOURS.NAVY : "var(--bg-card, #ffffff)",
                    color: activeTab === tab.key ? "white" : `var(--text-primary, ${COLOURS.NAVY})`,
                    border: `1px solid ${activeTab === tab.key ? COLOURS.NAVY : COLOURS.BORDER}`,
                    borderRadius: "6px", padding: "7px 14px", fontSize: "14px", fontWeight: 600, cursor: "pointer",
                  }}>{tab.label}</button>
                ))}
                <div style={{ flex: 1 }} />
                <button onClick={() => { setBulkAction(!bulkAction); setSelectedTasks(new Set()); }} style={{
                  backgroundColor: bulkAction ? COLOURS.AMBER : "var(--bg-card, #ffffff)", color: bulkAction ? "white" : `var(--text-primary, ${COLOURS.NAVY})`,
                  border: `1px solid ${bulkAction ? COLOURS.AMBER : COLOURS.BORDER}`,
                  borderRadius: "6px", padding: "6px 12px", fontSize: "13px", fontWeight: 600, cursor: "pointer",
                }} title="Select multiple tasks for bulk actions">{bulkAction ? "Cancel Select" : "Bulk Select"}</button>
              </div>

              {/* Tab content */}
              <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "var(--bg-card, #ffffff)", overflow: "hidden", marginBottom: "14px" }}>
                {activeTab === "upcoming" && (
                  upcomingTasks.length === 0 ? (
                    <div style={{ padding: "16px", color: `var(--text-secondary, ${COLOURS.SLATE})`, textAlign: "center" }}>No tasks due in the next 7 days.</div>
                  ) : (
                    <div style={{ maxHeight: "500px", overflowY: "auto" }}>
                      {upcomingTasks.map((t) => {
                        const d = daysUntil(t.due_date!);
                        const urgency = d <= 1 ? COLOURS.RED : d <= 3 ? COLOURS.AMBER : COLOURS.SLATE;
                        return (
                          <div key={t.id} style={{ borderBottom: `1px solid ${COLOURS.BORDER}`, padding: "9px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: "16px", fontWeight: 600, color: `var(--text-primary, ${COLOURS.NAVY})`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</div>
                              <div style={{ fontSize: "14px", color: `var(--text-secondary, ${COLOURS.SLATE})` }}>{t.assigned_to || "Unassigned"}</div>
                            </div>
                            <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0 }}>
                              <span style={{ fontSize: "13px", fontWeight: 700, color: urgency }}>
                                {d === 0 ? "Today" : d === 1 ? "Tomorrow" : `${d} days`}
                              </span>
                              <PriorityBadge priority={t.priority} />
                              <a href={`/tasks?task=${t.id}`} style={{ fontSize: "12px", color: COLOURS.BLUE, fontWeight: 600, textDecoration: "none" }}>Open →</a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )
                )}

                {activeTab === "people" && !viewPerson && (
                  <div>
                    {people.map((p) => (
                      <div key={p.name} onClick={() => setViewPerson(p.name)}
                        style={{ borderBottom: `1px solid ${COLOURS.BORDER}`, padding: "9px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
                        <div>
                          <span style={{ fontWeight: 600, fontSize: "16px", color: `var(--text-primary, ${COLOURS.NAVY})` }}>{p.name}</span>
                          <span style={{ color: `var(--text-secondary, ${COLOURS.SLATE})`, fontSize: "15px", marginLeft: "6px" }}>({p.total} tasks)</span>
                        </div>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          {p.overdue > 0 && <span style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.RED }}>{p.overdue} overdue</span>}
                          {p.waiting > 0 && <span style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.AMBER }}>{p.waiting} waiting</span>}
                          {p.overdue === 0 && p.waiting === 0 && <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: COLOURS.GREEN, display: "inline-block" }} />}
                          <span style={{ color: `var(--text-secondary, ${COLOURS.SLATE})`, fontSize: "15px" }}>▶</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === "people" && viewPerson && viewTasks && (
                  <>
                    <div style={{ padding: "10px 14px", backgroundColor: "var(--bg-card-hover, #f8fafc)", borderBottom: `1px solid ${COLOURS.BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "15px", fontWeight: 700, color: `var(--text-primary, ${COLOURS.NAVY})` }}>{viewPerson} — {viewTasks.length} tasks</span>
                      <button onClick={() => setViewPerson(null)} style={{ background: "transparent", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "5px", padding: "4px 10px", fontSize: "15px", color: `var(--text-secondary, ${COLOURS.SLATE})`, cursor: "pointer" }}>← Back</button>
                    </div>
                    <div style={{ maxHeight: "500px", overflowY: "auto" }}>
                      {viewTasks.sort((a, b) => daysOverdue(b) - daysOverdue(a)).map((t) => <TaskCard key={t.id} task={t} />)}
                    </div>
                  </>
                )}

                {activeTab === "all" && (
                  <div style={{ maxHeight: "600px", overflowY: "auto" }}>
                    {openTasks.map((t) => <TaskCard key={t.id} task={t} />)}
                  </div>
                )}
              </div>

              {/* ── Dividend Calendar (confirmed only — no financial figures) ── */}
              {paDividends.length > 0 && (
                <div style={{ marginBottom: "16px" }}>
                  <SectionTitle title="Dividend Dates — Next 14 Days" />
                  <div style={{
                    border: `1px solid ${COLOURS.BORDER}`,
                    borderTop: `3px solid ${COLOURS.AMBER}`,
                    borderRadius: "8px",
                    backgroundColor: "var(--bg-card, #ffffff)",
                    overflow: "hidden",
                  }}>
                    {paDividends.map((d, i) => (
                      <div key={d.id} style={{
                        display: "flex", alignItems: "center", gap: "12px",
                        padding: "9px 14px",
                        borderBottom: i < paDividends.length - 1 ? `1px solid var(--border-light, #f1f5f9)` : "none",
                      }}>
                        <span style={{ fontWeight: 700, fontSize: "14px", color: COLOURS.NAVY, minWidth: "60px" }}>{d.ticker}</span>
                        <span style={{ fontSize: "13px", color: `var(--text-secondary, ${COLOURS.SLATE})`, flex: 1 }}>
                          Ex-date: <strong>{formatDateUK(d.ex_dividend_date)}</strong>
                          {d.payment_date && <> &nbsp;·&nbsp; Pay: {formatDateUK(d.payment_date)}</>}
                        </span>
                        <span style={{
                          fontSize: "12px", fontWeight: 700, padding: "2px 8px", borderRadius: "10px",
                          color: "white",
                          backgroundColor: d.days_to_ex <= 3 ? COLOURS.RED : d.days_to_ex <= 7 ? COLOURS.AMBER : COLOURS.GREEN,
                        }}>
                          {d.days_to_ex === 0 ? "Today" : d.days_to_ex === 1 ? "Tomorrow" : `${d.days_to_ex}d`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Purpose Statement ── */}
              <div style={{
                backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                borderLeft: "4px solid var(--text-primary)",
                borderRadius: "8px", padding: isMobile ? "10px 12px" : "12px 18px",
                fontSize: isMobile ? "12px" : "14px", color: "var(--text-primary)",
                lineHeight: 1.7, fontStyle: "italic", fontWeight: 600,
              }}>
                &ldquo;Through service and sustainable business growth, we create opportunities that enhance the lifestyle of our employees, customers, and the community we operate in.&rdquo;
              </div>
            </>
          )}
        </main>
    </AuthWrapper>
  );
}

function KPICard({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div style={{
      border: `1px solid var(--border-color, ${COLOURS.HAIRLINE})`, borderTop: `3px solid ${color}`,
      borderRadius: "12px", padding: "14px 16px", backgroundColor: "var(--bg-card, white)",
    }}>
      <div style={{ fontSize: "26px", fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: "12px", color: `var(--text-secondary, ${COLOURS.SLATE})`, marginTop: "6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
    </div>
  );
}

function PASkeleton({ isMobile }: { isMobile: boolean }) {
  const pulse: React.CSSProperties = {
    borderRadius: "6px",
    background: `linear-gradient(90deg, var(--border-color, ${COLOURS.HAIRLINE}) 25%, var(--border-light, #f1f5f9) 50%, var(--border-color, ${COLOURS.HAIRLINE}) 75%)`,
    backgroundSize: "200% 100%",
    animation: "shimmer 1.5s ease-in-out infinite",
  };
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr minmax(200px, 280px)", gap: "16px", marginBottom: "20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} style={{ backgroundColor: "var(--bg-card, white)", border: `1px solid var(--border-color, ${COLOURS.HAIRLINE})`, borderRadius: "12px", padding: "14px 16px" }}>
              <div style={{ ...pulse, width: "40px", height: "26px" }} />
              <div style={{ ...pulse, width: "70px", height: "12px", marginTop: "8px" }} />
            </div>
          ))}
        </div>
        <div style={{ backgroundColor: "var(--bg-card, white)", border: `1px solid var(--border-color, ${COLOURS.HAIRLINE})`, borderRadius: "12px", padding: "16px" }}>
          <div style={{ ...pulse, width: "100px", height: "14px", marginBottom: "12px" }} />
          <div style={{ ...pulse, width: "100%", height: "120px", borderRadius: "50%" }} />
        </div>
      </div>
      <div style={{ backgroundColor: "var(--bg-card, white)", border: `1px solid var(--border-color, ${COLOURS.HAIRLINE})`, borderRadius: "12px", padding: "16px" }}>
        <div style={{ ...pulse, width: "120px", height: "14px", marginBottom: "12px" }} />
        {[1, 2, 3, 4, 5].map((i) => <div key={i} style={{ ...pulse, width: "100%", height: "14px", marginBottom: "10px" }} />)}
      </div>
    </div>
  );
}

function BannerSection({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ padding: "8px 16px", fontSize: "15px", fontWeight: 700, color, borderBottom: "1px solid var(--border-light, #f1f5f9)" }}>{title}</div>
      <div style={{ backgroundColor: "var(--bg-card, #ffffff)" }}>{children}</div>
    </div>
  );
}

function BannerItem({ href, primary, secondary, badge }: { href: string; primary: string; secondary: string; badge?: string | null }) {
  return (
    <a href={href} style={{ textDecoration: "none", color: "inherit", display: "block", borderBottom: "1px solid var(--border-light, #f1f5f9)" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "var(--bg-card-hover, #f8fafc)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "transparent"; }}>
      <div style={{ padding: "7px 16px 7px 48px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "15px", fontWeight: 600, color: `var(--text-primary, ${COLOURS.NAVY})` }}>{primary}</div>
          <div style={{ fontSize: "14px", color: `var(--text-secondary, ${COLOURS.SLATE})` }}>{secondary}</div>
        </div>
        <div style={{ display: "flex", gap: "4px", alignItems: "center", flexShrink: 0 }}>
          {badge && <PriorityBadge priority={badge} />}
          <span style={{ fontSize: "12px", color: COLOURS.BLUE, fontWeight: 600 }}>Open →</span>
        </div>
      </div>
    </a>
  );
}

const actionBtn = (color: string): React.CSSProperties => ({
  backgroundColor: color, color: "white", border: "none", borderRadius: "5px",
  padding: "5px 12px", fontSize: "12px", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
});

const controlStyle: React.CSSProperties = {
  padding: "5px 8px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "15px",
  backgroundColor: "var(--bg-input, #ffffff)", color: `var(--text-primary, ${COLOURS.NAVY})`,
};

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "16px", fontWeight: 600, color: `var(--text-primary, ${COLOURS.NAVY})`, marginBottom: "6px",
};

const inputStyle: React.CSSProperties = {
  display: "block", width: "100%", padding: "7px 10px", marginTop: "3px",
  border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "15px", boxSizing: "border-box",
  backgroundColor: "var(--bg-input, #ffffff)", color: `var(--text-primary, ${COLOURS.NAVY})`,
};
