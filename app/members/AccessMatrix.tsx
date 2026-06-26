"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { COLOURS } from "../lib/SharedUI";
import {
  CEO_EMAIL, ADMIN_EMAIL, PA_EMAIL, PROTECTED_EMAILS,
  isAdminTier, type UserCtx,
} from "../lib/permissions";

export type MatrixMember = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  email: string | null;
  role: string;
  department: string | null;
  company: string | null;
};

type PermRow = Record<string, boolean | string | null>;

const PERM_COLUMNS = [
  // ── Dashboards
  { key: "can_view_executive_dashboard", label: "Exec Dashboard", group: "Dashboards", tip: "Access the Executive command-centre dashboard" },
  { key: "can_view_operations_dashboard", label: "Ops Dashboard", group: "Dashboards", tip: "Access the Operations/production dashboard" },
  { key: "can_view_pa_dashboard", label: "PA Dashboard", group: "Dashboards", tip: "Access the PA assistant dashboard" },
  // ── Finance
  { key: "can_view_finance", label: "View Finance", group: "Finance", tip: "View cash positions, budgets, forecasts" },
  { key: "can_edit_finance", label: "Edit Finance", group: "Finance", tip: "Create/edit cash entries, plans, budgets" },
  { key: "finance_company_scope", label: "Fin. Scope", group: "Finance", tip: "Which companies: UTPL / IFPL / both", type: "select" as const, options: ["both", "UTPL", "IFPL"] },
  // ── Receivables
  { key: "can_view_receivables", label: "View Recv.", group: "Receivables", tip: "View receivable bills and stages" },
  { key: "can_edit_receivables", label: "Edit Recv.", group: "Receivables", tip: "Move bills, mark collected, add new" },
  // ── Tasks & Meetings
  { key: "can_see_all_tasks", label: "All Tasks", group: "Tasks & Meetings", tip: "See all tasks vs only own" },
  { key: "can_create_tasks", label: "Create Tasks", group: "Tasks & Meetings", tip: "Create and assign tasks to others" },
  { key: "can_review_tasks", label: "Review Tasks", group: "Tasks & Meetings", tip: "Edit due dates, close, reassign" },
  { key: "can_manage_recurring_tasks", label: "Recurring", group: "Tasks & Meetings", tip: "Manage recurring task templates" },
  { key: "can_manage_calendar", label: "Calendar Mgmt", group: "Tasks & Meetings", tip: "Approve/reject calendar requests" },
  { key: "can_see_all_minutes", label: "All Minutes", group: "Tasks & Meetings", tip: "See all meeting minutes vs only own" },
  // ── Departments
  { key: "can_view_dept_hr", label: "HR", group: "Departments", tip: "Access the HR department dashboard" },
  { key: "can_view_dept_tax", label: "Tax", group: "Departments", tip: "Access the Taxation department dashboard" },
  { key: "can_view_dept_audit", label: "Audit", group: "Departments", tip: "Access the Audit department dashboard" },
  { key: "can_view_dept_admin", label: "Admin Dept", group: "Departments", tip: "Access the Admin department dashboard" },
  // ── Members Management
  { key: "can_view_members", label: "View Members", group: "Members", tip: "Access the members management page" },
  { key: "can_add_members", label: "Add Members", group: "Members", tip: "Create new team members" },
  { key: "can_edit_members", label: "Edit Members", group: "Members", tip: "Edit member profiles, roles, departments" },
  { key: "can_delete_members", label: "Delete Members", group: "Members", tip: "Remove members from the system" },
  { key: "can_reset_passwords", label: "Reset PWs", group: "Members", tip: "Reset/set passwords for other users" },
  // ── Settings / Admin
  { key: "can_view_audit_log", label: "Audit Log", group: "Admin", tip: "View the system audit trail" },
  { key: "can_view_exceptions", label: "Exceptions", group: "Admin", tip: "View escalation/exception alerts" },
  { key: "can_import_export", label: "Import/Export", group: "Admin", tip: "Import/export member data via CSV" },
  // ── Production
  { key: "can_access_daily_entry", label: "Daily Entry", group: "Production", tip: "Log daily production, dispatch, breakage" },
] as const;

