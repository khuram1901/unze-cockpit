"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import AuthWrapper from "../../lib/AuthWrapper";
import { useRequireCapability, loadUserCtx } from "../../lib/useRouteGuard";
import { supabase } from "../../lib/supabase";
import { canViewGuaranteeFinancials } from "../../lib/permissions";
import { useMobile } from "../../lib/useMobile";
import { COLOURS, PageHeader, SectionTitle, useToast, useConfirm, primaryButtonStyle, inputStyle, labelStyle } from "../../lib/SharedUI";
import { formatDateUK } from "../../lib/dateUtils";
import DateInput from "../../lib/DateInput";

// ─── Types ────────────────────────────────────────────────────────────────────

type Facility = {
  id: string; bank_name: string; facility_name: string | null; facility_type: string;
  total_limit: number; seized: number; available: number;
  utilisation_pct: number; notes: string | null; active: boolean;
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
          <input value={facilityForm.bank_name} onChange={(e) => setFacilityForm({ ...facilityForm, bank_name: e.target.value })}
            placeholder="e.g. HBL, Faysal Bank, MCB" style={{ ...inputStyle, width: "100%" }} />
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

function BankFacilityCard({ bank, onEdit }: { bank: BankGroup; onEdit: (f: Facility) => void }) {
  const pct = bank.bank_utilisation_pct;
  const barColor = pct >= 90 ? "#dc2626" : pct >= 70 ? "#d97706" : "#16a34a";
  return (
    <div style={{ padding: "14px 16px", backgroundColor: "var(--bg-card,#fff)", borderRadius: "10px", border: "1px solid var(--border-color,#e2e8f0)" }}>
      {/* Bank header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
        <div style={{ fontSize: "15px", fontWeight: 800, color: "var(--text-primary,#1e293b)" }}>{bank.bank_name}</div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "18px", fontWeight: 800, color: barColor }}>{pct}%</div>
          <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>utilised</div>
        </div>
      </div>

      {/* Overall bank bar */}
      <div style={{ height: "8px", borderRadius: "4px", backgroundColor: "#e2e8f0", marginBottom: "10px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, backgroundColor: barColor, borderRadius: "4px" }} />
      </div>

      {/* Bank totals */}
      <div style={{ display: "flex", gap: "16px", fontSize: "13px", marginBottom: "12px" }}>
        <span style={{ color: COLOURS.SLATE }}>Total limit: <strong>{pkr(bank.bank_total_limit)}</strong></span>
        <span style={{ color: "#dc2626" }}>Seized: <strong>{pkr(bank.bank_seized)}</strong></span>
        <span style={{ color: "#16a34a" }}>Available: <strong>{pkr(bank.bank_available)}</strong></span>
      </div>

      {/* Sub-facility breakdown */}
      {bank.sub_facilities.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: "8px" }}>
          {bank.sub_facilities.map((sf) => {
            const sfPct = sf.utilisation_pct;
            const sfColor = sfPct >= 90 ? "#dc2626" : sfPct >= 70 ? "#d97706" : "#16a34a";
            return (
              <div key={sf.id} style={{ padding: "8px 10px", backgroundColor: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-primary,#1e293b)" }}>
                    {sf.facility_name || sf.facility_type}
                  </div>
                  <button onClick={() => onEdit(sf)} style={{ fontSize: "11px", color: COLOURS.SLATE, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0, flexShrink: 0 }}>Edit</button>
                </div>
                <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginBottom: "6px" }}>{sf.facility_type}</div>
                <div style={{ height: "4px", borderRadius: "2px", backgroundColor: "#e2e8f0", marginBottom: "6px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(100, sfPct)}%`, backgroundColor: sfColor, borderRadius: "2px" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
                  <span style={{ color: "#dc2626" }}>{pkr(sf.seized)} seized</span>
                  <span style={{ color: "#16a34a" }}>{pkr(sf.available)} free</span>
                </div>
                <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>Limit: {pkr(sf.total_limit)}</div>
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
        <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", backgroundColor: "#f0fdf4", borderRadius: "6px", border: "1px solid #bbf7d0" }}>
          <span style={{ fontSize: "13px", color: "#16a34a", fontWeight: 600 }}>
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
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100, backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", maxHeight: "200px", overflowY: "auto" }}>
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
                  <span style={{ marginLeft: "6px", fontSize: "11px", color: b.status === "Collected" ? "#16a34a" : "#d97706" }}>{b.status}</span>
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
            <DateInput value={manualDate} onChange={(e) => onManualDate(e.target.value)} style={{ ...inputStyle, width: "220px" }} />
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
    "Active":      { bg: "#eff6ff", color: "#2563eb" },
    "Converted":   { bg: "#f5f3ff", color: "#7c3aed" },
    "Returned":    { bg: "#f0fdf4", color: "#16a34a" },
    "Released":    { bg: "#f0fdf4", color: "#16a34a" },
    "Expired":     { bg: "#fef2f2", color: "#dc2626" },
  };
  const s = map[status] || { bg: "#f8fafc", color: COLOURS.SLATE };
  return (
    <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "10px", backgroundColor: s.bg, color: s.color }}>
      {status}
    </span>
  );
}

function urgencyBadge(urgency: string) {
  if (urgency === "Overdue")   return <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "10px", backgroundColor: "#fef2f2", color: "#dc2626" }}>⚠ Overdue</span>;
  if (urgency === "Due soon")  return <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "10px", backgroundColor: "#fffbeb", color: "#d97706" }}>⏱ Due soon</span>;
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
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [banks, setBanks] = useState<BankGroup[]>([]);
  const [guarantees, setGuarantees] = useState<Guarantee[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState("Active");
  const [filterType, setFilterType] = useState("All");

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
        loadUserCtx(user.email).then((ctx) => {
          setShowFinancials(canViewGuaranteeFinancials(ctx));
          load();
        });
      }
    });
  }, [checking, load]);

  // ── Filtered list ──
  const visible = guarantees.filter((g) => {
    if (filterStatus !== "All" && g.status !== filterStatus) return false;
    if (filterType   !== "All" && g.guarantee_type !== filterType) return false;
    return true;
  });

  // ── Add guarantee ──
  async function saveAdd() {
    if (!addForm.guarantee_type || !addForm.guarantee_number || !addForm.bank_name || !addForm.issue_date || !addForm.amount || !addForm.customer_name) {
      toast("Please fill all required fields", "error"); return;
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

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
        <PageHeader />

        {/* Header */}
        <div style={{ fontSize: "11px", color: "#fff", backgroundColor: "#1e293b", padding: "4px 8px", borderRadius: "4px", marginBottom: "8px", fontFamily: "monospace" }}>
          DEBUG — showFinancials: {String(showFinancials)} | banks: {banks.length} | facilities: {facilities.length} | loading: {String(loading)}
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", marginBottom: "20px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-primary,#1e293b)", margin: "0 0 4px" }}>Guarantees & Pay Orders</h1>
            <p style={{ fontSize: "14px", color: COLOURS.SLATE, margin: 0 }}>Unze Trading — bid guarantees, pay orders, performance guarantees</p>
          </div>
          {showFinancials && (
            <button onClick={() => { setShowAddForm((v) => !v); setEditId(null); setConvertId(null); setStatusActionId(null); }}
              style={primaryButtonStyle}>
              {showAddForm ? "Cancel" : "+ New Guarantee"}
            </button>
          )}
        </div>

        {/* ── Summary strip — Ops: counts only, no PKR amounts ── */}
        {showFinancials === false && totals && (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3,1fr)", gap: "10px", marginBottom: "18px" }}>
            {[
              { label: "Active guarantees", value: String(totals.active_count), sub: "Currently issued", color: "#2563eb" },
              { label: "Overdue", value: String(totals.overdue_count), sub: totals.overdue_count > 0 ? "Needs chasing now" : "None overdue", color: totals.overdue_count > 0 ? "#dc2626" : "#16a34a" },
              { label: "Due soon", value: String(totals.due_soon_count), sub: totals.due_soon_count > 0 ? "Expiring within 30 days" : "None due soon", color: totals.due_soon_count > 0 ? "#d97706" : "#16a34a" },
            ].map((c) => (
              <div key={c.label} style={{ padding: "12px 14px", backgroundColor: "var(--bg-card,#fff)", borderRadius: "10px", border: `1px solid var(--border-color,#e2e8f0)`, borderTop: `3px solid ${c.color}` }}>
                <div style={{ fontSize: "11px", color: COLOURS.SLATE, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "4px" }}>{c.label}</div>
                <div style={{ fontSize: "28px", fontWeight: 800, color: c.color, marginBottom: "2px" }}>{c.value}</div>
                <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>{c.sub}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Summary strip — Finance only ── */}
        {showFinancials && totals && (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)", gap: "10px", marginBottom: "18px" }}>
            {[
              { label: "Active guarantees", value: String(totals.active_count), sub: totals.overdue_count > 0 ? `${totals.overdue_count} overdue` : totals.due_soon_count > 0 ? `${totals.due_soon_count} due soon` : "All OK", alertColor: totals.overdue_count > 0 ? "#dc2626" : totals.due_soon_count > 0 ? "#d97706" : "#16a34a" },
              { label: "Total facility seized", value: pkr(totals.total_amount_active), sub: "Face value of active guarantees", alertColor: COLOURS.SLATE },
              { label: "Cash margin stuck", value: pkr(totals.total_cash_margin_stuck), sub: "5% held by banks as collateral", alertColor: "#d97706" },
              { label: "Bank charges paid", value: pkr(totals.total_bank_charges), sub: "All-time issuance charges", alertColor: COLOURS.SLATE },
            ].map((c) => (
              <div key={c.label} style={{ padding: "12px 14px", backgroundColor: "var(--bg-card,#fff)", borderRadius: "10px", border: "1px solid var(--border-color,#e2e8f0)" }}>
                <div style={{ fontSize: "11px", color: COLOURS.SLATE, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "4px" }}>{c.label}</div>
                <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--text-primary,#1e293b)", marginBottom: "2px" }}>{c.value}</div>
                <div style={{ fontSize: "12px", color: c.alertColor }}>{c.sub}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Bank facility utilisation — Finance only ── */}
        {showFinancials && banks.length > 0 && (
          <div style={{ marginBottom: "18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <SectionTitle title="Bank Facility Utilisation" />
              <button onClick={() => setShowFacilityForm((v) => !v)}
                style={{ padding: "4px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, border: `1px solid ${COLOURS.NAVY}`, backgroundColor: "var(--bg-card,#fff)", color: COLOURS.NAVY, cursor: "pointer" }}>
                {showFacilityForm ? "Cancel" : "+ Add Facility"}
              </button>
            </div>

            {showFacilityForm && (
              <div style={{ border: "1px solid #e2e8f0", borderRadius: "10px", padding: "16px", backgroundColor: "var(--bg-card,#fff)", marginBottom: "12px" }}>
                <FacilityForm facilityForm={facilityForm} setFacilityForm={setFacilityForm} saveFacility={saveFacility} savingFacility={savingFacility} isMobile={isMobile} />
              </div>
            )}

            {/* Inline edit facility form — shown above cards so it's always visible */}
            {editFacilityId && (
              <div style={{ border: "2px solid #d97706", borderRadius: "10px", padding: "16px", backgroundColor: "#fffbeb", marginBottom: "12px" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#92400e", marginBottom: "10px" }}>Edit Facility</div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px" }}>
                  <Field label="Bank name *"><input value={editFacilityForm.bank_name} onChange={(e) => setEditFacilityForm({ ...editFacilityForm, bank_name: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                  <Field label="Facility name *"><input value={editFacilityForm.facility_name} onChange={(e) => setEditFacilityForm({ ...editFacilityForm, facility_name: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                  <Field label="Facility type">
                    <select value={editFacilityForm.facility_type} onChange={(e) => setEditFacilityForm({ ...editFacilityForm, facility_type: e.target.value })} style={{ ...inputStyle, width: "100%" }}>
                      {FACILITY_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Total limit (PKR) *"><input type="number" min="0" value={editFacilityForm.total_limit} onChange={(e) => setEditFacilityForm({ ...editFacilityForm, total_limit: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                  <Field label="Notes"><input value={editFacilityForm.notes} onChange={(e) => setEditFacilityForm({ ...editFacilityForm, notes: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                </div>
                <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                  <button onClick={saveEditFacility} disabled={savingEditFacility} style={{ ...primaryButtonStyle, fontSize: "13px", padding: "6px 14px", opacity: savingEditFacility ? 0.6 : 1 }}>{savingEditFacility ? "Saving…" : "Save changes"}</button>
                  <button onClick={() => setEditFacilityId(null)} style={{ padding: "6px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, border: "1px solid #e2e8f0", backgroundColor: "var(--bg-card,#fff)", color: COLOURS.SLATE, cursor: "pointer" }}>Cancel</button>
                </div>
              </div>
            )}

            {/* Bank-grouped utilisation bars */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {banks.map((b) => <BankFacilityCard key={b.bank_name} bank={b} onEdit={startEditFacility} />)}
            </div>
          </div>
        )}

        {/* No facilities yet — Finance only */}
        {showFinancials && banks.length === 0 && !loading && (
          <div style={{ marginBottom: "18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <SectionTitle title="Bank Facility Utilisation" />
              <button onClick={() => setShowFacilityForm((v) => !v)}
                style={{ padding: "4px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, border: `1px solid ${COLOURS.NAVY}`, backgroundColor: "var(--bg-card,#fff)", color: COLOURS.NAVY, cursor: "pointer" }}>
                {showFacilityForm ? "Cancel" : "+ Add Facility"}
              </button>
            </div>
            {showFacilityForm && (
              <div style={{ border: "1px solid #e2e8f0", borderRadius: "10px", padding: "16px", backgroundColor: "var(--bg-card,#fff)", marginBottom: "12px" }}>
                <FacilityForm facilityForm={facilityForm} setFacilityForm={setFacilityForm} saveFacility={saveFacility} savingFacility={savingFacility} isMobile={isMobile} />
              </div>
            )}
          </div>
        )}

        {/* ── Add Guarantee form — Finance only ── */}
        {showFinancials && showAddForm && (
          <div style={{ border: "2px solid #2563eb", borderRadius: "10px", padding: "18px", backgroundColor: "#eff6ff", marginBottom: "20px" }}>
            <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "14px" }}>New Guarantee / Pay Order</div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "12px" }}>
              <Field label="Type *">
                <select value={addForm.guarantee_type} onChange={(e) => setAddForm({ ...addForm, guarantee_type: e.target.value })} style={{ ...inputStyle, width: "100%" }}>
                  {GUARANTEE_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Customer / Beneficiary *">
                <input value={addForm.customer_name} onChange={(e) => setAddForm({ ...addForm, customer_name: e.target.value })} placeholder="e.g. FESCO, MEPCO, PSO" style={{ ...inputStyle, width: "100%" }} />
              </Field>
              <Field label="Guarantee / PO number *">
                <input value={addForm.guarantee_number} onChange={(e) => setAddForm({ ...addForm, guarantee_number: e.target.value })} placeholder="Bank-issued reference" style={{ ...inputStyle, width: "100%" }} />
              </Field>
              <Field label="Bank *">
                <input value={addForm.bank_name} onChange={(e) => setAddForm({ ...addForm, bank_name: e.target.value })} placeholder="e.g. HBL, MCB" style={{ ...inputStyle, width: "100%" }} />
              </Field>
              <Field label="Bank facility (optional)">
                <select value={addForm.facility_id} onChange={(e) => setAddForm({ ...addForm, facility_id: e.target.value })} style={{ ...inputStyle, width: "100%" }}>
                  <option value="">— Not linked to a facility —</option>
                  {banks.flatMap((b) => b.sub_facilities).map((f) => <option key={f.id} value={f.id}>{f.bank_name} — {f.facility_name || f.facility_type}</option>)}
                </select>
              </Field>
              <Field label="Tender / contract reference">
                <input value={addForm.tender_reference} onChange={(e) => setAddForm({ ...addForm, tender_reference: e.target.value })} placeholder="Optional" style={{ ...inputStyle, width: "100%" }} />
              </Field>
              <Field label="Issue date *"><DateInput value={addForm.issue_date} onChange={(e) => setAddForm({ ...addForm, issue_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
              <Field label="Expiry date"><DateInput value={addForm.expiry_date} onChange={(e) => setAddForm({ ...addForm, expiry_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "12px" }}>
              <Field label="Amount (PKR) *"><input type="number" min="0" value={addForm.amount} onChange={(e) => setAddForm({ ...addForm, amount: e.target.value })} placeholder="0" style={{ ...inputStyle, width: "100%" }} /></Field>
              <Field label="Cash margin %">
                <input type="number" min="0" max="100" value={addForm.cash_margin_pct} onChange={(e) => setAddForm({ ...addForm, cash_margin_pct: e.target.value })} style={{ ...inputStyle, width: "100%" }} />
              </Field>
              <Field label="Cash margin held (auto)">
                <div style={{ ...inputStyle, width: "100%", backgroundColor: "#f1f5f9", color: COLOURS.SLATE, display: "flex", alignItems: "center" }}>
                  {addForm.amount && addForm.cash_margin_pct
                    ? pkr(Number(addForm.amount) * Number(addForm.cash_margin_pct) / 100)
                    : "—"}
                </div>
              </Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "12px" }}>
              <Field label="Bank charges (PKR)"><input type="number" min="0" value={addForm.bank_charges} onChange={(e) => setAddForm({ ...addForm, bank_charges: e.target.value })} placeholder="0" style={{ ...inputStyle, width: "100%" }} /></Field>
            </div>
            {addForm.guarantee_type === "Performance Guarantee" && (
              <Field label="1st bill (links expiry clock — search by customer or invoice ref)">
                <BillPicker
                  linkedId={addBillId}
                  linkedDate={null}
                  linkedRef={addBillRef}
                  onLink={(id) => setAddBillId(id)}
                  onManualDate={(d) => setAddBillDate(d)}
                  manualDate={addBillDate}
                  showManual={addShowManual}
                  onToggleManual={() => setAddShowManual((v) => !v)}
                />
              </Field>
            )}
            <Field label="Purpose / description">
              <textarea value={addForm.purpose} onChange={(e) => setAddForm({ ...addForm, purpose: e.target.value })} rows={2} placeholder="e.g. PC Spun Poles bid for FESCO PO 4640" style={{ ...inputStyle, width: "100%", resize: "vertical" }} />
            </Field>
            <Field label="Notes">
              <textarea value={addForm.notes} onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })} rows={2} style={{ ...inputStyle, width: "100%", resize: "vertical" }} />
            </Field>
            <button onClick={saveAdd} disabled={saving} style={{ ...primaryButtonStyle, opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : "Add Guarantee"}</button>
          </div>
        )}

        {/* ── Guarantee list ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "10px" }}>
          <SectionTitle title="Guarantees" />
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ ...inputStyle, padding: "5px 10px", fontSize: "13px" }}>
              <option value="All">All statuses</option>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ ...inputStyle, padding: "5px 10px", fontSize: "13px" }}>
              <option value="All">All types</option>
              {GUARANTEE_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div style={{ color: COLOURS.SLATE, fontSize: "14px" }}>Loading…</div>
        ) : error ? (
          <div style={{ color: "#dc2626", fontSize: "14px", padding: "12px", backgroundColor: "#fef2f2", borderRadius: "8px" }}>{error}</div>
        ) : visible.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px", color: COLOURS.SLATE, border: "1px solid #e2e8f0", borderRadius: "8px", backgroundColor: "var(--bg-card,#fff)" }}>
            No guarantees found. {filterStatus !== "All" || filterType !== "All" ? "Try clearing filters." : showFinancials ? "Add the first one above." : "None recorded yet."}
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
                <div key={g.id} style={{ border: "1px solid var(--border-color,#e2e8f0)", borderRadius: "10px", backgroundColor: "var(--bg-card,#fff)", overflow: "hidden",
                  borderLeft: `4px solid ${g.chase_urgency === "Overdue" ? "#dc2626" : g.chase_urgency === "Due soon" ? "#d97706" : g.status === "Active" ? "#2563eb" : "#94a3b8"}`,
                  opacity: ["Returned","Released","Expired"].includes(g.status) ? 0.7 : 1 }}>

                  {/* Row header */}
                  <div style={{ padding: "12px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "8px" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "4px" }}>
                          <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary,#1e293b)" }}>
                            {g.customer_name} — {g.guarantee_number}
                          </span>
                          <span style={{ fontSize: "12px", padding: "1px 8px", borderRadius: "10px", backgroundColor: "#f1f5f9", color: COLOURS.SLATE, fontWeight: 600 }}>
                            {g.guarantee_type}
                          </span>
                          {statusBadge(g.status)}
                          {urgencyBadge(g.chase_urgency)}
                        </div>
                        <div style={{ fontSize: "12px", color: COLOURS.SLATE, display: "flex", gap: "14px", flexWrap: "wrap" }}>
                          <span>Bank: <strong>{g.bank_name}</strong></span>
                          <span>Issued: {formatDateUK(g.issue_date)}</span>
                          {g.expiry_date && <span>Expires: <strong style={{ color: g.chase_urgency === "Overdue" ? "#dc2626" : g.chase_urgency === "Due soon" ? "#d97706" : "inherit" }}>{formatDateUK(g.expiry_date)}</strong></span>}
                          {g.tender_reference && <span>Ref: {g.tender_reference}</span>}
                        </div>
                        {g.purpose && <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px", fontStyle: "italic" }}>{g.purpose}</div>}
                        {g.guarantee_type === "Performance Guarantee" && g.effective_bill_date && (
                          <div style={{ fontSize: "12px", color: "#7c3aed", marginTop: "3px" }}>
                            {g.linked_invoice_ref ? (
                              <>Bill: <strong>{g.linked_invoice_ref}</strong> — {formatDateUK(g.effective_bill_date)}</>
                            ) : (
                              <>Bill submitted: {formatDateUK(g.effective_bill_date)}</>
                            )}
                            {g.release_due_date && <> · Release due: <strong>{formatDateUK(g.release_due_date)}</strong></>}
                          </div>
                        )}
                        {g.returned_date && <div style={{ fontSize: "12px", color: "#16a34a", marginTop: "2px" }}>Returned: {formatDateUK(g.returned_date)}</div>}
                      </div>

                      {/* Financials — Finance only */}
                      {showFinancials && (
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: "16px", fontWeight: 800, color: "var(--text-primary,#1e293b)" }}>{pkr(g.amount)}</div>
                          <div style={{ fontSize: "12px", color: "#d97706" }}>Margin: {pkr(g.cash_margin_amount)}</div>
                          {g.bank_charges > 0 && <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Charges: {pkr(g.bank_charges)}</div>}
                        </div>
                      )}
                    </div>

                    {/* Action buttons — Finance only */}
                    {showFinancials && !isEditing && !isConverting && !isActioning && (
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "10px" }}>
                        <button onClick={() => startEdit(g)} style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, border: "1px solid #e2e8f0", backgroundColor: "var(--bg-card,#fff)", color: COLOURS.SLATE, cursor: "pointer" }}>Edit</button>
                        {canConvert && (
                          <button onClick={() => startConvert(g)} style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: 700, border: "1px solid #7c3aed", backgroundColor: "#f5f3ff", color: "#7c3aed", cursor: "pointer" }}>
                            Tender Won → Convert
                          </button>
                        )}
                        {canRelease && (
                          <button onClick={() => { setStatusActionId(g.id); setEditId(null); setConvertId(null); }} style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: 700, border: "1px solid #16a34a", backgroundColor: "#f0fdf4", color: "#16a34a", cursor: "pointer" }}>
                            Mark Released
                          </button>
                        )}
                        {canReturn && !canRelease && (
                          <button onClick={() => { setStatusActionId(g.id); setEditId(null); setConvertId(null); }} style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: 700, border: "1px solid #16a34a", backgroundColor: "#f0fdf4", color: "#16a34a", cursor: "pointer" }}>
                            Mark Returned
                          </button>
                        )}
                        <button
                          onClick={() => deleteGuarantee(g)}
                          disabled={deletingId === g.id}
                          style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, border: "1px solid #fecaca", backgroundColor: "#fef2f2", color: "#dc2626", cursor: "pointer", marginLeft: "auto", opacity: deletingId === g.id ? 0.6 : 1 }}>
                          {deletingId === g.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* ── Edit form — Finance only ── */}
                  {showFinancials && isEditing && (
                    <div style={{ borderTop: "1px solid #e2e8f0", padding: "14px", backgroundColor: "#f8fafc" }}>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "10px" }}>Edit Guarantee</div>
                      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px" }}>
                        <Field label="Type">
                          <select value={editForm.guarantee_type} onChange={(e) => setEditForm({ ...editForm, guarantee_type: e.target.value })} style={{ ...inputStyle, width: "100%" }}>
                            {GUARANTEE_TYPES.map((t) => <option key={t}>{t}</option>)}
                          </select>
                        </Field>
                        <Field label="Customer *"><input value={editForm.customer_name} onChange={(e) => setEditForm({ ...editForm, customer_name: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Guarantee number *"><input value={editForm.guarantee_number} onChange={(e) => setEditForm({ ...editForm, guarantee_number: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Bank *"><input value={editForm.bank_name} onChange={(e) => setEditForm({ ...editForm, bank_name: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Issue date"><DateInput value={editForm.issue_date} onChange={(e) => setEditForm({ ...editForm, issue_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Expiry date"><DateInput value={editForm.expiry_date} onChange={(e) => setEditForm({ ...editForm, expiry_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Amount (PKR)"><input type="number" min="0" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Cash margin %"><input type="number" min="0" max="100" value={editForm.cash_margin_pct} onChange={(e) => setEditForm({ ...editForm, cash_margin_pct: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Bank charges (PKR)"><input type="number" min="0" value={editForm.bank_charges} onChange={(e) => setEditForm({ ...editForm, bank_charges: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Tender reference"><input value={editForm.tender_reference} onChange={(e) => setEditForm({ ...editForm, tender_reference: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Link to facility">
                          <select value={editForm.facility_id} onChange={(e) => setEditForm({ ...editForm, facility_id: e.target.value })} style={{ ...inputStyle, width: "100%" }}>
                            <option value="">— Not linked —</option>
                            {banks.flatMap((b) => b.sub_facilities).map((f) => <option key={f.id} value={f.id}>{f.bank_name} — {f.facility_name || f.facility_type}</option>)}
                          </select>
                        </Field>
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
                        <button onClick={() => setEditId(null)} style={{ padding: "6px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, border: "1px solid #e2e8f0", backgroundColor: "var(--bg-card,#fff)", color: COLOURS.SLATE, cursor: "pointer" }}>Cancel</button>
                      </div>
                    </div>
                  )}

                  {/* ── Convert to Performance Guarantee form — Finance only ── */}
                  {showFinancials && isConverting && convertTarget && (
                    <div style={{ borderTop: "1px solid #e2e8f0", padding: "14px", backgroundColor: "#faf5ff" }}>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#7c3aed", marginBottom: "6px" }}>Convert to Performance Guarantee</div>
                      <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "12px" }}>
                        The original {g.guarantee_type} ({g.guarantee_number}) will be marked <strong>Converted</strong> and a new Performance Guarantee will be created.
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px" }}>
                        <Field label="New guarantee number *"><input value={convertForm.guarantee_number} onChange={(e) => setConvertForm({ ...convertForm, guarantee_number: e.target.value })} placeholder="New PG number from bank" style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Bank *"><input value={convertForm.bank_name} onChange={(e) => setConvertForm({ ...convertForm, bank_name: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Issue date *"><DateInput value={convertForm.issue_date} onChange={(e) => setConvertForm({ ...convertForm, issue_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                        <Field label="Expiry date"><DateInput value={convertForm.expiry_date} onChange={(e) => setConvertForm({ ...convertForm, expiry_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
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
                        <button onClick={saveConvert} disabled={savingConvert} style={{ ...primaryButtonStyle, fontSize: "13px", padding: "6px 14px", backgroundColor: "#7c3aed", opacity: savingConvert ? 0.6 : 1 }}>{savingConvert ? "Saving…" : "Confirm Conversion"}</button>
                        <button onClick={() => setConvertId(null)} style={{ padding: "6px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, border: "1px solid #e2e8f0", backgroundColor: "var(--bg-card,#fff)", color: COLOURS.SLATE, cursor: "pointer" }}>Cancel</button>
                      </div>
                    </div>
                  )}

                  {/* ── Mark Returned / Released — Finance only ── */}
                  {showFinancials && isActioning && (
                    <div style={{ borderTop: "1px solid #e2e8f0", padding: "14px", backgroundColor: "#f0fdf4" }}>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#16a34a", marginBottom: "10px" }}>
                        {canRelease ? "Mark as Released" : "Mark as Returned to Bank"}
                      </div>
                      <Field label={canRelease ? "Release date" : "Return date"}>
                        <DateInput value={returnedDate} onChange={(e) => setReturnedDate(e.target.value)} style={{ ...inputStyle, width: "260px" }} />
                      </Field>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          onClick={() => saveStatusAction(g.id, canRelease ? "Released" : "Returned")}
                          disabled={savingStatus}
                          style={{ padding: "6px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 700, border: "none", backgroundColor: "#16a34a", color: "#fff", cursor: "pointer", opacity: savingStatus ? 0.6 : 1 }}
                        >{savingStatus ? "Saving…" : canRelease ? "Confirm Released" : "Confirm Returned"}</button>
                        <button onClick={() => { setStatusActionId(null); setReturnedDate(""); }} style={{ padding: "6px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, border: "1px solid #e2e8f0", backgroundColor: "var(--bg-card,#fff)", color: COLOURS.SLATE, cursor: "pointer" }}>Cancel</button>
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
