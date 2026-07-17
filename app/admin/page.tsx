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
  eobi_status: string | null; eobi_notes: string | null;
  ss_status: string | null;   ss_notes: string | null;
};

type MonthEntry = {
  month: number; amount_pkr: number | null;
  date_paid: string | null; challan_number: string | null;
  is_late: boolean | null; status: "on_time" | "late" | "missing" | "future";
};
type PaymentRow = { entity: string; payment_type: string; months: MonthEntry[] };

type ComplianceRow = {
  location_id: string; name: string; entity: string;
  civil_defence_status: string | null; civil_defence_due: string | null;
  labour_reg_status: string | null;    labour_reg_due: string | null;
  labour_insp_status: string | null;   labour_insp_due: string | null;
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
  const [complianceSubTab, setComplianceSubTab] = useState<"payments" | "renewals">("payments");

  // ── Documents state ────────────────────────────────────────────────
  const [ntnDocs, setNtnDocs] = useState<NtnDoc[]>([]);
  const [loadingNtn, setLoadingNtn] = useState(false);
  const [restaurantLicences, setRestaurantLicences] = useState<RestaurantLicence[]>([]);
  const [loadingLicences, setLoadingLicences] = useState(false);

  // ── Operations state ───────────────────────────────────────────────
  const [fuelRows, setFuelRows] = useState<FuelRow[]>([]);
  const [loadingFuel, setLoadingFuel] = useState(false);
  const [solarBranches, setSolarBranches] = useState<SolarBranch[]>([]);
  const [loadingSolar, setLoadingSolar] = useState(false);
  const [opsYear, setOpsYear] = useState(CURRENT_YEAR);

  // ── Initial setup ──────────────────────────────────────────────────
  useEffect(() => {
    if (checking) return;
    // Detect if user is main admin (needed for backups tab)
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email?.toLowerCase() === "khuram1901@gmail.com") setUserIsAdmin(true);
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
  const grouped = groupedByEntity(registrations);

  function renderRegistrations() {
    if (loadingRegs) return <SkeletonRows count={6} height="44px" />;

    return (
      <div>
        {Object.entries(grouped).map(([entity, rows]) => {
          if (rows.length === 0) return null;
          return (
            <div key={entity} style={{ marginBottom: "24px" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>{entity}</div>
              <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden", backgroundColor: "white" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                  <thead>
                    <tr style={{ backgroundColor: COLOURS.HAIRLINE }}>
                      <th style={{ padding: "8px 12px", textAlign: "left", fontSize: "12px", fontWeight: 700, color: COLOURS.SLATE, width: "40%" }}>Location</th>
                      <th style={{ padding: "8px 12px", textAlign: "left", fontSize: "12px", fontWeight: 700, color: COLOURS.SLATE, width: "30%" }}>EOBI</th>
                      <th style={{ padding: "8px 12px", textAlign: "left", fontSize: "12px", fontWeight: 700, color: COLOURS.SLATE, width: "30%" }}>Social Security</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.location_id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                        <td style={{ padding: "10px 12px", fontSize: "13px", color: COLOURS.NAVY, fontWeight: 500 }}>{r.name}</td>
                        {(["EOBI", "Social Security"] as const).map((type) => {
                          const status = type === "EOBI" ? r.eobi_status : r.ss_status;
                          return (
                            <td key={type} style={{ padding: "8px 12px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <StatusPill status={status} />
                                <button onClick={() => setEditingReg({
                                  location_id: r.location_id,
                                  name: r.name,
                                  type,
                                  current: status || "Pending",
                                  notes: (type === "EOBI" ? r.eobi_notes : r.ss_notes) || "",
                                })} style={{ fontSize: "11px", padding: "2px 8px", borderRadius: RADII.SM, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.SLATE, cursor: "pointer" }}>
                                  Edit
                                </button>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

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

    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "13px", minWidth: "700px" }}>
          <thead>
            <tr style={{ backgroundColor: COLOURS.HAIRLINE }}>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700, color: COLOURS.SLATE, whiteSpace: "nowrap" }}>Entity</th>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700, color: COLOURS.SLATE, whiteSpace: "nowrap" }}>Type</th>
              {MONTH_NAMES.map((m) => (
                <th key={m} style={{ padding: "6px 4px", textAlign: "center", fontWeight: 700, color: COLOURS.SLATE, width: "42px", fontSize: "11px" }}>{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paymentRows.map((row) => (
              <tr key={`${row.entity}-${row.payment_type}`} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                <td style={{ padding: "8px 12px", fontWeight: 600, color: COLOURS.NAVY, whiteSpace: "nowrap" }}>{row.entity}</td>
                <td style={{ padding: "8px 12px", color: COLOURS.SLATE, whiteSpace: "nowrap" }}>{row.payment_type}</td>
                {(row.months || []).map((entry) => (
                  <MonthCell key={entry.month} entry={entry} />
                ))}
                {/* Clicking missing months opens add-payment modal */}
                {(row.months || []).filter(e => e.status === "missing").length > 0 && (
                  (row.months || []).map((entry) =>
                    entry.status === "missing" ? (
                      <td key={`add-${entry.month}`} style={{ display: "none" }} />
                    ) : null
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "8px" }}>
          ✓ = paid on time (by 15th) · ✓ amber = late · ✗ = not paid · — = future
        </p>
        <p style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "12px" }}>Hover a ✓ to see amount, date, and challan number.</p>

        <button onClick={() => setAddingPayment({ entity: "IFPL", payment_type: "EOBI", month: new Date().getMonth() + 1 })}
          style={{ ...primaryButtonStyle }}>
          + Record a payment
        </button>
      </div>
    );
  }

  function renderComplianceRenewals() {
    if (loadingCompliance) return <SkeletonRows count={6} height="44px" />;
    const grouped2 = groupedByEntity(compliance);
    return (
      <div>
        {Object.entries(grouped2).map(([entity, rows]) => {
          if (rows.length === 0) return null;
          return (
            <div key={entity} style={{ marginBottom: "24px" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>{entity}</div>
              <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden", backgroundColor: "white", overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "560px" }}>
                  <thead>
                    <tr style={{ backgroundColor: COLOURS.HAIRLINE }}>
                      <th style={{ padding: "8px 12px", textAlign: "left", fontSize: "12px", fontWeight: 700, color: COLOURS.SLATE }}>Location</th>
                      <th style={{ padding: "8px 12px", textAlign: "center", fontSize: "12px", fontWeight: 700, color: COLOURS.SLATE }}>Civil Defence</th>
                      <th style={{ padding: "8px 12px", textAlign: "center", fontSize: "12px", fontWeight: 700, color: COLOURS.SLATE }}>Labour Registration</th>
                      <th style={{ padding: "8px 12px", textAlign: "center", fontSize: "12px", fontWeight: 700, color: COLOURS.SLATE }}>Labour Inspection</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.location_id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                        <td style={{ padding: "10px 12px", fontSize: "13px", color: COLOURS.NAVY, fontWeight: 500 }}>{r.name}</td>
                        {[
                          { status: r.civil_defence_status, due: r.civil_defence_due },
                          { status: r.labour_reg_status, due: r.labour_reg_due },
                          { status: r.labour_insp_status, due: r.labour_insp_due },
                        ].map((col, i) => (
                          <td key={i} style={{ padding: "8px 12px", textAlign: "center" }}>
                            <StatusPill status={col.status} />
                            {col.due && (
                              <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>
                                Due {formatDateUK(col.due)}
                              </div>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ── Tab: Documents ─────────────────────────────────────────────────
  function renderNtnDocs() {
    if (loadingNtn) return <SkeletonRows count={5} height="44px" />;
    const grouped3 = groupedByEntity(ntnDocs.map(d => ({ ...d, entity: d.entity })));
    return (
      <div>
        {Object.entries(grouped3).map(([entity, rows]) => {
          if (rows.length === 0) return null;
          return (
            <div key={entity} style={{ marginBottom: "24px" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>{entity}</div>
              <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden", backgroundColor: "white" }}>
                {(rows as NtnDoc[]).map((d) => (
                  <div key={d.doc_id} style={{ padding: "10px 14px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>{d.location_name}{d.meter_label && ` — ${d.meter_label}`}</div>
                      {d.ntn_number && <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>NTN: {d.ntn_number}</div>}
                    </div>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <StatusPill status={d.status} />
                      {d.folderit_link && (
                        <a href={d.folderit_link} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: "12px", color: COLOURS.GREEN, textDecoration: "none", fontWeight: 600 }}>View →</a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {ntnDocs.length === 0 && <p style={{ color: COLOURS.SLATE, fontSize: "14px" }}>No NTN documents on record yet.</p>}
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
    const grouped4 = restaurantLicences.reduce<Record<string, RestaurantLicence[]>>((acc, r) => {
      if (!acc[r.entity]) acc[r.entity] = [];
      acc[r.entity].push(r);
      return acc;
    }, {});
    return (
      <div>
        {["Baranh", "HD"].map((entity) => {
          const rows = grouped4[entity] || [];
          if (rows.length === 0) return null;
          return (
            <div key={entity} style={{ marginBottom: "24px" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>{entity}</div>
              <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden", backgroundColor: "white", overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "600px" }}>
                  <thead>
                    <tr style={{ backgroundColor: COLOURS.HAIRLINE }}>
                      <th style={{ padding: "8px 12px", textAlign: "left", fontSize: "12px", fontWeight: 700, color: COLOURS.SLATE }}>Location</th>
                      {LICENCE_COLS.map((col) => (
                        <th key={col.key} style={{ padding: "8px 12px", textAlign: "center", fontSize: "12px", fontWeight: 700, color: COLOURS.SLATE }}>{col.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.location_id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                        <td style={{ padding: "10px 12px", fontSize: "13px", color: COLOURS.NAVY, fontWeight: 500 }}>{r.location_name}</td>
                        {LICENCE_COLS.map((col) => {
                          const status = r[`${col.key}_status` as keyof RestaurantLicence] as string | null;
                          const link = r[`${col.key}_link` as keyof RestaurantLicence] as string | null;
                          const expiry = r[`${col.key}_expiry` as keyof RestaurantLicence] as string | null;
                          return (
                            <td key={col.key} style={{ padding: "8px 12px", textAlign: "center" }}>
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
            </div>
          );
        })}
        {restaurantLicences.length === 0 && <p style={{ color: COLOURS.SLATE, fontSize: "14px" }}>No restaurant licences on record yet.</p>}
      </div>
    );
  }

  // ── Tab: Operations ────────────────────────────────────────────────
  function renderFuel() {
    if (loadingFuel) return <SkeletonRows count={4} height="44px" />;
    if (fuelRows.length === 0) return <p style={{ color: COLOURS.SLATE, fontSize: "14px" }}>No fuel entries for {opsYear} yet.</p>;

    // Group by month
    const byMonth: Record<number, FuelRow[]> = {};
    fuelRows.forEach((r) => {
      if (!byMonth[r.month]) byMonth[r.month] = [];
      byMonth[r.month].push(r);
    });

    return (
      <div>
        {Object.entries(byMonth).sort((a, b) => Number(b[0]) - Number(a[0])).map(([mo, rows]) => {
          const totalAmt = rows.reduce((s, r) => s + r.total_amount, 0);
          const totalLit = rows.reduce((s, r) => s + r.total_litres, 0);
          return (
            <div key={mo} style={{ marginBottom: "20px" }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "6px" }}>
                {MONTH_NAMES[Number(mo) - 1]} {opsYear}
                <span style={{ fontWeight: 400, color: COLOURS.SLATE, marginLeft: "10px" }}>
                  PKR {totalAmt.toLocaleString()} · {totalLit.toFixed(1)}L total
                </span>
              </div>
              <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden", backgroundColor: "white" }}>
                {rows.map((r) => (
                  <div key={r.vehicle_id} style={{ padding: "10px 14px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>
                      {r.vehicle_name} <span style={{ fontWeight: 400, color: COLOURS.SLATE }}>({r.plate_number})</span>
                    </div>
                    <div style={{ fontSize: "13px", color: COLOURS.SLATE, textAlign: "right" }}>
                      <span style={{ color: COLOURS.NAVY, fontWeight: 600 }}>PKR {r.total_amount.toLocaleString()}</span>
                      {" · "}{r.total_litres.toFixed(1)}L
                      {r.avg_km_per_l && ` · ${r.avg_km_per_l} km/L`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function renderSolar() {
    if (loadingSolar) return <SkeletonRows count={4} height="44px" />;
    if (solarBranches.length === 0) return <p style={{ color: COLOURS.SLATE, fontSize: "14px" }}>No solar data for {opsYear} yet.</p>;

    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "13px", minWidth: "700px" }}>
          <thead>
            <tr style={{ backgroundColor: COLOURS.HAIRLINE }}>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700, color: COLOURS.SLATE }}>Branch</th>
              <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: COLOURS.SLATE }}>System</th>
              {MONTH_NAMES.map((m) => (
                <th key={m} style={{ padding: "6px 4px", textAlign: "center", fontWeight: 700, color: COLOURS.SLATE, width: "52px", fontSize: "11px" }}>{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {solarBranches.map((b) => {
              const monthMap: Record<number, { total_kwh: number | null; days_entered: number }> = {};
              (b.months || []).forEach((m) => { monthMap[m.month] = m; });
              return (
                <tr key={b.branch_id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                  <td style={{ padding: "8px 12px", fontWeight: 600, color: COLOURS.NAVY, whiteSpace: "nowrap" }}>{b.branch_name}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", color: COLOURS.SLATE, whiteSpace: "nowrap" }}>{b.system_kw ? `${b.system_kw} kW` : "—"}</td>
                  {MONTH_NAMES.map((_, i) => {
                    const mo = i + 1;
                    const data = monthMap[mo];
                    const isPast = mo <= new Date().getMonth() + 1 && opsYear <= CURRENT_YEAR;
                    return (
                      <td key={mo} style={{
                        padding: "6px 4px", textAlign: "center", fontSize: "12px",
                        backgroundColor: !data && isPast ? "#FEF3C7" : "transparent",
                        color: data?.total_kwh ? COLOURS.GREEN : COLOURS.SLATE,
                        border: `1px solid ${COLOURS.HAIRLINE}`,
                      }}>
                        {data?.total_kwh != null ? `${data.total_kwh.toFixed(0)}` : "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "8px" }}>Monthly kWh totals. Amber = no data entered for a past month.</p>
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
        {activeTab === "registrations" && (
          <div>
            <SectionTitle title="EOBI & Social Security Registration Status" />
            <p style={{ fontSize: "13px", color: COLOURS.SLATE, margin: "-8px 0 16px" }}>
              Click Edit on any cell to update the registration status for that location.
            </p>
            {renderRegistrations()}
          </div>
        )}

        {/* ── COMPLIANCE ── */}
        {activeTab === "compliance" && (
          <div>
            <div style={{ display: "flex", gap: "4px", marginBottom: "16px" }}>
              {(["payments", "renewals"] as const).map((sub) => (
                <button key={sub} onClick={() => setComplianceSubTab(sub)} style={{
                  padding: "6px 14px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 600, cursor: "pointer",
                  border: `1px solid ${complianceSubTab === sub ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
                  backgroundColor: complianceSubTab === sub ? COLOURS.NAVY : "white",
                  color: complianceSubTab === sub ? "white" : COLOURS.SLATE,
                }}>
                  {sub === "payments" ? "EOBI & SS Payments" : "Civil Defence & Labour"}
                </button>
              ))}
            </div>

            {complianceSubTab === "payments" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
                  <SectionTitle title={`Monthly Payments — ${paymentYear}`} style={{ margin: 0 }} />
                  <div style={{ display: "flex", gap: "4px" }}>
                    <button onClick={() => setPaymentYear((y) => y - 1)} style={{ padding: "4px 10px", borderRadius: RADII.SM, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", cursor: "pointer", fontSize: "14px" }}>‹</button>
                    <span style={{ padding: "4px 10px", fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>{paymentYear}</span>
                    <button onClick={() => setPaymentYear((y) => y + 1)} style={{ padding: "4px 10px", borderRadius: RADII.SM, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", cursor: "pointer", fontSize: "14px" }}>›</button>
                  </div>
                </div>
                {renderPayments()}
              </div>
            )}

            {complianceSubTab === "renewals" && (
              <div>
                <SectionTitle title="Civil Defence & Labour Compliance" />
                <p style={{ fontSize: "13px", color: COLOURS.SLATE, margin: "-8px 0 16px" }}>
                  Annual renewal tracking per location.
                </p>
                {renderComplianceRenewals()}
              </div>
            )}
          </div>
        )}

        {/* ── DOCUMENTS ── */}
        {activeTab === "documents" && (
          <div>
            <SectionTitle title="NTN on WAPDA Bills" />
            <p style={{ fontSize: "13px", color: COLOURS.SLATE, margin: "-8px 0 16px" }}>
              NTN registration status on electricity bills per location.
            </p>
            {renderNtnDocs()}

            <SectionTitle title="Restaurant Licences" style={{ marginTop: "24px" }} />
            <p style={{ fontSize: "13px", color: COLOURS.SLATE, margin: "-8px 0 16px" }}>
              PFA, Medical, Training, and Tourism certificates per outlet.
            </p>
            {renderLicences()}
          </div>
        )}

        {/* ── OPERATIONS ── */}
        {activeTab === "operations" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
              <h2 style={{ fontSize: "16px", fontWeight: 700, color: COLOURS.NAVY, margin: 0 }}>
                CEO Operations Summary — {opsYear}
              </h2>
              <div style={{ display: "flex", gap: "4px" }}>
                <button onClick={() => setOpsYear((y) => y - 1)} style={{ padding: "4px 10px", borderRadius: RADII.SM, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", cursor: "pointer", fontSize: "14px" }}>‹</button>
                <span style={{ padding: "4px 10px", fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>{opsYear}</span>
                <button onClick={() => setOpsYear((y) => y + 1)} style={{ padding: "4px 10px", borderRadius: RADII.SM, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", cursor: "pointer", fontSize: "14px" }}>›</button>
              </div>
            </div>

            <SectionTitle title="Vehicle Fuel" />
            {renderFuel()}

            <SectionTitle title="Solar Production (kWh/month)" style={{ marginTop: "24px" }} />
            {renderSolar()}
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