type ColDef = (typeof PERM_COLUMNS)[number];

const GROUPS = [...new Set(PERM_COLUMNS.map((c) => c.group))];

const GROUP_COLOURS: Record<string, string> = {
  Dashboards: "#6366f1",
  Finance: COLOURS.GREEN,
  Receivables: COLOURS.AMBER,
  "Tasks & Meetings": COLOURS.BLUE,
  Departments: COLOURS.PURPLE,
  Members: COLOURS.TEAL,
  Admin: COLOURS.NAVY,
  Production: "#ea580c",
};

function lc(s: string | null | undefined) { return (s || "").toLowerCase(); }

function roleDefault(col: ColDef, m: MatrixMember): boolean | string | null {
  const ctx: UserCtx = { email: m.email, role: m.role, department: m.department, company: m.company };
  const admin = isAdminTier(ctx);
  const exec = m.role === "Executive";
  const manager = m.role === "Manager";
  const dept = m.department;

  switch (col.key) {
    case "can_view_executive_dashboard": return admin;
    case "can_view_operations_dashboard": return admin || exec || dept === "Unze Trading Ops";
    case "can_view_pa_dashboard": return admin || exec;
    case "can_view_finance": return admin || (manager && dept === "Finance");
    case "can_edit_finance": return admin || (manager && dept === "Finance");
    case "finance_company_scope": {
      if (admin || !m.company) return "both";
      if (m.company?.startsWith("Unze Trading")) return "UTPL";
      if (m.company?.startsWith("Imperial")) return "IFPL";
      return "both";
    }
    case "can_view_receivables": return admin || (manager && (dept === "Finance" || dept === "Unze Trading Ops"));
    case "can_edit_receivables": return admin || (manager && (dept === "Finance" || dept === "Unze Trading Ops"));
    case "can_see_all_tasks": return admin || exec;
    case "can_create_tasks": return admin || exec;
    case "can_review_tasks": return admin || exec;
    case "can_manage_recurring_tasks": return admin || exec;
    case "can_manage_calendar": return admin || exec;
    case "can_see_all_minutes": return admin || exec;
    case "can_view_dept_hr": return admin;
    case "can_view_dept_tax": return admin;
    case "can_view_dept_audit": return admin;
    case "can_view_dept_admin": return admin || exec || dept === "Admin";
    case "can_view_members": return admin || exec;
    case "can_add_members": return admin || exec;
    case "can_edit_members": return admin || exec;
    case "can_delete_members": return admin || exec;
    case "can_reset_passwords": return admin || exec;
    case "can_view_audit_log": return admin || exec;
    case "can_view_exceptions": return admin || exec;
    case "can_import_export": return admin || exec;
    case "can_access_daily_entry": return admin || dept === "Unze Trading Ops";
    default: return false;
  }
}

function effectiveValue(col: ColDef, m: MatrixMember, overrides: PermRow | null): boolean | string {
  const override = overrides?.[col.key];
  if (override !== null && override !== undefined) {
    return col.key === "finance_company_scope" ? (override as string) : (override as boolean);
  }
  const def = roleDefault(col, m);
  return def ?? false;
}

function fullName(m: MatrixMember) {
  return `${m.first_name || ""} ${m.last_name || ""}`.trim() || m.name || m.email || "Unnamed";
}

function effectiveLabel(m: MatrixMember): string {
  const e = lc(m.email);
  if (e === CEO_EMAIL) return "CEO";
  if (e === ADMIN_EMAIL) return "Admin";
  if (e === PA_EMAIL || m.role === "Executive") return "PA";
  return m.role;
}

