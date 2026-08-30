"use client";

import { useEffect, useState, useCallback } from "react";
import { authFetch } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import DateInput from "../lib/DateInput";
import {
  COLOURS, RADII, SkeletonRows, useToast, primaryButtonStyle, inputStyle,
} from "../lib/SharedUI";

// ── Types ─────────────────────────────────────────────────────────────

export type LegalCase = {
  id: string;
  case_number: string;
  entity: string;
  location_name: string;
  subject_name: string;
  subject_role: string | null;
  offence_type: string;
  status: string;
  incident_date: string | null;
  amount_involved_pkr: number | null;
  fir_number: string | null;
  warrant_number: string | null;
  court_case_number: string | null;
  police_station: string | null;
  fir_date: string | null;
  warrant_date: string | null;
  amount_recovered_pkr: number | null;
  resolution_type: string | null;
  resolution_notes: string | null;
  initiated_by: string;
  created_at: string;
  updated_at: string;
};

export type CaseUpdate = {
  id: string;
  update_type: string;
  update_date: string;
  description: string;
  status_before: string | null;
  status_after: string | null;
  fir_number: string | null;
  warrant_number: string | null;
  next_action: string | null;
  next_action_date: string | null;
  entered_by: string;
  created_at: string;
};

export type CaseDetail = LegalCase & { updates: CaseUpdate[] };

// ── Constants ──────────────────────────────────────────────────────────

const STATUSES = [
  "HR Documents Issued",
  "Police Report Filed",
  "FIR Registered",
  "Warrant Issued",
  "Under Investigation",
  "Court Proceedings",
  "Resolved",
  "Closed",
];

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

const ENTITY_ORDER = ["UTPL", "IFPL", "Baranh", "HD", "ALM", "DIR", "UZL"];
const ENTITY_DISPLAY: Record<string, string> = {
  IFPL: "IFPL — Imperial Footwear",
  Baranh: "Baranh",
  HD: "HD",
  UTPL: "UTPL — Unze Trading",
};

const OFFENCE_TYPES = [
  "Stock Shortage", "Theft", "Fraud", "Harassment",
  "Misconduct", "Property Damage", "Other",
];

const UPDATE_TYPES = [
  "Police Station Visit", "Court Hearing", "Authority Meeting",
  "Document Submitted", "FIR Registration", "Warrant Execution",
  "Status Update", "Other",
];

// ── Status badge ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE["HR Documents Issued"];
  return (
    <span style={{
      fontSize: "11px", fontWeight: 700, padding: "3px 10px",
      borderRadius: "20px", backgroundColor: s.bg, color: s.color,
      whiteSpace: "nowrap",
    }}>{status}</span>
  );
}

// ── Progress tracker ────────────────────────────────────────────────────

const PIPELINE = [
  "HR Documents Issued",
  "Police Report Filed",
  "FIR Registered",
  "Warrant Issued",
  "Under Investigation",
  "Court Proceedings",
  "Resolved",
];

function daysBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

