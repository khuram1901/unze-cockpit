"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

type Member = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  email: string | null;
  role: string;
  department: string | null;
  business_unit: string | null;
};

const ROLES = ["Admin", "Executive", "Manager", "Member"];

const DEPARTMENTS = [
  "Unze Pole Production",
  "Unze Meters",
  "Finance",
  "HR",
  "Admin",
  "Legal",
  "Sales",
  "Audit",
  "Accounts",
  "S&M Investment",
  "BINC",
];

const BUSINESS_UNITS = [
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

function fullName(firstName: string | null, lastName: string | null, oldName?: string | null) {
  const combined = `${firstName || ""} ${lastName || ""}`.trim();
  return combined || oldName || "Unnamed";
}

export default function MembersManager() {
  const [members, setMembers] = useState<Member[]>([]);
  const [myRole, setMyRole] = useState<string>("Member");
  const [loading, setLoading] = useState(true);

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
      .select("id, first_name, last_name, name, email, role, department, business_unit")
      .order("first_name", { ascending: true });

    if (data) setMembers(data);

    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();

    setSaving(true);

    const displayName = `${firstName} ${lastName}`.trim();

    const { error } = await supabase.from("members").insert({
      first_name: firstName,
      last_name: lastName,
      name: displayName,
      email,
      role,
      department: department || null,
      business_unit: businessUnit || null,
    });

    setSaving(false);

    if (error) {
      alert("Error adding member: " + error.message);
      return;
    }

    setFirstName("");
    setLastName("");
    setEmail("");
    setRole("Member");
    setDepartment("");
    setBusinessUnit("");

    loadData();
  }

  async function updateMember(id: string, updates: Partial<Member>) {
    const member = members.find((m) => m.id === id);

    const updatedFirstName =
      updates.first_name !== undefined ? updates.first_name : member?.first_name || "";

    const updatedLastName =
      updates.last_name !== undefined ? updates.last_name : member?.last_name || "";

    const updatedName = `${updatedFirstName || ""} ${updatedLastName || ""}`.trim();

    const { error } = await supabase
      .from("members")
      .update({
        ...updates,
        name: updatedName || member?.name || null,
      })
      .eq("id", id);

    if (error) {
      alert("Error updating member: " + error.message);
      return;
    }

    loadData();
  }

  async function deleteMember(id: string, memberName: string) {
    if (!confirm(`Remove ${memberName} from members?`)) return;

    const { error } = await supabase.from("members").delete().eq("id", id);

    if (error) {
      alert("Error removing member: " + error.message);
      return;
    }

    loadData();
  }

  const isAdmin = myRole === "Admin";

  const inputStyle = {
    padding: "8px",
    border: "1px solid #ccc",
    borderRadius: "6px",
    fontSize: "14px",
    marginRight: "8px",
  };

  const smallInputStyle = {
    padding: "6px",
    border: "1px solid #ccc",
    borderRadius: "6px",
    fontSize: "13px",
    minWidth: "120px",
  };

  if (loading) return <p>Loading members…</p>;

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
          <h2
            style={{
              fontSize: "16px",
              fontWeight: "bold",
              marginBottom: "12px",
            }}
          >
            Add a member
          </h2>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "8px",
              alignItems: "center",
            }}
          >
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
            />

            <select
              style={inputStyle}
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>

            <select
              style={inputStyle}
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
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
            >
              <option value="">Business Unit</option>
              {BUSINESS_UNITS.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>

            <button
              type="submit"
              disabled={saving}
              style={{
                backgroundColor: "#0070f3",
                color: "white",
                border: "none",
                borderRadius: "6px",
                padding: "9px 18px",
                fontSize: "14px",
                cursor: "pointer",
              }}
            >
              {saving ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
      )}

      <div style={{ display: "grid", gap: "10px", maxWidth: "1100px" }}>
        {members.map((m) => {
          const displayName = fullName(m.first_name, m.last_name, m.name);

          return (
            <div
              key={m.id}
              style={{
                border: "1px solid #e0e0e0",
                borderRadius: "8px",
                padding: "14px 16px",
                display: "grid",
                gridTemplateColumns: "1.5fr 1.5fr 1fr 1.5fr 1.5fr auto",
                gap: "10px",
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
                      onChange={(e) =>
                        updateMember(m.id, {
                          first_name: e.target.value,
                        })
                      }
                    />

                    <input
                      style={{ ...smallInputStyle, width: "90%" }}
                      value={m.last_name || ""}
                      placeholder="Last Name"
                      onChange={(e) =>
                        updateMember(m.id, {
                          last_name: e.target.value,
                        })
                      }
                    />
                  </div>

                  <input
                    style={smallInputStyle}
                    value={m.email || ""}
                    placeholder="Email"
                    onChange={(e) =>
                      updateMember(m.id, {
                        email: e.target.value,
                      })
                    }
                  />

                  <select
                    value={m.role}
                    onChange={(e) =>
                      updateMember(m.id, {
                        role: e.target.value,
                      })
                    }
                    style={smallInputStyle}
                  >
                    {ROLES.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>

                  <select
                    value={m.department || ""}
                    onChange={(e) =>
                      updateMember(m.id, {
                        department: e.target.value || null,
                      })
                    }
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
                      updateMember(m.id, {
                        business_unit: e.target.value || null,
                      })
                    }
                    style={smallInputStyle}
                  >
                    <option value="">Business Unit</option>
                    {BUSINESS_UNITS.map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <div>
                    <div style={{ fontWeight: "bold", fontSize: "15px" }}>
                      {displayName}
                    </div>
                    <div style={{ color: "#777", fontSize: "13px" }}>
                      {m.email || "no email"}
                    </div>
                  </div>

                  <div style={{ fontSize: "13px", color: "#555" }}>
                    {m.department || "No department"}
                  </div>

                  <div style={{ fontSize: "13px", color: "#555" }}>
                    {m.business_unit || "No business unit"}
                  </div>

                  <span
                    style={{
                      fontSize: "12px",
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

              {isAdmin && (
                <button
                  onClick={() => deleteMember(m.id, displayName)}
                  style={{
                    backgroundColor: "white",
                    border: "1px solid #e0a0a0",
                    color: "#c0392b",
                    borderRadius: "6px",
                    padding: "6px 12px",
                    fontSize: "13px",
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
    </div>
  );
}