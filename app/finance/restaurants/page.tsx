"use client";

// ─────────────────────────────────────────────────────────────────────────
// Restaurants P&L — Baranh + Haute Dolci (built 28/07/2026, same family as
// the Unze and Imperial P&L pages). One page, one tab per company; K&K
// Jhang is parked but slots in as a third COMPANY_TABS entry when ready.
// The restaurant files carry ACTUALS only (no budget), so this follows the
// Unze trend style; the signature restaurant metric — food cost % of net
// sales — gets first-class treatment. Filter bar drives every card.
// Layout: tabs → filter bar → attention → KPI cards → sales & profit chart
// + margin health → branch league → expense watch + CEO commentary →
// data-quality strip (clickable) with restaurant market context.
// All aggregation in Postgres RPCs (migration 151); workbook parsed in the
// browser and posted as JSON (Vercel body cap), like Imperial.
// ─────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, LineChart, Line, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, ReferenceLine } from "recharts";
import AuthWrapper from "../../lib/AuthWrapper";
import { supabase } from "../../lib/supabase";
import { COLOURS, RADII, cardStyle, PageHeader, SkeletonRows } from "../../lib/SharedUI";
import { useRequireCapability } from "../../lib/useRouteGuard";
import { useUserCtx } from "../../lib/useUserCtx";
import { widgetVisible } from "../../lib/permissions";
import { formatDateUK } from "../../lib/dateUtils";
import type { RestCompany } from "../../lib/excel-parsers/pnl-restaurant-parser";

type KpiRow = {
  month: string;
  net_sales: number; total_cogs: number; gross_profit: number;
  admin_expenses: number; op_profit: number; net_profit: number;
};
type LeagueRow = { branch: string; net_sales: number; gross_profit: number; net_profit: number };
type LineTotal = { line: string; category: string; amount: number };
type ValidationRow = { month: string; file_name: string; status: string; checks_passed: number; checks_failed: number; warnings: number; uploaded_at: string };
type CheckIssue = { month: string; check_name: string; expected: number; reported: number; diff: number; blocking: boolean; status: string };
type CheckDetail = { name: string; expected: number; reported: number; diff: number; blocking: boolean };
type RestatedItem = { scope: string; line: string; old_value: number; new_value: number };
type UploadResult = { month: string; accepted: boolean; summary: string; failed?: CheckDetail[]; warnings?: CheckDetail[]; restated?: RestatedItem[] };
type Insight = { title: string; detail: string; severity: "good" | "watch" | "urgent" };

const COMPANY_TABS: { key: RestCompany; label: string }[] = [
  { key: "BARANH", label: "Baranh" },
  { key: "HD", label: "Haute Dolci" },
];

