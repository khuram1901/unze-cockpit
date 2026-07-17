"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import AuthWrapper from "../../lib/AuthWrapper";
import { useRequireCapability, loadUserCtx } from "../../lib/useRouteGuard";
import { supabase, loadMyWidgetOverrides } from "../../lib/supabase";
import { canViewGuaranteeFinancials, canManageGuarantees, widgetVisible } from "../../lib/permissions";
import { useMobile } from "../../lib/useMobile";
import { COLOURS, RADII, PageHeader, SectionTitle, CountCard, cardStyle, useToast, useConfirm, primaryButtonStyle, inputStyle, labelStyle } from "../../lib/SharedUI";
import { formatDateUK } from "../../lib/dateUtils";
import DateInputWithCalendar from "../../lib/DateInputWithCalendar";

// ─── Types ────────────────────────────────────────────────────────────────────

type FacilityTypeBreakdown = {
  guarantee_type: string;
  count: number;
  seized: number;
};

type Facility = {
  id: string; bank_name: string; facility_name: string | null; facility_type: string;
  total_limit: number; seized: number; available: number;
  utilisation_pct: number; notes: string | null; active: boolean;
  type_breakdown: FacilityTypeBreakdown[];
};

type BankGroup = {
  bank_name: string;
  bank_total_limit: number; bank_seized: number; bank_available: number;
  bank_utilisation_pct: number;
  sub_facilities: Facility[];
};

type Guarantee = {
  id: string; facility_id: string | null;
  guarantee_type: string; guarantee_number: string; bank_name: string;
  issue_date: string; expiry_date: string | null;
  amount: number; cash_margin_pct: number; cash_margin_amount: number; bank_charges: number;
  customer_name: string; tender_reference: string | null; purpose: string | null;
  status: string; linked_guarantee_id: string | null;
  first_bill_receivable_id: string | null;
  linked_bill_date: string | null; linked_invoice_ref: string | null; linked_bill_amount: number | null;
  performance_bill_date: string | null; effective_bill_date: string | null; release_due_date: string | null;
  returned_date: string | null; days_to_expiry: number | null;
  chase_urgency: string; notes: string | null; created_by: string | null; created_at: string;
};

type BillOption = {
  id: string; utility: string; invoice_ref: string | null;
  amount: number; date_submitted: string; bill_type: string; status: string;
};

type Totals = {
  active_count: number; total_amount_active: number;
  total_cash_margin_stuck: number; total_bank_charges: number;
  overdue_count: number; due_soon_count: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function authedFetch(url: string, opts: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
  });
}

function pkr(n: number) {
  return "PKR " + Math.round(n).toLocaleString("en-PK");
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "12px" }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

// ─── Facility form (shared between empty-state and existing-state) ────────────

const BANKS = [
  "HBL", "Faysal Bank", "AlFalah Bank", "Allied Bank", "BOP", "DIB", "Other",
];

const FACILITY_TYPES = [
  "Guarantee Limit", "Overdraft", "Letter of Credit (LC)",
  "Car Finance", "Running Finance", "Term Finance", "Pay Order Limit", "Other",
];

function FacilityForm({ facilityForm, setFacilityForm, saveFacility, savingFacility, isMobile }: {
  facilityForm: { bank_name: string; facility_name: string; facility_type: string; total_limit: string; notes: string };
  setFacilityForm: (f: { bank_name: string; facility_name: string; facility_type: string; total_limit: string; notes: string }) => void;
  saveFacility: () => void;
  savingFacility: boolean;
  isMobile: boolean;
}) {
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px" }}>
        <Field label="Bank name *">
          <select value={facilityForm.bank_name} onChange={(e) => setFacilityForm({ ...facilityForm, bank_name: e.target.value })} style={{ ...inputStyle, width: "100%" }}>
            <option value="">— Select bank —</option>
            {BANKS.map((b) => <option key={b}>{b}</option>)}
          </select>
        </Field>
        <Field label="Facility name *">
          <input value={facilityForm.facility_name} onChange={(e) => setFacilityForm({ ...facilityForm, facility_name: e.target.value })}
            placeholder="e.g. Guarantee Limit, Overdraft" style={{ ...inputStyle, width: "100%" }} />
        </Field>
        <Field label="Facility type">
          <select value={facilityForm.facility_type} onChange={(e) => setFacilityForm({ ...facilityForm, facility_type: e.target.value })} style={{ ...inputStyle, width: "100%" }}>
            {FACILITY_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Total limit (PKR) *">
          <input type="number" min="0" value={facilityForm.total_limit} onChange={(e) => setFacilityForm({ ...facilityForm, total_limit: e.target.value })} placeholder="0" style={{ ...inputStyle, width: "100%" }} />
        </Field>
        <Field label="Notes" >
          <input value={facilityForm.notes} onChange={(e) => setFacilityForm({ ...facilityForm, notes: e.target.value })} placeholder="Optional" style={{ ...inputStyle, width: "100%" }} />
        </Field>
      </div>
      <button onClick={saveFacility} disabled={savingFacility} style={{ ...primaryButtonStyle, opacity: savingFacility ? 0.6 : 1 }}>{savingFacility ? "Saving…" : "Add Facility"}</button>
    </>
  );
}

// ─── Bank-grouped utilisation card ────────────────────────────────────────────

function TrafficDot({ color, title, onClick }: { color: string; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: "13px", height: "13px", borderRadius: "50%",
        backgroundColor: color, border: "none", cursor: "pointer",
        flexShrink: 0, padding: 0,
        boxShadow: `0 0 0 1px ${color}55`,
        transition: "transform 0.1s, box-shadow 0.1s",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.2)"; (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 0 0 3px ${color}33`; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 0 0 1px ${color}55`; }}
    />
  );
}

