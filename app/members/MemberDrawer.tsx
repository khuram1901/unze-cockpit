"use client";

/**
 * MemberDrawer — right-side panel shown when a member is selected in the People tab.
 *
 * Three tabs:
 *   Access   — access packs (quick presets) + finance section redesign + grouped permission toggles
 *   Profile  — photo, name, role, dept, manager, team members, plants, notifications
 *   Security — password reset/set, active status, remove member
 *
 * All security logic is identical to the old inline edit panel:
 *   - MATRIX_LOCKED_EMAILS / PROTECTED_EMAILS are checked before any edit
 *   - canEditMember / canDeleteMember / canChangePasswordFor gate every action
 *   - Permission saves go via supabase upsert to member_permissions (same table, same columns)
 *   - Profile changes go via the onUpdate callback → supabase.from("members").update()
 *
 * Finance section redesigned from the 0%-satisfaction per-company widget to:
 *   Company scope chips: Both | UTPL only | IFPL only | No access
 *   Individual area toggles: Cash view/edit, P&L Imperial, Receivables, Bank Facilities, Investments
 *
 * Access Packs: one-click presets for common roles — Tasks Only, Ops Staff, Finance Viewer, Audit Team.
 *   Applying a pack patches only the pack's defined keys and marks them pending; the user still hits
 *   "Save permissions" to commit.
 */

import React, { useState, useEffect, useRef, useCallback, CSSProperties } from "react";
import { supabase, authFetch } from "../lib/supabase";
import { COLOURS, RADII, inputStyle, labelStyle, useToast } from "../lib/SharedUI";
import {
  MATRIX_LOCKED_EMAILS, PROTECTED_EMAILS,
  canChangePasswordFor, canEditMember, canDeleteMember,
  type UserCtx,
} from "../lib/permissions";
import { logAction } from "../lib/audit-log";
import PhotoCropModal from "../lib/PhotoCropModal";
import { WIDGET_REGISTRY } from "../lib/widgetRegistry";
import { FINANCE_COMPANIES } from "../lib/constants";

/* ── Types ────────────────────────────────────────────────────────────── */

