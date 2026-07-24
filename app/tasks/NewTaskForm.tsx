"use client";

import { useState, useEffect } from "react";
import { supabase, authFetch } from "../lib/supabase";
import { useRouter } from "next/navigation";
import { logAction } from "../lib/audit-log";
import { useToast, COLOURS, RADII, TASK_DESCRIPTION_LIMIT, TASK_COMPANY_CODES } from "../lib/SharedUI";
import { filterAssignableMembers } from "../lib/permissions";
import DateInputWithCalendar from "../lib/DateInputWithCalendar";
import MentionTextarea, { MentionMember } from "../lib/MentionTextarea";

type Member = {
  id: string;
  name: string;
  email: string | null;
  role: string;
  department: string | null;
  business_unit: string | null;
};

type DepartmentOwner = {
  id: string;
  department_name: string;
  primary_owner_member_id: string | null;
  primary_owner_name: string | null;
  primary_owner_email: string | null;
};

type Company = {
  id: string;
  name: string;
  short_code: string | null;
};


const PROJECT_AREAS = [
  "Unze Trading Ops",
  "Finance",
  "HR",
  "Admin",
  "IT",
  "Tax",
  "Legal",
  "Sales",
  "Audit",
  "S&M Investment",
  "BINC",
];

// "Completed" is deliberately NOT offered as a starting status — found
// during the 15 Jul 2026 full-app audit that offering it here let anyone
// hand themselves a pre-closed task, skipping HOD review entirely (the
// only door to Completed is meant to be Submitted -> HOD "Mark Complete").
// createTaskCore() also rejects it server-side now, so this isn't just a
// UI-level restriction.
const STATUSES = [
  "Not Started",
  "In Progress",
  "Waiting Reply",
  "Stuck",
  "Submitted",
  "Cancelled",
];

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "7px 10px",
  marginTop: "4px",
  marginBottom: "12px",
  border: `1px solid ${COLOURS.HAIRLINE}`,
  borderRadius: RADII.SM,
  fontSize: "14px",
  color: COLOURS.NAVY,
  backgroundColor: COLOURS.CARD,
  boxSizing: "border-box",
};

const kickerStyle: React.CSSProperties = {
  fontSize: "10.5px",
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: COLOURS.SLATE,
  display: "block",
};

