"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useMobile } from "../lib/useMobile";
import { logAction } from "../lib/audit-log";
import { COLOURS, PageHeader, SectionTitle, CountCard } from "../lib/SharedUI";

type Member = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  email: string | null;
  role: string;
  department: string | null;
  business_unit: string | null;
  is_hod: boolean;
  notify_email: boolean;
  notify_whatsapp: boolean;
  phone_e164: string | null;
};

type Plant = { id: string; name: string };

const ROLES = ["Admin", "Executive", "Manager", "Member"];

const DEPARTMENTS = [
  "Unze Trading Ops",
  "Unze Trading Accounts",
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

const ALL_BUSINESS_UNITS = [
  "Head Office",
  "PESCO Plant",
  "MEPCO Plant",
  "FESCO Plant",
  "Meters",
  "Retail",
  "Hospitality",
  "Property",
  "Nursing College",
];

const DEPT_BUSINESS_UNITS: Record<string, string[]> = {
  "Unze Trading Ops": ["Head Office", "PESCO Plant", "MEPCO Plant", "FESCO Plant", "Meters"],
  Finance: ALL_BUSINESS_UNITS,
  HR: ALL_BUSINESS_UNITS,
  Admin: ALL_BUSINESS_UNITS,
  Legal: ALL_BUSINESS_UNITS,
  Audit: ALL_BUSINESS_UNITS,
  Sales: ["PESCO Plant", "MEPCO Plant", "FESCO Plant", "Meters"],
  "S&M Investment": ["Property"],
  BINC: ["Nursing College"],
};

function roleHasDeptAndBU(role: string): boolean {
  return role === "Manager" || role === "Member";
}

function businessUnitsFor(department: string | null): string[] {
  if (!department) return [];
  return DEPT_BUSINESS_UNITS[department] || ALL_BUSINESS_UNITS;
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function fullName(firstName: string | null, lastName: string | null, oldName?: string | null) {
  const combined = `${firstName || ""} ${lastName || ""}`.trim();
  return combined || oldName || "Unnamed";
}

function roleBadgeColour(role: string): string {
  switch (role) {
    case "Admin": return COLOURS.BLUE;
    case "Executive": return COLOURS.PURPLE;
    case "Manager": return COLOURS.GREEN;
    default: return COLOURS.SLATE;
  }
}

// ── Shared styles ──────────────────────────────────────────────

const fieldInput: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: `1px solid ${COLOURS.BORDER}`,
  borderRadius: "6px",
  fontSize: "15px",
  boxSizing: "border-box",
};

const fieldSelect: React.CSSProperties = { ...fieldInput };

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: "13px",
  fontWeight: 600,
  color: COLOURS.SLATE,
  marginBottom: "4px",
};

const actionBtn = (colour: string): React.CSSProperties => ({
  backgroundColor: "white",
  border: `1px solid ${colour}`,
  color: colour,
  borderRadius: "6px",
  padding: "6px 12px",
  fontSize: "14px",
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
});

const solidBtn = (bg: string): React.CSSProperties => ({
  backgroundColor: bg,
  color: "white",
  border: "none",
  borderRadius: "6px",
  padding: "8px 18px",
  fontSize: "15px",
  fontWeight: 700,
  cursor: "pointer",
});

