"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../../lib/supabase";
import { formatDateUK } from "../../../lib/dateUtils";
import DateInput from "../../../lib/DateInput";
import { useMobile } from "../../../lib/useMobile";
import { useUserCtx } from "../../../lib/useUserCtx";
import {
  COLOURS, RADII, SectionTitle, CountCard, SkeletonRows,
  useToast, primaryButtonStyle, inputStyle,
} from "../../../lib/SharedUI";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function authedFetch(url: string, opts: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers ?? {}), Authorization: `Bearer ${session?.access_token}` },
  });
}

const ENTITIES = ["IFPL", "Baranh", "HD", "UTPL"] as const;
type Entity = (typeof ENTITIES)[number];

const ENTITY_DISPLAY: Record<string, string> = {
  IFPL:   "IFPL — Imperial Footwear",
  Baranh: "Baranh",
  HD:     "Haute Dolci",
  UTPL:   "UTPL — Unze Trading",
};

const PAYMENT_TYPES = ["EOBI", "Social Security"] as const;
const MONTH_NAMES   = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_FULL    = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function fmtPKR(n: number | null | undefined) {
  if (n == null) return "—";
  return "PKR " + n.toLocaleString("en-PK", { maximumFractionDigits: 0 });
}

function monthLabel(isoDate: string) {
  const [y, m] = isoDate.split("-");
  return `${MONTH_FULL[parseInt(m, 10) - 1]} ${y}`;
}

function canWrite(role: string | null | undefined) {
  return role === "Admin" || role === "CEO" || role === "Manager";
}

// ─── Types ───────────────────────────────────────────────────────────────────

type Summary = {
  pending_challans:  number;
  overdue_challans:  number;
  paid_this_month:   number;
  total_pending_pkr: number;
  eobi_registered:   number;
  eobi_pending:      number;
  ss_registered:     number;
  ss_pending:        number;
  pending_list:      PendingChallan[];
};

type PendingChallan = {
  id:             string;
  entity:         string;
  payment_type:   string;
  month:          string;
  amount_pkr:     number | null;
  enrolled_count: number | null;
  notes:          string | null;
  created_by:     string | null;
  created_at:     string;
  is_overdue:     boolean;
};

type MonthEntry = {
  month:          number;
  amount_pkr:     number | null;
  date_paid:      string | null;
  challan_number: string | null;
  is_late:        boolean | null;
  status:         "on_time" | "late" | "missing" | "future" | "pending";
};
type CalendarRow = { entity: string; payment_type: string; months: MonthEntry[] };

type Registration = {
  location_id: string; name: string; entity: string; location_type: string;
  eobi_status: string | null; eobi_notes: string | null;
  ss_status:   string | null; ss_notes:   string | null;
};

// ─── Small shared UI pieces ───────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  on_time: { bg: "#D1FAE5", color: COLOURS.GREEN,  label: "Paid" },
  late:    { bg: "#FEF3C7", color: COLOURS.AMBER,  label: "Paid Late" },
  missing: { bg: "#FEE2E2", color: COLOURS.RED,    label: "Missing" },
  pending: { bg: "#FEF3C7", color: COLOURS.AMBER,  label: "Pending" },
  future:  { bg: COLOURS.HAIRLINE, color: COLOURS.SLATE, label: "—" },
};

function MonthCell({ entry }: { entry: MonthEntry }) {
  const s = STATUS_STYLES[entry.status] ?? STATUS_STYLES.future;
  if (entry.status === "future") {
    return (
      <td style={{ padding: "6px 8px", fontSize: "11px", color: COLOURS.SLATE, textAlign: "center" }}>—</td>
    );
  }
  return (
    <td style={{ padding: "6px 8px", textAlign: "center", verticalAlign: "top" }}>
      <span style={{
        display: "inline-block", fontSize: "10px", fontWeight: 700,
        padding: "2px 6px", borderRadius: RADII.PILL,
        backgroundColor: s.bg, color: s.color, whiteSpace: "nowrap",
      }}>{s.label}</span>
      {entry.amount_pkr != null && (
        <div style={{ fontSize: "10px", color: COLOURS.SLATE, marginTop: "2px" }}>
          {fmtPKR(entry.amount_pkr)}
        </div>
      )}
    </td>
  );
}

