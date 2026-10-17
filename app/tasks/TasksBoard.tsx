"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import { COLOURS, RADII, useToast } from "../lib/SharedUI";
import { canCompleteSubmittedTask, canReopenCompletedTask } from "../lib/permissions";
import TaskDetailModal from "./TaskDetailModal";
import MiniSubtaskToggle from "./MiniSubtaskToggle";

type Task = {
  id: string;
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
  task_type: string | null;
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
  whatsapp_auto_remind: boolean;
  company_id: string | null;
  requires_manager_signoff?: boolean | null;
  submitted_by_name?: string | null;
  submitted_by_email?: string | null;
  waiting_reply_note?: string | null;
  waiting_reply_to_email?: string | null;
  waiting_reply_to_name?: string | null;
  waiting_reply_by_email?: string | null;
  waiting_reply_by_name?: string | null;
  manager_reply_text?: string | null;
  manager_reply_at?: string | null;
  task_subtasks?: { id: string; is_complete: boolean }[];
  task_comments?: { id: string }[];
};

// ─── Column definitions ───────────────────────────────────────────────────────
// DB statuses are NEVER changed here — only the display label differs.
// "Submitted" stays "Submitted" in the database; it just renders as "IN REVIEW".
const KANBAN_COLUMNS: {
  key: string;
  label: string;
  statuses: string[];
  // What status to set when a card is dropped onto this column.
  // Defaults to the first item in `statuses`.
  dropStatus: string;
  headerBg: string;
  headerColor: string;
  countBg: string;
  bodyBg: string;
  stripe: string;
}[] = [
  {
    key: "todo",
    label: "TODO",
    statuses: ["Not Started", "Stuck"],
    dropStatus: "Not Started",
    headerBg: "#e2e8f0",
    headerColor: "#475569",
    countBg: "#94a3b8",
    bodyBg: "#f8fafc",
    stripe: "transparent",
  },
  {
    key: "inprogress",
    label: "IN PROGRESS",
    statuses: ["In Progress", "Waiting Reply"],
    dropStatus: "In Progress",
    headerBg: "#dbeafe",
    headerColor: "#1d4ed8",
    countBg: "#3b82f6",
    bodyBg: "#eff6ff",
    stripe: "#3b82f6",
  },
  {
    key: "inreview",
    label: "IN REVIEW",
    statuses: ["Submitted"],
    dropStatus: "Submitted",
    headerBg: "#fef9c3",
    headerColor: "#92400e",
    countBg: "#eab308",
    bodyBg: "#fefce8",
    stripe: "#eab308",
  },
  {
    key: "completed",
    label: "COMPLETED",
    statuses: ["Completed"],
    dropStatus: "Completed",
    headerBg: "#dcfce7",
    headerColor: "#15803d",
    countBg: "#22c55e",
    bodyBg: "#f0fdf4",
    stripe: "#22c55e",
  },
];

const todayStr = new Date().toISOString().slice(0, 10);

function isOverdue(t: Task): boolean {
  if (t.status === "Completed" || t.status === "Cancelled") return false;
  return !!t.due_date && t.due_date < todayStr;
}

function daysOverdue(t: Task): number {
  if (!t.due_date) return 0;
  return Math.floor(
    (new Date(todayStr).getTime() - new Date(t.due_date).getTime()) / 86400000
  );
}

function daysUntilDue(t: Task): number {
  if (!t.due_date) return 999;
  return Math.floor(
    (new Date(t.due_date).getTime() - new Date(todayStr).getTime()) / 86400000
  );
}

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

// Deterministic avatar colour from name
const AVATAR_PALETTE = [
  "#0f172a","#1d4ed8","#7c3aed","#0891b2","#db2777","#dc2626","#d97706","#059669",
];
function avatarColor(name: string | null): string {
  if (!name) return "#94a3b8";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

// ─── Priority badge ───────────────────────────────────────────────────────────
function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return null;
  const map: Record<string, { bg: string; color: string }> = {
    Critical: { bg: "#fee2e2", color: "#b91c1c" },
    High:     { bg: "#ffedd5", color: "#c2410c" },
    Medium:   { bg: "#fef9c3", color: "#92400e" },
    Low:      { bg: "#f0fdf4", color: "#15803d" },
  };
  const style = map[priority] ?? { bg: "#f1f5f9", color: "#475569" };
  return (
    <span style={{
      fontSize: "9.5px", fontWeight: 700, padding: "2px 7px",
      borderRadius: "20px", textTransform: "uppercase", letterSpacing: "0.04em",
      background: style.bg, color: style.color, whiteSpace: "nowrap",
    }}>
      {priority}
    </span>
  );
}