export type DrawerMember = {
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

export type DrawerPlant = { id: string; name: string };

type DrawerTab = "access" | "profile" | "security";
type FinanceScope = "both" | "UTPL" | "IFPL" | "none";
type PermRow = Record<string, boolean | string | null>;

/* ── Access packs ─────────────────────────────────────────────────────── */

type AccessPack = {
  id: string;
  label: string;
  description: string;
  perms: PermRow;
};

const ACCESS_PACKS: AccessPack[] = [
  {
    id: "tasks_only",
    label: "Tasks Only",
    description: "Create & track own tasks. No page or finance access.",
    perms: {
      can_view_executive_dashboard: false, can_view_operations_dashboard: false,
      can_view_pa_dashboard: false, can_view_finance: false, can_edit_finance: false,
      finance_company_scope: null, can_view_receivables: false, can_edit_receivables: false,
      can_see_all_tasks: false, can_review_tasks: false,
      can_manage_recurring_tasks: false, can_manage_calendar: false,
      can_see_all_minutes: false, can_manage_meetings: false,
      can_view_dept_hr: false, can_view_dept_tax: false, can_view_dept_audit: false,
      can_view_dept_admin: false, can_view_dept_ops: false, can_view_dept_it: false,
      can_view_dept_tax_accounts: false, can_manage_tax_notices: false, can_manage_tax_schedule: false,
      can_view_members: false, can_add_members: false,
      can_access_daily_entry: false, can_view_stock: false, can_manage_stock: false,
      can_view_investments: false, can_view_guarantees: false, can_manage_guarantees: false,
      can_view_ifpl_pnl: false, can_access_admin_ops: false,
      can_access_admin_entry: false, can_access_banking: false,
    },
  },
  {
    id: "ops_staff",
    label: "Ops Staff",
    description: "Operations dashboard, daily entry, stock, dispatch.",
    perms: {
      can_view_executive_dashboard: false, can_view_operations_dashboard: true,
      can_view_finance: false, finance_company_scope: null,
      can_see_all_tasks: false, can_review_tasks: false,
      can_view_dept_ops: true, can_access_daily_entry: true,
      can_view_stock: true, can_manage_stock: false,
    },
  },
  {
    id: "finance_viewer",
    label: "Finance Viewer",
    description: "Cash, receivables, Imperial P&L — read only, both companies.",
    perms: {
      can_view_finance: true, finance_company_scope: "both",
      can_edit_finance: false, can_view_receivables: true,
      can_edit_receivables: false, can_view_ifpl_pnl: true,
      can_view_investments: false, can_view_guarantees: false,
    },
  },
  {
    id: "audit_team",
    label: "Audit Team",
    description: "Audit department dashboard and own tasks only.",
    perms: {
      can_view_executive_dashboard: false, can_view_operations_dashboard: false,
      can_view_finance: false, finance_company_scope: null,
      can_view_dept_audit: true,
      can_see_all_tasks: false, can_review_tasks: false,
    },
  },
];

/* ── Permission sections for the Access tab ───────────────────────────── */

type PermItem = { key: string; label: string; description?: string };
type PermSection = { title: string; icon: string; items: PermItem[] };

const PERM_SECTIONS: PermSection[] = [
  {
    title: "Dashboards", icon: "📊",
    items: [
      { key: "can_view_executive_dashboard", label: "Executive dashboard", description: "CEO command-centre overview" },
      { key: "can_view_operations_dashboard", label: "Operations dashboard", description: "Production & dispatch overview" },
      { key: "can_view_pa_dashboard", label: "PA dashboard", description: "Executive assistant view" },
    ],
  },
  {
    title: "Tasks", icon: "✅",
    items: [
      { key: "can_see_all_tasks", label: "See all tasks", description: "View tasks assigned to anyone" },
      { key: "can_create_tasks", label: "Create & assign tasks", description: "Create tasks and assign to others" },
      { key: "can_review_tasks", label: "Review & close tasks", description: "Edit due dates, close, reassign" },
      { key: "can_manage_recurring_tasks", label: "Recurring task templates" },
      { key: "can_manage_calendar", label: "Calendar management", description: "Approve/reject calendar requests" },
      { key: "can_see_all_minutes", label: "All meeting minutes", description: "See minutes company-wide, not just own" },
      { key: "can_manage_meetings", label: "Manage meetings", description: "Create meetings, upload minutes" },
    ],
  },
  {
    title: "Departments", icon: "🏢",
    items: [
      { key: "can_view_dept_ops", label: "Unze Trading Ops" },
      { key: "can_view_dept_hr", label: "HR" },
      { key: "can_view_dept_audit", label: "Audit" },
      { key: "can_view_dept_admin", label: "Admin" },
      { key: "can_view_dept_it", label: "IT" },
      { key: "can_view_dept_tax", label: "Tax Notices" },
      { key: "can_view_dept_tax_accounts", label: "Accounts & Returns" },
      { key: "can_manage_tax_notices", label: "Manage tax notices" },
      { key: "can_manage_tax_schedule", label: "Tax accounts schedule" },
    ],
  },
  {
    title: "Production", icon: "🏭",
    items: [
      { key: "can_access_daily_entry", label: "Daily entry", description: "Log production, dispatch, breakage" },
      { key: "can_view_stock", label: "View stock", description: "View stock levels and inventory" },
      { key: "can_manage_stock", label: "Purchase orders", description: "Create & manage purchase orders" },
      { key: "can_edit_operations_targets", label: "Operations targets", description: "Set monthly production targets" },
    ],
  },
  {
    title: "Admin Operations", icon: "🔧",
    items: [
      { key: "can_access_admin_ops", label: "Admin ops", description: "EOBI, Social Security, compliance, fleet" },
      { key: "can_access_admin_entry", label: "Admin daily entry", description: "Log fuel, solar, utility readings" },
      { key: "can_access_banking", label: "Banking payments", description: "EOBI & Social Security payments" },
      { key: "can_manage_locations", label: "Manage locations" },
    ],
  },
  {
    title: "Team & Members", icon: "👥",
    items: [
      { key: "can_view_members", label: "View members page" },
      { key: "can_add_members", label: "Add new members" },
      { key: "can_edit_members", label: "Edit member profiles" },
      { key: "can_delete_members", label: "Remove members" },
      { key: "can_reset_passwords", label: "Reset other members' passwords" },
      { key: "can_view_audit_log", label: "Audit log" },
      { key: "can_import_export", label: "Import/export data" },
    ],
  },
  {
    title: "Folderit Documents", icon: "📁",
    items: [
      { key: "can_view_folderit_hr", label: "HR documents" },
      { key: "folderit_can_view_utpl", label: "Unze Trading (UTPL)" },
      { key: "folderit_can_view_ifpl", label: "Imperial Footwear (IFPL)" },
      { key: "folderit_can_view_rst", label: "Restaurants" },
      { key: "folderit_can_view_smi", label: "S&M Investments" },
      { key: "folderit_can_view_uzl", label: "Unze London" },
      { key: "folderit_can_view_dir", label: "Directors (Family Documents)" },
    ],
  },
];

/* ── Widget registry helpers ──────────────────────────────────────────── */

const PER_COMPANY_WIDGETS = WIDGET_REGISTRY.filter((w) => w.perCompany);
const PLAIN_WIDGETS = WIDGET_REGISTRY.filter((w) => !w.perCompany);
const PLAIN_WIDGET_PAGES = [...new Set(PLAIN_WIDGETS.map((w) => w.page))];

/* ── Department / BU helpers ──────────────────────────────────────────── */

const DEPARTMENTS = [
  "Unze Trading Ops", "Finance", "HR", "Admin",
  "IT", "Tax", "Legal", "Sales", "Audit", "S&M Investment", "BINC",
];
const ALL_BUS = [
  "Head Office", "PESCO Plant", "MEPCO Plant", "FESCO Plant",
  "Meters", "Retail", "Hospitality", "Property", "Nursing College",
];
const DEPT_BUS: Record<string, string[]> = {
  "Unze Trading Ops": ["Head Office", "PESCO Plant", "MEPCO Plant", "FESCO Plant", "Meters"],
  Finance: ALL_BUS, HR: ALL_BUS, Admin: ALL_BUS, Legal: ALL_BUS, Audit: ALL_BUS,
  Sales: ["PESCO Plant", "MEPCO Plant", "FESCO Plant", "Meters"],
  "S&M Investment": ["Property"], BINC: ["Nursing College"],
};
const MEMBER_COMPANIES = [
  "Unze Group", "Unze Trading PVT Limited", "Imperial Footwear PVT Limited",
  "Haute Dolci", "Barahn PVT Limited", "K&K Jhang",
];
function busFor(dept: string | null) { return dept ? DEPT_BUS[dept] || ALL_BUS : []; }
function fullName(m: DrawerMember) {
  return `${m.first_name || ""} ${m.last_name || ""}`.trim() || m.name || m.email || "Unnamed";
}

/* ── PHOTO_MAX_KB ─────────────────────────────────────────────────────── */

const PHOTO_MAX_KB = 150;

/* ── Small helper components ──────────────────────────────────────────── */

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div
      onClick={() => !disabled && onChange(!on)}
      style={{
        width: 34, height: 19, borderRadius: 10,
        background: on ? COLOURS.GREEN : COLOURS.HAIRLINE,
        position: "relative", cursor: disabled ? "not-allowed" : "pointer",
        transition: "background .15s", flexShrink: 0,
        border: `1px solid ${on ? COLOURS.GREEN : "#cbd5e1"}`,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <div style={{
        position: "absolute", width: 13, height: 13, borderRadius: "50%",
        background: "#fff", top: 2,
        left: on ? 17 : 2,
        transition: "left .15s",
        boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
      }} />
    </div>
  );
}

const inp: CSSProperties = { ...inputStyle, padding: "5px 8px", fontSize: "13px" };
const lbl: CSSProperties = { ...labelStyle, fontSize: "11px", marginBottom: "2px" };

function Field({
  label, value, onChange, type = "text", disabled, children,
}: {
  label: string;
  value?: string;
  onChange?: (v: string) => void;
  type?: string;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      {children || (
        <input
          style={{ ...inp, opacity: disabled ? 0.5 : 1 }}
          type={type}
          defaultValue={value}
          disabled={disabled}
          onBlur={(e) => { if (onChange && e.target.value !== value) onChange(e.target.value); }}
        />
      )}
    </div>
  );
}

/* ── PhotoUpload (moved from MembersManager) ──────────────────────────── */

function PhotoUpload({ member, onSaved, onRemoved }: {
  member: DrawerMember;
  onSaved: (url: string) => void;
  onRemoved: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    setError(null);
    if (!file.type.startsWith("image/")) { setError("Please select an image file."); return; }
    setCropFile(file);
  }
  function onCropDone(croppedBlob: Blob, prev: string) { setBlob(croppedBlob); setPreview(prev); setCropFile(null); }

  async function save() {
    if (!blob) return;
    setSaving(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("memberId", member.id);
      fd.append("photo", new File([blob], "photo.jpg", { type: "image/jpeg" }));
      const res = await authFetch("/api/members/photo", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Upload failed."); }
      else {
        setPreview(null); setBlob(null); onSaved(json.photoUrl);
        window.dispatchEvent(new CustomEvent("unze:photo-updated", { detail: { url: json.photoUrl, memberId: member.id } }));
      }
    } catch { setError("Network error."); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!member.photo_url) return;
    setSaving(true); setError(null);
    try {
      const res = await authFetch("/api/members/photo", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: member.id }) });
      if (res.ok) { onRemoved(); setPreview(null); setBlob(null); }
      else { const j = await res.json(); setError(j.error || "Remove failed."); }
    } catch { setError("Network error."); }
    finally { setSaving(false); }
  }

  const currentSrc = preview || member.photo_url || null;
  const initials = ((member.first_name?.[0] || "") + (member.last_name?.[0] || "")).toUpperCase() || (member.name?.slice(0, 2) || "?").toUpperCase();

  return (
    <>
      {cropFile && <PhotoCropModal file={cropFile} maxKb={PHOTO_MAX_KB} onDone={onCropDone} onCancel={() => setCropFile(null)} />}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div style={{
          width: 56, height: 56, borderRadius: "50%", flexShrink: 0,
          border: `2px solid ${COLOURS.HAIRLINE}`, overflow: "hidden",
          background: COLOURS.CARD_ALT, display: "flex", alignItems: "center", justifyContent: "center",
          position: "relative",
        }}>
          {currentSrc
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={currentSrc} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center" }} />
            : <span style={{ fontSize: 18, fontWeight: 700, color: COLOURS.SLATE }}>{initials}</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.05em" }}>Profile Photo</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => inputRef.current?.click()} disabled={saving}
              style={btn(COLOURS.NAVY, false)}>
              {member.photo_url || preview ? "Change" : "Upload"}
            </button>
            {preview && blob && <button onClick={save} disabled={saving} style={btn(COLOURS.GREEN, true)}>{saving ? "Saving…" : "Save"}</button>}
            {preview && <button onClick={() => { setPreview(null); setBlob(null); }} disabled={saving} style={btn(COLOURS.SLATE, false)}>Cancel</button>}
            {member.photo_url && !preview && <button onClick={remove} disabled={saving} style={btn(COLOURS.RED, false)}>{saving ? "Removing…" : "Remove"}</button>}
          </div>
          {error && <div style={{ fontSize: 11, color: COLOURS.RED }}>{error}</div>}
          <div style={{ fontSize: 10, color: COLOURS.INK_400 }}>Any size · auto-cropped · max {PHOTO_MAX_KB} KB</div>
        </div>
        <input ref={inputRef} type="file" accept="image/*" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
      </div>
    </>
  );
}

