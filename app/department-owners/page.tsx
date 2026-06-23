"use client";

import { useEffect, useMemo, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import { logAction } from "../lib/audit-log";
import { useMobile } from "../lib/useMobile";
import { COLOURS, PageHeader, SectionTitle } from "../lib/SharedUI";

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
  status: string;
};

const NAVY = COLOURS.NAVY;
const SLATE = COLOURS.SLATE;
const BORDER = COLOURS.BORDER;
const OPEN_STATUSES = ["Not Started", "In Progress", "Waiting Reply"];

function _SectionTitle({ title }: { title: string }) {
  return (
    <h2
      style={{
        fontSize: "17px",
        fontWeight: 700,
        color: NAVY,
        margin: "20px 0 10px",
        paddingLeft: "9px",
        borderLeft: `3px solid ${NAVY}`,
      }}
    >
      {title}
    </h2>
  );
}

export default function DepartmentOwnersPage() {
  const isMobile = useMobile();
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
      supabase.from("members").select("id,name,email,department,business_unit,position_title").order("name"),
      supabase.from("department_owners").select("*").order("department_name"),
      supabase.from("tasks").select("id,assigned_to,status").in("status", OPEN_STATUSES),
    ]);
    setMembers(membersRes.data || []);
    setDepartments(departmentsRes.data || []);
    setTasks(tasksRes.data || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

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
    if (error) { alert(error.message); return; }
    logAction("Updated", "department_owners", `Updated owners for ${row.department_name}`, row.id);
    loadData();
  }

  async function reassignOpenTasks() {
    setMessage("");
    if (!fromMemberId || !toMemberId) { setMessage("Please select both current owner and new owner."); return; }
    if (fromMemberId === toMemberId) { setMessage("Current and new owner cannot be the same person."); return; }
    const fromMember = members.find((m) => m.id === fromMemberId);
    const toMember = members.find((m) => m.id === toMemberId);
    if (!fromMember || !toMember) { setMessage("Could not find selected members."); return; }

    const confirmed = window.confirm(
      `Move all open tasks from ${fromMember.name} to ${toMember.name}?\n\nNot Started, In Progress and Waiting Reply tasks only.`
    );
    if (!confirmed) return;

    setReassigning(true);
    const { data: tasksToMove, error: findError } = await supabase
      .from("tasks")
      .select("id")
      .eq("assigned_to", fromMember.name)
      .in("status", OPEN_STATUSES);

    if (findError) { setReassigning(false); setMessage("Error finding tasks: " + findError.message); return; }
    const ids = (tasksToMove || []).map((t) => t.id);
    if (ids.length === 0) { setReassigning(false); setMessage(`No open tasks found for ${fromMember.name}.`); return; }

    const { error } = await supabase.from("tasks").update({
      assigned_to: toMember.name,
      assigned_to_email: toMember.email,
      assigned_to_department: toMember.department,
      assigned_to_business_unit: toMember.business_unit,
      updated_at: new Date().toISOString(),
    }).in("id", ids);

    setReassigning(false);
    if (error) { setMessage("Error reassigning tasks: " + error.message); return; }
    setMessage(`✅ Moved ${ids.length} open task(s) from ${fromMember.name} to ${toMember.name}.`);
    setFromMemberId(""); setToMemberId("");
    loadData();
  }

  if (loading) {
    return (
      <AuthWrapper>
        <main style={{ padding: isMobile ? "12px 14px" : "20px 24px" }}>
          <p style={{ color: SLATE, fontSize: "17px" }}>Loading…</p>
        </main>
      </AuthWrapper>
    );
  }

  const fromMember = members.find((m) => m.id === fromMemberId);
  const fromOpenCount = fromMember ? openTaskCountsByMember.get(fromMember.name) || 0 : 0;

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
        <PageHeader title="Department Owners" subtitle="Set primary, backup, and escalation owners per department" />

        {/* Reassign tasks */}
        <div
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: "8px",
            padding: "16px",
            backgroundColor: "white",
            marginBottom: "20px",
            maxWidth: "640px",
          }}
        >
          <SectionTitle title="Reassign Open Tasks" />
          <p style={{ fontSize: "16px", color: SLATE, marginBottom: "12px" }}>
            Moves Not Started, In Progress, and Waiting Reply tasks only. Completed tasks stay with the original owner.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "12px", marginBottom: "10px" }}>
            <label style={labelStyle}>
              Current owner
              <select style={inputStyle} value={fromMemberId} onChange={(e) => setFromMemberId(e.target.value)}>
                <option value="">— Select —</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({openTaskCountsByMember.get(m.name) || 0} open)
                  </option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              New owner
              <select style={inputStyle} value={toMemberId} onChange={(e) => setToMemberId(e.target.value)}>
                <option value="">— Select —</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </label>
          </div>

          {fromMemberId && (
            <p style={{ fontSize: "16px", color: SLATE, marginBottom: "10px" }}>
              {fromMember?.name} has <strong>{fromOpenCount}</strong> open task(s).
            </p>
          )}

          <button
            onClick={reassignOpenTasks}
            disabled={reassigning}
            style={{
              backgroundColor: "#dc2626",
              color: "white",
              border: "none",
              borderRadius: "6px",
              padding: "8px 18px",
              fontSize: "17px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {reassigning ? "Reassigning…" : "Move Open Tasks"}
          </button>

          {message && (
            <p
              style={{
                marginTop: "10px",
                fontSize: "17px",
                fontWeight: 600,
                color: message.startsWith("✅") ? "#16a34a" : "#dc2626",
              }}
            >
              {message}
            </p>
          )}
        </div>

        {/* Department owner cards */}
        {/* Vacancy alert */}
        {(() => {
          const vacant = departments.filter((d) => !d.primary_owner_member_id);
          if (vacant.length === 0) return null;
          return (
            <div style={{ border: "1px solid #fecaca", borderLeft: "4px solid #dc2626", borderRadius: "8px", backgroundColor: "#fef2f2", padding: "12px 16px", marginBottom: "14px", display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>⚠</span>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "#991b1b" }}>{vacant.length} department{vacant.length > 1 ? "s" : ""} without a primary owner</div>
                <div style={{ fontSize: "13px", color: "#991b1b", marginTop: "1px" }}>{vacant.map((d) => d.department_name).join(" · ")}</div>
              </div>
            </div>
          );
        })()}

        <SectionTitle title="Department Ownership" />
        <div style={{ display: "grid", gap: "10px", maxWidth: "760px" }}>
          {departments.map((dept) => (
            <div
              key={dept.id}
              style={{
                border: `1px solid ${BORDER}`,
                borderRadius: "8px",
                padding: "14px 16px",
                backgroundColor: "white",
              }}
            >
              <div
                style={{
                  fontSize: "17px",
                  fontWeight: 700,
                  color: NAVY,
                  marginBottom: "12px",
                  paddingBottom: "8px",
                  borderBottom: `1px solid ${BORDER}`,
                }}
              >
                {dept.department_name}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: "12px",
                  marginBottom: "12px",
                }}
              >
                <label style={labelStyle}>
                  Primary Owner
                  <select
                    style={inputStyle}
                    value={dept.primary_owner_member_id || ""}
                    onChange={(e) =>
                      setDepartments((prev) =>
                        prev.map((d) =>
                          d.id === dept.id ? { ...d, primary_owner_member_id: e.target.value } : d
                        )
                      )
                    }
                  >
                    <option value="">— None —</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </label>

                <label style={labelStyle}>
                  Backup Owner
                  <select
                    style={inputStyle}
                    value={dept.secondary_owner_member_id || ""}
                    onChange={(e) =>
                      setDepartments((prev) =>
                        prev.map((d) =>
                          d.id === dept.id ? { ...d, secondary_owner_member_id: e.target.value } : d
                        )
                      )
                    }
                  >
                    <option value="">— None —</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </label>

                <label style={labelStyle}>
                  Escalation Owner
                  <select
                    style={inputStyle}
                    value={dept.escalation_owner_member_id || ""}
                    onChange={(e) =>
                      setDepartments((prev) =>
                        prev.map((d) =>
                          d.id === dept.id ? { ...d, escalation_owner_member_id: e.target.value } : d
                        )
                      )
                    }
                  >
                    <option value="">— None —</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </label>
              </div>

              <button
                onClick={() => saveDepartment(dept)}
                style={{
                  backgroundColor: NAVY,
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  padding: "7px 16px",
                  fontSize: "16px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Save
              </button>
            </div>
          ))}
        </div>
      </main>
    </AuthWrapper>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "16px",
  fontWeight: 600,
  color: NAVY,
  marginBottom: "0",
};
const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "7px 9px",
  marginTop: "3px",
  border: `1px solid ${BORDER}`,
  borderRadius: "6px",
  fontSize: "17px",
  boxSizing: "border-box",
};
