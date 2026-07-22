"use client";

import Modal from "../lib/Modal";
import TaskDetailPanel from "./TaskDetailPanel";
import { formatDateUK } from "../lib/dateUtils";
import { COLOURS, RADII, StatusBadge, PriorityBadge } from "../lib/SharedUI";

// The finalised Tasks mockup opens task detail as a centred modal popup,
// not an inline expand-in-row/card panel. This wraps the existing
// TaskDetailPanel (unchanged) with the header (title, status/priority
// pills, stage chip) the mockup's modal has, so List rows and Board cards
// both open the same modal instead of two different inline patterns.
//
// Description/Priority/Department/Company/Owner(s) are always editable
// inside TaskDetailPanel now (no more click-to-edit toggle — Khuram found
// that pattern hid them too well), so this header is just a header.

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

export default function TaskDetailModal({
  task,
  open,
  onClose,
  currentRole,
  isPrivileged,
  canReview,
  canDelete,
  myEmail,
  memberPhones,
  onChanged,
}: {
  task: Task | null;
  open: boolean;
  onClose: () => void;
  currentRole: string;
  isPrivileged: boolean;
  canReview?: boolean;
  canDelete?: boolean;
  myEmail: string | null;
  memberPhones: Record<string, string>;
  onChanged: () => void;
}) {
  if (!task) return null;

  return (
    <Modal open={open} onClose={onClose} maxWidth="820px">
      <div style={{ padding: "18px 22px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
        <div style={{ flex: 1 }}>
          <h2
            style={{ fontFamily: "var(--font-display,'Inter Tight',sans-serif)", fontSize: "17px", fontWeight: 600, color: COLOURS.NAVY, margin: "0 0 8px", lineHeight: 1.35 }}
          >
            {task.description}
          </h2>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center", marginBottom: "8px" }}>
            <StatusBadge status={task.status} />
            {task.priority && <PriorityBadge priority={task.priority} />}
            {task.stage && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "10.5px", fontWeight: 600, color: COLOURS.SLATE, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.XS, padding: "2px 8px" }}>
                → {task.stage}
              </span>
            )}
          </div>
          {/* Compact meta line — moved up here from TaskDetailPanel's body
              so it reads as context for the title rather than competing
              with the two-column layout underneath. */}
          <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>
            {task.task_type || "Task"}
            {" · Assigned by "}<strong style={{ color: COLOURS.NAVY, fontWeight: 600 }}>{task.assigned_by || "—"}</strong>
            {" · Issued "}{formatDateUK(task.assigned_date)}
            {task.project && <span>{" · "}{task.project}</span>}
            {task.meeting_id && (
              <span> · <a href={`/my-minutes?meeting=${task.meeting_id}`} style={{ color: COLOURS.BLUE, fontWeight: 600, textDecoration: "none" }}>View Minutes →</a></span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ background: "none", border: "none", fontSize: "20px", color: COLOURS.INK_400, cursor: "pointer", lineHeight: 1, padding: "2px" }}
        >
          ×
        </button>
      </div>
      <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
        <TaskDetailPanel
          key={task.id}
          task={task}
          currentRole={currentRole}
          isPrivileged={isPrivileged}
          canReview={canReview}
          canDelete={canDelete}
          myEmail={myEmail}
          memberPhones={memberPhones}
          onChanged={onChanged}
          onClose={onClose}
        />
      </div>
    </Modal>
  );
}
