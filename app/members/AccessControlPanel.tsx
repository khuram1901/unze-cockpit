"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { COLOURS, useToast } from "../lib/SharedUI";
import { MATRIX_LOCKED_EMAILS, isAdminTier, type UserCtx } from "../lib/permissions";
import { PAGE_REGISTRY, GROUP_ORDER } from "../lib/pageRegistry";
import { WIDGET_REGISTRY } from "../lib/widgetRegistry";
import { PERM_COLUMNS, roleDefault, type MatrixMember, type ColDef } from "./AccessMatrix";

// One thumb rule, one flow, per Khuram (16 Jul 2026): pick a member, decide
// which PAGES they can reach, then — nested under each page that's on —
// decide which individual WIDGETS on that page they see. Page access still
// lives in member_permissions (same columns/RLS as the full matrix in
// AccessMatrix.tsx); widget visibility still lives in
// member_widget_overrides (supabase/136_widget_visibility.sql). This panel
// is just the single coherent UI over both, replacing what used to be two
// disconnected panels that each asked "which member?" separately.
//
// The PA's page (/pa) is deliberately left out of the page list here — per
// Khuram, she's the only person in that role, so it isn't worth generalising.

type TogglePage = { permKey: string; title: string; group: string };

// Executive Dashboard isn't in PAGE_REGISTRY (it's an always-shown sidebar
// link, not a permission-gated card — see SidebarLayout's alwaysItems) but
// it absolutely is still gated by a real permission underneath
// (canViewExecutiveDashboard), so it belongs in this list same as any page.
const TOGGLEABLE_PAGES: TogglePage[] = [
  { permKey: "can_view_executive_dashboard", title: "Executive Dashboard", group: "Overview" },
  ...PAGE_REGISTRY.filter((c) => !c.permKey.startsWith("_") && c.permKey !== "can_view_pa_dashboard")
    .map((c) => ({ permKey: c.permKey, title: c.title, group: c.group })),
];

// Widget registry "page" groups that nest under a given toggleable page's
// title. Finance Panels render physically inside the Executive Dashboard,
// so they nest there rather than needing their own page toggle.
const WIDGET_GROUP_TO_PAGE: Record<string, string> = {
  "Executive Dashboard": "Executive Dashboard",
  "Finance Panels": "Executive Dashboard",
  "Operations Dashboard": "Operations Dashboard",
};

function lc(s: string | null | undefined) { return (s || "").toLowerCase(); }

function fullName(m: MatrixMember) {
  return `${m.first_name || ""} ${m.last_name || ""}`.trim() || m.name || m.email || "Unnamed";
}

function findCol(permKey: string): ColDef | undefined {
  return PERM_COLUMNS.find((c) => c.key === permKey);
}

