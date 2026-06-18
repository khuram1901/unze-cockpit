"use client";

// HARD RULE: This page must NEVER display cash, financial figures, or finance-related data.

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import RoleGuard from "../lib/RoleGuard";
import { supabase } from "../lib/supabase";
import { formatDateUK, todayISO } from "../lib/dateUtils";
import { useMobile } from "../lib/useMobile";
import { logAction } from "../lib/audit-log";
import {
  COLOURS,
  SectionTitle,
  PageHeader,
  StatusBadge,
  PriorityBadge,
} from "../lib/SharedUI";

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
};

const today = new Date().toISOString().slice(0, 10);
const STATUSES = ["Not Started", "In Progress", "Waiting Reply", "Completed", "Cancelled"];
const PRIORITIES = ["Low", "Normal", "High", "Urgent"];

function isOverdue(task: Task): boolean {
  if (task.status === "Completed" || task.status === "Cancelled") return false;
  return !!task.due_date && task.due_date < today;
}

function daysOverdue(task: Task): number {
  if (!task.due_date || !isOverdue(task)) return 0;
  return Math.floor((Date.now() - new Date(task.due_date + "T00:00:00").getTime()) / 86400000);
}

export default function PADashboardPage() {
  const isMobile = useMobile();
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [meetingRequests, setMeetingRequests] = useState<MeetingRequest[]>([]);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [viewPerson, setViewPerson] = useState<string | null>(null);

  // New task form
  const [showNewTask, setShowNewTask] = useState(false);
  const [newDesc, setNewDesc] = useState("");
  const [newAssignTo, setNewAssignTo] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newPriority, setNewPriority] = useState("Normal");
  const [newProject, setNewProject] = useState("");
  const [savingTask, setSavingTask] = useState(false);

  useEffect(() => { loadData(); }, []);

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

    const [tasksRes, meetingsRes, membersRes] = await Promise.all([
      supabase.from("tasks").select("*").order("created_at", { ascending: false }),
      supabase.from("meeting_requests").select("*").eq("status", "Pending").order("created_at", { ascending: false }),
      supabase.from("members").select("first_name, last_name, name, email, department"),
    ]);

    setTasks(tasksRes.data || []);
    setMeetingRequests(meetingsRes.data || []);
    setMembers(membersRes.data || []);
    setLoading(false);
  }

  function showMsg(text: string) { setMessage(text); setTimeout(() => setMessage(""), 3000); }

  async function updateTask(id: string, updates: Record<string, unknown>) {
    await supabase.from("tasks").update({ ...updates, updated_at: new Date().toISOString() }).eq("id", id);
    const fields = Object.keys(updates).join(", ");
    logAction("Updated", "tasks", `PA updated ${fields}`, id);
    loadData();
  }

  async function closeTask(id: string) {
    await updateTask(id, { status: "Completed" });
    showMsg("Task closed.");
  }

  async function chaseTask(task: Task) {
    if (task.assigned_to_email) {
      fetch("/api/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "task_assigned", taskId: task.id, recipientEmail: task.assigned_to_email }),
      }).catch(() => {});
    }
    showMsg(`Chase sent to ${task.assigned_to || "assignee"}.`);
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
    if (!newDesc.trim() || !newAssignTo) return;
    setSavingTask(true);

    const assignedMember = members.find((m) => {
      const name = `${m.first_name || ""} ${m.last_name || ""}`.trim() || m.name;
      return name === newAssignTo;
    });

    const { data: newTask } = await supabase.from("tasks").insert({
      description: newDesc,
      assigned_to: newAssignTo,
      assigned_to_email: assignedMember?.email || null,
      assigned_by: currentUserName || "PA",
      assigned_date: todayISO(),
      due_date: newDueDate || null,
      priority: newPriority,
      project: newProject || null,
      status: "Not Started",
      task_type: "Task",
      assigned_to_department: assignedMember?.department || null,
    }).select("id").single();

    logAction("Created", "tasks", `PA assigned: ${newDesc} → ${newAssignTo}`);

    if (assignedMember?.email && newTask?.id) {
      fetch("/api/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "task_assigned", taskId: newTask.id, recipientEmail: assignedMember.email }),
      }).catch(() => {});
    }

    setSavingTask(false);
    setNewDesc(""); setNewAssignTo(""); setNewDueDate(""); setNewPriority("Normal"); setNewProject("");
    setShowNewTask(false);
    showMsg(`Task assigned to ${newAssignTo}.`);
    loadData();
  }

  const openTasks = tasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled");
  const overdueTasks = openTasks.filter(isOverdue);
  const waitingReply = openTasks.filter((t) => t.status === "Waiting Reply");
  const escalations = openTasks.filter((t) => t.source_type === "kpi_escalation" || t.source_type === "receivable_escalation");
  const myTasks = openTasks.filter((t) => t.assigned_to === currentUserName || (currentUserEmail && t.assigned_to === currentUserEmail));

  // Group by person
  const personMap = new Map<string, Task[]>();
  for (const t of openTasks) {
    const person = t.assigned_to || "Unassigned";
    if (!personMap.has(person)) personMap.set(person, []);
    personMap.get(person)!.push(t);
  }
  const people = Array.from(personMap.entries())
    .map(([name, tks]) => ({ name, tasks: tks, overdue: tks.filter(isOverdue).length }))
    .sort((a, b) => b.overdue - a.overdue);

  const viewTasks = viewPerson ? (personMap.get(viewPerson) || []) : null;

  function toggleSection(s: string) { setExpandedSection((prev) => prev === s ? null : s); setViewPerson(null); }

  function SummaryCard({ label, count, color, section }: { label: string; count: number; color: string; section: string }) {
    return (
      <div onClick={() => count > 0 && toggleSection(section)} style={{
        border: `1px solid ${COLOURS.BORDER}`, borderTop: `3px solid ${color}`,
        borderRadius: "7px", padding: "8px 10px",
        backgroundColor: expandedSection === section ? "#f8fafc" : "white",
        cursor: count > 0 ? "pointer" : "default",
      }}>
        <div style={{ color: COLOURS.SLATE, fontSize: "13px", marginBottom: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label} {count > 0 && "→"}</div>
        <div style={{ fontSize: "19px", fontWeight: 800, color }}>{count}</div>
      </div>
    );
  }

  function TaskCard({ task }: { task: Task }) {
    const isExpanded = expandedTask === task.id;
    return (
      <div style={{ borderBottom: `1px solid ${COLOURS.BORDER}`, backgroundColor: isOverdue(task) ? "#fef2f2" : "white" }}>
        <div onClick={() => setExpandedTask(isExpanded ? null : task.id)}
          style={{ padding: "10px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY }}>{task.description}</div>
            <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginTop: "3px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <span>{task.assigned_to || "Unassigned"}</span>
              {task.due_date && (
                <span style={{ color: isOverdue(task) ? COLOURS.RED : COLOURS.NAVY, fontWeight: isOverdue(task) ? 700 : 400 }}>
                  Due: {formatDateUK(task.due_date)}{isOverdue(task) && ` (${daysOverdue(task)}d late)`}
                </span>
              )}
              <PriorityBadge priority={task.priority} />
              <StatusBadge status={task.status} />
            </div>
          </div>
          <span style={{ color: COLOURS.SLATE, fontSize: "14px" }}>{isExpanded ? "▼" : "▶"}</span>
        </div>

        {isExpanded && (
          <div style={{ padding: "0 14px 14px", backgroundColor: "#f8fafc", borderTop: `1px solid ${COLOURS.BORDER}` }}>
            {task.reply_text && (
              <div style={{ marginTop: "8px", padding: "8px 10px", backgroundColor: "#fef3c7", borderRadius: "6px", fontSize: "14px" }}>
                <strong>Reply:</strong> {task.reply_text}
              </div>
            )}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" }}>
              <select value={task.status} onChange={(e) => updateTask(task.id, { status: e.target.value })}
                style={{ padding: "6px 10px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "14px" }}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
              <select value={task.priority || "Normal"} onChange={(e) => updateTask(task.id, { priority: e.target.value })}
                style={{ padding: "6px 10px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "14px" }}>
                {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
              </select>
              <input type="date" value={task.due_date || ""} onChange={(e) => updateTask(task.id, { due_date: e.target.value || null })}
                style={{ padding: "6px 10px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "14px" }} />
              <select value={task.assigned_to || ""} onChange={(e) => {
                const m = members.find((mem) => `${mem.first_name || ""} ${mem.last_name || ""}`.trim() === e.target.value || mem.name === e.target.value);
                updateTask(task.id, { assigned_to: e.target.value, assigned_to_email: m?.email || null, assigned_to_department: m?.department || null });
              }} style={{ padding: "6px 10px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "14px" }}>
                <option value="">Reassign...</option>
                {members.map((m) => {
                  const n = `${m.first_name || ""} ${m.last_name || ""}`.trim() || m.name || "";
                  return <option key={n} value={n}>{n}</option>;
                })}
              </select>
            </div>
            <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
              <button onClick={() => chaseTask(task)} style={actionBtn("#2563eb")}>Chase</button>
              <button onClick={() => closeTask(task.id)} style={actionBtn("#16a34a")}>Close</button>
            </div>
            <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "8px" }}>
              Assigned by: {task.assigned_by || "—"} · Dept: {task.assigned_to_department || "—"} · Project: {task.project || "—"}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <AuthWrapper>
      <RoleGuard allowedRoles={["Admin", "Executive"]}>
        <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
            <PageHeader title="PA Command Centre" subtitle="Full task management — chase, close, reassign, allocate" />
            <button onClick={() => setShowNewTask(!showNewTask)} style={{
              backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px",
              padding: "10px 18px", fontSize: "15px", fontWeight: 700, cursor: "pointer",
            }}>
              {showNewTask ? "Cancel" : "+ Assign Task"}
            </button>
          </div>

          {message && (
            <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderLeft: `4px solid ${COLOURS.GREEN}`, borderRadius: "6px", padding: "10px 14px", marginBottom: "14px", backgroundColor: "white", fontSize: "15px", color: COLOURS.NAVY }}>
              {message}
            </div>
          )}

          {/* New task form */}
          {showNewTask && (
            <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "16px", backgroundColor: "white", marginBottom: "16px" }}>
              <SectionTitle title="Assign a New Task" />
              <form onSubmit={createNewTask}>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px" }}>
                  <label style={labelStyle}>
                    Task Description
                    <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="What needs to be done" required style={inputStyle} />
                  </label>
                  <label style={labelStyle}>
                    Assign To
                    <select value={newAssignTo} onChange={(e) => setNewAssignTo(e.target.value)} required style={inputStyle}>
                      <option value="">Select person...</option>
                      {members.map((m) => {
                        const n = `${m.first_name || ""} ${m.last_name || ""}`.trim() || m.name || "";
                        return <option key={n} value={n}>{n} ({m.department || "No dept"})</option>;
                      })}
                    </select>
                  </label>
                  <label style={labelStyle}>
                    Due Date
                    <input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} style={inputStyle} />
                  </label>
                  <label style={labelStyle}>
                    Priority
                    <select value={newPriority} onChange={(e) => setNewPriority(e.target.value)} style={inputStyle}>
                      {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
                    </select>
                  </label>
                  <label style={labelStyle}>
                    Project / Company
                    <input value={newProject} onChange={(e) => setNewProject(e.target.value)} placeholder="Optional" style={inputStyle} />
                  </label>
                </div>
                <button type="submit" disabled={savingTask} style={{
                  backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px",
                  padding: "10px 20px", fontSize: "16px", fontWeight: 700, cursor: "pointer", marginTop: "10px",
                  opacity: savingTask ? 0.5 : 1,
                }}>
                  {savingTask ? "Assigning..." : "Assign Task"}
                </button>
              </form>
            </div>
          )}

          {loading ? (
            <p style={{ color: COLOURS.SLATE }}>Loading...</p>
          ) : (
            <>
              {/* Summary cards */}
              <div style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fit, minmax(140px, 1fr))",
                gap: "8px", marginBottom: "16px",
              }}>
                <SummaryCard label="Overdue" count={overdueTasks.length} color={COLOURS.RED} section="overdue" />
                <SummaryCard label="Waiting Reply" count={waitingReply.length} color={COLOURS.RED} section="waiting" />
                <SummaryCard label="Escalations" count={escalations.length} color={COLOURS.AMBER} section="escalations" />
                <SummaryCard label="Meetings" count={meetingRequests.length} color={COLOURS.BLUE} section="meetings" />
                <SummaryCard label="My Tasks" count={myTasks.length} color={COLOURS.PURPLE} section="mytasks" />
                <SummaryCard label="Total Open" count={openTasks.length} color={COLOURS.NAVY} section="all" />
              </div>

              {/* Expanded detail panel */}
              {expandedSection && !viewPerson && (
                <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "white", marginBottom: "16px", overflow: "hidden" }}>
                  <div style={{ padding: "10px 14px", backgroundColor: "#f8fafc", borderBottom: `1px solid ${COLOURS.BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "16px", fontWeight: 700, color: COLOURS.NAVY }}>
                      {expandedSection === "overdue" && `Overdue Tasks (${overdueTasks.length})`}
                      {expandedSection === "waiting" && `Waiting Reply (${waitingReply.length})`}
                      {expandedSection === "escalations" && `Active Escalations (${escalations.length})`}
                      {expandedSection === "meetings" && `Meeting Approvals (${meetingRequests.length})`}
                      {expandedSection === "mytasks" && `My Tasks (${myTasks.length})`}
                      {expandedSection === "all" && `All Open Tasks (${openTasks.length})`}
                    </span>
                    <button onClick={() => setExpandedSection(null)} style={{ background: "transparent", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", padding: "4px 10px", fontSize: "14px", color: COLOURS.SLATE, cursor: "pointer" }}>Close</button>
                  </div>
                  <div style={{ maxHeight: "500px", overflowY: "auto" }}>
                    {expandedSection === "overdue" && overdueTasks.sort((a, b) => daysOverdue(b) - daysOverdue(a)).map((t) => <TaskCard key={t.id} task={t} />)}
                    {expandedSection === "waiting" && waitingReply.map((t) => <TaskCard key={t.id} task={t} />)}
                    {expandedSection === "escalations" && escalations.map((t) => <TaskCard key={t.id} task={t} />)}
                    {expandedSection === "mytasks" && myTasks.map((t) => <TaskCard key={t.id} task={t} />)}
                    {expandedSection === "all" && openTasks.slice(0, 50).map((t) => <TaskCard key={t.id} task={t} />)}
                    {expandedSection === "meetings" && meetingRequests.map((r) => (
                      <div key={r.id} style={{ padding: "10px 14px", borderBottom: `1px solid ${COLOURS.BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: "15px", color: COLOURS.NAVY }}>{r.meeting_title}</div>
                          <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>{r.requested_by_name || "—"} · {r.requested_date ? formatDateUK(r.requested_date) : "No date"}</div>
                        </div>
                        <button onClick={() => approveMeeting(r.id)} style={actionBtn("#16a34a")}>Approve</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Person view — full task list for one person */}
              {viewPerson && viewTasks && (
                <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "white", marginBottom: "16px", overflow: "hidden" }}>
                  <div style={{ padding: "10px 14px", backgroundColor: "#f8fafc", borderBottom: `1px solid ${COLOURS.BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "16px", fontWeight: 700, color: COLOURS.NAVY }}>{viewPerson} — {viewTasks.length} open tasks</span>
                    <button onClick={() => setViewPerson(null)} style={{ background: "transparent", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", padding: "4px 10px", fontSize: "14px", color: COLOURS.SLATE, cursor: "pointer" }}>Close</button>
                  </div>
                  <div style={{ maxHeight: "500px", overflowY: "auto" }}>
                    {viewTasks.sort((a, b) => daysOverdue(b) - daysOverdue(a)).map((t) => <TaskCard key={t.id} task={t} />)}
                  </div>
                </div>
              )}

              {/* People breakdown */}
              <SectionTitle title="By Person" />
              <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden", marginBottom: "12px", maxWidth: isMobile ? "100%" : "400px" }}>
                {people.map((p) => (
                  <div key={p.name} onClick={() => { setViewPerson(p.name); setExpandedSection(null); }}
                    style={{ borderBottom: `1px solid ${COLOURS.BORDER}`, padding: "7px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                  >
                    <span style={{ fontWeight: 600, fontSize: "15px", color: COLOURS.NAVY }}>
                      {p.name} <span style={{ color: COLOURS.SLATE, fontWeight: 400 }}>({p.tasks.length})</span>
                    </span>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      {p.overdue > 0 && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                          <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: COLOURS.RED }} />
                          <span style={{ fontWeight: 700, fontSize: "14px", color: COLOURS.RED }}>{p.overdue}</span>
                        </span>
                      )}
                      {p.overdue === 0 && (
                        <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: COLOURS.GREEN, display: "inline-block" }} />
                      )}
                      <span style={{ color: COLOURS.SLATE, fontSize: "13px" }}>▶</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </main>
      </RoleGuard>
    </AuthWrapper>
  );
}

const actionBtn = (color: string): React.CSSProperties => ({
  backgroundColor: color, color: "white", border: "none", borderRadius: "5px",
  padding: "6px 14px", fontSize: "13px", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
});

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "8px",
};

const inputStyle: React.CSSProperties = {
  display: "block", width: "100%", padding: "8px 10px", marginTop: "3px",
  border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "16px", boxSizing: "border-box",
};
