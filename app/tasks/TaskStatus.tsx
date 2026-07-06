"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { logAction } from "../lib/audit-log";
import { useToast, COLOURS, RADII } from "../lib/SharedUI";
import DateInput from "../lib/DateInput";

type Task = {
  id: string;
  status: string;
  due_date: string | null;
  assigned_to: string | null;
  assigned_by: string | null;
  reply_required: boolean | null;
  reply_text: string | null;
  corrective_action: string | null;
  recovery_date: string | null;
  impact_on_monthly_target: string | null;
  time_spent_minutes: number | null;
  notes: string | null;
};

const STATUSES = [
  "Not Started",
  "In Progress",
  "Waiting Reply",
  "Submitted",
  "Completed",
  "Cancelled",
];

export default function TaskStatus({
  task,
  currentRole,
  onChanged,
  canReview: canReviewProp,
  canEditDueDate: canEditDateProp,
}: {
  task: Task;
  currentRole: string;
  onChanged: () => void;
  canReview?: boolean;
  canEditDueDate?: boolean;
  canEditTask?: boolean;
}) {
  const toast = useToast();
  const [status, setStatus] = useState(task.status);
  const [memberNames, setMemberNames] = useState<{ name: string; email: string | null; department: string | null; phone_e164: string | null }[]>([]);
  const [replyText, setReplyText] = useState(task.reply_text || "");
  const [correctiveAction, setCorrectiveAction] = useState(task.corrective_action || "");
  const [recoveryDate, setRecoveryDate] = useState(task.recovery_date || "");

  const [dueDate, setDueDate] = useState(task.due_date || "");
  const [savingDate, setSavingDate] = useState(false);
  const [dateMessage, setDateMessage] = useState("");

  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");

  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const isReviewer = canReviewProp ?? (currentRole === "Admin" || currentRole === "Executive");
  const canEditDate = canEditDateProp ?? (currentRole === "Admin" || currentRole === "Executive");

  useEffect(() => {
    if (canEditDate) {
      supabase.from("members").select("name, email, department, phone_e164").order("name").then(({ data }) => {
        if (data) setMemberNames(data.map((m) => ({ name: m.name || "", email: m.email, department: m.department, phone_e164: m.phone_e164 || null })));
      });
    }
  }, [canEditDate]);

  async function saveStatus(newStatus: string) {
    setSaving(true);
    setSavedMessage("");

    const { error } = await supabase
      .from("tasks")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", task.id);

    setSaving(false);

    if (error) {
      toast.show("Error updating status: " + error.message, "error");
      return;
    }

    logAction("Updated", "tasks", `Status → ${newStatus}: ${task.id}`, task.id);
    setStatus(newStatus);
    setSavedMessage("Saved ✓");
    onChanged();
    setTimeout(() => setSavedMessage(""), 2000);
  }

  async function saveDueDate() {
    setSavingDate(true);
    setDateMessage("");

    const { error } = await supabase
      .from("tasks")
      .update({ due_date: dueDate || null, updated_at: new Date().toISOString() })
      .eq("id", task.id);

    setSavingDate(false);

    if (error) {
      toast.show("Error updating due date: " + error.message, "error");
      return;
    }

    logAction("Updated", "tasks", `Due date → ${dueDate}: ${task.id}`, task.id);
    setDateMessage("Date saved ✓");
    onChanged();
    setTimeout(() => setDateMessage(""), 2000);
  }

  async function submitExplanation() {
    if (!replyText.trim()) {
      toast.show("Please write an explanation before submitting.", "error");
      return;
    }
    if (!correctiveAction.trim()) {
      toast.show("Please enter corrective action.", "error");
      return;
    }

    setSaving(true);
    setSavedMessage("");

    const { data: userData } = await supabase.auth.getUser();

    const { error } = await supabase
      .from("tasks")
      .update({
        reply_text: replyText,
        corrective_action: correctiveAction,
        recovery_date: recoveryDate || null,
        reply_by: userData.user?.email || "unknown",
        reply_at: new Date().toISOString(),
        status: "Submitted",
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id);

    setSaving(false);

    if (error) {
      toast.show("Error saving explanation: " + error.message, "error");
      return;
    }

    logAction("Updated", "tasks", `Explanation submitted: ${task.id}`, task.id);
    setStatus("Submitted");
    setSavedMessage("Response submitted ✓");
    onChanged();
    setTimeout(() => setSavedMessage(""), 2000);
  }

  async function saveNote() {
    if (!noteText.trim()) return;
    setSavingNote(true);

    const { data: userData } = await supabase.auth.getUser();
    const who = userData.user?.email || "unknown";
    const timestamp = new Date().toLocaleDateString("en-GB");
    const entry = `[${timestamp} — ${who}] ${noteText.trim()}`;
    const updated = task.notes ? `${task.notes}\n${entry}` : entry;

    const { error } = await supabase
      .from("tasks")
      .update({ notes: updated, updated_at: new Date().toISOString() })
      .eq("id", task.id);

    setSavingNote(false);
    if (error) {
      toast.show("Error saving note: " + error.message, "error");
      return;
    }

    logAction("Updated", "tasks", `Note added: ${noteText.trim().slice(0, 50)}`, task.id);
    setNoteText("");
    setShowNoteInput(false);
    onChanged();
  }

  const controlStyle: React.CSSProperties = {
    padding: "6px 8px",
    border: `1px solid ${COLOURS.HAIRLINE}`,
    borderRadius: RADII.SM,
    fontSize: "13px",
    color: COLOURS.NAVY,
    backgroundColor: COLOURS.CARD,
  };

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: "520px",
    padding: "8px 10px",
    border: `1px solid ${COLOURS.HAIRLINE}`,
    borderRadius: RADII.SM,
    fontSize: "13px",
    color: COLOURS.NAVY,
    display: "block",
    marginTop: "4px",
    marginBottom: "10px",
    boxSizing: "border-box",
  };

  const kickerStyle: React.CSSProperties = {
    fontSize: "10.5px",
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: COLOURS.SLATE,
  };

  return (
    <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>
      {toast.element}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <span style={kickerStyle}>Update status</span>

        <select
          style={controlStyle}
          value={status}
          onChange={(e) => saveStatus(e.target.value)}
          disabled={saving}
        >
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>

        {savedMessage && <span style={{ color: COLOURS.GREEN, fontSize: "13px", fontWeight: 600 }}>{savedMessage}</span>}
        {saving && <span style={{ color: COLOURS.SLATE, fontSize: "13px" }}>Saving…</span>}
      </div>

      {/* Due-date editor */}
      {canEditDate && (
        <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <span style={kickerStyle}>Due date</span>
          <DateInput
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            style={controlStyle}
          />
          <button
            onClick={saveDueDate}
            disabled={savingDate}
            style={{
              backgroundColor: COLOURS.BLUE,
              color: "white",
              border: "none",
              borderRadius: RADII.SM,
              padding: "6px 14px",
              fontSize: "13px",
              cursor: "pointer",
              fontWeight: 600,
              opacity: savingDate ? 0.7 : 1,
            }}
          >
            Save date
          </button>
          {dateMessage && <span style={{ color: COLOURS.GREEN, fontSize: "13px", fontWeight: 600 }}>{dateMessage}</span>}
          {savingDate && <span style={{ color: COLOURS.SLATE, fontSize: "13px" }}>Saving…</span>}
        </div>
      )}

      {/* Time tracking */}
      <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <span style={kickerStyle}>Time spent</span>
        <input
          type="number"
          min="0"
          step="15"
          defaultValue={task.time_spent_minutes || 0}
          onBlur={async (e) => {
            const mins = Number(e.target.value) || 0;
            if (mins !== (task.time_spent_minutes || 0)) {
              await supabase.from("tasks").update({ time_spent_minutes: mins, updated_at: new Date().toISOString() }).eq("id", task.id);
              logAction("Updated", "tasks", `Time: ${mins} minutes`, task.id);
              onChanged();
            }
          }}
          style={{ ...controlStyle, width: "80px" }}
        />
        <span style={{ fontSize: "13px", color: COLOURS.SLATE }}>minutes</span>
        {(task.time_spent_minutes || 0) > 0 && (
          <span style={{ fontSize: "13px", color: COLOURS.NAVY, fontWeight: 600 }}>
            ({Math.floor((task.time_spent_minutes || 0) / 60)}h {(task.time_spent_minutes || 0) % 60}m)
          </span>
        )}
      </div>

      {/* Add note */}
      <div style={{ marginTop: "12px" }}>
        {!showNoteInput ? (
          <button
            onClick={() => setShowNoteInput(true)}
            style={{
              backgroundColor: "transparent",
              color: COLOURS.BLUE,
              border: `1px solid ${COLOURS.BLUE}`,
              borderRadius: RADII.SM,
              padding: "5px 14px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            + Add Note
          </button>
        ) : (
          <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
            <textarea
              autoFocus
              placeholder="Add a progress update or note..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              style={{
                flex: 1, padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`,
                borderRadius: RADII.SM, fontSize: "13px", minHeight: "60px", resize: "vertical",
                color: COLOURS.NAVY,
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <button
                onClick={saveNote}
                disabled={savingNote || !noteText.trim()}
                style={{
                  backgroundColor: COLOURS.GREEN, color: "white", border: "none",
                  borderRadius: RADII.SM, padding: "6px 12px", fontSize: "13px",
                  fontWeight: 700, cursor: savingNote || !noteText.trim() ? "not-allowed" : "pointer",
                  opacity: savingNote || !noteText.trim() ? 0.5 : 1,
                }}
              >
                {savingNote ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => { setShowNoteInput(false); setNoteText(""); }}
                style={{
                  backgroundColor: "transparent", color: COLOURS.SLATE, border: "none",
                  fontSize: "13px", cursor: "pointer", padding: "4px",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Reassign: Admin / Executive only */}
      {canEditDate && (
        <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <span style={kickerStyle}>Reassign to</span>
          <select
            style={controlStyle}
            defaultValue=""
            onChange={async (e) => {
              if (!e.target.value) return;
              const m = memberNames.find((mem) => mem.name === e.target.value);
              await supabase.from("tasks").update({
                assigned_to: e.target.value,
                assigned_to_email: m?.email || null,
                assigned_to_department: m?.department || null,
                updated_at: new Date().toISOString(),
              }).eq("id", task.id);
              logAction("Updated", "tasks", `Reassigned to ${e.target.value}`, task.id);
              onChanged();
            }}
          >
            <option value="">Select person...</option>
            {memberNames.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
          </select>
        </div>
      )}

      {/* Assignee explanation form — status: Waiting Reply */}
      {task.reply_required && status === "Waiting Reply" && (
        <div style={{ marginTop: "12px" }}>
          <label>
            <span style={kickerStyle}>Explanation</span>
            <textarea
              placeholder="Explain what happened..."
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              style={{ ...fieldStyle, height: "90px" }}
            />
          </label>

          <label>
            <span style={kickerStyle}>Corrective Action</span>
            <textarea
              placeholder="What action has been taken or will be taken?"
              value={correctiveAction}
              onChange={(e) => setCorrectiveAction(e.target.value)}
              style={{ ...fieldStyle, height: "80px" }}
            />
          </label>

          <label>
            <span style={kickerStyle}>Expected Recovery Date</span>
            <DateInput
              value={recoveryDate}
              onChange={(e) => setRecoveryDate(e.target.value)}
              style={fieldStyle}
            />
          </label>

          <button
            onClick={submitExplanation}
            disabled={saving}
            style={{
              marginTop: "8px",
              backgroundColor: COLOURS.GREEN,
              color: "white",
              border: "none",
              borderRadius: RADII.SM,
              padding: "8px 18px",
              fontSize: "13px",
              cursor: "pointer",
              fontWeight: 700,
              opacity: saving ? 0.7 : 1,
            }}
          >
            Submit Explanation
          </button>
        </div>
      )}

      {/* Reviewer closes or reopens a Submitted task */}
      {isReviewer && status === "Submitted" && (
        <div style={{ marginTop: "12px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            onClick={() => saveStatus("Completed")}
            disabled={saving}
            style={{
              backgroundColor: COLOURS.GREEN,
              color: "white",
              border: "none",
              borderRadius: RADII.SM,
              padding: "8px 18px",
              fontSize: "13px",
              cursor: "pointer",
              fontWeight: 700,
              opacity: saving ? 0.7 : 1,
            }}
          >
            Accept &amp; Close
          </button>

          <button
            onClick={() => saveStatus("Waiting Reply")}
            disabled={saving}
            style={{
              backgroundColor: COLOURS.CARD,
              color: COLOURS.RED,
              border: `1px solid ${COLOURS.RED}`,
              borderRadius: RADII.SM,
              padding: "8px 18px",
              fontSize: "13px",
              cursor: "pointer",
              fontWeight: 700,
              opacity: saving ? 0.7 : 1,
            }}
          >
            Reopen (send back)
          </button>
        </div>
      )}
    </div>
  );
}
