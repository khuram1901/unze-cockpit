"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useRouter } from "next/navigation";
import { logAction } from "../lib/audit-log";

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

// Unified status list used across the whole task module
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

export default function NewTaskForm() {
  const router = useRouter();
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

    if (assignedDate > today) {
      alert("Assigned date cannot be in the future.");
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
      due_date: dueDate || null,
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
      alert("Error saving task: " + error.message);
      return;
    }

    logAction("Created", "tasks", `Task: ${description} → ${assignedTo}`);

    // Send notification to assignee
    if (assignedToEmail && newTask?.id) {
      fetch("/api/notifications/send", {
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
  }

  const inputStyle = {
    display: "block",
    width: "100%",
    padding: "6px 8px",
    marginTop: "3px",
    marginBottom: "10px",
    border: "1px solid #e2e8f0",
    borderRadius: "6px",
    fontSize: "17px",
  };

  const selectedMember = members.find((m) => m.name === assignedTo);
  const selectedOwner = departmentOwners.find((d) => d.department_name === project);

  return (
        <form
      onSubmit={handleSubmit}
      style={{
        padding: "14px",
        backgroundColor: "var(--bg-card, #ffffff)",
      }}
    >
      <h2 style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary, #1e293b)", marginBottom: "12px" }}>
        New Task
      </h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0 16px" }}>

      <label>
        What needs to be done?
        <textarea
          style={{ ...inputStyle, height: "80px" }}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          placeholder="Example: Follow up on MEPCO production shortfall and report recovery plan."
        />
      </label>

      <label>
        Department / project area
        <select
          style={inputStyle}
          value={project}
          onChange={(e) => handleProjectChange(e.target.value)}
          required
        >
          <option value="">-- Select department / area --</option>
          <option value="General">General / Executive</option>
          {PROJECT_AREAS.map((area) => (
            <option key={area}>{area}</option>
          ))}
        </select>
      </label>

      {project && (
        <div
          style={{
            maxWidth: "440px",
            border: "1px solid var(--border-color, #e2e8f0)",
            borderRadius: "6px",
            padding: "10px",
            marginBottom: "12px",
            backgroundColor: "var(--bg-card-hover, #f8fafc)",
            fontSize: "17px",
            color: "var(--text-secondary, #64748b)",
          }}
        >
          Default owner:{" "}
          <strong>{selectedOwner?.primary_owner_name || "No owner set for this department"}</strong>
        </div>
      )}

      <label>
        Priority
        <select style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option>High</option>
          <option>Medium</option>
          <option>Low</option>
        </select>
      </label>

      <label>
        Starting status
        <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>

      <label>
        Assigned to
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
            maxWidth: "440px",
            border: "1px solid var(--border-color, #e2e8f0)",
            borderRadius: "6px",
            padding: "10px",
            marginBottom: "12px",
            backgroundColor: "var(--bg-card-hover, #f8fafc)",
            fontSize: "17px",
            color: "var(--text-secondary, #64748b)",
          }}
        >
          <div>
            Department: <strong>{selectedMember.department || "Not set"}</strong>
          </div>
          <div>
            Business Unit: <strong>{selectedMember.business_unit || "Not set"}</strong>
          </div>
        </div>
      )}

      <div style={{ marginBottom: "12px" }}>
        <div style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "4px" }}>
          Assigned by
        </div>
        <div
          style={{
            maxWidth: "440px",
            padding: "8px",
            border: "1px solid var(--border-color, #e2e8f0)",
            borderRadius: "6px",
            backgroundColor: "var(--bg-card-hover, #f8fafc)",
            color: "var(--text-secondary, #64748b)",
            fontSize: "16px",
          }}
        >
          {assignedBy || assignedByEmail || "Current user"}
        </div>
      </div>

      <label>
        Assigned date
        <input
          type="date"
          style={inputStyle}
          value={assignedDate}
          max={today}
          onChange={(e) => setAssignedDate(e.target.value)}
        />
      </label>

      <label>
        Due date
        <input
          type="date"
          style={inputStyle}
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          required
        />
      </label>

      <label>
        Notes / context
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
          backgroundColor: "var(--text-primary, #1e293b)",
          color: "white",
          border: "none",
          borderRadius: "6px",
          padding: "8px 18px",
          fontSize: "17px",
          cursor: "pointer",
          fontWeight: 700,
          marginTop: "4px",
        }}
      >
        {saving ? "Saving..." : "Create Task"}
      </button>
    </form>
  );
}
