"use client";

// ─────────────────────────────────────────────────────────────────────────
// Profit & Loss — Unze Trading CEO view (rebuilt 17/07/2026 to the mockup
// Khuram approved). This page is Unze Trading ONLY — Imperial Footwear will
// get its own page because it's accessed by different people.
//
// The one rule of this layout: the filter bar at the top drives EVERY card.
// Change plant or period and every number below recomputes (via the
// plant-aware RPCs in migration 143). Layout, in decision order:
//   filter bar → attention banner → KPI cards → sales & profit combo +
//   profit bridge → margin health + cost structure → plant scoreboard →
//   expense watch + CEO commentary → data quality / market context footer.
// All aggregation happens in Postgres RPCs; this file only shapes chart data.
// ─────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, ReferenceLine } from "recharts";
import AuthWrapper from "../../lib/AuthWrapper";
import { supabase } from "../../lib/supabase";
import { COLOURS, RADII, cardStyle, PageHeader, SkeletonRows } from "../../lib/SharedUI";
import { useRequireCapability } from "../../lib/useRouteGuard";
import { canEditFinance, financeCompanies } from "../../lib/permissions";
import { useUserCtx } from "../../lib/useUserCtx";
import { UTPL_COMPANY_ID } from "../../lib/constants";
import { formatDateUK } from "../../lib/dateUtils";

type KpiRow = {
  month: string;
  gross_sale: number;
  cost_of_sale: number;
  gross_profit: number;
  operating_expenses: number;
  taxation: number;
  net_profit_after_tax: number;
  non_operating: number;
  net_profit_final: number;
};
type ScoreRow = { plant: string; gross_sale: number; gross_profit: number; net_profit: number };
type PlantTrendRow = { month: string; plant: string; gross_sale: number; gross_profit: number };
type OverheadRow = { month: string; plant: string; account_group: string; amount: number };
type CostRow = { month: string; bucket: string; amount: number };
type ValidationRow = { month: string; file_name: string; status: string; checks_passed: number; checks_failed: number; uploaded_at: string };
type CheckRow = { name: string; expected: number; reported: number; diff: number; passed: boolean };
type Insight = { title: string; detail: string; severity: "good" | "watch" | "urgent" };

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

const PLANTS = ["All", "FEDMIC", "MEPCO", "PESCO", "HO"];
const PRESETS = ["1M", "3M", "6M", "12M", "All", "Custom"] as const;
type Preset = typeof PRESETS[number];

const COST_BUCKETS = ["Production / COGS", "Admin", "Selling & distribution", "Finance costs", "Other expenses"];
const BUCKET_COLOURS: Record<string, string> = {
  "Production / COGS": COLOURS.NAVY,
  "Admin": COLOURS.BLUE,
  "Selling & distribution": COLOURS.AMBER,
  "Finance costs": COLOURS.RED,
  "Other expenses": COLOURS.SLATE,
};

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