function RegPill({ status }: { status: string | null }) {
  const s = status ?? "Pending";
  const map: Record<string, { bg: string; color: string }> = {
    Registered: { bg: "#D1FAE5", color: COLOURS.GREEN },
    Pending:    { bg: "#FEF3C7", color: COLOURS.AMBER },
    Inprocess:  { bg: "#FEF3C7", color: COLOURS.AMBER },
    "N/A":      { bg: COLOURS.HAIRLINE, color: COLOURS.SLATE },
    Overdue:    { bg: "#FEE2E2", color: COLOURS.RED },
  };
  const c = map[s] ?? map["Pending"];
  return (
    <span style={{
      fontSize: "11px", fontWeight: 700, padding: "2px 8px",
      borderRadius: RADII.PILL, backgroundColor: c.bg, color: c.color, whiteSpace: "nowrap",
    }}>{s}</span>
  );
}

// ─── Create Challan Form ──────────────────────────────────────────────────────

function CreateChallanForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const { show, element } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    entity:         "IFPL" as Entity,
    payment_type:   "EOBI",
    month:          "",
    amount_pkr:     "",
    enrolled_count: "",
    notes:          "",
  });

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const labelStyle: React.CSSProperties = {
    fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY,
    display: "block", marginBottom: "4px",
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.month) { show("Please select the contribution month.", "error"); return; }
    setSaving(true);
    try {
      const res = await authedFetch("/api/hr/eobi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity:         form.entity,
          payment_type:   form.payment_type,
          month:          form.month,
          amount_pkr:     form.amount_pkr     ? parseFloat(form.amount_pkr)     : null,
          enrolled_count: form.enrolled_count ? parseInt(form.enrolled_count, 10) : null,
          notes:          form.notes || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) { show(json.error ?? "Failed to create challan.", "error"); return; }
      show("Challan raised — Admin Operations will mark it paid once deposited.", "success");
      onSuccess();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {element}
      <form onSubmit={handleSubmit} style={{
        border: `1px solid ${COLOURS.HAIRLINE}`,
        borderRadius: RADII.CARD,
        padding: "20px",
        backgroundColor: "#F8FAFC",
      }}>
        <div style={{ fontWeight: 700, fontSize: "14px", color: COLOURS.NAVY, marginBottom: "16px" }}>
          Raise Payment Challan
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px" }}>
          <div>
            <label style={labelStyle}>Company</label>
            <select value={form.entity} onChange={e => set("entity", e.target.value)} style={inputStyle} required>
              {ENTITIES.map(e => <option key={e} value={e}>{ENTITY_DISPLAY[e]}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Scheme</label>
            <select value={form.payment_type} onChange={e => set("payment_type", e.target.value)} style={inputStyle} required>
              {PAYMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Contribution Month (1st of month)</label>
            <DateInput value={form.month} onChange={e => set("month", e.target.value)} placeholder="DD/MM/YYYY" style={inputStyle} />
            <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>
              Enter the 1st of the month, e.g. 01/07/2026
            </div>
          </div>
          <div>
            <label style={labelStyle}>Enrolled Employees</label>
            <input
              type="number" min="0" value={form.enrolled_count}
              onChange={e => set("enrolled_count", e.target.value)}
              placeholder="e.g. 250" style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Estimated Amount (PKR)</label>
            <input
              type="number" min="0" step="0.01" value={form.amount_pkr}
              onChange={e => set("amount_pkr", e.target.value)}
              placeholder="Optional" style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Notes</label>
            <input
              type="text" value={form.notes}
              onChange={e => set("notes", e.target.value)}
              placeholder="Optional" style={inputStyle}
            />
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "16px" }}>
          <button type="button" onClick={onCancel} style={{
            padding: "8px 16px", fontSize: "13px", fontWeight: 600,
            border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD,
            background: "white", cursor: "pointer", color: COLOURS.SLATE,
          }}>Cancel</button>
          <button type="submit" disabled={saving} style={primaryButtonStyle}>
            {saving ? "Raising…" : "Raise Challan"}
          </button>
        </div>
      </form>
    </>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({
  summary,
  loading,
  userRole,
  onRefresh,
}: {
  summary:  Summary | null;
  loading:  boolean;
  userRole: string | null | undefined;
  onRefresh: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const { show, element } = useToast();

  async function deleteChallan(id: string) {
    if (!confirm("Remove this pending challan? This cannot be undone.")) return;
    const res = await authedFetch("/api/hr/eobi", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const json = await res.json();
    if (!res.ok) { show(json.error ?? "Failed to remove.", "error"); return; }
    show("Challan removed.", "success");
    onRefresh();
  }

  if (loading) return <SkeletonRows count={6} />;

  const s = summary;
  const hasPending = (s?.pending_list?.length ?? 0) > 0;
  const hasOverdue = s?.pending_list?.some(c => c.is_overdue) ?? false;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {element}

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
        <CountCard label="Pending Challans" value={s?.pending_challans  ?? 0} color={COLOURS.AMBER} />
        <CountCard label="Overdue"          value={s?.overdue_challans  ?? 0} color={COLOURS.RED}   />
        <CountCard label="Paid This Month"  value={s?.paid_this_month   ?? 0} color={COLOURS.GREEN} />
        <CountCard label="Pending (PKR)"    value={fmtPKR(s?.total_pending_pkr)} color={COLOURS.NAVY} />
      </div>

      {/* Registration snapshot */}
      <div style={{
        border: `1px solid ${COLOURS.HAIRLINE}`,
        borderRadius: RADII.CARD,
        padding: "16px 20px",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "12px",
      }}>
        <div>
          <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
            EOBI Registrations
          </div>
          <span style={{ fontSize: "14px", color: COLOURS.GREEN, marginRight: "16px" }}>
            <strong>{s?.eobi_registered ?? 0}</strong> <span style={{ color: COLOURS.SLATE }}>Registered</span>
          </span>
          <span style={{ fontSize: "14px", color: COLOURS.AMBER }}>
            <strong>{s?.eobi_pending ?? 0}</strong> <span style={{ color: COLOURS.SLATE }}>Pending</span>
          </span>
        </div>
        <div>
          <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
            Social Security Registrations
          </div>
          <span style={{ fontSize: "14px", color: COLOURS.GREEN, marginRight: "16px" }}>
            <strong>{s?.ss_registered ?? 0}</strong> <span style={{ color: COLOURS.SLATE }}>Registered</span>
          </span>
          <span style={{ fontSize: "14px", color: COLOURS.AMBER }}>
            <strong>{s?.ss_pending ?? 0}</strong> <span style={{ color: COLOURS.SLATE }}>Pending</span>
          </span>
        </div>
      </div>

      {/* Overdue warning */}
      {hasOverdue && (
        <div style={{
          border: `1px solid ${COLOURS.RED}`, borderRadius: RADII.CARD,
          padding: "10px 14px", backgroundColor: "#FEF2F2",
          color: COLOURS.RED, fontSize: "13px", fontWeight: 600,
        }}>
          ⚠ Some challans are overdue — the contribution month has passed without a deposit recorded by Admin.
        </div>
      )}

      {/* Pending challans list */}
      {hasPending && (
        <div>
          <SectionTitle title="Pending Challans — Awaiting Deposit by Admin" />
          <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ backgroundColor: "#F8FAFC" }}>
                  {["Company","Scheme","Month","Employees","Amount (Est.)","Raised By","Status",""].map(h => (
                    <th key={h} style={{
                      padding: "8px 12px", textAlign: "left", fontSize: "11px",
                      fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase",
                      letterSpacing: "0.06em", borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s?.pending_list?.map(c => (
                  <tr key={c.id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                    <td style={{ padding: "10px 12px", fontWeight: 600, color: COLOURS.NAVY }}>{c.entity}</td>
                    <td style={{ padding: "10px 12px", color: COLOURS.SLATE }}>{c.payment_type}</td>
                    <td style={{ padding: "10px 12px" }}>{monthLabel(c.month)}</td>
                    <td style={{ padding: "10px 12px", color: COLOURS.SLATE }}>{c.enrolled_count ?? "—"}</td>
                    <td style={{ padding: "10px 12px" }}>{fmtPKR(c.amount_pkr)}</td>
                    <td style={{ padding: "10px 12px", color: COLOURS.SLATE, fontSize: "12px" }}>
                      {c.created_by?.split("@")[0] ?? "—"}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{
                        fontSize: "11px", fontWeight: 700, padding: "2px 8px",
                        borderRadius: RADII.PILL,
                        backgroundColor: c.is_overdue ? "#FEE2E2" : "#FEF3C7",
                        color: c.is_overdue ? COLOURS.RED : COLOURS.AMBER,
                      }}>
                        {c.is_overdue ? "Overdue" : "Pending"}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      {canWrite(userRole) && (
                        <button
                          onClick={() => deleteChallan(c.id)}
                          style={{
                            background: "none", border: "none", cursor: "pointer",
                            fontSize: "12px", color: COLOURS.RED, padding: 0,
                          }}
                        >Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!hasPending && !loading && (
        <div style={{
          border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD,
          padding: "24px", textAlign: "center", color: COLOURS.SLATE, fontSize: "13px",
        }}>
          No pending challans. All contributions are up to date.
        </div>
      )}

      {/* Raise Challan */}
      {canWrite(userRole) && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <SectionTitle title="Raise a New Challan" />
            {!showForm && (
              <button onClick={() => setShowForm(true)} style={primaryButtonStyle}>
                + Raise Challan
              </button>
            )}
          </div>
          {showForm && (
            <CreateChallanForm
              onSuccess={() => { setShowForm(false); onRefresh(); }}
              onCancel={() => setShowForm(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Payments Calendar Tab ────────────────────────────────────────────────────

function PaymentsTab() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<CalendarRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<"EOBI" | "Social Security" | "Both">("Both");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin/payments?year=${year}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const json = await res.json();
      if (json.data) {
        // Re-label "missing" entries as "pending" where a challan was raised (date_paid IS NULL)
        // The calendar RPC returns status=missing for unpaid past months —
        // those are displayed as "Pending" in HR view since challan may be in progress.
        const processed: CalendarRow[] = (json.data as CalendarRow[]).map(row => ({
          ...row,
          months: row.months.map((m: MonthEntry) => ({
            ...m,
            status: m.status === "missing" ? "pending" : m.status,
          })),
        }));
        setRows(processed);
      }
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r =>
    filterType === "Both" || r.payment_type === filterType
  );

  const thisYear = new Date().getFullYear();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Controls */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={() => setYear(y => y - 1)}
          style={{
            padding: "6px 10px", fontSize: "13px",
            border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD,
            background: "white", cursor: "pointer",
          }}>←</button>
        <div style={{ fontWeight: 700, fontSize: "16px", color: COLOURS.NAVY, minWidth: "48px", textAlign: "center" }}>
          {year}
        </div>
        <button
          onClick={() => setYear(y => y + 1)}
          disabled={year >= thisYear}
          style={{
            padding: "6px 10px", fontSize: "13px",
            border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD,
            background: year >= thisYear ? COLOURS.HAIRLINE : "white",
            cursor: year >= thisYear ? "default" : "pointer",
          }}>→</button>
        <div style={{ marginLeft: "16px", display: "flex", gap: "4px" }}>
          {(["Both","EOBI","Social Security"] as const).map(t => (
            <button key={t} onClick={() => setFilterType(t)} style={{
              padding: "5px 10px", fontSize: "12px", fontWeight: 600,
              border: `1px solid ${filterType === t ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
              borderRadius: RADII.PILL, cursor: "pointer",
              backgroundColor: filterType === t ? COLOURS.NAVY : "white",
              color: filterType === t ? "white" : COLOURS.SLATE,
            }}>{t}</button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", fontSize: "11px", color: COLOURS.SLATE }}>
        {([
          { label: "Paid on time", bg: "#D1FAE5", border: COLOURS.GREEN },
          { label: "Paid late",    bg: "#FEF3C7", border: COLOURS.AMBER },
          { label: "Pending / Not yet paid", bg: "#FEF3C7", border: COLOURS.AMBER },
          { label: "Missing (no challan)",   bg: "#FEE2E2", border: COLOURS.RED   },
        ]).map(l => (
          <span key={l.label} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "2px", backgroundColor: l.bg, border: `1px solid ${l.border}`, display: "inline-block" }} />
            {l.label}
          </span>
        ))}
      </div>

      {loading ? <SkeletonRows count={8} /> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
            <thead>
              <tr style={{ backgroundColor: "#F8FAFC" }}>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700, color: COLOURS.NAVY, borderBottom: `1px solid ${COLOURS.HAIRLINE}`, whiteSpace: "nowrap" }}>
                  Company
                </th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700, color: COLOURS.NAVY, borderBottom: `1px solid ${COLOURS.HAIRLINE}`, whiteSpace: "nowrap" }}>
                  Scheme
                </th>
                {MONTH_NAMES.map(m => (
                  <th key={m} style={{
                    padding: "8px 6px", textAlign: "center", fontWeight: 700, fontSize: "11px",
                    color: COLOURS.SLATE, borderBottom: `1px solid ${COLOURS.HAIRLINE}`, minWidth: "58px",
                  }}>{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                  <td style={{ padding: "8px 12px", fontWeight: 600, color: COLOURS.NAVY, whiteSpace: "nowrap" }}>{row.entity}</td>
                  <td style={{ padding: "8px 12px", color: COLOURS.SLATE, whiteSpace: "nowrap" }}>{row.payment_type}</td>
                  {row.months.map((m, j) => <MonthCell key={j} entry={m} />)}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={14} style={{ padding: "40px", textAlign: "center", color: COLOURS.SLATE }}>
                    No payment data for {year}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>
        ℹ Payments are marked paid by Admin Operations once the deposit is made. HR creates the challan to initiate the process.
      </div>
    </div>
  );
}

// ─── Registrations Tab ───────────────────────────────────────────────────────

function RegistrationsTab() {
  const [rows, setRows] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await authedFetch("/api/admin/registrations");
      const json = await res.json();
      if (json.data) setRows(json.data);
      setLoading(false);
    })();
  }, []);

  if (loading) return <SkeletonRows count={10} />;

  const grouped: Record<string, Registration[]> = {};
  for (const r of rows) {
    if (!grouped[r.entity]) grouped[r.entity] = [];
    grouped[r.entity].push(r);
  }
  const entityOrder = ["IFPL", "Baranh", "HD", "UTPL"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>
        Registration status is managed in Admin Operations. This is a read-only reference for HR.
      </div>
      {entityOrder.filter(e => grouped[e]?.length).map(entity => (
        <div key={entity}>
          <SectionTitle title={ENTITY_DISPLAY[entity] ?? entity} />
          <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ backgroundColor: "#F8FAFC" }}>
                  {["Location","Type","EOBI Status","Social Security Status"].map(h => (
                    <th key={h} style={{
                      padding: "8px 12px", textAlign: "left", fontSize: "11px",
                      fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase",
                      letterSpacing: "0.06em", borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grouped[entity].map(r => (
                  <tr key={r.location_id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                    <td style={{ padding: "10px 12px", fontWeight: 600, color: COLOURS.NAVY }}>{r.name}</td>
                    <td style={{ padding: "10px 12px", color: COLOURS.SLATE, textTransform: "capitalize" }}>{r.location_type}</td>
                    <td style={{ padding: "10px 12px" }}>
                      <RegPill status={r.eobi_status} />
                      {r.eobi_notes && (
                        <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "3px" }}>{r.eobi_notes}</div>
                      )}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <RegPill status={r.ss_status} />
                      {r.ss_notes && (
                        <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "3px" }}>{r.ss_notes}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {entityOrder.every(e => !grouped[e]?.length) && (
        <div style={{ padding: "40px", textAlign: "center", color: COLOURS.SLATE, fontSize: "13px" }}>
          No registration data found.
        </div>
      )}
    </div>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

type EobiInnerTab = "overview" | "payments" | "registrations";
const INNER_TABS: { key: EobiInnerTab; label: string }[] = [
  { key: "overview",      label: "Overview" },
  { key: "payments",      label: "Payment Calendar" },
  { key: "registrations", label: "Registrations" },
];

export default function HREobi() {
  const { ctx: member } = useUserCtx();
  const [activeTab, setActiveTab]     = useState<EobiInnerTab>("overview");
  const [summary, setSummary]         = useState<Summary | null>(null);
  const [summaryLoading, setLoading]  = useState(true);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await authedFetch("/api/hr/eobi");
      const json = await res.json();
      if (json.data) setSummary(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const pillStyle = (key: EobiInnerTab): React.CSSProperties => ({
    padding: "5px 14px", fontSize: "12px", fontWeight: 600,
    borderRadius: RADII.PILL,
    border: `1px solid ${activeTab === key ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
    backgroundColor: activeTab === key ? COLOURS.NAVY : "white",
    color: activeTab === key ? "white" : COLOURS.SLATE,
    cursor: "pointer",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Inner tab pills */}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {INNER_TABS.map(t => (
          <button key={t.key} style={pillStyle(t.key)} onClick={() => setActiveTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "overview"      && (
        <OverviewTab
          summary={summary}
          loading={summaryLoading}
          userRole={member?.role}
          onRefresh={loadSummary}
        />
      )}
      {activeTab === "payments"      && <PaymentsTab />}
      {activeTab === "registrations" && <RegistrationsTab />}
    </div>
  );
}
