"use client";

import React, { useEffect, useState, useCallback } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase, loadMyPermissions } from "../lib/supabase";
import { COLOURS, SectionTitle, PageHeader, useConfirm } from "../lib/SharedUI";
import DateInput from "../lib/DateInput";
import { useMobile } from "../lib/useMobile";
import { useRequireCapability } from "../lib/useRouteGuard";
import { canEditInvestments, type UserCtx, type PermOverrides } from "../lib/permissions";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";

const { NAVY, SLATE, BORDER, GREEN, RED, AMBER } = COLOURS;

type Holding = {
  id: string;
  ticker: string;
  company_name: string | null;
  quantity: number;
  buy_price: number;
  buy_date: string | null;
  target_price: number | null;
  notes: string | null;
};

type PriceRow = {
  ticker: string;
  price: number;
  as_of_date: string;
  source: string;
};

type HistoryRow = {
  ticker: string;
  price: number;
  as_of_date: string;
};

type PortfolioStock = {
  ticker: string;
  company: string;
  totalQty: number;
  avgCost: number;
  totalCost: number;
  currentPrice: number | null;
  currentValue: number | null;
  gainLoss: number | null;
  gainLossPct: number | null;
  priceDate: string | null;
  priceSource: string | null;
  targetPrice: number | null;
  lots: Holding[];
};