export default function NewTaskForm({ onCreated }: { onCreated?: () => void } = {}) {
  const router = useRouter();
  const toast = useToast();
  const today = todayDate();

  const [members, setMembers] = useState<Member[]>([]);
  const [departmentOwners, setDepartmentOwners] = useState<DepartmentOwner[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);

  const [description, setDescription] = useState("");
  const [companyId, setCompanyId] = useState<string>(""); // "" = Group / needs review
  const [companyTouched, setCompanyTouched] = useState(false); // must actively pick, "" is a real choice not a default
  const [project, setProject] = useState("");
  const [stage, setStage] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [status, setStatus] = useState("Not Started");
  const [dueDate, setDueDate] = useState("");
  // Multi-owner: Khuram wants the same task assignable to more than one
  // person, each seeing it as their own — not just a heads-up. First
  // person ticked stays the "primary" owner for every existing report/
  // notification/WhatsApp reminder that only knows about one; the rest
  // are additive co-owners stored in task_assignees.
  const [assignedToIds, setAssignedToIds] = useState<string[]>([]);
  const [assignedBy, setAssignedBy] = useState("");
  const [assignedByEmail, setAssignedByEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [subtaskInput, setSubtaskInput] = useState("");

  // Track which members were added via @mention so we can show them as pills
  // below the notes field. Adding via @mention also auto-ticks them in the
  // assignee checkbox list (same assignedToIds state).
  const [mentionedMemberIds, setMentionedMemberIds] = useState<string[]>([]);

  function handleMentionAdded(member: MentionMember) {
    // Add to assignees if not already there
    setAssignedToIds((prev) => prev.includes(member.id) ? prev : [...prev, member.id]);
    // Track which ones came via @mention (for the pill display)
    setMentionedMemberIds((prev) => prev.includes(member.id) ? prev : [...prev, member.id]);
  }

  useEffect(() => {
    async function loadInitialData() {
      const { data: userData } = await supabase.auth.getUser();
      const currentEmail = userData.user?.email || "";

      setAssignedByEmail(currentEmail);

      const { data: memberData } = await supabase
        .from("members")
        .select("name, role")
        .eq("email", currentEmail)
        .single();

      setAssignedBy(memberData?.name || currentEmail);

      const [membersRes, ownersRes, companiesRes] = await Promise.all([
        supabase
          .from("members")
          .select("id, name, email, role, department, business_unit")
          .eq("is_active", true)
          .order("name", { ascending: true }),

        supabase
          .from("department_owners")
          .select(
            "id, department_name, primary_owner_member_id, primary_owner_name, primary_owner_email"
          )
          .eq("active", true)
          .order("department_name", { ascending: true }),

        supabase
          .from("companies")
          .select("id, name, short_code")
          .in("short_code", TASK_COMPANY_CODES)
          .order("name", { ascending: true }),
      ]);

      // CEO assignment lock (Khuram, 24/07/2026): the CEOs never appear
      // as assignable unless the viewer is a CEO account or the PA.
      // Server-side twin lives in createTaskCore.
      if (membersRes.data) setMembers(filterAssignableMembers(membersRes.data, currentEmail));
      if (ownersRes.data) setDepartmentOwners(ownersRes.data);
      if (companiesRes.data) setCompanies(companiesRes.data);
    }

    loadInitialData();
  }, []);

  function handleProjectChange(value: string) {
    setProject(value);

    const owner = departmentOwners.find((d) => d.department_name === value);

    if (owner?.primary_owner_member_id && members.some((m) => m.id === owner.primary_owner_member_id)) {
      setAssignedToIds([owner.primary_owner_member_id]);
    } else {
      setAssignedToIds([]);
    }
  }

  function addSubtask() {
    const text = subtaskInput.trim();
    if (!text) return;
    setSubtasks((prev) => [...prev, text]);
    setSubtaskInput("");
  }

  function removeSubtask(index: number) {
    setSubtasks((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!dueDate) {
      toast.show("Due date is required — every task must have a deadline.", "error");
      return;
    }
    if (!companyTouched || !companyId) {
      toast.show("Please choose a Company.", "error");
      return;
    }
    if (assignedToIds.length === 0) {
      toast.show("Select at least one person to assign this to.", "error");
      return;
    }

    setSaving(true);

    const selectedMembers = assignedToIds.map((id) => members.find((m) => m.id === id)).filter((m): m is Member => !!m);
    const [primaryMember, ...coMembers] = selectedMembers;
    const assignedTo = primaryMember.name;
    const assignedToEmail = primaryMember.email;

    const needsReply = status === "Waiting Reply";

    // Routes through the shared task-creation gate (see
    // TASK_NOTIFICATION_AUDIT.md) instead of inserting directly — this
    // form was already the closest to "doing it right," so this mainly
    // just brings it onto the same rails as every other creation path.
    const res = await authFetch("/api/tasks/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskType: "Task",
        description,
        companyId,
        project,
        stage: stage.trim() || null,
        priority,
        status,
        dueDate,
        assignedTo,
        assignedToEmail,
        assignedToMemberId: primaryMember.id,
        additionalAssignees: coMembers.map((m) => ({ memberId: m.id, name: m.name, email: m.email })),
        assignedToDepartment: primaryMember.department || project || null,
        assignedToBusinessUnit: primaryMember.business_unit || null,
        notes,
        replyRequired: needsReply,
      }),
    });
    const result = await res.json().catch(() => ({}));

    if (!res.ok || result?.error) {
      setSaving(false);
      toast.show("Error saving task: " + (result?.error || "Unknown error"), "error");
      return;
    }

    const newTaskId: string | undefined = result?.taskId;

    if (subtasks.length > 0 && newTaskId) {
      const { error: subtaskError } = await supabase.from("task_subtasks").insert(
        subtasks.map((title, i) => ({ task_id: newTaskId, title, position: i }))
      );
      if (subtaskError) {
        toast.show("Task created, but subtasks failed to save: " + subtaskError.message, "error");
      }
    }

    setSaving(false);

    logAction("Created", "tasks", `Task: ${description} → ${selectedMembers.map((m) => m.name).join(", ")}`);

    setDescription("");
    setCompanyId("");
    setCompanyTouched(false);
    setProject("");
    setStage("");
    setPriority("Medium");
    setStatus("Not Started");
    setDueDate("");
    setAssignedToIds([]);
    setNotes("");
    setSubtasks([]);
    setSubtaskInput("");
    setMentionedMemberIds([]);

    router.refresh();
    onCreated?.();
  }

  const selectedMembers = assignedToIds.map((id) => members.find((m) => m.id === id)).filter((m): m is Member => !!m);
  const selectedOwner = departmentOwners.find((d) => d.department_name === project);

  function toggleAssignee(id: string, checked: boolean) {
    setAssignedToIds((prev) => checked ? [...prev, id] : prev.filter((x) => x !== id));
  }

  return (
    <>
      {toast.element}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: "16px 20px",
          backgroundColor: COLOURS.CARD,
        }}
      >
        <h2 style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "14px", letterSpacing: "-0.01em" }}>
          New Task
        </h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0 16px" }}>

          <label style={{ gridColumn: "1 / -1" }}>
            <span style={{ ...kickerStyle, display: "flex", justifyContent: "space-between" }}>
              <span>What needs to be done?</span>
              <span style={{ color: description.length > TASK_DESCRIPTION_LIMIT - 20 ? COLOURS.AMBER : COLOURS.SLATE, fontWeight: 600 }}>
                {description.length}/{TASK_DESCRIPTION_LIMIT}
              </span>
            </span>
            <textarea
              style={{ ...inputStyle, height: "80px" }}
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, TASK_DESCRIPTION_LIMIT))}
              maxLength={TASK_DESCRIPTION_LIMIT}
              required
              placeholder="Example: Follow up on MEPCO production shortfall and report recovery plan. One line, not a paragraph."
            />
          </label>

          <label>
            <span style={kickerStyle}>Company *</span>
            <select
              style={{ ...inputStyle, color: companyTouched ? COLOURS.NAVY : COLOURS.SLATE }}
              value={companyTouched ? companyId : "__unselected__"}
              onChange={(e) => {
                setCompanyTouched(true);
                setCompanyId(e.target.value);
              }}
              required
            >
              <option value="__unselected__" disabled>Select…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>

          <label>
            <span style={kickerStyle}>Department / project area *</span>
            <select
              style={inputStyle}
              value={project}
              onChange={(e) => handleProjectChange(e.target.value)}
              required
            >
              <option value="">-- Select department / area --</option>
              <option value="Executive Office">Executive Office</option>
              {PROJECT_AREAS.map((area) => (
                <option key={area}>{area}</option>
              ))}
            </select>
          </label>

          {project && (
            <div
              style={{
                border: `1px solid ${COLOURS.HAIRLINE}`,
                borderRadius: RADII.SM,
                padding: "10px 12px",
                marginBottom: "12px",
                backgroundColor: COLOURS.CARD_ALT,
                fontSize: "13px",
                color: COLOURS.SLATE,
                gridColumn: "1 / -1",
              }}
            >
              Default owner:{" "}
              <strong style={{ color: COLOURS.NAVY }}>{selectedOwner?.primary_owner_name || "No owner set for this department"}</strong>
            </div>
          )}

          <label>
            <span style={kickerStyle}>Priority</span>
            <select style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option>Urgent</option>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
          </label>

          <label>
            <span style={kickerStyle}>Starting status</span>
            <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>

          <label>
            <span style={kickerStyle}>Stage (optional)</span>
            <input
              type="text"
              style={inputStyle}
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              placeholder="e.g. Submitted to Civil Dept"
            />
          </label>

          <label>
            <span style={kickerStyle}>Assigned to — tick everyone this applies to; the first person ticked is the primary owner</span>
            <div style={{
              marginTop: "4px", marginBottom: "12px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM,
              padding: "8px 10px", maxHeight: "160px", overflowY: "auto", display: "flex", flexWrap: "wrap", gap: "8px",
              backgroundColor: COLOURS.CARD,
            }}>
              {members.map((m) => {
                const checked = assignedToIds.includes(m.id);
                const isPrimary = assignedToIds[0] === m.id;
                return (
                  <label key={m.id} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px", color: checked ? COLOURS.NAVY : COLOURS.SLATE, cursor: "pointer", fontWeight: checked ? 600 : 400 }}>
                    <input type="checkbox" checked={checked} onChange={(e) => toggleAssignee(m.id, e.target.checked)} style={{ width: "14px", height: "14px" }} />
                    {m.name}{isPrimary && <span style={{ fontSize: "10px", fontWeight: 700, color: COLOURS.BLUE }}> (primary)</span>}
                  </label>
                );
              })}
              {members.length === 0 && <span style={{ fontSize: "12px", color: COLOURS.SLATE, fontStyle: "italic" }}>No members found.</span>}
            </div>
          </label>

          {selectedMembers.length > 0 && (
            <div
              style={{
                border: `1px solid ${COLOURS.HAIRLINE}`,
                borderRadius: RADII.SM,
                padding: "10px 12px",
                marginBottom: "12px",
                backgroundColor: COLOURS.CARD_ALT,
                fontSize: "13px",
                color: COLOURS.SLATE,
              }}
            >
              <div>Department: <strong style={{ color: COLOURS.NAVY }}>{selectedMembers[0].department || "Not set"}</strong></div>
              <div>Business Unit: <strong style={{ color: COLOURS.NAVY }}>{selectedMembers[0].business_unit || "Not set"}</strong></div>
              {selectedMembers.length > 1 && (
                <div style={{ marginTop: "4px" }}>Also assigned to: <strong style={{ color: COLOURS.NAVY }}>{selectedMembers.slice(1).map((m) => m.name).join(", ")}</strong></div>
              )}
            </div>
          )}

          <div style={{ marginBottom: "12px" }}>
            <span style={kickerStyle}>Assigned by</span>
            <div
              style={{
                marginTop: "4px",
                padding: "7px 10px",
                border: `1px solid ${COLOURS.HAIRLINE}`,
                borderRadius: RADII.SM,
                backgroundColor: COLOURS.CARD_ALT,
                color: COLOURS.SLATE,
                fontSize: "14px",
              }}
            >
              {assignedBy || assignedByEmail || "Current user"}
            </div>
          </div>

          <div style={{ marginBottom: "12px" }}>
            <span style={kickerStyle}>Assigned date</span>
            <div
              style={{
                marginTop: "4px",
                padding: "7px 10px",
                border: `1px solid ${COLOURS.HAIRLINE}`,
                borderRadius: RADII.SM,
                backgroundColor: COLOURS.CARD_ALT,
                color: COLOURS.SLATE,
                fontSize: "14px",
              }}
              title="Set automatically when the task is created — never editable, including by Admin."
            >
              {new Date(today + "T00:00:00").toLocaleDateString("en-GB")} — today, locked
            </div>
          </div>

          <label>
            <span style={kickerStyle}>Due date</span>
            <div style={{ marginTop: "4px", marginBottom: "12px" }}>
              <DateInputWithCalendar
                style={{ ...inputStyle, marginTop: 0, marginBottom: 0, width: "auto", flex: 1, display: "block" }}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
              />
            </div>
          </label>

          <label style={{ gridColumn: "1 / -1" }}>
            <span style={kickerStyle}>Subtasks (optional) — add as many steps as this task needs</span>
            {subtasks.length > 0 && (
              <div style={{ marginTop: "6px", marginBottom: "6px" }}>
                {subtasks.map((s, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                    <span style={{ fontSize: "13.5px", color: COLOURS.NAVY }}>{s}</span>
                    <button
                      type="button"
                      onClick={() => removeSubtask(i)}
                      style={{ background: "none", border: "none", color: COLOURS.RED, fontSize: "11.5px", fontWeight: 600, cursor: "pointer" }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: "8px", marginTop: "4px", marginBottom: "12px" }}>
              <input
                type="text"
                value={subtaskInput}
                onChange={(e) => setSubtaskInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSubtask(); } }}
                placeholder="Add a subtask…"
                style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
              />
              <button
                type="button"
                onClick={addSubtask}
                style={{
                  border: `1px solid ${COLOURS.HAIRLINE}`,
                  backgroundColor: COLOURS.CARD_ALT,
                  borderRadius: RADII.SM,
                  padding: "0 16px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: COLOURS.NAVY,
                  cursor: "pointer",
                }}
              >
                + Add
              </button>
            </div>
          </label>

          <div style={{ gridColumn: "1 / -1" }}>
            <span style={kickerStyle}>
              Notes / context — type @ to mention and assign a colleague
            </span>
            <MentionTextarea
              value={notes}
              onChange={setNotes}
              members={members}
              onMentionAdded={handleMentionAdded}
              placeholder="Add background, numbers, document references, or instructions. Type @ to assign someone inline."
              style={{ ...inputStyle, height: "70px", marginTop: "4px", marginBottom: mentionedMemberIds.length > 0 ? "6px" : "12px" }}
              rows={3}
            />
            {mentionedMemberIds.length > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "6px",
                  marginBottom: "12px",
                  padding: "6px 10px",
                  backgroundColor: COLOURS.CARD_ALT,
                  border: `1px solid ${COLOURS.HAIRLINE}`,
                  borderRadius: RADII.SM,
                  fontSize: "12px",
                  color: COLOURS.SLATE,
                }}
              >
                <span style={{ fontWeight: 500 }}>Added via @mention:</span>
                {mentionedMemberIds.map((id) => {
                  const m = members.find((x) => x.id === id);
                  if (!m) return null;
                  return (
                    <span
                      key={id}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        backgroundColor: "#E8EDFF",
                        color: COLOURS.BLUE,
                        borderRadius: RADII.PILL,
                        padding: "2px 8px",
                        fontWeight: 600,
                        fontSize: "12px",
                      }}
                    >
                      @{m.name}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

        </div>

        <button
          type="submit"
          disabled={saving}
          style={{
            backgroundColor: COLOURS.NAVY,
            color: COLOURS.CARD,
            border: "none",
            borderRadius: RADII.PILL,
            padding: "8px 22px",
            fontSize: "13px",
            cursor: "pointer",
            fontWeight: 600,
            marginTop: "4px",
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "Saving..." : "Create Task"}
        </button>
      </form>
    </>
  );
}