// Tiny inline sparkline for the plant scoreboard — margin % over the period.
function Sparkline({ values, colour }: { values: number[]; colour: string }) {
  if (values.length < 2) return <span style={{ fontSize: "11px", color: COLOURS.INK_400 }}>—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 96 + 2},${18 - ((v - min) / span) * 16}`).join(" ");
  return (
    <svg viewBox="0 0 100 20" width="90" height="20" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={colour} strokeWidth="1.5" />
    </svg>
  );
}

export default function ProfitAndLossPage() {
  const { checking } = useRequireCapability("finance");
  const { ctx } = useUserCtx();

  const scope = ctx ? financeCompanies(ctx) : "none";
  const hasUnze = scope === "both" || scope === "UTPL";
  const canUploadUnze = ctx ? canEditFinance(ctx) : false;
  const companyId = UTPL_COMPANY_ID;

  const [loading, setLoading] = useState(true);
  const [allMonths, setAllMonths] = useState<string[]>([]);
  const [kpiRows, setKpiRows] = useState<KpiRow[]>([]);
  const [scoreRows, setScoreRows] = useState<ScoreRow[]>([]);
  const [plantTrend, setPlantTrend] = useState<PlantTrendRow[]>([]);
  const [overheadRows, setOverheadRows] = useState<OverheadRow[]>([]);
  const [costRows, setCostRows] = useState<CostRow[]>([]);
  const [validationRows, setValidationRows] = useState<ValidationRow[]>([]);
  const [newFlags, setNewFlags] = useState<{ plant: string; account_group: string; amount: number }[]>([]);
  const [rpcsMissing, setRpcsMissing] = useState(false);

  const [plantFilter, setPlantFilter] = useState("All");
  const [preset, setPreset] = useState<Preset>("12M");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [showMarket, setShowMarket] = useState(false);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [insightError, setInsightError] = useState("");

  const [showUpload, setShowUpload] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<{ fileName: string; accepted: boolean; summary: string; checks: CheckRow[] }[]>([]);

  // The selected window, derived from the preset (or the custom pickers).
  const { monthFrom, monthTo } = useMemo(() => {
    if (allMonths.length === 0) return { monthFrom: "", monthTo: "" };
    const last = allMonths[allMonths.length - 1];
    if (preset === "Custom") {
      return { monthFrom: customFrom || allMonths[0], monthTo: customTo || last };
    }
    const n = preset === "1M" ? 1 : preset === "3M" ? 3 : preset === "6M" ? 6 : preset === "12M" ? 12 : allMonths.length;
    return { monthFrom: allMonths[Math.max(0, allMonths.length - n)], monthTo: last };
  }, [allMonths, preset, customFrom, customTo]);

  // Load the full month list once (sizes the presets and custom pickers).
  useEffect(() => {
    let active = true;
    async function loadAll() {
      if (!hasUnze) { if (active) setLoading(false); return; }
      setLoading(true);
      const { data } = await supabase.rpc("pnl_kpi_summary", { p_company_id: companyId, p_from: "2000-01-01", p_to: "2100-01-01" });
      if (!active) return;
      const rows = (data || []) as KpiRow[];
      setAllMonths(rows.map((r) => r.month));
      setLoading(false);
    }
    loadAll();
    return () => { active = false; };
  }, [companyId, hasUnze]);

  // Main load — refires when the filter bar changes anything.
  useEffect(() => {
    if (!hasUnze || !monthFrom || !monthTo) return;
    let active = true;
    async function load() {
      const [kpiRes, scoreRes, trendRes, ohRes, costRes, valRes, flagsRes] = await Promise.all([
        supabase.rpc("pnl_kpi_summary_plant", { p_company_id: companyId, p_from: monthFrom, p_to: monthTo, p_plant: plantFilter }),
        supabase.rpc("pnl_plant_scoreboard", { p_company_id: companyId, p_from: monthFrom, p_to: monthTo }),
        supabase.rpc("pnl_plant_margin_trend", { p_company_id: companyId, p_from: monthFrom, p_to: monthTo }),
        supabase.rpc("pnl_overheads_breakdown", { p_company_id: companyId, p_plant: plantFilter === "All" ? "All plants" : plantFilter, p_from: monthFrom, p_to: monthTo, p_allocate_ho: false }),
        supabase.rpc("pnl_cost_structure", { p_company_id: companyId, p_from: monthFrom, p_to: monthTo, p_plant: plantFilter }),
        supabase.rpc("pnl_validation_summary", { p_company_id: companyId }),
        supabase.rpc("pnl_new_account_flags", { p_company_id: companyId, p_month: monthTo }),
      ]);
      if (!active) return;
      setKpiRows((kpiRes.data || []) as KpiRow[]);
      setScoreRows((scoreRes.data || []) as ScoreRow[]);
      setPlantTrend((trendRes.data || []) as PlantTrendRow[]);
      setOverheadRows((ohRes.data || []) as OverheadRow[]);
      setCostRows((costRes.data || []) as CostRow[]);
      setValidationRows((valRes.data || []) as ValidationRow[]);
      setNewFlags((flagsRes.data || []) as { plant: string; account_group: string; amount: number }[]);
      setRpcsMissing(!!(kpiRes.error || scoreRes.error || costRes.error));
    }
    load();
    return () => { active = false; };
  }, [companyId, hasUnze, monthFrom, monthTo, plantFilter]);

  async function handleUpload() {
    if (uploadFiles.length === 0) return;
    setUploading(true);
    setUploadResults([]);
    let anyAccepted = false;
    for (const file of uploadFiles) {
      const formData = new FormData();
      formData.append("file", file);
      const res = await authedFetch("/api/pnl/upload-unze", { method: "POST", body: formData });
      const body = await res.json();
      if (body.accepted) anyAccepted = true;
      setUploadResults((prev) => [...prev, { fileName: file.name, accepted: !!body.accepted, summary: body.summary || body.error || "Unknown error", checks: body.checks || [] }]);
    }
    setUploading(false);
    setUploadFiles([]);
    if (anyAccepted) {
      const { data } = await supabase.rpc("pnl_kpi_summary", { p_company_id: companyId, p_from: "2000-01-01", p_to: "2100-01-01" });
      const rows = (data || []) as KpiRow[];
      setAllMonths(rows.map((r) => r.month));
    }
  }

  async function generateInsights() {
    setGenerating(true);
    setInsightError("");
    try {
      const res = await authedFetch("/api/pnl/ceo-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, from: monthFrom, to: monthTo, plant: plantFilter }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to generate commentary");
      setInsights((body.insights || []) as Insight[]);
      setActions((body.actions || []) as string[]);
    } catch (err) {
      setInsightError(err instanceof Error ? err.message : "Failed to generate commentary");
    }
    setGenerating(false);
  }

  if (checking) return null;

  /* ── Derived data (shaping only) ── */

  const isHo = plantFilter === "HO";
  const latest = kpiRows[kpiRows.length - 1];
  const prev = kpiRows[kpiRows.length - 2];
  const priorRows = kpiRows.slice(0, -1);
  const avgSales = priorRows.length ? priorRows.reduce((s, r) => s + r.gross_sale, 0) / priorRows.length : 0;
  const avgMargin = priorRows.length ? (priorRows.reduce((s, r) => s + (r.gross_sale ? r.gross_profit / r.gross_sale : 0), 0) / priorRows.length) * 100 : 0;
  const latestMargin = latest && latest.gross_sale ? (latest.gross_profit / latest.gross_sale) * 100 : null;
  const prevMargin = prev && prev.gross_sale ? (prev.gross_profit / prev.gross_sale) * 100 : null;
  const periodNp = kpiRows.reduce((s, r) => s + r.net_profit_final, 0);

  let lossStreak = 0;
  for (let i = kpiRows.length - 1; i >= 0; i--) {
    if (kpiRows[i].net_profit_final < 0) lossStreak++;
    else break;
  }
  const attention: string[] = [];
  const scopeLabel = plantFilter === "All" ? "" : ` (${plantFilter})`;
  if (lossStreak >= 2) attention.push(`${lossStreak} consecutive loss months${scopeLabel}, ${fmtM(kpiRows.slice(-lossStreak).reduce((s, r) => s + r.net_profit_final, 0))} cumulative`);
  else if (latest && latest.net_profit_final < 0) attention.push(`${MONTH_LABEL(latest.month)} was loss-making${scopeLabel} (${fmtM(latest.net_profit_final)})`);
  if (!isHo && latest && avgSales > 0 && latest.gross_sale < avgSales * 0.7) attention.push(`${MONTH_LABEL(latest.month)} sales ${fmtM(latest.gross_sale)}, ${fmtPct(((avgSales - latest.gross_sale) / avgSales) * 100)} below the period average`);
  if (!isHo && latestMargin !== null && priorRows.length >= 2 && latestMargin < avgMargin - 5) attention.push(`Gross margin ${fmtPct(latestMargin)} vs ${fmtPct(avgMargin)} period average`);

  const comboData = kpiRows.map((r) => ({
    month: MONTH_LABEL(r.month),
    sales: toM(r.gross_sale),
    profit: toM(r.net_profit_final),
    loss: r.net_profit_final < 0,
  }));

  const marginData = kpiRows.map((r) => ({
    month: MONTH_LABEL(r.month),
    margin: r.gross_sale ? Math.round((r.gross_profit / r.gross_sale) * 1000) / 10 : null,
    cogs: r.gross_sale ? Math.round((Math.abs(r.cost_of_sale) / r.gross_sale) * 1000) / 10 : null,
  }));

  type WfStep = { name: string; base: number; delta: number; colour: string; total?: boolean };
  const waterfall: WfStep[] = [];
  if (latest) {
    const s = toM(latest.gross_sale);
    const cogs = toM(latest.cost_of_sale);
    const gp = toM(latest.gross_profit);
    const opex = toM(latest.operating_expenses);
    const other = toM(latest.non_operating + latest.taxation);
    const np = toM(latest.net_profit_final);
    let running = s;
    waterfall.push({ name: "Sales", base: 0, delta: s, colour: COLOURS.BLUE, total: true });
    waterfall.push({ name: "COGS", base: running + cogs, delta: Math.abs(cogs), colour: COLOURS.RED });
    running += cogs;
    waterfall.push({ name: "Gross profit", base: gp >= 0 ? 0 : gp, delta: Math.abs(gp), colour: gp >= 0 ? COLOURS.GREEN : COLOURS.RED, total: true });
    waterfall.push({ name: "Opex", base: running + opex, delta: Math.abs(opex), colour: COLOURS.RED });
    running += opex;
    waterfall.push({ name: "Other", base: other >= 0 ? running : running + other, delta: Math.abs(other), colour: other >= 0 ? COLOURS.GREEN : COLOURS.RED });
    waterfall.push({ name: "Net", base: np >= 0 ? 0 : np, delta: Math.abs(np), colour: np >= 0 ? COLOURS.GREEN : COLOURS.RED, total: true });
  }

  // Cost structure — % of sales normally; absolute PKR m when viewing HO
  // (HO has no sales, so a percentage would be meaningless).
  const salesByMonth: Record<string, number> = {};
  kpiRows.forEach((r) => { salesByMonth[r.month] = r.gross_sale; });
  const costMonths = [...new Set(costRows.map((r) => r.month))].sort();
  const costChartData = costMonths.map((m) => {
    const row: Record<string, number | string> = { month: MONTH_LABEL(m) };
    const sales = salesByMonth[m] || 0;
    COST_BUCKETS.forEach((b) => {
      const amt = costRows.filter((r) => r.month === m && r.bucket === b).reduce((s, r) => s + r.amount, 0);
      row[b] = isHo ? toM(amt) : sales > 0 ? Math.round((amt / sales) * 1000) / 10 : 0;
    });
    return row;
  });

  // Plant scoreboard rows, MEPCO/PESCO/FEDMIC by sales then HO last.
  const productionPlants = scoreRows.filter((r) => r.plant !== "HO").sort((a, b) => b.gross_sale - a.gross_sale);
  const hoRow = scoreRows.find((r) => r.plant === "HO");
  const maxPlantSales = Math.max(1, ...productionPlants.map((r) => r.gross_sale));
  const totalPlantSales = productionPlants.reduce((s, r) => s + r.gross_sale, 0);
  const sparkFor = (plant: string) => {
    const months = [...new Set(plantTrend.filter((r) => r.plant === plant).map((r) => r.month))].sort();
    return months.map((m) => {
      const rec = plantTrend.find((r) => r.plant === plant && r.month === m);
      return rec && rec.gross_sale ? (rec.gross_profit / rec.gross_sale) * 100 : 0;
    });
  };
  const marginChip = (pct: number | null) => {
    if (pct === null) return { bg: COLOURS.TRACK, fg: COLOURS.SLATE, label: "—" };
    if (pct >= 18) return { bg: COLOURS.SUCCESS_SOFT, fg: COLOURS.GREEN, label: fmtPct(pct) };
    if (pct >= 10) return { bg: COLOURS.WARNING_SOFT, fg: COLOURS.AMBER, label: fmtPct(pct) };
    return { bg: COLOURS.DANGER_SOFT, fg: COLOURS.RED, label: fmtPct(pct) };
  };

  // Expense watch — top groups this month with movement vs prior month.
  const ohMonths = [...new Set(overheadRows.map((r) => r.month))].sort();
  const ohGroups = [...new Set(overheadRows.map((r) => r.account_group))];
  const curM = ohMonths[ohMonths.length - 1];
  const prevM = ohMonths.length >= 2 ? ohMonths[ohMonths.length - 2] : null;
  const expenseWatch = ohGroups
    .map((g) => {
      const cur = overheadRows.filter((r) => r.account_group === g && r.month === curM).reduce((s, r) => s + r.amount, 0);
      const before = prevM === null ? null : overheadRows.filter((r) => r.account_group === g && r.month === prevM).reduce((s, r) => s + r.amount, 0);
      return { group: g, amount: cur, delta: before === null ? null : cur - before };
    })
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);
  const maxWatch = Math.max(1, ...expenseWatch.map((r) => r.amount));

  const allValidated = validationRows.length > 0 && validationRows.every((v) => v.status === "accepted" && v.checks_failed === 0);
  const badMonths = validationRows.filter((v) => v.status !== "accepted" || v.checks_failed > 0);

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
          {canUploadUnze && (
            <button onClick={() => { setShowUpload(!showUpload); setUploadResults([]); }} style={chipBtn(showUpload)}>
              {showUpload ? "Close upload" : "Upload months"}
            </button>
          )}
        </div>

        {!hasUnze ? (
          <div style={cardStyle}>
            <p style={{ color: COLOURS.SLATE, fontSize: "14px" }}>
              This page covers Unze Trading only. Imperial Footwear&apos;s P&amp;L will be a separate page for its own team.
            </p>
          </div>
        ) : (
          <>
            {showUpload && (
              <div style={{ ...cardStyle, marginBottom: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <input type="file" accept=".xlsx" multiple onChange={(e) => setUploadFiles(Array.from(e.target.files || []))} style={{ fontSize: "13px" }} />
                  <button
                    onClick={handleUpload}
                    disabled={uploadFiles.length === 0 || uploading}
                    style={{ ...chipBtn(true), opacity: uploadFiles.length === 0 || uploading ? 0.5 : 1, cursor: uploadFiles.length === 0 || uploading ? "not-allowed" : "pointer" }}
                  >
                    {uploading ? "Checking…" : uploadFiles.length > 1 ? `Upload ${uploadFiles.length} files` : "Upload"}
                  </button>
                  <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>Each month is checked and accepted or rejected on its own.</span>
                </div>
                {uploadResults.map((r, idx) => (
                  <div key={idx} style={{ marginTop: "10px", padding: "10px 14px", borderRadius: RADII.SM, background: r.accepted ? COLOURS.SUCCESS_SOFT : COLOURS.DANGER_SOFT }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: r.accepted ? COLOURS.GREEN : COLOURS.RED }}>
                      {r.fileName} — {r.accepted ? "Accepted — " : "Rejected — "}{r.summary}
                    </div>
                    {!r.accepted && (
                      <div style={{ fontSize: "12px", color: COLOURS.RED, lineHeight: 1.6, marginTop: "4px" }}>
                        {r.checks.filter((c) => !c.passed).map((c, i) => (
                          <div key={i}>· {c.name}: expected {fmtM(c.expected)}, got {fmtM(c.reported)} (diff {fmtM(c.diff)})</div>
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
                <p style={{ color: COLOURS.SLATE, fontSize: "14px" }}>No months uploaded yet for Unze Trading.</p>
              </div>
            ) : (
              <>
                {/* ── Filter bar — drives every card below ── */}
                <div style={{ ...cardStyle, padding: "10px 14px", marginBottom: "10px", position: "sticky", top: 0, zIndex: 10 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", alignItems: "center" }}>
                    <span style={{ fontSize: "11px", color: COLOURS.SLATE, fontWeight: 600 }}>PLANT</span>
                    {PLANTS.map((p) => (
                      <button key={p} style={chipBtn(plantFilter === p)} onClick={() => setPlantFilter(p)}>{p}</button>
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
                    Showing {plantFilter === "All" ? "all plants + HO" : plantFilter} · {MONTH_LABEL(monthFrom)} to {MONTH_LABEL(monthTo)} — every card obeys these filters
                  </div>
                </div>

                {rpcsMissing && (
                  <div style={{ ...cardStyle, marginBottom: "10px", background: COLOURS.WARNING_SOFT }}>
                    <p style={{ fontSize: "13px", color: COLOURS.AMBER, fontWeight: 600 }}>
                      Migration 143_pnl_ceo_view_v2.sql hasn&apos;t been applied — apply it in the Supabase SQL Editor and reload.
                    </p>
                  </div>
                )}

                {/* ── Attention banner ── */}
                {attention.length > 0 && (
                  <div style={{ ...cardStyle, marginBottom: "10px", background: COLOURS.DANGER_SOFT, border: `1px solid ${COLOURS.RED}` }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.RED, marginBottom: "3px" }}>Needs your attention</div>
                    <div style={{ fontSize: "12px", color: COLOURS.INK_700, lineHeight: 1.6 }}>{attention.join(" · ")}</div>
                  </div>
                )}

                {/* ── KPI cards ── */}
                {latest && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px", marginBottom: "10px" }}>
                    <div style={{ ...cardStyle, padding: "10px 12px" }}>
                      <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Sales — {MONTH_LABEL(latest.month)}</div>
                      <div style={{ fontSize: "22px", fontWeight: 700, color: COLOURS.NAVY }}>{fmtM(latest.gross_sale)}</div>
                      {prev && (
                        <div style={{ fontSize: "11px", color: latest.gross_sale >= prev.gross_sale ? COLOURS.GREEN : COLOURS.RED }}>
                          {latest.gross_sale >= prev.gross_sale ? "▲" : "▼"} {fmtM(Math.abs(latest.gross_sale - prev.gross_sale))} vs {MONTH_LABEL(prev.month)}
                          {avgSales > 0 && ` · avg ${fmtM(avgSales)}`}
                        </div>
                      )}
                    </div>
                    <div style={{ ...cardStyle, padding: "10px 12px" }}>
                      <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Gross margin</div>
                      <div style={{ fontSize: "22px", fontWeight: 700, color: COLOURS.NAVY }}>{latestMargin === null ? "—" : fmtPct(latestMargin)}</div>
                      <div style={{ fontSize: "11px", color: latestMargin !== null && prevMargin !== null && latestMargin < prevMargin ? COLOURS.RED : COLOURS.SLATE }}>
                        {prevMargin !== null ? `vs ${fmtPct(prevMargin)} ${MONTH_LABEL(prev.month)}` : ""}{priorRows.length >= 2 && latestMargin !== null ? ` · avg ${fmtPct(avgMargin)}` : ""}
                      </div>
                    </div>
                    <div style={{ ...cardStyle, padding: "10px 12px" }}>
                      <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Operating expenses</div>
                      <div style={{ fontSize: "22px", fontWeight: 700, color: COLOURS.NAVY }}>{fmtM(Math.abs(latest.operating_expenses))}</div>
                      {prev && (
                        <div style={{ fontSize: "11px", color: Math.abs(latest.operating_expenses) <= Math.abs(prev.operating_expenses) ? COLOURS.GREEN : COLOURS.RED }}>
                          {Math.abs(latest.operating_expenses) <= Math.abs(prev.operating_expenses) ? "▼" : "▲"} {fmtM(Math.abs(Math.abs(latest.operating_expenses) - Math.abs(prev.operating_expenses)))} vs {MONTH_LABEL(prev.month)}
                        </div>
                      )}
                    </div>
                    <div style={{ ...cardStyle, padding: "10px 12px" }}>
                      <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Net profit — {MONTH_LABEL(latest.month)}</div>
                      <div style={{ fontSize: "22px", fontWeight: 700, color: latest.net_profit_final >= 0 ? COLOURS.NAVY : COLOURS.RED }}>{fmtM(latest.net_profit_final)}</div>
                      <div style={{ fontSize: "11px", color: periodNp >= 0 ? COLOURS.SLATE : COLOURS.RED }}>Period total: {fmtM(periodNp)}</div>
                    </div>
                  </div>
                )}

                {/* ── Sales & profit + profit bridge ── */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "10px", marginBottom: "10px" }}>
                  <div style={cardStyle}>
                    <div style={sectionTitle}>Sales and net profit by month</div>
                    <div style={sectionCaption}>Bars = sales · line = net profit · red bars = loss months</div>
                    <div style={{ height: "210px" }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={comboData}>
                          <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.HAIRLINE} />
                          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <ReferenceLine y={0} stroke={COLOURS.SLATE} />
                          <Bar dataKey="sales" name="Sales (m)">
                            {comboData.map((d, i) => <Cell key={i} fill={d.loss ? COLOURS.RED : COLOURS.BLUE} fillOpacity={d.loss ? 0.7 : 0.85} />)}
                          </Bar>
                          <Line type="monotone" dataKey="profit" name="Net profit (m)" stroke={COLOURS.NAVY} strokeWidth={2} dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div style={cardStyle}>
                    <div style={sectionTitle}>Where {latest ? MONTH_LABEL(latest.month) : "the month"}&apos;s money went</div>
                    <div style={sectionCaption}>Sales in, costs out, what&apos;s left</div>
                    <div style={{ height: "210px" }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={waterfall}>
                          <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.HAIRLINE} />
                          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <ReferenceLine y={0} stroke={COLOURS.SLATE} strokeDasharray="3 3" />
                          <Bar dataKey="base" stackId="wf" fill="transparent" />
                          <Bar dataKey="delta" stackId="wf">
                            {waterfall.map((w, i) => <Cell key={i} fill={w.colour} fillOpacity={w.total ? 1 : 0.75} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                {/* ── Margin health + cost structure ── */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "10px", marginBottom: "10px" }}>
                  <div style={cardStyle}>
                    <div style={sectionTitle}>Margin health</div>
                    <div style={sectionCaption}>Gross margin % (amber) vs COGS % of sales (red) — above the dashed line you sold below cost</div>
                    <div style={{ height: "200px" }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={marginData}>
                          <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.HAIRLINE} />
                          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} unit="%" />
                          <Tooltip />
                          <ReferenceLine y={100} stroke={COLOURS.RED} strokeDasharray="4 4" />
                          <ReferenceLine y={0} stroke={COLOURS.HAIRLINE} />
                          <Line type="monotone" dataKey="margin" name="Gross margin %" stroke={COLOURS.AMBER} strokeWidth={2} dot={false} connectNulls />
                          <Line type="monotone" dataKey="cogs" name="COGS %" stroke={COLOURS.RED} strokeWidth={2} dot={false} connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div style={cardStyle}>
                    <div style={sectionTitle}>Cost structure — {isHo ? "PKR m" : "% of sales"}</div>
                    <div style={sectionCaption}>Navy = production/COGS · blue = admin · amber = selling · red = finance{isHo ? " · HO shown in absolute PKR (no sales)" : ""}</div>
                    <div style={{ height: "200px" }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={costChartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.HAIRLINE} />
                          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} unit={isHo ? "" : "%"} />
                          <Tooltip />
                          {!isHo && <ReferenceLine y={100} stroke={COLOURS.RED} strokeDasharray="4 4" />}
                          {COST_BUCKETS.map((b) => (
                            <Bar key={b} dataKey={b} stackId="cost" fill={BUCKET_COLOURS[b]} />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                {/* ── Plant scoreboard ── */}
                <div style={{ ...cardStyle, marginBottom: "10px" }}>
                  <div style={sectionTitle}>Plant scoreboard — {MONTH_LABEL(monthFrom)} to {MONTH_LABEL(monthTo)}</div>
                  <div style={sectionCaption}>Click a row to filter the whole page to that plant · margin sparkline over the period</div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse", minWidth: "560px" }}>
                      <thead>
                        <tr style={{ color: COLOURS.SLATE, textAlign: "left", fontSize: "11px" }}>
                          <th style={{ fontWeight: 600, padding: "4px 0", width: "90px" }}>Plant</th>
                          <th style={{ fontWeight: 600, width: "200px" }}>Sales</th>
                          <th style={{ fontWeight: 600, width: "110px" }}>Gross margin</th>
                          <th style={{ fontWeight: 600, width: "100px" }}>Net profit</th>
                          <th style={{ fontWeight: 600 }}>Margin trend</th>
                        </tr>
                      </thead>
                      <tbody>
                        {productionPlants.map((r) => {
                          const pct = r.gross_sale ? (r.gross_profit / r.gross_sale) * 100 : null;
                          const chip = marginChip(pct);
                          const selected = plantFilter === r.plant;
                          return (
                            <tr
                              key={r.plant}
                              onClick={() => setPlantFilter(selected ? "All" : r.plant)}
                              style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, cursor: "pointer", background: selected ? COLOURS.INFO_SOFT : "transparent" }}
                            >
                              <td style={{ padding: "9px 0", fontWeight: 700 }}>{r.plant}</td>
                              <td>
                                {fmtM(r.gross_sale)}{" "}
                                <span style={{ display: "inline-block", background: COLOURS.BLUE, height: "6px", width: `${Math.round((r.gross_sale / maxPlantSales) * 100)}px`, borderRadius: "3px", verticalAlign: "middle" }} />
                              </td>
                              <td><span style={{ background: chip.bg, color: chip.fg, borderRadius: RADII.PILL, padding: "2px 9px", fontSize: "12px", fontWeight: 600 }}>{chip.label}</span></td>
                              <td style={{ color: r.net_profit >= 0 ? COLOURS.GREEN : COLOURS.RED, fontWeight: 600 }}>{r.net_profit >= 0 ? "+" : ""}{fmtM(r.net_profit)}</td>
                              <td><Sparkline values={sparkFor(r.plant)} colour={(marginChip((r.gross_sale ? (r.gross_profit / r.gross_sale) * 100 : null))).fg} /></td>
                            </tr>
                          );
                        })}
                        {hoRow && (
                          <tr
                            onClick={() => setPlantFilter(plantFilter === "HO" ? "All" : "HO")}
                            style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, cursor: "pointer", background: plantFilter === "HO" ? COLOURS.INFO_SOFT : "transparent" }}
                          >
                            <td style={{ padding: "9px 0", fontWeight: 700 }}>HO</td>
                            <td style={{ color: COLOURS.INK_400 }}>cost centre</td>
                            <td style={{ color: COLOURS.INK_400 }}>—</td>
                            <td style={{ color: hoRow.net_profit >= 0 ? COLOURS.GREEN : COLOURS.RED, fontWeight: 600 }}>{hoRow.net_profit >= 0 ? "+" : ""}{fmtM(hoRow.net_profit)}</td>
                            <td style={{ fontSize: "11px", color: COLOURS.INK_400 }}>{totalPlantSales > 0 ? `${fmtPct((Math.abs(hoRow.net_profit) / totalPlantSales) * 100)} of sales` : "—"}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ── Expense watch + CEO commentary ── */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "10px", marginBottom: "10px" }}>
                  <div style={cardStyle}>
                    <div style={sectionTitle}>Expense watch — {curM ? MONTH_LABEL(curM) : ""}</div>
                    <div style={sectionCaption}>Top groups with movement vs {prevM ? MONTH_LABEL(prevM) : "prior month"}{plantFilter !== "All" ? ` · ${plantFilter} only` : ""}</div>
                    {expenseWatch.length === 0 && <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No overhead activity this month.</p>}
                    {expenseWatch.map((r) => (
                      <div key={r.group} style={{ marginBottom: "9px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "3px" }}>
                          <span>{r.group}</span>
                          <span>
                            {fmtM(r.amount)}{" "}
                            {r.delta !== null && Math.abs(r.delta) > 100_000 && (
                              <span style={{ color: r.delta > 0 ? COLOURS.RED : COLOURS.GREEN, fontWeight: 600 }}>
                                {r.delta > 0 ? "▲" : "▼"} {fmtM(Math.abs(r.delta))}
                              </span>
                            )}
                          </span>
                        </div>
                        <div style={{ background: COLOURS.TRACK, borderRadius: "3px", height: "5px" }}>
                          <div style={{ width: `${(r.amount / maxWatch) * 100}%`, background: COLOURS.BLUE, height: "5px", borderRadius: "3px" }} />
                        </div>
                      </div>
                    ))}
                    {newFlags.length > 0 && (
                      <div style={{ marginTop: "10px", padding: "8px 10px", borderRadius: RADII.SM, background: COLOURS.WARNING_SOFT }}>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.AMBER, marginBottom: "3px" }}>New account activity this month</div>
                        {newFlags.map((f, i) => (
                          <div key={i} style={{ fontSize: "12px", color: COLOURS.INK_700 }}>{f.plant} — {f.account_group}: {fmtM(f.amount)}</div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={cardStyle}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={sectionTitle}>CEO commentary</div>
                      <button onClick={generateInsights} disabled={generating} style={{ ...chipBtn(true), opacity: generating ? 0.5 : 1, cursor: generating ? "not-allowed" : "pointer" }}>
                        {generating ? "Analysing…" : insights.length > 0 ? "Regenerate" : "Generate"}
                      </button>
                    </div>
                    <div style={sectionCaption}>Fresh analysis of the selected plant and period, tied to market context</div>
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
                </div>

                {/* ── Data quality + market context footer ── */}
                <div style={{ ...cardStyle, marginBottom: "20px", padding: "10px 14px" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                    <span style={{ fontSize: "11px", color: COLOURS.SLATE, fontWeight: 600 }}>DATA QUALITY</span>
                    {allValidated ? (
                      <span style={{ background: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN, borderRadius: RADII.PILL, padding: "2px 10px", fontSize: "11px", fontWeight: 600 }}>
                        ✓ {validationRows.length}/{validationRows.length} months validated, 16/16 checks each
                      </span>
                    ) : (
                      badMonths.map((v) => (
                        <span key={v.month} title={`${v.file_name} — uploaded ${formatDateUK(v.uploaded_at.slice(0, 10))}`} style={{ background: COLOURS.DANGER_SOFT, color: COLOURS.RED, borderRadius: RADII.PILL, padding: "2px 10px", fontSize: "11px", fontWeight: 600 }}>
                          {MONTH_LABEL(v.month)}: {v.checks_passed}/{v.checks_passed + v.checks_failed} checks
                        </span>
                      ))
                    )}
                    <span style={{ width: "1px", height: "16px", background: COLOURS.HAIRLINE, margin: "0 4px" }} />
                    <button onClick={() => setShowMarket(!showMarket)} style={{ ...chipBtn(showMarket), padding: "3px 11px", fontSize: "11px" }}>
                      {showMarket ? "Hide market context" : "Market context"}
                    </button>
                  </div>
                  {showMarket && (
                    <div style={{ fontSize: "12px", color: COLOURS.INK_700, lineHeight: 1.7, marginTop: "10px", borderTop: `1px solid ${COLOURS.HAIRLINE}`, paddingTop: "10px" }}>
                      <div style={{ fontWeight: 700, fontSize: "11px", color: COLOURS.GREEN, marginBottom: "3px" }}>DEMAND — TAILWINDS</div>
                      <div>· ADB&apos;s proposed $130m PDSP-II digitisation project covers PESCO, HAZECO, QESCO, LESCO and SEPCO; an earlier $200m ADB loan funds 332,000+ AMI meters. (<a href="https://profit.pakistantoday.com.pk/2026/06/02/adb-proposes-dollar130-million-project-to-digitise-power-distribution-network-across-five-discos" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>Profit</a>, <a href="https://www.adb.org/news/adb-help-modernize-power-distribution-pakistan" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>ADB</a>)</div>
                      <div>· World Bank approved $375.9m for grid stability (BEST-PAK), July 2026. (<a href="https://www.worldbank.org/en/news/press-release/2026/07/08/world-bank-support-to-strengthen-pakistan-s-electricity-grid-for-improved-reliability-and-accelerated-clean-energy-growt" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>World Bank</a>)</div>
                      <div>· Government target: all old meters replaced with AMI by December 2026 via a PPP covering LESCO, MEPCO, PESCO, HAZECO and QESCO — a live tender window for the Smart Meter Plant. (<a href="https://propakistani.pk/2026/01/05/govt-to-roll-out-advanced-metering-infrastructure-in-5-electricity-companies/" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>ProPakistani</a>)</div>
                      <div style={{ fontWeight: 700, fontSize: "11px", color: COLOURS.RED, margin: "8px 0 3px" }}>COSTS — HEADWINDS</div>
                      <div>· Steel (grade 60 rebar) around PKR 222–232/kg — the main pole input cost. (<a href="https://priceit.pk/steel-rate-today/" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>priceit.pk</a>)</div>
                      <div>· CPI inflation 11.0% (June 2026); SBP policy rate 11.5% after the April hike. (<a href="https://tradingeconomics.com/pakistan/inflation-cpi" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>Trading Economics</a>)</div>
                      <div>· Energy costs elevated: petrol/diesel roughly 48%/38% above pre-conflict levels.</div>
                      <div style={{ fontSize: "11px", color: COLOURS.INK_400, marginTop: "8px" }}>Researched 17/07/2026 — directional context, not live data.</div>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </AuthWrapper>
  );
}
