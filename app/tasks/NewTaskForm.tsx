"use client";

import { useState, useEffect } from "react";
import { supabase, authFetch } from "../lib/supabase";
import { useRouter } from "next/navigation";
import { logAction } from "../lib/audit-log";
import { useToast, COLOURS, RADII } from "../lib/SharedUI";
import DateInput from "../lib/DateInput";

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

// The 4 trading companies in scope for task tagging today — Almahar and
// Directors were deliberately excluded when this hierarchy was agreed
// with Khuram. Anything not tagged to one of these falls into the
// "Group / needs review" bucket (company_id left null).
const TASK_COMPANY_CODES = ["UTPL", "IFPL", "BRNH", "HD"];

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

const STATUSES = [
  "Not Started",
  "In Progress",
  "Waiting Reply",
  "Stuck",
  "Submitted",
  "Completed",
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
  const [project, setProject] = useState("");
  const [stage, setStage] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [status, setStatus] = useState("Not Started");
  const [dueDate, setDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [assignedBy, setAssignedBy] = useState("");
  const [assignedByEmail, setAssignedByEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [subtaskInput, setSubtaskInput] = useState("");

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

      if (membersRes.data) setMembers(membersRes.data);
      if (ownersRes.data) setDepartmentOwners(ownersRes.data);
      if (companiesRes.data) setCompanies(companiesRes.data);
    }

    loadInitialData();
  }, []);

  function handleProjectChange(value: string) {
    setProject(value);

    const owner = departmentOwners.find((d) => d.department_name === value);

    if (owner?.primary_owner_member_id) {
      const ownerMember = members.find((m) => m.id === owner.primary_owner_member_id);
      setAssignedTo(ownerMember?.name || owner.primary_owner_name || "");
    } else {
      setAssignedTo("");
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
    // Note: companyId === "" is a valid, deliberate choice (Group / needs
    // review), not a missing value — nothing to validate here.

    setSaving(true);

    const assignedMember = members.find((m) => m.name === assignedTo);
    const assignedToEmail = assignedMember?.email || null;

    const needsReply = status === "Waiting Reply";

    const { data: newTask, error } = await supabase.from("tasks").insert({
      task_type: "Task",
      description,
      company_id: companyId || null,
      project,
      stage: stage.trim() || null,
      priority,
      status,
      due_date: dueDate,
      assigned_by_email: assignedByEmail || null,
      assigned_date: today,
      assigned_to: assignedTo,
      assigned_to_email: assignedToEmail,
      assigned_by: assignedBy,
      notes,
      reply_required: needsReply,
      assigned_to_department: assignedMember?.department || project || null,
      assigned_to_business_unit: assignedMember?.business_unit || null,
    }).select("id").single();

    if (error) {
      setSaving(false);
      toast.show("Error saving task: " + error.message, "error");
      return;
    }

    if (subtasks.length > 0 && newTask?.id) {
      const { error: subtaskError } = await supabase.from("task_subtasks").insert(
        subtasks.map((title, i) => ({ task_id: newTask.id, title, position: i }))
      );
      if (subtaskError) {
        toast.show("Task created, but subtasks failed to save: " + subtaskError.message, "error");
      }
    }

    setSaving(false);

    logAction("Created", "tasks", `Task: ${description} → ${assignedTo}`);

    if (assignedToEmail && newTask?.id) {
      authFetch("/api/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "task_assigned", taskId: newTask.id, recipientEmail: assignedToEmail }),
      }).catch(() => {});
    }

    setDescription("");
    setCompanyId("");
    setProject("");
    setStage("");
    setPriority("Medium");
    setStatus("Not Started");
    setDueDate("");
    setAssignedTo("");
    setNotes("");
    setSubtasks([]);
    setSubtaskInput("");

    router.refresh();
    onCreated?.();
  }

  const selectedMember = members.find((m) => m.name === assignedTo);
  const selectedOwner = departmentOwners.find((d) => d.department_name === project);

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
            <span style={kickerStyle}>What needs to be done?</span>
            <textarea
              style={{ ...inputStyle, height: "80px" }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              placeholder="Example: Follow up on MEPCO production shortfall and report recovery plan."
            />
          </label>

          <label>
            <span style={kickerStyle}>Company *</span>
            <select
              style={inputStyle}
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              required
            >
              <option value="">Group / needs review</option>
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
            <span style={kickerStyle}>Assigned to</span>
            <select
              style={inputStyle}
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              required
            >
              <option value="">-- Select a member --</option>
              {members.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>

          {selectedMember && (
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
              <div>Department: <strong style={{ color: COLOURS.NAVY }}>{selectedMember.department || "Not set"}</strong></div>
              <div>Business Unit: <strong style={{ color: COLOURS.NAVY }}>{selectedMember.business_unit || "Not set"}</strong></div>
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
            <DateInput
              style={inputStyle}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              required
            />
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

          <label style={{ gridColumn: "1 / -1" }}>
            <span style={kickerStyle}>Notes / context</span>
            <textarea
              style={{ ...inputStyle, height: "70px" }}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add background, numbers, document references, or instructions."
            />
          </label>

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
