"use client";

// HARD RULE: This page must NEVER display cash, financial figures, or finance-related data.

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import RoleGuard from "../lib/RoleGuard";
import { supabase } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import {
  COLOURS,
  SectionTitle,
  PageHeader,
  StatusBadge,
  PriorityBadge,
  tableHeaderStyle,
  tableCellStyle,
  tableCellBoldStyle,
} from "../lib/SharedUI";
import { useMobile } from "../lib/useMobile";

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
  source_type: string | null;
  exception_type: string | null;
  assigned_to_department: string | null;
  created_at: string | null;
};

type MeetingRequest = {
  id: string;
  requested_by_name: string | null;
  requested_by_email: string | null;
  requested_by_department: string | null;
  meeting_title: string;
  meeting_purpose: string | null;
  requested_date: string | null;
  preferred_time: string | null;
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
  const due = new Date(task.due_date + "T00:00:00");
  return Math.floor((Date.now() - due.getTime()) / 86400000);
}

export default function PADashboardPage() {
  const isMobile = useMobile();
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [meetingRequests, setMeetingRequests] = useState<MeetingRequest[]>([]);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    const email = user?.email || null;
    setCurrentUserEmail(email);

    if (email) {
      const { data: member } = await supabase
        .from("members")
        .select("first_name, last_name, name")
        .eq("email", email)
        .maybeSingle();
      if (member) {
        const fullName = `${member.first_name || ""} ${member.last_name || ""}`.trim();
        setCurrentUserName(fullName || member.name || email);
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
    loadData();
  }

  const openTasks = tasks.filter(
    (t) => t.status !== "Completed" && t.status !== "Cancelled"
  );

  const escalations = tasks.filter(
    (t) =>
      (t.source_type === "kpi_escalation" || t.source_type === "receivable_escalation") &&
      t.status !== "Completed" && t.status !== "Cancelled"
  );

  // Group open tasks by assignee
  const tasksByAssignee = new Map<string, Task[]>();
  for (const task of openTasks) {
    const key = task.assigned_to || "Unassigned";
    if (!tasksByAssignee.has(key)) tasksByAssignee.set(key, []);
    tasksByAssignee.get(key)!.push(task);
  }
  const assigneeGroups = Array.from(tasksByAssignee.entries())
    .map(([name, tks]) => ({
      name,
      tasks: tks,
      overdueCount: tks.filter(isOverdue).length,
    }))
    .sort((a, b) => b.overdueCount - a.overdueCount);

  // Slipping users: 2+ overdue tasks
  const slippingUsers = assigneeGroups.filter((g) => g.overdueCount >= 2);

  // PA's own tasks
  const myTasks = tasks.filter(
    (t) =>
      t.status !== "Completed" &&
      t.status !== "Cancelled" &&
      (t.assigned_to === currentUserName ||
        (currentUserEmail && t.assigned_to === currentUserEmail))
  );

  return (
    <AuthWrapper>
      <RoleGuard allowedRoles={["Admin", "Executive"]}>
        <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
          <PageHeader
            title="PA Command Centre"
            subtitle="Tasks, escalations, approvals, and follow-ups across the company"
          />

          {loading ? (
            <p style={{ color: COLOURS.SLATE }}>Loading…</p>
          ) : (
            <>
              {/* ── SLIPPING USERS ── */}
              {slippingUsers.length > 0 && (
                <>
                  <SectionTitle title="Slipping Users" />
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                      gap: "8px",
                      marginBottom: "12px",
                    }}
                  >
                    {slippingUsers.map((u) => (
                      <div
                        key={u.name}
                        style={{
                          border: `1px solid ${COLOURS.BORDER}`,
                          borderTop: `3px solid ${COLOURS.RED}`,
                          borderRadius: "7px",
                          padding: "10px 12px",
                          backgroundColor: "white",
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: "17px", color: COLOURS.NAVY }}>{u.name}</div>
                        <div style={{ fontSize: "15px", color: COLOURS.RED, fontWeight: 600, marginTop: "2px" }}>
                          {u.overdueCount} overdue task{u.overdueCount > 1 ? "s" : ""}
                        </div>
                        <div style={{ fontSize: "14px", color: COLOURS.SLATE, marginTop: "2px" }}>
                          {u.tasks.length} total open
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* ── MEETING REQUESTS AWAITING APPROVAL ── */}
              <SectionTitle title={`Meeting Requests Awaiting Approval (${meetingRequests.length})`} />
              {meetingRequests.length === 0 ? (
                <p style={{ color: COLOURS.SLATE, fontSize: "17px", marginBottom: "12px" }}>No pending requests.</p>
              ) : (
                <div style={{ marginBottom: "12px" }}>
                  {meetingRequests.map((r) => (
                    <div key={r.id} style={{
                      border: `1px solid ${COLOURS.BORDER}`,
                      borderRadius: "8px",
                      padding: "10px 12px",
                      backgroundColor: "white",
                      marginBottom: "8px",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", flexWrap: "wrap" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: "17px", color: COLOURS.NAVY }}>{r.meeting_title}</div>
                          <div style={{ fontSize: "15px", color: COLOURS.SLATE, marginTop: "2px" }}>
                            {r.requested_by_name || "—"} · {r.requested_date ? formatDateUK(r.requested_date) : "No date"} · <PriorityBadge priority={r.priority} />
                          </div>
                        </div>
                        <button
                          onClick={() => approveMeeting(r.id)}
                          style={{
                            backgroundColor: COLOURS.GREEN,
                            color: "white",
                            border: "none",
                            borderRadius: "5px",
                            padding: "7px 12px",
                            fontSize: "15px",
                            fontWeight: 700,
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          Approve
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── ESCALATIONS ── */}
              <SectionTitle title={`Active Escalations (${escalations.length})`} />
              {escalations.length === 0 ? (
                <p style={{ color: COLOURS.SLATE, fontSize: "17px", marginBottom: "12px" }}>No active escalations.</p>
              ) : (
                <div style={{ marginBottom: "12px" }}>
                  {escalations.map((t) => (
                    <div key={t.id} style={{
                      border: `1px solid ${COLOURS.BORDER}`,
                      borderLeft: `3px solid ${isOverdue(t) ? COLOURS.RED : COLOURS.AMBER}`,
                      borderRadius: "6px",
                      padding: "10px 12px",
                      backgroundColor: "white",
                      marginBottom: "8px",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                        <div style={{ fontSize: "16px", fontWeight: 700, color: COLOURS.NAVY, minWidth: 0 }}>{t.description}</div>
                        <StatusBadge status={t.status} />
                      </div>
                      <div style={{ fontSize: "15px", color: COLOURS.SLATE, marginTop: "4px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <span style={{ color: COLOURS.RED, fontWeight: 600 }}>{t.exception_type || t.source_type}</span>
                        <span>→ {t.assigned_to || "Unassigned"}</span>
                        <span style={{ color: isOverdue(t) ? COLOURS.RED : COLOURS.NAVY, fontWeight: isOverdue(t) ? 700 : 400 }}>
                          Due: {t.due_date ? formatDateUK(t.due_date) : "—"}
                          {isOverdue(t) && ` (${daysOverdue(t)}d late)`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── PA'S OWN TASKS ── */}
              {myTasks.length > 0 && (
                <>
                  <SectionTitle title={`My Tasks (${myTasks.length})`} />
                  <div style={{ marginBottom: "12px", backgroundColor: "white", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "6px" }}>
                    {myTasks.map((t) => (
                      <div key={t.id} style={{
                        padding: "8px 8px",
                        borderBottom: `1px solid ${COLOURS.LIGHT}`,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: "8px",
                        flexWrap: "wrap",
                      }}>
                        <div style={{ fontSize: "16px", fontWeight: 600, color: COLOURS.NAVY, minWidth: 0, flex: 1 }}>
                          {t.description}
                          <div style={{ fontSize: "14px", color: isOverdue(t) ? COLOURS.RED : COLOURS.SLATE, marginTop: "2px" }}>
                            {t.due_date ? formatDateUK(t.due_date) : "No due date"}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                          <PriorityBadge priority={t.priority} />
                          <StatusBadge status={t.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* ── ALL OPEN TASKS BY ASSIGNEE ── */}
              <SectionTitle title={`All Open Tasks (${openTasks.length})`} />
              {assigneeGroups.map((group) => (
                <div key={group.name} style={{ marginBottom: "12px" }}>
                  <div style={{
                    fontSize: "16px",
                    fontWeight: 700,
                    color: COLOURS.NAVY,
                    padding: "6px 10px",
                    backgroundColor: "#f8fafc",
                    border: `1px solid ${COLOURS.BORDER}`,
                    borderRadius: "6px 6px 0 0",
                    display: "flex",
                    justifyContent: "space-between",
                  }}>
                    <span>{group.name}</span>
                    <span>
                      {group.overdueCount > 0 && (
                        <span style={{ color: COLOURS.RED, marginRight: "8px" }}>{group.overdueCount} overdue</span>
                      )}
                      {group.tasks.length} open
                    </span>
                  </div>
                  <div style={{ backgroundColor: "white", border: `1px solid ${COLOURS.BORDER}`, borderTop: "none", borderRadius: "0 0 6px 6px", padding: "6px" }}>
                    {group.tasks
                      .sort((a, b) => daysOverdue(b) - daysOverdue(a))
                      .map((t) => (
                        <div key={t.id} style={{
                          padding: "8px 8px",
                          borderBottom: `1px solid ${COLOURS.LIGHT}`,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: "8px",
                          flexWrap: "wrap",
                        }}>
                          <div style={{ fontSize: "16px", fontWeight: 600, color: COLOURS.NAVY, minWidth: 0, flex: 1 }}>
                            {t.description}
                            <div style={{ fontSize: "14px", color: isOverdue(t) ? COLOURS.RED : COLOURS.SLATE, marginTop: "2px", fontWeight: isOverdue(t) ? 700 : 400 }}>
                              {t.due_date ? formatDateUK(t.due_date) : "No due date"}
                              {isOverdue(t) && ` · ${daysOverdue(t)}d overdue`}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                            <PriorityBadge priority={t.priority} />
                            <StatusBadge status={t.status} />
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </main>
      </RoleGuard>
    </AuthWrapper>
  );
}
