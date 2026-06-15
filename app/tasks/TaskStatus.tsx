"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useRouter } from "next/navigation";

type Task = {
  id: string;
  status: string;
  reply_required: boolean | null;
  reply_text: string | null;
  corrective_action: string | null;
  recovery_date: string | null;
  impact_on_monthly_target: string | null;
};
const STATUSES = [
  "Not Started",
  "In Progress",
  "Waiting Reply",
  "Decision Required",
  "Approval Required",
  "Completed",
  "Cancelled",
];

export default function TaskStatus({ task }: { task: Task }) {
  const router = useRouter();

  const [status, setStatus] = useState(task.status);
  const [replyText, setReplyText] = useState(task.reply_text || "");
  const [correctiveAction, setCorrectiveAction] = useState(task.corrective_action || "");
  const [recoveryDate, setRecoveryDate] = useState(task.recovery_date || "");
  const [impactOnMonthlyTarget, setImpactOnMonthlyTarget] = useState(
    task.impact_on_monthly_target || ""
  );

  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");

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

    setStatus(newStatus);
    setSavedMessage("Saved ✓");
    router.refresh();

    setTimeout(() => setSavedMessage(""), 2000);
  }

  async function saveReply() {
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
        impact_on_monthly_target: impactOnMonthlyTarget || null,
        reply_by: userData.user?.email || "unknown",
        reply_at: new Date().toISOString(),
        status: "In Progress",
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id);

    setSaving(false);

    if (error) {
      alert("Error saving explanation: " + error.message);
      return;
    }

    setStatus("In Progress");
    setSavedMessage("Response saved ✓");
    router.refresh();

    setTimeout(() => {
      setSavedMessage("");
    }, 2000);
  }

  function handleStatusChange(newStatus: string) {
    saveStatus(newStatus);
  }

  const controlStyle = {
    padding: "6px",
    border: "1px solid #ccc",
    borderRadius: "6px",
    fontSize: "14px",
  };

  const fieldStyle = {
    width: "100%",
    maxWidth: "520px",
    padding: "8px",
    border: "1px solid #ccc",
    borderRadius: "6px",
    fontSize: "14px",
    display: "block",
    marginTop: "4px",
    marginBottom: "10px",
  };

  return (
    <div
      style={{
        marginTop: "12px",
        paddingTop: "12px",
        borderTop: "1px solid #eee",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: "14px",
            fontWeight: "bold",
          }}
        >
          Update status:
        </span>

        <select
          style={controlStyle}
          value={status}
          onChange={(e) => handleStatusChange(e.target.value)}
          disabled={saving}
        >
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>

        {savedMessage && (
          <span style={{ color: "green", fontSize: "14px" }}>{savedMessage}</span>
        )}

        {saving && <span style={{ color: "#888", fontSize: "14px" }}>Saving…</span>}
      </div>

      {task.reply_required && status === "Waiting Reply" && (
        <div style={{ marginTop: "12px" }}>
          <label style={{ fontSize: "14px", fontWeight: "bold" }}>
            Explanation
            <textarea
              placeholder="Explain what happened..."
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              style={{ ...fieldStyle, height: "90px" }}
            />
          </label>

          <label style={{ fontSize: "14px", fontWeight: "bold" }}>
            Corrective Action
            <textarea
              placeholder="What action has been taken or will be taken?"
              value={correctiveAction}
              onChange={(e) => setCorrectiveAction(e.target.value)}
              style={{ ...fieldStyle, height: "80px" }}
            />
          </label>

          <label style={{ fontSize: "14px", fontWeight: "bold" }}>
            Expected Recovery Date
            <input
              type="date"
              value={recoveryDate}
              onChange={(e) => setRecoveryDate(e.target.value)}
              style={fieldStyle}
            />
          </label>

          <button
            onClick={saveReply}
            disabled={saving}
            style={{
              marginTop: "8px",
              backgroundColor: "#16a34a",
              color: "white",
              border: "none",
              borderRadius: "6px",
              padding: "8px 16px",
              fontSize: "14px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            Submit Explanation
          </button>
        </div>
      )}
    </div>
  );
}