"use client";

import { useEffect, useState, useCallback } from "react";
import AuthWrapper from "../../lib/AuthWrapper";
import { useRequireCapability } from "../../lib/useRouteGuard";
import { supabase } from "../../lib/supabase";
import { useMobile } from "../../lib/useMobile";
import { COLOURS, PageHeader, SectionTitle, useToast, useConfirm, primaryButtonStyle, inputStyle, labelStyle } from "../../lib/SharedUI";
import { formatDateUK } from "../../lib/dateUtils";

type Plant = { id: string; name: string; type: string };
type PO = {
  id: string; plant_id: string; plant_name: string;
  customer_name: string; po_number: string; po_label: string;
  ordered_31: number; ordered_36: number; ordered_45: number; ordered_meter: number;
  variance_pct: number; status: string; is_system_unallocated: boolean;
  start_date: string | null; notes: string | null;
  opening_produced_31: number; opening_produced_36: number; opening_produced_45: number; opening_produced_meter: number;
};
type Contractor = { id: string; name: string; cnic_or_id: string | null; contact_phone: string | null; contact_address: string | null };

async function authedFetch(url: string, opts: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" } });
}

const emptyPO = { customer_name: "", po_number: "", po_label: "", ordered_31: "", ordered_36: "", ordered_45: "", ordered_meter: "", start_date: "", notes: "", opening_produced_31: "0", opening_produced_36: "0", opening_produced_45: "0", opening_produced_meter: "0" };
const emptyLetter = { contractor_id: "", letter_number: "", issue_date: "", issued_by: "", qty_31: "", qty_36: "", qty_45: "", qty_meter: "", opening_dispatched_31: "0", opening_dispatched_36: "0", opening_dispatched_45: "0", opening_dispatched_meter: "0", notes: "" };
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

  useEffect(() => { if (!checking) loadPlants(); }, [checking]);
  useEffect(() => { if (selectedPlant) { loadPOs(); loadContractors(); } }, [selectedPlant]);

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
        ordered_45: Number(poForm.ordered_45) || 0, ordered_meter: Number(poForm.ordered_meter) || 0,
        start_date: poForm.start_date || null, notes: poForm.notes || null,
        opening_produced_31: Number(poForm.opening_produced_31) || 0,
        opening_produced_36: Number(poForm.opening_produced_36) || 0,
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
        qty_31: Number(letterForm.qty_31) || 0, qty_36: Number(letterForm.qty_36) || 0,
        qty_45: Number(letterForm.qty_45) || 0, qty_meter: Number(letterForm.qty_meter) || 0,
        opening_dispatched_31: Number(letterForm.opening_dispatched_31) || 0,
        opening_dispatched_36: Number(letterForm.opening_dispatched_36) || 0,
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
              <Field label="Customer name *"><input value={poForm.customer_name} onChange={(e) => setPOForm({ ...poForm, customer_name: e.target.value })} placeholder="e.g. FESCO" style={{ ...inputStyle, width: "100%" }} /></Field>
              <Field label="PO number *"><input value={poForm.po_number} onChange={(e) => setPOForm({ ...poForm, po_number: e.target.value })} placeholder="e.g. FESCO-2024-001" style={{ ...inputStyle, width: "100%" }} /></Field>
              <Field label="PO label / description"><input value={poForm.po_label} onChange={(e) => setPOForm({ ...poForm, po_label: e.target.value })} placeholder="e.g. Old PO, 1st Year with 15% Repeat" style={{ ...inputStyle, width: "100%" }} /></Field>
              <Field label="Start date"><input type="date" value={poForm.start_date} onChange={(e) => setPOForm({ ...poForm, start_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
            </div>
            <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.SLATE, margin: "10px 0 8px" }}>Ordered quantities (by size)</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: "10px" }}>
              <Field label="31ft"><NumInput value={poForm.ordered_31} onChange={(v) => setPOForm({ ...poForm, ordered_31: v })} /></Field>
              <Field label="36ft"><NumInput value={poForm.ordered_36} onChange={(v) => setPOForm({ ...poForm, ordered_36: v })} /></Field>
              <Field label="45ft"><NumInput value={poForm.ordered_45} onChange={(v) => setPOForm({ ...poForm, ordered_45: v })} /></Field>
              <Field label="Meter"><NumInput value={poForm.ordered_meter} onChange={(v) => setPOForm({ ...poForm, ordered_meter: v })} /></Field>
            </div>
            <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.SLATE, margin: "10px 0 8px" }}>Opening balance (already produced before go-live)</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: "10px" }}>
              <Field label="31ft"><NumInput value={poForm.opening_produced_31} onChange={(v) => setPOForm({ ...poForm, opening_produced_31: v })} /></Field>
              <Field label="36ft"><NumInput value={poForm.opening_produced_36} onChange={(v) => setPOForm({ ...poForm, opening_produced_36: v })} /></Field>
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
              <div key={po.id} style={{ border: "1px solid var(--border-color,#e2e8f0)", borderRadius: "8px", padding: "12px 14px", backgroundColor: "var(--bg-card,#fff)", marginBottom: "8px", opacity: po.status === "Closed" ? 0.6 : 1, borderLeft: `4px solid ${po.status === "Closed" ? "#94a3b8" : COLOURS.NAVY}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "8px" }}>
                  <div>
                    <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary,#1e293b)" }}>
                      {po.customer_name} — PO #{po.po_number}
                      {po.po_label && <span style={{ fontSize: "12px", marginLeft: "8px", padding: "1px 8px", borderRadius: "10px", backgroundColor: "#eff6ff", color: "#2563eb", fontWeight: 600 }}>{po.po_label}</span>}
                      {po.status === "Closed" && <span style={{ fontSize: "11px", marginLeft: "8px", padding: "1px 8px", borderRadius: "10px", backgroundColor: "#f1f5f9", color: COLOURS.SLATE, fontWeight: 700 }}>CLOSED</span>}
                    </div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "3px" }}>
                      {po.start_date && `From ${formatDateUK(po.start_date)} · `}
                      Ordered: {[po.ordered_31 && `${po.ordered_31} × 31ft`, po.ordered_36 && `${po.ordered_36} × 36ft`, po.ordered_45 && `${po.ordered_45} × 45ft`, po.ordered_meter && `${po.ordered_meter} × Mtr`].filter(Boolean).join(", ")}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button
                      onClick={() => { setSelectedPOId(po.id); setShowLetterForm(true); }}
                      style={{ padding: "5px 12px", borderRadius: "6px", fontSize: "13px", fontWeight: 600, border: `1px solid ${COLOURS.NAVY}`, backgroundColor: "var(--bg-card,#fff)", color: COLOURS.NAVY, cursor: "pointer" }}
                    >
                      + Authority Letter
                    </button>
                    {po.status === "Active" && (
                      <button onClick={() => closePO(po)} style={{ padding: "5px 12px", borderRadius: "6px", fontSize: "13px", fontWeight: 600, border: "1px solid #e2e8f0", backgroundColor: "var(--bg-card,#fff)", color: COLOURS.SLATE, cursor: "pointer" }}>
                        Close PO
                      </button>
                    )}
                  </div>
                </div>
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
              <Field label="Letter number *"><input value={letterForm.letter_number} onChange={(e) => setLetterForm({ ...letterForm, letter_number: e.target.value })} placeholder="e.g. MEPCO-LT-2291" style={{ ...inputStyle, width: "100%" }} /></Field>
              <Field label="Issue date *"><input type="date" value={letterForm.issue_date} onChange={(e) => setLetterForm({ ...letterForm, issue_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
              <Field label="Issued by (customer rep name) *"><input value={letterForm.issued_by} onChange={(e) => setLetterForm({ ...letterForm, issued_by: e.target.value })} placeholder="Name of MEPCO/FESCO contact who issued it" style={{ ...inputStyle, width: "100%" }} /></Field>
            </div>
            <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.SLATE, margin: "10px 0 8px" }}>Letter quantity (authorized to collect)</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: "10px" }}>
              <Field label="31ft"><NumInput value={letterForm.qty_31} onChange={(v) => setLetterForm({ ...letterForm, qty_31: v })} /></Field>
              <Field label="36ft"><NumInput value={letterForm.qty_36} onChange={(v) => setLetterForm({ ...letterForm, qty_36: v })} /></Field>
              <Field label="45ft"><NumInput value={letterForm.qty_45} onChange={(v) => setLetterForm({ ...letterForm, qty_45: v })} /></Field>
              <Field label="Meter"><NumInput value={letterForm.qty_meter} onChange={(v) => setLetterForm({ ...letterForm, qty_meter: v })} /></Field>
            </div>
            <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.SLATE, margin: "10px 0 8px" }}>Already dispatched before go-live (opening balance)</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: "10px" }}>
              <Field label="31ft"><NumInput value={letterForm.opening_dispatched_31} onChange={(v) => setLetterForm({ ...letterForm, opening_dispatched_31: v })} /></Field>
              <Field label="36ft"><NumInput value={letterForm.opening_dispatched_36} onChange={(v) => setLetterForm({ ...letterForm, opening_dispatched_36: v })} /></Field>
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
            <div key={c.id} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-light,#f1f5f9)", display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--text-primary,#1e293b)" }}>{c.name}</span>
              {c.cnic_or_id && <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>ID: {c.cnic_or_id}</span>}
              {c.contact_phone && <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{c.contact_phone}</span>}
              {c.contact_address && <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{c.contact_address}</span>}
            </div>
          ))}
        </div>

        {toastEl}
        {confirmEl}
      </main>
    </AuthWrapper>
  );
}