/* ── Button style helper ──────────────────────────────────────────────── */

function btn(colour: string, solid: boolean): CSSProperties {
  return {
    fontSize: 12, padding: "4px 10px", borderRadius: 5, cursor: "pointer", fontWeight: 600,
    background: solid ? colour : "transparent",
    border: `1px solid ${colour}`,
    color: solid ? "#fff" : colour,
  };
}

/* ── Props ────────────────────────────────────────────────────────────── */

export type MemberDrawerProps = {
  member: DrawerMember;
  me: UserCtx;
  members: DrawerMember[];
  plants: DrawerPlant[];
  assignments: Record<string, Set<string>>;
  savingAssignment: string;
  myAssignableRoles: string[];
  onClose?: () => void;
  onUpdate: (id: string, updates: Partial<DrawerMember>) => void;
  onTogglePlant: (memberId: string, plantId: string, on: boolean) => void;
  onToggleTeam: (managerId: string, memberId: string, checked: boolean) => void;
  onDelete: (id: string, name: string) => void;
  onSendPwReset: (email: string, name: string) => void;
  onSetPw: (email: string, name: string, pw: string) => void;
  onPhotoSaved: (memberId: string, url: string) => void;
  onPhotoRemoved: (memberId: string) => void;
};

/* ═══════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════ */

