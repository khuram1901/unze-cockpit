"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase, loadMyPermissions, authFetch } from "../lib/supabase";
import { useMobile } from "../lib/useMobile";
import { logAction } from "../lib/audit-log";
import { COLOURS, RADII, SHADOWS, cardStyle, tableHeaderStyle, PageHeader, SectionTitle, inputStyle, labelStyle, useToast, useConfirm, SkeletonRows } from "../lib/SharedUI";
import { downloadCSV } from "../lib/exportUtils";
import ImportExportButtons from "../lib/ImportExportButtons";
import AccessMatrix from "./AccessMatrix";
import AccessControlPanel from "./AccessControlPanel";
import WidgetVisibilityPanel from "./WidgetVisibilityPanel";
import { assignableRoles, canChangePasswordFor, canEditMember, canDeleteMember, isAdminTier, isMainAdmin, canAddMembers, canImportExport, PROTECTED_EMAILS, type UserCtx, type PermOverrides } from "../lib/permissions";

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
  manager_id: string | null;
  position_title: string | null;
  is_active: boolean;
  notify_email: boolean;
  notify_whatsapp: boolean;
  phone_e164: string | null;
  photo_url: string | null;
};

type Plant = { id: string; name: string };
type DepartmentOwner = {
  id: string;
  department_name: string;
  primary_owner_member_id: string | null;
  primary_owner_name: string | null;
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
  "Unze Group",
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

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #3B4CCA, #6E7AE0)",
  "linear-gradient(135deg, #0F7B5F, #4CB58F)",
  "linear-gradient(135deg, #B4791F, #E1B860)",
  "linear-gradient(135deg, #6E45B8, #A17DDD)",
  "linear-gradient(135deg, #64748B, #A5B0BF)",
];

const PAGE_SIZE = 10;

function roleHasDeptAndBU(r: string) { return r === "Manager" || r === "Member"; }
function businessUnitsFor(d: string | null) { return d ? DEPT_BUSINESS_UNITS[d] || ALL_BUSINESS_UNITS : []; }
function isValidEmail(e: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()); }
function fullName(f: string | null, l: string | null, n?: string | null) {
  return `${f || ""} ${l || ""}`.trim() || n || "Unnamed";
}
function roleChip(r: string): React.CSSProperties {
  if (r === "Admin")     return { backgroundColor: COLOURS.NAVY, color: "#FFFFFF", border: `1px solid ${COLOURS.NAVY}` };
  if (r === "CEO")       return { backgroundColor: COLOURS.CARD_ALT, color: COLOURS.BLUE, border: `1px solid ${COLOURS.BLUE}` };
  if (r === "Executive") return { backgroundColor: "#EEE8F9", color: COLOURS.PURPLE, border: `1px solid ${COLOURS.PURPLE}` };
  if (r === "Manager")   return { backgroundColor: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN, border: `1px solid ${COLOURS.GREEN}` };
  return { backgroundColor: COLOURS.CARD_ALT, color: COLOURS.INK_700, border: `1px solid ${COLOURS.HAIRLINE}` };
}

function getInitials(firstName: string | null, lastName: string | null, name?: string | null): string {
  const f = firstName?.trim() || "";
  const l = lastName?.trim() || "";
  if (f && l) return (f[0] + l[0]).toUpperCase();
  if (f) return f.slice(0, 2).toUpperCase();
  const n = name?.trim() || "";
  if (n) return n.slice(0, 2).toUpperCase();
  return "??";
}

const inp: React.CSSProperties = { ...inputStyle, padding: "6px 8px", fontSize: "16px" };
const lbl: React.CSSProperties = { ...labelStyle, fontSize: "14px", marginBottom: "3px" };
const smallBtn = (c: string, solid?: boolean): React.CSSProperties => ({
  backgroundColor: solid ? c : "var(--bg-card, #ffffff)",
  border: solid ? "none" : `1px solid ${c}`,
  color: solid ? "white" : c,
  borderRadius: "5px", padding: "4px 10px", fontSize: "15px", fontWeight: 600, cursor: "pointer",
});

type ActiveTab = "people" | "matrix" | "ownership" | "offboard" | "orgchart";

/* ─── Photo upload + face-crop component ───────────────────────────────── */
const PHOTO_SIZE   = 300;  // canvas output px
const PHOTO_MAX_KB = 150;  // max KB after compression

