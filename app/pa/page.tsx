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
import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

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
  const [bannerOpen, setBannerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"upcoming" | "people" | "all">("upcoming");

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
    logAction("Updated", "tasks", `PA updated ${Object.keys(updates).join(", ")}`, id);
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

    const assignedMember = members.find((m) => memberName(m) === newAssignTo);

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
  const completedTasks = tasks.filter((t) => t.status === "Completed");
  const overdueTasks = openTasks.filter(isOverdue);
  const waitingReply = openTasks.filter((t) => t.status === "Waiting Reply");
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

  // Chart data
  const donutData = [
    { name: "Overdue", value: overdueTasks.length, color: COLOURS.RED },
    { name: "Waiting Reply", value: waitingReply.length, color: "#d97706" },
    { name: "In Progress", value: openTasks.filter((t) => t.status === "In Progress").length, color: "#2563eb" },
    { name: "Not Started", value: openTasks.filter((t) => t.status === "Not Started").length, color: COLOURS.SLATE },
  ].filter((d) => d.value > 0);

  const personChartData = people.slice(0, 8).map((p) => ({
    name: p.name.length > 12 ? p.name.slice(0, 10) + "…" : p.name,
    Overdue: p.overdue,
    Active: p.total - p.overdue,
  }));

  // Banner items
  const bannerItems: { label: string; count: number; color: string }[] = [];
  if (overdueTasks.length > 0) bannerItems.push({ label: `${overdueTasks.length} overdue task${overdueTasks.length > 1 ? "s" : ""}`, count: overdueTasks.length, color: COLOURS.RED });
  if (waitingReply.length > 0) bannerItems.push({ label: `${waitingReply.length} waiting repl${waitingReply.length > 1 ? "ies" : "y"}`, count: waitingReply.length, color: COLOURS.RED });
  if (escalations.length > 0) bannerItems.push({ label: `${escalations.length} escalation${escalations.length > 1 ? "s" : ""}`, count: escalations.length, color: "#d97706" });
  if (meetingRequests.length > 0) bannerItems.push({ label: `${meetingRequests.length} meeting${meetingRequests.length > 1 ? "s" : ""} to approve`, count: meetingRequests.length, color: "#2563eb" });
  const hasCritical = overdueTasks.length > 0 || escalations.length > 0;

  function TaskCard({ task }: { task: Task }) {
    const isExpanded = expandedTask === task.id;
    const od = daysOverdue(task);
    return (
      <div style={{ borderBottom: `1px solid ${COLOURS.BORDER}`, backgroundColor: isOverdue(task) ? "#fef2f2" : "white" }}>
        <div onClick={() => setExpandedTask(isExpanded ? null : task.id)}
          style={{ padding: "9px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.description}</div>
            <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
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
          <span style={{ color: COLOURS.SLATE, fontSize: "13px", flexShrink: 0 }}>{isExpanded ? "▼" : "▶"}</span>
        </div>

        {isExpanded && (
          <div style={{ padding: "8px 14px 12px", backgroundColor: "#f8fafc", borderTop: `1px solid ${COLOURS.BORDER}` }}>
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
              <input type="date" value={task.due_date || ""} onChange={(e) => updateTask(task.id, { due_date: e.target.value || null })} style={controlStyle} />
              <select value={task.assigned_to || ""} onChange={(e) => {
                const m = members.find((mem) => memberName(mem) === e.target.value);
                updateTask(task.id, { assigned_to: e.target.value, assigned_to_email: m?.email || null, assigned_to_department: m?.department || null });
              }} style={controlStyle}>
                <option value="">Reassign...</option>
                {members.map((m) => { const n = memberName(m); return <option key={n} value={n}>{n}</option>; })}
              </select>
            </div>
            <div style={{ display: "flex", gap: "6px" }}>
              <button onClick={() => chaseTask(task)} style={actionBtn("#2563eb")}>Chase</button>
              <button onClick={() => closeTask(task.id)} style={actionBtn(COLOURS.GREEN)}>Complete</button>
            </div>
            <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "6px" }}>
              By: {task.assigned_by || "—"} · Dept: {task.assigned_to_department || "—"} · Project: {task.project || "—"}
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
            <PageHeader title="PA Command Centre" subtitle="Chase, close, reassign, allocate — full task control" />
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

          {/* ── New task form ── */}
          {showNewTask && (
            <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white", marginBottom: "14px" }}>
              <SectionTitle title="Assign a New Task" />
              <form onSubmit={createNewTask}>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "8px" }}>
                  <label style={labelStyle}>Task <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="What needs to be done" required style={inputStyle} /></label>
                  <label style={labelStyle}>Assign To
                    <select value={newAssignTo} onChange={(e) => setNewAssignTo(e.target.value)} required style={inputStyle}>
                      <option value="">Select person...</option>
                      {members.map((m) => { const n = memberName(m); return <option key={n} value={n}>{n}</option>; })}
                    </select>
                  </label>
                  <label style={labelStyle}>Due Date <input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} style={inputStyle} /></label>
                  <label style={labelStyle}>Priority
                    <select value={newPriority} onChange={(e) => setNewPriority(e.target.value)} style={inputStyle}>
                      {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
                    </select>
                  </label>
                  <label style={labelStyle}>Project <input value={newProject} onChange={(e) => setNewProject(e.target.value)} placeholder="Optional" style={inputStyle} /></label>
                </div>
                <button type="submit" disabled={savingTask} style={{
                  backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "6px",
                  padding: "9px 18px", fontSize: "15px", fontWeight: 700, cursor: "pointer", marginTop: "8px",
                  opacity: savingTask ? 0.5 : 1,
                }}>{savingTask ? "Assigning..." : "Assign Task"}</button>
              </form>
            </div>
          )}

          {loading ? (
            <p style={{ color: COLOURS.SLATE }}>Loading...</p>
          ) : (
            <>
              {/* ═══ ZONE 1: ACTION BANNER ═══ */}
              {bannerItems.length > 0 ? (
                <div style={{
                  border: `1px solid ${hasCritical ? "#fecaca" : COLOURS.BORDER}`,
                  borderLeft: `4px solid ${hasCritical ? COLOURS.RED : "#d97706"}`,
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
                        <BannerSection title={`Escalations (${escalations.length})`} color="#d97706">
                          {escalations.map((t) => (
                            <BannerItem key={t.id} href={`/tasks?task=${t.id}`} primary={t.description} secondary={t.assigned_to || "Unassigned"} />
                          ))}
                        </BannerSection>
                      )}
                      {meetingRequests.length > 0 && (
                        <BannerSection title={`Meetings to Approve (${meetingRequests.length})`} color="#2563eb">
                          {meetingRequests.map((r) => (
                            <div key={r.id} style={{ padding: "8px 16px 8px 48px", borderBottom: `1px solid #f1f5f9`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div>
                                <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>{r.meeting_title}</div>
                                <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>{r.requested_by_name || "—"} · {formatDateUK(r.requested_date)}</div>
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
                <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderLeft: `4px solid ${COLOURS.GREEN}`, borderRadius: "6px", padding: "12px 16px", backgroundColor: "white", fontSize: "16px", color: COLOURS.NAVY, fontWeight: 600, marginBottom: "14px" }}>
                  All clear — nothing needs your attention right now.
                </div>
              )}

              {/* ═══ ZONE 2: CHARTS ROW ═══ */}
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 2fr", gap: "14px", marginBottom: "14px" }}>
                {/* Task status donut */}
                <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white" }}>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "6px" }}>Task Status</div>
                  <div style={{ fontSize: "24px", fontWeight: 800, color: COLOURS.NAVY, textAlign: "center" }}>{openTasks.length} <span style={{ fontSize: "14px", fontWeight: 400, color: COLOURS.SLATE }}>open</span></div>
                  {donutData.length > 0 && (
                    <ResponsiveContainer width="100%" height={160}>
                      <PieChart>
                        <Pie data={donutData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={2}>
                          {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                        </Pie>
                        <Tooltip formatter={(value, name) => [`${value} tasks`, name]} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                  <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap", marginTop: "4px" }}>
                    {donutData.map((d) => (
                      <div key={d.name} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: COLOURS.SLATE }}>
                        <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: d.color, display: "inline-block" }} />
                        {d.name} ({d.value})
                      </div>
                    ))}
                  </div>
                  <div style={{ textAlign: "center", marginTop: "8px", fontSize: "13px", color: COLOURS.GREEN, fontWeight: 600 }}>
                    {completedTasks.length} completed total
                  </div>
                </div>

                {/* Person workload bar chart */}
                {personChartData.length > 0 && (
                  <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white" }}>
                    <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "6px" }}>Workload by Person</div>
                    <ResponsiveContainer width="100%" height={Math.max(160, personChartData.length * 32)}>
                      <BarChart data={personChartData} layout="vertical" margin={{ left: 10, right: 10, top: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11, fill: COLOURS.SLATE }} allowDecimals={false} />
                        <YAxis dataKey="name" type="category" tick={{ fontSize: 12, fill: COLOURS.NAVY, fontWeight: 600 }} width={90} />
                        <Tooltip />
                        <Bar dataKey="Overdue" stackId="a" fill={COLOURS.RED} name="Overdue (red)" radius={[0, 0, 0, 0]} />
                        <Bar dataKey="Active" stackId="a" fill="#2563eb" name="Active (blue)" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* ═══ ZONE 3: TASK MANAGEMENT ═══ */}
              {/* Tab bar */}
              <div style={{ display: "flex", gap: "4px", marginBottom: "10px" }}>
                {([
                  { key: "upcoming" as const, label: `Due This Week (${upcomingTasks.length})` },
                  { key: "people" as const, label: `By Person (${people.length})` },
                  { key: "all" as const, label: `All Open (${openTasks.length})` },
                ]).map((tab) => (
                  <button key={tab.key} onClick={() => { setActiveTab(tab.key); setViewPerson(null); }} style={{
                    backgroundColor: activeTab === tab.key ? COLOURS.NAVY : "white",
                    color: activeTab === tab.key ? "white" : COLOURS.NAVY,
                    border: `1px solid ${activeTab === tab.key ? COLOURS.NAVY : COLOURS.BORDER}`,
                    borderRadius: "6px", padding: "7px 14px", fontSize: "14px", fontWeight: 600, cursor: "pointer",
                  }}>{tab.label}</button>
                ))}
              </div>

              {/* Tab content */}
              <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden", marginBottom: "14px" }}>
                {activeTab === "upcoming" && (
                  upcomingTasks.length === 0 ? (
                    <div style={{ padding: "16px", color: COLOURS.SLATE, textAlign: "center" }}>No tasks due in the next 7 days.</div>
                  ) : (
                    <div style={{ maxHeight: "500px", overflowY: "auto" }}>
                      {upcomingTasks.map((t) => {
                        const d = daysUntil(t.due_date!);
                        const urgency = d <= 1 ? COLOURS.RED : d <= 3 ? "#d97706" : COLOURS.SLATE;
                        return (
                          <div key={t.id} style={{ borderBottom: `1px solid ${COLOURS.BORDER}`, padding: "9px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</div>
                              <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>{t.assigned_to || "Unassigned"}</div>
                            </div>
                            <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0 }}>
                              <span style={{ fontSize: "13px", fontWeight: 700, color: urgency }}>
                                {d === 0 ? "Today" : d === 1 ? "Tomorrow" : `${d} days`}
                              </span>
                              <PriorityBadge priority={t.priority} />
                              <a href={`/tasks?task=${t.id}`} style={{ fontSize: "12px", color: "#2563eb", fontWeight: 600, textDecoration: "none" }}>Open →</a>
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
                          <span style={{ fontWeight: 600, fontSize: "14px", color: COLOURS.NAVY }}>{p.name}</span>
                          <span style={{ color: COLOURS.SLATE, fontSize: "13px", marginLeft: "6px" }}>({p.total} tasks)</span>
                        </div>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          {p.overdue > 0 && <span style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.RED }}>{p.overdue} overdue</span>}
                          {p.waiting > 0 && <span style={{ fontSize: "12px", fontWeight: 700, color: "#d97706" }}>{p.waiting} waiting</span>}
                          {p.overdue === 0 && p.waiting === 0 && <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: COLOURS.GREEN, display: "inline-block" }} />}
                          <span style={{ color: COLOURS.SLATE, fontSize: "13px" }}>▶</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === "people" && viewPerson && viewTasks && (
                  <>
                    <div style={{ padding: "10px 14px", backgroundColor: "#f8fafc", borderBottom: `1px solid ${COLOURS.BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>{viewPerson} — {viewTasks.length} tasks</span>
                      <button onClick={() => setViewPerson(null)} style={{ background: "transparent", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "5px", padding: "4px 10px", fontSize: "13px", color: COLOURS.SLATE, cursor: "pointer" }}>← Back</button>
                    </div>
                    <div style={{ maxHeight: "500px", overflowY: "auto" }}>
                      {viewTasks.sort((a, b) => daysOverdue(b) - daysOverdue(a)).map((t) => <TaskCard key={t.id} task={t} />)}
                    </div>
                  </>
                )}

                {activeTab === "all" && (
                  <div style={{ maxHeight: "500px", overflowY: "auto" }}>
                    {openTasks.slice(0, 50).map((t) => <TaskCard key={t.id} task={t} />)}
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </RoleGuard>
    </AuthWrapper>
  );
}

function BannerSection({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ padding: "8px 16px", fontSize: "13px", fontWeight: 700, color, borderBottom: `1px solid #f1f5f9` }}>{title}</div>
      <div style={{ backgroundColor: "white" }}>{children}</div>
    </div>
  );
}

function BannerItem({ href, primary, secondary, badge }: { href: string; primary: string; secondary: string; badge?: string | null }) {
  return (
    <a href={href} style={{ textDecoration: "none", color: "inherit", display: "block", borderBottom: `1px solid #f1f5f9` }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "#f8fafc"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "transparent"; }}>
      <div style={{ padding: "7px 16px 7px 48px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>{primary}</div>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>{secondary}</div>
        </div>
        <div style={{ display: "flex", gap: "4px", alignItems: "center", flexShrink: 0 }}>
          {badge && <PriorityBadge priority={badge} />}
          <span style={{ fontSize: "12px", color: "#2563eb", fontWeight: 600 }}>Open →</span>
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
  padding: "5px 8px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "13px",
};

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "6px",
};

const inputStyle: React.CSSProperties = {
  display: "block", width: "100%", padding: "7px 10px", marginTop: "3px",
  border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "15px", boxSizing: "border-box",
};
