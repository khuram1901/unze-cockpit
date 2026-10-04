"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { COLOURS, RADII } from "../lib/SharedUI";
import { canReopenCompletedTask } from "../lib/permissions";

// Extended type for subtasks — includes the new status machine columns added
// in migration 253 (status, submitted_at, submitted_by_email).
// is_complete is still present for backwards compat with embedded task row data.
type Subtask = {
  id: string;
  title: string;
  is_complete: boolean;
  position: number;
  status: "Not Started" | "Submitted" | "Completed";
  submitted_by_email: string | null;
};

// Per-subtask assignee record from task_subtask_assignees.
type SubtaskAssignee = {
  subtask_id: string;
  member_email: string;
  member_name: string;
  assigned_by_email: string;
};

// Lightweight member for the picker.
type MemberLite = {
  id: string;
  name: string;
  email: string | null;
  department: string | null;
};

type Task = {
  id: string;
  status?: string;
  assigned_by_email?: string | null;
  task_subtasks?: { id: string; is_complete: boolean }[];
};

// ─── helpers ────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(" ").map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
}

// Deterministic avatar colour based on email string.
const AVATAR_COLOURS = ["#3b82f6", "#22c55e", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4", "#ef4444"];
function avatarColour(email: string) {
  let h = 0;
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return AVATAR_COLOURS[Math.abs(h) % AVATAR_COLOURS.length];
}

// ─── component ──────────────────────────────────────────────────────────────

export default function MiniSubtaskToggle({
  task,
  onChanged,
  myEmail,
  currentRole,
}: {
  task: Task;
  onChanged: () => void;
  myEmail: string | null;
  currentRole: string;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [assignees, setAssignees] = useState<SubtaskAssignee[]>([]);

  // Member picker state — one picker can be open at a time (keyed by subtask id).
  const [pickerOpen, setPickerOpen] = useState<string | null>(null);
  const [members, setMembers] = useState<MemberLite[]>([]);
  const [pickerSearch, setPickerSearch] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  const [newTitle, setNewTitle] = useState("");
  const [actionBusy, setActionBusy] = useState<string | null>(null); // subtask id currently being submitted/approved

  // Locked if parent task is Completed and caller cannot reopen.
  const locked = task.status === "Completed" && !canReopenCompletedTask({ email: myEmail, role: currentRole });

  const embeddedTotal = task.task_subtasks?.length ?? 0;
  const embeddedDone  = task.task_subtasks?.filter((s) => s.is_complete).length ?? 0;
  const total = loaded ? subtasks.length : embeddedTotal;
  const done  = loaded ? subtasks.filter((s) => s.status === "Completed").length : embeddedDone;

  if (total === 0 && !open) return null;

  // ── data loading ──────────────────────────────────────────────────────
  async function load() {
    const [subtasksRes, assigneesRes] = await Promise.all([
      supabase
        .from("task_subtasks")
        .select("id, title, is_complete, position, status, submitted_by_email")
        .eq("task_id", task.id)
        .order("position", { ascending: true }),
      supabase
        .from("task_subtask_assignees")
        .select("subtask_id, member_email, member_name, assigned_by_email")
        .eq("task_id", task.id),
    ]);
    setSubtasks((subtasksRes.data || []) as Subtask[]);
    setAssignees(assigneesRes.data || []);
    setLoaded(true);
  }

  async function loadMembers() {
    if (members.length > 0) return;
    const { data } = await supabase
      .from("members")
      .select("id, name, email, department")
      .eq("is_active", true)
      .order("name");
    setMembers(data || []);
  }

  // Close picker on outside click.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(null);
      }
    }
    if (pickerOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [pickerOpen]);

  // ── actions ───────────────────────────────────────────────────────────

  // Old-style direct checkbox toggle for unassigned subtasks.
  async function toggleOne(sub: Subtask) {
    if (locked) return;
    await supabase.from("task_subtasks").update({ is_complete: !sub.is_complete }).eq("id", sub.id);
    await load();
    onChanged();
  }

  async function addOne() {
    if (locked) return;
    const title = newTitle.trim();
    if (!title) return;
    await supabase.from("task_subtasks").insert({ task_id: task.id, title, position: subtasks.length });
    setNewTitle("");
    await load();
    onChanged();
  }

  // Assign a member to a subtask via the existing subtask-assignees API.
  async function assignMember(sub: Subtask, m: MemberLite) {
    if (!m.email) return;
    setPickerOpen(null);
    await fetch(`/api/tasks/${task.id}/subtask-assignees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subtaskId: sub.id, memberEmail: m.email, memberName: m.name, memberId: m.id }),
    });
    await load();
    onChanged();
  }

  // Remove the assignee from a subtask.
  async function unassignMember(sub: Subtask, assignee: SubtaskAssignee) {
    await fetch(`/api/tasks/${task.id}/subtask-assignees`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subtaskId: sub.id, memberEmail: assignee.member_email }),
    });
    await load();
    onChanged();
  }

  // Submit a subtask (assignee → Submitted).
  async function submitSubtask(sub: Subtask) {
    setActionBusy(sub.id);
    try {
      const res = await fetch(`/api/tasks/${task.id}/subtasks/${sub.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to submit subtask.");
        return;
      }
      await load();
      onChanged();
    } finally {
      setActionBusy(null);
    }
  }

  // Approve a subtask (assigner → Completed).
  async function approveSubtask(sub: Subtask) {
    setActionBusy(sub.id);
    try {
      const res = await fetch(`/api/tasks/${task.id}/subtasks/${sub.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to approve subtask.");
        return;
      }
      await load();
      onChanged();
    } finally {
      setActionBusy(null);
    }
  }

  // ── per-subtask role resolution ───────────────────────────────────────
  function getMyRole(sub: Subtask): {
    assignee: SubtaskAssignee | null;
    iAmAssignee: boolean;
    iAmAssigner: boolean;
    iAmTaskCreator: boolean;
    canManage: boolean;
  } {
    const me = myEmail?.toLowerCase() ?? "";
    const assignee = assignees.find((a) => a.subtask_id === sub.id) ?? null;
    const iAmAssignee = assignee?.member_email.toLowerCase() === me;
    const iAmAssigner = assignee?.assigned_by_email.toLowerCase() === me;
    const iAmTaskCreator = (task.assigned_by_email ?? "").toLowerCase() === me;
    const adminRoles = ["CEO", "HOD", "PA", "Finance"];
    const isAdmin = adminRoles.includes(currentRole);
    const canManage = iAmAssigner || iAmTaskCreator || isAdmin;
    return { assignee, iAmAssignee, iAmAssigner, iAmTaskCreator, canManage };
  }

  // ── render ────────────────────────────────────────────────────────────

  const pickerMembers = members.filter((m) => {
    if (!pickerSearch) return true;
    const q = pickerSearch.toLowerCase();
    return m.name.toLowerCase().includes(q) || (m.email || "").toLowerCase().includes(q);
  });

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ padding: "5px 16px 8px 16px", borderTop: total > 0 ? `1px solid ${COLOURS.HAIRLINE}` : "none", backgroundColor: COLOURS.CARD }}
    >
      {/* ── header ─────────────────────────────────────────────────── */}
      <div
        onClick={() => { const next = !open; setOpen(next); if (next && !loaded) load(); }}
        style={{ cursor: "pointer", fontSize: "10.5px", fontWeight: 600, color: COLOURS.SLATE, display: "flex", alignItems: "center", gap: "5px" }}
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>Subtasks</span>
        <span style={{ fontSize: "10.5px", fontWeight: 700, color: COLOURS.SLATE, backgroundColor: COLOURS.TRACK, borderRadius: RADII.XS, padding: "1px 7px" }}>
          {done}/{total}
        </span>
      </div>

      {/* ── body ───────────────────────────────────────────────────── */}
      {open && (
        <div style={{ marginTop: "6px" }}>
          {locked && (
            <p style={{ fontSize: "11px", color: COLOURS.SLATE, margin: "0 0 6px" }}>
              Completed and locked — only an admin can reopen or edit it.
            </p>
          )}

          {subtasks.map((sub) => {
            const { assignee, iAmAssignee, iAmAssigner, iAmTaskCreator, canManage } = getMyRole(sub);
            const hasAssignee = !!assignee;
            const st = sub.status ?? (sub.is_complete ? "Completed" : "Not Started");
            const isCompleted = st === "Completed";
            const isSubmitted = st === "Submitted";
            const busy = actionBusy === sub.id;
            const showCheckbox = !hasAssignee && !locked;

            return (
              <div
                key={sub.id}
                style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 0", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, flexWrap: "wrap" }}
              >
                {/* Checkbox — only for unassigned subtasks */}
                {showCheckbox && (
                  <input
                    type="checkbox"
                    checked={isCompleted}
                    disabled={locked}
                    onChange={() => toggleOne(sub)}
                    style={{ width: "14px", height: "14px", accentColor: COLOURS.GREEN, cursor: "pointer", flexShrink: 0 }}
                  />
                )}

                {/* Status dot for assigned subtasks */}
                {hasAssignee && (
                  <div style={{
                    width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0,
                    backgroundColor: isCompleted ? COLOURS.GREEN : isSubmitted ? "#f59e0b" : COLOURS.TRACK,
                  }} />
                )}

                {/* Title */}
                <span style={{ fontSize: "12.5px", flex: 1, color: isCompleted ? COLOURS.SLATE : COLOURS.NAVY, textDecoration: isCompleted ? "line-through" : "none", lineHeight: 1.3 }}>
                  {sub.title}
                </span>

                {/* Submitted pill */}
                {isSubmitted && (
                  <span style={{ fontSize: "10px", fontWeight: 700, backgroundColor: "#fef9ec", color: "#92400e", borderRadius: RADII.XS, padding: "1px 7px", whiteSpace: "nowrap" }}>
                    Submitted
                  </span>
                )}

                {/* Assignee chip */}
                {hasAssignee && !isCompleted && (
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", backgroundColor: COLOURS.CARD_ALT, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "20px", padding: "2px 8px 2px 3px", fontSize: "10.5px", color: COLOURS.SLATE, whiteSpace: "nowrap" }}>
                    <div style={{
                      width: "16px", height: "16px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "8px", fontWeight: 700, color: "#fff", flexShrink: 0,
                      backgroundColor: avatarColour(assignee.member_email),
                    }}>
                      {initials(assignee.member_name)}
                    </div>
                    <span>{assignee.member_name.split(" ")[0]}</span>
                    {canManage && !locked && !isSubmitted && (
                      <button
                        onClick={() => unassignMember(sub, assignee)}
                        style={{ background: "none", border: "none", color: COLOURS.SLATE, fontSize: "12px", cursor: "pointer", padding: "0 0 0 2px", lineHeight: 1, opacity: 0.6 }}
                        title="Remove assignee"
                      >×</button>
                    )}
                  </div>
                )}

                {/* Action buttons */}
                {!locked && !isCompleted && (
                  <>
                    {/* SUBMIT — subtask assignee, Not Started */}
                    {hasAssignee && iAmAssignee && !isSubmitted && (
                      <button
                        disabled={busy}
                        onClick={() => submitSubtask(sub)}
                        style={{ fontSize: "10.5px", fontWeight: 700, color: "#92400e", backgroundColor: "#fef9ec", border: "1px solid #fde68a", borderRadius: RADII.XS, padding: "2px 9px", cursor: busy ? "default" : "pointer", whiteSpace: "nowrap", opacity: busy ? 0.6 : 1 }}
                      >
                        {busy ? "…" : "Submit →"}
                      </button>
                    )}

                    {/* MARK COMPLETE — assigner/task-creator/admin, Submitted */}
                    {hasAssignee && isSubmitted && (iAmAssigner || iAmTaskCreator) && (
                      <button
                        disabled={busy}
                        onClick={() => approveSubtask(sub)}
                        style={{ fontSize: "10.5px", fontWeight: 700, color: "#166534", backgroundColor: "#f0fdf4", border: "1px solid #86efac", borderRadius: RADII.XS, padding: "2px 9px", cursor: busy ? "default" : "pointer", whiteSpace: "nowrap", opacity: busy ? 0.6 : 1 }}
                      >
                        {busy ? "…" : "Mark Complete ✓"}
                      </button>
                    )}

                    {/* Submitted, waiting — shown to assignee when they can't approve */}
                    {hasAssignee && isSubmitted && iAmAssignee && !iAmAssigner && !iAmTaskCreator && (
                      <span style={{ fontSize: "10px", color: COLOURS.SLATE, fontStyle: "italic" }}>Pending approval</span>
                    )}

                    {/* ASSIGN BUTTON — no assignee yet, caller can manage */}
                    {!hasAssignee && canManage && (
                      <div ref={pickerOpen === sub.id ? pickerRef : null} style={{ position: "relative" }}>
                        <button
                          onClick={() => {
                            if (pickerOpen === sub.id) { setPickerOpen(null); return; }
                            setPickerOpen(sub.id);
                            setPickerSearch("");
                            loadMembers();
                          }}
                          style={{ fontSize: "10.5px", color: COLOURS.SLATE, backgroundColor: "transparent", border: `1px dashed ${COLOURS.HAIRLINE}`, borderRadius: "20px", padding: "2px 9px", cursor: "pointer", whiteSpace: "nowrap" }}
                        >
                          + Assign
                        </button>

                        {pickerOpen === sub.id && (
                          <div style={{ position: "absolute", right: 0, top: "100%", marginTop: "4px", backgroundColor: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, boxShadow: "0 4px 16px rgba(0,0,0,.12)", zIndex: 50, minWidth: "200px", overflow: "hidden" }}>
                            <div style={{ padding: "6px 8px", borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                              <input
                                autoFocus
                                value={pickerSearch}
                                onChange={(e) => setPickerSearch(e.target.value)}
                                placeholder="Search members…"
                                style={{ width: "100%", border: "none", backgroundColor: COLOURS.CARD_ALT, borderRadius: RADII.SM, padding: "4px 8px", fontSize: "11.5px", color: COLOURS.NAVY, outline: "none" }}
                              />
                            </div>
                            <div style={{ maxHeight: "180px", overflowY: "auto" }}>
                              {pickerMembers.length === 0 && (
                                <div style={{ padding: "8px 10px", fontSize: "11.5px", color: COLOURS.SLATE, fontStyle: "italic" }}>
                                  {members.length === 0 ? "Loading…" : "No match"}
                                </div>
                              )}
                              {pickerMembers.map((m) => (
                                <div
                                  key={m.id}
                                  onClick={() => assignMember(sub, m)}
                                  style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 10px", cursor: "pointer", fontSize: "12px", color: COLOURS.NAVY }}
                                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = COLOURS.CARD_ALT)}
                                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                                >
                                  <div style={{ width: "22px", height: "22px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", fontWeight: 700, color: "#fff", flexShrink: 0, backgroundColor: avatarColour(m.email || m.name) }}>
                                    {initials(m.name)}
                                  </div>
                                  <div>
                                    <div>{m.name}</div>
                                    {m.department && <div style={{ fontSize: "10px", color: COLOURS.SLATE }}>{m.department}</div>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* Completed badge */}
                {isCompleted && hasAssignee && (
                  <span style={{ fontSize: "10px", color: COLOURS.GREEN, fontWeight: 700 }}>✓ Done</span>
                )}
              </div>
            );
          })}

          {/* Add subtask */}
          {!locked && (
            <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOne(); } }}
                placeholder="Add a subtask…"
                style={{ flex: 1, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, padding: "5px 8px", fontSize: "12px", color: COLOURS.NAVY, backgroundColor: COLOURS.CARD_ALT }}
              />
              <button
                onClick={addOne}
                style={{ border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: COLOURS.CARD_ALT, borderRadius: RADII.SM, padding: "5px 10px", fontSize: "11.5px", fontWeight: 600, color: COLOURS.NAVY, cursor: "pointer" }}
              >+</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
