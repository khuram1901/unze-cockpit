"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { useRequireCapability } from "../lib/useRouteGuard";
import { authFetch } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import DateInput from "../lib/DateInput";
import {
  COLOURS, RADII, PageHeader, SkeletonRows,
  useToast, primaryButtonStyle, inputStyle,
} from "../lib/SharedUI";

// ── Types ─────────────────────────────────────────────────────────────

type MonthEntry = {
  month: number;
  amount_pkr: number | null;
  date_paid: string | null;
  challan_number: string | null;
  is_late: boolean | null;
  status: "on_time" | "late" | "missing" | "future";
};

type PaymentRow = { entity: string; payment_type: string; months: MonthEntry[] };

// ── Constants ──────────────────────────────────────────────────────────

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_FULL  = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const ENTITY_DISPLAY: Record<string, string> = {
  IFPL: "IFPL — Imperial Footwear",
  Baranh: "Baranh",
  HD: "Haute Dolci",
  UTPL: "UTPL — Unze Trading",
};

// ── Feature tabs (top level — more will be added later) ──────────────
type FeatureTab = "eobi_ss";
const FEATURE_TABS: { id: FeatureTab; label: string }[] = [
  { id: "eobi_ss", label: "EOBI & Social Security" },
];

// ── Company sub-tabs ─────────────────────────────────────────────────
type CompanyTab = "unze" | "imperial" | "restaurants";
const COMPANY_TABS: { id: CompanyTab; label: string; entities: string[] }[] = [
  { id: "unze",        label: "Unze",        entities: ["UTPL"] },
  { id: "imperial",    label: "Imperial",    entities: ["IFPL"] },
  { id: "restaurants", label: "Restaurants", entities: ["Baranh", "HD"] },
];

// ── Fiscal year helpers ───────────────────────────────────────────────
// Pakistan fiscal year: July → June. "2025-26" means Jul 2025–Jun 2026.
function getCurrentFiscalYear(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // 1-based
  // If month is July (7) or later, FY has started with y
  return m >= 7 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
}

function fiscalYearToCalendar(fy: string): number {
  // "2025-26" → 2025 (start year, which is what the payments RPC uses)
  return parseInt(fy.split("-")[0], 10);
}

function buildAvailableYears(): string[] {
  const current = getCurrentFiscalYear();
  const startYear = fiscalYearToCalendar(current);
  // Show 3 past years + current
  const years: string[] = [];
  for (let y = startYear - 3; y <= startYear; y++) {
    years.push(`${y}-${String(y + 1).slice(2)}`);
  }
  return years;
}

// ── Component ──────────────────────────────────────────────────────────

