"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { COLOURS, useToast } from "../lib/SharedUI";
import {
  CEO_EMAIL, ADMIN_EMAIL, PA_EMAIL, PROTECTED_EMAILS, OPS_HOD_EMAIL,
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
  // ── Dashboards ──────────────────────────────────────────────
  { key: "can_view_executive_dashboard", label: "Exec", group: "Dashboards", tip: "Access the Executive command-centre dashboard" },
  { key: "can_view_operations_dashboard", label: "Ops", group: "Dashboards", tip: "Access the Operations/production dashboard" },
  { key: "can_view_pa_dashboard", label: "PA", group: "Dashboards", tip: "Access the PA assistant dashboard" },

  // ── Finance ─────────────────────────────────────────────────
  { key: "can_view_finance", label: "Cash", group: "Finance", tip: "View cash positions, budgets, forecasts" },
  { key: "can_edit_finance", label: "Cash Edit", group: "Finance", tip: "Create/edit cash entries, plans, budgets" },
  { key: "finance_company_scope", label: "Scope", group: "Finance", tip: "Which companies: UTPL / IFPL / both", type: "select" as const, options: ["both", "UTPL", "IFPL"] },
  { key: "can_view_guarantees", label: "BF View", group: "Finance", tip: "View Bank Facilities / guarantee records" },
  { key: "can_manage_guarantees", label: "BF Mgr", group: "Finance", tip: "Add, edit, convert and release bank guarantees" },
  { key: "can_view_investments", label: "Inv", group: "Finance", tip: "View the PSX stock portfolio" },
  { key: "can_edit_investments", label: "Inv Edit", group: "Finance", tip: "Add/edit/delete holdings and refresh prices" },

  // ── Receivables ─────────────────────────────────────────────
  { key: "can_view_receivables", label: "View", group: "Recv.", tip: "View receivable bills and stages" },
  { key: "can_edit_receivables", label: "Edit", group: "Recv.", tip: "Move bills, mark collected, add new" },

  // ── Tasks ────────────────────────────────────────────────────
  { key: "can_see_all_tasks", label: "All Tasks", group: "Tasks", tip: "See all tasks vs only own" },
  { key: "can_create_tasks", label: "Create", group: "Tasks", tip: "Create and assign tasks to others" },
  { key: "can_review_tasks", label: "Review", group: "Tasks", tip: "Edit due dates, close, reassign" },
  { key: "can_manage_recurring_tasks", label: "Recur", group: "Tasks", tip: "Manage recurring task templates" },
  { key: "can_manage_calendar", label: "Cal", group: "Tasks", tip: "Approve/reject calendar requests" },
  { key: "can_see_all_minutes", label: "Mins", group: "Tasks", tip: "See all meeting minutes vs only own" },
  { key: "can_manage_meetings", label: "Meetings", group: "Tasks", tip: "Create meetings, upload minutes, manage attendees" },

  // ── Departments ──────────────────────────────────────────────
  { key: "can_view_dept_ops", label: "Ops", group: "Depts", tip: "Access the Unze Trading Ops department dashboard" },
  { key: "can_view_dept_hr", label: "HR", group: "Depts", tip: "Access the HR department dashboard" },
  { key: "can_view_dept_audit", label: "Audit", group: "Depts", tip: "Access the Audit department dashboard" },
  { key: "can_view_dept_admin", label: "Admin", group: "Depts", tip: "Access the Admin department dashboard" },
  { key: "can_view_dept_it", label: "IT", group: "Depts", tip: "Access the IT department dashboard" },
  { key: "can_view_dept_tax", label: "Tax", group: "Depts", tip: "Access the Tax Notices department dashboard" },
  { key: "can_view_dept_tax_accounts", label: "A&R", group: "Depts", tip: "Access Accounts & Returns page" },

  // ── Tax Management ───────────────────────────────────────────
  { key: "can_manage_tax_notices", label: "Notices", group: "Tax Mgmt", tip: "Add, edit, delete and manage tax notices" },
  { key: "can_manage_tax_schedule", label: "Schedule", group: "Tax Mgmt", tip: "Update the tax accounts schedule and return filings" },

  // ── Production ───────────────────────────────────────────────
  { key: "can_access_daily_entry", label: "Entry", group: "Prod.", tip: "Log daily production, dispatch, breakage" },
  { key: "can_view_stock", label: "Stock", group: "Prod.", tip: "View stock levels and inventory" },
  { key: "can_manage_stock", label: "POs", group: "Prod.", tip: "Create, approve and manage purchase orders" },
  { key: "can_edit_operations_targets", label: "Targets", group: "Prod.", tip: "Set monthly production/dispatch targets" },

  // ── Members ──────────────────────────────────────────────────
  { key: "can_view_members", label: "View", group: "Members", tip: "Access the members management page" },
  { key: "can_add_members", label: "Add", group: "Members", tip: "Create new team members" },
  { key: "can_edit_members", label: "Edit", group: "Members", tip: "Edit member profiles, roles, departments" },
  { key: "can_delete_members", label: "Del", group: "Members", tip: "Remove members from the system" },
  { key: "can_reset_passwords", label: "PW", group: "Members", tip: "Reset/set passwords for other users" },

  // ── Admin ────────────────────────────────────────────────────
  { key: "can_view_audit_log", label: "Log", group: "Admin", tip: "View the system audit trail" },
  { key: "can_view_exceptions", label: "Exc", group: "Admin", tip: "View escalation/exception alerts" },
  { key: "can_import_export", label: "I/O", group: "Admin", tip: "Import/export member data via CSV" },
] as const;

