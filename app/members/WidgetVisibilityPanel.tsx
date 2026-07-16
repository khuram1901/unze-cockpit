"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { COLOURS, useToast } from "../lib/SharedUI";
import { WIDGET_REGISTRY } from "../lib/widgetRegistry";
import { FINANCE_COMPANIES } from "../lib/constants";
import type { MatrixMember } from "./AccessMatrix";

// Per-company widget visibility — the simple (one-per-page) widgets are
// handled inline in AccessControlPanel.tsx now, nested under their page.
// This panel exists specifically for the perCompany:true entries in
// widgetRegistry.ts (Cash in Hand, PDC Outstanding, etc.), which need one
// toggle PER company rather than one toggle overall — reading from
// FINANCE_COMPANIES (lib/constants.ts) so a newly added company's finance
// pipeline automatically gets a row here with no code change.

function fullName(m: MatrixMember) {
  return `${m.first_name || ""} ${m.last_name || ""}`.trim() || m.name || m.email || "Unnamed";
}

const PER_COMPANY_WIDGETS = WIDGET_REGISTRY.filter((w) => w.perCompany);

export default function WidgetVisibilityPanel({ members, isMobile }: { members: MatrixMember[]; isMobile: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(FINANCE_COMPANIES[0]?.id || "");

  const rows = [...members].sort((a, b) => fullName(a).localeCompare(fullName(b)));

  const loadOverrides = useCallback(async (memberId: string) => {
    setLoading(true);
    const { data } = await supabase
      .from("member_widget_overrides").select("widget_key, visible").eq("member_id", memberId);
    const map: Record<string, boolean> = {};
    for (const r of data || []) map[r.widget_key] = r.visible;
    setOverrides(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (selectedId) loadOverrides(selectedId);
    else setOverrides({});
  }, [selectedId, loadOverrides]);

  async function setWidget(widgetKey: string, value: "default" | "show" | "hide") {
    if (!selectedId) return;
    setSaving(widgetKey);
    if (value === "default") {
      const { error } = await supabase.from("member_widget_overrides")
        .delete().eq("member_id", selectedId).eq("widget_key", widgetKey);
      if (error) { toast.show("Error: " + error.message, "error"); setSaving(null); return; }
      setOverrides((prev) => { const next = { ...prev }; delete next[widgetKey]; return next; });
    } else {
      const visible = value === "show";
      const { error } = await supabase.from("member_widget_overrides")
        .upsert({ member_id: selectedId, widget_key: widgetKey, visible, updated_at: new Date().toISOString() }, { onConflict: "member_id,widget_key" });
      if (error) { toast.show("Error: " + error.message, "error"); setSaving(null); return; }
      setOverrides((prev) => ({ ...prev, [widgetKey]: visible }));
    }
    setSaving(null);
  }

  const selectedMember = rows.find((m) => m.id === selectedId);

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
          <div style={{ fontSize: "17px", fontWeight: 700, color: open ? "white" : COLOURS.NAVY }}>Finance Widgets (per company)</div>
          <div style={{ fontSize: "14px", color: open ? "rgba(255,255,255,0.7)" : COLOURS.SLATE }}>
            Cash in Hand, PDC, Forecast — set independently for each company&apos;s finance panel
          </div>
        </div>
        <span style={{ fontSize: "20px", color: open ? "white" : COLOURS.SLATE }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: "none", borderRadius: "0 0 8px 8px", padding: "18px" }}>
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "16px" }}>
            <div>
              <label style={{ fontSize: "12.5px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "6px" }}>
                Team member
              </label>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                style={{
                  width: isMobile ? "100%" : "280px", padding: "9px 12px", fontSize: "14px",
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
            <div>
              <label style={{ fontSize: "12.5px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "6px" }}>
                Company
              </label>
              <select
                value={selectedCompanyId}
                onChange={(e) => setSelectedCompanyId(e.target.value)}
                style={{
                  width: isMobile ? "100%" : "220px", padding: "9px 12px", fontSize: "14px",
                  border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "var(--bg-card, #fff)",
                  color: COLOURS.NAVY,
                }}
              >
                {FINANCE_COMPANIES.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          {!selectedId && (
            <div style={{ fontSize: "13.5px", color: COLOURS.SLATE, fontStyle: "italic" }}>
              Pick a member above to see and change their per-company finance widgets.
            </div>
          )}

          {selectedId && loading && (
            <div style={{ fontSize: "13.5px", color: COLOURS.SLATE }}>Loading…</div>
          )}

          {selectedId && !loading && selectedMember && selectedCompanyId && (
            <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", overflow: "hidden" }}>
              {PER_COMPANY_WIDGETS.map((w, i, arr) => {
                const widgetKey = `${w.key}.${selectedCompanyId}`;
                const current: "default" | "show" | "hide" =
                  overrides[widgetKey] === true ? "show" : overrides[widgetKey] === false ? "hide" : "default";
                return (
                  <div key={w.key} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 14px", borderBottom: i < arr.length - 1 ? `1px solid ${COLOURS.BORDER}` : "none",
                    opacity: saving === widgetKey ? 0.5 : 1,
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "13.5px", fontWeight: 500, color: COLOURS.NAVY }}>{w.label}</div>
                      {w.tip && <div style={{ fontSize: "11.5px", color: COLOURS.SLATE, marginTop: "1px" }}>{w.tip}</div>}
                    </div>
                    <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                      {(["default", "show", "hide"] as const).map((opt) => (
                        <button
                          key={opt}
                          onClick={() => setWidget(widgetKey, opt)}
                          disabled={saving === widgetKey}
                          style={{
                            fontSize: "11.5px", fontWeight: 600, padding: "5px 10px", borderRadius: "6px",
                            border: `1px solid ${current === opt ? COLOURS.NAVY : COLOURS.BORDER}`,
                            backgroundColor: current === opt ? COLOURS.NAVY : "transparent",
                            color: current === opt ? "white" : COLOURS.SLATE,
                            cursor: saving === widgetKey ? "default" : "pointer",
                            textTransform: "capitalize",
                          }}
                        >
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
      )}
    </div>
  );
}
