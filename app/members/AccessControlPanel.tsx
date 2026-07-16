"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { COLOURS, useToast } from "../lib/SharedUI";
import { MATRIX_LOCKED_EMAILS, isAdminTier, type UserCtx } from "../lib/permissions";
import { PAGE_REGISTRY, GROUP_COLOURS, GROUP_ORDER } from "../lib/pageRegistry";
import { WIDGET_REGISTRY, type WidgetDef } from "../lib/widgetRegistry";
import { PERM_COLUMNS, roleDefault, type MatrixMember, type ColDef } from "./AccessMatrix";

// 16 Jul 2026, per Khuram: the original version of this panel was a
// vertical drill-down — pick one member, expand a page, expand its
// widgets — which meant scrolling all the way down the screen to see or
// change anything. Redesigned to match the horizontal Full Permission
// Matrix below instead: every member is a row, every page (and its
// widgets, as narrower sub-columns) is a column, and you scroll sideways
// instead of down. Same "one thumb rule" data model underneath — page
// access still lives in member_permissions, widget visibility still
// lives in member_widget_overrides — only the layout changed.
//
// The PA's page (/pa) is deliberately left out of the column list — per
// Khuram, she's the only person in that role, so it isn't worth
// generalising.

type TogglePage = { permKey: string; title: string; group: string };

// permKeys that appear in PAGE_REGISTRY but aren't real member_permissions
// columns — SidebarLayout computes them on the fly from can_view_finance +
// finance_company_scope instead of storing them directly, so there's
// nothing to write to. Excluded here; replaced with a single real
// "Finance" toggle below (can_view_finance is a genuine column). Company
// scope (which of UTPL/IFPL that resolves to) is still set via the Scope
// selector in the Full Permission Matrix below.
const SYNTHETIC_PERM_KEYS = ["can_view_finance_utpl", "can_view_finance_ifpl"];

// Executive Dashboard isn't in PAGE_REGISTRY (it's an always-shown sidebar
// link, not a permission-gated card — see SidebarLayout's alwaysItems) but
// it absolutely is still gated by a real permission underneath
// (canViewExecutiveDashboard), so it belongs in this list same as any page.
const TOGGLEABLE_PAGES: TogglePage[] = [
  { permKey: "can_view_executive_dashboard", title: "Executive Dashboard", group: "Overview" },
  { permKey: "can_view_finance", title: "Finance (Unze Trading / Imperial)", group: "Finance" },
  ...PAGE_REGISTRY.filter((c) => !c.permKey.startsWith("_") && c.permKey !== "can_view_pa_dashboard" && !SYNTHETIC_PERM_KEYS.includes(c.permKey))
    .map((c) => ({ permKey: c.permKey, title: c.title, group: c.group })),
];

// Widget registry "page" groups that nest under a given toggleable page's
// title. Finance Panels render physically inside the Executive Dashboard,
// so they nest there rather than needing their own page column.
const WIDGET_GROUP_TO_PAGE: Record<string, string> = {
  "Executive Dashboard": "Executive Dashboard",
  "Finance Panels": "Executive Dashboard",
  "Operations Dashboard": "Operations Dashboard",
  "Admin": "Admin",
  "Audit": "Audit",
  "HR": "HR",
  "Tax Notices": "Tax Notices",
  "IT": "IT",
  "Bank Facilities": "Bank Facilities",
};

function lc(s: string | null | undefined) { return (s || "").toLowerCase(); }

function fullName(m: MatrixMember) {
  return `${m.first_name || ""} ${m.last_name || ""}`.trim() || m.name || m.email || "Unnamed";
}

function findCol(permKey: string): ColDef | undefined {
  return PERM_COLUMNS.find((c) => c.key === permKey);
}

function roleBadgeColor(m: MatrixMember): string {
  if (m.role === "Admin") return "#111827";
  if (m.role === "CEO") return COLOURS.BLUE;
  if (m.role === "Executive") return COLOURS.PURPLE;
  if (m.role === "Manager") return COLOURS.GREEN;
  return COLOURS.SLATE;
}