function fmtRs(n: number) {
  return `${n < 0 ? "-" : ""}Rs ${Math.abs(n).toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
}

function fmtPrice(n: number) {
  return `Rs ${n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}-${m}-${y}`;
}

function glColor(n: number | null) {
  if (n === null) return SLATE;
  if (n > 0) return GREEN;
  if (n < 0) return RED;
  return SLATE;
}

function ragColor(pct: number | null) {
  if (pct === null) return SLATE;
  if (pct >= 5) return GREEN;
  if (pct >= -5) return AMBER;
  return RED;
}

export default function InvestmentsPage() {
  const { checking } = useRequireCapability("investments");
  const isMobile = useMobile();
  const dlg = useConfirm();

  const [canEdit, setCanEdit] = useState(false);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [currentPrices, setCurrentPrices] = useState<PriceRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [updateResult, setUpdateResult] = useState<string | null>(null);
  const [lastPriceUpdate, setLastPriceUpdate] = useState<string | null>(null);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [manualPriceModal, setManualPriceModal] = useState<string | null>(null);
  const [manualPrice, setManualPrice] = useState("");
  const [chartRange, setChartRange] = useState<"1M" | "3M" | "6M" | "ALL">("3M");

  const [formTicker, setFormTicker] = useState("");
  const [formCompany, setFormCompany] = useState("");
  const [formQty, setFormQty] = useState("");
  const [formBuyPrice, setFormBuyPrice] = useState("");
  const [formBuyDate, setFormBuyDate] = useState("");
  const [formTarget, setFormTarget] = useState("");
  const [formNotes, setFormNotes] = useState("");

  const load = useCallback(async () => {
    const [hRes, pRes, histRes, latestRes] = await Promise.all([
      supabase.from("holdings").select("*").order("ticker"),
      supabase.from("current_prices").select("*"),
      supabase.from("price_history").select("ticker, price, as_of_date").order("as_of_date", { ascending: true }),
      supabase.from("price_history").select("created_at").order("created_at", { ascending: false }).limit(1).single(),
    ]);
    setHoldings(hRes.data || []);
    setCurrentPrices(pRes.data || []);
    setHistory(histRes.data || []);
    setLastPriceUpdate(latestRes.data?.created_at ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (checking) return;
    load();
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email;
      if (!email) return;
      const { data: memberData } = await supabase.from("members").select("role, department, company").eq("email", email).single();
      let overrides: PermOverrides | null = null;
      const p = await loadMyPermissions();
      if (p) overrides = p as PermOverrides;
      const ctx: UserCtx = { email, role: memberData?.role ?? null, department: memberData?.department ?? null, company: memberData?.company ?? null, overrides };
      setCanEdit(canEditInvestments(ctx));
    })();
  }, [checking, load]);

  const stocks: PortfolioStock[] = (() => {
    const map = new Map<string, PortfolioStock>();
    for (const h of holdings) {
      if (!map.has(h.ticker)) {
        const cp = currentPrices.find((p) => p.ticker === h.ticker);
        map.set(h.ticker, {
          ticker: h.ticker,
          company: h.company_name || h.ticker,
          totalQty: 0,
          avgCost: 0,
          totalCost: 0,
          currentPrice: cp?.price ?? null,
          currentValue: null,
          gainLoss: null,
          gainLossPct: null,
          priceDate: cp?.as_of_date ?? null,
          priceSource: cp?.source ?? null,
          targetPrice: h.target_price,
          lots: [],
        });
      }
      const s = map.get(h.ticker)!;
      s.totalQty += h.quantity;
      s.totalCost += h.quantity * h.buy_price;
      if (h.target_price && (!s.targetPrice || h.target_price > s.targetPrice)) {
        s.targetPrice = h.target_price;
      }
      s.lots.push(h);
    }
    for (const s of map.values()) {
      s.avgCost = s.totalQty > 0 ? s.totalCost / s.totalQty : 0;
      if (s.currentPrice !== null) {
        s.currentValue = s.totalQty * s.currentPrice;
        s.gainLoss = s.currentValue - s.totalCost;
        s.gainLossPct = s.totalCost > 0 ? (s.gainLoss / s.totalCost) * 100 : 0;
      }
    }
    return Array.from(map.values()).sort((a, b) => a.ticker.localeCompare(b.ticker));
  })();

  const totalCost = stocks.reduce((s, st) => s + st.totalCost, 0);
  const totalValue = stocks.reduce((s, st) => s + (st.currentValue ?? 0), 0);
  const totalGL = totalValue - totalCost;
  const totalGLPct = totalCost > 0 ? (totalGL / totalCost) * 100 : 0;
  const losers = stocks.filter((s) => s.gainLossPct !== null && s.gainLossPct < -5);
  const winners = stocks.filter((s) => s.gainLossPct !== null && s.gainLossPct > 20);

  async function handleRefreshPrices() {
    if (!canEdit) return;
    setUpdating(true);
    setUpdateResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/investments/update-prices", {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const json = await res.json();
      setUpdateResult(`Updated ${json.succeeded}/${json.total} prices. ${json.failed > 0 ? `${json.failed} failed.` : ""}`);
      await load();
    } catch {
      setUpdateResult("Failed to update prices.");
    }
    setUpdating(false);
  }

  async function handleManualPrice(ticker: string) {
    if (!canEdit) return;
    const price = parseFloat(manualPrice);
    if (isNaN(price) || price <= 0) return;
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from("price_history").upsert(
      { ticker, price, as_of_date: today, source: "manual" },
      { onConflict: "ticker,as_of_date" },
    );
    setManualPriceModal(null);
    setManualPrice("");
    await load();
  }

  async function handleAddHolding(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    const payload = {
      ticker: formTicker.toUpperCase().trim(),
      company_name: formCompany.trim() || null,
      quantity: parseFloat(formQty),
      buy_price: parseFloat(formBuyPrice),
      buy_date: formBuyDate || null,
      target_price: formTarget ? parseFloat(formTarget) : null,
      notes: formNotes.trim() || null,
    };
    if (editingId) {
      await supabase.from("holdings").update(payload).eq("id", editingId);
    } else {
      await supabase.from("holdings").insert(payload);
    }
    resetForm();
    await load();
  }

  async function handleDelete(id: string) {
    if (!canEdit) return;
    if (!await dlg.confirm("Delete this holding?", true)) return;
    await supabase.from("holdings").delete().eq("id", id);
    await load();
  }

  function startEdit(h: Holding) {
    setEditingId(h.id);
    setFormTicker(h.ticker);
    setFormCompany(h.company_name || "");
    setFormQty(String(h.quantity));
    setFormBuyPrice(String(h.buy_price));
    setFormBuyDate(h.buy_date || "");
    setFormTarget(h.target_price ? String(h.target_price) : "");
    setFormNotes(h.notes || "");
    setShowAddForm(true);
  }

  function resetForm() {
    setShowAddForm(false);
    setEditingId(null);
    setFormTicker("");
    setFormCompany("");
    setFormQty("");
    setFormBuyPrice("");
    setFormBuyDate("");
    setFormTarget("");
    setFormNotes("");
  }

  const chartTicker = selectedTicker || stocks[0]?.ticker;
  const chartData = (() => {
    if (!chartTicker) return [];
    const now = new Date();
    let cutoff = new Date();
    if (chartRange === "1M") cutoff.setMonth(now.getMonth() - 1);
    else if (chartRange === "3M") cutoff.setMonth(now.getMonth() - 3);
    else if (chartRange === "6M") cutoff.setMonth(now.getMonth() - 6);
    else cutoff = new Date(2000, 0, 1);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return history
      .filter((h) => h.ticker === chartTicker && h.as_of_date >= cutoffStr)
      .map((h) => ({ date: h.as_of_date.slice(5), price: h.price }));
  })();

  const glBarData = stocks
    .filter((s) => s.gainLossPct !== null)
    .sort((a, b) => (b.gainLossPct ?? 0) - (a.gainLossPct ?? 0))
    .map((s) => ({
      ticker: s.ticker,
      pct: Math.round((s.gainLossPct ?? 0) * 100) / 100,
      fill: (s.gainLossPct ?? 0) >= 0 ? GREEN : RED,
    }));

  if (checking) return null;

  const priceDate = currentPrices[0]?.as_of_date;

  return (
    <AuthWrapper>
      {dlg.element}
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%" }}>
        <PageHeader />

        {loading ? (
          <p style={{ color: "var(--text-secondary, #64748b)" }}>Loading portfolio...</p>
        ) : stocks.length === 0 && !showAddForm ? (
          <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "12px", padding: "40px 20px", backgroundColor: "var(--bg-card, #ffffff)", textAlign: "center" }}>
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>📊</div>
            <div style={{ fontSize: "18px", fontWeight: 700, color: NAVY, marginBottom: "6px" }}>No Holdings Yet</div>
            <div style={{ fontSize: "15px", color: SLATE, marginBottom: "16px" }}>
              {canEdit ? "Add your first stock holding to start tracking your portfolio." : "No holdings have been added yet."}
            </div>
            {canEdit && (
              <button onClick={() => { resetForm(); setShowAddForm(true); }} style={{ backgroundColor: GREEN, color: "white", border: "none", borderRadius: "8px", padding: "10px 24px", fontSize: "16px", fontWeight: 700, cursor: "pointer" }}>
                + Add First Holding
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Portfolio Summary Cards */}
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fit, minmax(100px, 1fr))",
              gap: "12px", marginBottom: "16px",
            }}>
              <SummaryCard label="Total Invested" value={fmtRs(totalCost)} color={NAVY} />
              <SummaryCard label="Current Value" value={fmtRs(totalValue)} color={COLOURS.BLUE} />
              <SummaryCard
                label="Total Gain/Loss"
                value={fmtRs(totalGL)}
                sub={fmtPct(totalGLPct)}
                color={glColor(totalGL)}
              />
              <SummaryCard label="Stocks" value={String(stocks.length)} sub={priceDate ? `Prices: ${fmtDate(priceDate)}` : "No prices"} color={SLATE} />
            </div>

            {/* Last updated */}
            {lastPriceUpdate && (
              <div style={{ fontSize: "14px", color: "var(--text-secondary, #64748b)", marginBottom: "12px", textAlign: "right" }}>
                Prices last updated: {new Date(lastPriceUpdate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} at {new Date(lastPriceUpdate).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
              </div>
            )}

            {/* Alerts */}
            {losers.length > 0 && (
              <div style={{
                border: "1px solid #fecaca", borderLeft: "4px solid " + RED,
                borderRadius: "8px", backgroundColor: "#fef2f2",
                padding: "10px 16px", marginBottom: "14px",
              }}>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "#991b1b", marginBottom: "4px" }}>
                  {losers.length} stock{losers.length > 1 ? "s" : ""} down more than 5%
                </div>
                {losers.map((s) => (
                  <div key={s.ticker} style={{ fontSize: "15px", color: "#991b1b", lineHeight: 1.8 }}>
                    <span style={{ fontWeight: 700 }}>{s.ticker}</span> ({s.company}) — {fmtPct(s.gainLossPct!)} ({fmtRs(s.gainLoss!)})
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            {canEdit && (
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "16px" }}>
                <button onClick={handleRefreshPrices} disabled={updating} style={btnStyle}>
                  {updating ? "Updating..." : "Refresh Prices from PSX"}
                </button>
                <button onClick={() => { resetForm(); setShowAddForm(true); }} style={{ ...btnStyle, backgroundColor: GREEN }}>
                  + Add Holding
                </button>
                {updateResult && (
                  <span style={{ fontSize: "15px", color: "var(--text-secondary, #64748b)", alignSelf: "center" }}>{updateResult}</span>
                )}
              </div>
            )}

            {/* Add/Edit Form */}
            {canEdit && showAddForm && (
              <div style={{
                border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "10px",
                backgroundColor: "var(--bg-card, #fff)", padding: "16px", marginBottom: "16px",
              }}>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary, #1e293b)", marginBottom: "12px" }}>
                  {editingId ? "Edit Holding" : "Add New Holding"}
                </div>
                <form onSubmit={handleAddHolding} style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr" : "repeat(4, 1fr)",
                  gap: "10px",
                }}>
                  <input placeholder="Ticker (e.g. HBL)" value={formTicker} onChange={(e) => setFormTicker(e.target.value)} required style={inputStyle} />
                  <input placeholder="Company Name" value={formCompany} onChange={(e) => setFormCompany(e.target.value)} style={inputStyle} />
                  <input placeholder="Quantity" type="number" step="1" value={formQty} onChange={(e) => setFormQty(e.target.value)} required style={inputStyle} />
                  <input placeholder="Buy Price (Rs)" type="number" step="0.01" value={formBuyPrice} onChange={(e) => setFormBuyPrice(e.target.value)} required style={inputStyle} />
                  <DateInput placeholder="Buy Date" value={formBuyDate} onChange={(e) => setFormBuyDate(e.target.value)} style={inputStyle} />
                  <input placeholder="Target Price (Rs)" type="number" step="0.01" value={formTarget} onChange={(e) => setFormTarget(e.target.value)} style={inputStyle} />
                  <input placeholder="Notes" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} style={inputStyle} />
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button type="submit" style={{ ...btnStyle, flex: 1 }}>{editingId ? "Save" : "Add"}</button>
                    <button type="button" onClick={resetForm} style={{ ...btnStyle, backgroundColor: SLATE, flex: 1 }}>Cancel</button>
                  </div>
                </form>
              </div>
            )}

            {/* Manual Price Modal */}
            {canEdit && manualPriceModal && (
              <div style={{
                border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "10px",
                backgroundColor: "var(--bg-card, #fff)", padding: "16px", marginBottom: "16px",
                display: "flex", gap: "10px", alignItems: "center",
              }}>
                <span style={{ fontWeight: 700, color: "var(--text-primary, #1e293b)" }}>{manualPriceModal}:</span>
                <input
                  type="number" step="0.01" placeholder="Price (Rs)"
                  value={manualPrice} onChange={(e) => setManualPrice(e.target.value)}
                  style={{ ...inputStyle, width: "140px" }}
                />
                <button onClick={() => handleManualPrice(manualPriceModal)} style={btnStyle}>Save</button>
                <button onClick={() => { setManualPriceModal(null); setManualPrice(""); }} style={{ ...btnStyle, backgroundColor: SLATE }}>Cancel</button>
              </div>
            )}

            {/* Holdings Table */}
            <SectionTitle title="Holdings" />
            <div style={{ overflowX: "auto", marginBottom: "20px" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "900px" }}>
                <thead>
                  <tr style={{ backgroundColor: "var(--bg-card-hover, #f8fafc)" }}>
                    <Th>Ticker</Th>
                    <Th>Company</Th>
                    <Th align="right">Qty</Th>
                    <Th align="right">Avg Cost</Th>
                    <Th align="right">Current</Th>
                    <Th align="right">Value</Th>
                    <Th align="right">Gain/Loss</Th>
                    <Th align="right">%</Th>
                    <Th align="right">Target</Th>
                    <Th>Updated</Th>
                    {canEdit && <Th>Actions</Th>}
                  </tr>
                </thead>
                <tbody>
                  {stocks.map((s) => (
                    <tr key={s.ticker} style={{ borderBottom: "1px solid var(--border-light, #f1f5f9)" }}
                      onClick={() => setSelectedTicker(s.ticker)}
                    >
                      <td style={{ ...td, fontWeight: 700, color: "var(--text-primary, #1e293b)", cursor: "pointer" }}>{s.ticker}</td>
                      <td style={{ ...td, color: "var(--text-secondary, #64748b)", fontSize: "15px" }}>{s.company}</td>
                      <td style={{ ...td, textAlign: "right" }}>{s.totalQty.toLocaleString()}</td>
                      <td style={{ ...td, textAlign: "right" }}>{fmtPrice(s.avgCost)}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>
                        {s.currentPrice !== null ? fmtPrice(s.currentPrice) : "—"}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>
                        {s.currentValue !== null ? fmtRs(s.currentValue) : "—"}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, color: glColor(s.gainLoss) }}>
                        {s.gainLoss !== null ? fmtRs(s.gainLoss) : "—"}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {s.gainLossPct !== null ? (
                          <span style={{
                            fontSize: "12px", fontWeight: 700,
                            padding: "2px 6px", borderRadius: "6px",
                            color: "white", backgroundColor: ragColor(s.gainLossPct),
                          }}>
                            {fmtPct(s.gainLossPct)}
                          </span>
                        ) : "—"}
                      </td>
                      <td style={{ ...td, textAlign: "right", color: "var(--text-secondary, #64748b)" }}>
                        {s.targetPrice ? fmtPrice(s.targetPrice) : "—"}
                      </td>
                      <td style={{ ...td, color: "var(--text-secondary, #64748b)", fontSize: "14px" }}>
                        {s.priceDate ? fmtDate(s.priceDate) : "—"}
                        {s.priceSource ? ` (${s.priceSource})` : ""}
                      </td>
                      {canEdit && (
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          <button onClick={(e) => { e.stopPropagation(); setManualPriceModal(s.ticker); }} style={miniBtn} title="Set price">
                            Rs
                          </button>
                          {s.lots.length === 1 && (
                            <>
                              <button onClick={(e) => { e.stopPropagation(); startEdit(s.lots[0]); }} style={miniBtn} title="Edit">
                                ✏️
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); handleDelete(s.lots[0].id); }} style={{ ...miniBtn, color: RED }} title="Delete">
                                🗑️
                              </button>
                            </>
                          )}
                          {s.lots.length > 1 && (
                            <span style={{ fontSize: "13px", color: "var(--text-secondary, #64748b)" }}>{s.lots.length} lots</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: `2px solid ${NAVY}`, fontWeight: 700 }}>
                    <td style={td} colSpan={5}>TOTAL</td>
                    <td style={{ ...td, textAlign: "right" }}>{fmtRs(totalValue)}</td>
                    <td style={{ ...td, textAlign: "right", color: glColor(totalGL) }}>{fmtRs(totalGL)}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <span style={{
                        fontSize: "12px", fontWeight: 700,
                        padding: "2px 6px", borderRadius: "6px",
                        color: "white", backgroundColor: ragColor(totalGLPct),
                      }}>
                        {fmtPct(totalGLPct)}
                      </span>
                    </td>
                    <td style={td} colSpan={canEdit ? 3 : 2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Charts Section */}
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
              gap: "16px", marginBottom: "20px",
            }}>
              {/* Price Chart */}
              <div style={{
                border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "10px",
                backgroundColor: "var(--bg-card, #fff)", padding: "16px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary, #1e293b)" }}>
                    {chartTicker || "—"} Price History
                  </div>
                  <div style={{ display: "flex", gap: "4px" }}>
                    {(["1M", "3M", "6M", "ALL"] as const).map((r) => (
                      <button key={r} onClick={() => setChartRange(r)} style={{
                        padding: "2px 8px", fontSize: "12px", fontWeight: 600,
                        border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "4px", cursor: "pointer",
                        backgroundColor: chartRange === r ? NAVY : "transparent",
                        color: chartRange === r ? "white" : "var(--text-secondary, #64748b)",
                      }}>{r}</button>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "10px" }}>
                  {stocks.map((s) => (
                    <button key={s.ticker} onClick={() => setSelectedTicker(s.ticker)} style={{
                      padding: "2px 8px", fontSize: "11px", fontWeight: 600,
                      border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "4px", cursor: "pointer",
                      backgroundColor: chartTicker === s.ticker ? NAVY : "transparent",
                      color: chartTicker === s.ticker ? "white" : "var(--text-secondary, #64748b)",
                    }}>{s.ticker}</button>
                  ))}
                </div>
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: SLATE }} />
                      <YAxis tick={{ fontSize: 11, fill: SLATE }} domain={["auto", "auto"]} />
                      <Tooltip formatter={(v) => [fmtPrice(Number(v)), "Price"]} />
                      <Line type="monotone" dataKey="price" stroke={COLOURS.BLUE} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p style={{ color: "var(--text-secondary, #64748b)", fontSize: "15px", textAlign: "center", padding: "40px 0" }}>No price history for {chartTicker}</p>
                )}
              </div>

              {/* Gain/Loss Bar Chart */}
              <div style={{
                border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "10px",
                backgroundColor: "var(--bg-card, #fff)", padding: "16px",
              }}>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary, #1e293b)", marginBottom: "12px" }}>
                  Gain/Loss by Stock (%)
                </div>
                {glBarData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={Math.max(220, glBarData.length * 22)}>
                    <BarChart data={glBarData} layout="vertical" margin={{ left: 50 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: SLATE }} />
                      <YAxis type="category" dataKey="ticker" tick={{ fontSize: 11, fill: NAVY, fontWeight: 600 }} width={50} />
                      <Tooltip formatter={(v) => [`${Number(v).toFixed(2)}%`, "Gain/Loss"]} />
                      <Bar dataKey="pct" radius={[0, 4, 4, 0]}>
                        {glBarData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p style={{ color: "var(--text-secondary, #64748b)", fontSize: "15px", textAlign: "center", padding: "40px 0" }}>No data</p>
                )}
              </div>
            </div>

            {/* Winners section */}
            {winners.length > 0 && (
              <>
                <SectionTitle title="Top Performers (20%+)" />
                <div style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fill, minmax(200px, 1fr))",
                  gap: "10px", marginBottom: "16px",
                }}>
                  {winners.sort((a, b) => (b.gainLossPct ?? 0) - (a.gainLossPct ?? 0)).map((s) => (
                    <div key={s.ticker} style={{
                      border: "1px solid var(--border-color, #e2e8f0)", borderTop: `3px solid ${GREEN}`,
                      borderRadius: "8px", padding: "10px 12px",
                      backgroundColor: "var(--bg-card, #fff)",
                    }}>
                      <div style={{ fontWeight: 700, color: "var(--text-primary, #1e293b)", fontSize: "15px" }}>{s.ticker}</div>
                      <div style={{ fontSize: "14px", color: "var(--text-secondary, #64748b)" }}>{s.company}</div>
                      <div style={{ fontWeight: 700, color: GREEN, fontSize: "18px", marginTop: "4px" }}>
                        {fmtPct(s.gainLossPct!)}
                      </div>
                      <div style={{ fontSize: "12px", color: GREEN }}>{fmtRs(s.gainLoss!)}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </AuthWrapper>
  );
}

function SummaryCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{
      border: "1px solid var(--border-color, #e2e8f0)", borderTop: `3px solid ${color}`,
      borderRadius: "8px", padding: "10px 14px",
      backgroundColor: "var(--bg-card, #fff)",
    }}>
      <div style={{ color: "var(--text-secondary, #64748b)", fontSize: "15px", marginBottom: "2px" }}>{label}</div>
      <div style={{ fontSize: "20px", fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: "15px", color: "var(--text-secondary, #64748b)", marginTop: "2px" }}>{sub}</div>}
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th style={{
      textAlign: align || "left", borderBottom: "1px solid var(--border-color, #e2e8f0)",
      padding: "6px 10px", fontSize: "14px", color: "var(--text-secondary, #64748b)", fontWeight: 700,
      whiteSpace: "nowrap",
    }}>{children}</th>
  );
}

const td: React.CSSProperties = {
  padding: "7px 10px", fontSize: "15px",
};

const inputStyle: React.CSSProperties = {
  padding: "8px 10px", border: "1px solid var(--border-color, #e2e8f0)",
  borderRadius: "6px", fontSize: "16px", boxSizing: "border-box",
};

const btnStyle: React.CSSProperties = {
  backgroundColor: NAVY, color: "white", border: "none",
  borderRadius: "6px", padding: "8px 16px", fontSize: "15px",
  fontWeight: 700, cursor: "pointer",
};

const miniBtn: React.CSSProperties = {
  background: "transparent", border: "none", cursor: "pointer",
  fontSize: "15px", padding: "2px 4px",
};
