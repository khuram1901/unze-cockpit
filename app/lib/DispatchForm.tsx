"use client";

// Shared "record a dispatch against an authority letter" form.
//
// Previously this exact set of fields (date, released-by, vehicle number,
// per-size quantity boxes, notes) was built TWICE — once as a modal on the
// Stock page, once as an inline panel on the Manage POs page — both
// posting to the same /api/stock/dispatch-records endpoint. Khuram flagged
// the two pages as feeling duplicative; this was the one piece of actual
// duplicate logic between them (everything else on Manage — PO/contractor
// CRUD, bulk actions, performance — has no equivalent on Stock at all).
// Extracted here so there's exactly one place that knows how to record a
// dispatch; each page still decides its own chrome around it (Stock wraps
// it in a modal overlay, Manage renders it inline under the letter row).

import { useState } from "react";
import { supabase } from "./supabase";
import { COLOURS, RADII, inputStyle, labelStyle, primaryButtonStyle } from "./SharedUI";
import DateInputWithCalendar from "./DateInputWithCalendar";

export type DispatchLetterTarget = {
  letterId: string;
  qty_31: number; qty_36: number; qty_40: number; qty_45: number; qty_meter: number;
  // Optional: only Stock's overview tree currently tracks remaining balance
  // per letter at this point in the data it already has loaded. When
  // provided, inputs are capped to the remaining amount and a "remaining on
  // letter" line is shown. Manage's letters view doesn't have this figure
  // to hand, so it's simply omitted there — same as today's behaviour.
  remaining_31?: number; remaining_36?: number; remaining_40?: number; remaining_45?: number; remaining_meter?: number;
};

const emptyForm = { dispatch_date: "", qty_31: "", qty_36: "", qty_40: "", qty_45: "", qty_meter: "", released_by: "", vehicle_number: "", notes: "" };

export default function DispatchForm({ target, onSaved, onCancel, compact }: {
  target: DispatchLetterTarget;
  onSaved: () => void;
  onCancel?: () => void;
  // Tighter spacing/font-size for the inline (Manage) placement; Stock's
  // modal keeps the slightly roomier original sizing.
  compact?: boolean;
}) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!form.dispatch_date || !form.released_by) { setError("Date and released-by are required"); return; }
    setSaving(true); setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/stock/dispatch-records", {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        authority_letter_id: target.letterId,
        dispatch_date: form.dispatch_date,
        qty_31: Number(form.qty_31) || 0,
        qty_36: Number(form.qty_36) || 0,
        qty_40: Number(form.qty_40) || 0,
        qty_45: Number(form.qty_45) || 0,
        qty_meter: Number(form.qty_meter) || 0,
        released_by: form.released_by,
        vehicle_number: form.vehicle_number || null,
        notes: form.notes || null,
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (json.error) { setError(json.error); return; }
    setForm(emptyForm);
    onSaved();
  }

  const hasRemaining = target.remaining_31 !== undefined;
  const gap = compact ? "8px" : "10px";
  const fontSize = compact ? "12px" : "13px";
  const labelSt = compact ? { ...labelStyle, fontSize: "11px", textTransform: "none" as const, letterSpacing: "normal" } : labelStyle;

  return (
    <div>
      {hasRemaining && (
        <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "12px", padding: "6px 10px", backgroundColor: COLOURS.CARD_ALT, borderRadius: RADII.XS }}>
          Remaining on letter:{" "}
          {[
            (target.remaining_31 || 0) > 0 && `${target.remaining_31} × 31ft`,
            (target.remaining_36 || 0) > 0 && `${target.remaining_36} × 36ft`,
            (target.remaining_40 || 0) > 0 && `${target.remaining_40} × 40ft`,
            (target.remaining_45 || 0) > 0 && `${target.remaining_45} × 45ft`,
            (target.remaining_meter || 0) > 0 && `${target.remaining_meter} × Mtr`,
          ].filter(Boolean).join(", ") || "Fully collected"}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap, marginBottom: gap }}>
        <div>
          <label style={labelSt}>Date *</label>
          <DateInputWithCalendar value={form.dispatch_date} onChange={(e) => setForm({ ...form, dispatch_date: e.target.value })} style={inputStyle} />
        </div>
        <div>
          <label style={labelSt}>Released by *</label>
          <input value={form.released_by} onChange={(e) => setForm({ ...form, released_by: e.target.value })} placeholder="Name of person releasing poles" style={inputStyle} />
        </div>
        <div>
          <label style={labelSt}>Vehicle number</label>
          <input value={form.vehicle_number} onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })} placeholder="Optional" style={inputStyle} />
        </div>
      </div>

      <div style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.SLATE, margin: "4px 0 8px" }}>Quantities dispatched</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(90px,1fr))", gap, marginBottom: gap }}>
        {target.qty_31 > 0 && (
          <div>
            <label style={labelSt}>31ft</label>
            <input type="number" min="0" max={target.remaining_31} value={form.qty_31} onChange={(e) => setForm({ ...form, qty_31: e.target.value })} placeholder="0" style={inputStyle} />
          </div>
        )}
        {target.qty_36 > 0 && (
          <div>
            <label style={labelSt}>36ft</label>
            <input type="number" min="0" max={target.remaining_36} value={form.qty_36} onChange={(e) => setForm({ ...form, qty_36: e.target.value })} placeholder="0" style={inputStyle} />
          </div>
        )}
        {target.qty_40 > 0 && (
          <div>
            <label style={labelSt}>40ft</label>
            <input type="number" min="0" max={target.remaining_40} value={form.qty_40} onChange={(e) => setForm({ ...form, qty_40: e.target.value })} placeholder="0" style={inputStyle} />
          </div>
        )}
        {target.qty_45 > 0 && (
          <div>
            <label style={labelSt}>45ft</label>
            <input type="number" min="0" max={target.remaining_45} value={form.qty_45} onChange={(e) => setForm({ ...form, qty_45: e.target.value })} placeholder="0" style={inputStyle} />
          </div>
        )}
        {target.qty_meter > 0 && (
          <div>
            <label style={labelSt}>Meter</label>
            <input type="number" min="0" max={target.remaining_meter} value={form.qty_meter} onChange={(e) => setForm({ ...form, qty_meter: e.target.value })} placeholder="0" style={inputStyle} />
          </div>
        )}
      </div>

      <div style={{ marginBottom: gap }}>
        <label style={labelSt}>Notes</label>
        <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" style={inputStyle} />
      </div>

      {error && (
        <div style={{ fontSize: "13px", color: COLOURS.RED, marginBottom: "10px", padding: "6px 10px", backgroundColor: COLOURS.DANGER_SOFT, borderRadius: RADII.XS }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: "8px" }}>
        <button onClick={save} disabled={saving} style={{ ...primaryButtonStyle, fontSize, opacity: saving ? 0.6 : 1, cursor: saving ? "not-allowed" : "pointer" }}>
          {saving ? "Saving…" : "Save Dispatch"}
        </button>
        {onCancel && (
          <button onClick={onCancel} style={{ padding: "8px 18px", borderRadius: RADII.PILL, fontSize, fontWeight: 600, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: COLOURS.CARD, color: COLOURS.SLATE, cursor: "pointer" }}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
