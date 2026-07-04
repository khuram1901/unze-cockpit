"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { useRequireCapability } from "../lib/useRouteGuard";
import { supabase } from "../lib/supabase";
import { useMobile } from "../lib/useMobile";
import { COLOURS, PageHeader, SectionTitle, SkeletonRows, ErrorBanner, useToast } from "../lib/SharedUI";
import DateInput from "../lib/DateInput";
import { formatDateUK } from "../lib/dateUtils";

// ─── Types ───────────────────────────────────────────────────────

type LetterSummary = {
  id: string;
  contractor_id: string;
  contractor_name: string;
  letter_number: string;
  issue_date: string;
  expiry_date: string | null;
  issued_by: string;
  qty_31: number; qty_36: number; qty_40: number; qty_45: number; qty_meter: number;
  dispatched_31: number; dispatched_36: number; dispatched_40: number; dispatched_45: number; dispatched_meter: number;
  remaining_31: number; remaining_36: number; remaining_40: number; remaining_45: number; remaining_meter: number;
  notes: string | null;
};

type ContractorGroup = {
  contractor_id: string;
  contractor_name: string;
  contractor_phone: string | null;
  letters: LetterSummary[];
  total_authorized_31: number; total_authorized_36: number; total_authorized_40: number; total_authorized_45: number; total_authorized_meter: number;
  total_dispatched_31: number; total_dispatched_36: number; total_dispatched_40: number; total_dispatched_45: number; total_dispatched_meter: number;
  total_remaining_31: number; total_remaining_36: number; total_remaining_40: number; total_remaining_45: number; total_remaining_meter: number;
};

type POSummary = {
  po: {
    id: string; plant_id: string; plant_name: string;
    customer_name: string; po_number: string; po_label: string;
    ordered_31: number; ordered_36: number; ordered_40: number; ordered_45: number; ordered_meter: number;
    variance_pct: number; status: string; is_system_unallocated: boolean;
    start_date: string | null; notes: string | null;
    produced_31: number; produced_36: number; produced_40: number; produced_45: number; produced_meter: number;
    dispatched_31: number; dispatched_36: number; dispatched_40: number; dispatched_45: number; dispatched_meter: number;
    in_stock_31: number; in_stock_36: number; in_stock_40: number; in_stock_45: number; in_stock_meter: number;
    fulfillment_pct: number | null;
    daily_rate: number;
    estimated_completion_date: string | null;
  };
  contractors: ContractorGroup[];
};

type Plant = { id: string; name: string; type: string };

// ─── Helpers ─────────────────────────────────────────────────────