// ─── Task type badge ──────────────────────────────────────────────────────────
function TypeBadge({ type }: { type: string | null }) {
  if (!type) return null;
  return (
    <span style={{
      fontSize: "9.5px", fontWeight: 700, padding: "2px 7px",
      borderRadius: "20px", textTransform: "uppercase", letterSpacing: "0.04em",
      background: "#f1f5f9", color: "#475569", whiteSpace: "nowrap",
    }}>
      {type}
    </span>
  );
}

// ─── SLA / status badge ───────────────────────────────────────────────────────
function SlaBadge({ task }: { task: Task }) {
  if (task.status === "Waiting Reply") {
    return (
      <span style={{
        fontSize: "9.5px", fontWeight: 700, padding: "2px 7px", borderRadius: "20px",
        textTransform: "uppercase", letterSpacing: "0.04em",
        background: "#fef3c7", color: "#92400e", whiteSpace: "nowrap",
      }}>
        ⏳ Waiting Reply
      </span>
    );
  }
  if (task.status === "Stuck") {
    return (
      <span style={{
        fontSize: "9.5px", fontWeight: 700, padding: "2px 7px", borderRadius: "20px",
        textTransform: "uppercase", letterSpacing: "0.04em",
        background: "#fee2e2", color: "#b91c1c", whiteSpace: "nowrap",
      }}>
        🚫 Stuck
      </span>
    );
  }
  if (task.status === "Completed" || task.status === "Cancelled") return null;
  if (isOverdue(task)) {
    return (
      <span style={{
        fontSize: "9.5px", fontWeight: 700, padding: "2px 7px", borderRadius: "20px",
        textTransform: "uppercase", letterSpacing: "0.04em",
        background: "#fee2e2", color: "#b91c1c", whiteSpace: "nowrap",
      }}>
        SLA BREACHED
      </span>
    );
  }
  return (
    <span style={{
      fontSize: "9.5px", fontWeight: 700, padding: "2px 7px", borderRadius: "20px",
      textTransform: "uppercase", letterSpacing: "0.04em",
      background: "#dcfce7", color: "#15803d", whiteSpace: "nowrap",
    }}>
      SLA ACTIVE
    </span>
  );
}

