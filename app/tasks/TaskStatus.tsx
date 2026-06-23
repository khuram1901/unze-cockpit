"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { logAction } from "../lib/audit-log";

type Task = {
  id: string;
  status: string;
  due_date: string | null;
  reply_required: boolean | null;
  reply_text: string | null;
  corrective_action: string | null;
  recovery_date: string | null;
  impact_on_monthly_target: string | null;
  time_spent_minutes: number | null;
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
}: {
  task: Task;
  currentRole: string;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState(task.status);
  const [memberNames, setMemberNames] = useState<{ name: string; email: string | null; department: string | null }[]>([]);
  const [replyText, setReplyText] = useState(task.reply_text || "");
  const [correctiveAction, setCorrectiveAction] = useState(task.corrective_action || "");
  const [recoveryDate, setRecoveryDate] = useState(task.recovery_date || "");

  // Due-date editing (Admin / Executive only)
  const [dueDate, setDueDate] = useState(task.due_date || "");
  const [savingDate, setSavingDate] = useState(false);
  const [dateMessage, setDateMessage] = useState("");

  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");

  const isReviewer = currentRole === "Admin" || currentRole === "Executive";
  const canEditDate = currentRole === "Admin" || currentRole === "Executive";

  useEffect(() => {
    if (canEditDate) {
      supabase.from("members").select("name, email, department").order("name").then(({ data }) => {
        if (data) setMemberNames(data.map((m) => ({ name: m.name || "", email: m.email, department: m.department })));
      });
    }
  }, [canEditDate]);

  async function saveStatus(newStatus: string) {
    setSaving(true);
    setSavedMessage("");

    const { error } = await supabase
      .from("tasks")
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id);

    setSaving(false);

    if (error) {
      alert("Error updating status: " + error.message);
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
      .update({
        due_date: dueDate || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id);

    setSavingDate(false);

    if (error) {
      alert("Error updating due date: " + error.message);
      return;
    }

    logAction("Updated", "tasks", `Due date → ${dueDate}: ${task.id}`, task.id);
    setDateMessage("Date saved ✓");
    onChanged();
    setTimeout(() => setDateMessage(""), 2000);
  }

  async function submitExplanation() {
    if (!replyText.trim()) {
      alert("Please write an explanation before submitting.");
      return;
    }
    if (!correctiveAction.trim()) {
      alert("Please enter corrective action.");
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
        status: "Submitted", // ball goes to the reviewer, not "In Progress"
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id);

    setSaving(false);

    if (error) {
      alert("Error saving explanation: " + error.message);
      return;
    }

    logAction("Updated", "tasks", `Explanation submitted: ${task.id}`, task.id);
    setStatus("Submitted");
    setSavedMessage("Response submitted ✓");
    onChanged();
    setTimeout(() => setSavedMessage(""), 2000);
  }

  const controlStyle = {
    padding: "6px",
    border: "1px solid #e2e8f0",
    borderRadius: "6px",
    fontSize: "16px",
  };

  const fieldStyle = {
    width: "100%",
    maxWidth: "520px",
    padding: "8px",
    border: "1px solid #e2e8f0",
    borderRadius: "6px",
    fontSize: "16px",
    display: "block",
    marginTop: "4px",
    marginBottom: "10px",
  };

  return (
    <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #e2e8f0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "16px", fontWeight: "bold" }}>Update status:</span>

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

        {savedMessage && <span style={{ color: "green", fontSize: "16px" }}>{savedMessage}</span>}
        {saving && <span style={{ color: "#64748b", fontSize: "16px" }}>Saving…</span>}
      </div>

      {/* Due-date editor: Admin / Executive only */}
      {canEditDate && (
        <div
          style={{
            marginTop: "12px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: "16px", fontWeight: "bold" }}>Due date:</span>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            style={controlStyle}
            disabled={savingDate}
          />
          <button
            onClick={saveDueDate}
            disabled={savingDate}
            style={{
              backgroundColor: "#2563eb",
              color: "white",
              border: "none",
              borderRadius: "6px",
              padding: "6px 14px",
              fontSize: "16px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            Save date
          </button>
          {dateMessage && <span style={{ color: "green", fontSize: "16px" }}>{dateMessage}</span>}
          {savingDate && <span style={{ color: "#64748b", fontSize: "16px" }}>Saving…</span>}
        </div>
      )}

      {/* Time tracking */}
      <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "14px", fontWeight: "bold" }}>Time spent:</span>
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
        <span style={{ fontSize: "13px", color: "#64748b" }}>minutes</span>
        {(task.time_spent_minutes || 0) > 0 && (
          <span style={{ fontSize: "13px", color: "#1e293b", fontWeight: 600 }}>
            ({Math.floor((task.time_spent_minutes || 0) / 60)}h {(task.time_spent_minutes || 0) % 60}m)
          </span>
        )}
      </div>

      {/* Reassign: Admin / Executive only */}
      {canEditDate && (
        <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "14px", fontWeight: "bold" }}>Reassign to:</span>
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

      {/* The assignee fills in their explanation while status is Waiting Reply */}
      {task.reply_required && status === "Waiting Reply" && (
        <div style={{ marginTop: "12px" }}>
          <label style={{ fontSize: "16px", fontWeight: "bold" }}>
            Explanation
            <textarea
              placeholder="Explain what happened..."
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              style={{ ...fieldStyle, height: "90px" }}
            />
          </label>

          <label style={{ fontSize: "16px", fontWeight: "bold" }}>
            Corrective Action
            <textarea
              placeholder="What action has been taken or will be taken?"
              value={correctiveAction}
              onChange={(e) => setCorrectiveAction(e.target.value)}
              style={{ ...fieldStyle, height: "80px" }}
            />
          </label>

          <label style={{ fontSize: "16px", fontWeight: "bold" }}>
            Expected Recovery Date
            <input
              type="date"
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
              backgroundColor: "#16a34a",
              color: "white",
              border: "none",
              borderRadius: "6px",
              padding: "8px 16px",
              fontSize: "16px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            Submit Explanation
          </button>
        </div>
      )}

      {/* Reviewer (Admin/Executive) closes or reopens a Submitted task */}
      {isReviewer && status === "Submitted" && (
        <div style={{ marginTop: "12px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            onClick={() => saveStatus("Completed")}
            disabled={saving}
            style={{
              backgroundColor: "#16a34a",
              color: "white",
              border: "none",
              borderRadius: "6px",
              padding: "8px 16px",
              fontSize: "16px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            Accept & Close
          </button>

          <button
            onClick={() => saveStatus("Waiting Reply")}
            disabled={saving}
            style={{
              backgroundColor: "white",
              color: "#dc2626",
              border: "1px solid #dc2626",
              borderRadius: "6px",
              padding: "8px 16px",
              fontSize: "16px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            Reopen (send back)
          </button>
        </div>
      )}
    </div>
  );
}
