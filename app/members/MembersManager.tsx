"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useMobile } from "../lib/useMobile";
import { logAction } from "../lib/audit-log";
import { COLOURS, PageHeader, SectionTitle } from "../lib/SharedUI";

type Member = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  email: string | null;
  role: string;
  department: string | null;
  business_unit: string | null;
  company: string | null;
  is_hod: boolean;
  notify_email: boolean;
  notify_whatsapp: boolean;
  phone_e164: string | null;
};

type Plant = { id: string; name: string };

const ROLES = ["Admin", "Executive", "Manager", "Member"];

const DEPARTMENTS = [
  "Unze Trading Ops", "Unze Trading Accounts", "Finance", "HR", "Admin",
  "IT", "Tax", "Legal", "Sales", "Audit", "S&M Investment", "BINC",
];

const ALL_BUSINESS_UNITS = [
  "Head Office", "PESCO Plant", "MEPCO Plant", "FESCO Plant",
  "Meters", "Retail", "Hospitality", "Property", "Nursing College",
];

const MEMBER_COMPANIES = [
  "Unze Trading PVT Limited",
  "Imperial Footwear PVT Limited",
  "Haute Dolci",
  "Barahn PVT Limited",
  "K&K Jhang",
];

const DEPT_BUSINESS_UNITS: Record<string, string[]> = {
  "Unze Trading Ops": ["Head Office", "PESCO Plant", "MEPCO Plant", "FESCO Plant", "Meters"],
  Finance: ALL_BUSINESS_UNITS, HR: ALL_BUSINESS_UNITS, Admin: ALL_BUSINESS_UNITS,
  Legal: ALL_BUSINESS_UNITS, Audit: ALL_BUSINESS_UNITS,
  Sales: ["PESCO Plant", "MEPCO Plant", "FESCO Plant", "Meters"],
  "S&M Investment": ["Property"], BINC: ["Nursing College"],
};

function roleHasDeptAndBU(r: string) { return r === "Manager" || r === "Member"; }
function businessUnitsFor(d: string | null) { return d ? DEPT_BUSINESS_UNITS[d] || ALL_BUSINESS_UNITS : []; }
function isValidEmail(e: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()); }
function fullName(f: string | null, l: string | null, n?: string | null) {
  return `${f || ""} ${l || ""}`.trim() || n || "Unnamed";
}
function roleBg(r: string) {
  return r === "Admin" ? COLOURS.BLUE : r === "Executive" ? COLOURS.PURPLE : r === "Manager" ? COLOURS.GREEN : COLOURS.SLATE;
}

const inp: React.CSSProperties = {
  width: "100%", padding: "6px 8px", border: `1px solid ${COLOURS.BORDER}`,
  borderRadius: "5px", fontSize: "14px", boxSizing: "border-box",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "3px",
};
const smallBtn = (c: string, solid?: boolean): React.CSSProperties => ({
  backgroundColor: solid ? c : "white",
  border: solid ? "none" : `1px solid ${c}`,
  color: solid ? "white" : c,
  borderRadius: "5px", padding: "4px 10px", fontSize: "13px", fontWeight: 600, cursor: "pointer",
});

