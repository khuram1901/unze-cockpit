"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { COLOURS, useToast } from "../lib/SharedUI";
import { WIDGET_REGISTRY, WIDGET_PAGES } from "../lib/widgetRegistry";
import type { MatrixMember } from "./AccessMatrix";

// Per-member, per-widget visibility — one level below the Access Matrix's
// page-level toggles. "Default" means no row exists in
// member_widget_overrides for this member+widget, so the widget's own
// built-in default applies (see widgetVisible() in lib/permissions.ts).
// "Show"/"Hide" write an explicit override row; picking "Default" again
// deletes the row rather than storing it, keeping the table sparse.

function fullName(m: MatrixMember) {
  return `${m.first_name || ""} ${m.last_name || ""}`.trim() || m.name || m.email || "Unnamed";
}

export default function WidgetVisibilityPanel({ members, isMobile }: { members: MatrixMember[]; isMobile: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

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
          <div style={{ fontSize: "17px", fontWeight: 700, color: open ? "white" : COLOURS.NAVY }}>Dashboard Widgets</div>
          <div style={{ fontSize: "14px", color: open ? "rgba(255,255,255,0.7)" : COLOURS.SLATE }}>
            Turn individual dashboard sections on or off per person
          </div>
        </div>
        <span style={{ fontSize: "20px", color: open ? "white" : COLOURS.SLATE }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: "none", borderRadius: "0 0 8px 8px", padding: "18px" }}>
          <div style={{ marginBottom: "16px" }}>
            <label style={{ fontSize: "12.5px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "6px" }}>
              Team member
            </label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
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
              Pick a member above to see and change what they see on each dashboard.
            </div>
          )}

          {selectedId && loading && (
            <div style={{ fontSize: "13.5px", color: COLOURS.SLATE }}>Loading…</div>
          )}

          {selectedId && !loading && selectedMember && WIDGET_PAGES.map((page) => (
            <div key={page} style={{ marginBottom: "20px" }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {page}
              </div>
              <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", overflow: "hidden" }}>
                {WIDGET_REGISTRY.filter((w) => w.page === page).map((w, i, arr) => {
                  const current: "default" | "show" | "hide" =
                    overrides[w.key] === true ? "show" : overrides[w.key] === false ? "hide" : "default";
                  return (
                    <div key={w.key} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "10px 14px", borderBottom: i < arr.length - 1 ? `1px solid ${COLOURS.BORDER}` : "none",
                      opacity: saving === w.key ? 0.5 : 1,
                    }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: "13.5px", fontWeight: 500, color: COLOURS.NAVY }}>{w.label}</div>
                        {w.tip && <div style={{ fontSize: "11.5px", color: COLOURS.SLATE, marginTop: "1px" }}>{w.tip}</div>}
                      </div>
                      <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                        {(["default", "show", "hide"] as const).map((opt) => (
                          <button
                            key={opt}
                            onClick={() => setWidget(w.key, opt)}
                            disabled={saving === w.key}
                            style={{
                              fontSize: "11.5px", fontWeight: 600, padding: "5px 10px", borderRadius: "6px",
                              border: `1px solid ${current === opt ? COLOURS.NAVY : COLOURS.BORDER}`,
                              backgroundColor: current === opt ? COLOURS.NAVY : "transparent",
                              color: current === opt ? "white" : COLOURS.SLATE,
                              cursor: saving === w.key ? "default" : "pointer",
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