function BankFacilityCard({ bank, allGuarantees, onEdit, onDelete, canManage }: {
  bank: BankGroup;
  allGuarantees: Guarantee[];
  onEdit: (f: Facility) => void;
  onDelete: (f: Facility) => void;
  canManage: boolean;
}) {
  const pct = bank.bank_utilisation_pct;
  const barColor = pct >= 90 ? COLOURS.RED : pct >= 70 ? COLOURS.AMBER : COLOURS.GREEN;
  return (
    <div style={{ ...cardStyle, padding: "16px 18px" }}>
      {/* Bank header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
        <div style={{ fontSize: "16px", fontWeight: 800, color: `var(--text-primary,${COLOURS.NAVY})`, letterSpacing: "-0.2px" }}>{bank.bank_name}</div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "20px", fontWeight: 800, color: barColor, letterSpacing: "-0.5px" }}>{pct}%</div>
          <div style={{ fontSize: "10px", color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.5px" }}>utilised</div>
        </div>
      </div>

      {/* Overall bank bar */}
      <div style={{ height: "6px", borderRadius: "3px", backgroundColor: COLOURS.HAIRLINE, marginBottom: "12px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, backgroundColor: barColor, borderRadius: "3px", transition: "width 0.4s ease" }} />
      </div>

      {/* Bank totals */}
      <div style={{ display: "flex", gap: "16px", fontSize: "12px", marginBottom: "14px" }}>
        <span style={{ color: COLOURS.SLATE }}>Limit <strong style={{ color: `var(--text-primary,${COLOURS.NAVY})` }}>{pkr(bank.bank_total_limit)}</strong></span>
        <span style={{ color: COLOURS.RED }}>Seized <strong>{pkr(bank.bank_seized)}</strong></span>
        <span style={{ color: COLOURS.GREEN }}>Free <strong>{pkr(bank.bank_available)}</strong></span>
      </div>

      {/* Sub-facility breakdown */}
      {bank.sub_facilities.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {bank.sub_facilities.map((sf) => {
            const sfPct = sf.utilisation_pct;
            const sfColor = sfPct >= 90 ? COLOURS.RED : sfPct >= 70 ? COLOURS.AMBER : COLOURS.GREEN;
            const sfGuarantees = allGuarantees.filter((g) => g.facility_id === sf.id && g.status === "Active");
            return (
              <div key={sf.id} style={{ padding: "12px 14px", backgroundColor: COLOURS.CARD_ALT, borderRadius: RADII.SM, border: `1px solid ${COLOURS.HAIRLINE}` }}>
                {/* Facility header: name + edit/delete buttons */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: `var(--text-primary,${COLOURS.NAVY})`, flex: 1 }}>
                    {sf.facility_name || sf.facility_type}
                  </div>
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>{sf.facility_type}</div>
                  {canManage && (
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button onClick={() => onEdit(sf)} style={{ fontSize: "12px", fontWeight: 600, padding: "3px 10px", borderRadius: "6px", border: `1px solid ${COLOURS.NAVY}`, backgroundColor: "transparent", color: COLOURS.NAVY, cursor: "pointer" }}>Edit</button>
                      <button onClick={() => onDelete(sf)} style={{ fontSize: "12px", fontWeight: 600, padding: "3px 10px", borderRadius: "6px", border: `1px solid ${COLOURS.RED}`, backgroundColor: "transparent", color: COLOURS.RED, cursor: "pointer" }}>Delete</button>
                    </div>
                  )}
                </div>

                {/* Utilisation bar */}
                <div style={{ height: "4px", borderRadius: "2px", backgroundColor: COLOURS.HAIRLINE, marginBottom: "10px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(100, sfPct)}%`, backgroundColor: sfColor, borderRadius: "2px", transition: "width 0.4s ease" }} />
                </div>

                {/* Limit / Seized / Free */}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "10px" }}>
                  <span style={{ color: COLOURS.SLATE }}>Limit: <strong style={{ color: `var(--text-primary,${COLOURS.NAVY})` }}>{pkr(sf.total_limit)}</strong></span>
                  <span style={{ color: COLOURS.RED, fontWeight: 600 }}>{pkr(sf.seized)} seized</span>
                  <span style={{ color: COLOURS.GREEN, fontWeight: 600 }}>{pkr(sf.available)} free</span>
                </div>

                {/* Per-type breakdown chips */}
                {sf.type_breakdown && sf.type_breakdown.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: sfGuarantees.length > 0 ? "10px" : "0" }}>
                    {sf.type_breakdown.map((tb) => (
                      <div key={tb.guarantee_type} style={{ padding: "4px 10px", borderRadius: RADII.PILL, fontSize: "11px", backgroundColor: COLOURS.INFO_SOFT, color: COLOURS.BLUE, fontWeight: 600 }}>
                        {tb.guarantee_type}: {pkr(tb.seized)} ({tb.count})
                      </div>
                    ))}
                  </div>
                )}

                {/* Individual Active instruments */}
                {sfGuarantees.length > 0 && (
                  <div style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, paddingTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
                    {sfGuarantees.map((g) => (
                      <div key={g.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 600, color: `var(--text-primary,${COLOURS.NAVY})` }}>{g.customer_name}</span>
                          <span style={{ color: COLOURS.SLATE }}> · {g.guarantee_number}</span>
                          <span style={{ marginLeft: "6px", fontSize: "10px", padding: "1px 6px", borderRadius: "8px", backgroundColor: COLOURS.TRACK, color: COLOURS.SLATE, fontWeight: 600 }}>{g.guarantee_type}</span>
                          {g.chase_urgency === "Overdue" && <span style={{ marginLeft: "4px", fontSize: "10px", color: COLOURS.RED, fontWeight: 700 }}>⚠ Overdue</span>}
                          {g.chase_urgency === "Due soon" && <span style={{ marginLeft: "4px", fontSize: "10px", color: COLOURS.AMBER, fontWeight: 700 }}>⏱ Soon</span>}
                        </div>
                        <span style={{ fontWeight: 700, color: COLOURS.RED, flexShrink: 0, marginLeft: "10px" }}>{pkr(g.amount)}</span>
                      </div>
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
}

// ─── Bill Picker ──────────────────────────────────────────────────────────────
// Searches receivables and lets the user link one as the first bill.
// Falls back to a manual date entry when no receivable exists in the system.

function BillPicker({ linkedId, linkedDate, linkedRef, onLink, onManualDate, manualDate, showManual, onToggleManual }: {
  linkedId: string | null;
  linkedDate: string | null;
  linkedRef: string | null;
  onLink: (id: string | null) => void;
  onManualDate: (d: string) => void;
  manualDate: string;
  showManual: boolean;
  onToggleManual: () => void;
}) {
  const [query, setQuery] = useState(() =>
    linkedId && (linkedRef || linkedDate)
      ? `${linkedRef || "Bill"}${linkedDate ? " (" + formatDateUK(linkedDate) + ")" : ""}`
      : ""
  );
  const [results, setResults] = useState<BillOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function search(q: string) {
    setSearching(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/finance/receivables-search?q=${encodeURIComponent(q)}`, {
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    const json = await res.json();
    setResults(json.bills || []);
    setSearching(false);
  }

  function handleInput(v: string) {
    setQuery(v);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(v), 300);
  }

  function select(b: BillOption) {
    onLink(b.id);
    setQuery(`${b.utility}${b.invoice_ref ? " — " + b.invoice_ref : ""} (${formatDateUK(b.date_submitted)})`);
    setOpen(false);
  }

  function clear() {
    onLink(null);
    setQuery("");
    setResults([]);
  }

  return (
    <div>
      {linkedId ? (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", backgroundColor: COLOURS.SUCCESS_SOFT, borderRadius: RADII.SM, border: `1px solid ${COLOURS.GREEN}40` }}>
          <span style={{ fontSize: "13px", color: COLOURS.GREEN, fontWeight: 600 }}>
            ✓ Linked: {linkedRef || "Bill"} — {linkedDate ? formatDateUK(linkedDate) : "—"}
          </span>
          <button onClick={clear} style={{ marginLeft: "auto", fontSize: "11px", color: COLOURS.SLATE, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Remove</button>
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          <input
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            onFocus={() => { setOpen(true); if (!results.length) search(""); }}
            onBlur={() => setTimeout(() => setOpen(false), 200)}
            placeholder="Search by customer or invoice ref…"
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
          />
          {open && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100, backgroundColor: "#fff", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", maxHeight: "200px", overflowY: "auto" }}>
              {searching && <div style={{ padding: "10px 12px", fontSize: "12px", color: COLOURS.SLATE }}>Searching…</div>}
              {!searching && results.length === 0 && <div style={{ padding: "10px 12px", fontSize: "12px", color: COLOURS.SLATE }}>No bills found</div>}
              {results.map((b) => (
                <div key={b.id} onMouseDown={() => select(b)}
                  style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #f1f5f9", fontSize: "13px" }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f8fafc")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#fff")}
                >
                  <span style={{ fontWeight: 600 }}>{b.utility}</span>
                  {b.invoice_ref && <span style={{ color: COLOURS.SLATE }}> — {b.invoice_ref}</span>}
                  <span style={{ color: COLOURS.SLATE }}> · {formatDateUK(b.date_submitted)} · PKR {Math.round(b.amount).toLocaleString()}</span>
                  <span style={{ marginLeft: "6px", fontSize: "11px", color: b.status === "Collected" ? COLOURS.GREEN : COLOURS.AMBER }}>{b.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div style={{ marginTop: "6px" }}>
        <button type="button" onClick={onToggleManual}
          style={{ fontSize: "12px", color: COLOURS.SLATE, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
          {showManual ? "Hide manual date" : "Bill not in system? Enter date manually"}
        </button>
        {showManual && (
          <div style={{ marginTop: "6px" }}>
            <DateInputWithCalendar value={manualDate} onChange={(e) => onManualDate(e.target.value)} style={{ ...inputStyle, width: "220px" }} />
            <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "3px" }}>Used as fallback if no bill is linked above</div>
          </div>
        )}
      </div>
    </div>
  );
}

const GUARANTEE_TYPES = ["Bid Guarantee", "Pay Order", "Performance Guarantee", "Car Finance Drawdown", "Other"];
const STATUSES = ["Active", "Converted", "Returned", "Released", "Expired"];

function statusBadge(status: string) {
  const map: Record<string, { bg: string; color: string }> = {
    "Active":      { bg: COLOURS.INFO_SOFT,    color: COLOURS.BLUE },
    "Converted":   { bg: "#f5f3ff",            color: COLOURS.PURPLE },
    "Returned":    { bg: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN },
    "Released":    { bg: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN },
    "Expired":     { bg: COLOURS.DANGER_SOFT,  color: COLOURS.RED },
  };
  const s = map[status] || { bg: COLOURS.CARD_ALT, color: COLOURS.SLATE };
  return (
    <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "10px", backgroundColor: s.bg, color: s.color }}>
      {status}
    </span>
  );
}

function urgencyBadge(urgency: string) {
  if (urgency === "Overdue")   return <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "10px", backgroundColor: COLOURS.DANGER_SOFT, color: COLOURS.RED }}>⚠ Overdue</span>;
  if (urgency === "Due soon")  return <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "10px", backgroundColor: COLOURS.WARNING_SOFT, color: COLOURS.AMBER }}>⏱ Due soon</span>;
  return null;
}

const emptyForm = {
  facility_id: "", guarantee_type: "Bid Guarantee", guarantee_number: "", bank_name: "",
  issue_date: "", expiry_date: "", amount: "", cash_margin_pct: "5", bank_charges: "",
  customer_name: "", tender_reference: "", purpose: "", performance_bill_date: "", notes: "",
};

const emptyConvertForm = {
  guarantee_number: "", bank_name: "", issue_date: "", expiry_date: "",
  amount: "", cash_margin_pct: "5", bank_charges: "",
  tender_reference: "", purpose: "", performance_bill_date: "", notes: "", facility_id: "",
};

// ─── Main page ────────────────────────────────────────────────────────────────

export default function GuaranteesPage() {
  const { checking } = useRequireCapability("guarantees");
  const isMobile = useMobile();
  const { show: toast, element: toastEl } = useToast();
  const { confirm, element: confirmEl } = useConfirm();

  const [showFinancials, setShowFinancials] = useState<boolean | null>(null);
  const [canManage, setCanManage] = useState<boolean>(false);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [banks, setBanks] = useState<BankGroup[]>([]);
  const [guarantees, setGuarantees] = useState<Guarantee[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState("Active");
  const [filterType, setFilterType] = useState("All");
  const [filterQuery, setFilterQuery] = useState("");

  // Add guarantee form
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [addBillId, setAddBillId] = useState<string | null>(null);
  const [addBillDate, setAddBillDate] = useState("");
  const [addBillRef, setAddBillRef] = useState<string | null>(null);
  const [addShowManual, setAddShowManual] = useState(false);

  // Edit guarantee
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editBillId, setEditBillId] = useState<string | null>(null);
  const [editBillDate, setEditBillDate] = useState("");
  const [editBillRef, setEditBillRef] = useState<string | null>(null);
  const [editShowManual, setEditShowManual] = useState(false);

  // Convert to Performance Guarantee
  const [convertId, setConvertId] = useState<string | null>(null);
  const [convertForm, setConvertForm] = useState(emptyConvertForm);
  const [savingConvert, setSavingConvert] = useState(false);
  const [convertBillId, setConvertBillId] = useState<string | null>(null);
  const [convertBillDate, setConvertBillDate] = useState("");
  const [convertBillRef, setConvertBillRef] = useState<string | null>(null);
  const [convertShowManual, setConvertShowManual] = useState(false);

  // Mark returned / released
  const [statusActionId, setStatusActionId] = useState<string | null>(null);
  const [returnedDate, setReturnedDate] = useState("");
  const [savingStatus, setSavingStatus] = useState(false);

  // Facility form (add)
  const [showFacilityForm, setShowFacilityForm] = useState(false);
  const [facilityForm, setFacilityForm] = useState({ bank_name: "", facility_name: "", facility_type: "Guarantee Limit", total_limit: "", notes: "" });
  const [savingFacility, setSavingFacility] = useState(false);

  // Facility edit
  const [editFacilityId, setEditFacilityId] = useState<string | null>(null);
  const [editFacilityForm, setEditFacilityForm] = useState({ bank_name: "", facility_name: "", facility_type: "", total_limit: "", notes: "" });
  const [savingEditFacility, setSavingEditFacility] = useState(false);

  // Delete guarantee
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const res = await authedFetch("/api/finance/guarantees");
    const json = await res.json();
    if (json.error) { setError(json.error); setLoading(false); return; }
    setFacilities(json.facilities || []);
    setBanks(json.banks || []);
    setGuarantees(json.guarantees || []);
    setTotals(json.totals || null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (checking) return;
    // Resolve financials permission and load data in one pass
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email) {
        loadUserCtx(user.email).then(async (ctx) => {
          const roleFinancials = canViewGuaranteeFinancials(ctx);
          // 16 Jul 2026, per Khuram: he wants to grant/deny the PKR figures
          // to specific people regardless of their role/department (e.g. an
          // Ops lead he trusts). canViewGuaranteeFinancials() still supplies
          // the sensible role-based default (Finance managers/Admin/CEO);
          // the "guarantees.financials" widget override on top of it is what
          // makes that a per-person choice via Members → Access Control.
          const widgetOverrides = await loadMyWidgetOverrides();
          const financialsVisible = widgetOverrides
            ? widgetVisible({ ...ctx, widgetOverrides }, "guarantees.financials", roleFinancials)
            : roleFinancials;
          setShowFinancials(financialsVisible);
          setCanManage(canManageGuarantees(ctx));
          load();
        });
      }
    });
  }, [checking, load]);

  // ── Filtered list ──
  const visible = guarantees.filter((g) => {
    if (filterStatus !== "All" && g.status !== filterStatus) return false;
    if (filterType   !== "All" && g.guarantee_type !== filterType) return false;
    if (filterQuery) {
      const q = filterQuery.toLowerCase();
      const haystack = `${g.customer_name} ${g.guarantee_number} ${g.bank_name} ${g.tender_reference ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // ── Add guarantee ──
  async function saveAdd() {
    if (!addForm.guarantee_type || !addForm.guarantee_number || !addForm.bank_name || !addForm.issue_date || !addForm.amount || !addForm.customer_name) {
      toast("Please fill all required fields", "error"); return;
    }
    if (!addForm.facility_id) {
      toast("A bank facility must be selected", "error"); return;
    }
    setSaving(true);
    const res = await authedFetch("/api/finance/guarantees", { method: "POST", body: JSON.stringify({
      ...addForm, amount: Number(addForm.amount),
      cash_margin_pct: Number(addForm.cash_margin_pct) || 5,
      bank_charges: Number(addForm.bank_charges) || 0,
      facility_id: addForm.facility_id || null,
      expiry_date: addForm.expiry_date || null,
      performance_bill_date: addShowManual ? (addBillDate || null) : null,
      first_bill_receivable_id: addBillId || null,
    })});
    const json = await res.json();
    setSaving(false);
    if (json.error) { toast(json.error, "error"); return; }
    toast("Guarantee added", "success");
    setShowAddForm(false); setAddForm(emptyForm);
    setAddBillId(null); setAddBillDate(""); setAddBillRef(null); setAddShowManual(false);
    load();
  }

  // ── Edit guarantee ──
  function startEdit(g: Guarantee) {
    setEditId(g.id);
    setEditForm({
      facility_id: g.facility_id || "", guarantee_type: g.guarantee_type,
      guarantee_number: g.guarantee_number, bank_name: g.bank_name,
      issue_date: g.issue_date, expiry_date: g.expiry_date || "",
      amount: String(g.amount), cash_margin_pct: String(g.cash_margin_pct),
      bank_charges: String(g.bank_charges),
      customer_name: g.customer_name, tender_reference: g.tender_reference || "",
      purpose: g.purpose || "", performance_bill_date: g.performance_bill_date || "",
      notes: g.notes || "",
    });
    setEditBillId(g.first_bill_receivable_id || null);
    setEditBillDate(g.performance_bill_date || "");
    setEditBillRef(g.linked_invoice_ref || null);
    setEditShowManual(!g.first_bill_receivable_id && !!g.performance_bill_date);
    setConvertId(null); setStatusActionId(null);
  }

  async function saveEdit() {
    if (!editId) return;
    setSavingEdit(true);
    const res = await authedFetch("/api/finance/guarantees", { method: "PATCH", body: JSON.stringify({
      id: editId, ...editForm,
      amount: Number(editForm.amount),
      cash_margin_pct: Number(editForm.cash_margin_pct) || 5,
      bank_charges: Number(editForm.bank_charges) || 0,
      facility_id: editForm.facility_id || null,
      expiry_date: editForm.expiry_date || null,
      performance_bill_date: editShowManual ? (editBillDate || null) : null,
      first_bill_receivable_id: editBillId || null,
    })});
    const json = await res.json();
    setSavingEdit(false);
    if (json.error) { toast(json.error, "error"); return; }
    toast("Guarantee updated", "success");
    setEditId(null); load();
  }

  // ── Convert to Performance Guarantee ──
  function startConvert(g: Guarantee) {
    setConvertId(g.id);
    setConvertForm({
      ...emptyConvertForm,
      bank_name: g.bank_name,
      customer_name: g.customer_name,
      tender_reference: g.tender_reference || "",
      facility_id: g.facility_id || "",
    } as typeof emptyConvertForm & { customer_name: string });
    setEditId(null); setStatusActionId(null);
  }

  async function saveConvert() {
    if (!convertId) return;
    if (!convertForm.guarantee_number || !convertForm.bank_name || !convertForm.issue_date || !convertForm.amount) {
      toast("Guarantee number, bank, issue date and amount are required", "error"); return;
    }
    if (!convertForm.facility_id) {
      toast("A bank facility must be selected for the Performance Guarantee", "error"); return;
    }
    setSavingConvert(true);
    const res = await authedFetch("/api/finance/guarantees", { method: "PATCH", body: JSON.stringify({
      id: convertId, action: "convert", ...convertForm,
      amount: Number(convertForm.amount),
      cash_margin_pct: Number(convertForm.cash_margin_pct) || 5,
      bank_charges: Number(convertForm.bank_charges) || 0,
      facility_id: convertForm.facility_id || null,
      expiry_date: convertForm.expiry_date || null,
      performance_bill_date: convertShowManual ? (convertBillDate || null) : null,
      first_bill_receivable_id: convertBillId || null,
    })});
    const json = await res.json();
    setSavingConvert(false);
    if (json.error) { toast(json.error, "error"); return; }
    toast("Converted — Performance Guarantee created", "success");
    setConvertId(null);
    setConvertBillId(null); setConvertBillDate(""); setConvertBillRef(null); setConvertShowManual(false);
    load();
  }

  // ── Mark returned / released ──
  async function saveStatusAction(id: string, status: "Returned" | "Released") {
    setSavingStatus(true);
    const body: Record<string, unknown> = { id, status };
    if (status === "Returned" && returnedDate) body.returned_date = returnedDate;
    const res = await authedFetch("/api/finance/guarantees", { method: "PATCH", body: JSON.stringify(body) });
    const json = await res.json();
    setSavingStatus(false);
    if (json.error) { toast(json.error, "error"); return; }
    toast(`Marked as ${status}`, "success");
    setStatusActionId(null); setReturnedDate(""); load();
  }

  // ── Add facility ──
  async function saveFacility() {
    if (!facilityForm.bank_name || !facilityForm.total_limit) { toast("Bank name and limit are required", "error"); return; }
    setSavingFacility(true);
    const res = await authedFetch("/api/finance/guarantee-facilities", { method: "POST", body: JSON.stringify({
      ...facilityForm, total_limit: Number(facilityForm.total_limit),
    })});
    const json = await res.json();
    setSavingFacility(false);
    if (json.error) { toast(json.error, "error"); return; }
    toast("Facility added", "success");
    setShowFacilityForm(false); setFacilityForm({ bank_name: "", facility_name: "", facility_type: "Guarantee Limit", total_limit: "", notes: "" });
    load();
  }

  // ── Edit facility ──
  function startEditFacility(f: Facility) {
    setEditFacilityId(f.id);
    setEditFacilityForm({
      bank_name: f.bank_name, facility_name: f.facility_name || "",
      facility_type: f.facility_type, total_limit: String(f.total_limit), notes: f.notes || "",
    });
    setShowFacilityForm(false);
  }

  async function saveEditFacility() {
    if (!editFacilityId) return;
    if (!editFacilityForm.bank_name || !editFacilityForm.facility_name || !editFacilityForm.total_limit) {
      toast("Bank name, facility name and limit are required", "error"); return;
    }
    setSavingEditFacility(true);
    const res = await authedFetch("/api/finance/guarantee-facilities", { method: "PATCH", body: JSON.stringify({
      id: editFacilityId, ...editFacilityForm, total_limit: Number(editFacilityForm.total_limit),
    })});
    const json = await res.json();
    setSavingEditFacility(false);
    if (json.error) { toast(json.error, "error"); return; }
    toast("Facility updated", "success");
    setEditFacilityId(null); load();
  }

  // ── Delete facility ──
  async function deleteFacility(f: Facility) {
    if (!confirm(`Delete "${f.facility_name || f.facility_type}" at ${f.bank_name}? This cannot be undone.`)) return;
    const res = await authedFetch("/api/finance/guarantee-facilities", { method: "DELETE", body: JSON.stringify({ id: f.id }) });
    const json = await res.json();
    if (json.error) { toast(json.error, "error"); return; }
    toast("Facility deleted", "success");
    load();
  }

  // ── Delete guarantee ──
  async function deleteGuarantee(g: Guarantee) {
    const confirmed = await confirm(
      g.status === "Active"
        ? `This guarantee is still Active. Are you sure you want to delete it? This cannot be undone.`
        : `Delete this guarantee (${g.customer_name} — ${g.guarantee_number})? This cannot be undone.`
    );
    if (!confirmed) return;
    setDeletingId(g.id);
    const res = await authedFetch("/api/finance/guarantees", { method: "DELETE", body: JSON.stringify({ id: g.id }) });
    const json = await res.json();
    setDeletingId(null);
    if (json.error) { toast(json.error, "error"); return; }
    toast("Guarantee deleted", "success");
    load();
  }

  if (checking) return <AuthWrapper><main style={{ padding: "14px 18px" }}><p style={{ color: COLOURS.SLATE }}>Checking permissions…</p></main></AuthWrapper>;

  const convertTarget = convertId ? guarantees.find((g) => g.id === convertId) : null;

  // Overdue = expired, or past its release-due date, and still sitting Active/
  // Converted unactioned. Same "chase_urgency" the summary cards already count —
  // this just surfaces the individual guarantees so they can't be missed.
  const overdueGuarantees = guarantees.filter((g) => g.chase_urgency === "Overdue");

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
        <PageHeader />

        <div style={{ marginBottom: "4px" }}>
          <SectionTitle title="Bank Facilities" style={{ margin: "0 0 2px" }} />
          <p style={{ fontSize: "13px", color: COLOURS.SLATE, margin: "0 0 16px" }}>Unze Trading — bank facilities, bid guarantees, pay orders &amp; performance guarantees</p>
        </div>

        {/* ── Overdue guarantees — top-of-page alert, impossible to miss ── */}
        {overdueGuarantees.length > 0 && (
          <div style={{ border: `1px solid ${COLOURS.RED}`, borderLeft: `4px solid ${COLOURS.RED}`, borderRadius: "8px", backgroundColor: COLOURS.DANGER_SOFT, padding: "12px 16px", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <span style={{ fontSize: "17px" }}>⚠</span>
              <span style={{ fontSize: "15px", fontWeight: 800, color: COLOURS.RED }}>
                {overdueGuarantees.length} guarantee{overdueGuarantees.length > 1 ? "s" : ""} overdue — needs chasing now
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {overdueGuarantees.map((g) => (
                <div key={g.id} style={{ fontSize: "13px", color: `var(--text-primary,${COLOURS.NAVY})`, display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "baseline" }}>
                  <span style={{ fontWeight: 700 }}>{g.customer_name}</span>
                  <span style={{ color: COLOURS.SLATE }}>— {g.guarantee_number} · {g.bank_name} · {g.guarantee_type}</span>
                  {g.expiry_date && <span style={{ color: COLOURS.RED, fontWeight: 600 }}>Expired {formatDateUK(g.expiry_date)}{g.days_to_expiry !== null ? ` (${Math.abs(g.days_to_expiry)}d ago)` : ""}</span>}
                  {!g.expiry_date && g.release_due_date && <span style={{ color: COLOURS.RED, fontWeight: 600 }}>Release was due {formatDateUK(g.release_due_date)}</span>}
                  {showFinancials && <span style={{ color: COLOURS.SLATE }}>· {pkr(g.amount)}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Action bar — both buttons, same size, at the top ── */}
        {canManage && (
          <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
            {(() => {
              const btnBase: React.CSSProperties = {
                padding: "7px 18px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 600,
                cursor: "pointer", transition: "opacity 0.1s", fontFamily: "var(--font-sans, Inter, sans-serif)",
              };
              const activeForm = showAddForm ? "guarantee" : showFacilityForm ? "facility" : null;
              return (
                <>
                  <button
                    onClick={() => { setShowFacilityForm((v) => !v); setShowAddForm(false); setEditId(null); setConvertId(null); setStatusActionId(null); }}
                    style={{ ...btnBase, backgroundColor: activeForm === "facility" ? COLOURS.NAVY : COLOURS.CARD_ALT, color: activeForm === "facility" ? "#fff" : COLOURS.NAVY, border: `1px solid ${COLOURS.NAVY}` }}
                  >{activeForm === "facility" ? "✕ Cancel" : "+ New Facility"}</button>
                  <button
                    onClick={() => { setShowAddForm((v) => !v); setShowFacilityForm(false); setEditId(null); setConvertId(null); setStatusActionId(null); }}
                    style={{ ...btnBase, backgroundColor: activeForm === "guarantee" ? COLOURS.NAVY : COLOURS.CARD_ALT, color: activeForm === "guarantee" ? "#fff" : COLOURS.NAVY, border: `1px solid ${COLOURS.NAVY}` }}
                  >{activeForm === "guarantee" ? "✕ Cancel" : "+ New Guarantee"}</button>
                </>
              );
            })()}
          </div>
        )}

        {/* ── Inline panel — opens at the top, used for both New Facility and New Guarantee ── */}
        {canManage && showFacilityForm && (
          <div style={{ ...cardStyle, border: `1.5px solid ${COLOURS.NAVY}`, padding: "14px 16px", marginBottom: "16px" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "12px" }}>New Bank Facility</div>
            <FacilityForm facilityForm={facilityForm} setFacilityForm={setFacilityForm} saveFacility={saveFacility} savingFacility={savingFacility} isMobile={isMobile} />
          </div>
        )}

        {canManage && showAddForm && (
          <div style={{ ...cardStyle, border: `1.5px solid ${COLOURS.NAVY}`, padding: "14px 16px", marginBottom: "16px" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "12px" }}>New Guarantee / Pay Order</div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3,1fr)", gap: "10px" }}>
              <Field label="Type *">
                <select value={addForm.guarantee_type} onChange={(e) => setAddForm({ ...addForm, guarantee_type: e.target.value })} style={{ ...inputStyle, width: "100%" }}>
                  {GUARANTEE_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Facility * (sets bank)">
                <select value={addForm.facility_id} onChange={(e) => {
                  const sel = banks.flatMap((b) => b.sub_facilities).find((f) => f.id === e.target.value);
                  setAddForm({ ...addForm, facility_id: e.target.value, bank_name: sel ? sel.bank_name : "" });
                }} style={{ ...inputStyle, width: "100%", borderColor: !addForm.facility_id ? "#fca5a5" : undefined }}>
                  <option value="">— Select facility —</option>
                  {banks.flatMap((b) => b.sub_facilities).map((f) => <option key={f.id} value={f.id}>{f.bank_name} — {f.facility_name || f.facility_type} (free: {pkr(f.available)})</option>)}
                </select>
                {addForm.facility_id && (() => {
                  const sel = banks.flatMap((b) => b.sub_facilities).find((f) => f.id === addForm.facility_id);
                  if (!sel) return null;
                  const over = Number(addForm.amount) > 0 && Number(addForm.amount) > sel.available;
                  return <div style={{ marginTop: "3px", fontSize: "11px", fontWeight: 600, color: over ? COLOURS.RED : COLOURS.GREEN }}>{over ? `⚠ Over by ${pkr(Number(addForm.amount) - sel.available)}` : `Free: ${pkr(sel.available)}`}</div>;
                })()}
              </Field>
              <Field label="Customer / Beneficiary *">
                <input value={addForm.customer_name} onChange={(e) => setAddForm({ ...addForm, customer_name: e.target.value })} placeholder="e.g. FESCO, MEPCO" style={{ ...inputStyle, width: "100%" }} />
              </Field>
              <Field label="Guarantee / PO number *">
                <input value={addForm.guarantee_number} onChange={(e) => setAddForm({ ...addForm, guarantee_number: e.target.value })} placeholder="Bank-issued reference" style={{ ...inputStyle, width: "100%" }} />
              </Field>
              <Field label="Issue date *"><DateInputWithCalendar value={addForm.issue_date} onChange={(e) => setAddForm({ ...addForm, issue_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
              <Field label="Expiry date"><DateInputWithCalendar value={addForm.expiry_date} onChange={(e) => setAddForm({ ...addForm, expiry_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
              <Field label="Amount (PKR) *"><input type="number" min="0" value={addForm.amount} onChange={(e) => setAddForm({ ...addForm, amount: e.target.value })} placeholder="0" style={{ ...inputStyle, width: "100%" }} /></Field>
              <Field label="Cash margin %">
                <input type="number" min="0" max="100" value={addForm.cash_margin_pct} onChange={(e) => setAddForm({ ...addForm, cash_margin_pct: e.target.value })} style={{ ...inputStyle, width: "100%" }} />
              </Field>
              <Field label="Bank charges (PKR)"><input type="number" min="0" value={addForm.bank_charges} onChange={(e) => setAddForm({ ...addForm, bank_charges: e.target.value })} placeholder="0" style={{ ...inputStyle, width: "100%" }} /></Field>
              <Field label="Tender reference"><input value={addForm.tender_reference} onChange={(e) => setAddForm({ ...addForm, tender_reference: e.target.value })} placeholder="Optional" style={{ ...inputStyle, width: "100%" }} /></Field>
            </div>
            {addForm.guarantee_type === "Performance Guarantee" && (
              <div style={{ marginTop: "10px" }}>
                <Field label="1st bill (links expiry clock)">
                  <BillPicker linkedId={addBillId} linkedDate={null} linkedRef={addBillRef}
                    onLink={(id) => setAddBillId(id)} onManualDate={(d) => setAddBillDate(d)}
                    manualDate={addBillDate} showManual={addShowManual} onToggleManual={() => setAddShowManual((v) => !v)} />
                </Field>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px", marginTop: "2px" }}>
              <Field label="Purpose">
                <input value={addForm.purpose} onChange={(e) => setAddForm({ ...addForm, purpose: e.target.value })} placeholder="e.g. PC Spun Poles bid for FESCO PO 4640" style={{ ...inputStyle, width: "100%" }} />
              </Field>
              <Field label="Notes">
                <input value={addForm.notes} onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })} style={{ ...inputStyle, width: "100%" }} />
              </Field>
            </div>
            <div style={{ marginTop: "12px" }}>
              <button onClick={saveAdd} disabled={saving} style={{ ...primaryButtonStyle, opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : "Add Guarantee"}</button>
            </div>
          </div>
        )}

        {/* ── Summary strip — Ops: counts only, no PKR amounts ── */}
        {showFinancials === false && totals && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px", marginBottom: "18px" }}>
            <CountCard label="Active guarantees" value={totals.active_count} color={COLOURS.BLUE} sub="Currently issued" />
            <CountCard label="Overdue" value={totals.overdue_count} color={totals.overdue_count > 0 ? COLOURS.RED : COLOURS.GREEN} sub={totals.overdue_count > 0 ? "Needs chasing now" : "None overdue"} />
            <CountCard label="Due soon" value={totals.due_soon_count} color={totals.due_soon_count > 0 ? COLOURS.AMBER : COLOURS.GREEN} sub={totals.due_soon_count > 0 ? "Expiring within 30 days" : "None due soon"} />
          </div>
        )}

        {/* ── Summary strip — Finance only ── */}
        {showFinancials && totals && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px", marginBottom: "18px" }}>
            <CountCard
              label="Active guarantees"
              value={totals.active_count}
              color={totals.overdue_count > 0 ? COLOURS.RED : totals.due_soon_count > 0 ? COLOURS.AMBER : COLOURS.GREEN}
              sub={totals.overdue_count > 0 ? `${totals.overdue_count} overdue` : totals.due_soon_count > 0 ? `${totals.due_soon_count} due soon` : "All OK"}
            />
            <CountCard label="Total facility seized" value={pkr(totals.total_amount_active)} color={COLOURS.NAVY} sub="Face value of active guarantees" />
            <CountCard label="Cash margin stuck" value={pkr(totals.total_cash_margin_stuck)} color={COLOURS.AMBER} sub="5% held by banks as collateral" />
            <CountCard label="Bank charges paid" value={pkr(totals.total_bank_charges)} color={COLOURS.NAVY} sub="All-time issuance charges" />
          </div>
        )}

        {/* ── Bank facility utilisation ── shown to anyone with financials
            visibility, not just people who can manage — edit/delete
            buttons inside BankFacilityCard stay gated on canManage
            separately, so this just becomes read-only for them. */}
        {(canManage || showFinancials) && (
          <div style={{ marginBottom: "18px" }}>
            <SectionTitle title="Bank Facility Utilisation" />

            {/* Edit facility inline panel */}
            {editFacilityId && (
              <div style={{ border: `1.5px solid ${COLOURS.NAVY}`, borderRadius: "10px", padding: "14px 16px", backgroundColor: "var(--bg-card,#fff)", marginBottom: "10px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                  <div style={{ display: "flex", gap: "5px" }}>
                    <TrafficDot color="#ff5f57" title="Cancel edit" onClick={() => setEditFacilityId(null)} />
                    <TrafficDot color="#ffbd2e" title="Editing…" onClick={() => {}} />
                    <TrafficDot color="#28c840" title="Save changes" onClick={saveEditFacility} />
                  </div>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: `var(--text-primary,${COLOURS.NAVY})` }}>Edit Facility</span>
                  {savingEditFacility && <span style={{ fontSize: "12px", color: COLOURS.SLATE, marginLeft: "auto" }}>Saving…</span>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3,1fr)", gap: "10px" }}>
                  <Field label="Bank *">
                    <select value={editFacilityForm.bank_name} onChange={(e) => setEditFacilityForm({ ...editFacilityForm, bank_name: e.target.value })} style={{ ...inputStyle, width: "100%" }}>
                      <option value="">— Select bank —</option>
                      {BANKS.map((b) => <option key={b}>{b}</option>)}
                    </select>
                  </Field>
                  <Field label="Facility name *"><input value={editFacilityForm.facility_name} onChange={(e) => setEditFacilityForm({ ...editFacilityForm, facility_name: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                  <Field label="Facility type">
                    <select value={editFacilityForm.facility_type} onChange={(e) => setEditFacilityForm({ ...editFacilityForm, facility_type: e.target.value })} style={{ ...inputStyle, width: "100%" }}>
                      {FACILITY_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Total limit (PKR) *"><input type="number" min="0" value={editFacilityForm.total_limit} onChange={(e) => setEditFacilityForm({ ...editFacilityForm, total_limit: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                  <Field label="Notes"><input value={editFacilityForm.notes} onChange={(e) => setEditFacilityForm({ ...editFacilityForm, notes: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                </div>
                <div style={{ marginTop: "10px" }}>
                  <button onClick={saveEditFacility} disabled={savingEditFacility} style={{ ...primaryButtonStyle, fontSize: "13px", padding: "6px 16px", opacity: savingEditFacility ? 0.6 : 1 }}>{savingEditFacility ? "Saving…" : "Save changes"}</button>
                </div>
              </div>
            )}

            {banks.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "12px" }}>
                {banks.map((b) => <BankFacilityCard key={b.bank_name} bank={b} allGuarantees={guarantees} onEdit={startEditFacility} onDelete={deleteFacility} canManage={canManage} />)}
              </div>
            ) : !loading && (
              <div style={{ padding: "18px", textAlign: "center", color: COLOURS.SLATE, fontSize: "13px", border: `1px dashed ${COLOURS.HAIRLINE}`, borderRadius: "8px" }}>
                No facilities set up yet. Click <strong>+ New Facility</strong> above to add one.
              </div>
            )}
          </div>
        )}

        {/* ── Guarantee list ── */}
        <SectionTitle title="Guarantees" />
        <div style={{
          display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap", alignItems: "center",
          position: "sticky", top: 0, zIndex: 10, backgroundColor: "var(--bg-page, #f4f6f9)", paddingTop: "4px", paddingBottom: "4px",
        }}>
          <input
            type="text"
            placeholder="Search by customer, guarantee number, bank…"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            style={{ ...inputStyle, flex: "1 1 240px", maxWidth: "360px" }}
          />
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ ...inputStyle, width: "auto", padding: "8px 10px", fontSize: "13px" }}>
            <option value="All">All statuses</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ ...inputStyle, width: "auto", padding: "8px 10px", fontSize: "13px" }}>
            <option value="All">All types</option>
            {GUARANTEE_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>

        {loading ? (
          <div style={{ color: COLOURS.SLATE, fontSize: "14px" }}>Loading…</div>
        ) : error ? (
          <div style={{ color: COLOURS.RED, fontSize: "14px", padding: "12px", backgroundColor: COLOURS.DANGER_SOFT, borderRadius: "8px" }}>{error}</div>
        ) : visible.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px", color: COLOURS.SLATE, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", backgroundColor: "var(--bg-card,#fff)" }}>
            No guarantees found. {filterStatus !== "All" || filterType !== "All" || filterQuery ? "Try clearing filters or the search box." : showFinancials ? "Add the first one above." : "None recorded yet."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {visible.map((g) => {
              const isEditing   = editId      === g.id;
              const isConverting= convertId   === g.id;
              const isActioning = statusActionId === g.id;
              const canConvert  = (g.guarantee_type === "Bid Guarantee" || g.guarantee_type === "Pay Order") && g.status === "Active";
              const canReturn   = g.status === "Active" || g.status === "Converted";
              const canRelease  = g.guarantee_type === "Performance Guarantee" && g.status === "Active";

              return (
                <div key={g.id} style={{ border: `1px solid var(--border-color,${COLOURS.HAIRLINE})`, borderRadius: "10px", backgroundColor: "var(--bg-card,#fff)", overflow: "hidden",
                  borderLeft: `4px solid ${g.chase_urgency === "Overdue" ? COLOURS.RED : g.chase_urgency === "Due soon" ? COLOURS.AMBER : g.status === "Active" ? COLOURS.BLUE : COLOURS.SLATE}`,
                  opacity: ["Returned","Released","Expired"].includes(g.status) ? 0.7 : 1 }}>

                  {/* Row header */}
                  <div style={{ padding: "12px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "8px" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "4px" }}>
                          <span style={{ fontSize: "15px", fontWeight: 700, color: `var(--text-primary,${COLOURS.NAVY})` }}>
                            {g.customer_name} — {g.guarantee_number}
                          </span>
                          <span style={{ fontSize: "12px", padding: "1px 8px", borderRadius: "10px", backgroundColor: COLOURS.TRACK, color: COLOURS.SLATE, fontWeight: 600 }}>
                            {g.guarantee_type}
                          </span>
                          {statusBadge(g.status)}
                          {urgencyBadge(g.chase_urgency)}
                        </div>
                        <div style={{ fontSize: "12px", color: COLOURS.SLATE, display: "flex", gap: "14px", flexWrap: "wrap" }}>
                          <span>Bank: <strong>{g.bank_name}</strong></span>
                          <span>Issued: {formatDateUK(g.issue_date)}</span>
                          {g.expiry_date && <span>Expires: <strong style={{ color: g.chase_urgency === "Overdue" ? COLOURS.RED : g.chase_urgency === "Due soon" ? COLOURS.AMBER : "inherit" }}>{formatDateUK(g.expiry_date)}</strong></span>}
                          {g.tender_reference && <span>Ref: {g.tender_reference}</span>}
                        </div>
                        {g.purpose && <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px", fontStyle: "italic" }}>{g.purpose}</div>}
                        {g.guarantee_type === "Performance Guarantee" && g.effective_bill_date && (
                          <div style={{ fontSize: "12px", color: COLOURS.PURPLE, marginTop: "3px" }}>
                            {g.linked_invoice_ref ? (
                              <>Bill: <strong>{g.linked_invoice_ref}</strong> — {formatDateUK(g.effective_bill_date)}</>
                            ) : (
                              <>Bill submitted: {formatDateUK(g.effective_bill_date)}</>
                            )}
                            {g.release_due_date && <> · Release due: <strong>{formatDateUK(g.release_due_date)}</strong></>}
                          </div>
                        )}
                        {g.returned_date && <div style={{ fontSize: "12px", color: COLOURS.GREEN, marginTop: "2px" }}>Returned: {formatDateUK(g.returned_date)}</div>}
                      </div>

                      {/* Financials — Finance only */}
                      {showFinancials && (
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: "16px", fontWeight: 800, color: `var(--text-primary,${COLOURS.NAVY})` }}>{pkr(g.amount)}</div>
                          <div style={{ fontSize: "12px", color: COLOURS.AMBER }}>Margin: {pkr(g.cash_margin_amount)}</div>
                          {g.bank_charges > 0 && <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Charges: {pkr(g.bank_charges)}</div>}
                        </div>
                      )}
                    </div>

                    {/* Action buttons — Finance managers only */}
                    {canManage && !isEditing && !isConverting && !isActioning && (
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "10px" }}>
                        <button onClick={() => startEdit(g)} style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "var(--bg-card,#fff)", color: COLOURS.SLATE, cursor: "pointer" }}>Edit</button>
                        {canConvert && (
                          <button onClick={() => startConvert(g)} style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: 700, border: `1px solid ${COLOURS.PURPLE}`, backgroundColor: "#f5f3ff", color: COLOURS.PURPLE, cursor: "pointer" }}>
                            Tender Won → Convert
                          </button>
                        )}
                        {canRelease && (
                          <button onClick={() => { setStatusActionId(g.id); setEditId(null); setConvertId(null); }} style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: 700, border: `1px solid ${COLOURS.GREEN}`, backgroundColor: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN, cursor: "pointer" }}>
                            Mark Released
                          </button>
                        )}
                        {canReturn && !canRelease && (
                          <button onClick={() => { setStatusActionId(g.id); setEditId(null); setConvertId(null); }} style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: 700, border: `1px solid ${COLOURS.GREEN}`, backgroundColor: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN, cursor: "pointer" }}>
                            Mark Returned
                          </button>
                        )}
                        <button
                          onClick={() => deleteGuarantee(g)}
                          disabled={deletingId === g.id}
                          style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, border: `1px solid ${COLOURS.RED}40`, backgroundColor: COLOURS.DANGER_SOFT, color: COLOURS.RED, cursor: "pointer", marginLeft: "auto", opacity: deletingId === g.id ? 0.6 : 1 }}>
                          {deletingId === g.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* ── Edit form — Finance managers only ── */}
                  {canManage && isEditing && (
                    <div style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, padding: "14px", backgroundColor: COLOURS.CARD_ALT }}>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "10px" }}>Edit Guarantee</div>
                      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px" }}>
                        <Field label="Type">
                          <select value={editForm.guarantee_type} onChange={(e) => setEditForm({ ...editForm, guarantee_type: e.target.value })} style={{ ...inputStyle, width: "100%" }}>
                            {GUARANTEE_TYPES.map((t) => <option key={t}>{t}</option>)}
                          </select>
                        </Field>
                        <Field label="Customer *"><input value={editForm.customer_name} onChange={(e) => setEditForm({ ...editForm, customer_name: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Guarantee number *"><input value={editForm.guarantee_number} onChange={(e) => setEditForm({ ...editForm, guarantee_number: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Bank facility * (bank is set automatically)">
                          <select value={editForm.facility_id} onChange={(e) => {
                            const sel = banks.flatMap((b) => b.sub_facilities).find((f) => f.id === e.target.value);
                            setEditForm({ ...editForm, facility_id: e.target.value, bank_name: sel ? sel.bank_name : editForm.bank_name });
                          }} style={{ ...inputStyle, width: "100%", borderColor: !editForm.facility_id ? "#fca5a5" : undefined }}>
                            <option value="">— Select facility —</option>
                            {banks.flatMap((b) => b.sub_facilities).map((f) => <option key={f.id} value={f.id}>{f.bank_name} — {f.facility_name || f.facility_type} (free: {pkr(f.available)})</option>)}
                          </select>
                          {editForm.facility_id && (() => {
                            const sel = banks.flatMap((b) => b.sub_facilities).find((f) => f.id === editForm.facility_id);
                            if (!sel) return null;
                            const requestedAmt = Number(editForm.amount) || 0;
                            const wouldExceed = requestedAmt > 0 && requestedAmt > sel.available + (editId ? (guarantees.find((gg) => gg.id === editId && gg.facility_id === editForm.facility_id)?.amount || 0) : 0);
                            return (
                              <div style={{ marginTop: "4px", fontSize: "11px", color: wouldExceed ? COLOURS.RED : COLOURS.GREEN, fontWeight: 600 }}>
                                {wouldExceed
                                  ? `⚠ May exceed available capacity`
                                  : `Bank: ${sel.bank_name} · Available: ${pkr(sel.available)}`}
                              </div>
                            );
                          })()}
                        </Field>
                        <Field label="Issue date"><DateInputWithCalendar value={editForm.issue_date} onChange={(e) => setEditForm({ ...editForm, issue_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Expiry date"><DateInputWithCalendar value={editForm.expiry_date} onChange={(e) => setEditForm({ ...editForm, expiry_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Amount (PKR)"><input type="number" min="0" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Cash margin %"><input type="number" min="0" max="100" value={editForm.cash_margin_pct} onChange={(e) => setEditForm({ ...editForm, cash_margin_pct: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Bank charges (PKR)"><input type="number" min="0" value={editForm.bank_charges} onChange={(e) => setEditForm({ ...editForm, bank_charges: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Tender reference"><input value={editForm.tender_reference} onChange={(e) => setEditForm({ ...editForm, tender_reference: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                      </div>
                      {editForm.guarantee_type === "Performance Guarantee" && (
                        <Field label="1st bill (links expiry clock — search by customer or invoice ref)">
                          <BillPicker
                            linkedId={editBillId}
                            linkedDate={g.linked_bill_date}
                            linkedRef={editBillRef}
                            onLink={(id) => setEditBillId(id)}
                            onManualDate={(d) => setEditBillDate(d)}
                            manualDate={editBillDate}
                            showManual={editShowManual}
                            onToggleManual={() => setEditShowManual((v) => !v)}
                          />
                        </Field>
                      )}
                      <Field label="Purpose"><textarea value={editForm.purpose} onChange={(e) => setEditForm({ ...editForm, purpose: e.target.value })} rows={2} style={{ ...inputStyle, width: "100%", resize: "vertical" }} /></Field>
                      <Field label="Notes"><textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={2} style={{ ...inputStyle, width: "100%", resize: "vertical" }} /></Field>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button onClick={saveEdit} disabled={savingEdit} style={{ ...primaryButtonStyle, fontSize: "13px", padding: "6px 14px", opacity: savingEdit ? 0.6 : 1 }}>{savingEdit ? "Saving…" : "Save changes"}</button>
                        <button onClick={() => setEditId(null)} style={{ padding: "6px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "var(--bg-card,#fff)", color: COLOURS.SLATE, cursor: "pointer" }}>Cancel</button>
                      </div>
                    </div>
                  )}

                  {/* ── Convert to Performance Guarantee form — Finance managers only ── */}
                  {canManage && isConverting && convertTarget && (
                    <div style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, padding: "14px", backgroundColor: "#f5f3ff" }}>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.PURPLE, marginBottom: "6px" }}>Convert to Performance Guarantee</div>
                      <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "12px" }}>
                        The original {g.guarantee_type} ({g.guarantee_number}) will be marked <strong>Converted</strong> and a new Performance Guarantee will be created.
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px" }}>
                        <Field label="New guarantee number *"><input value={convertForm.guarantee_number} onChange={(e) => setConvertForm({ ...convertForm, guarantee_number: e.target.value })} placeholder="New PG number from bank" style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Bank facility * (bank is set automatically)">
                          <select value={convertForm.facility_id} onChange={(e) => {
                            const sel = banks.flatMap((b) => b.sub_facilities).find((f) => f.id === e.target.value);
                            setConvertForm({ ...convertForm, facility_id: e.target.value, bank_name: sel ? sel.bank_name : convertForm.bank_name });
                          }} style={{ ...inputStyle, width: "100%", borderColor: !convertForm.facility_id ? "#fca5a5" : undefined }}>
                            <option value="">— Select facility —</option>
                            {banks.flatMap((b) => b.sub_facilities).map((f) => <option key={f.id} value={f.id}>{f.bank_name} — {f.facility_name || f.facility_type} (free: {pkr(f.available)})</option>)}
                          </select>
                          {convertForm.facility_id && (() => {
                            const sel = banks.flatMap((b) => b.sub_facilities).find((f) => f.id === convertForm.facility_id);
                            return sel ? <div style={{ marginTop: "4px", fontSize: "11px", color: COLOURS.GREEN, fontWeight: 600 }}>Bank: {sel.bank_name} · Available: {pkr(sel.available)}</div> : null;
                          })()}
                        </Field>
                        <Field label="Issue date *"><DateInputWithCalendar value={convertForm.issue_date} onChange={(e) => setConvertForm({ ...convertForm, issue_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Expiry date"><DateInputWithCalendar value={convertForm.expiry_date} onChange={(e) => setConvertForm({ ...convertForm, expiry_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Amount (PKR) *"><input type="number" min="0" value={convertForm.amount} onChange={(e) => setConvertForm({ ...convertForm, amount: e.target.value })} placeholder="Performance guarantee amount" style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Cash margin %"><input type="number" min="0" max="100" value={convertForm.cash_margin_pct} onChange={(e) => setConvertForm({ ...convertForm, cash_margin_pct: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Bank charges (PKR)"><input type="number" min="0" value={convertForm.bank_charges} onChange={(e) => setConvertForm({ ...convertForm, bank_charges: e.target.value })} placeholder="0" style={{ ...inputStyle, width: "100%" }} /></Field>
                      </div>
                      <Field label="1st bill (links 12-month expiry clock — search by customer or invoice ref)">
                        <BillPicker
                          linkedId={convertBillId}
                          linkedDate={null}
                          linkedRef={convertBillRef}
                          onLink={(id) => setConvertBillId(id)}
                          onManualDate={(d) => setConvertBillDate(d)}
                          manualDate={convertBillDate}
                          showManual={convertShowManual}
                          onToggleManual={() => setConvertShowManual((v) => !v)}
                        />
                      </Field>
                      <Field label="Notes"><textarea value={convertForm.notes} onChange={(e) => setConvertForm({ ...convertForm, notes: e.target.value })} rows={2} style={{ ...inputStyle, width: "100%", resize: "vertical" }} /></Field>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button onClick={saveConvert} disabled={savingConvert} style={{ ...primaryButtonStyle, fontSize: "13px", padding: "6px 14px", backgroundColor: COLOURS.PURPLE, opacity: savingConvert ? 0.6 : 1 }}>{savingConvert ? "Saving…" : "Confirm Conversion"}</button>
                        <button onClick={() => setConvertId(null)} style={{ padding: "6px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "var(--bg-card,#fff)", color: COLOURS.SLATE, cursor: "pointer" }}>Cancel</button>
                      </div>
                    </div>
                  )}

                  {/* ── Mark Returned / Released — Finance managers only ── */}
                  {canManage && isActioning && (
                    <div style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, padding: "14px", backgroundColor: COLOURS.SUCCESS_SOFT }}>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.GREEN, marginBottom: "10px" }}>
                        {canRelease ? "Mark as Released" : "Mark as Returned to Bank"}
                      </div>
                      <Field label={canRelease ? "Release date" : "Return date"}>
                        <DateInputWithCalendar value={returnedDate} onChange={(e) => setReturnedDate(e.target.value)} style={{ ...inputStyle, width: "260px" }} />
                      </Field>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          onClick={() => saveStatusAction(g.id, canRelease ? "Released" : "Returned")}
                          disabled={savingStatus}
                          style={{ padding: "6px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 700, border: "none", backgroundColor: COLOURS.GREEN, color: "#fff", cursor: "pointer", opacity: savingStatus ? 0.6 : 1 }}
                        >{savingStatus ? "Saving…" : canRelease ? "Confirm Released" : "Confirm Returned"}</button>
                        <button onClick={() => { setStatusActionId(null); setReturnedDate(""); }} style={{ padding: "6px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "var(--bg-card,#fff)", color: COLOURS.SLATE, cursor: "pointer" }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {toastEl}
        {confirmEl}
      </main>
    </AuthWrapper>
  );
}