const MONTH_LABEL = (m: string) => {
  const d = new Date(m + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
};
const fmtM = (n: number | null | undefined) => {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return (Math.round((n / 1_000_000) * 10) / 10).toLocaleString() + "m";
};
const fmtPct = (n: number) => (Math.round(n * 10) / 10) + "%";
const toM = (n: number) => Math.round(n / 100_000) / 10;

const PRESETS = ["Month", "Quarter", "12M", "All", "Custom"] as const;
type Preset = typeof PRESETS[number];

async function authedFetch(url: string, opts: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${session?.access_token}` } });
}

const chipBtn = (active: boolean): React.CSSProperties => ({
  padding: "5px 13px",
  borderRadius: RADII.PILL,
  border: `1px solid ${active ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
  background: active ? COLOURS.NAVY : COLOURS.CARD,
  color: active ? "white" : COLOURS.INK_700,
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
});
const sectionTitle: React.CSSProperties = { fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY };
const sectionCaption: React.CSSProperties = { fontSize: "11px", color: COLOURS.INK_400, marginBottom: "8px", marginTop: "2px" };

export default function RestaurantsPnlPage() {
  const { checking } = useRequireCapability("restaurants_pnl");
  const { ctx } = useUserCtx();
  const show = (key: string) => !ctx || widgetVisible(ctx, key, true);

  const [company, setCompany] = useState<RestCompany>("BARANH");
  const [loading, setLoading] = useState(true);
  const [allMonths, setAllMonths] = useState<string[]>([]);
  const [kpiRows, setKpiRows] = useState<KpiRow[]>([]);
  const [league, setLeague] = useState<LeagueRow[]>([]);
  const [lineTotals, setLineTotals] = useState<LineTotal[]>([]);
  const [validationRows, setValidationRows] = useState<ValidationRow[]>([]);

  const [branchFilter, setBranchFilter] = useState("All");
  const [preset, setPreset] = useState<Preset>("12M");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [insights, setInsights] = useState<Insight[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [insightError, setInsightError] = useState("");
  const [showMarket, setShowMarket] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [showRestatements, setShowRestatements] = useState(false);
  const [restatements, setRestatements] = useState<(RestatedItem & { month: string; changed_by: string; changed_at: string })[] | null>(null);
  const [checkIssues, setCheckIssues] = useState<CheckIssue[] | null>(null);

  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);

  const { monthFrom, monthTo } = useMemo(() => {
    if (allMonths.length === 0) return { monthFrom: "", monthTo: "" };
    const last = allMonths[allMonths.length - 1];
    if (preset === "Custom") return { monthFrom: customFrom || allMonths[0], monthTo: customTo || last };
    const n = preset === "Month" ? 1 : preset === "Quarter" ? 3 : preset === "12M" ? 12 : allMonths.length;
    return { monthFrom: allMonths[Math.max(0, allMonths.length - n)], monthTo: last };
  }, [allMonths, preset, customFrom, customTo]);

  // Month list per company tab.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setBranchFilter("All");
    setCustomFrom("");
    setCustomTo("");
    setUploadResults([]);
    setShowIssues(false);
    setCheckIssues(null);
    setShowRestatements(false);
    setRestatements(null);
    async function loadAll() {
      const { data } = await supabase.rpc("rest_kpi_by_month", { p_company: company, p_from: "2000-01-01", p_to: "2100-01-01", p_branch: "All" });
      if (!active) return;
      setAllMonths(((data || []) as KpiRow[]).map((r) => r.month));
      setLoading(false);
    }
    loadAll();
    return () => { active = false; };
  }, [company]);

  // Main load on any filter change.
  useEffect(() => {
    if (!monthFrom || !monthTo) return;
    let active = true;
    async function load() {
      const [kpiRes, leagueRes, lineRes, valRes] = await Promise.all([
        supabase.rpc("rest_kpi_by_month", { p_company: company, p_from: monthFrom, p_to: monthTo, p_branch: branchFilter }),
        supabase.rpc("rest_branch_league", { p_company: company, p_from: monthFrom, p_to: monthTo }),
        supabase.rpc("rest_line_totals", { p_company: company, p_from: monthFrom, p_to: monthTo, p_branch: branchFilter }),
        supabase.rpc("rest_validation_summary", { p_company: company }),
      ]);
      if (!active) return;
      setKpiRows((kpiRes.data || []) as KpiRow[]);
      setLeague((leagueRes.data || []) as LeagueRow[]);
      setLineTotals((lineRes.data || []) as LineTotal[]);
      setValidationRows((valRes.data || []) as ValidationRow[]);
    }
    load();
    return () => { active = false; };
  }, [company, monthFrom, monthTo, branchFilter]);

  // Saved AI commentary for this exact company + branch + period.
  useEffect(() => {
    if (!monthFrom || !monthTo) return;
    let active = true;
    async function loadSaved() {
      const { data } = await supabase.rpc("get_pnl_commentary", { p_company: company, p_scope: branchFilter, p_from: monthFrom, p_to: monthTo });
      if (!active) return;
      const row = data && data[0];
      setInsights((row?.insights || []) as Insight[]);
      setActions((row?.actions || []) as string[]);
      setGeneratedAt(row?.generated_at || null);
      setInsightError("");
    }
    loadSaved();
    return () => { active = false; };
  }, [company, monthFrom, monthTo, branchFilter]);

  async function toggleIssues() {
    const next = !showIssues;
    setShowIssues(next);
    if (next && checkIssues === null) {
      const { data } = await supabase.rpc("rest_check_details", { p_company: company });
      setCheckIssues((data || []) as CheckIssue[]);
    }
  }

  async function toggleRestatements() {
    const next = !showRestatements;
    setShowRestatements(next);
    if (next && restatements === null) {
      const { data } = await supabase.rpc("get_pnl_restatements", { p_company: company, p_limit: 100 });
      setRestatements((data || []) as (RestatedItem & { month: string; changed_by: string; changed_at: string })[]);
    }
  }

  async function handleUpload() {
    if (!uploadFile) return;
    setUploading(true);
    setUploadResults([]);
    try {
      const bytes = await uploadFile.arrayBuffer();
      const { parseRestaurantPnl } = await import("../../lib/excel-parsers/pnl-restaurant-parser");
      const months = parseRestaurantPnl(bytes, company);
      if (months.length === 0) {
        setUploadResults([{ month: "", accepted: false, summary: "No months with activity found — is this the right workbook?" }]);
        return;
      }
      const res = await authedFetch("/api/pnl/upload-restaurants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: uploadFile.name, company, months }),
      });
      let body: { results?: UploadResult[]; error?: string } = {};
      try { body = await res.json(); } catch { /* non-JSON error page */ }
      if (!res.ok) {
        setUploadResults([{ month: "", accepted: false, summary: body.error || `Upload failed (${res.status})` }]);
        return;
      }
      const detail = (month: string, blocking: boolean) => {
        const m = months.find((x) => x.month === month);
        return (m?.checks || [])
          .filter((c) => !c.passed && c.blocking === blocking)
          .map((c) => ({ name: c.name, expected: c.expected, reported: c.reported, diff: c.diff, blocking: c.blocking }));
      };
      setUploadResults(((body.results || []) as UploadResult[]).map((r) => ({
        ...r,
        failed: detail(r.month, true),
        warnings: detail(r.month, false),
      })));
      setCheckIssues(null);
      const { data } = await supabase.rpc("rest_kpi_by_month", { p_company: company, p_from: "2000-01-01", p_to: "2100-01-01", p_branch: "All" });
      setAllMonths(((data || []) as KpiRow[]).map((r) => r.month));
    } catch (err) {
      setUploadResults([{ month: "", accepted: false, summary: err instanceof Error ? err.message : "Could not read this file" }]);
    } finally {
      setUploading(false);
      setUploadFile(null);
    }
  }

  async function generateInsights() {
    setGenerating(true);
    setInsightError("");
    try {
      const res = await authedFetch("/api/pnl/ceo-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, from: monthFrom, to: monthTo, branch: branchFilter }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to generate commentary");
      setInsights((body.insights || []) as Insight[]);
      setActions((body.actions || []) as string[]);
      setGeneratedAt(body.generated_at || new Date().toISOString());
    } catch (err) {
      setInsightError(err instanceof Error ? err.message : "Failed to generate commentary");
    }
    setGenerating(false);
  }

  if (checking) return null;

  /* ── Derived data (shaping only) ── */

  const companyLabel = COMPANY_TABS.find((t) => t.key === company)?.label || company;
  const branchOptions = ["All", ...league.map((l) => l.branch)];

  const latest = kpiRows[kpiRows.length - 1];
  const prev = kpiRows[kpiRows.length - 2];
  const totSales = kpiRows.reduce((s, r) => s + r.net_sales, 0);
  const totCogs = kpiRows.reduce((s, r) => s + r.total_cogs, 0);
  const totAdmin = kpiRows.reduce((s, r) => s + r.admin_expenses, 0);
  const totNp = kpiRows.reduce((s, r) => s + r.net_profit, 0);
  const latestFoodCost = latest && latest.net_sales ? (latest.total_cogs / latest.net_sales) * 100 : null;
  const periodFoodCost = totSales ? (totCogs / totSales) * 100 : null;

  let lossStreak = 0;
  for (let i = kpiRows.length - 1; i >= 0; i--) {
    if (kpiRows[i].net_profit < 0) lossStreak++;
    else break;
  }
  const lossBranches = league.filter((l) => l.net_profit < -100_000).sort((a, b) => a.net_profit - b.net_profit);
  const attention: string[] = [];
  if (lossStreak >= 2) attention.push(`${lossStreak} consecutive loss months${branchFilter !== "All" ? ` (${branchFilter})` : ""}, ${fmtM(kpiRows.slice(-lossStreak).reduce((s, r) => s + r.net_profit, 0))} cumulative`);
  else if (latest && latest.net_profit < 0) attention.push(`${MONTH_LABEL(latest.month)} was loss-making (${fmtM(latest.net_profit)})`);
  if (branchFilter === "All" && lossBranches.length > 0) attention.push(`${lossBranches.length} branch${lossBranches.length > 1 ? "es" : ""} loss-making over the period (worst: ${lossBranches[0].branch} ${fmtM(lossBranches[0].net_profit)})`);
  if (latestFoodCost !== null && periodFoodCost !== null && kpiRows.length >= 3 && latestFoodCost > periodFoodCost + 3) {
    attention.push(`Food cost ${fmtPct(latestFoodCost)} in ${MONTH_LABEL(latest.month)} vs ${fmtPct(periodFoodCost)} period average`);
  }

  const chartData = kpiRows.map((r) => ({
    month: MONTH_LABEL(r.month),
    sales: toM(r.net_sales),
    profit: toM(r.net_profit),
    loss: r.net_profit < 0,
    gpPct: r.net_sales ? Math.round((r.gross_profit / r.net_sales) * 1000) / 10 : null,
    foodPct: r.net_sales ? Math.round((r.total_cogs / r.net_sales) * 1000) / 10 : null,
  }));

  const maxLeagueSales = Math.max(1, ...league.map((l) => l.net_sales));
  const foodChip = (pct: number | null) => {
    if (pct === null) return { bg: COLOURS.TRACK, fg: COLOURS.SLATE, label: "—" };
    if (pct <= 42) return { bg: COLOURS.SUCCESS_SOFT, fg: COLOURS.GREEN, label: fmtPct(pct) };
    if (pct <= 50) return { bg: COLOURS.WARNING_SOFT, fg: COLOURS.AMBER, label: fmtPct(pct) };
    return { bg: COLOURS.DANGER_SOFT, fg: COLOURS.RED, label: fmtPct(pct) };
  };

  const expenseLines = lineTotals.filter((l) => l.category === "expense" && l.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 8);
  const maxExpense = Math.max(1, ...expenseLines.map((l) => l.amount));
  const belowLines = lineTotals.filter((l) => l.category.startsWith("below"));

  const allValidated = validationRows.length > 0 && validationRows.every((v) => v.status === "accepted");
  const totalWarnings = validationRows.reduce((s, v) => s + (v.warnings || 0), 0);

  const severityColour = (s: Insight["severity"]) => s === "good" ? COLOURS.GREEN : s === "watch" ? COLOURS.AMBER : COLOURS.RED;
  const severitySoft = (s: Insight["severity"]) => s === "good" ? COLOURS.SUCCESS_SOFT : s === "watch" ? COLOURS.WARNING_SOFT : COLOURS.DANGER_SOFT;

  const monthSelect = (value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ padding: "5px 9px", borderRadius: RADII.SM, border: `1px solid ${COLOURS.HAIRLINE}`, fontSize: "12px" }}>
      {allMonths.map((m) => <option key={m} value={m}>{MONTH_LABEL(m)}</option>)}
    </select>
  );

  return (
    <AuthWrapper>
      <main style={{ padding: "14px 18px", maxWidth: "1100px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "12px" }}>
          <PageHeader />
          <button onClick={() => { setShowUpload(!showUpload); setUploadResults([]); }} style={chipBtn(showUpload)}>
            {showUpload ? "Close upload" : `Upload ${companyLabel} workbook`}
          </button>
        </div>

        {/* Company tabs */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
          {COMPANY_TABS.map((t) => (
            <button key={t.key} style={{ ...chipBtn(company === t.key), fontSize: "13px", padding: "7px 18px" }} onClick={() => setCompany(t.key)}>{t.label}</button>
          ))}
        </div>

        {showUpload && (
          <div style={{ ...cardStyle, marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <input type="file" accept=".xlsx" onChange={(e) => setUploadFile((e.target.files || [])[0] || null)} style={{ fontSize: "13px" }} />
              <button
                onClick={handleUpload}
                disabled={!uploadFile || uploading}
                style={{ ...chipBtn(true), opacity: !uploadFile || uploading ? 0.5 : 1, cursor: !uploadFile || uploading ? "not-allowed" : "pointer" }}
              >
                {uploading ? "Checking every month…" : `Upload for ${companyLabel}`}
              </button>
              <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>
                Upload the full {companyLabel} workbook — every month in it is validated and refreshed. Wrong-company files are rejected.
              </span>
            </div>
            {uploadResults.map((r, i) => (
              <div key={i} style={{ marginTop: "8px", padding: "8px 12px", borderRadius: RADII.SM, background: r.accepted ? COLOURS.SUCCESS_SOFT : COLOURS.DANGER_SOFT }}>
                <div style={{ fontSize: "12px", fontWeight: 600, color: r.accepted ? COLOURS.GREEN : COLOURS.RED }}>
                  {r.month ? MONTH_LABEL(r.month) + " — " : ""}{r.accepted ? "Accepted — " : "Rejected — "}{r.summary}
                </div>
                {(r.failed || []).length > 0 && (
                  <div style={{ fontSize: "12px", color: COLOURS.RED, lineHeight: 1.6, marginTop: "4px" }}>
                    {(r.failed || []).map((c, j) => (
                      <div key={j}>✗ {c.name}{c.expected || c.reported ? <>: should be {fmtM(c.expected)}, file shows {fmtM(c.reported)} (out by {fmtM(c.diff)})</> : null}</div>
                    ))}
                  </div>
                )}
                {(r.restated || []).length > 0 && (
                  <div style={{ fontSize: "12px", color: COLOURS.BLUE, lineHeight: 1.6, marginTop: "4px", fontWeight: 600 }}>
                    <div>Financial change to previously reported figures:</div>
                    {(r.restated || []).map((c, j) => (
                      <div key={j}>↺ {c.scope} {c.line}: {fmtM(c.old_value)} → {fmtM(c.new_value)}</div>
                    ))}
                  </div>
                )}
                {(r.warnings || []).length > 0 && (
                  <div style={{ fontSize: "12px", color: COLOURS.AMBER, lineHeight: 1.6, marginTop: "4px" }}>
                    {(r.warnings || []).map((c, j) => (
                      <div key={j}>⚠ {c.name}{c.expected || c.reported ? <>: should be {fmtM(c.expected)}, file shows {fmtM(c.reported)} (out by {fmtM(c.diff)})</> : null} — accepted anyway, worth checking</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <SkeletonRows count={4} />
        ) : allMonths.length === 0 ? (
          <div style={cardStyle}>
            <p style={{ color: COLOURS.SLATE, fontSize: "14px" }}>
              No {companyLabel} P&L data yet — press &quot;Upload {companyLabel} workbook&quot; and select the file.
            </p>
          </div>
        ) : (
          <>
            {/* ── Filter bar ── */}
            <div style={{ ...cardStyle, padding: "10px 14px", marginBottom: "10px", position: "sticky", top: 0, zIndex: 10 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", alignItems: "center" }}>
                <span style={{ fontSize: "11px", color: COLOURS.SLATE, fontWeight: 600 }}>BRANCH</span>
                {branchOptions.map((b) => (
                  <button key={b} style={chipBtn(branchFilter === b)} onClick={() => setBranchFilter(b)}>{b}</button>
                ))}
                <span style={{ width: "1px", height: "18px", background: COLOURS.HAIRLINE, margin: "0 3px" }} />
                <span style={{ fontSize: "11px", color: COLOURS.SLATE, fontWeight: 600 }}>PERIOD</span>
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    style={chipBtn(preset === p)}
                    onClick={() => {
                      setPreset(p);
                      if (p === "Custom" && !customFrom && allMonths.length > 0) {
                        setCustomFrom(allMonths[Math.max(0, allMonths.length - 12)]);
                        setCustomTo(allMonths[allMonths.length - 1]);
                      }
                    }}
                  >
                    {p}
                  </button>
                ))}
                {preset === "Custom" && (
                  <>
                    {monthSelect(customFrom, setCustomFrom)}
                    <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>to</span>
                    {monthSelect(customTo, setCustomTo)}
                  </>
                )}
              </div>
              <div style={{ fontSize: "11px", color: COLOURS.INK_400, marginTop: "5px" }}>
                {companyLabel} · {branchFilter === "All" ? "all branches" : branchFilter} · {MONTH_LABEL(monthFrom)} to {MONTH_LABEL(monthTo)} — every card obeys these filters
              </div>
            </div>

            {/* ── Attention banner ── */}
            {show("restaurants_pnl.attention_banner") && attention.length > 0 && (
              <div style={{ ...cardStyle, marginBottom: "10px", background: COLOURS.DANGER_SOFT, border: `1px solid ${COLOURS.RED}` }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.RED, marginBottom: "3px" }}>Needs your attention</div>
                <div style={{ fontSize: "12px", color: COLOURS.INK_700, lineHeight: 1.6 }}>{attention.join(" · ")}</div>
              </div>
            )}

            {/* ── KPI cards ── */}
            {show("restaurants_pnl.kpi_cards") && latest && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px", marginBottom: "10px" }}>
                <div style={{ ...cardStyle, padding: "10px 12px" }}>
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Net sales — {MONTH_LABEL(latest.month)}</div>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: COLOURS.NAVY }}>{fmtM(latest.net_sales)}</div>
                  {prev && (
                    <div style={{ fontSize: "11px", color: latest.net_sales >= prev.net_sales ? COLOURS.GREEN : COLOURS.RED }}>
                      {latest.net_sales >= prev.net_sales ? "▲" : "▼"} {fmtM(Math.abs(latest.net_sales - prev.net_sales))} vs {MONTH_LABEL(prev.month)}
                    </div>
                  )}
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Period: {fmtM(totSales)}</div>
                </div>
                <div style={{ ...cardStyle, padding: "10px 12px" }}>
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Food cost % — {MONTH_LABEL(latest.month)}</div>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: latestFoodCost !== null && latestFoodCost > 50 ? COLOURS.RED : COLOURS.NAVY }}>{latestFoodCost === null ? "—" : fmtPct(latestFoodCost)}</div>
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Period: {periodFoodCost === null ? "—" : fmtPct(periodFoodCost)} · healthy ≤ 42%</div>
                </div>
                <div style={{ ...cardStyle, padding: "10px 12px" }}>
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Admin expenses — {MONTH_LABEL(latest.month)}</div>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: COLOURS.NAVY }}>{fmtM(latest.admin_expenses)}</div>
                  {prev && (
                    <div style={{ fontSize: "11px", color: latest.admin_expenses <= prev.admin_expenses ? COLOURS.GREEN : COLOURS.RED }}>
                      {latest.admin_expenses <= prev.admin_expenses ? "▼" : "▲"} {fmtM(Math.abs(latest.admin_expenses - prev.admin_expenses))} vs {MONTH_LABEL(prev.month)}
                    </div>
                  )}
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Period: {fmtM(totAdmin)}</div>
                </div>
                <div style={{ ...cardStyle, padding: "10px 12px" }}>
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Net profit — {MONTH_LABEL(latest.month)}</div>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: latest.net_profit >= 0 ? COLOURS.GREEN : COLOURS.RED }}>{latest.net_profit >= 0 ? "+" : ""}{fmtM(latest.net_profit)}</div>
                  <div style={{ fontSize: "11px", color: totNp >= 0 ? COLOURS.SLATE : COLOURS.RED }}>Period total: {totNp >= 0 ? "+" : ""}{fmtM(totNp)}</div>
                </div>
              </div>
            )}

            {/* ── Charts ── */}
            {show("restaurants_pnl.charts") && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "10px", marginBottom: "10px" }}>
                <div style={cardStyle}>
                  <div style={sectionTitle}>Net sales and net profit by month</div>
                  <div style={sectionCaption}>Bars = net sales (red = loss month) · line = net profit</div>
                  <div style={{ height: "210px" }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.HAIRLINE} />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <ReferenceLine y={0} stroke={COLOURS.SLATE} />
                        <Bar dataKey="sales" name="Net sales (m)">
                          {chartData.map((d, i) => <Cell key={i} fill={d.loss ? COLOURS.RED : COLOURS.BLUE} fillOpacity={d.loss ? 0.7 : 0.85} />)}
                        </Bar>
                        <Line type="monotone" dataKey="profit" name="Net profit (m)" stroke={COLOURS.NAVY} strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div style={cardStyle}>
                  <div style={sectionTitle}>Margin health</div>
                  <div style={sectionCaption}>Gross margin % (amber) vs food cost % of net sales (red)</div>
                  <div style={{ height: "210px" }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.HAIRLINE} />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} unit="%" />
                        <Tooltip />
                        <ReferenceLine y={42} stroke={COLOURS.RED} strokeDasharray="4 4" label={{ value: "42% food cost target", fontSize: 10, fill: COLOURS.RED }} />
                        <Line type="monotone" dataKey="gpPct" name="Gross margin %" stroke={COLOURS.AMBER} strokeWidth={2} dot={false} connectNulls />
                        <Line type="monotone" dataKey="foodPct" name="Food cost %" stroke={COLOURS.RED} strokeWidth={2} dot={false} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* ── Branch league ── */}
            {show("restaurants_pnl.branch_league") && league.length > 0 && (
              <div style={{ ...cardStyle, marginBottom: "10px" }}>
                <div style={sectionTitle}>Branch league — {MONTH_LABEL(monthFrom)} to {MONTH_LABEL(monthTo)}</div>
                <div style={sectionCaption}>Click a row to filter the whole page to that branch · food cost chip: green ≤42%, amber ≤50%</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse", minWidth: "540px" }}>
                    <thead>
                      <tr style={{ color: COLOURS.SLATE, textAlign: "left", fontSize: "11px" }}>
                        <th style={{ fontWeight: 600, padding: "4px 0", width: "120px" }}>Branch</th>
                        <th style={{ fontWeight: 600, width: "190px" }}>Net sales</th>
                        <th style={{ fontWeight: 600, width: "95px" }}>Food cost</th>
                        <th style={{ fontWeight: 600, width: "85px" }}>GP %</th>
                        <th style={{ fontWeight: 600 }}>Net profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {league.map((r) => {
                        const food = r.net_sales ? ((r.net_sales - r.gross_profit) / r.net_sales) * 100 : null;
                        const chip = foodChip(food);
                        const gp = r.net_sales ? (r.gross_profit / r.net_sales) * 100 : null;
                        const selected = branchFilter === r.branch;
                        return (
                          <tr
                            key={r.branch}
                            onClick={() => setBranchFilter(selected ? "All" : r.branch)}
                            style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, cursor: "pointer", background: selected ? COLOURS.INFO_SOFT : r.net_profit < -100_000 ? COLOURS.WARNING_SOFT : "transparent" }}
                          >
                            <td style={{ padding: "8px 0", fontWeight: 700 }}>{r.branch}</td>
                            <td>
                              {fmtM(r.net_sales)}{" "}
                              <span style={{ display: "inline-block", background: COLOURS.BLUE, height: "5px", width: `${Math.max(2, Math.round((r.net_sales / maxLeagueSales) * 90))}px`, borderRadius: "3px", verticalAlign: "middle" }} />
                            </td>
                            <td><span style={{ background: chip.bg, color: chip.fg, borderRadius: RADII.PILL, padding: "2px 9px", fontSize: "12px", fontWeight: 600 }}>{chip.label}</span></td>
                            <td style={{ color: COLOURS.INK_700 }}>{gp === null ? "—" : fmtPct(gp)}</td>
                            <td style={{ color: r.net_profit >= 0 ? COLOURS.GREEN : COLOURS.RED, fontWeight: 600 }}>{r.net_profit >= 0 ? "+" : ""}{fmtM(r.net_profit)}</td>
                          </tr>
                        );
                      })}
                      <tr style={{ borderTop: `2px solid ${COLOURS.NAVY}`, background: COLOURS.CARD_ALT }}>
                        <td style={{ padding: "8px 0", fontWeight: 700 }}>Whole company</td>
                        <td style={{ fontWeight: 700 }}>{fmtM(league.reduce((s, l) => s + l.net_sales, 0))}</td>
                        <td style={{ fontWeight: 700 }}>{(() => { const ns = league.reduce((s, l) => s + l.net_sales, 0); const gp = league.reduce((s, l) => s + l.gross_profit, 0); return ns ? fmtPct(((ns - gp) / ns) * 100) : "—"; })()}</td>
                        <td style={{ fontWeight: 700 }}>{(() => { const ns = league.reduce((s, l) => s + l.net_sales, 0); const gp = league.reduce((s, l) => s + l.gross_profit, 0); return ns ? fmtPct((gp / ns) * 100) : "—"; })()}</td>
                        <td style={{ color: league.reduce((s, l) => s + l.net_profit, 0) >= 0 ? COLOURS.GREEN : COLOURS.RED, fontWeight: 700 }}>
                          {(() => { const np = league.reduce((s, l) => s + l.net_profit, 0); return `${np >= 0 ? "+" : ""}${fmtM(np)}`; })()}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Expense watch + CEO commentary ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "10px", marginBottom: "10px" }}>
              {show("restaurants_pnl.expense_watch") && (
                <div style={cardStyle}>
                  <div style={sectionTitle}>Expense watch</div>
                  <div style={sectionCaption}>Largest admin expenses for the selected scope and period, as % of net sales</div>
                  {expenseLines.length === 0 && <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No expense activity in this selection.</p>}
                  {expenseLines.map((l) => (
                    <div key={l.line} style={{ marginBottom: "9px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "3px" }}>
                        <span>{l.line}</span>
                        <span>{fmtM(l.amount)}{totSales > 0 ? <span style={{ color: COLOURS.SLATE }}> · {fmtPct((l.amount / totSales) * 100)}</span> : null}</span>
                      </div>
                      <div style={{ background: COLOURS.TRACK, borderRadius: "3px", height: "5px" }}>
                        <div style={{ width: `${(l.amount / maxExpense) * 100}%`, background: COLOURS.BLUE, height: "5px", borderRadius: "3px" }} />
                      </div>
                    </div>
                  ))}
                  {belowLines.length > 0 && (
                    <div style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, marginTop: "8px", paddingTop: "6px", fontSize: "11px", color: COLOURS.SLATE }}>
                      Below the line: {belowLines.map((l) => `${l.line} ${fmtM(l.amount)}`).join(" · ")}
                    </div>
                  )}
                </div>
              )}
              {show("restaurants_pnl.commentary") && (
                <div style={cardStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={sectionTitle}>CEO commentary</div>
                    <button onClick={generateInsights} disabled={generating} style={{ ...chipBtn(true), opacity: generating ? 0.5 : 1, cursor: generating ? "not-allowed" : "pointer" }}>
                      {generating ? "Analysing…" : insights.length > 0 ? "Regenerate" : "Generate"}
                    </button>
                  </div>
                  <div style={sectionCaption}>
                    {generatedAt
                      ? `Saved analysis from ${formatDateUK(generatedAt.slice(0, 10))} for this exact period and scope — press Regenerate to refresh it`
                      : "Analysis of the selected branch and period, tied to restaurant market context — saved once generated"}
                  </div>
                  {insightError && <p style={{ fontSize: "12px", color: COLOURS.RED }}>{insightError}</p>}
                  {insights.length === 0 && !insightError && !generating && (
                    <p style={{ fontSize: "12px", color: COLOURS.SLATE }}>Press Generate — each run reads the live numbers for the current filters.</p>
                  )}
                  {insights.map((ins, i) => (
                    <div key={i} style={{ marginTop: "7px", padding: "8px 10px", borderRadius: RADII.SM, background: severitySoft(ins.severity) }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: severityColour(ins.severity) }}>{ins.title}</div>
                      <div style={{ fontSize: "12px", color: COLOURS.INK_700, lineHeight: 1.5 }}>{ins.detail}</div>
                    </div>
                  ))}
                  {actions.length > 0 && (
                    <div style={{ marginTop: "10px" }}>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.SLATE, marginBottom: "4px" }}>SUGGESTED ACTIONS</div>
                      {actions.map((a, i) => (
                        <div key={i} style={{ fontSize: "12px", color: COLOURS.INK_700, padding: "3px 0", borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>{i + 1}. {a}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Data quality strip + market context ── */}
            {show("restaurants_pnl.data_strip") && (
              <div style={{ ...cardStyle, marginBottom: "20px", padding: "10px 14px" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                  <span style={{ fontSize: "11px", color: COLOURS.SLATE, fontWeight: 600 }}>DATA</span>
                  {allValidated ? (
                    <span style={{ background: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN, borderRadius: RADII.PILL, padding: "2px 10px", fontSize: "11px", fontWeight: 600 }}>
                      ✓ {validationRows.length} months loaded and validated
                    </span>
                  ) : (
                    validationRows.filter((v) => v.status !== "accepted").map((v) => (
                      <button key={v.month} onClick={toggleIssues} style={{ background: COLOURS.DANGER_SOFT, color: COLOURS.RED, borderRadius: RADII.PILL, padding: "2px 10px", fontSize: "11px", fontWeight: 600, border: `1px solid ${COLOURS.RED}`, cursor: "pointer" }}>
                        {MONTH_LABEL(v.month)} rejected {showIssues ? "▲" : "▼"}
                      </button>
                    ))
                  )}
                  {totalWarnings > 0 && (
                    <button
                      onClick={toggleIssues}
                      style={{ background: COLOURS.WARNING_SOFT, color: COLOURS.AMBER, borderRadius: RADII.PILL, padding: "2px 10px", fontSize: "11px", fontWeight: 600, border: `1px solid ${COLOURS.AMBER}`, cursor: "pointer" }}
                    >
                      {totalWarnings} data-quality warning{totalWarnings > 1 ? "s" : ""} in the source file {showIssues ? "▲" : "▼"}
                    </button>
                  )}
                  {validationRows.length > 0 && (
                    <span style={{ fontSize: "11px", color: COLOURS.INK_400 }}>
                      Last upload {formatDateUK(validationRows[validationRows.length - 1].uploaded_at.slice(0, 10))}
                    </span>
                  )}
                  <span style={{ width: "1px", height: "16px", background: COLOURS.HAIRLINE, margin: "0 4px" }} />
                  <button onClick={toggleRestatements} style={{ ...chipBtn(showRestatements), padding: "3px 11px", fontSize: "11px" }}>
                    Restatement log {showRestatements ? "▲" : "▼"}
                  </button>
                  <button onClick={() => setShowMarket(!showMarket)} style={{ ...chipBtn(showMarket), padding: "3px 11px", fontSize: "11px" }}>
                    {showMarket ? "Hide market context" : "Market context"}
                  </button>
                </div>
                {showIssues && (
                  <div style={{ marginTop: "10px", borderTop: `1px solid ${COLOURS.HAIRLINE}`, paddingTop: "10px" }}>
                    {checkIssues === null && <p style={{ fontSize: "12px", color: COLOURS.SLATE }}>Loading…</p>}
                    {checkIssues !== null && checkIssues.length === 0 && (
                      <p style={{ fontSize: "12px", color: COLOURS.GREEN }}>All checks pass — nothing to fix.</p>
                    )}
                    {checkIssues !== null && checkIssues.length > 0 && (
                      <>
                        <div style={{ fontSize: "12px", color: COLOURS.INK_700, marginBottom: "8px" }}>
                          These are the source file&apos;s own inconsistencies. Fix the cells in the workbook and re-upload; each one clears automatically once its month passes.
                        </div>
                        {[...new Set(checkIssues.map((c) => c.month))].map((m) => (
                          <div key={m} style={{ marginBottom: "8px" }}>
                            <div style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.NAVY }}>{MONTH_LABEL(m)}</div>
                            {checkIssues.filter((c) => c.month === m).map((c, i) => (
                              <div key={i} style={{ fontSize: "12px", color: c.blocking ? COLOURS.RED : COLOURS.AMBER, lineHeight: 1.6, paddingLeft: "10px" }}>
                                {c.blocking ? "✗" : "⚠"} {c.check_name}{c.expected || c.reported ? <>: should be {fmtM(c.expected)}, file shows {fmtM(c.reported)} (out by {fmtM(c.diff)})</> : null}
                                {c.blocking ? " — month was rejected" : " — accepted, but worth correcting"}
                              </div>
                            ))}
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
                {showRestatements && (
                  <div style={{ marginTop: "10px", borderTop: `1px solid ${COLOURS.HAIRLINE}`, paddingTop: "10px" }}>
                    {restatements === null && <p style={{ fontSize: "12px", color: COLOURS.SLATE }}>Loading…</p>}
                    {restatements !== null && restatements.length === 0 && (
                      <p style={{ fontSize: "12px", color: COLOURS.GREEN }}>No restatements — previously reported figures have never been changed.</p>
                    )}
                    {restatements !== null && restatements.length > 0 && (<>
                      <div style={{ fontSize: "12px", color: COLOURS.INK_700, marginBottom: "8px" }}>
                        Every change made to previously reported figures — recorded automatically at upload; this log cannot be edited or deleted.
                      </div>
                      {restatements.map((r, i) => (
                        <div key={i} style={{ fontSize: "12px", color: COLOURS.INK_700, lineHeight: 1.7 }}>
                          ↺ <b>{MONTH_LABEL(r.month)}</b> · {r.scope} {r.line}: {fmtM(r.old_value)} → <b>{fmtM(r.new_value)}</b>
                          <span style={{ color: COLOURS.INK_400 }}> · by {r.changed_by || "unknown"} on {formatDateUK(r.changed_at.slice(0, 10))}</span>
                        </div>
                      ))}
                    </>)}
                  </div>
                )}
                {showMarket && (
                  <div style={{ fontSize: "12px", color: COLOURS.INK_700, lineHeight: 1.7, marginTop: "10px", borderTop: `1px solid ${COLOURS.HAIRLINE}`, paddingTop: "10px" }}>
                    <div style={{ fontWeight: 700, fontSize: "11px", color: COLOURS.GREEN, marginBottom: "3px" }}>DEMAND — TAILWINDS</div>
                    <div>· Dining out keeps growing in Pakistan — a young, urbanising population and premium-casual dining expanding fastest. (<a href="https://marketintelo.com/report/pakistani-restaurant-market" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>MarketIntelo</a>, <a href="https://www.6wresearch.com/industry-report/pakistan-food-service-restaurant-market" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>6Wresearch</a>)</div>
                    <div>· Restaurants &amp; hotels CPI eased to ~5-6% in late 2025 — pricing pressure is off its peak. (<a href="https://tradingeconomics.com/pakistan/inflation-cpi/news/506322" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>Trading Economics</a>)</div>
                    <div style={{ fontWeight: 700, fontSize: "11px", color: COLOURS.NAVY, margin: "8px 0 3px" }}>COMPETITIVE SET &amp; POSITIONING</div>
                    <div>· Both brands play in <b>casual/family dining</b> — the widest, most contested segment: every mall food court, mid-range chain and fast-food giant competes for the same family outing. Top-10 chains hold ~28% of the national market.</div>
                    <div>· <b>Haute Dolci is a UK franchise</b> (founded by Nizam Mohamed, East London; 10+ years of brand history) — premium dessert experience with five Lahore sites (Raya, Gulberg, Dolmen, Y-Block, Packages). Franchise economics cut both ways: brand pull and imported standards, but fees and spec costs sit in the P&amp;L whatever the sales. (<a href="https://hautedolci.co.uk/stores/pakistan/" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>Haute Dolci UK</a>)</div>
                    <div>· Baranh&apos;s Gulberg/Raya/Y-Block/Packages spread mirrors HD — the two brands share locations, so area-level softness (a slow mall, a road closure) hits both at once.</div>
                    <div style={{ fontWeight: 700, fontSize: "11px", color: COLOURS.NAVY, margin: "8px 0 3px" }}>CITY CONCENTRATION</div>
                    <div>· Everything is in <b>Lahore</b> — a single-city portfolio. Lahore&apos;s dining scene is Pakistan&apos;s most competitive, and its mall landscape just shifted: Dolmen Mall Lahore (the country&apos;s biggest) opened Dec-24, pulling footfall and raising the bar for older locations. Concentration is also an opportunity: one supply chain, one warehouse, one HO. (<a href="https://www.brecorder.com/news/2006789" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>BR mall economy</a>)</div>
                    <div style={{ fontWeight: 700, fontSize: "11px", color: COLOURS.RED, margin: "8px 0 3px" }}>COSTS — HEADWINDS</div>
                    <div>· Food cost inflation averaged ~8.6%/yr through 2025 — ingredient prices are the biggest margin lever; a healthy full-service food cost is 28-35% of net sales. (<a href="https://marketintelo.com/report/pakistani-restaurant-market" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>MarketIntelo</a>)</div>
                    <div>· Inflation still elevated (7–11% range through 2026), SBP rate 11.5% — wages, rent and utilities all climbing.</div>
                    <div>· Delivery platform commissions (visible as Food Panda charges in your own P&L) eat directly into branch margin.</div>
                    <div style={{ fontSize: "11px", color: COLOURS.INK_400, marginTop: "8px" }}>Researched 29/07/2026 — directional context, not live data.</div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </AuthWrapper>
  );
}
