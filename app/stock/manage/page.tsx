"use client";

import { useEffect, useState, useCallback } from "react";
import AuthWrapper from "../../lib/AuthWrapper";
import { useRequireCapability } from "../../lib/useRouteGuard";
import { supabase } from "../../lib/supabase";
import { useMobile } from "../../lib/useMobile";
import {
  COLOURS, RADII, PageHeader, SectionTitle, CountCard,
  useToast, useConfirm,
  primaryButtonStyle, inputStyle, labelStyle, cardStyle,
} from "../../lib/SharedUI";
import { formatDateUK } from "../../lib/dateUtils";
import DateInputWithCalendar from "../../lib/DateInputWithCalendar";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────
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
type FlatLetter = {
  id: string; letter_number: string; expiry_date: string | null;
  po_id: string; po_number: string; customer_name: string;
  contractor_id: string; contractor_name: string;
  qty_31: number; qty_36: number; qty_40: number; qty_45: number; qty_meter: number;
  remaining_31: number; remaining_36: number; remaining_40: number; remaining_45: number; remaining_meter: number;
};
type DispatchRecord = {
  id: string; authority_letter_id: string; dispatch_date: string;
  qty_31: number; qty_36: number; qty_40: number; qty_45: number; qty_meter: number;
  released_by: string; vehicle_number: string | null; notes: string | null;
};
type ContractorPerf = {
  contractor_id: string; contractor_name: string; contractor_phone: string | null;
  letters_issued: number; total_authorised: number; total_collected: number; collection_pct: number;
  letters_fully_collected: number; letters_partial: number; letters_not_started: number;
  avg_days_to_full_collection: number | null; fastest_days: number | null; slowest_days: number | null;
};
type ActiveTab = "pos" | "letters" | "contractors" | "performance";

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────
async function authedFetch(url: string, opts: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
  });
}

type ExpiryStatus = "Expired" | "Expiring7" | "Expiring14" | "Active" | "Complete";

function expiryStatus(expiry: string | null, totalRemaining: number): ExpiryStatus {
  if (totalRemaining === 0) return "Complete";
  if (!expiry) return "Active";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expiry + "T00:00:00");
  const diffDays = Math.floor((exp.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return "Expired";
  if (diffDays <= 7) return "Expiring7";
  if (diffDays <= 14) return "Expiring14";
  return "Active";
}

function expiryDaysLeft(expiry: string | null): number | null {
  if (!expiry) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expiry + "T00:00:00");
  return Math.floor((exp.getTime() - today.getTime()) / 86400000);
}

function expiryChipStyle(status: ExpiryStatus): React.CSSProperties {
  if (status === "Expired" || status === "Expiring7") {
    return { backgroundColor: COLOURS.DANGER_SOFT, color: COLOURS.RED, fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: RADII.PILL, whiteSpace: "nowrap" as const };
  }
  if (status === "Expiring14") {
    return { backgroundColor: COLOURS.WARNING_SOFT, color: COLOURS.AMBER, fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: RADII.PILL, whiteSpace: "nowrap" as const };
  }
  if (status === "Complete") {
    return { backgroundColor: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN, fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: RADII.PILL, whiteSpace: "nowrap" as const };
  }
  return { backgroundColor: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN, fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: RADII.PILL, whiteSpace: "nowrap" as const };
}

function expiryLabel(status: ExpiryStatus, expiry: string | null): string {
  if (status === "Complete") return "Complete";
  if (status === "Expired") return "Expired";
  const days = expiryDaysLeft(expiry);
  if (status === "Expiring7") return `${days}d left`;
  if (status === "Expiring14") return `${days}d left`;
  return "Active";
}

function progressColor(pct: number, expired: boolean): string {
  if (expired) return COLOURS.RED;
  if (pct >= 95) return COLOURS.RED;
  if (pct >= 75) return COLOURS.AMBER;
  return COLOURS.GREEN;
}