// ─── Due date label ───────────────────────────────────────────────────────────
function DueLabel({ task }: { task: Task }) {
  if (task.status === "Completed") {
    return <span style={{ fontSize: "10.5px", color: "#64748b" }}>Done ✓</span>;
  }
  if (task.status === "Submitted") {
    return <span style={{ fontSize: "10.5px", color: "#92400e" }}>Awaiting sign-off</span>;
  }
  if (!task.due_date) return null;
  if (isOverdue(task)) {
    return (
      <span style={{ fontSize: "10.5px", color: "#dc2626", fontWeight: 700 }}>
        {daysOverdue(task)}d overdue
      </span>
    );
  }
  const d = daysUntilDue(task);
  if (d === 0) return <span style={{ fontSize: "10.5px", color: "#d97706", fontWeight: 700 }}>Due today</span>;
  if (d === 1) return <span style={{ fontSize: "10.5px", color: "#d97706", fontWeight: 700 }}>Due tomorrow</span>;
  if (d <= 3) return <span style={{ fontSize: "10.5px", color: "#d97706", fontWeight: 600 }}>Due in {d}d</span>;
  return <span style={{ fontSize: "10.5px", color: "#64748b" }}>{formatDateUK(task.due_date)}</span>;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function TasksBoard({
  tasks,
  currentRole,
  isPrivileged,
  canReview,
  canDelete,
  myEmail,
  memberPhones,
  meetingTitles,
  companies,
  emailToCode,
  onChanged,
}: {
  tasks: Task[];
  currentRole: string;
  isPrivileged: boolean;
  canReview?: boolean;
  canDelete?: boolean;
  myEmail: string | null;
  memberPhones: Record<string, string>;
  meetingTitles?: Record<string, string>;
  companies?: { id: string; name: string; short_code: string | null }[];
  emailToCode?: Map<string, string>;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // Tasks in each column
  const allMappedStatuses = new Set(KANBAN_COLUMNS.flatMap((c) => c.statuses));

  function tasksFor(col: typeof KANBAN_COLUMNS[number]): Task[] {
    return tasks.filter((t) => col.statuses.includes(t.status));
  }

  // Tasks not covered by any column (edge-case guard)
  const orphans = tasks.filter((t) => !allMappedStatuses.has(t.status) && t.status !== "Cancelled");

  async function moveTask(taskId: string, targetCol: typeof KANBAN_COLUMNS[number]) {
    const t = tasks.find((x) => x.id === taskId);
    const newStatus = targetCol.dropStatus;

    // Completing a task: enforce the same policy as everywhere else
    if (newStatus === "Completed") {
      const selfCreated = t?.requires_manager_signoff === false;
      const canClose = !!t && canCompleteSubmittedTask({ email: myEmail, role: currentRole }, t?.assigned_to_email);
      if (!canClose || (!selfCreated && t?.status !== "Submitted")) {
        toast.show(
          selfCreated
            ? "Only the assignee (or Khuram, Kamran, or the Executive) can close this."
            : "This must be Submitted first, and only the assigned HOD (or Khuram, Kamran, or the Executive) can close it.",
          "error"
        );
        return;
      }
    }

    // Re-opening a completed task requires admin tier
    if (t?.status === "Completed" && newStatus !== "Completed" && !canReopenCompletedTask({ email: myEmail, role: currentRole })) {
      toast.show("This task is completed and locked — only an admin can reopen it.", "error");
      return;
    }

    // Routing on submission is handled by DB trigger (migration 194).
    const { error } = await supabase
      .from("tasks")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", taskId);

    if (error) {
      toast.show(
        error.message.includes("unfinished subtasks")
          ? error.message
          : `Couldn't move task: ${error.message}`,
        "error"
      );
      return;
    }
    onChanged();
  }

  return (
    <div>
      {toast.element}
      <TaskDetailModal
        task={tasks.find((t) => t.id === expandedId) || null}
        open={!!expandedId}
        onClose={() => setExpandedId(null)}
        currentRole={currentRole}
        isPrivileged={isPrivileged}
        canReview={canReview}
        canDelete={canDelete}
        myEmail={myEmail}
        memberPhones={memberPhones}
        onChanged={onChanged}
      />

      {/* ── Board grid ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${KANBAN_COLUMNS.length}, minmax(0, 1fr))`,
        gap: "12px",
        alignItems: "start",
      }}>
        {KANBAN_COLUMNS.map((col) => {
          const colTasks = tasksFor(col);
          const isOver = dragOverKey === col.key;
          return (
            <div
              key={col.key}
              onDragOver={(e) => { e.preventDefault(); setDragOverKey(col.key); }}
              onDragLeave={() => setDragOverKey((k) => (k === col.key ? null : k))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverKey(null);
                const taskId = e.dataTransfer.getData("text/plain");
                setDraggingId(null);
                if (taskId) moveTask(taskId, col);
              }}
              style={{
                borderRadius: "12px",
                overflow: "hidden",
                outline: isOver ? `2px dashed ${col.countBg}` : "none",
                outlineOffset: "2px",
                transition: "outline 0.1s",
              }}
            >
              {/* Column header */}
              <div style={{
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: col.headerBg,
              }}>
                <span style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  color: col.headerColor,
                }}>
                  {col.label}
                </span>
                <span style={{
                  minWidth: "20px",
                  height: "20px",
                  borderRadius: "10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "11px",
                  fontWeight: 700,
                  background: col.countBg,
                  color: "white",
                  padding: "0 6px",
                }}>
                  {colTasks.length}
                </span>
              </div>

              {/* Column body */}
              <div style={{
                background: isOver ? `${col.bodyBg}` : col.bodyBg,
                padding: "8px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                minHeight: "80px",
                transition: "background 0.15s",
              }}>
                {colTasks.length === 0 ? (
                  <div style={{
                    border: `1px dashed ${COLOURS.HAIRLINE}`,
                    borderRadius: "8px",
                    padding: "20px 10px",
                    textAlign: "center",
                    color: COLOURS.INK_400,
                    fontSize: "11px",
                  }}>
                    Drop a task here
                  </div>
                ) : (
                  colTasks.map((t) => {
                    const done = t.status === "Completed";
                    const isDragging = draggingId === t.id;
                    const totalSubs = t.task_subtasks?.length ?? 0;
                    const doneSubs = t.task_subtasks?.filter((s) => s.is_complete).length ?? 0;

                    return (
                      <div key={t.id}>
                        <div
                          draggable
                          onDragStart={(e) => {
                            setDraggingId(t.id);
                            e.dataTransfer.setData("text/plain", t.id);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragEnd={() => setDraggingId(null)}
                          onClick={() => setExpandedId(t.id)}
                          style={{
                            background: "white",
                            border: `1px solid ${COLOURS.HAIRLINE}`,
                            borderLeft: col.stripe !== "transparent"
                              ? `3px solid ${col.stripe}`
                              : `1px solid ${COLOURS.HAIRLINE}`,
                            borderRadius: "10px",
                            padding: "11px 12px",
                            cursor: "grab",
                            opacity: isDragging ? 0.4 : done ? 0.65 : 1,
                            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                            transition: "box-shadow 0.15s, opacity 0.15s",
                          }}
                          onMouseEnter={(e) => {
                            if (!isDragging) (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLDivElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.05)";
                          }}
                        >
                          {/* Badges row */}
                          <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginBottom: "7px" }}>
                            <PriorityBadge priority={t.priority} />
                            <TypeBadge type={t.task_type} />
                            <SlaBadge task={t} />
                          </div>

                          {/* Title */}
                          <div style={{
                            fontSize: "12.5px",
                            fontWeight: 500,
                            color: done ? COLOURS.SLATE : COLOURS.NAVY,
                            textDecoration: done ? "line-through" : "none",
                            lineHeight: 1.4,
                            marginBottom: "9px",
                          }}>
                            {t.description}
                          </div>

                          {/* Meeting source link */}
                          {t.meeting_id && (
                            <a
                              href={`/my-minutes?meeting=${t.meeting_id}`}
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                display: "inline-block",
                                fontSize: "10px",
                                fontWeight: 600,
                                color: COLOURS.BLUE,
                                backgroundColor: COLOURS.INFO_SOFT,
                                borderRadius: RADII.XS,
                                padding: "1px 8px",
                                marginBottom: "7px",
                                textDecoration: "none",
                              }}
                            >
                              From: {meetingTitles?.[t.meeting_id] || "Meeting"} →
                            </a>
                          )}

                          {/* Footer: assignee + due date */}
                          <div style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "6px",
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", overflow: "hidden" }}>
                              <div style={{
                                width: "22px",
                                height: "22px",
                                borderRadius: "50%",
                                background: done ? "#94a3b8" : avatarColor(t.assigned_to),
                                color: "white",
                                fontSize: "9px",
                                fontWeight: 700,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}>
                                {initials(t.assigned_to)}
                              </div>
                              <span style={{
                                fontSize: "11px",
                                color: COLOURS.SLATE,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}>
                                {t.assigned_to || "Unassigned"}
                              </span>
                            </div>
                            <DueLabel task={t} />
                          </div>

                          {/* Comments count */}
                          {t.task_comments && t.task_comments.length > 0 && (
                            <div style={{ marginTop: "6px", fontSize: "10.5px", color: COLOURS.SLATE, fontWeight: 600 }}>
                              💬 {t.task_comments.length} comment{t.task_comments.length > 1 ? "s" : ""}
                            </div>
                          )}
                        </div>

                        {/* Subtask progress bar */}
                        {totalSubs > 0 && (
                          <div style={{
                            background: "white",
                            border: `1px solid ${COLOURS.HAIRLINE}`,
                            borderTop: "none",
                            borderRadius: "0 0 10px 10px",
                            overflow: "hidden",
                          }}>
                            <div style={{ height: "3px", background: COLOURS.HAIRLINE }}>
                              <div style={{
                                height: "3px",
                                width: `${Math.round((doneSubs / totalSubs) * 100)}%`,
                                background: "#16a34a",
                                transition: "width 0.3s",
                              }} />
                            </div>
                            <MiniSubtaskToggle task={t} onChanged={onChanged} myEmail={myEmail} currentRole={currentRole} />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Orphan tasks (statuses not mapped to any column) */}
      {orphans.length > 0 && (
        <div style={{ marginTop: "16px", padding: "12px 14px", background: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Other ({orphans.length})
          </div>
          {orphans.map((t) => (
            <div
              key={t.id}
              onClick={() => setExpandedId(t.id)}
              style={{ fontSize: "12.5px", color: COLOURS.NAVY, padding: "4px 0", cursor: "pointer", borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}
            >
              {t.description}
              <span style={{ fontSize: "10.5px", color: COLOURS.SLATE, marginLeft: "8px" }}>[{t.status}]</span>
            </div>
          ))}
        </div>
      )}

      <p style={{ fontSize: "11px", color: COLOURS.INK_400, marginTop: "10px" }}>
        Drag a card to move it. Completing requires Submitted status first — only the assigned HOD, Khuram, Kamran, or an Executive can close it.
      </p>
    </div>
  );
}
