"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useMobile } from "../lib/useMobile";
import { logAction } from "../lib/audit-log";
import { COLOURS, PageHeader, SectionTitle } from "../lib/SharedUI";
import { downloadCSV } from "../lib/exportUtils";
import ImportExportButtons from "../lib/ImportExportButtons";
import AccessMatrix from "./AccessMatrix";
import { assignableRoles, canChangePasswordFor, canEditMember, canDeleteMember, isAdminTier, canAddMembers, canImportExport, LOCKED_EMAILS, PROTECTED_EMAILS, type UserCtx, type PermOverrides } from "../lib/permissions";

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
type TaskSummary = { id: string; assigned_to: string | null; status: string };

const DEPARTMENTS = [
  "Unze Trading Ops", "Finance", "HR", "Admin",
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
function roleBg(r: string, email?: string | null) {
  if (email === "k.saleem@unzegroup.com") return COLOURS.BLUE;
  return r === "Admin" ? "#111827" : r === "Executive" ? COLOURS.PURPLE : r === "Manager" ? COLOURS.GREEN : COLOURS.SLATE;
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
  const [myEmail, setMyEmail] = useState("");
  const [myOverrides, setMyOverrides] = useState<PermOverrides | null>(null);
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

  const [departments, setDepartments] = useState<DepartmentOwner[]>([]);
  const [openTasks, setOpenTasks] = useState<TaskSummary[]>([]);
  const [showDeptOwners, setShowDeptOwners] = useState(false);
  const [showReassign, setShowReassign] = useState(false);
  const [fromMemberId, setFromMemberId] = useState("");
  const [toMemberId, setToMemberId] = useState("");
  const [reassigning, setReassigning] = useState(false);
  const [reassignMsg, setReassignMsg] = useState("");

  async function loadData() {
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      setMyEmail(userData.user.email || "");
      const { data: me } = await supabase.from("members").select("id, role").eq("email", userData.user.email).single();
      if (me) {
        setMyRole(me.role);
        const { data: perms } = await supabase.from("member_permissions").select("*").eq("member_id", me.id).maybeSingle();
        if (perms) setMyOverrides(perms as PermOverrides);
      }
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

    const { data: deptData } = await supabase.from("department_owners").select("*").order("department_name");
    setDepartments(deptData || []);

    const OPEN_STATUSES = ["Not Started", "In Progress", "Waiting Reply"];
    const { data: taskData } = await supabase.from("tasks").select("id, assigned_to, status").in("status", OPEN_STATUSES);
    setOpenTasks(taskData || []);

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
    const { error } = await supabase.from("members").insert({
      first_name: firstName, last_name: lastName, name: `${firstName} ${lastName}`.trim(),
      email: email.trim(), role,
      department: department || null,
      business_unit: businessUnit || null,
      company: company || null,
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

  async function updateMember(id: string, updates: Partial<Member>) {
    if (updates.email !== undefined && !isValidEmail(updates.email || "")) { alert("Valid email required."); loadData(); return; }
    const member = members.find((m) => m.id === id);
    const target: UserCtx = { email: member?.email, role: member?.role };
    // Locked accounts (Admin/CEO/PA) — role and email immutable except by an admin-tier user on others
    if (member?.email && LOCKED_EMAILS.includes(member.email.toLowerCase()) && member.email.toLowerCase() !== myEmail.toLowerCase()) {
      if (!isAdminTier(me)) { alert("You cannot edit this protected account."); loadData(); return; }
    }
    if (member?.email && PROTECTED_EMAILS.includes(member.email)) {
      if (updates.role !== undefined && updates.role !== "Admin") { alert("This account must remain Admin."); loadData(); return; }
      if (updates.email !== undefined) { alert("This account's email cannot be changed."); loadData(); return; }
    }
    // PA's own role is locked; PA may only assign Manager/Member to others
    if (updates.role !== undefined && !myAssignableRoles.includes(updates.role)) {
      alert(`You are not allowed to set the role "${updates.role}".`); loadData(); return;
    }
    if (!canEditMember(me, target)) { alert("You do not have permission to edit this member."); loadData(); return; }
    // Department and business unit are preserved for all roles
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
    const target: UserCtx = { email: m?.email, role: m?.role };
    if (!canDeleteMember(me, target)) { alert("You do not have permission to remove this member."); return; }
    if (!confirm(`Remove ${nm}?`)) return;
    const { error } = await supabase.from("members").delete().eq("id", id);
    if (error) { alert("Error: " + error.message); return; }
    logAction("Deleted", "members", `Removed ${nm}`, id);
    loadData();
  }

  const me: UserCtx = { email: myEmail, role: myRole, overrides: myOverrides };
  const isAdmin = myRole === "Admin" || myRole === "Executive"; // can access this page (privileged)
  const myAssignableRoles = assignableRoles(me);

  async function updateDeptOwner(deptId: string, field: "primary" | "secondary" | "escalation", memberId: string) {
    const m = memberId ? members.find((x) => x.id === memberId) : null;
    const prefix = field === "primary" ? "primary_owner" : field === "secondary" ? "secondary_owner" : "escalation_owner";
    const updates: Record<string, string | null> = {
      [`${prefix}_member_id`]: m?.id || null,
      [`${prefix}_name`]: m?.name || null,
      [`${prefix}_email`]: m?.email || null,
    };
    setDepartments((prev) => prev.map((d) => d.id === deptId ? { ...d, [`${prefix}_member_id`]: memberId || null } : d));
    const dept = departments.find((d) => d.id === deptId);
    const { error } = await supabase.from("department_owners").update(updates).eq("id", deptId);
    if (error) { alert(error.message); return; }
    logAction("Updated", "department_owners", `Set ${field} owner for ${dept?.department_name || deptId}`, deptId);
  }

  const openTaskCounts = new Map<string, number>();
  for (const t of openTasks) { const n = t.assigned_to || "Unassigned"; openTaskCounts.set(n, (openTaskCounts.get(n) || 0) + 1); }

  async function reassignOpenTasks() {
    setReassignMsg("");
    if (!fromMemberId || !toMemberId) { setReassignMsg("Select both current and new owner."); return; }
    if (fromMemberId === toMemberId) { setReassignMsg("Cannot reassign to the same person."); return; }
    const fromM = members.find((m) => m.id === fromMemberId);
    const toM = members.find((m) => m.id === toMemberId);
    if (!fromM || !toM) return;
    if (!confirm(`Move all open tasks from ${fromM.name} to ${toM.name}?\n\nNot Started, In Progress and Waiting Reply tasks only.`)) return;
    setReassigning(true);
    const OPEN_STATUSES = ["Not Started", "In Progress", "Waiting Reply"];
    const { data: tasksToMove } = await supabase.from("tasks").select("id").eq("assigned_to", fromM.name).in("status", OPEN_STATUSES);
    const ids = (tasksToMove || []).map((t) => t.id);
    if (ids.length === 0) { setReassigning(false); setReassignMsg(`No open tasks found for ${fromM.name}.`); return; }
    const { error } = await supabase.from("tasks").update({
      assigned_to: toM.name, assigned_to_email: toM.email, assigned_to_department: toM.department, assigned_to_business_unit: toM.business_unit, updated_at: new Date().toISOString(),
    }).in("id", ids);
    setReassigning(false);
    if (error) { setReassignMsg("Error: " + error.message); return; }
    logAction("Updated", "tasks", `Reassigned ${ids.length} tasks from ${fromM.name} to ${toM.name}`);
    setReassignMsg(`Moved ${ids.length} open task(s) from ${fromM.name} to ${toM.name}.`);
    setFromMemberId(""); setToMemberId("");
    loadData();
  }

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
    <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
        <PageHeader title="Members" subtitle="Manage team members, roles, and access" />
        {isAdmin && (
          <button onClick={() => setShowAddForm(!showAddForm)} style={{
            backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "50%",
            width: "38px", height: "38px", fontSize: "20px", fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
          }} title="Add member">{showAddForm ? "×" : "+"}</button>
        )}
      </div>

      {/* ── Summary cards ─────────────────────────────── */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
        {[
          { label: "Total", value: counts.total, color: COLOURS.NAVY },
          { label: "Admin/Exec", value: counts.admin, color: COLOURS.PURPLE },
          { label: "Managers", value: counts.manager, color: COLOURS.GREEN },
          { label: "Members", value: counts.member, color: COLOURS.SLATE },
        ].map((c) => (
          <div key={c.label} style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: `3px solid ${c.color}`, borderRadius: "7px", padding: "6px 14px", backgroundColor: "white", minWidth: "80px" }}>
            <div style={{ color: COLOURS.SLATE, fontSize: "12px" }}>{c.label}</div>
            <div style={{ fontSize: "18px", fontWeight: 800, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* ── Search + Import/Export ───────────────────────────────────── */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "14px", flexWrap: "wrap" }}>
        <input
          type="text" placeholder="Search by name, email, role, department..." value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ ...inp, flex: "1 1 200px", maxWidth: "400px" }}
        />
        {isAdmin && (
          <ImportExportButtons
            onExport={() => {
              const headers = ["First Name", "Last Name", "Email", "Role", "Department", "Business Unit", "Company"];
              const rows = members.map((m) => [m.first_name || "", m.last_name || "", m.email || "", m.role, m.department || "", m.business_unit || "", m.company || ""]);
              downloadCSV(`members-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
            }}
            onImport={async (rows) => {
              const errors: string[] = [];
              const validRows: Record<string, string>[] = [];
              rows.forEach((row, i) => {
                const line = i + 2;
                if (!row["First Name"]?.trim()) { errors.push(`Row ${line}: First Name is required`); return; }
                if (!row["Last Name"]?.trim()) { errors.push(`Row ${line}: Last Name is required`); return; }
                if (!row["Email"]?.trim()) { errors.push(`Row ${line}: Email is required`); return; }
                if (!row["Role"]?.trim()) { errors.push(`Row ${line}: Role is required`); return; }
                validRows.push(row);
              });
              if (errors.length > 0) {
                alert(`Import validation failed:\n\n${errors.slice(0, 10).join("\n")}${errors.length > 10 ? `\n...and ${errors.length - 10} more` : ""}`);
                return;
              }
              let count = 0;
              for (const row of validRows) {
                await supabase.from("members").insert({
                  first_name: row["First Name"].trim(),
                  last_name: row["Last Name"].trim(),
                  name: `${row["First Name"].trim()} ${row["Last Name"].trim()}`,
                  email: row["Email"].trim(),
                  role: row["Role"].trim(),
                  department: row["Department"]?.trim() || null,
                  business_unit: row["Business Unit"]?.trim() || null,
                  company: row["Company"]?.trim() || null,
                });
                count++;
              }
              alert(`Successfully imported ${count} member${count !== 1 ? "s" : ""}.`);
              loadData();
            }}
            templateHeaders={["First Name", "Last Name", "Email", "Role", "Department", "Business Unit", "Company"]}
            templateFilename="members-import-template.csv"
            exportLabel="Export members as CSV"
            importLabel="Import members from CSV"
          />
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
              <select style={inp} value={role} onChange={(e) => setRole(e.target.value)}>
                {myAssignableRoles.map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
          </div>
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
          gridTemplateColumns: isMobile ? "1fr auto" : "2fr 1.2fr 1.2fr 0.8fr",
          gap: "8px", padding: "8px 12px",
          backgroundColor: COLOURS.LIGHT, borderBottom: `1px solid ${COLOURS.BORDER}`,
          fontSize: "12px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase" as const, letterSpacing: "0.5px",
        }}>
          <div>Name</div>
          {!isMobile && <div>Dept / BU</div>}
          {!isMobile && <div>Company</div>}
          <div>Role</div>
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
                  gridTemplateColumns: isMobile ? "1fr auto" : "2fr 1.2fr 1.2fr 0.8fr",
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

                {/* Company */}
                {!isMobile && (
                  <div style={{ fontSize: "13px", color: COLOURS.NAVY, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.company || <span style={{ color: COLOURS.SLATE }}>—</span>}
                  </div>
                )}

                {/* Role badge */}
                <span style={{
                  fontSize: "12px", fontWeight: 700, padding: "2px 8px", borderRadius: "8px",
                  color: "white", backgroundColor: roleBg(m.role, m.email), width: "fit-content",
                  justifySelf: isMobile ? "end" : "start",
                }}>{m.email === "k.saleem@unzegroup.com" ? "CEO" : m.role}</span>
              </div>

              {/* ── Mobile sub-row ────────────────────── */}
              {isMobile && !isEditing && (
                <div style={{ padding: "0 12px 8px", fontSize: "12px", color: COLOURS.SLATE }}>
                  {m.company || "No company"} · {showsDept ? `${m.department || "—"}` : "All depts"}
                </div>
              )}

              {/* ── Edit panel (compact) ────────────────────────── */}
              {isAdmin && isEditing && (
                <div style={{ padding: "8px 12px", borderTop: `1px solid ${COLOURS.BORDER}`, backgroundColor: COLOURS.LIGHT }}>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1.5fr 0.6fr 1fr 1fr 1fr 0.5fr", gap: "6px", marginBottom: "6px", alignItems: "end" }}>
                    <div><label style={lblC}>First Name</label><input style={inpC} value={m.first_name || ""} onChange={(e) => updateMember(m.id, { first_name: e.target.value })} /></div>
                    <div><label style={lblC}>Last Name</label><input style={inpC} value={m.last_name || ""} onChange={(e) => updateMember(m.id, { last_name: e.target.value })} /></div>
                    <div><label style={lblC}>Email</label><input style={inpC} defaultValue={m.email || ""} onBlur={(e) => { if (e.target.value.trim() !== (m.email || "")) updateMember(m.id, { email: e.target.value }); }} /></div>
                    <div><label style={lblC}>Role</label><select style={inpC} value={m.role} onChange={(e) => updateMember(m.id, { role: e.target.value })} disabled={!canEditMember(me, { email: m.email, role: m.role })}>{Array.from(new Set([m.role, ...myAssignableRoles])).map((r) => <option key={r}>{r}</option>)}</select></div>
                    <div><label style={lblC}>Department</label><select style={inpC} value={m.department || ""} onChange={(e) => updateMember(m.id, { department: e.target.value || null })}><option value="">—</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</select></div>
                    <div><label style={lblC}>Business Unit</label><select style={inpC} value={m.business_unit || ""} onChange={(e) => updateMember(m.id, { business_unit: e.target.value || null })} disabled={!m.department}><option value="">—</option>{businessUnitsFor(m.department).map((b) => <option key={b}>{b}</option>)}</select></div>
                    <div><label style={lblC}>Company</label><select style={inpC} value={m.company || ""} onChange={(e) => updateMember(m.id, { company: e.target.value || null })}><option value="">—</option>{MEMBER_COMPANIES.map((c) => <option key={c}>{c}</option>)}</select></div>
                    <label style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "11px", color: COLOURS.NAVY, cursor: "pointer", paddingBottom: "4px" }}>
                      <input type="checkbox" checked={m.is_hod || false} onChange={(e) => updateMember(m.id, { is_hod: e.target.checked })} /> HOD
                    </label>
                  </div>

                  {/* Plants + Notifications in one row */}
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginBottom: "6px", fontSize: "12px" }}>
                    {showsDept && plants.length > 0 && (
                      <>
                        <span style={{ fontWeight: 600, color: COLOURS.SLATE }}>Plants:</span>
                        {plants.map((p) => {
                          const on = memberPlants.has(p.id);
                          const key = `${m.id}-${p.id}`;
                          return (
                            <label key={p.id} style={{ display: "flex", alignItems: "center", gap: "2px", color: COLOURS.NAVY, cursor: savingAssignment === key ? "wait" : "pointer", opacity: savingAssignment === key ? 0.5 : 1 }}>
                              <input type="checkbox" checked={on} disabled={savingAssignment === key} onChange={() => togglePlant(m.id, p.id, on)} style={{ width: "13px", height: "13px" }} />
                              {p.name}
                            </label>
                          );
                        })}
                        <span style={{ color: COLOURS.BORDER }}>|</span>
                      </>
                    )}
                    <span style={{ fontWeight: 600, color: COLOURS.SLATE }}>Notify:</span>
                    <label style={{ display: "flex", alignItems: "center", gap: "2px", cursor: "pointer" }}>
                      <input type="checkbox" checked={m.notify_email} onChange={(e) => updateMember(m.id, { notify_email: e.target.checked })} style={{ width: "13px", height: "13px" }} /> Email
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "2px", cursor: "pointer" }}>
                      <input type="checkbox" checked={m.notify_whatsapp || false} onChange={(e) => updateMember(m.id, { notify_whatsapp: e.target.checked })} style={{ width: "13px", height: "13px" }} /> WA
                    </label>
                    {m.notify_whatsapp && (
                      <input placeholder="+92..." defaultValue={m.phone_e164 || ""} onBlur={(e) => { if (e.target.value !== (m.phone_e164 || "")) updateMember(m.id, { phone_e164: e.target.value || null }); }}
                        style={{ ...inpC, width: "110px" }} />
                    )}
                    {canChangePasswordFor(me, { email: m.email, role: m.role }) && (
                      <>
                        <span style={{ color: COLOURS.BORDER }}>|</span>
                        <button onClick={() => sendPwReset(m.email || "", dn)} disabled={!m.email || resettingPw === m.email}
                          style={{ ...smallBtn(COLOURS.BLUE), fontSize: "11px", padding: "3px 8px", opacity: resettingPw === m.email ? 0.5 : 1 }}>
                          {resettingPw === m.email ? "..." : "Reset PW"}
                        </button>
                        <button onClick={() => { setSettingPwFor(settingPwFor === m.id ? null : m.id); setNewPw(""); }}
                          style={{ ...smallBtn(COLOURS.PURPLE), fontSize: "11px", padding: "3px 8px" }}>Set PW</button>
                      </>
                    )}
                    {canDeleteMember(me, { email: m.email, role: m.role }) && (
                      <button onClick={() => deleteMember(m.id, dn)} style={{ ...smallBtn(COLOURS.RED), fontSize: "11px", padding: "3px 8px" }}>Remove</button>
                    )}
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

      {/* ── Access Control Matrix ────────────────────── */}
      {isAdmin && <AccessMatrix members={members} isMobile={isMobile} />}

      {/* ── Department Ownership ─────────────────────── */}
      {isAdmin && departments.length > 0 && (
        <div style={{ marginTop: "16px" }}>
          <div onClick={() => setShowDeptOwners(!showDeptOwners)} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer",
            border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "12px 16px",
            backgroundColor: showDeptOwners ? COLOURS.NAVY : "white",
          }}>
            <div>
              <div style={{ fontSize: "16px", fontWeight: 700, color: showDeptOwners ? "white" : COLOURS.NAVY }}>Department Ownership</div>
              <div style={{ fontSize: "12px", color: showDeptOwners ? "rgba(255,255,255,0.7)" : COLOURS.SLATE }}>
                Primary, backup, and escalation owners
                {(() => { const v = departments.filter((d) => !d.primary_owner_member_id).length; return v > 0 ? ` · ${v} vacant` : ""; })()}
              </div>
            </div>
            <span style={{ color: showDeptOwners ? "white" : COLOURS.SLATE, fontSize: "14px" }}>{showDeptOwners ? "▲" : "▼"}</span>
          </div>

          {showDeptOwners && (
            <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: "none", borderRadius: "0 0 8px 8px", backgroundColor: "white", padding: "12px" }}>
              {departments.map((dept) => (
                <div key={dept.id} style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "6px", padding: "10px 12px", marginBottom: "8px" }}>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "8px", paddingBottom: "6px", borderBottom: `1px solid ${COLOURS.BORDER}` }}>
                    {dept.department_name}
                    {!dept.primary_owner_member_id && <span style={{ fontSize: "11px", color: COLOURS.RED, marginLeft: "8px", fontWeight: 600 }}>NO PRIMARY OWNER</span>}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "8px", alignItems: "end" }}>
                    <div>
                      <label style={lblC}>Primary Owner</label>
                      <select style={inpC} value={dept.primary_owner_member_id || ""}
                        onChange={(e) => updateDeptOwner(dept.id, "primary", e.target.value)}>
                        <option value="">— None —</option>
                        {members.map((m) => <option key={m.id} value={m.id}>{fullName(m.first_name, m.last_name, m.name)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={lblC}>Backup Owner</label>
                      <select style={inpC} value={dept.secondary_owner_member_id || ""}
                        onChange={(e) => updateDeptOwner(dept.id, "secondary", e.target.value)}>
                        <option value="">— None —</option>
                        {members.map((m) => <option key={m.id} value={m.id}>{fullName(m.first_name, m.last_name, m.name)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={lblC}>Escalation</label>
                      <select style={inpC} value={dept.escalation_owner_member_id || ""}
                        onChange={(e) => updateDeptOwner(dept.id, "escalation", e.target.value)}>
                        <option value="">— None —</option>
                        {members.map((m) => <option key={m.id} value={m.id}>{fullName(m.first_name, m.last_name, m.name)}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Reassign Open Tasks ──────────────────────── */}
      {isAdmin && (
        <div style={{ marginTop: "12px" }}>
          <div onClick={() => setShowReassign(!showReassign)} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer",
            border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "12px 16px",
            backgroundColor: showReassign ? COLOURS.NAVY : "white",
          }}>
            <div>
              <div style={{ fontSize: "16px", fontWeight: 700, color: showReassign ? "white" : COLOURS.NAVY }}>Reassign Open Tasks</div>
              <div style={{ fontSize: "12px", color: showReassign ? "rgba(255,255,255,0.7)" : COLOURS.SLATE }}>
                Transfer tasks when a member leaves or changes role
              </div>
            </div>
            <span style={{ color: showReassign ? "white" : COLOURS.SLATE, fontSize: "14px" }}>{showReassign ? "▲" : "▼"}</span>
          </div>

          {showReassign && (
            <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: "none", borderRadius: "0 0 8px 8px", backgroundColor: "white", padding: "14px" }}>
              <p style={{ fontSize: "13px", color: COLOURS.SLATE, marginBottom: "10px" }}>
                Moves Not Started, In Progress, and Waiting Reply tasks only. Completed tasks stay with the original owner.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px", marginBottom: "10px", maxWidth: "500px" }}>
                <div>
                  <label style={lblC}>Current owner</label>
                  <select style={inpC} value={fromMemberId} onChange={(e) => setFromMemberId(e.target.value)}>
                    <option value="">— Select —</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{fullName(m.first_name, m.last_name, m.name)} ({openTaskCounts.get(m.name || "") || 0} open)</option>)}
                  </select>
                </div>
                <div>
                  <label style={lblC}>New owner</label>
                  <select style={inpC} value={toMemberId} onChange={(e) => setToMemberId(e.target.value)}>
                    <option value="">— Select —</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{fullName(m.first_name, m.last_name, m.name)}</option>)}
                  </select>
                </div>
              </div>
              {fromMemberId && (() => {
                const fm = members.find((m) => m.id === fromMemberId);
                const count = fm ? openTaskCounts.get(fm.name || "") || 0 : 0;
                return <p style={{ fontSize: "13px", color: COLOURS.SLATE, marginBottom: "8px" }}>{fm?.name} has <strong>{count}</strong> open task(s).</p>;
              })()}
              <button onClick={reassignOpenTasks} disabled={reassigning} style={{ ...smallBtn(COLOURS.RED, true), fontSize: "13px", padding: "6px 14px" }}>
                {reassigning ? "Reassigning..." : "Move Open Tasks"}
              </button>
              {reassignMsg && (
                <p style={{ marginTop: "8px", fontSize: "13px", fontWeight: 600, color: reassignMsg.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN }}>{reassignMsg}</p>
              )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

const inpC: React.CSSProperties = {
  width: "100%", padding: "4px 6px", border: `1px solid ${COLOURS.BORDER}`,
  borderRadius: "4px", fontSize: "13px", boxSizing: "border-box",
};
const lblC: React.CSSProperties = {
  display: "block", fontSize: "10px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "1px",
};
