"use client";

import { useEffect, useState, useCallback } from "react";
import AuthWrapper from "../../lib/AuthWrapper";
import { useRequireCapability } from "../../lib/useRouteGuard";
import { supabase } from "../../lib/supabase";
import { useMobile } from "../../lib/useMobile";
import { COLOURS, PageHeader, SectionTitle, useToast, useConfirm, primaryButtonStyle, inputStyle, labelStyle } from "../../lib/SharedUI";
import { formatDateUK } from "../../lib/dateUtils";
import DateInput from "../../lib/DateInput";

type Plant = { id: string; name: string; type: string };
type PO = {
  id: string; plant_id: string; plant_name: string;
  customer_name: string; po_number: string; po_label: string;
  ordered_31: number; ordered_36: number; ordered_40: number; ordered_45: number; ordered_meter: number;
  variance_pct: number; status: string; is_system_unallocated: boolean;
  start_date: string | null; notes: string | null;
  opening_produced_31: number; opening_produced_36: number; opening_produced_40: number; opening_produced_45: number; opening_produced_meter: number;
};
type Contractor = { id: string; name: string; cnic_or_id: string | null; contact_phone: string | null; contact_address: string | null };
type AuthorityLetter = {
  id: string; po_id: string; contractor_id: string; letter_number: string;
  issue_date: string; issued_by: string; expiry_date: string | null;
  qty_31: number; qty_36: number; qty_40: number; qty_45: number; qty_meter: number;
  opening_dispatched_31: number; opening_dispatched_36: number; opening_dispatched_40: number; opening_dispatched_45: number; opening_dispatched_meter: number;
  notes: string | null;
  contractors?: { name: string } | null;
};
type DispatchRecord = {
  id: string; authority_letter_id: string; dispatch_date: string;
  qty_31: number; qty_36: number; qty_40: number; qty_45: number; qty_meter: number;
  released_by: string; vehicle_number: string | null; notes: string | null;
};
type ContractorPerf = {
  contractor_id: string;
  contractor_name: string;
  contractor_phone: string | null;
  letters_issued: number;
  total_authorised: number;
  total_collected: number;
  collection_pct: number;
  letters_fully_collected: number;
  letters_partial: number;
  letters_not_started: number;
  avg_days_to_full_collection: number | null;
  fastest_days: number | null;
  slowest_days: number | null;
};

async function authedFetch(url: string, opts: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" } });
}

const emptyPO = { customer_name: "", po_number: "", po_label: "", ordered_31: "", ordered_36: "", ordered_40: "", ordered_45: "", ordered_meter: "", start_date: "", notes: "", opening_produced_31: "0", opening_produced_36: "0", opening_produced_40: "0", opening_produced_45: "0", opening_produced_meter: "0" };
const emptyLetter = { contractor_id: "", letter_number: "", issue_date: "", issued_by: "", expiry_date: "", qty_31: "", qty_36: "", qty_40: "", qty_45: "", qty_meter: "", opening_dispatched_31: "0", opening_dispatched_36: "0", opening_dispatched_40: "0", opening_dispatched_45: "0", opening_dispatched_meter: "0", notes: "" };
const emptyContractor = { name: "", cnic_or_id: "", contact_phone: "", contact_address: "" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "12px" }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

function NumInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="number" min="0" value={value} placeholder={placeholder || "0"}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, width: "100%" }}
    />
  );
}

