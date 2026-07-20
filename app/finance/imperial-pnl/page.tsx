"use client";

// ─────────────────────────────────────────────────────────────────────────
// Imperial Footwear (Unze London retail) P&L — built 17/07/2026 to the
// mockup Khuram approved. Access: Khuram, Kamran, Shakeel, Shahida only
// (canViewIfplPnl). Unlike the Unze Trading page, PLAN vs ACTUAL is the
// spine here — the workbook projects every line, so every number carries
// its variance. The filter bar drives every card below it.
// Layout: filter bar → attention → KPI cards → plan-vs-actual chart →
// final profit by month + growth story → branch league (sortable,
// searchable, click-to-filter) → expense watch + CEO commentary →
// data quality strip. All aggregation in Postgres RPCs (migration 144).
// ─────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, ReferenceLine } from "recharts";
import AuthWrapper from "../../lib/AuthWrapper";
import { authFetch, supabase } from "../../lib/supabase";
import { COLOURS, RADII, cardStyle, PageHeader, SkeletonRows } from "../../lib/SharedUI";
import { useRequireCapability } from "../../lib/useRouteGuard";
import { useUserCtx } from "../../lib/useUserCtx";
import { widgetVisible } from "../../lib/permissions";
import { formatDateUK } from "../../lib/dateUtils";

type KpiRow = {
  month: string;
  proj_sales: number; act_sales: number;
  proj_gp: number; act_gp: number;
  proj_overheads: number; act_overheads: number;
  proj_final: number; act_final: number;
};
type LeagueRow = { branch: string; channel: string; proj_sales: number; act_sales: number; act_gp: number; act_final: number };
type LineTotal = { line: string; category: string; projection: number; actual: number };
type ValidationRow = { month: string; file_name: string; status: string; checks_passed: number; checks_failed: number; warnings: number; uploaded_at: string };
type CheckDetail = { name: string; expected: number; reported: number; diff: number; blocking: boolean };
type CheckIssue = { month: string; check_name: string; expected: number; reported: number; diff: number; blocking: boolean; status: string };
type UploadResult = { month: string; accepted: boolean; summary: string; failed?: CheckDetail[]; warnings?: CheckDetail[] };
type Insight = { title: string; detail: string; severity: "good" | "watch" | "urgent" };