function exportToCSV(data: PO[], filename: string) {
  const headers = ["Customer", "PO Number", "Label", "Status", "Start Date", "31ft", "36ft", "40ft", "45ft", "Meter"];
  const rows = data.map((po) => [
    po.customer_name,
    po.po_number || "",
    po.po_label || "",
    po.status || "Active",
    po.start_date ? po.start_date.split("-").reverse().join("/") : "",
    po.ordered_31,
    po.ordered_36,
    po.ordered_40,
    po.ordered_45,
    po.ordered_meter,
  ]);
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────
// Small shared UI pieces
// ─────────────────────────────────────────────────────────────────
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

function ghostBtn(active?: boolean): React.CSSProperties {
  return {
    padding: "5px 12px", borderRadius: RADII.PILL, fontSize: "12px", fontWeight: 600,
    border: `1px solid ${COLOURS.HAIRLINE}`,
    backgroundColor: active ? COLOURS.CARD_ALT : COLOURS.CARD,
    color: COLOURS.SLATE, cursor: "pointer",
  };
}

function filterPillStyle(active: boolean): React.CSSProperties {
  return {
    padding: "5px 14px", borderRadius: RADII.PILL, fontSize: "12px", fontWeight: 600,
    border: `1px solid ${active ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
    backgroundColor: active ? COLOURS.NAVY : COLOURS.CARD,
    color: active ? "white" : COLOURS.SLATE,
    cursor: "pointer",
  };
}

const kicker: React.CSSProperties = {
  fontSize: "10.5px", fontWeight: 500, letterSpacing: "0.08em",
  textTransform: "uppercase", color: COLOURS.SLATE,
  fontFamily: "var(--font-sans, Inter, sans-serif)",
};

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #3B4CCA, #6E7AE0)",
  "linear-gradient(135deg, #0F7B5F, #4CB58F)",
  "linear-gradient(135deg, #B4791F, #E1B860)",
  "linear-gradient(135deg, #6E45B8, #A17DDD)",
  "linear-gradient(135deg, #64748B, #A5B0BF)",
];

function avatarGradient(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[h];
}

// ─────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────
export default function StockManagePage() {
  const { checking } = useRequireCapability("stock");
  const isMobile = useMobile();
  const { show: toast, element: toastEl } = useToast();
  const { confirm, element: confirmEl } = useConfirm();

  // ── Core data ──
  const [plants, setPlants] = useState<Plant[]>([]);
  const [selectedPlant, setSelectedPlant] = useState("");
  const [pos, setPOs] = useState<PO[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [loading, setLoading] = useState(false);
  const [performance, setPerformance] = useState<ContractorPerf[]>([]);
  const [perfLoading, setPerfLoading] = useState(false);

  // ── Tab state ──
  const [activeTab, setActiveTab] = useState<ActiveTab>("pos");

  // ── PO tab state ──
  const [poSearch, setPoSearch] = useState("");
  const [poFilter, setPoFilter] = useState<"all" | "active" | "closed">("all");
  const [selectedPOs, setSelectedPOs] = useState<Set<string>>(new Set());
  const [expandedPOs, setExpandedPOs] = useState<Set<string>>(new Set());
  const [bulkClosing, setBulkClosing] = useState(false);

  // ── Letters tab state ──
  const [allLetters, setAllLetters] = useState<FlatLetter[]>([]);
  const [allLettersLoading, setAllLettersLoading] = useState(false);
  const [allLettersLoaded, setAllLettersLoaded] = useState(false);
  const [letterSearch, setLetterSearch] = useState("");
  const [letterFilter, setLetterFilter] = useState<"all" | "active" | "expiring" | "expired" | "complete">("all");

  // ── Contractors tab search ──
  const [contractorSearch, setContractorSearch] = useState("");

  // ── PO form ──
  const [showPOForm, setShowPOForm] = useState(false);
  const [poForm, setPOForm] = useState(emptyPO);
  const [savingPO, setSavingPO] = useState(false);

  // ── PO edit (core fields) ──
  const [editPOId, setEditPOId] = useState<string | null>(null);
  const [editPOForm, setEditPOForm] = useState(emptyPO);
  const [savingEditPO, setSavingEditPO] = useState(false);

  // ── Letter (new) form — shown inside PO card ──
  const [showLetterForm, setShowLetterForm] = useState(false);
  const [selectedPOId, setSelectedPOId] = useState("");
  const [letterForm, setLetterForm] = useState(emptyLetter);
  const [savingLetter, setSavingLetter] = useState(false);

  // ── Letters per PO (lazy loaded when expanding a PO) ──
  const [viewLettersPOId, setViewLettersPOId] = useState<string | null>(null);
  const [letters, setLetters] = useState<AuthorityLetter[]>([]);
  const [lettersLoading, setLettersLoading] = useState(false);
  const [editLetterId, setEditLetterId] = useState<string | null>(null);
  const [editLetterForm, setEditLetterForm] = useState(emptyLetter);
  const [savingEditLetter, setSavingEditLetter] = useState(false);
  const [deletingLetterId, setDeletingLetterId] = useState<string | null>(null);

  // ── Contractor form ──
  const [showContractorForm, setShowContractorForm] = useState(false);
  const [contractorForm, setContractorForm] = useState(emptyContractor);
  const [savingContractor, setSavingContractor] = useState(false);
  const [editContractorId, setEditContractorId] = useState<string | null>(null);
  const [editContractorForm, setEditContractorForm] = useState(emptyContractor);
  const [savingEditContractor, setSavingEditContractor] = useState(false);
  const [deletingContractorId, setDeletingContractorId] = useState<string | null>(null);

  // ── Dispatch records ──
  const [viewDispatchLetterId, setViewDispatchLetterId] = useState<string | null>(null);
  const [dispatches, setDispatches] = useState<DispatchRecord[]>([]);
  const [dispatchesLoading, setDispatchesLoading] = useState(false);
  const [showNewDispatchForm, setShowNewDispatchForm] = useState(false);
  const [newDispatchForm, setNewDispatchForm] = useState({ dispatch_date: "", qty_31: "", qty_36: "", qty_40: "", qty_45: "", qty_meter: "", released_by: "", vehicle_number: "", notes: "" });
  const [savingNewDispatch, setSavingNewDispatch] = useState(false);
  const [editDispatchId, setEditDispatchId] = useState<string | null>(null);
  const [editDispatchForm, setEditDispatchForm] = useState({ dispatch_date: "", qty_31: "", qty_36: "", qty_40: "", qty_45: "", qty_meter: "", released_by: "", vehicle_number: "", notes: "" });
  const [savingEditDispatch, setSavingEditDispatch] = useState(false);

  // ─────────────────────────────────────────────────────────────
  // Data loading
  // ─────────────────────────────────────────────────────────────
  useEffect(() => { if (!checking) loadPlants(); }, [checking]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selectedPlant) {
      loadPOs();
      loadContractors();
      loadPerformance();
      // Reset letters tab state when plant changes
      setAllLetters([]);
      setAllLettersLoaded(false);
    }
  }, [selectedPlant]);

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

  const loadAllLetters = useCallback(async () => {
    if (!selectedPlant) return;
    setAllLettersLoading(true);
    try {
      const res = await authedFetch(`/api/stock/authority-letters?plantId=${selectedPlant}&listAll=true`);
      const json = await res.json();
      const sorted = (json.letters || []).sort((a: FlatLetter, b: FlatLetter) => {
        const aExp = a.expiry_date ? new Date(a.expiry_date).getTime() : Infinity;
        const bExp = b.expiry_date ? new Date(b.expiry_date).getTime() : Infinity;
        return aExp - bExp;
      });
      setAllLetters(sorted);
      setAllLettersLoaded(true);
    } finally {
      setAllLettersLoading(false);
    }
  }, [selectedPlant]);

  // ─────────────────────────────────────────────────────────────
  // PO CRUD
  // ─────────────────────────────────────────────────────────────
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

  async function handleBulkClose() {
    if (selectedPOs.size === 0) return;
    const ok = await confirm(`Close ${selectedPOs.size} selected PO${selectedPOs.size > 1 ? "s" : ""}? They will stay visible but greyed out.`, true);
    if (!ok) return;
    setBulkClosing(true);
    const ids = Array.from(selectedPOs);
    await Promise.all(ids.map((id) =>
      authedFetch("/api/stock/purchase-orders", { method: "PATCH", body: JSON.stringify({ id, status: "Closed" }) })
    ));
    setBulkClosing(false);
    setSelectedPOs(new Set());
    toast(`${ids.length} PO${ids.length > 1 ? "s" : ""} closed`, "success");
    loadPOs();
  }

  function startEditPO(po: PO) {
    setEditPOId(po.id);
    setEditPOForm({
      customer_name: po.customer_name, po_number: po.po_number, po_label: po.po_label || "",
      ordered_31: String(po.ordered_31 || ""), ordered_36: String(po.ordered_36 || ""),
      ordered_40: String(po.ordered_40 || ""), ordered_45: String(po.ordered_45 || ""),
      ordered_meter: String(po.ordered_meter || ""),
      start_date: po.start_date || "", notes: po.notes || "",
      opening_produced_31: String(po.opening_produced_31 || "0"),
      opening_produced_36: String(po.opening_produced_36 || "0"),
      opening_produced_40: String(po.opening_produced_40 || "0"),
      opening_produced_45: String(po.opening_produced_45 || "0"),
      opening_produced_meter: String(po.opening_produced_meter || "0"),
    });
  }

  async function saveEditPO() {
    if (!editPOId) return;
    if (!editPOForm.customer_name || !editPOForm.po_number) { toast("Customer name and PO number are required", "error"); return; }
    setSavingEditPO(true);
    const res = await authedFetch("/api/stock/purchase-orders", {
      method: "PATCH",
      body: JSON.stringify({
        id: editPOId,
        customer_name: editPOForm.customer_name, po_number: editPOForm.po_number, po_label: editPOForm.po_label,
        ordered_31: Number(editPOForm.ordered_31) || 0, ordered_36: Number(editPOForm.ordered_36) || 0,
        ordered_45: Number(editPOForm.ordered_45) || 0, ordered_meter: Number(editPOForm.ordered_meter) || 0,
        start_date: editPOForm.start_date || null, notes: editPOForm.notes || null,
        opening_produced_31: Number(editPOForm.opening_produced_31) || 0,
        opening_produced_36: Number(editPOForm.opening_produced_36) || 0,
        opening_produced_45: Number(editPOForm.opening_produced_45) || 0,
        opening_produced_meter: Number(editPOForm.opening_produced_meter) || 0,
      }),
    });
    const json = await res.json();
    setSavingEditPO(false);
    if (json.error) { toast(json.error, "error"); return; }
    toast("PO updated", "success");
    setEditPOId(null);
    loadPOs();
  }

  async function handleBulkDelete() {
    if (selectedPOs.size === 0) return;
    const ok = await confirm(`Permanently delete ${selectedPOs.size} selected PO${selectedPOs.size > 1 ? "s" : ""}? This cannot be undone.`, true);
    if (!ok) return;
    const ids = Array.from(selectedPOs);
    let errors = 0;
    for (const id of ids) {
      const res = await authedFetch("/api/stock/purchase-orders", { method: "DELETE", body: JSON.stringify({ id }) });
      const json = await res.json();
      if (json.error) errors++;
    }
    setSelectedPOs(new Set());
    if (errors > 0) toast(`${errors} deletion${errors > 1 ? "s" : ""} failed`, "error");
    else toast(`${ids.length} PO${ids.length > 1 ? "s" : ""} deleted`, "success");
    loadPOs();
  }

  // ─────────────────────────────────────────────────────────────
  // Letter CRUD
  // ─────────────────────────────────────────────────────────────
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
    if (viewLettersPOId === selectedPOId) loadLetters(selectedPOId);
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
      contractor_id: l.contractor_id, letter_number: l.letter_number,
      issue_date: l.issue_date, issued_by: l.issued_by, expiry_date: l.expiry_date || "",
      qty_31: String(l.qty_31 || ""), qty_36: String(l.qty_36 || ""),
      qty_40: String(l.qty_40 || ""), qty_45: String(l.qty_45 || ""), qty_meter: String(l.qty_meter || ""),
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

  async function deleteLetter(l: AuthorityLetter) {
    const ok = await confirm(`Permanently delete authority letter #${l.letter_number}? This cannot be undone.`, true);
    if (!ok) return;
    setDeletingLetterId(l.id);
    const res = await authedFetch("/api/stock/authority-letters", { method: "DELETE", body: JSON.stringify({ id: l.id }) });
    const json = await res.json();
    setDeletingLetterId(null);
    if (json.error) { toast(json.error, "error"); return; }
    toast("Letter deleted", "success");
    if (viewLettersPOId) loadLetters(viewLettersPOId);
    loadPOs();
  }

  // ─────────────────────────────────────────────────────────────
  // Contractor CRUD
  // ─────────────────────────────────────────────────────────────
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

  function startEditContractor(c: Contractor) {
    setEditContractorId(c.id);
    setEditContractorForm({ name: c.name, cnic_or_id: c.cnic_or_id || "", contact_phone: c.contact_phone || "", contact_address: c.contact_address || "" });
  }

  async function saveEditContractor() {
    if (!editContractorId) return;
    if (!editContractorForm.name) { toast("Name is required", "error"); return; }
    setSavingEditContractor(true);
    const res = await authedFetch("/api/stock/contractors", { method: "PATCH", body: JSON.stringify({ id: editContractorId, ...editContractorForm }) });
    const json = await res.json();
    setSavingEditContractor(false);
    if (json.error) { toast(json.error, "error"); return; }
    toast("Contractor updated", "success");
    setEditContractorId(null);
    loadContractors();
  }

  async function deleteContractor(c: Contractor) {
    const ok = await confirm(`Permanently delete contractor "${c.name}"? This cannot be undone.`, true);
    if (!ok) return;
    setDeletingContractorId(c.id);
    const res = await authedFetch("/api/stock/contractors", { method: "DELETE", body: JSON.stringify({ id: c.id }) });
    const json = await res.json();
    setDeletingContractorId(null);
    if (json.error) { toast(json.error, "error"); return; }
    toast("Contractor deleted", "success");
    loadContractors();
  }

  // ─────────────────────────────────────────────────────────────
  // Dispatch CRUD
  // ─────────────────────────────────────────────────────────────
  async function loadDispatches(letterId: string) {
    setDispatchesLoading(true);
    const res = await authedFetch(`/api/stock/dispatch-records?letterId=${letterId}`);
    const json = await res.json();
    setDispatches(json.dispatches || []);
    setDispatchesLoading(false);
  }

  async function saveNewDispatch() {
    if (!viewDispatchLetterId) return;
    if (!newDispatchForm.dispatch_date || !newDispatchForm.released_by) { toast("Date and released-by are required", "error"); return; }
    setSavingNewDispatch(true);
    const res = await authedFetch("/api/stock/dispatch-records", {
      method: "POST",
      body: JSON.stringify({
        authority_letter_id: viewDispatchLetterId,
        dispatch_date: newDispatchForm.dispatch_date,
        qty_31: Number(newDispatchForm.qty_31) || 0, qty_36: Number(newDispatchForm.qty_36) || 0,
        qty_40: Number(newDispatchForm.qty_40) || 0, qty_45: Number(newDispatchForm.qty_45) || 0,
        qty_meter: Number(newDispatchForm.qty_meter) || 0,
        released_by: newDispatchForm.released_by,
        vehicle_number: newDispatchForm.vehicle_number || null,
        notes: newDispatchForm.notes || null,
      }),
    });
    const json = await res.json();
    setSavingNewDispatch(false);
    if (json.error) { toast(json.error, "error"); return; }
    toast("Dispatch recorded", "success");
    setShowNewDispatchForm(false);
    setNewDispatchForm({ dispatch_date: "", qty_31: "", qty_36: "", qty_40: "", qty_45: "", qty_meter: "", released_by: "", vehicle_number: "", notes: "" });
    loadDispatches(viewDispatchLetterId);
    loadPOs();
  }

  function startEditDispatch(d: DispatchRecord) {
    setEditDispatchId(d.id);
    setEditDispatchForm({
      dispatch_date: d.dispatch_date,
      qty_31: String(d.qty_31 || ""), qty_36: String(d.qty_36 || ""),
      qty_40: String(d.qty_40 || ""), qty_45: String(d.qty_45 || ""), qty_meter: String(d.qty_meter || ""),
      released_by: d.released_by, vehicle_number: d.vehicle_number || "", notes: d.notes || "",
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
        qty_31: Number(editDispatchForm.qty_31) || 0, qty_36: Number(editDispatchForm.qty_36) || 0,
        qty_40: Number(editDispatchForm.qty_40) || 0, qty_45: Number(editDispatchForm.qty_45) || 0,
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

  // ─────────────────────────────────────────────────────────────
  // Computed values
  // ─────────────────────────────────────────────────────────────
  if (checking) return <AuthWrapper><main style={{ padding: "14px 18px" }}><p style={{ color: COLOURS.SLATE }}>Checking permissions…</p></main></AuthWrapper>;

  const visiblePOs = pos.filter((p) => !p.is_system_unallocated);
  const activePOs = visiblePOs.filter((p) => p.status === "Active");
  const closedPOs = visiblePOs.filter((p) => p.status === "Closed");

  const filteredPOs = visiblePOs.filter((po) => {
    const matchFilter = poFilter === "all" || (poFilter === "active" && po.status === "Active") || (poFilter === "closed" && po.status === "Closed");
    if (!matchFilter) return false;
    if (!poSearch) return true;
    const q = poSearch.toLowerCase();
    return (
      po.customer_name.toLowerCase().includes(q) ||
      (po.po_number || "").toLowerCase().includes(q) ||
      (po.po_label || "").toLowerCase().includes(q)
    );
  });

  const filteredLetters = allLetters.filter((l) => {
    const totalRemaining = l.remaining_31 + l.remaining_36 + l.remaining_40 + l.remaining_45 + l.remaining_meter;
    const status = expiryStatus(l.expiry_date, totalRemaining);
    if (letterFilter !== "all") {
      if (letterFilter === "complete" && status !== "Complete") return false;
      if (letterFilter === "expired" && status !== "Expired") return false;
      if (letterFilter === "expiring" && status !== "Expiring7" && status !== "Expiring14") return false;
      if (letterFilter === "active" && status !== "Active") return false;
    }
    if (!letterSearch) return true;
    const q = letterSearch.toLowerCase();
    return (
      l.letter_number.toLowerCase().includes(q) ||
      l.contractor_name.toLowerCase().includes(q) ||
      l.customer_name.toLowerCase().includes(q)
    );
  });

  const filteredContractors = contractors.filter((c) => {
    if (!contractorSearch) return true;
    const q = contractorSearch.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      (c.cnic_or_id || "").toLowerCase().includes(q) ||
      (c.contact_phone || "").toLowerCase().includes(q) ||
      (c.contact_address || "").toLowerCase().includes(q)
    );
  });

  const tabs: { key: ActiveTab; label: string; count?: number }[] = [
    { key: "pos", label: "Purchase orders", count: visiblePOs.length },
    { key: "letters", label: "Authority letters", count: allLettersLoaded ? allLetters.length : undefined },
    { key: "contractors", label: "Contractors", count: contractors.length },
    { key: "performance", label: "Performance" },
  ];

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
        <PageHeader />

        {/* ── Page title ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", marginBottom: "18px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 800, color: COLOURS.NAVY, margin: "0 0 4px", fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>Manage POs &amp; Letters</h1>
            <p style={{ fontSize: "14px", color: COLOURS.SLATE, margin: 0 }}>Purchase orders, authority letters, contractors</p>
          </div>
          <a href="/stock" style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, textDecoration: "none" }}>← Back to Stock</a>
        </div>

        {/* ── Plant selector ── */}
        <div style={{
          display: "inline-flex", gap: "2px",
          backgroundColor: COLOURS.CARD_ALT,
          border: `1px solid ${COLOURS.HAIRLINE}`,
          borderRadius: RADII.PILL,
          padding: "3px",
          marginBottom: "20px",
          flexWrap: "wrap",
        }}>
          {plants.map((p) => {
            const isActive = selectedPlant === p.id;
            return (
              <button
                key={p.id}
                onClick={() => {
                  setSelectedPlant(p.id);
                  setSelectedPOs(new Set());
                  setExpandedPOs(new Set());
                  setViewLettersPOId(null);
                  setViewDispatchLetterId(null);
                }}
                style={{
                  padding: "8px 16px", borderRadius: RADII.PILL, fontSize: "12.5px", fontWeight: 500,
                  border: "none", cursor: "pointer",
                  backgroundColor: isActive ? COLOURS.NAVY : "transparent",
                  color: isActive ? "white" : COLOURS.INK_700,
                  transition: "all 0.15s",
                }}
              >
                {p.name}
              </button>
            );
          })}
        </div>

        {/* ── Tab strip ── */}
        <div style={{
          display: "flex", gap: "4px",
          backgroundColor: COLOURS.CARD_ALT,
          border: `1px solid ${COLOURS.HAIRLINE}`,
          borderRadius: RADII.PILL,
          padding: "4px",
          width: "fit-content",
          marginBottom: "24px",
          flexWrap: "wrap",
        }}>
          {tabs.map((t) => {
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => {
                  setActiveTab(t.key);
                  if (t.key === "letters" && !allLettersLoaded && !allLettersLoading) {
                    loadAllLetters();
                  }
                }}
                style={{
                  padding: "7px 16px", fontSize: "12.5px", borderRadius: RADII.PILL,
                  border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: "6px",
                  backgroundColor: isActive ? COLOURS.CARD : "transparent",
                  color: isActive ? COLOURS.NAVY : COLOURS.SLATE,
                  fontWeight: isActive ? 500 : 400,
                  boxShadow: isActive ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                  transition: "all 0.15s",
                }}
              >
                {t.label}
                {t.count !== undefined && (
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "10.5px", color: isActive ? COLOURS.SLATE : COLOURS.INK_400 }}>
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ══════════════════════════════════════════════
            TAB 1 — PURCHASE ORDERS
        ══════════════════════════════════════════════ */}
        {activeTab === "pos" && (
          <>
            {/* Stats row */}
            {!loading && (
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: "12px", marginBottom: "20px" }}>
                <CountCard label="Active POs" value={activePOs.length} color={COLOURS.GREEN} />
                <CountCard label="Closed POs" value={closedPOs.length} color={COLOURS.SLATE} />
                <CountCard
                  label="Expiring ≤ 14 days"
                  value={(() => {
                    return 0;
                  })()}
                  color={COLOURS.AMBER}
                />
                <CountCard label="Fully collected" value={0} color={COLOURS.BLUE} />
              </div>
            )}

            {/* Toolbar */}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginBottom: "12px" }}>
              {/* Search */}
              <div style={{ position: "relative", flex: isMobile ? "1 1 100%" : "1 1 260px", minWidth: 0 }}>
                <input
                  value={poSearch}
                  onChange={(e) => setPoSearch(e.target.value)}
                  placeholder="Search by customer, PO number…"
                  style={{ ...inputStyle, paddingLeft: "32px", width: "100%", boxSizing: "border-box" }}
                />
                <span style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: COLOURS.SLATE, fontSize: "13px", pointerEvents: "none" }}>⌕</span>
              </div>

              {/* Filter pills */}
              <div style={{ display: "flex", gap: "4px" }}>
                {(["all", "active", "closed"] as const).map((f) => (
                  <button key={f} onClick={() => setPoFilter(f)} style={filterPillStyle(poFilter === f)}>
                    {f === "all" ? "All" : f === "active" ? "Active" : "Closed"}
                  </button>
                ))}
              </div>

              <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
                <button
                  onClick={() => exportToCSV(filteredPOs, "purchase-orders.csv")}
                  style={{ ...ghostBtn(), fontSize: "12px" }}
                >
                  Export CSV
                </button>
                <button onClick={() => { setShowPOForm((v) => !v); }} style={primaryButtonStyle}>
                  {showPOForm ? "Cancel" : "+ New PO"}
                </button>
              </div>
            </div>

            {/* Bulk action bar */}
            {selectedPOs.size > 0 && (
              <div style={{
                display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
                padding: "10px 16px", borderRadius: RADII.CARD,
                backgroundColor: COLOURS.NAVY, marginBottom: "12px",
              }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "white", flex: 1 }}>
                  {selectedPOs.size} PO{selectedPOs.size > 1 ? "s" : ""} selected
                </span>
                <button
                  onClick={handleBulkClose}
                  disabled={bulkClosing}
                  style={{ padding: "5px 14px", borderRadius: RADII.PILL, fontSize: "12px", fontWeight: 600, border: "1px solid rgba(255,255,255,0.3)", backgroundColor: "transparent", color: "white", cursor: "pointer", opacity: bulkClosing ? 0.6 : 1 }}
                >
                  {bulkClosing ? "Closing…" : "Close selected"}
                </button>
                <button
                  onClick={() => exportToCSV(filteredPOs.filter((p) => selectedPOs.has(p.id)), "selected-pos.csv")}
                  style={{ padding: "5px 14px", borderRadius: RADII.PILL, fontSize: "12px", fontWeight: 600, border: "1px solid rgba(255,255,255,0.3)", backgroundColor: "transparent", color: "white", cursor: "pointer" }}
                >
                  Export selected
                </button>
                <button
                  onClick={handleBulkDelete}
                  // Derived from COLOURS.RED (#B3261E = rgb(179,38,30)), lightened for
                  // contrast on the dark navy toolbar background.
                  style={{ padding: "5px 14px", borderRadius: RADII.PILL, fontSize: "12px", fontWeight: 600, border: "1px solid rgba(179,38,30,0.5)", backgroundColor: "rgba(179,38,30,0.15)", color: "#DFA3A0", cursor: "pointer" }}
                >
                  Delete selected
                </button>
                <button
                  onClick={() => setSelectedPOs(new Set())}
                  style={{ padding: "5px 12px", borderRadius: RADII.PILL, fontSize: "12px", fontWeight: 600, border: "none", backgroundColor: "transparent", color: "rgba(255,255,255,0.5)", cursor: "pointer" }}
                >
                  ✕ Clear
                </button>
              </div>
            )}

            {/* New PO form */}
            {showPOForm && (
              <div style={{ ...cardStyle, marginBottom: "16px" }}>
                <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "14px", fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>New Purchase Order</div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "12px" }}>
                  <Field label="Customer name *"><input value={poForm.customer_name} onChange={(e) => setPOForm({ ...poForm, customer_name: e.target.value })} placeholder="e.g. FESCO, MEPCO, Packages Ltd" style={{ ...inputStyle, width: "100%" }} /></Field>
                  <Field label="PO number *"><input value={poForm.po_number} onChange={(e) => setPOForm({ ...poForm, po_number: e.target.value })} placeholder="e.g. FESCO-2024-001" style={{ ...inputStyle, width: "100%" }} /></Field>
                  <Field label="PO label / description"><input value={poForm.po_label} onChange={(e) => setPOForm({ ...poForm, po_label: e.target.value })} placeholder="e.g. 1st Year with 15% Repeat" style={{ ...inputStyle, width: "100%" }} /></Field>
                  <Field label="Start date"><DateInputWithCalendar value={poForm.start_date} onChange={(e) => setPOForm({ ...poForm, start_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                </div>
                <div style={{ ...kicker, margin: "12px 0 8px" }}>Ordered quantities (by size)</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px,1fr))", gap: "10px" }}>
                  <Field label="31ft"><NumInput value={poForm.ordered_31} onChange={(v) => setPOForm({ ...poForm, ordered_31: v })} /></Field>
                  <Field label="36ft"><NumInput value={poForm.ordered_36} onChange={(v) => setPOForm({ ...poForm, ordered_36: v })} /></Field>
                  <Field label="40ft"><NumInput value={poForm.ordered_40} onChange={(v) => setPOForm({ ...poForm, ordered_40: v })} /></Field>
                  <Field label="45ft"><NumInput value={poForm.ordered_45} onChange={(v) => setPOForm({ ...poForm, ordered_45: v })} /></Field>
                  <Field label="Meter"><NumInput value={poForm.ordered_meter} onChange={(v) => setPOForm({ ...poForm, ordered_meter: v })} /></Field>
                </div>
                <div style={{ ...kicker, margin: "12px 0 8px" }}>Opening balance (already produced before go-live)</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px,1fr))", gap: "10px" }}>
                  <Field label="31ft"><NumInput value={poForm.opening_produced_31} onChange={(v) => setPOForm({ ...poForm, opening_produced_31: v })} /></Field>
                  <Field label="36ft"><NumInput value={poForm.opening_produced_36} onChange={(v) => setPOForm({ ...poForm, opening_produced_36: v })} /></Field>
                  <Field label="40ft"><NumInput value={poForm.opening_produced_40} onChange={(v) => setPOForm({ ...poForm, opening_produced_40: v })} /></Field>
                  <Field label="45ft"><NumInput value={poForm.opening_produced_45} onChange={(v) => setPOForm({ ...poForm, opening_produced_45: v })} /></Field>
                  <Field label="Meter"><NumInput value={poForm.opening_produced_meter} onChange={(v) => setPOForm({ ...poForm, opening_produced_meter: v })} /></Field>
                </div>
                <Field label="Notes"><textarea value={poForm.notes || ""} onChange={(e) => setPOForm({ ...poForm, notes: e.target.value })} rows={2} style={{ ...inputStyle, width: "100%", resize: "vertical" as const }} /></Field>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={savePO} disabled={savingPO} style={{ ...primaryButtonStyle, opacity: savingPO ? 0.6 : 1 }}>{savingPO ? "Saving…" : "Create PO"}</button>
                  <button onClick={() => { setShowPOForm(false); setPOForm(emptyPO); }} style={{ padding: "8px 18px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 500, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: COLOURS.CARD, color: COLOURS.SLATE, cursor: "pointer" }}>Cancel</button>
                </div>
              </div>
            )}

            {/* Issue Letter form (shown when triggered from a PO card) */}
            {showLetterForm && (
              <div style={{ ...cardStyle, backgroundColor: COLOURS.CARD_ALT, marginBottom: "16px" }}>
                <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "12px", fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>
                  Issue Authority Letter — {pos.find((p) => p.id === selectedPOId)?.customer_name} PO #{pos.find((p) => p.id === selectedPOId)?.po_number}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "12px" }}>
                  <Field label="Contractor *">
                    <select value={letterForm.contractor_id} onChange={(e) => setLetterForm({ ...letterForm, contractor_id: e.target.value })} style={{ ...inputStyle, width: "100%" }}>
                      <option value="">Select contractor…</option>
                      {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Letter / reference number *"><input value={letterForm.letter_number} onChange={(e) => setLetterForm({ ...letterForm, letter_number: e.target.value })} placeholder="e.g. FESCO-LT-2291" style={{ ...inputStyle, width: "100%" }} /></Field>
                  <Field label="Issue date *"><DateInputWithCalendar value={letterForm.issue_date} onChange={(e) => setLetterForm({ ...letterForm, issue_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                  <Field label="Authorised by *"><input value={letterForm.issued_by} onChange={(e) => setLetterForm({ ...letterForm, issued_by: e.target.value })} placeholder="Name of contact who authorised collection" style={{ ...inputStyle, width: "100%" }} /></Field>
                  <Field label="Expiry date (optional)"><DateInputWithCalendar value={letterForm.expiry_date} onChange={(e) => setLetterForm({ ...letterForm, expiry_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                </div>
                <div style={{ ...kicker, margin: "10px 0 8px" }}>Letter quantity (authorised to collect)</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px,1fr))", gap: "10px" }}>
                  <Field label="31ft"><NumInput value={letterForm.qty_31} onChange={(v) => setLetterForm({ ...letterForm, qty_31: v })} /></Field>
                  <Field label="36ft"><NumInput value={letterForm.qty_36} onChange={(v) => setLetterForm({ ...letterForm, qty_36: v })} /></Field>
                  <Field label="40ft"><NumInput value={letterForm.qty_40} onChange={(v) => setLetterForm({ ...letterForm, qty_40: v })} /></Field>
                  <Field label="45ft"><NumInput value={letterForm.qty_45} onChange={(v) => setLetterForm({ ...letterForm, qty_45: v })} /></Field>
                  <Field label="Meter"><NumInput value={letterForm.qty_meter} onChange={(v) => setLetterForm({ ...letterForm, qty_meter: v })} /></Field>
                </div>
                <div style={{ ...kicker, margin: "10px 0 8px" }}>Already dispatched before go-live (opening balance)</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px,1fr))", gap: "10px" }}>
                  <Field label="31ft"><NumInput value={letterForm.opening_dispatched_31} onChange={(v) => setLetterForm({ ...letterForm, opening_dispatched_31: v })} /></Field>
                  <Field label="36ft"><NumInput value={letterForm.opening_dispatched_36} onChange={(v) => setLetterForm({ ...letterForm, opening_dispatched_36: v })} /></Field>
                  <Field label="40ft"><NumInput value={letterForm.opening_dispatched_40} onChange={(v) => setLetterForm({ ...letterForm, opening_dispatched_40: v })} /></Field>
                  <Field label="45ft"><NumInput value={letterForm.opening_dispatched_45} onChange={(v) => setLetterForm({ ...letterForm, opening_dispatched_45: v })} /></Field>
                  <Field label="Meter"><NumInput value={letterForm.opening_dispatched_meter} onChange={(v) => setLetterForm({ ...letterForm, opening_dispatched_meter: v })} /></Field>
                </div>
                <Field label="Notes"><textarea value={letterForm.notes || ""} onChange={(e) => setLetterForm({ ...letterForm, notes: e.target.value })} rows={2} style={{ ...inputStyle, width: "100%", resize: "vertical" as const }} /></Field>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={saveLetter} disabled={savingLetter} style={{ ...primaryButtonStyle, opacity: savingLetter ? 0.6 : 1 }}>{savingLetter ? "Saving…" : "Issue Letter"}</button>
                  <button onClick={() => { setShowLetterForm(false); setLetterForm(emptyLetter); }} style={{ padding: "8px 18px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 500, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: COLOURS.CARD, color: COLOURS.SLATE, cursor: "pointer" }}>Cancel</button>
                </div>
              </div>
            )}

            {/* PO list */}
            {loading ? (
              <div style={{ color: COLOURS.SLATE, fontSize: "14px", padding: "24px 0" }}>Loading…</div>
            ) : filteredPOs.length === 0 ? (
              <div style={{ textAlign: "center" as const, padding: "32px", color: COLOURS.SLATE, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD }}>
                {poSearch || poFilter !== "all" ? "No POs match your search or filter." : "No POs for this plant yet."}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {filteredPOs.map((po) => {
                  const isExpanded = expandedPOs.has(po.id);
                  const isClosed = po.status === "Closed";
                  const isChecked = selectedPOs.has(po.id);

                  return (
                    <div key={po.id} style={{
                      border: `1px solid ${COLOURS.HAIRLINE}`,
                      borderRadius: RADII.CARD,
                      backgroundColor: COLOURS.CARD,
                      opacity: isClosed ? 0.65 : 1,
                      overflow: "hidden",
                    }}>
                      {/* Card header — always visible */}
                      <div style={{
                        display: "flex", alignItems: "center", gap: "10px",
                        padding: "14px 16px",
                        borderLeft: `4px solid ${isClosed ? COLOURS.INK_400 : COLOURS.NAVY}`,
                        cursor: "pointer",
                        backgroundColor: isExpanded ? COLOURS.CARD_ALT : COLOURS.CARD,
                      }}>
                        {/* Checkbox */}
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            e.stopPropagation();
                            const next = new Set(selectedPOs);
                            if (e.target.checked) next.add(po.id); else next.delete(po.id);
                            setSelectedPOs(next);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          style={{ width: "15px", height: "15px", cursor: "pointer", flexShrink: 0, accentColor: COLOURS.NAVY }}
                        />

                        {/* Title */}
                        <div style={{ flex: 1, minWidth: 0 }} onClick={() => {
                          const next = new Set(expandedPOs);
                          if (next.has(po.id)) {
                            next.delete(po.id);
                            if (viewLettersPOId === po.id) { setViewLettersPOId(null); setViewDispatchLetterId(null); setEditLetterId(null); }
                          } else {
                            next.add(po.id);
                          }
                          setExpandedPOs(next);
                        }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
                            <span style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY, fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>{po.customer_name}</span>
                            <span style={{ fontSize: "12px", fontFamily: "var(--font-mono)", color: COLOURS.BLUE, fontWeight: 500 }}>PO #{po.po_number}</span>
                            {po.po_label && (
                              <span style={{ fontSize: "11px", padding: "1px 8px", borderRadius: RADII.PILL, backgroundColor: COLOURS.CARD_ALT, color: COLOURS.SLATE, border: `1px solid ${COLOURS.HAIRLINE}`, fontWeight: 500 }}>{po.po_label}</span>
                            )}
                            {isClosed && (
                              <span style={{ fontSize: "11px", padding: "1px 8px", borderRadius: RADII.PILL, backgroundColor: COLOURS.CARD_ALT, color: COLOURS.SLATE, fontWeight: 700 }}>CLOSED</span>
                            )}
                          </div>
                          <div style={{ fontSize: "11.5px", color: COLOURS.SLATE, marginTop: "3px", fontFamily: "var(--font-mono)" }}>
                            {po.start_date && `${formatDateUK(po.start_date)} · `}
                            {[
                              po.ordered_31 && `${po.ordered_31.toLocaleString()}×31ft`,
                              po.ordered_36 && `${po.ordered_36.toLocaleString()}×36ft`,
                              po.ordered_40 && `${po.ordered_40.toLocaleString()}×40ft`,
                              po.ordered_45 && `${po.ordered_45.toLocaleString()}×45ft`,
                              po.ordered_meter && `${po.ordered_meter.toLocaleString()}×Mtr`,
                            ].filter(Boolean).join(" · ")}
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", flexShrink: 0 }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedPOId(po.id); setShowLetterForm(true); setShowPOForm(false); }}
                            style={{ padding: "5px 10px", borderRadius: RADII.PILL, fontSize: "12px", fontWeight: 600, border: `1px solid ${COLOURS.NAVY}`, backgroundColor: COLOURS.CARD, color: COLOURS.NAVY, cursor: "pointer", whiteSpace: "nowrap" as const }}
                          >
                            + Letter
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const next = new Set(expandedPOs);
                              if (next.has(po.id)) {
                                next.delete(po.id);
                                if (viewLettersPOId === po.id) { setViewLettersPOId(null); setViewDispatchLetterId(null); setEditLetterId(null); }
                              } else {
                                next.add(po.id);
                                if (viewLettersPOId !== po.id) { setViewLettersPOId(po.id); loadLetters(po.id); setViewDispatchLetterId(null); setEditLetterId(null); }
                              }
                              setExpandedPOs(next);
                            }}
                            style={{ ...ghostBtn(isExpanded) }}
                          >
                            {isExpanded ? "▴ Hide" : "▾ Letters"}
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); startEditPO(po); }} style={{ ...ghostBtn() }}>Edit</button>
                          {!isClosed && (
                            <button onClick={(e) => { e.stopPropagation(); closePO(po); }} style={{ ...ghostBtn() }}>Close PO</button>
                          )}
                        </div>
                      </div>

                      {/* Edit PO panel */}
                      {editPOId === po.id && (
                        <div style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, padding: "16px", backgroundColor: COLOURS.CARD_ALT }}>
                          <div style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "12px", fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>Edit PO #{po.po_number}</div>
                          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "12px" }}>
                            <Field label="Customer name *"><input value={editPOForm.customer_name} onChange={(e) => setEditPOForm({ ...editPOForm, customer_name: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                            <Field label="PO number *"><input value={editPOForm.po_number} onChange={(e) => setEditPOForm({ ...editPOForm, po_number: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                            <Field label="PO label / description"><input value={editPOForm.po_label} onChange={(e) => setEditPOForm({ ...editPOForm, po_label: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                            <Field label="Start date"><DateInputWithCalendar value={editPOForm.start_date} onChange={(e) => setEditPOForm({ ...editPOForm, start_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                          </div>
                          <div style={{ ...kicker, margin: "10px 0 8px" }}>Ordered quantities (by size)</div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px,1fr))", gap: "8px" }}>
                            <Field label="31ft"><NumInput value={editPOForm.ordered_31} onChange={(v) => setEditPOForm({ ...editPOForm, ordered_31: v })} /></Field>
                            <Field label="36ft"><NumInput value={editPOForm.ordered_36} onChange={(v) => setEditPOForm({ ...editPOForm, ordered_36: v })} /></Field>
                            <Field label="45ft"><NumInput value={editPOForm.ordered_45} onChange={(v) => setEditPOForm({ ...editPOForm, ordered_45: v })} /></Field>
                            <Field label="Meter"><NumInput value={editPOForm.ordered_meter} onChange={(v) => setEditPOForm({ ...editPOForm, ordered_meter: v })} /></Field>
                          </div>
                          <div style={{ ...kicker, margin: "10px 0 8px" }}>Opening balance (already produced before go-live)</div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px,1fr))", gap: "8px" }}>
                            <Field label="31ft"><NumInput value={editPOForm.opening_produced_31} onChange={(v) => setEditPOForm({ ...editPOForm, opening_produced_31: v })} /></Field>
                            <Field label="36ft"><NumInput value={editPOForm.opening_produced_36} onChange={(v) => setEditPOForm({ ...editPOForm, opening_produced_36: v })} /></Field>
                            <Field label="45ft"><NumInput value={editPOForm.opening_produced_45} onChange={(v) => setEditPOForm({ ...editPOForm, opening_produced_45: v })} /></Field>
                            <Field label="Meter"><NumInput value={editPOForm.opening_produced_meter} onChange={(v) => setEditPOForm({ ...editPOForm, opening_produced_meter: v })} /></Field>
                          </div>
                          <Field label="Notes"><textarea value={editPOForm.notes || ""} onChange={(e) => setEditPOForm({ ...editPOForm, notes: e.target.value })} rows={2} style={{ ...inputStyle, width: "100%", resize: "vertical" as const }} /></Field>
                          <div style={{ display: "flex", gap: "8px" }}>
                            <button onClick={saveEditPO} disabled={savingEditPO} style={{ ...primaryButtonStyle, fontSize: "13px", padding: "6px 14px", opacity: savingEditPO ? 0.6 : 1 }}>{savingEditPO ? "Saving…" : "Save changes"}</button>
                            <button onClick={() => setEditPOId(null)} style={{ padding: "6px 14px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 500, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: COLOURS.CARD, color: COLOURS.SLATE, cursor: "pointer" }}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {/* Card body — expanded letters panel */}
                      {isExpanded && (
                        <div style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, padding: "16px" }}>
                          {/* Quantity grid */}
                          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(5,1fr)", gap: "1px", backgroundColor: COLOURS.HAIRLINE, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, overflow: "hidden", marginBottom: "16px" }}>
                            {[
                              { label: "31ft ordered", value: po.ordered_31 },
                              { label: "36ft ordered", value: po.ordered_36 },
                              { label: "45ft ordered", value: po.ordered_45 },
                              { label: "Total dispatched", value: "—" },
                              { label: "Remaining", value: "—" },
                            ].map((cell) => (
                              <div key={cell.label} style={{ padding: "10px 12px", backgroundColor: COLOURS.CARD_ALT }}>
                                <div style={{ ...kicker, marginBottom: "4px" }}>{cell.label}</div>
                                <div style={{ fontSize: "18px", fontWeight: 700, color: COLOURS.NAVY, fontFamily: "var(--font-mono)" }}>
                                  {typeof cell.value === "number" ? cell.value.toLocaleString() : cell.value}
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Letters nested list */}
                          <div style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.SLATE, marginBottom: "8px", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>Authority Letters</div>
                          {lettersLoading && viewLettersPOId === po.id ? (
                            <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>Loading…</div>
                          ) : viewLettersPOId !== po.id || letters.length === 0 ? (
                            <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>
                              {viewLettersPOId !== po.id ? (
                                <button onClick={() => { setViewLettersPOId(po.id); loadLetters(po.id); setViewDispatchLetterId(null); setEditLetterId(null); }} style={{ ...ghostBtn() }}>Load letters</button>
                              ) : "No letters issued for this PO yet."}
                            </div>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                              {letters.map((l) => {
                                const contractorName = (Array.isArray(l.contractors) ? (l.contractors as { name: string }[])[0]?.name : (l.contractors as { name: string } | null)?.name) || "—";
                                const totalAuth = l.qty_31 + l.qty_36 + l.qty_40 + l.qty_45 + l.qty_meter;
                                const totalRemaining = totalAuth;
                                const status = expiryStatus(l.expiry_date, totalRemaining);
                                const daysLeft = expiryDaysLeft(l.expiry_date);
                                const pct = totalAuth > 0 ? Math.round(((totalAuth - totalRemaining) / totalAuth) * 100) : 0;
                                const pColor = progressColor(pct, status === "Expired");

                                return (
                                  <div key={l.id} style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, backgroundColor: COLOURS.CARD, overflow: "hidden" }}>
                                    {editLetterId === l.id ? (
                                      <div style={{ padding: "14px 16px" }}>
                                        <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "10px" }}>Edit Letter #{l.letter_number}</div>
                                        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px" }}>
                                          <Field label="Contractor">
                                            <select value={editLetterForm.contractor_id} onChange={(e) => setEditLetterForm({ ...editLetterForm, contractor_id: e.target.value })} style={{ ...inputStyle, width: "100%" }}>
                                              <option value="">Select…</option>
                                              {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                            </select>
                                          </Field>
                                          <Field label="Letter number"><input value={editLetterForm.letter_number} onChange={(e) => setEditLetterForm({ ...editLetterForm, letter_number: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                                          <Field label="Issue date"><DateInputWithCalendar value={editLetterForm.issue_date} onChange={(e) => setEditLetterForm({ ...editLetterForm, issue_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                                          <Field label="Issued by"><input value={editLetterForm.issued_by} onChange={(e) => setEditLetterForm({ ...editLetterForm, issued_by: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                                          <Field label="Expiry date"><DateInputWithCalendar value={editLetterForm.expiry_date} onChange={(e) => setEditLetterForm({ ...editLetterForm, expiry_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                                        </div>
                                        <div style={{ ...kicker, margin: "8px 0 6px" }}>Authorised quantities</div>
                                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(100px,1fr))", gap: "8px" }}>
                                          <Field label="31ft"><NumInput value={editLetterForm.qty_31} onChange={(v) => setEditLetterForm({ ...editLetterForm, qty_31: v })} /></Field>
                                          <Field label="36ft"><NumInput value={editLetterForm.qty_36} onChange={(v) => setEditLetterForm({ ...editLetterForm, qty_36: v })} /></Field>
                                          <Field label="40ft"><NumInput value={editLetterForm.qty_40} onChange={(v) => setEditLetterForm({ ...editLetterForm, qty_40: v })} /></Field>
                                          <Field label="45ft"><NumInput value={editLetterForm.qty_45} onChange={(v) => setEditLetterForm({ ...editLetterForm, qty_45: v })} /></Field>
                                          <Field label="Meter"><NumInput value={editLetterForm.qty_meter} onChange={(v) => setEditLetterForm({ ...editLetterForm, qty_meter: v })} /></Field>
                                        </div>
                                        <Field label="Notes"><textarea value={editLetterForm.notes || ""} onChange={(e) => setEditLetterForm({ ...editLetterForm, notes: e.target.value })} rows={2} style={{ ...inputStyle, width: "100%", resize: "vertical" as const }} /></Field>
                                        <div style={{ display: "flex", gap: "8px" }}>
                                          <button onClick={saveEditLetter} disabled={savingEditLetter} style={{ ...primaryButtonStyle, fontSize: "13px", padding: "6px 14px", opacity: savingEditLetter ? 0.6 : 1 }}>{savingEditLetter ? "Saving…" : "Save changes"}</button>
                                          <button onClick={() => setEditLetterId(null)} style={{ padding: "6px 14px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 500, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: COLOURS.CARD, color: COLOURS.SLATE, cursor: "pointer" }}>Cancel</button>
                                        </div>
                                      </div>
                                    ) : (
                                      <>
                                        {/* Letter row header */}
                                        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", flexWrap: "wrap" }}>
                                          <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                              <span style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY }}>#{l.letter_number}</span>
                                              <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{contractorName}</span>
                                              <span style={{ fontSize: "11.5px", color: COLOURS.SLATE, fontFamily: "var(--font-mono)" }}>
                                                Issued {formatDateUK(l.issue_date)}
                                                {l.expiry_date && ` · Expires ${formatDateUK(l.expiry_date)}`}
                                              </span>
                                              {l.expiry_date && (
                                                <span style={expiryChipStyle(status)}>{expiryLabel(status, l.expiry_date)}</span>
                                              )}
                                              {status === "Complete" && <span style={expiryChipStyle(status)}>Complete</span>}
                                            </div>
                                            {/* Progress bar */}
                                            {totalAuth > 0 && (
                                              <div style={{ marginTop: "6px", display: "flex", alignItems: "center", gap: "8px" }}>
                                                <div style={{ width: "80px", height: "4px", backgroundColor: COLOURS.TRACK, borderRadius: RADII.PILL, overflow: "hidden", flexShrink: 0 }}>
                                                  <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, backgroundColor: pColor, borderRadius: RADII.PILL }} />
                                                </div>
                                                <span style={{ fontSize: "11px", color: COLOURS.SLATE, fontFamily: "var(--font-mono)" }}>{pct}%</span>
                                                {/* Remaining qty chips */}
                                                {[
                                                  l.qty_31 > 0 && <span key="31" style={{ fontSize: "10.5px", padding: "1px 6px", borderRadius: RADII.PILL, backgroundColor: COLOURS.CARD_ALT, color: COLOURS.SLATE, border: `1px solid ${COLOURS.HAIRLINE}`, fontFamily: "var(--font-mono)" }}>31ft</span>,
                                                  l.qty_36 > 0 && <span key="36" style={{ fontSize: "10.5px", padding: "1px 6px", borderRadius: RADII.PILL, backgroundColor: COLOURS.CARD_ALT, color: COLOURS.SLATE, border: `1px solid ${COLOURS.HAIRLINE}`, fontFamily: "var(--font-mono)" }}>36ft</span>,
                                                  l.qty_45 > 0 && <span key="45" style={{ fontSize: "10.5px", padding: "1px 6px", borderRadius: RADII.PILL, backgroundColor: COLOURS.CARD_ALT, color: COLOURS.SLATE, border: `1px solid ${COLOURS.HAIRLINE}`, fontFamily: "var(--font-mono)" }}>45ft</span>,
                                                  l.qty_meter > 0 && <span key="mtr" style={{ fontSize: "10.5px", padding: "1px 6px", borderRadius: RADII.PILL, backgroundColor: COLOURS.CARD_ALT, color: COLOURS.SLATE, border: `1px solid ${COLOURS.HAIRLINE}`, fontFamily: "var(--font-mono)" }}>Mtr</span>,
                                                ].filter(Boolean)}
                                              </div>
                                            )}
                                          </div>
                                          <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                                            <button onClick={() => { startEditLetter(l); setViewDispatchLetterId(null); }} style={{ ...ghostBtn() }}>Edit</button>
                                            <button
                                              onClick={() => deleteLetter(l)}
                                              disabled={deletingLetterId === l.id}
                                              style={{ ...ghostBtn(), color: COLOURS.RED, borderColor: COLOURS.RED, opacity: deletingLetterId === l.id ? 0.6 : 1 }}
                                            >
                                              {deletingLetterId === l.id ? "Deleting…" : "Delete"}
                                            </button>
                                            <button
                                              onClick={() => {
                                                const isOpen = viewDispatchLetterId === l.id;
                                                setViewDispatchLetterId(isOpen ? null : l.id);
                                                setEditDispatchId(null);
                                                setShowNewDispatchForm(false);
                                                setNewDispatchForm({ dispatch_date: "", qty_31: "", qty_36: "", qty_40: "", qty_45: "", qty_meter: "", released_by: "", vehicle_number: "", notes: "" });
                                                if (!isOpen) loadDispatches(l.id);
                                              }}
                                              style={{ ...ghostBtn(viewDispatchLetterId === l.id) }}
                                            >
                                              {viewDispatchLetterId === l.id ? "Hide Dispatches" : "Edit Dispatches"}
                                            </button>
                                          </div>
                                        </div>

                                        {/* Dispatch records panel */}
                                        {viewDispatchLetterId === l.id && (
                                          <div style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, padding: "12px 14px", backgroundColor: COLOURS.CARD_ALT }}>
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                                              <div style={{ ...kicker }}>Dispatch Records</div>
                                              <button
                                                onClick={() => { setShowNewDispatchForm((v) => !v); setEditDispatchId(null); }}
                                                style={{ padding: "3px 10px", borderRadius: RADII.PILL, fontSize: "12px", fontWeight: 600, border: `1px solid ${COLOURS.NAVY}`, backgroundColor: showNewDispatchForm ? COLOURS.CARD_ALT : COLOURS.CARD, color: COLOURS.NAVY, cursor: "pointer" }}
                                              >
                                                {showNewDispatchForm ? "Cancel" : "+ Record Dispatch"}
                                              </button>
                                            </div>

                                            {showNewDispatchForm && (
                                              <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, padding: "12px", backgroundColor: COLOURS.CARD, marginBottom: "10px" }}>
                                                <div style={{ ...kicker, marginBottom: "8px" }}>Record new dispatch</div>
                                                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "8px" }}>
                                                  <Field label="Date *"><DateInputWithCalendar value={newDispatchForm.dispatch_date} onChange={(e) => setNewDispatchForm({ ...newDispatchForm, dispatch_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                                                  <Field label="Released by *"><input value={newDispatchForm.released_by} onChange={(e) => setNewDispatchForm({ ...newDispatchForm, released_by: e.target.value })} placeholder="Name of person releasing poles" style={{ ...inputStyle, width: "100%" }} /></Field>
                                                  <Field label="Vehicle number"><input value={newDispatchForm.vehicle_number} onChange={(e) => setNewDispatchForm({ ...newDispatchForm, vehicle_number: e.target.value })} placeholder="Optional" style={{ ...inputStyle, width: "100%" }} /></Field>
                                                </div>
                                                <div style={{ ...kicker, margin: "6px 0 4px" }}>Quantities dispatched</div>
                                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(100px,1fr))", gap: "8px" }}>
                                                  {l.qty_31 > 0 && <Field label="31ft"><NumInput value={newDispatchForm.qty_31} onChange={(v) => setNewDispatchForm({ ...newDispatchForm, qty_31: v })} /></Field>}
                                                  {l.qty_36 > 0 && <Field label="36ft"><NumInput value={newDispatchForm.qty_36} onChange={(v) => setNewDispatchForm({ ...newDispatchForm, qty_36: v })} /></Field>}
                                                  {l.qty_40 > 0 && <Field label="40ft"><NumInput value={newDispatchForm.qty_40} onChange={(v) => setNewDispatchForm({ ...newDispatchForm, qty_40: v })} /></Field>}
                                                  {l.qty_45 > 0 && <Field label="45ft"><NumInput value={newDispatchForm.qty_45} onChange={(v) => setNewDispatchForm({ ...newDispatchForm, qty_45: v })} /></Field>}
                                                  {l.qty_meter > 0 && <Field label="Meter"><NumInput value={newDispatchForm.qty_meter} onChange={(v) => setNewDispatchForm({ ...newDispatchForm, qty_meter: v })} /></Field>}
                                                </div>
                                                <Field label="Notes"><input value={newDispatchForm.notes} onChange={(e) => setNewDispatchForm({ ...newDispatchForm, notes: e.target.value })} placeholder="Optional" style={{ ...inputStyle, width: "100%" }} /></Field>
                                                <button onClick={saveNewDispatch} disabled={savingNewDispatch} style={{ ...primaryButtonStyle, fontSize: "12px", padding: "6px 14px", opacity: savingNewDispatch ? 0.6 : 1 }}>
                                                  {savingNewDispatch ? "Saving…" : "Save Dispatch"}
                                                </button>
                                              </div>
                                            )}

                                            {dispatchesLoading ? (
                                              <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>Loading…</div>
                                            ) : dispatches.length === 0 ? (
                                              <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>No dispatch records yet.</div>
                                            ) : dispatches.map((d) => (
                                              <div key={d.id} style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.XS, padding: "8px 10px", marginBottom: "6px", backgroundColor: COLOURS.CARD }}>
                                                {editDispatchId === d.id ? (
                                                  <div>
                                                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "8px" }}>
                                                      <Field label="Date"><DateInputWithCalendar value={editDispatchForm.dispatch_date} onChange={(e) => setEditDispatchForm({ ...editDispatchForm, dispatch_date: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
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
                                                      <button onClick={() => setEditDispatchId(null)} style={{ padding: "5px 12px", borderRadius: RADII.PILL, fontSize: "12px", fontWeight: 500, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: COLOURS.CARD, color: COLOURS.SLATE, cursor: "pointer" }}>Cancel</button>
                                                    </div>
                                                  </div>
                                                ) : (
                                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "4px" }}>
                                                    <div>
                                                      <span style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.NAVY }}>{formatDateUK(d.dispatch_date)}</span>
                                                      <span style={{ fontSize: "12px", color: COLOURS.SLATE, marginLeft: "8px", fontFamily: "var(--font-mono)" }}>
                                                        {[d.qty_31 && `${d.qty_31}×31`, d.qty_36 && `${d.qty_36}×36`, d.qty_40 && `${d.qty_40}×40`, d.qty_45 && `${d.qty_45}×45`, d.qty_meter && `${d.qty_meter}×Mtr`].filter(Boolean).join(", ")} · {d.released_by}
                                                        {d.vehicle_number && ` · ${d.vehicle_number}`}
                                                      </span>
                                                    </div>
                                                    <button onClick={() => startEditDispatch(d)} style={{ ...ghostBtn() }}>Edit</button>
                                                  </div>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════
            TAB 2 — AUTHORITY LETTERS (flat list)
        ══════════════════════════════════════════════ */}
        {activeTab === "letters" && (
          <>
            {/* Toolbar */}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginBottom: "12px" }}>
              <div style={{ position: "relative", flex: isMobile ? "1 1 100%" : "1 1 260px", minWidth: 0 }}>
                <input
                  value={letterSearch}
                  onChange={(e) => setLetterSearch(e.target.value)}
                  placeholder="Search by letter number or contractor…"
                  style={{ ...inputStyle, paddingLeft: "32px", width: "100%", boxSizing: "border-box" }}
                />
                <span style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: COLOURS.SLATE, fontSize: "13px", pointerEvents: "none" }}>⌕</span>
              </div>
              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                {(["all", "active", "expiring", "expired", "complete"] as const).map((f) => (
                  <button key={f} onClick={() => setLetterFilter(f)} style={filterPillStyle(letterFilter === f)}>
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  const headers = ["Letter #", "PO Number", "Customer", "Contractor", "Expires", "Status"];
                  const rows = filteredLetters.map((l) => {
                    const totalRemaining = l.remaining_31 + l.remaining_36 + l.remaining_45 + l.remaining_meter;
                    const status = expiryStatus(l.expiry_date, totalRemaining);
                    return [l.letter_number, l.po_number, l.customer_name, l.contractor_name, l.expiry_date ? l.expiry_date.split("-").reverse().join("/") : "", expiryLabel(status, l.expiry_date)];
                  });
                  const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url; a.download = "authority-letters.csv"; a.click();
                  URL.revokeObjectURL(url);
                }}
                style={{ ...ghostBtn(), marginLeft: "auto" }}
              >
                Export CSV
              </button>
            </div>

            {allLettersLoading ? (
              <div style={{ color: COLOURS.SLATE, fontSize: "14px", padding: "32px", textAlign: "center" as const }}>Loading letters…</div>
            ) : filteredLetters.length === 0 ? (
              <div style={{ textAlign: "center" as const, padding: "32px", color: COLOURS.SLATE, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD }}>
                {letterSearch || letterFilter !== "all" ? "No letters match your search or filter." : "No authority letters found for this plant."}
              </div>
            ) : (
              <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD, overflow: "hidden" }}>
                {/* Table header */}
                {!isMobile && (
                  <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 1fr 120px 120px 100px 80px", gap: "0", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: COLOURS.CARD_ALT }}>
                    {["Letter #", "PO / Customer", "Contractor", "Expires", "Progress", "Status", ""].map((h) => (
                      <div key={h} style={{ padding: "10px 14px", fontSize: "10.5px", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: COLOURS.SLATE }}>{h}</div>
                    ))}
                  </div>
                )}
                {filteredLetters.map((l, idx) => {
                  const totalAuth = l.qty_31 + l.qty_36 + l.qty_45 + l.qty_meter;
                  const totalRemaining = l.remaining_31 + l.remaining_36 + l.remaining_45 + l.remaining_meter;
                  const totalDispatched = totalAuth - totalRemaining;
                  const pct = totalAuth > 0 ? Math.round((totalDispatched / totalAuth) * 100) : 0;
                  const status = expiryStatus(l.expiry_date, totalRemaining);
                  const pColor = progressColor(pct, status === "Expired");
                  const daysLeft = expiryDaysLeft(l.expiry_date);

                  if (isMobile) {
                    return (
                      <div key={l.id} style={{ padding: "12px 14px", borderBottom: idx < filteredLetters.length - 1 ? `1px solid ${COLOURS.HAIRLINE}` : "none" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", marginBottom: "6px" }}>
                          <div>
                            <span style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY }}>#{l.letter_number}</span>
                            <span style={{ fontSize: "11.5px", color: COLOURS.SLATE, marginLeft: "8px" }}>{l.contractor_name}</span>
                          </div>
                          <span style={expiryChipStyle(status)}>{expiryLabel(status, l.expiry_date)}</span>
                        </div>
                        <div style={{ fontSize: "11.5px", color: COLOURS.SLATE, marginBottom: "4px" }}>{l.customer_name} · PO #{l.po_number}</div>
                        {l.expiry_date && <div style={{ fontSize: "11px", color: COLOURS.SLATE, fontFamily: "var(--font-mono)", marginBottom: "6px" }}>Expires {l.expiry_date.split("-").reverse().join("/")}</div>}
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div style={{ flex: 1, height: "4px", backgroundColor: COLOURS.TRACK, borderRadius: RADII.PILL, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, backgroundColor: pColor, borderRadius: RADII.PILL }} />
                          </div>
                          <span style={{ fontSize: "11px", color: COLOURS.SLATE, fontFamily: "var(--font-mono)", whiteSpace: "nowrap" as const }}>{totalRemaining} rem.</span>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={l.id} style={{ display: "grid", gridTemplateColumns: "140px 1fr 1fr 120px 120px 100px 80px", borderBottom: idx < filteredLetters.length - 1 ? `1px solid ${COLOURS.HAIRLINE}` : "none", alignItems: "center" }}>
                      <div style={{ padding: "12px 14px", fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY, fontFamily: "var(--font-mono)" }}>#{l.letter_number}</div>
                      <div style={{ padding: "12px 14px" }}>
                        <div style={{ fontSize: "12.5px", fontWeight: 600, color: COLOURS.NAVY }}>{l.customer_name}</div>
                        <div style={{ fontSize: "11.5px", color: COLOURS.SLATE, fontFamily: "var(--font-mono)" }}>PO #{l.po_number}</div>
                      </div>
                      <div style={{ padding: "12px 14px", fontSize: "12.5px", color: COLOURS.INK_700 }}>{l.contractor_name}</div>
                      <div style={{ padding: "12px 14px" }}>
                        {l.expiry_date ? (
                          <>
                            <div style={{ fontSize: "12px", fontFamily: "var(--font-mono)", color: COLOURS.NAVY }}>{l.expiry_date.split("-").reverse().join("/")}</div>
                            {daysLeft !== null && daysLeft >= 0 && daysLeft <= 14 && (
                              <div style={{ fontSize: "11px", color: daysLeft <= 7 ? COLOURS.RED : COLOURS.AMBER }}>{daysLeft}d left</div>
                            )}
                            {daysLeft !== null && daysLeft < 0 && (
                              <div style={{ fontSize: "11px", color: COLOURS.RED }}>Expired</div>
                            )}
                          </>
                        ) : <span style={{ fontSize: "12px", color: COLOURS.INK_400 }}>—</span>}
                      </div>
                      <div style={{ padding: "12px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <div style={{ flex: 1, height: "4px", backgroundColor: COLOURS.TRACK, borderRadius: RADII.PILL, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, backgroundColor: pColor, borderRadius: RADII.PILL }} />
                          </div>
                          <span style={{ fontSize: "10.5px", color: COLOURS.SLATE, fontFamily: "var(--font-mono)", whiteSpace: "nowrap" as const }}>{pct}%</span>
                        </div>
                        <div style={{ fontSize: "10.5px", color: COLOURS.SLATE, marginTop: "2px", fontFamily: "var(--font-mono)" }}>{totalRemaining} rem.</div>
                      </div>
                      <div style={{ padding: "12px 14px" }}>
                        <span style={expiryChipStyle(status)}>{expiryLabel(status, l.expiry_date)}</span>
                      </div>
                      <div style={{ padding: "12px 14px" }}>
                        <button
                          onClick={() => {
                            setActiveTab("pos");
                            const po = pos.find((p) => p.id === l.po_id);
                            if (po) {
                              const next = new Set(expandedPOs);
                              next.add(po.id);
                              setExpandedPOs(next);
                              setViewLettersPOId(po.id);
                              loadLetters(po.id);
                            }
                          }}
                          style={{ ...ghostBtn(), fontSize: "11px", padding: "3px 8px" }}
                        >
                          View PO
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════
            TAB 3 — CONTRACTORS
        ══════════════════════════════════════════════ */}
        {activeTab === "contractors" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "8px" }}>
              <SectionTitle title="Contractors" style={{ margin: 0 }} />
              <button
                onClick={() => setShowContractorForm((v) => !v)}
                style={{ padding: "7px 16px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 600, border: `1px solid ${COLOURS.NAVY}`, backgroundColor: COLOURS.CARD, color: COLOURS.NAVY, cursor: "pointer" }}
              >
                {showContractorForm ? "Cancel" : "+ Add Contractor"}
              </button>
            </div>

            {/* Search */}
            <div style={{ position: "relative", marginBottom: "12px", maxWidth: isMobile ? "100%" : "320px" }}>
              <input
                value={contractorSearch}
                onChange={(e) => setContractorSearch(e.target.value)}
                placeholder="Search by name, phone, CNIC, address…"
                style={{ ...inputStyle, paddingLeft: "32px", width: "100%", boxSizing: "border-box" }}
              />
              <span style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: COLOURS.SLATE, fontSize: "13px", pointerEvents: "none" }}>⌕</span>
            </div>

            {/* Add contractor form */}
            {showContractorForm && (
              <div style={{ ...cardStyle, marginBottom: "16px" }}>
                <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "16px", fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>Add contractor</div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "12px" }}>
                  <Field label="Name *"><input value={contractorForm.name} onChange={(e) => setContractorForm({ ...contractorForm, name: e.target.value })} placeholder="Contractor / firm name" style={{ ...inputStyle, width: "100%" }} /></Field>
                  <Field label="CNIC / ID (optional)"><input value={contractorForm.cnic_or_id} onChange={(e) => setContractorForm({ ...contractorForm, cnic_or_id: e.target.value })} placeholder="e.g. 42101-1234567-1" style={{ ...inputStyle, width: "100%" }} /></Field>
                  <Field label="Phone (optional)"><input value={contractorForm.contact_phone} onChange={(e) => setContractorForm({ ...contractorForm, contact_phone: e.target.value })} placeholder="+92 300 1234567" style={{ ...inputStyle, width: "100%" }} /></Field>
                  <Field label="Address (optional)"><input value={contractorForm.contact_address} onChange={(e) => setContractorForm({ ...contractorForm, contact_address: e.target.value })} placeholder="City, area" style={{ ...inputStyle, width: "100%" }} /></Field>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" }}>
                  <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>Only <strong style={{ color: COLOURS.NAVY }}>Name</strong> is required. You can add contact details later.</span>
                  <button onClick={saveContractor} disabled={savingContractor} style={{ ...primaryButtonStyle, opacity: savingContractor ? 0.6 : 1 }}>{savingContractor ? "Saving…" : "Add contractor"}</button>
                </div>
              </div>
            )}

            {/* Contractor list */}
            {contractors.length === 0 ? (
              <div style={{ textAlign: "center" as const, padding: "32px", color: COLOURS.SLATE, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD }}>
                No contractors yet. Add one above.
              </div>
            ) : filteredContractors.length === 0 ? (
              <div style={{ textAlign: "center" as const, padding: "32px", color: COLOURS.SLATE, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD }}>
                No contractors match your search.
              </div>
            ) : (
              <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD, overflow: "hidden" }}>
                {filteredContractors.map((c, idx) => (
                  <div key={c.id} style={{ borderBottom: idx < filteredContractors.length - 1 ? `1px solid ${COLOURS.HAIRLINE}` : "none" }}>
                    {editContractorId === c.id ? (
                      <div style={{ padding: "16px" }}>
                        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px" }}>
                          <Field label="Name *"><input value={editContractorForm.name} onChange={(e) => setEditContractorForm({ ...editContractorForm, name: e.target.value })} style={{ ...inputStyle, width: "100%" }} /></Field>
                          <Field label="CNIC / ID"><input value={editContractorForm.cnic_or_id} onChange={(e) => setEditContractorForm({ ...editContractorForm, cnic_or_id: e.target.value })} placeholder="Optional" style={{ ...inputStyle, width: "100%" }} /></Field>
                          <Field label="Phone"><input value={editContractorForm.contact_phone} onChange={(e) => setEditContractorForm({ ...editContractorForm, contact_phone: e.target.value })} placeholder="Optional" style={{ ...inputStyle, width: "100%" }} /></Field>
                          <Field label="Address"><input value={editContractorForm.contact_address} onChange={(e) => setEditContractorForm({ ...editContractorForm, contact_address: e.target.value })} placeholder="Optional" style={{ ...inputStyle, width: "100%" }} /></Field>
                        </div>
                        <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                          <button onClick={saveEditContractor} disabled={savingEditContractor} style={{ ...primaryButtonStyle, fontSize: "13px", padding: "6px 14px", opacity: savingEditContractor ? 0.6 : 1 }}>{savingEditContractor ? "Saving…" : "Save changes"}</button>
                          <button onClick={() => setEditContractorId(null)} style={{ padding: "6px 14px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 500, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: COLOURS.CARD, color: COLOURS.SLATE, cursor: "pointer" }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: "14px" }}>
                        {/* Avatar */}
                        <div style={{
                          width: "36px", height: "36px", borderRadius: "50%", flexShrink: 0,
                          background: avatarGradient(c.name),
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "white", fontSize: "12px", fontWeight: 600, fontFamily: "var(--font-display, 'Inter Tight', sans-serif)",
                        }}>
                          {c.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "13.5px", fontWeight: 600, color: COLOURS.NAVY }}>{c.name}</div>
                          <div style={{ fontSize: "11.5px", color: COLOURS.SLATE, marginTop: "2px" }}>
                            {[c.contact_phone, c.cnic_or_id, c.contact_address].filter(Boolean).join(" · ") || "No contact details"}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button onClick={() => startEditContractor(c)} style={{ ...ghostBtn() }}>Edit</button>
                          <button
                            onClick={() => deleteContractor(c)}
                            disabled={deletingContractorId === c.id}
                            style={{ ...ghostBtn(), color: COLOURS.RED, borderColor: COLOURS.RED, opacity: deletingContractorId === c.id ? 0.6 : 1 }}
                          >
                            {deletingContractorId === c.id ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════
            TAB 4 — PERFORMANCE
        ══════════════════════════════════════════════ */}
        {activeTab === "performance" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <SectionTitle title="Contractor Performance" style={{ margin: 0 }} />
              <button onClick={loadPerformance} disabled={perfLoading} style={{ ...ghostBtn(), opacity: perfLoading ? 0.6 : 1 }}>
                {perfLoading ? "Loading…" : "Refresh"}
              </button>
            </div>
            <p style={{ fontSize: "13px", color: COLOURS.SLATE, margin: "0 0 16px" }}>Per-contractor totals across all POs for this plant.</p>

            {perfLoading ? (
              <div style={{ color: COLOURS.SLATE, fontSize: "14px" }}>Loading performance data…</div>
            ) : performance.length === 0 ? (
              <div style={{ textAlign: "center" as const, padding: "32px", color: COLOURS.SLATE, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD, fontSize: "14px" }}>
                No contractor data yet for this plant.
              </div>
            ) : (
              <div style={{ display: "grid", gap: "10px" }}>
                {performance.map((c) => {
                  const pctColor = c.collection_pct >= 90 ? COLOURS.GREEN : c.collection_pct >= 60 ? COLOURS.AMBER : COLOURS.RED;
                  return (
                    <div key={c.contractor_id} style={{ ...cardStyle, padding: "20px 22px" }}>
                      {/* Head */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "4px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <div style={{
                            width: "40px", height: "40px", borderRadius: "50%", flexShrink: 0,
                            background: avatarGradient(c.contractor_name),
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: "white", fontSize: "13px", fontWeight: 600,
                          }}>
                            {c.contractor_name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" }}>{c.contractor_name}</div>
                            {c.contractor_phone && <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>{c.contractor_phone}</div>}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" as const }}>
                          <div style={{ fontSize: "24px", fontWeight: 700, color: pctColor, fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", letterSpacing: "-0.02em" }}>{c.collection_pct}<span style={{ fontSize: "0.5em", color: COLOURS.SLATE, fontWeight: 500, marginLeft: "2px" }}>%</span></div>
                          <div style={{ ...kicker, textAlign: "right" as const, marginTop: "2px" }}>Collected</div>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div style={{ height: "6px", borderRadius: RADII.PILL, backgroundColor: COLOURS.TRACK, margin: "14px 0", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${Math.min(100, c.collection_pct)}%`, backgroundColor: pctColor, borderRadius: RADII.PILL, transition: "width 0.3s" }} />
                      </div>

                      {/* Stats grid */}
                      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: "16px", marginBottom: "14px" }}>
                        {[
                          { label: "Letters issued", value: c.letters_issued, color: COLOURS.NAVY },
                          { label: "Total authorised", value: c.total_authorised.toLocaleString(), color: COLOURS.SLATE },
                          { label: "Total collected", value: c.total_collected.toLocaleString(), color: COLOURS.GREEN },
                          { label: "Still outstanding", value: Math.max(0, c.total_authorised - c.total_collected).toLocaleString(), color: c.total_authorised > c.total_collected ? COLOURS.RED : COLOURS.GREEN },
                        ].map((s) => (
                          <div key={s.label}>
                            <div style={{ ...kicker, marginBottom: "4px" }}>{s.label}</div>
                            <div style={{ fontSize: "22px", fontWeight: 700, color: s.color, fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", letterSpacing: "-0.015em" }}>{s.value}</div>
                          </div>
                        ))}
                      </div>

                      {/* Letter breakdown */}
                      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", paddingTop: "12px", borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>
                        {[
                          { label: "Fully collected", value: c.letters_fully_collected, bg: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN },
                          { label: "Partial", value: c.letters_partial, bg: COLOURS.WARNING_SOFT, color: COLOURS.AMBER },
                          { label: "Not started", value: c.letters_not_started, bg: COLOURS.CARD_ALT, color: COLOURS.SLATE },
                        ].map((s) => (
                          <span key={s.label} style={{ fontSize: "12px", padding: "3px 10px", borderRadius: RADII.PILL, backgroundColor: s.bg, color: s.color, fontWeight: 600 }}>
                            {s.value} {s.label}
                          </span>
                        ))}
                        {c.avg_days_to_full_collection !== null && (
                          <div style={{ marginLeft: "auto", display: "flex", gap: "16px", flexWrap: "wrap" }}>
                            <span style={{ fontSize: "12px", color: COLOURS.BLUE }}>Avg: <strong style={{ fontFamily: "var(--font-mono)" }}>{c.avg_days_to_full_collection}d</strong></span>
                            {c.fastest_days !== null && <span style={{ fontSize: "12px", color: COLOURS.GREEN }}>Fastest: <strong style={{ fontFamily: "var(--font-mono)" }}>{c.fastest_days}d</strong></span>}
                            {c.slowest_days !== null && <span style={{ fontSize: "12px", color: COLOURS.RED }}>Slowest: <strong style={{ fontFamily: "var(--font-mono)" }}>{c.slowest_days}d</strong></span>}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {toastEl}
        {confirmEl}
      </main>
    </AuthWrapper>
  );
}
