"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import { COLOURS, RADII, PriorityBadge, StatusBadge, useToast } from "../lib/SharedUI";
import { canCompleteSubmittedTask, canReopenCompletedTask } from "../lib/permissions";
import { routeSubmittedTask } from "../lib/taskRouting";
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
  task_subtasks?: { id: string; is_complete: boolean }[];
  task_comments?: { id: string }[];
};

const COLUMNS = ["Not Started", "In Progress", "Waiting Reply", "Stuck", "Submitted", "Completed"];

const todayStr = new Date().toISOString().slice(0, 10);
function isOverdue(t: Task) {
  if (t.status === "Completed" || t.status === "Cancelled") return false;
  return !!t.due_date && t.due_date < todayStr;
}

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
  onChanged: () => void;
}) {
  const toast = useToast();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  const knownStatuses = new Set(COLUMNS);
  const otherStatuses = Array.from(new Set(tasks.map((t) => t.status).filter((s) => !knownStatuses.has(s))));
  const columns = [...COLUMNS, ...(otherStatuses.length > 0 ? ["Other"] : [])];

  function tasksFor(col: string): Task[] {
    if (col === "Other") return tasks.filter((t) => !knownStatuses.has(t.status));
    return tasks.filter((t) => t.status === col);
  }

  async function moveTask(taskId: string, newStatus: string) {
    const t = tasks.find((x) => x.id === taskId);

    // Dragging straight onto Completed used to bypass the whole "submit to
    // your HOD" flow this same board respects everywhere else — a card
    // could go from Not Started to Completed in one drop. Same rule as the
    // single-task view now: only Submitted can become Completed, and only
    // by the person that rule says may close it.
    if (newStatus === "Completed") {
      if (!t || t.status !== "Submitted" || !canCompleteSubmittedTask({ email: myEmail, role: currentRole }, t.assigned_to_email)) {
        toast.show("This has to be Submitted first, and only the assigned HOD (or Khuram, Kamran, or the Executive) can close it.", "error");
        return;
      }
    }

    // Khuram: "I dont think the task should be allowed to be edited
    // afterwards... unless the administration who has the rights to bring
    // it back." A completed card is locked — dragging it to any other
    // column is a reopen, so only Admin-tier can do it.
    if (t?.status === "Completed" && newStatus !== "Completed" && !canReopenCompletedTask({ email: myEmail, role: currentRole })) {
      toast.show("This task is completed and locked — only an admin can reopen it.", "error");
      return;
    }

    // "Submitted" routes to the assignee's HOD — same rule as the
    // single-task dropdown and the bulk status change in TasksList.tsx.
    const extra = newStatus === "Submitted" && t && t.status !== "Submitted"
      ? await routeSubmittedTask(taskId, t.assigned_to, t.assigned_to_email)
      : {};

    const { error } = await supabase.from("tasks").update({ status: newStatus, updated_at: new Date().toISOString(), ...extra }).eq("id", taskId);
    if (error) {
      // Most likely cause: the subtask-completion gate (migration 100) rejected
      // a move to Completed while subtasks are still open — surface that
      // plainly rather than a raw Postgres error.
      toast.show(error.message.includes("unfinished subtasks") ? error.message : `Couldn't move task: ${error.message}`, "error");
      return;
    }
    onChanged();
  }

  function companyLabel(companyId: string | null): string {
    if (!companyId) return "Group";
    const c = companies?.find((co) => co.id === companyId);
    // Full name, not a short code — "Unze Trading Pvt Ltd", not "UTPL".
    return c?.name || "Tagged";
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
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`, gap: "8px", alignItems: "start" }}>
        {columns.map((col) => {
          const colTasks = tasksFor(col);
          return (
            <div
              key={col}
              onDragOver={(e) => { e.preventDefault(); setDragOverCol(col); }}
              onDragLeave={() => setDragOverCol((c) => (c === col ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverCol(null);
                const taskId = e.dataTransfer.getData("text/plain");
                setDraggingId(null);
                if (taskId) moveTask(taskId, col);
              }}
              style={{
                background: dragOverCol === col ? COLOURS.INFO_SOFT : "transparent",
                borderRadius: RADII.CARD,
                minHeight: "80px",
                padding: "4px",
                transition: "background-color 0.15s",
              }}
            >
              <div style={{ fontSize: "11.5px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px", display: "flex", justifyContent: "space-between" }}>
                <span>{col}</span>
                <span>{colTasks.length}</span>
              </div>

              {colTasks.length === 0 ? (
                <div style={{ border: `1px dashed ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, padding: "14px 10px", textAlign: "center", color: COLOURS.INK_400, fontSize: "11.5px" }}>
                  Drop a task here
                </div>
              ) : (
                colTasks.map((t) => {
                  const overdue = isOverdue(t);
                  const totalCount = t.task_subtasks?.length ?? 0;
                  const done = t.status === "Completed";
                  return (
                    <div key={t.id} style={{ marginBottom: "6px" }}>
                      <div
                        draggable
                        onDragStart={(e) => { setDraggingId(t.id); e.dataTransfer.setData("text/plain", t.id); e.dataTransfer.effectAllowed = "move"; }}
                        onDragEnd={() => setDraggingId(null)}
                        onClick={() => setExpandedId(t.id)}
                        style={{
                          background: done ? COLOURS.CARD_ALT : COLOURS.CARD,
                          border: `1px solid ${COLOURS.HAIRLINE}`,
                          borderRadius: "10px",
                          padding: "9px 11px",
                          cursor: "grab",
                          opacity: draggingId === t.id ? 0.4 : done ? 0.6 : 1,
                        }}
                      >
                        <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginBottom: "6px" }}>
                          {t.priority && <PriorityBadge priority={t.priority} />}
                          {col === "Other" && <StatusBadge status={t.status} />}
                          <span style={{ fontSize: "10.5px", fontWeight: 700, padding: "1px 7px", borderRadius: RADII.PILL, color: COLOURS.SLATE, backgroundColor: COLOURS.HAIRLINE }}>
                            {companyLabel(t.company_id)}
                          </span>
                        </div>
                        <div style={{ fontSize: "12.5px", fontWeight: 500, color: done ? COLOURS.SLATE : COLOURS.NAVY, textDecoration: done ? "line-through" : "none", marginBottom: "6px", lineHeight: 1.35 }}>{t.description}</div>
                        {t.meeting_id && (
                          <a
                            href={`/my-minutes?meeting=${t.meeting_id}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{ display: "inline-block", fontSize: "10px", fontWeight: 600, color: COLOURS.BLUE, backgroundColor: COLOURS.INFO_SOFT, borderRadius: RADII.XS, padding: "1px 8px", marginBottom: "5px", textDecoration: "none" }}
                          >
                            From: {meetingTitles?.[t.meeting_id] || "Meeting"} →
                          </a>
                        )}
                        {t.stage && (
                          <div style={{ fontSize: "10.5px", color: COLOURS.SLATE, marginBottom: "5px" }}>→ {t.stage}</div>
                        )}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px" }}>
                          <span style={{ fontSize: "11px", color: COLOURS.SLATE, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.assigned_to || "Unassigned"}</span>
                          {t.due_date && (
                            <span style={{ fontFamily: "var(--font-mono,'JetBrains Mono',monospace)", fontSize: "10.5px", color: overdue ? COLOURS.RED : COLOURS.SLATE, fontWeight: overdue ? 700 : 400, flexShrink: 0 }}>
                              {formatDateUK(t.due_date)}
                            </span>
                          )}
                        </div>
                        {t.task_comments && t.task_comments.length > 0 && (
                          <div style={{ marginTop: "5px", fontSize: "10.5px", color: COLOURS.SLATE, fontWeight: 600 }}>
                            {t.task_comments.length} comment{t.task_comments.length > 1 ? "s" : ""}
                          </div>
                        )}
                      </div>
                      {totalCount > 0 && (
                        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderTop: "none", borderRadius: "0 0 10px 10px" }}>
                          <MiniSubtaskToggle task={t} onChanged={onChanged} myEmail={myEmail} currentRole={currentRole} />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: "11.5px", color: COLOURS.INK_400, marginTop: "10px" }}>
        Drag a card to a different column to change its status. Dropping onto Completed only works from Submitted, and only for the assigned HOD (or Khuram, Kamran, or the Executive) — everyone else, and any task with open subtasks, is blocked.
      </p>
    </div>
  );
}
