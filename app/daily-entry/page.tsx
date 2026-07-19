"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { useRequireCapability } from "../lib/useRouteGuard";
import { isDailyEntryOnly } from "../lib/permissions";
import { supabase } from "../lib/supabase";
import DateInput from "../lib/DateInput";
import { COLOURS, RADII, PageHeader, useToast, primaryButtonStyle, inputStyle } from "../lib/SharedUI";
import { useMobile } from "../lib/useMobile";
import { routeSubmittedTask } from "../lib/taskRouting";

// ── Types ─────────────────────────────────────────────────────────────

type Vehicle  = { id: string; name: string; plate_number: string; odometer_unit: string };
type Branch   = { id: string; name: string; system_kw: number | null };
type Location = { id: string; name: string; entity: string; default_disco: string | null };

type FormType = "fuel" | "solar" | "utility" | "maintenance" | "tasks";

type MyTask = {
  id: string;
  description: string;
  project: string | null;
  due_date: string | null;
  priority: string | null;
  status: string;
  notes: string | null;
  assigned_to: string | null;
  assigned_to_email: string | null;
  requires_manager_signoff: boolean | null;
};

type RecentFuel = {
  date: string; quantity_litres: number; price_per_litre: number;
  amount_pkr: number | null; current_odometer: number | null; km_per_litre: number | null;
};
type RecentMaint = {
  date: string; work_type: string; description: string | null;
  odometer_km: number | null; cost_pkr: number; workshop: string | null;
};
type RecentSolar = { date: string; production_kwh: number; status: string | null };
type RecentUtility = {
  reading_date: string; current_reading: number | null; previous_reading: number | null;
  units_consumed: number | null; bill_amount_pkr: number | null; meter_label: string;
};

// ── Helper ────────────────────────────────────────────────────────────

