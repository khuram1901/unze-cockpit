"use client";

import { useEffect, useState, useRef, Fragment } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { useRequireCapability } from "../lib/useRouteGuard";
import LegalCases from "./LegalCases";
import { widgetVisible, isAdminTier, isPrivileged, canAccessAdminOps, canAccessVisitorEntry } from "../lib/permissions";
import { useUserCtx } from "../lib/useUserCtx";
import { authFetch, supabase } from "../lib/supabase";
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
  id: string;
  date: string; price_per_litre: number; quantity_litres: number;
  amount_pkr: number; previous_odometer: number | null;
  current_odometer: number | null; km_per_litre: number | null; mileage_km: number | null;
  notes: string | null; entered_by: string | null; slip_image_url: string | null;
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

type TabId = "registrations" | "payments" | "compliance" | "documents" | "operations" | "legal" | "visitors" | "generators";

// ── Generator types ───────────────────────────────────────────────────
type GenTabView = "diesel" | "maintenance" | "master" | "analytics";

type GenFuelRow = {
  id: string; generator_label: string; location_name: string;
  refuel_date: string; previous_hours: number | null; present_hours: number;
  hours_run: number | null; rate_per_litre: number; qty_litres: number;
  total_cost: number; litres_per_hour: number | null; cost_per_hour: number | null;
  remarks: string | null; entered_by: string | null;
};

type GenMaintRow = {
  id: string; generator_label: string; location_name: string;
  maintenance_date: string;
  engine_oil: number; oil_filter: number; fuel_filter: number; air_filter: number;
  radiator_service: number; periodic_maintenance: number; other_mechanical_work: number; others: number;
  total_cost: number; entered_by: string | null;
  is_deleted: boolean; deleted_reason: string | null;
};

type GenSummaryRow = {
  generator_id: string; generator_label: string; location_name: string;
  kva: number; model: string; is_active: boolean;
  total_refuels: number; total_litres: number; total_fuel_cost: number;
  avg_litres_per_hour: number | null; avg_cost_per_hour: number | null;
  last_refuel_date: string | null; last_service_date: string | null;
  days_since_refuel: number | null; days_since_service: number | null;
  hours_since_last_service: number | null;
};

type GenMasterRow = {
  id: string; location_id: string; location_name: string;
  kva: number; model: string; label: string | null; is_active: boolean;
};

type GenThresholds = {
  unusual_pct: number; service_hours: number; days_amber: number; days_red: number;
};

// ── Helpers ───────────────────────────────────────────────────────────


