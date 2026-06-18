"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useMobile } from "../lib/useMobile";
import { logAction } from "../lib/audit-log";

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
  "Finance",
  "HR",
  "Admin",
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

// Which business units are valid for each department
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

// Admin and Executive are organisation-wide: they are not pinned to a
// department or business unit. Department/BU fields apply only to Manager
// and Member.
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

    // Admin/Executive are organisation-wide — never store a department or BU.
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

    // Send welcome email with password setup link
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

    loadData();
  }

  async function updateMember(id: string, updates: Partial<Member>) {
    if (updates.email !== undefined && !isValidEmail(updates.email || "")) {
      alert("A valid email address is required. The email cannot be left blank.");
      loadData();
      return;
    }

    const member = members.find((m) => m.id === id);

    // If the role is being changed UP to Admin/Executive, wipe department/BU.
    if (updates.role !== undefined && !roleHasDeptAndBU(updates.role)) {
      updates = { ...updates, department: null, business_unit: null };
    }

    // If department changes and current business unit is no longer valid, clear it.
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
    if (!confirm(`Remove ${memberName} from members?`)) return;

    const { error } = await supabase.from("members").delete().eq("id", id);

    if (error) {
      alert("Error removing member: " + error.message);
      return;
    }

    logAction("Deleted", "members", `Removed ${memberName}`, id);
    loadData();
  }

  const isAdmin = myRole === "Admin";

  const inputStyle = {
    padding: "8px",
    border: "1px solid #ccc",
    borderRadius: "6px",
    fontSize: "16px",
    marginRight: "8px",
  };

  const smallInputStyle = {
    padding: "6px",
    border: "1px solid #ccc",
    borderRadius: "6px",
    fontSize: "17px",
    minWidth: "120px",
  };

  if (loading) return <p>Loading members</p>;

  const addFormBUs = businessUnitsFor(department);
  const addFormShowsDeptBU = roleHasDeptAndBU(role);

  return (
    <div>
      {isAdmin && (
        <form
          onSubmit={addMember}
          style={{
            border: "1px solid #e0e0e0",
            borderRadius: "8px",
            padding: "20px",
            marginBottom: "28px",
            maxWidth: "1000px",
          }}
        >
          <h2 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "12px" }}>
            Add a member
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(150px, 1fr))", gap: "8px", alignItems: "center" }}>
            <input
              style={inputStyle}
              placeholder="First Name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
            <input
              style={inputStyle}
              placeholder="Last Name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />
            <input
              style={inputStyle}
              placeholder="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <select
              style={inputStyle}
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                // Switching to Admin/Executive clears any selected dept/BU.
                if (!roleHasDeptAndBU(e.target.value)) {
                  setDepartment("");
                  setBusinessUnit("");
                }
              }}
            >
              {ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>

            {addFormShowsDeptBU ? (
              <>
                <select
                  style={inputStyle}
                  value={department}
                  onChange={(e) => {
                    setDepartment(e.target.value);
                    setBusinessUnit(""); // reset BU when department changes
                  }}
                >
                  <option value="">Department</option>
                  {DEPARTMENTS.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
                <select
                  style={inputStyle}
                  value={businessUnit}
                  onChange={(e) => setBusinessUnit(e.target.value)}
                  disabled={!department}
                >
                  <option value="">{department ? "Business Unit" : "Select dept first"}</option>
                  {addFormBUs.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </>
            ) : (
              <span style={{ fontSize: "17px", color: "#888", alignSelf: "center" }}>
                {role} sees all departments &amp; business units
              </span>
            )}

            <button
              type="submit"
              disabled={saving}
              style={{
                backgroundColor: "#0070f3",
                color: "white",
                border: "none",
                borderRadius: "6px",
                padding: "9px 18px",
                fontSize: "16px",
                cursor: "pointer",
              }}
            >
              {saving ? "Adding" : "Add"}
            </button>
          </div>
        </form>
      )}

      <div style={{ display: "grid", gap: "10px", maxWidth: "1100px" }}>
        {members.map((m) => {
          const displayName = fullName(m.first_name, m.last_name, m.name);
          const rowBUs = businessUnitsFor(m.department);
          const rowShowsDeptBU = roleHasDeptAndBU(m.role);

          return (
            <div
              key={m.id}
              style={{
                border: "1px solid #e0e0e0",
                borderRadius: "8px",
                padding: isMobile ? "12px" : "14px 16px",
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "1.5fr 1.5fr 1fr 1.5fr 1.5fr auto",
                gap: isMobile ? "8px" : "10px",
                alignItems: "center",
              }}
            >
              {isAdmin ? (
                <>
                  <div>
                    <input
                      style={{ ...smallInputStyle, marginBottom: "6px", width: "90%" }}
                      value={m.first_name || ""}
                      placeholder="First Name"
                      onChange={(e) => updateMember(m.id, { first_name: e.target.value })}
                    />
                    <input
                      style={{ ...smallInputStyle, width: "90%" }}
                      value={m.last_name || ""}
                      placeholder="Last Name"
                      onChange={(e) => updateMember(m.id, { last_name: e.target.value })}
                    />
                  </div>

                  <input
                    style={smallInputStyle}
                    defaultValue={m.email || ""}
                    placeholder="Email"
                    onBlur={(e) => {
                      if (e.target.value.trim() !== (m.email || "")) {
                        updateMember(m.id, { email: e.target.value });
                      }
                    }}
                  />

                  <select
                    value={m.role}
                    onChange={(e) => updateMember(m.id, { role: e.target.value })}
                    style={smallInputStyle}
                  >
                    {ROLES.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>

                  {rowShowsDeptBU ? (
                    <>
                      <select
                        value={m.department || ""}
                        onChange={(e) => updateMember(m.id, { department: e.target.value || null })}
                        style={smallInputStyle}
                      >
                        <option value="">Department</option>
                        {DEPARTMENTS.map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                      </select>

                      <select
                        value={m.business_unit || ""}
                        onChange={(e) =>
                          updateMember(m.id, { business_unit: e.target.value || null })
                        }
                        style={smallInputStyle}
                        disabled={!m.department}
                      >
                        <option value="">
                          {m.department ? "Business Unit" : "Select dept first"}
                        </option>
                        {rowBUs.map((b) => (
                          <option key={b}>{b}</option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: "16px", color: "#999" }}>All departments</div>
                      <div style={{ fontSize: "16px", color: "#999" }}>All business units</div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <div style={{ fontWeight: "bold", fontSize: "17px" }}>{displayName}</div>
                    <div style={{ color: "#777", fontSize: "17px" }}>{m.email || "no email"}</div>
                  </div>

                  <div style={{ fontSize: "17px", color: "#555" }}>
                    {rowShowsDeptBU ? m.department || "No department" : "All departments"}
                  </div>

                  <div style={{ fontSize: "17px", color: "#555" }}>
                    {rowShowsDeptBU ? m.business_unit || "No business unit" : "All business units"}
                  </div>

                  <span
                    style={{
                      fontSize: "16px",
                      backgroundColor:
                        m.role === "Admin"
                          ? "#0070f3"
                          : m.role === "Executive"
                          ? "#7c3aed"
                          : m.role === "Manager"
                          ? "#16a34a"
                          : "#888",
                      color: "white",
                      padding: "2px 10px",
                      borderRadius: "10px",
                      width: "fit-content",
                    }}
                  >
                    {m.role}
                  </span>
                </>
              )}

              {isAdmin && (m.role === "Manager" || m.role === "Member") && (
                <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "16px", color: "#1e293b", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={m.is_hod || false}
                    onChange={(e) => updateMember(m.id, { is_hod: e.target.checked })}
                    style={{ width: "16px", height: "16px" }}
                  />
                  Head of Dept
                </label>
              )}

              {isAdmin && (
                <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", fontSize: "14px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer", color: "#1e293b" }}>
                    <input type="checkbox" checked={m.notify_email} onChange={(e) => updateMember(m.id, { notify_email: e.target.checked })} style={{ width: "14px", height: "14px" }} />
                    Email
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer", color: "#1e293b" }}>
                    <input type="checkbox" checked={m.notify_whatsapp || false} onChange={(e) => updateMember(m.id, { notify_whatsapp: e.target.checked })} style={{ width: "14px", height: "14px" }} />
                    WhatsApp
                  </label>
                  {m.notify_whatsapp && (
                    <input
                      placeholder="+92..."
                      value={m.phone_e164 || ""}
                      onBlur={(e) => { if (e.target.value !== (m.phone_e164 || "")) updateMember(m.id, { phone_e164: e.target.value || null }); }}
                      onChange={() => {}}
                      defaultValue={m.phone_e164 || ""}
                      style={{ padding: "4px 8px", border: "1px solid #ccc", borderRadius: "6px", fontSize: "14px", width: "130px" }}
                    />
                  )}
                </div>
              )}

              {isAdmin && (
                <button
                  onClick={() => deleteMember(m.id, displayName)}
                  style={{
                    backgroundColor: "white",
                    border: "1px solid #e0a0a0",
                    color: "#c0392b",
                    borderRadius: "6px",
                    padding: "6px 12px",
                    fontSize: "17px",
                    cursor: "pointer",
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          );
        })}
      </div>

      {isAdmin && (
        <div style={{ marginTop: "40px", maxWidth: "1100px" }}>
          <h2 style={{ fontSize: "18px", fontWeight: "bold", marginBottom: "6px" }}>
            Plant Assignments
          </h2>
          <p style={{ fontSize: "17px", color: "#666", marginBottom: "16px" }}>
            Tick the plants each person can enter data for. A person can be assigned one, several, or
            no plants. Only Members and Managers are listed — Admin and Executive can see all plants
            automatically.
          </p>

          {plants.length === 0 ? (
            <p style={{ color: "#999" }}>No active plants found.</p>
          ) : (
            (() => {
              const entryUsers = members.filter(
                (m) => m.role === "Member" || m.role === "Manager"
              );

              if (entryUsers.length === 0) {
                return <p style={{ color: "#999" }}>No Members or Managers to assign yet.</p>;
              }

              return (
                <div style={{ display: "grid", gap: "10px" }}>
                  {entryUsers.map((m) => {
                    const displayName = fullName(m.first_name, m.last_name, m.name);
                    const memberPlants = assignments[m.id] || new Set<string>();

                    return (
                      <div
                        key={m.id}
                        style={{
                          border: "1px solid #e0e0e0",
                          borderRadius: "8px",
                          padding: "12px 16px",
                        }}
                      >
                        <div style={{ fontWeight: "bold", fontSize: "16px", marginBottom: "8px" }}>
                          {displayName}{" "}
                          <span style={{ color: "#999", fontWeight: "normal", fontSize: "16px" }}>
                            ({m.role})
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
                                  fontSize: "16px",
                                  cursor: isSaving ? "wait" : "pointer",
                                  opacity: isSaving ? 0.5 : 1,
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
        </div>
      )}
    </div>
  );
}
