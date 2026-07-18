"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { useRequireCapability } from "../lib/useRouteGuard";
import { supabase } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import { useMobile } from "../lib/useMobile";
import DateInput from "../lib/DateInput";
import {
  COLOURS, RADII, PageHeader, SectionTitle, CountCard, SkeletonRows,
  useConfirm, useToast, primaryButtonStyle, inputStyle,
} from "../lib/SharedUI";

// ── Types ─────────────────────────────────────────────────────────────

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

type FuelFill = {
  date: string; price_per_litre: number; quantity_litres: number;
  amount_pkr: number; previous_odometer: number | null;
  current_odometer: number | null; km_per_litre: number | null; mileage_km: number | null;
};

type MaintenanceRecord = {
  date: string; work_type: string; description: string | null;
  odometer_km: number | null; cost_pkr: number; workshop: string | null;
};

type SolarBranch = {
  branch_id: string; branch_name: string; system_kw: number | null;
  months: { month: number; total_kwh: number | null; days_entered: number }[] | null;
};

type UtilityLocation = {
  location_id: string; location_name: string; entity: string;
  months: { month: number; total_bill: number | null; meters_read: number }[] | null;
};

type TabId = "registrations" | "payments" | "compliance" | "documents" | "operations";

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

// Fiscal year start year (July year).
// e.g. in March 2026 → 2025 (FY 2025-26); in September 2026 → 2026 (FY 2026-27).
function currentFyStart(): number {
  const now = new Date();
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}
function fyLabel(fyStart: number): string {
  return `FY ${fyStart}-${String(fyStart + 1).slice(2)}`;
}

const CURRENT_FY_START = currentFyStart();

// ── Main component ────────────────────────────────────────────────────