export default function AccessControlPanel({ members, isMobile }: { members: MatrixMember[]; isMobile: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string>("");
  const [pagePerms, setPagePerms] = useState<Record<string, boolean | string | null>>({});
  const [widgetOverrides, setWidgetOverrides] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [expandedPage, setExpandedPage] = useState<string | null>(null);

  const rows = [...members].sort((a, b) => fullName(a).localeCompare(fullName(b)));
  const selectedMember = rows.find((m) => m.id === selectedId);

  const loadForMember = useCallback(async (memberId: string) => {
    setLoading(true);
    const [{ data: permRow }, { data: widgetRows }] = await Promise.all([
      supabase.from("member_permissions").select("*").eq("member_id", memberId).maybeSingle(),
      supabase.from("member_widget_overrides").select("widget_key, visible").eq("member_id", memberId),
    ]);
    setPagePerms((permRow as Record<string, boolean | string | null>) || {});
    const wMap: Record<string, boolean> = {};
    for (const r of widgetRows || []) wMap[r.widget_key] = r.visible;
    setWidgetOverrides(wMap);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (selectedId) loadForMember(selectedId);
    else { setPagePerms({}); setWidgetOverrides({}); }
  }, [selectedId, loadForMember]);

  function pageIsOn(page: TogglePage): boolean {
    if (!selectedMember) return false;
    const override = pagePerms[page.permKey];
    if (override !== null && override !== undefined) return override === true;
    const col = findCol(page.permKey);
    if (!col) return isAdminTier({ email: selectedMember.email, role: selectedMember.role, department: selectedMember.department, company: selectedMember.company } as UserCtx);
    return roleDefault(col, selectedMember) === true;
  }

  async function togglePage(page: TogglePage, value: "default" | "on" | "off") {
    if (!selectedId) return;
    setSavingKey(page.permKey);
    const newValue = value === "default" ? null : value === "on";
    const existing = Object.keys(pagePerms).length > 0;
    const { error } = existing
      ? await supabase.from("member_permissions").update({ [page.permKey]: newValue, updated_at: new Date().toISOString() }).eq("member_id", selectedId)
      : await supabase.from("member_permissions").insert({ member_id: selectedId, [page.permKey]: newValue });
    if (error) { toast.show("Error: " + error.message, "error"); setSavingKey(null); return; }
    setPagePerms((prev) => ({ ...prev, [page.permKey]: newValue }));
    setSavingKey(null);
  }

  async function toggleWidget(widgetKey: string, value: "default" | "show" | "hide") {
    if (!selectedId) return;
    setSavingKey(widgetKey);
    if (value === "default") {
      const { error } = await supabase.from("member_widget_overrides").delete().eq("member_id", selectedId).eq("widget_key", widgetKey);
      if (error) { toast.show("Error: " + error.message, "error"); setSavingKey(null); return; }
      setWidgetOverrides((prev) => { const next = { ...prev }; delete next[widgetKey]; return next; });
    } else {
      const visible = value === "show";
      const { error } = await supabase.from("member_widget_overrides")
        .upsert({ member_id: selectedId, widget_key: widgetKey, visible, updated_at: new Date().toISOString() }, { onConflict: "member_id,widget_key" });
      if (error) { toast.show("Error: " + error.message, "error"); setSavingKey(null); return; }
      setWidgetOverrides((prev) => ({ ...prev, [widgetKey]: visible }));
    }
    setSavingKey(null);
  }

  const isProtected = selectedMember ? MATRIX_LOCKED_EMAILS.includes(lc(selectedMember.email)) : false;

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
            Pick a member → which pages they can reach → which pieces of each page they see
          </div>
        </div>
        <span style={{ fontSize: "20px", color: open ? "white" : COLOURS.SLATE }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: "none", borderRadius: "0 0 8px 8px", padding: "18px" }}>
          <div style={{ marginBottom: "18px" }}>
            <label style={{ fontSize: "12.5px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "6px" }}>
              Team member
            </label>
            <select
              value={selectedId}
              onChange={(e) => { setSelectedId(e.target.value); setExpandedPage(null); }}
              style={{
                width: isMobile ? "100%" : "320px", padding: "9px 12px", fontSize: "14px",
                border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "var(--bg-card, #fff)",
                color: COLOURS.NAVY,
              }}
            >
              <option value="">Select a member…</option>
              {rows.map((m) => (
                <option key={m.id} value={m.id}>{fullName(m)} — {m.role}</option>
              ))}
            </select>
          </div>

          {!selectedId && (
            <div style={{ fontSize: "13.5px", color: COLOURS.SLATE, fontStyle: "italic" }}>
              Pick a member above to see and change what they can reach.
            </div>
          )}

          {selectedId && isProtected && (
            <div style={{ fontSize: "13.5px", color: COLOURS.SLATE, fontStyle: "italic" }}>
              This account is fully locked — everything, unconditionally, no toggle can change it.
            </div>
          )}

          {selectedId && !isProtected && loading && (
            <div style={{ fontSize: "13.5px", color: COLOURS.SLATE }}>Loading…</div>
          )}

          {selectedId && !isProtected && !loading && selectedMember && groupsPresent.map((group) => (
            <div key={group} style={{ marginBottom: "18px" }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {group}
              </div>
              <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", overflow: "hidden" }}>
                {TOGGLEABLE_PAGES.filter((p) => p.group === group).map((page, i, arr) => {
                  const override = pagePerms[page.permKey];
                  const current: "default" | "on" | "off" = override === true ? "on" : override === false ? "off" : "default";
                  const isOn = pageIsOn(page);
                  const pageWidgets = WIDGET_REGISTRY.filter((w) => WIDGET_GROUP_TO_PAGE[w.page] === page.title);
                  const isExpanded = expandedPage === page.permKey;

                  return (
                    <div key={page.permKey} style={{ borderBottom: i < arr.length - 1 ? `1px solid ${COLOURS.BORDER}` : "none" }}>
                      <div style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "10px 14px", opacity: savingKey === page.permKey ? 0.5 : 1,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                          {pageWidgets.length > 0 && isOn && (
                            <button
                              onClick={() => setExpandedPage(isExpanded ? null : page.permKey)}
                              style={{ background: "none", border: "none", cursor: "pointer", fontSize: "12px", color: COLOURS.SLATE, padding: 0, flexShrink: 0 }}
                            >
                              {isExpanded ? "▼" : "▶"}
                            </button>
                          )}
                          <div style={{ fontSize: "13.5px", fontWeight: 500, color: COLOURS.NAVY }}>{page.title}</div>
                          {pageWidgets.length > 0 && (
                            <span style={{ fontSize: "11px", color: COLOURS.SLATE }}>({pageWidgets.length} widgets)</span>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                          {(["default", "on", "off"] as const).map((opt) => (
                            <button
                              key={opt}
                              onClick={() => togglePage(page, opt)}
                              disabled={savingKey === page.permKey}
                              style={{
                                fontSize: "11.5px", fontWeight: 600, padding: "5px 10px", borderRadius: "6px",
                                border: `1px solid ${current === opt ? COLOURS.NAVY : COLOURS.BORDER}`,
                                backgroundColor: current === opt ? COLOURS.NAVY : "transparent",
                                color: current === opt ? "white" : COLOURS.SLATE,
                                cursor: savingKey === page.permKey ? "default" : "pointer",
                                textTransform: "capitalize",
                              }}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>

                      {isExpanded && isOn && pageWidgets.length > 0 && (
                        <div style={{ backgroundColor: "var(--bg-card-alt, #F8FAFC)", padding: "8px 14px 12px 34px" }}>
                          {pageWidgets.map((w) => {
                            const widgetKey = w.perCompany ? null : w.key;
                            const current2: "default" | "show" | "hide" = widgetKey
                              ? (widgetOverrides[widgetKey] === true ? "show" : widgetOverrides[widgetKey] === false ? "hide" : "default")
                              : "default";
                            return (
                              <div key={w.key} style={{
                                display: "flex", justifyContent: "space-between", alignItems: "center",
                                padding: "6px 0",
                              }}>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontSize: "13px", color: COLOURS.NAVY }}>{w.label}</div>
                                  {w.tip && <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>{w.tip}</div>}
                                  {w.perCompany && <div style={{ fontSize: "11px", color: COLOURS.SLATE, fontStyle: "italic" }}>Per-company — set in Dashboard Widgets below</div>}
                                </div>
                                {!w.perCompany && (
                                  <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                                    {(["default", "show", "hide"] as const).map((opt) => (
                                      <button
                                        key={opt}
                                        onClick={() => toggleWidget(w.key, opt)}
                                        disabled={savingKey === w.key}
                                        style={{
                                          fontSize: "11px", fontWeight: 600, padding: "4px 9px", borderRadius: "6px",
                                          border: `1px solid ${current2 === opt ? COLOURS.NAVY : COLOURS.BORDER}`,
                                          backgroundColor: current2 === opt ? COLOURS.NAVY : "transparent",
                                          color: current2 === opt ? "white" : COLOURS.SLATE,
                                          cursor: savingKey === w.key ? "default" : "pointer",
                                          textTransform: "capitalize",
                                        }}
                                      >
                                        {opt}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
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
}
