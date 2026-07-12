"use client";

import React, { useEffect, useState, useCallback } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase, loadMyPermissions, authFetch } from "../lib/supabase";
import { COLOURS, RADII, SectionTitle, PageHeader, useConfirm } from "../lib/SharedUI";
import DateInput from "../lib/DateInput";
import { useMobile } from "../lib/useMobile";
import { useRequireCapability } from "../lib/useRouteGuard";
import { canEditInvestments, canRefreshInvestmentPrices, type UserCtx, type PermOverrides } from "../lib/permissions";
import { formatDateUK } from "../lib/dateUtils";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";

const { NAVY, SLATE, BORDER, GREEN, RED, AMBER, BLUE, HAIRLINE } = COLOURS;

type PensionSummary = {
  total_value_gbp: number;
  net_gain_gbp: number;
  return_pct: number;
  contributed_gbp: number;
  fees_gbp: number;
  fund_count: number;
  last_price_date: string | null;
};

type PensionFundBreakdown = {
  fund_name: string;
  isin: string;
  units_held: number;
  price_gbp: number;
  value_gbp: number;
  allocation_pct: number;
  price_date: string | null;
  value_pkr?: number;
  risk_rating: number | null;
  ongoing_charge_pct: number | null;
  benchmark: string | null;
  return_1m_pct: number | null;
  return_3m_pct: number | null;
  return_6m_pct: number | null;
  return_1y_pct: number | null;
  return_5y_pct: number | null;
  factsheet_date: string | null;
  factsheet_notes: string | null;
};

type DividendRow = {
  id: string;
  ticker: string;
  dividend_per_share: number;
  ex_dividend_date: string;
  payment_date: string | null;
  announced_date: string | null;
  status: string;
  source: string;
  confirmed: boolean;
  notes: string | null;
  entered_by: string | null;
  entered_at: string;
  total_qty: number;
  estimated_payout: number;
  days_to_ex: number;
};

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

type PensionMovementRow = {
  isin: string;
  price_today: number;
  price_yesterday: number | null;
  price_1w: number | null;
  price_1m: number | null;
  change_1d_pct: number;
  change_1w_pct: number;
  change_1m_pct: number;
};

type PsxMovementRow = {
  ticker: string;
  company_name: string;
  price_today: number;
  price_yesterday: number | null;
  change_1d_pkr: number;
  change_1d_pct: number;
  direction: "up" | "down" | "flat";
};

type ComparisonFundRow = {
  fund_name: string;
  isin: string;
  risk_level: string | null;
  style: string | null;
  price_today: number | null;
  change_1m_pct: number | null;
  change_1y_pct: number | null;
  price_date: string | null;
  your_avg_1m_pct: number | null;
};