type ColDef = (typeof PERM_COLUMNS)[number];

const GROUPS = [...new Set(PERM_COLUMNS.map((c) => c.group))];

const GROUP_COLOURS: Record<string, string> = {
  Dashboards: "#6366f1",
  Finance: COLOURS.GREEN,
  "Recv.": COLOURS.AMBER,
  Tasks: COLOURS.BLUE,
  Depts: COLOURS.PURPLE,
  Members: COLOURS.TEAL,
  Admin: COLOURS.NAVY,
  "Prod.": "#ea580c",
  "Tax Mgmt": COLOURS.AMBER,
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
    case "can_view_operations_dashboard": return admin || dept === "Unze Trading Ops";
    case "can_view_pa_dashboard": return admin || exec;
    case "can_view_guarantees": return admin || (manager && (dept === "Finance" || dept === "Unze Trading Ops"));
    case "can_manage_guarantees": return admin || (manager && dept === "Finance");
    case "can_view_finance": return admin || (manager && dept === "Finance");
    case "can_edit_finance": return admin || (manager && dept === "Finance");
    case "finance_company_scope": {
      if (admin || !m.company) return "both";
      if (m.company?.startsWith("Unze Trading")) return "UTPL";
      if (m.company?.startsWith("Imperial")) return "IFPL";
      return "both";
    }
    case "can_view_receivables": return admin || (manager && (dept === "Finance" || dept === "Unze Trading Ops"));
    case "can_edit_receivables": return admin || dept === "Unze Trading Ops";
    case "can_see_all_tasks": return admin || exec;
    case "can_create_tasks": return admin || exec || (manager && dept === "Unze Trading Ops");
    case "can_review_tasks": return admin || exec;
    case "can_manage_recurring_tasks": return admin || exec;
    case "can_manage_calendar": return admin || exec;
    case "can_see_all_minutes": return admin || exec;
    case "can_manage_meetings": return admin || exec;
    case "can_view_dept_ops": return admin || dept === "Unze Trading Ops";
    case "can_view_dept_hr": return admin || dept === "HR";
    case "can_view_dept_tax": return admin || dept === "Tax" || (manager && dept === "Finance");
    case "can_view_dept_audit": return admin || dept === "Audit";
    case "can_view_dept_admin": return admin || dept === "Admin";
    case "can_view_dept_it": return admin || dept === "IT";
    case "can_view_members": return admin || exec;
    case "can_add_members": return admin || exec;
    case "can_edit_members": return admin || exec;
    case "can_delete_members": return admin || exec;
    case "can_reset_passwords": return admin || exec;
    case "can_view_audit_log": return admin || exec;
    case "can_view_exceptions": return admin || exec;
    case "can_import_export": return admin || exec;
    case "can_manage_tax_notices": return admin;
    case "can_manage_tax_schedule": return admin;
    case "can_view_dept_tax_accounts": return !exec;
    case "can_view_stock": return admin || dept === "Unze Trading Ops";
    case "can_manage_stock": return admin || (manager && dept === "Unze Trading Ops");
    case "can_access_daily_entry": return admin || dept === "Unze Trading Ops";
    case "can_edit_operations_targets": return admin || exec || lc(m.email) === OPS_HOD_EMAIL;
    case "can_view_investments": return lc(m.email) === "k.saleem@unzegroup.com" || lc(m.email) === "khuram1901@gmail.com" || exec;
    case "can_edit_investments": return lc(m.email) === "k.saleem@unzegroup.com" || lc(m.email) === "khuram1901@gmail.com";
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
  const toast = useToast();
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
      if (error) { toast.show("Error: " + error.message, "error"); setSaving(null); return; }
    } else {
      const { error } = await supabase.from("member_permissions")
        .insert({ member_id: memberId, [col.key]: newValue });
      if (error) { toast.show("Error: " + error.message, "error"); setSaving(null); return; }
    }
    setPerms((prev) => ({
      ...prev,
      [memberId]: { ...prev[memberId], [col.key]: newValue },
    }));
    setSaving(null);
  }

  const rows = [...members].sort((a, b) => fullName(a).localeCompare(fullName(b)));

  const isProtected = (m: MatrixMember) => PROTECTED_EMAILS.includes(lc(m.email));
  const isSelf = (m: MatrixMember) => lc(m.email) === lc(myEmail);

  return (
    <div style={{ marginTop: "12px" }}>
      {toast.element}
      <div onClick={() => setOpen(!open)} style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer",
        border: `1px solid ${COLOURS.BORDER}`, borderRadius: open ? "8px 8px 0 0" : "8px", padding: "14px 18px",
        backgroundColor: open ? COLOURS.NAVY : "var(--bg-card, #ffffff)",
        transition: "background-color 0.2s",
      }}>
        <div>
          <div style={{ fontSize: "17px", fontWeight: 700, color: open ? "white" : COLOURS.NAVY }}>Access Control Matrix</div>
          <div style={{ fontSize: "14px", color: open ? "rgba(255,255,255,0.7)" : COLOURS.SLATE }}>
            Toggle individual permissions per team member
          </div>
        </div>
        <span style={{ color: open ? "white" : COLOURS.SLATE, fontSize: "16px" }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{
          border: `1px solid ${COLOURS.BORDER}`, borderTop: "none", borderRadius: "0 0 8px 8px",
          backgroundColor: "var(--bg-card, #ffffff)",
        }}>
          {!loaded ? (
            <div style={{ padding: "40px", textAlign: "center", color: COLOURS.SLATE }}>Loading permissions...</div>
          ) : (
            <>
              {/* Legend */}
              <div style={{ padding: "8px 12px", display: "flex", gap: "12px", flexWrap: "wrap", fontSize: "14px", color: COLOURS.SLATE, borderBottom: `1px solid ${COLOURS.BORDER}`, alignItems: "center" }}>
                <span style={{ fontWeight: 700 }}>Legend:</span>
                <span style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                  <span style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: COLOURS.GREEN, display: "inline-block" }} /> On
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                  <span style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: "var(--border-color, #e2e8f0)", border: "1px solid #cbd5e1", display: "inline-block" }} /> Off
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                  <span style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: COLOURS.GREEN, opacity: 0.35, display: "inline-block" }} /> Default
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                  <span style={{ width: 14, height: 14, borderRadius: 3, border: "2px solid #111827", display: "inline-block" }} /> Locked
                </span>
              </div>

              {/* Scrollable table container */}
              <div style={{
                overflow: "auto",
                maxHeight: "calc(100vh - 220px)",
              }}>
                <table style={{
                  width: "100%",
                  borderCollapse: "separate",
                  borderSpacing: 0,
                  tableLayout: "fixed",
                }}>
                  <colgroup>
                    <col style={{ width: isMobile ? 130 : 160 }} />
                    <col style={{ width: 56 }} />
                    {PERM_COLUMNS.map((col) => (
                      <col key={col.key} style={{ width: col.key === "finance_company_scope" ? 64 : Math.max(52, col.label.length * 9 + 18) }} />
                    ))}
                  </colgroup>
                  <thead>
                    {/* Group header row */}
                    <tr>
                      <th style={{
                        ...stickyTh, left: 0, zIndex: 14, width: isMobile ? 130 : 160,
                        backgroundColor: "var(--border-light, #f1f5f9)", borderBottom: "none",
                      }} />
                      <th style={{
                        ...stickyTh, left: isMobile ? 130 : 160, zIndex: 14, width: 56,
                        backgroundColor: "var(--border-light, #f1f5f9)", borderBottom: "none",
                      }} />
                      {GROUPS.map((g) => {
                        const cols = PERM_COLUMNS.filter((c) => c.group === g);
                        return (
                          <th key={g} colSpan={cols.length} style={{
                            position: "sticky", top: 0, zIndex: 10,
                            padding: "6px 2px",
                            backgroundColor: GROUP_COLOURS[g] || COLOURS.SLATE,
                            color: "white",
                            textAlign: "center",
                            fontSize: "11px",
                            fontWeight: 700,
                            letterSpacing: "0.3px",
                            borderLeft: "2px solid var(--bg-card, #ffffff)",
                            borderBottom: "none",
                          }}>{g}</th>
                        );
                      })}
                    </tr>
                    {/* Column header row */}
                    <tr>
                      <th style={{
                        ...stickyTh, top: 28, left: 0, zIndex: 14, width: isMobile ? 130 : 160,
                        backgroundColor: "var(--border-light, #f1f5f9)", textAlign: "left",
                        fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY,
                      }}>Member</th>
                      <th style={{
                        ...stickyTh, top: 28, left: isMobile ? 130 : 160, zIndex: 14, width: 56,
                        backgroundColor: "var(--border-light, #f1f5f9)", textAlign: "center",
                        fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY,
                      }}>Role</th>
                      {PERM_COLUMNS.map((col, i) => {
                        const isGroupStart = i === 0 || PERM_COLUMNS[i - 1].group !== col.group;
                        return (
                          <th key={col.key} title={col.tip} style={{
                            position: "sticky", top: 28, zIndex: 10,
                            padding: "6px 4px",
                            textAlign: "center",
                            cursor: "help",
                            fontSize: "12px",
                            fontWeight: 700,
                            color: COLOURS.SLATE,
                            backgroundColor: "var(--border-light, #f1f5f9)",
                            borderBottom: `2px solid ${COLOURS.BORDER}`,
                            borderLeft: isGroupStart ? `2px solid ${COLOURS.BORDER}` : undefined,
                            whiteSpace: "nowrap",
                            overflow: "visible",
                          }}>
                            {col.label}
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
                        <tr key={m.id} style={{ backgroundColor: locked ? "var(--bg-card-hover, #f8fafc)" : "var(--bg-card, #ffffff)" }}>
                          <td style={{
                            ...stickyTd, left: 0, zIndex: 3,
                            backgroundColor: locked ? "var(--bg-card-hover, #f8fafc)" : "var(--bg-card, #ffffff)",
                            borderRight: `1px solid ${COLOURS.BORDER}`,
                            borderBottom: `1px solid ${COLOURS.BORDER}`,
                            padding: "4px 6px",
                          }}>
                            <div style={{ fontWeight: 600, color: COLOURS.NAVY, fontSize: "14px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fullName(m)}</div>
                          </td>
                          <td style={{
                            ...stickyTd, left: isMobile ? 130 : 160, zIndex: 3,
                            backgroundColor: locked ? "var(--bg-card-hover, #f8fafc)" : "var(--bg-card, #ffffff)",
                            borderRight: `1px solid ${COLOURS.BORDER}`,
                            borderBottom: `1px solid ${COLOURS.BORDER}`,
                            textAlign: "center", padding: "4px 2px",
                          }}>
                            <span style={{
                              display: "inline-block", fontSize: "10px", fontWeight: 700, color: "white",
                              backgroundColor: roleBadgeColor(m), borderRadius: "6px", padding: "2px 6px",
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
                                return <td key={col.key} style={{ ...cellStyle, borderLeft: isGroupStart ? `2px solid ${COLOURS.BORDER}` : undefined, color: "#cbd5e1" }}>—</td>;
                              }
                              return (
                                <td key={col.key} style={{ ...cellStyle, borderLeft: isGroupStart ? `2px solid ${COLOURS.BORDER}` : undefined }}>
                                  <select
                                    value={(eff as string) || "both"}
                                    onChange={(e) => togglePerm(m.id, col, e.target.value)}
                                    disabled={!canToggle || isLoading}
                                    style={{
                                      fontSize: "11px", padding: "2px 3px", borderRadius: 3,
                                      border: `1px solid ${COLOURS.BORDER}`, cursor: canToggle ? "pointer" : "not-allowed",
                                      backgroundColor: hasOverride ? "#dbeafe" : "var(--bg-card, #ffffff)",
                                      opacity: isLoading ? 0.5 : 1,
                                      width: "100%", maxWidth: 56,
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
                              <td key={col.key} style={{ ...cellStyle, borderLeft: isGroupStart ? `2px solid ${COLOURS.BORDER}` : undefined }}>
                                {locked ? (
                                  <div style={{
                                    width: 18, height: 18, margin: "0 auto",
                                    borderRadius: 4,
                                    border: "2px solid #111827",
                                    backgroundColor: on ? COLOURS.GREEN : "var(--border-color, #e2e8f0)",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                  }} title="Locked — Admin/CEO permissions cannot be changed">
                                    {on && <span style={{ color: "white", fontSize: 11, fontWeight: 700 }}>✓</span>}
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => {
                                      if (!canToggle) return;
                                      togglePerm(m.id, col, !on);
                                    }}
                                    disabled={isLoading || !canToggle}
                                    title={
                                      isLoading ? "Saving..." :
                                      !canToggle ? "Cannot modify your own permissions" :
                                      hasOverride ? `Override — click to toggle` :
                                      `Default: ${on ? "on" : "off"} — click to override`
                                    }
                                    style={{
                                      width: 18, height: 18, padding: 0, margin: "0 auto",
                                      borderRadius: 4, cursor: canToggle ? "pointer" : "not-allowed",
                                      border: hasOverride ? "2px solid #3b82f6" : "1px solid #cbd5e1",
                                      backgroundColor: on ? COLOURS.GREEN : "var(--border-color, #e2e8f0)",
                                      opacity: isLoading ? 0.3 : hasOverride ? 1 : 0.55,
                                      display: "flex", alignItems: "center", justifyContent: "center",
                                      transition: "all 0.15s",
                                    }}
                                  >
                                    {on && <span style={{ color: "white", fontSize: 11, fontWeight: 700 }}>✓</span>}
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
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const stickyTh: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 10,
  padding: "6px 4px",
  borderBottom: `2px solid ${COLOURS.BORDER}`,
};

const stickyTd: React.CSSProperties = {
  position: "sticky",
  verticalAlign: "middle",
};

const cellStyle: React.CSSProperties = {
  padding: "3px 1px",
  textAlign: "center",
  verticalAlign: "middle",
  borderBottom: `1px solid ${COLOURS.BORDER}`,
};
