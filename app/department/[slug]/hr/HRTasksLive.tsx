"use client";

/**
 * HRTasksLive.tsx — HR Tasks tab (30/08/2026)
 * ─────────────────────────────────────────────────────────────────
 * Shows the REAL HR tasks from the main tasks system (tasks table,
 * assigned_to_department = 'HR') — replacing the old parallel hr_tasks
 * mini-tracker which was a second task system that never held data.
 * Quick-create posts through /api/tasks/create so the full routing,
 * protection and notification rules apply. Full management stays on
 * the main Tasks page.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase, authFetch } from "../../../lib/supabase";
import { formatDateUK } from "../../../lib/dateUtils";
import DateInput from "../../../lib/DateInput";
import {
  COLOURS, RADII, SkeletonRows, useToast, primaryButtonStyle, inputStyle, labelStyle, StatusBadge,
} from "../../../lib/SharedUI";
import { useMobile } from "../../../lib/useMobile";

type Task = {
  id: string;
  description: string | null;
  assigned_to: string | null;
  assigned_to_email: string | null;
  status: string;
  priority: string | null;
  due_date: string | null;
  created_at: string;
};

const OPEN_STATUSES = ["Not Started", "In Progress", "Waiting Reply", "Stuck", "Submitted"];

const card: React.CSSProperties = {
  backgroundColor: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`,
  borderRadius: RADII.CARD, padding: "16px",
};

export default function HRTasksLive() {
  const isMobile = useMobile();
  const { show, element: toastElement } = useToast();
  const [tasks, setTasks]     = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [adding, setAdding]   = useState(false);
  const [saving, setSaving]   = useState(false);
  const [members, setMembers] = useState<{ id: string; name: string; email: string }[]>([]);
  const [form, setForm] = useState({ description: "", assignedToEmail: "", dueDate: "", priority: "Medium" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("tasks")
        .select("id, description, assigned_to, assigned_to_email, status, priority, due_date, created_at")
        .eq("assigned_to_department", "HR")
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(300);
      setTasks(data ?? []);
      const { data: hrMembers } = await supabase
        .from("members")
        .select("id, name, email")
        .eq("department", "HR")
        .eq("is_active", true)
        .order("name");
      setMembers(hrMembers ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createTask() {
    if (!form.description.trim()) { show("Describe the task first.", "error"); return; }
    setSaving(true);
    try {
      const res = await authFetch("/api/tasks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: form.description.trim(),
          assignedToEmail: form.assignedToEmail || undefined,
          assignedToDepartment: "HR",
          dueDate: form.dueDate || undefined,
          priority: form.priority,
        }),
      });
      const j = await res.json();
      if (!res.ok) { show(j.error ?? "Could not create task.", "error"); return; }
      show("Task created.", "success");
      setForm({ description: "", assignedToEmail: "", dueDate: "", priority: "Medium" });
      setAdding(false);
      load();
    } finally { setSaving(false); }
  }

  const open = tasks.filter(t => OPEN_STATUSES.includes(t.status));
  const done = tasks.filter(t => !OPEN_STATUSES.includes(t.status));
  const overdue = open.filter(t => t.due_date && t.due_date < new Date().toISOString().slice(0, 10));
  const shown = showDone ? tasks : open;

  const th: React.CSSProperties = {
    textAlign: "left", padding: "8px 12px", fontSize: "11px", fontWeight: 600,
    color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.5px",
    borderBottom: `1px solid ${COLOURS.HAIRLINE}`, whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    padding: "8px 12px", fontSize: "13px", color: COLOURS.NAVY,
    borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
  };

  return (
    <div>
      {toastElement}
      <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "14px" }}>
        HR department tasks from the main task system. Full management (status changes, sign-off, recurring) lives on the <a href="/tasks" style={{ color: COLOURS.BLUE }}>Tasks page</a>.
      </div>

      {/* Summary cards */}
      <div style={{
        display: "grid", gap: "10px", marginBottom: "16px",
        gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)",
      }}>
        <div style={card}><div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "4px" }}>Open</div><div style={{ fontSize: "22px", fontWeight: 600, color: COLOURS.NAVY }}>{loading ? "…" : open.length}</div></div>
        <div style={card}><div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "4px" }}>Overdue</div><div style={{ fontSize: "22px", fontWeight: 600, color: overdue.length > 0 ? COLOURS.RED : COLOURS.GREEN }}>{loading ? "…" : overdue.length}</div></div>
        <div style={card}><div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "4px" }}>Stuck / waiting</div><div style={{ fontSize: "22px", fontWeight: 600, color: COLOURS.AMBER }}>{loading ? "…" : open.filter(t => t.status === "Stuck" || t.status === "Waiting Reply").length}</div></div>
        <div style={card}><div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "4px" }}>Completed</div><div style={{ fontSize: "22px", fontWeight: 600, color: COLOURS.GREEN }}>{loading ? "…" : done.length}</div></div>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "12px", flexWrap: "wrap" }}>
        <button onClick={() => setAdding(a => !a)} style={primaryButtonStyle}>{adding ? "Cancel" : "+ New HR task"}</button>
        <label style={{ fontSize: "13px", color: COLOURS.SLATE, display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />
          Show completed
        </label>
      </div>

      {/* Quick create — goes through /api/tasks/create (full routing rules) */}
      {adding && (
        <div style={{ ...card, marginBottom: "14px" }}>
          <div style={{ display: "grid", gap: "10px", gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr 1fr 1fr" }}>
            <div>
              <label style={labelStyle}>Task description *</label>
              <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="What needs doing?" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={labelStyle}>Assign to (HR)</label>
              <select value={form.assignedToEmail} onChange={e => setForm({ ...form, assignedToEmail: e.target.value })} style={{ ...inputStyle, width: "100%" }}>
                <option value="">Department (unassigned)</option>
                {members.map(m => <option key={m.id} value={m.email}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Due date</label>
              <DateInput value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Priority</label>
              <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} style={{ ...inputStyle, width: "100%" }}>
                <option>High</option><option>Medium</option><option>Low</option>
              </select>
            </div>
          </div>
          <div style={{ marginTop: "10px" }}>
            <button onClick={createTask} disabled={saving} style={{ ...primaryButtonStyle, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Creating…" : "Create task"}
            </button>
          </div>
        </div>
      )}

      {/* Task list */}
      <div style={{ ...card, padding: 0, overflow: "auto", maxHeight: "540px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Task</th><th style={th}>Assigned to</th><th style={th}>Status</th>
              <th style={th}>Priority</th><th style={th}>Due</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows count={6} />
            ) : shown.length === 0 ? (
              <tr><td colSpan={5} style={{ ...td, textAlign: "center", color: COLOURS.SLATE, padding: "24px" }}>No {showDone ? "" : "open "}HR tasks.</td></tr>
            ) : shown.map(t => {
              const isOverdue = OPEN_STATUSES.includes(t.status) && t.due_date && t.due_date < new Date().toISOString().slice(0, 10);
              return (
                <tr key={t.id}>
                  <td style={{ ...td, maxWidth: "380px" }}>{t.description ?? "—"}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{t.assigned_to ?? "—"}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}><StatusBadge status={t.status} /></td>
                  <td style={{ ...td, whiteSpace: "nowrap", color: t.priority === "High" ? COLOURS.RED : COLOURS.INK_700 }}>{t.priority ?? "—"}</td>
                  <td style={{ ...td, whiteSpace: "nowrap", color: isOverdue ? COLOURS.RED : COLOURS.NAVY, fontWeight: isOverdue ? 600 : 400 }}>
                    {t.due_date ? formatDateUK(t.due_date) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