type PriceRow = {
  ticker: string;
  current_price: number | null;
  price_date: string | null;
  total_qty: number;
  total_cost: number;
  avg_cost: number;
  current_value: number | null;
  gain_loss: number | null;
  gain_loss_pct: number | null;
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

  const todayISO = new Date().toISOString().slice(0, 10);

  const [canEdit, setCanEdit] = useState(false);
  const [canRefresh, setCanRefresh] = useState(false);
  const [selectedDate, setSelectedDate] = useState(todayISO);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [portfolioPrices, setPortfolioPrices] = useState<PriceRow[]>([]);
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

  // UK Pension state
  const [pensionSummary, setPensionSummary] = useState<PensionSummary | null>(null);
  const [pensionBreakdown, setPensionBreakdown] = useState<PensionFundBreakdown[]>([]);
  const [pensionMovement, setPensionMovement] = useState<PensionMovementRow[]>([]);
  const [gbpPkrRate, setGbpPkrRate] = useState<number>(0);
  const [pensionLoading, setPensionLoading] = useState(true);

  // PSX movement state
  const [psxMovement, setPsxMovement] = useState<PsxMovementRow[]>([]);

  // Comparison funds state
  const [comparisonFunds, setComparisonFunds] = useState<ComparisonFundRow[]>([]);

  const [formTicker, setFormTicker] = useState("");
  const [formCompany, setFormCompany] = useState("");
  const [formQty, setFormQty] = useState("");
  const [formBuyPrice, setFormBuyPrice] = useState("");
  const [formBuyDate, setFormBuyDate] = useState("");
  const [formTarget, setFormTarget] = useState("");
  const [formNotes, setFormNotes] = useState("");

  // Portfolio totals — come directly from DB, no JS aggregation
  const [portfolioTotals, setPortfolioTotals] = useState<{
    total_cost: number; total_value: number; gain_loss: number; gain_loss_pct: number;
    stock_count: number; price_date: string | null;
    prev_value: number; day_change: number | null; day_change_pct: number | null;
    dividend_count: number;
  } | null>(null);
  const [losersDB, setLosersDB] = useState<{ ticker: string; company_name: string; gain_loss_pct: number; gain_loss: number }[]>([]);

  // Dividend state
  const [dayChange, setDayChange] = useState<{ value: number; pct: number } | null>(null);
  const [dividends, setDividends] = useState<DividendRow[]>([]);
  const [divSectionOpen, setDivSectionOpen] = useState(true);
  const [showDivForm, setShowDivForm] = useState(false);
  const [editingDivId, setEditingDivId] = useState<string | null>(null);
  const [divTicker, setDivTicker] = useState("");
  const [divAmount, setDivAmount] = useState("");
  const [divExDate, setDivExDate] = useState("");
  const [divPayDate, setDivPayDate] = useState("");
  const [divAnnounced, setDivAnnounced] = useState("");
  const [divNotes, setDivNotes] = useState("");
  const [divError, setDivError] = useState<string | null>(null);
  const [divSaving, setDivSaving] = useState(false);

  const loadDividends = useCallback(async () => {
    try {
      // 2 weeks back + 2 weeks ahead, so recently-paid dividends stay visible
      // for sell/hold decisions instead of disappearing the moment they pay out.
      const res = await authFetch("/api/investments/dividends?mode=upcoming&days=14&daysBack=14");
      const json = await res.json();
      setDividends(json.dividends ?? []);
    } catch { /* silently ignore — dividends are additive */ }
  }, []);

  const load = useCallback(async (asOf: string) => {
    const [summaryRes, hRes, histRes, latestRes, psxMoveRes] = await Promise.all([
      // Single RPC: totals, per-ticker rows, losers, day-change, dividend count — all in DB
      supabase.rpc("get_portfolio_summary_full", { p_as_of: asOf, p_alert_pct: -3, p_div_days: 7 }),
      // Holdings still needed for individual lot edit/delete UI
      supabase.from("holdings").select("*").order("ticker"),
      // Chart history — for the portfolio value graph only
      supabase.from("price_history").select("ticker, price, as_of_date").order("as_of_date", { ascending: true }),
      supabase.from("price_history").select("created_at").order("created_at", { ascending: false }).limit(1).single(),
      // PSX daily movement
      supabase.rpc("get_psx_stock_movement"),
    ]);

    const summary = summaryRes.data as {
      totals: { total_cost: number; total_value: number; gain_loss: number; gain_loss_pct: number; stock_count: number; price_date: string | null; prev_value: number; day_change: number | null; day_change_pct: number | null; dividend_count: number };
      stocks: PriceRow[];
      losers: { ticker: string; company_name: string; gain_loss_pct: number; gain_loss: number }[];
    } | null;

    setHoldings(hRes.data || []);
    setPortfolioPrices(summary?.stocks ?? []);
    setHistory(histRes.data || []);
    setLastPriceUpdate(latestRes.data?.created_at ?? null);
    setPortfolioTotals(summary?.totals ?? null);
    setLosersDB(summary?.losers ?? []);
    setPsxMovement((psxMoveRes.data as PsxMovementRow[] | null) ?? []);
    setDayChange(
      summary?.totals?.day_change != null && summary?.totals?.day_change_pct != null
        ? { value: summary.totals.day_change, pct: summary.totals.day_change_pct }
        : null
    );
    setLoading(false);
  }, []);

  const loadPensionData = useCallback(async () => {
    setPensionLoading(true);
    try {
      const [summaryRes, breakdownRes, fxRes, movementRes, compRes] = await Promise.all([
        supabase.rpc("get_pension_summary"),
        supabase.rpc("get_pension_fund_breakdown"),
        fetch("/api/fx/gbp-pkr"),
        supabase.rpc("get_pension_fund_movement"),
        supabase.rpc("get_pension_comparison_performance"),
      ]);

      let pkrRate = 356;
      try {
        const fxData = await fxRes.json();
        pkrRate = fxData?.rate ?? 356;
      } catch { /* use fallback */ }

      const row = (summaryRes.data as PensionSummary[] | null)?.[0] ?? null;
      setPensionSummary(row);
      setPensionBreakdown(
        ((breakdownRes.data as PensionFundBreakdown[] | null) ?? []).map((f) => ({
          ...f,
          value_pkr: f.value_gbp * pkrRate,
        }))
      );
      setPensionMovement((movementRes.data as PensionMovementRow[] | null) ?? []);
      setComparisonFunds((compRes.data as ComparisonFundRow[] | null) ?? []);
      setGbpPkrRate(pkrRate);
    } catch { /* non-fatal — pension section is additive */ }
    setPensionLoading(false);
  }, []);

  useEffect(() => {
    if (checking) return;
    load(selectedDate);
    loadDividends();
    loadPensionData();
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
      setCanRefresh(canRefreshInvestmentPrices(ctx));
    })();
  }, [checking, load, loadPensionData, selectedDate]);

  const stocks: PortfolioStock[] = (() => {
    // portfolioPrices from the RPC already has one aggregated row per ticker
    // with quantities, costs, and prices as of the selected date.
    const priceMap = new Map(portfolioPrices.map((p) => [p.ticker, p]));

    // We still need holdings to get the individual lots (for edit/delete) and target prices.
    const lotMap = new Map<string, Holding[]>();
    const targetMap = new Map<string, number | null>();
    for (const h of holdings) {
      if (!lotMap.has(h.ticker)) lotMap.set(h.ticker, []);
      lotMap.get(h.ticker)!.push(h);
      if (h.target_price && (!targetMap.get(h.ticker) || h.target_price > (targetMap.get(h.ticker) ?? 0))) {
        targetMap.set(h.ticker, h.target_price);
      }
    }

    // Build PortfolioStock from the RPC result — quantities/costs come from the DB.
    return portfolioPrices.map((p) => ({
      ticker: p.ticker,
      company: (holdings.find(h => h.ticker === p.ticker)?.company_name) || p.ticker,
      totalQty: p.total_qty,
      avgCost: p.avg_cost,
      totalCost: p.total_cost,
      currentPrice: p.current_price,
      currentValue: p.current_value,
      gainLoss: p.gain_loss,
      gainLossPct: p.gain_loss_pct,
      priceDate: p.price_date,
      priceSource: null,
      targetPrice: targetMap.get(p.ticker) ?? null,
      lots: lotMap.get(p.ticker) || [],
    })).sort((a, b) => a.ticker.localeCompare(b.ticker));
  })();

  const totalCost = portfolioTotals?.total_cost ?? 0;
  const totalValue = portfolioTotals?.total_value ?? 0;
  const totalGL = portfolioTotals?.gain_loss ?? 0;
  const totalGLPct = portfolioTotals?.gain_loss_pct ?? 0;
  const losers = losersDB;
  const winners = stocks.filter((s) => s.gainLossPct !== null && s.gainLossPct > 20);

  // UK Pension values — all aggregation done in Postgres RPCs
  const pensionTotalGbp = pensionSummary?.total_value_gbp ?? 0;
  const pensionTotalPkr = pensionTotalGbp * gbpPkrRate;
  const pensionNetGain = pensionSummary?.net_gain_gbp ?? 0;
  const pensionReturnPct = pensionSummary?.return_pct ?? 0;
  const pensionLatestDate = pensionSummary?.last_price_date ?? null;

  async function handleRefreshPrices() {
    if (!canRefresh) return;
    setUpdating(true);
    setUpdateResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/investments/update-prices", {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const json = await res.json();
      setUpdateResult(`Updated ${json.succeeded}/${json.total} prices. ${json.failed > 0 ? `${json.failed} failed.` : ""}`);
      await load(selectedDate);
    } catch {
      setUpdateResult("Failed to update prices.");
    }
    setUpdating(false);
  }

  async function handleManualPrice(ticker: string) {
    if (!canEdit) return;
    const price = parseFloat(manualPrice);
    if (isNaN(price) || price <= 0) return;
    await supabase.from("price_history").upsert(
      { ticker, price, as_of_date: todayISO, source: "manual" },
      { onConflict: "ticker,as_of_date" },
    );
    setManualPriceModal(null);
    setManualPrice("");
    await load(selectedDate);
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
    await load(selectedDate);
  }

  async function handleDelete(id: string) {
    if (!canEdit) return;
    if (!await dlg.confirm("Delete this holding?", true)) return;
    await supabase.from("holdings").delete().eq("id", id);
    await load(selectedDate);
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

  // ── Dividend CRUD ──────────────────────────────────────────────────────────

  function resetDivForm() {
    setEditingDivId(null);
    setDivTicker("");
    setDivAmount("");
    setDivExDate("");
    setDivPayDate("");
    setDivAnnounced("");
    setDivNotes("");
    setDivError(null);
    setShowDivForm(false);
  }

  function startEditDiv(d: DividendRow) {
    setEditingDivId(d.id);
    setDivTicker(d.ticker);
    setDivAmount(String(d.dividend_per_share));
    setDivExDate(d.ex_dividend_date);
    setDivPayDate(d.payment_date ?? "");
    setDivAnnounced(d.announced_date ?? "");
    setDivNotes(d.notes ?? "");
    setDivError(null);
    setShowDivForm(true);
  }

  async function handleSaveDividend(e: React.FormEvent) {
    e.preventDefault();
    setDivError(null);
    setDivSaving(true);
    try {
      const payload = {
        ticker: divTicker.toUpperCase().trim(),
        dividend_per_share: parseFloat(divAmount),
        ex_dividend_date: divExDate,
        payment_date: divPayDate || null,
        announced_date: divAnnounced || null,
        notes: divNotes.trim() || null,
        source: "manual",
        confirmed: true,
      };
      if (editingDivId) {
        const res = await authFetch("/api/investments/dividends", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingDivId, ...payload }),
        });
        const json = await res.json();
        if (!res.ok) { setDivError(json.error ?? "Failed to save."); setDivSaving(false); return; }
      } else {
        const res = await authFetch("/api/investments/dividends", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok) { setDivError(json.error ?? "Failed to save."); setDivSaving(false); return; }
      }
      resetDivForm();
      await loadDividends();
    } catch { setDivError("Network error. Please try again."); }
    setDivSaving(false);
  }

  async function handleDeleteDividend(id: string) {
    if (!await dlg.confirm("Remove this dividend record?", true)) return;
    await authFetch("/api/investments/dividends", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await loadDividends();
  }

  async function handleConfirmDiv(id: string) {
    await authFetch("/api/investments/dividends", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, confirmed: true }),
    });
    await loadDividends();
  }

  async function handleDismissDiv(id: string) {
    await authFetch("/api/investments/dividends", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "cancelled" }),
    });
    await loadDividends();
  }

  const confirmedDivs = dividends.filter((d) => d.confirmed);
  const unconfirmedDivs = dividends.filter((d) => !d.confirmed);

  if (checking) return null;

  const priceDate = portfolioTotals?.price_date ?? null;
  const isHistorical = selectedDate < todayISO;

  return (
    <AuthWrapper>
      {dlg.element}
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%" }}>
        <PageHeader />

        {/* Date selector */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "15px", fontWeight: 600, color: NAVY }}>View portfolio as of:</span>
          <DateInput
            value={selectedDate}
            onChange={(e) => { setSelectedDate(e.target.value); setLoading(true); }}
            style={{ padding: "6px 10px", border: `1px solid var(--border-color, ${COLOURS.HAIRLINE})`, borderRadius: "6px", fontSize: "15px" }}
          />
          {isHistorical && (
            <button
              onClick={() => { setSelectedDate(todayISO); setLoading(true); }}
              style={{ fontSize: "13px", color: COLOURS.BLUE, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}
            >
              Back to today
            </button>
          )}
        </div>

        {/* Historical date notice */}
        {isHistorical && !loading && (
          <div style={{
            border: "1px solid #bfdbfe", borderLeft: `4px solid ${COLOURS.BLUE}`,
            borderRadius: "8px", backgroundColor: "#eff6ff",
            padding: "8px 14px", marginBottom: "14px", fontSize: "14px", color: "#1d4ed8",
          }}>
            Showing portfolio value as of <strong>{formatDateUK(selectedDate)}</strong> — prices are the most recent recorded on or before that date.
          </div>
        )}

        {loading ? (
          <p style={{ color: `var(--text-secondary, ${COLOURS.SLATE})` }}>Loading portfolio...</p>
        ) : stocks.length === 0 && !showAddForm ? (
          <div style={{ border: `1px solid var(--border-color, ${COLOURS.HAIRLINE})`, borderRadius: "12px", padding: "40px 20px", backgroundColor: "var(--bg-card, #ffffff)", textAlign: "center" }}>
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
              {dayChange !== null ? (
                <SummaryCard
                  label="Today's Change"
                  value={fmtRs(dayChange.value)}
                  sub={fmtPct(dayChange.pct)}
                  color={dayChange.value >= 0 ? GREEN : RED}
                />
              ) : (
                <SummaryCard label="Stocks" value={String(stocks.length)} sub={priceDate ? `Prices: ${formatDateUK(priceDate)}` : "No prices"} color={SLATE} />
              )}
            </div>

            {/* Last updated */}
            {lastPriceUpdate && (
              <div style={{ fontSize: "14px", color: `var(--text-secondary, ${COLOURS.SLATE})`, marginBottom: "12px", textAlign: "right" }}>
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
                  {losers.length} stock{losers.length > 1 ? "s" : ""} down more than 3%
                </div>
                {losers.map((s) => (
                  <div key={s.ticker} style={{ fontSize: "15px", color: "#991b1b", lineHeight: 1.8 }}>
                    <span style={{ fontWeight: 700 }}>{s.ticker}</span> ({s.company_name}) — {fmtPct(s.gain_loss_pct)} ({fmtRs(s.gain_loss)})
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            {(canEdit || canRefresh) && (
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "16px" }}>
                {canRefresh && (
                  <button onClick={handleRefreshPrices} disabled={updating} style={btnStyle}>
                    {updating ? "Updating..." : "Refresh Prices from PSX"}
                  </button>
                )}
                {canEdit && (
                  <button onClick={() => { resetForm(); setShowAddForm(true); }} style={{ ...btnStyle, backgroundColor: GREEN }}>
                    + Add Holding
                  </button>
                )}
                {updateResult && (
                  <span style={{ fontSize: "15px", color: `var(--text-secondary, ${COLOURS.SLATE})`, alignSelf: "center" }}>{updateResult}</span>
                )}
              </div>
            )}

            {/* Add/Edit Form */}
            {canEdit && showAddForm && (
              <div style={{
                border: `1px solid var(--border-color, ${COLOURS.HAIRLINE})`, borderRadius: "10px",
                backgroundColor: "var(--bg-card, #fff)", padding: "16px", marginBottom: "16px",
              }}>
                <div style={{ fontSize: "15px", fontWeight: 700, color: `var(--text-primary, ${COLOURS.NAVY})`, marginBottom: "12px" }}>
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
                border: `1px solid var(--border-color, ${COLOURS.HAIRLINE})`, borderRadius: "10px",
                backgroundColor: "var(--bg-card, #fff)", padding: "16px", marginBottom: "16px",
                display: "flex", gap: "10px", alignItems: "center",
              }}>
                <span style={{ fontWeight: 700, color: `var(--text-primary, ${COLOURS.NAVY})` }}>{manualPriceModal}:</span>
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
                    <Th align="right">Today</Th>
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
                      <td style={{ ...td, fontWeight: 700, color: `var(--text-primary, ${COLOURS.NAVY})`, cursor: "pointer" }}>{s.ticker}</td>
                      <td style={{ ...td, color: `var(--text-secondary, ${COLOURS.SLATE})`, fontSize: "15px" }}>{s.company}</td>
                      <td style={{ ...td, textAlign: "right" }}>{s.totalQty.toLocaleString()}</td>
                      <td style={{ ...td, textAlign: "right" }}>{fmtPrice(s.avgCost)}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>
                        {s.currentPrice !== null ? fmtPrice(s.currentPrice) : "—"}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {(() => {
                          const m = psxMovement.find((r) => r.ticker === s.ticker);
                          if (!m || m.direction === "flat" || m.price_yesterday === null) {
                            return <span style={{ color: SLATE, fontSize: "13px" }}>—</span>;
                          }
                          const up = m.direction === "up";
                          return (
                            <span style={{
                              fontSize: "12px", fontWeight: 700,
                              padding: "2px 7px", borderRadius: RADII.PILL,
                              color: up ? COLOURS.GREEN : COLOURS.RED,
                              backgroundColor: up ? COLOURS.SUCCESS_SOFT : COLOURS.DANGER_SOFT,
                              whiteSpace: "nowrap",
                            }}>
                              {up ? "▲" : "▼"} {Math.abs(m.change_1d_pct).toFixed(2)}%
                            </span>
                          );
                        })()}
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
                      <td style={{ ...td, textAlign: "right", color: `var(--text-secondary, ${COLOURS.SLATE})` }}>
                        {s.targetPrice ? fmtPrice(s.targetPrice) : "—"}
                      </td>
                      <td style={{ ...td, color: `var(--text-secondary, ${COLOURS.SLATE})`, fontSize: "14px" }}>
                        {s.priceDate ? formatDateUK(s.priceDate) : "—"}
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
                            <span style={{ fontSize: "13px", color: `var(--text-secondary, ${COLOURS.SLATE})` }}>{s.lots.length} lots</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: `2px solid ${NAVY}`, fontWeight: 700 }}>
                    <td style={td} colSpan={6}>TOTAL</td>
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
                border: `1px solid var(--border-color, ${COLOURS.HAIRLINE})`, borderRadius: "10px",
                backgroundColor: "var(--bg-card, #fff)", padding: "16px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: `var(--text-primary, ${COLOURS.NAVY})` }}>
                    {chartTicker || "—"} Price History
                  </div>
                  <div style={{ display: "flex", gap: "4px" }}>
                    {(["1M", "3M", "6M", "ALL"] as const).map((r) => (
                      <button key={r} onClick={() => setChartRange(r)} style={{
                        padding: "2px 8px", fontSize: "12px", fontWeight: 600,
                        border: `1px solid var(--border-color, ${COLOURS.HAIRLINE})`, borderRadius: "4px", cursor: "pointer",
                        backgroundColor: chartRange === r ? NAVY : "transparent",
                        color: chartRange === r ? "white" : `var(--text-secondary, ${COLOURS.SLATE})`,
                      }}>{r}</button>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "10px" }}>
                  {stocks.map((s) => (
                    <button key={s.ticker} onClick={() => setSelectedTicker(s.ticker)} style={{
                      padding: "2px 8px", fontSize: "11px", fontWeight: 600,
                      border: `1px solid var(--border-color, ${COLOURS.HAIRLINE})`, borderRadius: "4px", cursor: "pointer",
                      backgroundColor: chartTicker === s.ticker ? NAVY : "transparent",
                      color: chartTicker === s.ticker ? "white" : `var(--text-secondary, ${COLOURS.SLATE})`,
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
                  <p style={{ color: `var(--text-secondary, ${COLOURS.SLATE})`, fontSize: "15px", textAlign: "center", padding: "40px 0" }}>No price history for {chartTicker}</p>
                )}
              </div>

              {/* Gain/Loss Bar Chart */}
              <div style={{
                border: `1px solid var(--border-color, ${COLOURS.HAIRLINE})`, borderRadius: "10px",
                backgroundColor: "var(--bg-card, #fff)", padding: "16px",
              }}>
                <div style={{ fontSize: "15px", fontWeight: 700, color: `var(--text-primary, ${COLOURS.NAVY})`, marginBottom: "12px" }}>
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
                  <p style={{ color: `var(--text-secondary, ${COLOURS.SLATE})`, fontSize: "15px", textAlign: "center", padding: "40px 0" }}>No data</p>
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
                      border: `1px solid var(--border-color, ${COLOURS.HAIRLINE})`, borderTop: `3px solid ${GREEN}`,
                      borderRadius: "8px", padding: "10px 12px",
                      backgroundColor: "var(--bg-card, #fff)",
                    }}>
                      <div style={{ fontWeight: 700, color: `var(--text-primary, ${COLOURS.NAVY})`, fontSize: "15px" }}>{s.ticker}</div>
                      <div style={{ fontSize: "14px", color: `var(--text-secondary, ${COLOURS.SLATE})` }}>{s.company}</div>
                      <div style={{ fontWeight: 700, color: GREEN, fontSize: "18px", marginTop: "4px" }}>
                        {fmtPct(s.gainLossPct!)}
                      </div>
                      <div style={{ fontSize: "12px", color: GREEN }}>{fmtRs(s.gainLoss!)}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ── Dividends ── */}
            <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: "8px", paddingTop: "4px" }}>
              <div
                onClick={() => setDivSectionOpen((o) => !o)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", padding: "10px 0" }}
              >
                <span style={{ fontSize: "15px", fontWeight: 700, color: NAVY }}>
                  Dividends — Past 2 Weeks &amp; Next 2 Weeks
                  {confirmedDivs.length > 0 && (
                    <span style={{ marginLeft: "8px", fontSize: "12px", fontWeight: 700, color: "white", backgroundColor: AMBER, padding: "2px 8px", borderRadius: "10px" }}>
                      {confirmedDivs.length} confirmed
                    </span>
                  )}
                  {unconfirmedDivs.length > 0 && (
                    <span style={{ marginLeft: "6px", fontSize: "12px", fontWeight: 700, color: NAVY, backgroundColor: "#fef9c3", padding: "2px 8px", borderRadius: "10px", border: `1px solid ${AMBER}` }}>
                      {unconfirmedDivs.length} to verify
                    </span>
                  )}
                </span>
                <span style={{ fontSize: "13px", color: SLATE }}>{divSectionOpen ? "▲ Hide" : "▼ Show"}</span>
              </div>

              {divSectionOpen && (
                <>
                  {/* Confirmed upcoming dividends */}
                  {confirmedDivs.length > 0 && (
                    <div style={{ border: `1px solid ${BORDER}`, borderTop: `3px solid ${AMBER}`, borderRadius: "8px", padding: "12px 14px", marginBottom: "12px", backgroundColor: "var(--bg-card, #fff)" }}>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: NAVY, marginBottom: "10px" }}>Confirmed Upcoming</div>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "560px" }}>
                          <thead>
                            <tr style={{ backgroundColor: "var(--bg-card-hover, #f8fafc)" }}>
                              <Th>Ticker</Th>
                              <Th>Status</Th>
                              <Th align="right">Rs/Share</Th>
                              <Th>Ex-Date</Th>
                              <Th>Pay Date</Th>
                              <Th align="right">Days</Th>
                              <Th align="right">Est. Payout</Th>
                              {canEdit && <Th>Actions</Th>}
                            </tr>
                          </thead>
                          <tbody>
                            {confirmedDivs.map((d) => {
                              const isPast = d.days_to_ex < 0;
                              return (
                              <tr key={d.id} style={{ borderBottom: "1px solid var(--border-light, #f1f5f9)" }}>
                                <td style={{ ...divTd, fontWeight: 700, color: NAVY }}>{d.ticker}</td>
                                <td style={{ ...divTd }}>
                                  <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "10px", color: isPast ? SLATE : GREEN, backgroundColor: isPast ? "var(--border-light, #f1f5f9)" : "#e7f2ed" }}>
                                    {isPast ? "Paid" : "Upcoming"}
                                  </span>
                                </td>
                                <td style={{ ...divTd, textAlign: "right" }}>{fmtPrice(d.dividend_per_share)}</td>
                                <td style={{ ...divTd }}>
                                  <span style={{ fontWeight: !isPast && d.days_to_ex <= 3 ? 700 : 400, color: !isPast && d.days_to_ex <= 3 ? RED : "inherit" }}>
                                    {formatDateUK(d.ex_dividend_date)}
                                  </span>
                                </td>
                                <td style={{ ...divTd, color: SLATE }}>{d.payment_date ? formatDateUK(d.payment_date) : "—"}</td>
                                <td style={{ ...divTd, textAlign: "right" }}>
                                  <span style={{ fontWeight: 700, color: isPast ? SLATE : d.days_to_ex <= 3 ? RED : d.days_to_ex <= 7 ? AMBER : GREEN }}>
                                    {isPast ? `${Math.abs(d.days_to_ex)}d ago` : `${d.days_to_ex}d`}
                                  </span>
                                </td>
                                <td style={{ ...divTd, textAlign: "right", fontWeight: 700, color: GREEN }}>
                                  {d.total_qty > 0 ? fmtRs(d.estimated_payout) : "—"}
                                </td>
                                {canEdit && (
                                  <td style={{ ...divTd, whiteSpace: "nowrap" }}>
                                    <button onClick={() => startEditDiv(d)} style={miniBtn} title="Edit">✏️</button>
                                    <button onClick={() => handleDeleteDividend(d.id)} style={{ ...miniBtn, color: RED }} title="Delete">🗑️</button>
                                  </td>
                                )}
                              </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {confirmedDivs.length === 0 && !unconfirmedDivs.length && (
                    <p style={{ color: SLATE, fontSize: "13px", marginBottom: "12px" }}>No dividend activity in the past 2 weeks or next 2 weeks.</p>
                  )}

                  {/* Unconfirmed dividends — review list */}
                  {unconfirmedDivs.length > 0 && (
                    <div style={{ border: `1px solid ${AMBER}`, borderRadius: "8px", padding: "12px 14px", marginBottom: "12px", backgroundColor: "#fffbeb" }}>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#92400e", marginBottom: "4px" }}>
                        Unconfirmed — please verify before acting on these
                      </div>
                      <div style={{ fontSize: "12px", color: "#92400e", marginBottom: "10px" }}>
                        Auto-fetched data, including already-paid dividends from the past 2 weeks. Review each entry and confirm or dismiss.
                      </div>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "500px" }}>
                          <thead>
                            <tr style={{ backgroundColor: "#fef3c7" }}>
                              <Th>Ticker</Th>
                              <Th>Status</Th>
                              <Th align="right">Rs/Share</Th>
                              <Th>Ex-Date</Th>
                              <Th>Source</Th>
                              <Th>Action</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {unconfirmedDivs.map((d) => {
                              const isPast = d.days_to_ex < 0;
                              return (
                              <tr key={d.id} style={{ borderBottom: "1px solid #fde68a" }}>
                                <td style={{ ...divTd, fontWeight: 700 }}>{d.ticker}</td>
                                <td style={{ ...divTd }}>
                                  <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "10px", color: isPast ? SLATE : GREEN, backgroundColor: isPast ? "var(--border-light, #f1f5f9)" : "#e7f2ed" }}>
                                    {isPast ? "Paid" : "Upcoming"}
                                  </span>
                                </td>
                                <td style={{ ...divTd, textAlign: "right" }}>{fmtPrice(d.dividend_per_share)}</td>
                                <td style={{ ...divTd }}>{formatDateUK(d.ex_dividend_date)}</td>
                                <td style={{ ...divTd, color: SLATE, fontSize: "12px" }}>{d.source}</td>
                                <td style={{ ...divTd, whiteSpace: "nowrap" }}>
                                  {canEdit && (
                                    <>
                                      <button
                                        onClick={() => handleConfirmDiv(d.id)}
                                        style={{ ...miniConfirmBtn, backgroundColor: GREEN }}
                                      >Confirm</button>
                                      <button
                                        onClick={() => handleDismissDiv(d.id)}
                                        style={{ ...miniConfirmBtn, backgroundColor: SLATE, marginLeft: "6px" }}
                                      >Dismiss</button>
                                    </>
                                  )}
                                </td>
                              </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Add / Edit dividend form */}
                  {canEdit && (
                    <>
                      {!showDivForm ? (
                        <button
                          onClick={() => { resetDivForm(); setShowDivForm(true); }}
                          style={{ ...btnStyle, backgroundColor: AMBER, marginBottom: "16px" }}
                        >
                          + Add Dividend
                        </button>
                      ) : (
                        <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", backgroundColor: "var(--bg-card, #fff)", padding: "14px", marginBottom: "16px" }}>
                          <div style={{ fontSize: "14px", fontWeight: 700, color: NAVY, marginBottom: "10px" }}>
                            {editingDivId ? "Edit Dividend" : "Add Dividend"}
                          </div>
                          <form onSubmit={handleSaveDividend} style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: "10px" }}>
                            <div>
                              <label style={{ fontSize: "12px", color: SLATE, display: "block", marginBottom: "3px" }}>Ticker *</label>
                              <select
                                value={divTicker}
                                onChange={(e) => setDivTicker(e.target.value)}
                                required
                                style={inputStyle}
                              >
                                <option value="">Select stock…</option>
                                {[...new Set(holdings.map((h) => h.ticker))].sort().map((t) => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label style={{ fontSize: "12px", color: SLATE, display: "block", marginBottom: "3px" }}>Rs per Share *</label>
                              <input type="number" step="0.0001" min="0" placeholder="e.g. 5.00" value={divAmount} onChange={(e) => setDivAmount(e.target.value)} required style={inputStyle} />
                            </div>
                            <div>
                              <label style={{ fontSize: "12px", color: SLATE, display: "block", marginBottom: "3px" }}>Ex-Dividend Date *</label>
                              <DateInput value={divExDate} onChange={(e) => setDivExDate(e.target.value)} required style={inputStyle} />
                            </div>
                            <div>
                              <label style={{ fontSize: "12px", color: SLATE, display: "block", marginBottom: "3px" }}>Payment Date</label>
                              <DateInput value={divPayDate} onChange={(e) => setDivPayDate(e.target.value)} style={inputStyle} />
                            </div>
                            <div>
                              <label style={{ fontSize: "12px", color: SLATE, display: "block", marginBottom: "3px" }}>Announced Date</label>
                              <DateInput value={divAnnounced} onChange={(e) => setDivAnnounced(e.target.value)} style={inputStyle} />
                            </div>
                            <div>
                              <label style={{ fontSize: "12px", color: SLATE, display: "block", marginBottom: "3px" }}>Notes</label>
                              <input placeholder="Optional notes" value={divNotes} onChange={(e) => setDivNotes(e.target.value)} style={inputStyle} />
                            </div>
                            <div style={{ gridColumn: isMobile ? "1" : "1 / -1", display: "flex", gap: "8px", alignItems: "center" }}>
                              <button type="submit" disabled={divSaving} style={btnStyle}>{divSaving ? "Saving…" : editingDivId ? "Save Changes" : "Add Dividend"}</button>
                              <button type="button" onClick={resetDivForm} style={{ ...btnStyle, backgroundColor: SLATE }}>Cancel</button>
                              {divError && <span style={{ fontSize: "13px", color: RED }}>{divError}</span>}
                            </div>
                          </form>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {/* ── UK PENSION — AVIVA SIPP ── */}
        <div style={{ borderTop: `2px solid ${HAIRLINE}`, marginTop: "24px", paddingTop: "24px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", marginBottom: "4px" }}>
            <SectionTitle title="UK Pension — Aviva SIPP" />
            {gbpPkrRate > 0 && (
              <span style={{
                fontSize: "12px", fontWeight: 600, color: BLUE,
                backgroundColor: "#EEF2FF", border: `1px solid #C7D2FE`,
                borderRadius: "999px", padding: "3px 10px",
              }}>
                £1 = PKR {gbpPkrRate.toFixed(2)}
              </span>
            )}
          </div>
          <div style={{ fontSize: "13px", color: SLATE, marginBottom: "16px" }}>
            2 funds · Prices auto-updated daily · GBP
          </div>

          {pensionLoading ? (
            <p style={{ color: SLATE, fontSize: "14px" }}>Loading pension data…</p>
          ) : (
            <>
              {/* Hero card */}
              <div style={{
                backgroundColor: NAVY,
                borderRadius: "14px",
                padding: isMobile ? "20px 18px" : "24px 28px",
                marginBottom: "16px",
                color: "white",
              }}>
                <div style={{ fontSize: "10.5px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#94A3B8", marginBottom: "8px" }}>
                  TOTAL PENSION VALUE
                </div>
                <div style={{ fontSize: isMobile ? "32px" : "42px", fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", lineHeight: 1, marginBottom: "8px" }}>
                  £{pensionTotalGbp.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div style={{ fontSize: "14px", color: "#CBD5E1" }}>
                  PKR {Math.round(pensionTotalPkr).toLocaleString("en-PK")}&nbsp;·&nbsp;
                  <span style={{ color: pensionNetGain >= 0 ? "#4ADE80" : "#F87171" }}>
                    {pensionNetGain >= 0 ? "+" : ""}£{pensionNetGain.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}&nbsp;
                    ({pensionReturnPct >= 0 ? "+" : ""}{pensionReturnPct.toFixed(1)}%) vs contributions
                  </span>
                </div>
              </div>

              {/* 4-metric grid */}
              <div style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)",
                gap: "12px",
                marginBottom: "20px",
              }}>
                <PensionMetricCard
                  label="Total Paid In"
                  value={`£${(pensionSummary?.contributed_gbp ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  color={NAVY}
                />
                <PensionMetricCard
                  label="Fees Deducted"
                  value={`£${(pensionSummary?.fees_gbp ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  color={RED}
                />
                <PensionMetricCard
                  label="Net Gain"
                  value={`${pensionNetGain >= 0 ? "+" : ""}£${pensionNetGain.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  color={pensionNetGain >= 0 ? GREEN : RED}
                />
                <PensionMetricCard
                  label="Return"
                  value={`${pensionReturnPct >= 0 ? "+" : ""}${pensionReturnPct.toFixed(1)}%`}
                  color={pensionReturnPct >= 0 ? GREEN : RED}
                />
              </div>

              {/* Fund breakdown */}
              <div style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)",
                gap: "14px",
                marginBottom: "14px",
              }}>
                {pensionBreakdown.map((fund) => (
                    <div key={fund.isin} style={{
                      border: `1px solid ${HAIRLINE}`,
                      borderTop: `3px solid ${BLUE}`,
                      borderRadius: "12px",
                      padding: "16px",
                      backgroundColor: "var(--bg-card, #fff)",
                    }}>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: NAVY, marginBottom: "6px", lineHeight: 1.4 }}>
                        {fund.fund_name}
                      </div>
                      <span style={{
                        display: "inline-block",
                        fontSize: "11px", fontWeight: 600,
                        backgroundColor: "#EEF2FF", color: BLUE,
                        border: `1px solid #C7D2FE`,
                        borderRadius: "6px",
                        padding: "2px 8px",
                        marginBottom: "12px",
                        letterSpacing: "0.02em",
                      }}>
                        {fund.isin}
                      </span>

                      {/* Allocation bar — percentage computed by DB */}
                      <div style={{ marginBottom: "10px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: SLATE, marginBottom: "4px" }}>
                          <span>{Number(fund.allocation_pct).toFixed(1)}% of pension</span>
                        </div>
                        <div style={{ height: "6px", backgroundColor: HAIRLINE, borderRadius: "999px", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${Number(fund.allocation_pct)}%`, backgroundColor: BLUE, borderRadius: "999px" }} />
                        </div>
                      </div>

                      {/* Daily movement chips */}
                      {(() => {
                        const mv = pensionMovement.find((m) => m.isin === fund.isin);
                        if (!mv) return null;
                        const periods: { label: string; pct: number }[] = [
                          { label: "1D", pct: Number(mv.change_1d_pct) },
                          { label: "1W", pct: Number(mv.change_1w_pct) },
                          { label: "1M", pct: Number(mv.change_1m_pct) },
                        ];
                        return (
                          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
                            {periods.map(({ label, pct }) => {
                              const up = pct > 0;
                              const flat = pct === 0;
                              return (
                                <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                                  <span style={{ fontSize: "10px", color: SLATE, fontWeight: 600, marginRight: "1px" }}>{label}</span>
                                  <span style={{
                                    fontSize: "11px", fontWeight: 700,
                                    padding: "2px 7px", borderRadius: RADII.PILL,
                                    color: flat ? SLATE : up ? COLOURS.GREEN : COLOURS.RED,
                                    backgroundColor: flat ? COLOURS.CARD_ALT : up ? COLOURS.SUCCESS_SOFT : COLOURS.DANGER_SOFT,
                                    whiteSpace: "nowrap",
                                  }}>
                                    {flat ? "—" : up ? "▲" : "▼"} {flat ? "0.000%" : `${Math.abs(pct).toFixed(3)}%`}
                                  </span>
                                </span>
                              );
                            })}
                          </div>
                        );
                      })()}

                      {/* 4-metric mini grid — all values from DB */}
                      <div style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, 1fr)",
                        gap: "8px",
                      }}>
                        <div>
                          <div style={{ fontSize: "10px", color: SLATE, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "2px" }}>Units Held</div>
                          <div style={{ fontSize: "14px", fontWeight: 600, color: NAVY, fontVariantNumeric: "tabular-nums" }}>
                            {Number(fund.units_held).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: "10px", color: SLATE, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "2px" }}>Unit Price</div>
                          <div style={{ fontSize: "14px", fontWeight: 600, color: NAVY, fontVariantNumeric: "tabular-nums" }}>
                            {fund.price_gbp > 0 ? `£${Number(fund.price_gbp).toFixed(4)}` : "—"}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: "10px", color: SLATE, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "2px" }}>Value (GBP)</div>
                          <div style={{ fontSize: "14px", fontWeight: 600, color: BLUE, fontVariantNumeric: "tabular-nums" }}>
                            £{Number(fund.value_gbp).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: "10px", color: SLATE, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "2px" }}>Value (PKR)</div>
                          <div style={{ fontSize: "14px", fontWeight: 600, color: SLATE, fontVariantNumeric: "tabular-nums" }}>
                            {gbpPkrRate > 0 ? `PKR ${Math.round(fund.value_pkr ?? 0).toLocaleString("en-PK")}` : "—"}
                          </div>
                        </div>
                      </div>

                      {/* ── Factsheet performance table ── */}
                      <div style={{ borderTop: `1px solid ${HAIRLINE}`, marginTop: "14px", paddingTop: "12px" }}>
                        <div style={{
                          fontSize: "10.5px", fontWeight: 700, letterSpacing: "0.08em",
                          textTransform: "uppercase", color: SLATE, marginBottom: "8px",
                        }}>
                          PERFORMANCE{fund.factsheet_date ? ` (as at ${formatDateUK(fund.factsheet_date)})` : ""}
                        </div>

                        {/* Return row */}
                        <div style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(5, 1fr)",
                          gap: "4px",
                          marginBottom: "4px",
                        }}>
                          {(["1M", "3M", "6M", "1Y", "5Y"] as const).map((label) => (
                            <div key={label} style={{ fontSize: "10px", color: SLATE, textAlign: "center", fontWeight: 600, letterSpacing: "0.05em" }}>
                              {label}
                            </div>
                          ))}
                        </div>
                        <div style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(5, 1fr)",
                          gap: "4px",
                          borderTop: `1px solid ${HAIRLINE}`,
                          borderBottom: `1px solid ${HAIRLINE}`,
                          padding: "6px 0",
                          marginBottom: "10px",
                        }}>
                          {([fund.return_1m_pct, fund.return_3m_pct, fund.return_6m_pct, fund.return_1y_pct, fund.return_5y_pct] as (number | null)[]).map((v, i) => (
                            <div key={i} style={{
                              textAlign: "center",
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: "13px",
                              fontWeight: 600,
                              color: v === null ? SLATE : v > 0 ? GREEN : v < 0 ? RED : SLATE,
                            }}>
                              {v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`}
                            </div>
                          ))}
                        </div>

                        {/* Risk pips */}
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", flexWrap: "wrap" }}>
                          {fund.risk_rating !== null && (
                            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                              <span style={{ fontSize: "10.5px", color: SLATE, fontWeight: 600 }}>Risk</span>
                              <div style={{ display: "flex", gap: "3px", alignItems: "center" }}>
                                {Array.from({ length: 7 }, (_, i) => (
                                  <div key={i} style={{
                                    width: "8px", height: "8px", borderRadius: "50%",
                                    backgroundColor: i < fund.risk_rating! ? NAVY : HAIRLINE,
                                  }} />
                                ))}
                              </div>
                              <span style={{ fontSize: "10.5px", color: SLATE }}>{fund.risk_rating}/7</span>
                            </div>
                          )}
                          {fund.ongoing_charge_pct !== null && (
                            <span style={{ fontSize: "12px", color: SLATE }}>
                              · Ongoing charge: {fund.ongoing_charge_pct.toFixed(2)}%
                            </span>
                          )}
                        </div>

                        {/* Benchmark / factsheet notes */}
                        {fund.factsheet_notes && (
                          <div style={{ fontSize: "11px", color: SLATE, fontStyle: "italic", lineHeight: 1.5 }}>
                            {fund.factsheet_notes}
                          </div>
                        )}
                      </div>
                    </div>
                ))}
              </div>

              {/* Last updated */}
              {pensionLatestDate && (
                <div style={{ fontSize: "13px", color: SLATE, textAlign: "right" }}>
                  Prices last updated: {formatDateUK(pensionLatestDate)} · Auto-refreshed daily at 11pm UK time
                </div>
              )}
            </>
          )}
        </div>

        {/* ── AVIVA FUND COMPARISON ── */}
        <div style={{ borderTop: `2px solid ${HAIRLINE}`, marginTop: "24px", paddingTop: "24px" }}>
          <SectionTitle title="Aviva Fund Comparison" />
          <div style={{ fontSize: "13px", color: SLATE, marginBottom: "16px" }}>
            Top performing Aviva pension funds — updated daily
          </div>

          {comparisonFunds.length === 0 ? (
            <div style={{
              border: `1px solid ${HAIRLINE}`, borderRadius: RADII.CARD,
              padding: "24px", backgroundColor: COLOURS.CARD_ALT,
              fontSize: "14px", color: SLATE, textAlign: "center",
            }}>
              No comparison data yet — fund ISINs are pending verification.
              Once confirmed, prices will be fetched automatically each night.
            </div>
          ) : (
            <div style={{ overflowX: "auto", marginBottom: "12px" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "700px" }}>
                <thead>
                  <tr style={{ backgroundColor: "var(--bg-card-hover, #f8fafc)" }}>
                    <Th>Fund Name</Th>
                    <Th>Risk</Th>
                    <Th>Style</Th>
                    <Th align="right">Today's Price</Th>
                    <Th align="right">1 Month</Th>
                    <Th align="right">1 Year</Th>
                    <Th align="right">vs Your Funds</Th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonFunds.map((cf) => {
                    const hasPct = cf.change_1m_pct !== null && cf.your_avg_1m_pct !== null;
                    const outperforms = hasPct && cf.change_1m_pct! > cf.your_avg_1m_pct!;
                    const diff = hasPct ? (cf.change_1m_pct! - cf.your_avg_1m_pct!).toFixed(2) : null;
                    return (
                      <tr key={cf.isin} style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
                        <td style={{ ...td, fontWeight: 600, color: NAVY, maxWidth: "220px" }}>{cf.fund_name}</td>
                        <td style={{ ...td, fontSize: "13px", color: SLATE }}>{cf.risk_level ?? "—"}</td>
                        <td style={{ ...td, fontSize: "13px", color: SLATE }}>{cf.style ?? "—"}</td>
                        <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {cf.price_today !== null ? `£${Number(cf.price_today).toFixed(4)}` : "—"}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          {cf.change_1m_pct !== null ? (
                            <span style={{
                              fontSize: "12px", fontWeight: 700,
                              padding: "2px 7px", borderRadius: RADII.PILL,
                              color: cf.change_1m_pct >= 0 ? COLOURS.GREEN : COLOURS.RED,
                              backgroundColor: cf.change_1m_pct >= 0 ? COLOURS.SUCCESS_SOFT : COLOURS.DANGER_SOFT,
                            }}>
                              {cf.change_1m_pct >= 0 ? "▲" : "▼"} {Math.abs(cf.change_1m_pct).toFixed(2)}%
                            </span>
                          ) : "—"}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          {cf.change_1y_pct !== null ? (
                            <span style={{
                              fontSize: "12px", fontWeight: 700,
                              padding: "2px 7px", borderRadius: RADII.PILL,
                              color: cf.change_1y_pct >= 0 ? COLOURS.GREEN : COLOURS.RED,
                              backgroundColor: cf.change_1y_pct >= 0 ? COLOURS.SUCCESS_SOFT : COLOURS.DANGER_SOFT,
                            }}>
                              {cf.change_1y_pct >= 0 ? "▲" : "▼"} {Math.abs(cf.change_1y_pct).toFixed(2)}%
                            </span>
                          ) : "—"}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          {hasPct ? (
                            <span style={{
                              fontSize: "12px", fontWeight: 700,
                              padding: "2px 7px", borderRadius: RADII.PILL,
                              color: outperforms ? COLOURS.GREEN : COLOURS.RED,
                              backgroundColor: outperforms ? COLOURS.SUCCESS_SOFT : COLOURS.DANGER_SOFT,
                            }}>
                              {outperforms ? "Better ▲" : "Lower ▼"} {diff && Math.abs(Number(diff)).toFixed(2)}%
                            </span>
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{
            fontSize: "12px", color: SLATE,
            borderLeft: `3px solid ${HAIRLINE}`,
            paddingLeft: "10px", marginTop: "8px",
          }}>
            Performance data for reference only. Consult an Aviva adviser before switching funds.
          </div>
        </div>
      </main>
    </AuthWrapper>
  );
}

function PensionMetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      border: `1px solid ${COLOURS.HAIRLINE}`,
      borderTop: `3px solid ${color}`,
      borderRadius: "8px",
      padding: "12px 14px",
      backgroundColor: "var(--bg-card, #fff)",
    }}>
      <div style={{ fontSize: "11px", color: SLATE, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "4px", fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: "20px", fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function SummaryCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{
      border: `1px solid var(--border-color, ${COLOURS.HAIRLINE})`, borderTop: `3px solid ${color}`,
      borderRadius: "8px", padding: "10px 14px",
      backgroundColor: "var(--bg-card, #fff)",
    }}>
      <div style={{ color: `var(--text-secondary, ${COLOURS.SLATE})`, fontSize: "15px", marginBottom: "2px" }}>{label}</div>
      <div style={{ fontSize: "20px", fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: "15px", color: `var(--text-secondary, ${COLOURS.SLATE})`, marginTop: "2px" }}>{sub}</div>}
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th style={{
      textAlign: align || "left", borderBottom: `1px solid var(--border-color, ${COLOURS.HAIRLINE})`,
      padding: "6px 10px", fontSize: "14px", color: `var(--text-secondary, ${COLOURS.SLATE})`, fontWeight: 700,
      whiteSpace: "nowrap",
    }}>{children}</th>
  );
}

const td: React.CSSProperties = {
  padding: "7px 10px", fontSize: "15px",
};

const inputStyle: React.CSSProperties = {
  padding: "8px 10px", border: `1px solid var(--border-color, ${COLOURS.HAIRLINE})`,
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

const divTd: React.CSSProperties = {
  padding: "7px 10px", fontSize: "13px",
};

const miniConfirmBtn: React.CSSProperties = {
  color: "white", border: "none", borderRadius: "4px",
  padding: "3px 10px", fontSize: "12px", fontWeight: 700, cursor: "pointer",
};
