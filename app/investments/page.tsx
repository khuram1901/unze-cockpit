"use client";

import React, { useEffect, useState, useCallback } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase, loadMyPermissions } from "../lib/supabase";
import { COLOURS, RADII, SectionTitle, PageHeader, kpiGrid, fixedCols } from "../lib/SharedUI";
import { useMobile } from "../lib/useMobile";
import { useRequireCapability } from "../lib/useRouteGuard";
import { canEditInvestments, canRefreshInvestmentPrices, type UserCtx, type PermOverrides } from "../lib/permissions";
import { formatDateUK } from "../lib/dateUtils";

const { NAVY, SLATE, GREEN, RED, BLUE, HAIRLINE } = COLOURS;

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

function InvestmentsPageInner() {
  const { checking } = useRequireCapability("investments");
  const isMobile = useMobile();

  const [canEdit, setCanEdit] = useState(false);
  const [canRefresh, setCanRefresh] = useState(false);

  // UK Pension state
  const [pensionSummary, setPensionSummary] = useState<PensionSummary | null>(null);
  const [pensionBreakdown, setPensionBreakdown] = useState<PensionFundBreakdown[]>([]);
  const [pensionMovement, setPensionMovement] = useState<PensionMovementRow[]>([]);
  const [gbpPkrRate, setGbpPkrRate] = useState<number>(0);
  const [pensionLoading, setPensionLoading] = useState(true);
  const [pensionRefreshing, setPensionRefreshing] = useState(false);
  const [pensionRefreshResult, setPensionRefreshResult] = useState<string | null>(null);
  // Manual pension price entry
  const [manualPensionModal, setManualPensionModal] = useState<string | null>(null); // isin
  const [manualPensionPrice, setManualPensionPrice] = useState("");

  // Comparison funds state
  const [comparisonFunds, setComparisonFunds] = useState<ComparisonFundRow[]>([]);

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

  async function handleRefreshPensionPrices() {
    if (!canRefresh) return;
    setPensionRefreshing(true);
    setPensionRefreshResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/investments/fetch-pension-prices", {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setPensionRefreshResult(`Error: ${json.error ?? "Unknown error"}`);
      } else {
        const updated = json.funds?.length ?? 0;
        const skipped = json.skipped?.length ?? 0;
        setPensionRefreshResult(
          updated > 0
            ? `Updated ${updated} fund price${updated !== 1 ? "s" : ""} from Morningstar.${skipped > 0 ? ` ${skipped} fund(s) could not be fetched — DB retains last known price.` : ""}`
            : `Could not fetch live prices (Morningstar API unavailable). DB retains last known prices. Enter prices manually below.`
        );
        await loadPensionData();
      }
    } catch {
      setPensionRefreshResult("Network error — please try again.");
    }
    setPensionRefreshing(false);
  }

  async function handleManualPensionPrice(isin: string) {
    if (!canEdit) return;
    const price = parseFloat(manualPensionPrice);
    if (isNaN(price) || price <= 0) return;
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from("pension_fund_prices").upsert(
      { isin, price_date: today, price_gbp: price, source: "manual" },
      { onConflict: "isin,price_date" }
    );
    setManualPensionModal(null);
    setManualPensionPrice("");
    await loadPensionData();
  }

  useEffect(() => {
    if (checking) return;
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
  }, [checking, loadPensionData]);

  // UK Pension values — all aggregation done in Postgres RPCs
  const pensionTotalGbp = pensionSummary?.total_value_gbp ?? 0;
  const pensionTotalPkr = pensionTotalGbp * gbpPkrRate;
  const pensionNetGain = pensionSummary?.net_gain_gbp ?? 0;
  const pensionReturnPct = pensionSummary?.return_pct ?? 0;
  const pensionLatestDate = pensionSummary?.last_price_date ?? null;

  if (checking) return null;

  return (
    <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%" }}>
      <PageHeader />

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
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "12px" }}>
          <span style={{ fontSize: "13px", color: SLATE }}>
            2 funds · Prices updated from Morningstar (weekdays) · GBP
          </span>
          {canRefresh && (
            <button
              onClick={handleRefreshPensionPrices}
              disabled={pensionRefreshing}
              style={{ ...btnStyle, fontSize: "13px", padding: "5px 12px", backgroundColor: BLUE }}
            >
              {pensionRefreshing ? "Fetching…" : "↻ Refresh Prices"}
            </button>
          )}
          {pensionRefreshResult && (
            <span style={{ fontSize: "13px", color: pensionRefreshResult.startsWith("Error") || pensionRefreshResult.includes("could not") || pensionRefreshResult.includes("unavailable") ? RED : GREEN }}>
              {pensionRefreshResult}
            </span>
          )}
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
              gridTemplateColumns: kpiGrid(200),
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
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", marginBottom: "6px" }}>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: NAVY, lineHeight: 1.4 }}>
                        {fund.fund_name}
                      </div>
                      {canEdit && (
                        <button
                          onClick={() => { setManualPensionModal(fund.isin); setManualPensionPrice(String(fund.price_gbp)); }}
                          style={{ ...miniBtn, fontSize: "12px", color: BLUE, whiteSpace: "nowrap", flexShrink: 0 }}
                          title="Enter price manually (from Aviva app)"
                        >
                          £ Edit
                        </button>
                      )}
                    </div>
                    {/* Manual price entry modal */}
                    {canEdit && manualPensionModal === fund.isin && (
                      <div style={{
                        display: "flex", gap: "6px", alignItems: "center",
                        marginBottom: "10px", padding: "8px 10px",
                        backgroundColor: "#EEF2FF", borderRadius: "8px",
                        border: `1px solid #C7D2FE`,
                      }}>
                        <span style={{ fontSize: "12px", fontWeight: 600, color: NAVY }}>Unit price £</span>
                        <input
                          type="number" step="0.0001" min="0"
                          placeholder="e.g. 2.4500"
                          value={manualPensionPrice}
                          onChange={(e) => setManualPensionPrice(e.target.value)}
                          style={{ ...inputStyle, width: "110px", padding: "4px 8px", fontSize: "13px" }}
                          autoFocus
                        />
                        <button onClick={() => handleManualPensionPrice(fund.isin)} style={{ ...btnStyle, padding: "4px 12px", fontSize: "13px" }}>Save</button>
                        <button onClick={() => { setManualPensionModal(null); setManualPensionPrice(""); }} style={{ ...btnStyle, backgroundColor: SLATE, padding: "4px 10px", fontSize: "13px" }}>✕</button>
                      </div>
                    )}
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
                        gridTemplateColumns: fixedCols("1fr 1fr 1fr 1fr 1fr"),
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
                        gridTemplateColumns: fixedCols("1fr 1fr 1fr 1fr 1fr"),
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
                Prices last updated: {formatDateUK(pensionLatestDate)} · Auto-fetched weekday mornings from Morningstar
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

export default function InvestmentsPage() {
  return (
    <AuthWrapper>
      <InvestmentsPageInner />
    </AuthWrapper>
  );
}