export default function AdminDataPage() {
  const { checking } = useRequireCapability("admin_ops");
  const isMobile = useMobile();
  const { confirm, element: confirmElement } = useConfirm();
  const { show: showToast, element: toastElement } = useToast();

  const [activeTab, setActiveTab] = useState<TabId>("registrations");

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
  const [editingLicence, setEditingLicence] = useState<{
    location_id: string; location_name: string;
    licence_type: string; licence_label: string;
    status: string; expiry_date: string; folderit_link: string;
  } | null>(null);
  const [savingLicence, setSavingLicence] = useState(false);
  const [paymentRows, setPaymentRows] = useState<PaymentRow[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [paymentYear, setPaymentYear] = useState(new Date().getFullYear()); // EOBI = calendar year
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
  const [ntnPage, setNtnPage] = useState(0);
  const [editingNtn, setEditingNtn] = useState<{
    doc_id: string; location_id: string; location_name: string;
    meter_label: string; ntn_number: string; status: string; folderit_link: string;
  } | null>(null);
  const [savingNtn, setSavingNtn] = useState(false);

  // ── Registrations filter state ─────────────────────────────────────
  const [regSearch, setRegSearch] = useState("");
  const [regEntityFilter, setRegEntityFilter] = useState("");
  const [regStatusFilter, setRegStatusFilter] = useState("");
  const [regTypeFilter, setRegTypeFilter] = useState<"" | "EOBI" | "Social Security">("");
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [canManageLocations, setCanManageLocations] = useState(false);

  // ── Add location modal state ───────────────────────────────────────
  const [addingLocation, setAddingLocation] = useState(false);
  const [newLocation, setNewLocation] = useState({
    name: "", entity: "IFPL", location_type: "retail", province: "",
    eobi_status: "Pending", ss_status: "Pending",
    civil_defence_status: "Pending", civil_defence_registered: "", civil_defence_due: "",
    labour_reg_status: "Pending", labour_insp_status: "Pending",
    ntn_number: "", meter_label: "",
  });
  const [savingLocation, setSavingLocation] = useState(false);

  // ── Operations state ───────────────────────────────────────────────
  const [fuelRows, setFuelRows] = useState<FuelRow[]>([]);
  const [loadingFuel, setLoadingFuel] = useState(false);
  const [solarBranches, setSolarBranches] = useState<SolarBranch[]>([]);
  const [loadingSolar, setLoadingSolar] = useState(false);
  const [utilityLocations, setUtilityLocations] = useState<UtilityLocation[]>([]);
  const [loadingUtility, setLoadingUtility] = useState(false);
  // opsYear = fiscal year START year (July year), e.g. 2025 = FY 2025-26
  const [opsYear, setOpsYear] = useState(CURRENT_FY_START);
  const [opsMonth, setOpsMonth] = useState(new Date().getMonth() + 1);

  // ── Vehicle detail side panel ──────────────────────────────────────
  const [vehiclePanel, setVehiclePanel] = useState<{
    vehicleId: string; vehicleName: string; plateNumber: string;
  } | null>(null);
  const [vehicleDetail, setVehicleDetail] = useState<{
    fuel: FuelFill[]; maintenance: MaintenanceRecord[];
  } | null>(null);
  const [vehicleDetailTab, setVehicleDetailTab] = useState<"fuel" | "maintenance" | "summary">("fuel");
  // vehicleDetailYear = fiscal year START year
  const [vehicleDetailYear, setVehicleDetailYear] = useState(CURRENT_FY_START);
  const [loadingVehicleDetail, setLoadingVehicleDetail] = useState(false);

  // ── Import modal ───────────────────────────────────────────────────
  const [importModal, setImportModal] = useState<{
    type: "fuel" | "maintenance" | "solar"; label: string;
  } | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    imported: number; skipped: number; errors: string[];
  } | null>(null);

  // ── Manage Fleet modal ─────────────────────────────────────────────
  const [manageFleet, setManageFleet] = useState(false);
  const [allVehicles, setAllVehicles] = useState<{
    id: string; name: string; plate_number: string; is_active: boolean; odometer_unit: string;
  }[]>([]);
  const [vehicleForm, setVehicleForm] = useState<{
    id?: string; name: string; plate_number: string; is_active: boolean; odometer_unit: string;
  } | null>(null);
  const [savingVehicle, setSavingVehicle] = useState(false);

  // ── Manage Solar Sites modal ───────────────────────────────────────
  const [manageSolar, setManageSolar] = useState(false);
  const [allSolarBranches, setAllSolarBranches] = useState<{
    id: string; name: string; system_kw: number | null; is_active: boolean;
  }[]>([]);
  const [solarForm, setSolarForm] = useState<{
    id?: string; name: string; system_kw: string; is_active: boolean;
  } | null>(null);
  const [savingSolar, setSavingSolar] = useState(false);

  // ── Manage Utility Sites modal ─────────────────────────────────────
  const [manageUtility, setManageUtility] = useState(false);
  const [allLocations, setAllLocations] = useState<{
    id: string; name: string; entity: string; location_type: string; province: string | null; is_active: boolean; default_disco: string | null;
  }[]>([]);
  const [locationForm, setLocationForm] = useState<{
    id?: string; name: string; entity: string; location_type: string; province: string; is_active: boolean; default_disco: string;
  } | null>(null);
  const [savingUtilityLoc, setSavingUtilityLoc] = useState(false);

  // ── Utility pagination ─────────────────────────────────────────────
  const [utilityPage, setUtilityPage] = useState(0);
  const UTIL_PAGE_SIZE = 10;

  // ── Initial setup ──────────────────────────────────────────────────
  useEffect(() => {
    if (checking) return;
    // Check can_manage_locations for admin emails and permitted members
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const ADMIN_EMAILS_UI = ["khuram1901@gmail.com", "k.saleem@unzegroup.com"];
      const isAdmin = ADMIN_EMAILS_UI.includes(user.email?.toLowerCase() || "");
      if (isAdmin) { setCanManageLocations(true); return; }
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
    if (activeTab === "payments" && paymentRows.length === 0 && !loadingPayments) {
      loadPayments();
    }
    if (activeTab === "compliance" && compliance.length === 0 && !loadingCompliance) {
      loadCompliance();
      loadLicences();
    }
    if (activeTab === "documents" && ntnDocs.length === 0 && !loadingNtn) {
      loadNtnDocs();
    }
    if (activeTab === "operations" && fuelRows.length === 0 && !loadingFuel) {
      loadFuel();
      loadSolar();
      loadUtility();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, checking]);

  useEffect(() => {
    if (activeTab === "payments" && !checking) loadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentYear]);

  useEffect(() => {
    if (activeTab === "operations" && !checking) { loadFuel(); loadSolar(); loadUtility(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opsYear]);

  // Reset utility page when month changes
  useEffect(() => { setUtilityPage(0); }, [opsMonth, opsYear]);

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

  async function loadUtility() {
    setLoadingUtility(true);
    const res = await authedFetch(`/api/admin/operations?type=utility&year=${opsYear}`);
    const json = await res.json();
    setUtilityLocations(json.data || []);
    setLoadingUtility(false);
  }

  async function loadVehicleDetail(vehicleId: string, year: number) {
    setLoadingVehicleDetail(true);
    setVehicleDetail(null);
    const res = await authedFetch(`/api/admin/vehicle-detail?vehicleId=${vehicleId}&year=${year}`);
    const json = await res.json();
    setVehicleDetail(json.data || { fuel: [], maintenance: [] });
    setLoadingVehicleDetail(false);
  }

  async function handleImport() {
    if (!importFile || !importModal) return;
    setImporting(true);
    setImportResult(null);
    const form = new FormData();
    form.append("type", importModal.type);
    form.append("file", importFile);
    const res = await authedFetch("/api/admin/import", { method: "POST", body: form });
    const json = await res.json();
    setImportResult(json);
    setImporting(false);
    if (json.imported > 0) {
      if (importModal.type === "fuel") loadFuel();
      else if (importModal.type === "solar") loadSolar();
    }
  }

  async function handleDownloadTemplate(type: string, filename: string) {
    const res = await authedFetch(`/api/admin/import?type=${type}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

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
    // Crossing Jul backward enters the previous fiscal year
    if (opsMonth === 7) { setOpsMonth(6); setOpsYear((y) => y - 1); }
    else setOpsMonth((m) => m - 1);
  }
  function nextOpsMonth() {
    const now = new Date();
    // opsCalYear: actual calendar year for the displayed month
    const calYear = opsMonth >= 7 ? opsYear : opsYear + 1;
    if (calYear === now.getFullYear() && opsMonth === now.getMonth() + 1) return;
    // Crossing Jun forward enters the next fiscal year
    if (opsMonth === 6) { setOpsMonth(7); setOpsYear((y) => y + 1); }
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

  async function saveNtn() {
    if (!editingNtn) return;
    setSavingNtn(true);
    const res = await authedFetch("/api/admin/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        doc_id:       editingNtn.doc_id,
        location_id:  editingNtn.location_id,
        meter_label:  editingNtn.meter_label || "Meter 1",
        ntn_number:   editingNtn.ntn_number || null,
        status:       editingNtn.status,
        folderit_link: editingNtn.folderit_link || null,
      }),
    });
    const json = await res.json();
    setSavingNtn(false);
    if (json.ok) {
      showToast("Document updated", "success");
      setEditingNtn(null);
      loadNtnDocs();
    } else {
      showToast(json.error || "Failed to save", "error");
    }
  }

  async function saveLicence() {
    if (!editingLicence) return;
    setSavingLicence(true);
    const res = await authedFetch("/api/admin/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        doc_type:     "licence",
        location_id:  editingLicence.location_id,
        licence_type: editingLicence.licence_type,
        status:       editingLicence.status,
        expiry_date:  editingLicence.expiry_date || null,
        folderit_link: editingLicence.folderit_link || null,
      }),
    });
    const json = await res.json();
    setSavingLicence(false);
    if (json.ok) {
      showToast("Licence updated", "success");
      setEditingLicence(null);
      loadLicences();
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
      setNewLocation({
        name: "", entity: "IFPL", location_type: "retail", province: "",
        eobi_status: "Pending", ss_status: "Pending",
        civil_defence_status: "Pending", civil_defence_registered: "", civil_defence_due: "",
        labour_reg_status: "Pending", labour_insp_status: "Pending",
        ntn_number: "", meter_label: "",
      });
      loadRegistrations();
      loadCompliance();
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
    { id: "payments",      label: "Payments" },
    { id: "compliance",    label: "Compliance" },
    { id: "documents",     label: "Documents" },
    { id: "operations",    label: "Operations" },
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
                      {canManageLocations && (
                        <button onClick={() => removeLocation(r.location_id, r.name)}
                          style={{ fontSize: "11px", color: COLOURS.RED, background: "none", border: "none", cursor: "pointer", fontWeight: 500, marginLeft: "10px" }}>
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
            <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "white", borderRadius: RADII.CARD, padding: "24px", maxWidth: "560px", width: "100%", boxShadow: "0 20px 60px rgba(15,23,42,0.15)", maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "4px" }}>Add Location</div>
              <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "18px" }}>Creates the location and registers it across EOBI, Social Security, Civil Defence, and Labour in one step.</div>

              {/* Section: Basic Details */}
              <div style={{ fontSize: "10.5px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "10px" }}>Basic Details</div>
              <div style={{ display: "grid", gap: "12px", marginBottom: "18px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Location Name</label>
                  <input value={newLocation.name} onChange={(e) => setNewLocation({ ...newLocation, name: e.target.value })}
                    placeholder="e.g. Sukkur Branch"
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

              {/* Section: Registrations */}
              <div style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, paddingTop: "14px", marginBottom: "14px" }}>
                <div style={{ fontSize: "10.5px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "10px" }}>Registrations</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>EOBI Status</label>
                    <select value={newLocation.eobi_status} onChange={(e) => setNewLocation({ ...newLocation, eobi_status: e.target.value })}
                      style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Social Security Status</label>
                    <select value={newLocation.ss_status} onChange={(e) => setNewLocation({ ...newLocation, ss_status: e.target.value })}
                      style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Section: Civil Defence */}
              <div style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, paddingTop: "14px", marginBottom: "14px" }}>
                <div style={{ fontSize: "10.5px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "10px" }}>Civil Defence</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Status</label>
                    <select value={newLocation.civil_defence_status} onChange={(e) => setNewLocation({ ...newLocation, civil_defence_status: e.target.value })}
                      style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                      <option value="Pending">Pending</option>
                      <option value="Registered">Registered</option>
                      <option value="Overdue">Overdue</option>
                      <option value="N/A">N/A</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Registered</label>
                    <DateInput value={newLocation.civil_defence_registered} onChange={(e) => setNewLocation({ ...newLocation, civil_defence_registered: e.target.value })}
                      style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Renewal Due</label>
                    <DateInput value={newLocation.civil_defence_due} onChange={(e) => setNewLocation({ ...newLocation, civil_defence_due: e.target.value })}
                      style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                  </div>
                </div>
              </div>

              {/* Section: Labour */}
              <div style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, paddingTop: "14px", marginBottom: "14px" }}>
                <div style={{ fontSize: "10.5px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "10px" }}>Labour</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Labour Registration</label>
                    <select value={newLocation.labour_reg_status} onChange={(e) => setNewLocation({ ...newLocation, labour_reg_status: e.target.value })}
                      style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                      <option value="Pending">Pending</option>
                      <option value="Registered">Registered</option>
                      <option value="Overdue">Overdue</option>
                      <option value="N/A">N/A</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Labour Inspection</label>
                    <select value={newLocation.labour_insp_status} onChange={(e) => setNewLocation({ ...newLocation, labour_insp_status: e.target.value })}
                      style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                      <option value="Pending">Pending</option>
                      <option value="Done">Done</option>
                      <option value="Overdue">Overdue</option>
                      <option value="N/A">N/A</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Section: Documents (optional) */}
              <div style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, paddingTop: "14px", marginBottom: "18px" }}>
                <div style={{ fontSize: "10.5px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "10px" }}>NTN / Meter (optional)</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>NTN Number</label>
                    <input value={newLocation.ntn_number} onChange={(e) => setNewLocation({ ...newLocation, ntn_number: e.target.value })}
                      placeholder="e.g. 1234567-8"
                      style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Meter Label</label>
                    <input value={newLocation.meter_label} onChange={(e) => setNewLocation({ ...newLocation, meter_label: e.target.value })}
                      placeholder="e.g. Meter 1"
                      style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                  </div>
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

    // Helper: shows status badge + registered + due date, all clickable
    function ComplianceCell({ r, type }: {
      r: ComplianceRow;
      type: "Civil Defence" | "Labour Registration" | "Labour Inspection";
    }) {
      const vals = {
        "Civil Defence":       { status: r.civil_defence_status, registered: r.civil_defence_registered, due: r.civil_defence_due },
        "Labour Registration": { status: r.labour_reg_status,    registered: r.labour_reg_registered,    due: r.labour_reg_due },
        "Labour Inspection":   { status: r.labour_insp_status,   registered: r.labour_insp_registered,   due: r.labour_insp_due },
      }[type];

      const dueDate = vals.due;
      const isDueOverdue = dueDate && dueDate < today && vals.status !== "Done" && vals.status !== "Registered";
      const isDueSoon = dueDate && !isDueOverdue && dueDate <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

      return (
        <td
          onClick={() => openComplianceEdit(r, type)}
          title={`Click to edit ${type}`}
          style={{ padding: "10px 14px", cursor: "pointer", verticalAlign: "top" }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            <span style={statusBadge(vals.status)}>{vals.status || "Pending"}</span>
            {vals.registered && (
              <span style={{ fontSize: "10.5px", color: COLOURS.SLATE }}>
                Reg: {formatDateUK(vals.registered)}
              </span>
            )}
            {dueDate && (
              <span style={{
                fontSize: "10.5px",
                fontWeight: isDueOverdue ? 700 : 400,
                color: isDueOverdue ? COLOURS.RED : isDueSoon ? COLOURS.AMBER : COLOURS.SLATE,
              }}>
                Due: {formatDateUK(dueDate)}{isDueOverdue ? " ⚠" : isDueSoon ? " ↑" : ""}
              </span>
            )}
            {!vals.registered && !dueDate && (
              <span style={{ fontSize: "10.5px", color: COLOURS.SLATE, fontStyle: "italic" }}>No dates set</span>
            )}
          </div>
        </td>
      );
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
        <p style={{ fontSize: "11.5px", color: COLOURS.SLATE, marginBottom: "12px" }}>Click any cell to update its status, registered date, and renewal date.</p>
        {compliance.length === 0 ? (
          <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No compliance data on record yet.</p>
        ) : (
          <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", overflow: "hidden", backgroundColor: "white", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "680px" }}>
              <thead>
                <tr>
                  <th style={thStyle}>Location</th>
                  <th style={thStyle}>Entity</th>
                  <th style={thStyle}>Civil Defence</th>
                  <th style={thStyle}>Labour Reg.</th>
                  <th style={thStyle}>Labour Insp.</th>
                </tr>
              </thead>
              <tbody>
                {visibleCompliance.map((r) => (
                  <tr key={r.location_id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                    <td style={{ padding: "10px 14px", fontSize: "12.5px", color: COLOURS.NAVY, fontWeight: 500, verticalAlign: "top" }}>{r.name}</td>
                    <td style={{ padding: "10px 14px", fontSize: "11px", color: COLOURS.SLATE, whiteSpace: "nowrap", verticalAlign: "top" }}>{r.entity}</td>
                    {ComplianceCell({ r, type: "Civil Defence" })}
                    {ComplianceCell({ r, type: "Labour Registration" })}
                    {ComplianceCell({ r, type: "Labour Inspection" })}
                  </tr>
                ))}
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
                  <select value={editingCompliance.status} onChange={(e) => {
                    const newStatus = e.target.value;
                    const today = new Date().toISOString().slice(0, 10);
                    const nextYear = `${new Date().getFullYear() + 1}-${today.slice(5)}`;
                    const isRegistered = newStatus === "Registered" || newStatus === "Done";
                    setEditingCompliance({
                      ...editingCompliance,
                      status: newStatus,
                      last_renewed: isRegistered && !editingCompliance.last_renewed ? today : editingCompliance.last_renewed,
                      next_due:     isRegistered && !editingCompliance.next_due     ? nextYear : editingCompliance.next_due,
                    });
                  }} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                    {COMPLIANCE_STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                  {(editingCompliance.status === "Registered" || editingCompliance.status === "Done") && (
                    <p style={{ fontSize: "11px", color: COLOURS.GREEN, marginTop: "4px" }}>
                      ✓ Dates auto-filled below — adjust if needed.
                    </p>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>
                      {editingCompliance.compliance_type === "Labour Inspection" ? "Last Inspection" : "Date Registered"}
                    </label>
                    <DateInput value={editingCompliance.last_renewed} onChange={(e) => setEditingCompliance({ ...editingCompliance, last_renewed: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>
                      {editingCompliance.compliance_type === "Labour Inspection" ? "Next Inspection Due" : "Renewal Due"}
                    </label>
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

    const PAGE_SIZE = 20;

    const filtered = ntnDocs.filter((d) => {
      if (docSearch && !d.location_name.toLowerCase().includes(docSearch.toLowerCase())) return false;
      if (docStatusFilterUI && d.status !== docStatusFilterUI) return false;
      return true;
    });

    if (ntnDocs.length === 0) return <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No NTN documents on record yet.</p>;
    if (filtered.length === 0) return <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No NTN documents match your filters.</p>;

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const safePage = Math.min(ntnPage, totalPages - 1);
    const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

    const thStyle: React.CSSProperties = { padding: "9px 14px", textAlign: "left", fontSize: "10.5px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "#FAFBFC" };

    return (
      <>
        <p style={{ fontSize: "11.5px", color: COLOURS.SLATE, marginBottom: "12px" }}>Click any row to update the NTN number, status, or Folderit link.</p>
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", overflow: "hidden", backgroundColor: "white" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Location", "Meter", "NTN Number", "Status", "Folderit Link"].map((h) => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((d) => (
                <tr key={d.doc_id}
                  onClick={() => setEditingNtn({
                    doc_id: d.doc_id, location_id: d.location_id,
                    location_name: d.location_name,
                    meter_label: d.meter_label || "",
                    ntn_number: d.ntn_number || "",
                    status: d.status,
                    folderit_link: d.folderit_link || "",
                  })}
                  style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}`, cursor: "pointer" }}
                >
                  <td style={{ padding: "10px 14px", fontSize: "12.5px", color: COLOURS.NAVY, fontWeight: 500 }}>{d.location_name}</td>
                  <td style={{ padding: "10px 14px", fontSize: "11px", color: COLOURS.SLATE }}>{d.meter_label || "—"}</td>
                  <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: "11.5px", color: COLOURS.NAVY }}>{d.ntn_number || "—"}</td>
                  <td style={{ padding: "8px 14px" }}><StatusPill status={d.status} /></td>
                  <td style={{ padding: "8px 14px" }} onClick={(e) => e.stopPropagation()}>
                    {d.folderit_link
                      ? <a href={d.folderit_link} target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px", color: COLOURS.GREEN, textDecoration: "none", fontWeight: 500 }}>📄 Open in Folderit</a>
                      : <span style={{ fontSize: "11px", color: COLOURS.SLATE, fontStyle: "italic" }}>No link — click row to add</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination footer */}
          {totalPages > 1 && (
            <div style={{ padding: "10px 16px", borderTop: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11.5px", color: COLOURS.SLATE }}>
                Showing {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  onClick={() => setNtnPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  style={{ padding: "5px 12px", borderRadius: "6px", border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: safePage === 0 ? COLOURS.SLATE : COLOURS.NAVY, fontSize: "12px", fontWeight: 600, cursor: safePage === 0 ? "default" : "pointer", opacity: safePage === 0 ? 0.4 : 1 }}>
                  ← Prev
                </button>
                <span style={{ padding: "5px 10px", fontSize: "12px", color: COLOURS.SLATE }}>
                  Page {safePage + 1} of {totalPages}
                </span>
                <button
                  onClick={() => setNtnPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={safePage === totalPages - 1}
                  style={{ padding: "5px 12px", borderRadius: "6px", border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: safePage === totalPages - 1 ? COLOURS.SLATE : COLOURS.NAVY, fontSize: "12px", fontWeight: 600, cursor: safePage === totalPages - 1 ? "default" : "pointer", opacity: safePage === totalPages - 1 ? 0.4 : 1 }}>
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* NTN edit modal */}
        {editingNtn && (
          <div style={{ position: "fixed", inset: 0, zIndex: 9998, backgroundColor: "rgba(15,23,42,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
            onClick={() => setEditingNtn(null)}>
            <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "white", borderRadius: RADII.CARD, padding: "24px", maxWidth: "440px", width: "100%", boxShadow: "0 20px 60px rgba(15,23,42,0.15)" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "2px" }}>{editingNtn.location_name}</div>
              <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "16px" }}>NTN / WAPDA Document</div>
              <div style={{ display: "grid", gap: "12px", marginBottom: "16px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>NTN Number</label>
                    <input value={editingNtn.ntn_number} onChange={(e) => setEditingNtn({ ...editingNtn, ntn_number: e.target.value })}
                      placeholder="e.g. 1234567–8"
                      style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Meter Label</label>
                    <input value={editingNtn.meter_label} onChange={(e) => setEditingNtn({ ...editingNtn, meter_label: e.target.value })}
                      placeholder="e.g. Meter 1"
                      style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Status</label>
                  <select value={editingNtn.status} onChange={(e) => setEditingNtn({ ...editingNtn, status: e.target.value })}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                    <option value="Done">Done</option>
                    <option value="Pending">Pending</option>
                    <option value="N/A">N/A</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Folderit Link</label>
                  <input value={editingNtn.folderit_link} onChange={(e) => setEditingNtn({ ...editingNtn, folderit_link: e.target.value })}
                    placeholder="https://app.folderit.net/…"
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                  {editingNtn.folderit_link && (
                    <a href={editingNtn.folderit_link} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: "11px", color: COLOURS.GREEN, display: "block", marginTop: "4px" }}>
                      📄 Preview link
                    </a>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <button onClick={() => setEditingNtn(null)} style={{ padding: "8px 16px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 500, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.NAVY, cursor: "pointer" }}>Cancel</button>
                <button onClick={saveNtn} disabled={savingNtn} style={{ ...primaryButtonStyle, opacity: savingNtn ? 0.6 : 1 }}>
                  {savingNtn ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
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

    const today = new Date().toISOString().slice(0, 10);

    return (
      <>
        <p style={{ fontSize: "11.5px", color: COLOURS.SLATE, marginBottom: "12px" }}>Click any certificate cell to update its status and expiry date.</p>
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
                  <td style={{ padding: "10px 14px", fontSize: "12.5px", color: COLOURS.NAVY, fontWeight: 500, verticalAlign: "top" }}>{r.location_name}</td>
                  <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
                    <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 9px", borderRadius: "20px", backgroundColor: "rgba(15,23,32,.08)", color: COLOURS.NAVY }}>{r.entity}</span>
                  </td>
                  {LICENCE_COLS.map((col) => {
                    const status = r[`${col.key}_status` as keyof RestaurantLicence] as string | null;
                    const link   = r[`${col.key}_link`   as keyof RestaurantLicence] as string | null;
                    const expiry = r[`${col.key}_expiry`  as keyof RestaurantLicence] as string | null;
                    const isExpired = expiry && expiry < today && status !== "Done" && status !== "N/A";
                    const isSoon = expiry && !isExpired && expiry <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
                    return (
                      <td key={col.key}
                        onClick={() => setEditingLicence({
                          location_id: r.location_id, location_name: r.location_name,
                          licence_type: col.key, licence_label: col.label,
                          status: status || "Pending",
                          expiry_date: expiry || "",
                          folderit_link: link || "",
                        })}
                        title={`Click to edit ${col.label}`}
                        style={{ padding: "10px 14px", cursor: "pointer", verticalAlign: "top" }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                          <StatusPill status={status} />
                          {expiry ? (
                            <span style={{
                              fontSize: "10.5px",
                              fontWeight: isExpired ? 700 : 400,
                              color: isExpired ? COLOURS.RED : isSoon ? COLOURS.AMBER : COLOURS.SLATE,
                            }}>
                              Expires: {formatDateUK(expiry)}{isExpired ? " ⚠" : isSoon ? " ↑" : ""}
                            </span>
                          ) : (
                            <span style={{ fontSize: "10.5px", color: COLOURS.SLATE, fontStyle: "italic" }}>No expiry set</span>
                          )}
                          {link && <a href={link} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontSize: "10.5px", color: COLOURS.GREEN }}>📄 View</a>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Licence edit modal */}
        {editingLicence && (
          <div style={{ position: "fixed", inset: 0, zIndex: 9998, backgroundColor: "rgba(15,23,42,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
            onClick={() => setEditingLicence(null)}>
            <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "white", borderRadius: RADII.CARD, padding: "24px", maxWidth: "420px", width: "100%", boxShadow: "0 20px 60px rgba(15,23,42,0.15)" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "2px" }}>{editingLicence.location_name}</div>
              <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "16px" }}>{editingLicence.licence_label}</div>
              <div style={{ display: "grid", gap: "12px", marginBottom: "16px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Status</label>
                  <select value={editingLicence.status} onChange={(e) => {
                    const newStatus = e.target.value;
                    const nextYear = `${new Date().getFullYear() + 1}-${new Date().toISOString().slice(5, 10)}`;
                    const isDone = newStatus === "Done" || newStatus === "Registered";
                    setEditingLicence({
                      ...editingLicence,
                      status: newStatus,
                      expiry_date: isDone && !editingLicence.expiry_date ? nextYear : editingLicence.expiry_date,
                    });
                  }} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                    <option value="Done">Done</option>
                    <option value="Pending">Pending</option>
                    <option value="Inprocess">Inprocess</option>
                    <option value="Overdue">Overdue</option>
                    <option value="N/A">N/A</option>
                  </select>
                  {(editingLicence.status === "Done" || editingLicence.status === "Registered") && (
                    <p style={{ fontSize: "11px", color: COLOURS.GREEN, marginTop: "4px" }}>
                      ✓ Set the expiry date below — auto-suggested to one year from today.
                    </p>
                  )}
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Expiry / Renewal Date</label>
                  <DateInput value={editingLicence.expiry_date} onChange={(e) => setEditingLicence({ ...editingLicence, expiry_date: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Folderit Link (optional)</label>
                  <input value={editingLicence.folderit_link} onChange={(e) => setEditingLicence({ ...editingLicence, folderit_link: e.target.value })}
                    placeholder="https://…"
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <button onClick={() => setEditingLicence(null)} style={{ padding: "8px 16px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 500, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.NAVY, cursor: "pointer" }}>Cancel</button>
                <button onClick={saveLicence} disabled={savingLicence} style={{ ...primaryButtonStyle, opacity: savingLicence ? 0.6 : 1 }}>
                  {savingLicence ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // ── Manage Fleet handlers ──────────────────────────────────────────
  async function openManageFleet() {
    const res = await authedFetch("/api/admin/vehicles");
    const json = await res.json();
    setAllVehicles(json.data || []);
    setVehicleForm(null);
    setManageFleet(true);
  }

  async function saveVehicle() {
    if (!vehicleForm || !vehicleForm.name.trim() || !vehicleForm.plate_number.trim()) return;
    setSavingVehicle(true);
    const res = await authedFetch("/api/admin/vehicles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(vehicleForm),
    });
    const json = await res.json();
    setSavingVehicle(false);
    if (json.ok) {
      showToast(vehicleForm.id ? "Vehicle updated ✓" : "Vehicle added ✓", "success");
      setVehicleForm(null);
      // Refresh list + reload ops data so it appears immediately
      const r = await authedFetch("/api/admin/vehicles");
      setAllVehicles((await r.json()).data || []);
      loadFuel();
    } else {
      showToast(json.error || "Failed to save", "error");
    }
  }

  // ── Manage Solar Sites handlers ────────────────────────────────────
  async function openManageSolar() {
    const res = await authedFetch("/api/admin/solar-branches");
    const json = await res.json();
    setAllSolarBranches(json.data || []);
    setSolarForm(null);
    setManageSolar(true);
  }

  async function saveSolarBranch() {
    if (!solarForm || !solarForm.name.trim()) return;
    setSavingSolar(true);
    const res = await authedFetch("/api/admin/solar-branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(solarForm),
    });
    const json = await res.json();
    setSavingSolar(false);
    if (json.ok) {
      showToast(solarForm.id ? "Site updated ✓" : "Site added ✓", "success");
      setSolarForm(null);
      const r = await authedFetch("/api/admin/solar-branches");
      setAllSolarBranches((await r.json()).data || []);
      loadSolar();
    } else {
      showToast(json.error || "Failed to save", "error");
    }
  }

  // ── Manage Utility Sites handlers ──────────────────────────────────
  async function openManageUtility() {
    const res = await authedFetch("/api/admin/locations");
    const json = await res.json();
    setAllLocations(json.data || []);
    setLocationForm(null);
    setManageUtility(true);
  }

  async function saveLocation() {
    if (!locationForm || !locationForm.name.trim() || !locationForm.entity || !locationForm.location_type) return;
    setSavingUtilityLoc(true);
    if (locationForm.id) {
      // Edit existing
      const res = await authedFetch("/api/admin/locations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: locationForm.id, name: locationForm.name, entity: locationForm.entity, location_type: locationForm.location_type, province: locationForm.province, is_active: locationForm.is_active, default_disco: locationForm.default_disco }),
      });
      const json = await res.json();
      setSavingUtilityLoc(false);
      if (json.ok) {
        showToast("Site updated ✓", "success");
        setLocationForm(null);
        const r = await authedFetch("/api/admin/locations");
        setAllLocations((await r.json()).data || []);
        loadUtility();
      } else {
        showToast(json.error || "Failed to save", "error");
      }
    } else {
      // Create new (uses the full RPC which creates compliance records too)
      const res = await authedFetch("/api/admin/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: locationForm.name, entity: locationForm.entity, location_type: locationForm.location_type, province: locationForm.province, default_disco: locationForm.default_disco }),
      });
      const json = await res.json();
      setSavingUtilityLoc(false);
      if (json.ok) {
        showToast("Site added ✓", "success");
        setLocationForm(null);
        const r = await authedFetch("/api/admin/locations");
        setAllLocations((await r.json()).data || []);
        loadUtility();
      } else {
        showToast(json.error || "Failed to save", "error");
      }
    }
  }

  // ── Manage modals render ───────────────────────────────────────────
  function renderManageFleet() {
    if (!manageFleet) return null;
    const mgmtInput: React.CSSProperties = { ...inputStyle, width: "100%", boxSizing: "border-box" as const, fontSize: "13px" };
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9998, backgroundColor: "rgba(15,23,42,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
        onClick={() => { setManageFleet(false); setVehicleForm(null); }}>
        <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "white", borderRadius: "12px", padding: "24px", maxWidth: "540px", width: "100%", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(15,23,42,0.15)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>⛽ Manage Fleet</div>
            <button onClick={() => { setManageFleet(false); setVehicleForm(null); }}
              style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer", color: COLOURS.SLATE }}>✕</button>
          </div>

          {/* Vehicle list */}
          {allVehicles.length > 0 && (
            <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", overflow: "hidden", marginBottom: "16px" }}>
              {allVehicles.map((v, i) => (
                <div key={v.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", borderBottom: i < allVehicles.length - 1 ? `1px solid ${COLOURS.HAIRLINE}` : "none", backgroundColor: vehicleForm?.id === v.id ? "#F0F4FF" : "white" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: v.is_active ? COLOURS.NAVY : COLOURS.SLATE }}>{v.name}</div>
                    <div style={{ fontSize: "11px", color: COLOURS.SLATE, fontFamily: "monospace" }}>{v.plate_number}</div>
                  </div>
                  <span style={{ fontSize: "10.5px", fontWeight: 600, padding: "2px 8px", borderRadius: "20px", backgroundColor: v.is_active ? "#DCFCE7" : COLOURS.HAIRLINE, color: v.is_active ? COLOURS.GREEN : COLOURS.SLATE }}>{v.is_active ? "Active" : "Inactive"}</span>
                  <div style={{ fontSize: "10.5px", color: COLOURS.SLATE, fontFamily: "monospace" }}>{v.odometer_unit ?? "km"}</div>
                  <button onClick={() => setVehicleForm({ id: v.id, name: v.name, plate_number: v.plate_number, is_active: v.is_active, odometer_unit: v.odometer_unit ?? "km" })}
                    style={{ fontSize: "11.5px", fontWeight: 600, padding: "4px 10px", borderRadius: "6px", border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.NAVY, cursor: "pointer" }}>Edit</button>
                </div>
              ))}
            </div>
          )}

          {/* Add / Edit form */}
          {vehicleForm ? (
            <div style={{ border: `1px solid ${COLOURS.NAVY}`, borderRadius: "8px", padding: "16px", backgroundColor: "#F8F9FC" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "12px" }}>{vehicleForm.id ? "Edit Vehicle" : "Add New Vehicle"}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                <div>
                  <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Vehicle Name *</label>
                  <input type="text" placeholder="e.g. Honda City" value={vehicleForm.name}
                    onChange={(e) => setVehicleForm((f) => f ? { ...f, name: e.target.value } : f)}
                    style={mgmtInput} />
                </div>
                <div>
                  <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Plate Number *</label>
                  <input type="text" placeholder="e.g. LHR-1234" value={vehicleForm.plate_number}
                    onChange={(e) => setVehicleForm((f) => f ? { ...f, plate_number: e.target.value } : f)}
                    style={{ ...mgmtInput, fontFamily: "monospace", textTransform: "uppercase" }} />
                </div>
                <div>
                  <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>ODO Unit *</label>
                  <select value={vehicleForm.odometer_unit ?? "km"}
                    onChange={(e) => setVehicleForm((f) => f ? { ...f, odometer_unit: e.target.value } : f)}
                    style={mgmtInput}>
                    <option value="km">km</option>
                    <option value="miles">miles</option>
                  </select>
                </div>
              </div>
              {vehicleForm.id && (
                <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: COLOURS.SLATE, marginBottom: "12px", cursor: "pointer" }}>
                  <input type="checkbox" checked={vehicleForm.is_active}
                    onChange={(e) => setVehicleForm((f) => f ? { ...f, is_active: e.target.checked } : f)} />
                  Active (shows in daily entry + ops)
                </label>
              )}
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={saveVehicle} disabled={savingVehicle}
                  style={{ ...primaryButtonStyle, padding: "8px 18px", fontSize: "13px", opacity: savingVehicle ? 0.6 : 1 }}>
                  {savingVehicle ? "Saving…" : vehicleForm.id ? "Save Changes" : "Add Vehicle"}
                </button>
                <button onClick={() => setVehicleForm(null)}
                  style={{ padding: "8px 14px", borderRadius: RADII.SM, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", fontSize: "13px", cursor: "pointer", color: COLOURS.SLATE }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setVehicleForm({ name: "", plate_number: "", is_active: true, odometer_unit: "km" })}
              style={{ ...primaryButtonStyle, width: "100%", padding: "10px", fontSize: "13px" }}>+ Add New Vehicle</button>
          )}
        </div>
      </div>
    );
  }

  function renderManageSolar() {
    if (!manageSolar) return null;
    const mgmtInput: React.CSSProperties = { ...inputStyle, width: "100%", boxSizing: "border-box" as const, fontSize: "13px" };
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9998, backgroundColor: "rgba(15,23,42,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
        onClick={() => { setManageSolar(false); setSolarForm(null); }}>
        <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "white", borderRadius: "12px", padding: "24px", maxWidth: "500px", width: "100%", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(15,23,42,0.15)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>☀️ Manage Solar Sites</div>
            <button onClick={() => { setManageSolar(false); setSolarForm(null); }}
              style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer", color: COLOURS.SLATE }}>✕</button>
          </div>

          {/* Site list */}
          {allSolarBranches.length > 0 && (
            <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", overflow: "hidden", marginBottom: "16px" }}>
              {allSolarBranches.map((b, i) => (
                <div key={b.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", borderBottom: i < allSolarBranches.length - 1 ? `1px solid ${COLOURS.HAIRLINE}` : "none", backgroundColor: solarForm?.id === b.id ? "#F0F4FF" : "white" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: b.is_active ? COLOURS.NAVY : COLOURS.SLATE }}>{b.name}</div>
                    {b.system_kw && <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>{b.system_kw} kW system</div>}
                  </div>
                  <span style={{ fontSize: "10.5px", fontWeight: 600, padding: "2px 8px", borderRadius: "20px", backgroundColor: b.is_active ? "#DCFCE7" : COLOURS.HAIRLINE, color: b.is_active ? COLOURS.GREEN : COLOURS.SLATE }}>{b.is_active ? "Active" : "Inactive"}</span>
                  <button onClick={() => setSolarForm({ id: b.id, name: b.name, system_kw: b.system_kw != null ? String(b.system_kw) : "", is_active: b.is_active })}
                    style={{ fontSize: "11.5px", fontWeight: 600, padding: "4px 10px", borderRadius: "6px", border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.NAVY, cursor: "pointer" }}>Edit</button>
                </div>
              ))}
            </div>
          )}

          {/* Add / Edit form */}
          {solarForm ? (
            <div style={{ border: `1px solid ${COLOURS.NAVY}`, borderRadius: "8px", padding: "16px", backgroundColor: "#F8F9FC" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "12px" }}>{solarForm.id ? "Edit Site" : "Add New Solar Site"}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                <div>
                  <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Site Name *</label>
                  <input type="text" placeholder="e.g. Head Office" value={solarForm.name}
                    onChange={(e) => setSolarForm((f) => f ? { ...f, name: e.target.value } : f)}
                    style={mgmtInput} />
                </div>
                <div>
                  <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>System kW (optional)</label>
                  <input type="number" step="0.5" min="0" placeholder="e.g. 40" value={solarForm.system_kw}
                    onChange={(e) => setSolarForm((f) => f ? { ...f, system_kw: e.target.value } : f)}
                    style={mgmtInput} />
                </div>
              </div>
              {solarForm.id && (
                <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: COLOURS.SLATE, marginBottom: "12px", cursor: "pointer" }}>
                  <input type="checkbox" checked={solarForm.is_active}
                    onChange={(e) => setSolarForm((f) => f ? { ...f, is_active: e.target.checked } : f)} />
                  Active (shows in daily entry + ops)
                </label>
              )}
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={saveSolarBranch} disabled={savingSolar}
                  style={{ ...primaryButtonStyle, padding: "8px 18px", fontSize: "13px", opacity: savingSolar ? 0.6 : 1 }}>
                  {savingSolar ? "Saving…" : solarForm.id ? "Save Changes" : "Add Site"}
                </button>
                <button onClick={() => setSolarForm(null)}
                  style={{ padding: "8px 14px", borderRadius: RADII.SM, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", fontSize: "13px", cursor: "pointer", color: COLOURS.SLATE }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setSolarForm({ name: "", system_kw: "", is_active: true })}
              style={{ ...primaryButtonStyle, width: "100%", padding: "10px", fontSize: "13px" }}>+ Add New Solar Site</button>
          )}
        </div>
      </div>
    );
  }

  // ── Manage Utility Sites modal render ──────────────────────────────
  function renderManageUtility() {
    if (!manageUtility) return null;
    const mgmtInput: React.CSSProperties = { ...inputStyle, width: "100%", boxSizing: "border-box" as const, fontSize: "13px" };
    const ENTITIES = [
      { value: "IFPL",   label: "IFPL — Imperial Footwear" },
      { value: "UTPL",   label: "UTPL — Unze Trading" },
      { value: "HD",     label: "HD — Haute Dolci" },
      { value: "Baranh", label: "Baranh — Bahrain" },
    ];
    const LOC_TYPES = ["retail", "restaurant", "plant", "warehouse", "office"];
    const PROVINCES = ["Punjab", "Sindh", "KPK", "Islamabad", "Balochistan"];
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9998, backgroundColor: "rgba(15,23,42,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
        onClick={() => { setManageUtility(false); setLocationForm(null); }}>
        <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "white", borderRadius: "12px", padding: "24px", maxWidth: "600px", width: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(15,23,42,0.15)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>⚡ Manage Sites</div>
            <button onClick={() => { setManageUtility(false); setLocationForm(null); }}
              style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer", color: COLOURS.SLATE }}>✕</button>
          </div>

          {/* Location list */}
          {allLocations.length > 0 && (
            <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", overflow: "hidden", marginBottom: "16px" }}>
              {allLocations.map((loc, i) => (
                <div key={loc.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", borderBottom: i < allLocations.length - 1 ? `1px solid ${COLOURS.HAIRLINE}` : "none", backgroundColor: locationForm?.id === loc.id ? "#F0F4FF" : "white" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: loc.is_active ? COLOURS.NAVY : COLOURS.SLATE }}>{loc.name}</div>
                    <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>{ENTITIES.find((e) => e.value === loc.entity)?.label ?? loc.entity} · {loc.location_type}</div>
                  </div>
                  {loc.default_disco && <span style={{ fontSize: "10.5px", fontWeight: 600, color: COLOURS.SLATE }}>{loc.default_disco}</span>}
                  <span style={{ fontSize: "10.5px", fontWeight: 600, padding: "2px 8px", borderRadius: "20px", backgroundColor: loc.is_active ? "#DCFCE7" : COLOURS.HAIRLINE, color: loc.is_active ? COLOURS.GREEN : COLOURS.SLATE }}>{loc.is_active ? "Active" : "Inactive"}</span>
                  <button onClick={() => setLocationForm({ id: loc.id, name: loc.name, entity: loc.entity, location_type: loc.location_type, province: loc.province || "", is_active: loc.is_active, default_disco: loc.default_disco || "" })}
                    style={{ fontSize: "11.5px", fontWeight: 600, padding: "4px 10px", borderRadius: "6px", border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.NAVY, cursor: "pointer" }}>Edit</button>
                </div>
              ))}
            </div>
          )}

          {/* Add / Edit form */}
          {locationForm ? (
            <div style={{ border: `1px solid ${COLOURS.NAVY}`, borderRadius: "8px", padding: "16px", backgroundColor: "#F8F9FC" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "12px" }}>{locationForm.id ? "Edit Site" : "Add New Site"}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Site Name *</label>
                  <input type="text" placeholder="e.g. DHA Branch" value={locationForm.name}
                    onChange={(e) => setLocationForm((f) => f ? { ...f, name: e.target.value } : f)}
                    style={mgmtInput} />
                </div>
                <div>
                  <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Company *</label>
                  <select value={locationForm.entity}
                    onChange={(e) => setLocationForm((f) => f ? { ...f, entity: e.target.value } : f)}
                    style={mgmtInput}>
                    <option value="">Select…</option>
                    {ENTITIES.map((en) => <option key={en.value} value={en.value}>{en.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Type *</label>
                  <select value={locationForm.location_type}
                    onChange={(e) => setLocationForm((f) => f ? { ...f, location_type: e.target.value } : f)}
                    style={mgmtInput}>
                    <option value="">Select…</option>
                    {LOC_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Province</label>
                  <select value={locationForm.province}
                    onChange={(e) => setLocationForm((f) => f ? { ...f, province: e.target.value } : f)}
                    style={mgmtInput}>
                    <option value="">Select…</option>
                    {PROVINCES.map((p) => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>DISCO (electricity supplier)</label>
                  <select value={locationForm.default_disco}
                    onChange={(e) => setLocationForm((f) => f ? { ...f, default_disco: e.target.value } : f)}
                    style={mgmtInput}>
                    <option value="">None / unknown</option>
                    {["LESCO", "MEPCO", "FESCO", "PESCO", "HESCO", "IESCO", "SSGC", "SNGPL", "Other"].map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                </div>
              </div>
              {locationForm.id && (
                <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: COLOURS.SLATE, marginBottom: "12px", cursor: "pointer" }}>
                  <input type="checkbox" checked={locationForm.is_active}
                    onChange={(e) => setLocationForm((f) => f ? { ...f, is_active: e.target.checked } : f)} />
                  Active (shows in daily entry + ops)
                </label>
              )}
              {!locationForm.id && (
                <p style={{ fontSize: "11.5px", color: COLOURS.SLATE, margin: "0 0 12px" }}>
                  Adding a new site also creates its EOBI &amp; compliance records automatically.
                </p>
              )}
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={saveLocation} disabled={savingUtilityLoc}
                  style={{ ...primaryButtonStyle, padding: "8px 18px", fontSize: "13px", opacity: savingUtilityLoc ? 0.6 : 1 }}>
                  {savingUtilityLoc ? "Saving…" : locationForm.id ? "Save Changes" : "Add Site"}
                </button>
                <button onClick={() => setLocationForm(null)}
                  style={{ padding: "8px 14px", borderRadius: RADII.SM, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", fontSize: "13px", cursor: "pointer", color: COLOURS.SLATE }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setLocationForm({ name: "", entity: "", location_type: "retail", province: "Punjab", is_active: true, default_disco: "" })}
              style={{ ...primaryButtonStyle, width: "100%", padding: "10px", fontSize: "13px" }}>+ Add New Site</button>
          )}
        </div>
      </div>
    );
  }

  // ── Tab: Operations ────────────────────────────────────────────────
  function renderFuel() {
    if (loadingFuel) return <SkeletonRows count={4} height="44px" />;
    // After migration 158, fuelRows contains ALL active vehicles for every month.
    // Before migration (INNER JOIN), vehicles with no entries won't appear at all —
    // so we fall back to an empty message only when the array itself is empty.
    const monthRows = fuelRows.filter((r) => r.month === opsMonth);
    if (fuelRows.length === 0) return <p style={{ color: COLOURS.SLATE, fontSize: "14px" }}>No vehicles configured yet. Add vehicles in the database to see them here.</p>;

    const withData = monthRows.filter((r) => r.total_amount > 0 || r.fills > 0);
    const totalAmt  = withData.reduce((s, r) => s + r.total_amount, 0);
    const totalLit  = withData.reduce((s, r) => s + r.total_litres, 0);
    // Weighted avg km/L across vehicles with data
    const avgKmL    = totalLit > 0
      ? withData.reduce((s, r) => s + (r.avg_km_per_l || 0) * r.total_litres, 0) / totalLit
      : null;
    const avgPriceL = totalLit > 0 ? totalAmt / totalLit : null;
    const fmtPKR = (n: number) => n >= 100000 ? `PKR ${(n / 1000).toFixed(0)}K` : n > 0 ? `PKR ${n.toLocaleString()}` : "—";

    const statCards = [
      { label: "Fuel spend", value: fmtPKR(totalAmt), color: COLOURS.NAVY },
      { label: "Litres fuelled", value: totalLit > 0 ? `${totalLit.toFixed(0)} L` : "—", color: COLOURS.NAVY },
      { label: "Avg km / litre", value: avgKmL ? `${avgKmL.toFixed(1)}` : "—", color: COLOURS.GREEN },
      { label: "Avg price / litre", value: avgPriceL ? `PKR ${avgPriceL.toFixed(0)}` : "—", color: COLOURS.NAVY },
      { label: "Vehicles", value: String(monthRows.length), color: COLOURS.NAVY },
      { label: "No data yet", value: String(monthRows.length - withData.length), color: monthRows.length - withData.length > 0 ? COLOURS.AMBER : COLOURS.GREEN },
    ];

    return (
      <div>
        {/* Fuel stat row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "10px", marginBottom: "14px" }}>
          {statCards.map((c) => (
            <div key={c.label} style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", padding: "14px 18px", backgroundColor: "white" }}>
              <div style={{ fontSize: "20px", fontWeight: 700, color: c.color, lineHeight: 1.1 }}>{c.value}</div>
              <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "3px", fontWeight: 500 }}>{c.label}</div>
            </div>
          ))}
        </div>

        {/* Vehicle cards grid — ALL vehicles always shown; click to open detail panel */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "10px" }}>
          {monthRows.map((r) => {
            const hasData = r.fills > 0 || r.total_amount > 0;
            const isSelected = vehiclePanel?.vehicleId === r.vehicle_id;
            return (
              <div key={r.vehicle_id}
                onClick={() => {
                  setVehiclePanel({ vehicleId: r.vehicle_id, vehicleName: r.vehicle_name, plateNumber: r.plate_number });
                  setVehicleDetailYear(opsYear);
                  setVehicleDetailTab("fuel");
                  loadVehicleDetail(r.vehicle_id, opsYear);
                }}
                style={{
                  backgroundColor: "white",
                  border: `1.5px solid ${isSelected ? COLOURS.NAVY : hasData ? COLOURS.HAIRLINE : "#E5E7EB"}`,
                  borderRadius: "10px", padding: "14px 16px",
                  opacity: hasData ? 1 : 0.75,
                  cursor: "pointer",
                  transition: "box-shadow 0.15s, border-color 0.15s",
                  boxShadow: isSelected ? `0 0 0 3px rgba(15,23,32,0.08)` : undefined,
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY }}>{r.vehicle_name}</div>
                    <div style={{ fontSize: "11px", color: COLOURS.SLATE, fontFamily: "monospace", marginTop: "2px" }}>{r.plate_number || "—"}</div>
                  </div>
                  {hasData
                    ? <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 9px", borderRadius: "20px", backgroundColor: "#ECFDF5", color: COLOURS.GREEN, whiteSpace: "nowrap" }}>Active</span>
                    : <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 9px", borderRadius: "20px", backgroundColor: COLOURS.HAIRLINE, color: COLOURS.SLATE, whiteSpace: "nowrap" }}>No entry</span>
                  }
                </div>
                <div style={{ display: "flex" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "16px", fontWeight: 700, color: hasData ? COLOURS.NAVY : COLOURS.SLATE }}>
                      {hasData ? `PKR ${r.total_amount.toLocaleString()}` : "—"}
                    </div>
                    <div style={{ fontSize: "10.5px", color: COLOURS.SLATE, marginTop: "2px" }}>Fuel spend</div>
                  </div>
                  <div style={{ width: "1px", backgroundColor: COLOURS.HAIRLINE, margin: "0 12px" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "16px", fontWeight: 700, color: hasData ? COLOURS.NAVY : COLOURS.SLATE }}>
                      {r.avg_km_per_l ? `${r.avg_km_per_l} km/L` : "—"}
                    </div>
                    <div style={{ fontSize: "10.5px", color: COLOURS.SLATE, marginTop: "2px" }}>Efficiency</div>
                  </div>
                </div>
                <div style={{ fontSize: "10.5px", color: COLOURS.SLATE, marginTop: "10px", borderTop: `1px solid ${COLOURS.HAIRLINE}`, paddingTop: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{hasData ? `${r.fills} fill${r.fills !== 1 ? "s" : ""} · ${r.total_litres.toFixed(1)} L` : `No fuel entries for ${MONTH_NAMES[opsMonth - 1]}`}</span>
                  <span style={{ fontSize: "10px", color: COLOURS.SLATE, opacity: 0.6 }}>View →</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderSolar() {
    if (loadingSolar) return <SkeletonRows count={4} height="44px" />;
    if (solarBranches.length === 0) return <p style={{ color: COLOURS.SLATE, fontSize: "14px" }}>No solar branches configured yet.</p>;

    const now = new Date();
    // opsYear is FY start year; derive actual calendar year for the displayed month
    const opsCalYear = opsMonth >= 7 ? opsYear : opsYear + 1;
    const isCurrentOrPast = opsCalYear < now.getFullYear() || (opsCalYear === now.getFullYear() && opsMonth <= now.getMonth() + 1);

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

        {/* Solar cards grid — per-site production + estimated savings */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "10px" }}>
          {branchData.map((b) => {
            const kwh     = b.monthData?.total_kwh;
            const noData  = isCurrentOrPast && (kwh == null || kwh === 0);
            const savings = kwh ? kwh * 40 : 0;
            return (
              <div key={b.branch_id} style={{ backgroundColor: "white", border: `1px solid ${noData ? COLOURS.RED : COLOURS.HAIRLINE}`, borderRadius: "10px", padding: "14px 16px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.NAVY, textTransform: "uppercase" as const, letterSpacing: "0.4px" }}>{b.branch_name}</div>
                <div style={{ fontSize: "10.5px", color: COLOURS.SLATE, marginBottom: "8px" }}>{b.system_kw ? `${b.system_kw} kW system` : "—"}</div>

                {/* Production */}
                <div style={{ fontSize: "22px", fontWeight: 700, color: kwh ? COLOURS.NAVY : COLOURS.SLATE }}>
                  {kwh != null ? Math.round(kwh) : "—"}
                  {kwh != null && <span style={{ fontSize: "11.5px", color: COLOURS.SLATE, fontWeight: 400, marginLeft: "2px" }}>kWh</span>}
                </div>

                {/* Savings estimate */}
                {savings > 0 && (
                  <div style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.GREEN, marginTop: "3px" }}>
                    ≈ PKR {savings >= 100000 ? `${(savings / 1000).toFixed(0)}K` : savings.toLocaleString()} saved
                  </div>
                )}

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

  // ── Vehicle detail side panel ─────────────────────────────────────────
  function renderVehiclePanel() {
    if (!vehiclePanel) return null;
    const { vehicleName, plateNumber } = vehiclePanel;
    const fuel = vehicleDetail?.fuel || [];
    const maintenance = vehicleDetail?.maintenance || [];

    const totalFuelCost  = fuel.reduce((s, f) => s + (f.amount_pkr || 0), 0);
    const totalMaintCost = maintenance.reduce((s, m) => s + (m.cost_pkr || 0), 0);
    const totalRunning   = totalFuelCost + totalMaintCost;
    const totalLitres    = fuel.reduce((s, f) => s + f.quantity_litres, 0);
    const totalKm        = fuel.reduce((s, f) => s + (f.mileage_km || 0), 0);
    const fmtPKR = (n: number) => `PKR ${Math.round(n).toLocaleString()}`;

    // Group by month for summary tab
    const fuelByMonth: Record<number, { fills: number; amount: number; litres: number }> = {};
    fuel.forEach((f) => {
      const mo = parseInt(f.date.split("-")[1], 10);
      if (!fuelByMonth[mo]) fuelByMonth[mo] = { fills: 0, amount: 0, litres: 0 };
      fuelByMonth[mo].fills++;
      fuelByMonth[mo].amount += f.amount_pkr || 0;
      fuelByMonth[mo].litres += f.quantity_litres;
    });
    const maintByMonth: Record<number, { count: number; cost: number }> = {};
    maintenance.forEach((m) => {
      const mo = parseInt(m.date.split("-")[1], 10);
      if (!maintByMonth[mo]) maintByMonth[mo] = { count: 0, cost: 0 };
      maintByMonth[mo].count++;
      maintByMonth[mo].cost += m.cost_pkr || 0;
    });

    const thS: React.CSSProperties = { padding: "8px 12px", textAlign: "left", fontSize: "10.5px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase" as const, letterSpacing: "0.05em", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "#FAFBFC", whiteSpace: "nowrap" as const };
    const tdS: React.CSSProperties = { padding: "8px 12px", fontSize: "12px", color: COLOURS.NAVY, borderBottom: `1px solid ${COLOURS.HAIRLINE}` };
    const thR: React.CSSProperties = { ...thS, textAlign: "right" as const };
    const tdR: React.CSSProperties = { ...tdS, textAlign: "right" as const };

    return (
      <>
        {/* Backdrop */}
        <div onClick={() => setVehiclePanel(null)} style={{ position: "fixed", inset: 0, zIndex: 9990, backgroundColor: "rgba(15,23,42,0.35)" }} />
        {/* Panel */}
        <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 9991, width: "min(720px, 100vw)", backgroundColor: "white", boxShadow: "-4px 0 30px rgba(15,23,42,0.15)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Header */}
          <div style={{ padding: "18px 20px 14px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: "17px", fontWeight: 800, color: COLOURS.NAVY }}>{vehicleName}</div>
                <div style={{ fontSize: "12px", color: COLOURS.SLATE, fontFamily: "monospace", marginTop: "2px" }}>{plateNumber}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button onClick={() => { const y = vehicleDetailYear - 1; setVehicleDetailYear(y); loadVehicleDetail(vehiclePanel.vehicleId, y); }}
                  style={{ width: "26px", height: "26px", borderRadius: "6px", border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", cursor: "pointer", fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
                <span style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY, minWidth: "80px", textAlign: "center" }}>{fyLabel(vehicleDetailYear)}</span>
                <button onClick={() => { const y = vehicleDetailYear + 1; setVehicleDetailYear(y); loadVehicleDetail(vehiclePanel.vehicleId, y); }}
                  disabled={vehicleDetailYear >= CURRENT_FY_START}
                  style={{ width: "26px", height: "26px", borderRadius: "6px", border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", cursor: vehicleDetailYear >= CURRENT_FY_START ? "default" : "pointer", fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "center", opacity: vehicleDetailYear >= CURRENT_FY_START ? 0.4 : 1 }}>›</button>
                <button onClick={() => setVehiclePanel(null)}
                  style={{ marginLeft: "4px", width: "30px", height: "30px", borderRadius: "8px", border: "none", backgroundColor: COLOURS.HAIRLINE, cursor: "pointer", fontSize: "16px", color: COLOURS.SLATE, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
              </div>
            </div>
            {/* YTD summary chips */}
            {!loadingVehicleDetail && (
              <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "12px", fontWeight: 600, padding: "3px 11px", borderRadius: "20px", backgroundColor: "#EFF6FF", color: "#1D4ED8" }}>⛽ {fmtPKR(totalFuelCost)} fuel</span>
                <span style={{ fontSize: "12px", fontWeight: 600, padding: "3px 11px", borderRadius: "20px", backgroundColor: "#FFF7ED", color: "#9A3412" }}>🔧 {fmtPKR(totalMaintCost)} maint.</span>
                <span style={{ fontSize: "12px", fontWeight: 600, padding: "3px 11px", borderRadius: "20px", backgroundColor: "#F0FDF4", color: COLOURS.GREEN }}>Total {fmtPKR(totalRunning)}</span>
                {totalLitres > 0 && <span style={{ fontSize: "12px", fontWeight: 600, padding: "3px 11px", borderRadius: "20px", backgroundColor: COLOURS.HAIRLINE, color: COLOURS.SLATE }}>{totalLitres.toFixed(0)} L</span>}
                {totalLitres > 0 && totalKm > 0 && <span style={{ fontSize: "12px", fontWeight: 600, padding: "3px 11px", borderRadius: "20px", backgroundColor: COLOURS.HAIRLINE, color: COLOURS.SLATE }}>{(totalKm / totalLitres).toFixed(1)} km/L avg</span>}
              </div>
            )}
            {/* Tabs */}
            <div style={{ display: "flex", gap: "4px", marginTop: "12px" }}>
              {(["fuel", "maintenance", "summary"] as const).map((t) => (
                <button key={t} onClick={() => setVehicleDetailTab(t)} style={{ padding: "5px 14px", borderRadius: "20px", border: "none", fontSize: "12px", fontWeight: 600, cursor: "pointer", backgroundColor: vehicleDetailTab === t ? COLOURS.NAVY : "transparent", color: vehicleDetailTab === t ? "white" : COLOURS.SLATE }}>
                  {t === "fuel" ? `Fuel Log${!loadingVehicleDetail && fuel.length ? ` (${fuel.length})` : ""}` : t === "maintenance" ? `Maintenance${!loadingVehicleDetail && maintenance.length ? ` (${maintenance.length})` : ""}` : "YTD Summary"}
                </button>
              ))}
            </div>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
            {loadingVehicleDetail ? (
              <SkeletonRows count={8} height="38px" />
            ) : vehicleDetailTab === "fuel" ? (
              fuel.length === 0 ? (
                <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No fuel entries for {fyLabel(vehicleDetailYear)}.</p>
              ) : (
                <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                    <thead>
                      <tr>
                        <th style={thS}>Date</th>
                        <th style={thR}>Qty (L)</th>
                        <th style={thR}>PKR/L</th>
                        <th style={thR}>Amount (PKR)</th>
                        <th style={thR}>Odometer</th>
                        <th style={thR}>km/L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fuel.map((f, i) => (
                        <tr key={i} style={{ backgroundColor: i % 2 === 0 ? "white" : "#FAFBFC" }}>
                          <td style={tdS}>{formatDateUK(f.date)}</td>
                          <td style={tdR}>{f.quantity_litres.toFixed(1)}</td>
                          <td style={tdR}>{f.price_per_litre.toFixed(1)}</td>
                          <td style={{ ...tdR, fontWeight: 600 }}>{f.amount_pkr ? Math.round(f.amount_pkr).toLocaleString() : "—"}</td>
                          <td style={{ ...tdR, color: COLOURS.SLATE, fontFamily: "monospace" }}>{f.current_odometer ? f.current_odometer.toLocaleString() : "—"}</td>
                          <td style={{ ...tdR, color: f.km_per_litre ? COLOURS.GREEN : COLOURS.SLATE, fontWeight: f.km_per_litre ? 600 : 400 }}>{f.km_per_litre ? f.km_per_litre.toFixed(1) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ backgroundColor: "#F0F4F8" }}>
                        <td style={{ ...tdS, fontWeight: 700 }}>Total</td>
                        <td style={{ ...tdR, fontWeight: 700 }}>{totalLitres.toFixed(1)}</td>
                        <td style={tdR}></td>
                        <td style={{ ...tdR, fontWeight: 700 }}>{Math.round(totalFuelCost).toLocaleString()}</td>
                        <td style={{ ...tdR, color: COLOURS.SLATE, fontFamily: "monospace" }}>{totalKm > 0 ? `${totalKm.toLocaleString()} km` : "—"}</td>
                        <td style={{ ...tdR, fontWeight: 700, color: COLOURS.GREEN }}>{totalLitres > 0 && totalKm > 0 ? (totalKm / totalLitres).toFixed(1) : "—"}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )
            ) : vehicleDetailTab === "maintenance" ? (
              maintenance.length === 0 ? (
                <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No maintenance records for {fyLabel(vehicleDetailYear)}.</p>
              ) : (
                <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                    <thead>
                      <tr>
                        <th style={thS}>Date</th>
                        <th style={thS}>Type</th>
                        <th style={thS}>Description</th>
                        <th style={thR}>Odometer</th>
                        <th style={thR}>Cost (PKR)</th>
                        <th style={thS}>Workshop</th>
                      </tr>
                    </thead>
                    <tbody>
                      {maintenance.map((m, i) => (
                        <tr key={i} style={{ backgroundColor: i % 2 === 0 ? "white" : "#FAFBFC" }}>
                          <td style={{ ...tdS, whiteSpace: "nowrap" as const }}>{formatDateUK(m.date)}</td>
                          <td style={tdS}><span style={{ fontSize: "10.5px", fontWeight: 600, padding: "2px 7px", borderRadius: "20px", backgroundColor: "#EFF6FF", color: "#1D4ED8", whiteSpace: "nowrap" as const }}>{m.work_type}</span></td>
                          <td style={{ ...tdS, color: COLOURS.SLATE, maxWidth: "160px" }}>{m.description || "—"}</td>
                          <td style={{ ...tdR, fontFamily: "monospace", color: COLOURS.SLATE }}>{m.odometer_km ? m.odometer_km.toLocaleString() : "—"}</td>
                          <td style={{ ...tdR, fontWeight: 600 }}>{Math.round(m.cost_pkr).toLocaleString()}</td>
                          <td style={{ ...tdS, color: COLOURS.SLATE }}>{m.workshop || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ backgroundColor: "#F0F4F8" }}>
                        <td colSpan={4} style={{ ...tdS, fontWeight: 700 }}>Total maintenance cost</td>
                        <td style={{ ...tdR, fontWeight: 700 }}>{Math.round(totalMaintCost).toLocaleString()}</td>
                        <td style={tdS}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )
            ) : (
              // YTD Summary tab
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: "18px" }}>
                  <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", padding: "14px 16px", backgroundColor: "white" }}>
                    <div style={{ fontSize: "18px", fontWeight: 700, color: "#1D4ED8" }}>{fmtPKR(totalFuelCost)}</div>
                    <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>Fuel spend</div>
                  </div>
                  <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", padding: "14px 16px", backgroundColor: "white" }}>
                    <div style={{ fontSize: "18px", fontWeight: 700, color: "#9A3412" }}>{fmtPKR(totalMaintCost)}</div>
                    <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>Maintenance</div>
                  </div>
                  <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", padding: "14px 16px", backgroundColor: "white" }}>
                    <div style={{ fontSize: "18px", fontWeight: 700, color: COLOURS.GREEN }}>{fmtPKR(totalRunning)}</div>
                    <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>Total running cost</div>
                  </div>
                </div>
                <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: "10px" }}>{fyLabel(vehicleDetailYear)} — Month by Month</div>
                <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                    <thead>
                      <tr>
                        <th style={thS}>Month</th>
                        <th style={thR}>Fuel (PKR)</th>
                        <th style={thR}>Litres</th>
                        <th style={thR}>km/L</th>
                        <th style={thR}>Maintenance</th>
                        <th style={thR}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Fiscal order: Jul(7)…Dec(12) then Jan(1)…Jun(6) */}
                      {[7,8,9,10,11,12,1,2,3,4,5,6].map((mo) => {
                        const mn = MONTH_NAMES[mo - 1];
                        const f  = fuelByMonth[mo];
                        const m  = maintByMonth[mo];
                        const rowFuel  = f?.amount || 0;
                        const rowLit   = f?.litres || 0;
                        const rowMaint = m?.cost   || 0;
                        const rowTotal = rowFuel + rowMaint;
                        const hasData  = rowFuel > 0 || rowMaint > 0;
                        const kmPerL   = rowLit > 0 && f ? fuel.filter((fl) => parseInt(fl.date.split("-")[1], 10) === mo).reduce((s, fl) => s + (fl.mileage_km || 0), 0) / rowLit : null;
                        return (
                          <tr key={mo} style={{ backgroundColor: hasData ? "white" : "#FAFBFC" }}>
                            <td style={{ ...tdS, fontWeight: hasData ? 600 : 400, color: hasData ? COLOURS.NAVY : COLOURS.SLATE }}>{mn}</td>
                            <td style={{ ...tdR, color: rowFuel > 0 ? COLOURS.NAVY : COLOURS.SLATE }}>{rowFuel > 0 ? Math.round(rowFuel).toLocaleString() : "—"}</td>
                            <td style={{ ...tdR, color: COLOURS.SLATE }}>{rowLit > 0 ? `${rowLit.toFixed(0)}L` : "—"}</td>
                            <td style={{ ...tdR, color: kmPerL ? COLOURS.GREEN : COLOURS.SLATE, fontWeight: kmPerL ? 600 : 400 }}>{kmPerL ? kmPerL.toFixed(1) : "—"}</td>
                            <td style={{ ...tdR, color: rowMaint > 0 ? "#9A3412" : COLOURS.SLATE }}>{rowMaint > 0 ? Math.round(rowMaint).toLocaleString() : "—"}</td>
                            <td style={{ ...tdR, fontWeight: hasData ? 700 : 400, color: hasData ? COLOURS.NAVY : COLOURS.SLATE }}>{rowTotal > 0 ? Math.round(rowTotal).toLocaleString() : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  // ── Import modal ──────────────────────────────────────────────────────
  function renderImportModal() {
    if (!importModal) return null;
    const { type, label } = importModal;
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9998, backgroundColor: "rgba(15,23,42,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
        onClick={() => { setImportModal(null); setImportFile(null); setImportResult(null); }}>
        <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "white", borderRadius: "12px", padding: "24px", maxWidth: "500px", width: "100%", boxShadow: "0 20px 60px rgba(15,23,42,0.15)" }}>
          <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "4px" }}>Import {label} Data</div>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "18px" }}>Download the CSV template, fill in your data in Excel (save as CSV), then upload. Existing entries are automatically skipped.</div>

          {/* Step 1 */}
          <div style={{ backgroundColor: "#F8F9FC", borderRadius: "8px", padding: "14px", marginBottom: "12px" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: "8px" }}>Step 1 — Download Template</div>
            <button onClick={() => handleDownloadTemplate(type, `${type}_template.csv`)}
              style={{ padding: "7px 14px", borderRadius: "6px", border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", color: COLOURS.NAVY }}>
              📥 Download {label} template (.csv)
            </button>
            <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "7px" }}>
              {type === "fuel" && "Columns: Date · Plate Number · Price Per Litre · Quantity · Previous Odometer · Current Odometer"}
              {type === "maintenance" && "Columns: Date · Plate Number · Work Type · Description · Odometer · Cost · Workshop"}
              {type === "solar" && "Columns: Date · Site Name · Units Produced (kWh)"}
            </div>
          </div>

          {/* Step 2 */}
          <div style={{ backgroundColor: "#F8F9FC", borderRadius: "8px", padding: "14px", marginBottom: "14px" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: "8px" }}>Step 2 — Upload Filled CSV</div>
            <input type="file" accept=".csv,.txt"
              onChange={(e) => { setImportFile(e.target.files?.[0] || null); setImportResult(null); }}
              style={{ display: "block", fontSize: "12.5px", color: COLOURS.NAVY }} />
            {importFile && (
              <div style={{ marginTop: "8px", fontSize: "11.5px", color: COLOURS.SLATE }}>{importFile.name} · {(importFile.size / 1024).toFixed(1)} KB</div>
            )}
          </div>

          {/* Result */}
          {importResult && (
            <div style={{ borderRadius: "8px", padding: "12px 14px", marginBottom: "14px", backgroundColor: importResult.imported > 0 ? "#ECFDF5" : "#FFFBEB", border: `1px solid ${importResult.imported > 0 ? "#A7F3D0" : "#FDE68A"}` }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: importResult.imported > 0 ? COLOURS.GREEN : COLOURS.AMBER }}>
                ✓ {importResult.imported} row{importResult.imported !== 1 ? "s" : ""} imported · {importResult.skipped} skipped
              </div>
              {importResult.errors.length > 0 && (
                <ul style={{ margin: "6px 0 0", paddingLeft: "18px", fontSize: "11.5px", color: COLOURS.RED }}>
                  {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            <button onClick={() => { setImportModal(null); setImportFile(null); setImportResult(null); }}
              style={{ padding: "8px 16px", borderRadius: "8px", border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", color: COLOURS.NAVY }}>
              Close
            </button>
            {importFile && !importResult && (
              <button onClick={handleImport} disabled={importing}
                style={{ padding: "8px 16px", borderRadius: "8px", border: "none", backgroundColor: COLOURS.NAVY, color: "white", fontSize: "12.5px", fontWeight: 600, cursor: importing ? "not-allowed" : "pointer", opacity: importing ? 0.7 : 1 }}>
                {importing ? "Importing…" : `Import ${label}`}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderUtility() {
    if (loadingUtility) return <SkeletonRows count={4} height="40px" />;
    if (utilityLocations.length === 0) return (
      <p style={{ color: COLOURS.SLATE, fontSize: "14px" }}>No sites configured yet.</p>
    );

    const now = new Date();
    // opsYear is FY start year; derive actual calendar year for the displayed month
    const opsCalYear = opsMonth >= 7 ? opsYear : opsYear + 1;
    const isCurrentOrPast = opsCalYear < now.getFullYear() || (opsCalYear === now.getFullYear() && opsMonth <= now.getMonth() + 1);

    const rows = utilityLocations.map((loc) => ({
      ...loc,
      monthData: (loc.months || []).find((m) => m.month === opsMonth),
    }));

    const totalBill   = rows.reduce((s, r) => s + (r.monthData?.total_bill || 0), 0);
    const noDataCount = isCurrentOrPast ? rows.filter((r) => !r.monthData?.total_bill).length : 0;

    // Group by entity for cleaner display
    const entities = [...new Set(rows.map((r) => r.entity))].sort();

    const fmtPKR = (n: number) => n >= 100000 ? `PKR ${(n / 1000).toFixed(0)}K` : `PKR ${n.toLocaleString()}`;

    return (
      <div>
        {/* Summary stat row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px", marginBottom: "14px" }}>
          <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", padding: "14px 18px", backgroundColor: "white" }}>
            <div style={{ fontSize: "20px", fontWeight: 700, color: COLOURS.NAVY, lineHeight: 1.1 }}>{totalBill > 0 ? fmtPKR(totalBill) : "—"}</div>
            <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "3px", fontWeight: 500 }}>Total bills</div>
          </div>
          <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", padding: "14px 18px", backgroundColor: "white" }}>
            <div style={{ fontSize: "20px", fontWeight: 700, color: COLOURS.NAVY, lineHeight: 1.1 }}>{rows.length}</div>
            <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "3px", fontWeight: 500 }}>Sites</div>
          </div>
          <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", padding: "14px 18px", backgroundColor: "white" }}>
            <div style={{ fontSize: "20px", fontWeight: 700, color: noDataCount > 0 ? COLOURS.AMBER : COLOURS.GREEN, lineHeight: 1.1 }}>{noDataCount}</div>
            <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "3px", fontWeight: 500 }}>No bill this month</div>
          </div>
        </div>

        {/* Paginate: 10 sites per page, sorted by entity then name */}
        {(() => {
          const sortedRows = [...rows].sort((a, b) => a.entity.localeCompare(b.entity) || a.location_name.localeCompare(b.location_name));
          const totalPages = Math.ceil(sortedRows.length / UTIL_PAGE_SIZE);
          const pageRows   = sortedRows.slice(utilityPage * UTIL_PAGE_SIZE, (utilityPage + 1) * UTIL_PAGE_SIZE);
          const pageEntities = [...new Set(pageRows.map((r) => r.entity))].sort();
          const thStyle: React.CSSProperties = { padding: "8px 14px", textAlign: "left" as const, fontSize: "10.5px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase" as const, letterSpacing: "0.05em", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "#FAFBFC" };

          return (
            <>
              {pageEntities.map((entity) => {
                const entityRows  = pageRows.filter((r) => r.entity === entity);
                const entityTotal = entityRows.reduce((s, r) => s + (r.monthData?.total_bill || 0), 0);
                return (
                  <div key={entity} style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", overflow: "hidden", backgroundColor: "white", marginBottom: "12px" }}>
                    <div style={{ padding: "10px 16px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#F8F9FC" }}>
                      <span style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.NAVY }}>{entity}</span>
                      <span style={{ fontSize: "11.5px", color: COLOURS.SLATE }}>{entityTotal > 0 ? fmtPKR(entityTotal) : "No bills yet"} · {entityRows.length} sites</span>
                    </div>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>{["Site", "Bill amount", "Meters read", "Status"].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {entityRows.map((r) => {
                          const bill    = r.monthData?.total_bill;
                          const noEntry = isCurrentOrPast && !bill;
                          return (
                            <tr key={r.location_id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                              <td style={{ padding: "9px 14px", fontSize: "12.5px", color: COLOURS.NAVY, fontWeight: 500 }}>{r.location_name}</td>
                              <td style={{ padding: "9px 14px", fontSize: "12.5px", color: bill ? COLOURS.NAVY : COLOURS.SLATE }}>{bill ? fmtPKR(bill) : "—"}</td>
                              <td style={{ padding: "9px 14px", fontSize: "12px", color: COLOURS.SLATE }}>{r.monthData?.meters_read ?? "—"}</td>
                              <td style={{ padding: "8px 14px" }}>
                                <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 9px", borderRadius: "20px", backgroundColor: noEntry ? "#FEF3C7" : "#ECFDF5", color: noEntry ? COLOURS.AMBER : COLOURS.GREEN, whiteSpace: "nowrap" as const }}>
                                  {noEntry ? "No entry" : "Recorded"}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}

              {/* Pagination controls */}
              {totalPages > 1 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "4px" }}>
                  <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>
                    Showing {utilityPage * UTIL_PAGE_SIZE + 1}–{Math.min((utilityPage + 1) * UTIL_PAGE_SIZE, sortedRows.length)} of {sortedRows.length} sites
                  </span>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button onClick={() => setUtilityPage((p) => Math.max(0, p - 1))} disabled={utilityPage === 0}
                      style={{ padding: "5px 14px", borderRadius: "6px", border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", fontSize: "12px", fontWeight: 600, cursor: utilityPage === 0 ? "default" : "pointer", color: COLOURS.NAVY, opacity: utilityPage === 0 ? 0.4 : 1 }}>← Prev</button>
                    <button onClick={() => setUtilityPage((p) => Math.min(totalPages - 1, p + 1))} disabled={utilityPage >= totalPages - 1}
                      style={{ padding: "5px 14px", borderRadius: "6px", border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", fontSize: "12px", fontWeight: 600, cursor: utilityPage >= totalPages - 1 ? "default" : "pointer", color: COLOURS.NAVY, opacity: utilityPage >= totalPages - 1 ? 0.4 : 1 }}>Next →</button>
                  </div>
                </div>
              )}
            </>
          );
        })()}
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

        {/* ── PAYMENTS ── */}
        {activeTab === "payments" && (
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
          </div>
        )}

        {/* ── COMPLIANCE ── */}
        {activeTab === "compliance" && (
          <div>
            <div style={{ marginBottom: "28px" }}>
              {renderComplianceRenewals()}
            </div>

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
          </div>
        )}

        {/* ── DOCUMENTS ── */}
        {activeTab === "documents" && (
          <div>
            {/* Filter bar */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "18px", flexWrap: "wrap", alignItems: "center" }}>
              <select value={docStatusFilterUI} onChange={(e) => { setDocStatusFilterUI(e.target.value); setNtnPage(0); }}
                style={{ padding: "6px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "6px", fontSize: "12.5px", color: COLOURS.NAVY, backgroundColor: "white", minWidth: "140px" }}>
                <option value="">All Statuses</option>
                <option value="Done">Done</option>
                <option value="Pending">Pending</option>
                <option value="N/A">N/A</option>
              </select>
              <input type="text" value={docSearch} onChange={(e) => { setDocSearch(e.target.value); setNtnPage(0); }}
                placeholder="🔍  Search location…"
                style={{ padding: "6px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "6px", fontSize: "12.5px", flex: 1, minWidth: "180px", color: COLOURS.NAVY, backgroundColor: "white" }}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>NTN on WAPDA Bills</span>
              <div style={{ flex: 1, height: "1px", backgroundColor: COLOURS.HAIRLINE }} />
            </div>
            {renderNtnDocs()}
          </div>
        )}

        {/* ── OPERATIONS ── */}
        {activeTab === "operations" && (
          <div>
            {/* Month nav */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
              <button onClick={prevOpsMonth} style={{ width: "26px", height: "26px", borderRadius: "6px", border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.SLATE, fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>‹</button>
              <span style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY, minWidth: "140px", textAlign: "center" }}>
                {MONTH_FULL[opsMonth - 1]} {opsMonth >= 7 ? opsYear : opsYear + 1}
                <span style={{ fontSize: "11px", fontWeight: 400, color: COLOURS.SLATE, marginLeft: "6px" }}>({fyLabel(opsYear)})</span>
              </span>
              <button onClick={nextOpsMonth} style={{ width: "26px", height: "26px", borderRadius: "6px", border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.SLATE, fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>›</button>
              {opsYear === CURRENT_FY_START && opsMonth === new Date().getMonth() + 1 && (
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
                <button onClick={() => setImportModal({ type: "fuel", label: "Fuel Log" })}
                  style={{ fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "20px", border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.NAVY, cursor: "pointer", whiteSpace: "nowrap" }}>
                  📥 Import
                </button>
                <button onClick={() => setImportModal({ type: "maintenance", label: "Maintenance" })}
                  style={{ fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "20px", border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.NAVY, cursor: "pointer", whiteSpace: "nowrap" }}>
                  🔧 Import Maint.
                </button>
                {canManageLocations && (
                  <button onClick={openManageFleet}
                    style={{ fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "20px", border: `1px solid ${COLOURS.NAVY}`, backgroundColor: COLOURS.NAVY, color: "white", cursor: "pointer", whiteSpace: "nowrap" }}>
                    ⚙ Manage
                  </button>
                )}
              </div>
              {renderFuel()}
            </div>

            {/* Solar section */}
            <div style={{ marginBottom: "28px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>☀️ Solar — Monthly Production</span>
                <div style={{ flex: 1, height: "1px", backgroundColor: COLOURS.HAIRLINE }} />
                <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 9px", borderRadius: "20px", backgroundColor: COLOURS.HAIRLINE, color: COLOURS.SLATE }}>
                  {solarBranches.length} systems
                </span>
                <button onClick={() => setImportModal({ type: "solar", label: "Solar" })}
                  style={{ fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "20px", border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.NAVY, cursor: "pointer", whiteSpace: "nowrap" }}>
                  📥 Import
                </button>
                {canManageLocations && (
                  <button onClick={openManageSolar}
                    style={{ fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "20px", border: `1px solid ${COLOURS.NAVY}`, backgroundColor: COLOURS.NAVY, color: "white", cursor: "pointer", whiteSpace: "nowrap" }}>
                    ⚙ Manage
                  </button>
                )}
              </div>
              {renderSolar()}
            </div>

            {/* Utility / Sites section */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>⚡ Sites — Utility Bills</span>
                <div style={{ flex: 1, height: "1px", backgroundColor: COLOURS.HAIRLINE }} />
                <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 9px", borderRadius: "20px", backgroundColor: COLOURS.HAIRLINE, color: COLOURS.SLATE }}>
                  {utilityLocations.length} sites
                </span>
                {canManageLocations && (
                  <button onClick={openManageUtility}
                    style={{ fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "20px", border: `1px solid ${COLOURS.NAVY}`, backgroundColor: COLOURS.NAVY, color: "white", cursor: "pointer", whiteSpace: "nowrap" }}>
                    ⚙ Manage
                  </button>
                )}
              </div>
              {renderUtility()}
            </div>
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

      {/* Vehicle detail side panel — rendered outside main to avoid clipping */}
      {renderVehiclePanel()}
      {/* Import modal */}
      {renderImportModal()}
      {/* Manage Fleet modal */}
      {renderManageFleet()}
      {/* Manage Solar Sites modal */}
      {renderManageSolar()}
      {/* Manage Utility Sites modal */}
      {renderManageUtility()}
    </AuthWrapper>
  );
}