export default function MembersManager() {
  const isMobile = useMobile();
  const [members, setMembers] = useState<Member[]>([]);
  const [myRole, setMyRole] = useState<string>("Member");
  const [loading, setLoading] = useState(true);

  const [plants, setPlants] = useState<Plant[]>([]);
  const [assignments, setAssignments] = useState<Record<string, Set<string>>>({});
  const [savingAssignment, setSavingAssignment] = useState<string>("");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Member");
  const [department, setDepartment] = useState("");
  const [businessUnit, setBusinessUnit] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [resettingPassword, setResettingPassword] = useState<string>("");
  const [settingPasswordFor, setSettingPasswordFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [settingPassword, setSettingPassword] = useState(false);

  const [filter, setFilter] = useState("");

  async function loadData() {
    const { data: userData } = await supabase.auth.getUser();

    if (userData.user) {
      const { data: me } = await supabase
        .from("members")
        .select("role")
        .eq("email", userData.user.email)
        .single();

      if (me) setMyRole(me.role);
    }

    const { data } = await supabase
      .from("members")
      .select("id, first_name, last_name, name, email, role, department, business_unit, is_hod, notify_email, notify_whatsapp, phone_e164")
      .order("first_name", { ascending: true });

    if (data) setMembers(data);

    const { data: plantData } = await supabase
      .from("plants")
      .select("id, name")
      .eq("active", true)
      .order("name");

    if (plantData) setPlants(plantData);

    const { data: mpData } = await supabase
      .from("member_plants")
      .select("member_id, plant_id");

    const grouped: Record<string, Set<string>> = {};
    (mpData || []).forEach((row) => {
      if (!grouped[row.member_id]) grouped[row.member_id] = new Set();
      grouped[row.member_id].add(row.plant_id);
    });
    setAssignments(grouped);

    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function togglePlant(memberId: string, plantId: string, currentlyAssigned: boolean) {
    const key = `${memberId}-${plantId}`;
    setSavingAssignment(key);

    if (currentlyAssigned) {
      const { error } = await supabase
        .from("member_plants")
        .delete()
        .eq("member_id", memberId)
        .eq("plant_id", plantId);

      if (error) {
        alert("Error removing plant: " + error.message);
        setSavingAssignment("");
        return;
      }
    } else {
      const { error } = await supabase
        .from("member_plants")
        .insert({ member_id: memberId, plant_id: plantId });

      if (error) {
        alert("Error assigning plant: " + error.message);
        setSavingAssignment("");
        return;
      }
    }

    setAssignments((prev) => {
      const next = { ...prev };
      const set = new Set(next[memberId] || []);
      if (currentlyAssigned) set.delete(plantId);
      else set.add(plantId);
      next[memberId] = set;
      return next;
    });

    setSavingAssignment("");
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();

    if (!isValidEmail(email)) {
      alert("A valid email address is required to add a member.");
      return;
    }

    setSaving(true);

    const displayName = `${firstName} ${lastName}`.trim();
    const keepsDeptBU = roleHasDeptAndBU(role);

    const { error } = await supabase.from("members").insert({
      first_name: firstName,
      last_name: lastName,
      name: displayName,
      email: email.trim(),
      role,
      department: keepsDeptBU ? department || null : null,
      business_unit: keepsDeptBU ? businessUnit || null : null,
    });

    setSaving(false);

    if (error) {
      alert("Error adding member: " + error.message);
      return;
    }

    logAction("Created", "members", `Added ${firstName} ${lastName} (${email}) as ${role}`);

    fetch("/api/members/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), firstName, lastName, role }),
    }).catch(() => {});

    setFirstName("");
    setLastName("");
    setEmail("");
    setRole("Member");
    setDepartment("");
    setBusinessUnit("");
    setShowAddForm(false);

    loadData();
  }

  async function sendPasswordReset(memberEmail: string, memberName: string) {
    setResettingPassword(memberEmail);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: memberEmail }),
      });
      await res.json();
      alert(`Password reset email sent to ${memberName} (${memberEmail}).`);
      logAction("Updated", "members", `Sent password reset email to ${memberName} (${memberEmail})`);
    } catch {
      alert("Failed to send password reset email. Please try again.");
    }
    setResettingPassword("");
  }

  async function setPasswordDirectly(memberEmail: string, memberName: string) {
    if (newPassword.length < 6) {
      alert("Password must be at least 6 characters.");
      return;
    }
    setSettingPassword(true);
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: memberEmail, password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert("Error: " + (data.error || "Failed to set password"));
      } else {
        alert(`Password updated for ${memberName}. They can now sign in with the new password.`);
        logAction("Updated", "members", `Set password directly for ${memberName} (${memberEmail})`);
        setSettingPasswordFor(null);
        setNewPassword("");
      }
    } catch {
      alert("Failed to set password. Please try again.");
    }
    setSettingPassword(false);
  }

  const OWNER_EMAIL = "khuram1901@gmail.com";

  async function updateMember(id: string, updates: Partial<Member>) {
    if (updates.email !== undefined && !isValidEmail(updates.email || "")) {
      alert("A valid email address is required. The email cannot be left blank.");
      loadData();
      return;
    }

    const member = members.find((m) => m.id === id);

    if (member?.email === OWNER_EMAIL && myRole !== "Admin") {
      alert("The owner account cannot be modified.");
      loadData();
      return;
    }

    if (member?.role === "Admin" && myRole !== "Admin") {
      alert("Only an Admin can edit another Admin's details.");
      loadData();
      return;
    }

    if (updates.role !== undefined && !roleHasDeptAndBU(updates.role)) {
      updates = { ...updates, department: null, business_unit: null };
    }

    if (updates.department !== undefined) {
      const validBUs = businessUnitsFor(updates.department);
      const currentBU = member?.business_unit;
      if (currentBU && !validBUs.includes(currentBU)) {
        updates = { ...updates, business_unit: null };
      }
    }

    const updatedFirstName =
      updates.first_name !== undefined ? updates.first_name : member?.first_name || "";
    const updatedLastName =
      updates.last_name !== undefined ? updates.last_name : member?.last_name || "";
    const updatedName = `${updatedFirstName || ""} ${updatedLastName || ""}`.trim();

    const { error } = await supabase
      .from("members")
      .update({
        ...updates,
        ...(updates.email !== undefined ? { email: (updates.email || "").trim() } : {}),
        name: updatedName || member?.name || null,
      })
      .eq("id", id);

    if (error) {
      alert("Error updating member: " + error.message);
      return;
    }

    const changedFields = Object.keys(updates).join(", ");
    logAction("Updated", "members", `Updated ${changedFields}`, id);
    loadData();
  }

  async function deleteMember(id: string, memberName: string) {
    const member = members.find((m) => m.id === id);
    if (member?.email === OWNER_EMAIL) {
      alert("The owner account cannot be removed.");
      return;
    }
    if (member?.role === "Admin" && myRole !== "Admin") {
      alert("Only an Admin can remove another Admin.");
      return;
    }
    if (!confirm(`Remove ${memberName} from members?`)) return;

    const { error } = await supabase.from("members").delete().eq("id", id);

    if (error) {
      alert("Error removing member: " + error.message);
      return;
    }

    logAction("Deleted", "members", `Removed ${memberName}`, id);
    loadData();
  }

  const isAdmin = myRole === "Admin" || myRole === "Executive";

  if (loading) {
    return (
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px" }}>
        <p style={{ color: COLOURS.SLATE, fontSize: "16px" }}>Loading members...</p>
      </main>
    );
  }

  const addFormBUs = businessUnitsFor(department);
  const addFormShowsDeptBU = roleHasDeptAndBU(role);

  const filtered = filter
    ? members.filter((m) => {
        const q = filter.toLowerCase();
        return (
          fullName(m.first_name, m.last_name, m.name).toLowerCase().includes(q) ||
          (m.email || "").toLowerCase().includes(q) ||
          m.role.toLowerCase().includes(q) ||
          (m.department || "").toLowerCase().includes(q) ||
          (m.business_unit || "").toLowerCase().includes(q)
        );
      })
    : members;

  const totalMembers = members.length;
  const admins = members.filter((m) => m.role === "Admin" || m.role === "Executive").length;
  const managers = members.filter((m) => m.role === "Manager").length;
  const staff = members.filter((m) => m.role === "Member").length;

  return (
    <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
      <PageHeader title="Members" subtitle="Manage team members, roles, departments, and plant assignments" />

      {/* ── Summary cards ──────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: "10px", marginBottom: "20px", maxWidth: "600px" }}>
        <CountCard label="Total" value={totalMembers} color={COLOURS.NAVY} />
        <CountCard label="Admin / Exec" value={admins} color={COLOURS.PURPLE} />
        <CountCard label="Managers" value={managers} color={COLOURS.GREEN} />
        <CountCard label="Members" value={staff} color={COLOURS.SLATE} />
      </div>

      {/* ── Toolbar: search + add ─────────────────────── */}
      <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "16px", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Search by name, email, role, department..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            flex: "1 1 250px",
            maxWidth: "400px",
            padding: "9px 12px",
            border: `1px solid ${COLOURS.BORDER}`,
            borderRadius: "6px",
            fontSize: "15px",
            boxSizing: "border-box",
          }}
        />
        {isAdmin && (
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            style={solidBtn(COLOURS.NAVY)}
          >
            {showAddForm ? "Cancel" : "+ Add Member"}
          </button>
        )}
      </div>

      {/* ── Add member form ───────────────────────────── */}
      {isAdmin && showAddForm && (
        <form
          onSubmit={addMember}
          style={{
            border: `1px solid ${COLOURS.BORDER}`,
            borderTop: `3px solid ${COLOURS.NAVY}`,
            borderRadius: "8px",
            padding: "20px",
            marginBottom: "20px",
            backgroundColor: "white",
          }}
        >
          <div style={{ fontSize: "16px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "14px" }}>
            New Member
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1.5fr 1fr", gap: "12px" }}>
            <div>
              <label style={fieldLabel}>First Name</label>
              <input style={fieldInput} value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div>
              <label style={fieldLabel}>Last Name</label>
              <input style={fieldInput} value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </div>
            <div>
              <label style={fieldLabel}>Email</label>
              <input style={fieldInput} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <label style={fieldLabel}>Role</label>
              <select
                style={fieldSelect}
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                  if (!roleHasDeptAndBU(e.target.value)) {
                    setDepartment("");
                    setBusinessUnit("");
                  }
                }}
              >
                {ROLES.map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
          </div>

          {addFormShowsDeptBU && (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "12px", marginTop: "12px" }}>
              <div>
                <label style={fieldLabel}>Department</label>
                <select style={fieldSelect} value={department} onChange={(e) => { setDepartment(e.target.value); setBusinessUnit(""); }}>
                  <option value="">Select department</option>
                  {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label style={fieldLabel}>Business Unit</label>
                <select style={fieldSelect} value={businessUnit} onChange={(e) => setBusinessUnit(e.target.value)} disabled={!department}>
                  <option value="">{department ? "Select business unit" : "Choose department first"}</option>
                  {addFormBUs.map((b) => <option key={b}>{b}</option>)}
                </select>
              </div>
            </div>
          )}

          {!addFormShowsDeptBU && (
            <p style={{ fontSize: "14px", color: COLOURS.SLATE, marginTop: "10px" }}>
              {role} role has access to all departments and business units.
            </p>
          )}

          <div style={{ marginTop: "16px" }}>
            <button type="submit" disabled={saving} style={solidBtn(COLOURS.NAVY)}>
              {saving ? "Adding..." : "Add Member"}
            </button>
          </div>
        </form>
      )}

      {/* ── Members list ──────────────────────────────── */}
      <SectionTitle title={`Team (${filtered.length})`} />

      <div style={{ display: "grid", gap: "8px" }}>
        {filtered.map((m) => {
          const displayName = fullName(m.first_name, m.last_name, m.name);
          const rowBUs = businessUnitsFor(m.department);
          const rowShowsDeptBU = roleHasDeptAndBU(m.role);
          const isExpanded = expandedMember === m.id;

          return (
            <div
              key={m.id}
              style={{
                border: `1px solid ${COLOURS.BORDER}`,
                borderRadius: "8px",
                backgroundColor: "white",
                overflow: "hidden",
              }}
            >
              {/* ── Top row: summary ───────────────────── */}
              <div
                onClick={() => isAdmin ? setExpandedMember(isExpanded ? null : m.id) : undefined}
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr auto" : "2fr 2fr 1fr 1.5fr auto",
                  gap: "10px",
                  alignItems: "center",
                  padding: isMobile ? "12px" : "12px 16px",
                  cursor: isAdmin ? "pointer" : "default",
                  backgroundColor: isExpanded ? COLOURS.LIGHT : "white",
                }}
              >
                {/* Name */}
                <div>
                  <div style={{ fontWeight: 700, fontSize: "16px", color: COLOURS.NAVY }}>
                    {displayName}
                    {m.is_hod && <span style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.AMBER, marginLeft: "6px" }}>HOD</span>}
                  </div>
                  <div style={{ fontSize: "14px", color: COLOURS.SLATE, marginTop: "1px" }}>{m.email || "No email"}</div>
                </div>

                {/* Department + BU (desktop only) */}
                {!isMobile && (
                  <div style={{ fontSize: "14px", color: COLOURS.SLATE }}>
                    {rowShowsDeptBU
                      ? `${m.department || "No department"} · ${m.business_unit || "No BU"}`
                      : "All departments"}
                  </div>
                )}

                {/* Role badge */}
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 700,
                    padding: "3px 10px",
                    borderRadius: "10px",
                    color: "white",
                    backgroundColor: roleBadgeColour(m.role),
                    whiteSpace: "nowrap",
                    width: "fit-content",
                    justifySelf: isMobile ? "end" : "start",
                  }}
                >
                  {m.role}
                </span>

                {/* Notifications (desktop only) */}
                {!isMobile && (
                  <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>
                    {m.notify_email && "Email"}
                    {m.notify_email && m.notify_whatsapp && " · "}
                    {m.notify_whatsapp && "WhatsApp"}
                    {!m.notify_email && !m.notify_whatsapp && "No notifications"}
                  </div>
                )}

                {/* Expand indicator (desktop) */}
                {!isMobile && isAdmin && (
                  <div style={{ fontSize: "18px", color: COLOURS.SLATE, justifySelf: "end" }}>
                    {isExpanded ? "▲" : "▼"}
                  </div>
                )}
              </div>

              {/* ── Mobile: dept row ───────────────────── */}
              {isMobile && !isExpanded && (
                <div style={{ padding: "0 12px 10px", fontSize: "13px", color: COLOURS.SLATE }}>
                  {rowShowsDeptBU
                    ? `${m.department || "No department"} · ${m.business_unit || "No BU"}`
                    : "All departments"}
                </div>
              )}

              {/* ── Expanded edit panel ────────────────── */}
              {isAdmin && isExpanded && (
                <div style={{ borderTop: `1px solid ${COLOURS.BORDER}`, padding: isMobile ? "14px 12px" : "16px 20px" }}>

                  {/* Edit fields */}
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 2fr 1fr", gap: "12px", marginBottom: "14px" }}>
                    <div>
                      <label style={fieldLabel}>First Name</label>
                      <input
                        style={fieldInput}
                        value={m.first_name || ""}
                        onChange={(e) => updateMember(m.id, { first_name: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={fieldLabel}>Last Name</label>
                      <input
                        style={fieldInput}
                        value={m.last_name || ""}
                        onChange={(e) => updateMember(m.id, { last_name: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={fieldLabel}>Email</label>
                      <input
                        style={fieldInput}
                        defaultValue={m.email || ""}
                        onBlur={(e) => {
                          if (e.target.value.trim() !== (m.email || "")) {
                            updateMember(m.id, { email: e.target.value });
                          }
                        }}
                      />
                    </div>
                    <div>
                      <label style={fieldLabel}>Role</label>
                      <select value={m.role} onChange={(e) => updateMember(m.id, { role: e.target.value })} style={fieldSelect}>
                        {ROLES.map((r) => <option key={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>

                  {rowShowsDeptBU && (
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "12px", marginBottom: "14px" }}>
                      <div>
                        <label style={fieldLabel}>Department</label>
                        <select value={m.department || ""} onChange={(e) => updateMember(m.id, { department: e.target.value || null })} style={fieldSelect}>
                          <option value="">Select department</option>
                          {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={fieldLabel}>Business Unit</label>
                        <select
                          value={m.business_unit || ""}
                          onChange={(e) => updateMember(m.id, { business_unit: e.target.value || null })}
                          style={fieldSelect}
                          disabled={!m.department}
                        >
                          <option value="">{m.department ? "Select business unit" : "Choose department first"}</option>
                          {rowBUs.map((b) => <option key={b}>{b}</option>)}
                        </select>
                      </div>
                      <div style={{ display: "flex", alignItems: "end", paddingBottom: "4px" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px", color: COLOURS.NAVY, cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={m.is_hod || false}
                            onChange={(e) => updateMember(m.id, { is_hod: e.target.checked })}
                            style={{ width: "16px", height: "16px" }}
                          />
                          Head of Department
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Notifications */}
                  <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap", marginBottom: "16px", paddingTop: "6px", borderTop: `1px solid ${COLOURS.BORDER}` }}>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.SLATE }}>Notifications:</span>
                    <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "14px", color: COLOURS.NAVY, cursor: "pointer" }}>
                      <input type="checkbox" checked={m.notify_email} onChange={(e) => updateMember(m.id, { notify_email: e.target.checked })} style={{ width: "15px", height: "15px" }} />
                      Email
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "14px", color: COLOURS.NAVY, cursor: "pointer" }}>
                      <input type="checkbox" checked={m.notify_whatsapp || false} onChange={(e) => updateMember(m.id, { notify_whatsapp: e.target.checked })} style={{ width: "15px", height: "15px" }} />
                      WhatsApp
                    </label>
                    {m.notify_whatsapp && (
                      <input
                        placeholder="+92..."
                        defaultValue={m.phone_e164 || ""}
                        onBlur={(e) => { if (e.target.value !== (m.phone_e164 || "")) updateMember(m.id, { phone_e164: e.target.value || null }); }}
                        style={{ padding: "5px 8px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", fontSize: "14px", width: "140px" }}
                      />
                    )}
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", paddingTop: "10px", borderTop: `1px solid ${COLOURS.BORDER}` }}>
                    <button
                      onClick={() => sendPasswordReset(m.email || "", displayName)}
                      disabled={!m.email || resettingPassword === m.email}
                      style={{ ...actionBtn(COLOURS.BLUE), opacity: resettingPassword === m.email ? 0.6 : 1 }}
                    >
                      {resettingPassword === m.email ? "Sending..." : "Send Password Reset"}
                    </button>
                    <button
                      onClick={() => { setSettingPasswordFor(settingPasswordFor === m.id ? null : m.id); setNewPassword(""); }}
                      style={actionBtn(COLOURS.PURPLE)}
                    >
                      Set Password
                    </button>
                    <button
                      onClick={() => deleteMember(m.id, displayName)}
                      style={actionBtn(COLOURS.RED)}
                    >
                      Remove Member
                    </button>
                  </div>

                  {/* Set password inline form */}
                  {settingPasswordFor === m.id && (
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "12px", padding: "12px", backgroundColor: COLOURS.LIGHT, borderRadius: "6px" }}>
                      <input
                        type="text"
                        placeholder="New password (min 6 characters)"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        style={{ ...fieldInput, flex: "1 1 200px", maxWidth: "260px" }}
                      />
                      <button
                        onClick={() => setPasswordDirectly(m.email || "", displayName)}
                        disabled={settingPassword || newPassword.length < 6}
                        style={{ ...solidBtn(COLOURS.PURPLE), opacity: settingPassword || newPassword.length < 6 ? 0.5 : 1 }}
                      >
                        {settingPassword ? "Saving..." : "Save"}
                      </button>
                      <button
                        onClick={() => { setSettingPasswordFor(null); setNewPassword(""); }}
                        style={actionBtn(COLOURS.SLATE)}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Plant Assignments ─────────────────────────── */}
      {isAdmin && (
        <>
          <SectionTitle title="Plant Assignments" />
          <p style={{ fontSize: "14px", color: COLOURS.SLATE, marginBottom: "12px" }}>
            Tick the plants each person can enter data for. Admin and Executive can see all plants automatically.
          </p>

          {plants.length === 0 ? (
            <p style={{ color: COLOURS.SLATE }}>No active plants found.</p>
          ) : (
            (() => {
              const entryUsers = members.filter((m) => m.role === "Member" || m.role === "Manager");

              if (entryUsers.length === 0) {
                return <p style={{ color: COLOURS.SLATE }}>No Members or Managers to assign yet.</p>;
              }

              return (
                <div style={{ display: "grid", gap: "8px" }}>
                  {entryUsers.map((m) => {
                    const displayName = fullName(m.first_name, m.last_name, m.name);
                    const memberPlants = assignments[m.id] || new Set<string>();

                    return (
                      <div
                        key={m.id}
                        style={{
                          border: `1px solid ${COLOURS.BORDER}`,
                          borderRadius: "8px",
                          padding: "12px 16px",
                          backgroundColor: "white",
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: "15px", color: COLOURS.NAVY, marginBottom: "8px" }}>
                          {displayName}
                          <span style={{ color: COLOURS.SLATE, fontWeight: 400, fontSize: "14px", marginLeft: "8px" }}>
                            {m.role}
                          </span>
                        </div>

                        <div style={{ display: "flex", flexWrap: "wrap", gap: "14px" }}>
                          {plants.map((p) => {
                            const assigned = memberPlants.has(p.id);
                            const key = `${m.id}-${p.id}`;
                            const isSaving = savingAssignment === key;

                            return (
                              <label
                                key={p.id}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  fontSize: "14px",
                                  cursor: isSaving ? "wait" : "pointer",
                                  opacity: isSaving ? 0.5 : 1,
                                  color: COLOURS.NAVY,
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={assigned}
                                  disabled={isSaving}
                                  onChange={() => togglePlant(m.id, p.id, assigned)}
                                />
                                {p.name}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()
          )}
        </>
      )}
    </main>
  );
}