async function authedFetch(url: string, opts: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${session?.access_token}` },
  });
}

function sizeRow(label: string, qty: number | null, colour?: string) {
  if (!qty) return null;
  return (
    <span style={{ fontSize: "12px", color: colour || COLOURS.SLATE, marginRight: "10px" }}>
      {label}: <strong>{qty.toLocaleString()}</strong>
    </span>
  );
}

function totalPoles(...nums: number[]) {
  return nums.reduce((a, b) => a + (b || 0), 0);
}

// Returns: "expired" | "expiring-soon" | "ok" | null
function expiryStatus(expiry_date: string | null): "expired" | "expiring-soon" | "ok" | null {
  if (!expiry_date) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const exp = new Date(expiry_date); exp.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "expired";
  if (diffDays <= 14) return "expiring-soon";
  return "ok";
}

// ─── Sub-components ──────────────────────────────────────────────

function SizeBadges({ label, qty_31, qty_36, qty_40, qty_45, qty_meter, colour }: {
  label: string; qty_31: number; qty_36: number; qty_40?: number; qty_45: number; qty_meter: number; colour?: string;
}) {
  const total = totalPoles(qty_31, qty_36, qty_40 || 0, qty_45, qty_meter);
  if (total === 0) return <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{label}: 0</span>;
  return (
    <span>
      <span style={{ fontSize: "12px", color: COLOURS.SLATE, marginRight: "6px" }}>{label}:</span>
      {sizeRow("31ft", qty_31, colour)}
      {sizeRow("36ft", qty_36, colour)}
      {qty_40 ? sizeRow("40ft", qty_40, colour) : null}
      {sizeRow("45ft", qty_45, colour)}
      {sizeRow("Mtr", qty_meter, colour)}
    </span>
  );
}

type DispatchTarget = {
  letterId: string;
  letterNumber: string;
  qty_31: number; qty_36: number; qty_40: number; qty_45: number; qty_meter: number;
  remaining_31: number; remaining_36: number; remaining_40: number; remaining_45: number; remaining_meter: number;
};

const emptyDispatchForm = { dispatch_date: "", qty_31: "", qty_36: "", qty_40: "", qty_45: "", qty_meter: "", released_by: "", vehicle_number: "", notes: "" };

function DispatchModal({ target, onClose, onSaved }: {
  target: DispatchTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(emptyDispatchForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

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
    onSaved();
    onClose();
  }

  const inputSt: React.CSSProperties = { border: "1px solid #cbd5e1", borderRadius: "6px", padding: "7px 10px", fontSize: "13px", width: "100%", boxSizing: "border-box", backgroundColor: "#fff" };

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
    >
      <div style={{ backgroundColor: "#fff", borderRadius: "12px", padding: "20px 24px", width: "100%", maxWidth: "480px", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
          <div style={{ fontSize: "16px", fontWeight: 700, color: COLOURS.NAVY }}>Record Dispatch — Letter #{target.letterNumber}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: COLOURS.SLATE, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "12px", padding: "6px 10px", backgroundColor: "#f8fafc", borderRadius: "6px" }}>
          Remaining on letter:{" "}
          {[
            target.remaining_31 > 0 && `${target.remaining_31} × 31ft`,
            target.remaining_36 > 0 && `${target.remaining_36} × 36ft`,
            target.remaining_40 > 0 && `${target.remaining_40} × 40ft`,
            target.remaining_45 > 0 && `${target.remaining_45} × 45ft`,
            target.remaining_meter > 0 && `${target.remaining_meter} × Mtr`,
          ].filter(Boolean).join(", ") || "Fully collected"}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
          <div>
            <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Date *</label>
            <DateInput value={form.dispatch_date} onChange={(e) => setForm({ ...form, dispatch_date: e.target.value })} style={inputSt} />
          </div>
          <div>
            <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Released by *</label>
            <input value={form.released_by} onChange={(e) => setForm({ ...form, released_by: e.target.value })} placeholder="Name of person releasing poles" style={inputSt} />
          </div>
          <div>
            <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Vehicle number</label>
            <input value={form.vehicle_number} onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })} placeholder="Optional" style={inputSt} />
          </div>
        </div>

        <div style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.SLATE, margin: "4px 0 8px" }}>Quantities dispatched</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(90px,1fr))", gap: "8px", marginBottom: "10px" }}>
          {target.qty_31 > 0 && (
            <div>
              <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>31ft</label>
              <input type="number" min="0" max={target.remaining_31} value={form.qty_31} onChange={(e) => setForm({ ...form, qty_31: e.target.value })} placeholder="0" style={inputSt} />
            </div>
          )}
          {target.qty_36 > 0 && (
            <div>
              <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>36ft</label>
              <input type="number" min="0" max={target.remaining_36} value={form.qty_36} onChange={(e) => setForm({ ...form, qty_36: e.target.value })} placeholder="0" style={inputSt} />
            </div>
          )}
          {target.qty_40 > 0 && (
            <div>
              <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>40ft</label>
              <input type="number" min="0" max={target.remaining_40} value={form.qty_40} onChange={(e) => setForm({ ...form, qty_40: e.target.value })} placeholder="0" style={inputSt} />
            </div>
          )}
          {target.qty_45 > 0 && (
            <div>
              <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>45ft</label>
              <input type="number" min="0" max={target.remaining_45} value={form.qty_45} onChange={(e) => setForm({ ...form, qty_45: e.target.value })} placeholder="0" style={inputSt} />
            </div>
          )}
          {target.qty_meter > 0 && (
            <div>
              <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Meter</label>
              <input type="number" min="0" max={target.remaining_meter} value={form.qty_meter} onChange={(e) => setForm({ ...form, qty_meter: e.target.value })} placeholder="0" style={inputSt} />
            </div>
          )}
        </div>

        <div style={{ marginBottom: "12px" }}>
          <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Notes</label>
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" style={inputSt} />
        </div>

        {error && <div style={{ fontSize: "13px", color: "#dc2626", marginBottom: "10px", padding: "6px 10px", backgroundColor: "#fef2f2", borderRadius: "6px" }}>{error}</div>}

        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={save} disabled={saving} style={{ padding: "8px 18px", borderRadius: "8px", fontSize: "14px", fontWeight: 700, backgroundColor: COLOURS.NAVY, color: "#fff", border: "none", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}>
            {saving ? "Saving…" : "Save Dispatch"}
          </button>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: "8px", fontSize: "14px", fontWeight: 600, border: "1px solid #e2e8f0", backgroundColor: "#fff", color: COLOURS.SLATE, cursor: "pointer" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function LetterRow({ letter, expanded, onToggle, onDispatch }: {
  letter: LetterSummary; expanded: boolean; onToggle: () => void; onDispatch: () => void;
}) {
  const remaining = totalPoles(letter.remaining_31, letter.remaining_36, letter.remaining_40, letter.remaining_45, letter.remaining_meter);
  const authorized = totalPoles(letter.qty_31, letter.qty_36, letter.qty_40, letter.qty_45, letter.qty_meter);
  const dispatched = totalPoles(letter.dispatched_31, letter.dispatched_36, letter.dispatched_40, letter.dispatched_45, letter.dispatched_meter);
  const fullyCollected = remaining === 0 && authorized > 0;
  const expStatus = expiryStatus(letter.expiry_date);

  const expiryBadge = expStatus === "expired"
    ? { label: `Expired ${formatDateUK(letter.expiry_date!)}`, bg: "#fef2f2", color: "#dc2626" }
    : expStatus === "expiring-soon"
    ? { label: `Expires ${formatDateUK(letter.expiry_date!)}`, bg: "#fffbeb", color: "#d97706" }
    : expStatus === "ok"
    ? { label: `Exp. ${formatDateUK(letter.expiry_date!)}`, bg: "#f0fdf4", color: "#16a34a" }
    : null;

  return (
    <div style={{ marginLeft: "24px", marginBottom: "6px" }}>
      <div
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", gap: "8px", padding: "7px 10px",
          borderRadius: "6px", cursor: "pointer", flexWrap: "wrap",
          backgroundColor: expStatus === "expired" ? "#fef2f2" : fullyCollected ? "#f0fdf4" : "var(--bg-card-hover, #f8fafc)",
          border: `1px solid ${expStatus === "expired" ? "#fecaca" : expStatus === "expiring-soon" ? "#fde68a" : fullyCollected ? "#bbf7d0" : "var(--border-light, #f1f5f9)"}`,
        }}
      >
        <span style={{ fontSize: "13px" }}>{expanded ? "▾" : "▸"}</span>
        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary, #1e293b)" }}>
          Letter #{letter.letter_number}
        </span>
        <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>— {formatDateUK(letter.issue_date)} — Auth'd by {letter.issued_by}</span>
        {expiryBadge && (
          <span style={{ fontSize: "11px", fontWeight: 700, padding: "1px 7px", borderRadius: "10px", backgroundColor: expiryBadge.bg, color: expiryBadge.color }}>
            {expiryBadge.label}
          </span>
        )}
        <span style={{ marginLeft: "auto", display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>Authorized: <strong>{authorized.toLocaleString()}</strong></span>
          <span style={{ fontSize: "12px", color: "#2563eb" }}>Collected: <strong>{dispatched.toLocaleString()}</strong></span>
          <span style={{ fontSize: "12px", fontWeight: 700, color: fullyCollected ? "#16a34a" : "#dc2626" }}>
            Balance: {remaining.toLocaleString()}
          </span>
          {!fullyCollected && (
            <button
              onClick={(e) => { e.stopPropagation(); onDispatch(); }}
              style={{ padding: "3px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: 700, border: `1px solid ${COLOURS.NAVY}`, backgroundColor: COLOURS.NAVY, color: "#fff", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              + Dispatch
            </button>
          )}
        </span>
      </div>
      {expanded && (
        <div style={{ padding: "8px 12px", fontSize: "12px", color: COLOURS.SLATE }}>
          <SizeBadges label="Auth'd" qty_31={letter.qty_31} qty_36={letter.qty_36} qty_40={letter.qty_40} qty_45={letter.qty_45} qty_meter={letter.qty_meter} />
          <span style={{ margin: "0 10px" }}>·</span>
          <SizeBadges label="Collected" qty_31={letter.dispatched_31} qty_36={letter.dispatched_36} qty_40={letter.dispatched_40} qty_45={letter.dispatched_45} qty_meter={letter.dispatched_meter} colour="#2563eb" />
          <span style={{ margin: "0 10px" }}>·</span>
          <SizeBadges label="Balance" qty_31={letter.remaining_31} qty_36={letter.remaining_36} qty_40={letter.remaining_40} qty_45={letter.remaining_45} qty_meter={letter.remaining_meter} colour={remaining === 0 ? "#16a34a" : "#dc2626"} />
          {letter.notes && <div style={{ marginTop: "4px", fontStyle: "italic" }}>{letter.notes}</div>}
        </div>
      )}
    </div>
  );
}

function ContractorRow({ group, expandedLetters, onToggle, onLetterToggle, onDispatch }: {
  group: ContractorGroup;
  expandedLetters: Set<string>;
  onToggle: () => void;
  onLetterToggle: (id: string) => void;
  onDispatch: (letter: LetterSummary) => void;
}) {
  const remaining = totalPoles(group.total_remaining_31, group.total_remaining_36, group.total_remaining_40, group.total_remaining_45, group.total_remaining_meter);
  const authorized = totalPoles(group.total_authorized_31, group.total_authorized_36, group.total_authorized_40, group.total_authorized_45, group.total_authorized_meter);
  const isOpen = expandedLetters.has(`c-${group.contractor_id}`);

  return (
    <div style={{ marginLeft: "16px", marginBottom: "6px" }}>
      <div
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px",
          borderRadius: "6px", cursor: "pointer", flexWrap: "wrap",
          backgroundColor: "var(--bg-card, #ffffff)",
          border: "1px solid var(--border-color, #e2e8f0)",
        }}
      >
        <span style={{ fontSize: "13px" }}>{isOpen ? "▾" : "▸"}</span>
        <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary, #1e293b)" }}>
          {group.contractor_name}
        </span>
        {group.contractor_phone && (
          <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{group.contractor_phone}</span>
        )}
        <span style={{ fontSize: "12px", color: COLOURS.SLATE, marginLeft: "4px" }}>
          {group.letters.length} letter{group.letters.length !== 1 ? "s" : ""}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: "14px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>Auth'd: <strong>{authorized.toLocaleString()}</strong></span>
          <span style={{ fontSize: "12px", fontWeight: 700, color: remaining === 0 ? "#16a34a" : "#dc2626" }}>
            Balance: {remaining.toLocaleString()}
          </span>
        </span>
      </div>
      {isOpen && group.letters.map((l) => (
        <LetterRow
          key={l.id}
          letter={l}
          expanded={expandedLetters.has(l.id)}
          onToggle={() => onLetterToggle(l.id)}
          onDispatch={() => onDispatch(l)}
        />
      ))}
    </div>
  );
}

function PORow({ item, expandedKeys, onToggle, onDispatch }: {
  item: POSummary;
  expandedKeys: Set<string>;
  onToggle: (key: string) => void;
  onDispatch: (letter: LetterSummary) => void;
}) {
  const { po, contractors } = item;
  const isClosed = po.status === "Closed";
  const isExpanded = expandedKeys.has(po.id);
  const inStock = totalPoles(po.in_stock_31, po.in_stock_36, po.in_stock_40, po.in_stock_45, po.in_stock_meter);
  const produced = totalPoles(po.produced_31, po.produced_36, po.produced_40, po.produced_45, po.produced_meter);
  const dispatched = totalPoles(po.dispatched_31, po.dispatched_36, po.dispatched_40, po.dispatched_45, po.dispatched_meter);

  return (
    <div style={{ marginBottom: "6px", opacity: isClosed ? 0.55 : 1 }}>
      <div
        onClick={() => onToggle(po.id)}
        style={{
          display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px",
          borderRadius: "8px", cursor: "pointer", flexWrap: "wrap",
          backgroundColor: "var(--bg-card, #ffffff)",
          border: `1px solid ${isClosed ? "#e2e8f0" : "#cbd5e1"}`,
          borderLeft: `4px solid ${isClosed ? "#94a3b8" : po.is_system_unallocated ? "#f59e0b" : COLOURS.NAVY}`,
        }}
      >
        <span style={{ fontSize: "13px" }}>{isExpanded ? "▾" : "▸"}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary, #1e293b)" }}>
              {po.is_system_unallocated ? "Unze Unallocated Stock" : `${po.customer_name} — PO #${po.po_number}`}
            </span>
            {po.po_label && !po.is_system_unallocated && (
              <span style={{ fontSize: "12px", padding: "1px 8px", borderRadius: "10px", backgroundColor: "#eff6ff", color: "#2563eb", fontWeight: 600 }}>
                {po.po_label}
              </span>
            )}
            {isClosed && (
              <span style={{ fontSize: "11px", padding: "1px 8px", borderRadius: "10px", backgroundColor: "#f1f5f9", color: COLOURS.SLATE, fontWeight: 700 }}>
                CLOSED
              </span>
            )}
            {po.fulfillment_pct !== null && (
              <span style={{ fontSize: "12px", color: po.fulfillment_pct >= 100 ? "#16a34a" : "#d97706", fontWeight: 600 }}>
                {po.fulfillment_pct}% produced
              </span>
            )}
          </div>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>
            {!po.is_system_unallocated && `Ordered: ${totalPoles(po.ordered_31, po.ordered_36, po.ordered_40, po.ordered_45, po.ordered_meter).toLocaleString()} · `}
            Produced: {produced.toLocaleString()} · Dispatched: {dispatched.toLocaleString()} · In stock: <strong style={{ color: inStock > 0 ? COLOURS.NAVY : "#16a34a" }}>{inStock.toLocaleString()}</strong>
            {po.estimated_completion_date && (
              <span style={{ marginLeft: "10px", padding: "1px 8px", borderRadius: "10px", backgroundColor: "#eff6ff", color: "#2563eb", fontWeight: 700, fontSize: "11px" }}>
                Est. completion: {formatDateUK(po.estimated_completion_date)}
                {po.daily_rate > 0 && <span style={{ fontWeight: 400, marginLeft: "4px" }}>({po.daily_rate}/day avg)</span>}
              </span>
            )}
          </div>
          {/* Size breakdown for in-stock — only shown when there's stock */}
          {inStock > 0 && (
            <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "3px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, color: COLOURS.NAVY }}>In stock by size:</span>
              {po.in_stock_31 > 0 && <span>31 ft: <strong>{po.in_stock_31.toLocaleString()}</strong></span>}
              {po.in_stock_36 > 0 && <span>36 ft: <strong>{po.in_stock_36.toLocaleString()}</strong></span>}
              {po.in_stock_40 > 0 && <span>40 ft: <strong>{po.in_stock_40.toLocaleString()}</strong></span>}
              {po.in_stock_45 > 0 && <span>45 ft: <strong>{po.in_stock_45.toLocaleString()}</strong></span>}
              {po.in_stock_meter > 0 && <span>Mtr: <strong>{po.in_stock_meter.toLocaleString()}</strong></span>}
            </div>
          )}
        </div>
      </div>

      {isExpanded && (
        <div style={{ paddingTop: "6px" }}>
          {contractors.length === 0 ? (
            <div style={{ marginLeft: "20px", fontSize: "13px", color: COLOURS.SLATE, padding: "8px 0" }}>
              No authority letters issued yet.
            </div>
          ) : contractors.map((cg) => (
            <ContractorRow
              key={cg.contractor_id}
              group={cg}
              expandedLetters={expandedKeys}
              onToggle={() => onToggle(`c-${cg.contractor_id}`)}
              onLetterToggle={(id) => onToggle(id)}
              onDispatch={onDispatch}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────

export default function StockPage() {
  const { checking } = useRequireCapability("stock");
  const isMobile = useMobile();
  const { show: toast, element: toastEl } = useToast();

  const [plants, setPlants] = useState<Plant[]>([]);
  const [selectedPlant, setSelectedPlant] = useState<string>("");
  const [summary, setSummary] = useState<POSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [showClosed, setShowClosed] = useState(true);
  const [dispatchTarget, setDispatchTarget] = useState<DispatchTarget | null>(null);

  useEffect(() => {
    if (!checking) loadPlants();
  }, [checking]);

  useEffect(() => {
    if (selectedPlant) loadSummary(selectedPlant);
  }, [selectedPlant]);

  async function loadPlants() {
    const { data } = await supabase.from("plants").select("id, name, type").eq("active", true).order("name");
    const list = data || [];
    setPlants(list);
    if (list.length > 0) setSelectedPlant(list[0].id);
  }

  const loadSummary = useCallback(async (plantId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/stock/summary?plantId=${plantId}`);
      const json = await res.json();
      if (json.error) { setError(json.error); return; }
      setSummary(json.summary || []);
    } catch {
      setError("Failed to load stock summary.");
    } finally {
      setLoading(false);
    }
  }, []);

  function openDispatch(letter: LetterSummary) {
    setDispatchTarget({
      letterId: letter.id,
      letterNumber: letter.letter_number,
      qty_31: letter.qty_31, qty_36: letter.qty_36, qty_40: letter.qty_40, qty_45: letter.qty_45, qty_meter: letter.qty_meter,
      remaining_31: letter.remaining_31, remaining_36: letter.remaining_36, remaining_40: letter.remaining_40, remaining_45: letter.remaining_45, remaining_meter: letter.remaining_meter,
    });
  }

  function toggle(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function expandAll() {
    const keys = new Set<string>();
    for (const item of summary) {
      keys.add(item.po.id);
      for (const cg of item.contractors) {
        keys.add(`c-${cg.contractor_id}`);
        for (const l of cg.letters) keys.add(l.id);
      }
    }
    setExpandedKeys(keys);
  }

  // Plant-level totals
  const totalInStock = summary.reduce((s, i) => s + totalPoles(i.po.in_stock_31, i.po.in_stock_36, i.po.in_stock_45, i.po.in_stock_meter), 0);
  const activePOs = summary.filter((i) => i.po.status === "Active" && !i.po.is_system_unallocated).length;
  const visibleSummary = showClosed ? summary : summary.filter((i) => i.po.status === "Active");

  // Expiry warnings — letters expiring within 14 days or already expired
  const expiryWarnings: { po_label: string; contractor: string; letter_number: string; expiry_date: string; status: "expired" | "expiring-soon" }[] = [];
  for (const item of summary) {
    if (item.po.status === "Closed") continue;
    for (const cg of item.contractors) {
      for (const l of cg.letters) {
        const s = expiryStatus(l.expiry_date);
        if (s === "expired" || s === "expiring-soon") {
          expiryWarnings.push({
            po_label: item.po.is_system_unallocated ? "Unallocated" : `${item.po.customer_name} PO#${item.po.po_number}`,
            contractor: cg.contractor_name,
            letter_number: l.letter_number,
            expiry_date: l.expiry_date!,
            status: s,
          });
        }
      }
    }
  }

  if (checking) return (
    <AuthWrapper><main style={{ padding: "14px 18px" }}><p style={{ color: COLOURS.SLATE }}>Checking permissions...</p></main></AuthWrapper>
  );

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
        <PageHeader />
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", marginBottom: "18px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-primary, #1e293b)", margin: "0 0 4px" }}>Stock</h1>
            <p style={{ fontSize: "14px", color: COLOURS.SLATE, margin: 0 }}>Customer POs, authority letters, and dispatch balances</p>
          </div>
          <a href="/stock/manage" style={{ padding: "8px 16px", borderRadius: "8px", fontSize: "14px", fontWeight: 600, backgroundColor: COLOURS.NAVY, color: "white", textDecoration: "none" }}>
            Manage POs & Letters
          </a>
        </div>

        {/* Plant selector */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap", alignItems: "center" }}>
          {plants.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedPlant(p.id)}
              style={{
                padding: "8px 18px", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: "pointer",
                border: `2px solid ${selectedPlant === p.id ? COLOURS.NAVY : "#e2e8f0"}`,
                backgroundColor: selectedPlant === p.id ? COLOURS.NAVY : "var(--bg-card, #fff)",
                color: selectedPlant === p.id ? "white" : COLOURS.NAVY,
              }}
            >
              {p.name}
            </button>
          ))}
        </div>

        {/* Stats strip */}
        {!loading && summary.length > 0 && (
          <div style={{ display: "flex", gap: "16px", marginBottom: "14px", flexWrap: "wrap", padding: "10px 14px", backgroundColor: "var(--bg-card, #ffffff)", borderRadius: "8px", border: "1px solid var(--border-color, #e2e8f0)" }}>
            <span style={{ fontSize: "13px", color: COLOURS.SLATE }}>Total in stock: <strong style={{ color: COLOURS.NAVY, fontSize: "15px" }}>{totalInStock.toLocaleString()} poles</strong></span>
            <span style={{ fontSize: "13px", color: COLOURS.SLATE }}>Active POs: <strong>{activePOs}</strong></span>
            <span style={{ fontSize: "13px", color: COLOURS.SLATE }}>All POs: <strong>{summary.length}</strong></span>
          </div>
        )}

        {/* Expiry warnings banner */}
        {expiryWarnings.length > 0 && (
          <div style={{ marginBottom: "14px", border: "1px solid #fde68a", borderRadius: "8px", backgroundColor: "#fffbeb", padding: "10px 14px" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#92400e", marginBottom: "6px" }}>
              ⚠ Authority Letter Expiry Alerts
            </div>
            {expiryWarnings.map((w, i) => (
              <div key={i} style={{ fontSize: "12px", color: w.status === "expired" ? "#dc2626" : "#d97706", marginBottom: "3px" }}>
                <strong>{w.status === "expired" ? "EXPIRED" : "Expiring soon"}:</strong> Letter #{w.letter_number} ({w.po_label} · {w.contractor}) — {formatDateUK(w.expiry_date)}
              </div>
            ))}
          </div>
        )}

        {/* Controls */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap", alignItems: "center" }}>
          <SectionTitle title="Purchase Orders" />
          <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
            <button onClick={expandAll} style={{ padding: "5px 12px", borderRadius: "6px", fontSize: "13px", fontWeight: 600, border: "1px solid #e2e8f0", backgroundColor: "var(--bg-card,#fff)", color: COLOURS.NAVY, cursor: "pointer" }}>
              Expand all
            </button>
            <button onClick={() => setExpandedKeys(new Set())} style={{ padding: "5px 12px", borderRadius: "6px", fontSize: "13px", fontWeight: 600, border: "1px solid #e2e8f0", backgroundColor: "var(--bg-card,#fff)", color: COLOURS.SLATE, cursor: "pointer" }}>
              Collapse all
            </button>
            <button
              onClick={() => setShowClosed((v) => !v)}
              style={{ padding: "5px 12px", borderRadius: "6px", fontSize: "13px", fontWeight: 600, border: "1px solid #e2e8f0", backgroundColor: "var(--bg-card,#fff)", color: COLOURS.SLATE, cursor: "pointer" }}
            >
              {showClosed ? "Hide closed" : "Show closed"}
            </button>
          </div>
        </div>

        {error && <ErrorBanner message={error} onRetry={() => loadSummary(selectedPlant)} />}

        {loading ? <SkeletonRows count={5} height="48px" /> : visibleSummary.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px", color: COLOURS.SLATE, border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", backgroundColor: "var(--bg-card, #fff)" }}>
            No POs found for this plant. <a href="/stock/manage" style={{ color: COLOURS.NAVY, fontWeight: 600 }}>Add the first PO →</a>
          </div>
        ) : (
          <div>
            {visibleSummary.map((item) => (
              <PORow key={item.po.id} item={item} expandedKeys={expandedKeys} onToggle={toggle} onDispatch={openDispatch} />
            ))}
          </div>
        )}

        {dispatchTarget && (
          <DispatchModal
            target={dispatchTarget}
            onClose={() => setDispatchTarget(null)}
            onSaved={() => {
              toast("Dispatch recorded successfully", "success");
              loadSummary(selectedPlant);
            }}
          />
        )}
        {toastEl}
      </main>
    </AuthWrapper>
  );
}