export function CaseProgress({ c }: { c: CaseDetail }) {
  const isClosed = c.status === "Closed";
  const currentIdx = isClosed ? PIPELINE.length : PIPELINE.indexOf(c.status);

  // Build a map: status → date it was first entered
  const enteredAt: Record<string, string> = { [PIPELINE[0]]: c.created_at };
  // Walk updates oldest-first
  const sortedUpdates = [...c.updates].sort(
    (a, b) => new Date(a.update_date).getTime() - new Date(b.update_date).getTime()
  );
  sortedUpdates.forEach((u) => {
    if (u.status_after && !enteredAt[u.status_after]) {
      enteredAt[u.status_after] = u.update_date;
    }
  });

  const now = new Date().toISOString();
  const daysSinceLastUpdate = sortedUpdates.length > 0
    ? daysBetween(sortedUpdates[sortedUpdates.length - 1].update_date, now)
    : daysBetween(c.created_at, now);
  const stalled = daysSinceLastUpdate > 7 && !["Resolved", "Closed"].includes(c.status);

  // Next action from most recent update that has one
  const nextAction = [...sortedUpdates].reverse().find((u) => u.next_action);

  return (
    <div style={{ padding: "16px 24px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "#FAFBFD" }}>
      <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "14px" }}>
        Case Progress
      </div>

      {/* Stage stepper */}
      <div style={{ position: "relative" }}>
        {/* Connector line */}
        <div style={{
          position: "absolute", left: "10px", top: "10px",
          bottom: "10px", width: "2px", backgroundColor: COLOURS.HAIRLINE, zIndex: 0,
        }} />

        {PIPELINE.map((stage, idx) => {
          const done = idx < currentIdx;
          const active = idx === currentIdx && !isClosed;
          const pending = idx > currentIdx;
          const enteredDate = enteredAt[stage];
          const leftDate = enteredAt[PIPELINE[idx + 1]] ?? (done ? now : null);
          const daysSpent = enteredDate && leftDate ? daysBetween(enteredDate, leftDate) : null;

          const dotColor = done ? COLOURS.GREEN : active ? COLOURS.NAVY : COLOURS.HAIRLINE;
          const dotBorder = active ? `2px solid ${COLOURS.NAVY}` : "none";

          return (
            <div key={stage} style={{ display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "10px", position: "relative", zIndex: 1 }}>
              {/* Dot */}
              <div style={{
                width: "20px", height: "20px", borderRadius: "50%", flexShrink: 0,
                backgroundColor: done ? COLOURS.GREEN : active ? "white" : "#EEF0F3",
                border: done ? "none" : dotBorder || `2px solid ${COLOURS.HAIRLINE}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                marginTop: "1px",
              }}>
                {done && <span style={{ fontSize: "10px", color: "white", fontWeight: 700 }}>✓</span>}
                {active && <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: COLOURS.NAVY }} />}
              </div>

              {/* Label + meta */}
              <div style={{ flex: 1, paddingBottom: "4px" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{
                    fontSize: "13px", fontWeight: active ? 700 : done ? 600 : 400,
                    color: pending ? COLOURS.SLATE : COLOURS.NAVY,
                  }}>{stage}</span>
                  {daysSpent !== null && !active && (
                    <span style={{ fontSize: "11px", color: COLOURS.SLATE }}>
                      {daysSpent === 0 ? "same day" : `${daysSpent}d`}
                    </span>
                  )}
                  {active && daysSpent === null && enteredDate && (
                    <span style={{ fontSize: "11px", color: stalled ? COLOURS.RED : COLOURS.AMBER, fontWeight: 600 }}>
                      {daysBetween(enteredDate, now)}d here
                      {stalled ? " · stalled" : ""}
                    </span>
                  )}
                </div>
                {enteredDate && (
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "1px" }}>
                    {done ? `${formatDateUK(enteredDate)} → ${leftDate ? formatDateUK(leftDate) : ""}` : formatDateUK(enteredDate)}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Closed state at end */}
        {isClosed && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", position: "relative", zIndex: 1 }}>
            <div style={{ width: "20px", height: "20px", borderRadius: "50%", flexShrink: 0, backgroundColor: COLOURS.SLATE, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: "10px", color: "white", fontWeight: 700 }}>✓</span>
            </div>
            <span style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.SLATE, paddingTop: "2px" }}>Closed</span>
          </div>
        )}
      </div>

      {/* Stall / next-action banner */}
      {stalled && (
        <div style={{ marginTop: "12px", padding: "8px 12px", borderRadius: "6px", backgroundColor: "#FEF2F2", border: `1px solid ${COLOURS.RED}30` }}>
          <span style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.RED }}>⚠ No update for {daysSinceLastUpdate} days</span>
          <p style={{ fontSize: "12px", color: COLOURS.RED, margin: "2px 0 0", opacity: 0.85 }}>This case may need chasing — last activity was {daysSinceLastUpdate} days ago.</p>
        </div>
      )}
      {nextAction && (
        <div style={{ marginTop: stalled ? "8px" : "12px", padding: "8px 12px", borderRadius: "6px", backgroundColor: "#FFFBEB", border: `1px solid ${COLOURS.AMBER}40` }}>
          <span style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.AMBER, textTransform: "uppercase", letterSpacing: "0.04em" }}>Next action</span>
          <p style={{ fontSize: "12px", color: COLOURS.NAVY, margin: "2px 0 0", fontWeight: 600 }}>{nextAction.next_action}</p>
          {nextAction.next_action_date && (
            <p style={{ fontSize: "11px", color: COLOURS.SLATE, margin: "2px 0 0" }}>Due: {formatDateUK(nextAction.next_action_date)}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────

export default function LegalCases() {
  const [cases, setCases] = useState<LegalCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterEntity, setFilterEntity] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("open");

  const [selectedCase, setSelectedCase] = useState<CaseDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Edit case fields panel
  const [editFields, setEditFields] = useState<Partial<LegalCase>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingCase, setDeletingCase] = useState(false);

  const { show: showToast, element: toastElement } = useToast();

  // ── Load ─────────────────────────────────────────────────────────

  const loadCases = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterEntity !== "all") params.set("entity", filterEntity);
    const res = await authFetch(`/api/legal/cases?${params}`);
    const json = await res.json();
    setCases(json.data || []);
    setLoading(false);
  }, [filterEntity]);

  useEffect(() => { loadCases(); }, [loadCases]);

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

  // ── Filter cases ──────────────────────────────────────────────────

  const CLOSED_STATUSES = ["Resolved", "Closed"];
  const visibleCases = cases.filter((c) => {
    if (filterStatus === "open") return !CLOSED_STATUSES.includes(c.status);
    if (filterStatus === "closed") return CLOSED_STATUSES.includes(c.status);
    return true;
  });

  // Group by entity
  const byEntity: Record<string, LegalCase[]> = {};
  ENTITY_ORDER.forEach((e) => { byEntity[e] = []; });
  visibleCases.forEach((c) => {
    if (!byEntity[c.entity]) byEntity[c.entity] = [];
    byEntity[c.entity].push(c);
  });
  const entityGroups = ENTITY_ORDER.filter((e) => byEntity[e].length > 0);

  // ── Render ────────────────────────────────────────────────────────

  const thStyle: React.CSSProperties = {
    padding: "9px 14px", textAlign: "left", fontSize: "10.5px", fontWeight: 700,
    color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.05em",
    borderBottom: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "#FAFBFC",
    whiteSpace: "nowrap",
  };
  const tdStyle: React.CSSProperties = {
    padding: "10px 14px", fontSize: "13px", color: COLOURS.NAVY,
    borderBottom: `1px solid ${COLOURS.HAIRLINE}`, verticalAlign: "middle",
  };

  return (
    <div>
      {/* Filters */}
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "18px", alignItems: "center" }}>
        <select
          value={filterEntity}
          onChange={(e) => setFilterEntity(e.target.value)}
          style={{ ...inputStyle, fontSize: "13px", padding: "6px 10px" }}
        >
          <option value="all">All Entities</option>
          {ENTITY_ORDER.map((e) => <option key={e} value={e}>{ENTITY_DISPLAY[e]}</option>)}
        </select>
        <div style={{ display: "flex", gap: "4px" }}>
          {[
            { v: "open",   l: "Open" },
            { v: "closed", l: "Resolved / Closed" },
            { v: "all",    l: "All" },
          ].map(({ v, l }) => (
            <button
              key={v}
              onClick={() => setFilterStatus(v)}
              style={{
                padding: "5px 14px", fontSize: "12px", fontWeight: 600, borderRadius: RADII.PILL,
                border: `1px solid ${filterStatus === v ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
                backgroundColor: filterStatus === v ? COLOURS.NAVY : "white",
                color: filterStatus === v ? "white" : COLOURS.SLATE, cursor: "pointer",
              }}
            >{l}</button>
          ))}
        </div>
        <span style={{ fontSize: "12px", color: COLOURS.SLATE, marginLeft: "auto" }}>
          {visibleCases.length} case{visibleCases.length !== 1 ? "s" : ""}
        </span>
      </div>

      {loading && <SkeletonRows count={6} height="44px" />}

      {!loading && visibleCases.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 20px", color: COLOURS.SLATE, fontSize: "14px" }}>
          No legal cases found.
        </div>
      )}

      {!loading && entityGroups.map((entity) => (
        <div key={entity} style={{ marginBottom: "28px" }}>
          {/* Entity header */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
            <span style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em" }}>
              {ENTITY_DISPLAY[entity] || entity}
            </span>
            <div style={{ flex: 1, height: "1px", backgroundColor: COLOURS.HAIRLINE }} />
            <span style={{ fontSize: "11px", color: COLOURS.SLATE }}>{byEntity[entity].length} case{byEntity[entity].length !== 1 ? "s" : ""}</span>
          </div>

          {/* Cases table */}
          <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: "10px", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>Case No.</th>
                  <th style={thStyle}>Location</th>
                  <th style={thStyle}>Accused</th>
                  <th style={thStyle}>Offence</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Amount (PKR)</th>
                </tr>
              </thead>
              <tbody>
                {byEntity[entity].map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => openCase(c.id)}
                    style={{ cursor: "pointer", transition: "background 0.1s" }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#F8FAFC")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
                  >
                    <td style={{ ...tdStyle, fontWeight: 700, color: COLOURS.NAVY, whiteSpace: "nowrap" }}>
                      {c.case_number}
                    </td>
                    <td style={{ ...tdStyle, color: COLOURS.SLATE }}>{c.location_name}</td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{c.subject_name}</div>
                      {c.subject_role && <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>{c.subject_role}</div>}
                    </td>
                    <td style={{ ...tdStyle, color: COLOURS.SLATE }}>{c.offence_type}</td>
                    <td style={tdStyle}><StatusBadge status={c.status} /></td>
                    <td style={{ ...tdStyle, color: COLOURS.SLATE, whiteSpace: "nowrap" }}>
                      {c.incident_date ? formatDateUK(c.incident_date) : "—"}
                    </td>
                    <td style={{ ...tdStyle, color: COLOURS.SLATE, textAlign: "right" }}>
                      {c.amount_involved_pkr ? Number(c.amount_involved_pkr).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* Case detail side panel */}
      {(loadingDetail || selectedCase) && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9990, backgroundColor: "rgba(15,23,42,0.35)", display: "flex", justifyContent: "flex-end" }}
          onClick={() => setSelectedCase(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(560px, 100vw)", height: "100%", backgroundColor: "white",
              overflowY: "auto", boxShadow: "-4px 0 32px rgba(15,23,42,0.12)",
              display: "flex", flexDirection: "column",
            }}
          >
            {loadingDetail && (
              <div style={{ padding: "24px" }}>
                <SkeletonRows count={8} height="32px" />
              </div>
            )}

            {!loadingDetail && selectedCase && (
              <>
                {/* Panel header */}
                <div style={{ padding: "20px 24px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: "#FAFBFD" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "4px" }}>
                        {selectedCase.case_number}
                      </div>
                      <div style={{ fontSize: "17px", fontWeight: 700, color: COLOURS.NAVY }}>
                        {selectedCase.subject_name}
                      </div>
                      {selectedCase.subject_role && (
                        <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "1px" }}>{selectedCase.subject_role}</div>
                      )}
                      <div style={{ marginTop: "8px" }}>
                        <StatusBadge status={selectedCase.status} />
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <button
                        onClick={deleteCase}
                        disabled={deletingCase}
                        style={{ border: `1px solid ${COLOURS.RED}40`, backgroundColor: "#FEF2F2", color: COLOURS.RED, cursor: "pointer", fontSize: "12px", fontWeight: 600, padding: "4px 10px", borderRadius: "6px", opacity: deletingCase ? 0.6 : 1 }}
                      >{deletingCase ? "Deleting…" : "Delete"}</button>
                      <button
                        onClick={() => setSelectedCase(null)}
                        style={{ border: "none", backgroundColor: "transparent", cursor: "pointer", fontSize: "20px", color: COLOURS.SLATE, padding: "0 4px", lineHeight: 1 }}
                      >×</button>
                    </div>
                  </div>

                  {/* Summary row */}
                  <div style={{ display: "flex", gap: "16px", marginTop: "12px", flexWrap: "wrap" }}>
                    {[
                      { l: "Entity", v: ENTITY_DISPLAY[selectedCase.entity] || selectedCase.entity },
                      { l: "Location", v: selectedCase.location_name },
                      { l: "Offence", v: selectedCase.offence_type },
                      { l: "Incident", v: selectedCase.incident_date ? formatDateUK(selectedCase.incident_date) : "—" },
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

                {/* Editable case fields */}
                <div style={{ padding: "16px 24px", borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "12px" }}>
                    Case Details
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    {/* Status */}
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px" }}>Status</label>
                      <select
                        value={editFields.status ?? selectedCase.status}
                        onChange={(e) => setEditFields({ ...editFields, status: e.target.value })}
                        style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                      >
                        {STATUSES.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </div>

                    <div>
                      <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px" }}>Police Station</label>
                      <input value={editFields.police_station ?? ""} onChange={(e) => setEditFields({ ...editFields, police_station: e.target.value })}
                        style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} placeholder="Optional" />
                    </div>

                    <div>
                      <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px" }}>FIR Number</label>
                      <input value={editFields.fir_number ?? ""} onChange={(e) => setEditFields({ ...editFields, fir_number: e.target.value })}
                        style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} placeholder="Optional" />
                    </div>

                    <div>
                      <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px" }}>FIR Date</label>
                      <DateInput value={editFields.fir_date ?? ""} onChange={(e) => setEditFields({ ...editFields, fir_date: e.target.value })} />
                    </div>

                    <div>
                      <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px" }}>Warrant Number</label>
                      <input value={editFields.warrant_number ?? ""} onChange={(e) => setEditFields({ ...editFields, warrant_number: e.target.value })}
                        style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} placeholder="Optional" />
                    </div>

                    <div>
                      <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px" }}>Warrant Date</label>
                      <DateInput value={editFields.warrant_date ?? ""} onChange={(e) => setEditFields({ ...editFields, warrant_date: e.target.value })} />
                    </div>

                    <div style={{ gridColumn: "1 / -1" }}>
                      <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px" }}>Court Case Number</label>
                      <input value={editFields.court_case_number ?? ""} onChange={(e) => setEditFields({ ...editFields, court_case_number: e.target.value })}
                        style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} placeholder="Optional" />
                    </div>

                    {(editFields.status === "Resolved" || editFields.status === "Closed") && (
                      <>
                        <div>
                          <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px" }}>Amount Recovered (PKR)</label>
                          <input type="number" value={editFields.amount_recovered_pkr ?? ""} onChange={(e) => setEditFields({ ...editFields, amount_recovered_pkr: e.target.value ? Number(e.target.value) : undefined })}
                            style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} placeholder="Optional" />
                        </div>
                        <div>
                          <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px" }}>Resolution Type</label>
                          <select value={editFields.resolution_type ?? ""} onChange={(e) => setEditFields({ ...editFields, resolution_type: e.target.value })}
                            style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                            <option value="">— Select —</option>
                            {["Recovered", "Convicted", "Acquitted", "Settled", "Dropped"].map((r) => <option key={r}>{r}</option>)}
                          </select>
                        </div>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <label style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "3px" }}>Resolution Notes</label>
                          <textarea value={editFields.resolution_notes ?? ""} onChange={(e) => setEditFields({ ...editFields, resolution_notes: e.target.value })}
                            rows={2} style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical" as const }} />
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

                {/* Update timeline */}
                <div style={{ padding: "16px 24px", flex: 1 }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "14px" }}>
                    Activity Log ({selectedCase.updates.length})
                  </div>

                  {selectedCase.updates.length === 0 && (
                    <p style={{ fontSize: "13px", color: COLOURS.SLATE }}>No follow-ups logged yet.</p>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {selectedCase.updates.map((u) => (
                      <div key={u.id} style={{ borderLeft: `3px solid ${COLOURS.HAIRLINE}`, paddingLeft: "14px", position: "relative" }}>
                        <div style={{ position: "absolute", left: "-6px", top: "4px", width: "9px", height: "9px", borderRadius: "50%", backgroundColor: COLOURS.NAVY }} />
                        <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.NAVY }}>{u.update_type}</span>
                          <span style={{ fontSize: "11px", color: COLOURS.SLATE }}>{formatDateUK(u.update_date)}</span>
                          {u.status_after && u.status_after !== u.status_before && (
                            <StatusBadge status={u.status_after} />
                          )}
                        </div>
                        <p style={{ fontSize: "13px", color: COLOURS.NAVY, margin: "4px 0 0" }}>{u.description}</p>
                        {u.fir_number && <p style={{ fontSize: "11px", color: COLOURS.SLATE, margin: "2px 0 0" }}>FIR: {u.fir_number}</p>}
                        {u.warrant_number && <p style={{ fontSize: "11px", color: COLOURS.SLATE, margin: "2px 0 0" }}>Warrant: {u.warrant_number}</p>}
                        {u.next_action && (
                          <p style={{ fontSize: "11px", color: COLOURS.AMBER, margin: "4px 0 0", fontWeight: 600 }}>
                            Next: {u.next_action}{u.next_action_date ? ` — by ${formatDateUK(u.next_action_date)}` : ""}
                          </p>
                        )}
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
