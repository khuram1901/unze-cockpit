"use client";

/**
 * RetailSalesTab — rendered inside /finance/[company]/page.tsx when the
 * user activates the "Retail Sales" tab.
 *
 * Panels:
 *  - Filter bar (month chips + store dropdown) + HOD buttons
 *  - Row-state legend
 *  - daily_sales_computed table (all columns per mockup B)
 *  - Opening Balances side-panel (mockup C left)
 *  - Excel Import side-panel (mockup C right)
 *
 * All figures come from Supabase via /api/daily-sales/rows.
 * No calculations happen in JS.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import OpeningBalancesPanel from "./OpeningBalancesPanel";
import ExcelImportPanel from "./ExcelImportPanel";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Store {
  id: string;
  fm_code: string;
  name: string;
  email: string;
}

interface SalesRow {
  id: string;
  store_id: string;
  sales_date: string;
  allied_bank_cc_sale: number;
  hbl_cc_sale: number;
  gift_karte: number;
  credit_notes_issue: number;
  gift_vouchers: number;
  cash_sale: number;
  campaign_float_cash: number;
  expenses: number;
  other_income: number;
  deposit: number;
  remarks: string | null;
  total_credit_card_sale: number;
  total_sale: number;
  net_cash_movement: number;
  status: string;
  opening_balance: number | null;
  closing_balance: number | null;
  deleted_at: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function today(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function pkr(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-PK");
}

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? "";
}

async function apiFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  return fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RetailSalesTab({ companyId }: { companyId: string }) {
  const now = today();
  const [selYear, setSelYear]   = useState(now.year);
  const [selMonth, setSelMonth] = useState(now.month);
  const [stores, setStores]     = useState<Store[]>([]);
  const [selStore, setSelStore] = useState<string>("");
  const [rows, setRows]         = useState<SalesRow[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Panels
  const [showOB, setShowOB]         = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Load stores list once
  useEffect(() => {
    (async () => {
      const res = await apiFetch(
        `/api/daily-sales/opening-balances?year=${selYear}&month=${selMonth}`
      );
      if (!res.ok) return;
      const json = await res.json() as { stores: Store[] };
      setStores(json.stores ?? []);
      if (!selStore && json.stores.length > 0) {
        setSelStore(json.stores[0].id);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load rows when filter changes
  const loadRows = useCallback(async () => {
    if (!selStore) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/daily-sales/rows?store_id=${selStore}&year=${selYear}&month=${selMonth}`
      );
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        setError(j.error ?? "Failed to load data");
        return;
      }
      const j = await res.json() as { rows: SalesRow[] };
      setRows(j.rows ?? []);
    } finally {
      setLoading(false);
    }
  }, [selStore, selYear, selMonth]);

  useEffect(() => { void loadRows(); }, [loadRows]);

  // ── Month chip row (last 4 months + current future month) ─────────────────
  const monthChips: { year: number; month: number }[] = [];
  for (let i = 3; i >= 0; i--) {
    let m = now.month - i;
    let y = now.year;
    if (m <= 0) { m += 12; y -= 1; }
    monthChips.push({ year: y, month: m });
  }
  // add next month (future, disabled)
  const nextM = now.month === 12 ? 1 : now.month + 1;
  const nextY = now.month === 12 ? now.year + 1 : now.year;
  monthChips.push({ year: nextY, month: nextM });

  const isSelected = (y: number, m: number) => y === selYear && m === selMonth;
  const isFuture   = (y: number, m: number) =>
    y > now.year || (y === now.year && m > now.month);

  // ── Row state helpers ───────────────────────────────────────────────────────
  function rowClass(r: SalesRow): string {
    if (r.deleted_at) return "deleted";
    if (r.status === "locked") return "locked";
    if (r.status === "edited") return "edited";
    return "submitted";
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const cell: React.CSSProperties = { padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
  const calcCell: React.CSSProperties = { ...cell, background: "#EEF5FF", color: "#3B5EA6", fontWeight: 500 };
  const balCell: React.CSSProperties  = { ...cell, background: "#F0FBF7", fontWeight: 500 };

  return (
    <div>
      {/* ── Filter bar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#64748B", whiteSpace: "nowrap" }}>Month</span>
        <div style={{ display: "flex", gap: 4 }}>
          {monthChips.map(({ year, month }) => {
            const disabled = isFuture(year, month);
            const active = isSelected(year, month);
            return (
              <button
                key={`${year}-${month}`}
                disabled={disabled}
                onClick={() => { setSelYear(year); setSelMonth(month); }}
                style={{
                  padding: "5px 12px",
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: disabled ? "default" : "pointer",
                  border: `1px solid ${active ? "#0F1720" : "#EEF0F3"}`,
                  background: active ? "#0F1720" : "#fff",
                  color: active ? "#fff" : "#64748B",
                  opacity: disabled ? 0.4 : 1,
                  fontFamily: "inherit",
                }}
              >
                {MONTHS[month - 1]}
              </button>
            );
          })}
        </div>

        <div style={{ width: 1, height: 20, background: "#EEF0F3", flexShrink: 0 }} />

        <span style={{ fontSize: 11, fontWeight: 600, color: "#64748B", whiteSpace: "nowrap" }}>Store</span>
        <div style={{ position: "relative" }}>
          <select
            value={selStore}
            onChange={(e) => setSelStore(e.target.value)}
            style={{
              appearance: "none",
              padding: "5px 28px 5px 12px",
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 500,
              border: "1px solid #EEF0F3",
              background: "#fff",
              color: "#64748B",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", fontSize: 10, color: "#64748B" }}>▾</span>
        </div>

        <div style={{ flex: 1 }} />

        {/* HOD controls */}
        <button
          onClick={() => { setShowOB(true); setShowImport(false); }}
          style={{ padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#fff", border: "1px solid #EEF0F3", color: "#0F1720", fontFamily: "inherit" }}
        >
          Opening Balances
        </button>
        <button
          onClick={() => { setShowImport(true); setShowOB(false); }}
          style={{ padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#fff", border: "1px solid #EEF0F3", color: "#0F1720", fontFamily: "inherit" }}
        >
          Import Excel
        </button>
      </div>

      {/* ── Panels ── */}
      {showOB && (
        <OpeningBalancesPanel
          year={selYear}
          month={selMonth}
          onClose={() => setShowOB(false)}
          onSaved={() => { void loadRows(); }}
        />
      )}
      {showImport && (
        <ExcelImportPanel
          stores={stores}
          defaultStoreId={selStore}
          year={selYear}
          month={selMonth}
          onClose={() => setShowImport(false)}
          onImported={() => { void loadRows(); }}
        />
      )}

      {/* ── Row-state legend ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 10, padding: "10px 14px", background: "#fff", border: "1px solid #EEF0F3", borderRadius: 8, fontSize: 11, color: "#64748B", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 11, color: "#0F1720" }}>Row states:</strong>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 12, height: 12, borderRadius: 2, background: "#fff", border: "1px solid #EEF0F3" }} />
          Submitted
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 12, height: 12, borderRadius: 2, background: "#FEF3C7", borderLeft: "3px solid #B4791F" }} />
          Edited
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 12, height: 12, borderRadius: 2, background: "#F8F9FB", border: "1px solid #EEF0F3" }} />
          Locked
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, color: "#B3261E" }}>
          <div style={{ width: 12, height: 12, borderRadius: 2, background: "#FFF5F5", borderLeft: "3px solid #B3261E" }} />
          Soft-deleted (HOD only)
        </div>
        <div style={{ marginLeft: "auto", fontStyle: "italic", color: "#3B5EA6" }}>Blue = calculated (read-only)</div>
        <div style={{ color: "#0F7B5F" }}>Green = balance</div>
      </div>

      {/* ── Main table ── */}
      <div style={{ background: "#fff", border: "1px solid #EEF0F3", borderRadius: 12, overflow: "hidden" }}>
        {loading && (
          <div style={{ padding: "32px", textAlign: "center", color: "#64748B", fontSize: 13 }}>Loading…</div>
        )}
        {error && (
          <div style={{ padding: "16px", color: "#B3261E", fontSize: 13 }}>{error}</div>
        )}
        {!loading && !error && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                {/* Column group header */}
                <tr style={{ borderBottom: "1px solid #EEF0F3" }}>
                  <th rowSpan={2} style={{ background: "#F4F6F9", padding: "5px 14px", fontSize: 10, fontWeight: 600, color: "#64748B", textAlign: "left", position: "sticky", left: 0, zIndex: 3, verticalAlign: "middle", whiteSpace: "nowrap" }}>Date</th>
                  <th colSpan={5} style={{ background: "#F4F6F9", padding: "5px 10px", fontSize: 10, fontWeight: 600, color: "#64748B", textAlign: "center", borderRight: "1px solid #EEF0F3", whiteSpace: "nowrap" }}>Cash Movement</th>
                  <th colSpan={2} style={{ background: "#F4F6F9", padding: "5px 10px", fontSize: 10, fontWeight: 600, color: "#64748B", textAlign: "center", borderRight: "1px solid #EEF0F3", whiteSpace: "nowrap" }}>Card Sales</th>
                  <th colSpan={3} style={{ background: "#F4F6F9", padding: "5px 10px", fontSize: 10, fontWeight: 600, color: "#64748B", textAlign: "center", borderRight: "1px solid #EEF0F3", whiteSpace: "nowrap" }}>Other Sales</th>
                  <th colSpan={3} style={{ background: "#EEF5FF", padding: "5px 10px", fontSize: 10, fontWeight: 600, color: "#3B5EA6", textAlign: "center", borderRight: "1px solid #EEF0F3", fontStyle: "italic", whiteSpace: "nowrap" }}>Calculated (read-only)</th>
                  <th colSpan={2} style={{ background: "#F0FBF7", padding: "5px 10px", fontSize: 10, fontWeight: 600, color: "#0F7B5F", textAlign: "center", borderRight: "1px solid #EEF0F3", whiteSpace: "nowrap" }}>Balance</th>
                  <th rowSpan={2} style={{ background: "#F4F6F9", padding: "5px 10px", fontSize: 10, fontWeight: 600, color: "#64748B", textAlign: "left", whiteSpace: "nowrap", verticalAlign: "middle" }}>Remarks</th>
                  <th rowSpan={2} style={{ background: "#F4F6F9", padding: "5px 10px", fontSize: 10, fontWeight: 600, color: "#64748B", textAlign: "center", whiteSpace: "nowrap", verticalAlign: "middle" }}>Status</th>
                  <th rowSpan={2} style={{ background: "#F4F6F9", padding: "5px 10px", fontSize: 10, fontWeight: 600, color: "#64748B", textAlign: "center", whiteSpace: "nowrap", verticalAlign: "middle" }}>Actions</th>
                </tr>
                {/* Sub-header */}
                <tr style={{ borderBottom: "1px solid #EEF0F3" }}>
                  {/* Cash Movement */}
                  {["Cash Sale","Float","Expenses","Other Inc","Deposit"].map((h) => (
                    <th key={h} style={{ background: "#F8F9FB", padding: "7px 10px", fontSize: 11, fontWeight: 600, color: "#64748B", textAlign: "right", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                  {/* Card */}
                  {["Allied CC","HBL CC"].map((h) => (
                    <th key={h} style={{ background: "#F8F9FB", padding: "7px 10px", fontSize: 11, fontWeight: 600, color: "#64748B", textAlign: "right", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                  {/* Other */}
                  {["Gift Karte","Vouchers","Cr Notes"].map((h) => (
                    <th key={h} style={{ background: "#F8F9FB", padding: "7px 10px", fontSize: 11, fontWeight: 600, color: "#64748B", textAlign: "right", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                  {/* Calculated */}
                  {["Total CC","Total Sale","Net Cash"].map((h) => (
                    <th key={h} style={{ background: "#EEF5FF", padding: "7px 10px", fontSize: 11, fontWeight: 600, color: "#3B5EA6", textAlign: "right", whiteSpace: "nowrap", fontStyle: "italic" }}>{h}</th>
                  ))}
                  {/* Balance */}
                  {["Opening","Closing"].map((h) => (
                    <th key={h} style={{ background: "#F0FBF7", padding: "7px 10px", fontSize: 11, fontWeight: 600, color: "#0F7B5F", textAlign: "right", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={20} style={{ padding: "32px", textAlign: "center", color: "#64748B" }}>
                      No entries for {MONTHS[selMonth - 1]} {selYear}
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const state = rowClass(r);
                  const isLocked  = state === "locked";
                  const isDeleted = state === "deleted";
                  const isEdited  = state === "edited";

                  const rowBg = isLocked ? "#F8F9FB" : isDeleted ? "#FFF5F5" : isEdited ? "#FFFDF5" : "#fff";
                  const rowColor = isLocked ? "#94A3B8" : isDeleted ? "#94A3B8" : "#0F1720";
                  const borderLeft = isEdited ? "3px solid #B4791F" : isDeleted ? "3px solid #B3261E" : undefined;
                  const tdStyle: React.CSSProperties = { ...cell, background: rowBg, color: rowColor, textDecoration: isDeleted ? "line-through" : undefined };
                  const tdCalc: React.CSSProperties = { ...calcCell, background: isLocked ? "#F0F2F5" : isEdited ? "#FFF8E6" : isDeleted ? "#FFEEED" : "#EEF5FF", color: isLocked ? "#94A3B8" : "#3B5EA6" };
                  const tdBal: React.CSSProperties  = { ...balCell, background: isLocked ? "#F0F4F2" : isEdited ? "#FFFDF0" : isDeleted ? "#F5FBF8" : "#F0FBF7", color: isLocked ? "#94A3B8" : "#0F1720" };

                  const pillText = isDeleted ? "Deleted" : isLocked ? "Locked" : isEdited ? "Edited" : "Submitted";
                  const pillStyle: React.CSSProperties = {
                    display: "inline-flex", alignItems: "center", padding: "2px 8px",
                    borderRadius: 10, fontSize: 10, fontWeight: 600, whiteSpace: "nowrap",
                    background: isDeleted ? "#FDECEA" : isLocked ? "#E8E8EB" : isEdited ? "#FEF3C7" : "#EEF0F3",
                    color: isDeleted ? "#B3261E" : isLocked ? "#64748B" : isEdited ? "#B4791F" : "#64748B",
                  };

                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #EEF0F3", borderLeft }}>
                      <td style={{ ...tdStyle, textAlign: "left", paddingLeft: 14, fontWeight: 600, position: "sticky", left: 0, zIndex: 1 }}>
                        {formatDateUK(r.sales_date)}
                        {isLocked && <span style={{ fontSize: 9, fontWeight: 600, background: "#E8E8EB", color: "#64748B", padding: "1px 5px", borderRadius: 4, marginLeft: 4 }}>🔒</span>}
                      </td>
                      <td style={tdStyle}>{pkr(r.cash_sale)}</td>
                      <td style={tdStyle}>{pkr(r.campaign_float_cash)}</td>
                      <td style={tdStyle}>{pkr(r.expenses)}</td>
                      <td style={tdStyle}>{pkr(r.other_income)}</td>
                      <td style={tdStyle}>{pkr(r.deposit)}</td>
                      <td style={tdStyle}>{pkr(r.allied_bank_cc_sale)}</td>
                      <td style={tdStyle}>{pkr(r.hbl_cc_sale)}</td>
                      <td style={tdStyle}>{pkr(r.gift_karte)}</td>
                      <td style={tdStyle}>{pkr(r.gift_vouchers)}</td>
                      <td style={tdStyle}>{pkr(r.credit_notes_issue)}</td>
                      <td style={tdCalc}>{pkr(r.total_credit_card_sale)}</td>
                      <td style={tdCalc}>{pkr(r.total_sale)}</td>
                      <td style={tdCalc}>{pkr(r.net_cash_movement)}</td>
                      <td style={tdBal}>{pkr(r.opening_balance)}</td>
                      <td style={tdBal}>{pkr(r.closing_balance)}</td>
                      <td style={{ ...tdStyle, textAlign: "left", color: "#64748B", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.remarks || "—"}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <span style={pillStyle}>{pillText}</span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center", whiteSpace: "nowrap" }}>
                        {isDeleted ? (
                          <button style={{ padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: "pointer", border: "1px solid #C8EAE2", background: "#fff", color: "#0F7B5F", fontFamily: "inherit" }}>
                            Restore
                          </button>
                        ) : isLocked ? (
                          <button disabled style={{ padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: "not-allowed", border: "1px solid #EEF0F3", background: "#fff", color: "#94A3B8", fontFamily: "inherit", opacity: 0.4 }}>
                            Edit
                          </button>
                        ) : (
                          <>
                            <button style={{ padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: "pointer", border: "1px solid #EEF0F3", background: "#fff", color: "#0F1720", fontFamily: "inherit" }}>
                              Edit
                            </button>
                            <button style={{ marginLeft: 4, padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: "pointer", border: "1px solid #FDECEA", background: "#fff", color: "#B3261E", fontFamily: "inherit" }}>
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr style={{ borderTop: "2px solid #EEF0F3" }}>
                    <td style={{ padding: "8px 14px", fontWeight: 700, color: "#0F1720", background: "#F8F9FB", textAlign: "left", fontSize: 12 }}>Totals</td>
                    <td style={{ ...cell, background: "#F8F9FB", fontWeight: 700 }}>{pkr(rows.reduce((s,r) => s + r.cash_sale, 0))}</td>
                    <td style={{ ...cell, background: "#F8F9FB", fontWeight: 700 }}>{pkr(rows.reduce((s,r) => s + r.campaign_float_cash, 0))}</td>
                    <td style={{ ...cell, background: "#F8F9FB", fontWeight: 700 }}>{pkr(rows.reduce((s,r) => s + r.expenses, 0))}</td>
                    <td style={{ ...cell, background: "#F8F9FB", fontWeight: 700 }}>{pkr(rows.reduce((s,r) => s + r.other_income, 0))}</td>
                    <td style={{ ...cell, background: "#F8F9FB", fontWeight: 700 }}>{pkr(rows.reduce((s,r) => s + r.deposit, 0))}</td>
                    <td style={{ ...cell, background: "#F8F9FB", fontWeight: 700 }}>{pkr(rows.reduce((s,r) => s + r.allied_bank_cc_sale, 0))}</td>
                    <td style={{ ...cell, background: "#F8F9FB", fontWeight: 700 }}>{pkr(rows.reduce((s,r) => s + r.hbl_cc_sale, 0))}</td>
                    <td style={{ ...cell, background: "#F8F9FB", fontWeight: 700 }}>{pkr(rows.reduce((s,r) => s + r.gift_karte, 0))}</td>
                    <td style={{ ...cell, background: "#F8F9FB", fontWeight: 700 }}>{pkr(rows.reduce((s,r) => s + r.gift_vouchers, 0))}</td>
                    <td style={{ ...cell, background: "#F8F9FB", fontWeight: 700 }}>{pkr(rows.reduce((s,r) => s + r.credit_notes_issue, 0))}</td>
                    <td style={{ ...calcCell, background: "#E8F0FF", fontWeight: 700 }}>{pkr(rows.reduce((s,r) => s + r.total_credit_card_sale, 0))}</td>
                    <td style={{ ...calcCell, background: "#E8F0FF", fontWeight: 700 }}>{pkr(rows.reduce((s,r) => s + r.total_sale, 0))}</td>
                    <td style={{ ...calcCell, background: "#E8F0FF", fontWeight: 700 }}>{pkr(rows.reduce((s,r) => s + r.net_cash_movement, 0))}</td>
                    <td style={{ ...balCell, background: "#E5F7F2", fontWeight: 700 }}>
                      {/* Opening = first row's opening_balance */}
                      {pkr(rows.find(r => r.opening_balance != null)?.opening_balance ?? null)}
                    </td>
                    <td style={{ ...balCell, background: "#E5F7F2", fontWeight: 700 }}>
                      {/* Closing = last row's closing_balance */}
                      {pkr([...rows].reverse().find(r => r.closing_balance != null)?.closing_balance ?? null)}
                    </td>
                    <td colSpan={3} style={{ background: "#F8F9FB" }} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
