"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { logAction } from "../lib/audit-log";
import { useToast, COLOURS, RADII } from "../lib/SharedUI";
import { formatDateUK } from "../lib/dateUtils";
import DateInput from "../lib/DateInput";
import DateInputWithCalendar from "../lib/DateInputWithCalendar";

type Task = {
  id: string;
  status: string;
  due_date: string | null;
  original_due_date?: string | null;
  stage?: string | null;
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

type Subtask = {
  id: string;
  title: string;
  is_complete: boolean;
  position: number;
};

type DueDateHistoryRow = {
  id: string;
  old_due_date: string | null;
  new_due_date: string | null;
  changed_by: string | null;
  changed_at: string;
};

const STATUSES = [
  "Not Started",
  "In Progress",
  "Waiting Reply",
  "Stuck",
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

  const [stage, setStage] = useState(task.stage || "");
  const [savingStage, setSavingStage] = useState(false);

  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");

  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newSubtask, setNewSubtask] = useState("");
  const [dueDateHistory, setDueDateHistory] = useState<DueDateHistoryRow[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const isReviewer = canReviewProp ?? (currentRole === "Admin" || currentRole === "Executive");
  const canEditDate = canEditDateProp ?? (currentRole === "Admin" || currentRole === "Executive");

  useEffect(() => {
    if (canEditDate) {
      supabase.from("members").select("name, email, department, phone_e164").order("name").then(({ data }) => {
        if (data) setMemberNames(data.map((m) => ({ name: m.name || "", email: m.email, department: m.department, phone_e164: m.phone_e164 || null })));
      });
    }
  }, [canEditDate]);

  async function loadSubtasks() {
    const { data } = await supabase
      .from("task_subtasks")
      .select("id, title, is_complete, position")
      .eq("task_id", task.id)
      .order("position", { ascending: true });
    setSubtasks(data || []);
  }

  useEffect(() => {
    loadSubtasks();
    supabase
      .from("task_due_date_history")
      .select("id, old_due_date, new_due_date, changed_by, changed_at")
      .eq("task_id", task.id)
      .order("changed_at", { ascending: false })
      .then(({ data }) => setDueDateHistory(data || []));
  }, [task.id]);

  const openSubtasks = subtasks.filter((s) => !s.is_complete).length;
  const hasSubtasks = subtasks.length > 0;

  async function saveStatus(newStatus: string) {
    if (newStatus === "Completed" && openSubtasks > 0) {
      toast.show(`Complete all ${subtasks.length} subtask${subtasks.length > 1 ? "s" : ""} before this task can be marked Completed.`, "error");
      return;
    }

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
    setDateMessage("Date saved ✓ — logged in due date history below");
    onChanged();
    supabase
      .from("task_due_date_history")
      .select("id, old_due_date, new_due_date, changed_by, changed_at")
      .eq("task_id", task.id)
      .order("changed_at", { ascending: false })
      .then(({ data }) => setDueDateHistory(data || []));
    setTimeout(() => setDateMessage(""), 3000);
  }

  async function saveStage() {
    setSavingStage(true);
    const { error } = await supabase
      .from("tasks")
      .update({ stage: stage.trim() || null, updated_at: new Date().toISOString() })
      .eq("id", task.id);
    setSavingStage(false);
    if (error) {
      toast.show("Error updating stage: " + error.message, "error");
      return;
    }
    logAction("Updated", "tasks", `Stage → ${stage}: ${task.id}`, task.id);
    onChanged();
  }

  async function addSubtask() {
    const title = newSubtask.trim();
    if (!title) return;
    const { error } = await supabase.from("task_subtasks").insert({
      task_id: task.id,
      title,
      position: subtasks.length,
    });
    if (error) {
      toast.show("Error adding subtask: " + error.message, "error");
      return;
    }
    setNewSubtask("");
    loadSubtasks();
  }

  async function toggleSubtask(sub: Subtask) {
    const { error } = await supabase
      .from("task_subtasks")
      .update({ is_complete: !sub.is_complete })
      .eq("id", sub.id);
    if (error) {
      toast.show("Error updating subtask: " + error.message, "error");
      return;
    }
    loadSubtasks();
  }

  async function removeSubtask(sub: Subtask) {
    const { error } = await supabase.from("task_subtasks").delete().eq("id", sub.id);
    if (error) {
      toast.show("Error removing subtask: " + error.message, "error");
      return;
    }
    loadSubtasks();
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

      {/* Stage — optional free-text pipeline label, separate from status */}
      <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <span style={kickerStyle}>Stage (optional)</span>
        <input
          type="text"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          onBlur={() => { if (stage !== (task.stage || "")) saveStage(); }}
          placeholder="e.g. Back to FD Dept"
          style={{ ...controlStyle, width: "220px" }}
          disabled={savingStage}
        />
      </div>

      {/* Subtasks — one flat checklist level, gates Completed */}
      <div style={{ marginTop: "12px" }}>
        <span style={kickerStyle}>Subtasks{hasSubtasks ? ` (${subtasks.length - openSubtasks} of ${subtasks.length} complete)` : " (none yet)"}</span>
        {subtasks.length > 0 && (
          <div style={{ marginTop: "6px", height: "6px", backgroundColor: COLOURS.TRACK, borderRadius: "3px", overflow: "hidden", maxWidth: "320px" }}>
            <div style={{ height: "100%", width: `${Math.round(((subtasks.length - openSubtasks) / subtasks.length) * 100)}%`, backgroundColor: COLOURS.GREEN }} />
          </div>
        )}
        <div style={{ marginTop: "8px" }}>
          {subtasks.map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 0" }}>
              <input type="checkbox" checked={s.is_complete} onChange={() => toggleSubtask(s)} style={{ width: "15px", height: "15px", accentColor: COLOURS.GREEN, cursor: "pointer" }} />
              <span style={{ fontSize: "13.5px", color: s.is_complete ? COLOURS.SLATE : COLOURS.NAVY, textDecoration: s.is_complete ? "line-through" : "none", flex: 1 }}>{s.title}</span>
              <button onClick={() => removeSubtask(s)} style={{ background: "none", border: "none", color: COLOURS.RED, fontSize: "11px", fontWeight: 600, cursor: "pointer" }}>Remove</button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
          <input
            type="text"
            value={newSubtask}
            onChange={(e) => setNewSubtask(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSubtask(); } }}
            placeholder="Add a subtask…"
            style={{ ...controlStyle, flex: 1, maxWidth: "320px" }}
          />
          <button onClick={addSubtask} style={{ ...controlStyle, backgroundColor: COLOURS.CARD_ALT, fontWeight: 600, cursor: "pointer" }}>+ Add</button>
        </div>
        {openSubtasks > 0 && (
          <p style={{ fontSize: "12px", color: COLOURS.AMBER, marginTop: "6px", marginBottom: 0 }}>
            Complete all subtasks before this task can be marked Completed.
          </p>
        )}
        {status !== "Completed" && status !== "Cancelled" && (
          <button
            onClick={() => saveStatus("Completed")}
            disabled={saving || openSubtasks > 0}
            style={{
              marginTop: "10px", width: "100%", maxWidth: "320px", padding: "10px",
              borderRadius: RADII.SM, border: "none", fontSize: "13.5px", fontWeight: 700,
              cursor: openSubtasks > 0 ? "not-allowed" : "pointer",
              backgroundColor: openSubtasks > 0 ? COLOURS.TRACK : COLOURS.GREEN,
              color: openSubtasks > 0 ? COLOURS.INK_400 : "white",
              opacity: saving ? 0.7 : 1,
            }}
          >
            Mark task complete
          </button>
        )}
      </div>

      {/* Due-date editor — original locked, current open, every move logged */}
      {canEditDate && (
        <div style={{ marginTop: "14px" }}>
          {task.original_due_date && (
            <div style={{ marginBottom: "8px", fontSize: "13px" }}>
              <span style={kickerStyle}>Original due date (locked)</span>{" "}
              <strong style={{ color: COLOURS.NAVY }}>{formatDateUK(task.original_due_date)}</strong>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <span style={kickerStyle}>Current due date</span>
            <DateInputWithCalendar
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
          {dueDateHistory.length > 0 && (
            <div style={{ marginTop: "8px" }}>
              <span
                onClick={() => setHistoryOpen(!historyOpen)}
                style={{ fontSize: "12px", color: COLOURS.SLATE, cursor: "pointer", fontWeight: 600 }}
              >
                {historyOpen ? "▼" : "▶"} Due date history ({dueDateHistory.length} move{dueDateHistory.length > 1 ? "s" : ""})
              </span>
              {historyOpen && (
                <div style={{ marginTop: "6px" }}>
                  {dueDateHistory.map((h) => (
                    <div key={h.id} style={{ fontSize: "12px", color: COLOURS.SLATE, padding: "4px 0", borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                      <strong style={{ color: COLOURS.NAVY }}>{h.old_due_date ? formatDateUK(h.old_due_date) : "—"}</strong>
                      {" → "}
                      <strong style={{ color: COLOURS.NAVY }}>{h.new_due_date ? formatDateUK(h.new_due_date) : "—"}</strong>
                      {" — moved by "}{h.changed_by || "unknown"}{", "}{formatDateUK(h.changed_at)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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
