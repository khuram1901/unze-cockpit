"use client";

// HARD RULE: This page must NEVER display cash, financial figures, or finance-related data.

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import RoleGuard from "../lib/RoleGuard";
import { supabase } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
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
  assigned_by: string | null;
  status: string;
  source_type: string | null;
  exception_type: string | null;
  assigned_to_department: string | null;
  created_at: string | null;
};

type MeetingRequest = {
  id: string;
  requested_by_name: string | null;
  meeting_title: string;
  requested_date: string | null;
  priority: string | null;
  status: string | null;
  created_at: string;
};

const today = new Date().toISOString().slice(0, 10);

function isOverdue(task: Task): boolean {
  if (task.status === "Completed" || task.status === "Cancelled") return false;
  if (!task.due_date) return false;
  return task.due_date < today;
}

function daysOverdue(task: Task): number {
  if (!task.due_date || !isOverdue(task)) return 0;
  return Math.floor((Date.now() - new Date(task.due_date + "T00:00:00").getTime()) / 86400000);
}

export default function PADashboardPage() {
  const isMobile = useMobile();
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [meetingRequests, setMeetingRequests] = useState<MeetingRequest[]>([]);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [message, setMessage] = useState("");

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
      if (member) {
        setCurrentUserName(`${member.first_name || ""} ${member.last_name || ""}`.trim() || member.name || email);
      }
    }

    const [tasksRes, meetingsRes] = await Promise.all([
      supabase.from("tasks").select("*").order("created_at", { ascending: false }),
      supabase.from("meeting_requests").select("*").eq("status", "Pending").order("created_at", { ascending: false }),
    ]);

    setTasks(tasksRes.data || []);
    setMeetingRequests(meetingsRes.data || []);
    setLoading(false);
  }

  async function approveMeeting(id: string) {
    await supabase.from("meeting_requests").update({
      status: "Approved",
      approved_by: currentUserName || currentUserEmail || "PA",
    }).eq("id", id);
    logAction("Updated", "meeting_requests", "Approved on CEO's behalf", id);
    loadData();
  }

  async function closeTask(id: string) {
    await supabase.from("tasks").update({
      status: "Completed",
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    logAction("Updated", "tasks", "Closed by PA", id);
    setMessage("Task closed.");
    setTimeout(() => setMessage(""), 3000);
    loadData();
  }

  async function chaseTask(task: Task) {
    if (!task.assigned_to) return;
    const recipient = tasks.find((t) => t.assigned_to === task.assigned_to);
    const email = recipient ? (recipient as Record<string, unknown>).assigned_to_email : null;
    if (email && typeof email === "string") {
      fetch("/api/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "task_assigned", taskId: task.id, recipientEmail: email }),
      }).catch(() => {});
    }
    setMessage(`Chase sent to ${task.assigned_to}.`);
    setTimeout(() => setMessage(""), 3000);
  }

  const openTasks = tasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled");
  const overdueTasks = openTasks.filter(isOverdue);
  const waitingReply = openTasks.filter((t) => t.status === "Waiting Reply");
  const escalations = openTasks.filter((t) => t.source_type === "kpi_escalation" || t.source_type === "receivable_escalation");
  const myTasks = openTasks.filter((t) => t.assigned_to === currentUserName || (currentUserEmail && t.assigned_to === currentUserEmail));

  // Group by department
  const deptMap = new Map<string, Task[]>();
  for (const t of openTasks) {
    const dept = t.assigned_to_department || "Unassigned";
    if (!deptMap.has(dept)) deptMap.set(dept, []);
    deptMap.get(dept)!.push(t);
  }
  const departments = Array.from(deptMap.entries())
    .map(([name, tks]) => ({ name, tasks: tks, overdue: tks.filter(isOverdue).length, waiting: tks.filter((t) => t.status === "Waiting Reply").length }))
    .sort((a, b) => b.overdue - a.overdue || b.waiting - a.waiting);

  function toggleSection(s: string) {
    setExpandedSection((prev) => prev === s ? null : s);
  }

  function SummaryCard({ label, count, color, section }: { label: string; count: number; color: string; section: string }) {
    return (
      <div
        onClick={() => count > 0 && toggleSection(section)}
        style={{
          border: `1px solid ${COLOURS.BORDER}`,
          borderTop: `3px solid ${color}`,
          borderRadius: "7px",
          padding: "10px 12px",
          backgroundColor: expandedSection === section ? "#f8fafc" : "white",
          cursor: count > 0 ? "pointer" : "default",
          transition: "box-shadow 0.15s",
        }}
      >
        <div style={{ color: COLOURS.SLATE, fontSize: "14px" }}>{label}</div>
        <div style={{ fontSize: "22px", fontWeight: 800, color }}>{count}</div>
      </div>
    );
  }

  function TaskRow({ task, showActions }: { task: Task; showActions?: boolean }) {
    return (
      <div style={{
        padding: "10px 12px",
        borderBottom: `1px solid ${COLOURS.BORDER}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: "8px",
        flexWrap: "wrap",
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY }}>{task.description}</div>
          <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginTop: "3px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <span>{task.assigned_to || "Unassigned"}</span>
            {task.due_date && (
              <span style={{ color: isOverdue(task) ? COLOURS.RED : COLOURS.NAVY, fontWeight: isOverdue(task) ? 700 : 400 }}>
                Due: {formatDateUK(task.due_date)}
                {isOverdue(task) && ` (${daysOverdue(task)}d late)`}
              </span>
            )}
            <PriorityBadge priority={task.priority} />
            <StatusBadge status={task.status} />
          </div>
        </div>
        {showActions && (
          <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
            <button onClick={() => chaseTask(task)} style={actionBtn("#2563eb")}>Chase</button>
            <button onClick={() => closeTask(task.id)} style={actionBtn("#16a34a")}>Close</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <AuthWrapper>
      <RoleGuard allowedRoles={["Admin", "Executive"]}>
        <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
          <PageHeader title="PA Command Centre" subtitle="Chase, close, and manage tasks across the company" />

          {message && (
            <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderLeft: `4px solid ${COLOURS.GREEN}`, borderRadius: "6px", padding: "10px 14px", marginBottom: "14px", backgroundColor: "white", fontSize: "15px", color: COLOURS.NAVY }}>
              {message}
            </div>
          )}

          {loading ? (
            <p style={{ color: COLOURS.SLATE }}>Loading…</p>
          ) : (
            <>
              {/* Summary cards */}
              <div style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fit, minmax(140px, 1fr))",
                gap: "8px",
                marginBottom: "16px",
              }}>
                <SummaryCard label="Overdue" count={overdueTasks.length} color={COLOURS.RED} section="overdue" />
                <SummaryCard label="Waiting Reply" count={waitingReply.length} color={COLOURS.RED} section="waiting" />
                <SummaryCard label="Escalations" count={escalations.length} color={COLOURS.AMBER} section="escalations" />
                <SummaryCard label="Meeting Approvals" count={meetingRequests.length} color={COLOURS.BLUE} section="meetings" />
                <SummaryCard label="My Tasks" count={myTasks.length} color={COLOURS.PURPLE} section="mytasks" />
                <SummaryCard label="Total Open" count={openTasks.length} color={COLOURS.NAVY} section="all" />
              </div>

              {/* Expanded detail panel */}
              {expandedSection && (
                <div style={{
                  border: `1px solid ${COLOURS.BORDER}`,
                  borderRadius: "8px",
                  backgroundColor: "white",
                  marginBottom: "16px",
                  overflow: "hidden",
                }}>
                  <div style={{
                    padding: "10px 14px",
                    backgroundColor: "#f8fafc",
                    borderBottom: `1px solid ${COLOURS.BORDER}`,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}>
                    <span style={{ fontSize: "16px", fontWeight: 700, color: COLOURS.NAVY }}>
                      {expandedSection === "overdue" && `Overdue Tasks (${overdueTasks.length})`}
                      {expandedSection === "waiting" && `Waiting Reply (${waitingReply.length})`}
                      {expandedSection === "escalations" && `Active Escalations (${escalations.length})`}
                      {expandedSection === "meetings" && `Meeting Approvals (${meetingRequests.length})`}
                      {expandedSection === "mytasks" && `My Tasks (${myTasks.length})`}
                      {expandedSection === "all" && `All Open Tasks (${openTasks.length})`}
                    </span>
                    <button onClick={() => setExpandedSection(null)} style={{ background: "transparent", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", padding: "4px 10px", fontSize: "14px", color: COLOURS.SLATE, cursor: "pointer" }}>
                      Close
                    </button>
                  </div>
                  <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                    {expandedSection === "overdue" && overdueTasks.sort((a, b) => daysOverdue(b) - daysOverdue(a)).map((t) => <TaskRow key={t.id} task={t} showActions />)}
                    {expandedSection === "waiting" && waitingReply.map((t) => <TaskRow key={t.id} task={t} showActions />)}
                    {expandedSection === "escalations" && escalations.map((t) => <TaskRow key={t.id} task={t} showActions />)}
                    {expandedSection === "mytasks" && myTasks.map((t) => <TaskRow key={t.id} task={t} />)}
                    {expandedSection === "all" && openTasks.slice(0, 50).map((t) => <TaskRow key={t.id} task={t} showActions />)}
                    {expandedSection === "meetings" && meetingRequests.map((r) => (
                      <div key={r.id} style={{
                        padding: "10px 12px",
                        borderBottom: `1px solid ${COLOURS.BORDER}`,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "8px",
                        flexWrap: "wrap",
                      }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: "15px", color: COLOURS.NAVY }}>{r.meeting_title}</div>
                          <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>
                            {r.requested_by_name || "—"} · {r.requested_date ? formatDateUK(r.requested_date) : "No date"} · <PriorityBadge priority={r.priority} />
                          </div>
                        </div>
                        <button onClick={() => approveMeeting(r.id)} style={actionBtn("#16a34a")}>Approve</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Department breakdown */}
              <SectionTitle title="By Department" />
              <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden", marginBottom: "12px" }}>
                {departments.map((dept) => (
                  <div key={dept.name} style={{ borderBottom: `1px solid ${COLOURS.BORDER}`, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "16px", color: COLOURS.NAVY }}>{dept.name}</div>
                      <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>{dept.tasks.length} open tasks</div>
                    </div>
                    <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                      {dept.overdue > 0 && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                          <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: COLOURS.RED, display: "inline-block" }} />
                          <span style={{ fontWeight: 700, fontSize: "15px", color: COLOURS.RED }}>{dept.overdue}</span>
                        </span>
                      )}
                      {dept.waiting > 0 && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                          <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: COLOURS.AMBER, display: "inline-block" }} />
                          <span style={{ fontWeight: 700, fontSize: "15px", color: COLOURS.AMBER }}>{dept.waiting}</span>
                        </span>
                      )}
                      {dept.overdue === 0 && dept.waiting === 0 && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                          <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: COLOURS.GREEN, display: "inline-block" }} />
                          <span style={{ fontWeight: 600, fontSize: "14px", color: COLOURS.GREEN }}>OK</span>
                        </span>
                      )}
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
  backgroundColor: color,
  color: "white",
  border: "none",
  borderRadius: "5px",
  padding: "6px 14px",
  fontSize: "13px",
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
});
