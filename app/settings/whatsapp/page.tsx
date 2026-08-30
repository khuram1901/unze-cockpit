"use client";

// Settings → WhatsApp — map members' WhatsApp numbers and choose who may
// ISSUE tasks from WhatsApp. Anyone mapped can be an assignee; the toggle
// only controls creating. Admin-tier only (enforced server-side too).

import { useEffect, useState } from "react";
import AuthWrapper from "../../lib/AuthWrapper";
import { authFetch } from "../../lib/supabase";
import { COLOURS, RADII, cardStyle } from "../../lib/SharedUI";
import { useUserCtx } from "../../lib/useUserCtx";
import { isAdminTier } from "../../lib/permissions";

type Row = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  email: string | null;
  department: string | null;
  company: string | null;
  phone_e164: string | null;
  wa_can_issue_tasks: boolean | null;
};

const display = (r: Row) => (`${r.first_name || ""} ${r.last_name || ""}`.trim() || r.name || r.email || "—");

export default function WhatsAppSettingsPage() {
  const { ctx } = useUserCtx();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState("");

  async function load() {
    setLoadError("");
    try {
      const res = await authFetch("/api/whatsapp/mapping");
      let body: { members?: Row[]; error?: string } = {};
      try { body = await res.json(); } catch { body = {}; }
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setRows(body.members || []);
    } catch (e) {
      setRows([]);
      setLoadError(e instanceof Error ? e.message : "Could not load members.");
    }
  }
  useEffect(() => { load(); }, []);

  async function save(id: string, patch: { phone?: string; canIssue?: boolean }) {
    setSavingId(id);
    setNotice(null);
    try {
      const res = await authFetch("/api/whatsapp/mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: id, ...patch }),
      });
      let body: { success?: boolean; error?: string } = {};
      try { body = await res.json(); } catch { body = {}; }
      if (body.success) {
        setNotice({ id, ok: true, text: "Saved" });
        setRows((prev) => (prev || []).map((r) => r.id === id
          ? { ...r, ...(patch.phone !== undefined ? { phone_e164: patch.phone || null } : {}), ...(patch.canIssue !== undefined ? { wa_can_issue_tasks: patch.canIssue } : {}) }
          : r));
        setEdits((e) => { const n = { ...e }; delete n[id]; return n; });
      } else {
        setNotice({ id, ok: false, text: body.error || "Could not save." });
      }
    } catch (e) {
      setNotice({ id, ok: false, text: e instanceof Error ? e.message : "Network error." });
    } finally {
      setSavingId(null);
    }
  }

  const isAdmin = !ctx || isAdminTier(ctx); // server enforces regardless

  const visible = (rows || []).filter((r) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return display(r).toLowerCase().includes(f) || (r.department || "").toLowerCase().includes(f) || (r.email || "").toLowerCase().includes(f);
  });

  return (
    <AuthWrapper>
      <main style={{ padding: "14px 18px", maxWidth: "900px" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: COLOURS.NAVY, margin: "0 0 4px" }}>WhatsApp task mapping</h1>
        <p style={{ fontSize: 12.5, color: COLOURS.SLATE, margin: "0 0 16px", lineHeight: 1.6 }}>
          Map each member&apos;s WhatsApp number (international format, e.g. +923001234567). The <b>Can issue tasks</b> switch
          controls who may CREATE tasks by messaging the company WhatsApp number — anyone can be an assignee.
          Senders message the business number like: <i>@Ali Prepare the June VAT return, due Friday</i>
        </p>

        {!isAdmin ? (
          <div style={cardStyle}><p style={{ color: COLOURS.SLATE, fontSize: 14 }}>Only admins can manage WhatsApp mapping.</p></div>
        ) : rows === null ? (
          <div style={cardStyle}><p style={{ color: COLOURS.SLATE, fontSize: 13 }}>Loading…</p></div>
        ) : loadError ? (
          <div style={cardStyle}><p style={{ color: COLOURS.RED, fontSize: 13 }}>{loadError}</p></div>
        ) : (
          <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search name, department, email…"
                style={{ width: "100%", maxWidth: 320, padding: "7px 12px", borderRadius: RADII.SM, border: `1px solid ${COLOURS.HAIRLINE}`, fontSize: 13 }}
              />
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${COLOURS.NAVY}` }}>
                  {["Member", "Department", "WhatsApp number", "Can issue tasks", ""].map((h) => (
                    <th key={h} style={{ padding: "8px 14px", fontSize: 10, fontWeight: 700, color: COLOURS.INK_400, textAlign: "left", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const edited = edits[r.id];
                  const phoneVal = edited !== undefined ? edited : (r.phone_e164 || "");
                  const dirty = edited !== undefined && edited !== (r.phone_e164 || "");
                  return (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                      <td style={{ padding: "8px 14px", fontSize: 13, color: COLOURS.INK_700, fontWeight: 600 }}>{display(r)}</td>
                      <td style={{ padding: "8px 14px", fontSize: 12, color: COLOURS.SLATE }}>{r.department || "—"}</td>
                      <td style={{ padding: "8px 14px" }}>
                        <input
                          value={phoneVal}
                          onChange={(e) => setEdits((prev) => ({ ...prev, [r.id]: e.target.value }))}
                          placeholder="+92300…"
                          style={{ width: 170, padding: "6px 10px", borderRadius: RADII.SM, border: `1px solid ${dirty ? COLOURS.BLUE : COLOURS.HAIRLINE}`, fontSize: 12.5, fontFamily: "monospace" }}
                        />
                        {dirty && (
                          <button
                            onClick={() => save(r.id, { phone: edits[r.id] })}
                            disabled={savingId === r.id}
                            style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: "#fff", background: COLOURS.NAVY, border: "none", borderRadius: 8, padding: "6px 12px", cursor: savingId === r.id ? "wait" : "pointer" }}
                          >
                            {savingId === r.id ? "Saving…" : "Save"}
                          </button>
                        )}
                      </td>
                      <td style={{ padding: "8px 14px" }}>
                        <button
                          onClick={() => save(r.id, { canIssue: !r.wa_can_issue_tasks })}
                          disabled={savingId === r.id || !r.phone_e164}
                          title={!r.phone_e164 ? "Add a WhatsApp number first" : undefined}
                          style={{
                            fontSize: 11, fontWeight: 700, borderRadius: RADII.PILL, padding: "5px 14px", border: "none",
                            cursor: !r.phone_e164 ? "not-allowed" : savingId === r.id ? "wait" : "pointer",
                            background: r.wa_can_issue_tasks ? COLOURS.GREEN : COLOURS.TRACK,
                            color: r.wa_can_issue_tasks ? "#fff" : COLOURS.INK_400,
                            opacity: !r.phone_e164 ? 0.5 : 1,
                          }}
                        >
                          {r.wa_can_issue_tasks ? "Enabled" : "Disabled"}
                        </button>
                      </td>
                      <td style={{ padding: "8px 14px", fontSize: 11.5, minWidth: 110, color: notice?.id === r.id ? (notice.ok ? COLOURS.GREEN : COLOURS.RED) : COLOURS.INK_400 }}>
                        {notice?.id === r.id ? notice.text : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </AuthWrapper>
  );
}