function PhotoUpload({
  member,
  onSaved,
  onRemoved,
}: {
  member: Member;
  onSaved: (url: string) => void;
  onRemoved: () => void;
}) {
  const [preview, setPreview]   = useState<string | null>(null);
  const [blob,    setBlob]      = useState<Blob | null>(null);
  const [saving,  setSaving]    = useState(false);
  const [error,   setError]     = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    if (!file.type.startsWith("image/")) { setError("Please select an image file."); return; }

    // Load into an Image element
    const url = URL.createObjectURL(file);
    const img  = new Image();
    img.src    = url;
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; });

    // ── Face detection ──────────────────────────────────────────────────
    let cropX = img.width  * 0.5;  // default: horizontal centre
    let cropY = img.height * 0.3;  // default: 30% from top (where faces usually are)
    let cropR = Math.min(img.width, img.height) * 0.45;

    try {
      // FaceDetector is Chrome/Edge only — graceful fallback for other browsers
      if ("FaceDetector" in window) {
        // @ts-expect-error — FaceDetector is not in standard TS types yet
        const fd = new window.FaceDetector({ fastMode: true });
        const faces = await fd.detect(img);
        if (faces.length > 0) {
          // Pick the largest face
          const face = faces.reduce((a: { boundingBox: DOMRectReadOnly }, b: { boundingBox: DOMRectReadOnly }) =>
            b.boundingBox.width > a.boundingBox.width ? b : a);
          const bb = face.boundingBox;
          cropX = bb.x + bb.width  / 2;
          cropY = bb.y + bb.height / 2;
          // Crop radius = 1.4× the face box half-width so we get shoulders too
          cropR = Math.max(bb.width, bb.height) * 0.7;
        }
      }
    } catch { /* ignore — use defaults */ }

    // ── Canvas crop ─────────────────────────────────────────────────────
    const canvas  = document.createElement("canvas");
    canvas.width  = PHOTO_SIZE;
    canvas.height = PHOTO_SIZE;
    const ctx = canvas.getContext("2d")!;

    // Clip to circle
    ctx.beginPath();
    ctx.arc(PHOTO_SIZE / 2, PHOTO_SIZE / 2, PHOTO_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();

    // Draw the cropped region scaled to fill the circle
    const scale = PHOTO_SIZE / (cropR * 2);
    const sx    = cropX - cropR;
    const sy    = cropY - cropR;
    const sw    = cropR * 2;
    const sh    = cropR * 2;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, PHOTO_SIZE, PHOTO_SIZE);

    URL.revokeObjectURL(url);

    // ── Compress to JPEG ────────────────────────────────────────────────
    // Try quality levels until we're under PHOTO_MAX_KB
    let quality = 0.9;
    let result: Blob | null = null;
    while (quality >= 0.5) {
      result = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/jpeg", quality));
      if (result && result.size <= PHOTO_MAX_KB * 1000) break;
      quality -= 0.1;
    }
    if (!result) { setError("Could not process image."); return; }
    if (result.size > PHOTO_MAX_KB * 1000) {
      setError(`Image still too large (${Math.round(result.size / 1000)} KB) after compression. Try a simpler photo.`);
      return;
    }

    setBlob(result);
    setPreview(canvas.toDataURL("image/jpeg", 0.9));
  }

  async function save() {
    if (!blob) return;
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("memberId", member.id);
      fd.append("photo", new File([blob], "photo.jpg", { type: "image/jpeg" }));
      const res = await authFetch("/api/members/photo", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Upload failed."); }
      else { setPreview(null); setBlob(null); onSaved(json.photoUrl); }
    } catch { setError("Network error."); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!member.photo_url) return;
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch("/api/members/photo", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: member.id }) });
      if (res.ok) { onRemoved(); setPreview(null); setBlob(null); }
      else { const j = await res.json(); setError(j.error || "Remove failed."); }
    } catch { setError("Network error."); }
    finally { setSaving(false); }
  }

  const currentSrc = preview || member.photo_url || null;
  const initials   = getInitials(member.first_name, member.last_name, member.name);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "10px 0", marginBottom: "6px" }}>
      {/* Circle preview */}
      <div style={{
        width: "64px", height: "64px", borderRadius: "50%", flexShrink: 0,
        border: `2px solid ${COLOURS.HAIRLINE}`,
        overflow: "hidden", backgroundColor: COLOURS.CARD_ALT,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {currentSrc ? (
          <img src={currentSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <span style={{ fontSize: "20px", fontWeight: 700, color: COLOURS.SLATE }}>
            {initials}
          </span>
        )}
      </div>

      {/* Controls */}
      <div style={{ display: "flex", flexDirection: "column", gap: "5px", flex: 1 }}>
        <div style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Profile Photo
        </div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={saving}
            style={{ ...smallBtn(COLOURS.BLUE), fontSize: "12px", padding: "3px 10px" }}
          >
            {member.photo_url || preview ? "Change" : "Upload photo"}
          </button>
          {preview && blob && (
            <button
              onClick={save}
              disabled={saving}
              style={{ ...smallBtn(COLOURS.GREEN, true), fontSize: "12px", padding: "3px 10px" }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          )}
          {preview && (
            <button
              onClick={() => { setPreview(null); setBlob(null); }}
              disabled={saving}
              style={{ ...smallBtn(COLOURS.SLATE), fontSize: "12px", padding: "3px 10px" }}
            >
              Cancel
            </button>
          )}
          {member.photo_url && !preview && (
            <button
              onClick={remove}
              disabled={saving}
              style={{ ...smallBtn(COLOURS.RED), fontSize: "12px", padding: "3px 10px" }}
            >
              {saving ? "Removing…" : "Remove"}
            </button>
          )}
        </div>
        {error && <div style={{ fontSize: "11px", color: COLOURS.RED }}>{error}</div>}
        <div style={{ fontSize: "10px", color: COLOURS.INK_400 }}>
          Any size · auto-cropped to face · max {PHOTO_MAX_KB} KB after compression
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
      />
    </div>
  );
}

// Renders one person plus everyone under them as a proper branching tree —
// node, a stem down, a horizontal bar across siblings, then a stem down to
// each child — pure inline-styled divs (no pseudo-elements, per the
// inline-styles-only convention). Depth-capped and cycle-guarded since
// manager_id has no DB constraint preventing a loop if it's ever set
// incorrectly (a HOD's own picker can't target themselves, but nothing
// stops A -> B -> A across two separate edits).
function OrgNode({ member, allMembers, depth, visited }: { member: Member; allMembers: Member[]; depth: number; visited: Set<string> }) {
  const dn = fullName(member.first_name, member.last_name, member.name);
  if (visited.has(member.id) || depth > 6) return null;
  const nextVisited = new Set(visited); nextVisited.add(member.id);
  const children = allMembers.filter((x) => x.manager_id === member.id);
  // Prefer the person's actual title (e.g. "CEO", "GM Operations") when set
  // — falls back to a generic HOD/role label for anyone who doesn't have
  // one yet. No separate "Director" flag needed: it's just whatever title
  // Kamran's account is given, same as Khuram's is "CEO".
  const rankLabel = member.position_title || (member.is_hod ? "HOD" : (member.role === "Admin" || member.role === "CEO" || member.role === "Executive") ? member.role : null);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: "2px",
        padding: "8px 14px", minWidth: "140px",
        border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM,
        backgroundColor: depth === 0 ? COLOURS.CARD_ALT : COLOURS.CARD,
        borderTop: `3px solid ${depth === 0 ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        textAlign: "center" as const,
      }}>
        <span style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, whiteSpace: "nowrap" as const }}>{dn}</span>
        {rankLabel && (
          <span style={{ fontSize: "10.5px", fontWeight: 700, color: COLOURS.AMBER, textTransform: "uppercase" as const }}>{rankLabel}</span>
        )}
        <span style={{ fontSize: "11px", color: COLOURS.SLATE, whiteSpace: "nowrap" as const }}>{member.department || (member.role === "Admin" || member.role === "CEO" || member.role === "Executive" ? "" : "No department")}</span>
      </div>
      {children.length > 0 && (
        <>
          <div style={{ width: "2px", height: "16px", backgroundColor: COLOURS.HAIRLINE }} />
          <div style={{
            display: "flex", gap: "20px", alignItems: "flex-start",
            borderTop: children.length > 1 ? `2px solid ${COLOURS.HAIRLINE}` : "none",
          }}>
            {children.map((c) => (
              <div key={c.id} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ width: "2px", height: "16px", backgroundColor: COLOURS.HAIRLINE }} />
                <OrgNode member={c} allMembers={allMembers} depth={depth + 1} visited={nextVisited} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function MembersManager() {
  const isMobile = useMobile();
  const toast = useToast();
  const dialog = useConfirm();
  const [members, setMembers] = useState<Member[]>([]);
  const [myRole, setMyRole] = useState("Member");
  const [myEmail, setMyEmail] = useState("");
  const [myOverrides, setMyOverrides] = useState<PermOverrides | null>(null);
  const [myMemberId, setMyMemberId] = useState<string | null>(null);
  const [myIsHod, setMyIsHod] = useState(false);
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
  // Khuram (17/07/2026): "any new users added needed to allocated with a
  // manager, this needs to be a mandatory... finally allow me to add new
  // members into their manager roles." managerId is who THIS new person
  // reports to (required — see the validation in addMember); newMemberManages
  // is the reverse: existing people Khuram wants reporting to this new
  // person the moment they're created, instead of having to go tick them
  // one at a time afterwards from the new manager's own row.
  const [managerId, setManagerId] = useState("");
  const [newMemberManages, setNewMemberManages] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [resettingPw, setResettingPw] = useState("");
  const [settingPwFor, setSettingPwFor] = useState<string | null>(null);
  const [newPw, setNewPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);

  const [activeTab, setActiveTab] = useState<ActiveTab>("people");

  const [departments, setDepartments] = useState<DepartmentOwner[]>([]);
  const [openTasks, setOpenTasks] = useState<TaskSummary[]>([]);
  const [leavingId, setLeavingId] = useState("");
  const [replacementId, setReplacementId] = useState("");
  const [stepIntoLine, setStepIntoLine] = useState(true);
  const [offboarding, setOffboarding] = useState(false);
  const [offboardMsg, setOffboardMsg] = useState("");

  async function loadData() {
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      setMyEmail(userData.user.email || "");
      const { data: me } = await supabase.from("members").select("id, role, is_hod").eq("email", userData.user.email).single();
      if (me) {
        setMyRole(me.role);
        setMyMemberId(me.id);
        setMyIsHod(!!me.is_hod);
        const perms = await loadMyPermissions();
        if (perms) setMyOverrides(perms as PermOverrides);
      }
    }
    const { data } = await supabase.from("members")
      .select("id, first_name, last_name, name, email, role, department, business_unit, company, is_hod, manager_id, position_title, is_active, notify_email, notify_whatsapp, phone_e164, photo_url")
      .order("first_name", { ascending: true });
    if (data) setMembers(data);

    const { data: pd } = await supabase.from("plants").select("id, name").eq("active", true).order("name");
    if (pd) setPlants(pd);

    const { data: mp } = await supabase.from("member_plants").select("member_id, plant_id");
    const g: Record<string, Set<string>> = {};
    (mp || []).forEach((r) => { if (!g[r.member_id]) g[r.member_id] = new Set(); g[r.member_id].add(r.plant_id); });
    setAssignments(g);

    const { data: deptData } = await supabase.from("department_owners").select("id, department_name, primary_owner_member_id, primary_owner_name").order("department_name");
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
    if (!isValidEmail(email)) { toast.show("A valid email address is required.", "error"); return; }
    // Khuram (17/07/2026): a manager is mandatory for everyone except the
    // top of the chain — without one, the new person's tasks would have
    // nowhere to route on Submit and nobody could see them via the
    // manager-hierarchy visibility rule (migration 142).
    if (role !== "Admin" && role !== "CEO" && !managerId) {
      toast.show("Please choose who this person reports to.", "error");
      return;
    }
    setSaving(true);
    const { data: inserted, error } = await supabase.from("members").insert({
      first_name: firstName, last_name: lastName, name: `${firstName} ${lastName}`.trim(),
      email: email.trim(), role,
      department: department || null,
      business_unit: businessUnit || null,
      company: company || null,
      manager_id: managerId || null,
    }).select("id").single();
    setSaving(false);
    if (error) { toast.show("Error: " + error.message, "error"); return; }

    // ── Zero-access default ──────────────────────────────────────────
    // Every new member gets a member_permissions row with ALL toggles set
    // to false. Without this, the permission functions fall through to
    // role-based defaults (e.g. department === "Finance" → can_view_finance)
    // which grants unintended access. Khuram or Sundas must explicitly
    // grant each permission via the Access Matrix after creation.
    // Admin and CEO roles are excluded — they rely on role-based defaults
    // that cannot safely be overridden to false here.
    if (role !== "Admin" && role !== "CEO" && inserted?.id) {
      await supabase.from("member_permissions").insert({
        member_id: inserted.id,
        can_view_executive_dashboard: false,
        can_view_operations_dashboard: false,
        can_view_pa_dashboard: false,
        can_view_finance: false,
        can_edit_finance: false,
        can_view_receivables: false,
        can_edit_receivables: false,
        can_see_all_tasks: false,
        can_create_tasks: false,
        can_review_tasks: false,
        can_manage_recurring_tasks: false,
        can_manage_calendar: false,
        can_see_all_minutes: false,
        can_view_dept_hr: false,
        can_view_dept_tax: false,
        can_view_dept_audit: false,
        can_view_dept_admin: false,
        can_view_dept_ops: false,
        can_view_dept_it: false,
        can_view_members: false,
        can_add_members: false,
        can_view_audit_log: false,
        can_import_export: false,
        can_access_daily_entry: false,
        can_view_investments: false,
        can_view_stock: false,
        can_manage_stock: false,
        can_view_guarantees: false,
        can_view_ifpl_pnl: false,
        can_access_admin_ops: false,
        can_access_admin_entry: false,
        can_manage_meetings: false,
        can_edit_operations_targets: false,
        can_manage_locations: false,
        folderit_can_view_utpl: false,
        folderit_can_view_ifpl: false,
        folderit_can_view_rst: false,
        folderit_can_view_smi: false,
        folderit_can_view_uzl: false,
        folderit_can_view_dir: false,
      });
    }

    logAction("Created", "members", `Added ${firstName} ${lastName} (${email}) as ${role}`);
    // Point any existing members Khuram ticked at this new person's id,
    // now that we actually have it — the same reports-to relationship as
    // toggleTeamMember, just wired up at creation time instead of
    // requiring a second trip to this new person's row afterwards.
    if (inserted?.id && newMemberManages.size > 0) {
      await supabase.from("members").update({ manager_id: inserted.id }).in("id", Array.from(newMemberManages));
    }
    authFetch("/api/members/invite", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), firstName, lastName, role }) }).catch(() => {});
    toast.show(`${firstName} ${lastName} added as ${role}.`, "success");
    setFirstName(""); setLastName(""); setEmail(""); setRole("Member");
    setDepartment(""); setBusinessUnit(""); setCompany(""); setManagerId(""); setNewMemberManages(new Set());
    setShowAddForm(false);
    loadData();
  }

  async function sendPwReset(em: string, nm: string) {
    setResettingPw(em);
    try {
      await fetch("/api/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: em }) });
      toast.show(`Password reset email sent to ${nm}.`, "success");
      logAction("Updated", "members", `Sent password reset to ${nm} (${em})`);
    } catch { toast.show("Failed to send reset email.", "error"); }
    setResettingPw("");
  }

  async function setPwDirectly(em: string, nm: string) {
    if (newPw.length < 6) { toast.show("Password must be at least 6 characters.", "error"); return; }
    setSavingPw(true);
    try {
      const res = await authFetch("/api/auth/set-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: em, password: newPw }) });
      const d = await res.json();
      if (!res.ok) { toast.show("Error: " + (d.error || "Failed"), "error"); }
      else { toast.show(`Password set for ${nm}.`, "success"); logAction("Updated", "members", `Set password for ${nm}`); setSettingPwFor(null); setNewPw(""); }
    } catch { toast.show("Failed to set password.", "error"); }
    setSavingPw(false);
  }

  async function updateMember(id: string, updates: Partial<Member>) {
    if (updates.email !== undefined && !isValidEmail(updates.email || "")) { toast.show("Valid email required.", "error"); loadData(); return; }
    const member = members.find((m) => m.id === id);
    const target: UserCtx = { email: member?.email, role: member?.role };
    // Khuram's own two accounts (khuram1901@gmail.com, k.saleem@unzegroup.com):
    // only the true Admin account can touch them, and their role/email can
    // never change — tightened 16 Jul 2026 so a CEO-tier actor other than
    // Khuram himself can't edit them either.
    if (member?.email && PROTECTED_EMAILS.includes(member.email.toLowerCase()) && member.email.toLowerCase() !== myEmail.toLowerCase()) {
      if (!isMainAdmin(me) && me.role !== "Admin") { toast.show("You cannot edit this protected account.", "error"); loadData(); return; }
    }
    if (member?.email && PROTECTED_EMAILS.includes(member.email.toLowerCase())) {
      if (updates.role !== undefined && updates.role !== member.role) { toast.show("This account's role cannot be changed.", "error"); loadData(); return; }
      if (updates.email !== undefined) { toast.show("This account's email cannot be changed.", "error"); loadData(); return; }
    }
    if (updates.role !== undefined && !myAssignableRoles.includes(updates.role)) {
      toast.show(`You are not allowed to set the role "${updates.role}".`, "error"); loadData(); return;
    }
    if (!canEditMember(me, target)) { toast.show("You do not have permission to edit this member.", "error"); loadData(); return; }
    if (updates.department !== undefined) {
      const valid = businessUnitsFor(updates.department);
      if (member?.business_unit && !valid.includes(member.business_unit)) updates = { ...updates, business_unit: null };
    }
    const fn = updates.first_name !== undefined ? updates.first_name : member?.first_name || "";
    const ln = updates.last_name !== undefined ? updates.last_name : member?.last_name || "";
    const finalUpdates = {
      ...updates, ...(updates.email !== undefined ? { email: (updates.email || "").trim() } : {}),
      name: `${fn} ${ln}`.trim() || member?.name || null,
    };
    const { error } = await supabase.from("members").update(finalUpdates).eq("id", id);
    if (error) { toast.show("Error: " + error.message, "error"); return; }
    logAction("Updated", "members", `Updated ${Object.keys(updates).join(", ")}`, id);
    // Patch local state instead of a full reload (5+ queries) — this was
    // the actual cause of Khuram's "getting stuck" report: every keystroke
    // in a text field, or every checkbox click, was waiting on a full
    // members/plants/departments/tasks refetch before the screen updated.
    setMembers((prev) => prev.map((x) => x.id === id ? { ...x, ...finalUpdates } : x));
  }

  // Sets or clears manager_id on ANOTHER member's row (not the one being
  // edited) — the "tick your team members" flow Khuram asked for, driven
  // from the HOD/Director's own row rather than each person picking their
  // own manager one at a time.
  async function toggleTeamMember(managerId: string, memberId: string, checked: boolean) {
    if (memberId === managerId) return;
    const newManagerId = checked ? managerId : null;
    const { error } = await supabase.from("members").update({ manager_id: newManagerId }).eq("id", memberId);
    if (error) { toast.show("Error: " + error.message, "error"); return; }
    const mgr = members.find((x) => x.id === managerId);
    const person = members.find((x) => x.id === memberId);
    logAction("Updated", "members", checked ? `${person?.name} now reports to ${mgr?.name}` : `${person?.name} no longer reports to ${mgr?.name}`, memberId);
    // Local patch, not a full reload — same fix as updateMember above, and
    // this is what makes ticking several boxes in a row feel instant.
    setMembers((prev) => prev.map((x) => x.id === memberId ? { ...x, manager_id: newManagerId } : x));
  }

  async function deleteMember(id: string, nm: string) {
    const m = members.find((x) => x.id === id);
    const target: UserCtx = { email: m?.email, role: m?.role };
    if (!canDeleteMember(me, target)) { toast.show("You do not have permission to remove this member.", "error"); return; }
    if (!await dialog.confirm(`Remove ${nm}?`, true)) return;
    const { error } = await supabase.from("members").delete().eq("id", id);
    if (error) { toast.show("Error: " + error.message, "error"); return; }
    logAction("Deleted", "members", `Removed ${nm}`, id);
    loadData();
  }

  const me: UserCtx = { email: myEmail, role: myRole, overrides: myOverrides };
  // Includes CEO (16 Jul 2026) — without this, migrating k.saleem@unzegroup.com's
  // role from "Admin" to "CEO" would have silently locked him out of the
  // Members page's add/edit/matrix/org-chart UI, since this used to check
  // the literal string "Admin".
  const isAdmin = myRole === "Admin" || myRole === "CEO" || myRole === "Executive";
  const myAssignableRoles = assignableRoles(me);

  // Offboard access: Admin/Exec (everyone), or a HOD acting on their own
  // team — Khuram's call, so departures don't have to wait on him
  // personally. Scoped below to just the HOD's own direct reports (plus
  // themselves, so they can step in and hold the work personally).
  const canOffboard = isAdmin || myIsHod;
  const offboardableMembers = (isAdmin
    ? members
    : members.filter((m) => m.id === myMemberId || m.manager_id === myMemberId)
  ).filter((m) => m.is_active !== false);
  // Who can take over — anyone active, except the person leaving.
  const replacementCandidates = members.filter((m) => m.is_active !== false && m.id !== leavingId);

  async function updateDeptOwner(deptId: string, memberId: string) {
    const m = memberId ? members.find((x) => x.id === memberId) : null;
    const updates = {
      primary_owner_member_id: m?.id || null,
      primary_owner_name: m?.name || null,
      primary_owner_email: m?.email || null,
    };
    setDepartments((prev) => prev.map((d) => d.id === deptId ? { ...d, primary_owner_member_id: memberId || null } : d));
    const dept = departments.find((d) => d.id === deptId);
    const { error } = await supabase.from("department_owners").update(updates).eq("id", deptId);
    if (error) { toast.show(error.message, "error"); return; }
    logAction("Updated", "department_owners", `Set primary owner for ${dept?.department_name || deptId}`, deptId);
  }

  const openTaskCounts = new Map<string, number>();
  for (const t of openTasks) { const n = t.assigned_to || "Unassigned"; openTaskCounts.set(n, (openTaskCounts.get(n) || 0) + 1); }

  function nameOf(m: Member) { return m.name || fullName(m.first_name, m.last_name); }

  // Single "this person is leaving" action. Replaces the old standalone
  // Reassign Tasks tool — Khuram's call, since that tool only ever existed
  // to handle departures, and doing tasks/reports/ownership separately left
  // room to forget one. No replacement lined up yet -> everything routes to
  // the leaver's own manager as interim cover, same as Khuram described for
  // "HOD steps in until someone new joins."
  async function offboardMember() {
    setOffboardMsg("");
    if (!leavingId) { setOffboardMsg("Select who is leaving."); return; }
    if (leavingId === replacementId) { setOffboardMsg("Replacement must be a different person."); return; }
    const leaver = members.find((m) => m.id === leavingId);
    if (!leaver) return;
    const replacement = replacementId ? members.find((m) => m.id === replacementId) || null : null;
    const interim = !replacement && leaver.manager_id ? members.find((m) => m.id === leaver.manager_id) || null : null;
    const target = replacement || interim;

    const directReports = members.filter((m) => m.manager_id === leaver.id);
    const ownedDepts = departments.filter((d) => d.primary_owner_member_id === leaver.id);
    const taskCount = openTaskCounts.get(leaver.name || "") || 0;
    const willStepIntoLine = !!replacement && stepIntoLine && !replacement.manager_id && !!leaver.manager_id;

    if (!target && (directReports.length > 0 || ownedDepts.length > 0 || taskCount > 0)) {
      setOffboardMsg(`${nameOf(leaver)} has no manager on file and no replacement was picked, so there's nowhere to route their ${taskCount} task(s)/${directReports.length} report(s). Pick a replacement first.`);
      return;
    }

    const summary = [
      taskCount > 0 ? `${taskCount} open task(s) → ${target ? nameOf(target) : "—"}` : null,
      directReports.length > 0 ? `${directReports.length} direct report(s) → ${target ? nameOf(target) : "—"}` : null,
      ownedDepts.length > 0 ? `${ownedDepts.length} department(s) they own → ${target ? nameOf(target) : "—"}` : null,
      willStepIntoLine ? `${nameOf(replacement!)} will now report to ${nameOf(members.find((m) => m.id === leaver.manager_id)!)}` : null,
    ].filter(Boolean) as string[];

    if (!await dialog.confirm(
      `Offboard ${nameOf(leaver)}?\n\n${summary.length ? summary.join("\n") : "No open tasks, reports, or department ownership to move."}\n\n${nameOf(leaver)} will be marked inactive and hidden from every list going forward — nothing is deleted.`,
      true,
    )) return;

    setOffboarding(true);

    if (target && taskCount > 0) {
      const OPEN_STATUSES = ["Not Started", "In Progress", "Waiting Reply"];
      const { data: tasksToMove } = await supabase.from("tasks").select("id").eq("assigned_to", leaver.name).in("status", OPEN_STATUSES);
      const ids = (tasksToMove || []).map((t) => t.id);
      if (ids.length > 0) {
        await supabase.from("tasks").update({
          assigned_to: target.name, assigned_to_email: target.email, assigned_to_department: target.department, assigned_to_business_unit: target.business_unit, updated_at: new Date().toISOString(),
        }).in("id", ids);
      }
    }
    if (target && directReports.length > 0) {
      await supabase.from("members").update({ manager_id: target.id }).in("id", directReports.map((m) => m.id));
    }
    if (target && ownedDepts.length > 0) {
      await supabase.from("department_owners").update({
        primary_owner_member_id: target.id, primary_owner_name: target.name, primary_owner_email: target.email,
      }).in("id", ownedDepts.map((d) => d.id));
    }
    if (willStepIntoLine && replacement) {
      await supabase.from("members").update({ manager_id: leaver.manager_id }).eq("id", replacement.id);
    }

    const { error } = await supabase.from("members").update({ is_active: false }).eq("id", leaver.id);
    setOffboarding(false);
    if (error) { setOffboardMsg("Error: " + error.message); return; }
    logAction("Updated", "members", `Offboarded ${nameOf(leaver)}${target ? ` — handed over to ${nameOf(target)}` : ""}`, leaver.id);
    setOffboardMsg(`${nameOf(leaver)} offboarded.${summary.length ? " " + summary.join("; ") + "." : ""}`);
    setLeavingId(""); setReplacementId(""); setStepIntoLine(true);
    loadData();
  }

  if (loading) return (
    <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%" }}>
      <SkeletonRows count={4} height="48px" />
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

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginatedMembers = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const counts = { total: members.length, admin: 0, manager: 0, member: 0 };
  members.forEach((m) => {
    if (m.role === "Admin" || m.role === "CEO" || m.role === "Executive") counts.admin++;
    else if (m.role === "Manager") counts.manager++;
    else counts.member++;
  });

  function handleTabChange(tab: ActiveTab) {
    setActiveTab(tab);
    if (tab === "matrix") window.scrollTo(0, 0);
  }

  const tabs: { key: ActiveTab; label: string; count?: number }[] = [
    { key: "people",    label: "People",        count: members.length },
    { key: "matrix",    label: "Access matrix", count: members.length },
    { key: "ownership", label: "Dept. ownership" },
    { key: "offboard",  label: "Offboard" },
    { key: "orgchart",  label: "Org chart" },
  ];

  return (
    <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%" }}>
      {toast.element}
      {dialog.element}

      {/* ── Page header ─────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
        <PageHeader />
        {isAdmin && (
          <button onClick={() => setShowAddForm(!showAddForm)} style={{
            backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "50%",
            width: "38px", height: "38px", fontSize: "20px", fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            boxShadow: SHADOWS.MODAL,
          }} title="Add member">{showAddForm ? "×" : "+"}</button>
        )}
      </div>

      {/* ── Tab strip ───────────────────────────────── */}
      <div style={{
        display: "flex", gap: "4px",
        backgroundColor: COLOURS.CARD_ALT,
        border: `1px solid ${COLOURS.HAIRLINE}`,
        borderRadius: RADII.PILL,
        padding: "4px",
        width: "fit-content",
        marginBottom: "20px",
        flexWrap: "wrap",
      }}>
        {tabs.map((t) => {
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => handleTabChange(t.key)}
              style={{
                padding: "7px 16px",
                fontSize: "12.5px",
                borderRadius: RADII.PILL,
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                backgroundColor: isActive ? COLOURS.CARD : "transparent",
                color: isActive ? COLOURS.NAVY : COLOURS.SLATE,
                fontWeight: isActive ? 500 : 400,
                boxShadow: isActive ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                transition: "all 0.15s",
              }}
            >
              {t.label}
              {t.count !== undefined && (
                <span style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "10.5px",
                  color: isActive ? COLOURS.SLATE : COLOURS.INK_400,
                }}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ══════════════════════════════════════════════
          TAB: PEOPLE
      ══════════════════════════════════════════════ */}
      {activeTab === "people" && (
        <>
          {/* ── Stats cards ─────────────────────────── */}
          <div style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)",
            gap: "10px",
            marginBottom: "20px",
          }}>
            {[
              { label: "Total",        value: counts.total   },
              { label: "Admin / Exec", value: counts.admin   },
              { label: "Managers",     value: counts.manager },
              { label: "Members",      value: counts.member  },
            ].map((c) => (
              <div key={c.label} style={{
                backgroundColor: COLOURS.CARD_ALT,
                border: `1px solid ${COLOURS.HAIRLINE}`,
                borderRadius: RADII.CARD,
                padding: "12px 16px",
              }}>
                <div style={{
                  fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE,
                  textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px",
                }}>{c.label}</div>
                <div style={{
                  fontFamily: "var(--font-display, 'Inter Tight', sans-serif)",
                  fontSize: "22px", fontWeight: 600, color: COLOURS.NAVY,
                  fontVariantNumeric: "tabular-nums",
                }}>{c.value}</div>
              </div>
            ))}
          </div>

          {/* ── Toolbar: search + export/import + add form ─ */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", marginBottom: "16px", flexWrap: "wrap" }}>
            <input
              type="text"
              placeholder="Search by name, email, role, department..."
              value={filter}
              onChange={(e) => { setFilter(e.target.value); setPage(0); }}
              style={{ ...inp, flex: "1 1 200px", maxWidth: "320px" }}
            />
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
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
                      toast.show(`Import validation failed:\n${errors.slice(0, 10).join("\n")}${errors.length > 10 ? `\n...and ${errors.length - 10} more` : ""}`, "error");
                      return;
                    }
                    let count = 0;
                    for (const row of validRows) {
                      const { data: csvInserted } = await supabase.from("members").insert({
                        first_name: row["First Name"].trim(),
                        last_name: row["Last Name"].trim(),
                        name: `${row["First Name"].trim()} ${row["Last Name"].trim()}`,
                        email: row["Email"].trim(),
                        role: row["Role"].trim(),
                        department: row["Department"]?.trim() || null,
                        business_unit: row["Business Unit"]?.trim() || null,
                        company: row["Company"]?.trim() || null,
                      }).select("id, role").single();
                      // Zero-access default — same rule as manual addMember
                      if (csvInserted?.id && csvInserted.role !== "Admin" && csvInserted.role !== "CEO") {
                        await supabase.from("member_permissions").insert({
                          member_id: csvInserted.id,
                          can_view_executive_dashboard: false, can_view_operations_dashboard: false,
                          can_view_pa_dashboard: false, can_view_finance: false, can_edit_finance: false,
                          can_view_receivables: false, can_edit_receivables: false,
                          can_see_all_tasks: false, can_create_tasks: false, can_review_tasks: false,
                          can_manage_recurring_tasks: false, can_manage_calendar: false,
                          can_see_all_minutes: false, can_view_dept_hr: false, can_view_dept_tax: false,
                          can_view_dept_audit: false, can_view_dept_admin: false, can_view_dept_ops: false,
                          can_view_dept_it: false, can_view_members: false, can_add_members: false,
                          can_view_audit_log: false, can_import_export: false, can_access_daily_entry: false,
                          can_view_investments: false, can_view_stock: false, can_manage_stock: false,
                          can_view_guarantees: false, can_view_ifpl_pnl: false,
                          can_access_admin_ops: false, can_access_admin_entry: false,
                          can_manage_meetings: false, can_edit_operations_targets: false,
                          can_manage_locations: false,
                          folderit_can_view_utpl: false, folderit_can_view_ifpl: false,
                          folderit_can_view_rst: false, folderit_can_view_smi: false,
                          folderit_can_view_uzl: false, folderit_can_view_dir: false,
                        });
                      }
                      count++;
                    }
                    toast.show(`Successfully imported ${count} member${count !== 1 ? "s" : ""}.`, "success");
                    loadData();
                  }}
                  templateHeaders={["First Name", "Last Name", "Email", "Role", "Department", "Business Unit", "Company"]}
                  templateFilename="members-import-template.csv"
                  exportLabel="Export members as CSV"
                  importLabel="Import members from CSV"
                />
              )}
            </div>
          </div>

          {/* ── Add form ──────────────────────────────── */}
          {isAdmin && showAddForm && (
            <form onSubmit={addMember} style={{ ...cardStyle, marginBottom: "14px" }}>
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

              {/* Manager — mandatory for everyone except Admin/CEO at the
                  top of the chain (Khuram, 17/07/2026). Drives task
                  visibility and the Submit/sign-off routing. */}
              {role !== "Admin" && role !== "CEO" && (
                <div style={{ marginTop: "8px" }}>
                  <label style={lbl}>Manager (required)</label>
                  <select style={inp} value={managerId} onChange={(e) => setManagerId(e.target.value)} required>
                    <option value="">Select who this person reports to</option>
                    {members.filter((m) => m.is_active).sort((a, b) => fullName(a.first_name, a.last_name, a.name).localeCompare(fullName(b.first_name, b.last_name, b.name))).map((m) => (
                      <option key={m.id} value={m.id}>{fullName(m.first_name, m.last_name, m.name)} ({m.role})</option>
                    ))}
                  </select>
                </div>
              )}

              {/* This person will manage — the reverse relationship, wired
                  up at creation time so Khuram doesn't have to add the
                  member first and then come back to tick people under
                  them from a second screen. */}
              <div style={{ marginTop: "10px" }}>
                <label style={lbl}>This person will manage (optional)</label>
                <div style={{ maxHeight: "140px", overflowY: "auto", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, padding: "6px 8px" }}>
                  {members.filter((m) => m.is_active).sort((a, b) => fullName(a.first_name, a.last_name, a.name).localeCompare(fullName(b.first_name, b.last_name, b.name))).map((m) => (
                    <label key={m.id} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "3px 0", fontSize: "13px", color: COLOURS.NAVY, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={newMemberManages.has(m.id)}
                        onChange={(e) => setNewMemberManages((prev) => {
                          const next = new Set(prev);
                          e.target.checked ? next.add(m.id) : next.delete(m.id);
                          return next;
                        })}
                      />
                      {fullName(m.first_name, m.last_name, m.name)} <span style={{ color: COLOURS.SLATE }}>({m.role})</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Permissions preview */}
              {(role || department) && (
                <div style={{ marginTop: "12px", padding: "10px 12px", backgroundColor: COLOURS.CARD_ALT, borderRadius: RADII.SM, border: `1px solid ${COLOURS.HAIRLINE}` }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "6px" }}>
                    Permissions Preview — this member will automatically get:
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {(() => {
                      const isA = role === "Admin" || role === "CEO";
                      const isE = role === "Executive";
                      const isM = role === "Manager";
                      const d = department;
                      const perms: { label: string; on: boolean }[] = [
                        { label: "Exec Dashboard", on: isA },
                        { label: "Ops Dashboard", on: isA || isE || d === "Unze Trading Ops" },
                        { label: "PA Dashboard", on: isA || isE },
                        { label: "View Finance", on: isA || (isM && d === "Finance") },
                        { label: "Edit Finance", on: isA || (isM && d === "Finance") },
                        { label: "View Receivables", on: isA || (isM && (d === "Finance" || d === "Unze Trading Ops")) },
                        { label: "All Tasks", on: isA || isE },
                        { label: "Create Tasks", on: isA || isE },
                        { label: "Review Tasks", on: isA || isE },
                        { label: "Recurring Tasks", on: isA || isE },
                        { label: "Calendar Mgmt", on: isA || isE },
                        { label: "All Minutes", on: isA || isE },
                        { label: "Ops Dept", on: isA || d === "Unze Trading Ops" },
                        { label: "HR Dept", on: isA || d === "HR" },
                        { label: "Tax Dept", on: isA || d === "Tax" },
                        { label: "Audit Dept", on: isA || d === "Audit" },
                        { label: "Admin Dept", on: isA || isE || d === "Admin" },
                        { label: "IT Dept", on: isA || d === "IT" },
                        { label: "View Members", on: isA || isE },
                        { label: "Add Members", on: isA || isE },
                        { label: "Edit Members", on: isA || isE },
                        { label: "Delete Members", on: isA || isE },
                        { label: "Reset Others' PWs", on: isA || isE },
                        { label: "Audit Log", on: isA || isE },
                        { label: "Exceptions", on: isA || isE },
                        { label: "Import/Export", on: isA || isE },
                        { label: "Daily Entry", on: isA || d === "Unze Trading Ops" },
                      ];
                      return perms.filter((p) => p.on).map((p) => (
                        <span key={p.label} style={{
                          fontSize: "11px", fontWeight: 600, color: "white",
                          backgroundColor: COLOURS.GREEN, borderRadius: "6px", padding: "2px 8px",
                        }}>{p.label}</span>
                      ));
                    })()}
                    {role === "Member" && !department && (
                      <span style={{ fontSize: "11px", color: COLOURS.SLATE, fontStyle: "italic" }}>
                        Members get own-task access only. Select a department for department-specific rights.
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "6px", fontStyle: "italic" }}>
                    You can adjust individual permissions in the Access Control Matrix after adding.
                  </div>
                </div>
              )}
              <div style={{ marginTop: "10px" }}>
                <button type="submit" disabled={saving} style={smallBtn(COLOURS.NAVY, true)}>{saving ? "Adding..." : "Add Member"}</button>
              </div>
            </form>
          )}

          {/* ── Members table ─────────────────────────── */}
          <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
            {/* Header */}
            <div style={{
              ...tableHeaderStyle,
              display: "grid" as const,
              gridTemplateColumns: isMobile ? "1fr auto" : "2fr 1.2fr 1.2fr 0.8fr",
              gap: "8px",
              padding: "8px 12px",
              borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
            }}>
              <div>Name</div>
              {!isMobile && <div>Dept / BU</div>}
              {!isMobile && <div>Company</div>}
              <div>Role</div>
            </div>

            {/* Rows */}
            {paginatedMembers.map((m, idx) => {
              const dn = fullName(m.first_name, m.last_name, m.name);
              const isEditing = editingId === m.id;
              const memberPlants = assignments[m.id] || new Set<string>();
              const showsDept = roleHasDeptAndBU(m.role);
              const avatarGradient = AVATAR_GRADIENTS[(page * PAGE_SIZE + idx) % 5];
              const initials = getInitials(m.first_name, m.last_name, m.name);

              return (
                <div key={m.id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                  {/* ── Row ──────────────────────────────── */}
                  <div
                    onClick={() => isAdmin ? setEditingId(isEditing ? null : m.id) : undefined}
                    style={{
                      display: "grid",
                      gridTemplateColumns: isMobile ? "1fr auto" : "2fr 1.2fr 1.2fr 0.8fr",
                      gap: "8px", padding: "10px 12px", alignItems: "center",
                      cursor: isAdmin ? "pointer" : "default",
                      backgroundColor: isEditing ? COLOURS.CARD_ALT : COLOURS.CARD,
                    }}
                  >
                    {/* Name + avatar + email */}
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                      <div style={{
                        width: "32px", height: "32px", borderRadius: "50%",
                        background: m.photo_url ? "none" : avatarGradient,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                        color: "#fff",
                        fontSize: "11px", fontWeight: 600,
                        fontFamily: "var(--font-display, 'Inter Tight', sans-serif)",
                        overflow: "hidden",
                      }}>
                        {m.photo_url
                          ? <img src={m.photo_url} alt={initials} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                          : initials}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: "13.5px", fontWeight: 500, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "6px" }}>
                          {dn}
                          {m.is_hod && <span style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.AMBER }}>HOD</span>}
                        </div>
                        <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: COLOURS.SLATE, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "2px" }}>{m.email || "—"}</div>
                      </div>
                    </div>

                    {/* Dept / BU (desktop) */}
                    {!isMobile && (
                      <div style={{ fontSize: "12px", color: COLOURS.SLATE, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {showsDept ? (m.department || "—") : "All"}
                        {showsDept && m.business_unit && <span style={{ color: COLOURS.INK_400 }}> · {m.business_unit}</span>}
                      </div>
                    )}

                    {/* Company */}
                    {!isMobile && (
                      <div style={{ fontSize: "12px", color: COLOURS.SLATE, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {m.company || <span style={{ color: COLOURS.INK_400 }}>—</span>}
                      </div>
                    )}

                    {/* Role badge */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: isMobile ? "flex-end" : "flex-start" }}>
                      <span style={{
                        fontSize: "11px", fontWeight: 600, padding: "3px 9px", borderRadius: RADII.PILL,
                        width: "fit-content",
                        ...roleChip(m.role),
                      }}>{m.role}</span>
                      {m.is_active === false && (
                        <span style={{ fontSize: "10px", fontWeight: 700, color: COLOURS.SLATE, backgroundColor: COLOURS.CARD_ALT, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.PILL, padding: "2px 8px", width: "fit-content" }}>Inactive</span>
                      )}
                    </div>
                  </div>

                  {/* ── Mobile sub-row ────────────────────── */}
                  {isMobile && !isEditing && (
                    <div style={{ padding: "0 12px 8px", paddingLeft: "54px", fontSize: "12px", color: COLOURS.SLATE }}>
                      {m.company || "No company"} · {showsDept ? `${m.department || "—"}` : "All depts"}
                    </div>
                  )}

                  {/* ── Edit panel ──────────────────────────────────── */}
                  {isAdmin && isEditing && (
                    <div style={{ padding: "8px 12px", borderTop: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: COLOURS.CARD_ALT }}>
                      {/* ── Photo upload ── */}
                      <PhotoUpload
                        member={m}
                        onSaved={(url) => setMembers((prev) => prev.map((x) => x.id === m.id ? { ...x, photo_url: url } : x))}
                        onRemoved={() => setMembers((prev) => prev.map((x) => x.id === m.id ? { ...x, photo_url: null } : x))}
                      />
                      <div style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}`, marginBottom: "8px" }} />
                      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(auto-fit, minmax(120px, 1fr))", gap: "6px", marginBottom: "6px", alignItems: "end" }}>
                        <div><label style={lblC}>First Name</label><input style={inpC} defaultValue={m.first_name || ""} onBlur={(e) => { if (e.target.value !== (m.first_name || "")) updateMember(m.id, { first_name: e.target.value }); }} /></div>
                        <div><label style={lblC}>Last Name</label><input style={inpC} defaultValue={m.last_name || ""} onBlur={(e) => { if (e.target.value !== (m.last_name || "")) updateMember(m.id, { last_name: e.target.value }); }} /></div>
                        <div><label style={lblC}>Email</label><input style={inpC} defaultValue={m.email || ""} onBlur={(e) => { if (e.target.value.trim() !== (m.email || "")) updateMember(m.id, { email: e.target.value }); }} /></div>
                        <div><label style={lblC}>Role</label><select style={inpC} value={m.role} onChange={(e) => updateMember(m.id, { role: e.target.value })} disabled={!canEditMember(me, { email: m.email, role: m.role })}>{Array.from(new Set([m.role, ...myAssignableRoles])).map((r) => <option key={r}>{r}</option>)}</select></div>
                        <div><label style={lblC}>Department</label><select style={inpC} value={m.department || ""} onChange={(e) => updateMember(m.id, { department: e.target.value || null })}><option value="">—</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</select></div>
                        <div><label style={lblC}>Business Unit</label><select style={inpC} value={m.business_unit || ""} onChange={(e) => updateMember(m.id, { business_unit: e.target.value || null })} disabled={!m.department}><option value="">—</option>{businessUnitsFor(m.department).map((b) => <option key={b}>{b}</option>)}</select></div>
                        <div><label style={lblC}>Company</label><select style={inpC} value={m.company || ""} onChange={(e) => updateMember(m.id, { company: e.target.value || null })}><option value="">—</option>{MEMBER_COMPANIES.map((c) => <option key={c}>{c}</option>)}</select></div>
                        <label style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "11px", color: COLOURS.NAVY, cursor: "pointer", paddingBottom: "4px" }}>
                          <input type="checkbox" checked={m.is_hod || false} onChange={(e) => updateMember(m.id, { is_hod: e.target.checked })} /> HOD
                        </label>
                        <div><label style={lblC}>Position title</label><input style={inpC} defaultValue={m.position_title || ""} onBlur={(e) => { if (e.target.value !== (m.position_title || "")) updateMember(m.id, { position_title: e.target.value || null }); }} placeholder="e.g. CEO, Director" /></div>
                        <label style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "11px", color: m.is_active === false ? COLOURS.RED : COLOURS.NAVY, cursor: "pointer", paddingBottom: "4px" }} title="Use Offboard instead if they still have tasks, reports, or ownership to hand over — this just flips the flag directly.">
                          <input type="checkbox" checked={m.is_active !== false} onChange={(e) => updateMember(m.id, { is_active: e.target.checked })} /> Active
                        </label>
                      </div>

                      {/* Reports to — editable dropdown so a manager can be
                          assigned or changed directly from the edit panel. */}
                      {m.role !== "Admin" && m.role !== "CEO" && (
                        <div style={{ marginBottom: "8px" }}>
                          <label style={lblC}>Reports to (manager)</label>
                          <select
                            style={inpC}
                            value={m.manager_id || ""}
                            onChange={(e) => updateMember(m.id, { manager_id: e.target.value || null })}
                          >
                            <option value="">— No manager —</option>
                            {members
                              .filter((x) => x.id !== m.id && x.is_active !== false)
                              .sort((a, b) => fullName(a.first_name, a.last_name, a.name).localeCompare(fullName(b.first_name, b.last_name, b.name)))
                              .map((x) => (
                                <option key={x.id} value={x.id}>
                                  {fullName(x.first_name, x.last_name, x.name)} ({x.role})
                                </option>
                              ))}
                          </select>
                        </div>
                      )}

                      {/* Team members — only shown for HODs/Directors (and Admin/Exec,
                          who sit at the top of the chain and can have direct reports
                          too). Tick whoever should report to this person; unticking
                          clears their manager_id.
                          One person can only report to one HOD, so anyone already
                          assigned to someone else is hidden here entirely, not just
                          shown unticked — the only way to move them is to untick them
                          under their current manager first. */}
                      {(m.is_hod || m.role === "Admin" || m.role === "CEO" || m.role === "Executive") && (() => {
                        const pickable = members.filter((x) => x.id !== m.id && x.is_active !== false && (!x.manager_id || x.manager_id === m.id));
                        const elsewhereCount = members.filter((x) => x.id !== m.id && x.is_active !== false && x.manager_id && x.manager_id !== m.id).length;
                        return (
                          <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, padding: "8px 10px", marginBottom: "6px", backgroundColor: COLOURS.CARD }}>
                            <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, marginBottom: "6px", textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>
                              Team members reporting to {dn}
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                              {pickable.map((x) => {
                                const xn = fullName(x.first_name, x.last_name, x.name);
                                const checked = x.manager_id === m.id;
                                return (
                                  <label key={x.id} style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "12px", color: checked ? COLOURS.NAVY : COLOURS.SLATE, cursor: "pointer" }}>
                                    <input type="checkbox" checked={checked} onChange={(e) => toggleTeamMember(m.id, x.id, e.target.checked)} style={{ width: "13px", height: "13px" }} />
                                    {xn}
                                  </label>
                                );
                              })}
                              {pickable.length === 0 && <span style={{ fontSize: "12px", color: COLOURS.SLATE, fontStyle: "italic" }}>Nobody left to assign.</span>}
                            </div>
                            {elsewhereCount > 0 && (
                              <div style={{ fontSize: "11px", color: COLOURS.INK_400, marginTop: "6px" }}>
                                {elsewhereCount} other{elsewhereCount !== 1 ? "s" : ""} already assigned to a different manager — not shown here.
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Plants + Notifications */}
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginBottom: "6px", fontSize: "14px" }}>
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
                            <span style={{ color: COLOURS.HAIRLINE }}>|</span>
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
                            <span style={{ color: COLOURS.HAIRLINE }}>|</span>
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
                        <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "8px", flexWrap: "wrap" }}>
                          <input type="text" placeholder="Min 6 characters" value={newPw} onChange={(e) => setNewPw(e.target.value)}
                            style={{ ...inp, flex: "1 1 150px", maxWidth: "200px" }} />
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
              <div style={{ padding: "20px 12px", textAlign: "center", color: COLOURS.SLATE, fontSize: "13px" }}>No members found.</div>
            )}
          </div>

          {/* ── Pagination ────────────────────────────── */}
          {filtered.length > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px", flexWrap: "wrap", gap: "8px" }}>
              <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length} member{filtered.length !== 1 ? "s" : ""}
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  style={{
                    ...smallBtn(COLOURS.NAVY), padding: "6px 14px", fontSize: "12px",
                    opacity: page === 0 ? 0.4 : 1,
                    cursor: page === 0 ? "not-allowed" : "pointer",
                  }}
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  style={{
                    ...smallBtn(COLOURS.NAVY), padding: "6px 14px", fontSize: "12px",
                    opacity: page >= totalPages - 1 ? 0.4 : 1,
                    cursor: page >= totalPages - 1 ? "not-allowed" : "pointer",
                  }}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════
          TAB: ACCESS MATRIX
      ══════════════════════════════════════════════ */}
      {activeTab === "matrix" && isAdmin && (
        <>
          <AccessControlPanel members={members} isMobile={isMobile} />
          <WidgetVisibilityPanel members={members} isMobile={isMobile} />
          <AccessMatrix members={members} isMobile={isMobile} />
        </>
      )}

      {/* ══════════════════════════════════════════════
          TAB: DEPT. OWNERSHIP
      ══════════════════════════════════════════════ */}
      {activeTab === "ownership" && isAdmin && departments.length > 0 && (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD, overflow: "hidden" }}>
          <div style={{
            backgroundColor: COLOURS.NAVY,
            padding: "14px 18px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 600, color: "white", fontFamily: "var(--font-display)" }}>
                Department Ownership
              </div>
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", marginTop: "2px" }}>
                Who owns each department overall — shown on the Executive Dashboard
                {(() => { const v = departments.filter((d) => !d.primary_owner_member_id).length; return v > 0 ? ` · ${v} vacant` : ""; })()}
              </div>
            </div>
          </div>
          <div style={{ padding: "12px" }}>
            {departments.map((dept) => (
              <div key={dept.id} style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, padding: "10px 12px", marginBottom: "8px" }}>
                <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "8px", paddingBottom: "6px", borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                  {dept.department_name}
                  {!dept.primary_owner_member_id && <span style={{ fontSize: "11px", color: COLOURS.RED, marginLeft: "8px", fontWeight: 600 }}>NO PRIMARY OWNER</span>}
                </div>
                <div style={{ maxWidth: "260px" }}>
                  <label style={lblC}>Primary Owner</label>
                  <select style={inpC} value={dept.primary_owner_member_id || ""}
                    onChange={(e) => updateDeptOwner(dept.id, e.target.value)}>
                    <option value="">— None —</option>
                    {members.filter((m) => m.is_active !== false || m.id === dept.primary_owner_member_id).map((m) => <option key={m.id} value={m.id}>{fullName(m.first_name, m.last_name, m.name)}{m.is_active === false ? " (inactive)" : ""}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          TAB: OFFBOARD
      ══════════════════════════════════════════════ */}
      {activeTab === "offboard" && canOffboard && (() => {
        const leaver = leavingId ? members.find((m) => m.id === leavingId) : null;
        const replacement = replacementId ? members.find((m) => m.id === replacementId) : null;
        const taskCount = leaver ? openTaskCounts.get(leaver.name || "") || 0 : 0;
        const directReportCount = leaver ? members.filter((m) => m.manager_id === leaver.id).length : 0;
        const ownedDeptCount = leaver ? departments.filter((d) => d.primary_owner_member_id === leaver.id).length : 0;
        const interimManager = leaver?.manager_id ? members.find((m) => m.id === leaver.manager_id) : null;
        const showStepIntoLine = !!replacement && !replacement.manager_id && !!leaver?.manager_id;
        return (
          <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD, overflow: "hidden" }}>
            <div style={{ backgroundColor: COLOURS.NAVY, padding: "14px 18px" }}>
              <div style={{ fontSize: "14px", fontWeight: 600, color: "white", fontFamily: "var(--font-display)" }}>
                Offboard a Team Member
              </div>
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", marginTop: "2px" }}>
                One action for a departure: moves their open tasks, direct reports, and department ownership — then hides them from every list
              </div>
            </div>
            <div style={{ padding: "14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px", marginBottom: "10px", maxWidth: "560px" }}>
                <div>
                  <label style={lblC}>Who is leaving</label>
                  <select style={inpC} value={leavingId} onChange={(e) => { setLeavingId(e.target.value); setOffboardMsg(""); }}>
                    <option value="">— Select —</option>
                    {offboardableMembers.map((m) => <option key={m.id} value={m.id}>{fullName(m.first_name, m.last_name, m.name)} ({openTaskCounts.get(m.name || "") || 0} open)</option>)}
                  </select>
                </div>
                <div>
                  <label style={lblC}>Replacement (optional)</label>
                  <select style={inpC} value={replacementId} onChange={(e) => { setReplacementId(e.target.value); setOffboardMsg(""); }} disabled={!leavingId}>
                    <option value="">— None yet, route to their manager —</option>
                    {replacementCandidates.map((m) => <option key={m.id} value={m.id}>{fullName(m.first_name, m.last_name, m.name)}</option>)}
                  </select>
                </div>
              </div>
              {!isAdmin && (
                <p style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "8px" }}>Scoped to your own team — you and whoever reports directly to you.</p>
              )}
              {leaver && (
                <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, padding: "10px 12px", marginBottom: "10px", backgroundColor: COLOURS.CARD_ALT, fontSize: "13px", color: COLOURS.SLATE, maxWidth: "560px" }}>
                  <div><strong style={{ color: COLOURS.NAVY }}>{taskCount}</strong> open task(s), <strong style={{ color: COLOURS.NAVY }}>{directReportCount}</strong> direct report(s){ownedDeptCount > 0 ? <>, owns <strong style={{ color: COLOURS.NAVY }}>{ownedDeptCount}</strong> department(s)</> : null} — all moving to{" "}
                    <strong style={{ color: COLOURS.NAVY }}>{replacement ? fullName(replacement.first_name, replacement.last_name, replacement.name) : interimManager ? `${fullName(interimManager.first_name, interimManager.last_name, interimManager.name)} (their manager, interim)` : "nobody — pick a replacement if they have anything to hand over"}</strong>.
                  </div>
                  {showStepIntoLine && (
                    <label style={{ display: "flex", alignItems: "center", gap: "5px", marginTop: "8px", cursor: "pointer" }}>
                      <input type="checkbox" checked={stepIntoLine} onChange={(e) => setStepIntoLine(e.target.checked)} />
                      {fullName(replacement!.first_name, replacement!.last_name, replacement!.name)} also steps into {fullName(leaver.first_name, leaver.last_name, leaver.name)}&apos;s reporting line (reports to {fullName(interimManager?.first_name ?? null, interimManager?.last_name ?? null, interimManager?.name)})
                    </label>
                  )}
                </div>
              )}
              <button onClick={offboardMember} disabled={offboarding || !leavingId} style={{ ...smallBtn(COLOURS.RED, true), fontSize: "15px", padding: "6px 14px" }}>
                {offboarding ? "Offboarding..." : "Offboard"}
              </button>
              {offboardMsg && (
                <p style={{ marginTop: "8px", fontSize: "15px", fontWeight: 600, color: offboardMsg.startsWith("Error") || offboardMsg.includes("nowhere to route") ? COLOURS.RED : COLOURS.GREEN }}>{offboardMsg}</p>
              )}
            </div>
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════════
          TAB: ORG CHART
      ══════════════════════════════════════════════ */}
      {activeTab === "orgchart" && isAdmin && (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD, overflow: "hidden" }}>
          <div style={{ backgroundColor: COLOURS.NAVY, padding: "14px 18px" }}>
            <div style={{ fontSize: "14px", fontWeight: 600, color: "white", fontFamily: "var(--font-display)" }}>Org Chart</div>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", marginTop: "2px" }}>
              Who reports to whom — set from each HOD/Director&apos;s &quot;Team members&quot; picker on the People tab
            </div>
          </div>
          <div style={{ padding: "14px" }}>
            {(() => {
              // Leavers are archived, not deleted — keep them out of the
              // chart entirely rather than showing a stale box for someone
              // who no longer works here (their reports/ownership are moved
              // off them by the Offboard action, so this is just display).
              const activeMembers = members.filter((m) => m.is_active !== false);
              const roots = activeMembers.filter((m) => !m.manager_id);
              const unassigned = activeMembers.filter((m) => m.manager_id && !activeMembers.some((x) => x.id === m.manager_id));
              if (roots.length === 0) {
                return <div style={{ fontSize: "13px", color: COLOURS.SLATE, textAlign: "center" as const, padding: "20px" }}>No one has been set up yet — start from the People tab.</div>;
              }
              return (
                <>
                  <div style={{ display: "flex", gap: "40px", justifyContent: roots.length > 1 ? "flex-start" : "center", overflowX: "auto", padding: "4px 4px 12px" }}>
                    {roots.map((r) => (
                      <OrgNode key={r.id} member={r} allMembers={activeMembers} depth={0} visited={new Set()} />
                    ))}
                  </div>
                  {unassigned.length > 0 && (
                    <div style={{ marginTop: "14px", padding: "8px 12px", border: `1px dashed ${COLOURS.RED}`, borderRadius: RADII.SM, fontSize: "12px", color: COLOURS.RED }}>
                      {unassigned.length} member{unassigned.length !== 1 ? "s" : ""} point to a manager that no longer exists — check and re-assign on the People tab.
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </main>
  );
}

const inpC: React.CSSProperties = {
  width: "100%", padding: "4px 6px", border: `1px solid ${COLOURS.HAIRLINE}`,
  borderRadius: RADII.XS, fontSize: "13px", boxSizing: "border-box",
};
const lblC: React.CSSProperties = {
  display: "block", fontSize: "10px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "1px",
};