const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_FULL  = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const ENTITY_DISPLAY: Record<string, string> = {
  UTPL:   "UTPL — Unze Trading",
  IFPL:   "IFPL — Imperial Footwear",
  Baranh: "Baranh",
  HD:     "HD",
  ALM:    "Almahar",
  DIR:    "Directors",
  UZL:    "Unze London",
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
        ? `Paid ${formatDateUK(entry.date_paid)}${entry.challan_number ? ` · Challan ${entry.challan_number}` : ""}${entry.amount_pkr ? ` · PKR ${Number(entry.amount_pkr).toLocaleString()}` : ""}`
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
  const { checking } = useRequireCapability("admin_page");
  const { ctx } = useUserCtx();
  const isMobile = useMobile();
  // Widget visibility — gates individual tabs. Default true = visible unless explicitly hidden.
  const wv = (key: string) => !ctx || widgetVisible(ctx, key, true);
  // Visitor-entry-only users (reception staff) see only the Visitors tab
  const isVisitorOnly = !!ctx && canAccessVisitorEntry(ctx) && !canAccessAdminOps(ctx);
  const { confirm, element: confirmElement } = useConfirm();
  const { show: showToast, element: toastElement } = useToast();

  const [activeTab, setActiveTab] = useState<TabId>("registrations");

  // Deep-link support: /admin?tab=payments, /admin?tab=compliance etc.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab") as TabId | null;
    if (t && (["registrations","payments","compliance","documents","operations","legal"] as string[]).includes(t)) {
      setActiveTab(t);
    }
  }, []);

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
  // Derived from ctx — no separate queries needed. True for admin-tier users
  // and for anyone explicitly granted can_manage_locations in member_permissions.
  const canManageLocations = ctx
    ? (isAdminTier(ctx) || !!ctx.overrides?.can_manage_locations)
    : false;

  // canAmendFuel — Admin tier, Executive (Sunaina), or Manager in Admin dept (Akhlaq)
  const canAmendFuel = ctx
    ? (isPrivileged(ctx) || (ctx.role === "Manager" && ctx.department === "Admin"))
    : false;

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
  const vehicleDetailCache = useRef<Map<string, { fuel: FuelFill[]; maintenance: MaintenanceRecord[] }>>(new Map());

  // ── Fuel amendment state ───────────────────────────────────────────
  const [editingFuel, setEditingFuel] = useState<FuelFill | null>(null);
  const [savingFuelEdit, setSavingFuelEdit] = useState(false);
  const [editSlipFile, setEditSlipFile] = useState<File | null>(null);
  const [editSlipPreviewUrl, setEditSlipPreviewUrl] = useState<string | null>(null);

  // ── Fuel add-entry state ───────────────────────────────────────────
  const [addingFuel, setAddingFuel] = useState<{
    date: string; price_per_litre: string; quantity_litres: string;
    previous_odometer: string; current_odometer: string; notes: string;
    slipFile: File | null; slipPreviewUrl: string | null;
    stationFile: File | null; stationPreviewUrl: string | null;
    finishedFile: File | null; finishedPreviewUrl: string | null;
  } | null>(null);
  // ── Solar add-entry state ──────────────────────────────────────────
  const [addingSolar, setAddingSolar] = useState<{
    branch_id: string; branch_name: string; date: string;
    production_kwh: string; status: string; notes: string;
  } | null>(null);
  const [savingSolarAdd, setSavingSolarAdd] = useState(false);
  // ── Utility add-entry state ────────────────────────────────────────
  const [addingUtility, setAddingUtility] = useState<{
    location_id: string; location_name: string; meter_label: string;
    utility_company: string; reading_date: string;
    current_reading: string; previous_reading: string; bill_amount_pkr: string;
  } | null>(null);
  const [savingUtilityAdd, setSavingUtilityAdd] = useState(false);
  // ── Maintenance add-entry state ────────────────────────────────────
  const [addingMaint, setAddingMaint] = useState<{
    date: string; work_type: string; description: string;
    odometer_km: string; workshop: string; cost_pkr: string; next_service_due: string;
  } | null>(null);
  const [savingMaintAdd, setSavingMaintAdd] = useState(false);
  const [savingFuelAdd, setSavingFuelAdd] = useState(false);

  // Canvas-based image compression: resize to max 1200px, JPEG quality 0.82
  function compressImage(file: File): Promise<File> {
    return new Promise((resolve) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const MAX_PX = 1200;
        let { width, height } = img;
        if (width > height) {
          if (width > MAX_PX) { height = Math.round(height * MAX_PX / width); width = MAX_PX; }
        } else {
          if (height > MAX_PX) { width = Math.round(width * MAX_PX / height); height = MAX_PX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }));
        }, "image/jpeg", 0.82);
      };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
      img.src = objectUrl;
    });
  }

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
    const res = await authFetch("/api/admin/registrations");
    const json = await res.json();
    setRegistrations(json.data || []);
    setLoadingRegs(false);
  }

  async function loadPayments() {
    setLoadingPayments(true);
    const res = await authFetch(`/api/admin/payments?year=${paymentYear}`);
    const json = await res.json();
    setPaymentRows(json.data || []);
    setLoadingPayments(false);
  }

  async function loadCompliance() {
    setLoadingCompliance(true);
    const res = await authFetch("/api/admin/compliance");
    const json = await res.json();
    setCompliance(json.data || []);
    setLoadingCompliance(false);
  }

  async function loadNtnDocs() {
    setLoadingNtn(true);
    const res = await authFetch("/api/admin/documents?type=ntn");
    const json = await res.json();
    setNtnDocs(json.data || []);
    setLoadingNtn(false);
  }

  async function loadLicences() {
    setLoadingLicences(true);
    const res = await authFetch("/api/admin/documents?type=licences");
    const json = await res.json();
    setRestaurantLicences(json.data || []);
    setLoadingLicences(false);
  }

  async function loadFuel() {
    setLoadingFuel(true);
    const res = await authFetch(`/api/admin/operations?type=fuel&year=${opsYear}`);
    const json = await res.json();
    setFuelRows(json.data || []);
    setLoadingFuel(false);
  }

  async function loadSolar() {
    setLoadingSolar(true);
    const res = await authFetch(`/api/admin/operations?type=solar&year=${opsYear}`);
    const json = await res.json();
    setSolarBranches(json.data || []);
    setLoadingSolar(false);
  }

  async function loadUtility() {
    setLoadingUtility(true);
    const res = await authFetch(`/api/admin/operations?type=utility&year=${opsYear}`);
    const json = await res.json();
    setUtilityLocations(json.data || []);
    setLoadingUtility(false);
  }

  async function loadVehicleDetail(vehicleId: string, year: number) {
    const cacheKey = `${vehicleId}:${year}`;
    const cached = vehicleDetailCache.current.get(cacheKey);
    if (cached) { setVehicleDetail(cached); return; }
    setLoadingVehicleDetail(true);
    setVehicleDetail(null);
    const res = await authFetch(`/api/admin/vehicle-detail?vehicleId=${vehicleId}&year=${year}`);
    const json = await res.json();
    const data = json.data || { fuel: [], maintenance: [] };
    vehicleDetailCache.current.set(cacheKey, data);
    setVehicleDetail(data);
    setLoadingVehicleDetail(false);
  }

  async function handleImport() {
    if (!importFile || !importModal) return;
    setImporting(true);
    setImportResult(null);
    const form = new FormData();
    form.append("type", importModal.type);
    form.append("file", importFile);
    const res = await authFetch("/api/admin/import", { method: "POST", body: form });
    const json = await res.json();
    setImportResult(json);
    setImporting(false);
    if (json.imported > 0) {
      if (importModal.type === "fuel") loadFuel();
      else if (importModal.type === "solar") loadSolar();
    }
  }

  async function handleDownloadTemplate(type: string, filename: string) {
    const res = await authFetch(`/api/admin/import?type=${type}`);
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
    const res = await authFetch("/api/admin/registrations", {
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
    const res = await authFetch("/api/admin/registrations", {
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
    const res = await authFetch("/api/admin/compliance", {
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
    const res = await authFetch("/api/admin/documents", {
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
    const res = await authFetch("/api/admin/documents", {
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
    const res = await authFetch("/api/admin/locations", {
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
    const res = await authFetch(`/api/admin/locations?id=${location_id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.ok) { showToast(`${name} removed`, "success"); loadRegistrations(); }
    else showToast(json.error || "Failed to remove", "error");
  }

  async function savePayment() {
    if (!addingPayment) return;
    setSavingPayment(true);
    const res = await authFetch("/api/admin/payments", {
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
    const order = ["UTPL", "IFPL", "Baranh", "HD", "ALM", "DIR", "UZL"];
    const grouped: Record<string, T[]> = {};
    order.forEach((e) => { grouped[e] = []; });
    rows.forEach((r) => {
      if (!grouped[r.entity]) grouped[r.entity] = [];
      grouped[r.entity].push(r);
    });
    return grouped;
  }

  // ── Visitor Log state ─────────────────────────────────────────────────────
  type VisitorRow = {
    id: string; visit_date: string; time_in: string; time_out: string | null;
    visitor_name: string; mobile_masked: string; cnic_masked: string | null;
    department_name: string; host_name: string; purpose: string; purpose_other: string | null;
    comments: string | null; duration_mins: number | null; is_inside: boolean;
    flag_type: "vip" | "blacklist" | null; entered_by_name: string | null;
  };
  type VisitorKpi = {
    total: number; currently_inside: number; overstay: number;
    unique_visitors: number; avg_duration_mins: number; longest_stay_mins: number; repeat_visitors: number;
  };
  type VisitorDeptRow = { department_name: string; total: number; inside: number; avg_mins: number | null };
  type VisitorHostRow = { host_name: string; department_name: string; total: number; inside: number; avg_mins: number | null };
  type VisitorHeatCell = { dow: number; hour: number; visits: number };
  type VisitorException = { id: string; visitor_name: string; mobile_masked: string; department_name: string; host_name: string; time_in: string; time_out: string | null; flag_type: string | null; exception_type: string | null; mins_inside: number };

  const [visitorRows, setVisitorRows]         = useState<VisitorRow[]>([]);
  const [visitorTotal, setVisitorTotal]       = useState(0);
  const [loadingVisitors, setLoadingVisitors] = useState(false);
  const [visitorKpi, setVisitorKpi]           = useState<VisitorKpi | null>(null);
  const [visitorDeptRows, setVisitorDeptRows] = useState<VisitorDeptRow[]>([]);
  const [visitorHostRows, setVisitorHostRows] = useState<VisitorHostRow[]>([]);
  const [visitorHeatmap, setVisitorHeatmap]   = useState<VisitorHeatCell[]>([]);
  const [visitorExceptions, setVisitorExceptions] = useState<VisitorException[]>([]);
  const [visitorDateFrom, setVisitorDateFrom] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
  });
  const [visitorDateTo, setVisitorDateTo]     = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [visitorSearch, setVisitorSearch]     = useState("");
  const [visitorStatus, setVisitorStatus]     = useState<"" | "inside" | "checked_out">("");
  const [visitorDeptFilter, setVisitorDeptFilter] = useState("");
  const [visitorPage, setVisitorPage]         = useState(0);
  const [editingVisitor, setEditingVisitor]   = useState<VisitorRow | null>(null);
  const [editCnic, setEditCnic]               = useState("");   // raw 13-digit CNIC to overwrite (blank = no change)
  const [editMobile, setEditMobile]           = useState("");   // raw mobile to overwrite (blank = no change)
  const [savingVisitor, setSavingVisitor]     = useState(false);
  const [deleteVisitorId, setDeleteVisitorId] = useState<string | null>(null);
  const [deleteReason, setDeleteReason]       = useState("");
  const visitorPageSize = 50;

  // Dashboard view switcher
  const [dashView, setDashView] = useState<"kpi" | "league" | "peak" | "alerts">("kpi");

  // F10 — Settings panel state
  const [showVisitorSettings, setShowVisitorSettings] = useState(false);
  const [showVisitorImport,   setShowVisitorImport]   = useState(false);
  type PurposeThreshold = { keyword: string; threshold_mins: number };
  type VisitorSettings  = { overstay_threshold_mins: number; office_open_hour: number; office_close_hour: number; weekly_digest_email: string; purpose_thresholds: PurposeThreshold[] };
  const [visitorSettings, setVisitorSettings]         = useState<VisitorSettings | null>(null);
  const [settingsSaving, setSettingsSaving]           = useState(false);
  const [settingsNewKw, setSettingsNewKw]             = useState("");
  const [settingsNewMins, setSettingsNewMins]         = useState("");
  // F14 — Historical import state
  const [visitorImportFile, setVisitorImportFile]     = useState<File | null>(null);
  const [visitorImporting, setVisitorImporting]       = useState(false);
  const [visitorImportResult, setVisitorImportResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
  // P2-C: preview before confirm
  type VisitorImportPreviewRow = { visitor_name: string; mobile: string; visit_date: string; time_in: string; time_out: string; purpose: string; host_name: string };
  const [visitorImportPreview, setVisitorImportPreview] = useState<VisitorImportPreviewRow[] | null>(null);
  const [visitorImportRowCount, setVisitorImportRowCount] = useState(0);

  // ── Generator state ────────────────────────────────────────────────────────
  const [genTabView, setGenTabView]         = useState<GenTabView>("diesel");
  const [genActiveCard, setGenActiveCard]   = useState<string | null>(null);
  const [genFuelRows, setGenFuelRows]       = useState<GenFuelRow[]>([]);
  const [genMaintRows, setGenMaintRows]     = useState<GenMaintRow[]>([]);
  const [genSummary, setGenSummary]         = useState<GenSummaryRow[]>([]);
  const [genMaster, setGenMaster]           = useState<GenMasterRow[]>([]);
  const [genThresholds, setGenThresholds]   = useState<GenThresholds | null>(null);
  const [genMeta, setGenMeta]               = useState<{location_id:string;location_name:string;generator_id:string;kva:number;model:string;label:string|null}[]>([]);
  const [loadingGen, setLoadingGen]         = useState(false);
  const [genDateFrom, setGenDateFrom]       = useState<string>(() => { const d = new Date(); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,10); });
  const [genDateTo, setGenDateTo]           = useState<string>(() => new Date().toISOString().slice(0,10));
  const [genLocFilter, setGenLocFilter]     = useState("");
  const [genGenFilter, setGenGenFilter]     = useState("");
  const [genSearch, setGenSearch]           = useState("");
  const [editingGenFuel, setEditingGenFuel]     = useState<GenFuelRow | null>(null);
  const [editingGenMaint, setEditingGenMaint]   = useState<GenMaintRow | null>(null);
  const [showGenMasterForm, setShowGenMasterForm] = useState(false);
  const [editingGenMaster, setEditingGenMaster]   = useState<GenMasterRow | null>(null);
  const [showGenThresholds, setShowGenThresholds] = useState(false);
  const [genMasterForm, setGenMasterForm]   = useState({ location_id:"", kva:"", model:"", label:"", is_active:true });
  const [genThreshForm, setGenThreshForm]   = useState({ unusual_pct:"50", service_hours:"250", days_amber:"7", days_red:"14" });
  const [savingGenFuel, setSavingGenFuel]   = useState(false);
  const [savingGenMaint, setSavingGenMaint] = useState(false);
  const [savingGenMaster, setSavingGenMaster] = useState(false);
  const [savingGenThresh, setSavingGenThresh] = useState(false);

  // ── Generator Analytics state ──────────────────────────────────────────────
  type GenAnalyticsRow = {
    location_id: string; location_name: string; generator_count: number;
    total_litres: number; total_fuel_cost: number; total_hours_run: number;
    avg_litres_per_hr: number | null; avg_cost_per_hr: number | null;
    total_maint_cost: number; maint_event_count: number;
    fuel_share_pct: number; maint_share_pct: number; efficiency_rank: number;
  };
  const [analyticsRows, setAnalyticsRows]     = useState<GenAnalyticsRow[]>([]);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [analyticsError, setAnalyticsError]   = useState<string | null>(null);
  const TODAY = new Date().toISOString().slice(0, 10);
  const firstOfMonth = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };
  const xMonthsAgo   = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10); };
  const startOfYear  = () => `${new Date().getFullYear()}-01-01`;
  const [analyticsPeriod, setAnalyticsPeriod] = useState<"month" | "q3" | "ytd" | "custom">("month");
  const [analyticsLocFilter, setAnalyticsLocFilter] = useState<string>("all");
  const [analyticsFrom, setAnalyticsFrom]     = useState<string>(firstOfMonth());
  const [analyticsTo, setAnalyticsTo]         = useState<string>(TODAY);

  async function loadGeneratorData() {
    setLoadingGen(true);
    try {
      const params = new URLSearchParams({ date_from: genDateFrom, date_to: genDateTo });
      if (genLocFilter) params.set("location_id",  genLocFilter);
      if (genGenFilter) params.set("generator_id", genGenFilter);
      if (genSearch)    params.set("search",        genSearch);
      const [metaRes, fuelRes, maintRes, summRes] = await Promise.all([
        authFetch("/api/admin/generators?type=meta"),
        authFetch(`/api/admin/generators?type=fuel_table&${params}`),
        authFetch(`/api/admin/generators?type=maint_table&${params}`),
        authFetch(`/api/admin/generators?type=summary&${params}`),
      ]);
      const [meta, fuel, maint, summ] = await Promise.all([metaRes.json(), fuelRes.json(), maintRes.json(), summRes.json()]);
      setGenMeta(meta.data ?? []);
      setGenFuelRows(fuel.data ?? []);
      setGenMaintRows(maint.data ?? []);
      setGenSummary(summ.summary ?? []);
      if (summ.summary?.[0]) {
        // thresholds come from the first summary row — extract from meta instead
      }
      // build master list from flat rows
      const masterRows = (meta.data ?? []).map((g: {location_id:string;location_name:string;generator_id:string;kva:number;model:string;label:string|null}) => ({
        id: g.generator_id,
        location_id: g.location_id,
        location_name: g.location_name,
        kva: g.kva,
        model: g.model,
        label: g.label,
        is_active: true,
      }));
      setGenMaster(masterRows);
    } finally {
      setLoadingGen(false);
    }
  }

  // Load generators when tab becomes active or filters change
  useEffect(() => {
    if (activeTab === "generators" && !checking) {
      loadGeneratorData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, checking, genDateFrom, genDateTo, genLocFilter, genGenFilter, genSearch]);

  function renderGeneratorsTab() {
    const PKR = (n: number | null | undefined) => n == null ? "—" : `PKR ${Math.round(n).toLocaleString("en-PK")}`;
    const NUM = (n: number | null | undefined, dp = 1) => n == null ? "—" : n.toFixed(dp);

    // Unique locations from flat rows
    const allLocations = Array.from(new Map(genMeta.map(g => [g.location_id, g.location_name])).entries())
      .map(([id, name]) => ({ id, name }));
    // Generators for the selected location (for sub-filter)
    const locGens = genLocFilter
      ? genMeta.filter(g => g.location_id === genLocFilter)
      : [];

    // Status badge helper
    const daysBadge = (days: number | null, amberThreshold = 7, redThreshold = 14) => {
      if (days == null) return null;
      const color = days > redThreshold ? "#B3261E" : days > amberThreshold ? "#B4791F" : "#0F7B5F";
      const bg    = days > redThreshold ? "#FEF2F2" : days > amberThreshold ? "#FFFBEB" : "#F0FDF4";
      return <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "20px", backgroundColor: bg, color }}>{days}d ago</span>;
    };

    // ── Fetch analytics ────────────────────────────────────────────────────────
    const fetchGenAnalytics = async (from: string, to: string) => {
      setLoadingAnalytics(true);
      setAnalyticsError(null);
      try {
        const r = await authFetch(`/api/admin/generators?type=analytics&from=${from}&to=${to}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Failed");
        setAnalyticsRows(j.data ?? []);
      } catch (e: unknown) {
        setAnalyticsError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoadingAnalytics(false);
      }
    };

    // Fetch analytics when analytics tab is active
    // (triggered via useEffect on genTabView in outer scope — call explicitly on mount for analytics)
    const subTab = (id: GenTabView, label: string) => (
      <button key={id} onClick={() => {
        setGenTabView(id);
        setGenActiveCard(null);
        if (id === "analytics") fetchGenAnalytics(analyticsFrom, analyticsTo);
      }} style={{
        padding: "6px 16px", borderRadius: "20px", fontSize: "12px", fontWeight: 600, cursor: "pointer",
        backgroundColor: genTabView === id ? COLOURS.NAVY : "transparent",
        color:           genTabView === id ? "white"      : COLOURS.SLATE,
        border: `1px solid ${genTabView === id ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
      }}>{label}</button>
    );

    const selectedLocName = genLocFilter
      ? (allLocations.find(l => l.id === genLocFilter)?.name ?? "")
      : "";

    const filterBar = (
      <div style={{ background: "#FFFFFF", border: "1px solid #EEF0F3", borderRadius: "12px", padding: "16px", marginBottom: "20px" }}>
        {/* Row 1: Location (prominent) + Generator sub-filter */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginBottom: "10px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748B" }}>📍 Location</span>
            <select value={genLocFilter} onChange={e => { setGenLocFilter(e.target.value); setGenGenFilter(""); }}
              style={{ padding: "8px 12px", border: `2px solid ${genLocFilter ? "#0F1720" : "#EEF0F3"}`, borderRadius: "8px", fontSize: "13px", fontWeight: genLocFilter ? 600 : 400, minWidth: "180px", background: "white", color: "#0F1720" }}>
              <option value="">All Locations</option>
              {allLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          {locGens.length > 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748B" }}>⚡ Generator</span>
              <select value={genGenFilter} onChange={e => setGenGenFilter(e.target.value)}
                style={{ padding: "8px 12px", border: "1px solid #EEF0F3", borderRadius: "8px", fontSize: "13px", minWidth: "160px", background: "white" }}>
                <option value="">All Generators</option>
                {locGens.map(g => <option key={g.generator_id} value={g.generator_id}>{g.label || `${g.kva} kVA – ${g.model}`}</option>)}
              </select>
            </div>
          )}
          {genLocFilter && (
            <button onClick={() => { setGenLocFilter(""); setGenGenFilter(""); }}
              style={{ alignSelf: "flex-end", padding: "8px 12px", border: "1px solid #EEF0F3", borderRadius: "8px", fontSize: "12px", cursor: "pointer", background: "white", color: "#64748B" }}>
              ✕ Clear
            </button>
          )}
        </div>
        {/* Row 2: Date range + search + apply */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748B" }}>From</span>
            <DateInput value={genDateFrom} onChange={e => setGenDateFrom(e.target.value)} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748B" }}>To</span>
            <DateInput value={genDateTo} onChange={e => setGenDateTo(e.target.value)} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748B" }}>Search</span>
            <input type="text" placeholder="Search…" value={genSearch} onChange={e => setGenSearch(e.target.value)}
              style={{ padding: "7px 10px", border: "1px solid #EEF0F3", borderRadius: "8px", fontSize: "13px", minWidth: "160px" }} />
          </div>
          <button onClick={loadGeneratorData}
            style={{ padding: "8px 18px", backgroundColor: "#0F1720", color: "white", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
            {loadingGen ? "Loading…" : "Apply"}
          </button>
        </div>
      </div>
    );

    // ── Summary cards ──────────────────────────────────────────────────────
    const totalLitres   = genFuelRows.reduce((s, r) => s + r.qty_litres, 0);
    const totalFuelCost = genFuelRows.reduce((s, r) => s + r.total_cost, 0);
    const totalMaintCost = genMaintRows.reduce((s, r) => s + r.total_cost, 0);
    const avgLph = genSummary.length > 0
      ? genSummary.filter(r => r.avg_litres_per_hour != null).reduce((s, r) => s + (r.avg_litres_per_hour ?? 0), 0) / Math.max(1, genSummary.filter(r => r.avg_litres_per_hour != null).length)
      : null;

    const CARD_ACTIONS: Record<string, GenTabView> = {
      "Total Litres": "diesel",
      "Fuel Cost":    "diesel",
      "Avg L/hr":     "diesel",
      "Maint Cost":   "maintenance",
      "Generators":   "master",
    };

    const summaryCards = (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "12px", marginBottom: "20px" }}>
        {[
          { label: "Total Litres",   value: `${Math.round(totalLitres).toLocaleString("en-PK")} L`, colour: COLOURS.NAVY },
          { label: "Fuel Cost",      value: PKR(totalFuelCost),    colour: COLOURS.AMBER },
          { label: "Maint Cost",     value: PKR(totalMaintCost),   colour: "#7C3AED" },
          { label: "Avg L/hr",       value: avgLph != null ? `${avgLph.toFixed(2)} L/hr` : "—", colour: COLOURS.SLATE },
          { label: "Generators",     value: genSummary.length.toString(), colour: COLOURS.GREEN },
        ].map(c => {
          const isActive = genActiveCard === c.label;
          return (
            <div key={c.label}
              onClick={() => {
                const target = CARD_ACTIONS[c.label];
                if (target) {
                  setGenTabView(target);
                  setGenActiveCard(isActive ? null : c.label);
                }
              }}
              style={{
                background: COLOURS.CARD,
                border: isActive ? `2px solid ${c.colour}` : `1px solid ${COLOURS.HAIRLINE}`,
                borderRadius: "12px",
                padding: isActive ? "15px" : "16px",
                borderTop: `3px solid ${c.colour}`,
                cursor: "pointer",
                transition: "box-shadow 0.15s",
                boxShadow: isActive ? `0 0 0 3px ${c.colour}22` : "none",
                userSelect: "none" as const,
              }}
            >
              <p style={{ margin: "0 0 4px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: COLOURS.SLATE }}>
                {c.label}
              </p>
              <p style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: COLOURS.NAVY }}>{c.value}</p>
              <p style={{ margin: "4px 0 0", fontSize: "10px", color: c.colour, fontWeight: 600 }}>
                {isActive ? "✓ viewing" : `→ ${CARD_ACTIONS[c.label] === "diesel" ? "Diesel Log" : CARD_ACTIONS[c.label] === "maintenance" ? "Maintenance" : "Master"}`}
              </p>
            </div>
          );
        })}
      </div>
    );

    const TH: React.CSSProperties = { padding: "8px 10px", textAlign: "left", fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, whiteSpace: "nowrap" };
    const TD: React.CSSProperties = { padding: "9px 10px", fontSize: "13px", color: COLOURS.NAVY, borderBottom: `1px solid ${COLOURS.HAIRLINE}`, whiteSpace: "nowrap" };

    // ── Diesel sub-tab ─────────────────────────────────────────────────────
    const dieselView = (
      <div>
        {summaryCards}
        {filterBar}

        {/* Generator status table */}
        <div style={{ background: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "12px", padding: "16px", marginBottom: "20px", overflowX: "auto" }}>
          <p style={{ margin: "0 0 12px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: COLOURS.SLATE }}>
            🔋 Generator Status{selectedLocName ? ` — ${selectedLocName}` : ""}
          </p>
          {(() => {
            const rows = genLocFilter
              ? genSummary.filter(r => r.location_name === selectedLocName)
              : genSummary;
            return rows.length === 0 ? (
              <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No generators found.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Generator","Location","Last Refuel","Last Service","Days Since Refuel","Days Since Service","Total Litres","Avg L/hr"].map(h =>
                      <th key={h} style={TH}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.generator_id}>
                      <td style={TD}><strong>{r.generator_label}</strong> <span style={{ fontSize: "11px", color: COLOURS.SLATE }}>{r.kva}KVA</span></td>
                      <td style={TD}>{r.location_name}</td>
                      <td style={TD}>{r.last_refuel_date  ? formatDateUK(r.last_refuel_date)  : "—"}</td>
                      <td style={TD}>{r.last_service_date ? formatDateUK(r.last_service_date) : "—"}</td>
                      <td style={TD}>{daysBadge(r.days_since_refuel,  7, 14)  ?? "—"}</td>
                      <td style={TD}>{daysBadge(r.days_since_service, 7, 14) ?? "—"}</td>
                      <td style={TD}>{Math.round(r.total_litres).toLocaleString("en-PK")} L</td>
                      <td style={TD}>{NUM(r.avg_litres_per_hour, 2)} L/hr</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}
        </div>

        {/* Fuel log table */}
        <div style={{ background: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "12px", padding: "16px", overflowX: "auto" }}>
          <p style={{ margin: "0 0 12px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: COLOURS.SLATE }}>
            ⛽ Diesel Refuel Log{selectedLocName ? ` — ${selectedLocName}` : ""} <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>({genFuelRows.length} entries)</span>
          </p>
          {genFuelRows.length === 0 ? (
            <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No fuel entries for this period.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Date","Generator","Location","Prev Hrs","Present Hrs","Hrs Run","Qty (L)","Rate/L","Total Cost","L/hr","Cost/hr","Remarks",""].map(h =>
                    <th key={h} style={TH}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {genFuelRows.map(r => (
                  <tr key={r.id}>
                    <td style={TD}>{formatDateUK(r.refuel_date)}</td>
                    <td style={TD}>{r.generator_label}</td>
                    <td style={TD}>{r.location_name}</td>
                    <td style={TD}>{r.previous_hours ?? "—"}</td>
                    <td style={TD}>{r.present_hours}</td>
                    <td style={TD}>{r.hours_run ?? "—"}</td>
                    <td style={TD}>{r.qty_litres.toFixed(1)}</td>
                    <td style={TD}>{PKR(r.rate_per_litre)}</td>
                    <td style={TD}>{PKR(r.total_cost)}</td>
                    <td style={TD}>{NUM(r.litres_per_hour, 2)}</td>
                    <td style={TD}>{NUM(r.cost_per_hour, 0) !== "—" ? PKR(r.cost_per_hour) : "—"}</td>
                    <td style={{ ...TD, maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis" }}>{r.remarks ?? "—"}</td>
                    <td style={TD}>
                      {ctx && isAdminTier(ctx) && (
                        <button onClick={() => setEditingGenFuel(r)}
                          style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", border: `1px solid ${COLOURS.HAIRLINE}`, background: "white", cursor: "pointer", color: COLOURS.NAVY }}>
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );

    // ── Maintenance sub-tab ────────────────────────────────────────────────
    const MAINT_COLS: [string, keyof GenMaintRow][] = [
      ["Engine Oil", "engine_oil"], ["Oil Filter", "oil_filter"], ["Fuel Filter", "fuel_filter"],
      ["Air Filter", "air_filter"], ["Radiator",   "radiator_service"], ["Periodic", "periodic_maintenance"],
      ["Other Mech", "other_mechanical_work"], ["Others", "others"],
    ];

    const maintView = (
      <div>
        {summaryCards}
        {filterBar}
        <div style={{ background: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "12px", padding: "16px", overflowX: "auto" }}>
          <p style={{ margin: "0 0 12px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: COLOURS.SLATE }}>
            🔧 Maintenance Log{selectedLocName ? ` — ${selectedLocName}` : ""} <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>({genMaintRows.length} entries)</span>
          </p>
          {genMaintRows.length === 0 ? (
            <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No maintenance entries for this period.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={TH}>Date</th>
                  <th style={TH}>Generator</th>
                  <th style={TH}>Location</th>
                  {MAINT_COLS.map(([h]) => <th key={h} style={TH}>{h}</th>)}
                  <th style={TH}>Total</th>
                  <th style={TH}></th>
                </tr>
              </thead>
              <tbody>
                {genMaintRows.map(r => (
                  <tr key={r.id}>
                    <td style={TD}>{formatDateUK(r.maintenance_date)}</td>
                    <td style={TD}>{r.generator_label}</td>
                    <td style={TD}>{r.location_name}</td>
                    {MAINT_COLS.map(([, key]) => (
                      <td key={key} style={TD}>
                        {(r[key] as number) > 0 ? PKR(r[key] as number) : <span style={{ color: COLOURS.SLATE }}>—</span>}
                      </td>
                    ))}
                    <td style={{ ...TD, fontWeight: 700 }}>{PKR(r.total_cost)}</td>
                    <td style={TD}>
                      {ctx && isAdminTier(ctx) && (
                        <button onClick={() => setEditingGenMaint(r)}
                          style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", border: `1px solid ${COLOURS.HAIRLINE}`, background: "white", cursor: "pointer", color: COLOURS.NAVY }}>
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );

    // ── Master / settings sub-tab ──────────────────────────────────────────
    // Group generators by location for card display
    const masterByLocation = genMaster.reduce<Record<string, { locName: string; gens: GenMasterRow[] }>>((acc, g) => {
      if (!acc[g.location_id]) acc[g.location_id] = { locName: g.location_name, gens: [] };
      acc[g.location_id].gens.push(g);
      return acc;
    }, {});

    const masterView = (
      <div>
        {/* Header row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div>
            <p style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>Generator Master List</p>
            <p style={{ margin: "2px 0 0", fontSize: "11px", color: COLOURS.SLATE }}>
              ⚡ Changes here sync automatically to the Daily Entry page
            </p>
          </div>
          {ctx && isAdminTier(ctx) && (
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => { setShowGenThresholds(v => !v); }}
                style={{ padding: "6px 12px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "12px", cursor: "pointer", background: "white", color: COLOURS.NAVY }}>
                ⚙ Thresholds
              </button>
              <button onClick={() => { setEditingGenMaster(null); setGenMasterForm({ location_id:"", kva:"", model:"", label:"", is_active:true }); setShowGenMasterForm(true); }}
                style={{ padding: "6px 12px", backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "8px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
                + Add Generator
              </button>
            </div>
          )}
        </div>

        {/* Thresholds panel */}
        {showGenThresholds && ctx && isAdminTier(ctx) && (
          <div style={{ background: "#FFFBEB", border: `1px solid #FDE68A`, borderRadius: "12px", padding: "16px", marginBottom: "16px" }}>
            <p style={{ margin: "0 0 12px", fontSize: "12px", fontWeight: 700, color: COLOURS.AMBER }}>⚙ Alert Thresholds</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "10px" }}>
              {[
                { label: "Unusual Consumption %", key: "unusual_pct", hint: "flag if L/hr varies by this %" },
                { label: "Service Interval (hrs)", key: "service_hours", hint: "recommended service hours" },
                { label: "Amber (days since refuel)", key: "days_amber", hint: "shows amber warning" },
                { label: "Red (days since refuel)", key: "days_red", hint: "shows red alert" },
              ].map(f => (
                <label key={f.key}>
                  <span style={{ fontSize: "10px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {f.label}
                  </span>
                  <input type="number" min="0" value={genThreshForm[f.key as keyof typeof genThreshForm]}
                    onChange={e => setGenThreshForm(t => ({ ...t, [f.key]: e.target.value }))}
                    style={{ width: "100%", padding: "6px 8px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "6px", fontSize: "12px", boxSizing: "border-box" }} />
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
              <button disabled={savingGenThresh} onClick={async () => {
                setSavingGenThresh(true);
                try {
                  const res = await authFetch("/api/admin/generators?type=upsert_thresholds", {
                    method: "POST",
                    body: JSON.stringify(genThreshForm),
                  });
                  if (res.ok) { showToast("Thresholds saved"); setShowGenThresholds(false); }
                  else { const j = await res.json(); showToast(j.error || "Failed to save", "error"); }
                } finally { setSavingGenThresh(false); }
              }} style={{ padding: "6px 14px", backgroundColor: COLOURS.GREEN, color: "white", border: "none", borderRadius: "8px", fontWeight: 600, fontSize: "12px", cursor: savingGenThresh ? "default" : "pointer", opacity: savingGenThresh ? 0.7 : 1 }}>
                {savingGenThresh ? "Saving…" : "Save"}
              </button>
              <button onClick={() => setShowGenThresholds(false)}
                style={{ padding: "6px 12px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "12px", cursor: "pointer", background: "white", color: COLOURS.NAVY }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Generator cards grouped by location */}
        {genMaster.length === 0 ? (
          <div style={{ background: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "12px", padding: "24px", textAlign: "center" }}>
            <p style={{ color: COLOURS.SLATE, fontSize: "13px", margin: 0 }}>No generators set up yet. Click + Add Generator to begin.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {Object.entries(masterByLocation).sort(([,a],[,b]) => a.locName.localeCompare(b.locName)).map(([locId, { locName, gens }]) => (
              <div key={locId} style={{ background: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "12px", padding: "12px 16px" }}>
                {/* Location header */}
                <p style={{ margin: "0 0 10px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: COLOURS.SLATE }}>
                  📍 {locName}
                </p>
                {/* Generator mini-cards */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {gens.map(g => (
                    <div key={g.id} style={{
                      display: "flex", alignItems: "center", gap: "8px",
                      padding: "6px 10px", borderRadius: "8px",
                      border: `1px solid ${g.is_active ? COLOURS.HAIRLINE : "#E2E8F0"}`,
                      background: g.is_active ? "white" : "#F8FAFC",
                      opacity: g.is_active ? 1 : 0.6,
                    }}>
                      <span style={{ fontSize: "16px" }}>⚡</span>
                      <div>
                        <p style={{ margin: 0, fontSize: "12px", fontWeight: 700, color: COLOURS.NAVY }}>
                          {g.label || `${g.kva} kVA`}
                        </p>
                        <p style={{ margin: 0, fontSize: "11px", color: COLOURS.SLATE }}>
                          {g.kva} kVA · {g.model}
                        </p>
                      </div>
                      <span style={{
                        fontSize: "10px", fontWeight: 600, padding: "1px 6px", borderRadius: "20px",
                        backgroundColor: g.is_active ? "#F0FDF4" : "#F1F5F9",
                        color: g.is_active ? COLOURS.GREEN : COLOURS.SLATE,
                      }}>
                        {g.is_active ? "✓" : "off"}
                      </span>
                      {ctx && isAdminTier(ctx) && (
                        <button onClick={() => {
                          setEditingGenMaster(g);
                          setGenMasterForm({ location_id: g.location_id, kva: String(g.kva), model: g.model, label: g.label ?? "", is_active: g.is_active });
                          setShowGenMasterForm(true);
                        }} style={{ fontSize: "11px", padding: "2px 6px", borderRadius: "4px", border: `1px solid ${COLOURS.HAIRLINE}`, background: "white", cursor: "pointer", color: COLOURS.SLATE }}>
                          ✎
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );


    // ─────────────────────────────────────────────────────────────────────────
    // ANALYTICS VIEW
    // Pure SVG/CSS charts. All calculations in Postgres (GOLDEN RULE).
    // ─────────────────────────────────────────────────────────────────────────
    const PALETTE = ["#0F1720","#0F7B5F","#B4791F","#3B82F6","#8B5CF6","#EC4899","#06B6D4","#F59E0B"];

    const fmtK = (n: number) => n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n/1_000).toFixed(0)}K` : String(Math.round(n));
    const fmtPKR = (n: number) => `PKR ${fmtK(n)}`;
    const fmtL   = (n: number) => `${fmtK(n)} L`;

    // Donut chart (pure SVG)
    const DonutChart = ({ data, title }: { data: {label:string;value:number;color:string}[]; title:string }) => {
      const total = data.reduce((s, d) => s + d.value, 0);
      if (total === 0) return (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"8px" }}>
          <div style={{ fontSize:"12px", fontWeight:700, color:COLOURS.NAVY, textTransform:"uppercase", letterSpacing:"0.05em" }}>{title}</div>
          <div style={{ fontSize:"12px", color:COLOURS.SLATE }}>No data</div>
        </div>
      );
      let angle = -90;
      const segments = data.map(d => {
        const sweep = (d.value / total) * 360;
        const rad = (a: number) => (a * Math.PI) / 180;
        const x1 = 50 + 40 * Math.cos(rad(angle));
        const y1 = 50 + 40 * Math.sin(rad(angle));
        angle += sweep;
        const x2 = 50 + 40 * Math.cos(rad(angle));
        const y2 = 50 + 40 * Math.sin(rad(angle));
        const large = sweep > 180 ? 1 : 0;
        return { ...d, path: `M 50 50 L ${x1.toFixed(2)} ${y1.toFixed(2)} A 40 40 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`, pct: ((d.value/total)*100).toFixed(1) };
      });
      return (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"10px" }}>
          <div style={{ fontSize:"12px", fontWeight:700, color:COLOURS.NAVY, textTransform:"uppercase", letterSpacing:"0.05em" }}>{title}</div>
          <svg viewBox="0 0 100 100" style={{ width:"160px", height:"160px" }}>
            {segments.map((seg, i) => (
              <path key={i} d={seg.path} fill={seg.color} stroke="white" strokeWidth="1.5">
                <title>{seg.label}: {seg.pct}%</title>
              </path>
            ))}
            <circle cx="50" cy="50" r="25" fill="white" />
            <text x="50" y="53" textAnchor="middle" fontSize="8" fontWeight="700" fill={COLOURS.NAVY}>Fleet</text>
          </svg>
          <div style={{ display:"flex", flexDirection:"column", gap:"4px", width:"100%", maxWidth:"200px" }}>
            {segments.map((seg, i) => (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:"6px", fontSize:"11px" }}>
                <div style={{ width:"10px", height:"10px", borderRadius:"2px", background:seg.color, flexShrink:0 }} />
                <span style={{ color:COLOURS.NAVY, fontWeight:600, flex:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{seg.label}</span>
                <span style={{ color:COLOURS.SLATE, fontWeight:700 }}>{seg.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      );
    };

    // Horizontal bar (for per-location metric cards)
    const MiniBar = ({ value, max, color }: { value: number; max: number; color: string }) => {
      const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
      return (
        <div style={{ height:"6px", background:COLOURS.HAIRLINE, borderRadius:"3px", overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${pct}%`, background:color, borderRadius:"3px", transition:"width 0.4s" }} />
        </div>
      );
    };

    // Efficiency ranking medal
    const RankBadge = ({ rank }: { rank: number }) => {
      const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
      return <span style={{ fontSize: rank <= 3 ? "20px" : "13px", fontWeight: 700, color: COLOURS.NAVY }}>{medal}</span>;
    };

    const maxFuelCost  = Math.max(...analyticsRows.map(r => r.total_fuel_cost), 1);
    const maxMaintCost = Math.max(...analyticsRows.map(r => r.total_maint_cost), 1);
    const maxLitres    = Math.max(...analyticsRows.map(r => r.total_litres), 1);
    const maxLperHr    = Math.max(...analyticsRows.map(r => r.avg_litres_per_hr ?? 0), 1);
    const maxCostPerHr = Math.max(...analyticsRows.map(r => r.avg_cost_per_hr ?? 0), 1);

    // Date filter quick-select
    const setAnalyticsPeriodFn = (period: "month" | "q3" | "ytd" | "custom") => {
      setAnalyticsPeriod(period);
      let from = analyticsFrom;
      let to   = TODAY;
      if (period === "month") { from = firstOfMonth(); }
      if (period === "q3")    { from = xMonthsAgo(3); }
      if (period === "ytd")   { from = startOfYear(); }
      setAnalyticsFrom(from);
      setAnalyticsTo(to);
      if (period !== "custom") fetchGenAnalytics(from, to);
    };

    const analyticsView = (
      <div>
        {/* Date filter strip */}
        <div style={{ background:"white", border:`1px solid ${COLOURS.HAIRLINE}`, borderRadius:"12px", padding:"14px 16px", marginBottom:"20px", display:"flex", alignItems:"center", gap:"10px", flexWrap:"wrap" }}>
          <span style={{ fontSize:"11px", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", color:COLOURS.SLATE }}>Period</span>
          {(["month","q3","ytd","custom"] as const).map(p => (
            <button key={p} onClick={() => setAnalyticsPeriodFn(p)} style={{
              padding:"6px 14px", borderRadius:"20px", fontSize:"12px", fontWeight:600, cursor:"pointer",
              background: analyticsPeriod === p ? COLOURS.NAVY : "transparent",
              color:      analyticsPeriod === p ? "white"      : COLOURS.SLATE,
              border:`1px solid ${analyticsPeriod === p ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
            }}>
              {p === "month" ? "This Month" : p === "q3" ? "Last 3 Months" : p === "ytd" ? "YTD" : "Custom"}
            </button>
          ))}
          {analyticsPeriod === "custom" && (
            <>
              <input type="date" value={analyticsFrom} onChange={e => setAnalyticsFrom(e.target.value)}
                style={{ padding:"6px 10px", border:`1px solid ${COLOURS.HAIRLINE}`, borderRadius:"8px", fontSize:"12px" }} />
              <span style={{ color:COLOURS.SLATE, fontSize:"12px" }}>→</span>
              <input type="date" value={analyticsTo} onChange={e => setAnalyticsTo(e.target.value)}
                style={{ padding:"6px 10px", border:`1px solid ${COLOURS.HAIRLINE}`, borderRadius:"8px", fontSize:"12px" }} />
              <button onClick={() => fetchGenAnalytics(analyticsFrom, analyticsTo)} style={{
                padding:"6px 16px", borderRadius:"20px", fontSize:"12px", fontWeight:600, cursor:"pointer",
                background:COLOURS.NAVY, color:"white", border:"none",
              }}>Apply</button>
            </>
          )}
          <span style={{ marginLeft:"auto", fontSize:"11px", color:COLOURS.SLATE }}>
            {analyticsFrom} → {analyticsTo}
          </span>
        </div>

        {/* Loading / error */}
        {loadingAnalytics && (
          <div style={{ textAlign:"center", padding:"40px", color:COLOURS.SLATE, fontSize:"14px" }}>
            Loading analytics…
          </div>
        )}
        {analyticsError && !loadingAnalytics && (
          <div style={{ background:"#FEF2F2", border:"1px solid #FECACA", borderRadius:"10px", padding:"14px 16px", color:"#B3261E", fontSize:"13px", marginBottom:"20px" }}>
            ⚠ {analyticsError}
          </div>
        )}

        {!loadingAnalytics && analyticsRows.length === 0 && !analyticsError && (
          <div style={{ textAlign:"center", padding:"60px", color:COLOURS.SLATE, fontSize:"14px" }}>
            No data for selected period. Try a wider date range.
          </div>
        )}

        {!loadingAnalytics && analyticsRows.length > 0 && (
          <>
            {/* ── Efficiency Ranking Strip ─────────────────────────────── */}
            <div style={{ background:"white", border:`1px solid ${COLOURS.HAIRLINE}`, borderRadius:"12px", padding:"18px 20px", marginBottom:"20px" }}>
              <div style={{ fontSize:"12px", fontWeight:700, color:COLOURS.NAVY, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:"14px" }}>
                🏆 Efficiency Ranking — Cost per Hour (PKR)
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                {[...analyticsRows].sort((a,b) => a.efficiency_rank - b.efficiency_rank).map(r => {
                  const costPerHr = r.avg_cost_per_hr ?? 0;
                  const barPct    = maxCostPerHr > 0 ? (costPerHr / maxCostPerHr) * 100 : 0;
                  const barColor  = r.efficiency_rank === 1 ? COLOURS.GREEN : r.efficiency_rank === 2 ? "#3B82F6" : r.efficiency_rank === 3 ? "#8B5CF6" : COLOURS.SLATE;
                  return (
                    <div key={r.location_id} style={{ display:"grid", gridTemplateColumns:"30px 1fr auto 90px", alignItems:"center", gap:"10px" }}>
                      <RankBadge rank={r.efficiency_rank} />
                      <div>
                        <div style={{ fontSize:"13px", fontWeight:700, color:COLOURS.NAVY }}>{r.location_name}</div>
                        <div style={{ height:"6px", background:COLOURS.HAIRLINE, borderRadius:"3px", overflow:"hidden", marginTop:"4px" }}>
                          <div style={{ height:"100%", width:`${barPct}%`, background:barColor, borderRadius:"3px" }} />
                        </div>
                      </div>
                      <div style={{ fontSize:"13px", fontWeight:700, color:barColor, textAlign:"right", whiteSpace:"nowrap" }}>
                        PKR {costPerHr.toFixed(0)}/hr
                      </div>
                      <div style={{ fontSize:"11px", color:COLOURS.SLATE, textAlign:"right" }}>
                        {r.total_hours_run.toFixed(0)} hrs
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Donut Charts Row ──────────────────────────────────────── */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"16px", marginBottom:"20px" }}>
              <div style={{ background:"white", border:`1px solid ${COLOURS.HAIRLINE}`, borderRadius:"12px", padding:"20px", display:"flex", justifyContent:"center" }}>
                <DonutChart
                  title="⛽ Fuel Cost Share"
                  data={analyticsRows.map((r,i) => ({ label:r.location_name, value:r.total_fuel_cost, color:PALETTE[i % PALETTE.length] }))}
                />
              </div>
              <div style={{ background:"white", border:`1px solid ${COLOURS.HAIRLINE}`, borderRadius:"12px", padding:"20px", display:"flex", justifyContent:"center" }}>
                <DonutChart
                  title="🔧 Maintenance Cost Share"
                  data={analyticsRows.map((r,i) => ({ label:r.location_name, value:r.total_maint_cost, color:PALETTE[i % PALETTE.length] }))}
                />
              </div>
            </div>

            {/* ── Per-Location Metric Cards ─────────────────────────────── */}
            {/* Location filter */}
            <div style={{ display:"flex", alignItems:"center", gap:"8px", flexWrap:"wrap", marginBottom:"14px" }}>
              <span style={{ fontSize:"11px", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", color:COLOURS.SLATE }}>Location</span>
              <button onClick={() => setAnalyticsLocFilter("all")} style={{ padding:"5px 14px", borderRadius:"20px", fontSize:"12px", fontWeight:600, cursor:"pointer", background:analyticsLocFilter==="all"?COLOURS.NAVY:"transparent", color:analyticsLocFilter==="all"?"white":COLOURS.SLATE, border:`1px solid ${analyticsLocFilter==="all"?COLOURS.NAVY:COLOURS.HAIRLINE}` }}>All ({analyticsRows.length})</button>
              {[...analyticsRows].sort((a,b) => a.efficiency_rank - b.efficiency_rank).map(r => (
                <button key={r.location_id} onClick={() => setAnalyticsLocFilter(analyticsLocFilter===r.location_id?"all":r.location_id)} style={{ padding:"5px 14px", borderRadius:"20px", fontSize:"12px", fontWeight:600, cursor:"pointer", background:analyticsLocFilter===r.location_id?COLOURS.NAVY:"transparent", color:analyticsLocFilter===r.location_id?"white":COLOURS.SLATE, border:`1px solid ${analyticsLocFilter===r.location_id?COLOURS.NAVY:COLOURS.HAIRLINE}` }}>
                  {r.location_name}
                </button>
              ))}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(280px, 1fr))", gap:"14px" }}>
              {[...analyticsRows].sort((a,b) => a.efficiency_rank - b.efficiency_rank).filter(r => analyticsLocFilter==="all" || r.location_id===analyticsLocFilter).map((r,i) => {
                const totalCost = r.total_fuel_cost + r.total_maint_cost;
                const fuelRatio = totalCost > 0 ? (r.total_fuel_cost / totalCost * 100) : 0;
                const maintRatio = totalCost > 0 ? (r.total_maint_cost / totalCost * 100) : 0;
                const accent = PALETTE[i % PALETTE.length];
                return (
                  <div key={r.location_id} style={{ background:"white", border:`1px solid ${COLOURS.HAIRLINE}`, borderRadius:"12px", overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                    {/* Card header */}
                    <div style={{ background:accent, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div>
                        <div style={{ fontSize:"14px", fontWeight:700, color:"white" }}>{r.location_name}</div>
                        <div style={{ fontSize:"11px", color:"rgba(255,255,255,0.75)" }}>{r.generator_count} generator{r.generator_count !== 1 ? "s" : ""}</div>
                      </div>
                      <RankBadge rank={r.efficiency_rank} />
                    </div>
                    {/* Metric grid */}
                    <div style={{ padding:"14px 16px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px" }}>
                      {[
                        { label:"Total Litres",    value:fmtL(r.total_litres),          sub:"consumed", color:COLOURS.NAVY },
                        { label:"Fuel Cost",       value:fmtPKR(r.total_fuel_cost),     sub:`${r.fuel_share_pct}% of fleet`, color:COLOURS.NAVY },
                        { label:"Maint Cost",      value:fmtPKR(r.total_maint_cost),    sub:`${r.maint_event_count} events`, color:COLOURS.AMBER },
                        { label:"Hours Run",       value:`${r.total_hours_run.toFixed(0)} hr`, sub:"total",       color:COLOURS.NAVY },
                      ].map(m => (
                        <div key={m.label} style={{ background:"#F8FAFC", borderRadius:"8px", padding:"10px 12px" }}>
                          <div style={{ fontSize:"10px", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em", color:COLOURS.SLATE, marginBottom:"4px" }}>{m.label}</div>
                          <div style={{ fontSize:"16px", fontWeight:700, color:m.color }}>{m.value}</div>
                          <div style={{ fontSize:"10px", color:COLOURS.SLATE, marginTop:"2px" }}>{m.sub}</div>
                        </div>
                      ))}
                    </div>
                    {/* Efficiency bars */}
                    <div style={{ padding:"0 16px 14px" }}>
                      <div style={{ fontSize:"10px", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em", color:COLOURS.SLATE, marginBottom:"8px" }}>Efficiency Indicators</div>
                      <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                        <div>
                          <div style={{ display:"flex", justifyContent:"space-between", fontSize:"11px", marginBottom:"3px" }}>
                            <span style={{ color:COLOURS.SLATE }}>L/hr (avg)</span>
                            <span style={{ fontWeight:700, color:COLOURS.NAVY }}>{(r.avg_litres_per_hr ?? 0).toFixed(2)}</span>
                          </div>
                          <MiniBar value={r.avg_litres_per_hr ?? 0} max={maxLperHr} color="#3B82F6" />
                        </div>
                        <div>
                          <div style={{ display:"flex", justifyContent:"space-between", fontSize:"11px", marginBottom:"3px" }}>
                            <span style={{ color:COLOURS.SLATE }}>PKR/hr (avg)</span>
                            <span style={{ fontWeight:700, color:COLOURS.NAVY }}>{(r.avg_cost_per_hr ?? 0).toFixed(0)}</span>
                          </div>
                          <MiniBar value={r.avg_cost_per_hr ?? 0} max={maxCostPerHr} color={accent} />
                        </div>
                        <div>
                          <div style={{ display:"flex", justifyContent:"space-between", fontSize:"11px", marginBottom:"3px" }}>
                            <span style={{ color:COLOURS.SLATE }}>Fuel vs Maint split</span>
                            <span style={{ fontWeight:700, color:COLOURS.NAVY }}>{fuelRatio.toFixed(0)}% / {maintRatio.toFixed(0)}%</span>
                          </div>
                          <div style={{ height:"6px", borderRadius:"3px", overflow:"hidden", display:"flex" }}>
                            <div style={{ height:"100%", width:`${fuelRatio}%`, background:COLOURS.NAVY }} />
                            <div style={{ height:"100%", width:`${maintRatio}%`, background:COLOURS.AMBER }} />
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* Total cost footer */}
                    <div style={{ borderTop:`1px solid ${COLOURS.HAIRLINE}`, padding:"10px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <span style={{ fontSize:"11px", color:COLOURS.SLATE, fontWeight:600 }}>Total Operating Cost</span>
                      <span style={{ fontSize:"14px", fontWeight:700, color:COLOURS.NAVY }}>PKR {fmtK(totalCost)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
    // END ANALYTICS VIEW

    return (
      <div>
        {/* Sub-tab switcher */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
          {subTab("diesel",      "⛽ Diesel Log")}
          {subTab("maintenance", "🔧 Maintenance")}
          {subTab("master",      "⚙ Master / Settings")}
          {subTab("analytics",   "📊 Analytics")}
        </div>
        {genTabView === "diesel"      && dieselView}
        {genTabView === "maintenance" && maintView}
        {genTabView === "master"      && masterView}
        {genTabView === "analytics"   && analyticsView}

        {/* ── Edit Fuel modal ── */}
        {editingGenFuel && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
            onClick={() => { if (!savingGenFuel) setEditingGenFuel(null); }}>
            <div style={{ background: "white", borderRadius: "14px", padding: "24px 28px", width: "480px", maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", maxHeight: "90vh", overflowY: "auto" }}
              onClick={e => e.stopPropagation()}>
              <h3 style={{ margin: "0 0 18px", fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>Edit Fuel Entry</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <label style={{ gridColumn: "1/-1" }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Refuel Date</span>
                  <DateInput value={editingGenFuel.refuel_date} onChange={e => setEditingGenFuel(f => f && ({ ...f, refuel_date: e.target.value }))} />
                </label>
                {[
                  { label: "Previous Hours", key: "previous_hours" },
                  { label: "Present Hours",  key: "present_hours" },
                  { label: "Rate/Litre (PKR)", key: "rate_per_litre" },
                  { label: "Qty Litres",     key: "qty_litres" },
                ].map(f => (
                  <label key={f.key}>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{f.label}</span>
                    <input type="number" min="0" step="0.01"
                      value={(editingGenFuel as Record<string,unknown>)[f.key] as string ?? ""}
                      onChange={e => setEditingGenFuel(r => r && ({ ...r, [f.key]: e.target.value }))}
                      style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" }} />
                  </label>
                ))}
                <label style={{ gridColumn: "1/-1" }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Remarks</span>
                  <textarea rows={2} value={editingGenFuel.remarks ?? ""}
                    onChange={e => setEditingGenFuel(r => r && ({ ...r, remarks: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", resize: "vertical", boxSizing: "border-box" }} />
                </label>
              </div>
              <div style={{ display: "flex", gap: "8px", marginTop: "20px" }}>
                <button disabled={savingGenFuel} onClick={async () => {
                  setSavingGenFuel(true);
                  try {
                    const res = await authFetch("/api/admin/generators?type=fuel", {
                      method: "PATCH",
                      body: JSON.stringify(editingGenFuel),
                    });
                    if (res.ok) { showToast("Fuel entry updated"); setEditingGenFuel(null); loadGeneratorData(); }
                    else { const j = await res.json(); showToast(j.error || "Failed to save", "error"); }
                  } finally { setSavingGenFuel(false); }
                }} style={{ flex: 1, padding: "9px", backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "8px", fontWeight: 600, fontSize: "13px", cursor: savingGenFuel ? "default" : "pointer", opacity: savingGenFuel ? 0.7 : 1 }}>
                  {savingGenFuel ? "Saving…" : "Save Changes"}
                </button>
                <button disabled={savingGenFuel} onClick={async () => {
                  if (!window.confirm("Soft-delete this fuel entry?")) return;
                  setSavingGenFuel(true);
                  try {
                    const res = await authFetch(`/api/admin/generators?type=fuel&id=${editingGenFuel.id}&reason=Deleted by admin`, { method: "DELETE" });
                    if (res.ok) { showToast("Entry deleted"); setEditingGenFuel(null); loadGeneratorData(); }
                    else { const j = await res.json(); showToast(j.error || "Failed", "error"); }
                  } finally { setSavingGenFuel(false); }
                }} style={{ padding: "9px 14px", backgroundColor: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: "8px", fontWeight: 600, fontSize: "13px", cursor: savingGenFuel ? "default" : "pointer" }}>
                  Delete
                </button>
                <button disabled={savingGenFuel} onClick={() => setEditingGenFuel(null)}
                  style={{ padding: "9px 14px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", cursor: "pointer", background: "white", color: COLOURS.NAVY }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Edit Maintenance modal ── */}
        {editingGenMaint && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
            onClick={() => { if (!savingGenMaint) setEditingGenMaint(null); }}>
            <div style={{ background: "white", borderRadius: "14px", padding: "24px 28px", width: "520px", maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", maxHeight: "90vh", overflowY: "auto" }}
              onClick={e => e.stopPropagation()}>
              <h3 style={{ margin: "0 0 4px", fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>Edit Maintenance Entry</h3>
              <p style={{ margin: "0 0 18px", fontSize: "12px", color: COLOURS.SLATE }}>{editingGenMaint.generator_label} — {editingGenMaint.location_name}</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <label style={{ gridColumn: "1/-1" }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Service Date</span>
                  <DateInput value={editingGenMaint.maintenance_date} onChange={e => setEditingGenMaint(r => r && ({ ...r, maintenance_date: e.target.value }))} />
                </label>
                {[
                  ["Engine Oil","engine_oil"], ["Oil Filter","oil_filter"], ["Fuel Filter","fuel_filter"],
                  ["Air Filter","air_filter"], ["Radiator","radiator_service"], ["Periodic Maint","periodic_maintenance"],
                  ["Other Mech","other_mechanical_work"], ["Others","others"],
                ].map(([label, key]) => (
                  <label key={key}>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
                    <input type="number" min="0" step="0.01"
                      value={(editingGenMaint as Record<string,unknown>)[key] as string ?? "0"}
                      onChange={e => setEditingGenMaint(r => r && ({ ...r, [key]: parseFloat(e.target.value) || 0 }))}
                      style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" }} />
                  </label>
                ))}
                <label style={{ gridColumn: "1/-1" }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Remarks</span>
                  <textarea rows={2} value={editingGenMaint.remarks ?? ""}
                    onChange={e => setEditingGenMaint(r => r && ({ ...r, remarks: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", resize: "vertical", boxSizing: "border-box" }} />
                </label>
              </div>
              <div style={{ display: "flex", gap: "8px", marginTop: "20px" }}>
                <button disabled={savingGenMaint} onClick={async () => {
                  setSavingGenMaint(true);
                  try {
                    const res = await authFetch("/api/admin/generators?type=maintenance", {
                      method: "PATCH",
                      body: JSON.stringify(editingGenMaint),
                    });
                    if (res.ok) { showToast("Maintenance entry updated"); setEditingGenMaint(null); loadGeneratorData(); }
                    else { const j = await res.json(); showToast(j.error || "Failed to save", "error"); }
                  } finally { setSavingGenMaint(false); }
                }} style={{ flex: 1, padding: "9px", backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "8px", fontWeight: 600, fontSize: "13px", cursor: savingGenMaint ? "default" : "pointer", opacity: savingGenMaint ? 0.7 : 1 }}>
                  {savingGenMaint ? "Saving…" : "Save Changes"}
                </button>
                <button disabled={savingGenMaint} onClick={async () => {
                  if (!window.confirm("Soft-delete this maintenance entry?")) return;
                  setSavingGenMaint(true);
                  try {
                    const res = await authFetch(`/api/admin/generators?type=maintenance&id=${editingGenMaint.id}&reason=Deleted by admin`, { method: "DELETE" });
                    if (res.ok) { showToast("Entry deleted"); setEditingGenMaint(null); loadGeneratorData(); }
                    else { const j = await res.json(); showToast(j.error || "Failed", "error"); }
                  } finally { setSavingGenMaint(false); }
                }} style={{ padding: "9px 14px", backgroundColor: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: "8px", fontWeight: 600, fontSize: "13px", cursor: savingGenMaint ? "default" : "pointer" }}>
                  Delete
                </button>
                <button disabled={savingGenMaint} onClick={() => setEditingGenMaint(null)}
                  style={{ padding: "9px 14px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", cursor: "pointer", background: "white", color: COLOURS.NAVY }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Add/Edit Generator modal ── */}
        {showGenMasterForm && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
            onClick={() => { if (!savingGenMaster) setShowGenMasterForm(false); }}>
            <div style={{ background: "white", borderRadius: "14px", padding: "24px 28px", width: "440px", maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}
              onClick={e => e.stopPropagation()}>
              <h3 style={{ margin: "0 0 18px", fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>
                {editingGenMaster ? "Edit Generator" : "Add Generator"}
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <label style={{ gridColumn: "1/-1" }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Location</span>
                  <select value={genMasterForm.location_id} onChange={e => setGenMasterForm(f => ({ ...f, location_id: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" }}>
                    <option value="">Select location…</option>
                    {allLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </label>
                <label>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>KVA</span>
                  <input type="number" min="1" placeholder="e.g. 100" value={genMasterForm.kva}
                    onChange={e => setGenMasterForm(f => ({ ...f, kva: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" }} />
                </label>
                <label>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Model</span>
                  <input type="text" placeholder="e.g. Perkins" value={genMasterForm.model}
                    onChange={e => setGenMasterForm(f => ({ ...f, model: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" }} />
                </label>
                <label style={{ gridColumn: "1/-1" }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Label (optional)</span>
                  <input type="text" placeholder="e.g. Main Generator" value={genMasterForm.label}
                    onChange={e => setGenMasterForm(f => ({ ...f, label: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" }} />
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", gridColumn: "1/-1" }}>
                  <input type="checkbox" checked={genMasterForm.is_active}
                    onChange={e => setGenMasterForm(f => ({ ...f, is_active: e.target.checked }))} />
                  <span style={{ fontSize: "13px", color: COLOURS.NAVY }}>Active</span>
                </label>
              </div>
              <div style={{ display: "flex", gap: "8px", marginTop: "20px" }}>
                <button disabled={savingGenMaster || !genMasterForm.location_id || !genMasterForm.kva || !genMasterForm.model}
                  onClick={async () => {
                    setSavingGenMaster(true);
                    try {
                      const res = await authFetch("/api/admin/generators?type=upsert_generator", {
                        method: "POST",
                        body: JSON.stringify({ id: editingGenMaster?.id ?? null, ...genMasterForm }),
                      });
                      if (res.ok) {
                        showToast(editingGenMaster ? "Generator updated" : "Generator added");
                        setShowGenMasterForm(false);
                        setEditingGenMaster(null);
                        loadGeneratorData();
                      } else {
                        const j = await res.json();
                        showToast(j.error || "Failed to save", "error");
                      }
                    } finally { setSavingGenMaster(false); }
                  }}
                  style={{ flex: 1, padding: "9px", backgroundColor: COLOURS.GREEN, color: "white", border: "none", borderRadius: "8px", fontWeight: 600, fontSize: "13px", cursor: (savingGenMaster || !genMasterForm.location_id || !genMasterForm.kva || !genMasterForm.model) ? "default" : "pointer", opacity: (savingGenMaster || !genMasterForm.location_id || !genMasterForm.kva || !genMasterForm.model) ? 0.6 : 1 }}>
                  {savingGenMaster ? "Saving…" : editingGenMaster ? "Save Changes" : "Add Generator"}
                </button>
                <button disabled={savingGenMaster} onClick={() => { setShowGenMasterForm(false); setEditingGenMaster(null); }}
                  style={{ padding: "9px 14px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", cursor: "pointer", background: "white", color: COLOURS.NAVY }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  async function loadVisitorList() {
    setLoadingVisitors(true);
    try {
      const params = new URLSearchParams({
        date_from: visitorDateFrom, date_to: visitorDateTo,
        limit: String(visitorPageSize), offset: String(visitorPage * visitorPageSize),
      });
      if (visitorSearch)     params.set("search",     visitorSearch);
      if (visitorStatus)     params.set("status",     visitorStatus);
      if (visitorDeptFilter) params.set("department", visitorDeptFilter);
      const res  = await authFetch(`/api/visitors/list?${params}`);
      const data = await res.json();
      setVisitorRows(data.rows ?? []);
      setVisitorTotal(data.total ?? 0);
    } finally { setLoadingVisitors(false); }
  }

  async function loadVisitorKpi() {
    const params = new URLSearchParams({ date_from: visitorDateFrom, date_to: visitorDateTo });

    const [kpiRes, leagueRes, heatRes, excRes] = await Promise.all([
      authFetch(`/api/visitors/kpi?view=kpi&${params}`),
      authFetch(`/api/visitors/kpi?view=league&${params}`),
      authFetch(`/api/visitors/kpi?view=heatmap&${params}`),
      authFetch(`/api/visitors/kpi?view=exceptions&date_from=${visitorDateTo}&date_to=${visitorDateTo}`),
    ]);
    setVisitorKpi(await kpiRes.json());
    const league = await leagueRes.json();
    setVisitorDeptRows(league.by_department ?? []);
    setVisitorHostRows(league.by_host ?? []);
    setVisitorHeatmap(await heatRes.json());
    setVisitorExceptions(await excRes.json());
  }

  async function handleVisitorCheckout(id: string) {
    if (!(await confirm("Check out this visitor now?"))) return;
    await authFetch("/api/visitors/check-out", { method: "POST", body: JSON.stringify({ visitor_id: id }) });
    showToast("Visitor checked out");
    loadVisitorList();
    loadVisitorKpi();
  }

  function handleVisitorDelete(id: string) {
    setDeleteReason("");
    setDeleteVisitorId(id);
  }

  async function confirmVisitorDelete() {
    if (!deleteVisitorId || !deleteReason.trim()) return;
    await authFetch("/api/visitors/list", {
      method: "DELETE",
      body: JSON.stringify({ id: deleteVisitorId, delete_reason: deleteReason.trim() }),
    });
    setDeleteVisitorId(null);
    setDeleteReason("");
    showToast("Record deleted");
    loadVisitorList();
  }

  async function handleVisitorEdit() {
    if (!editingVisitor) return;
    setSavingVisitor(true);
    try {
      const payload: Record<string, unknown> = { ...editingVisitor };
      // Only include cnic/mobile if the user typed new values
      const rawCnic = editCnic.replace(/\D/g, "");
      if (rawCnic.length === 13) payload.cnic = rawCnic;
      const rawMobile = editMobile.trim();
      if (rawMobile) payload.mobile = rawMobile;
      const res = await authFetch("/api/visitors/list", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      if (!res.ok) { showToast("Save failed"); return; }
      showToast("Saved");
      setEditingVisitor(null);
      loadVisitorList();
    } finally { setSavingVisitor(false); }
  }

  // F10 — load visitor settings (admin only)
  async function loadVisitorSettings() {
    const res  = await authFetch("/api/visitors/settings");
    const data = await res.json();
    setVisitorSettings(data);
  }

  async function saveVisitorGlobalSettings() {
    if (!visitorSettings) return;
    setSettingsSaving(true);
    try {
      await authFetch("/api/visitors/settings", {
        method: "PATCH",
        body: JSON.stringify({
          overstay_threshold_mins: visitorSettings.overstay_threshold_mins,
          office_open_hour:        visitorSettings.office_open_hour,
          office_close_hour:       visitorSettings.office_close_hour,
          weekly_digest_email:     visitorSettings.weekly_digest_email,
        }),
      });
      showToast("Settings saved");
    } finally { setSettingsSaving(false); }
  }

  async function addPurposeThreshold() {
    const kw   = settingsNewKw.trim();
    const mins = parseInt(settingsNewMins, 10);
    if (!kw || isNaN(mins) || mins < 1) return;
    await authFetch("/api/visitors/settings", {
      method: "POST",
      body: JSON.stringify({ keyword: kw, threshold_mins: mins }),
    });
    setSettingsNewKw("");
    setSettingsNewMins("");
    loadVisitorSettings();
  }

  async function deletePurposeThreshold(keyword: string) {
    await authFetch(`/api/visitors/settings?keyword=${encodeURIComponent(keyword)}`, { method: "DELETE" });
    loadVisitorSettings();
  }

  async function handleVisitorPreview() {
    if (!visitorImportFile) return;
    setVisitorImportResult(null);
    const name = visitorImportFile.name.toLowerCase();
    if (name.endsWith(".csv")) {
      try {
        const text = await visitorImportFile.text();
        const lines = text.split("\n").filter((l) => l.trim());
        const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
        const dataRows = lines.slice(1);
        const firstFive = dataRows.slice(0, 5).map((line) => {
          const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
          return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""])) as unknown as VisitorImportPreviewRow;
        });
        setVisitorImportPreview(firstFive);
        setVisitorImportRowCount(dataRows.length);
      } catch {
        setVisitorImportPreview([]);
        setVisitorImportRowCount(0);
      }
    } else {
      // Excel — cannot parse client-side without a library; show file info only
      setVisitorImportPreview([]);
      setVisitorImportRowCount(-1);
    }
  }

  async function handleVisitorImport() {
    if (!visitorImportFile) return;
    setVisitorImporting(true);
    setVisitorImportResult(null);
    const form = new FormData();
    form.append("file", visitorImportFile);
    const res = await authFetch("/api/visitors/import", { method: "POST", body: form });
    const json = await res.json();
    setVisitorImportResult(json);
    setVisitorImporting(false);
    setVisitorImportPreview(null);
    setVisitorImportRowCount(0);
    if (json.imported > 0) loadVisitorList();
  }

  // Load visitors when tab becomes active
  useEffect(() => {
    if (activeTab === "visitors" && !checking) {
      loadVisitorList();
      loadVisitorKpi();
      if (ctx && isAdminTier(ctx)) loadVisitorSettings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, checking, visitorDateFrom, visitorDateTo, visitorPage]);

  // ── Render guard ───────────────────────────────────────────────────
  if (checking) return (
    <AuthWrapper>
      <main style={{ padding: "14px 18px" }}>
        <p style={{ color: COLOURS.SLATE }}>Checking permissions...</p>
      </main>
    </AuthWrapper>
  );

  const ALL_TABS: { id: TabId; label: string; widgetKey: string }[] = [
    { id: "registrations", label: "Registrations", widgetKey: "admin_ops.registrations" },
    { id: "payments",      label: "Payments",      widgetKey: "admin_ops.payments" },
    { id: "compliance",    label: "Compliance",    widgetKey: "admin_ops.compliance" },
    { id: "documents",     label: "Documents",     widgetKey: "admin_ops.documents" },
    { id: "operations",    label: "Operations",    widgetKey: "admin_ops.operations" },
    { id: "generators",    label: "Generators",    widgetKey: "admin_ops.generators" },
    { id: "visitors",      label: "Visitors",      widgetKey: "admin_ops.visitors" },
  ];
  // Only show tabs that are widget-visible for this user.
  const TABS = isVisitorOnly
    ? ALL_TABS.filter((t) => t.id === "visitors")
    : ALL_TABS.filter((t) => wv(t.widgetKey));
  // If the current activeTab was hidden, jump to the first visible one.
  const safeActiveTab: TabId = TABS.some((t) => t.id === activeTab) ? activeTab : (TABS[0]?.id ?? "registrations");


  function visitorPreset(label: string) {
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    if (label === "Today") { setVisitorDateFrom(fmt(today)); setVisitorDateTo(fmt(today)); }
    else if (label === "Yesterday") { const d = new Date(today); d.setDate(d.getDate()-1); setVisitorDateFrom(fmt(d)); setVisitorDateTo(fmt(d)); }
    else if (label === "This Week") { const d = new Date(today); d.setDate(d.getDate()-6); setVisitorDateFrom(fmt(d)); setVisitorDateTo(fmt(today)); }
    else if (label === "This Month") { const d = new Date(today.getFullYear(), today.getMonth(), 1); setVisitorDateFrom(fmt(d)); setVisitorDateTo(fmt(today)); }
    else if (label === "Last Month") {
      const first = new Date(today.getFullYear(), today.getMonth()-1, 1);
      const last  = new Date(today.getFullYear(), today.getMonth(), 0);
      setVisitorDateFrom(fmt(first)); setVisitorDateTo(fmt(last));
    }
    setVisitorPage(0);
  }

  // Build month quick-jump options (current month going back 12 months)
  const visitorMonthOptions = (() => {
    const opts: { label: string; from: string; to: string }[] = [];
    const today = new Date();
    for (let i = 0; i < 13; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const from = d.toISOString().slice(0, 10);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const to = last.toISOString().slice(0, 10);
      opts.push({
        label: d.toLocaleDateString("en-GB", { month: "short", year: "numeric" }),
        from,
        to,
      });
    }
    return opts;
  })();

  // ── Heat-map max for colour scale ──
  const heatMax = Math.max(1, ...visitorHeatmap.map((c) => c.visits));
  const DOW_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  function renderVisitorDashboard() {
    // ── helpers ──────────────────────────────────────────────────────────────
    const fmtDur = (mins: number | null | undefined) => {
      if (!mins) return "—";
      const h = Math.floor(mins / 60), m = mins % 60;
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

    // dept bars
    const deptMax = Math.max(1, ...visitorDeptRows.map((r) => r.total));

    // heatmap — show hours 6-22 only; across days Sun-Sat
    const PEAK_HOURS = [6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22];

    // top 5 hosts
    const topHosts = [...visitorHostRows].sort((a, b) => b.total - a.total).slice(0, 5);
    const hostMax  = Math.max(1, ...topHosts.map((h) => h.total));

    // card stripe colours
    const C = {
      navy:   COLOURS.NAVY,
      green:  COLOURS.GREEN,
      red:    COLOURS.RED,
      amber:  COLOURS.AMBER,
      blue:   COLOURS.BLUE,
      slate:  COLOURS.SLATE,
    };

    const kpiCards = visitorKpi ? [
      { label: "Total Visits",    value: visitorKpi.total,                              stripe: C.navy,  sub: "this period",       filterStatus: "" as "" | "inside" | "checked_out",  alertsView: false },
      { label: "Currently Inside",value: visitorKpi.currently_inside,                  stripe: C.green, sub: "right now",          filterStatus: "inside" as "inside",                 alertsView: false },
      { label: "Overstays",       value: visitorKpi.overstay,                          stripe: visitorKpi.overstay > 0 ? C.red : C.green, sub: "need attention", filterStatus: "inside" as "inside", alertsView: false },
      { label: "Unique Visitors", value: visitorKpi.unique_visitors,                   stripe: C.blue,  sub: "distinct people",    filterStatus: "" as "",                             alertsView: false },
      { label: "Avg Duration",    value: fmtDur(visitorKpi.avg_duration_mins),         stripe: C.navy,  sub: "per visit",          filterStatus: null,                                 alertsView: false },
      { label: "Longest Stay",    value: fmtDur(visitorKpi.longest_stay_mins),         stripe: C.amber, sub: "single visit",       filterStatus: null,                                 alertsView: false },
      { label: "Repeat Visitors", value: visitorKpi.repeat_visitors,                   stripe: visitorKpi.repeat_visitors > 0 ? C.amber : C.green, sub: "returned visitors", filterStatus: null, alertsView: false },
      { label: "Active Alerts",   value: visitorExceptions.length,                     stripe: visitorExceptions.length > 0 ? C.red : C.green, sub: "flags today", filterStatus: null, alertsView: true },
    ] : [];

    // shared card style
    const card: React.CSSProperties = {
      background: COLOURS.CARD,
      border: `1px solid ${COLOURS.HAIRLINE}`,
      borderRadius: "12px",
      padding: "16px",
      marginBottom: "16px",
    };
    const sectionHead: React.CSSProperties = {
      margin: "0 0 12px",
      fontSize: "11px",
      fontWeight: 700,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: COLOURS.SLATE,
    };

    return (
      <div style={{ marginBottom: "20px" }}>

        {/* ── Dashboard header ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", gap: "8px" }}>
          <div>
            <p style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: COLOURS.NAVY }}>Visitor Analytics</p>
            <p style={{ margin: "2px 0 0", fontSize: "12px", color: COLOURS.SLATE }}>{visitorDateFrom} — {visitorDateTo}</p>
          </div>
          {visitorExceptions.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", background: COLOURS.DANGER_SOFT, border: `1px solid ${COLOURS.RED}22`, borderRadius: "8px", padding: "6px 12px" }}>
              <span style={{ fontSize: "14px" }}>⚠️</span>
              <span style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.RED }}>{visitorExceptions.length} alert{visitorExceptions.length !== 1 ? "s" : ""}</span>
            </div>
          )}
        </div>

        {/* ── View switcher ── */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "16px", flexWrap: "wrap" }}>
          {([ ["kpi", "📊 KPI"], ["league", "🏆 Dept & Hosts"], ["peak", "🕐 Peak Hours"], ["alerts", "⚠️ Alerts"] ] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setDashView(v)}
              style={{
                padding: "6px 14px", borderRadius: "20px", border: `1px solid ${dashView === v ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
                background: dashView === v ? COLOURS.NAVY : COLOURS.CARD,
                color: dashView === v ? "white" : COLOURS.SLATE,
                fontSize: "12px", fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
              }}
            >{label}</button>
          ))}
        </div>

        {/* ── Row 1: 8 KPI cards ── */}
        {dashView === "kpi" && kpiCards.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: "10px", marginBottom: "16px" }}>
            {kpiCards.map(({ label, value, stripe, sub, filterStatus, alertsView }) => {
              const isClickable = filterStatus !== null || alertsView;
              const isActive = filterStatus !== null && !alertsView && visitorStatus === filterStatus;
              const handleClick = () => {
                if (alertsView) { setDashView("alerts"); return; }
                if (filterStatus === null) return;
                setVisitorStatus(filterStatus);
                setVisitorPage(0);
                // Bypass stale-closure issue: build params directly with new value
                setLoadingVisitors(true);
                const p = new URLSearchParams({ date_from: visitorDateFrom, date_to: visitorDateTo, limit: String(visitorPageSize), offset: "0" });
                if (visitorSearch) p.set("search", visitorSearch);
                if (filterStatus)  p.set("status", filterStatus);
                if (visitorDeptFilter) p.set("department", visitorDeptFilter);
                authFetch(`/api/visitors/list?${p}`).then(r => r.json()).then(d => { setVisitorRows(d.rows ?? []); setVisitorTotal(d.total ?? 0); }).finally(() => setLoadingVisitors(false));
              };
              return (
                <div
                  key={label}
                  onClick={isClickable ? handleClick : undefined}
                  style={{
                    background: isActive ? COLOURS.NAVY : COLOURS.CARD,
                    border: `2px solid ${isActive ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
                    borderRadius: "12px",
                    overflow: "hidden",
                    cursor: isClickable ? "pointer" : "default",
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                >
                  <div style={{ height: "4px", background: stripe }} />
                  <div style={{ padding: "12px 14px" }}>
                    <p style={{ margin: "0 0 2px", fontSize: "26px", fontWeight: 800, color: isActive ? "white" : stripe, lineHeight: 1 }}>{value}</p>
                    <p style={{ margin: "4px 0 0", fontSize: "12px", fontWeight: 700, color: isActive ? "rgba(255,255,255,0.9)" : COLOURS.NAVY }}>{label}</p>
                    <p style={{ margin: "2px 0 0", fontSize: "11px", color: isActive ? "rgba(255,255,255,0.65)" : COLOURS.SLATE }}>{sub}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Row 2: Dept efficiency table + Top Hosts ── */}
        {dashView === "league" && <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: "12px", marginBottom: "16px" }}>

          {/* Dept table */}
          <div style={card}>
            <p style={sectionHead}>Department Traffic &amp; Efficiency</p>
            {visitorDeptRows.length === 0 ? (
              <p style={{ color: COLOURS.SLATE, textAlign: "center", padding: "20px 0", margin: 0 }}>No data</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${COLOURS.HAIRLINE}` }}>
                    {["Department","Visits","Inside","Avg Duration","Traffic"].map((h) => (
                      <th key={h} style={{ padding: "6px 8px", textAlign: "left", color: COLOURS.SLATE, fontWeight: 600, fontSize: "11px", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visitorDeptRows.map((row, i) => {
                    const barPct = (row.total / deptMax) * 100;
                    const avgHigh = row.avg_mins != null && row.avg_mins > 120;
                    return (
                      <tr key={i} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                        <td style={{ padding: "8px 8px", fontWeight: 600, color: COLOURS.NAVY }}>{row.department_name}</td>
                        <td style={{ padding: "8px 8px", fontWeight: 700 }}>{row.total}</td>
                        <td style={{ padding: "8px 8px" }}>
                          {row.inside > 0
                            ? <span style={{ background: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN, borderRadius: "6px", padding: "2px 8px", fontWeight: 700, fontSize: "12px" }}>{row.inside}</span>
                            : <span style={{ color: COLOURS.SLATE }}>0</span>}
                        </td>
                        <td style={{ padding: "8px 8px", color: avgHigh ? COLOURS.RED : COLOURS.SLATE, fontWeight: avgHigh ? 700 : 400 }}>
                          {fmtDur(row.avg_mins)}
                        </td>
                        <td style={{ padding: "8px 8px", minWidth: "80px" }}>
                          <div style={{ background: COLOURS.HAIRLINE, borderRadius: "4px", height: "8px", overflow: "hidden" }}>
                            <div style={{ width: `${barPct}%`, height: "100%", background: avgHigh ? COLOURS.RED : COLOURS.BLUE, borderRadius: "4px", transition: "width 0.4s" }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Top Hosts leaderboard */}
          <div style={card}>
            <p style={sectionHead}>Top Hosts</p>
            {topHosts.length === 0 ? (
              <p style={{ color: COLOURS.SLATE, textAlign: "center", padding: "20px 0", margin: 0 }}>No data</p>
            ) : topHosts.map((h, i) => {
              const barPct = (h.total / hostMax) * 100;
              const medals = ["🥇","🥈","🥉"];
              return (
                <div key={i} style={{ marginBottom: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>
                      {medals[i] ?? `#${i+1}`} {h.host_name}
                    </span>
                    <span style={{ fontSize: "13px", fontWeight: 800, color: COLOURS.BLUE }}>{h.total}</span>
                  </div>
                  <div style={{ background: COLOURS.HAIRLINE, borderRadius: "4px", height: "6px", overflow: "hidden" }}>
                    <div style={{ width: `${barPct}%`, height: "100%", background: i === 0 ? COLOURS.NAVY : COLOURS.BLUE, borderRadius: "4px", transition: "width 0.4s" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>}

        {/* ── Row 3: Arrival Heatmap ── */}
        {dashView === "peak" && <div style={{ ...card, overflowX: "auto" }}>
          <p style={sectionHead}>Peak Arrival Hours (visits by hour × day)</p>
          <table style={{ borderCollapse: "collapse", fontSize: "11px", minWidth: "500px" }}>
            <thead>
              <tr>
                <th style={{ padding: "4px 8px", color: COLOURS.SLATE, fontWeight: 600, textAlign: "left", minWidth: "52px" }}>Hour</th>
                {DOW_LABELS.map((d) => (
                  <th key={d} style={{ padding: "4px 10px", color: COLOURS.SLATE, fontWeight: 600, textAlign: "center", minWidth: "38px" }}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PEAK_HOURS.map((hr) => {
                const label = `${String(hr).padStart(2,"0")}:00`;
                return (
                  <tr key={hr}>
                    <td style={{ padding: "3px 8px", color: COLOURS.SLATE, fontWeight: 600, fontSize: "11px" }}>{label}</td>
                    {Array.from({ length: 7 }, (_, dow) => {
                      const cell = visitorHeatmap.find((c) => c.dow === dow && c.hour === hr);
                      const v    = cell?.visits ?? 0;
                      const alpha = v / heatMax;
                      return (
                        <td key={dow} title={`${v} visit${v !== 1 ? "s" : ""} — ${DOW_LABELS[dow]} ${label}`} style={{
                          padding: "3px 10px", textAlign: "center",
                          background: v === 0 ? COLOURS.CANVAS : `rgba(15,123,95,${0.12 + alpha * 0.88})`,
                          color: alpha > 0.55 ? "white" : v > 0 ? COLOURS.NAVY : COLOURS.SLATE,
                          fontWeight: v > 0 ? 700 : 400,
                          borderRadius: "4px",
                          transition: "background 0.2s",
                        }}>{v > 0 ? v : ""}</td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style={{ margin: "10px 0 0", fontSize: "11px", color: COLOURS.SLATE }}>
            Darker = more visits. Showing hours 06:00–22:00.
          </p>
        </div>}

        {/* ── Row 4: Active Alerts ── */}
        {dashView === "alerts" && <div style={card}>
          <p style={sectionHead}>Active Alerts {visitorExceptions.length > 0 && `(${visitorExceptions.length})`}</p>
          {visitorExceptions.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px 0", color: COLOURS.GREEN }}>
              <span style={{ fontSize: "18px" }}>✓</span>
              <span style={{ fontSize: "14px", fontWeight: 600 }}>No alerts today — all clear</span>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: "10px" }}>
              {visitorExceptions.map((ex) => {
                const isOverstay = ex.exception_type === "overstay";
                const isBL = ex.flag_type === "blacklist";
                const bg    = isOverstay ? COLOURS.DANGER_SOFT : COLOURS.WARNING_SOFT;
                const bdr   = isOverstay ? `${COLOURS.RED}44` : `${COLOURS.AMBER}44`;
                const icon  = isOverstay ? "🕐" : isBL ? "🚫" : "⭐";
                return (
                  <div key={ex.id} style={{ padding: "12px 14px", borderRadius: "10px", background: bg, border: `1px solid ${bdr}`, display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: "14px", color: COLOURS.NAVY }}>{icon} {ex.visitor_name}</p>
                        <p style={{ margin: "3px 0 0", fontSize: "12px", color: COLOURS.SLATE }}>
                          {ex.department_name} · {ex.host_name}
                        </p>
                      </div>
                      {isOverstay && (
                        <span style={{ background: COLOURS.RED, color: "white", borderRadius: "6px", padding: "2px 8px", fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap" }}>
                          {fmtDur(ex.mins_inside)} inside
                        </span>
                      )}
                      {!isOverstay && ex.flag_type && (
                        <span style={{ background: COLOURS.AMBER, color: "white", borderRadius: "6px", padding: "2px 8px", fontSize: "11px", fontWeight: 700 }}>
                          {ex.flag_type.toUpperCase()}
                        </span>
                      )}
                    </div>
                    {ex.time_out === null && (
                      <button
                        onClick={() => handleVisitorCheckout(ex.id)}
                        style={{ padding: "6px 12px", borderRadius: RADII.PILL, border: "none", background: COLOURS.NAVY, color: "white", fontSize: "12px", fontWeight: 600, cursor: "pointer", alignSelf: "flex-start" }}
                      >Check Out</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>}

      </div>
    );
  }

  function renderVisitorsTab() {
    const distinctDepts = [...new Set(visitorRows.map((r) => r.department_name))].sort();

    // Determine which preset tab is active (if any)
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const presetRanges: Record<string, { from: string; to: string }> = {
      "Today":      { from: fmt(today), to: fmt(today) },
      "Yesterday":  { from: fmt(new Date(today.getFullYear(), today.getMonth(), today.getDate()-1)), to: fmt(new Date(today.getFullYear(), today.getMonth(), today.getDate()-1)) },
      "This Week":  { from: fmt(new Date(today.getFullYear(), today.getMonth(), today.getDate()-6)), to: fmt(today) },
      "This Month": { from: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), to: fmt(today) },
      "Last Month": { from: fmt(new Date(today.getFullYear(), today.getMonth()-1, 1)), to: fmt(new Date(today.getFullYear(), today.getMonth(), 0)) },
    };
    const activePreset = Object.entries(presetRanges).find(([, r]) => r.from === visitorDateFrom && r.to === visitorDateTo)?.[0] ?? null;

    const filterCardStyle: React.CSSProperties = {
      background: COLOURS.CARD,
      border: `1px solid ${COLOURS.HAIRLINE}`,
      borderRadius: "12px",
      padding: "14px 16px",
      marginBottom: "16px",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
    };
    const tabGroupStyle: React.CSSProperties = {
      display: "flex",
      background: COLOURS.CANVAS,
      borderRadius: RADII.PILL,
      padding: "3px",
      gap: "2px",
    };
    const tabBtn = (active: boolean): React.CSSProperties => ({
      padding: "5px 13px",
      borderRadius: RADII.PILL,
      border: "none",
      cursor: "pointer",
      fontSize: "12px",
      fontWeight: 600,
      whiteSpace: "nowrap" as const,
      background: active ? COLOURS.NAVY : "transparent",
      color: active ? "#fff" : COLOURS.SLATE,
      transition: "background 0.15s, color 0.15s",
    });
    const monthSelectStyle: React.CSSProperties = {
      padding: "5px 10px",
      borderRadius: RADII.PILL,
      border: `1px solid ${COLOURS.HAIRLINE}`,
      background: COLOURS.CARD,
      fontSize: "12px",
      fontWeight: 600,
      color: COLOURS.NAVY,
      cursor: "pointer",
      outline: "none",
    };

    return (
      <div>
        {wv("admin.visitors_dashboard") && renderVisitorDashboard()}

        {/* ── Admin icon buttons (top-right) ── */}
        {ctx && isAdminTier(ctx) && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px", marginBottom: "8px" }}>
            <button
              title="Visitor Settings"
              onClick={() => { setShowVisitorSettings((v) => !v); setShowVisitorImport(false); }}
              style={{
                width: "32px", height: "32px", borderRadius: "8px", border: `1px solid ${showVisitorSettings ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
                background: showVisitorSettings ? COLOURS.NAVY : COLOURS.CARD, color: showVisitorSettings ? "white" : COLOURS.SLATE,
                cursor: "pointer", fontSize: "15px", display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >⚙️</button>
            <button
              title="Historical Import"
              onClick={() => { setShowVisitorImport((v) => !v); setShowVisitorSettings(false); }}
              style={{
                width: "32px", height: "32px", borderRadius: "8px", border: `1px solid ${showVisitorImport ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
                background: showVisitorImport ? COLOURS.NAVY : COLOURS.CARD, color: showVisitorImport ? "white" : COLOURS.SLATE,
                cursor: "pointer", fontSize: "15px", display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >📥</button>
          </div>
        )}

        {/* ── Filter bar (single scrollable row) ── */}
        <div style={{ ...filterCardStyle, padding: "10px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", overflowX: "auto", whiteSpace: "nowrap" }}>
            {/* Period tabs */}
            <div style={{ ...tabGroupStyle, flexShrink: 0 }}>
              {["Today","Yesterday","This Week","This Month","Last Month"].map((p) => (
                <button key={p} onClick={() => visitorPreset(p)} style={{ ...tabBtn(activePreset === p), padding: "5px 10px", fontSize: "11px" }}>{p}</button>
              ))}
            </div>

            <div style={{ width: "1px", height: "20px", background: COLOURS.HAIRLINE, flexShrink: 0 }} />

            {/* Custom date range */}
            <DateInput value={visitorDateFrom} onChange={(e) => { setVisitorDateFrom(e.target.value); setVisitorPage(0); }} />
            <span style={{ color: COLOURS.SLATE, fontSize: "12px", flexShrink: 0 }}>→</span>
            <DateInput value={visitorDateTo}   onChange={(e) => { setVisitorDateTo(e.target.value);   setVisitorPage(0); }} />

            <div style={{ width: "1px", height: "20px", background: COLOURS.HAIRLINE, flexShrink: 0 }} />

            {/* Status */}
            <select
              value={visitorStatus}
              onChange={(e) => { setVisitorStatus(e.target.value as typeof visitorStatus); setVisitorPage(0); }}
              style={{ ...inputStyle, fontSize: "12px", padding: "5px 8px", minWidth: "unset", width: "110px", flexShrink: 0 }}
            >
              <option value="">All Status</option>
              <option value="inside">Inside</option>
              <option value="checked_out">Checked Out</option>
            </select>

            {/* Dept */}
            <select
              value={visitorDeptFilter}
              onChange={(e) => { setVisitorDeptFilter(e.target.value); setVisitorPage(0); }}
              style={{ ...inputStyle, fontSize: "12px", padding: "5px 8px", minWidth: "unset", width: "110px", flexShrink: 0 }}
            >
              <option value="">All Depts</option>
              {distinctDepts.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>

            {/* Search */}
            <input
              type="text"
              placeholder="Search…"
              value={visitorSearch}
              onChange={(e) => { setVisitorSearch(e.target.value); setVisitorPage(0); }}
              style={{ ...inputStyle, fontSize: "12px", padding: "5px 8px", width: "140px", flexShrink: 0 }}
              onKeyDown={(e) => e.key === "Enter" && loadVisitorList()}
            />
            <button onClick={() => loadVisitorList()} style={{ ...primaryButtonStyle, padding: "5px 12px", fontSize: "12px", flexShrink: 0 }}>Search</button>

            {/* Export Excel */}
            <button
              onClick={async () => {
                const p = new URLSearchParams({ from: visitorDateFrom, to: visitorDateTo });
                if (visitorStatus)     p.set("status", visitorStatus);
                if (visitorDeptFilter) p.set("dept",   visitorDeptFilter);
                if (visitorSearch)     p.set("search", visitorSearch);
                try {
                  const res = await authFetch(`/api/visitors/export?${p}`);
                  if (!res.ok) { showToast("Export failed"); return; }
                  const blob = await res.blob();
                  const url  = URL.createObjectURL(blob);
                  const a    = document.createElement("a");
                  a.href     = url;
                  a.download = `visitor-log-${visitorDateFrom}-to-${visitorDateTo}.xlsx`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch { showToast("Export failed"); }
              }}
              style={{
                padding: "5px 10px", borderRadius: RADII.PILL,
                background: COLOURS.CARD_ALT, border: `1px solid ${COLOURS.HAIRLINE}`,
                color: COLOURS.SLATE, fontSize: "11px", fontWeight: 600,
                cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "4px",
                whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              ↓ Excel
            </button>
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", minWidth: "700px" }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${COLOURS.HAIRLINE}`, background: COLOURS.CARD_ALT }}>
                {["Check In","Check Out","Visitor","CNIC","Department","Host","Purpose","Status","Actions"].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: COLOURS.SLATE, fontSize: "11px", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingVisitors && (
                <tr><td colSpan={9}><SkeletonRows count={8} /></td></tr>
              )}
              {!loadingVisitors && visitorRows.length === 0 && (
                <tr><td colSpan={9} style={{ padding: "24px", textAlign: "center", color: COLOURS.SLATE }}>No records found</td></tr>
              )}
              {!loadingVisitors && visitorRows.map((row) => (
                <tr key={row.id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                  {/* Check In: date + time stacked */}
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    <div style={{ fontWeight: 600, fontSize: "13px" }}>{formatDateUK(row.visit_date)}</div>
                    <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>
                      {new Date(row.time_in).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" })}
                    </div>
                  </td>
                  {/* Check Out: time + duration stacked */}
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    {row.time_out ? (
                      <>
                        <div style={{ fontSize: "13px" }}>
                          {new Date(row.time_out).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" })}
                        </div>
                        <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>
                          {row.duration_mins != null ? (Math.floor(row.duration_mins / 60) > 0 ? `${Math.floor(row.duration_mins / 60)}h ${row.duration_mins % 60}m` : `${row.duration_mins}m`) : "—"}
                        </div>
                      </>
                    ) : (
                      <span style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.GREEN }}>● Inside</span>
                    )}
                  </td>
                  {/* Visitor: name + mobile stacked */}
                  <td style={{ padding: "8px 10px" }}>
                    <div style={{ fontWeight: 600, fontSize: "13px" }}>
                      {row.visitor_name}
                      {row.flag_type === "blacklist" && <span style={{ marginLeft: "4px", fontSize: "10px", color: COLOURS.RED }}>🚫</span>}
                      {row.flag_type === "vip"       && <span style={{ marginLeft: "4px", fontSize: "10px", color: COLOURS.AMBER }}>⭐</span>}
                    </div>
                    <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "1px" }}>{row.mobile_masked}</div>
                  </td>
                  <td style={{ padding: "8px 10px", color: COLOURS.SLATE, fontFamily: "monospace", fontSize: "11px", whiteSpace: "nowrap" }}>{row.cnic_masked ?? "—"}</td>
                  <td style={{ padding: "8px 10px", fontSize: "12px" }}>{row.department_name}</td>
                  <td style={{ padding: "8px 10px", fontSize: "12px" }}>{row.host_name}</td>
                  <td style={{ padding: "8px 10px", fontSize: "12px" }}>{row.purpose === "Other" ? row.purpose_other || "Other" : row.purpose}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <span style={{
                      fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: RADII.PILL,
                      backgroundColor: row.is_inside ? "#D1FAE5" : COLOURS.HAIRLINE,
                      color: row.is_inside ? COLOURS.GREEN : COLOURS.SLATE,
                    }}>{row.is_inside ? "Inside" : "Out"}</span>
                  </td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                      <button
                        title="Edit record"
                        onClick={() => { setEditingVisitor(row); setEditCnic(""); setEditMobile(""); }}
                        style={{ width: "28px", height: "28px", borderRadius: "6px", border: `1px solid ${COLOURS.HAIRLINE}`, background: "white", cursor: "pointer", fontSize: "13px", display: "flex", alignItems: "center", justifyContent: "center" }}
                      >✏️</button>
                      {row.is_inside && (
                        <button
                          title="Check out"
                          onClick={() => handleVisitorCheckout(row.id)}
                          style={{ width: "28px", height: "28px", borderRadius: "6px", border: `1px solid ${COLOURS.GREEN}`, background: "#D1FAE5", color: COLOURS.GREEN, cursor: "pointer", fontSize: "13px", display: "flex", alignItems: "center", justifyContent: "center" }}
                        >✓</button>
                      )}
                      <button
                        title="Delete record"
                        onClick={() => handleVisitorDelete(row.id)}
                        style={{ width: "28px", height: "28px", borderRadius: "6px", border: `1px solid #FECACA`, background: "#FEF2F2", color: COLOURS.RED, cursor: "pointer", fontSize: "13px", display: "flex", alignItems: "center", justifyContent: "center" }}
                      >🗑️</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {visitorTotal > visitorPageSize && (
          <div style={{ display: "flex", gap: "8px", marginTop: "12px", alignItems: "center" }}>
            <button
              disabled={visitorPage === 0}
              onClick={() => setVisitorPage((p) => p - 1)}
              style={{ padding: "5px 12px", borderRadius: RADII.PILL, border: `1px solid ${COLOURS.HAIRLINE}`, background: "white", cursor: "pointer" }}
            >‹ Prev</button>
            <span style={{ fontSize: "13px", color: COLOURS.SLATE }}>
              {visitorPage * visitorPageSize + 1}–{Math.min((visitorPage + 1) * visitorPageSize, visitorTotal)} of {visitorTotal}
            </span>
            <button
              disabled={(visitorPage + 1) * visitorPageSize >= visitorTotal}
              onClick={() => setVisitorPage((p) => p + 1)}
              style={{ padding: "5px 12px", borderRadius: RADII.PILL, border: `1px solid ${COLOURS.HAIRLINE}`, background: "white", cursor: "pointer" }}
            >Next ›</button>
          </div>
        )}

        {/* F10 — Settings panel (admin only) */}
        {ctx && isAdminTier(ctx) && showVisitorSettings && (
          <div style={{ marginTop: "16px" }}>
            <div style={{ background: COLOURS.CARD_ALT, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, padding: "20px" }}>
              {!visitorSettings ? (
                <p style={{ margin: 0, color: COLOURS.SLATE, fontSize: "13px" }}>Loading…</p>
              ) : (
                <>
                  {/* Global defaults */}
                  <p style={{ margin: "0 0 14px", fontWeight: 700, fontSize: "13px", color: COLOURS.NAVY, letterSpacing: "0.04em", textTransform: "uppercase" }}>Global Defaults</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", marginBottom: "20px" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "4px" }}>DEFAULT OVERSTAY (MINS)</label>
                      <input type="number" min={1} value={visitorSettings.overstay_threshold_mins}
                        onChange={(e) => setVisitorSettings({ ...visitorSettings, overstay_threshold_mins: parseInt(e.target.value) || 0 })}
                        style={{ ...inputStyle, width: "90px" }} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "4px" }}>OFFICE OPENS (HOUR)</label>
                      <input type="number" min={0} max={23} value={visitorSettings.office_open_hour}
                        onChange={(e) => setVisitorSettings({ ...visitorSettings, office_open_hour: parseInt(e.target.value) || 0 })}
                        style={{ ...inputStyle, width: "80px" }} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "4px" }}>OFFICE CLOSES (HOUR)</label>
                      <input type="number" min={0} max={23} value={visitorSettings.office_close_hour}
                        onChange={(e) => setVisitorSettings({ ...visitorSettings, office_close_hour: parseInt(e.target.value) || 0 })}
                        style={{ ...inputStyle, width: "80px" }} />
                    </div>
                    <div style={{ flex: 1, minWidth: "200px" }}>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "4px" }}>WEEKLY DIGEST EMAIL</label>
                      <input type="email" value={visitorSettings.weekly_digest_email}
                        onChange={(e) => setVisitorSettings({ ...visitorSettings, weekly_digest_email: e.target.value })}
                        style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                    </div>
                  </div>
                  <button onClick={saveVisitorGlobalSettings} disabled={settingsSaving}
                    style={{ ...primaryButtonStyle, padding: "8px 20px", marginBottom: "24px", opacity: settingsSaving ? 0.6 : 1 }}>
                    {settingsSaving ? "Saving…" : "Save Settings"}
                  </button>

                  {/* Divider */}
                  <div style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, marginBottom: "16px" }} />

                  {/* Per-purpose thresholds */}
                  <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: "13px", color: COLOURS.NAVY, letterSpacing: "0.04em", textTransform: "uppercase" }}>Per-Purpose Thresholds</p>
                  <p style={{ margin: "0 0 14px", fontSize: "12px", color: COLOURS.SLATE }}>Longest keyword match wins; falls back to the default above.</p>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", marginBottom: "14px" }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                        <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 600, color: COLOURS.SLATE, fontSize: "11px" }}>KEYWORD</th>
                        <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 600, color: COLOURS.SLATE, fontSize: "11px" }}>THRESHOLD (MINS)</th>
                        <th style={{ width: "60px" }} />
                      </tr>
                    </thead>
                    <tbody>
                      {visitorSettings.purpose_thresholds.map((t) => (
                        <tr key={t.keyword} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                          <td style={{ padding: "7px 8px" }}>{t.keyword}</td>
                          <td style={{ padding: "7px 8px" }}>{t.threshold_mins} m</td>
                          <td style={{ padding: "7px 8px", textAlign: "right" }}>
                            <button onClick={() => deletePurposeThreshold(t.keyword)}
                              style={{ padding: "3px 8px", borderRadius: "5px", border: `1px solid #FECACA`, background: "#FEF2F2", color: COLOURS.RED, cursor: "pointer", fontSize: "11px" }}>
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                      {visitorSettings.purpose_thresholds.length === 0 && (
                        <tr><td colSpan={3} style={{ padding: "10px 8px", color: COLOURS.SLATE, fontSize: "12px" }}>No custom thresholds yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                  {/* Add threshold row */}
                  <div style={{ display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "4px" }}>KEYWORD</label>
                      <input type="text" placeholder="e.g. Delivery" value={settingsNewKw}
                        onChange={(e) => setSettingsNewKw(e.target.value)}
                        style={{ ...inputStyle, width: "150px" }} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "4px" }}>MINS</label>
                      <input type="number" min={1} placeholder="30" value={settingsNewMins}
                        onChange={(e) => setSettingsNewMins(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addPurposeThreshold()}
                        style={{ ...inputStyle, width: "80px" }} />
                    </div>
                    <button onClick={addPurposeThreshold} disabled={!settingsNewKw.trim() || !settingsNewMins}
                      style={{ ...primaryButtonStyle, padding: "8px 16px", opacity: (!settingsNewKw.trim() || !settingsNewMins) ? 0.5 : 1 }}>
                      + Add
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Historical Import panel */}
        {ctx && isAdminTier(ctx) && showVisitorImport && (
          <div style={{ marginTop: "16px" }}>
            <div style={{ background: COLOURS.CARD_ALT, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, padding: "20px" }}>
              <p style={{ margin: "0 0 8px", fontWeight: 600, color: COLOURS.NAVY }}>Bulk import from Excel / CSV</p>
              <p style={{ margin: "0 0 12px", fontSize: "13px", color: COLOURS.SLATE }}>
                Upload historical visitor records. Required columns: <code>visit_date</code>, <code>visitor_name</code>, <code>mobile</code>.<br/>
                Optional: <code>cnic</code>, <code>department_name</code>, <code>host_name</code>, <code>purpose</code>, <code>time_in</code>, <code>time_out</code>, <code>comments</code>.<br/>
                Duplicate rows (same mobile + time_in) are skipped automatically.
              </p>
              {visitorImportResult && (
                <div style={{ borderRadius: "8px", padding: "12px 14px", marginBottom: "14px",
                  backgroundColor: visitorImportResult.imported > 0 ? "#ECFDF5" : "#FFFBEB",
                  border: `1px solid ${visitorImportResult.imported > 0 ? "#A7F3D0" : "#FDE68A"}` }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: visitorImportResult.imported > 0 ? COLOURS.GREEN : COLOURS.AMBER }}>
                    ✓ {visitorImportResult.imported} row{visitorImportResult.imported !== 1 ? "s" : ""} imported · {visitorImportResult.skipped} skipped
                  </div>
                  {visitorImportResult.errors.length > 0 && (
                    <ul style={{ margin: "8px 0 0", padding: "0 0 0 16px", fontSize: "12px", color: COLOURS.RED }}>
                      {visitorImportResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  )}
                </div>
              )}
              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                <label style={{
                  padding: "7px 14px", borderRadius: RADII.PILL, border: `1px solid ${COLOURS.HAIRLINE}`,
                  background: "white", color: COLOURS.SLATE, fontSize: "12px", fontWeight: 600, cursor: "pointer",
                }}>
                  Choose File
                  <input type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
                    onChange={(e) => {
                      setVisitorImportFile(e.target.files?.[0] ?? null);
                      setVisitorImportResult(null);
                      setVisitorImportPreview(null);
                      setVisitorImportRowCount(0);
                    }} />
                </label>
                {visitorImportFile && (
                  <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>
                    {visitorImportFile.name} · {(visitorImportFile.size / 1024).toFixed(1)} KB
                  </span>
                )}
                {visitorImportFile && visitorImportPreview === null && (
                  <button
                    onClick={handleVisitorPreview}
                    style={{ ...primaryButtonStyle, padding: "7px 18px", background: COLOURS.SLATE }}
                  >
                    Preview
                  </button>
                )}
              </div>

              {/* Preview section */}
              {visitorImportPreview !== null && (
                <div style={{ marginTop: "14px" }}>
                  <div style={{ borderRadius: "8px", padding: "12px 14px", marginBottom: "12px", background: "#EFF6FF", border: "1px solid #BFDBFE" }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "4px" }}>
                      {visitorImportRowCount === -1
                        ? "Excel file ready — row count will be shown after import."
                        : `${visitorImportRowCount} data row${visitorImportRowCount !== 1 ? "s" : ""} found. Duplicates (same mobile + time-in) will be skipped.`}
                    </div>
                    {visitorImportPreview.length > 0 && (
                      <div style={{ overflowX: "auto", marginTop: "8px" }}>
                        <table style={{ borderCollapse: "collapse", fontSize: "11px", width: "100%" }}>
                          <thead>
                            <tr>
                              {(["visitor_name","mobile","visit_date","time_in","time_out","host_name","purpose"] as const).map((h) => (
                                <th key={h} style={{ padding: "4px 8px", background: COLOURS.NAVY, color: "white", textAlign: "left", whiteSpace: "nowrap" }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {visitorImportPreview.map((row, i) => (
                              <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#F8FAFC" }}>
                                {(["visitor_name","mobile","visit_date","time_in","time_out","host_name","purpose"] as const).map((h) => (
                                  <td key={h} style={{ padding: "4px 8px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, whiteSpace: "nowrap" }}>{row[h] ?? "—"}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {visitorImportRowCount > 5 && (
                          <p style={{ margin: "6px 0 0", fontSize: "11px", color: COLOURS.SLATE }}>
                            …and {visitorImportRowCount - 5} more row{visitorImportRowCount - 5 !== 1 ? "s" : ""}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "10px" }}>
                    <button
                      onClick={() => { setVisitorImportPreview(null); setVisitorImportRowCount(0); }}
                      style={{ padding: "7px 18px", borderRadius: RADII.PILL, border: `1px solid ${COLOURS.HAIRLINE}`, background: "white", color: COLOURS.SLATE, fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleVisitorImport}
                      disabled={visitorImporting}
                      style={{ ...primaryButtonStyle, padding: "7px 18px", opacity: visitorImporting ? 0.5 : 1 }}
                    >
                      {visitorImporting ? "Importing…" : "Confirm Import"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Edit modal */}
        {editingVisitor && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(15,23,32,0.6)", zIndex: 200,
            display: "flex", alignItems: "center", justifyContent: "center", padding: "16px",
          }}>
            <div style={{ background: "white", borderRadius: "16px", padding: "24px", width: "100%", maxWidth: "480px", maxHeight: "90vh", overflowY: "auto" }}>
              <h3 style={{ margin: "0 0 16px", color: COLOURS.NAVY }}>Edit Visitor Record</h3>
              {(["visitor_name", "host_name", "department_name", "purpose", "comments"] as const).map((field) => (
                <div key={field} style={{ marginBottom: "12px" }}>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "4px", textTransform: "uppercase" }}>
                    {field.replace(/_/g, " ")}
                  </label>
                  <input
                    type="text"
                    value={(editingVisitor as unknown as Record<string, string>)[field] ?? ""}
                    onChange={(e) => setEditingVisitor((v) => v ? { ...v, [field]: e.target.value } : v)}
                    style={{ ...inputStyle, display: "block", width: "100%", boxSizing: "border-box" }}
                  />
                </div>
              ))}
              {/* CNIC + Mobile (raw — leave blank to keep existing) */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "4px", textTransform: "uppercase" }}>CNIC</label>
                  <input
                    type="text"
                    placeholder={editingVisitor.cnic_masked ?? "Leave blank to keep"}
                    maxLength={15}
                    value={editCnic}
                    onChange={(e) => setEditCnic(e.target.value.replace(/[^\d-]/g, ""))}
                    style={{ ...inputStyle, display: "block", width: "100%", boxSizing: "border-box" }}
                  />
                  <p style={{ margin: "3px 0 0", fontSize: "11px", color: COLOURS.SLATE }}>Enter 13 digits to update</p>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "4px", textTransform: "uppercase" }}>Mobile</label>
                  <input
                    type="text"
                    placeholder={editingVisitor.mobile_masked ?? "Leave blank to keep"}
                    value={editMobile}
                    onChange={(e) => setEditMobile(e.target.value)}
                    style={{ ...inputStyle, display: "block", width: "100%", boxSizing: "border-box" }}
                  />
                  <p style={{ margin: "3px 0 0", fontSize: "11px", color: COLOURS.SLATE }}>e.g. 03001234567</p>
                </div>
              </div>
              {/* Time In / Time Out editors */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                {(["time_in", "time_out"] as const).map((field) => {
                  const raw = editingVisitor[field];
                  const hhmm = raw
                    ? new Date(raw).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" })
                    : "";
                  return (
                    <div key={field}>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "4px", textTransform: "uppercase" }}>
                        {field === "time_in" ? "Time In (PKT)" : "Time Out (PKT)"}
                      </label>
                      <input
                        type="time"
                        defaultValue={hhmm}
                        onChange={(e) => {
                          const t = e.target.value; // "HH:MM"
                          if (!t) { if (field === "time_out") setEditingVisitor((v) => v ? { ...v, time_out: null } : v); return; }
                          // Reconstruct ISO timestamp: visit_date + entered time in PKT → UTC
                          const [hh, mm] = t.split(":").map(Number);
                          const base = new Date(`${editingVisitor.visit_date}T${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:00+05:00`);
                          setEditingVisitor((v) => v ? { ...v, [field]: base.toISOString() } : v);
                        }}
                        style={{ ...inputStyle, display: "block", width: "100%", boxSizing: "border-box" }}
                      />
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
                <button onClick={() => { setEditingVisitor(null); setEditCnic(""); setEditMobile(""); }} style={{ flex: 1, padding: "10px", borderRadius: RADII.PILL, border: `1px solid ${COLOURS.HAIRLINE}`, background: "white", cursor: "pointer" }}>Cancel</button>
                <button onClick={handleVisitorEdit} disabled={savingVisitor} style={{ flex: 2, ...primaryButtonStyle, padding: "10px" }}>
                  {savingVisitor ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete confirmation modal */}
        {deleteVisitorId && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
            <div style={{ background: "white", borderRadius: RADII.CARD, padding: "24px", width: "100%", maxWidth: "380px", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
              <p style={{ margin: "0 0 4px", fontSize: "16px", fontWeight: 700, color: COLOURS.NAVY }}>Delete visitor record?</p>
              <p style={{ margin: "0 0 16px", fontSize: "13px", color: COLOURS.SLATE }}>This cannot be undone. A reason is required for the audit log.</p>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "6px" }}>REASON</label>
              <input
                autoFocus
                placeholder="e.g. Duplicate entry"
                value={deleteReason}
                onChange={e => setDeleteReason(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && deleteReason.trim()) confirmVisitorDelete(); if (e.key === "Escape") { setDeleteVisitorId(null); setDeleteReason(""); } }}
                style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: RADII.PILL, border: `1px solid ${COLOURS.HAIRLINE}`, fontSize: "13px", outline: "none", marginBottom: "16px" }}
              />
              <div style={{ display: "flex", gap: "10px" }}>
                <button onClick={() => { setDeleteVisitorId(null); setDeleteReason(""); }} style={{ flex: 1, padding: "10px", borderRadius: RADII.PILL, border: `1px solid ${COLOURS.HAIRLINE}`, background: "white", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>Cancel</button>
                <button onClick={confirmVisitorDelete} disabled={!deleteReason.trim()} style={{ flex: 2, padding: "10px", borderRadius: RADII.PILL, border: "none", background: deleteReason.trim() ? COLOURS.RED : COLOURS.HAIRLINE, color: deleteReason.trim() ? "white" : COLOURS.SLATE, cursor: deleteReason.trim() ? "pointer" : "not-allowed", fontSize: "13px", fontWeight: 700 }}>Delete Record</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const tabStyle = (id: TabId): React.CSSProperties => ({
    padding: "8px 16px",
    borderRadius: RADII.PILL,
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    border: "none",
    backgroundColor: safeActiveTab === id ? COLOURS.NAVY : "transparent",
    color: safeActiveTab === id ? "white" : COLOURS.SLATE,
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
            <option value="UTPL">UTPL — Unze Trading</option>
            <option value="IFPL">IFPL — Imperial Footwear</option>
            <option value="Baranh">Baranh</option>
            <option value="HD">HD</option>
            <option value="ALM">Almahar</option>
            <option value="DIR">Directors</option>
            <option value="UZL">Unze London</option>
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
        {renderSection(restRows, "Restaurants — Baranh & HD", true, "restaurants")}
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
                      <option value="UTPL">UTPL — Unze Trading</option>
                      <option value="IFPL">IFPL — Imperial Footwear</option>
                      <option value="Baranh">Baranh</option>
                      <option value="HD">HD</option>
                      <option value="ALM">Almahar</option>
                      <option value="DIR">Directors</option>
                      <option value="UZL">Unze London</option>
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
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr", gap: "10px" }}>
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

    const ENTITY_ORDER = ["UTPL", "IFPL", "Baranh", "HD", "ALM", "DIR", "UZL"];
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
                  ? formatDateUK(entry.date_paid).slice(0, 5)
                  : entry.status === "missing" ? "Overdue" : "Due 15";
                const tooltip = entry.date_paid
                  ? `Paid ${formatDateUK(entry.date_paid)}${entry.challan_number ? ` · Challan ${entry.challan_number}` : ""}${entry.amount_pkr ? ` · PKR ${Number(entry.amount_pkr).toLocaleString()}` : ""}`
                  : entry.status === "missing" ? "Not paid — record in Banking page" : "";
                return (
                  <div
                    key={entry.month}
                    title={tooltip}
                    style={{
                      display: "flex", flexDirection: "column", alignItems: "center",
                      gap: "3px", cursor: "default",
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
            <span style={{ fontSize: "11px", color: COLOURS.SLATE, fontStyle: "italic", whiteSpace: "nowrap" }}>
              View only — enter payments in Banking
            </span>
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
            Payments are entered in the Banking page.
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
          style={{ padding: "10px 14px", cursor: "pointer", verticalAlign: "top", transition: "background-color 0.1s" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLTableCellElement).style.backgroundColor = COLOURS.CARD_ALT; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLTableCellElement).style.backgroundColor = ""; }}
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
    const res = await authFetch("/api/admin/vehicles");
    const json = await res.json();
    setAllVehicles(json.data || []);
    setVehicleForm(null);
    setManageFleet(true);
  }

  async function saveVehicle() {
    if (!vehicleForm || !vehicleForm.name.trim() || !vehicleForm.plate_number.trim()) return;
    setSavingVehicle(true);
    const res = await authFetch("/api/admin/vehicles", {
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
      const r = await authFetch("/api/admin/vehicles");
      setAllVehicles((await r.json()).data || []);
      loadFuel();
    } else {
      showToast(json.error || "Failed to save", "error");
    }
  }

  // ── Manage Solar Sites handlers ────────────────────────────────────
  async function openManageSolar() {
    const res = await authFetch("/api/admin/solar-branches");
    const json = await res.json();
    setAllSolarBranches(json.data || []);
    setSolarForm(null);
    setManageSolar(true);
  }

  async function saveSolarBranch() {
    if (!solarForm || !solarForm.name.trim()) return;
    setSavingSolar(true);
    const res = await authFetch("/api/admin/solar-branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(solarForm),
    });
    const json = await res.json();
    setSavingSolar(false);
    if (json.ok) {
      showToast(solarForm.id ? "Site updated ✓" : "Site added ✓", "success");
      setSolarForm(null);
      const r = await authFetch("/api/admin/solar-branches");
      setAllSolarBranches((await r.json()).data || []);
      loadSolar();
    } else {
      showToast(json.error || "Failed to save", "error");
    }
  }

  // ── Manage Utility Sites handlers ──────────────────────────────────
  async function openManageUtility() {
    const res = await authFetch("/api/admin/locations");
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
      const res = await authFetch("/api/admin/locations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: locationForm.id, name: locationForm.name, entity: locationForm.entity, location_type: locationForm.location_type, province: locationForm.province, is_active: locationForm.is_active, default_disco: locationForm.default_disco }),
      });
      const json = await res.json();
      setSavingUtilityLoc(false);
      if (json.ok) {
        showToast("Site updated ✓", "success");
        setLocationForm(null);
        const r = await authFetch("/api/admin/locations");
        setAllLocations((await r.json()).data || []);
        loadUtility();
      } else {
        showToast(json.error || "Failed to save", "error");
      }
    } else {
      // Create new (uses the full RPC which creates compliance records too)
      const res = await authFetch("/api/admin/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: locationForm.name, entity: locationForm.entity, location_type: locationForm.location_type, province: locationForm.province, default_disco: locationForm.default_disco }),
      });
      const json = await res.json();
      setSavingUtilityLoc(false);
      if (json.ok) {
        showToast("Site added ✓", "success");
        setLocationForm(null);
        const r = await authFetch("/api/admin/locations");
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
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr", gap: "10px", marginBottom: "10px" }}>
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
      { value: "UTPL",   label: "UTPL — Unze Trading" },
      { value: "IFPL",   label: "IFPL — Imperial Footwear" },
      { value: "Baranh", label: "Baranh" },
      { value: "HD",     label: "HD" },
      { value: "ALM",    label: "Almahar" },
      { value: "DIR",    label: "Directors" },
      { value: "UZL",    label: "Unze London" },
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
            {/* Tabs + Add Entry button */}
            <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "12px" }}>
              {(["fuel", "maintenance", "summary"] as const).map((t) => (
                <button key={t} onClick={() => setVehicleDetailTab(t)} style={{ padding: "5px 14px", borderRadius: "20px", border: "none", fontSize: "12px", fontWeight: 600, cursor: "pointer", backgroundColor: vehicleDetailTab === t ? COLOURS.NAVY : "transparent", color: vehicleDetailTab === t ? "white" : COLOURS.SLATE }}>
                  {t === "fuel" ? `Fuel Log${!loadingVehicleDetail && fuel.length ? ` (${fuel.length})` : ""}` : t === "maintenance" ? `Maintenance${!loadingVehicleDetail && maintenance.length ? ` (${maintenance.length})` : ""}` : "YTD Summary"}
                </button>
              ))}
              {vehicleDetailTab === "fuel" && (
                <button
                  onClick={() => setAddingFuel({ date: new Date().toISOString().slice(0, 10), price_per_litre: "", quantity_litres: "", previous_odometer: "", current_odometer: "", notes: "", slipFile: null, slipPreviewUrl: null, stationFile: null, stationPreviewUrl: null, finishedFile: null, finishedPreviewUrl: null })}
                  style={{ marginLeft: "auto", padding: "5px 13px", borderRadius: "20px", border: `1px solid ${COLOURS.NAVY}`, backgroundColor: COLOURS.NAVY, color: "white", fontSize: "12px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" as const }}>
                  ＋ Log Entry
                </button>
              )}
              {vehicleDetailTab === "maintenance" && canManageLocations && (
                <button
                  onClick={() => setAddingMaint({ date: new Date().toISOString().slice(0, 10), work_type: "", description: "", odometer_km: "", workshop: "", cost_pkr: "", next_service_due: "" })}
                  style={{ marginLeft: "auto", padding: "5px 13px", borderRadius: "20px", border: `1px solid ${COLOURS.NAVY}`, backgroundColor: COLOURS.NAVY, color: "white", fontSize: "12px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" as const }}>
                  ＋ Log Maintenance
                </button>
              )}
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
                        <th style={thR}>Slip</th>
                        {canAmendFuel && <th style={thR}></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {fuel.map((f, i) => {
                        const gapDays = i > 0
                          ? Math.round((new Date(f.date).getTime() - new Date(fuel[i - 1].date).getTime()) / 86400000)
                          : 0;
                        return (
                          <Fragment key={f.id || i}>
                            {i > 0 && gapDays > 14 && (
                              <tr>
                                <td colSpan={canAmendFuel ? 8 : 7} style={{ padding: "4px 10px", fontSize: "11px", fontWeight: 700, color: "#92400E", backgroundColor: "#FFFBEB", borderTop: "1px dashed #FDE68A", borderBottom: "1px dashed #FDE68A", textAlign: "center" }}>
                                  ⚠ GAP: {gapDays} days — possible missed slip
                                </td>
                              </tr>
                            )}
                            <tr style={{ backgroundColor: i % 2 === 0 ? "white" : "#FAFBFC" }}>
                              <td style={tdS}>{formatDateUK(f.date)}</td>
                              <td style={tdR}>{f.quantity_litres.toFixed(1)}</td>
                              <td style={tdR}>{f.price_per_litre.toFixed(1)}</td>
                              <td style={{ ...tdR, fontWeight: 600 }}>{f.amount_pkr ? Math.round(f.amount_pkr).toLocaleString() : "—"}</td>
                              <td style={{ ...tdR, color: COLOURS.SLATE, fontFamily: "monospace" }}>{f.current_odometer ? f.current_odometer.toLocaleString() : "—"}</td>
                              <td style={{ ...tdR, color: f.km_per_litre ? COLOURS.GREEN : COLOURS.SLATE, fontWeight: f.km_per_litre ? 600 : 400 }}>{f.km_per_litre ? f.km_per_litre.toFixed(1) : "—"}</td>
                              <td style={{ ...tdR, width: "36px", padding: "4px" }}>
                                {f.slip_image_url
                                  ? <a href={f.slip_image_url} target="_blank" rel="noreferrer" title="View fuel slip" style={{ fontSize: "15px", textDecoration: "none" }}>📷</a>
                                  : <span style={{ fontSize: "11px", color: COLOURS.SLATE, opacity: 0.4 }}>—</span>}
                              </td>
                              {canAmendFuel && (
                                <td style={{ ...tdR, width: "28px", padding: "4px" }}>
                                  <button onClick={() => { if (editSlipPreviewUrl) URL.revokeObjectURL(editSlipPreviewUrl); setEditSlipFile(null); setEditSlipPreviewUrl(null); setEditingFuel({ ...f }); }} style={{ border: "none", background: "none", cursor: "pointer", color: COLOURS.SLATE, fontSize: "13px", padding: "2px 5px", borderRadius: "4px" }} title="Edit entry">✎</button>
                                </td>
                              )}
                            </tr>
                          </Fragment>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ backgroundColor: "#F0F4F8" }}>
                        <td style={{ ...tdS, fontWeight: 700 }}>Total</td>
                        <td style={{ ...tdR, fontWeight: 700 }}>{totalLitres.toFixed(1)}</td>
                        <td style={tdR}></td>
                        <td style={{ ...tdR, fontWeight: 700 }}>{Math.round(totalFuelCost).toLocaleString()}</td>
                        <td style={{ ...tdR, color: COLOURS.SLATE, fontFamily: "monospace" }}>{totalKm > 0 ? `${totalKm.toLocaleString()} km` : "—"}</td>
                        <td style={{ ...tdR, fontWeight: 700, color: COLOURS.GREEN }}>{totalLitres > 0 && totalKm > 0 ? (totalKm / totalLitres).toFixed(1) : "—"}</td>
                        <td></td>
                        {canAmendFuel && <td></td>}
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
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3, 1fr)", gap: "10px", marginBottom: "18px" }}>
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
        {safeActiveTab === "registrations" && renderRegistrations()}

        {/* ── PAYMENTS ── */}
        {safeActiveTab === "payments" && (
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
        {safeActiveTab === "compliance" && (
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
        {safeActiveTab === "documents" && (
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
        {safeActiveTab === "legal" && <LegalCases />}

        {safeActiveTab === "visitors" && renderVisitorsTab()}

        {safeActiveTab === "generators" && renderGeneratorsTab()}

        {safeActiveTab === "operations" && (
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
                  <button
                    onClick={() => {
                      const first = solarBranches[0];
                      setAddingSolar({ branch_id: first?.branch_id ?? "", branch_name: first?.branch_name ?? "", date: new Date().toISOString().slice(0, 10), production_kwh: "", status: "normal", notes: "" });
                    }}
                    style={{ fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "20px", border: `1px solid ${COLOURS.GREEN}`, backgroundColor: COLOURS.GREEN, color: "white", cursor: "pointer", whiteSpace: "nowrap" }}>
                    ☀️ Log Reading
                  </button>
                )}
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
                  <button
                    onClick={() => {
                      const first = utilityLocations[0];
                      setAddingUtility({ location_id: first?.location_id ?? "", location_name: first?.location_name ?? "", meter_label: "", utility_company: "", reading_date: new Date().toISOString().slice(0, 10), current_reading: "", previous_reading: "", bill_amount_pkr: "" });
                    }}
                    style={{ fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "20px", border: `1px solid ${COLOURS.GREEN}`, backgroundColor: COLOURS.GREEN, color: "white", cursor: "pointer", whiteSpace: "nowrap" }}>
                    ⚡ Log Bill
                  </button>
                )}
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
                    {["UTPL", "IFPL", "Baranh", "HD", "ALM", "DIR", "UZL"].map((e) => <option key={e}>{e}</option>)}
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

      {/* ── Fuel add-entry modal ────────────────────────────────────────── */}
      {addingFuel && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
          onClick={() => { if (!savingFuelAdd) { if (addingFuel?.slipPreviewUrl) URL.revokeObjectURL(addingFuel.slipPreviewUrl); if (addingFuel?.stationPreviewUrl) URL.revokeObjectURL(addingFuel.stationPreviewUrl); if (addingFuel?.finishedPreviewUrl) URL.revokeObjectURL(addingFuel.finishedPreviewUrl); setAddingFuel(null); } }}
        >
          <div
            style={{ background: "white", borderRadius: "14px", padding: "24px 28px", width: "460px", maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", maxHeight: "90vh", overflowY: "auto" }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 4px", fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>Log Fuel Entry</h3>
            <p style={{ margin: "0 0 18px", fontSize: "12px", color: COLOURS.SLATE }}>{vehiclePanel?.vehicleName} · {vehiclePanel?.plateNumber}</p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              {/* Date */}
              <label style={{ gridColumn: "1/-1" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Date</span>
                <input type="date" value={addingFuel.date}
                  onChange={e => setAddingFuel(f => f && ({ ...f, date: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" as const }} />
              </label>

              {/* Qty */}
              <label>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Qty (Litres)</span>
                <input type="number" step="0.1" min="0" placeholder="e.g. 40.0" value={addingFuel.quantity_litres}
                  onChange={e => setAddingFuel(f => f && ({ ...f, quantity_litres: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" as const }} />
              </label>

              {/* Price per litre */}
              <label>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>PKR / Litre</span>
                <input type="number" step="0.01" min="0" placeholder="e.g. 270.00" value={addingFuel.price_per_litre}
                  onChange={e => setAddingFuel(f => f && ({ ...f, price_per_litre: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" as const }} />
              </label>

              {/* Prev odometer */}
              <label>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Prev Odometer</span>
                <input type="number" min="0" placeholder="km" value={addingFuel.previous_odometer}
                  onChange={e => setAddingFuel(f => f && ({ ...f, previous_odometer: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" as const }} />
              </label>

              {/* Curr odometer */}
              <label>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Curr Odometer</span>
                <input type="number" min="0" placeholder="km" value={addingFuel.current_odometer}
                  onChange={e => setAddingFuel(f => f && ({ ...f, current_odometer: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" as const }} />
              </label>

              {/* Notes */}
              <label style={{ gridColumn: "1/-1" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Notes (optional)</span>
                <textarea value={addingFuel.notes}
                  onChange={e => setAddingFuel(f => f && ({ ...f, notes: e.target.value }))}
                  rows={2}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", resize: "vertical", boxSizing: "border-box" as const }} />
              </label>

              {/* Fuel slip image capture */}
              <div style={{ gridColumn: "1/-1" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Fuel Slip Photo (optional)</span>
                <label style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "10px 14px", borderRadius: "8px",
                  border: `1.5px dashed ${addingFuel.slipPreviewUrl ? COLOURS.GREEN : COLOURS.HAIRLINE}`,
                  cursor: "pointer", backgroundColor: addingFuel.slipPreviewUrl ? "#F0FDF4" : "#FAFBFC",
                  transition: "border-color 0.15s",
                }}>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: "none" }}
                    onChange={async (e) => {
                      const raw = e.target.files?.[0];
                      if (!raw) return;
                      const compressed = await compressImage(raw);
                      const previewUrl = URL.createObjectURL(compressed);
                      setAddingFuel(f => f && ({ ...f, slipFile: compressed, slipPreviewUrl: previewUrl }));
                    }}
                  />
                  <span style={{ fontSize: "20px" }}>📷</span>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY }}>
                      {addingFuel.slipFile ? addingFuel.slipFile.name : "Tap to capture slip"}
                    </div>
                    <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "1px" }}>
                      {addingFuel.slipFile
                        ? `${(addingFuel.slipFile.size / 1024).toFixed(0)} KB · compressed to 72 DPI`
                        : "Opens phone camera · auto-compressed to 72 DPI"}
                    </div>
                  </div>
                  {addingFuel.slipPreviewUrl && (
                    <img src={addingFuel.slipPreviewUrl} alt="slip preview"
                      style={{ width: "48px", height: "48px", objectFit: "cover", borderRadius: "6px", marginLeft: "auto", border: `1px solid ${COLOURS.HAIRLINE}` }} />
                  )}
                </label>
                {addingFuel.slipFile && (
                  <button
                    onClick={() => {
                      if (addingFuel.slipPreviewUrl) URL.revokeObjectURL(addingFuel.slipPreviewUrl);
                      setAddingFuel(f => f && ({ ...f, slipFile: null, slipPreviewUrl: null }));
                    }}
                    style={{ marginTop: "6px", fontSize: "11px", color: COLOURS.SLATE, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    ✕ Remove photo
                  </button>
                )}
              </div>

              {/* Station photo */}
              <div style={{ gridColumn: "1/-1" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>⛽ Pump Filling Station Photo <span style={{ fontWeight: 400, textTransform: "none" as const }}>(optional)</span></span>
                <label style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "10px 14px", borderRadius: "8px",
                  border: `1.5px dashed ${addingFuel.stationPreviewUrl ? COLOURS.GREEN : COLOURS.HAIRLINE}`,
                  cursor: "pointer", backgroundColor: addingFuel.stationPreviewUrl ? "#F0FDF4" : "#FAFBFC",
                }}>
                  <input type="file" accept="image/*" capture="environment" style={{ display: "none" }}
                    onChange={async (e) => {
                      const raw = e.target.files?.[0];
                      if (!raw) return;
                      const compressed = await compressImage(raw);
                      const previewUrl = URL.createObjectURL(compressed);
                      setAddingFuel(f => f && ({ ...f, stationFile: compressed, stationPreviewUrl: previewUrl }));
                    }} />
                  <span style={{ fontSize: "20px" }}>📷</span>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY }}>{addingFuel.stationFile ? addingFuel.stationFile.name : "Tap to capture station photo"}</div>
                    <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "1px" }}>{addingFuel.stationFile ? `${(addingFuel.stationFile.size / 1024).toFixed(0)} KB · compressed` : "Opens phone camera · auto-compressed"}</div>
                  </div>
                  {addingFuel.stationPreviewUrl && (
                    <img src={addingFuel.stationPreviewUrl} alt="station preview"
                      style={{ width: "48px", height: "48px", objectFit: "cover", borderRadius: "6px", marginLeft: "auto", border: `1px solid ${COLOURS.HAIRLINE}` }} />
                  )}
                </label>
                {addingFuel.stationFile && (
                  <button onClick={() => { if (addingFuel.stationPreviewUrl) URL.revokeObjectURL(addingFuel.stationPreviewUrl); setAddingFuel(f => f && ({ ...f, stationFile: null, stationPreviewUrl: null })); }}
                    style={{ marginTop: "6px", fontSize: "11px", color: COLOURS.SLATE, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    ✕ Remove photo
                  </button>
                )}
              </div>

              {/* Finished photo */}
              <div style={{ gridColumn: "1/-1" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>✅ Pump Finished Photo <span style={{ fontWeight: 400, textTransform: "none" as const }}>(optional)</span></span>
                <label style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "10px 14px", borderRadius: "8px",
                  border: `1.5px dashed ${addingFuel.finishedPreviewUrl ? COLOURS.GREEN : COLOURS.HAIRLINE}`,
                  cursor: "pointer", backgroundColor: addingFuel.finishedPreviewUrl ? "#F0FDF4" : "#FAFBFC",
                }}>
                  <input type="file" accept="image/*" capture="environment" style={{ display: "none" }}
                    onChange={async (e) => {
                      const raw = e.target.files?.[0];
                      if (!raw) return;
                      const compressed = await compressImage(raw);
                      const previewUrl = URL.createObjectURL(compressed);
                      setAddingFuel(f => f && ({ ...f, finishedFile: compressed, finishedPreviewUrl: previewUrl }));
                    }} />
                  <span style={{ fontSize: "20px" }}>📷</span>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY }}>{addingFuel.finishedFile ? addingFuel.finishedFile.name : "Tap to capture finished photo"}</div>
                    <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "1px" }}>{addingFuel.finishedFile ? `${(addingFuel.finishedFile.size / 1024).toFixed(0)} KB · compressed` : "Opens phone camera · auto-compressed"}</div>
                  </div>
                  {addingFuel.finishedPreviewUrl && (
                    <img src={addingFuel.finishedPreviewUrl} alt="finished preview"
                      style={{ width: "48px", height: "48px", objectFit: "cover", borderRadius: "6px", marginLeft: "auto", border: `1px solid ${COLOURS.HAIRLINE}` }} />
                  )}
                </label>
                {addingFuel.finishedFile && (
                  <button onClick={() => { if (addingFuel.finishedPreviewUrl) URL.revokeObjectURL(addingFuel.finishedPreviewUrl); setAddingFuel(f => f && ({ ...f, finishedFile: null, finishedPreviewUrl: null })); }}
                    style={{ marginTop: "6px", fontSize: "11px", color: COLOURS.SLATE, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    ✕ Remove photo
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: "8px", marginTop: "20px" }}>
              <button
                disabled={savingFuelAdd || !addingFuel.date || !addingFuel.price_per_litre || !addingFuel.quantity_litres}
                onClick={async () => {
                  if (!vehiclePanel) return;
                  setSavingFuelAdd(true);
                  try {
                    const uploadPhoto = async (file: File | null): Promise<string | null> => {
                      if (!file) return null;
                      const fd = new FormData();
                      fd.append("file", file);
                      const res = await authFetch("/api/admin/fuel/upload", { method: "POST", body: fd });
                      if (!res.ok) return null;
                      const { url } = await res.json();
                      return url ?? null;
                    };
                    const [slip_image_url, station_image_url, finished_image_url] = await Promise.all([
                      uploadPhoto(addingFuel.slipFile),
                      uploadPhoto(addingFuel.stationFile),
                      uploadPhoto(addingFuel.finishedFile),
                    ]);

                    await authFetch("/api/admin/fuel", {
                      method: "POST",
                      body: JSON.stringify({
                        vehicle_id:        vehiclePanel.vehicleId,
                        date:              addingFuel.date,
                        price_per_litre:   addingFuel.price_per_litre,
                        quantity_litres:   addingFuel.quantity_litres,
                        previous_odometer: addingFuel.previous_odometer || null,
                        current_odometer:  addingFuel.current_odometer  || null,
                        notes:             addingFuel.notes || null,
                        slip_image_url, station_image_url, finished_image_url,
                      }),
                    });

                    if (addingFuel.slipPreviewUrl) URL.revokeObjectURL(addingFuel.slipPreviewUrl);
                    if (addingFuel.stationPreviewUrl) URL.revokeObjectURL(addingFuel.stationPreviewUrl);
                    if (addingFuel.finishedPreviewUrl) URL.revokeObjectURL(addingFuel.finishedPreviewUrl);
                    vehicleDetailCache.current.clear();
                    loadVehicleDetail(vehiclePanel.vehicleId, vehicleDetailYear);
                    setAddingFuel(null);
                  } finally {
                    setSavingFuelAdd(false);
                  }
                }}
                style={{ flex: 1, padding: "9px", backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "8px", fontWeight: 600, fontSize: "13px", cursor: (savingFuelAdd || !addingFuel.date || !addingFuel.price_per_litre || !addingFuel.quantity_litres) ? "default" : "pointer", opacity: (savingFuelAdd || !addingFuel.date || !addingFuel.price_per_litre || !addingFuel.quantity_litres) ? 0.6 : 1 }}
              >
                {savingFuelAdd ? "Saving…" : "Save Entry"}
              </button>
              <button
                disabled={savingFuelAdd}
                onClick={() => {
                  if (addingFuel.slipPreviewUrl) URL.revokeObjectURL(addingFuel.slipPreviewUrl);
                  if (addingFuel.stationPreviewUrl) URL.revokeObjectURL(addingFuel.stationPreviewUrl);
                  if (addingFuel.finishedPreviewUrl) URL.revokeObjectURL(addingFuel.finishedPreviewUrl);
                  setAddingFuel(null);
                }}
                style={{ padding: "9px 14px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", cursor: "pointer", background: "white", color: COLOURS.NAVY }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Fuel entry amendment modal ───────────────────────────────────── */}
      {editingFuel && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => { if (!savingFuelEdit) { if (editSlipPreviewUrl) URL.revokeObjectURL(editSlipPreviewUrl); setEditSlipFile(null); setEditSlipPreviewUrl(null); setEditingFuel(null); } }}
        >
          <div
            style={{ background: "white", borderRadius: "14px", padding: "24px 28px", width: "440px", maxWidth: "92vw", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 18px", fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>Edit Fuel Entry</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <label style={{ gridColumn: "1/-1" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Date</span>
                <input type="date" value={editingFuel.date}
                  onChange={e => setEditingFuel(f => f && ({ ...f, date: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" as const }} />
              </label>
              <label>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Qty (Litres)</span>
                <input type="number" step="0.1" min="0" value={editingFuel.quantity_litres}
                  onChange={e => setEditingFuel(f => f && ({ ...f, quantity_litres: parseFloat(e.target.value) || 0 }))}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" as const }} />
              </label>
              <label>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>PKR / Litre</span>
                <input type="number" step="0.01" min="0" value={editingFuel.price_per_litre}
                  onChange={e => setEditingFuel(f => f && ({ ...f, price_per_litre: parseFloat(e.target.value) || 0 }))}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" as const }} />
              </label>
              <label>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Prev Odometer</span>
                <input type="number" min="0" value={editingFuel.previous_odometer ?? ""}
                  onChange={e => setEditingFuel(f => f && ({ ...f, previous_odometer: e.target.value ? parseInt(e.target.value) : null }))}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" as const }} />
              </label>
              <label>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Curr Odometer</span>
                <input type="number" min="0" value={editingFuel.current_odometer ?? ""}
                  onChange={e => setEditingFuel(f => f && ({ ...f, current_odometer: e.target.value ? parseInt(e.target.value) : null }))}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" as const }} />
              </label>
              <label style={{ gridColumn: "1/-1" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Notes</span>
                <textarea value={editingFuel.notes ?? ""}
                  onChange={e => setEditingFuel(f => f && ({ ...f, notes: e.target.value }))}
                  rows={2}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", resize: "vertical", boxSizing: "border-box" as const }} />
              </label>
              {/* Slip image — view existing or upload new */}
              <div style={{ gridColumn: "1/-1" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "6px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Fuel Slip Photo</span>
                {/* Existing image (if no new one selected) */}
                {(editingFuel.slip_image_url && !editSlipPreviewUrl) && (
                  <div style={{ position: "relative", display: "inline-block", borderRadius: "8px", overflow: "hidden", border: `1px solid ${COLOURS.HAIRLINE}`, marginBottom: "8px" }}>
                    <img src={editingFuel.slip_image_url} alt="Fuel slip"
                      style={{ display: "block", maxWidth: "100%", maxHeight: "160px", objectFit: "contain", backgroundColor: "#F8F9FA" }} />
                    <a href={editingFuel.slip_image_url} target="_blank" rel="noreferrer"
                      style={{ position: "absolute", top: "6px", right: "6px", background: "rgba(0,0,0,0.55)", color: "white", fontSize: "11px", fontWeight: 600, padding: "3px 8px", borderRadius: "6px", textDecoration: "none" }}>
                      View full ↗
                    </a>
                  </div>
                )}
                {/* New image preview */}
                {editSlipPreviewUrl && (
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                    <img src={editSlipPreviewUrl} alt="new slip"
                      style={{ height: "64px", borderRadius: "6px", objectFit: "cover", border: `1px solid ${COLOURS.HAIRLINE}` }} />
                    <button type="button" onClick={() => { if (editSlipPreviewUrl) URL.revokeObjectURL(editSlipPreviewUrl); setEditSlipFile(null); setEditSlipPreviewUrl(null); }}
                      style={{ fontSize: "12px", color: COLOURS.SLATE, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Remove</button>
                  </div>
                )}
                {/* Upload / replace button */}
                <label style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", border: `1.5px dashed ${editSlipPreviewUrl ? COLOURS.GREEN : COLOURS.HAIRLINE}`, borderRadius: "8px", cursor: "pointer", backgroundColor: editSlipPreviewUrl ? "#F0FDF4" : "#FAFBFC" }}>
                  <span style={{ fontSize: "16px" }}>📷</span>
                  <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{editSlipFile ? `${editSlipFile.name} (${(editSlipFile.size/1024).toFixed(0)} KB)` : editingFuel.slip_image_url ? "Replace photo" : "Attach slip photo"}</span>
                  <input type="file" accept="image/*" capture="environment" style={{ display: "none" }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const compressed = await compressImage(file);
                      const previewUrl = URL.createObjectURL(compressed);
                      if (editSlipPreviewUrl) URL.revokeObjectURL(editSlipPreviewUrl);
                      setEditSlipFile(compressed);
                      setEditSlipPreviewUrl(previewUrl);
                      e.target.value = "";
                    }} />
                </label>
              </div>
            </div>
            {editingFuel.entered_by && (
              <p style={{ fontSize: "11px", color: COLOURS.SLATE, margin: "10px 0 0" }}>Originally entered by {editingFuel.entered_by}</p>
            )}
            <div style={{ display: "flex", gap: "8px", marginTop: "20px" }}>
              <button
                disabled={savingFuelEdit}
                onClick={async () => {
                  setSavingFuelEdit(true);
                  try {
                    // Upload new slip image if selected — abort if upload fails
                    let slip_image_url: string | undefined = undefined;
                    if (editSlipFile) {
                      const fd = new FormData();
                      fd.append("file", editSlipFile);
                      const upRes = await authFetch("/api/admin/fuel/upload", { method: "POST", body: fd });
                      const upJson = await upRes.json();
                      if (!upRes.ok) {
                        showToast(upJson.error || "Failed to upload slip image", "error");
                        return;
                      }
                      slip_image_url = upJson.url;
                    }
                    const patchRes = await authFetch("/api/admin/fuel", {
                      method: "PATCH",
                      body: JSON.stringify({
                        id: editingFuel.id,
                        date: editingFuel.date,
                        price_per_litre: editingFuel.price_per_litre,
                        quantity_litres: editingFuel.quantity_litres,
                        previous_odometer: editingFuel.previous_odometer,
                        current_odometer: editingFuel.current_odometer,
                        notes: editingFuel.notes || null,
                        ...(slip_image_url !== undefined ? { slip_image_url } : {}),
                      }),
                    });
                    const patchJson = await patchRes.json();
                    if (!patchRes.ok) {
                      showToast(patchJson.error || "Failed to save changes", "error");
                      return;
                    }
                    if (editSlipPreviewUrl) URL.revokeObjectURL(editSlipPreviewUrl);
                    setEditSlipFile(null);
                    setEditSlipPreviewUrl(null);
                    vehicleDetailCache.current.clear();
                    if (vehiclePanel) loadVehicleDetail(vehiclePanel.vehicleId, vehicleDetailYear);
                    setEditingFuel(null);
                  } finally {
                    setSavingFuelEdit(false);
                  }
                }}
                style={{ flex: 1, padding: "9px", backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "8px", fontWeight: 600, fontSize: "13px", cursor: savingFuelEdit ? "default" : "pointer", opacity: savingFuelEdit ? 0.7 : 1 }}
              >
                {savingFuelEdit ? "Saving…" : "Save Changes"}
              </button>
              <button
                disabled={savingFuelEdit}
                onClick={async () => {
                  if (!window.confirm("Delete this fuel entry? This cannot be undone.")) return;
                  setSavingFuelEdit(true);
                  await authFetch(`/api/admin/fuel?id=${editingFuel.id}`, { method: "DELETE" });
                  vehicleDetailCache.current.clear();
                  if (vehiclePanel) loadVehicleDetail(vehiclePanel.vehicleId, vehicleDetailYear);
                  setEditingFuel(null);
                  setSavingFuelEdit(false);
                }}
                style={{ padding: "9px 14px", backgroundColor: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: "8px", fontWeight: 600, fontSize: "13px", cursor: savingFuelEdit ? "default" : "pointer" }}
              >
                Delete
              </button>
              <button
                disabled={savingFuelEdit}
                onClick={() => setEditingFuel(null)}
                style={{ padding: "9px 14px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", cursor: "pointer", background: "white", color: COLOURS.NAVY }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Solar log-reading modal ──────────────────────────────────────── */}
      {addingSolar && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
          onClick={() => { if (!savingSolarAdd) setAddingSolar(null); }}
        >
          <div
            style={{ background: "white", borderRadius: "14px", padding: "24px 28px", width: "420px", maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", maxHeight: "90vh", overflowY: "auto" }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 4px", fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>☀️ Log Solar Reading</h3>
            <p style={{ margin: "0 0 18px", fontSize: "12px", color: COLOURS.SLATE }}>Record monthly solar production for a branch</p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              {/* Branch */}
              <label style={{ gridColumn: "1/-1" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Branch</span>
                <select value={addingSolar.branch_id}
                  onChange={e => {
                    const b = solarBranches.find(x => x.branch_id === e.target.value);
                    setAddingSolar(s => s && ({ ...s, branch_id: e.target.value, branch_name: b?.branch_name ?? "" }));
                  }}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" as const }}>
                  {solarBranches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>)}
                </select>
              </label>

              {/* Date */}
              <label style={{ gridColumn: "1/-1" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Reading Date</span>
                <DateInput value={addingSolar.date} onChange={e => setAddingSolar(s => s && ({ ...s, date: e.target.value }))} />
              </label>

              {/* Production */}
              <label style={{ gridColumn: "1/-1" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Production (kWh)</span>
                <input type="number" step="0.1" min="0" placeholder="e.g. 320.5" value={addingSolar.production_kwh}
                  onChange={e => setAddingSolar(s => s && ({ ...s, production_kwh: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" as const }} />
              </label>

              {/* Status */}
              <label style={{ gridColumn: "1/-1" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Status</span>
                <select value={addingSolar.status}
                  onChange={e => setAddingSolar(s => s && ({ ...s, status: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" as const }}>
                  <option value="normal">Normal</option>
                  <option value="fault">Fault</option>
                  <option value="offline">Offline</option>
                </select>
              </label>

              {/* Notes */}
              <label style={{ gridColumn: "1/-1" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Notes (optional)</span>
                <textarea value={addingSolar.notes}
                  onChange={e => setAddingSolar(s => s && ({ ...s, notes: e.target.value }))}
                  rows={2}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", resize: "vertical", boxSizing: "border-box" as const }} />
              </label>
            </div>

            <div style={{ display: "flex", gap: "8px", marginTop: "20px" }}>
              <button
                disabled={savingSolarAdd || !addingSolar.branch_id || !addingSolar.date || !addingSolar.production_kwh}
                onClick={async () => {
                  setSavingSolarAdd(true);
                  try {
                    await authFetch("/api/admin/solar", {
                      method: "POST",
                      body: JSON.stringify({
                        branch_id:      addingSolar.branch_id,
                        date:           addingSolar.date,
                        production_kwh: parseFloat(addingSolar.production_kwh),
                        status:         addingSolar.status,
                        notes:          addingSolar.notes || null,
                      }),
                    });
                    setAddingSolar(null);
                    loadSolar();
                  } finally {
                    setSavingSolarAdd(false);
                  }
                }}
                style={{ flex: 1, padding: "9px", backgroundColor: COLOURS.GREEN, color: "white", border: "none", borderRadius: "8px", fontWeight: 600, fontSize: "13px", cursor: (savingSolarAdd || !addingSolar.branch_id || !addingSolar.date || !addingSolar.production_kwh) ? "default" : "pointer", opacity: (savingSolarAdd || !addingSolar.branch_id || !addingSolar.date || !addingSolar.production_kwh) ? 0.6 : 1 }}
              >
                {savingSolarAdd ? "Saving…" : "Save Reading"}
              </button>
              <button
                disabled={savingSolarAdd}
                onClick={() => setAddingSolar(null)}
                style={{ padding: "9px 14px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", cursor: "pointer", background: "white", color: COLOURS.NAVY }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Utility log-bill modal ────────────────────────────────────────── */}
      {addingUtility && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
          onClick={() => { if (!savingUtilityAdd) setAddingUtility(null); }}
        >
          <div
            style={{ background: "white", borderRadius: "14px", padding: "24px 28px", width: "460px", maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", maxHeight: "90vh", overflowY: "auto" }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 4px", fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>⚡ Log Utility Bill</h3>
            <p style={{ margin: "0 0 18px", fontSize: "12px", color: COLOURS.SLATE }}>Record a meter reading and bill amount for a site</p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              {/* Site */}
              <label style={{ gridColumn: "1/-1" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Site</span>
                <select value={addingUtility.location_id}
                  onChange={e => {
                    const loc = utilityLocations.find(x => x.location_id === e.target.value);
                    setAddingUtility(u => u && ({ ...u, location_id: e.target.value, location_name: loc?.location_name ?? "" }));
                  }}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" as const }}>
                  {utilityLocations.map(loc => <option key={loc.location_id} value={loc.location_id}>{loc.location_name}</option>)}
                </select>
              </label>

              {/* Meter label */}
              <label>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Meter Label</span>
                <input type="text" placeholder="e.g. Main" value={addingUtility.meter_label}
                  onChange={e => setAddingUtility(u => u && ({ ...u, meter_label: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" as const }} />
              </label>

              {/* Utility company */}
              <label>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Utility Company</span>
                <input type="text" placeholder="e.g. LESCO" value={addingUtility.utility_company}
                  onChange={e => setAddingUtility(u => u && ({ ...u, utility_company: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" as const }} />
              </label>

              {/* Reading date */}
              <label style={{ gridColumn: "1/-1" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Reading Date</span>
                <DateInput value={addingUtility.reading_date} onChange={e => setAddingUtility(u => u && ({ ...u, reading_date: e.target.value }))} />
              </label>

              {/* Previous reading */}
              <label>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Prev Reading</span>
                <input type="number" min="0" placeholder="units" value={addingUtility.previous_reading}
                  onChange={e => setAddingUtility(u => u && ({ ...u, previous_reading: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" as const }} />
              </label>

              {/* Current reading */}
              <label>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Curr Reading</span>
                <input type="number" min="0" placeholder="units" value={addingUtility.current_reading}
                  onChange={e => setAddingUtility(u => u && ({ ...u, current_reading: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" as const }} />
              </label>

              {/* Bill amount */}
              <label style={{ gridColumn: "1/-1" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Bill Amount (PKR)</span>
                <input type="number" min="0" step="0.01" placeholder="e.g. 15000" value={addingUtility.bill_amount_pkr}
                  onChange={e => setAddingUtility(u => u && ({ ...u, bill_amount_pkr: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" as const }} />
              </label>
            </div>

            <div style={{ display: "flex", gap: "8px", marginTop: "20px" }}>
              <button
                disabled={savingUtilityAdd || !addingUtility.location_id || !addingUtility.reading_date || !addingUtility.current_reading || !addingUtility.bill_amount_pkr}
                onClick={async () => {
                  setSavingUtilityAdd(true);
                  try {
                    await authFetch("/api/admin/utility", {
                      method: "POST",
                      body: JSON.stringify({
                        location_id:      addingUtility.location_id,
                        meter_label:      addingUtility.meter_label || null,
                        utility_company:  addingUtility.utility_company || null,
                        reading_date:     addingUtility.reading_date,
                        current_reading:  parseFloat(addingUtility.current_reading),
                        previous_reading: addingUtility.previous_reading ? parseFloat(addingUtility.previous_reading) : null,
                        bill_amount_pkr:  parseFloat(addingUtility.bill_amount_pkr),
                      }),
                    });
                    setAddingUtility(null);
                    loadUtility();
                  } finally {
                    setSavingUtilityAdd(false);
                  }
                }}
                style={{ flex: 1, padding: "9px", backgroundColor: COLOURS.GREEN, color: "white", border: "none", borderRadius: "8px", fontWeight: 600, fontSize: "13px", cursor: (savingUtilityAdd || !addingUtility.location_id || !addingUtility.reading_date || !addingUtility.current_reading || !addingUtility.bill_amount_pkr) ? "default" : "pointer", opacity: (savingUtilityAdd || !addingUtility.location_id || !addingUtility.reading_date || !addingUtility.current_reading || !addingUtility.bill_amount_pkr) ? 0.6 : 1 }}
              >
                {savingUtilityAdd ? "Saving…" : "Save Bill"}
              </button>
              <button
                disabled={savingUtilityAdd}
                onClick={() => setAddingUtility(null)}
                style={{ padding: "9px 14px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", cursor: "pointer", background: "white", color: COLOURS.NAVY }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Maintenance log modal ─────────────────────────────────────────── */}
      {addingMaint && vehiclePanel && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 10001, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
          onClick={() => { if (!savingMaintAdd) setAddingMaint(null); }}
        >
          <div
            style={{ background: "white", borderRadius: "14px", padding: "24px 28px", width: "460px", maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", maxHeight: "90vh", overflowY: "auto" }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 4px", fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>🔧 Log Maintenance</h3>
            <p style={{ margin: "0 0 18px", fontSize: "12px", color: COLOURS.SLATE }}>{vehiclePanel.vehicleName} · {vehiclePanel.plateNumber}</p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              {/* Date */}
              <label style={{ gridColumn: "1/-1" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Date</span>
                <DateInput value={addingMaint.date} onChange={e => setAddingMaint(m => m && ({ ...m, date: e.target.value }))} />
              </label>

              {/* Work type */}
              <label style={{ gridColumn: "1/-1" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Work Type</span>
                <input type="text" placeholder="e.g. Oil Change, Tyre Replacement" value={addingMaint.work_type}
                  onChange={e => setAddingMaint(m => m && ({ ...m, work_type: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" as const }} />
              </label>

              {/* Description */}
              <label style={{ gridColumn: "1/-1" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Description (optional)</span>
                <textarea value={addingMaint.description}
                  onChange={e => setAddingMaint(m => m && ({ ...m, description: e.target.value }))}
                  rows={2}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", resize: "vertical", boxSizing: "border-box" as const }} />
              </label>

              {/* Odometer */}
              <label>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Odometer (km)</span>
                <input type="number" min="0" placeholder="km" value={addingMaint.odometer_km}
                  onChange={e => setAddingMaint(m => m && ({ ...m, odometer_km: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" as const }} />
              </label>

              {/* Cost */}
              <label>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Cost (PKR)</span>
                <input type="number" min="0" step="0.01" placeholder="e.g. 5000" value={addingMaint.cost_pkr}
                  onChange={e => setAddingMaint(m => m && ({ ...m, cost_pkr: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" as const }} />
              </label>

              {/* Workshop */}
              <label style={{ gridColumn: "1/-1" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Workshop (optional)</span>
                <input type="text" placeholder="e.g. Al-Noor Auto Workshop" value={addingMaint.workshop}
                  onChange={e => setAddingMaint(m => m && ({ ...m, workshop: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" as const }} />
              </label>

              {/* Next service due */}
              <label style={{ gridColumn: "1/-1" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Next Service Due (optional)</span>
                <DateInput value={addingMaint.next_service_due} onChange={e => setAddingMaint(m => m && ({ ...m, next_service_due: e.target.value }))} />
              </label>
            </div>

            <div style={{ display: "flex", gap: "8px", marginTop: "20px" }}>
              <button
                disabled={savingMaintAdd || !addingMaint.date || !addingMaint.work_type}
                onClick={async () => {
                  if (!vehiclePanel) return;
                  setSavingMaintAdd(true);
                  try {
                    await authFetch("/api/admin/maintenance", {
                      method: "POST",
                      body: JSON.stringify({
                        vehicle_id:       vehiclePanel.vehicleId,
                        date:             addingMaint.date,
                        work_type:        addingMaint.work_type,
                        description:      addingMaint.description || null,
                        odometer_km:      addingMaint.odometer_km ? parseInt(addingMaint.odometer_km) : null,
                        workshop:         addingMaint.workshop || null,
                        cost_pkr:         addingMaint.cost_pkr ? parseFloat(addingMaint.cost_pkr) : null,
                        next_service_due: addingMaint.next_service_due || null,
                      }),
                    });
                    vehicleDetailCache.current.clear();
                    loadVehicleDetail(vehiclePanel.vehicleId, vehicleDetailYear);
                    setAddingMaint(null);
                  } finally {
                    setSavingMaintAdd(false);
                  }
                }}
                style={{ flex: 1, padding: "9px", backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "8px", fontWeight: 600, fontSize: "13px", cursor: (savingMaintAdd || !addingMaint.date || !addingMaint.work_type) ? "default" : "pointer", opacity: (savingMaintAdd || !addingMaint.date || !addingMaint.work_type) ? 0.6 : 1 }}
              >
                {savingMaintAdd ? "Saving…" : "Save Entry"}
              </button>
              <button
                disabled={savingMaintAdd}
                onClick={() => setAddingMaint(null)}
                style={{ padding: "9px 14px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "8px", fontSize: "13px", cursor: "pointer", background: "white", color: COLOURS.NAVY }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </AuthWrapper>
  );
}