async function authedFetch(url: string, opts: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${session?.access_token}` },
  });
}

const today = new Date().toISOString().slice(0, 10);

const SOLAR_STATUSES = ["Active", "Inverter Issue", "Internet Issue", "Solar Damage", "Inactive"];
const MAINTENANCE_TYPES = [
  "Oil Change", "Tyre Rotation", "Brake Service", "Battery Replacement",
  "Air Filter", "AC Service", "Wheel Alignment", "General Service", "Repair", "Other",
];
const UTILITY_COMPANIES = ["LESCO", "MEPCO", "FESCO", "PESCO", "HESCO", "IESCO", "SSGC", "SNGPL", "Other"];

// ── Styles ────────────────────────────────────────────────────────────

const sectionCard: React.CSSProperties = {
  border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD,
  padding: "20px", backgroundColor: COLOURS.CARD, marginBottom: "16px",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "5px" }}>{label}</label>
      {children}
    </div>
  );
}


// ── Main page ─────────────────────────────────────────────────────────

export default function DailyEntryPage() {
  const { checking, ctx } = useRequireCapability("admin_entry");
  const entryOnly = ctx ? isDailyEntryOnly(ctx) : false;
  const isMobile = useMobile();
  const { show: showToast, element: toastElement } = useToast();

  const [activeForm, setActiveForm] = useState<FormType>("fuel");
  const [vehicles,  setVehicles]  = useState<Vehicle[]>([]);
  const [branches,  setBranches]  = useState<Branch[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);

  // ── Fuel form ──────────────────────────────────────────────────────
  const [fuel, setFuel] = useState({
    vehicle_id: "", date: today,
    price_per_litre: "", quantity_litres: "",
    previous_odometer: "", current_odometer: "", notes: "",
  });
  const [loadingOdo, setLoadingOdo] = useState(false);
  const [submittingFuel, setSubmittingFuel] = useState(false);

  // ── Maintenance last-ODO (to show reference + validate forward-only) ─
  const [lastMaintOdo, setLastMaintOdo] = useState<number | null>(null);

  // ── Solar form ─────────────────────────────────────────────────────
  const [solar, setSolar] = useState({
    branch_id: "", date: today,
    production_kwh: "", status: "Active", notes: "",
  });
  const [submittingSolar, setSubmittingSolar] = useState(false);

  // ── Utility form ───────────────────────────────────────────────────
  const [utility, setUtility] = useState({
    location_id: "", meter_label: "Meter 1", utility_company: "",
    reading_date: today, current_reading: "", previous_reading: "", bill_amount_pkr: "",
  });
  const [loadingLastReading, setLoadingLastReading] = useState(false);
  const [submittingUtility, setSubmittingUtility] = useState(false);

  // ── Maintenance form ───────────────────────────────────────────────
  const [maint, setMaint] = useState({
    vehicle_id: "", date: today,
    work_types: [] as string[], description: "",
    odometer_km: "", workshop: "", cost_pkr: "", next_service_due: "",
  });
  const [submittingMaint, setSubmittingMaint] = useState(false);

  // ── Recent entries (per-form history) ─────────────────────────────
  const [recentFuel,    setRecentFuel]    = useState<RecentFuel[]>([]);
  const [recentMaint,   setRecentMaint]   = useState<RecentMaint[]>([]);
  const [recentSolar,   setRecentSolar]   = useState<RecentSolar[]>([]);
  const [recentUtility, setRecentUtility] = useState<RecentUtility[]>([]);

  // ── My tasks ───────────────────────────────────────────────────────
  const [myTasks,       setMyTasks]       = useState<MyTask[]>([]);
  const [loadingTasks,  setLoadingTasks]  = useState(false);
  const [updatingTask,  setUpdatingTask]  = useState<string | null>(null);

  // ── Computed fuel values ───────────────────────────────────────────
  const fuelAmount = fuel.price_per_litre && fuel.quantity_litres
    ? (parseFloat(fuel.price_per_litre) * parseFloat(fuel.quantity_litres)).toFixed(2)
    : null;
  const mileage = fuel.current_odometer && fuel.previous_odometer
    ? Math.max(0, parseInt(fuel.current_odometer) - parseInt(fuel.previous_odometer))
    : null;
  const kmPerL = mileage && fuel.quantity_litres && parseFloat(fuel.quantity_litres) > 0
    ? (mileage / parseFloat(fuel.quantity_litres)).toFixed(1)
    : null;

  // ── Computed utility values ────────────────────────────────────────
  const unitsConsumed = utility.current_reading && utility.previous_reading
    ? Math.max(0, parseInt(utility.current_reading) - parseInt(utility.previous_reading))
    : null;

  // ── Load meta on mount ─────────────────────────────────────────────
  useEffect(() => {
    if (checking) return;
    authedFetch("/api/admin/entry-meta")
      .then((r) => r.json())
      .then((json) => {
        setVehicles(json.vehicles || []);
        setBranches(json.branches || []);
        setLocations(json.locations || []);
        if (json.vehicles?.length)  setFuel((f)    => ({ ...f,    vehicle_id: json.vehicles[0].id }));
        if (json.branches?.length)  setSolar((s)   => ({ ...s,   branch_id:  json.branches[0].id }));
        if (json.locations?.length) setUtility((u) => ({ ...u, location_id:  json.locations[0].id }));
        if (json.vehicles?.length)  setMaint((m)   => ({ ...m,   vehicle_id: json.vehicles[0].id }));
        setLoadingMeta(false);
      });
  }, [checking]);

  // Auto-fetch last odometer + recent fuel when vehicle changes
  useEffect(() => {
    if (!fuel.vehicle_id) return;
    setLoadingOdo(true);
    authedFetch(`/api/admin/fuel?vehicle_id=${fuel.vehicle_id}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.data?.current_odometer) {
          setFuel((f) => ({ ...f, previous_odometer: String(json.data.current_odometer) }));
        } else {
          setFuel((f) => ({ ...f, previous_odometer: "" }));
        }
        setLoadingOdo(false);
      });
    authedFetch(`/api/admin/recent-entries?form=fuel&vehicleId=${fuel.vehicle_id}`)
      .then((r) => r.json()).then((j) => setRecentFuel(j.data || []));
  }, [fuel.vehicle_id]);

  // Recent maintenance + last ODO when maintenance vehicle changes
  useEffect(() => {
    if (!maint.vehicle_id) return;
    authedFetch(`/api/admin/recent-entries?form=maintenance&vehicleId=${maint.vehicle_id}`)
      .then((r) => r.json()).then((j) => setRecentMaint(j.data || []));
    // Load last recorded odometer for this vehicle (reuse fuel endpoint)
    authedFetch(`/api/admin/fuel?vehicle_id=${maint.vehicle_id}`)
      .then((r) => r.json())
      .then((json) => setLastMaintOdo(json.data?.current_odometer ?? null));
  }, [maint.vehicle_id]);

  // Recent solar when branch changes
  useEffect(() => {
    if (!solar.branch_id) return;
    authedFetch(`/api/admin/recent-entries?form=solar&branchId=${solar.branch_id}`)
      .then((r) => r.json()).then((j) => setRecentSolar(j.data || []));
  }, [solar.branch_id]);

  // Auto-fetch last utility reading + recent when location+meter changes
  // Also auto-populate DISCO from location's default_disco
  useEffect(() => {
    if (!utility.location_id) return;
    // Auto-populate DISCO
    const loc = locations.find((l) => l.id === utility.location_id);
    if (loc?.default_disco) {
      setUtility((u) => ({ ...u, utility_company: loc.default_disco! }));
    }
    setLoadingLastReading(true);
    authedFetch(`/api/admin/utility?location_id=${utility.location_id}&meter_label=${encodeURIComponent(utility.meter_label)}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.data?.current_reading != null) {
          setUtility((u) => ({ ...u, previous_reading: String(json.data.current_reading) }));
        } else {
          setUtility((u) => ({ ...u, previous_reading: "" }));
        }
        setLoadingLastReading(false);
      });
    authedFetch(`/api/admin/recent-entries?form=utility&locationId=${utility.location_id}&meterLabel=${encodeURIComponent(utility.meter_label)}`)
      .then((r) => r.json()).then((j) => setRecentUtility(j.data || []));
  }, [utility.location_id, utility.meter_label, locations]);

  // Load my tasks when tasks tab is opened
  useEffect(() => {
    if (activeForm !== "tasks" || checking) return;
    loadMyTasks();
  }, [activeForm, checking]);

  async function loadMyTasks() {
    setLoadingTasks(true);
    const { data: { session } } = await supabase.auth.getSession();
    const email = session?.user?.email;
    if (!email) { setLoadingTasks(false); return; }
    const { data } = await supabase
      .from("tasks")
      .select("id, description, project, due_date, priority, status, notes, assigned_to, assigned_to_email, requires_manager_signoff")
      .eq("assigned_to_email", email)
      .not("status", "in", '("Completed","Cancelled")')
      .order("due_date", { ascending: true, nullsFirst: false });
    setMyTasks(data || []);
    setLoadingTasks(false);
  }

  async function updateTaskStatus(task: MyTask, newStatus: string) {
    setUpdatingTask(task.id);
    // When submitting, route to manager (same flow as the main Tasks page)
    const extra = newStatus === "Submitted" && task.status !== "Submitted"
      ? await routeSubmittedTask(task.id, task.assigned_to, task.assigned_to_email, task.requires_manager_signoff !== false)
      : {};
    await supabase.from("tasks").update({
      status: newStatus,
      updated_at: new Date().toISOString(),
      ...extra,
    }).eq("id", task.id);
    // Submitted tasks are now reassigned to the manager — remove from this user's list
    if (newStatus === "Submitted") {
      setMyTasks((prev) => prev.filter((t) => t.id !== task.id));
      showToast("Submitted for review ✓");
    } else {
      setMyTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: newStatus } : t));
      showToast("Task updated");
    }
    setUpdatingTask(null);
  }

  // ── Submit handlers ────────────────────────────────────────────────
  async function submitFuel(e: React.FormEvent) {
    e.preventDefault();
    if (!fuel.vehicle_id || !fuel.date || !fuel.price_per_litre || !fuel.quantity_litres) {
      showToast("Please fill all required fields", "error"); return;
    }
    // Forward-only odometer check
    if (fuel.current_odometer && fuel.previous_odometer) {
      const curr = parseInt(fuel.current_odometer);
      const prev = parseInt(fuel.previous_odometer);
      if (curr < prev) {
        const unit = vehicles.find((v) => v.id === fuel.vehicle_id)?.odometer_unit ?? "km";
        showToast(`Current odometer (${curr.toLocaleString()} ${unit}) cannot be less than last recorded (${prev.toLocaleString()} ${unit})`, "error");
        return;
      }
    }
    setSubmittingFuel(true);
    const res = await authedFetch("/api/admin/fuel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fuel),
    });
    const json = await res.json();
    setSubmittingFuel(false);
    if (json.ok) {
      showToast("Fuel entry saved ✓", "success");
      setFuel((f) => ({ ...f, price_per_litre: "", quantity_litres: "", current_odometer: "", notes: "" }));
      authedFetch(`/api/admin/recent-entries?form=fuel&vehicleId=${fuel.vehicle_id}`)
        .then((r) => r.json()).then((j) => setRecentFuel(j.data || []));
    } else {
      showToast(json.error || "Failed to save", "error");
    }
  }

  async function submitSolar(e: React.FormEvent) {
    e.preventDefault();
    if (!solar.branch_id || !solar.date) {
      showToast("Please select a branch and date", "error"); return;
    }
    setSubmittingSolar(true);
    const res = await authedFetch("/api/admin/solar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(solar),
    });
    const json = await res.json();
    setSubmittingSolar(false);
    if (json.ok) {
      showToast("Solar reading saved ✓", "success");
      setSolar((s) => ({ ...s, production_kwh: "", notes: "", status: "Active" }));
      authedFetch(`/api/admin/recent-entries?form=solar&branchId=${solar.branch_id}`)
        .then((r) => r.json()).then((j) => setRecentSolar(j.data || []));
    } else {
      showToast(json.error || "Failed to save", "error");
    }
  }

  async function submitUtility(e: React.FormEvent) {
    e.preventDefault();
    if (!utility.location_id || !utility.reading_date || !utility.current_reading) {
      showToast("Please fill all required fields", "error"); return;
    }
    // Forward-only meter check
    if (utility.previous_reading !== "") {
      const curr = parseInt(utility.current_reading);
      const prev = parseInt(utility.previous_reading);
      if (curr <= prev) {
        showToast(`Current reading (${curr.toLocaleString()}) must be greater than the last recorded reading (${prev.toLocaleString()})`, "error");
        return;
      }
    }
    setSubmittingUtility(true);
    const res = await authedFetch("/api/admin/utility", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(utility),
    });
    const json = await res.json();
    setSubmittingUtility(false);
    if (json.ok) {
      showToast("Utility reading saved ✓", "success");
      setUtility((u) => ({ ...u, current_reading: "", bill_amount_pkr: "" }));
      authedFetch(`/api/admin/recent-entries?form=utility&locationId=${utility.location_id}&meterLabel=${encodeURIComponent(utility.meter_label)}`)
        .then((r) => r.json()).then((j) => setRecentUtility(j.data || []));
    } else {
      showToast(json.error || "Failed to save", "error");
    }
  }

  async function submitMaint(e: React.FormEvent) {
    e.preventDefault();
    if (!maint.vehicle_id || !maint.date || maint.work_types.length === 0 || !maint.cost_pkr) {
      showToast("Please select at least one work type and fill all required fields", "error"); return;
    }
    // Forward-only odometer check
    if (maint.odometer_km && lastMaintOdo != null) {
      const curr = parseInt(maint.odometer_km);
      if (curr < lastMaintOdo) {
        const unit = vehicles.find((v) => v.id === maint.vehicle_id)?.odometer_unit ?? "km";
        showToast(`Odometer (${curr.toLocaleString()} ${unit}) cannot be less than last recorded (${lastMaintOdo.toLocaleString()} ${unit})`, "error");
        return;
      }
    }
    setSubmittingMaint(true);
    const res = await authedFetch("/api/admin/maintenance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...maint, work_type: maint.work_types.join(", ") }),
    });
    const json = await res.json();
    setSubmittingMaint(false);
    if (json.ok) {
      showToast("Maintenance entry saved ✓", "success");
      setMaint((m) => ({ ...m, work_types: [], description: "", odometer_km: "", workshop: "", cost_pkr: "", next_service_due: "" }));
      authedFetch(`/api/admin/recent-entries?form=maintenance&vehicleId=${maint.vehicle_id}`)
        .then((r) => r.json()).then((j) => setRecentMaint(j.data || []));
    } else {
      showToast(json.error || "Failed to save", "error");
    }
  }

  if (checking || loadingMeta) return (
    <AuthWrapper>
      <main style={{ padding: "14px 18px" }}>
        <p style={{ color: COLOURS.SLATE }}>{checking ? "Checking permissions…" : "Loading…"}</p>
      </main>
    </AuthWrapper>
  );

  const FORMS: { id: FormType; label: string; emoji: string }[] = [
    { id: "fuel",        label: "Fuel",         emoji: "⛽" },
    { id: "solar",       label: "Solar",        emoji: "☀️" },
    { id: "utility",     label: "Utilities",    emoji: "🔌" },
    { id: "maintenance", label: "Maintenance",  emoji: "🔧" },
    { id: "tasks",       label: "My Tasks",     emoji: "✅" },
  ];

  const btnSt = (id: FormType): React.CSSProperties => ({
    padding: isMobile ? "10px 2px" : "12px 4px", borderRadius: RADII.CARD,
    fontSize: isMobile ? "10px" : "12px", fontWeight: 700, cursor: "pointer",
    border: `2px solid ${activeForm === id ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
    backgroundColor: activeForm === id ? COLOURS.NAVY : "white",
    color: activeForm === id ? "white" : COLOURS.SLATE,
    textAlign: "center" as const,
    transition: "all 0.15s",
  });

  const maxW = isMobile ? "100%" : "520px";

  const row2: React.CSSProperties = {
    display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "12px",
  };
  const row3: React.CSSProperties = {
    display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "12px",
  };
  const recentGrid4: React.CSSProperties = {
    display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: "4px",
  };
  const recentGrid3: React.CSSProperties = {
    display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr", gap: "4px",
  };

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: maxW, margin: "0 auto" }}>
        <PageHeader hideHome={entryOnly} />
        <h1 style={{ fontSize: "20px", fontWeight: 800, color: COLOURS.NAVY, margin: "0 0 4px" }}>Daily Entry</h1>
        <p style={{ fontSize: "13px", color: COLOURS.SLATE, margin: "0 0 20px" }}>
          Log fuel, solar, utility, and vehicle maintenance.
        </p>

        {/* Form selector */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "6px", marginBottom: "20px" }}>
          {FORMS.map((f) => (
            <button key={f.id} onClick={() => setActiveForm(f.id)} style={btnSt(f.id)}>
              <div style={{ fontSize: isMobile ? "18px" : "20px", marginBottom: "2px" }}>{f.emoji}</div>
              {f.label}
            </button>
          ))}
        </div>

        {/* ── FUEL ── */}
        {activeForm === "fuel" && (
          <>
          <form onSubmit={submitFuel}>
            <div style={sectionCard}>
              <h2 style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, margin: "0 0 16px" }}>⛽ Fuel Fill-up</h2>

              <Field label="Vehicle *">
                <select value={fuel.vehicle_id} onChange={(e) => setFuel({ ...fuel, vehicle_id: e.target.value })}
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const }}>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>{v.name} ({v.plate_number})</option>
                  ))}
                </select>
              </Field>

              <div style={{ marginTop: "12px" }}>
                <Field label="Date *">
                  <DateInput value={fuel.date} onChange={(e) => setFuel((f) => ({ ...f, date: e.target.value }))} />
                </Field>
              </div>

              <div style={{ ...row2, marginTop: "12px" }}>
                <Field label="Price per litre (PKR) *">
                  <input type="number" step="0.01" min="0" placeholder="e.g. 285.00"
                    value={fuel.price_per_litre} onChange={(e) => setFuel({ ...fuel, price_per_litre: e.target.value })}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const }} />
                </Field>
                <Field label="Quantity (litres) *">
                  <input type="number" step="0.01" min="0" placeholder="e.g. 40.5"
                    value={fuel.quantity_litres} onChange={(e) => setFuel({ ...fuel, quantity_litres: e.target.value })}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const }} />
                </Field>
              </div>

              {fuelAmount && (
                <div style={{ margin: "10px 0", padding: "10px 14px", backgroundColor: "#F0FDF4", borderRadius: RADII.SM, border: `1px solid #9ED4A3` }}>
                  <span style={{ fontSize: "13px", color: COLOURS.SLATE }}>Amount: </span>
                  <span style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.GREEN }}>PKR {parseFloat(fuelAmount).toLocaleString()}</span>
                </div>
              )}

              {(() => {
                const oUnit = vehicles.find((v) => v.id === fuel.vehicle_id)?.odometer_unit ?? "km";
                return (
                  <div style={{ ...row3, marginTop: "12px" }}>
                    <Field label={loadingOdo ? "Last recorded (loading…)" : `Last recorded (${oUnit})`}>
                      <input type="number" min="0" readOnly
                        value={fuel.previous_odometer}
                        placeholder="—"
                        style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const, backgroundColor: "#F1F5F9", color: COLOURS.SLATE, cursor: "not-allowed" }} />
                    </Field>
                    <Field label={`New odometer (${oUnit}) *`}>
                      <input type="number" min="0" placeholder={`Enter current ${oUnit}`}
                        value={fuel.current_odometer} onChange={(e) => setFuel({ ...fuel, current_odometer: e.target.value })}
                        style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const }} />
                    </Field>
                    <Field label="Distance driven">
                      <div style={{ ...inputStyle, backgroundColor: COLOURS.HAIRLINE, color: COLOURS.SLATE, display: "flex", alignItems: "center" }}>
                        {mileage != null ? `${mileage} ${oUnit}` : "—"}
                      </div>
                    </Field>
                  </div>
                );
              })()}

              {kmPerL && (
                <div style={{ margin: "8px 0 0", fontSize: "13px", color: COLOURS.SLATE }}>
                  Efficiency: <strong style={{ color: COLOURS.NAVY }}>{kmPerL} km/L</strong>
                </div>
              )}

              <Field label="Notes (optional)" >
                <textarea value={fuel.notes} onChange={(e) => setFuel({ ...fuel, notes: e.target.value })}
                  rows={2} placeholder="Any notes about this fill-up…"
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const, resize: "vertical" as const, marginTop: "12px" }} />
              </Field>
            </div>

            <button type="submit" disabled={submittingFuel} style={{ ...primaryButtonStyle, width: "100%", padding: "14px", fontSize: "15px", opacity: submittingFuel ? 0.6 : 1 }}>
              {submittingFuel ? "Saving…" : "Save Fuel Entry"}
            </button>
          </form>

          {/* Recent fuel entries */}
          {recentFuel.length > 0 && (
            <div style={{ marginTop: "16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: "8px" }}>Recent fills</div>
              <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", overflow: "hidden", backgroundColor: "white" }}>
                {recentFuel.map((r, i) => (
                  <div key={i} style={{ ...recentGrid4, padding: "10px 14px", borderBottom: i < recentFuel.length - 1 ? `1px solid ${COLOURS.HAIRLINE}` : "none", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY }}>{r.date.split("-").reverse().join("/")}</div>
                      <div style={{ fontSize: "10.5px", color: COLOURS.SLATE }}>{r.current_odometer ? `${r.current_odometer.toLocaleString()} km` : "—"}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY }}>{r.quantity_litres.toFixed(1)} L</div>
                      <div style={{ fontSize: "10.5px", color: COLOURS.SLATE }}>PKR {r.price_per_litre.toFixed(0)}/L</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY }}>{r.amount_pkr ? `PKR ${Math.round(r.amount_pkr).toLocaleString()}` : "—"}</div>
                      <div style={{ fontSize: "10.5px", color: COLOURS.SLATE }}>Amount</div>
                    </div>
                    <div style={{ textAlign: "right" as const }}>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: r.km_per_litre ? COLOURS.GREEN : COLOURS.SLATE }}>{r.km_per_litre ? `${r.km_per_litre.toFixed(1)} km/L` : "—"}</div>
                      <div style={{ fontSize: "10.5px", color: COLOURS.SLATE }}>Efficiency</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          </>
        )}

        {/* ── SOLAR ── */}
        {activeForm === "solar" && (
          <>
          <form onSubmit={submitSolar}>
            <div style={sectionCard}>
              <h2 style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, margin: "0 0 16px" }}>☀️ Solar Production</h2>

              <Field label="Branch *">
                <select value={solar.branch_id} onChange={(e) => setSolar({ ...solar, branch_id: e.target.value })}
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const }}>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}{b.system_kw ? ` (${b.system_kw} kW)` : ""}</option>
                  ))}
                </select>
              </Field>

              <div style={{ marginTop: "12px" }}>
                <Field label="Date *">
                  <DateInput value={solar.date} onChange={(e) => setSolar((s) => ({ ...s, date: e.target.value }))} />
                </Field>
              </div>

              <div style={{ marginTop: "12px" }}>
                <Field label="Production (kWh)">
                  <input type="number" step="0.1" min="0" placeholder="e.g. 142.5"
                    value={solar.production_kwh} onChange={(e) => setSolar({ ...solar, production_kwh: e.target.value })}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const }} />
                </Field>
              </div>

              <div style={{ marginTop: "12px" }}>
                <Field label="Status">
                  <select value={solar.status} onChange={(e) => setSolar({ ...solar, status: e.target.value })}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const }}>
                    {SOLAR_STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </Field>
              </div>

              <div style={{ marginTop: "12px" }}>
                <Field label="Notes (optional)">
                  <textarea value={solar.notes} onChange={(e) => setSolar({ ...solar, notes: e.target.value })}
                    rows={2} placeholder="Inverter issue, weather, etc."
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const, resize: "vertical" as const }} />
                </Field>
              </div>
            </div>

            <button type="submit" disabled={submittingSolar} style={{ ...primaryButtonStyle, width: "100%", padding: "14px", fontSize: "15px", opacity: submittingSolar ? 0.6 : 1 }}>
              {submittingSolar ? "Saving…" : "Save Solar Reading"}
            </button>
          </form>

          {/* Recent solar readings */}
          {recentSolar.length > 0 && (
            <div style={{ marginTop: "16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: "8px" }}>Recent readings</div>
              <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", overflow: "hidden", backgroundColor: "white" }}>
                {recentSolar.map((r, i) => (
                  <div key={i} style={{ ...recentGrid3, padding: "10px 14px", borderBottom: i < recentSolar.length - 1 ? `1px solid ${COLOURS.HAIRLINE}` : "none", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY }}>{r.date.split("-").reverse().join("/")}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY }}>{r.production_kwh != null ? `${r.production_kwh.toFixed(1)} kWh` : "—"}</div>
                      <div style={{ fontSize: "10.5px", color: COLOURS.SLATE }}>Production</div>
                    </div>
                    <div style={{ textAlign: "right" as const }}>
                      <div style={{ fontSize: "11px", fontWeight: 600, color: r.status === "Active" ? COLOURS.GREEN : COLOURS.AMBER }}>
                        {r.status || "—"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          </>
        )}

        {/* ── UTILITY ── */}
        {activeForm === "utility" && (
          <>
          <form onSubmit={submitUtility}>
            <div style={sectionCard}>
              <h2 style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, margin: "0 0 16px" }}>🔌 Utility Reading</h2>

              <Field label="Location *">
                <select value={utility.location_id} onChange={(e) => setUtility({ ...utility, location_id: e.target.value })}
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const }}>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name} ({l.entity})</option>
                  ))}
                </select>
              </Field>

              <div style={{ ...row2, marginTop: "12px" }}>
                <Field label="Meter">
                  <select value={utility.meter_label} onChange={(e) => setUtility({ ...utility, meter_label: e.target.value })}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const }}>
                    {["Meter 1", "Meter 2", "Meter 3"].map((m) => <option key={m}>{m}</option>)}
                  </select>
                </Field>
                <Field label="Utility company">
                  <select value={utility.utility_company} onChange={(e) => setUtility({ ...utility, utility_company: e.target.value })}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const }}>
                    <option value="">Select…</option>
                    {UTILITY_COMPANIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </Field>
              </div>

              <div style={{ marginTop: "12px" }}>
                <Field label="Reading date *">
                  <DateInput value={utility.reading_date} onChange={(e) => setUtility((u) => ({ ...u, reading_date: e.target.value }))} />
                </Field>
              </div>

              <div style={{ ...row2, marginTop: "12px" }}>
                <Field label={loadingLastReading ? "Last recorded (loading…)" : "Last recorded (units)"}>
                  <input type="number" min="0" readOnly
                    value={utility.previous_reading}
                    placeholder="—"
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const, backgroundColor: "#F1F5F9", color: COLOURS.SLATE, cursor: "not-allowed" }} />
                </Field>
                <Field label="New meter reading *">
                  <input type="number" min="0" placeholder="Enter current reading"
                    value={utility.current_reading} onChange={(e) => setUtility({ ...utility, current_reading: e.target.value })}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const }} />
                </Field>
              </div>

              {unitsConsumed != null && (
                <div style={{ margin: "10px 0", padding: "10px 14px", backgroundColor: "#EFF6FF", borderRadius: RADII.SM, border: `1px solid #BFDBFE` }}>
                  <span style={{ fontSize: "13px", color: COLOURS.SLATE }}>Units consumed: </span>
                  <span style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>{unitsConsumed}</span>
                </div>
              )}

              <div style={{ marginTop: "12px" }}>
                <Field label="Bill amount (PKR) — optional">
                  <input type="number" step="0.01" min="0" placeholder="Leave blank if not yet billed"
                    value={utility.bill_amount_pkr} onChange={(e) => setUtility({ ...utility, bill_amount_pkr: e.target.value })}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const }} />
                </Field>
              </div>
            </div>

            <button type="submit" disabled={submittingUtility} style={{ ...primaryButtonStyle, width: "100%", padding: "14px", fontSize: "15px", opacity: submittingUtility ? 0.6 : 1 }}>
              {submittingUtility ? "Saving…" : "Save Utility Reading"}
            </button>
          </form>

          {/* Recent utility readings */}
          {recentUtility.length > 0 && (
            <div style={{ marginTop: "16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: "8px" }}>Recent readings</div>
              <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", overflow: "hidden", backgroundColor: "white" }}>
                {recentUtility.map((r, i) => (
                  <div key={i} style={{ ...recentGrid3, padding: "10px 14px", borderBottom: i < recentUtility.length - 1 ? `1px solid ${COLOURS.HAIRLINE}` : "none", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY }}>{r.reading_date.split("-").reverse().join("/")}</div>
                      <div style={{ fontSize: "10.5px", color: COLOURS.SLATE }}>{r.meter_label}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY }}>{r.units_consumed != null ? `${r.units_consumed} units` : "—"}</div>
                      <div style={{ fontSize: "10.5px", color: COLOURS.SLATE }}>Consumed</div>
                    </div>
                    <div style={{ textAlign: "right" as const }}>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY }}>
                        {r.bill_amount_pkr ? `PKR ${Math.round(r.bill_amount_pkr).toLocaleString()}` : "—"}
                      </div>
                      <div style={{ fontSize: "10.5px", color: COLOURS.SLATE }}>Bill</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          </>
        )}

        {/* ── MAINTENANCE ── */}
        {activeForm === "maintenance" && (
          <>
          <form onSubmit={submitMaint}>
            <div style={sectionCard}>
              <h2 style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, margin: "0 0 16px" }}>🔧 Vehicle Maintenance</h2>

              <Field label="Vehicle *">
                <select value={maint.vehicle_id} onChange={(e) => setMaint({ ...maint, vehicle_id: e.target.value })}
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const }}>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>{v.name} ({v.plate_number})</option>
                  ))}
                </select>
              </Field>

              <div style={{ marginTop: "12px" }}>
                <Field label="Date *">
                  <DateInput value={maint.date} onChange={(e) => setMaint((m) => ({ ...m, date: e.target.value }))} />
                </Field>
              </div>

              {(() => {
                const oUnit = vehicles.find((v) => v.id === maint.vehicle_id)?.odometer_unit ?? "km";
                return (
                  <div style={{ marginTop: "12px" }}>
                    <Field label={`Odometer (${oUnit})`}>
                      <input type="number" min="0" placeholder={`e.g. ${lastMaintOdo ? (lastMaintOdo + 500).toLocaleString() : "75000"}`}
                        value={maint.odometer_km} onChange={(e) => setMaint({ ...maint, odometer_km: e.target.value })}
                        style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const }} />
                    </Field>
                    {lastMaintOdo != null && (
                      <div style={{ fontSize: "11.5px", color: COLOURS.SLATE, marginTop: "4px" }}>
                        Last recorded: <strong style={{ color: COLOURS.NAVY }}>{lastMaintOdo.toLocaleString()} {oUnit}</strong> — new reading must be equal or higher
                      </div>
                    )}
                  </div>
                );
              })()}

              <div style={{ marginTop: "16px" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "5px" }}>Work done * <span style={{ fontSize: "11px", fontWeight: 400, color: COLOURS.SLATE }}>(select all that apply)</span></label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "6px" }}>
                  {MAINTENANCE_TYPES.map((t) => {
                    const checked = maint.work_types.includes(t);
                    return (
                      <button key={t} type="button"
                        onClick={() => setMaint((m) => ({
                          ...m,
                          work_types: checked
                            ? m.work_types.filter((x) => x !== t)
                            : [...m.work_types, t],
                        }))}
                        style={{
                          padding: "8px 14px", borderRadius: RADII.PILL, fontSize: "13px",
                          fontWeight: checked ? 700 : 500,
                          border: `2px solid ${checked ? COLOURS.GREEN : COLOURS.HAIRLINE}`,
                          backgroundColor: checked ? "#D1FAE5" : "white",
                          color: checked ? COLOURS.GREEN : COLOURS.SLATE,
                          cursor: "pointer",
                        }}>
                        {checked ? "✓ " : ""}{t}
                      </button>
                    );
                  })}
                </div>
                {maint.work_types.length > 0 && (
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "8px" }}>
                    Selected: {maint.work_types.join(" · ")}
                  </div>
                )}
              </div>

              <div style={{ marginTop: "12px" }}>
                <Field label="Description (optional)">
                  <textarea value={maint.description} onChange={(e) => setMaint({ ...maint, description: e.target.value })}
                    rows={2} placeholder="Details of work done…"
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const, resize: "vertical" as const }} />
                </Field>
              </div>

              <div style={{ ...row2, marginTop: "12px" }}>
                <Field label="Workshop / garage">
                  <input type="text" placeholder="e.g. KIA DHA"
                    value={maint.workshop} onChange={(e) => setMaint({ ...maint, workshop: e.target.value })}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const }} />
                </Field>
                <Field label="Cost (PKR) *">
                  <input type="number" step="0.01" min="0" placeholder="0"
                    value={maint.cost_pkr} onChange={(e) => setMaint({ ...maint, cost_pkr: e.target.value })}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const }} />
                </Field>
              </div>

              <div style={{ marginTop: "12px" }}>
                <Field label="Next service due (optional)">
                  <input type="text" placeholder="e.g. 15/10/2026 or 75,000 km"
                    value={maint.next_service_due} onChange={(e) => setMaint({ ...maint, next_service_due: e.target.value })}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" as const }} />
                </Field>
              </div>
            </div>

            <button type="submit" disabled={submittingMaint} style={{ ...primaryButtonStyle, width: "100%", padding: "14px", fontSize: "15px", opacity: submittingMaint ? 0.6 : 1 }}>
              {submittingMaint ? "Saving…" : "Save Maintenance Entry"}
            </button>
          </form>

          {/* Recent maintenance records */}
          {recentMaint.length > 0 && (
            <div style={{ marginTop: "16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: "8px" }}>Recent maintenance</div>
              <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", overflow: "hidden", backgroundColor: "white" }}>
                {recentMaint.map((r, i) => (
                  <div key={i} style={{ padding: "10px 14px", borderBottom: i < recentMaint.length - 1 ? `1px solid ${COLOURS.HAIRLINE}` : "none" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY }}>{r.work_type}</div>
                        {r.description && <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>{r.description}</div>}
                      </div>
                      <div style={{ textAlign: "right" as const, flexShrink: 0, marginLeft: "8px" }}>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY }}>PKR {Math.round(r.cost_pkr).toLocaleString()}</div>
                        <div style={{ fontSize: "10.5px", color: COLOURS.SLATE }}>{r.date.split("-").reverse().join("/")}</div>
                      </div>
                    </div>
                    {(r.odometer_km || r.workshop) && (
                      <div style={{ display: "flex", gap: "12px", marginTop: "4px" }}>
                        {r.odometer_km && <div style={{ fontSize: "10.5px", color: COLOURS.SLATE }}>{r.odometer_km.toLocaleString()} km</div>}
                        {r.workshop && <div style={{ fontSize: "10.5px", color: COLOURS.SLATE }}>{r.workshop}</div>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          </>
        )}

        {/* ── MY TASKS ── */}
        {activeForm === "tasks" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <h2 style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, margin: 0 }}>✅ My Tasks</h2>
              <button onClick={loadMyTasks} disabled={loadingTasks}
                style={{ fontSize: "12px", color: COLOURS.GREEN, background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: 0 }}>
                {loadingTasks ? "Loading…" : "Refresh"}
              </button>
            </div>

            {loadingTasks && (
              <div style={{ color: COLOURS.SLATE, fontSize: "13px", textAlign: "center", padding: "32px 0" }}>Loading tasks…</div>
            )}

            {!loadingTasks && myTasks.length === 0 && (
              <div style={{ ...sectionCard, textAlign: "center", padding: "32px 20px" }}>
                <div style={{ fontSize: "28px", marginBottom: "8px" }}>🎉</div>
                <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>All clear!</div>
                <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "4px" }}>No open tasks assigned to you.</div>
              </div>
            )}

            {!loadingTasks && myTasks.map((task) => {
              const isOverdue = task.due_date && task.due_date < today;
              const priorityColor =
                task.priority === "Urgent" ? COLOURS.RED :
                task.priority === "High"   ? COLOURS.AMBER :
                COLOURS.SLATE;
              const statusColor =
                task.status === "In Progress"    ? COLOURS.GREEN :
                task.status === "Waiting Reply"  ? COLOURS.AMBER :
                COLOURS.SLATE;
              const busy = updatingTask === task.id;

              return (
                <div key={task.id} style={{
                  ...sectionCard, marginBottom: "10px", padding: "14px 16px",
                  borderLeft: `4px solid ${isOverdue ? COLOURS.RED : task.status === "In Progress" ? COLOURS.GREEN : COLOURS.HAIRLINE}`,
                }}>
                  {/* Priority + status row */}
                  <div style={{ display: "flex", gap: "6px", marginBottom: "8px", flexWrap: "wrap" }}>
                    {task.priority && (
                      <span style={{
                        fontSize: "10px", fontWeight: 700, padding: "2px 7px",
                        borderRadius: RADII.PILL, backgroundColor: `${priorityColor}18`, color: priorityColor,
                      }}>{task.priority}</span>
                    )}
                    <span style={{
                      fontSize: "10px", fontWeight: 600, padding: "2px 7px",
                      borderRadius: RADII.PILL, backgroundColor: COLOURS.CARD_ALT, color: statusColor,
                    }}>{task.status}</span>
                    {isOverdue && (
                      <span style={{
                        fontSize: "10px", fontWeight: 700, padding: "2px 7px",
                        borderRadius: RADII.PILL, backgroundColor: "#FDECEA", color: COLOURS.RED,
                      }}>Overdue</span>
                    )}
                  </div>

                  {/* Description */}
                  <p style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, margin: "0 0 4px", lineHeight: "1.4" }}>
                    {task.description}
                  </p>

                  {/* Project + due date */}
                  <div style={{ display: "flex", gap: "12px", fontSize: "11.5px", color: COLOURS.SLATE, marginBottom: "10px" }}>
                    {task.project && <span>📁 {task.project}</span>}
                    {task.due_date && (
                      <span style={{ color: isOverdue ? COLOURS.RED : COLOURS.SLATE }}>
                        📅 {task.due_date.split("-").reverse().join("/")}
                      </span>
                    )}
                  </div>

                  {/* Notes */}
                  {task.notes && (
                    <p style={{ fontSize: "11.5px", color: COLOURS.SLATE, margin: "0 0 10px",
                      padding: "6px 10px", backgroundColor: COLOURS.CARD_ALT,
                      borderRadius: RADII.SM, borderLeft: `3px solid ${COLOURS.HAIRLINE}` }}>
                      {task.notes}
                    </p>
                  )}

                  {/* Action buttons */}
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {task.status === "Not Started" && (
                      <button disabled={busy} onClick={() => updateTaskStatus(task, "In Progress")}
                        style={{ ...primaryButtonStyle, fontSize: "12px", padding: "7px 14px", opacity: busy ? 0.6 : 1 }}>
                        {busy ? "…" : "▶ Start"}
                      </button>
                    )}
                    {(task.status === "In Progress" || task.status === "Waiting Reply" || task.status === "Not Started") && (
                      <button disabled={busy} onClick={() => updateTaskStatus(task, "Submitted")}
                        style={{ ...primaryButtonStyle, fontSize: "12px", padding: "7px 14px",
                          backgroundColor: COLOURS.GREEN, opacity: busy ? 0.6 : 1 }}>
                        {busy ? "…" : "✓ Submit for Review"}
                      </button>
                    )}
                    {(task.status === "Not Started" || task.status === "In Progress") && (
                      <button disabled={busy} onClick={() => updateTaskStatus(task, "Waiting Reply")}
                        style={{ fontSize: "12px", padding: "7px 14px", borderRadius: RADII.SM,
                          border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white",
                          color: COLOURS.AMBER, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
                        ⏳ Waiting Reply
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {toastElement}
      </main>
    </AuthWrapper>
  );
}