// Net sales by financial year from the workbook's Sales Growth sheet
// (historic years don't exist at line level in the database).
const FY_HISTORY = [
  { fy: "21-22", sales: 927_277_513 },
  { fy: "22-23", sales: 1_262_859_897 },
  { fy: "23-24", sales: 1_600_223_174 },
  { fy: "24-25", sales: 2_576_900_112 },
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

const PRESETS = ["Month", "Quarter", "YTD", "Custom"] as const;
type Preset = typeof PRESETS[number];

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

export default function ImperialPnlPage() {
  const { checking } = useRequireCapability("ifpl_pnl");
  const { ctx } = useUserCtx();
  // Per-section visibility from the Access Matrix page-element picker.
  const show = (key: string) => !ctx || widgetVisible(ctx, key, true);

  const [loading, setLoading] = useState(true);
  const [allMonths, setAllMonths] = useState<string[]>([]);
  const [kpiRows, setKpiRows] = useState<KpiRow[]>([]);
  const [league, setLeague] = useState<LeagueRow[]>([]);
  const [lineTotals, setLineTotals] = useState<LineTotal[]>([]);
  const [validationRows, setValidationRows] = useState<ValidationRow[]>([]);

  const [channelFilter, setChannelFilter] = useState("All");
  const [branchFilter, setBranchFilter] = useState("All");
  const [preset, setPreset] = useState<Preset>("YTD");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"sales" | "variance" | "margin" | "contribution">("sales");
  const [sortDesc, setSortDesc] = useState(true);
  const [leagueTab, setLeagueTab] = useState<"top" | "watch" | "all">("top");

  const [insights, setInsights] = useState<Insight[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [insightError, setInsightError] = useState("");
  const [showMarket, setShowMarket] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [checkIssues, setCheckIssues] = useState<CheckIssue[] | null>(null);

  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);

  const { monthFrom, monthTo } = useMemo(() => {
    if (allMonths.length === 0) return { monthFrom: "", monthTo: "" };
    const last = allMonths[allMonths.length - 1];
    if (preset === "Custom") return { monthFrom: customFrom || allMonths[0], monthTo: customTo || last };
    const n = preset === "Month" ? 1 : preset === "Quarter" ? 3 : allMonths.length;
    return { monthFrom: allMonths[Math.max(0, allMonths.length - n)], monthTo: last };
  }, [allMonths, preset, customFrom, customTo]);

  // Full month list once, to size the presets.
  useEffect(() => {
    let active = true;
    async function loadAll() {
      const { data, error } = await supabase.rpc("ifpl_kpi_by_month", { p_from: "2000-01-01", p_to: "2100-01-01", p_channel: "All", p_branch: "All" });
      if (!active) return;
      if (!error) setAllMonths(((data || []) as KpiRow[]).map((r) => r.month));
      setLoading(false);
    }
    loadAll();
    return () => { active = false; };
  }, []);

  // Main load on any filter change.
  useEffect(() => {
    if (!monthFrom || !monthTo) return;
    let active = true;
    async function load() {
      const [kpiRes, leagueRes, lineRes, valRes] = await Promise.all([
        supabase.rpc("ifpl_kpi_by_month", { p_from: monthFrom, p_to: monthTo, p_channel: channelFilter, p_branch: branchFilter }),
        supabase.rpc("ifpl_branch_league", { p_from: monthFrom, p_to: monthTo }),
        supabase.rpc("ifpl_line_totals", { p_from: monthFrom, p_to: monthTo, p_channel: channelFilter, p_branch: branchFilter }),
        supabase.rpc("ifpl_validation_summary"),
      ]);
      if (!active) return;
      setKpiRows((kpiRes.data || []) as KpiRow[]);
      setLeague((leagueRes.data || []) as LeagueRow[]);
      setLineTotals((lineRes.data || []) as LineTotal[]);
      setValidationRows((valRes.data || []) as ValidationRow[]);
    }
    load();
    return () => { active = false; };
  }, [monthFrom, monthTo, channelFilter, branchFilter]);

  // Saved AI commentary for this exact period + scope — shown as-is on
  // every visit; only Regenerate replaces it.
  useEffect(() => {
    if (!monthFrom || !monthTo) return;
    let active = true;
    async function loadSaved() {
      const { data } = await supabase.rpc("get_pnl_commentary", { p_company: "IFPL", p_scope: `${channelFilter}|${branchFilter}`, p_from: monthFrom, p_to: monthTo });
      if (!active) return;
      const row = data && data[0];
      setInsights((row?.insights || []) as Insight[]);
      setActions((row?.actions || []) as string[]);
      setGeneratedAt(row?.generated_at || null);
      setInsightError("");
    }
    loadSaved();
    return () => { active = false; };
  }, [monthFrom, monthTo, channelFilter, branchFilter]);

  // The workbook (~9.4 MB) is over Vercel's 4.5 MB request-body cap, so the
  // file itself is parsed HERE in the browser (parser loaded on demand) and
  // only the extracted rows go to the server as JSON.
  async function handleUpload() {
    if (!uploadFile) return;
    setUploading(true);
    setUploadResults([]);
    try {
      const bytes = await uploadFile.arrayBuffer();
      const { parseIfplPnl } = await import("../../lib/excel-parsers/pnl-ifpl-parser");
      const months = parseIfplPnl(bytes);
      if (months.length === 0) {
        setUploadResults([{ month: "", accepted: false, summary: "No month sheets with activity found — is this the right workbook?" }]);
        return;
      }
      const res = await authFetch("/api/pnl/upload-ifpl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: uploadFile.name, months }),
      });
      let body: { results?: UploadResult[]; error?: string } = {};
      try { body = await res.json(); } catch { /* non-JSON error page */ }
      if (!res.ok) {
        setUploadResults([{ month: "", accepted: false, summary: body.error || `Upload failed (${res.status})` }]);
        return;
      }
      // Attach the exact check figures from the local parse so a rejected
      // month shows precisely which reconciliation broke and by how much —
      // that's what accounts need to fix the file and re-upload.
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
      const { data } = await supabase.rpc("ifpl_kpi_by_month", { p_from: "2000-01-01", p_to: "2100-01-01", p_channel: "All", p_branch: "All" });
      setAllMonths(((data || []) as KpiRow[]).map((r) => r.month));
    } catch (err) {
      setUploadResults([{ month: "", accepted: false, summary: err instanceof Error ? err.message : "Could not read this file" }]);
    } finally {
      setUploading(false);
      setUploadFile(null);
    }
  }

  // Lazy-load the failed-check detail the first time the chip is opened.
  async function toggleIssues() {
    const next = !showIssues;
    setShowIssues(next);
    if (next && checkIssues === null) {
      const { data } = await supabase.rpc("ifpl_check_details");
      setCheckIssues((data || []) as CheckIssue[]);
    }
  }

  async function generateInsights() {
    setGenerating(true);
    setInsightError("");
    try {
      const res = await authFetch("/api/pnl/ceo-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: "IFPL", from: monthFrom, to: monthTo, channel: channelFilter, branch: branchFilter }),
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

  const channels = ["All", ...new Set(league.map((l) => l.channel))];
  const branchOptions = ["All", ...league.map((l) => l.branch).sort()];

  const sum = (f: (r: KpiRow) => number) => kpiRows.reduce((s, r) => s + f(r), 0);
  const totSales = sum((r) => r.act_sales);
  const totProjSales = sum((r) => r.proj_sales);
  const totGp = sum((r) => r.act_gp);
  const totProjGp = sum((r) => r.proj_gp);
  const totOverheads = sum((r) => r.act_overheads);
  const totProjOverheads = sum((r) => r.proj_overheads);
  const totFinal = sum((r) => r.act_final);
  const salesVarPct = totProjSales ? ((totSales - totProjSales) / totProjSales) * 100 : null;
  const overheadVarPct = totProjOverheads ? ((totOverheads - totProjOverheads) / totProjOverheads) * 100 : null;

  // Attention signals — branches badly off plan or loss-making (period
  // league, so they respect the date filter), plus the latest month's miss.
  const tradingBranches = league.filter((l) => l.channel !== "Cost centre");
  const offPlan = tradingBranches
    .filter((l) => l.proj_sales > 1_000_000 && l.act_sales < l.proj_sales * 0.8)
    .sort((a, b) => (a.act_sales / a.proj_sales) - (b.act_sales / b.proj_sales));
  const lossBranches = tradingBranches.filter((l) => l.act_final < -100_000).sort((a, b) => a.act_final - b.act_final);
  const latest = kpiRows[kpiRows.length - 1];
  const attention: string[] = [];
  if (offPlan.length > 0) attention.push(offPlan.slice(0, 3).map((l) => `${l.branch} ${fmtPct((1 - l.act_sales / l.proj_sales) * 100)} below plan`).join(" · "));
  if (lossBranches.length > 0) attention.push(`${lossBranches.length} branch${lossBranches.length > 1 ? "es" : ""} loss-making (worst: ${lossBranches[0].branch} ${fmtM(lossBranches[0].act_final)})`);
  if (latest && latest.proj_sales > 0 && latest.act_sales < latest.proj_sales * 0.9) {
    attention.push(`${MONTH_LABEL(latest.month)} missed plan by ${fmtM(latest.proj_sales - latest.act_sales)} (${fmtPct((1 - latest.act_sales / latest.proj_sales) * 100)})`);
  }

  const planData = kpiRows.map((r) => ({
    month: MONTH_LABEL(r.month),
    actual: toM(r.act_sales),
    plan: toM(r.proj_sales),
    beat: r.act_sales >= r.proj_sales,
  }));
  const profitData = kpiRows.map((r) => ({
    month: MONTH_LABEL(r.month),
    final: toM(r.act_final),
  }));
  const growthData = [
    ...FY_HISTORY.map((h) => ({ fy: h.fy, sales: toM(h.sales), current: false })),
    { fy: "25-26*", sales: toM(4_282_500_000 > 0 ? league.reduce((s, l) => s + l.act_sales, 0) : 0), current: true },
  ];

  // League rows with computed columns; the table shows Top 10 by default,
  // with Watch list / All tabs — summary first, detail on demand.
  const allLeagueRows = tradingBranches
    .map((l) => ({
      branch: l.branch,
      channel: l.channel,
      sales: l.act_sales,
      projSales: l.proj_sales,
      gp: l.act_gp,
      variance: l.proj_sales ? ((l.act_sales - l.proj_sales) / l.proj_sales) * 100 : null,
      margin: l.act_sales ? (l.act_gp / l.act_sales) * 100 : null,
      contribution: l.act_final,
    }))
    .sort((a, b) => {
      const va = a[sortKey] ?? -Infinity;
      const vb = b[sortKey] ?? -Infinity;
      return sortDesc ? (vb as number) - (va as number) : (va as number) - (vb as number);
    });
  const watchRows = allLeagueRows.filter((l) => l.contribution < -100_000 || (l.variance !== null && l.variance < -20));
  const searchActive = search.trim().length > 0;
  const searched = allLeagueRows.filter((l) => l.branch.toLowerCase().includes(search.toLowerCase()));
  const visibleRows = searchActive ? searched : leagueTab === "top" ? allLeagueRows.slice(0, 10) : leagueTab === "watch" ? watchRows : allLeagueRows;
  const restRows = !searchActive && leagueTab === "top" ? allLeagueRows.slice(10) : [];
  const restSales = restRows.reduce((s, r) => s + r.sales, 0);
  const restGp = restRows.reduce((s, r) => s + r.gp, 0);
  const restContribution = restRows.reduce((s, r) => s + r.contribution, 0);

  const costCentres = league.filter((l) => l.channel === "Cost centre");
  const costCentreTotal = costCentres.reduce((s, l) => s + l.act_final, 0);
  const maxLeagueSales = Math.max(1, ...allLeagueRows.map((l) => l.sales));
  const maxContribution = Math.max(1, ...allLeagueRows.map((l) => Math.abs(l.contribution)));

  // Channel totals + stars for the summary cards — filter-independent
  // (always the whole company over the selected period).
  const onlineTotal = tradingBranches.filter((l) => l.channel === "Online PK");
  const retailTotal = tradingBranches.filter((l) => l.channel !== "Online PK");
  const onlineSales = onlineTotal.reduce((s, l) => s + l.act_sales, 0);
  const onlineContribution = onlineTotal.reduce((s, l) => s + l.act_final, 0);
  const retailSales = retailTotal.reduce((s, l) => s + l.act_sales, 0);
  const retailContribution = retailTotal.reduce((s, l) => s + l.act_final, 0);
  const companySales = onlineSales + retailSales;
  const companyProjSales = tradingBranches.reduce((s, l) => s + l.proj_sales, 0);
  const companyGp = tradingBranches.reduce((s, l) => s + l.act_gp, 0);
  const companyFinal = tradingBranches.reduce((s, l) => s + l.act_final, 0) + costCentreTotal;

  const retailByContribution = [...retailTotal].sort((a, b) => b.act_final - a.act_final);
  const topStore = retailByContribution[0];
  const bestMargin = [...tradingBranches]
    .filter((l) => l.act_sales > 20_000_000)
    .sort((a, b) => (b.act_gp / b.act_sales) - (a.act_gp / a.act_sales))[0];
  const bestBeat = [...tradingBranches]
    .filter((l) => l.proj_sales > 5_000_000)
    .sort((a, b) => (b.act_sales / b.proj_sales) - (a.act_sales / a.proj_sales))[0];
  const worstLosses = watchRows.filter((l) => l.contribution < -100_000).sort((a, b) => a.contribution - b.contribution).slice(0, 3);
  const worstOffPlan = watchRows.filter((l) => l.variance !== null && l.variance < -20).sort((a, b) => (a.variance as number) - (b.variance as number)).slice(0, 2);

  const marginChip = (pct: number | null) => {
    if (pct === null) return { bg: COLOURS.TRACK, fg: COLOURS.SLATE, label: "—" };
    if (pct >= 40) return { bg: COLOURS.SUCCESS_SOFT, fg: COLOURS.GREEN, label: fmtPct(pct) };
    if (pct >= 34) return { bg: COLOURS.WARNING_SOFT, fg: COLOURS.AMBER, label: fmtPct(pct) };
    return { bg: COLOURS.DANGER_SOFT, fg: COLOURS.RED, label: fmtPct(pct) };
  };

  const overheadLines = lineTotals
    .filter((l) => l.category === "overhead" && l.actual > 0)
    .sort((a, b) => b.actual - a.actual)
    .slice(0, 6);
  const maxOverhead = Math.max(1, ...overheadLines.map((l) => l.actual));
  const belowLines = lineTotals.filter((l) => l.category.startsWith("below"));

  const allValidated = validationRows.length > 0 && validationRows.every((v) => v.status === "accepted");
  const totalWarnings = validationRows.reduce((s, v) => s + (v.warnings || 0), 0);

  const severityColour = (s: Insight["severity"]) => s === "good" ? COLOURS.GREEN : s === "watch" ? COLOURS.AMBER : COLOURS.RED;
  const severitySoft = (s: Insight["severity"]) => s === "good" ? COLOURS.SUCCESS_SOFT : s === "watch" ? COLOURS.WARNING_SOFT : COLOURS.DANGER_SOFT;

  const sortHeader = (key: typeof sortKey, label: string) => (
    <th
      onClick={() => { if (sortKey === key) setSortDesc(!sortDesc); else { setSortKey(key); setSortDesc(true); } }}
      style={{ fontWeight: 600, cursor: "pointer", userSelect: "none" }}
      title="Click to sort"
    >
      {label}{sortKey === key ? (sortDesc ? " ↓" : " ↑") : ""}
    </th>
  );

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
            {showUpload ? "Close upload" : "Upload workbook"}
          </button>
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
                {uploading ? "Checking every month…" : "Upload"}
              </button>
              <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>
                Upload the full PL-CURRENT workbook — every month in it is validated and refreshed. Takes a minute.
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
                      <div key={j}>✗ {c.name}: should be {fmtM(c.expected)}, file shows {fmtM(c.reported)} (out by {fmtM(c.diff)})</div>
                    ))}
                  </div>
                )}
                {(r.warnings || []).length > 0 && (
                  <div style={{ fontSize: "12px", color: COLOURS.AMBER, lineHeight: 1.6, marginTop: "4px" }}>
                    {(r.warnings || []).map((c, j) => (
                      <div key={j}>⚠ {c.name}: should be {fmtM(c.expected)}, file shows {fmtM(c.reported)} (out by {fmtM(c.diff)}) — accepted anyway, worth checking</div>
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
              No Imperial P&amp;L data yet — press &quot;Upload workbook&quot; and select the PL-CURRENT file.
            </p>
          </div>
        ) : (
          <>
            {/* ── Filter bar ── */}
            <div style={{ ...cardStyle, padding: "10px 14px", marginBottom: "10px", position: "sticky", top: 0, zIndex: 10 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", alignItems: "center" }}>
                <span style={{ fontSize: "11px", color: COLOURS.SLATE, fontWeight: 600 }}>CHANNEL</span>
                {channels.map((c) => (
                  <button key={c} style={chipBtn(channelFilter === c)} onClick={() => { setChannelFilter(c); setBranchFilter("All"); }}>{c}</button>
                ))}
                <span style={{ width: "1px", height: "18px", background: COLOURS.HAIRLINE, margin: "0 3px" }} />
                <span style={{ fontSize: "11px", color: COLOURS.SLATE, fontWeight: 600 }}>BRANCH</span>
                <select value={branchFilter} onChange={(e) => { setBranchFilter(e.target.value); setChannelFilter("All"); }} style={{ padding: "5px 9px", borderRadius: RADII.SM, border: `1px solid ${COLOURS.HAIRLINE}`, fontSize: "12px", maxWidth: "180px" }}>
                  {branchOptions.map((b) => <option key={b} value={b}>{b === "All" ? `All ${branchOptions.length - 1} branches` : b}</option>)}
                </select>
                <span style={{ width: "1px", height: "18px", background: COLOURS.HAIRLINE, margin: "0 3px" }} />
                <span style={{ fontSize: "11px", color: COLOURS.SLATE, fontWeight: 600 }}>PERIOD</span>
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    style={chipBtn(preset === p)}
                    onClick={() => {
                      setPreset(p);
                      if (p === "Custom" && !customFrom && allMonths.length > 0) {
                        setCustomFrom(allMonths[0]);
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
                Showing {branchFilter !== "All" ? branchFilter : channelFilter === "All" ? "the whole company" : channelFilter} · {MONTH_LABEL(monthFrom)} to {MONTH_LABEL(monthTo)} — every card obeys these filters
              </div>
            </div>

            {/* ── Attention banner ── */}
            {show("imperial_pnl.attention_banner") && attention.length > 0 && (
              <div style={{ ...cardStyle, marginBottom: "10px", background: COLOURS.DANGER_SOFT, border: `1px solid ${COLOURS.RED}` }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.RED, marginBottom: "3px" }}>Needs your attention</div>
                <div style={{ fontSize: "12px", color: COLOURS.INK_700, lineHeight: 1.6 }}>{attention.join(" · ")}</div>
              </div>
            )}

            {/* ── KPI cards ── */}
            {show("imperial_pnl.kpi_cards") && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px", marginBottom: "10px" }}>
              <div style={{ ...cardStyle, padding: "10px 12px" }}>
                <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Net sales — {preset === "Month" ? MONTH_LABEL(monthTo) : "period"}</div>
                <div style={{ fontSize: "22px", fontWeight: 700, color: COLOURS.NAVY }}>{fmtM(totSales)}</div>
                {salesVarPct !== null && (
                  <div style={{ fontSize: "11px", color: salesVarPct >= 0 ? COLOURS.GREEN : COLOURS.RED }}>
                    {salesVarPct >= 0 ? "▲" : "▼"} {fmtPct(Math.abs(salesVarPct))} vs plan {fmtM(totProjSales)}
                  </div>
                )}
              </div>
              <div style={{ ...cardStyle, padding: "10px 12px" }}>
                <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Gross margin</div>
                <div style={{ fontSize: "22px", fontWeight: 700, color: COLOURS.NAVY }}>{totSales ? fmtPct((totGp / totSales) * 100) : "—"}</div>
                <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>vs {totProjSales ? fmtPct((totProjGp / totProjSales) * 100) : "—"} planned</div>
              </div>
              <div style={{ ...cardStyle, padding: "10px 12px" }}>
                <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Overheads</div>
                <div style={{ fontSize: "22px", fontWeight: 700, color: COLOURS.NAVY }}>{fmtM(totOverheads)}</div>
                {overheadVarPct !== null && (
                  <div style={{ fontSize: "11px", color: overheadVarPct <= 0 ? COLOURS.GREEN : COLOURS.RED }}>
                    {overheadVarPct <= 0 ? "▼" : "▲"} {fmtPct(Math.abs(overheadVarPct))} vs plan
                  </div>
                )}
              </div>
              <div style={{ ...cardStyle, padding: "10px 12px" }}>
                <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Final profit</div>
                <div style={{ fontSize: "22px", fontWeight: 700, color: totFinal >= 0 ? COLOURS.GREEN : COLOURS.RED }}>{totFinal >= 0 ? "+" : ""}{fmtM(totFinal)}</div>
                <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>{totSales ? fmtPct((totFinal / totSales) * 100) + " of net sales" : ""}</div>
              </div>
            </div>
            )}

            {/* ── Plan vs actual ── */}
            {show("imperial_pnl.charts") && (<>
            <div style={{ ...cardStyle, marginBottom: "10px" }}>
              <div style={sectionTitle}>Sales — plan vs actual by month</div>
              <div style={sectionCaption}>Bars = actual (green beat plan, red missed) · dark line = projection</div>
              <div style={{ height: "220px" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={planData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.HAIRLINE} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="actual" name="Actual (m)">
                      {planData.map((d, i) => <Cell key={i} fill={d.beat ? COLOURS.GREEN : COLOURS.RED} fillOpacity={0.75} />)}
                    </Bar>
                    <Line type="monotone" dataKey="plan" name="Plan (m)" stroke={COLOURS.NAVY} strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ── Final profit + growth story ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "10px", marginBottom: "10px" }}>
              <div style={cardStyle}>
                <div style={sectionTitle}>Final profit by month</div>
                <div style={sectionCaption}>After D&amp;A, adjustments and tax — the business lives off the season peaks</div>
                <div style={{ height: "200px" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={profitData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.HAIRLINE} />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <ReferenceLine y={0} stroke={COLOURS.SLATE} strokeDasharray="3 3" />
                      <Bar dataKey="final" name="Final profit (m)">
                        {profitData.map((d, i) => <Cell key={i} fill={d.final >= 0 ? COLOURS.GREEN : COLOURS.RED} fillOpacity={d.final >= 0 ? 1 : 0.75} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div style={cardStyle}>
                <div style={sectionTitle}>Growth story</div>
                <div style={sectionCaption}>Net sales by financial year · 25-26* is the live database total for the loaded months</div>
                <div style={{ height: "200px" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={growthData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.HAIRLINE} />
                      <XAxis dataKey="fy" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="sales" name="Net sales (m)">
                        {growthData.map((d, i) => <Cell key={i} fill={COLOURS.BLUE} fillOpacity={d.current ? 1 : 0.45 + i * 0.12} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            </>)}

            {/* ── Branch league ── */}
            {show("imperial_pnl.branch_league") && (
            <div style={{ ...cardStyle, marginBottom: "10px" }}>
              <div style={sectionTitle}>Branch league — {MONTH_LABEL(monthFrom)} to {MONTH_LABEL(monthTo)}</div>
              <div style={sectionCaption}>Summary first, detail on demand — the full list only when you ask for it</div>

              {/* Summary cards: channel totals, stars, watch list */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "8px", marginBottom: "12px" }}>
                <div style={{ background: COLOURS.SUCCESS_SOFT, borderRadius: RADII.SM, padding: "9px 11px" }}>
                  <div style={{ fontSize: "11px", color: COLOURS.GREEN, fontWeight: 700, marginBottom: "2px" }}>CHANNEL TOTALS</div>
                  <div style={{ fontSize: "12px", color: COLOURS.INK_700, lineHeight: 1.7 }}>
                    Online PK: {fmtM(onlineSales)} → <b>{onlineContribution >= 0 ? "+" : ""}{fmtM(onlineContribution)}</b><br />
                    {retailTotal.length} retail stores: {fmtM(retailSales)} → <b>{retailContribution >= 0 ? "+" : ""}{fmtM(retailContribution)}</b><br />
                    <span style={{ color: COLOURS.RED }}>HO + warehouses: {fmtM(costCentreTotal)}</span>
                  </div>
                </div>
                <div style={{ background: COLOURS.SUCCESS_SOFT, borderRadius: RADII.SM, padding: "9px 11px" }}>
                  <div style={{ fontSize: "11px", color: COLOURS.GREEN, fontWeight: 700, marginBottom: "2px" }}>STARS</div>
                  <div style={{ fontSize: "12px", color: COLOURS.INK_700, lineHeight: 1.7 }}>
                    {topStore && <>{topStore.branch} +{fmtM(topStore.act_final)} (top store)<br /></>}
                    {bestMargin && <>{bestMargin.branch} {fmtPct((bestMargin.act_gp / bestMargin.act_sales) * 100)} GP (best margin)<br /></>}
                    {bestBeat && <>{bestBeat.branch} +{fmtPct((bestBeat.act_sales / bestBeat.proj_sales - 1) * 100)} vs plan (best beat)</>}
                  </div>
                </div>
                <div style={{ background: watchRows.length > 0 ? COLOURS.DANGER_SOFT : COLOURS.SUCCESS_SOFT, borderRadius: RADII.SM, padding: "9px 11px" }}>
                  <div style={{ fontSize: "11px", color: watchRows.length > 0 ? COLOURS.RED : COLOURS.GREEN, fontWeight: 700, marginBottom: "2px" }}>
                    {watchRows.length > 0 ? `WATCH LIST — ${watchRows.length} STORE${watchRows.length > 1 ? "S" : ""}` : "WATCH LIST — CLEAR"}
                  </div>
                  <div style={{ fontSize: "12px", color: COLOURS.INK_700, lineHeight: 1.7 }}>
                    {watchRows.length === 0 && "No loss-making or badly off-plan stores in this period."}
                    {worstLosses.length > 0 && <>{worstLosses.length} loss-making: {worstLosses.map((l) => `${l.branch} ${fmtM(l.contribution)}`).join(", ")}<br /></>}
                    {worstOffPlan.length > 0 && <>Far off plan: {worstOffPlan.map((l) => `${l.branch} ${fmtPct(l.variance as number)}`).join(", ")}</>}
                  </div>
                </div>
              </div>

              {/* Tabs + search */}
              <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", marginBottom: "8px" }}>
                <button style={chipBtn(!searchActive && leagueTab === "top")} onClick={() => { setLeagueTab("top"); setSearch(""); }}>Top 10</button>
                <button
                  style={{ ...chipBtn(!searchActive && leagueTab === "watch"), color: !searchActive && leagueTab === "watch" ? "white" : COLOURS.RED }}
                  onClick={() => { setLeagueTab("watch"); setSearch(""); }}
                >
                  Watch list ({watchRows.length})
                </button>
                <button style={chipBtn(!searchActive && leagueTab === "all")} onClick={() => { setLeagueTab("all"); setSearch(""); }}>All {allLeagueRows.length}</button>
                <span style={{ flex: 1 }} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search branches…"
                  style={{ padding: "5px 10px", borderRadius: RADII.SM, border: `1px solid ${COLOURS.HAIRLINE}`, fontSize: "12px", width: "150px" }}
                />
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse", minWidth: "600px" }}>
                  <thead>
                    <tr style={{ color: COLOURS.SLATE, textAlign: "left", fontSize: "11px" }}>
                      <th style={{ fontWeight: 600, padding: "4px 0", width: "26px" }}>#</th>
                      <th style={{ fontWeight: 600, width: "160px" }}>Branch</th>
                      {sortHeader("sales", "Net sales")}
                      {sortHeader("variance", "vs plan")}
                      {sortHeader("margin", "GP %")}
                      {sortHeader("contribution", "Contribution")}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.length === 0 && (
                      <tr><td colSpan={6} style={{ padding: "10px 0", color: COLOURS.SLATE, fontSize: "13px" }}>No branches match.</td></tr>
                    )}
                    {visibleRows.map((r) => {
                      const chip = marginChip(r.margin);
                      const selected = branchFilter === r.branch;
                      const rank = allLeagueRows.indexOf(r) + 1;
                      return (
                        <tr
                          key={r.branch}
                          onClick={() => { setBranchFilter(selected ? "All" : r.branch); setChannelFilter("All"); }}
                          style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, cursor: "pointer", background: selected ? COLOURS.INFO_SOFT : r.contribution < -100_000 || (r.variance !== null && r.variance < -20) ? COLOURS.WARNING_SOFT : "transparent" }}
                        >
                          <td style={{ color: COLOURS.INK_400, fontSize: "12px" }}>{rank}</td>
                          <td style={{ padding: "7px 0", fontWeight: 600 }}>{r.branch}{r.channel === "Online PK" ? " 🌐" : ""}</td>
                          <td>
                            {fmtM(r.sales)}{" "}
                            <span style={{ display: "inline-block", background: COLOURS.BLUE, height: "5px", width: `${Math.max(2, Math.round((r.sales / maxLeagueSales) * 80))}px`, borderRadius: "3px", verticalAlign: "middle" }} />
                          </td>
                          <td style={{ color: r.variance === null ? COLOURS.SLATE : r.variance >= 0 ? COLOURS.GREEN : COLOURS.RED, fontWeight: 600 }}>
                            {r.variance === null ? "—" : `${r.variance >= 0 ? "+" : ""}${fmtPct(r.variance)}`}
                          </td>
                          <td><span style={{ background: chip.bg, color: chip.fg, borderRadius: RADII.PILL, padding: "2px 9px", fontSize: "12px", fontWeight: 600 }}>{chip.label}</span></td>
                          <td style={{ color: r.contribution >= 0 ? COLOURS.GREEN : COLOURS.RED, fontWeight: 600 }}>
                            {r.contribution >= 0 ? "+" : ""}{fmtM(r.contribution)}{" "}
                            <span style={{ display: "inline-block", background: r.contribution >= 0 ? COLOURS.GREEN : COLOURS.RED, height: "5px", width: `${Math.max(2, Math.round((Math.abs(r.contribution) / maxContribution) * 50))}px`, borderRadius: "3px", verticalAlign: "middle", opacity: 0.7 }} />
                          </td>
                        </tr>
                      );
                    })}
                    {restRows.length > 0 && (
                      <tr onClick={() => setLeagueTab("all")} style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, cursor: "pointer", background: COLOURS.CARD_ALT }}>
                        <td></td>
                        <td style={{ padding: "7px 0", fontWeight: 600, color: COLOURS.SLATE }}>{restRows.length} other stores</td>
                        <td style={{ color: COLOURS.SLATE }}>{fmtM(restSales)}</td>
                        <td style={{ color: COLOURS.INK_400 }}>—</td>
                        <td style={{ color: COLOURS.SLATE }}>{restSales > 0 ? fmtPct((restGp / restSales) * 100) : "—"}</td>
                        <td style={{ color: restContribution >= 0 ? COLOURS.GREEN : COLOURS.RED, fontWeight: 600 }}>{restContribution >= 0 ? "+" : ""}{fmtM(restContribution)} · tap for all</td>
                      </tr>
                    )}
                    {costCentres.length > 0 && !searchActive && leagueTab !== "watch" && (
                      <tr style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, background: COLOURS.CARD_ALT }}>
                        <td></td>
                        <td style={{ padding: "7px 0", fontWeight: 600, color: COLOURS.INK_400 }}>Cost centres (HO + {costCentres.length - 1} warehouse{costCentres.length > 2 ? "s" : ""})</td>
                        <td style={{ color: COLOURS.INK_400 }}>—</td>
                        <td style={{ color: COLOURS.INK_400 }}>—</td>
                        <td style={{ color: COLOURS.INK_400 }}>—</td>
                        <td style={{ color: COLOURS.RED, fontWeight: 600 }}>{fmtM(costCentreTotal)}</td>
                      </tr>
                    )}
                    {!searchActive && leagueTab !== "watch" && (
                      <tr style={{ borderTop: `2px solid ${COLOURS.NAVY}`, background: COLOURS.CARD_ALT }}>
                        <td></td>
                        <td style={{ padding: "7px 0", fontWeight: 700 }}>Whole company</td>
                        <td style={{ fontWeight: 700 }}>{fmtM(companySales)}</td>
                        <td style={{ color: companySales >= companyProjSales ? COLOURS.GREEN : COLOURS.RED, fontWeight: 700 }}>
                          {companyProjSales > 0 ? `${companySales >= companyProjSales ? "+" : ""}${fmtPct(((companySales - companyProjSales) / companyProjSales) * 100)}` : "—"}
                        </td>
                        <td style={{ fontWeight: 700 }}>{companySales > 0 ? fmtPct((companyGp / companySales) * 100) : "—"}</td>
                        <td style={{ color: companyFinal >= 0 ? COLOURS.GREEN : COLOURS.RED, fontWeight: 700 }}>{companyFinal >= 0 ? "+" : ""}{fmtM(companyFinal)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            )}

            {/* ── Expense watch + CEO commentary ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "10px", marginBottom: "10px" }}>
              {show("imperial_pnl.expense_watch") && (
              <div style={cardStyle}>
                <div style={sectionTitle}>Expense watch — vs plan</div>
                <div style={sectionCaption}>Largest overheads for the selected scope and period</div>
                {overheadLines.length === 0 && <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No overhead activity in this selection.</p>}
                {overheadLines.map((l) => {
                  const varPct = l.projection ? ((l.actual - l.projection) / Math.abs(l.projection)) * 100 : null;
                  const over = varPct !== null && varPct > 5;
                  return (
                    <div key={l.line} style={{ marginBottom: "9px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "3px" }}>
                        <span>{l.line}</span>
                        <span>
                          {fmtM(l.actual)}{" "}
                          {varPct === null ? null : Math.abs(varPct) <= 5 ? (
                            <span style={{ color: COLOURS.GREEN }}>✓ on plan</span>
                          ) : (
                            <span style={{ color: over ? COLOURS.RED : COLOURS.GREEN, fontWeight: 600 }}>{varPct > 0 ? "▲" : "▼"} {fmtPct(Math.abs(varPct))} vs plan</span>
                          )}
                        </span>
                      </div>
                      <div style={{ background: COLOURS.TRACK, borderRadius: "3px", height: "5px" }}>
                        <div style={{ width: `${(l.actual / maxOverhead) * 100}%`, background: over ? COLOURS.RED : COLOURS.BLUE, height: "5px", borderRadius: "3px" }} />
                      </div>
                    </div>
                  );
                })}
                {belowLines.length > 0 && (
                  <div style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}`, marginTop: "8px", paddingTop: "6px", fontSize: "11px", color: COLOURS.SLATE }}>
                    Below the line: {belowLines.map((l) => `${l.line} ${fmtM(l.actual)}`).join(" · ")}
                  </div>
                )}
              </div>
              )}
              {show("imperial_pnl.commentary") && (
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
                    : "Analysis of the selected scope and period, tied to retail market context — saved once generated"}
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

            {/* ── Data quality strip ── */}
            {show("imperial_pnl.data_strip") && (
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
                        These are the source file&apos;s own inconsistencies — the exact cells that don&apos;t reconcile. Fix them in the workbook and re-upload; each one clears automatically once its month passes.
                      </div>
                      {[...new Set(checkIssues.map((c) => c.month))].map((m) => (
                        <div key={m} style={{ marginBottom: "8px" }}>
                          <div style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.NAVY }}>{MONTH_LABEL(m)}</div>
                          {checkIssues.filter((c) => c.month === m).map((c, i) => (
                            <div key={i} style={{ fontSize: "12px", color: c.blocking ? COLOURS.RED : COLOURS.AMBER, lineHeight: 1.6, paddingLeft: "10px" }}>
                              {c.blocking ? "✗" : "⚠"} {c.check_name}: should be {fmtM(c.expected)}, file shows {fmtM(c.reported)} (out by {fmtM(c.diff)})
                              {c.blocking ? " — month was rejected" : " — accepted, but worth correcting"}
                            </div>
                          ))}
                        </div>
                      ))}
                      <div style={{ fontSize: "11px", color: COLOURS.INK_400 }}>
                        Known cause for Aug 25: Hakim Mall has 2.0m net sales recorded with no COGS or gross profit entered. Oct 25&apos;s two are in the projection columns — a GP cell and a hardcoded Total Overheads that don&apos;t match their own parts.
                      </div>
                    </>
                  )}
                </div>
              )}
              {showMarket && (
                <div style={{ fontSize: "12px", color: COLOURS.INK_700, lineHeight: 1.7, marginTop: "10px", borderTop: `1px solid ${COLOURS.HAIRLINE}`, paddingTop: "10px" }}>
                  <div style={{ fontWeight: 700, fontSize: "11px", color: COLOURS.GREEN, marginBottom: "3px" }}>DEMAND — TAILWINDS</div>
                  <div>· Pakistan&apos;s footwear market growing ~6.5% a year; overall retail ~8.2% — driven by a young population, urbanisation and a growing middle class. (<a href="https://www.6wresearch.com/industry-report/pakistan-footwear-market-2020-2026" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>6Wresearch</a>, <a href="https://www.6wresearch.com/industry-report/pakistan-retail-industry-market-outlook" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>retail outlook</a>)</div>
                  <div>· E-commerce is the growth engine: online sales projected past PKR 1.2 trillion in 2026, 85%+ of orders on mobile, fashion the top marketplace category — plays directly to Online PK&apos;s strength. (<a href="https://www.digitalmediatrend.com/pakistan-e-commerce-in-2026-pakistans-e-commerce-growth-and-market-share/" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>Digital Media Trend</a>, <a href="https://www.statista.com/outlook/emo/ecommerce/pakistan" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>Statista</a>)</div>
                  <div>· Social commerce (Facebook/Instagram/TikTok/WhatsApp selling) heading toward ~35% of online retail; cash on delivery still ~95% of orders.</div>
                  <div style={{ fontWeight: 700, fontSize: "11px", color: COLOURS.RED, margin: "8px 0 3px" }}>COSTS — HEADWINDS</div>
                  <div>· CPI inflation 11.0% (June 2026); SBP policy rate 11.5% — squeezes consumer wallets and keeps borrowing dear. (<a href="https://tradingeconomics.com/pakistan/inflation-cpi" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>Trading Economics</a>)</div>
                  <div>· Store economics under pressure: mall rents, wages and electricity rising while online scales cheaper — visible in your own numbers (rent + wages are the two biggest overheads).</div>
                  <div>· Established competitors with deep retail networks: Bata, Service, Stylo, Hush Puppies. (<a href="https://www.pacra.com/view/storage/app/Footwear%20-%20PACRA%20Research%20-%20Sep'25_1757929234.pdf" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>PACRA sector study</a>)</div>
                  <div style={{ fontSize: "11px", color: COLOURS.INK_400, marginTop: "8px" }}>Researched 18/07/2026 — directional context, not live data.</div>
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
