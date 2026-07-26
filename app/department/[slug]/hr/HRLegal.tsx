"use client";

import { useEffect, useState, useCallback } from "react";
import { authFetch } from "../../../lib/supabase";
import { formatDateUK } from "../../../lib/dateUtils";
import DateInput from "../../../lib/DateInput";
import {
  COLOURS, RADII, SkeletonRows, useToast, primaryButtonStyle, inputStyle,
} from "../../../lib/SharedUI";
import type { LegalCase, CaseDetail } from "../../../admin/LegalCases";
import { CaseProgress } from "../../../admin/LegalCases";

// ── Constants ──────────────────────────────────────────────────────────

const OFFENCE_TYPES = [
  "Stock Shortage", "Theft", "Fraud", "Harassment",
  "Misconduct", "Property Damage", "Other",
];

const ENTITY_ORDER = ["IFPL", "Baranh", "HD", "UTPL"];
const ENTITY_DISPLAY: Record<string, string> = {
  IFPL: "IFPL — Imperial Footwear",
  Baranh: "Baranh",
  HD: "Haute Dolci",
  UTPL: "UTPL — Unze Trading",
};

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  "HR Documents Issued":  { bg: "#F1F5F9", color: COLOURS.SLATE },
  "Police Report Filed":  { bg: "#DBEAFE", color: "#1D4ED8" },
  "FIR Registered":       { bg: "#BFDBFE", color: "#1E40AF" },
  "Warrant Issued":       { bg: "#FEF3C7", color: COLOURS.AMBER },
  "Under Investigation":  { bg: "#FFEDD5", color: "#C2410C" },
  "Court Proceedings":    { bg: "#EDE9FE", color: "#6D28D9" },
  "Resolved":             { bg: "#D1FAE5", color: COLOURS.GREEN },
  "Closed":               { bg: "#F1F5F9", color: "#475569" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE["HR Documents Issued"];
  return (
    <span style={{
      fontSize: "11px", fontWeight: 700, padding: "3px 10px",
      borderRadius: "20px", backgroundColor: s.bg, color: s.color, whiteSpace: "nowrap",
    }}>{status}</span>
  );
}

type Location = { id: string; name: string; entity: string };

type NewCaseForm = {
  entity: string;
  location_id: string;
  location_name: string;
  subject_name: string;
  subject_role: string;
  subject_employee_id: string;
  offence_type: string;
  description: string;
  incident_date: string;
  amount_involved_pkr: string;
  police_station: string;
};

const BLANK_FORM: NewCaseForm = {
  entity: "IFPL", location_id: "", location_name: "",
  subject_name: "", subject_role: "", subject_employee_id: "",
  offence_type: "Theft", description: "", incident_date: "",
  amount_involved_pkr: "", police_station: "",
};

// ── Component ──────────────────────────────────────────────────────────

