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

  const [description, setDescription] = useState("");
  const [project, setProject] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [status, setStatus] = useState("Not Started");
  const [dueDate, setDueDate] = useState("");
  const [assignedDate, setAssignedDate] = useState(today);
  const [assignedTo, setAssignedTo] = useState("");
  const [assignedBy, setAssignedBy] = useState("");
  const [assignedByEmail, setAssignedByEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

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

      const [membersRes, ownersRes] = await Promise.all([
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
      ]);

      if (membersRes.data) setMembers(membersRes.data);
      if (ownersRes.data) setDepartmentOwners(ownersRes.data);
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!dueDate) {
      toast.show("Due date is required — every task must have a deadline.", "error");
      return;
    }
    if (assignedDate > today) {
      toast.show("Assigned date cannot be in the future.", "error");
      return;
    }

    setSaving(true);

    const assignedMember = members.find((m) => m.name === assignedTo);
    const assignedToEmail = assignedMember?.email || null;

    const needsReply = status === "Waiting Reply";

    const { data: newTask, error } = await supabase.from("tasks").insert({
      task_type: "Task",
      description,
      project,
      priority,
      status,
      due_date: dueDate,
      assigned_by_email: assignedByEmail || null,
      assigned_date: assignedDate || null,
      assigned_to: assignedTo,
      assigned_to_email: assignedToEmail,
      assigned_by: assignedBy,
      notes,
      reply_required: needsReply,
      assigned_to_department: assignedMember?.department || project || null,
      assigned_to_business_unit: assignedMember?.business_unit || null,
    }).select("id").single();

    setSaving(false);

    if (error) {
      toast.show("Error saving task: " + error.message, "error");
      return;
    }

    logAction("Created", "tasks", `Task: ${description} → ${assignedTo}`);

    if (assignedToEmail && newTask?.id) {
      authFetch("/api/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "task_assigned", taskId: newTask.id, recipientEmail: assignedToEmail }),
      }).catch(() => {});
    }

    setDescription("");
    setProject("");
    setPriority("Medium");
    setStatus("Not Started");
    setDueDate("");
    setAssignedDate(today);
    setAssignedTo("");
    setNotes("");

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

          <label>
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
            <span style={kickerStyle}>Department / project area</span>
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
              }}
            >
              Default owner:{" "}
              <strong style={{ color: COLOURS.NAVY }}>{selectedOwner?.primary_owner_name || "No owner set for this department"}</strong>
            </div>
          )}

          <label>
            <span style={kickerStyle}>Priority</span>
            <select style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value)}>
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

          <label>
            <span style={kickerStyle}>Assigned date</span>
            <DateInput
              style={inputStyle}
              value={assignedDate}
              max={today}
              onChange={(e) => setAssignedDate(e.target.value)}
            />
          </label>

          <label>
            <span style={kickerStyle}>Due date</span>
            <DateInput
              style={inputStyle}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              required
            />
          </label>

          <label>
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
