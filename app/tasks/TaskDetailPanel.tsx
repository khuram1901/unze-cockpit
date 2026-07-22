"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import { whatsappLink, taskReminderMessage } from "../lib/whatsapp";
import { COLOURS, RADII, useConfirm, TASK_DESCRIPTION_LIMIT, TASK_COMPANY_CODES } from "../lib/SharedUI";
import { canDeleteTask, canEditTask, canReopenCompletedTask, isTaskProtected } from "../lib/permissions";
import TaskStatus from "./TaskStatus";

type Comment = {
  id: string;
  comment_text: string;
  commented_by: string | null;
  commented_by_email: string | null;
  created_at: string;
};

type Company = { id: string; name: string; short_code: string };
type DepartmentOwner = { id: string; department_name: string };
type MemberLite = { id: string; name: string; email: string | null; department: string | null; business_unit: string | null };

const PRIORITY_OPTIONS = ["Urgent", "High", "Medium", "Normal", "Low"];

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
  onClose,
}: {
  task: Task;
  currentRole: string;
  isPrivileged: boolean;
  canReview?: boolean;
  canDelete?: boolean;
  myEmail: string | null;
  memberPhones: Record<string, string>;
  onChanged: () => void;
  onClose?: () => void;
}) {
  const dlg = useConfirm();
  const userCtx = { email: myEmail, role: currentRole };
  const taskEditable = canEditTask(userCtx, task.assigned_by_email);
  const taskDeletable = canDeleteTask(userCtx, task.assigned_by_email);
  const protected_ = isTaskProtected(task.assigned_by_email);
  // Khuram: "once the task is completed then it should be greyed out...
  // not allowed to be edited afterwards, unless the administration who
  // has the rights to bring it back." Locks the core-field editor,
  // owner picker, and auto-remind toggle below; TaskStatus.tsx locks
  // status/stage/subtasks/due-date/time/notes/reassign the same way.
  const locked = task.status === "Completed" && !canReopenCompletedTask(userCtx);

  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [autoRemind, setAutoRemind] = useState(task.whatsapp_auto_remind);

  // Core fields (description/priority/department/company/owners) — always
  // visible and auto-saving, same as Status/Stage further down. Khuram:
  // "we cannot amend the company, department, priority — these options
  // should be available everywhere," after the previous click-to-edit
  // pattern turned out to hide them too well. Gated by taskEditable so
  // protected tasks assigned by someone else still can't be rewritten.
  const [companies, setCompanies] = useState<Company[]>([]);
  const [deptOwners, setDeptOwners] = useState<DepartmentOwner[]>([]);
  const [editDesc, setEditDesc] = useState(task.description);
  const [editPriority, setEditPriority] = useState(task.priority || "Normal");
  const [editProject, setEditProject] = useState(task.project || "");
  const [editCompanyId, setEditCompanyId] = useState(task.company_id || "");
  // Owners — real multi-assignee (Khuram: "same task assigned to multiple
  // members"), not just the single assigned_to this used to be limited
  // to. First person ticked stays the "primary" owner: tasks.assigned_to/
  // assigned_to_email/etc. get kept in sync with them so every existing
  // report/notification/WhatsApp reminder that only knows about one owner
  // keeps working; task_assignees holds the full list.
  const [members, setMembers] = useState<MemberLite[]>([]);
  const [editOwnerIds, setEditOwnerIds] = useState<string[]>([]);
  // Owner(s) card is collapsed to chips by default now (mockup Khuram
  // approved) — the full checkbox grid only appears once "Edit" is clicked.
  const [ownersEditOpen, setOwnersEditOpen] = useState(false);

  // No effect needed to reset editDesc/editPriority/editProject/
  // editCompanyId when switching tasks — TaskDetailModal keys this
  // component by task.id, so React remounts fresh (and these useState
  // initializers re-run) instead of reusing state across tasks. Avoids
  // the "setState synchronously in an effect" anti-pattern for what's
  // really just a prop-driven initial value.
  useEffect(() => {
    if (!taskEditable) return;
    (async () => {
      const [companiesRes, deptRes, membersRes, assigneesRes] = await Promise.all([
        supabase.from("companies").select("id, name, short_code").in("short_code", TASK_COMPANY_CODES).order("name"),
        supabase.from("department_owners").select("id, department_name").order("department_name"),
        supabase.from("members").select("id, name, email, department, business_unit").eq("is_active", true).order("name"),
        supabase.from("task_assignees").select("member_id, member_email").eq("task_id", task.id),
      ]);
      setCompanies(companiesRes.data || []);
      setDeptOwners(deptRes.data || []);
      const memberList = membersRes.data || [];
      setMembers(memberList);
      const ids = (assigneesRes.data || [])
        .map((a) => a.member_id || memberList.find((m) => m.email === a.member_email)?.id)
        .filter((id): id is string => !!id);
      setEditOwnerIds(Array.from(new Set(ids)));
    })();
  }, [taskEditable, task.id]);

  async function updateTaskField(fields: Record<string, unknown>) {
    const { error } = await supabase.from("tasks").update(fields).eq("id", task.id);
    if (error) { alert("Couldn't save changes: " + error.message); return; }
    onChanged();
  }

  async function toggleEditOwner(id: string, checked: boolean) {
    const nextIds = checked ? [...editOwnerIds, id] : editOwnerIds.filter((x) => x !== id);
    if (nextIds.length === 0) { alert("At least one owner is required."); return; }
    setEditOwnerIds(nextIds);

    const selected = nextIds.map((mid) => members.find((m) => m.id === mid)).filter((m): m is MemberLite => !!m);
    const primary = selected[0];
    const { error } = await supabase.from("tasks").update({
      assigned_to: primary.name,
      assigned_to_email: primary.email,
      assigned_to_department: primary.department || editProject || null,
      assigned_to_business_unit: primary.business_unit || null,
    }).eq("id", task.id);
    if (error) { alert("Couldn't update owners: " + error.message); return; }

    await supabase.from("task_assignees").delete().eq("task_id", task.id);
    const { error: assigneeError } = await supabase.from("task_assignees").insert(
      selected.map((m) => ({ task_id: task.id, member_id: m.id, member_name: m.name, member_email: m.email }))
    );
    if (assigneeError) { alert("Task saved, but the owner list failed to update: " + assigneeError.message); }
    onChanged();
  }

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

  // Owner chips — collapsed view of editOwnerIds against the loaded
  // members list, used both to render the read-only chip row and to
  // work out initials/primary tagging.
  const selectedOwners = editOwnerIds.map((id) => members.find((m) => m.id === id)).filter((m): m is MemberLite => !!m);
  function initials(name: string) {
    return name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  }

  return (
    <div style={{ padding: "12px 16px", backgroundColor: COLOURS.CARD_ALT, borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>
      {dlg.element}

      {task.reply_text && (
        <div style={{ padding: "8px 12px", border: `1px solid ${COLOURS.GREEN}`, backgroundColor: COLOURS.SUCCESS_SOFT, borderRadius: RADII.SM, color: COLOURS.GREEN, fontSize: "13px", marginBottom: "10px" }}>
          <strong>Explanation:</strong> {task.reply_text}
          {task.corrective_action && <div style={{ marginTop: "4px" }}><strong>Corrective action:</strong> {task.corrective_action}</div>}
          {task.recovery_date && <div style={{ marginTop: "4px" }}><strong>Expected recovery:</strong> {formatDateUK(task.recovery_date)}</div>}
          <div style={{ marginTop: "4px", fontSize: "12px", color: COLOURS.SLATE }}>By {task.reply_by || "unknown"} {task.reply_at ? `on ${formatDateUK(task.reply_at)}` : ""}</div>
        </div>
      )}
      {protected_ && !isPrivileged && (
        <div style={{ fontSize: "12px", color: COLOURS.AMBER, fontWeight: 600, marginBottom: "10px", padding: "4px 8px", backgroundColor: COLOURS.WARNING_SOFT, borderRadius: RADII.XS, border: `1px solid ${COLOURS.AMBER}` }}>
          Assigned by {task.assigned_by || "management"} — you can update status and add notes but cannot edit or delete this task.
        </div>
      )}
      {locked && (
        <div style={{ fontSize: "12px", color: COLOURS.SLATE, fontWeight: 600, marginBottom: "10px", padding: "6px 10px", backgroundColor: COLOURS.TRACK, borderRadius: RADII.XS, border: `1px solid ${COLOURS.HAIRLINE}` }}>
          This task is completed and locked. Only an admin can reopen or edit it.
        </div>
      )}

      {/* Two-column layout per the approved mockup: left is the editable
          core of the task (description/priority/dept/company, owners,
          comments); right is status/progress plus the WhatsApp/delete
          actions. Stacks to one column automatically below ~760px via the
          minmax fallback so it still works in a narrower window. */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1.35fr) minmax(240px, 1fr)", gap: "16px", alignItems: "start" }}>
        {/* ═══ LEFT COLUMN ═══ */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {taskEditable && !locked && (
            <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, padding: "12px", backgroundColor: COLOURS.CARD }}>
              <label style={{ display: "block", marginBottom: "8px" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                  <span>Description</span>
                  <span style={{ fontWeight: 500, color: editDesc.length > TASK_DESCRIPTION_LIMIT - 20 ? COLOURS.AMBER : COLOURS.SLATE }}>
                    {editDesc.length}/{TASK_DESCRIPTION_LIMIT}
                  </span>
                </span>
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value.slice(0, TASK_DESCRIPTION_LIMIT))}
                  onBlur={() => { if (editDesc.trim() && editDesc.trim() !== task.description) updateTaskField({ description: editDesc.trim() }); }}
                  maxLength={TASK_DESCRIPTION_LIMIT}
                  rows={2}
                  style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, padding: "7px 10px", fontSize: "13px", color: COLOURS.NAVY, fontFamily: "inherit", resize: "vertical" }}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                <label>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px" }}>Priority</span>
                  <select value={editPriority} onChange={(e) => { setEditPriority(e.target.value); updateTaskField({ priority: e.target.value }); }} style={{ width: "100%", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, padding: "6px 8px", fontSize: "13px", color: COLOURS.NAVY }}>
                    {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <label>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px" }}>Department</span>
                  <select value={editProject} onChange={(e) => { setEditProject(e.target.value); updateTaskField({ project: e.target.value || null }); }} style={{ width: "100%", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, padding: "6px 8px", fontSize: "13px", color: COLOURS.NAVY }}>
                    <option value="">-- None --</option>
                    {deptOwners.map((d) => <option key={d.id} value={d.department_name}>{d.department_name}</option>)}
                  </select>
                </label>
                <label>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px" }}>Company</span>
                  <select value={editCompanyId} onChange={(e) => { setEditCompanyId(e.target.value); updateTaskField({ company_id: e.target.value || null }); }} style={{ width: "100%", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, padding: "6px 8px", fontSize: "13px", color: COLOURS.NAVY }}>
                    <option value="">Group</option>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              </div>
            </div>
          )}

          {/* Owner(s) — collapsed to avatar-initial chips; "Edit" expands
              the full checkbox grid on demand instead of always showing it. */}
          <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, padding: "12px", backgroundColor: COLOURS.CARD }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE }}>Owner(s)</span>
              {taskEditable && !locked && (
                <span onClick={() => setOwnersEditOpen(!ownersEditOpen)} style={{ fontSize: "12px", color: COLOURS.BLUE, fontWeight: 600, cursor: "pointer" }}>
                  {ownersEditOpen ? "Done" : "Edit →"}
                </span>
              )}
            </div>

            {!ownersEditOpen && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {selectedOwners.map((m, i) => (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 10px 4px 4px", borderRadius: RADII.PILL, backgroundColor: COLOURS.CARD_ALT, border: `1px solid ${COLOURS.HAIRLINE}` }}>
                    <span style={{
                      width: "22px", height: "22px", borderRadius: "50%", backgroundColor: i === 0 ? COLOURS.BLUE : COLOURS.INK_300,
                      color: "white", fontSize: "10px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {initials(m.name)}
                    </span>
                    <span style={{ fontSize: "12.5px", color: COLOURS.NAVY, fontWeight: 600 }}>{m.name}</span>
                    {i === 0 && <span style={{ fontSize: "9px", fontWeight: 700, color: COLOURS.BLUE, letterSpacing: "0.04em" }}>PRIMARY</span>}
                  </div>
                ))}
                {selectedOwners.length === 0 && task.assigned_to && (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 10px 4px 4px", borderRadius: RADII.PILL, backgroundColor: COLOURS.CARD_ALT, border: `1px solid ${COLOURS.HAIRLINE}` }}>
                    <span style={{ width: "22px", height: "22px", borderRadius: "50%", backgroundColor: COLOURS.BLUE, color: "white", fontSize: "10px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {initials(task.assigned_to)}
                    </span>
                    <span style={{ fontSize: "12.5px", color: COLOURS.NAVY, fontWeight: 600 }}>{task.assigned_to}</span>
                  </div>
                )}
              </div>
            )}

            {ownersEditOpen && taskEditable && !locked && (
              <div style={{
                border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, padding: "8px 10px",
                maxHeight: "140px", overflowY: "auto", display: "flex", flexWrap: "wrap", gap: "8px",
                backgroundColor: "white",
              }}>
                {members.map((m) => {
                  const checked = editOwnerIds.includes(m.id);
                  const isPrimary = editOwnerIds[0] === m.id;
                  return (
                    <label key={m.id} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12.5px", color: checked ? COLOURS.NAVY : COLOURS.SLATE, cursor: "pointer", fontWeight: checked ? 600 : 400 }}>
                      <input type="checkbox" checked={checked} onChange={(e) => toggleEditOwner(m.id, e.target.checked)} style={{ width: "13px", height: "13px" }} />
                      {m.name}{isPrimary && <span style={{ fontSize: "10px", fontWeight: 700, color: COLOURS.BLUE }}> (primary)</span>}
                    </label>
                  );
                })}
                {members.length === 0 && <span style={{ fontSize: "12px", color: COLOURS.SLATE, fontStyle: "italic" }}>Loading members…</span>}
              </div>
            )}
          </div>

          {/* Comments — flat, oldest first, no edit/delete (append-only log) */}
          <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, padding: "12px", backgroundColor: COLOURS.CARD }}>
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
            {!locked && (
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
            )}
          </div>
        </div>

        {/* ═══ RIGHT COLUMN ═══ */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <TaskStatus task={task} currentRole={currentRole} onChanged={onChanged} onClose={onClose} myEmail={myEmail} canEditDueDate={(canReview ?? isPrivileged) || taskEditable} canEditTask={taskEditable} />

          {/* Captures intent only — still needs the WhatsApp Business API
              setup before anything actually sends by itself. See migration 105. */}
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12.5px", color: COLOURS.NAVY, cursor: locked ? "default" : "pointer", padding: "0 2px" }}>
            <input type="checkbox" checked={autoRemind} disabled={locked} onChange={toggleAutoRemind} style={{ width: "15px", height: "15px", accentColor: COLOURS.GREEN, cursor: locked ? "default" : "pointer" }} />
            Auto-remind on WhatsApp if overdue
          </label>

          {((canDelete ?? isPrivileged) || taskDeletable) && (
            <div style={{ display: "flex", gap: "6px" }}>
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
        </div>
      </div>
    </div>
  );
}