// One column-group per toggleable page: the page-access cell itself, plus
// one cell per non-perCompany widget registered under it. perCompany
// widgets (Cash in Hand, PDC Outstanding, etc.) stay in the "Finance
// Widgets (per company)" panel below — there are only 2 companies today
// but that count will grow, and multiplying every finance widget by every
// company would make this grid unreadable.
type GridCol =
  | { kind: "access"; page: TogglePage }
  | { kind: "widget"; page: TogglePage; widget: WidgetDef };

const COLUMN_GROUPS: { page: TogglePage; cols: GridCol[] }[] = TOGGLEABLE_PAGES.map((page) => {
  const widgets = WIDGET_REGISTRY.filter((w) => WIDGET_GROUP_TO_PAGE[w.page] === page.title && !w.perCompany);
  return {
    page,
    cols: [
      { kind: "access", page } as GridCol,
      ...widgets.map((widget) => ({ kind: "widget", page, widget } as GridCol)),
    ],
  };
});

// Three states per cell, cycled by clicking: Default (inherits the role's
// normal behaviour, whatever it computes to) → On/Show (explicit
// override) → Off/Hide (explicit override) → back to Default. Matches the
// Default/On/Off and Default/Show/Hide button trios from the old vertical
// layout — just compressed into one clickable cell instead of three
// buttons, since there isn't room for three buttons per cell at this
// column width.
type TriState = "default" | "on" | "off";

function nextState(s: TriState): TriState {
  return s === "default" ? "on" : s === "on" ? "off" : "default";
}

const MEMBER_COL_W = 180;
const ROLE_COL_W = 70;