export default function StockManagePage() {
  const { checking } = useRequireCapability("stock");
  const isMobile = useMobile();
  const { show: toast, element: toastEl } = useToast();
  const { confirm, element: confirmEl } = useConfirm();

  const [plants, setPlants] = useState<Plant[]>([]);
  const [selectedPlant, setSelectedPlant] = useState("");
  const [pos, setPOs] = useState<PO[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [loading, setLoading] = useState(false);

  // PO form
  const [showPOForm, setShowPOForm] = useState(false);
  const [poForm, setPOForm] = useState(emptyPO);
  const [savingPO, setSavingPO] = useState(false);

  // Letter form
  const [showLetterForm, setShowLetterForm] = useState(false);
  const [selectedPOId, setSelectedPOId] = useState("");
  const [letterForm, setLetterForm] = useState(emptyLetter);
  const [savingLetter, setSavingLetter] = useState(false);

  // Contractor form
  const [showContractorForm, setShowContractorForm] = useState(false);
  const [contractorForm, setContractorForm] = useState(emptyContractor);
  const [savingContractor, setSavingContractor] = useState(false);

  // Letters list (for a selected PO)
  const [viewLettersPOId, setViewLettersPOId] = useState<string | null>(null);
  const [letters, setLetters] = useState<AuthorityLetter[]>([]);
  const [lettersLoading, setLettersLoading] = useState(false);
  // Edit letter
  const [editLetterId, setEditLetterId] = useState<string | null>(null);
  const [editLetterForm, setEditLetterForm] = useState(emptyLetter);
  const [savingEditLetter, setSavingEditLetter] = useState(false);
  // Edit contractor
  const [editContractorId, setEditContractorId] = useState<string | null>(null);
  const [editContractorForm, setEditContractorForm] = useState(emptyContractor);
  const [savingEditContractor, setSavingEditContractor] = useState(false);
  // Dispatch records for a letter
  const [viewDispatchLetterId, setViewDispatchLetterId] = useState<string | null>(null);
  const [dispatches, setDispatches] = useState<DispatchRecord[]>([]);
  const [dispatchesLoading, setDispatchesLoading] = useState(false);
  // Edit dispatch
  const [editDispatchId, setEditDispatchId] = useState<string | null>(null);
  const [editDispatchForm, setEditDispatchForm] = useState({ dispatch_date: "", qty_31: "", qty_36: "", qty_40: "", qty_45: "", qty_meter: "", released_by: "", vehicle_number: "", notes: "" });
  const [savingEditDispatch, setSavingEditDispatch] = useState(false);

  // Contractor performance
  const [performance, setPerformance] = useState<ContractorPerf[]>([]);
  const [perfLoading, setPerfLoading] = useState(false);

  useEffect(() => { if (!checking) loadPlants(); }, [checking]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedPlant) { loadPOs(); loadContractors(); loadPerformance(); } }, [selectedPlant]);

  async function loadPlants() {
    const { data } = await supabase.from("plants").select("id, name, type").eq("active", true).order("name");
    const list = data || [];
    setPlants(list);
    if (list.length > 0) setSelectedPlant(list[0].id);
  }

  const loadPOs = useCallback(async () => {
    if (!selectedPlant) return;
    setLoading(true);
    const res = await authedFetch(`/api/stock/purchase-orders?plantId=${selectedPlant}&includeClosed=true`);
    const json = await res.json();
    setPOs(json.purchaseOrders || []);
    setLoading(false);
  }, [selectedPlant]);

  const loadContractors = useCallback(async () => {
    const res = await authedFetch("/api/stock/contractors");
    const json = await res.json();
    setContractors(json.contractors || []);
  }, []);

  const loadPerformance = useCallback(async () => {
    if (!selectedPlant) return;
    setPerfLoading(true);
    try {
      const res = await authedFetch(`/api/stock/contractor-performance?plantId=${selectedPlant}`);
      const json = await res.json();
      setPerformance(json.performance || []);
    } finally {
      setPerfLoading(false);
    }
  }, [selectedPlant]);

  async function savePO() {
    if (!poForm.customer_name || !poForm.po_number) { toast("Customer name and PO number are required", "error"); return; }
    const plant = plants.find((p) => p.id === selectedPlant);
    setSavingPO(true);
    const res = await authedFetch("/api/stock/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        plant_id: selectedPlant, plant_name: plant?.name || "",
        customer_name: poForm.customer_name, po_number: poForm.po_number, po_label: poForm.po_label,
        ordered_31: Number(poForm.ordered_31) || 0, ordered_36: Number(poForm.ordered_36) || 0,
        ordered_40: Number(poForm.ordered_40) || 0, ordered_45: Number(poForm.ordered_45) || 0,
        ordered_meter: Number(poForm.ordered_meter) || 0,
        start_date: poForm.start_date || null, notes: poForm.notes || null,
        opening_produced_31: Number(poForm.opening_produced_31) || 0,
        opening_produced_36: Number(poForm.opening_produced_36) || 0,
        opening_produced_40: Number(poForm.opening_produced_40) || 0,
        opening_produced_45: Number(poForm.opening_produced_45) || 0,
        opening_produced_meter: Number(poForm.opening_produced_meter) || 0,
      }),
    });
    const json = await res.json();
    setSavingPO(false);
    if (json.error) { toast(json.error, "error"); return; }
    toast("PO created successfully", "success");
    setShowPOForm(false);
    setPOForm(emptyPO);
    loadPOs();
  }

  async function closePO(po: PO) {
    const ok = await confirm(`Close PO #${po.po_number} for ${po.customer_name}? It will stay visible but greyed out.`, true);
    if (!ok) return;
    const res = await authedFetch("/api/stock/purchase-orders", { method: "PATCH", body: JSON.stringify({ id: po.id, status: "Closed" }) });
    const json = await res.json();
    if (json.error) { toast(json.error, "error"); return; }
    toast("PO closed", "success");
    loadPOs();
  }

  async function saveLetter() {
    if (!selectedPOId || !letterForm.contractor_id || !letterForm.letter_number || !letterForm.issue_date || !letterForm.issued_by) {
      toast("All letter fields are required", "error"); return;
    }
    setSavingLetter(true);
    const res = await authedFetch("/api/stock/authority-letters", {
      method: "POST",
      body: JSON.stringify({
        po_id: selectedPOId, contractor_id: letterForm.contractor_id,
        letter_number: letterForm.letter_number, issue_date: letterForm.issue_date, issued_by: letterForm.issued_by,
        expiry_date: letterForm.expiry_date || null,
        qty_31: Number(letterForm.qty_31) || 0, qty_36: Number(letterForm.qty_36) || 0,
        qty_40: Number(letterForm.qty_40) || 0, qty_45: Number(letterForm.qty_45) || 0,
        qty_meter: Number(letterForm.qty_meter) || 0,
        opening_dispatched_31: Number(letterForm.opening_dispatched_31) || 0,
        opening_dispatched_36: Number(letterForm.opening_dispatched_36) || 0,
        opening_dispatched_40: Number(letterForm.opening_dispatched_40) || 0,
        opening_dispatched_45: Number(letterForm.opening_dispatched_45) || 0,
        opening_dispatched_meter: Number(letterForm.opening_dispatched_meter) || 0,
        notes: letterForm.notes || null,
      }),
    });
    const json = await res.json();
    setSavingLetter(false);
    if (json.error) { toast(json.error, "error"); return; }
    toast("Authority letter issued", "success");
    setShowLetterForm(false);
    setLetterForm(emptyLetter);
  }

  async function saveContractor() {
    if (!contractorForm.name) { toast("Contractor name is required", "error"); return; }
    setSavingContractor(true);
    const res = await authedFetch("/api/stock/contractors", { method: "POST", body: JSON.stringify({ ...contractorForm }) });
    const json = await res.json();
    setSavingContractor(false);
    if (json.error) { toast(json.error, "error"); return; }
    toast("Contractor added", "success");
    setShowContractorForm(false);
    setContractorForm(emptyContractor);
    loadContractors();
  }

  async function loadLetters(poId: string) {
    setLettersLoading(true);
    const res = await authedFetch(`/api/stock/authority-letters?poId=${poId}`);
    const json = await res.json();
    setLetters(json.letters || []);
    setLettersLoading(false);
  }

  function startEditLetter(l: AuthorityLetter) {
    setEditLetterId(l.id);
    setEditLetterForm({
      contractor_id: l.contractor_id,
      letter_number: l.letter_number,
      issue_date: l.issue_date,
      issued_by: l.issued_by,
      expiry_date: l.expiry_date || "",
      qty_31: String(l.qty_31 || ""),
      qty_36: String(l.qty_36 || ""),
      qty_40: String(l.qty_40 || ""),
      qty_45: String(l.qty_45 || ""),
      qty_meter: String(l.qty_meter || ""),
      opening_dispatched_31: String(l.opening_dispatched_31 || "0"),
      opening_dispatched_36: String(l.opening_dispatched_36 || "0"),
      opening_dispatched_40: String(l.opening_dispatched_40 || "0"),
      opening_dispatched_45: String(l.opening_dispatched_45 || "0"),
      opening_dispatched_meter: String(l.opening_dispatched_meter || "0"),
      notes: l.notes || "",
    });
  }

  async function saveEditLetter() {
    if (!editLetterId) return;
    setSavingEditLetter(true);
    const res = await authedFetch("/api/stock/authority-letters", {
      method: "PATCH",
      body: JSON.stringify({
        id: editLetterId,
        contractor_id: editLetterForm.contractor_id,
        letter_number: editLetterForm.letter_number,
        issue_date: editLetterForm.issue_date,
        issued_by: editLetterForm.issued_by,
        expiry_date: editLetterForm.expiry_date || null,
        qty_31: Number(editLetterForm.qty_31) || 0,
        qty_36: Number(editLetterForm.qty_36) || 0,
        qty_40: Number(editLetterForm.qty_40) || 0,
        qty_45: Number(editLetterForm.qty_45) || 0,
        qty_meter: Number(editLetterForm.qty_meter) || 0,
        notes: editLetterForm.notes || null,
      }),
    });
    const json = await res.json();
    setSavingEditLetter(false);
    if (json.error) { toast(json.error, "error"); return; }
    toast("Letter updated", "success");
    setEditLetterId(null);
    if (viewLettersPOId) loadLetters(viewLettersPOId);
  }

  function startEditContractor(c: Contractor) {
    setEditContractorId(c.id);
    setEditContractorForm({
      name: c.name,
      cnic_or_id: c.cnic_or_id || "",
      contact_phone: c.contact_phone || "",
      contact_address: c.contact_address || "",
    });
  }

  async function saveEditContractor() {
    if (!editContractorId) return;
    if (!editContractorForm.name) { toast("Name is required", "error"); return; }
    setSavingEditContractor(true);
    const res = await authedFetch("/api/stock/contractors", {
      method: "PATCH",
      body: JSON.stringify({ id: editContractorId, ...editContractorForm }),
    });
    const json = await res.json();
    setSavingEditContractor(false);
    if (json.error) { toast(json.error, "error"); return; }
    toast("Contractor updated", "success");
    setEditContractorId(null);
    loadContractors();
  }

  async function loadDispatches(letterId: string) {
    setDispatchesLoading(true);
    const res = await authedFetch(`/api/stock/dispatch-records?letterId=${letterId}`);
    const json = await res.json();
    setDispatches(json.dispatches || []);
    setDispatchesLoading(false);
  }

  function startEditDispatch(d: DispatchRecord) {
    setEditDispatchId(d.id);
    setEditDispatchForm({
      dispatch_date: d.dispatch_date,
      qty_31: String(d.qty_31 || ""),
      qty_36: String(d.qty_36 || ""),
      qty_40: String(d.qty_40 || ""),
      qty_45: String(d.qty_45 || ""),
      qty_meter: String(d.qty_meter || ""),
      released_by: d.released_by,
      vehicle_number: d.vehicle_number || "",
      notes: d.notes || "",
    });
  }

  async function saveEditDispatch() {
    if (!editDispatchId) return;
    setSavingEditDispatch(true);
    const res = await authedFetch("/api/stock/dispatch-records", {
      method: "PATCH",
      body: JSON.stringify({
        id: editDispatchId,
        dispatch_date: editDispatchForm.dispatch_date,
        qty_31: Number(editDispatchForm.qty_31) || 0,
        qty_36: Number(editDispatchForm.qty_36) || 0,
        qty_40: Number(editDispatchForm.qty_40) || 0,
        qty_45: Number(editDispatchForm.qty_45) || 0,
        qty_meter: Number(editDispatchForm.qty_meter) || 0,
        released_by: editDispatchForm.released_by,
        vehicle_number: editDispatchForm.vehicle_number || null,
        notes: editDispatchForm.notes || null,
      }),
    });
    const json = await res.json();
    setSavingEditDispatch(false);
    if (json.error) { toast(json.error, "error"); return; }
    toast("Dispatch record updated", "success");
    setEditDispatchId(null);
    if (viewDispatchLetterId) loadDispatches(viewDispatchLetterId);
  }

  if (checking) return <AuthWrapper><main style={{ padding: "14px 18px" }}><p style={{ color: COLOURS.SLATE }}>Checking permissions...</p></main></AuthWrapper>;

  const activePOs = pos.filter((p) => !p.is_system_unallocated && p.status === "Active");
  const closedPOs = pos.filter((p) => !p.is_system_unallocated && p.status === "Closed");

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
        <PageHeader />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", marginBottom: "18px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-primary,#1e293b)", margin: "0 0 4px" }}>Manage POs & Letters</h1>
            <p style={{ fontSize: "14px", color: COLOURS.SLATE, margin: 0 }}>Create purchase orders, add contractors, issue authority letters</p>
          </div>
          <a href="/stock" style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, textDecoration: "none" }}>← Back to Stock</a>
        </div>

        {/* Plant selector */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "20px", flexWrap: "wrap" }}>
          {plants.map((p) => (
            <button key={p.id} onClick={() => setSelectedPlant(p.id)} style={{ padding: "8px 18px", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: "pointer", border: `2px solid ${selectedPlant === p.id ? COLOURS.NAVY : "#e2e8f0"}`, backgroundColor: selectedPlant === p.id ? COLOURS.NAVY : "var(--bg-card,#fff)", color: selectedPlant === p.id ? "white" : COLOURS.NAVY }}>
              {p.name}
            </button>
          ))}
        </div>

        {/* ── Purchase Orders ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
          <SectionTitle title="Purchase Orders" />
          <button onClick={() => setShowPOForm((v) => !v)} style={primaryButtonStyle}>
            {showPOForm ? "Cancel" : "+ New PO"}
          </button>
        </div>

        {showPOForm && (
          <div style={{ border: "1px solid var(--border-color,#e2e8f0)", borderRadius: "10px", padding: "18px", backgroundColor: "var(--bg-card,#fff)", marginBottom: "16px" }}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "12px" }}>
              <Field label="Customer name *"><input value={poForm.customer_name} onChange={(e) => setPOForm({ ...poForm, customer_name: e.target.value })} placeholder="e.g. FESCO, MEPCO, Packages Ltd" style={{ ...inputStyle, width: "100%" }} /></Field>
              <Field label="PO number *"><input value={poForm.po_number} onChange={(e) => setPOForm({ ...poForm, po_number: e.target.value })} placeholder="e.g. FESCO-2024-001 or PKG-PO-005" style={{ ...inputStyle, width: "100%" }} /></Field>
              <Field label="PO label / description"><input value={poForm.po_label} onChange={(e) => setPOForm({ ...poForm, po_label: e.target.value })} placeholder="e.g. Old PO, 1st Year with 15% Repeat" style={{ ...inputStyle, width: "100%" }} /></Field>
              <Field label="Start date"><DateInput value={poForm.start_date} onChange={(e) => setPOForm({ ...poForm, start_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
            </div>
            <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.SLATE, margin: "10px 0 8px" }}>Ordered quantities (by size)</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: "10px" }}>
              <Field label="31ft"><NumInput value={poForm.ordered_31} onChange={(v) => setPOForm({ ...poForm, ordered_31: v })} /></Field>
              <Field label="36ft"><NumInput value={poForm.ordered_36} onChange={(v) => setPOForm({ ...poForm, ordered_36: v })} /></Field>
              <Field label="40ft"><NumInput value={poForm.ordered_40} onChange={(v) => setPOForm({ ...poForm, ordered_40: v })} /></Field>
              <Field label="45ft"><NumInput value={poForm.ordered_45} onChange={(v) => setPOForm({ ...poForm, ordered_45: v })} /></Field>
              <Field label="Meter"><NumInput value={poForm.ordered_meter} onChange={(v) => setPOForm({ ...poForm, ordered_meter: v })} /></Field>
            </div>
            <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.SLATE, margin: "10px 0 8px" }}>Opening balance (already produced before go-live)</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: "10px" }}>
              <Field label="31ft"><NumInput value={poForm.opening_produced_31} onChange={(v) => setPOForm({ ...poForm, opening_produced_31: v })} /></Field>
              <Field label="36ft"><NumInput value={poForm.opening_produced_36} onChange={(v) => setPOForm({ ...poForm, opening_produced_36: v })} /></Field>
              <Field label="40ft"><NumInput value={poForm.opening_produced_40} onChange={(v) => setPOForm({ ...poForm, opening_produced_40: v })} /></Field>
              <Field label="45ft"><NumInput value={poForm.opening_produced_45} onChange={(v) => setPOForm({ ...poForm, opening_produced_45: v })} /></Field>
              <Field label="Meter"><NumInput value={poForm.opening_produced_meter} onChange={(v) => setPOForm({ ...poForm, opening_produced_meter: v })} /></Field>
            </div>
            <Field label="Notes"><textarea value={poForm.notes} onChange={(e) => setPOForm({ ...poForm, notes: e.target.value })} rows={2} style={{ ...inputStyle, width: "100%", resize: "vertical" }} /></Field>
            <button onClick={savePO} disabled={savingPO} style={{ ...primaryButtonStyle, opacity: savingPO ? 0.6 : 1 }}>
              {savingPO ? "Saving…" : "Create PO"}
            </button>
          </div>
        )}

        {loading ? <div style={{ color: COLOURS.SLATE, fontSize: "14px" }}>Loading…</div> : (
          <>
            {activePOs.length === 0 && !showPOForm && (
              <div style={{ textAlign: "center", padding: "24px", color: COLOURS.SLATE, border: "1px solid #e2e8f0", borderRadius: "8px", backgroundColor: "var(--bg-card,#fff)", marginBottom: "16px" }}>
                No active POs for this plant. Add the first one above.
              </div>
            )}
            {[...activePOs, ...closedPOs].map((po) => (
              <div key={po.id} style={{ marginBottom: "8px" }}>
              <div style={{ border: "1px solid var(--border-color,#e2e8f0)", borderRadius: "8px", padding: "12px 14px", backgroundColor: "var(--bg-card,#fff)", opacity: po.status === "Closed" ? 0.6 : 1, borderLeft: `4px solid ${po.status === "Closed" ? "#94a3b8" : COLOURS.NAVY}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "8px" }}>
                  <div>
                    <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary,#1e293b)" }}>
                      {po.customer_name} — PO #{po.po_number}
                      {po.po_label && <span style={{ fontSize: "12px", marginLeft: "8px", padding: "1px 8px", borderRadius: "10px", backgroundColor: "#eff6ff", color: "#2563eb", fontWeight: 600 }}>{po.po_label}</span>}
                      {po.status === "Closed" && <span style={{ fontSize: "11px", marginLeft: "8px", padding: "1px 8px", borderRadius: "10px", backgroundColor: "#f1f5f9", color: COLOURS.SLATE, fontWeight: 700 }}>CLOSED</span>}
                    </div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "3px" }}>
                      {po.start_date && `From ${formatDateUK(po.start_date)} · `}
                      Ordered: {[po.ordered_31 && `${po.ordered_31} × 31ft`, po.ordered_36 && `${po.ordered_36} × 36ft`, po.ordered_40 && `${po.ordered_40} × 40ft`, po.ordered_45 && `${po.ordered_45} × 45ft`, po.ordered_meter && `${po.ordered_meter} × Mtr`].filter(Boolean).join(", ")}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    <button
                      onClick={() => { setSelectedPOId(po.id); setShowLetterForm(true); }}
                      style={{ padding: "5px 12px", borderRadius: "6px", fontSize: "13px", fontWeight: 600, border: `1px solid ${COLOURS.NAVY}`, backgroundColor: "var(--bg-card,#fff)", color: COLOURS.NAVY, cursor: "pointer" }}
                    >
                      + Authority Letter
                    </button>
                    <button
                      onClick={() => {
                        const isOpen = viewLettersPOId === po.id;
                        setViewLettersPOId(isOpen ? null : po.id);
                        setEditLetterId(null);
                        setViewDispatchLetterId(null);
                        if (!isOpen) loadLetters(po.id);
                      }}
                      style={{ padding: "5px 12px", borderRadius: "6px", fontSize: "13px", fontWeight: 600, border: "1px solid #e2e8f0", backgroundColor: viewLettersPOId === po.id ? "#f1f5f9" : "var(--bg-card,#fff)", color: COLOURS.SLATE, cursor: "pointer" }}
                    >
                      {viewLettersPOId === po.id ? "Hide Letters" : "Edit Letters"}
                    </button>
                    {po.status === "Active" && (
                      <button onClick={() => closePO(po)} style={{ padding: "5px 12px", borderRadius: "6px", fontSize: "13px", fontWeight: 600, border: "1px solid #e2e8f0", backgroundColor: "var(--bg-card,#fff)", color: COLOURS.SLATE, cursor: "pointer" }}>
                        Close PO
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Letters panel for this PO ── */}
              {viewLettersPOId === po.id && (
                <div style={{ marginTop: "10px", borderTop: "1px solid #e2e8f0", paddingTop: "10px" }}>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.SLATE, marginBottom: "8px" }}>Authority Letters</div>
                  {lettersLoading ? (
                    <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>Loading…</div>
                  ) : letters.length === 0 ? (
                    <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>No letters issued for this PO yet.</div>
                  ) : letters.map((l) => (
                    <div key={l.id} style={{ border: "1px solid #e2e8f0", borderRadius: "8px", padding: "10px 12px", marginBottom: "8px", backgroundColor: "var(--bg-card,#fff)" }}>
                      {editLetterId === l.id ? (
                        <div>
                          <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "10px" }}>Edit Letter #{l.letter_number}</div>
                          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px" }}>
                            <Field label="Contractor">
                              <select value={editLetterForm.contractor_id} onChange={(e) => setEditLetterForm({ ...editLetterForm, contractor_id: e.target.value })} style={{ ...inputStyle, width: "100%" }}>
                                <option value="">Select…</option>
                                {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                              </select>
                            </Field>
                            <Field label="Letter number"><input value={editLetterForm.letter_number} onChange={(e) => setEditLetterForm({ ...editLetterForm, letter_number: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                            <Field label="Issue date"><DateInput value={editLetterForm.issue_date} onChange={(e) => setEditLetterForm({ ...editLetterForm, issue_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                            <Field label="Issued by"><input value={editLetterForm.issued_by} onChange={(e) => setEditLetterForm({ ...editLetterForm, issued_by: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                            <Field label="Expiry date"><DateInput value={editLetterForm.expiry_date} onChange={(e) => setEditLetterForm({ ...editLetterForm, expiry_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                          </div>
                          <div style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.SLATE, margin: "8px 0 6px" }}>Authorised quantities</div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: "8px" }}>
                            <Field label="31ft"><NumInput value={editLetterForm.qty_31} onChange={(v) => setEditLetterForm({ ...editLetterForm, qty_31: v })} /></Field>
                            <Field label="36ft"><NumInput value={editLetterForm.qty_36} onChange={(v) => setEditLetterForm({ ...editLetterForm, qty_36: v })} /></Field>
                            <Field label="40ft"><NumInput value={editLetterForm.qty_40} onChange={(v) => setEditLetterForm({ ...editLetterForm, qty_40: v })} /></Field>
                            <Field label="45ft"><NumInput value={editLetterForm.qty_45} onChange={(v) => setEditLetterForm({ ...editLetterForm, qty_45: v })} /></Field>
                            <Field label="Meter"><NumInput value={editLetterForm.qty_meter} onChange={(v) => setEditLetterForm({ ...editLetterForm, qty_meter: v })} /></Field>
                          </div>
                          <Field label="Notes"><textarea value={editLetterForm.notes} onChange={(e) => setEditLetterForm({ ...editLetterForm, notes: e.target.value })} rows={2} style={{ ...inputStyle, width: "100%", resize: "vertical" }} /></Field>
                          <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                            <button onClick={saveEditLetter} disabled={savingEditLetter} style={{ ...primaryButtonStyle, fontSize: "13px", padding: "6px 14px", opacity: savingEditLetter ? 0.6 : 1 }}>{savingEditLetter ? "Saving…" : "Save changes"}</button>
                            <button onClick={() => setEditLetterId(null)} style={{ padding: "6px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, border: "1px solid #e2e8f0", backgroundColor: "var(--bg-card,#fff)", color: COLOURS.SLATE, cursor: "pointer" }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "6px" }}>
                            <div>
                              <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary,#1e293b)" }}>Letter #{l.letter_number}</div>
                              <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>
                                {(Array.isArray(l.contractors) ? (l.contractors as {name:string}[])[0]?.name : (l.contractors as {name:string} | null)?.name) || "—"} · Issued {formatDateUK(l.issue_date)}
                                {l.expiry_date && ` · Expires ${formatDateUK(l.expiry_date)}`}
                              </div>
                              <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>
                                Auth: {[l.qty_31 && `${l.qty_31}×31`, l.qty_36 && `${l.qty_36}×36`, l.qty_40 && `${l.qty_40}×40`, l.qty_45 && `${l.qty_45}×45`, l.qty_meter && `${l.qty_meter}×Mtr`].filter(Boolean).join(", ") || "—"}
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: "6px" }}>
                              <button onClick={() => startEditLetter(l)} style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, border: "1px solid #e2e8f0", backgroundColor: "var(--bg-card,#fff)", color: COLOURS.SLATE, cursor: "pointer" }}>Edit</button>
                              <button
                                onClick={() => {
                                  const isOpen = viewDispatchLetterId === l.id;
                                  setViewDispatchLetterId(isOpen ? null : l.id);
                                  setEditDispatchId(null);
                                  if (!isOpen) loadDispatches(l.id);
                                }}
                                style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, border: "1px solid #e2e8f0", backgroundColor: viewDispatchLetterId === l.id ? "#f1f5f9" : "var(--bg-card,#fff)", color: COLOURS.SLATE, cursor: "pointer" }}
                              >
                                {viewDispatchLetterId === l.id ? "Hide Dispatches" : "Edit Dispatches"}
                              </button>
                            </div>
                          </div>

                          {/* Dispatch records for this letter */}
                          {viewDispatchLetterId === l.id && (
                            <div style={{ marginTop: "10px", borderTop: "1px solid #f1f5f9", paddingTop: "8px" }}>
                              <div style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.SLATE, marginBottom: "6px" }}>Dispatch Records</div>
                              {dispatchesLoading ? (
                                <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>Loading…</div>
                              ) : dispatches.length === 0 ? (
                                <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>No dispatch records for this letter.</div>
                              ) : dispatches.map((d) => (
                                <div key={d.id} style={{ border: "1px solid #f1f5f9", borderRadius: "6px", padding: "8px 10px", marginBottom: "6px", backgroundColor: "#f8fafc" }}>
                                  {editDispatchId === d.id ? (
                                    <div>
                                      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "8px" }}>
                                        <Field label="Date"><DateInput value={editDispatchForm.dispatch_date} onChange={(e) => setEditDispatchForm({ ...editDispatchForm, dispatch_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                                        <Field label="Released by"><input value={editDispatchForm.released_by} onChange={(e) => setEditDispatchForm({ ...editDispatchForm, released_by: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                                        <Field label="Vehicle"><input value={editDispatchForm.vehicle_number} onChange={(e) => setEditDispatchForm({ ...editDispatchForm, vehicle_number: e.target.value })} placeholder="Optional" style={{ ...inputStyle, width: "100%" }} /></Field>
                                      </div>
                                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(100px,1fr))", gap: "8px" }}>
                                        <Field label="31ft"><NumInput value={editDispatchForm.qty_31} onChange={(v) => setEditDispatchForm({ ...editDispatchForm, qty_31: v })} /></Field>
                                        <Field label="36ft"><NumInput value={editDispatchForm.qty_36} onChange={(v) => setEditDispatchForm({ ...editDispatchForm, qty_36: v })} /></Field>
                                        <Field label="40ft"><NumInput value={editDispatchForm.qty_40} onChange={(v) => setEditDispatchForm({ ...editDispatchForm, qty_40: v })} /></Field>
                                        <Field label="45ft"><NumInput value={editDispatchForm.qty_45} onChange={(v) => setEditDispatchForm({ ...editDispatchForm, qty_45: v })} /></Field>
                                        <Field label="Meter"><NumInput value={editDispatchForm.qty_meter} onChange={(v) => setEditDispatchForm({ ...editDispatchForm, qty_meter: v })} /></Field>
                                      </div>
                                      <Field label="Notes"><input value={editDispatchForm.notes} onChange={(e) => setEditDispatchForm({ ...editDispatchForm, notes: e.target.value })} placeholder="Optional" style={{ ...inputStyle, width: "100%" }} /></Field>
                                      <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                                        <button onClick={saveEditDispatch} disabled={savingEditDispatch} style={{ ...primaryButtonStyle, fontSize: "12px", padding: "5px 12px", opacity: savingEditDispatch ? 0.6 : 1 }}>{savingEditDispatch ? "Saving…" : "Save"}</button>
                                        <button onClick={() => setEditDispatchId(null)} style={{ padding: "5px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, border: "1px solid #e2e8f0", backgroundColor: "var(--bg-card,#fff)", color: COLOURS.SLATE, cursor: "pointer" }}>Cancel</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "4px" }}>
                                      <div>
                                        <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-primary,#1e293b)" }}>{formatDateUK(d.dispatch_date)}</span>
                                        <span style={{ fontSize: "12px", color: COLOURS.SLATE, marginLeft: "8px" }}>
                                          {[d.qty_31 && `${d.qty_31}×31`, d.qty_36 && `${d.qty_36}×36`, d.qty_40 && `${d.qty_40}×40`, d.qty_45 && `${d.qty_45}×45`, d.qty_meter && `${d.qty_meter}×Mtr`].filter(Boolean).join(", ")} · {d.released_by}
                                          {d.vehicle_number && ` · ${d.vehicle_number}`}
                                        </span>
                                      </div>
                                      <button onClick={() => startEditDispatch(d)} style={{ padding: "3px 8px", borderRadius: "5px", fontSize: "11px", fontWeight: 600, border: "1px solid #e2e8f0", backgroundColor: "var(--bg-card,#fff)", color: COLOURS.SLATE, cursor: "pointer" }}>Edit</button>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          </>
        )}

        {/* ── Issue Authority Letter ── */}
        {showLetterForm && (
          <div style={{ border: "2px solid #2563eb", borderRadius: "10px", padding: "18px", backgroundColor: "#eff6ff", marginBottom: "20px" }}>
            <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "12px" }}>
              Issue Authority Letter — {pos.find((p) => p.id === selectedPOId)?.customer_name} PO #{pos.find((p) => p.id === selectedPOId)?.po_number}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "12px" }}>
              <Field label="Contractor *">
                <select value={letterForm.contractor_id} onChange={(e) => setLetterForm({ ...letterForm, contractor_id: e.target.value })} style={{ ...inputStyle, width: "100%" }}>
                  <option value="">Select contractor…</option>
                  {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Letter / reference number *"><input value={letterForm.letter_number} onChange={(e) => setLetterForm({ ...letterForm, letter_number: e.target.value })} placeholder="e.g. FESCO-LT-2291 or PVT-REF-007" style={{ ...inputStyle, width: "100%" }} /></Field>
              <Field label="Issue date *"><DateInput value={letterForm.issue_date} onChange={(e) => setLetterForm({ ...letterForm, issue_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
              <Field label="Authorised by (customer rep name) *"><input value={letterForm.issued_by} onChange={(e) => setLetterForm({ ...letterForm, issued_by: e.target.value })} placeholder="Name of the contact who authorised collection" style={{ ...inputStyle, width: "100%" }} /></Field>
              <Field label="Expiry date (optional)">
                <DateInput value={letterForm.expiry_date} onChange={(e) => setLetterForm({ ...letterForm, expiry_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} />
              </Field>
            </div>
            <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.SLATE, margin: "10px 0 8px" }}>Letter quantity (authorized to collect)</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: "10px" }}>
              <Field label="31ft"><NumInput value={letterForm.qty_31} onChange={(v) => setLetterForm({ ...letterForm, qty_31: v })} /></Field>
              <Field label="36ft"><NumInput value={letterForm.qty_36} onChange={(v) => setLetterForm({ ...letterForm, qty_36: v })} /></Field>
              <Field label="40ft"><NumInput value={letterForm.qty_40} onChange={(v) => setLetterForm({ ...letterForm, qty_40: v })} /></Field>
              <Field label="45ft"><NumInput value={letterForm.qty_45} onChange={(v) => setLetterForm({ ...letterForm, qty_45: v })} /></Field>
              <Field label="Meter"><NumInput value={letterForm.qty_meter} onChange={(v) => setLetterForm({ ...letterForm, qty_meter: v })} /></Field>
            </div>
            <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.SLATE, margin: "10px 0 8px" }}>Already dispatched before go-live (opening balance)</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: "10px" }}>
              <Field label="31ft"><NumInput value={letterForm.opening_dispatched_31} onChange={(v) => setLetterForm({ ...letterForm, opening_dispatched_31: v })} /></Field>
              <Field label="36ft"><NumInput value={letterForm.opening_dispatched_36} onChange={(v) => setLetterForm({ ...letterForm, opening_dispatched_36: v })} /></Field>
              <Field label="40ft"><NumInput value={letterForm.opening_dispatched_40} onChange={(v) => setLetterForm({ ...letterForm, opening_dispatched_40: v })} /></Field>
              <Field label="45ft"><NumInput value={letterForm.opening_dispatched_45} onChange={(v) => setLetterForm({ ...letterForm, opening_dispatched_45: v })} /></Field>
              <Field label="Meter"><NumInput value={letterForm.opening_dispatched_meter} onChange={(v) => setLetterForm({ ...letterForm, opening_dispatched_meter: v })} /></Field>
            </div>
            <Field label="Notes"><textarea value={letterForm.notes} onChange={(e) => setLetterForm({ ...letterForm, notes: e.target.value })} rows={2} style={{ ...inputStyle, width: "100%", resize: "vertical" }} /></Field>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={saveLetter} disabled={savingLetter} style={{ ...primaryButtonStyle, opacity: savingLetter ? 0.6 : 1 }}>{savingLetter ? "Saving…" : "Issue Letter"}</button>
              <button onClick={() => { setShowLetterForm(false); setLetterForm(emptyLetter); }} style={{ padding: "8px 18px", borderRadius: "8px", fontSize: "14px", fontWeight: 600, border: "1px solid #e2e8f0", backgroundColor: "var(--bg-card,#fff)", color: COLOURS.SLATE, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        )}

        {/* ── Contractors ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", marginTop: "8px" }}>
          <SectionTitle title="Contractors" />
          <button onClick={() => setShowContractorForm((v) => !v)} style={{ padding: "6px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, border: `1px solid ${COLOURS.NAVY}`, backgroundColor: "var(--bg-card,#fff)", color: COLOURS.NAVY, cursor: "pointer" }}>
            {showContractorForm ? "Cancel" : "+ New Contractor"}
          </button>
        </div>

        {showContractorForm && (
          <div style={{ border: "1px solid var(--border-color,#e2e8f0)", borderRadius: "10px", padding: "18px", backgroundColor: "var(--bg-card,#fff)", marginBottom: "16px" }}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "12px" }}>
              <Field label="Name *"><input value={contractorForm.name} onChange={(e) => setContractorForm({ ...contractorForm, name: e.target.value })} placeholder="Contractor / firm name" style={{ ...inputStyle, width: "100%" }} /></Field>
              <Field label="CNIC / ID"><input value={contractorForm.cnic_or_id} onChange={(e) => setContractorForm({ ...contractorForm, cnic_or_id: e.target.value })} placeholder="Optional" style={{ ...inputStyle, width: "100%" }} /></Field>
              <Field label="Phone"><input value={contractorForm.contact_phone} onChange={(e) => setContractorForm({ ...contractorForm, contact_phone: e.target.value })} placeholder="Optional" style={{ ...inputStyle, width: "100%" }} /></Field>
              <Field label="Address"><input value={contractorForm.contact_address} onChange={(e) => setContractorForm({ ...contractorForm, contact_address: e.target.value })} placeholder="Optional" style={{ ...inputStyle, width: "100%" }} /></Field>
            </div>
            <button onClick={saveContractor} disabled={savingContractor} style={{ ...primaryButtonStyle, opacity: savingContractor ? 0.6 : 1 }}>{savingContractor ? "Saving…" : "Add Contractor"}</button>
          </div>
        )}

        <div style={{ border: "1px solid var(--border-color,#e2e8f0)", borderRadius: "8px", backgroundColor: "var(--bg-card,#fff)", overflow: "hidden" }}>
          {contractors.length === 0 ? (
            <div style={{ padding: "16px", textAlign: "center", color: COLOURS.SLATE, fontSize: "14px" }}>No contractors yet. Add one above.</div>
          ) : contractors.map((c) => (
            <div key={c.id} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-light,#f1f5f9)" }}>
              {editContractorId === c.id ? (
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px" }}>
                    <Field label="Name *"><input value={editContractorForm.name} onChange={(e) => setEditContractorForm({ ...editContractorForm, name: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                    <Field label="CNIC / ID"><input value={editContractorForm.cnic_or_id} onChange={(e) => setEditContractorForm({ ...editContractorForm, cnic_or_id: e.target.value })} placeholder="Optional" style={{ ...inputStyle, width: "100%" }} /></Field>
                    <Field label="Phone"><input value={editContractorForm.contact_phone} onChange={(e) => setEditContractorForm({ ...editContractorForm, contact_phone: e.target.value })} placeholder="Optional" style={{ ...inputStyle, width: "100%" }} /></Field>
                    <Field label="Address"><input value={editContractorForm.contact_address} onChange={(e) => setEditContractorForm({ ...editContractorForm, contact_address: e.target.value })} placeholder="Optional" style={{ ...inputStyle, width: "100%" }} /></Field>
                  </div>
                  <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                    <button onClick={saveEditContractor} disabled={savingEditContractor} style={{ ...primaryButtonStyle, fontSize: "13px", padding: "6px 14px", opacity: savingEditContractor ? 0.6 : 1 }}>{savingEditContractor ? "Saving…" : "Save changes"}</button>
                    <button onClick={() => setEditContractorId(null)} style={{ padding: "6px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, border: "1px solid #e2e8f0", backgroundColor: "var(--bg-card,#fff)", color: COLOURS.SLATE, cursor: "pointer" }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--text-primary,#1e293b)", flex: 1 }}>{c.name}</span>
                  {c.cnic_or_id && <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>ID: {c.cnic_or_id}</span>}
                  {c.contact_phone && <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{c.contact_phone}</span>}
                  {c.contact_address && <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{c.contact_address}</span>}
                  <button onClick={() => startEditContractor(c)} style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, border: "1px solid #e2e8f0", backgroundColor: "var(--bg-card,#fff)", color: COLOURS.SLATE, cursor: "pointer", marginLeft: "auto" }}>Edit</button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ── Contractor Performance ── */}
        <div style={{ marginTop: "28px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <SectionTitle title="Contractor Performance" />
            <button
              onClick={loadPerformance}
              disabled={perfLoading}
              style={{ padding: "5px 12px", borderRadius: "6px", fontSize: "13px", fontWeight: 600, border: "1px solid #e2e8f0", backgroundColor: "var(--bg-card,#fff)", color: COLOURS.SLATE, cursor: "pointer", opacity: perfLoading ? 0.6 : 1 }}
            >
              {perfLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
          <p style={{ fontSize: "13px", color: COLOURS.SLATE, margin: "0 0 12px" }}>
            Per-contractor totals across all POs for this plant.
          </p>

          {perfLoading ? (
            <div style={{ color: COLOURS.SLATE, fontSize: "14px" }}>Loading performance data…</div>
          ) : performance.length === 0 ? (
            <div style={{ textAlign: "center", padding: "20px", color: COLOURS.SLATE, border: "1px solid #e2e8f0", borderRadius: "8px", backgroundColor: "var(--bg-card,#fff)", fontSize: "14px" }}>
              No contractor data yet for this plant.
            </div>
          ) : (
            <div style={{ display: "grid", gap: "10px" }}>
              {performance.map((c) => {
                const pctColor = c.collection_pct >= 90 ? "#16a34a" : c.collection_pct >= 60 ? "#d97706" : "#dc2626";
                return (
                  <div key={c.contractor_id} style={{ border: "1px solid var(--border-color,#e2e8f0)", borderRadius: "10px", backgroundColor: "var(--bg-card,#fff)", padding: "14px 16px" }}>
                    {/* Header row */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "8px", marginBottom: "10px" }}>
                      <div>
                        <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary,#1e293b)" }}>{c.contractor_name}</div>
                        {c.contractor_phone && <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>{c.contractor_phone}</div>}
                      </div>
                      {/* Collection % badge */}
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "22px", fontWeight: 800, color: pctColor }}>{c.collection_pct}%</div>
                        <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>collected</div>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div style={{ height: "6px", borderRadius: "3px", backgroundColor: "#e2e8f0", marginBottom: "12px", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.min(100, c.collection_pct)}%`, backgroundColor: pctColor, borderRadius: "3px", transition: "width 0.3s" }} />
                    </div>

                    {/* Stats grid */}
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: "10px", marginBottom: "10px" }}>
                      {[
                        { label: "Letters issued", value: c.letters_issued, color: "var(--text-primary,#1e293b)" },
                        { label: "Total authorised", value: c.total_authorised.toLocaleString(), color: COLOURS.SLATE },
                        { label: "Total collected", value: c.total_collected.toLocaleString(), color: "#2563eb" },
                        { label: "Still outstanding", value: Math.max(0, c.total_authorised - c.total_collected).toLocaleString(), color: c.total_authorised > c.total_collected ? "#dc2626" : "#16a34a" },
                      ].map((s) => (
                        <div key={s.label} style={{ padding: "8px 10px", borderRadius: "8px", backgroundColor: "var(--bg-card-hover,#f8fafc)", border: "1px solid var(--border-light,#f1f5f9)" }}>
                          <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginBottom: "2px" }}>{s.label}</div>
                          <div style={{ fontSize: "16px", fontWeight: 700, color: s.color }}>{s.value}</div>
                        </div>
                      ))}
                    </div>

                    {/* Letter status breakdown */}
                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: c.avg_days_to_full_collection !== null ? "10px" : "0" }}>
                      {[
                        { label: "Fully collected", value: c.letters_fully_collected, bg: "#f0fdf4", color: "#16a34a" },
                        { label: "Partial", value: c.letters_partial, bg: "#fffbeb", color: "#d97706" },
                        { label: "Not started", value: c.letters_not_started, bg: "#f8fafc", color: COLOURS.SLATE },
                      ].map((s) => (
                        <span key={s.label} style={{ fontSize: "12px", padding: "3px 10px", borderRadius: "10px", backgroundColor: s.bg, color: s.color, fontWeight: 600 }}>
                          {s.value} {s.label}
                        </span>
                      ))}
                    </div>

                    {/* Speed metrics — only shown once at least one letter is fully collected */}
                    {c.avg_days_to_full_collection !== null && (
                      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", padding: "8px 10px", borderRadius: "8px", backgroundColor: "#eff6ff", border: "1px solid #bfdbfe" }}>
                        <span style={{ fontSize: "12px", color: "#1d4ed8" }}>
                          Avg days to collect: <strong>{c.avg_days_to_full_collection}d</strong>
                        </span>
                        {c.fastest_days !== null && (
                          <span style={{ fontSize: "12px", color: "#16a34a" }}>
                            Fastest: <strong>{c.fastest_days}d</strong>
                          </span>
                        )}
                        {c.slowest_days !== null && (
                          <span style={{ fontSize: "12px", color: "#dc2626" }}>
                            Slowest: <strong>{c.slowest_days}d</strong>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {toastEl}
        {confirmEl}
      </main>
    </AuthWrapper>
  );
}
