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
    label: "TO DO",
    statuses: ["Not Started"],
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
    key: "stuck",
    label: "STUCK",
    statuses: ["Stuck"],
    dropStatus: "Stuck",
    headerBg: "#fee2e2",
    headerColor: "#b91c1c",
    countBg: "#ef4444",
    bodyBg: "#fff5f5",
    stripe: "#ef4444",
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

  // Which columns are hidden — persisted so it survives page refresh
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("kanban_hidden_cols");
      return saved ? new Set<string>(JSON.parse(saved)) : new Set<string>();
    } catch { return new Set<string>(); }
  });

  function toggleCol(key: string) {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      try { localStorage.setItem("kanban_hidden_cols", JSON.stringify([...next])); } catch {}
      return next;
    });
  }

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

      {/* ── Column toggles ── */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
        <span style={{ fontSize: "11.5px", fontWeight: 600, color: COLOURS.SLATE, marginRight: "2px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Columns:</span>
        {KANBAN_COLUMNS.map((col) => {
          const count = tasksFor(col).length;
          const hidden = hiddenCols.has(col.key);
          return (
            <button
              key={col.key}
              onClick={() => toggleCol(col.key)}
              style={{
                display: "flex", alignItems: "center", gap: "5px",
                border: `1px solid ${hidden ? COLOURS.HAIRLINE : col.countBg}`,
                borderRadius: RADII.PILL, padding: "4px 10px",
                fontSize: "11.5px", fontWeight: 600, cursor: "pointer",
                background: hidden ? COLOURS.CARD : col.headerBg,
                color: hidden ? COLOURS.SLATE : col.headerColor,
                opacity: hidden ? 0.6 : 1,
                transition: "opacity 0.15s",
              }}
            >
              {!hidden && (
                <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: col.countBg, flexShrink: 0, display: "inline-block" }} />
              )}
              {col.label}
              <span style={{
                background: hidden ? "#e2e8f0" : col.countBg,
                color: hidden ? COLOURS.SLATE : "#fff",
                borderRadius: "99px", fontSize: "10px", fontWeight: 700,
                padding: "0 5px", minWidth: "16px", textAlign: "center", lineHeight: "16px",
              }}>{count}</span>
              {!hidden && (
                <span style={{ fontSize: "12px", opacity: 0.6, marginLeft: "1px" }}>×</span>
              )}
            </button>
          );
        })}
        {hiddenCols.size > 0 && (
          <button
            onClick={() => { setHiddenCols(new Set()); try { localStorage.removeItem("kanban_hidden_cols"); } catch {} }}
            style={{ background: "none", border: "none", color: COLOURS.BLUE, fontSize: "11.5px", fontWeight: 600, cursor: "pointer", textDecoration: "underline", padding: "4px 6px" }}
          >
            Show all
          </button>
        )}
      </div>

      {/* ── Board grid ── */}
      {(() => {
        const visibleCols = KANBAN_COLUMNS.filter((c) => !hiddenCols.has(c.key));
        return (
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${visibleCols.length || 1}, minmax(0, 1fr))`,
        gap: "12px",
        alignItems: "start",
      }}>
        {visibleCols.map((col) => {
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
                            position: "relative",
                            background: "white",
                            border: `1px solid ${COLOURS.HAIRLINE}`,
                            borderRadius: totalSubs > 0 ? "10px 10px 0 0" : "10px",
                            padding: "11px 12px 11px 15px",
                            cursor: "grab",
                            opacity: isDragging ? 0.4 : done ? 0.65 : 1,
                            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                            transition: "box-shadow 0.15s, opacity 0.15s",
                            overflow: "hidden",
                          }}
                          onMouseEnter={(e) => {
                            if (!isDragging) (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLDivElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.05)";
                          }}
                        >
                          {/* Left colour stripe */}
                          {col.stripe !== "transparent" && (
                            <div style={{
                              position: "absolute", left: 0, top: 0, bottom: 0, width: "3px",
                              background: col.stripe, borderRadius: "10px 0 0 10px",
                            }} />
                          )}

                          {/* Top row: priority badge + SLA badge */}
                          <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginBottom: "6px" }}>
                            <PriorityBadge priority={t.priority} />
                            <TypeBadge type={t.task_type} />
                            <SlaBadge task={t} />
                          </div>

                          {/* Title */}
                          <div style={{
                            fontSize: "12.5px",
                            fontWeight: 600,
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

                          {/* Meta row: avatar + name */}
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "5px" }}>
                            <div style={{
                              width: "22px", height: "22px", borderRadius: "50%",
                              background: done ? "#94a3b8" : avatarColor(t.assigned_to),
                              color: "white", fontSize: "9px", fontWeight: 700,
                              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                            }}>
                              {initials(t.assigned_to)}
                            </div>
                            <span style={{ fontSize: "11px", color: COLOURS.SLATE, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {t.assigned_to || "Unassigned"}
                            </span>
                          </div>

                          {/* Due date row */}
                          {t.due_date && (
                            <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "8px" }}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={isOverdue(t) ? "#dc2626" : COLOURS.SLATE} strokeWidth="2" strokeLinecap="round">
                                <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
                              </svg>
                              <DueLabel task={t} />
                            </div>
                          )}

                          {/* Footer: company dot + name | comment count */}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "2px" }}>
                            {(() => {
                              const co = companies?.find((c) => c.id === t.company_id);
                              const code = co?.short_code ?? (emailToCode?.get(t.assigned_to_email ?? "") ?? "");
                              const DOT_COLOURS: Record<string, string> = {
                                UTPL: "#0F7B5F", IFPL: "#2563EB", BRNH: "#7C3AED", HD: "#B4791F", DIR: "#B3261E",
                              };
                              const dotColor = DOT_COLOURS[code] ?? COLOURS.SLATE;
                              return co ? (
                                <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                                  <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
                                  <span style={{ fontSize: "10px", color: COLOURS.SLATE, fontWeight: 600 }}>{code || co.name}</span>
                                </div>
                              ) : <div />;
                            })()}
                            {t.task_comments && t.task_comments.length > 0 && (
                              <div style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "10px", color: COLOURS.SLATE, fontWeight: 600 }}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                {t.task_comments.length}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Subtask progress bar + toggle */}
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
        );
      })()}

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