export default function HRLegal() {
  const [cases, setCases] = useState<LegalCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState<Location[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<NewCaseForm>(BLANK_FORM);
  const [saving, setSaving] = useState(false);

  const [filterStatus, setFilterStatus] = useState<"open" | "closed" | "all">("open");

  const [selectedCase, setSelectedCase] = useState<CaseDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [editFields, setEditFields] = useState<Partial<LegalCase>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingCase, setDeletingCase] = useState(false);

  const { show: showToast, element: toastElement } = useToast();

  // ── Load ─────────────────────────────────────────────────────────

  const loadCases = useCallback(async () => {
    setLoading(true);
    const res = await authFetch("/api/legal/cases");
    const json = await res.json();
    setCases(json.data || []);
    setLoading(false);
  }, []);

  async function loadLocations(entity: string) {
    const res = await authFetch(`/api/admin/entry-meta?entity=${entity}`);
    const json = await res.json();
    setLocations(json.locations || []);
  }

  useEffect(() => { loadCases(); }, [loadCases]);

  useEffect(() => {
    if (showForm) loadLocations(form.entity);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm, form.entity]);

  // ── Submit new case ───────────────────────────────────────────────

  async function submitCase() {
    if (!form.subject_name || !form.location_name || !form.offence_type) {
      showToast("Please fill in all required fields", "error");
      return;
    }
    setSaving(true);
    const res = await authFetch("/api/legal/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entity: form.entity,
        location_id: form.location_id || null,
        location_name: form.location_name,
        subject_name: form.subject_name,
        subject_role: form.subject_role || null,
        subject_employee_id: form.subject_employee_id || null,
        offence_type: form.offence_type,
        description: form.description || null,
        incident_date: form.incident_date || null,
        amount_involved_pkr: form.amount_involved_pkr ? parseFloat(form.amount_involved_pkr) : null,
        police_station: form.police_station || null,
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (json.data) {
      showToast(`Case ${json.data.case_number} initiated`, "success");
      setForm(BLANK_FORM);
      setShowForm(false);
      loadCases();
    } else {
      showToast(json.error || "Failed to create case", "error");
    }
  }

  // ── Open case detail ──────────────────────────────────────────────

  async function openCase(id: string) {
    setLoadingDetail(true);
    setSelectedCase(null);
    const res = await authFetch(`/api/legal/cases/${id}`);
    const json = await res.json();
    if (json.data) {
      setSelectedCase(json.data);
      setEditFields({
        police_station: json.data.police_station ?? "",
        fir_number: json.data.fir_number ?? "",
        fir_date: json.data.fir_date ?? "",
        warrant_number: json.data.warrant_number ?? "",
        warrant_date: json.data.warrant_date ?? "",
        court_case_number: json.data.court_case_number ?? "",
        status: json.data.status,
        amount_involved_pkr: json.data.amount_involved_pkr ?? undefined,
        amount_recovered_pkr: json.data.amount_recovered_pkr ?? undefined,
        resolution_type: json.data.resolution_type ?? "",
        resolution_notes: json.data.resolution_notes ?? "",
      });
    }
    setLoadingDetail(false);
  }

  async function deleteCase() {
    if (!selectedCase) return;
    if (!confirm(`Delete case ${selectedCase.case_number}? This cannot be undone.`)) return;
    setDeletingCase(true);
    const res = await authFetch(`/api/legal/cases/${selectedCase.id}`, { method: "DELETE" });
    const json = await res.json();
    setDeletingCase(false);
    if (json.success) {
      showToast("Case deleted", "success");
      setSelectedCase(null);
      loadCases();
    } else {
      showToast(json.error || "Failed to delete", "error");
    }
  }

  async function saveEdit() {
    if (!selectedCase) return;
    setSavingEdit(true);
    const res = await authFetch(`/api/legal/cases/${selectedCase.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editFields),
    });
    const json = await res.json();
    setSavingEdit(false);
    if (json.data) {
      showToast("Case updated", "success");
      setSelectedCase({ ...selectedCase, ...json.data });
      loadCases();
    } else {
      showToast(json.error || "Failed to save", "error");
    }
  }

  // ── Filter ────────────────────────────────────────────────────────

  const CLOSED = ["Resolved", "Closed"];
  const visible = cases.filter((c) => {
    if (filterStatus === "open") return !CLOSED.includes(c.status);
    if (filterStatus === "closed") return CLOSED.includes(c.status);
    return true;
  });

  const filteredLocations = locations.filter((l) => l.entity === form.entity);

  // ── Render ────────────────────────────────────────────────────────

  const thStyle: React.CSSProperties = {
    padding: "9px 14px", textAlign: "left", fontSize: "10.5px", fontWeight: 700,
    color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.05em",
    borderBottom: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "#FAFBFC", whiteSpace: "nowrap",
  };
  const tdStyle: React.CSSProperties = {
    padding: "10px 14px", fontSize: "13px", color: COLOURS.NAVY,
    borderBottom: `1px solid ${COLOURS.HAIRLINE}`, verticalAlign: "middle",
  };

  return (
    <div>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
        <div>
          <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>Legal Cases</div>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>
            Cases initiated by HR — tracked by Admin and field team
          </div>
        </div>
        <button onClick={() => setShowForm(true)} style={{ ...primaryButtonStyle }}>
          + Initiate Case
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "16px" }}>
        {([["open","Open"], ["closed","Resolved / Closed"], ["all","All"]] as const).map(([v, l]) => (
          <button key={v} onClick={() => setFilterStatus(v)} style={{
            padding: "5px 14px", fontSize: "12px", fontWeight: 600, borderRadius: RADII.PILL,
            border: `1px solid ${filterStatus === v ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
            backgroundColor: filterStatus === v ? COLOURS.NAVY : "white",
            color: filterStatus === v ? "white" : COLOURS.SLATE, cursor: "pointer",
          }}>{l}</button>
        ))}
        <span style={{ fontSize: "12px", color: COLOURS.SLATE, marginLeft: "auto", alignSelf: "center" }}>
          {visible.length} case{visible.length !== 1 ? "s" : ""}
        </span>
      </div>

      {loading && <SkeletonRows count={5} height="44px" />}

      {!loading && visible.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 20px", color: COLOURS.SLATE, fontSize: "14px" }}>
          No legal cases found.
        </div>
      )}

      {!loading && visible.length > 0 && (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Case No.</th>
                <th style={thStyle}>Location</th>
                <th style={thStyle}>Accused</th>
                <th style={thStyle}>Offence</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Incident Date</th>
                <th style={thStyle}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id} onClick={() => openCase(c.id)} style={{ cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#F8FAFC")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}>
                  <td style={{ ...tdStyle, fontWeight: 700, whiteSpace: "nowrap" }}>{c.case_number}</td>
                  <td style={{ ...tdStyle, color: COLOURS.SLATE }}>
                    <div style={{ fontSize: "10px", color: COLOURS.SLATE, fontWeight: 600 }}>{c.entity}</div>
                    {c.location_name}
                  </td>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600 }}>{c.subject_name}</div>
                    {c.subject_role && <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>{c.subject_role}</div>}
                  </td>
                  <td style={{ ...tdStyle, color: COLOURS.SLATE }}>{c.offence_type}</td>
                  <td style={tdStyle}><StatusBadge status={c.status} /></td>
                  <td style={{ ...tdStyle, color: COLOURS.SLATE, whiteSpace: "nowrap" }}>
                    {c.incident_date ? formatDateUK(c.incident_date) : "—"}
                  </td>
                  <td style={{ ...tdStyle, color: COLOURS.SLATE, fontSize: "11px", whiteSpace: "nowrap" }}>
                    {formatDateUK(c.updated_at.slice(0, 10))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Initiate Case modal */}
      {showForm && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9998, backgroundColor: "rgba(15,23,42,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
          onClick={() => setShowForm(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ backgroundColor: "white", borderRadius: RADII.CARD, padding: "24px", maxWidth: "520px", width: "100%", boxShadow: "0 20px 60px rgba(15,23,42,0.15)", maxHeight: "90vh", overflowY: "auto" }}
          >
            <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "4px" }}>Initiate Legal Case</div>
            <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "18px" }}>HR issues formal documentation to begin the legal process</div>

            {/* Entity + Location */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Entity *</label>
                <select value={form.entity} onChange={(e) => setForm({ ...form, entity: e.target.value, location_id: "", location_name: "" })}
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                  {ENTITY_ORDER.map((e) => <option key={e} value={e}>{ENTITY_DISPLAY[e]}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Location *</label>
                {filteredLocations.length > 0 ? (
                  <select value={form.location_id}
                    onChange={(e) => {
                      const loc = filteredLocations.find((l) => l.id === e.target.value);
                      setForm({ ...form, location_id: e.target.value, location_name: loc?.name ?? "" });
                    }}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                    <option value="">— Select —</option>
                    {filteredLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                ) : (
                  <input value={form.location_name} onChange={(e) => setForm({ ...form, location_name: e.target.value })}
                    placeholder="Location name" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                )}
              </div>
            </div>

            {/* Accused */}
            <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px", marginTop: "4px" }}>
              Accused Person
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Full Name *</label>
                <input value={form.subject_name} onChange={(e) => setForm({ ...form, subject_name: e.target.value })}
                  placeholder="Name of accused" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Role / Designation</label>
                <input value={form.subject_role} onChange={(e) => setForm({ ...form, subject_role: e.target.value })}
                  placeholder="e.g. Store Manager" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Employee ID</label>
                <input value={form.subject_employee_id} onChange={(e) => setForm({ ...form, subject_employee_id: e.target.value })}
                  placeholder="Optional" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
              </div>
            </div>

            {/* Offence */}
            <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
              Offence
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Type *</label>
                <select value={form.offence_type} onChange={(e) => setForm({ ...form, offence_type: e.target.value })}
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                  {OFFENCE_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Incident Date</label>
                <DateInput value={form.incident_date} onChange={(e) => setForm({ ...form, incident_date: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Amount Involved (PKR)</label>
                <input type="number" value={form.amount_involved_pkr} onChange={(e) => setForm({ ...form, amount_involved_pkr: e.target.value })}
                  placeholder="Optional" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Police Station</label>
                <input value={form.police_station} onChange={(e) => setForm({ ...form, police_station: e.target.value })}
                  placeholder="Optional" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={3} placeholder="Describe the incident and evidence" style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical" as const }} />
              </div>
            </div>

            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button onClick={() => setShowForm(false)}
                style={{ padding: "8px 16px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 500, border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "white", color: COLOURS.NAVY, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={submitCase} disabled={saving || !form.subject_name || !form.location_name}
                style={{ ...primaryButtonStyle, opacity: (saving || !form.subject_name || !form.location_name) ? 0.6 : 1 }}>
                {saving ? "Initiating…" : "Initiate Case"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Case detail side panel */}
      {(loadingDetail || selectedCase) && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9990, backgroundColor: "rgba(15,23,42,0.35)", display: "flex", justifyContent: "flex-end" }}
          onClick={() => setSelectedCase(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(560px, 100vw)", height: "100%", backgroundColor: "white", overflowY: "auto", boxShadow: "-4px 0 32px rgba(15,23,42,0.12)", display: "flex", flexDirection: "column" }}
          >
            {loadingDetail && <div style={{ padding: "24px" }}><SkeletonRows count={8} height="32px" /></div>}

            {!loadingDetail && selectedCase && (
              <>
                {/* Header */}
                <div style={{ padding: "20px 24px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "#FAFBFD" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "4px" }}>{selectedCase.case_number}</div>
                      <div style={{ fontSize: "17px", fontWeight: 700, color: COLOURS.NAVY }}>{selectedCase.subject_name}</div>
                      {selectedCase.subject_role && <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "1px" }}>{selectedCase.subject_role}</div>}
                      <div style={{ marginTop: "8px" }}>
                        <span style={{ fontSize: "11px", fontWeight: 700, padding: "3px 10px", borderRadius: "20px", backgroundColor: "#F1F5F9", color: COLOURS.SLATE }}>{selectedCase.status}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <button onClick={deleteCase} disabled={deletingCase}
                        style={{ border: `1px solid ${COLOURS.RED}40`, backgroundColor: "#FEF2F2", color: COLOURS.RED, cursor: "pointer", fontSize: "12px", fontWeight: 600, padding: "4px 10px", borderRadius: "6px", opacity: deletingCase ? 0.6 : 1 }}>
                        {deletingCase ? "Deleting…" : "Delete"}
                      </button>
                      <button onClick={() => setSelectedCase(null)} style={{ border: "none", backgroundColor: "transparent", cursor: "pointer", fontSize: "20px", color: COLOURS.SLATE, padding: "0 4px", lineHeight: 1 }}>×</button>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "16px", marginTop: "12px", flexWrap: "wrap" }}>
                    {[
                      { l: "Location", v: selectedCase.location_name },
                      { l: "Offence", v: selectedCase.offence_type },
                      { l: "Initiated", v: formatDateUK(selectedCase.created_at.slice(0, 10)) },
                    ].map(({ l, v }) => (
                      <div key={l}>
                        <div style={{ fontSize: "10px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.05em" }}>{l}</div>
                        <div style={{ fontSize: "12px", color: COLOURS.NAVY, marginTop: "1px" }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Progress tracker */}
                <CaseProgress c={selectedCase} />

                {/* Editable fields */}
                <div style={{ padding: "16px 24px", borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "12px" }}>Edit Case Details</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px" }}>Status</label>
                      <select value={editFields.status ?? selectedCase.status} onChange={(e) => setEditFields({ ...editFields, status: e.target.value })}
                        style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                        {["HR Documents Issued","Police Report Filed","FIR Registered","Warrant Issued","Under Investigation","Court Proceedings","Resolved","Closed"].map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px" }}>Police Station</label>
                      <input value={editFields.police_station ?? ""} onChange={(e) => setEditFields({ ...editFields, police_station: e.target.value })} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} placeholder="Optional" />
                    </div>
                    <div>
                      <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px" }}>FIR Number</label>
                      <input value={editFields.fir_number ?? ""} onChange={(e) => setEditFields({ ...editFields, fir_number: e.target.value })} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} placeholder="Optional" />
                    </div>
                    <div>
                      <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px" }}>FIR Date</label>
                      <DateInput value={editFields.fir_date ?? ""} onChange={(e) => setEditFields({ ...editFields, fir_date: e.target.value })} />
                    </div>
                    <div>
                      <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px" }}>Warrant Number</label>
                      <input value={editFields.warrant_number ?? ""} onChange={(e) => setEditFields({ ...editFields, warrant_number: e.target.value })} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} placeholder="Optional" />
                    </div>
                    <div>
                      <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px" }}>Warrant Date</label>
                      <DateInput value={editFields.warrant_date ?? ""} onChange={(e) => setEditFields({ ...editFields, warrant_date: e.target.value })} />
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px" }}>Court Case Number</label>
                      <input value={editFields.court_case_number ?? ""} onChange={(e) => setEditFields({ ...editFields, court_case_number: e.target.value })} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} placeholder="Optional" />
                    </div>
                    {(editFields.status === "Resolved" || editFields.status === "Closed") && (
                      <>
                        <div>
                          <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px" }}>Amount Recovered (PKR)</label>
                          <input type="number" value={editFields.amount_recovered_pkr ?? ""} onChange={(e) => setEditFields({ ...editFields, amount_recovered_pkr: e.target.value ? Number(e.target.value) : undefined })} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} placeholder="Optional" />
                        </div>
                        <div>
                          <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px" }}>Resolution Type</label>
                          <select value={editFields.resolution_type ?? ""} onChange={(e) => setEditFields({ ...editFields, resolution_type: e.target.value })} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                            <option value="">— Select —</option>
                            {["Recovered","Convicted","Acquitted","Settled","Dropped"].map((r) => <option key={r}>{r}</option>)}
                          </select>
                        </div>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px" }}>Resolution Notes</label>
                          <textarea value={editFields.resolution_notes ?? ""} onChange={(e) => setEditFields({ ...editFields, resolution_notes: e.target.value })} rows={2} style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical" as const }} />
                        </div>
                      </>
                    )}
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
                    <button onClick={saveEdit} disabled={savingEdit} style={{ ...primaryButtonStyle, opacity: savingEdit ? 0.6 : 1 }}>
                      {savingEdit ? "Saving…" : "Save Changes"}
                    </button>
                  </div>
                </div>

                {/* Activity log */}
                <div style={{ padding: "16px 24px", flex: 1 }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "14px" }}>
                    Activity Log ({selectedCase.updates.length})
                  </div>
                  {selectedCase.updates.length === 0 && <p style={{ fontSize: "13px", color: COLOURS.SLATE }}>No follow-ups logged yet.</p>}
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {selectedCase.updates.map((u) => (
                      <div key={u.id} style={{ borderLeft: `3px solid ${COLOURS.HAIRLINE}`, paddingLeft: "14px", position: "relative" }}>
                        <div style={{ position: "absolute", left: "-6px", top: "4px", width: "9px", height: "9px", borderRadius: "50%", backgroundColor: COLOURS.NAVY }} />
                        <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.NAVY }}>{u.update_type}</span>
                          <span style={{ fontSize: "11px", color: COLOURS.SLATE }}>{formatDateUK(u.update_date)}</span>
                        </div>
                        <p style={{ fontSize: "13px", color: COLOURS.NAVY, margin: "4px 0 0" }}>{u.description}</p>
                        {u.fir_number && <p style={{ fontSize: "11px", color: COLOURS.SLATE, margin: "2px 0 0" }}>FIR: {u.fir_number}</p>}
                        {u.next_action && <p style={{ fontSize: "11px", color: COLOURS.AMBER, margin: "4px 0 0", fontWeight: 600 }}>Next: {u.next_action}{u.next_action_date ? ` — by ${formatDateUK(u.next_action_date)}` : ""}</p>}
                        <p style={{ fontSize: "10px", color: COLOURS.SLATE, margin: "4px 0 0" }}>Logged by {u.entered_by}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {toastElement}
    </div>
  );
}
