"use client";

import { useEffect, useState, useCallback } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { useRequireCapability } from "../lib/useRouteGuard";
import { supabase } from "../lib/supabase";
import { formatDateTimeUK, formatDateUK } from "../lib/dateUtils";
import { useMobile } from "../lib/useMobile";
import DateInput from "../lib/DateInput";
import {
  COLOURS, RADII, PageHeader, SectionTitle, CountCard, SkeletonRows,
  useConfirm, useToast, primaryButtonStyle, inputStyle,
} from "../lib/SharedUI";
import { COMPANIES } from "../lib/constants";

// ── Types ─────────────────────────────────────────────────────────────

type Backup = { name: string; sizeKB: number | null; createdAt: string };
type ArchivedDoc = {
  id: string; doc_type: string; company_id: string;
  position_date: string | null; original_filename: string;
  storage_path: string; source: string;
  uploaded_by: string | null; created_at: string;
};

type Registration = {
  location_id: string; name: string; entity: string; location_type: string;
  eobi_status: string | null; eobi_notes: string | null; eobi_updated_at: string | null;
  ss_status: string | null;   ss_notes: string | null;  ss_updated_at: string | null;
};

type MonthEntry = {
  month: number; amount_pkr: number | null;
  date_paid: string | null; challan_number: string | null;
  is_late: boolean | null; status: "on_time" | "late" | "missing" | "future";
};
type PaymentRow = { entity: string; payment_type: string; months: MonthEntry[] };

type ComplianceRow = {
  location_id: string; name: string; entity: string;
  civil_defence_status: string | null; civil_defence_registered: string | null; civil_defence_due: string | null;
  labour_reg_status: string | null;    labour_reg_registered: string | null;    labour_reg_due: string | null;
  labour_insp_status: string | null;   labour_insp_registered: string | null;   labour_insp_due: string | null;
};

type NtnDoc = {
  doc_id: string; location_id: string; location_name: string; entity: string;
  meter_label: string | null; ntn_number: string | null;
  status: string; folderit_link: string | null; updated_at: string;
};

type RestaurantLicence = {
  location_id: string; location_name: string; entity: string;
  pfa_status: string | null; pfa_link: string | null; pfa_expiry: string | null;
  medical_status: string | null; medical_link: string | null; medical_expiry: string | null;
  training_status: string | null; training_link: string | null; training_expiry: string | null;
  tourism_status: string | null; tourism_link: string | null; tourism_expiry: string | null;
};

type FuelRow = {
  month: number; vehicle_id: string; vehicle_name: string; plate_number: string;
  fills: number; total_litres: number; total_amount: number; avg_km_per_l: number | null;
};

type SolarBranch = {
  branch_id: string; branch_name: string; system_kw: number | null;
  months: { month: number; total_kwh: number | null; days_entered: number }[] | null;
};

type TabId = "registrations" | "compliance" | "documents" | "operations" | "backups";

// ── Helpers ───────────────────────────────────────────────────────────