export default function AccessControlPanel({ members, isMobile }: { members: MatrixMember[]; isMobile: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // 16 Jul 2026, per Khuram: the first version of this showed every page
  // and every widget as columns at once — 50+ columns, unreadable. This
  // version shows one page at a time via tabs, with only that page's
  // widgets as columns, so the table stays a handful of columns wide and
  // the text is legible without rotating it sideways.
  const [selectedPageKey, setSelectedPageKey] = useState<string>(TOGGLEABLE_PAGES[0].permKey);
  const [pagePerms, setPagePerms] = useState<Record<string, Record<string, boolean | string | null>>>({});
  const [widgetOverrides, setWidgetOverrides] = useState<Record<string, Record<string, boolean>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [myEmail, setMyEmail] = useState("");

  const loadAll = useCallback(async () => {
    const [{ data: permRows }, { data: widgetRows }] = await Promise.all([
      supabase.from("member_permissions").select("*"),
      supabase.from("member_widget_overrides").select("member_id, widget_key, visible"),
    ]);
    const pMap: Record<string, Record<string, boolean | string | null>> = {};
    for (const row of (permRows || []) as Record<string, boolean | string | null>[]) {
      pMap[row.member_id as string] = row;
    }
    setPagePerms(pMap);
    const wMap: Record<string, Record<string, boolean>> = {};
    for (const row of (widgetRows || []) as { member_id: string; widget_key: string; visible: boolean }[]) {
      if (!wMap[row.member_id]) wMap[row.member_id] = {};
      wMap[row.member_id][row.widget_key] = row.visible;
    }
    setWidgetOverrides(wMap);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (open && !loaded) {
      loadAll();
      supabase.auth.getUser().then(({ data }) => setMyEmail(data.user?.email || ""));
    }
  }, [open, loaded, loadAll]);

  const rows = [...members].sort((a, b) => fullName(a).localeCompare(fullName(b)));
  const isProtected = (m: MatrixMember) => MATRIX_LOCKED_EMAILS.includes(lc(m.email));
  const isSelf = (m: MatrixMember) => lc(m.email) === lc(myEmail);

  function pageOverride(memberId: string, page: TogglePage): boolean | null {
    const v = pagePerms[memberId]?.[page.permKey];
    if (v === true) return true;
    if (v === false) return false;
    return null;
  }

  function pageDefault(member: MatrixMember, page: TogglePage): boolean {
    const col = findCol(page.permKey);
    if (!col) return isAdminTier({ email: member.email, role: member.role, department: member.department, company: member.company } as UserCtx);
    return roleDefault(col, member) === true;
  }

  function widgetOverride(memberId: string, widgetKey: string): boolean | null {
    const v = widgetOverrides[memberId]?.[widgetKey];
    if (v === true) return true;
    if (v === false) return false;
    return null;
  }

  async function cyclePage(member: MatrixMember, page: TogglePage) {
    if (isProtected(member) || isSelf(member)) return;
    const cellKey = member.id + page.permKey;
    const override = pageOverride(member.id, page);
    const current: TriState = override === null ? "default" : override ? "on" : "off";
    const next = nextState(current);
    const newValue = next === "default" ? null : next === "on";
    setSaving(cellKey);
    const existing = Object.keys(pagePerms[member.id] || {}).length > 0;
    const { error } = existing
      ? await supabase.from("member_permissions").update({ [page.permKey]: newValue, updated_at: new Date().toISOString() }).eq("member_id", member.id)
      : await supabase.from("member_permissions").insert({ member_id: member.id, [page.permKey]: newValue });
    if (error) { toast.show("Error: " + error.message, "error"); setSaving(null); return; }
    setPagePerms((prev) => ({ ...prev, [member.id]: { ...prev[member.id], [page.permKey]: newValue } }));
    setSaving(null);
  }

  async function cycleWidget(member: MatrixMember, widget: WidgetDef) {
    if (isProtected(member) || isSelf(member)) return;
    const cellKey = member.id + widget.key;
    const override = widgetOverride(member.id, widget.key);
    const current: TriState = override === null ? "default" : override ? "on" : "off";
    const next = nextState(current);
    setSaving(cellKey);
    if (next === "default") {
      const { error } = await supabase.from("member_widget_overrides").delete().eq("member_id", member.id).eq("widget_key", widget.key);
      if (error) { toast.show("Error: " + error.message, "error"); setSaving(null); return; }
      setWidgetOverrides((prev) => {
        const memberMap = { ...(prev[member.id] || {}) };
        delete memberMap[widget.key];
        return { ...prev, [member.id]: memberMap };
      });
    } else {
      const visible = next === "on";
      const { error } = await supabase.from("member_widget_overrides")
        .upsert({ member_id: member.id, widget_key: widget.key, visible, updated_at: new Date().toISOString() }, { onConflict: "member_id,widget_key" });
      if (error) { toast.show("Error: " + error.message, "error"); setSaving(null); return; }
      setWidgetOverrides((prev) => ({ ...prev, [member.id]: { ...(prev[member.id] || {}), [widget.key]: visible } }));
    }
    setSaving(null);
  }

  const activeGroup = COLUMN_GROUPS.find((g) => g.page.permKey === selectedPageKey) || COLUMN_GROUPS[0];
  const activeCols = activeGroup.cols;
  const groupsPresent = GROUP_ORDER.filter((g) => TOGGLEABLE_PAGES.some((p) => p.group === g));

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
          <div style={{ fontSize: "17px", fontWeight: 700, color: open ? "white" : COLOURS.NAVY }}>Access Control</div>
          <div style={{ fontSize: "14px", color: open ? "rgba(255,255,255,0.7)" : COLOURS.SLATE }}>
            Pick a page below, then every member × that page&apos;s widgets in one short table.
          </div>
        </div>
        <span style={{ fontSize: "20px", color: open ? "white" : COLOURS.SLATE }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: "none", borderRadius: "0 0 8px 8px", backgroundColor: "var(--bg-card, #ffffff)", padding: "16px" }}>
          {!loaded ? (
            <div style={{ padding: "40px", textAlign: "center", color: COLOURS.SLATE }}>Loading…</div>
          ) : (
            <>
              {/* Page tabs, grouped */}
              <div style={{ marginBottom: "16px" }}>
                {groupsPresent.map((group) => (
                  <div key={group} style={{ marginBottom: "8px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>{group}</div>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {TOGGLEABLE_PAGES.filter((p) => p.group === group).map((page) => {
                        const active = page.permKey === selectedPageKey;
                        return (
                          <button
                            key={page.permKey}
                            onClick={() => setSelectedPageKey(page.permKey)}
                            style={{
                              fontSize: "12.5px", fontWeight: active ? 700 : 500, padding: "6px 12px",
                              borderRadius: "999px", cursor: "pointer",
                              border: `1px solid ${active ? (GROUP_COLOURS[group] || COLOURS.NAVY) : COLOURS.BORDER}`,
                              backgroundColor: active ? (GROUP_COLOURS[group] || COLOURS.NAVY) : "transparent",
                              color: active ? "white" : COLOURS.SLATE,
                            }}
                          >
                            {page.title}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Legend */}
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", fontSize: "12.5px", color: COLOURS.SLATE, alignItems: "center", marginBottom: "10px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                  <span style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: COLOURS.GREEN, display: "inline-block" }} /> On / Show
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                  <span style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: `var(--border-color, ${COLOURS.HAIRLINE})`, border: "1px solid #cbd5e1", display: "inline-block" }} /> Off / Hide
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                  <span style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: COLOURS.GREEN, opacity: 0.3, display: "inline-block" }} /> Default
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                  <span style={{ width: 14, height: 14, borderRadius: 3, border: "2px solid #111827", display: "inline-block" }} /> Locked
                </span>
                <span>Click a cell to cycle Default → On → Off → Default.</span>
              </div>

              <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", overflow: "auto", maxHeight: "calc(100vh - 320px)" }}>
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                  <colgroup>
                    <col style={{ width: isMobile ? 130 : MEMBER_COL_W }} />
                    <col style={{ width: ROLE_COL_W }} />
                    {activeCols.map((c, i) => <col key={i} style={{ minWidth: 110 }} />)}
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={{ ...stickyTh, left: 0, zIndex: 4, width: isMobile ? 130 : MEMBER_COL_W, backgroundColor: "var(--border-light, #f1f5f9)", textAlign: "left", fontSize: "13.5px", fontWeight: 700, color: COLOURS.NAVY }}>Member</th>
                      <th style={{ ...stickyTh, left: isMobile ? 130 : MEMBER_COL_W, zIndex: 4, width: ROLE_COL_W, backgroundColor: "var(--border-light, #f1f5f9)", textAlign: "center", fontSize: "12px", fontWeight: 700, color: COLOURS.NAVY }}>Role</th>
                      {activeCols.map((c, i) => {
                        const isAccess = c.kind === "access";
                        const label = isAccess ? "Access" : c.widget.label;
                        const tip = isAccess ? `Can this member reach ${c.page.title}?` : (c.widget.tip || c.widget.label);
                        return (
                          <th key={i} title={tip} style={{
                            ...stickyTh, textAlign: "center", cursor: "help",
                            fontSize: "12.5px", fontWeight: isAccess ? 700 : 500,
                            color: isAccess ? COLOURS.NAVY : COLOURS.SLATE,
                            backgroundColor: "var(--border-light, #f1f5f9)",
                            borderLeft: isAccess ? `2px solid ${COLOURS.BORDER}` : undefined,
                            padding: "8px 8px",
                          }}>
                            {label}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => {
                      const locked = isProtected(m);
                      const self = isSelf(m);
                      const canToggle = !locked && !self;

                      return (
                        <tr key={m.id} style={{ backgroundColor: locked ? "var(--bg-card-hover, #f8fafc)" : "var(--bg-card, #ffffff)" }}>
                          <td style={{
                            ...stickyTd, left: 0, zIndex: 2,
                            backgroundColor: locked ? "var(--bg-card-hover, #f8fafc)" : "var(--bg-card, #ffffff)",
                            borderRight: `1px solid ${COLOURS.BORDER}`, borderBottom: `1px solid ${COLOURS.BORDER}`,
                            padding: "8px 10px",
                          }}>
                            <div style={{ fontWeight: 600, color: COLOURS.NAVY, fontSize: "13.5px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={self ? "Cannot modify your own access" : locked ? "Locked — cannot be changed" : undefined}>
                              {fullName(m)}
                            </div>
                          </td>
                          <td style={{
                            ...stickyTd, left: isMobile ? 130 : MEMBER_COL_W, zIndex: 2,
                            backgroundColor: locked ? "var(--bg-card-hover, #f8fafc)" : "var(--bg-card, #ffffff)",
                            borderRight: `1px solid ${COLOURS.BORDER}`, borderBottom: `1px solid ${COLOURS.BORDER}`,
                            textAlign: "center", padding: "8px 4px",
                          }}>
                            <span style={{ display: "inline-block", fontSize: "10.5px", fontWeight: 700, color: "white", backgroundColor: roleBadgeColor(m), borderRadius: "6px", padding: "2px 6px" }}>
                              {m.role}
                            </span>
                          </td>
                          {activeCols.map((c, i) => {
                            const isAccess = c.kind === "access";
                            const borderLeft = isAccess ? `2px solid ${COLOURS.BORDER}` : undefined;

                            if (c.kind === "access") {
                              const cellKey = m.id + c.page.permKey;
                              const isLoading = saving === cellKey;
                              const override = pageOverride(m.id, c.page);
                              const overridden = override !== null;
                              const on = overridden ? override === true : pageDefault(m, c.page);
                              return (
                                <td key={i} style={{ ...cellStyle, borderLeft }}>
                                  {locked ? (
                                    <div style={{ width: 22, height: 22, margin: "0 auto", borderRadius: 5, border: "2px solid #111827", backgroundColor: on ? COLOURS.GREEN : `var(--border-color, ${COLOURS.HAIRLINE})`, display: "flex", alignItems: "center", justifyContent: "center" }} title="Locked — cannot be changed">
                                      {on && <span style={{ color: "white", fontSize: 12, fontWeight: 700 }}>✓</span>}
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => canToggle && cyclePage(m, c.page)}
                                      disabled={isLoading || !canToggle}
                                      title={isLoading ? "Saving…" : !canToggle ? "Cannot modify your own access" : overridden ? `Override: ${on ? "On" : "Off"} — click to cycle` : `Default: ${on ? "on" : "off"} — click to override`}
                                      style={{
                                        width: 22, height: 22, padding: 0, margin: "0 auto",
                                        borderRadius: 5, cursor: canToggle ? "pointer" : "not-allowed",
                                        border: overridden ? "2px solid #3b82f6" : "1px solid #cbd5e1",
                                        backgroundColor: on ? COLOURS.GREEN : `var(--border-color, ${COLOURS.HAIRLINE})`,
                                        opacity: isLoading ? 0.3 : overridden ? 1 : 0.4,
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        transition: "all 0.15s",
                                      }}
                                    >
                                      {on && <span style={{ color: "white", fontSize: 12, fontWeight: 700 }}>✓</span>}
                                    </button>
                                  )}
                                </td>
                              );
                            }

                            const cellKey = m.id + c.widget.key;
                            const isLoading = saving === cellKey;
                            const override = widgetOverride(m.id, c.widget.key);
                            const overridden = override !== null;
                            const on = override === true;
                            return (
                              <td key={i} style={{ ...cellStyle, borderLeft }}>
                                {locked ? (
                                  <div style={{ width: 20, height: 20, margin: "0 auto", borderRadius: 4, border: overridden ? "2px solid #3b82f6" : "1px solid #cbd5e1", backgroundColor: overridden ? (on ? COLOURS.GREEN : COLOURS.HAIRLINE) : "transparent" }} title="Locked — cannot be changed" />
                                ) : (
                                  <button
                                    onClick={() => canToggle && cycleWidget(m, c.widget)}
                                    disabled={isLoading || !canToggle}
                                    title={isLoading ? "Saving…" : !canToggle ? "Cannot modify your own access" : overridden ? `${on ? "Shown" : "Hidden"} (override) — click to cycle` : "Default — click to override"}
                                    style={{
                                      width: 20, height: 20, padding: 0, margin: "0 auto",
                                      borderRadius: 4, cursor: canToggle ? "pointer" : "not-allowed",
                                      border: overridden ? "2px solid #3b82f6" : "1px solid #cbd5e1",
                                      backgroundColor: overridden ? (on ? COLOURS.GREEN : `var(--border-color, ${COLOURS.HAIRLINE})`) : "transparent",
                                      opacity: isLoading ? 0.3 : 1,
                                      display: "flex", alignItems: "center", justifyContent: "center",
                                      transition: "all 0.15s",
                                    }}
                                  >
                                    {overridden && on && <span style={{ color: "white", fontSize: 11, fontWeight: 700 }}>✓</span>}
                                    {overridden && !on && <span style={{ color: COLOURS.SLATE, fontSize: 11, fontWeight: 700 }}>×</span>}
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