export default function MemberDrawer({
  member, me, members, plants, assignments, savingAssignment, myAssignableRoles,
  onClose, onUpdate, onTogglePlant, onToggleTeam, onDelete,
  onSendPwReset, onSetPw, onPhotoSaved, onPhotoRemoved,
}: MemberDrawerProps) {
  const toast = useToast();
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("access");

  /* ── Collapsible sections (Access tab) ───────────────────────────── */
  // All sections start collapsed so you see the full overview at a glance.
  // "Finance" and "Access Packs" are open by default — most common first stop.
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(["Finance", "Packs"]));
  function toggleSection(title: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      next.has(title) ? next.delete(title) : next.add(title);
      return next;
    });
  }

  /* ── Permission state ─────────────────────────────────────────────── */
  const [perms, setPerms] = useState<PermRow>({});
  const [pending, setPending] = useState<PermRow>({});
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [savingPerms, setSavingPerms] = useState(false);

  /* ── Widget override state ────────────────────────────────────────── */
  const [widgetOverrides, setWidgetOverrides] = useState<Record<string, boolean>>({});
  const [savingWidget, setSavingWidget] = useState<string | null>(null);
  const [openWidgetPages, setOpenWidgetPages] = useState<Set<string>>(new Set());
  function toggleWidgetPage(page: string) {
    setOpenWidgetPages((prev) => {
      const next = new Set(prev);
      next.has(page) ? next.delete(page) : next.add(page);
      return next;
    });
  }

  /* ── Security tab state ───────────────────────────────────────────── */
  const [settingPw, setSettingPw] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [resettingPw, setResettingPw] = useState(false);

  /* ── Load permissions when member changes ─────────────────────────── */
  const loadPerms = useCallback(async (memberId: string) => {
    setLoadingPerms(true);
    setPending({});
    const { data } = await supabase.from("member_permissions").select("*").eq("member_id", memberId).single();
    setPerms(data || {});
    setLoadingPerms(false);
  }, []);

  const loadWidgets = useCallback(async (memberId: string) => {
    const { data } = await supabase
      .from("member_widget_overrides")
      .select("widget_key, visible")
      .eq("member_id", memberId);
    const map: Record<string, boolean> = {};
    for (const r of data || []) map[r.widget_key] = r.visible;
    setWidgetOverrides(map);
  }, []);

  useEffect(() => {
    loadPerms(member.id);
    loadWidgets(member.id);
    // Reset tabs and security state when member changes
    setDrawerTab("access");
    setSettingPw(false);
    setNewPw("");
  }, [member.id, loadPerms, loadWidgets]);

  /* ── Effective perms (saved + pending) ───────────────────────────── */
  const ep: PermRow = { ...perms, ...pending };
  const hasPending = Object.keys(pending).length > 0;

  /* ── Finance scope helper ─────────────────────────────────────────── */
  function getFinanceScope(): FinanceScope {
    if (!ep.can_view_finance) return "none";
    const sc = ep.finance_company_scope;
    if (sc === "UTPL") return "UTPL";
    if (sc === "IFPL") return "IFPL";
    return "both";
  }

  function setFinanceScope(scope: FinanceScope) {
    if (scope === "none") {
      setPending((p) => ({ ...p, can_view_finance: false, finance_company_scope: null }));
    } else {
      setPending((p) => ({
        ...p,
        can_view_finance: true,
        finance_company_scope: scope,
      }));
    }
  }

  function toggle(key: string, value: boolean) { setPending((p) => ({ ...p, [key]: value })); }

  /* ── Apply access pack ───────────────────────────────────────────── */
  function applyPack(pack: AccessPack) {
    setPending((p) => ({ ...p, ...pack.perms }));
    toast.show(`"${pack.label}" pack applied — save to commit.`, "info");
  }

  /* ── Save permissions ─────────────────────────────────────────────── */
  async function savePerms() {
    if (!hasPending) return;
    setSavingPerms(true);
    const merged = { ...perms, ...pending };
    // Remove member_id from the merge if it exists (it's the upsert key)
    delete merged.member_id;
    const { error } = await supabase
      .from("member_permissions")
      .upsert({ member_id: member.id, ...merged }, { onConflict: "member_id" });
    if (error) { toast.show("Error: " + error.message, "error"); }
    else {
      setPerms(merged);
      setPending({});
      toast.show("Permissions saved.", "success");
      logAction("Updated", "member_permissions", `Updated permissions for ${fullName(member)}`, member.id);
    }
    setSavingPerms(false);
  }

  /* ── Widget override save ─────────────────────────────────────────── */
  async function setWidget(widgetKey: string, value: "default" | "show" | "hide") {
    setSavingWidget(widgetKey);
    if (value === "default") {
      const { error } = await supabase
        .from("member_widget_overrides")
        .delete()
        .eq("member_id", member.id)
        .eq("widget_key", widgetKey);
      if (error) { toast.show("Error: " + error.message, "error"); setSavingWidget(null); return; }
      setWidgetOverrides((prev) => { const next = { ...prev }; delete next[widgetKey]; return next; });
    } else {
      const visible = value === "show";
      const { error } = await supabase
        .from("member_widget_overrides")
        .upsert(
          { member_id: member.id, widget_key: widgetKey, visible, updated_at: new Date().toISOString() },
          { onConflict: "member_id,widget_key" }
        );
      if (error) { toast.show("Error: " + error.message, "error"); setSavingWidget(null); return; }
      setWidgetOverrides((prev) => ({ ...prev, [widgetKey]: visible }));
    }
    setSavingWidget(null);
  }

  /* ── Security helpers ─────────────────────────────────────────────── */
  const isProtected = MATRIX_LOCKED_EMAILS.includes((member.email || "").toLowerCase());
  const isProtectedProfile = PROTECTED_EMAILS.includes((member.email || "").toLowerCase());
  const target: UserCtx = { email: member.email, role: member.role };
  const canEdit = canEditMember(me, target) && !isProtectedProfile;
  const canDelete = canDeleteMember(me, target);
  const canPw = canChangePasswordFor(me, target);

  async function handleSetPw() {
    if (newPw.length < 6) { toast.show("Password must be at least 6 characters.", "error"); return; }
    setSavingPw(true);
    await onSetPw(member.email || "", fullName(member), newPw);
    setNewPw(""); setSettingPw(false); setSavingPw(false);
  }

  async function handlePwReset() {
    setResettingPw(true);
    await onSendPwReset(member.email || "", fullName(member));
    setResettingPw(false);
  }

  /* ── Section on-count helper ──────────────────────────────────────── */
  function onCount(items: PermItem[]) {
    return items.filter((i) => ep[i.key] === true).length;
  }

  /* ── Member is admin tier → no permission editing ─────────────────── */
  const isAdminRole = member.role === "Admin" || member.role === "CEO";

  /* ── Derived data for Profile tab ─────────────────────────────────── */
  const memberPlants = assignments[member.id] || new Set<string>();
  const showsDept = member.role === "Manager" || member.role === "Member";

  const dn = fullName(member);

  /* ─────────────────────────────────────────────────────────────────── */

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 480 }}>
      {toast.element}

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{
        padding: "14px 18px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
        display: "flex", alignItems: "center", gap: 12,
        background: COLOURS.CARD,
      }}>
        {onClose && (
          <button onClick={onClose} style={{ ...btn(COLOURS.SLATE, false), padding: "4px 8px", fontSize: 13 }}>
            ←
          </button>
        )}
        {/* Avatar */}
        <div style={{
          width: 42, height: 42, borderRadius: "50%", flexShrink: 0,
          background: member.photo_url ? "none" : COLOURS.NAVY,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fff", fontSize: 13, fontWeight: 600, overflow: "hidden", position: "relative",
        }}>
          {member.photo_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={member.photo_url} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center" }} />
            : ((member.first_name?.[0] || "") + (member.last_name?.[0] || "")).toUpperCase() || (member.name?.slice(0, 2) || "?").toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: COLOURS.NAVY }}>{dn}</span>
            <RoleBadge role={member.role} />
            {member.is_active === false && (
              <span style={{ fontSize: 10, fontWeight: 700, color: COLOURS.SLATE, background: COLOURS.CARD_ALT, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.PILL, padding: "1px 7px" }}>
                Inactive
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: COLOURS.SLATE, marginTop: 1 }}>
            {member.department ? `${member.department} · ` : ""}{member.email || "No email"}
          </div>
        </div>
      </div>

      {/* ── Tab strip ──────────────────────────────────────────────── */}
      <div style={{ display: "flex", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, background: COLOURS.CARD }}>
        {(["access", "profile", "security"] as DrawerTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setDrawerTab(t)}
            style={{
              padding: "9px 18px", fontSize: 12.5, border: "none", cursor: "pointer",
              background: "transparent",
              borderBottom: drawerTab === t ? `2px solid ${COLOURS.NAVY}` : "2px solid transparent",
              color: drawerTab === t ? COLOURS.NAVY : COLOURS.SLATE,
              fontWeight: drawerTab === t ? 600 : 400,
              marginBottom: -1,
              textTransform: "capitalize",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Tab body ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto", background: COLOURS.CARD_ALT }}>

        {/* ══════════════════════════════════════════
            ACCESS TAB
        ══════════════════════════════════════════ */}
        {drawerTab === "access" && (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Admin tier notice */}
            {isAdminRole && (
              <div style={{
                padding: "12px 14px", borderRadius: RADII.SM,
                background: COLOURS.NAVY, color: "#fff", fontSize: 13,
              }}>
                <strong>{member.role}</strong> — all permissions granted by role. Individual toggles below are not used for this account.
              </div>
            )}

            {/* ── Access Packs ─────────────────────────────────────── */}
            {!isAdminRole && (
              <div style={sectionBox}>
                <button
                  onClick={() => toggleSection("Packs")}
                  style={{ ...sectionHead, width: "100%", cursor: "pointer", background: openSections.has("Packs") ? COLOURS.CARD_ALT : COLOURS.CARD }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: COLOURS.NAVY }}>⚡ Quick Access Packs</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: COLOURS.SLATE }}>Apply a preset</span>
                    <span style={{ fontSize: 11, color: COLOURS.SLATE, transform: openSections.has("Packs") ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s", display: "inline-block" }}>▼</span>
                  </div>
                </button>
                {openSections.has("Packs") && (
                  <>
                    <div style={{ padding: "10px 14px", display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {ACCESS_PACKS.map((pack) => (
                        <button
                          key={pack.id}
                          onClick={() => applyPack(pack)}
                          disabled={isProtected}
                          title={pack.description}
                          style={{
                            fontSize: 12, fontWeight: 600, padding: "6px 14px",
                            borderRadius: RADII.PILL, cursor: isProtected ? "not-allowed" : "pointer",
                            border: `1px solid ${COLOURS.NAVY}`,
                            background: "transparent", color: COLOURS.NAVY,
                          }}
                        >
                          {pack.label}
                        </button>
                      ))}
                    </div>
                    <div style={{ padding: "0 14px 10px", fontSize: 11, color: COLOURS.SLATE, fontStyle: "italic" }}>
                      Packs are a starting point — you can still toggle individual permissions below before saving.
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Finance section ───────────────────────────────────── */}
            {!isAdminRole && (
              <div style={sectionBox}>
                <button onClick={() => toggleSection("Finance")} style={{ ...sectionHead, width: "100%", cursor: "pointer", background: openSections.has("Finance") ? COLOURS.CARD_ALT : COLOURS.CARD }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: COLOURS.NAVY }}>💰 Finance</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: RADII.PILL, background: getFinanceScope() !== "none" ? COLOURS.SUCCESS_SOFT : COLOURS.CARD_ALT, color: getFinanceScope() !== "none" ? COLOURS.GREEN : COLOURS.SLATE, fontWeight: 600 }}>
                      {getFinanceScope() === "none" ? "No access" : getFinanceScope() === "both" ? "UTPL + IFPL" : getFinanceScope()}
                    </span>
                    <span style={{ fontSize: 11, color: COLOURS.SLATE, transform: openSections.has("Finance") ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s", display: "inline-block" }}>▼</span>
                  </div>
                </button>
                {openSections.has("Finance") && <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
                  {/* Company scope */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: COLOURS.SLATE, marginBottom: 6 }}>Company scope</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {(["none", "UTPL", "IFPL", "both"] as FinanceScope[]).map((s) => {
                        const active = getFinanceScope() === s;
                        const label = s === "none" ? "No access" : s === "both" ? "Both (UTPL + IFPL)" : s === "UTPL" ? "UTPL only" : "IFPL only";
                        return (
                          <button
                            key={s}
                            onClick={() => !isProtected && setFinanceScope(s)}
                            disabled={isProtected}
                            style={{
                              fontSize: 12, padding: "5px 13px", borderRadius: RADII.PILL,
                              cursor: isProtected ? "not-allowed" : "pointer",
                              border: `1.5px solid ${active ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
                              background: active ? COLOURS.NAVY : "transparent",
                              color: active ? "#fff" : COLOURS.SLATE,
                              fontWeight: active ? 600 : 400,
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Finance area toggles — only when scope is not none */}
                  {getFinanceScope() !== "none" && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      {[
                        { key: "can_edit_finance", label: "Edit cash & budgets" },
                        { key: "can_view_receivables", label: "View receivables" },
                        { key: "can_edit_receivables", label: "Edit receivables" },
                        { key: "can_view_ifpl_pnl", label: "Imperial P&L (IFPL)" },
                        { key: "can_view_guarantees", label: "Bank facilities" },
                        { key: "can_manage_guarantees", label: "Manage guarantees" },
                        { key: "can_view_investments", label: "View investments" },
                        { key: "can_edit_investments", label: "Edit investments" },
                        { key: "can_refresh_investment_prices", label: "Refresh inv. prices" },
                      ].map(({ key, label: itemLabel }) => (
                        <div key={key} style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "6px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: 6,
                          background: COLOURS.CARD,
                        }}>
                          <span style={{ fontSize: 12, color: COLOURS.NAVY }}>{itemLabel}</span>
                          <Toggle on={ep[key] === true} onChange={(v) => toggle(key, v)} disabled={isProtected} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>}
              </div>
            )}

            {/* ── Permission sections ───────────────────────────────── */}
            {!isAdminRole && PERM_SECTIONS.map((section) => {
              const count = onCount(section.items);
              const isOpen = openSections.has(section.title);
              return (
                <div key={section.title} style={sectionBox}>
                  <button onClick={() => toggleSection(section.title)} style={{ ...sectionHead, width: "100%", cursor: "pointer", background: isOpen ? COLOURS.CARD_ALT : COLOURS.CARD }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: COLOURS.NAVY }}>{section.icon} {section.title}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: RADII.PILL, background: count > 0 ? COLOURS.SUCCESS_SOFT : COLOURS.CARD_ALT, color: count > 0 ? COLOURS.GREEN : COLOURS.SLATE, fontWeight: 600 }}>
                      {count > 0 ? `${count} on` : "None"}
                    </span>
                    <span style={{ fontSize: 11, color: COLOURS.SLATE, transform: isOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s", display: "inline-block" }}>▼</span>
                    </div>
                  </button>
                  {isOpen && (
                    <div style={{ padding: "8px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                      {section.items.map(({ key, label: itemLabel, description }) => (
                        <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <div>
                            <div style={{ fontSize: 12.5, color: COLOURS.NAVY }}>{itemLabel}</div>
                            {description && <div style={{ fontSize: 11, color: COLOURS.SLATE }}>{description}</div>}
                          </div>
                          <Toggle on={ep[key] === true} onChange={(v) => toggle(key, v)} disabled={isProtected} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* ── Widget visibility section ─────────────────────── */}
            {!isAdminRole && (() => {
              const overrideCount = Object.keys(widgetOverrides).length;
              const isOpen = openSections.has("Widgets");
              return (
                <div style={sectionBox}>
                  <button onClick={() => toggleSection("Widgets")} style={{ ...sectionHead, width: "100%", cursor: "pointer", background: isOpen ? COLOURS.CARD_ALT : COLOURS.CARD }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: COLOURS.NAVY }}>🎛️ Widget Visibility</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: RADII.PILL, background: overrideCount > 0 ? COLOURS.SUCCESS_SOFT : COLOURS.CARD_ALT, color: overrideCount > 0 ? COLOURS.GREEN : COLOURS.SLATE, fontWeight: 600 }}>
                        {overrideCount > 0 ? `${overrideCount} override${overrideCount !== 1 ? "s" : ""}` : "All default"}
                      </span>
                      <span style={{ fontSize: 11, color: COLOURS.SLATE, transform: isOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s", display: "inline-block" }}>▼</span>
                    </div>
                  </button>
                  {isOpen && (
                    <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 16 }}>
                      <div style={{ fontSize: 11, color: COLOURS.SLATE, fontStyle: "italic" }}>
                        Default = role-based. Show/Hide = forced on or off for this person only, regardless of role.
                      </div>

                      {/* Per-company finance widgets — collapsible */}
                      {(() => {
                        const pageKey = "__finance_panels__";
                        const isPageOpen = openWidgetPages.has(pageKey);
                        const overrideHere = PER_COMPANY_WIDGETS.flatMap((w) =>
                          FINANCE_COMPANIES.map((c) => `${w.key}.${c.id}`)
                        ).filter((k) => k in widgetOverrides).length;
                        return (
                          <div style={sectionBox}>
                            <button onClick={() => toggleWidgetPage(pageKey)} style={{ ...sectionHead, width: "100%", cursor: "pointer", background: isPageOpen ? COLOURS.CARD_ALT : COLOURS.CARD }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: COLOURS.NAVY }}>Finance Panels (per company)</span>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                {overrideHere > 0 && (
                                  <span style={{ fontSize: 10.5, padding: "1px 7px", borderRadius: RADII.PILL, background: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN, fontWeight: 600 }}>
                                    {overrideHere} override{overrideHere !== 1 ? "s" : ""}
                                  </span>
                                )}
                                <span style={{ fontSize: 11, color: COLOURS.SLATE, transform: isPageOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s", display: "inline-block" }}>▼</span>
                              </div>
                            </button>
                            {isPageOpen && (
                              <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
                                {FINANCE_COMPANIES.map((company) => (
                                  <div key={company.id}>
                                    <div style={{ fontSize: 11.5, fontWeight: 600, color: COLOURS.SLATE, marginBottom: 6 }}>{company.name}</div>
                                    <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: 6, overflow: "hidden" }}>
                                      {PER_COMPANY_WIDGETS.map((w, i, arr) => {
                                        const widgetKey = `${w.key}.${company.id}`;
                                        const current: "default" | "show" | "hide" =
                                          widgetOverrides[widgetKey] === true ? "show" :
                                          widgetOverrides[widgetKey] === false ? "hide" : "default";
                                        return (
                                          <div key={w.key} style={{
                                            display: "flex", justifyContent: "space-between", alignItems: "center",
                                            padding: "8px 12px",
                                            borderBottom: i < arr.length - 1 ? `1px solid ${COLOURS.HAIRLINE}` : "none",
                                            opacity: savingWidget === widgetKey ? 0.5 : 1,
                                          }}>
                                            <div style={{ minWidth: 0, paddingRight: 8 }}>
                                              <div style={{ fontSize: 12.5, color: COLOURS.NAVY }}>{w.label}</div>
                                              {w.tip && <div style={{ fontSize: 11, color: COLOURS.SLATE }}>{w.tip}</div>}
                                            </div>
                                            <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                                              {(["default", "show", "hide"] as const).map((opt) => (
                                                <button key={opt} onClick={() => setWidget(widgetKey, opt)} disabled={!!savingWidget}
                                                  style={{ fontSize: 10.5, fontWeight: 600, padding: "4px 8px", borderRadius: 5, textTransform: "capitalize", cursor: savingWidget ? "default" : "pointer", border: `1px solid ${current === opt ? COLOURS.NAVY : COLOURS.HAIRLINE}`, background: current === opt ? COLOURS.NAVY : "transparent", color: current === opt ? "#fff" : COLOURS.SLATE }}>
                                                  {opt}
                                                </button>
                                              ))}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Non-per-company widgets — each page collapsible */}
                      {PLAIN_WIDGET_PAGES.map((page) => {
                        const pageWidgets = PLAIN_WIDGETS.filter((w) => w.page === page);
                        const isPageOpen = openWidgetPages.has(page);
                        const overrideHere = pageWidgets.filter((w) => w.key in widgetOverrides).length;
                        return (
                          <div key={page} style={sectionBox}>
                            <button onClick={() => toggleWidgetPage(page)} style={{ ...sectionHead, width: "100%", cursor: "pointer", background: isPageOpen ? COLOURS.CARD_ALT : COLOURS.CARD }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: COLOURS.NAVY }}>{page}</span>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                {overrideHere > 0 && (
                                  <span style={{ fontSize: 10.5, padding: "1px 7px", borderRadius: RADII.PILL, background: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN, fontWeight: 600 }}>
                                    {overrideHere} override{overrideHere !== 1 ? "s" : ""}
                                  </span>
                                )}
                                <span style={{ fontSize: 11, color: COLOURS.SLATE, transform: isPageOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s", display: "inline-block" }}>▼</span>
                              </div>
                            </button>
                            {isPageOpen && (
                              <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "0 0 6px 6px", overflow: "hidden" }}>
                                {pageWidgets.map((w, i, arr) => {
                                  const current: "default" | "show" | "hide" =
                                    widgetOverrides[w.key] === true ? "show" :
                                    widgetOverrides[w.key] === false ? "hide" : "default";
                                  return (
                                    <div key={w.key} style={{
                                      display: "flex", justifyContent: "space-between", alignItems: "center",
                                      padding: "8px 12px",
                                      borderBottom: i < arr.length - 1 ? `1px solid ${COLOURS.HAIRLINE}` : "none",
                                      opacity: savingWidget === w.key ? 0.5 : 1,
                                    }}>
                                      <div style={{ minWidth: 0, paddingRight: 8 }}>
                                        <div style={{ fontSize: 12.5, color: COLOURS.NAVY }}>{w.label}</div>
                                        {w.tip && <div style={{ fontSize: 11, color: COLOURS.SLATE }}>{w.tip}</div>}
                                      </div>
                                      <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                                        {(["default", "show", "hide"] as const).map((opt) => (
                                          <button key={opt} onClick={() => setWidget(w.key, opt)} disabled={!!savingWidget}
                                            style={{ fontSize: 10.5, fontWeight: 600, padding: "4px 8px", borderRadius: 5, textTransform: "capitalize", cursor: savingWidget ? "default" : "pointer", border: `1px solid ${current === opt ? COLOURS.NAVY : COLOURS.HAIRLINE}`, background: current === opt ? COLOURS.NAVY : "transparent", color: current === opt ? "#fff" : COLOURS.SLATE }}>
                                            {opt}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Loading state */}
            {loadingPerms && (
              <div style={{ padding: "20px", textAlign: "center", color: COLOURS.SLATE, fontSize: 13 }}>Loading permissions…</div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════
            PROFILE TAB
        ══════════════════════════════════════════ */}
        {drawerTab === "profile" && (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Photo */}
            {canEdit && (
              <PhotoUpload
                member={member}
                onSaved={(url) => onPhotoSaved(member.id, url)}
                onRemoved={() => onPhotoRemoved(member.id)}
              />
            )}

            {/* Core fields */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Field label="First name" value={member.first_name || ""}
                onChange={(v) => updateIfChanged(v, member.first_name || "", () => onUpdate(member.id, { first_name: v }))}
                disabled={!canEdit} />
              <Field label="Last name" value={member.last_name || ""}
                onChange={(v) => updateIfChanged(v, member.last_name || "", () => onUpdate(member.id, { last_name: v }))}
                disabled={!canEdit} />
            </div>
            <Field label="Email" value={member.email || ""}
              onChange={(v) => updateIfChanged(v, member.email || "", () => onUpdate(member.id, { email: v }))}
              disabled={!canEdit} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Field label="Role" disabled={!canEdit}>
                <select style={inp} value={member.role} disabled={!canEdit}
                  onChange={(e) => onUpdate(member.id, { role: e.target.value })}>
                  {Array.from(new Set([member.role, ...myAssignableRoles])).map((r) => <option key={r}>{r}</option>)}
                </select>
              </Field>
              <Field label="Position title" value={member.position_title || ""}
                onChange={(v) => onUpdate(member.id, { position_title: v || null })}
                disabled={!canEdit} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <Field label="Department" disabled={!canEdit}>
                <select style={inp} value={member.department || ""} disabled={!canEdit}
                  onChange={(e) => onUpdate(member.id, { department: e.target.value || null })}>
                  <option value="">—</option>
                  {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
                </select>
              </Field>
              <Field label="Business unit" disabled={!canEdit || !member.department}>
                <select style={inp} value={member.business_unit || ""} disabled={!canEdit || !member.department}
                  onChange={(e) => onUpdate(member.id, { business_unit: e.target.value || null })}>
                  <option value="">—</option>
                  {busFor(member.department).map((b) => <option key={b}>{b}</option>)}
                </select>
              </Field>
              <Field label="Company" disabled={!canEdit}>
                <select style={inp} value={member.company || ""} disabled={!canEdit}
                  onChange={(e) => onUpdate(member.id, { company: e.target.value || null })}>
                  <option value="">—</option>
                  {MEMBER_COMPANIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
            </div>

            {/* HOD + Active */}
            {canEdit && (
              <div style={{ display: "flex", gap: 16 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={member.is_hod || false} onChange={(e) => onUpdate(member.id, { is_hod: e.target.checked })} />
                  Head of Department (HOD)
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, cursor: "pointer", color: member.is_active === false ? COLOURS.RED : COLOURS.NAVY }}
                  title="Use Offboard instead if they have tasks or direct reports to hand over.">
                  <input type="checkbox" checked={member.is_active !== false} onChange={(e) => onUpdate(member.id, { is_active: e.target.checked })} />
                  Active
                </label>
              </div>
            )}

            {/* Manager */}
            {canEdit && member.role !== "Admin" && member.role !== "CEO" && (
              <Field label="Reports to (manager)">
                <select style={inp} value={member.manager_id || ""}
                  onChange={(e) => onUpdate(member.id, { manager_id: e.target.value || null })}>
                  <option value="">— No manager —</option>
                  {members.filter((x) => x.id !== member.id && x.is_active !== false)
                    .sort((a, b) => fullName(a).localeCompare(fullName(b)))
                    .map((x) => <option key={x.id} value={x.id}>{fullName(x)} ({x.role})</option>)}
                </select>
              </Field>
            )}

            {/* Team members (HOD/Admin) */}
            {canEdit && (member.is_hod || member.role === "Admin" || member.role === "CEO" || member.role === "Executive") && (() => {
              const pickable = members.filter((x) => x.id !== member.id && x.is_active !== false && (!x.manager_id || x.manager_id === member.id));
              const elseCount = members.filter((x) => x.id !== member.id && x.is_active !== false && x.manager_id && x.manager_id !== member.id).length;
              return (
                <div>
                  <div style={lbl}>Team members reporting to {member.first_name || dn}</div>
                  <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, padding: "8px 10px", maxHeight: 140, overflowY: "auto" }}>
                    {pickable.map((x) => (
                      <label key={x.id} style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 0", fontSize: 13, cursor: "pointer" }}>
                        <input type="checkbox" checked={x.manager_id === member.id}
                          onChange={(e) => onToggleTeam(member.id, x.id, e.target.checked)} />
                        {fullName(x)} <span style={{ color: COLOURS.SLATE, fontSize: 12 }}>({x.role})</span>
                      </label>
                    ))}
                    {pickable.length === 0 && <span style={{ fontSize: 12, color: COLOURS.SLATE, fontStyle: "italic" }}>Nobody available to assign.</span>}
                  </div>
                  {elseCount > 0 && <div style={{ fontSize: 11, color: COLOURS.INK_400, marginTop: 4 }}>{elseCount} other{elseCount !== 1 ? "s" : ""} already assigned elsewhere.</div>}
                </div>
              );
            })()}

            {/* Plants */}
            {showsDept && plants.length > 0 && (
              <div>
                <div style={lbl}>Plants</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {plants.map((p) => {
                    const on = memberPlants.has(p.id);
                    const key = `${member.id}-${p.id}`;
                    return (
                      <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 13, cursor: savingAssignment === key ? "wait" : "pointer", opacity: savingAssignment === key ? 0.5 : 1 }}>
                        <input type="checkbox" checked={on} disabled={savingAssignment === key}
                          onChange={() => onTogglePlant(member.id, p.id, on)} />
                        {p.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Notifications */}
            <div>
              <div style={lbl}>Notifications</div>
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={member.notify_email}
                    onChange={(e) => onUpdate(member.id, { notify_email: e.target.checked })} />
                  Email
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={member.notify_whatsapp || false}
                    onChange={(e) => onUpdate(member.id, { notify_whatsapp: e.target.checked })} />
                  WhatsApp
                </label>
                {member.notify_whatsapp && (
                  <input placeholder="+92..." defaultValue={member.phone_e164 || ""}
                    onBlur={(e) => { if (e.target.value !== (member.phone_e164 || "")) onUpdate(member.id, { phone_e164: e.target.value || null }); }}
                    style={{ ...inp, width: 120 }} />
                )}
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════
            SECURITY TAB
        ══════════════════════════════════════════ */}
        {drawerTab === "security" && (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>

            {canPw && (
              <div style={sectionBox}>
                <div style={sectionHead}><span style={{ fontSize: 13, fontWeight: 600, color: COLOURS.NAVY }}>🔑 Password</span></div>
                <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                  <button onClick={handlePwReset} disabled={resettingPw || !member.email}
                    style={{ ...btn(COLOURS.NAVY, false), alignSelf: "flex-start" }}>
                    {resettingPw ? "Sending…" : "Send password reset email"}
                  </button>
                  {!settingPw ? (
                    <button onClick={() => setSettingPw(true)} style={{ ...btn(COLOURS.NAVY, false), alignSelf: "flex-start" }}>
                      Set password directly
                    </button>
                  ) : (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <input type="text" placeholder="Min 6 characters" value={newPw}
                        onChange={(e) => setNewPw(e.target.value)}
                        style={{ ...inp, flex: "1 1 140px", maxWidth: 200 }} />
                      <button onClick={handleSetPw} disabled={savingPw || newPw.length < 6}
                        style={{ ...btn(COLOURS.GREEN, true), opacity: newPw.length < 6 ? 0.5 : 1 }}>
                        {savingPw ? "Saving…" : "Save"}
                      </button>
                      <button onClick={() => { setSettingPw(false); setNewPw(""); }} style={btn(COLOURS.SLATE, false)}>Cancel</button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {canDelete && (
              <div style={sectionBox}>
                <div style={sectionHead}><span style={{ fontSize: 13, fontWeight: 600, color: COLOURS.RED }}>⚠️ Danger zone</span></div>
                <div style={{ padding: "12px 14px" }}>
                  <p style={{ fontSize: 12.5, color: COLOURS.SLATE, marginBottom: 10 }}>
                    Removing a member cannot be undone. Use the <strong>Offboard</strong> tab if they still have tasks, reports, or department ownership to hand over.
                  </p>
                  <button onClick={() => onDelete(member.id, dn)} style={{ ...btn(COLOURS.RED, true) }}>
                    Remove {member.first_name || dn}
                  </button>
                </div>
              </div>
            )}

            {!canPw && !canDelete && (
              <div style={{ padding: 20, color: COLOURS.SLATE, fontSize: 13, textAlign: "center" }}>
                You do not have permission to perform security actions on this account.
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Footer: Save / Discard (Access tab only) ───────────────── */}
      {drawerTab === "access" && !isAdminRole && (
        <div style={{
          padding: "10px 16px", borderTop: `1px solid ${COLOURS.HAIRLINE}`,
          display: "flex", justifyContent: "flex-end", gap: 8,
          background: COLOURS.CARD,
        }}>
          <button onClick={() => setPending({})} disabled={!hasPending}
            style={{ ...btn(COLOURS.SLATE, false), opacity: hasPending ? 1 : 0.4 }}>
            Discard
          </button>
          <button onClick={savePerms} disabled={!hasPending || savingPerms || isProtected}
            style={{ ...btn(COLOURS.NAVY, true), opacity: hasPending && !isProtected ? 1 : 0.4 }}>
            {savingPerms ? "Saving…" : `Save permissions${hasPending ? ` (${Object.keys(pending).length} change${Object.keys(pending).length !== 1 ? "s" : ""})` : ""}`}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Role badge ───────────────────────────────────────────────────────── */

function RoleBadge({ role }: { role: string }) {
  const colour =
    role === "Admin" ? COLOURS.NAVY :
    role === "CEO" ? COLOURS.BLUE :
    role === "Executive" ? COLOURS.PURPLE :
    role === "Manager" ? COLOURS.GREEN :
    COLOURS.SLATE;
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: colour, borderRadius: RADII.PILL, padding: "2px 8px" }}>
      {role}
    </span>
  );
}

/* ── Section style helpers ────────────────────────────────────────────── */

const sectionBox: CSSProperties = {
  border: `1px solid ${COLOURS.HAIRLINE}`,
  borderRadius: 8, overflow: "hidden", background: COLOURS.CARD,
};

const sectionHead: CSSProperties = {
  padding: "9px 14px", background: COLOURS.CARD_ALT,
  borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
  display: "flex", alignItems: "center", justifyContent: "space-between",
};

/* ── Helper: only call onUpdate if value actually changed ─────────────── */
function updateIfChanged(newVal: string, oldVal: string, fn: () => void) {
  if (newVal !== oldVal) fn();
}
