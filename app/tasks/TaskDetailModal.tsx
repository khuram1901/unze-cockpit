"use client";

import Modal from "../lib/Modal";
import TaskDetailPanel from "./TaskDetailPanel";
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
    <Modal open={open} onClose={onClose}>
      <div style={{ padding: "18px 22px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
        <div style={{ flex: 1 }}>
          <h2
            style={{ fontFamily: "var(--font-display,'Inter Tight',sans-serif)", fontSize: "17px", fontWeight: 600, color: COLOURS.NAVY, margin: "0 0 8px", lineHeight: 1.35 }}
          >
            {task.description}
          </h2>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
            <StatusBadge status={task.status} />
            {task.priority && <PriorityBadge priority={task.priority} />}
            {task.stage && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "10.5px", fontWeight: 600, color: COLOURS.SLATE, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.XS, padding: "2px 8px" }}>
                → {task.stage}
              </span>
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
        />
      </div>
    </Modal>
  );
}
