"use client";

"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import { whatsappLink, taskReminderMessage } from "../lib/whatsapp";
import { COLOURS, RADII, useConfirm } from "../lib/SharedUI";
import { canDeleteTask, canEditTask, isTaskProtected } from "../lib/permissions";
import TaskStatus from "./TaskStatus";

type Comment = {
  id: string;
  comment_text: string;
  commented_by: string | null;
  commented_by_email: string | null;
  created_at: string;
};

// Shared by both the department/weekly/monthly/quarterly list rows
// (TasksList.tsx) and the Board view (TasksBoard.tsx) so the task detail
// — status, subtasks, due-date history, WhatsApp/delete tools — is
// exactly the same wherever it's opened from, not two copies drifting
// apart over time.

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
};

export default function TaskDetailPanel({
  task,
  currentRole,
  isPrivileged,
  canReview,
  canDelete,
  myEmail,
  memberPhones,
  onChanged,
}: {
  task: Task;
  currentRole: string;
  isPrivileged: boolean;
  canReview?: boolean;
  canDelete?: boolean;
  myEmail: string | null;
  memberPhones: Record<string, string>;
  onChanged: () => void;
}) {
  const dlg = useConfirm();
  const userCtx = { email: myEmail, role: currentRole };
  const taskEditable = canEditTask(userCtx, task.assigned_by_email);
  const taskDeletable = canDeleteTask(userCtx, task.assigned_by_email);
  const protected_ = isTaskProtected(task.assigned_by_email);

  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [autoRemind, setAutoRemind] = useState(task.whatsapp_auto_remind);

  async function toggleAutoRemind() {
    const next = !autoRemind;
    setAutoRemind(next);
    await supabase.from("tasks").update({ whatsapp_auto_remind: next }).eq("id", task.id);
    onChanged();
  }

  function loadComments() {
    supabase
      .from("task_comments")
      .select("id, comment_text, commented_by, commented_by_email, created_at")
      .eq("task_id", task.id)
      .order("created_at", { ascending: true })
      .then(({ data }) => setComments(data || []));
  }

  useEffect(() => { loadComments(); }, [task.id]);

  async function postComment() {
    const text = newComment.trim();
    if (!text) return;
    setPostingComment(true);
    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email || myEmail;
    const { data: member } = email
      ? await supabase.from("members").select("name").eq("email", email).single()
      : { data: null };
    const { error } = await supabase.from("task_comments").insert({
      task_id: task.id,
      comment_text: text,
      commented_by: member?.name || email || "Unknown",
      commented_by_email: email || null,
    });
    setPostingComment(false);
    if (!error) {
      setNewComment("");
      loadComments();
    }
  }

  return (
    <div style={{ padding: "12px 16px", backgroundColor: COLOURS.CARD_ALT, borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>
      {dlg.element}
      <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginBottom: "6px" }}>
        Type: <strong style={{ color: COLOURS.NAVY }}>{task.task_type || "Task"}</strong>
        {" · "}Assigned by: <strong style={{ color: COLOURS.NAVY }}>{task.assigned_by || "—"}</strong>
        {" · "}Date: {formatDateUK(task.assigned_date)}
        {" · "}Project: {task.project || "—"}
        {task.meeting_id && (
          <span> · <a href={`/my-minutes?meeting=${task.meeting_id}`} style={{ color: COLOURS.BLUE, fontWeight: 600, textDecoration: "none" }}>View Minutes →</a></span>
        )}
      </div>
      {task.notes && <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginBottom: "6px" }}>Notes: {task.notes}</div>}
      {task.reply_text && (
        <div style={{ padding: "8px 12px", border: `1px solid ${COLOURS.GREEN}`, backgroundColor: COLOURS.SUCCESS_SOFT, borderRadius: RADII.SM, color: COLOURS.GREEN, fontSize: "13px", marginBottom: "8px" }}>
          <strong>Explanation:</strong> {task.reply_text}
          {task.corrective_action && <div style={{ marginTop: "4px" }}><strong>Corrective action:</strong> {task.corrective_action}</div>}
          {task.recovery_date && <div style={{ marginTop: "4px" }}><strong>Expected recovery:</strong> {formatDateUK(task.recovery_date)}</div>}
          <div style={{ marginTop: "4px", fontSize: "12px", color: COLOURS.SLATE }}>By {task.reply_by || "unknown"} {task.reply_at ? `on ${formatDateUK(task.reply_at)}` : ""}</div>
        </div>
      )}
      {protected_ && !isPrivileged && (
        <div style={{ fontSize: "12px", color: COLOURS.AMBER, fontWeight: 600, marginBottom: "6px", padding: "4px 8px", backgroundColor: COLOURS.WARNING_SOFT, borderRadius: RADII.XS, border: `1px solid ${COLOURS.AMBER}` }}>
          Assigned by {task.assigned_by || "management"} — you can update status and add notes but cannot edit or delete this task.
        </div>
      )}
      <TaskStatus task={task} currentRole={currentRole} onChanged={onChanged} canReview={canReview ?? isPrivileged} canEditDueDate={(canReview ?? isPrivileged) || taskEditable} canEditTask={taskEditable} />

      {/* Captures intent only — still needs the WhatsApp Business API setup
          before anything actually sends by itself. See migration 105. */}
      <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12.5px", color: COLOURS.NAVY, marginTop: "10px", cursor: "pointer" }}>
        <input type="checkbox" checked={autoRemind} onChange={toggleAutoRemind} style={{ width: "15px", height: "15px", accentColor: COLOURS.GREEN, cursor: "pointer" }} />
        Auto-remind on WhatsApp if this goes overdue
      </label>

      {((canDelete ?? isPrivileged) || taskDeletable) && (
        <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "flex-end", gap: "6px" }}>
          {task.assigned_to && memberPhones[task.assigned_to] && (
            <a
              href={whatsappLink(memberPhones[task.assigned_to], taskReminderMessage(task.description, task.due_date, task.assigned_by)) || "#"}
              target="_blank" rel="noopener noreferrer"
              style={{ backgroundColor: COLOURS.GREEN, color: "white", border: "none", borderRadius: RADII.SM, padding: "6px 14px", fontSize: "13px", fontWeight: 700, cursor: "pointer", textDecoration: "none", minHeight: "34px", display: "inline-flex", alignItems: "center" }}
              title="Send WhatsApp reminder to assignee"
            >
              WhatsApp
            </a>
          )}
          {taskDeletable && (
            <button
              onClick={async () => {
                if (!await dlg.confirm(`Delete task "${task.description}"? This cannot be undone.`, true)) return;
                await supabase.from("tasks").delete().eq("id", task.id);
                onChanged();
              }}
              style={{ backgroundColor: COLOURS.CARD, color: COLOURS.RED, border: `1px solid ${COLOURS.RED}`, borderRadius: RADII.SM, padding: "6px 14px", fontSize: "13px", fontWeight: 700, cursor: "pointer", minHeight: "34px" }}
              title="Permanently delete this task"
            >
              Delete Task
            </button>
          )}
        </div>
      )}

      {/* Comments — flat, oldest first, no edit/delete (append-only log) */}
      <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>
        <div style={{ fontSize: "10.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: COLOURS.INK_400, marginBottom: "8px" }}>
          Comments{comments.length > 0 ? ` (${comments.length})` : ""}
        </div>
        {comments.map((c) => (
          <div key={c.id} style={{ marginBottom: "10px" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "baseline", marginBottom: "2px" }}>
              <span style={{ fontSize: "12.5px", fontWeight: 600, color: COLOURS.NAVY }}>{c.commented_by || "Unknown"}</span>
              <span style={{ fontSize: "11px", color: COLOURS.INK_400 }}>{formatDateUK(c.created_at)}</span>
            </div>
            <div style={{ fontSize: "13px", color: COLOURS.NAVY, lineHeight: 1.5 }}>{c.comment_text}</div>
          </div>
        ))}
        {comments.length === 0 && (
          <div style={{ fontSize: "12.5px", color: COLOURS.INK_400, marginBottom: "10px" }}>No comments yet.</div>
        )}
        <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
          <input
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); postComment(); } }}
            placeholder="Add a comment…"
            style={{ flex: 1, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.PILL, padding: "8px 14px", fontSize: "13px", color: COLOURS.NAVY }}
          />
          <button
            onClick={postComment}
            disabled={postingComment || !newComment.trim()}
            style={{
              backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: RADII.PILL,
              padding: "8px 16px", fontSize: "12.5px", fontWeight: 600, cursor: postingComment || !newComment.trim() ? "not-allowed" : "pointer",
              opacity: postingComment || !newComment.trim() ? 0.6 : 1,
            }}
          >
            Post
          </button>
        </div>
      </div>
    </div>
  );
}