export default function MembersManager() {
  const isMobile = useMobile();
  const [members, setMembers] = useState<Member[]>([]);
  const [myRole, setMyRole] = useState("Member");
  const [loading, setLoading] = useState(true);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [assignments, setAssignments] = useState<Record<string, Set<string>>>({});
  const [savingAssignment, setSavingAssignment] = useState("");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Member");
  const [department, setDepartment] = useState("");
  const [businessUnit, setBusinessUnit] = useState("");
  const [company, setCompany] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [resettingPw, setResettingPw] = useState("");
  const [settingPwFor, setSettingPwFor] = useState<string | null>(null);
  const [newPw, setNewPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [filter, setFilter] = useState("");

  async function loadData() {
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      const { data: me } = await supabase.from("members").select("role").eq("email", userData.user.email).single();
      if (me) setMyRole(me.role);
    }
    const { data } = await supabase.from("members")
      .select("id, first_name, last_name, name, email, role, department, business_unit, company, is_hod, notify_email, notify_whatsapp, phone_e164")
      .order("first_name", { ascending: true });
    if (data) setMembers(data);

    const { data: pd } = await supabase.from("plants").select("id, name").eq("active", true).order("name");
    if (pd) setPlants(pd);

    const { data: mp } = await supabase.from("member_plants").select("member_id, plant_id");
    const g: Record<string, Set<string>> = {};
    (mp || []).forEach((r) => { if (!g[r.member_id]) g[r.member_id] = new Set(); g[r.member_id].add(r.plant_id); });
    setAssignments(g);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  async function togglePlant(memberId: string, plantId: string, on: boolean) {
    const key = `${memberId}-${plantId}`;
    setSavingAssignment(key);
    if (on) {
      await supabase.from("member_plants").delete().eq("member_id", memberId).eq("plant_id", plantId);
    } else {
      await supabase.from("member_plants").insert({ member_id: memberId, plant_id: plantId });
    }
    setAssignments((prev) => {
      const next = { ...prev }; const s = new Set(next[memberId] || []);
      on ? s.delete(plantId) : s.add(plantId); next[memberId] = s; return next;
    });
    setSavingAssignment("");
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidEmail(email)) { alert("A valid email address is required."); return; }
    setSaving(true);
    const keepsDept = roleHasDeptAndBU(role);
    const { error } = await supabase.from("members").insert({
      first_name: firstName, last_name: lastName, name: `${firstName} ${lastName}`.trim(),
      email: email.trim(), role,
      department: keepsDept ? department || null : null,
      business_unit: keepsDept ? businessUnit || null : null,
      company: keepsDept ? company || null : null,
    });
    setSaving(false);
    if (error) { alert("Error: " + error.message); return; }
    logAction("Created", "members", `Added ${firstName} ${lastName} (${email}) as ${role}`);
    fetch("/api/members/invite", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), firstName, lastName, role }) }).catch(() => {});
    setFirstName(""); setLastName(""); setEmail(""); setRole("Member");
    setDepartment(""); setBusinessUnit(""); setCompany(""); setShowAddForm(false);
    loadData();
  }

  async function sendPwReset(em: string, nm: string) {
    setResettingPw(em);
    try {
      await fetch("/api/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: em }) });
      alert(`Password reset email sent to ${nm}.`);
      logAction("Updated", "members", `Sent password reset to ${nm} (${em})`);
    } catch { alert("Failed to send reset email."); }
    setResettingPw("");
  }

  async function setPwDirectly(em: string, nm: string) {
    if (newPw.length < 6) { alert("Password must be at least 6 characters."); return; }
    setSavingPw(true);
    try {
      const res = await fetch("/api/auth/set-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: em, password: newPw }) });
      const d = await res.json();
      if (!res.ok) { alert("Error: " + (d.error || "Failed")); }
      else { alert(`Password set for ${nm}.`); logAction("Updated", "members", `Set password for ${nm}`); setSettingPwFor(null); setNewPw(""); }
    } catch { alert("Failed to set password."); }
    setSavingPw(false);
  }

  const OWNER_EMAIL = "khuram1901@gmail.com";

  async function updateMember(id: string, updates: Partial<Member>) {
    if (updates.email !== undefined && !isValidEmail(updates.email || "")) { alert("Valid email required."); loadData(); return; }
    const member = members.find((m) => m.id === id);
    if (member?.email === OWNER_EMAIL) {
      if (updates.role !== undefined && updates.role !== "Admin") { alert("The owner account must remain Admin."); loadData(); return; }
      if (updates.email !== undefined) { alert("The owner email cannot be changed."); loadData(); return; }
    }
    if (member?.role === "Admin" && myRole !== "Admin") { alert("Only Admin can edit another Admin."); loadData(); return; }
    if (updates.role !== undefined && !roleHasDeptAndBU(updates.role)) updates = { ...updates, department: null, business_unit: null, company: null };
    if (updates.department !== undefined) {
      const valid = businessUnitsFor(updates.department);
      if (member?.business_unit && !valid.includes(member.business_unit)) updates = { ...updates, business_unit: null };
    }
    const fn = updates.first_name !== undefined ? updates.first_name : member?.first_name || "";
    const ln = updates.last_name !== undefined ? updates.last_name : member?.last_name || "";
    const { error } = await supabase.from("members").update({
      ...updates, ...(updates.email !== undefined ? { email: (updates.email || "").trim() } : {}),
      name: `${fn} ${ln}`.trim() || member?.name || null,
    }).eq("id", id);
    if (error) { alert("Error: " + error.message); return; }
    logAction("Updated", "members", `Updated ${Object.keys(updates).join(", ")}`, id);
    loadData();
  }

  async function deleteMember(id: string, nm: string) {
    const m = members.find((x) => x.id === id);
    if (m?.email === OWNER_EMAIL) { alert("Owner account cannot be removed."); return; }
    if (m?.role === "Admin" && myRole !== "Admin") { alert("Only Admin can remove another Admin."); return; }
    if (!confirm(`Remove ${nm}?`)) return;
    const { error } = await supabase.from("members").delete().eq("id", id);
    if (error) { alert("Error: " + error.message); return; }
    logAction("Deleted", "members", `Removed ${nm}`, id);
    loadData();
  }

  const isAdmin = myRole === "Admin" || myRole === "Executive";

  if (loading) return (
    <main style={{ padding: isMobile ? "12px 14px" : "20px 24px" }}>
      <p style={{ color: COLOURS.SLATE }}>Loading...</p>
    </main>
  );

  const filtered = filter
    ? members.filter((m) => {
        const q = filter.toLowerCase();
        return fullName(m.first_name, m.last_name, m.name).toLowerCase().includes(q) ||
          (m.email || "").toLowerCase().includes(q) || m.role.toLowerCase().includes(q) ||
          (m.department || "").toLowerCase().includes(q);
      })
    : members;

  const counts = { total: members.length, admin: 0, manager: 0, member: 0 };
  members.forEach((m) => {
    if (m.role === "Admin" || m.role === "Executive") counts.admin++;
    else if (m.role === "Manager") counts.manager++;
    else counts.member++;
  });

  return (
    <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "760px" }}>
      <PageHeader title="Members" subtitle="Manage team members, roles, and access" />

      {/* ── Summary strip ─────────────────────────────── */}
      <div style={{ display: "flex", gap: "16px", marginBottom: "16px", fontSize: "14px", color: COLOURS.SLATE }}>
        <span><strong style={{ color: COLOURS.NAVY }}>{counts.total}</strong> total</span>
        <span><strong style={{ color: COLOURS.PURPLE }}>{counts.admin}</strong> admin/exec</span>
        <span><strong style={{ color: COLOURS.GREEN }}>{counts.manager}</strong> managers</span>
        <span><strong style={{ color: COLOURS.SLATE }}>{counts.member}</strong> members</span>
      </div>

      {/* ── Toolbar ───────────────────────────────────── */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "14px", flexWrap: "wrap" }}>
        <input
          type="text" placeholder="Search..." value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ ...inp, flex: "1 1 200px", maxWidth: "280px" }}
        />
        {isAdmin && (
          <button onClick={() => setShowAddForm(!showAddForm)} style={smallBtn(COLOURS.NAVY, true)}>
            {showAddForm ? "Cancel" : "+ Add"}
          </button>
        )}
      </div>

      {/* ── Add form ──────────────────────────────────── */}
      {isAdmin && showAddForm && (
        <form onSubmit={addMember} style={{
          border: `1px solid ${COLOURS.BORDER}`, borderTop: `3px solid ${COLOURS.NAVY}`,
          borderRadius: "8px", padding: "14px", marginBottom: "14px", backgroundColor: "white",
        }}>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1.5fr 0.8fr", gap: "8px" }}>
            <div><label style={lbl}>First Name</label><input style={inp} value={firstName} onChange={(e) => setFirstName(e.target.value)} required /></div>
            <div><label style={lbl}>Last Name</label><input style={inp} value={lastName} onChange={(e) => setLastName(e.target.value)} required /></div>
            <div><label style={lbl}>Email</label><input style={inp} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
            <div><label style={lbl}>Role</label>
              <select style={inp} value={role} onChange={(e) => { setRole(e.target.value); if (!roleHasDeptAndBU(e.target.value)) { setDepartment(""); setBusinessUnit(""); } }}>
                {ROLES.map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
          </div>
          {roleHasDeptAndBU(role) && (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "8px", marginTop: "8px" }}>
              <div><label style={lbl}>Department</label>
                <select style={inp} value={department} onChange={(e) => { setDepartment(e.target.value); setBusinessUnit(""); }}>
                  <option value="">Select</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Business Unit</label>
                <select style={inp} value={businessUnit} onChange={(e) => setBusinessUnit(e.target.value)} disabled={!department}>
                  <option value="">{department ? "Select" : "Dept first"}</option>
                  {businessUnitsFor(department).map((b) => <option key={b}>{b}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Company</label>
                <select style={inp} value={company} onChange={(e) => setCompany(e.target.value)}>
                  <option value="">Select</option>{MEMBER_COMPANIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
          )}
          <div style={{ marginTop: "10px" }}>
            <button type="submit" disabled={saving} style={smallBtn(COLOURS.NAVY, true)}>{saving ? "Adding..." : "Add Member"}</button>
          </div>
        </form>
      )}

      {/* ── Members table ─────────────────────────────── */}
      <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden" }}>
        {/* Header */}
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr auto" : "2fr 1.2fr 0.8fr 1fr",
          gap: "8px", padding: "8px 12px",
          backgroundColor: COLOURS.LIGHT, borderBottom: `1px solid ${COLOURS.BORDER}`,
          fontSize: "12px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase" as const, letterSpacing: "0.5px",
        }}>
          <div>Name</div>
          {!isMobile && <div>Dept / BU</div>}
          <div>Role</div>
          {!isMobile && <div>Plants</div>}
        </div>

        {/* Rows */}
        {filtered.map((m) => {
          const dn = fullName(m.first_name, m.last_name, m.name);
          const isEditing = editingId === m.id;
          const memberPlants = assignments[m.id] || new Set<string>();
          const plantNames = plants.filter((p) => memberPlants.has(p.id)).map((p) => p.name);
          const showsDept = roleHasDeptAndBU(m.role);

          return (
            <div key={m.id} style={{ borderBottom: `1px solid ${COLOURS.BORDER}` }}>
              {/* ── Row ──────────────────────────────── */}
              <div
                onClick={() => isAdmin ? setEditingId(isEditing ? null : m.id) : undefined}
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr auto" : "2fr 1.2fr 0.8fr 1fr",
                  gap: "8px", padding: "10px 12px", alignItems: "center",
                  cursor: isAdmin ? "pointer" : "default",
                  backgroundColor: isEditing ? "#f8fafc" : "white",
                }}
              >
                {/* Name + email */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {dn}
                    {m.is_hod && <span style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.AMBER, marginLeft: "5px" }}>HOD</span>}
                  </div>
                  <div style={{ fontSize: "13px", color: COLOURS.SLATE, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.email || "—"}</div>
                </div>

                {/* Dept / BU (desktop) */}
                {!isMobile && (
                  <div style={{ fontSize: "13px", color: COLOURS.SLATE, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {showsDept ? (m.department || "—") : "All"}
                    {showsDept && m.business_unit && <span style={{ color: "#94a3b8" }}> · {m.business_unit}</span>}
                  </div>
                )}

                {/* Role badge */}
                <span style={{
                  fontSize: "12px", fontWeight: 700, padding: "2px 8px", borderRadius: "8px",
                  color: "white", backgroundColor: roleBg(m.role), width: "fit-content",
                  justifySelf: isMobile ? "end" : "start",
                }}>{m.role}</span>

                {/* Plants (desktop) */}
                {!isMobile && (
                  <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>
                    {!showsDept ? "All" : plantNames.length > 0 ? plantNames.join(", ") : "—"}
                  </div>
                )}
              </div>

              {/* ── Mobile sub-row ────────────────────── */}
              {isMobile && !isEditing && (
                <div style={{ padding: "0 12px 8px", fontSize: "12px", color: COLOURS.SLATE }}>
                  {showsDept ? `${m.department || "—"} · ${m.business_unit || "—"}` : "All depts"}
                  {showsDept && plantNames.length > 0 && ` · ${plantNames.join(", ")}`}
                </div>
              )}

              {/* ── Edit panel ────────────────────────── */}
              {isAdmin && isEditing && (
                <div style={{ padding: "12px", borderTop: `1px solid ${COLOURS.BORDER}`, backgroundColor: COLOURS.LIGHT }}>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 2fr 0.8fr", gap: "8px", marginBottom: "10px" }}>
                    <div><label style={lbl}>First Name</label><input style={inp} value={m.first_name || ""} onChange={(e) => updateMember(m.id, { first_name: e.target.value })} /></div>
                    <div><label style={lbl}>Last Name</label><input style={inp} value={m.last_name || ""} onChange={(e) => updateMember(m.id, { last_name: e.target.value })} /></div>
                    <div><label style={lbl}>Email</label><input style={inp} defaultValue={m.email || ""} onBlur={(e) => { if (e.target.value.trim() !== (m.email || "")) updateMember(m.id, { email: e.target.value }); }} /></div>
                    <div><label style={lbl}>Role</label><select style={inp} value={m.role} onChange={(e) => updateMember(m.id, { role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></div>
                  </div>

                  {showsDept && (
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr auto", gap: "8px", marginBottom: "10px", alignItems: "end" }}>
                      <div><label style={lbl}>Department</label>
                        <select style={inp} value={m.department || ""} onChange={(e) => updateMember(m.id, { department: e.target.value || null })}>
                          <option value="">Select</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
                        </select>
                      </div>
                      <div><label style={lbl}>Business Unit</label>
                        <select style={inp} value={m.business_unit || ""} onChange={(e) => updateMember(m.id, { business_unit: e.target.value || null })} disabled={!m.department}>
                          <option value="">{m.department ? "Select" : "Dept first"}</option>
                          {businessUnitsFor(m.department).map((b) => <option key={b}>{b}</option>)}
                        </select>
                      </div>
                      <div><label style={lbl}>Company</label>
                        <select style={inp} value={m.company || ""} onChange={(e) => updateMember(m.id, { company: e.target.value || null })}>
                          <option value="">Select</option>{MEMBER_COMPANIES.map((c) => <option key={c}>{c}</option>)}
                        </select>
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "13px", color: COLOURS.NAVY, cursor: "pointer", paddingBottom: "6px" }}>
                        <input type="checkbox" checked={m.is_hod || false} onChange={(e) => updateMember(m.id, { is_hod: e.target.checked })} />
                        HOD
                      </label>
                    </div>
                  )}

                  {/* Plant assignments inline */}
                  {showsDept && plants.length > 0 && (
                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "10px" }}>
                      <span style={lbl}>Plants:</span>
                      {plants.map((p) => {
                        const on = memberPlants.has(p.id);
                        const key = `${m.id}-${p.id}`;
                        return (
                          <label key={p.id} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px", color: COLOURS.NAVY, cursor: savingAssignment === key ? "wait" : "pointer", opacity: savingAssignment === key ? 0.5 : 1 }}>
                            <input type="checkbox" checked={on} disabled={savingAssignment === key} onChange={() => togglePlant(m.id, p.id, on)} />
                            {p.name}
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {/* Notifications */}
                  <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", marginBottom: "10px" }}>
                    <span style={{ ...lbl, marginBottom: 0 }}>Notify:</span>
                    <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px", cursor: "pointer" }}>
                      <input type="checkbox" checked={m.notify_email} onChange={(e) => updateMember(m.id, { notify_email: e.target.checked })} /> Email
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px", cursor: "pointer" }}>
                      <input type="checkbox" checked={m.notify_whatsapp || false} onChange={(e) => updateMember(m.id, { notify_whatsapp: e.target.checked })} /> WhatsApp
                    </label>
                    {m.notify_whatsapp && (
                      <input placeholder="+92..." defaultValue={m.phone_e164 || ""} onBlur={(e) => { if (e.target.value !== (m.phone_e164 || "")) updateMember(m.id, { phone_e164: e.target.value || null }); }}
                        style={{ ...inp, width: "120px" }} />
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", paddingTop: "8px", borderTop: `1px solid ${COLOURS.BORDER}` }}>
                    <button onClick={() => sendPwReset(m.email || "", dn)} disabled={!m.email || resettingPw === m.email}
                      style={{ ...smallBtn(COLOURS.BLUE), opacity: resettingPw === m.email ? 0.5 : 1 }}>
                      {resettingPw === m.email ? "Sending..." : "Send Reset"}
                    </button>
                    <button onClick={() => { setSettingPwFor(settingPwFor === m.id ? null : m.id); setNewPw(""); }}
                      style={smallBtn(COLOURS.PURPLE)}>Set Password</button>
                    <button onClick={() => deleteMember(m.id, dn)} style={smallBtn(COLOURS.RED)}>Remove</button>
                  </div>

                  {/* Set password inline */}
                  {settingPwFor === m.id && (
                    <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "8px" }}>
                      <input type="text" placeholder="Min 6 characters" value={newPw} onChange={(e) => setNewPw(e.target.value)}
                        style={{ ...inp, width: "180px" }} />
                      <button onClick={() => setPwDirectly(m.email || "", dn)} disabled={savingPw || newPw.length < 6}
                        style={{ ...smallBtn(COLOURS.PURPLE, true), opacity: savingPw || newPw.length < 6 ? 0.5 : 1 }}>
                        {savingPw ? "Saving..." : "Save"}
                      </button>
                      <button onClick={() => { setSettingPwFor(null); setNewPw(""); }} style={smallBtn(COLOURS.SLATE)}>Cancel</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div style={{ padding: "20px 12px", textAlign: "center", color: COLOURS.SLATE, fontSize: "14px" }}>No members found.</div>
        )}
      </div>
    </main>
  );
}