export default function BankingPage() {
  const { checking } = useRequireCapability("banking");

  const availableYears = buildAvailableYears();
  const currentFY = getCurrentFiscalYear();
  const [selectedYear, setSelectedYear] = useState(currentFY);

  const [featureTab, setFeatureTab] = useState<FeatureTab>("eobi_ss");
  const [companyTab, setCompanyTab] = useState<CompanyTab>("unze");

  const [paymentRows, setPaymentRows] = useState<PaymentRow[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(true);

  const [addingPayment, setAddingPayment] = useState<{
    entity: string; payment_type: string; month: number;
  } | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    amount_pkr: "", date_paid: "", challan_number: "", notes: "",
  });
  const [savingPayment, setSavingPayment] = useState(false);

  const { show: showToast, element: toastElement } = useToast();

  // ── Data loading ──────────────────────────────────────────────────

  async function loadPayments() {
    setLoadingPayments(true);
    const calYear = fiscalYearToCalendar(selectedYear);
    const res = await authFetch(`/api/admin/payments?year=${calYear}`);
    const json = await res.json();
    setPaymentRows(json.data || []);
    setLoadingPayments(false);
  }

  useEffect(() => {
    if (!checking) loadPayments();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checking, selectedYear]);

  // ── Save payment ──────────────────────────────────────────────────

  async function savePayment() {
    if (!addingPayment) return;
    setSavingPayment(true);
    const calYear = fiscalYearToCalendar(selectedYear);
    const res = await authFetch("/api/admin/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entity: addingPayment.entity,
        payment_type: addingPayment.payment_type,
        month: `${calYear}-${String(addingPayment.month).padStart(2, "0")}-01`,
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

  function openAddModal(entity: string, payType: string, month: number) {
    setPaymentForm({ amount_pkr: "", date_paid: "", challan_number: "", notes: "" });
    setAddingPayment({ entity, payment_type: payType, month });
  }

  // ── Render helpers ────────────────────────────────────────────────

  function entityBadge(row: PaymentRow) {
    const past = (row.months || []).filter((m) => m.status !== "future");
    const missing = past.filter((m) => m.status === "missing").length;
    const late    = past.filter((m) => m.status === "late").length;
    const onTime  = past.filter((m) => m.status === "on_time").length;
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
                on_time: { bg: COLOURS.GREEN, color: "white",       symbol: "✓" },
                late:    { bg: COLOURS.AMBER, color: "white",       symbol: "!" },
                missing: { bg: COLOURS.RED,   color: "white",       symbol: "✗" },
                future:  { bg: "#E2E8F0",     color: COLOURS.SLATE, symbol: "—" },
              };
              const cfg = circleCfg[entry.status] || circleCfg.future;
              const detail = entry.date_paid
                ? formatDateUK(entry.date_paid).slice(0, 5)
                : entry.status === "missing" ? "Overdue" : "Due 15";
              const tooltip = entry.date_paid
                ? `Paid ${formatDateUK(entry.date_paid)}${entry.challan_number ? ` · Challan ${entry.challan_number}` : ""}${entry.amount_pkr ? ` · PKR ${Number(entry.amount_pkr).toLocaleString()}` : ""}`
                : entry.status === "missing" ? "Not paid — click to record" : "";
              const clickable = entry.status !== "future";
              return (
                <div
                  key={entry.month}
                  title={tooltip}
                  onClick={() => clickable && openAddModal(row.entity, payType, entry.month)}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    gap: "3px", cursor: clickable ? "pointer" : "default",
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

  function renderSection(title: string, rows: PaymentRow[], payType: string, entities: string[]) {
    const badge = sectionBadge(rows);
    return (
      <div style={{ marginBottom: "28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
          <span style={{
            fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE,
            textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap",
          }}>
            {title}
          </span>
          <div style={{ flex: 1, height: "1px", backgroundColor: COLOURS.HAIRLINE }} />
          {badge && (
            <span style={{
              fontSize: "11px", fontWeight: 700, padding: "2px 9px",
              borderRadius: "20px", backgroundColor: badge.bg, color: badge.color, whiteSpace: "nowrap",
            }}>
              {badge.text}
            </span>
          )}
          <button
            onClick={() => openAddModal(entities[0], payType, new Date().getMonth() + 1)}
            style={{
              fontSize: "12px", fontWeight: 600, padding: "5px 12px",
              borderRadius: "20px", border: `1px solid ${COLOURS.HAIRLINE}`,
              backgroundColor: "white", color: COLOURS.NAVY, cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            + Record Payment
          </button>
        </div>
        {rows.length === 0
          ? <p style={{ fontSize: "13px", color: COLOURS.SLATE }}>No data for {selectedYear}.</p>
          : rows.map((r) => renderEntityBlock(r, payType))
        }
      </div>
    );
  }

  function renderEobiSS() {
    if (loadingPayments) return <SkeletonRows count={6} height="64px" />;

    const tab = COMPANY_TABS.find((t) => t.id === companyTab)!;
    const { entities } = tab;

    const eobiRows = entities
      .map((e) => paymentRows.find((r) => r.entity === e && r.payment_type === "EOBI"))
      .filter(Boolean) as PaymentRow[];
    const ssRows = entities
      .map((e) => paymentRows.find((r) => r.entity === e && r.payment_type === "Social Security"))
      .filter(Boolean) as PaymentRow[];

    return (
      <div>
        {/* Company sub-tabs */}
        <div style={{
          display: "flex", gap: "4px", marginBottom: "20px",
          borderBottom: `2px solid ${COLOURS.HAIRLINE}`,
        }}>
          {COMPANY_TABS.map((ct) => {
            const active = companyTab === ct.id;
            return (
              <button
                key={ct.id}
                onClick={() => setCompanyTab(ct.id)}
                style={{
                  padding: "8px 18px", fontSize: "13px", fontWeight: active ? 700 : 500,
                  color: active ? COLOURS.NAVY : COLOURS.SLATE,
                  backgroundColor: "transparent", border: "none",
                  borderBottom: active ? `2px solid ${COLOURS.NAVY}` : "2px solid transparent",
                  marginBottom: "-2px", cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                {ct.label}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{
          display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "20px",
          padding: "10px 14px", backgroundColor: "#FAFBFD",
          borderRadius: "8px", border: `1px solid ${COLOURS.HAIRLINE}`,
        }}>
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
            Click any circle to record or update a payment.
          </span>
        </div>

        {renderSection("EOBI — Monthly Payments", eobiRows, "EOBI", entities)}
        {renderSection("Social Security — Monthly Payments", ssRows, "Social Security", entities)}
      </div>
    );
  }

  // ── Guard ─────────────────────────────────────────────────────────

  if (checking) return (
    <AuthWrapper>
      <main style={{ padding: "14px 18px" }}>
        <p style={{ color: COLOURS.SLATE }}>Checking permissions...</p>
      </main>
    </AuthWrapper>
  );

  // ── Pill styles ───────────────────────────────────────────────────

  const yearPill = (active: boolean): React.CSSProperties => ({
    padding: "5px 14px", borderRadius: RADII.PILL, fontSize: "13px", fontWeight: 600,
    cursor: "pointer", border: `1px solid ${active ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
    backgroundColor: active ? COLOURS.NAVY : "white",
    color: active ? "white" : COLOURS.SLATE,
    transition: "background 0.15s",
  });

  // ── Render ────────────────────────────────────────────────────────

  return (
    <AuthWrapper>
      <main style={{ padding: "14px 18px", maxWidth: "860px", margin: "0 auto" }}>
        <PageHeader />

        {/* Title + year pills */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "12px", marginBottom: "24px" }}>
          <div>
            <div style={{ fontSize: "22px", fontWeight: 700, color: COLOURS.NAVY, letterSpacing: "-0.01em" }}>
              Banking
            </div>
            <p style={{ fontSize: "13px", color: COLOURS.SLATE, marginTop: "2px" }}>
              Payment tracking and compliance
            </p>
          </div>
          {/* Year pill selector */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", paddingTop: "4px" }}>
            {availableYears.map((y) => (
              <button key={y} style={yearPill(y === selectedYear)} onClick={() => setSelectedYear(y)}>
                {y}
              </button>
            ))}
          </div>
        </div>

        {/* Feature tabs (top-level) */}
        <div style={{
          display: "flex", gap: "0", marginBottom: "24px",
          borderBottom: `2px solid ${COLOURS.HAIRLINE}`,
        }}>
          {FEATURE_TABS.map((ft) => {
            const active = featureTab === ft.id;
            return (
              <button
                key={ft.id}
                onClick={() => setFeatureTab(ft.id)}
                style={{
                  padding: "10px 20px", fontSize: "14px", fontWeight: active ? 700 : 500,
                  color: active ? COLOURS.NAVY : COLOURS.SLATE,
                  backgroundColor: "transparent", border: "none",
                  borderBottom: active ? `2px solid ${COLOURS.NAVY}` : "2px solid transparent",
                  marginBottom: "-2px", cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                {ft.label}
              </button>
            );
          })}
        </div>

        {/* Feature tab content */}
        {featureTab === "eobi_ss" && renderEobiSS()}

        {/* Record Payment modal */}
        {addingPayment && (
          <div
            style={{
              position: "fixed", inset: 0, zIndex: 9998,
              backgroundColor: "rgba(15,23,42,0.4)",
              display: "flex", alignItems: "center", justifyContent: "center", padding: "16px",
            }}
            onClick={() => setAddingPayment(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                backgroundColor: "white", borderRadius: RADII.CARD, padding: "24px",
                maxWidth: "440px", width: "100%", boxShadow: "0 20px 60px rgba(15,23,42,0.15)",
              }}
            >
              <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "4px" }}>
                Record Payment
              </div>
              <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "16px" }}>
                {ENTITY_DISPLAY[addingPayment.entity] || addingPayment.entity} · {addingPayment.payment_type}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Entity</label>
                  <select
                    value={addingPayment.entity}
                    onChange={(e) => setAddingPayment({ ...addingPayment, entity: e.target.value })}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                  >
                    {COMPANY_TABS.find((t) => t.id === companyTab)!.entities.map((e) => (
                      <option key={e} value={e}>{ENTITY_DISPLAY[e] || e}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Type</label>
                  <select
                    value={addingPayment.payment_type}
                    onChange={(e) => setAddingPayment({ ...addingPayment, payment_type: e.target.value })}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                  >
                    <option>EOBI</option>
                    <option>Social Security</option>
                  </select>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Month</label>
                  <select
                    value={addingPayment.month}
                    onChange={(e) => setAddingPayment({ ...addingPayment, month: Number(e.target.value) })}
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                  >
                    {MONTH_FULL.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Date Paid *</label>
                  <DateInput
                    value={paymentForm.date_paid}
                    onChange={(e) => setPaymentForm({ ...paymentForm, date_paid: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Amount (PKR)</label>
                  <input
                    type="number"
                    value={paymentForm.amount_pkr}
                    onChange={(e) => setPaymentForm({ ...paymentForm, amount_pkr: e.target.value })}
                    placeholder="Optional"
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Challan No.</label>
                  <input
                    type="text"
                    value={paymentForm.challan_number}
                    onChange={(e) => setPaymentForm({ ...paymentForm, challan_number: e.target.value })}
                    placeholder="Optional"
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.SLATE, display: "block", marginBottom: "4px" }}>Notes (optional)</label>
                <textarea
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                  rows={2}
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical" as const }}
                />
              </div>

              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <button
                  onClick={() => setAddingPayment(null)}
                  style={{
                    padding: "8px 16px", borderRadius: RADII.PILL, fontSize: "13px",
                    fontWeight: 500, border: `1px solid ${COLOURS.HAIRLINE}`,
                    backgroundColor: "white", color: COLOURS.NAVY, cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={savePayment}
                  disabled={savingPayment || !paymentForm.date_paid}
                  style={{ ...primaryButtonStyle, opacity: (savingPayment || !paymentForm.date_paid) ? 0.6 : 1 }}
                >
                  {savingPayment ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}

        {toastElement}
      </main>
    </AuthWrapper>
  );
}