async function authedFetch(url: string, opts: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${session?.access_token}` },
  });
}

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_FULL  = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const ENTITY_DISPLAY: Record<string, string> = {
  IFPL: "IFPL — Imperial Footwear",
  Baranh: "Baranh",
  HD: "Haute Dolci",
  UTPL: "UTPL — Unze Trading",
};
const STATUS_COLOURS: Record<string, { bg: string; color: string }> = {
  Registered: { bg: "#D1FAE5", color: COLOURS.GREEN },
  Done:       { bg: "#D1FAE5", color: COLOURS.GREEN },
  Pending:    { bg: "#FEF3C7", color: COLOURS.AMBER },
  Inprocess:  { bg: "#FEF3C7", color: COLOURS.AMBER },
  Overdue:    { bg: "#FEE2E2", color: COLOURS.RED },
  "N/A":      { bg: COLOURS.HAIRLINE, color: COLOURS.SLATE },
};

function StatusPill({ status }: { status: string | null }) {
  const s = status || "Pending";
  const c = STATUS_COLOURS[s] || { bg: COLOURS.HAIRLINE, color: COLOURS.SLATE };
  return (
    <span style={{
      fontSize: "11px", fontWeight: 700, padding: "2px 8px",
      borderRadius: RADII.PILL, backgroundColor: c.bg, color: c.color,
      whiteSpace: "nowrap",
    }}>{s}</span>
  );
}

function MonthCell({ entry }: { entry: MonthEntry }) {
  const colours: Record<string, { bg: string; color: string }> = {
    on_time: { bg: "#D1FAE5", color: COLOURS.GREEN },
    late:    { bg: "#FEF3C7", color: COLOURS.AMBER },
    missing: { bg: "#FEE2E2", color: COLOURS.RED },
    future:  { bg: COLOURS.HAIRLINE, color: COLOURS.SLATE },
  };
  const c = colours[entry.status] || colours.future;
  const label = entry.status === "future" ? "—" : entry.status === "missing" ? "✗" : "✓";
  return (
    <td title={
      entry.date_paid
        ? `Paid ${entry.date_paid.split("-").reverse().join("/")}${entry.challan_number ? ` · Challan ${entry.challan_number}` : ""}${entry.amount_pkr ? ` · PKR ${Number(entry.amount_pkr).toLocaleString()}` : ""}`
        : entry.status === "missing" ? "Not paid" : ""
    } style={{
      textAlign: "center", padding: "6px 4px",
      backgroundColor: c.bg, color: c.color,
      fontSize: "13px", fontWeight: 700,
      border: `1px solid ${COLOURS.HAIRLINE}`,
      cursor: entry.date_paid ? "help" : "default",
    }}>{label}</td>
  );
}

const CURRENT_YEAR = new Date().getFullYear();

// ── Main component ────────────────────────────────────────────────────

export default function AdminDataPage() {
  const { checking } = useRequireCapability("admin_ops");
  const isMobile = useMobile();
  const { confirm, element: confirmElement } = useConfirm();
  const { show: showToast, element: toastElement } = useToast();

  const [activeTab, setActiveTab] = useState<TabId>("registrations");
  const [userIsAdmin, setUserIsAdmin] = useState(false);

  // ── Backups state ──────────────────────────────────────────────────
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [docs, setDocs] = useState<ArchivedDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [docTypeFilter, setDocTypeFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [runningBackup, setRunningBackup] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // ── Registrations state ────────────────────────────────────────────
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loadingRegs, setLoadingRegs] = useState(false);
  const [editingReg, setEditingReg] = useState<{
    location_id: string; name: string; type: "EOBI" | "Social Security";
    current: string; notes: string;
  } | null>(null);
  const [regSaving, setRegSaving] = useState(false);

  // ── Compliance state ───────────────────────────────────────────────
  const [compliance, setCompliance] = useState<ComplianceRow[]>([]);
  const [loadingCompliance, setLoadingCompliance] = useState(false);
  const [editingCompliance, setEditingCompliance] = useState<{
    location_id: string; name: string; compliance_type: string;
    status: string; last_renewed: string; next_due: string; notes: string;
  } | null>(null);
  const [savingCompliance, setSavingCompliance] = useState(false);
  const [paymentRows, setPaymentRows] = useState<PaymentRow[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [paymentYear, setPaymentYear] = useState(CURRENT_YEAR);
  const [addingPayment, setAddingPayment] = useState<{
    entity: string; payment_type: string; month: number;
  } | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    amount_pkr: "", date_paid: "", challan_number: "", notes: "",
  });
  const [savingPayment, setSavingPayment] = useState(false);

  // ── Documents state ────────────────────────────────────────────────
  const [ntnDocs, setNtnDocs] = useState<NtnDoc[]>([]);
  const [loadingNtn, setLoadingNtn] = useState(false);
  const [restaurantLicences, setRestaurantLicences] = useState<RestaurantLicence[]>([]);
  const [loadingLicences, setLoadingLicences] = useState(false);
  const [docSearch, setDocSearch] = useState("");
  const [docTypeFilterUI, setDocTypeFilterUI] = useState("");
  const [docStatusFilterUI, setDocStatusFilterUI] = useState("");

  // ── Registrations filter state ─────────────────────────────────────
  const [regSearch, setRegSearch] = useState("");
  const [regEntityFilter, setRegEntityFilter] = useState("");
  const [regStatusFilter, setRegStatusFilter] = useState("");
  const [regTypeFilter, setRegTypeFilter] = useState<"" | "EOBI" | "Social Security">("");
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [canManageLocations, setCanManageLocations] = useState(false);

  // ── Add location modal state ───────────────────────────────────────
  const [addingLocation, setAddingLocation] = useState(false);
  const [newLocation, setNewLocation] = useState({ name: "", entity: "IFPL", location_type: "retail", province: "" });
  const [savingLocation, setSavingLocation] = useState(false);

  // ── Operations state ───────────────────────────────────────────────
  const [fuelRows, setFuelRows] = useState<FuelRow[]>([]);
  const [loadingFuel, setLoadingFuel] = useState(false);
  const [solarBranches, setSolarBranches] = useState<SolarBranch[]>([]);
  const [loadingSolar, setLoadingSolar] = useState(false);
  const [opsYear, setOpsYear] = useState(CURRENT_YEAR);
  const [opsMonth, setOpsMonth] = useState(new Date().getMonth() + 1);

  // ── Initial setup ──────────────────────────────────────────────────
  useEffect(() => {
    if (checking) return;
    // Detect if user is main admin (needed for backups tab)
    // Also check can_manage_locations for Akhlaq / Sunaina
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      if (user.email?.toLowerCase() === "khuram1901@gmail.com") setUserIsAdmin(true);
      const { data: member } = await supabase
        .from("members").select("id").eq("email", user.email!).single();
      if (member) {
        const { data: perm } = await supabase
          .from("member_permissions").select("can_manage_locations").eq("member_id", member.id).single();
        if (perm?.can_manage_locations) setCanManageLocations(true);
      }
    });
    loadRegistrations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checking]);

  // Lazy-load tab data on first visit
  useEffect(() => {
    if (checking) return;
    if (activeTab === "compliance" && paymentRows.length === 0 && !loadingPayments) {
      loadPayments();
      loadCompliance();
    }
    if (activeTab === "documents" && ntnDocs.length === 0 && !loadingNtn) {
      loadNtnDocs();
      loadLicences();
    }
    if (activeTab === "operations" && fuelRows.length === 0 && !loadingFuel) {
      loadFuel();
      loadSolar();
    }
    if (activeTab === "backups" && backups.length === 0 && !loadingBackups) {
      loadBackups();
      loadDocs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, checking]);

  useEffect(() => {
    if (activeTab === "compliance" && !checking) loadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentYear]);

  useEffect(() => {
    if (activeTab === "operations" && !checking) { loadFuel(); loadSolar(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opsYear]);

  useEffect(() => {
    if (activeTab === "backups" && !checking) loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docTypeFilter, companyFilter]);

  // ── Data loaders ───────────────────────────────────────────────────
  async function loadRegistrations() {
    setLoadingRegs(true);
    const res = await authedFetch("/api/admin/registrations");
    const json = await res.json();
    setRegistrations(json.data || []);
    setLoadingRegs(false);
  }

  async function loadPayments() {
    setLoadingPayments(true);
    const res = await authedFetch(`/api/admin/payments?year=${paymentYear}`);
    const json = await res.json();
    setPaymentRows(json.data || []);
    setLoadingPayments(false);
  }

  async function loadCompliance() {
    setLoadingCompliance(true);
    const res = await authedFetch("/api/admin/compliance");
    const json = await res.json();
    setCompliance(json.data || []);
    setLoadingCompliance(false);
  }

  async function loadNtnDocs() {
    setLoadingNtn(true);
    const res = await authedFetch("/api/admin/documents?type=ntn");
    const json = await res.json();
    setNtnDocs(json.data || []);
    setLoadingNtn(false);
  }

  async function loadLicences() {
    setLoadingLicences(true);
    const res = await authedFetch("/api/admin/documents?type=licences");
    const json = await res.json();
    setRestaurantLicences(json.data || []);
    setLoadingLicences(false);
  }

  async function loadFuel() {
    setLoadingFuel(true);
    const res = await authedFetch(`/api/admin/operations?type=fuel&year=${opsYear}`);
    const json = await res.json();
    setFuelRows(json.data || []);
    setLoadingFuel(false);
  }

  async function loadSolar() {
    setLoadingSolar(true);
    const res = await authedFetch(`/api/admin/operations?type=solar&year=${opsYear}`);
    const json = await res.json();
    setSolarBranches(json.data || []);
    setLoadingSolar(false);
  }

  async function loadBackups() {
    setLoadingBackups(true);
    const res = await authedFetch("/api/admin/list-backups");
    const json = await res.json();
    setBackups(json.backups || []);
    setLoadingBackups(false);
  }

  const loadDocs = useCallback(async () => {
    setLoadingDocs(true);
    const params = new URLSearchParams();
    if (docTypeFilter) params.set("docType", docTypeFilter);
    if (companyFilter) params.set("companyId", companyFilter);
    const res = await authedFetch(`/api/admin/list-documents?${params.toString()}`);
    const json = await res.json();
    setDocs(json.documents || []);
    setLoadingDocs(false);
  }, [docTypeFilter, companyFilter]);

  // ── Actions ────────────────────────────────────────────────────────
  async function saveRegistration() {
    if (!editingReg) return;
    setRegSaving(true);
    const res = await authedFetch("/api/admin/registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location_id: editingReg.location_id,
        registration_type: editingReg.type,
        status: editingReg.current,
        notes: editingReg.notes,
      }),
    });
    const json = await res.json();
    setRegSaving(false);
    if (json.ok) {
      showToast("Status updated", "success");
      setEditingReg(null);
      loadRegistrations();
    } else {
      showToast(json.error || "Failed to save", "error");
    }
  }

  async function saveRegInline(location_id: string, _name: string, type: "EOBI" | "Social Security", status: string) {
    const res = await authedFetch("/api/admin/registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location_id, registration_type: type, status, notes: "" }),
    });
    const json = await res.json();
    if (json.ok) {
      showToast("Status updated", "success");
      loadRegistrations();
    } else {
      showToast(json.error || "Failed to save", "error");
    }
  }

  function prevOpsMonth() {
    if (opsMonth === 1) { setOpsMonth(12); setOpsYear((y) => y - 1); }
    else setOpsMonth((m) => m - 1);
  }
  function nextOpsMonth() {
    const now = new Date();
    if (opsYear === now.getFullYear() && opsMonth === now.getMonth() + 1) return;
    if (opsMonth === 12) { setOpsMonth(1); setOpsYear((y) => y + 1); }
    else setOpsMonth((m) => m + 1);
  }

  async function saveCompliance() {
    if (!editingCompliance) return;
    setSavingCompliance(true);
    const res = await authedFetch("/api/admin/compliance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location_id:     editingCompliance.location_id,
        compliance_type: editingCompliance.compliance_type,
        status:          editingCompliance.status,
        last_renewed:    editingCompliance.last_renewed || null,
        next_due:        editingCompliance.next_due || null,
        notes:           editingCompliance.notes || null,
      }),
    });
    const json = await res.json();
    setSavingCompliance(false);
    if (json.ok) {
      showToast("Compliance record updated", "success");
      setEditingCompliance(null);
      loadCompliance();
    } else {
      showToast(json.error || "Failed to save", "error");
    }
  }

  async function addLocation() {
    if (!newLocation.name.trim()) return;
    setSavingLocation(true);
    const res = await authedFetch("/api/admin/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newLocation),
    });
    const json = await res.json();
    setSavingLocation(false);
    if (json.ok) {
      showToast(`${newLocation.name} added`, "success");
      setAddingLocation(false);
      setNewLocation({ name: "", entity: "IFPL", location_type: "retail", province: "" });
      loadRegistrations();
    } else {
      showToast(json.error || "Failed to add location", "error");
    }
  }

  async function removeLocation(location_id: string, name: string) {
    const ok = await confirm(`Remove "${name}" from the active locations list? Its existing data is preserved.`);
    if (!ok) return;
    const res = await authedFetch(`/api/admin/locations?id=${location_id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.ok) { showToast(`${name} removed`, "success"); loadRegistrations(); }
    else showToast(json.error || "Failed to remove", "error");
  }

  async function savePayment() {
    if (!addingPayment) return;
    setSavingPayment(true);
    const res = await authedFetch("/api/admin/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entity: addingPayment.entity,
        payment_type: addingPayment.payment_type,
        month: `${paymentYear}-${String(addingPayment.month).padStart(2, "0")}-01`,
        amount_pkr: paymentForm.amount_pkr ? parseFloat(paymentForm.amount_pkr) : null,
        date_paid: paymentForm.date_paid,
        challan_number: paymentForm.challan_number || null,
        notes: paymentForm.notes || null,
      }),
    });
    const json = await res.json();
    setSavingPayment(false);
    if (json.ok) {
      showToast("Payment recorded", "success");
      setAddingPayment(null);
      setPaymentForm({ amount_pkr: "", date_paid: "", challan_number: "", notes: "" });
      loadPayments();
    } else {
      showToast(json.error || "Failed to save", "error");
    }
  }

  async function handleDownloadBackup(name: string) {
    const res = await authedFetch("/api/admin/list-backups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: name }),
    });
    const json = await res.json();
    if (json.url) window.open(json.url, "_blank");
  }

  async function handleDownloadDoc(doc: ArchivedDoc) {
    const res = await authedFetch("/api/admin/list-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storagePath: doc.storage_path }),
    });
    const json = await res.json();
    if (json.url) window.open(json.url, "_blank");
  }

  async function handleRunBackup() {
    const ok = await confirm("Run a backup now? This emails a snapshot and saves a copy to Storage.");
    if (!ok) return;
    setRunningBackup(true);
    setStatusMsg(null);
    try {
      const res = await authedFetch("/api/backup");
      const json = await res.json();
      if (json.ok) {
        setStatusMsg({ text: `Backup complete — ${json.tables} tables, ${json.totalRows} rows.`, ok: true });
        loadBackups();
      } else {
        setStatusMsg({ text: `Backup failed: ${json.error || "unknown error"}`, ok: false });
      }
    } catch {
      setStatusMsg({ text: "Backup request failed.", ok: false });
    }
    setRunningBackup(false);
  }

  async function handleRestore() {
    if (!restoreTarget || restoreConfirmText !== "RESTORE") return;
    setRestoring(true);
    setStatusMsg(null);
    try {
      const res = await authedFetch("/api/admin/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "RESTORE_FROM_BACKUP", filename: restoreTarget }),
      });
      const json = await res.json();
      if (json.ok) {
        setStatusMsg({ text: `Restore complete — ${json.restoredTables} tables, ${json.totalRows} rows restored.`, ok: true });
      } else {
        const errored = (json.results || []).filter((r: { status: string }) => r.status.startsWith("error"));
        setStatusMsg({ text: `Restore finished with errors: ${errored.map((e: { table: string; status: string }) => `${e.table} (${e.status})`).join(", ")}`, ok: false });
      }
    } catch {
      setStatusMsg({ text: "Restore request failed.", ok: false });
    }
    setRestoring(false);
    setRestoreTarget(null);
    setRestoreConfirmText("");
  }

  function companyName(id: string) {
    return COMPANIES.find((c) => c.id === id)?.shortCode || id.slice(0, 8);
  }

  // ── Helpers: group data ────────────────────────────────────────────
  function groupedByEntity<T extends { entity: string }>(rows: T[]): Record<string, T[]> {
    const order = ["IFPL", "Baranh", "HD", "UTPL"];
    const grouped: Record<string, T[]> = {};
    order.forEach((e) => { grouped[e] = []; });
    rows.forEach((r) => {
      if (!grouped[r.entity]) grouped[r.entity] = [];
      grouped[r.entity].push(r);
    });
    return grouped;
  }

  // ── Render guard ───────────────────────────────────────────────────
  if (checking) return (
    <AuthWrapper>
      <main style={{ padding: "14px 18px" }}>
        <p style={{ color: COLOURS.SLATE }}>Checking permissions...</p>
      </main>
    </AuthWrapper>
  );

  const TABS: { id: TabId; label: string }[] = [
    { id: "registrations", label: "Registrations" },
    { id: "compliance", label: "Compliance & Payments" },
    { id: "documents", label: "Documents" },
    { id: "operations", label: "Operations" },
    ...(userIsAdmin ? [{ id: "backups" as TabId, label: "Data & Backups" }] : []),
  ];

  const tabStyle = (id: TabId): React.CSSProperties => ({
    padding: "8px 16px",
    borderRadius: RADII.PILL,
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    border: "none",
    backgroundColor: activeTab === id ? COLOURS.NAVY : "transparent",
    color: activeTab === id ? "white" : COLOURS.SLATE,
    whiteSpace: "nowrap",
  });

  // ── Tab: Registrations ─────────────────────────────────────────────
  const STATUSES = ["Registered", "Pending", "Inprocess", "N/A"];

  function renderRegistrations() {
    if (loadingRegs) return <SkeletonRows count={6} height="44px" />;

    const showEOBI = regTypeFilter === "" || regTypeFilter === "EOBI";
    const showSS   = regTypeFilter === "" || regTypeFilter === "Social Security";

    function getLastUpdated(r: Registration): string | null {
      if (regTypeFilter === "EOBI") return r.eobi_updated_at;
      if (regTypeFilter === "Social Security") return r.ss_updated_at;
      if (!r.eobi_updated_at && !r.ss_updated_at) return null;
      if (!r.eobi_updated_at) return r.ss_updated_at;
      if (!r.ss_updated_at) return r.eobi_updated_at;
      return r.eobi_updated_at > r.ss_updated_at ? r.eobi_updated_at : r.ss_updated_at;
    }

    // Filtering
    const filtered = registrations.filter((r) => {
      if (regEntityFilter && r.entity !== regEntityFilter) return false;
      if (regSearch && !r.name.toLowerCase().includes(regSearch.toLowerCase())) return false;
      if (regStatusFilter) {
        if (regTypeFilter === "EOBI")            return r.eobi_status === regStatusFilter;
        if (regTypeFilter === "Social Security") return r.ss_status   === regStatusFilter;
        return r.eobi_status === regStatusFilter || r.ss_status === regStatusFilter;
      }
      return true;
    });

    // Stat card values (unfiltered)
    const totalReg  = registrations.filter((r) => r.eobi_status === "Registered").length;
    const totalPend = registrations.filter((r) => !r.eobi_status || r.eobi_status === "Pending").length;
    const total     = registrations.length;
    const pct       = total > 0 ? Math.round((totalReg / total) * 100) : 0;

    // Section groups from filtered results
    const ifplRows = filtered.filter((r) => r.entity === "IFPL");
    const restRows = filtered.filter((r) => r.entity === "Baranh" || r.entity === "HD");
    const utplRows = filtered.filter((r) => r.entity === "UTPL");

    const SECTION_LIMIT = 10;

    const statusSelStyle = (status: string | null): React.CSSProperties => {
      const s = status || "Pending";
      const map: Record<string, { bg: string; color: string }> = {
        Registered: { bg: "#ECFDF5", color: COLOURS.GREEN },
        Pending:    { bg: "#FEF3C7", color: COLOURS.AMBER },
        Inprocess:  { bg: "#EFF6FF", color: "#1E40AF" },
        "N/A":      { bg: COLOURS.HAIRLINE, color: COLOURS.SLATE },
      };
      const c = map[s] || map["N/A"];
      return { WebkitAppearance: "none" as const, appearance: "none" as const, borderRadius: "20px", padding: "3px 10px", fontSize: "11px", fontWeight: 600, cursor: "pointer", border: "none", fontFamily: "inherit", backgroundColor: c.bg, color: c.color };
    };

    const thStyle: React.CSSProperties = { padding: "9px 14px", textAlign: "left", fontSize: "10.5px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "#FAFBFC" };

    function renderSection(rows: Registration[], title: string, showEntity: boolean, sectionKey: string) {
      if (rows.length === 0) return null;
      const isExpanded = expandedSections[sectionKey] || false;
      const visibleRows = isExpanded ? rows : rows.slice(0, SECTION_LIMIT);
      const hasMore = rows.length > SECTION_LIMIT;
      return (
        <div style={{ marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
            <span style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>{title}</span>
            <div style={{ flex: 1, height: "1px", backgroundColor: COLOURS.HAIRLINE }} />
            <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 9px", borderRadius: "20px", backgroundColor: COLOURS.HAIRLINE, color: COLOURS.SLATE, whiteSpace: "nowrap" }}>{rows.length} locations</span>
          </div>
          <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", overflow: "hidden", backgroundColor: "white" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>Location</th>
                  {showEntity && <th style={thStyle}>Entity</th>}
                  {showEOBI && <th style={thStyle}>EOBI</th>}
                  {showSS && <th style={thStyle}>Social Security</th>}
                  <th style={thStyle}>Last Updated</th>
                  <th style={{ ...thStyle, width: "50px" }}></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.location_id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                    <td style={{ padding: "10px 14px", fontSize: "12.5px", color: COLOURS.NAVY, fontWeight: 500 }}>{r.name}</td>
                    {showEntity && (
                      <td style={{ padding: "10px 14px" }}>
                        <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 9px", borderRadius: "20px", backgroundColor: "rgba(15,23,32,.08)", color: COLOURS.NAVY }}>{r.entity}</span>
                      </td>
                    )}
                    {showEOBI && (
                      <td style={{ padding: "8px 14px" }}>
                        <select value={r.eobi_status || "Pending"} onChange={(e) => saveRegInline(r.location_id, r.name, "EOBI", e.target.value)} style={statusSelStyle(r.eobi_status)}>
                          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                    )}
                    {showSS && (
                      <td style={{ padding: "8px 14px" }}>
                        <select value={r.ss_status || "Pending"} onChange={(e) => saveRegInline(r.location_id, r.name, "Social Security", e.target.value)} style={statusSelStyle(r.ss_status)}>
                          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                    )}
                    <td style={{ padding: "10px 14px", fontSize: "11px", color: COLOURS.SLATE, whiteSpace: "nowrap" }}>
                      {getLastUpdated(r) ? formatDateUK(getLastUpdated(r)!) : "—"}
                    </td>
                    <td style={{ padding: "8px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                      <button onClick={() => setEditingReg({ location_id: r.location_id, name: r.name, type: "EOBI", current: r.eobi_status || "Pending", notes: r.eobi_notes || "" })}
                        style={{ fontSize: "12px", color: COLOURS.GREEN, background: "none", border: "none", cursor: "pointer", fontWeight: 500 }}>
                        Edit
                      </button>
                      {canManageLocations && (
                        <button onClick={() => removeLocation(r.location_id, r.name)}
                          style={{ fontSize: "12px", color: COLOURS.RED, background: "none", border: "none", cursor: "pointer", fontWeight: 500, marginLeft: "8px" }}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hasMore && (
              <div style={{ padding: "9px 14px", fontSize: "11.5px", color: COLOURS.SLATE, borderTop: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Showing {visibleRows.length} of {rows.length}</span>
                <button onClick={() => setExpandedSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }))}
                  style={{ color: COLOURS.GREEN, background: "none", border: "none", cursor: "pointer", fontWeight: 600, fontSize: "11.5px" }}>
                  {isExpanded ? "Show less ↑" : `Show ${rows.length - SECTION_LIMIT} more ↓`}
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div>
        {/* Stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "10px", marginBottom: "18px" }}>
          <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", padding: "14px 18px", backgroundColor: "white" }}>
            <div style={{ fontSize: "24px", fontWeight: 700, color: COLOURS.GREEN, lineHeight: 1.1 }}>{totalReg}</div>
            <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "3px", fontWeight: 500 }}>EOBI Registered</div>
          </div>
          <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", padding: "14px 18px", backgroundColor: "white" }}>
            <div style={{ fontSize: "24px", fontWeight: 700, color: COLOURS.AMBER, lineHeight: 1.1 }}>{totalPend}</div>
            <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "3px", fontWeight: 500 }}>EOBI Pending</div>
          </div>
          <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", padding: "14px 18px", backgroundColor: "white" }}>
            <div style={{ fontSize: "24px", fontWeight: 700, color: COLOURS.NAVY, lineHeight: 1.1 }}>{total}</div>
            <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "3px", fontWeight: 500 }}>Total Locations</div>
          </div>
          <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", padding: "14px 18px", backgroundColor: "white" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
              <div style={{ flex: 1, height: "5px", backgroundColor: COLOURS.HAIRLINE, borderRadius: "3px", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, backgroundColor: COLOURS.GREEN, borderRadius: "3px" }} />
              </div>
              <span style={{ fontSize: "11px", color: COLOURS.SLATE, fontWeight: 600, whiteSpace: "nowrap" }}>{pct}%</span>
            </div>
            <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "6px", fontWeight: 500 }}>EOBI Compliance</div>
          </div>
        </div>

        {/* Filter bar */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap", alignItems: "center" }}>
          <select value={regEntityFilter} onChange={(e) => setRegEntityFilter(e.target.value)}
            style={{ padding: "6px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "6px", fontSize: "12.5px", color: COLOURS.NAVY, backgroundColor: "white", minWidth: "130px" }}>
            <option value="">All Entities</option>
            <option value="IFPL">IFPL — Retail</option>
            <option value="Baranh">Baranh</option>
            <option value="HD">Haute Dolci</option>
            <option value="UTPL">UTPL</option>
          </select>
          <select value={regTypeFilter} onChange={(e) => setRegTypeFilter(e.target.value as "" | "EOBI" | "Social Security")}
            style={{ padding: "6px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "6px", fontSize: "12.5px", color: COLOURS.NAVY, backgroundColor: "white", minWidth: "160px" }}>
            <option value="">EOBI &amp; Social Security</option>
            <option value="EOBI">EOBI only</option>
            <option value="Social Security">Social Security only</option>
          </select>
          <select value={regStatusFilter} onChange={(e) => setRegStatusFilter(e.target.value)}
            style={{ padding: "6px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "6px", fontSize: "12.5px", color: COLOURS.NAVY, backgroundColor: "white", minWidth: "130px" }}>
            <option value="">All Statuses</option>
            <option value="Registered">Registered</option>
            <option value="Pending">Pending</option>
          </select>
          <input type="text" value={regSearch} onChange={(e) => setRegSearch(e.target.value)}
            placeholder="🔍  Search location…"
            style={{ padding: "6px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "6px", fontSize: "12.5px", flex: 1, minWidth: "180px", color: COLOURS.NAVY, backgroundColor: "white" }}
          />
          {canManageLocations && (
            <button onClick={() => setAddingLocation(true)}
              style={{ padding: "6px 14px", borderRadius: "6px", border: "none", backgroundColor: COLOURS.NAVY, color: "white", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
              + Add Location
            </button>
          )}
        </div>

        {renderSection(ifplRows, "IFPL — Imperial Footwear (Retail)", false, "ifpl")}
        {renderSection(restRows, "Restaurants — Baranh & Haute Dolci", true, "restaurants")}
        {renderSection(utplRows, "Unze Trading (UTPL)", false, "utpl")}

        {filtered.length === 0 && !loadingRegs && (
          <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No locations match your filters.</p>
        )}

        {/* Add Location modal */}
        {addingLocation && (
          <div style={{ position: "fixed", inset: 0, zIndex: 9998, backgroundColor: "rgba(15,23,42,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
            onClick={() => setAddingLocation(false)}>
            <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "white", borderRadius: RADII.CARD, padding: "24px", maxWidth: "420px", width: "100%", boxShadow: "0 20px 60px rgba(15,23,42,0.15)" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "16px" }}>Add Location</div>
              <div style={{ display: "grid", gap: "12px", marginBottom: "16px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Location Name</label>
                  <input value={newLocation.name} onChange={(e) => setNewLocation({ ...newLocation, name: e.target.value })}
                    placeholder="e.g. Multan City Centre"
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Entity</label>
                    <select value={newLocation.entity} onChange={(e) => setNewLocation({ ...newLocation, entity: e.target.value })}
                      style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                      <option value="IFPL">IFPL</option>
                      <option value="Baranh">Baranh</option>
                      <option value="HD">Haute Dolci</option>
                      <option value="UTPL">UTPL</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Type</label>
                    <select value={newLocation.location_type} onChange={(e) => setNewLocation({ ...newLocation, location_type: e.target.value })}
                      style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                      <option value="retail">Retail</option>
                      <option value="restaurant">Restaurant</option>
                      <option value="warehouse">Warehouse</option>
                      <option value="plant">Plant</option>
                      <option value="office">Office</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Province (optional)</label>
                  <select value={newLocation.province} onChange={(e) => setNewLocation({ ...newLocation, province: e.target.value })}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                    <option value="">— Select —</option>
                    <option value="Punjab">Punjab</option>
                    <option value="Sindh">Sindh</option>
                    <option value="KPK">KPK</option>
                    <option value="Balochistan">Balochistan</option>
                    <option value="AJK">AJK</option>
                  </select>
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <button onClick={() => setAddingLocation(false)} style={{ padding: "8px 16px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 500, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.NAVY, cursor: "pointer" }}>Cancel</button>
                <button onClick={addLocation} disabled={savingLocation || !newLocation.name.trim()} style={{ ...primaryButtonStyle, opacity: (savingLocation || !newLocation.name.trim()) ? 0.6 : 1 }}>
                  {savingLocation ? "Adding…" : "Add Location"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit modal */}
        {editingReg && (
          <div style={{ position: "fixed", inset: 0, zIndex: 9998, backgroundColor: "rgba(15,23,42,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
            onClick={() => setEditingReg(null)}>
            <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "white", borderRadius: RADII.CARD, padding: "24px", maxWidth: "400px", width: "100%", boxShadow: "0 20px 60px rgba(15,23,42,0.15)" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "4px" }}>{editingReg.name}</div>
              <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "16px" }}>{editingReg.type} registration status</div>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Status</label>
                <select value={editingReg.current} onChange={(e) => setEditingReg({ ...editingReg, current: e.target.value })}
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: "16px" }}>
                <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Notes (optional)</label>
                <textarea value={editingReg.notes} onChange={(e) => setEditingReg({ ...editingReg, notes: e.target.value })}
                  rows={3} style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical" as const }} />
              </div>
              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <button onClick={() => setEditingReg(null)} style={{ padding: "8px 16px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 500, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.NAVY, cursor: "pointer" }}>Cancel</button>
                <button onClick={saveRegistration} disabled={regSaving} style={{ ...primaryButtonStyle, opacity: regSaving ? 0.6 : 1 }}>
                  {regSaving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Tab: Compliance & Payments ─────────────────────────────────────
  function renderPayments() {
    if (loadingPayments) return <SkeletonRows count={8} height="44px" />;

    const ENTITY_ORDER = ["IFPL", "Baranh", "HD", "UTPL"];
    const eobiRows = ENTITY_ORDER
      .map((e) => paymentRows.find((r) => r.entity === e && r.payment_type === "EOBI"))
      .filter(Boolean) as PaymentRow[];
    const ssRows = ENTITY_ORDER
      .map((e) => paymentRows.find((r) => r.entity === e && r.payment_type === "Social Security"))
      .filter(Boolean) as PaymentRow[];

    function entityBadge(row: PaymentRow) {
      const past = (row.months || []).filter((m) => m.status !== "future");
      const missing = past.filter((m) => m.status === "missing").length;
      const late = past.filter((m) => m.status === "late").length;
      const onTime = past.filter((m) => m.status === "on_time").length;
      if (missing > 0) return { text: `${missing} missing`, bg: "#FEE2E2", color: COLOURS.RED };
      if (late > 0)    return { text: `${late} late · ${onTime}/${past.length} on time`, bg: "#FEF3C7", color: COLOURS.AMBER };
      if (past.length === 0) return { text: "No data", bg: COLOURS.HAIRLINE, color: COLOURS.SLATE };
      return { text: `${onTime}/${past.length} on time`, bg: "#D1FAE5", color: COLOURS.GREEN };
    }

    function sectionBadge(rows: PaymentRow[]) {
      const missing = rows.reduce((n, r) => n + (r.months || []).filter((m) => m.status === "missing").length, 0);
      const late    = rows.reduce((n, r) => n + (r.months || []).filter((m) => m.status === "late").length, 0);
      if (missing > 0) return { text: `${missing} missing`, bg: "#FEE2E2", color: COLOURS.RED };
      if (late > 0)    return { text: `${late} late`, bg: "#FEF3C7", color: COLOURS.AMBER };
      return null;
    }

    function renderEntityBlock(row: PaymentRow, payType: string) {
      const badge = entityBadge(row);
      return (
        <div key={`${row.entity}-${payType}`} style={{
          border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px",
          overflow: "hidden", marginBottom: "10px", backgroundColor: "white",
        }}>
          {/* Entity header */}
          <div style={{
            padding: "12px 16px", display: "flex", justifyContent: "space-between",
            alignItems: "flex-start", borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
            backgroundColor: "#FAFBFD",
          }}>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY }}>
                {ENTITY_DISPLAY[row.entity] || row.entity}
              </div>
              <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>
                {payType} · Due by 15th each month
              </div>
            </div>
            <span style={{
              fontSize: "11px", fontWeight: 700, padding: "3px 10px",
              borderRadius: "20px", backgroundColor: badge.bg, color: badge.color,
              whiteSpace: "nowrap", marginLeft: "12px",
            }}>{badge.text}</span>
          </div>

          {/* Month grid */}
          <div style={{ padding: "14px 16px", overflowX: "auto" }}>
            <div style={{ display: "flex", gap: "6px", minWidth: "max-content" }}>
              {(row.months || []).map((entry) => {
                const circleCfg: Record<string, { bg: string; color: string; symbol: string }> = {
                  on_time: { bg: COLOURS.GREEN, color: "white",        symbol: "✓" },
                  late:    { bg: COLOURS.AMBER, color: "white",        symbol: "!" },
                  missing: { bg: COLOURS.RED,   color: "white",        symbol: "✗" },
                  future:  { bg: "#E2E8F0",     color: COLOURS.SLATE,  symbol: "—" },
                };
                const cfg = circleCfg[entry.status] || circleCfg.future;
                // DD short: "08/05" → show day only, or "Due 15th" / "Overdue"
                const detail = entry.date_paid
                  ? entry.date_paid.split("-").reverse().join("/").slice(0, 5)
                  : entry.status === "missing" ? "Overdue" : "Due 15";
                const tooltip = entry.date_paid
                  ? `Paid ${entry.date_paid.split("-").reverse().join("/")}${entry.challan_number ? ` · Challan ${entry.challan_number}` : ""}${entry.amount_pkr ? ` · PKR ${Number(entry.amount_pkr).toLocaleString()}` : ""}`
                  : entry.status === "missing" ? "Not paid — click to record" : "";
                return (
                  <div
                    key={entry.month}
                    title={tooltip}
                    onClick={() => entry.status === "missing" && setAddingPayment({ entity: row.entity, payment_type: payType, month: entry.month })}
                    style={{
                      display: "flex", flexDirection: "column", alignItems: "center",
                      gap: "3px", cursor: entry.status === "missing" ? "pointer" : "default",
                      minWidth: "38px",
                    }}
                  >
                    <div style={{ fontSize: "10px", fontWeight: 600, color: COLOURS.SLATE }}>
                      {MONTH_NAMES[entry.month - 1]}
                    </div>
                    <div style={{
                      width: "30px", height: "30px", borderRadius: "50%",
                      backgroundColor: cfg.bg, color: cfg.color,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "12px", fontWeight: 700,
                    }}>{cfg.symbol}</div>
                    <div style={{ fontSize: "9px", color: COLOURS.SLATE, textAlign: "center", lineHeight: 1.2 }}>
                      {detail}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      );
    }

    function renderSection(
      title: string,
      rows: PaymentRow[],
      payType: string,
    ) {
      const badge = sectionBadge(rows);
      return (
        <div style={{ marginBottom: "28px" }}>
          {/* Section header */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
            <span style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>
              {title}
            </span>
            <div style={{ flex: 1, height: "1px", backgroundColor: COLOURS.HAIRLINE }} />
            {badge && (
              <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 9px", borderRadius: "20px", backgroundColor: badge.bg, color: badge.color, whiteSpace: "nowrap" }}>
                {badge.text}
              </span>
            )}
            <button
              onClick={() => setAddingPayment({ entity: "IFPL", payment_type: payType, month: new Date().getMonth() + 1 })}
              style={{ fontSize: "12px", fontWeight: 600, padding: "5px 12px", borderRadius: "20px", border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.NAVY, cursor: "pointer", whiteSpace: "nowrap" }}
            >
              + Record Payment
            </button>
          </div>
          {rows.length === 0
            ? <p style={{ fontSize: "13px", color: COLOURS.SLATE }}>No data for {paymentYear}.</p>
            : rows.map((r) => renderEntityBlock(r, payType))
          }
        </div>
      );
    }

    return (
      <div>
        {/* Legend */}
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "20px", padding: "10px 14px", backgroundColor: "#FAFBFD", borderRadius: "8px", border: `1px solid ${COLOURS.HAIRLINE}` }}>
          {[
            { color: COLOURS.GREEN, label: "Paid on time (by 15th)" },
            { color: COLOURS.AMBER, label: "Paid late (after 15th)" },
            { color: COLOURS.RED,   label: "Missed / not paid" },
            { color: "#E2E8F0",     label: "Future month" },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: color, flexShrink: 0 }} />
              <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{label}</span>
            </div>
          ))}
          <span style={{ fontSize: "12px", color: COLOURS.SLATE, marginLeft: "auto" }}>
            Click a red ✗ to record a payment.
          </span>
        </div>

        {renderSection("EOBI — Monthly Payments", eobiRows, "EOBI")}
        {renderSection("Social Security — Monthly Payments", ssRows, "Social Security")}
      </div>
    );
  }

  function renderComplianceRenewals() {
    if (loadingCompliance) return <SkeletonRows count={6} height="44px" />;

    const today = new Date().toISOString().slice(0, 10);
    const overdueCount = compliance.filter((r) =>
      (r.civil_defence_status === "Overdue") ||
      (r.civil_defence_due && r.civil_defence_due < today && r.civil_defence_status !== "Done")
    ).length;

    const statusBadge = (status: string | null): React.CSSProperties => {
      const s = status || "—";
      const map: Record<string, { bg: string; color: string }> = {
        Done:       { bg: "#ECFDF5", color: COLOURS.GREEN },
        Registered: { bg: "#ECFDF5", color: COLOURS.GREEN },
        Pending:    { bg: "#FEF3C7", color: COLOURS.AMBER },
        Inprocess:  { bg: "#EFF6FF", color: "#1E40AF" },
        Overdue:    { bg: "#FEF2F2", color: COLOURS.RED },
      };
      const c = map[s] || { bg: COLOURS.HAIRLINE, color: COLOURS.SLATE };
      return { fontSize: "11px", fontWeight: 600, padding: "2px 9px", borderRadius: "20px", backgroundColor: c.bg, color: c.color, display: "inline-block" };
    };

    const thStyle: React.CSSProperties = { padding: "9px 14px", textAlign: "left", fontSize: "10.5px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "#FAFBFC" };

    const CIVIL_LIMIT = 10;
    const civilExpanded = expandedSections["civil-defence"] || false;
    const visibleCompliance = civilExpanded ? compliance : compliance.slice(0, CIVIL_LIMIT);
    const hasMorCivil = compliance.length > CIVIL_LIMIT;

    const COMPLIANCE_STATUSES = ["Done", "Inprocess", "Pending", "Overdue", "N/A"];

    function openComplianceEdit(r: ComplianceRow, type: "Civil Defence" | "Labour Registration" | "Labour Inspection") {
      const statusMap = {
        "Civil Defence":       { status: r.civil_defence_status, registered: r.civil_defence_registered, due: r.civil_defence_due },
        "Labour Registration": { status: r.labour_reg_status,    registered: r.labour_reg_registered,    due: r.labour_reg_due },
        "Labour Inspection":   { status: r.labour_insp_status,   registered: r.labour_insp_registered,   due: r.labour_insp_due },
      };
      const vals = statusMap[type];
      setEditingCompliance({
        location_id: r.location_id, name: r.name, compliance_type: type,
        status: vals.status || "Pending",
        last_renewed: vals.registered || "",
        next_due: vals.due || "",
        notes: "",
      });
    }

    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>Civil Defence & Labour — Periodic Renewals</span>
          <div style={{ flex: 1, height: "1px", backgroundColor: COLOURS.HAIRLINE }} />
          {overdueCount > 0 && (
            <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 9px", borderRadius: "20px", backgroundColor: "#FEF2F2", color: COLOURS.RED, whiteSpace: "nowrap" }}>{overdueCount} overdue</span>
          )}
        </div>
        {compliance.length === 0 ? (
          <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No compliance data on record yet.</p>
        ) : (
          <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", overflow: "hidden", backgroundColor: "white", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "780px" }}>
              <thead>
                <tr>
                  {["Location", "Entity", "Civil Defence", "Last Renewed", "Next Due", "Labour Reg.", "Labour Insp.", ""].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleCompliance.map((r) => {
                  const isOverdue = r.civil_defence_due && r.civil_defence_due < today && r.civil_defence_status !== "Done";
                  return (
                    <tr key={r.location_id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                      <td style={{ padding: "10px 14px", fontSize: "12.5px", color: COLOURS.NAVY, fontWeight: 500 }}>{r.name}</td>
                      <td style={{ padding: "10px 14px", fontSize: "11px", color: COLOURS.SLATE, whiteSpace: "nowrap" }}>{r.entity}</td>
                      <td style={{ padding: "8px 14px" }}><span style={statusBadge(r.civil_defence_status)}>{r.civil_defence_status || "—"}</span></td>
                      <td style={{ padding: "10px 14px", fontSize: "11.5px", color: COLOURS.SLATE }}>
                        {r.civil_defence_registered ? formatDateUK(r.civil_defence_registered) : "—"}
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: "11.5px", color: isOverdue ? COLOURS.RED : COLOURS.SLATE, fontWeight: isOverdue ? 600 : 400 }}>
                        {r.civil_defence_due ? formatDateUK(r.civil_defence_due) : "—"}{isOverdue ? " ⚠️" : ""}
                      </td>
                      <td style={{ padding: "8px 14px" }}><span style={statusBadge(r.labour_reg_status)}>{r.labour_reg_status || "—"}</span></td>
                      <td style={{ padding: "8px 14px" }}><span style={statusBadge(r.labour_insp_status)}>{r.labour_insp_status || "—"}</span></td>
                      <td style={{ padding: "8px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                        <button onClick={() => openComplianceEdit(r, "Civil Defence")}
                          style={{ fontSize: "11.5px", color: COLOURS.GREEN, background: "none", border: "none", cursor: "pointer", fontWeight: 500 }}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {hasMorCivil && (
              <div style={{ padding: "9px 14px", fontSize: "11.5px", color: COLOURS.SLATE, borderTop: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Showing {visibleCompliance.length} of {compliance.length}</span>
                <button onClick={() => setExpandedSections((prev) => ({ ...prev, "civil-defence": !prev["civil-defence"] }))}
                  style={{ color: COLOURS.GREEN, background: "none", border: "none", cursor: "pointer", fontWeight: 600, fontSize: "11.5px" }}>
                  {civilExpanded ? "Show less ↑" : `Show ${compliance.length - CIVIL_LIMIT} more ↓`}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Edit compliance modal */}
        {editingCompliance && (
          <div style={{ position: "fixed", inset: 0, zIndex: 9998, backgroundColor: "rgba(15,23,42,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
            onClick={() => setEditingCompliance(null)}>
            <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "white", borderRadius: RADII.CARD, padding: "24px", maxWidth: "420px", width: "100%", boxShadow: "0 20px 60px rgba(15,23,42,0.15)" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "2px" }}>{editingCompliance.name}</div>
              <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "16px" }}>{editingCompliance.compliance_type}</div>
              <div style={{ display: "grid", gap: "12px", marginBottom: "16px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Status</label>
                  <select value={editingCompliance.status} onChange={(e) => setEditingCompliance({ ...editingCompliance, status: e.target.value })}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                    {COMPLIANCE_STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Date Registered</label>
                    <DateInput value={editingCompliance.last_renewed} onChange={(e) => setEditingCompliance({ ...editingCompliance, last_renewed: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Renewal Due</label>
                    <DateInput value={editingCompliance.next_due} onChange={(e) => setEditingCompliance({ ...editingCompliance, next_due: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Notes (optional)</label>
                  <textarea value={editingCompliance.notes} onChange={(e) => setEditingCompliance({ ...editingCompliance, notes: e.target.value })}
                    rows={2} style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical" as const }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <button onClick={() => setEditingCompliance(null)} style={{ padding: "8px 16px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 500, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.NAVY, cursor: "pointer" }}>Cancel</button>
                <button onClick={saveCompliance} disabled={savingCompliance} style={{ ...primaryButtonStyle, opacity: savingCompliance ? 0.6 : 1 }}>
                  {savingCompliance ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Tab: Documents ─────────────────────────────────────────────────
  function renderNtnDocs() {
    if (loadingNtn) return <SkeletonRows count={5} height="44px" />;

    const filtered = ntnDocs.filter((d) => {
      if (docSearch && !d.location_name.toLowerCase().includes(docSearch.toLowerCase())) return false;
      if (docStatusFilterUI && d.status !== docStatusFilterUI) return false;
      return true;
    });

    if (ntnDocs.length === 0) return <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No NTN documents on record yet.</p>;
    if (filtered.length === 0) return <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No NTN documents match your filters.</p>;

    const thStyle: React.CSSProperties = { padding: "9px 14px", textAlign: "left", fontSize: "10.5px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "#FAFBFC" };

    return (
      <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", overflow: "hidden", backgroundColor: "white" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Location", "Meter", "NTN Number", "Status", "Document"].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => (
              <tr key={d.doc_id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                <td style={{ padding: "10px 14px", fontSize: "12.5px", color: COLOURS.NAVY, fontWeight: 500 }}>{d.location_name}</td>
                <td style={{ padding: "10px 14px", fontSize: "11px", color: COLOURS.SLATE }}>{d.meter_label || "—"}</td>
                <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: "11.5px", color: COLOURS.NAVY }}>{d.ntn_number || "—"}</td>
                <td style={{ padding: "8px 14px" }}><StatusPill status={d.status} /></td>
                <td style={{ padding: "8px 14px" }}>
                  {d.folderit_link
                    ? <a href={d.folderit_link} target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px", color: COLOURS.GREEN, textDecoration: "none", fontWeight: 500 }}>📄 Folderit</a>
                    : <span style={{ fontSize: "11px", color: COLOURS.SLATE }}>—</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderLicences() {
    if (loadingLicences) return <SkeletonRows count={4} height="44px" />;
    const LICENCE_COLS = [
      { key: "pfa", label: "PFA Licence" },
      { key: "medical", label: "Medical Cert" },
      { key: "training", label: "Training Cert" },
      { key: "tourism", label: "Tourism Cert" },
    ];

    const filtered = restaurantLicences.filter((r) => {
      if (docSearch && !r.location_name.toLowerCase().includes(docSearch.toLowerCase())) return false;
      if (docStatusFilterUI) {
        const matches = LICENCE_COLS.some((col) => r[`${col.key}_status` as keyof RestaurantLicence] === docStatusFilterUI);
        if (!matches) return false;
      }
      return true;
    });

    if (restaurantLicences.length === 0) return <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No restaurant licences on record yet.</p>;
    if (filtered.length === 0) return <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No licences match your filters.</p>;

    const thStyle: React.CSSProperties = { padding: "9px 14px", textAlign: "left", fontSize: "10.5px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "#FAFBFC" };

    return (
      <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", overflow: "hidden", backgroundColor: "white", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "600px" }}>
          <thead>
            <tr>
              <th style={thStyle}>Restaurant / Location</th>
              <th style={thStyle}>Entity</th>
              {LICENCE_COLS.map((col) => <th key={col.key} style={thStyle}>{col.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.location_id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                <td style={{ padding: "10px 14px", fontSize: "12.5px", color: COLOURS.NAVY, fontWeight: 500 }}>{r.location_name}</td>
                <td style={{ padding: "10px 14px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 9px", borderRadius: "20px", backgroundColor: "rgba(15,23,32,.08)", color: COLOURS.NAVY }}>{r.entity}</span>
                </td>
                {LICENCE_COLS.map((col) => {
                  const status = r[`${col.key}_status` as keyof RestaurantLicence] as string | null;
                  const link   = r[`${col.key}_link`   as keyof RestaurantLicence] as string | null;
                  const expiry = r[`${col.key}_expiry`  as keyof RestaurantLicence] as string | null;
                  return (
                    <td key={col.key} style={{ padding: "8px 14px" }}>
                      <StatusPill status={status} />
                      {expiry && <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>{formatDateUK(expiry)}</div>}
                      {link && <a href={link} target="_blank" rel="noopener noreferrer" style={{ display: "block", fontSize: "11px", color: COLOURS.GREEN, marginTop: "2px" }}>View</a>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ── Tab: Operations ────────────────────────────────────────────────
  function renderFuel() {
    if (loadingFuel) return <SkeletonRows count={4} height="44px" />;
    const monthRows = fuelRows.filter((r) => r.month === opsMonth);
    if (monthRows.length === 0) return <p style={{ color: COLOURS.SLATE, fontSize: "14px" }}>No fuel entries for {MONTH_NAMES[opsMonth - 1]} {opsYear} yet.</p>;

    const totalAmt = monthRows.reduce((s, r) => s + r.total_amount, 0);
    const totalLit = monthRows.reduce((s, r) => s + r.total_litres, 0);
    const avgKmL   = totalLit > 0 ? monthRows.reduce((s, r) => s + (r.avg_km_per_l || 0) * r.total_litres, 0) / totalLit : null;
    const avgPriceL = totalLit > 0 ? totalAmt / totalLit : null;
    const fmtPKR = (n: number) => n >= 100000 ? `PKR ${(n / 1000).toFixed(0)}K` : `PKR ${n.toLocaleString()}`;

    const statCards = [
      { label: "Total fuel spend", value: fmtPKR(totalAmt), color: COLOURS.NAVY },
      { label: "Total litres", value: `${totalLit.toFixed(0)} L`, color: COLOURS.NAVY },
      { label: "Avg km / litre", value: avgKmL ? `${avgKmL.toFixed(1)}` : "—", color: COLOURS.GREEN },
      { label: "Avg price / litre", value: avgPriceL ? `PKR ${avgPriceL.toFixed(0)}` : "—", color: COLOURS.NAVY },
    ];

    return (
      <div>
        {/* Fuel stat row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "10px", marginBottom: "14px" }}>
          {statCards.map((c) => (
            <div key={c.label} style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", padding: "14px 18px", backgroundColor: "white" }}>
              <div style={{ fontSize: "22px", fontWeight: 700, color: c.color, lineHeight: 1.1 }}>{c.value}</div>
              <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "3px", fontWeight: 500 }}>{c.label}</div>
            </div>
          ))}
        </div>

        {/* Vehicle cards grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "10px" }}>
          {monthRows.map((r) => (
            <div key={r.vehicle_id} style={{ backgroundColor: "white", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY }}>{r.vehicle_name}</div>
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE, fontFamily: "monospace", marginTop: "2px" }}>{r.plate_number}</div>
                </div>
                <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 9px", borderRadius: "20px", backgroundColor: "#ECFDF5", color: COLOURS.GREEN, whiteSpace: "nowrap" }}>Active</span>
              </div>
              <div style={{ display: "flex" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: COLOURS.NAVY }}>PKR {r.total_amount.toLocaleString()}</div>
                  <div style={{ fontSize: "10.5px", color: COLOURS.SLATE, marginTop: "2px" }}>This month</div>
                </div>
                <div style={{ width: "1px", backgroundColor: COLOURS.HAIRLINE, margin: "0 12px" }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: COLOURS.NAVY }}>{r.avg_km_per_l ? `${r.avg_km_per_l} km/L` : "—"}</div>
                  <div style={{ fontSize: "10.5px", color: COLOURS.SLATE, marginTop: "2px" }}>Efficiency</div>
                </div>
              </div>
              <div style={{ fontSize: "10.5px", color: COLOURS.SLATE, marginTop: "10px", borderTop: `1px solid ${COLOURS.HAIRLINE}`, paddingTop: "8px" }}>
                {r.fills} fill{r.fills !== 1 ? "s" : ""} · {r.total_litres.toFixed(1)} L total
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderSolar() {
    if (loadingSolar) return <SkeletonRows count={4} height="44px" />;
    if (solarBranches.length === 0) return <p style={{ color: COLOURS.SLATE, fontSize: "14px" }}>No solar branches configured yet.</p>;

    const now = new Date();
    const isCurrentOrPast = opsYear < now.getFullYear() || (opsYear === now.getFullYear() && opsMonth <= now.getMonth() + 1);

    const branchData = solarBranches.map((b) => ({
      ...b,
      monthData: (b.months || []).find((m) => m.month === opsMonth),
    }));

    const totalKwh    = branchData.reduce((s, b) => s + (b.monthData?.total_kwh || 0), 0);
    const noDataCount = isCurrentOrPast ? branchData.filter((b) => !b.monthData?.total_kwh).length : 0;
    const estSavings  = totalKwh * 40;

    return (
      <div>
        {/* Solar stat row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "10px", marginBottom: "14px" }}>
          <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", padding: "14px 18px", backgroundColor: "white" }}>
            <div style={{ fontSize: "22px", fontWeight: 700, color: COLOURS.NAVY, lineHeight: 1.1 }}>{totalKwh > 0 ? `${totalKwh.toFixed(0)} kWh` : "—"}</div>
            <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "3px", fontWeight: 500 }}>Total production</div>
          </div>
          <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", padding: "14px 18px", backgroundColor: "white" }}>
            <div style={{ fontSize: "22px", fontWeight: 700, color: COLOURS.GREEN, lineHeight: 1.1 }}>{estSavings > 0 ? `PKR ${(estSavings / 1000).toFixed(0)}K` : "—"}</div>
            <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "3px", fontWeight: 500 }}>Est. savings @ PKR 40/kWh</div>
          </div>
          <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", padding: "14px 18px", backgroundColor: "white" }}>
            <div style={{ fontSize: "22px", fontWeight: 700, color: noDataCount > 0 ? COLOURS.RED : COLOURS.GREEN, lineHeight: 1.1 }}>{noDataCount}</div>
            <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "3px", fontWeight: 500 }}>No data this month</div>
          </div>
        </div>

        {/* Solar cards grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "10px" }}>
          {branchData.map((b) => {
            const kwh    = b.monthData?.total_kwh;
            const noData = isCurrentOrPast && (kwh == null || kwh === 0);
            return (
              <div key={b.branch_id} style={{ backgroundColor: "white", border: `1px solid ${noData ? COLOURS.RED : COLOURS.HAIRLINE}`, borderRadius: "10px", padding: "14px 16px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.NAVY, textTransform: "uppercase", letterSpacing: "0.4px" }}>{b.branch_name}</div>
                <div style={{ fontSize: "10.5px", color: COLOURS.SLATE, marginBottom: "8px" }}>{b.system_kw ? `${b.system_kw} kW system` : "—"}</div>
                <div style={{ fontSize: "22px", fontWeight: 700, color: kwh ? COLOURS.NAVY : COLOURS.SLATE }}>
                  {kwh != null ? Math.round(kwh) : "—"}
                  {kwh != null && <span style={{ fontSize: "11.5px", color: COLOURS.SLATE, fontWeight: 400, marginLeft: "2px" }}>kWh</span>}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px", borderTop: `1px solid ${COLOURS.HAIRLINE}`, paddingTop: "7px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 9px", borderRadius: "20px", backgroundColor: noData ? "#FEF2F2" : "#ECFDF5", color: noData ? COLOURS.RED : COLOURS.GREEN, whiteSpace: "nowrap" }}>
                    {noData ? "No data" : "Active"}
                  </span>
                  <span style={{ fontSize: "10.5px", color: COLOURS.SLATE }}>
                    {b.monthData?.days_entered ? `${b.monthData.days_entered}d` : "—"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────
  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
        <PageHeader />
        <h1 style={{ fontSize: "22px", fontWeight: 800, color: COLOURS.NAVY, margin: "0 0 4px" }}>Admin Operations</h1>
        <p style={{ fontSize: "14px", color: COLOURS.SLATE, margin: "0 0 18px" }}>
          EOBI & Social Security registrations, compliance, documents, and operational data.
        </p>

        {/* Tab bar */}
        <div style={{ display: "flex", gap: "4px", marginBottom: "20px", overflowX: "auto", paddingBottom: "2px" }}>
          {TABS.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={tabStyle(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── REGISTRATIONS ── */}
        {activeTab === "registrations" && renderRegistrations()}

        {/* ── COMPLIANCE ── */}
        {activeTab === "compliance" && (
          <div>
            {/* Alert banner */}
            {!loadingPayments && (() => {
              const missingCount = paymentRows.reduce((n, r) => n + (r.months || []).filter((m) => m.status === "missing").length, 0);
              const lateCount    = paymentRows.reduce((n, r) => n + (r.months || []).filter((m) => m.status === "late").length, 0);
              if (missingCount === 0 && lateCount === 0) return null;
              const isHighAlert = missingCount > 0;
              const msg = [
                missingCount > 0 ? `${missingCount} missing payment${missingCount > 1 ? "s" : ""}` : "",
                lateCount > 0    ? `${lateCount} late payment${lateCount > 1 ? "s" : ""}` : "",
              ].filter(Boolean).join(" · ");
              return (
                <div style={{ padding: "11px 16px", borderRadius: "8px", marginBottom: "18px", fontSize: "12.5px", display: "flex", alignItems: "center", gap: "8px",
                  backgroundColor: isHighAlert ? "#FEF2F2" : "#FFFBEB",
                  color:           isHighAlert ? "#7F1D1D" : "#78350F",
                  border:          isHighAlert ? "1px solid #FECACA" : "1px solid #FDE68A",
                }}>
                  {isHighAlert ? "🚨" : "⚠️"} <strong>{msg}</strong>{isHighAlert ? " — action required" : ""}
                </div>
              );
            })()}

            {/* Year nav */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "18px" }}>
              <button onClick={() => setPaymentYear((y) => y - 1)} style={{ width: "26px", height: "26px", borderRadius: "6px", border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.SLATE, fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>‹</button>
              <span style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY }}>{paymentYear}</span>
              <button onClick={() => setPaymentYear((y) => y + 1)} style={{ width: "26px", height: "26px", borderRadius: "6px", border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.SLATE, fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>›</button>
            </div>

            {renderPayments()}

            <div style={{ marginTop: "8px" }}>
              {renderComplianceRenewals()}
            </div>
          </div>
        )}

        {/* ── DOCUMENTS ── */}
        {activeTab === "documents" && (
          <div>
            {/* Filter bar */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "18px", flexWrap: "wrap", alignItems: "center" }}>
              <select value={docTypeFilterUI} onChange={(e) => setDocTypeFilterUI(e.target.value)}
                style={{ padding: "6px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "6px", fontSize: "12.5px", color: COLOURS.NAVY, backgroundColor: "white", minWidth: "140px" }}>
                <option value="">All Types</option>
                <option value="ntn">NTN</option>
                <option value="licences">Restaurant Licences</option>
              </select>
              <select value={docStatusFilterUI} onChange={(e) => setDocStatusFilterUI(e.target.value)}
                style={{ padding: "6px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "6px", fontSize: "12.5px", color: COLOURS.NAVY, backgroundColor: "white", minWidth: "140px" }}>
                <option value="">All Statuses</option>
                <option value="Done">Done</option>
                <option value="Pending">Pending</option>
                <option value="N/A">N/A</option>
              </select>
              <input type="text" value={docSearch} onChange={(e) => setDocSearch(e.target.value)}
                placeholder="🔍  Search location…"
                style={{ padding: "6px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "6px", fontSize: "12.5px", flex: 1, minWidth: "180px", color: COLOURS.NAVY, backgroundColor: "white" }}
              />
            </div>

            {(docTypeFilterUI === "" || docTypeFilterUI === "ntn") && (
              <div style={{ marginBottom: "24px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>NTN on WAPDA Bills</span>
                  <div style={{ flex: 1, height: "1px", backgroundColor: COLOURS.HAIRLINE }} />
                </div>
                {renderNtnDocs()}
              </div>
            )}

            {(docTypeFilterUI === "" || docTypeFilterUI === "licences") && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>Restaurant Licences</span>
                  <div style={{ flex: 1, height: "1px", backgroundColor: COLOURS.HAIRLINE }} />
                  {(() => {
                    const pendCount = restaurantLicences.filter((r) =>
                      r.pfa_status === "Pending" || r.medical_status === "Pending" ||
                      r.training_status === "Pending" || r.tourism_status === "Pending"
                    ).length;
                    return pendCount > 0 ? (
                      <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 9px", borderRadius: "20px", backgroundColor: "#FEF3C7", color: COLOURS.AMBER, whiteSpace: "nowrap" }}>{pendCount} pending</span>
                    ) : null;
                  })()}
                </div>
                {renderLicences()}
              </div>
            )}
          </div>
        )}

        {/* ── OPERATIONS ── */}
        {activeTab === "operations" && (
          <div>
            {/* Month nav */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
              <button onClick={prevOpsMonth} style={{ width: "26px", height: "26px", borderRadius: "6px", border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.SLATE, fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>‹</button>
              <span style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY, minWidth: "140px", textAlign: "center" }}>{MONTH_FULL[opsMonth - 1]} {opsYear}</span>
              <button onClick={nextOpsMonth} style={{ width: "26px", height: "26px", borderRadius: "6px", border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.SLATE, fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>›</button>
              {opsYear === CURRENT_YEAR && opsMonth === new Date().getMonth() + 1 && (
                <span style={{ fontSize: "11px", color: COLOURS.SLATE, marginLeft: "4px" }}>(month to date)</span>
              )}
            </div>

            {/* Fuel section */}
            <div style={{ marginBottom: "28px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>⛽ Fleet — Fuel Summary</span>
                <div style={{ flex: 1, height: "1px", backgroundColor: COLOURS.HAIRLINE }} />
                <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 9px", borderRadius: "20px", backgroundColor: COLOURS.HAIRLINE, color: COLOURS.SLATE }}>
                  {fuelRows.filter((r) => r.month === opsMonth).length} vehicles
                </span>
              </div>
              {renderFuel()}
            </div>

            {/* Solar section */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>☀️ Solar — Monthly Production</span>
                <div style={{ flex: 1, height: "1px", backgroundColor: COLOURS.HAIRLINE }} />
                <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 9px", borderRadius: "20px", backgroundColor: COLOURS.HAIRLINE, color: COLOURS.SLATE }}>
                  {solarBranches.length} systems
                </span>
              </div>
              {renderSolar()}
            </div>
          </div>
        )}

        {/* ── DATA & BACKUPS ── */}
        {activeTab === "backups" && (
          <div>
            <SectionTitle title="Backups" />
            {statusMsg && (
              <div style={{
                padding: "10px 14px", borderRadius: RADII.CARD, marginBottom: "16px", fontSize: "13px",
                backgroundColor: statusMsg.ok ? "#D1FAE5" : "#FEE2E2",
                color: statusMsg.ok ? COLOURS.GREEN : COLOURS.RED,
                border: `1px solid ${statusMsg.ok ? "#9ED4A3" : "#EDB5B2"}`,
              }}>{statusMsg.text}</div>
            )}
            <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
              <button onClick={handleRunBackup} disabled={runningBackup} style={{ ...primaryButtonStyle, opacity: runningBackup ? 0.6 : 1 }}>
                {runningBackup ? "Running…" : "Run backup now"}
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "8px", marginBottom: "14px" }}>
              <CountCard label="Backups stored" value={backups.length} color={COLOURS.NAVY} />
              <CountCard label="Source PDFs archived" value={docs.length} color={COLOURS.NAVY} />
            </div>
            {loadingBackups ? <SkeletonRows count={3} height="40px" /> : backups.length === 0 ? (
              <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, padding: "14px", backgroundColor: "white", color: COLOURS.SLATE, textAlign: "center", marginBottom: "20px" }}>
                No backups yet.
              </div>
            ) : (
              <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: "white", overflow: "hidden", marginBottom: "20px" }}>
                {backups.map((b) => (
                  <div key={b.name} style={{ padding: "10px 14px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>{b.name}</div>
                      <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>{formatDateTimeUK(b.createdAt)} · {b.sizeKB ? `${b.sizeKB} KB` : "—"}</div>
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button onClick={() => handleDownloadBackup(b.name)} style={{ padding: "6px 12px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 500, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.NAVY, cursor: "pointer" }}>Download</button>
                      <button onClick={() => setRestoreTarget(b.name)} style={{ padding: "6px 12px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 500, border: "none", backgroundColor: COLOURS.RED, color: "white", cursor: "pointer" }}>Restore</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <SectionTitle title="Source Documents" />
            <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
              <select value={docTypeFilter} onChange={(e) => setDocTypeFilter(e.target.value)} style={{ padding: "7px 10px", borderRadius: RADII.SM, border: `1px solid ${COLOURS.HAIRLINE}`, fontSize: "13px", backgroundColor: "white", color: COLOURS.NAVY }}>
                <option value="">All document types</option>
                <option value="cash_flow">Cash flow</option>
                <option value="bank_position">Bank position</option>
              </select>
              <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} style={{ padding: "7px 10px", borderRadius: RADII.SM, border: `1px solid ${COLOURS.HAIRLINE}`, fontSize: "13px", backgroundColor: "white", color: COLOURS.NAVY }}>
                <option value="">All companies</option>
                {COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.shortCode}</option>)}
              </select>
            </div>
            {loadingDocs ? <SkeletonRows count={4} height="40px" /> : docs.length === 0 ? (
              <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, padding: "14px", backgroundColor: "white", color: COLOURS.SLATE, textAlign: "center" }}>
                No archived source documents match this filter.
              </div>
            ) : (
              <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: "white", overflow: "hidden" }}>
                {docs.map((d) => (
                  <div key={d.id} style={{ padding: "8px 14px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                        {d.original_filename}
                        <span style={{ fontSize: "11px", fontWeight: 600, padding: "1px 7px", borderRadius: RADII.XS, backgroundColor: "#EEF1FC", color: "#3B4CCA" }}>{companyName(d.company_id)}</span>
                        <span style={{ fontSize: "11px", fontWeight: 600, padding: "1px 7px", borderRadius: RADII.XS, backgroundColor: COLOURS.HAIRLINE, color: COLOURS.SLATE }}>{d.doc_type === "cash_flow" ? "Cash flow" : "Bank position"}</span>
                      </div>
                      <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>
                        {d.position_date ? formatDateUK(d.position_date) : "no date"} · {d.source} · uploaded {formatDateTimeUK(d.created_at)}
                      </div>
                    </div>
                    <button onClick={() => handleDownloadDoc(d)} style={{ padding: "6px 12px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 500, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.NAVY, cursor: "pointer", flexShrink: 0 }}>
                      Download
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Restore modal */}
            {restoreTarget && (
              <div style={{ position: "fixed", inset: 0, zIndex: 9998, backgroundColor: "rgba(15,23,42,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
                onClick={() => { setRestoreTarget(null); setRestoreConfirmText(""); }}>
                <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "white", borderRadius: RADII.CARD, padding: "28px", maxWidth: "440px", width: "100%", boxShadow: "0 20px 60px rgba(15,23,42,0.15)" }}>
                  <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "10px" }}>Restore from backup</div>
                  <p style={{ fontSize: "13px", color: COLOURS.SLATE, lineHeight: 1.5, margin: "0 0 14px" }}>
                    This will overwrite every matching row in <strong>{restoreTarget}</strong>. Nothing is deleted. Type <strong>RESTORE</strong> to confirm.
                  </p>
                  <input value={restoreConfirmText} onChange={(e) => setRestoreConfirmText(e.target.value)}
                    placeholder="RESTORE" style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: "16px" }} />
                  <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                    <button onClick={() => { setRestoreTarget(null); setRestoreConfirmText(""); }} style={{ padding: "8px 18px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 500, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.NAVY, cursor: "pointer" }}>Cancel</button>
                    <button onClick={handleRestore} disabled={restoreConfirmText !== "RESTORE" || restoring}
                      style={{ padding: "8px 18px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 500, border: "none", backgroundColor: COLOURS.RED, color: "white", cursor: restoreConfirmText === "RESTORE" ? "pointer" : "not-allowed", opacity: restoreConfirmText === "RESTORE" ? 1 : 0.5 }}>
                      {restoring ? "Restoring…" : "Restore"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Add payment modal */}
        {addingPayment && (
          <div style={{ position: "fixed", inset: 0, zIndex: 9998, backgroundColor: "rgba(15,23,42,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
            onClick={() => setAddingPayment(null)}>
            <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "white", borderRadius: RADII.CARD, padding: "24px", maxWidth: "420px", width: "100%", boxShadow: "0 20px 60px rgba(15,23,42,0.15)" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "4px" }}>Record Payment</div>
              <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "16px" }}></div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Entity</label>
                  <select value={addingPayment.entity} onChange={(e) => setAddingPayment({ ...addingPayment, entity: e.target.value })}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                    {["IFPL", "Baranh", "HD", "UTPL"].map((e) => <option key={e}>{e}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Type</label>
                  <select value={addingPayment.payment_type} onChange={(e) => setAddingPayment({ ...addingPayment, payment_type: e.target.value })}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                    <option>EOBI</option>
                    <option>Social Security</option>
                  </select>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Month</label>
                  <select value={addingPayment.month} onChange={(e) => setAddingPayment({ ...addingPayment, month: Number(e.target.value) })}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                    {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Date Paid</label>
                  <DateInput value={paymentForm.date_paid} onChange={(e) => setPaymentForm({ ...paymentForm, date_paid: e.target.value })} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Amount (PKR)</label>
                  <input type="number" value={paymentForm.amount_pkr} onChange={(e) => setPaymentForm({ ...paymentForm, amount_pkr: e.target.value })}
                    placeholder="0" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Challan No.</label>
                  <input type="text" value={paymentForm.challan_number} onChange={(e) => setPaymentForm({ ...paymentForm, challan_number: e.target.value })}
                    placeholder="Optional" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                </div>
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Notes (optional)</label>
                <textarea value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                  rows={2} style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical" as const }} />
              </div>

              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <button onClick={() => setAddingPayment(null)} style={{ padding: "8px 16px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 500, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.NAVY, cursor: "pointer" }}>Cancel</button>
                <button onClick={savePayment} disabled={savingPayment || !paymentForm.date_paid} style={{ ...primaryButtonStyle, opacity: (savingPayment || !paymentForm.date_paid) ? 0.6 : 1 }}>
                  {savingPayment ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}

        {confirmElement}
        {toastElement}
      </main>
    </AuthWrapper>
  );
}