function roleBadgeColor(m: MatrixMember): string {
  const e = lc(m.email);
  if (e === CEO_EMAIL) return COLOURS.BLUE;
  if (e === ADMIN_EMAIL) return "#111827";
  if (m.role === "Admin") return "#111827";
  if (m.role === "Executive") return COLOURS.PURPLE;
  if (m.role === "Manager") return COLOURS.GREEN;
  return COLOURS.SLATE;
}

export default function AccessMatrix({ members, isMobile }: { members: MatrixMember[]; isMobile: boolean }) {
  const [open, setOpen] = useState(false);
  const [perms, setPerms] = useState<Record<string, PermRow>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [myEmail, setMyEmail] = useState("");

  const loadPerms = useCallback(async () => {
    const { data } = await supabase.from("member_permissions").select("*");
    if (data) {
      const map: Record<string, PermRow> = {};
      for (const row of data) map[row.member_id] = row;
      setPerms(map);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (open && !loaded) {
      loadPerms();
      supabase.auth.getUser().then(({ data }) => setMyEmail(data.user?.email || ""));
    }
  }, [open, loaded, loadPerms]);

  async function togglePerm(memberId: string, col: ColDef, newValue: boolean | string | null) {
    setSaving(memberId + col.key);
    const existing = perms[memberId];
    if (existing) {
      const { error } = await supabase.from("member_permissions")
        .update({ [col.key]: newValue, updated_at: new Date().toISOString() })
        .eq("member_id", memberId);
      if (error) { alert("Error: " + error.message); setSaving(null); return; }
    } else {
      const { error } = await supabase.from("member_permissions")
        .insert({ member_id: memberId, [col.key]: newValue });
      if (error) { alert("Error: " + error.message); setSaving(null); return; }
    }
    setPerms((prev) => ({
      ...prev,
      [memberId]: { ...prev[memberId], [col.key]: newValue },
    }));
    setSaving(null);
  }

  const rows = [...members].sort((a, b) => {
    const rank = (m: MatrixMember) => {
      const ctx: UserCtx = { email: m.email, role: m.role };
      return isAdminTier(ctx) ? 0 : m.role === "Executive" ? 1 : m.role === "Manager" ? 2 : 3;
    };
    return rank(a) - rank(b) || fullName(a).localeCompare(fullName(b));
  });

  const isProtected = (m: MatrixMember) => PROTECTED_EMAILS.includes(lc(m.email));
  const isSelf = (m: MatrixMember) => lc(m.email) === lc(myEmail);

  return (
    <div style={{ marginTop: "12px" }}>
      <div onClick={() => setOpen(!open)} style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer",
        border: `1px solid ${COLOURS.BORDER}`, borderRadius: open ? "8px 8px 0 0" : "8px", padding: "14px 18px",
        backgroundColor: open ? COLOURS.NAVY : "white",
        transition: "background-color 0.2s",
      }}>
        <div>
          <div style={{ fontSize: "17px", fontWeight: 700, color: open ? "white" : COLOURS.NAVY }}>Access Control Matrix</div>
          <div style={{ fontSize: "12px", color: open ? "rgba(255,255,255,0.7)" : COLOURS.SLATE }}>
            Toggle individual permissions per team member
          </div>
        </div>
        <span style={{ color: open ? "white" : COLOURS.SLATE, fontSize: "14px" }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{
          border: `1px solid ${COLOURS.BORDER}`, borderTop: "none", borderRadius: "0 0 8px 8px",
          backgroundColor: "white", padding: "0", overflowX: "auto",
        }}>
          {!loaded ? (
            <div style={{ padding: "40px", textAlign: "center", color: COLOURS.SLATE }}>Loading permissions...</div>
          ) : (
            <>
              {/* Legend */}
              <div style={{ padding: "12px 16px", display: "flex", gap: "16px", flexWrap: "wrap", fontSize: "12px", color: COLOURS.SLATE, borderBottom: `1px solid ${COLOURS.BORDER}`, alignItems: "center" }}>
                <span style={{ fontWeight: 700 }}>Legend:</span>
                <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: COLOURS.GREEN, display: "inline-block" }} /> Enabled
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: "#e2e8f0", border: "1px solid #cbd5e1", display: "inline-block" }} /> Disabled
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: COLOURS.GREEN, opacity: 0.35, display: "inline-block" }} /> Role default (click to override)
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ width: 16, height: 16, borderRadius: 4, border: "2px solid #111827", display: "inline-block" }} /> Locked (Admin/CEO)
                </span>
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", minWidth: "1400px" }}>
                <thead>
                  {/* Group header row */}
                  <tr>
                    <th style={{ ...thStyle, minWidth: 180, position: "sticky", left: 0, zIndex: 3, backgroundColor: COLOURS.LIGHT }} />
                    <th style={{ ...thStyle, minWidth: 60 }} />
                    {GROUPS.map((g) => {
                      const cols = PERM_COLUMNS.filter((c) => c.group === g);
                      return (
                        <th key={g} colSpan={cols.length} style={{
                          ...thStyle,
                          backgroundColor: GROUP_COLOURS[g] || COLOURS.SLATE,
                          color: "white",
                          textAlign: "center",
                          fontSize: "11px",
                          fontWeight: 700,
                          letterSpacing: "0.5px",
                          borderLeft: "2px solid white",
                        }}>{g}</th>
                      );
                    })}
                  </tr>
                  {/* Column header row */}
                  <tr>
                    <th style={{ ...thStyle, minWidth: 180, position: "sticky", left: 0, zIndex: 3, backgroundColor: COLOURS.LIGHT, textAlign: "left" }}>Member</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>Role</th>
                    {PERM_COLUMNS.map((col, i) => {
                      const isGroupStart = i === 0 || PERM_COLUMNS[i - 1].group !== col.group;
                      return (
                        <th key={col.key} title={col.tip} style={{
                          ...thStyle,
                          textAlign: "center",
                          cursor: "help",
                          whiteSpace: "nowrap",
                          borderLeft: isGroupStart ? `2px solid ${COLOURS.BORDER}` : undefined,
                          maxWidth: 75,
                        }}>
                          <div style={{ writingMode: isMobile ? undefined : "vertical-rl", transform: isMobile ? undefined : "rotate(180deg)", fontSize: "11px", lineHeight: 1.2, padding: "4px 0" }}>
                            {col.label}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => {
                    const locked = isProtected(m);
                    const self = isSelf(m);
                    const overrides = perms[m.id] || null;

                    return (
                      <tr key={m.id} style={{ borderBottom: `1px solid ${COLOURS.BORDER}`, backgroundColor: locked ? "#fafafa" : "white" }}>
                        <td style={{ ...tdStyle, position: "sticky", left: 0, zIndex: 1, backgroundColor: locked ? "#fafafa" : "white", minWidth: 180 }}>
                          <div style={{ fontWeight: 600, color: COLOURS.NAVY, fontSize: "13px" }}>{fullName(m)}</div>
                          <div style={{ fontSize: "10px", color: COLOURS.SLATE }}>{m.email || "—"}</div>
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          <span style={{
                            display: "inline-block", fontSize: "10px", fontWeight: 700, color: "white",
                            backgroundColor: roleBadgeColor(m), borderRadius: "6px", padding: "2px 8px",
                          }}>{effectiveLabel(m)}</span>
                        </td>
                        {PERM_COLUMNS.map((col, i) => {
                          const isGroupStart = i === 0 || PERM_COLUMNS[i - 1].group !== col.group;
                          const eff = effectiveValue(col, m, overrides);
                          const hasOverride = overrides?.[col.key] !== null && overrides?.[col.key] !== undefined;
                          const isLoading = saving === m.id + col.key;
                          const canToggle = !locked && !self;

                          if (col.key === "finance_company_scope") {
                            const financeOn = effectiveValue(
                              PERM_COLUMNS.find((c) => c.key === "can_view_finance")!,
                              m, overrides
                            );
                            if (!financeOn) {
                              return <td key={col.key} style={{ ...tdStyle, textAlign: "center", borderLeft: isGroupStart ? `2px solid ${COLOURS.BORDER}` : undefined, color: "#cbd5e1" }}>—</td>;
                            }
                            return (
                              <td key={col.key} style={{ ...tdStyle, textAlign: "center", borderLeft: isGroupStart ? `2px solid ${COLOURS.BORDER}` : undefined }}>
                                <select
                                  value={(eff as string) || "both"}
                                  onChange={(e) => togglePerm(m.id, col, e.target.value)}
                                  disabled={!canToggle || isLoading}
                                  style={{
                                    fontSize: "10px", padding: "2px 4px", borderRadius: 4,
                                    border: `1px solid ${COLOURS.BORDER}`, cursor: canToggle ? "pointer" : "not-allowed",
                                    backgroundColor: hasOverride ? "#dbeafe" : "white",
                                    opacity: isLoading ? 0.5 : 1,
                                  }}
                                >
                                  {(col as unknown as { options: readonly string[] }).options.map((o: string) => (
                                    <option key={o} value={o}>{o.toUpperCase()}</option>
                                  ))}
                                </select>
                              </td>
                            );
                          }

                          const on = eff === true;
                          return (
                            <td key={col.key} style={{ ...tdStyle, textAlign: "center", borderLeft: isGroupStart ? `2px solid ${COLOURS.BORDER}` : undefined }}>
                              {locked ? (
                                <div style={{
                                  width: 22, height: 22, margin: "0 auto",
                                  borderRadius: 5,
                                  border: "2px solid #111827",
                                  backgroundColor: on ? COLOURS.GREEN : "#e2e8f0",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                }} title="Locked — Admin/CEO permissions cannot be changed">
                                  {on && <span style={{ color: "white", fontSize: 12, fontWeight: 700 }}>✓</span>}
                                </div>
                              ) : (
                                <button
                                  onClick={() => {
                                    if (!canToggle) return;
                                    const newVal = hasOverride ? null : !roleDefault(col, m);
                                    if (newVal === null) {
                                      togglePerm(m.id, col, null);
                                    } else {
                                      togglePerm(m.id, col, !on);
                                    }
                                  }}
                                  disabled={isLoading || !canToggle}
                                  title={
                                    isLoading ? "Saving..." :
                                    !canToggle ? "Cannot modify your own permissions" :
                                    hasOverride ? `Override active — click to reset to role default (${roleDefault(col, m) ? "on" : "off"})` :
                                    `Role default: ${on ? "on" : "off"} — click to override`
                                  }
                                  style={{
                                    width: 22, height: 22, padding: 0, margin: "0 auto",
                                    borderRadius: 5, cursor: canToggle ? "pointer" : "not-allowed",
                                    border: hasOverride ? "2px solid #3b82f6" : "1px solid #cbd5e1",
                                    backgroundColor: on ? COLOURS.GREEN : "#e2e8f0",
                                    opacity: isLoading ? 0.3 : hasOverride ? 1 : 0.55,
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    transition: "all 0.15s",
                                  }}
                                >
                                  {on && <span style={{ color: "white", fontSize: 12, fontWeight: 700 }}>✓</span>}
                                </button>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "6px 8px",
  fontSize: "11px",
  fontWeight: 700,
  color: COLOURS.SLATE,
  textTransform: "uppercase",
  letterSpacing: "0.3px",
  borderBottom: `2px solid ${COLOURS.BORDER}`,
  backgroundColor: COLOURS.LIGHT,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "6px 8px",
  verticalAlign: "middle",
};
