"use client";

import { useEffect, useMemo, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";

type Member = {
  id: string;
  name: string;
  email: string | null;
  department: string | null;
  business_unit: string | null;
  position_title: string | null;
};

type DepartmentOwner = {
  id: string;
  department_name: string;

  primary_owner_member_id: string | null;
  secondary_owner_member_id: string | null;
  escalation_owner_member_id: string | null;

  primary_owner_name: string | null;
  secondary_owner_name: string | null;
  escalation_owner_name: string | null;
};

type Task = {
  id: string;
  assigned_to: string | null;
  assigned_to_email: string | null;
  assigned_to_department: string | null;
  assigned_to_business_unit: string | null;
  assigned_to_position_title: string | null;
  status: string;
};

const OPEN_STATUSES = ["Not Started", "In Progress", "Waiting Reply"];

export default function DepartmentOwnersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [departments, setDepartments] = useState<DepartmentOwner[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const [fromMemberId, setFromMemberId] = useState("");
  const [toMemberId, setToMemberId] = useState("");
  const [reassigning, setReassigning] = useState(false);
  const [message, setMessage] = useState("");

  async function loadData() {
    setLoading(true);

    const [membersRes, departmentsRes, tasksRes] = await Promise.all([
      supabase
        .from("members")
        .select("id,name,email,department,business_unit,position_title")
        .order("name"),

      supabase
        .from("department_owners")
        .select("*")
        .order("department_name"),

      supabase
        .from("tasks")
        .select(
          "id,assigned_to,assigned_to_email,assigned_to_department,assigned_to_business_unit,assigned_to_position_title,status"
        )
        .in("status", OPEN_STATUSES),
    ]);

    setMembers(membersRes.data || []);
    setDepartments(departmentsRes.data || []);
    setTasks(tasksRes.data || []);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  const openTaskCountsByMember = useMemo(() => {
    const counts = new Map<string, number>();

    for (const task of tasks) {
      const name = task.assigned_to || "Unassigned";
      counts.set(name, (counts.get(name) || 0) + 1);
    }

    return counts;
  }, [tasks]);

  async function saveDepartment(row: DepartmentOwner) {
    const primary = members.find((m) => m.id === row.primary_owner_member_id);
    const secondary = members.find((m) => m.id === row.secondary_owner_member_id);
    const escalation = members.find((m) => m.id === row.escalation_owner_member_id);

    const { error } = await supabase
      .from("department_owners")
      .update({
        primary_owner_member_id: primary?.id || null,
        primary_owner_name: primary?.name || null,
        primary_owner_email: primary?.email || null,

        secondary_owner_member_id: secondary?.id || null,
        secondary_owner_name: secondary?.name || null,
        secondary_owner_email: secondary?.email || null,

        escalation_owner_member_id: escalation?.id || null,
        escalation_owner_name: escalation?.name || null,
        escalation_owner_email: escalation?.email || null,
      })
      .eq("id", row.id);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Saved ✓");
    loadData();
  }

  async function reassignOpenTasks() {
    setMessage("");

    if (!fromMemberId || !toMemberId) {
      setMessage("Please select both current owner and new owner.");
      return;
    }

    if (fromMemberId === toMemberId) {
      setMessage("Current owner and new owner cannot be the same person.");
      return;
    }

    const fromMember = members.find((m) => m.id === fromMemberId);
    const toMember = members.find((m) => m.id === toMemberId);

    if (!fromMember || !toMember) {
      setMessage("Could not find selected members.");
      return;
    }

    const confirmed = window.confirm(
      `Move all open tasks from ${fromMember.name} to ${toMember.name}?\n\nThis will move Not Started, In Progress and Waiting Reply tasks only. Completed tasks will not change.`
    );

    if (!confirmed) return;

    setReassigning(true);

    const { data: tasksToMove, error: findError } = await supabase
      .from("tasks")
      .select("id")
      .eq("assigned_to", fromMember.name)
      .in("status", OPEN_STATUSES);

    if (findError) {
      setReassigning(false);
      setMessage("Error finding tasks: " + findError.message);
      return;
    }

    const ids = (tasksToMove || []).map((t) => t.id);

    if (ids.length === 0) {
      setReassigning(false);
      setMessage(`No open tasks found for ${fromMember.name}.`);
      return;
    }

    const { error } = await supabase
      .from("tasks")
      .update({
        assigned_to: toMember.name,
        assigned_to_email: toMember.email,
        assigned_to_department: toMember.department,
        assigned_to_business_unit: toMember.business_unit,
        assigned_to_position_title: toMember.position_title,
        updated_at: new Date().toISOString(),
      })
      .in("id", ids);

    setReassigning(false);

    if (error) {
      setMessage("Error reassigning tasks: " + error.message);
      return;
    }

    setMessage(`✅ Reassigned ${ids.length} open task(s) from ${fromMember.name} to ${toMember.name}.`);
    setFromMemberId("");
    setToMemberId("");
    loadData();
  }

  if (loading) {
    return (
      <AuthWrapper>
        <main style={{ padding: "40px" }}>Loading...</main>
      </AuthWrapper>
    );
  }

  const fromMember = members.find((m) => m.id === fromMemberId);
  const fromOpenCount = fromMember ? openTaskCountsByMember.get(fromMember.name) || 0 : 0;

  return (
    <AuthWrapper>
      <main
        style={{
          padding: "40px",
          fontFamily: "sans-serif",
        }}
      >
        <h1
          style={{
            fontSize: "30px",
            fontWeight: "bold",
            marginBottom: "8px",
          }}
        >
          Department Owners
        </h1>

        <p style={{ color: "#666", marginBottom: "28px" }}>
          Set default owners for each department and reassign open tasks when someone changes role,
          leaves, or goes on holiday.
        </p>

        <section
          style={{
            border: "1px solid #e0e0e0",
            borderRadius: "10px",
            padding: "20px",
            marginBottom: "32px",
            backgroundColor: "#fafafa",
          }}
        >
          <h2 style={{ fontSize: "20px", fontWeight: "bold", marginBottom: "12px" }}>
            Reassign Open Tasks
          </h2>

          <p style={{ color: "#666", fontSize: "14px", marginBottom: "16px" }}>
            Moves only open tasks: Not Started, In Progress, and Waiting Reply. Completed tasks stay
            with the original owner.
          </p>

          <label>
            Current Owner
            <select
              value={fromMemberId}
              onChange={(e) => setFromMemberId(e.target.value)}
              style={inputStyle}
            >
              <option value="">-- Select current owner --</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({openTaskCountsByMember.get(m.name) || 0} open)
                </option>
              ))}
            </select>
          </label>

          <label>
            New Owner
            <select
              value={toMemberId}
              onChange={(e) => setToMemberId(e.target.value)}
              style={inputStyle}
            >
              <option value="">-- Select new owner --</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>

          {fromMemberId && (
            <div style={{ color: "#555", fontSize: "14px", marginBottom: "12px" }}>
              Selected current owner has <strong>{fromOpenCount}</strong> open task(s).
            </div>
          )}

          <button
            onClick={reassignOpenTasks}
            disabled={reassigning}
            style={{
              backgroundColor: "#dc2626",
              color: "white",
              border: "none",
              borderRadius: "6px",
              padding: "10px 20px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            {reassigning ? "Reassigning..." : "Move Open Tasks"}
          </button>

          {message && (
            <p
              style={{
                marginTop: "14px",
                fontSize: "14px",
                color: message.startsWith("✅") ? "green" : "red",
              }}
            >
              {message}
            </p>
          )}
        </section>

        <div
          style={{
            display: "grid",
            gap: "16px",
          }}
        >
          {departments.map((dept) => (
            <div
              key={dept.id}
              style={{
                border: "1px solid #e0e0e0",
                borderRadius: "10px",
                padding: "20px",
              }}
            >
              <h3
                style={{
                  marginBottom: "16px",
                  fontSize: "18px",
                  fontWeight: "bold",
                }}
              >
                {dept.department_name}
              </h3>

              <label>
                Primary Owner
                <select
                  value={dept.primary_owner_member_id || ""}
                  onChange={(e) => {
                    setDepartments((prev) =>
                      prev.map((d) =>
                        d.id === dept.id
                          ? {
                              ...d,
                              primary_owner_member_id: e.target.value,
                            }
                          : d
                      )
                    );
                  }}
                  style={inputStyle}
                >
                  <option value="">-- Select Owner --</option>

                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Backup Owner
                <select
                  value={dept.secondary_owner_member_id || ""}
                  onChange={(e) => {
                    setDepartments((prev) =>
                      prev.map((d) =>
                        d.id === dept.id
                          ? {
                              ...d,
                              secondary_owner_member_id: e.target.value,
                            }
                          : d
                      )
                    );
                  }}
                  style={inputStyle}
                >
                  <option value="">-- Select Backup --</option>

                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Escalation Owner
                <select
                  value={dept.escalation_owner_member_id || ""}
                  onChange={(e) => {
                    setDepartments((prev) =>
                      prev.map((d) =>
                        d.id === dept.id
                          ? {
                              ...d,
                              escalation_owner_member_id: e.target.value,
                            }
                          : d
                      )
                    );
                  }}
                  style={inputStyle}
                >
                  <option value="">-- Select Escalation Owner --</option>

                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>

              <button
                onClick={() => saveDepartment(dept)}
                style={{
                  marginTop: "12px",
                  backgroundColor: "#0070f3",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  padding: "10px 20px",
                  cursor: "pointer",
                }}
              >
                Save Department Owner
              </button>
            </div>
          ))}
        </div>
      </main>
    </AuthWrapper>
  );
}

const inputStyle = {
  display: "block",
  width: "100%",
  maxWidth: "400px",
  padding: "8px",
  marginTop: "6px",
  marginBottom: "16px",
  border: "1px solid #ccc",
  borderRadius: "6px",
};