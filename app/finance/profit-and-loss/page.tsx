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
//
// BS tab added 27/08/2026 — Balance Sheet per month, matching the approved
// mockup exactly. Data lives in the balance_sheet table (migration 182).
// ─────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import { ResponsiveContainer, ComposedChart, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, ReferenceLine } from "recharts";
import AuthWrapper from "../../lib/AuthWrapper";
import { authFetch, supabase } from "../../lib/supabase";
import { COLOURS, RADII, cardStyle, PageHeader, SkeletonRows } from "../../lib/SharedUI";
import { useRequireCapability } from "../../lib/useRouteGuard";
import { canEditFinance, financeCompanies, widgetVisible } from "../../lib/permissions";
import { useUserCtx } from "../../lib/useUserCtx";
import { UTPL_COMPANY_ID } from "../../lib/constants";
import { formatDateUK } from "../../lib/dateUtils";
import { useMobile } from "../../lib/useMobile";

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
type RestatedItem = { scope: string; line: string; old_value: number; new_value: number };

// Balance Sheet row returned by get_balance_sheet RPC
type BsRow = {
  month: string;
  ppe: number;
  long_term_investment: number;
  total_fixed: number;
  receivables: number;
  stocks: number;
  advances_prepayments: number;
  advance_taxation: number;
  cash_bank: number;
  total_current: number;
  total_assets: number;
  owner_capital: number;
  revenue_reserves: number;
  retained_earnings: number;
  total_equity: number;
  hbl_stf: number;
  loan_family: number;
  mazhar_sb_ac: number;
  loan_associates: number;
  lease_liabilities: number;
  total_ncl: number;
  accrued_liabilities: number;
  payable_controls: number;
  taxation: number;
  total_cl: number;
  total_equity_liabilities: number;
};

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

// Format full PKR integer with commas; negatives in parentheses
const fmtPKR = (n: number | null | undefined): string => {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.round(Math.abs(n)).toLocaleString();
  return n < 0 ? `(${abs})` : abs;
};

// % change string with arrow
const chgLabel = (cur: number, prev: number | null | undefined): { text: string; up: boolean } | null => {
  if (prev === null || prev === undefined || Math.abs(prev) < 1) return null;
  const p = ((cur - prev) / Math.abs(prev)) * 100;
  return { text: (p >= 0 ? "▲ " : "▼ ") + Math.abs(p).toFixed(1) + "%", up: p >= 0 };
};

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

const tabBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: "9px 20px",
  fontSize: "12.5px",
  fontWeight: 600,
  border: "none",
  borderBottom: `2px solid ${active ? COLOURS.NAVY : "transparent"}`,
  background: "none",
  cursor: "pointer",
  color: active ? COLOURS.NAVY : COLOURS.SLATE,
  marginBottom: "-1px",
  display: "flex",
  alignItems: "center",
  gap: "6px",
  fontFamily: "inherit",
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

// ── Balance Sheet: SVG donut ─────────────────────────────────────────────
function BsDonut({ d }: { d: BsRow }) {
  const r = 45, cx = 60, cy = 60;
  const circ = 2 * Math.PI * r;
  const segs = [
    { v: d.total_fixed,          c: COLOURS.NAVY   },
    { v: d.receivables,          c: COLOURS.BLUE   },
    { v: d.stocks,               c: COLOURS.AMBER  },
    { v: d.advance_taxation,     c: COLOURS.GREEN  },
    { v: d.cash_bank,            c: COLOURS.SLATE  },
    { v: d.advances_prepayments, c: "#CBD5E1"       },
  ];
  const total = d.total_assets || 1;
  let cumLen = 0;
  const arcs = segs.map((s) => {
    const len = (Math.max(0, s.v) / total) * circ;
    const arc = { len, offset: cumLen, c: s.c };
    cumLen += len;
    return arc;
  });
  const totalM = Math.round(total / 1_000_000);
  return (
    <svg viewBox="0 0 120 120" width="130" height="130" style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={COLOURS.HAIRLINE} strokeWidth="22" />
      {arcs.map((arc, i) => (
        <circle
          key={i} cx={cx} cy={cy} r={r} fill="none"
          stroke={arc.c} strokeWidth="22"
          strokeDasharray={`${arc.len} ${circ - arc.len}`}
          strokeDashoffset={circ / 4 - arc.offset}
        />
      ))}
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="9" fill={COLOURS.SLATE} fontFamily="system-ui">Total</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fontSize="10" fill={COLOURS.NAVY} fontWeight="700" fontFamily="system-ui">
        ₨ {totalM}M
      </text>
    </svg>
  );
}

// ── Balance Sheet: table row helpers ────────────────────────────────────
function BsSectionHeader({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={5} style={{
        padding: "8px 10px 4px",
        fontSize: "10px", fontWeight: 700,
        color: COLOURS.SLATE,
        letterSpacing: ".08em", textTransform: "uppercase",
        background: COLOURS.TRACK,
      }}>{label}</td>
    </tr>
  );
}

function BsSubHeader({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={5} style={{
        padding: "8px 10px 3px 10px",
        fontSize: "10px", fontWeight: 600,
        color: COLOURS.SLATE,
        letterSpacing: ".05em", textTransform: "uppercase",
      }}>{label}</td>
    </tr>
  );
}

function BsItem({ label, note, cur, prev }: { label: string; note?: string; cur: number; prev?: number | null }) {
  const chg = prev != null ? chgLabel(cur, prev) : null;
  const isNeg = cur < 0;
  const prevNeg = prev != null && prev < 0;
  return (
    <tr style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
      <td style={{ padding: "5px 10px 5px 22px", fontSize: "12px", color: COLOURS.INK_700 }}>{label}</td>
      <td style={{ padding: "5px 10px", fontSize: "10px", color: COLOURS.INK_400, textAlign: "right", whiteSpace: "nowrap" }}>{note}</td>
      <td style={{ padding: "5px 10px", fontSize: "11.5px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontFamily: "monospace", color: isNeg ? COLOURS.RED : COLOURS.INK_700 }}>{fmtPKR(cur)}</td>
      <td style={{ padding: "5px 10px", fontSize: "11.5px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontFamily: "monospace", color: prevNeg ? COLOURS.RED : COLOURS.INK_400 }}>{prev != null ? fmtPKR(prev) : "—"}</td>
      <td style={{ padding: "5px 10px", fontSize: "10.5px", textAlign: "right", color: chg ? (chg.up ? COLOURS.GREEN : COLOURS.RED) : COLOURS.INK_400 }}>{chg ? chg.text : "—"}</td>
    </tr>
  );
}

function BsSubtotal({ label, cur, prev }: { label: string; cur: number; prev?: number | null }) {
  const chg = prev != null ? chgLabel(cur, prev) : null;
  return (
    <tr style={{ borderTop: `1px solid ${COLOURS.SLATE}`, borderBottom: `2px solid ${COLOURS.SLATE}` }}>
      <td style={{ padding: "6px 10px", fontWeight: 600, fontSize: "12px", color: COLOURS.NAVY }}>{label}</td>
      <td></td>
      <td style={{ padding: "6px 10px", fontWeight: 600, fontSize: "11.5px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontFamily: "monospace", color: COLOURS.BLUE }}>{fmtPKR(cur)}</td>
      <td style={{ padding: "6px 10px", fontSize: "11.5px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontFamily: "monospace", color: COLOURS.INK_400 }}>{prev != null ? fmtPKR(prev) : "—"}</td>
      <td style={{ padding: "6px 10px", fontSize: "10.5px", textAlign: "right", color: chg ? (chg.up ? COLOURS.GREEN : COLOURS.RED) : COLOURS.INK_400 }}>{chg ? chg.text : ""}</td>
    </tr>
  );
}

function BsGrandTotal({ label, cur, prev }: { label: string; cur: number; prev?: number | null }) {
  const chg = prev != null ? chgLabel(cur, prev) : null;
  return (
    <tr>
      <td style={{ padding: "8px 10px", fontWeight: 700, fontSize: "12.5px", background: COLOURS.NAVY, color: "white", borderRadius: "5px 0 0 5px" }}>{label}</td>
      <td style={{ background: COLOURS.NAVY }}></td>
      <td style={{ padding: "8px 10px", fontWeight: 700, fontSize: "12.5px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontFamily: "monospace", background: COLOURS.NAVY, color: "white" }}>{fmtPKR(cur)}</td>
      <td style={{ padding: "8px 10px", fontSize: "11.5px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontFamily: "monospace", background: COLOURS.NAVY, color: COLOURS.INK_400 }}>{prev != null ? fmtPKR(prev) : "—"}</td>
      <td style={{ padding: "8px 10px", fontSize: "10.5px", textAlign: "right", background: COLOURS.NAVY, color: COLOURS.INK_400, borderRadius: "0 5px 5px 0" }}>{chg ? chg.text : ""}</td>
    </tr>
  );
}

function BsSpacer() {
  return <tr><td colSpan={5} style={{ height: "8px" }}></td></tr>;
}

// ── Ratio row ────────────────────────────────────────────────────────────
function RatioRow({ label, value, colour }: { label: string; value: string; colour: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
      <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{label}</span>
      <span style={{ fontSize: "12.5px", fontWeight: 700, fontFamily: "monospace", color: colour }}>{value}</span>
    </div>
  );
}

export default function ProfitAndLossPage() {
  const { checking } = useRequireCapability("finance");
  const { ctx } = useUserCtx();
  const isMobile = useMobile();

  const scope = ctx ? financeCompanies(ctx) : "none";
  const hasUnze = scope === "both" || scope === "UTPL";
  const canUploadUnze = ctx ? canEditFinance(ctx) : false;
  const show = (key: string) => !ctx || widgetVisible(ctx, key, true);
  const companyId = UTPL_COMPANY_ID;

  // ── Tab state ────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"pnl" | "bs">("pnl");

  // ── PNL state ────────────────────────────────────────────────────────
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
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [insightError, setInsightError] = useState("");
  const [showRestatements, setShowRestatements] = useState(false);
  const [restatements, setRestatements] = useState<(RestatedItem & { month: string; changed_by: string; changed_at: string })[] | null>(null);

  const [showUpload, setShowUpload] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<{ fileName: string; accepted: boolean; summary: string; checks: CheckRow[]; auditIssues: string[]; restated: RestatedItem[] }[]>([]);

  // ── Balance Sheet state ──────────────────────────────────────────────
  const [bsMonths, setBsMonths] = useState<string[]>([]);
  const [bsMonth, setBsMonth] = useState<string>("");
  const [bsData, setBsData] = useState<BsRow | null>(null);
  const [bsPrev, setBsPrev] = useState<BsRow | null>(null);
  const [bsLoading, setBsLoading] = useState(false);

  // ── PNL: load month list ─────────────────────────────────────────────
  const { monthFrom, monthTo } = useMemo(() => {
    if (allMonths.length === 0) return { monthFrom: "", monthTo: "" };
    const last = allMonths[allMonths.length - 1];
    if (preset === "Custom") {
      return { monthFrom: customFrom || allMonths[0], monthTo: customTo || last };
    }
    const n = preset === "1M" ? 1 : preset === "3M" ? 3 : preset === "6M" ? 6 : preset === "12M" ? 12 : allMonths.length;
    return { monthFrom: allMonths[Math.max(0, allMonths.length - n)], monthTo: last };
  }, [allMonths, preset, customFrom, customTo]);

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

  useEffect(() => {
    if (!hasUnze || !monthFrom || !monthTo) return;
    let active = true;
    async function loadSaved() {
      const { data } = await supabase.rpc("get_pnl_commentary", { p_company: "UTPL", p_scope: plantFilter, p_from: monthFrom, p_to: monthTo });
      if (!active) return;
      const row = data && data[0];
      setInsights((row?.insights || []) as Insight[]);
      setActions((row?.actions || []) as string[]);
      setGeneratedAt(row?.generated_at || null);
      setInsightError("");
    }
    loadSaved();
    return () => { active = false; };
  }, [hasUnze, monthFrom, monthTo, plantFilter]);

  // ── BS: load available months ────────────────────────────────────────
  useEffect(() => {
    if (!hasUnze) return;
    let active = true;
    async function loadBsMonths() {
      const { data } = await supabase.rpc("get_balance_sheet_months", { p_company_id: companyId });
      if (!active) return;
      const months = ((data || []) as { month: string }[]).map((r) => r.month);
      setBsMonths(months);
      if (months.length > 0) setBsMonth(months[months.length - 1]);
    }
    loadBsMonths();
    return () => { active = false; };
  }, [companyId, hasUnze]);

  // ── BS: load data for selected month ────────────────────────────────
  useEffect(() => {
    if (!hasUnze || !bsMonth) return;
    let active = true;
    async function loadBs() {
      setBsLoading(true);
      const { data } = await supabase.rpc("get_balance_sheet", { p_company_id: companyId, p_month: bsMonth });
      if (!active) return;
      const rows = (data || []) as BsRow[];
      setBsData(rows[0] || null);
      setBsPrev(rows[1] || null);
      setBsLoading(false);
    }
    loadBs();
    return () => { active = false; };
  }, [companyId, hasUnze, bsMonth]);

  async function handleUpload() {
    if (uploadFiles.length === 0) return;
    setUploading(true);
    setUploadResults([]);
    let anyAccepted = false;
    for (const file of uploadFiles) {
      const formData = new FormData();
      formData.append("file", file);
      const res = await authFetch("/api/pnl/upload-unze", { method: "POST", body: formData });
      const body = await res.json();
      if (body.accepted) anyAccepted = true;
      setUploadResults((prev) => [...prev, { fileName: file.name, accepted: !!body.accepted, summary: body.summary || body.error || "Unknown error", checks: body.checks || [], auditIssues: body.auditIssues || [], restated: body.restated || [] }]);
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
      const res = await authFetch("/api/pnl/ceo-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, from: monthFrom, to: monthTo, plant: plantFilter }),
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

  async function toggleRestatements() {
    const next = !showRestatements;
    setShowRestatements(next);
    if (next && restatements === null) {
      const { data } = await supabase.rpc("get_pnl_restatements", { p_company: "UTPL", p_limit: 100 });
      setRestatements((data || []) as (RestatedItem & { month: string; changed_by: string; changed_at: string })[]);
    }
  }

  if (checking) return null;

  /* ── PNL derived data (shaping only) ── */
  const isHo = plantFilter === "HO";
  const latest = kpiRows[kpiRows.length - 1];
  const prev = kpiRows[kpiRows.length - 2];
  const priorRows = kpiRows.slice(0, -1);
  const avgSales = priorRows.length ? priorRows.reduce((s, r) => s + r.gross_sale, 0) / priorRows.length : 0;
  const avgMargin = priorRows.length ? (priorRows.reduce((s, r) => s + (r.gross_sale ? r.gross_profit / r.gross_sale : 0), 0) / priorRows.length) * 100 : 0;
  const latestMargin = latest && latest.gross_sale ? (latest.gross_profit / latest.gross_sale) * 100 : null;
  const prevMargin = prev && prev.gross_sale ? (prev.gross_profit / prev.gross_sale) * 100 : null;
  const periodSales = kpiRows.reduce((s, r) => s + r.gross_sale, 0);
  const periodGp = kpiRows.reduce((s, r) => s + r.gross_profit, 0);
  const periodOpex = kpiRows.reduce((s, r) => s + Math.abs(r.operating_expenses), 0);
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

  /* ── BS derived values ── */
  const bsWorkingCapital = bsData ? bsData.total_current - bsData.total_cl : null;
  const bsCurrentRatio   = bsData && bsData.total_cl > 0 ? bsData.total_current / bsData.total_cl : null;
  const bsQuickRatio     = bsData && bsData.total_cl > 0 ? (bsData.total_current - bsData.stocks) / bsData.total_cl : null;
  const bsCashRatio      = bsData && bsData.total_cl > 0 ? bsData.cash_bank / bsData.total_cl : null;
  const bsDebtToEquity   = bsData && bsData.total_equity > 0 ? (Math.max(0, bsData.total_ncl) + bsData.total_cl) / bsData.total_equity : null;
  const bsEquityRatio    = bsData && bsData.total_assets > 0 ? (bsData.total_equity / bsData.total_assets) * 100 : null;
  const bsDebtRatio      = bsEquityRatio !== null ? 100 - bsEquityRatio : null;
  const bsEqPct          = bsData && bsData.total_assets > 0 ? (bsData.total_equity / bsData.total_assets) * 100 : 0;
  const bsNclPct         = bsData && bsData.total_assets > 0 ? (Math.max(0, bsData.total_ncl) / bsData.total_assets) * 100 : 0;
  const bsClPct          = bsData && bsData.total_assets > 0 ? (bsData.total_cl / bsData.total_assets) * 100 : 0;

  const ratioColour = (v: number | null, good: number, warn: number, higherIsBetter = true) => {
    if (v === null) return COLOURS.SLATE;
    if (higherIsBetter) return v >= good ? COLOURS.GREEN : v >= warn ? COLOURS.AMBER : COLOURS.RED;
    return v <= good ? COLOURS.GREEN : v <= warn ? COLOURS.AMBER : COLOURS.RED;
  };

  return (
    <AuthWrapper>
      <main style={{ padding: "14px 18px", maxWidth: "1100px" }}>

        {/* Page header + upload button */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "12px" }}>
          <PageHeader />
          {canUploadUnze && activeTab === "pnl" && (
            <button onClick={() => { setShowUpload(!showUpload); setUploadResults([]); }} style={chipBtn(showUpload)}>
              {showUpload ? "Close upload" : "Upload months"}
            </button>
          )}
        </div>

        {/* ── Tab bar ── */}
        <div style={{ display: "flex", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, marginBottom: "14px" }}>
          <button style={tabBtnStyle(activeTab === "pnl")} onClick={() => setActiveTab("pnl")}>
            PNL
          </button>
          <button style={tabBtnStyle(activeTab === "bs")} onClick={() => setActiveTab("bs")}>
            BS
            {bsMonth && (
              <span style={{ background: COLOURS.AMBER, color: "white", fontSize: "9.5px", fontWeight: 700, padding: "1px 5px", borderRadius: "3px", letterSpacing: ".03em" }}>
                {MONTH_LABEL(bsMonth)}
              </span>
            )}
          </button>
        </div>

        {/* ══════════════════════════════════════════════════════════════
            PNL TAB
        ══════════════════════════════════════════════════════════════ */}
        {activeTab === "pnl" && (
          <>
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
                        {r.auditIssues.length > 0 && (
                          <div style={{ fontSize: "12px", color: COLOURS.AMBER, lineHeight: 1.6, marginTop: "4px" }}>
                            {r.auditIssues.map((a, i) => <div key={i}>⚠ {a}</div>)}
                          </div>
                        )}
                        {r.restated.length > 0 && (
                          <div style={{ fontSize: "12px", color: COLOURS.BLUE, lineHeight: 1.6, marginTop: "4px", fontWeight: 600 }}>
                            <div>Financial change to previously reported figures:</div>
                            {r.restated.map((c, i) => (
                              <div key={i}>↺ {c.scope} {c.line}: {fmtM(c.old_value)} → {fmtM(c.new_value)}</div>
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
                    {/* ── Filter bar ── */}
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
                    {show("unze_pnl.attention_banner") && attention.length > 0 && (
                      <div style={{ ...cardStyle, marginBottom: "10px", background: COLOURS.DANGER_SOFT, border: `1px solid ${COLOURS.RED}` }}>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.RED, marginBottom: "3px" }}>Needs your attention</div>
                        <div style={{ fontSize: "12px", color: COLOURS.INK_700, lineHeight: 1.6 }}>{attention.join(" · ")}</div>
                      </div>
                    )}

                    {/* ── KPI cards ── */}
                    {show("unze_pnl.kpi_cards") && latest && (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px", marginBottom: "10px" }}>
                        <div style={{ ...cardStyle, padding: "10px 12px" }}>
                          <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Sales — {MONTH_LABEL(latest.month)} (latest month)</div>
                          <div style={{ fontSize: "22px", fontWeight: 700, color: COLOURS.NAVY }}>{fmtM(latest.gross_sale)}</div>
                          {latest.gross_sale === 0 ? (
                            <div style={{ fontSize: "11px", color: COLOURS.AMBER, fontWeight: 600 }}>No sales recorded this month{plantFilter !== "All" ? ` for ${plantFilter}` : ""}</div>
                          ) : prev && (
                            <div style={{ fontSize: "11px", color: latest.gross_sale >= prev.gross_sale ? COLOURS.GREEN : COLOURS.RED }}>
                              {latest.gross_sale >= prev.gross_sale ? "▲" : "▼"} {fmtM(Math.abs(latest.gross_sale - prev.gross_sale))} vs {MONTH_LABEL(prev.month)}
                            </div>
                          )}
                          <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Period: {fmtM(periodSales)}{avgSales > 0 ? ` · avg ${fmtM(avgSales)}/mo` : ""}</div>
                        </div>
                        <div style={{ ...cardStyle, padding: "10px 12px" }}>
                          <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Gross margin — {MONTH_LABEL(latest.month)}</div>
                          <div style={{ fontSize: "22px", fontWeight: 700, color: COLOURS.NAVY }}>{latestMargin === null ? "—" : fmtPct(latestMargin)}</div>
                          <div style={{ fontSize: "11px", color: latestMargin !== null && prevMargin !== null && latestMargin < prevMargin ? COLOURS.RED : COLOURS.SLATE }}>
                            {latestMargin === null ? "No sales this month" : prevMargin !== null ? `vs ${fmtPct(prevMargin)} ${MONTH_LABEL(prev.month)}` : ""}
                          </div>
                          <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Period: {periodSales > 0 ? fmtPct((periodGp / periodSales) * 100) : "—"}</div>
                        </div>
                        <div style={{ ...cardStyle, padding: "10px 12px" }}>
                          <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Operating expenses — {MONTH_LABEL(latest.month)}</div>
                          <div style={{ fontSize: "22px", fontWeight: 700, color: COLOURS.NAVY }}>{fmtM(Math.abs(latest.operating_expenses))}</div>
                          {prev && (
                            <div style={{ fontSize: "11px", color: Math.abs(latest.operating_expenses) <= Math.abs(prev.operating_expenses) ? COLOURS.GREEN : COLOURS.RED }}>
                              {Math.abs(latest.operating_expenses) <= Math.abs(prev.operating_expenses) ? "▼" : "▲"} {fmtM(Math.abs(Math.abs(latest.operating_expenses) - Math.abs(prev.operating_expenses)))} vs {MONTH_LABEL(prev.month)}
                            </div>
                          )}
                          <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Period: {fmtM(periodOpex)}</div>
                        </div>
                        <div style={{ ...cardStyle, padding: "10px 12px" }}>
                          <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Net profit — {MONTH_LABEL(latest.month)}</div>
                          <div style={{ fontSize: "22px", fontWeight: 700, color: latest.net_profit_final >= 0 ? COLOURS.NAVY : COLOURS.RED }}>{fmtM(latest.net_profit_final)}</div>
                          <div style={{ fontSize: "11px", color: periodNp >= 0 ? COLOURS.SLATE : COLOURS.RED }}>Period total: {fmtM(periodNp)}</div>
                        </div>
                      </div>
                    )}

                    {/* ── Sales & profit + profit bridge ── */}
                    {show("unze_pnl.charts") && (<>
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(320px, 1fr))", gap: "10px", marginBottom: "10px" }}>
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
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(320px, 1fr))", gap: "10px", marginBottom: "10px" }}>
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
                    </>)}

                    {/* ── Plant scoreboard ── */}
                    {show("unze_pnl.plant_scoreboard") && (
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
                    )}

                    {/* ── Expense watch + CEO commentary ── */}
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(320px, 1fr))", gap: "10px", marginBottom: "10px" }}>
                      {show("unze_pnl.expense_watch") && (
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
                      )}
                      {show("unze_pnl.commentary") && (
                      <div style={cardStyle}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={sectionTitle}>CEO commentary</div>
                          <button onClick={generateInsights} disabled={generating} style={{ ...chipBtn(true), opacity: generating ? 0.5 : 1, cursor: generating ? "not-allowed" : "pointer" }}>
                            {generating ? "Analysing…" : insights.length > 0 ? "Regenerate" : "Generate"}
                          </button>
                        </div>
                        <div style={sectionCaption}>
                          {generatedAt
                            ? `Saved analysis from ${formatDateUK(generatedAt.slice(0, 10))} for this exact period and plant — press Regenerate to refresh it`
                            : "Analysis of the selected plant and period, tied to market context — saved once generated"}
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

                    {/* ── Data quality + market context footer ── */}
                    {show("unze_pnl.footer") && (
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
                        <button onClick={toggleRestatements} style={{ ...chipBtn(showRestatements), padding: "3px 11px", fontSize: "11px" }}>
                          Restatement log {showRestatements ? "▲" : "▼"}
                        </button>
                        <button onClick={() => setShowMarket(!showMarket)} style={{ ...chipBtn(showMarket), padding: "3px 11px", fontSize: "11px" }}>
                          {showMarket ? "Hide market context" : "Market context"}
                        </button>
                      </div>
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
                          <div>· ADB&apos;s proposed $130m PDSP-II digitisation project covers PESCO, HAZECO, QESCO, LESCO and SEPCO; an earlier $200m ADB loan funds 332,000+ AMI meters. (<a href="https://profit.pakistantoday.com.pk/2026/06/02/adb-proposes-dollar130-million-project-to-digitise-power-distribution-network-across-five-discos" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>Profit</a>, <a href="https://www.adb.org/news/adb-help-modernize-power-distribution-pakistan" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>ADB</a>)</div>
                          <div>· World Bank approved $375.9m for grid stability (BEST-PAK), July 2026. (<a href="https://www.worldbank.org/en/news/press-release/2026/07/08/world-bank-support-to-strengthen-pakistan-s-electricity-grid-for-improved-reliability-and-accelerated-clean-energy-growt" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>World Bank</a>)</div>
                          <div>· Government target: all old meters replaced with AMI by December 2026 via a PPP covering LESCO, MEPCO, PESCO, HAZECO and QESCO — a live tender window for the Smart Meter Plant. (<a href="https://propakistani.pk/2026/01/05/govt-to-roll-out-advanced-metering-infrastructure-in-5-electricity-companies/" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>ProPakistani</a>)</div>
                          <div style={{ fontWeight: 700, fontSize: "11px", color: COLOURS.NAVY, margin: "8px 0 3px" }}>COMPETITIVE SET — PRICE-DRIVEN TENDERS</div>
                          <div>· DISCO pole tenders go to the lowest compliant bidder — cost discipline IS the margin. Key rivals: <b>EAP</b> (Engineers Associated Precast, Lahore — spun-pole pioneer with a patent, 30+ years) and <b>Rajput Concrete</b> (supplying LESCO/MEPCO/GEPCO/FESCO since 2018), plus smaller regional makers. (<a href="https://eap.com.pk/" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>EAP</a>, <a href="https://rc.org.pk/" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>Rajput</a>)</div>
                          <div>· Meters: <b>Pak Elektron (PEL)</b> and <b>MicroTech (MTI)</b> are the established local meter makers — MicroTech has AMR deployed and is developing AMI products. The AMI spec (15-minute reporting over GPRS/RF mesh) raises the technical bar; NEPRA&apos;s rollout is running via LESCO, K-Electric and IESCO first. (<a href="https://www.mtilimited.com/about/rnd.php" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>MTI</a>, <a href="https://www.pakistannewsdesk.com/ami-meter-in-pakistan-guide/" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>AMI guide</a>)</div>
                          <div>· WAPDA/DISCO demand for spun poles is rising — one of their most-purchased items right now.</div>
                          <div style={{ fontWeight: 700, fontSize: "11px", color: COLOURS.RED, margin: "8px 0 3px" }}>COSTS — HEADWINDS</div>
                          <div>· Steel (grade 60 rebar) around PKR 222–232/kg — the main pole input cost; in lowest-bidder tenders, input swings hit margin directly. (<a href="https://priceit.pk/steel-rate-today/" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>priceit.pk</a>)</div>
                          <div>· Inflation still elevated (7–11% range through 2026); SBP policy rate 11.5% — bid pricing must carry financing cost. (<a href="https://tradingeconomics.com/pakistan/inflation-cpi" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>Trading Economics</a>)</div>
                          <div>· Energy costs elevated: petrol/diesel roughly 48%/38% above pre-conflict levels.</div>
                          <div style={{ fontSize: "11px", color: COLOURS.INK_400, marginTop: "8px" }}>Researched 29/07/2026 — directional context, not live data.</div>
                        </div>
                      )}
                    </div>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════
            BALANCE SHEET TAB
        ══════════════════════════════════════════════════════════════ */}
        {activeTab === "bs" && (
          <>
            {!hasUnze ? (
              <div style={cardStyle}>
                <p style={{ color: COLOURS.SLATE, fontSize: "14px" }}>You don&apos;t have access to Unze Trading financial data.</p>
              </div>
            ) : bsLoading ? (
              <SkeletonRows count={4} />
            ) : bsMonths.length === 0 ? (
              <div style={cardStyle}>
                <p style={{ color: COLOURS.SLATE, fontSize: "14px" }}>No balance sheets uploaded yet. Upload a month to get started.</p>
              </div>
            ) : !bsData ? (
              <div style={cardStyle}>
                <p style={{ color: COLOURS.SLATE, fontSize: "14px" }}>No data for the selected month.</p>
              </div>
            ) : (
              <>
                {/* ── Period chips ── */}
                <div style={{ display: "flex", gap: "5px", alignItems: "center", flexWrap: "wrap", marginBottom: "14px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, marginRight: "2px" }}>Month:</span>
                  {bsMonths.map((m) => (
                    <button
                      key={m}
                      style={chipBtn(bsMonth === m)}
                      onClick={() => setBsMonth(m)}
                    >
                      {MONTH_LABEL(m)}
                    </button>
                  ))}
                </div>

                {/* ── KPI cards ── */}
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: "10px", marginBottom: "10px" }}>
                  {/* Total Assets */}
                  <div style={{ ...cardStyle, padding: "12px 14px" }}>
                    <div style={{ fontSize: "10.5px", color: COLOURS.SLATE, fontWeight: 500, letterSpacing: ".02em", textTransform: "uppercase", marginBottom: "6px" }}>Total Assets</div>
                    <div style={{ fontSize: "21px", fontWeight: 700, color: COLOURS.NAVY }}>{fmtM(bsData.total_assets)}</div>
                    <div style={{ fontSize: "11px", color: COLOURS.INK_400, marginTop: "4px" }}>
                      {bsPrev ? `vs ${fmtM(bsPrev.total_assets)} ${MONTH_LABEL(bsPrev.month)}` : "No prior month"}
                    </div>
                    {bsPrev && (() => { const c = chgLabel(bsData.total_assets, bsPrev.total_assets); return c ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "10px", marginTop: "6px", background: c.up ? COLOURS.SUCCESS_SOFT : COLOURS.DANGER_SOFT, color: c.up ? COLOURS.GREEN : COLOURS.RED }}>{c.text}</span>
                    ) : null; })()}
                  </div>
                  {/* Owner's Equity */}
                  <div style={{ ...cardStyle, padding: "12px 14px" }}>
                    <div style={{ fontSize: "10.5px", color: COLOURS.SLATE, fontWeight: 500, letterSpacing: ".02em", textTransform: "uppercase", marginBottom: "6px" }}>Owner&apos;s Equity</div>
                    <div style={{ fontSize: "21px", fontWeight: 700, color: COLOURS.NAVY }}>{fmtM(bsData.total_equity)}</div>
                    <div style={{ fontSize: "11px", color: COLOURS.INK_400, marginTop: "4px" }}>
                      {bsData.total_assets > 0 ? `${((bsData.total_equity / bsData.total_assets) * 100).toFixed(1)}% of total assets` : "—"}
                    </div>
                    {bsPrev && (() => { const c = chgLabel(bsData.total_equity, bsPrev.total_equity); return c ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "10px", marginTop: "6px", background: c.up ? COLOURS.SUCCESS_SOFT : COLOURS.DANGER_SOFT, color: c.up ? COLOURS.GREEN : COLOURS.RED }}>{c.text}</span>
                    ) : null; })()}
                  </div>
                  {/* Working Capital */}
                  <div style={{ ...cardStyle, padding: "12px 14px" }}>
                    <div style={{ fontSize: "10.5px", color: COLOURS.SLATE, fontWeight: 500, letterSpacing: ".02em", textTransform: "uppercase", marginBottom: "6px" }}>Working Capital</div>
                    <div style={{ fontSize: "21px", fontWeight: 700, color: COLOURS.NAVY }}>{fmtM(bsWorkingCapital ?? 0)}</div>
                    <div style={{ fontSize: "11px", color: COLOURS.INK_400, marginTop: "4px" }}>
                      Current ratio: {bsCurrentRatio !== null ? bsCurrentRatio.toFixed(1) + "×" : "—"}
                    </div>
                    {bsPrev && (() => {
                      const prevWC = bsPrev.total_current - bsPrev.total_cl;
                      const c = chgLabel(bsWorkingCapital ?? 0, prevWC);
                      return c ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "10px", marginTop: "6px", background: c.up ? COLOURS.SUCCESS_SOFT : COLOURS.DANGER_SOFT, color: c.up ? COLOURS.GREEN : COLOURS.RED }}>{c.text}</span>
                      ) : null;
                    })()}
                  </div>
                  {/* Debt-to-Equity */}
                  <div style={{ ...cardStyle, padding: "12px 14px" }}>
                    <div style={{ fontSize: "10.5px", color: COLOURS.SLATE, fontWeight: 500, letterSpacing: ".02em", textTransform: "uppercase", marginBottom: "6px" }}>Debt-to-Equity</div>
                    <div style={{ fontSize: "21px", fontWeight: 700, color: COLOURS.NAVY }}>{bsDebtToEquity !== null ? bsDebtToEquity.toFixed(2) + "×" : "—"}</div>
                    <div style={{ fontSize: "11px", color: COLOURS.INK_400, marginTop: "4px" }}>Low leverage position</div>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "10px", marginTop: "6px", background: COLOURS.SUCCESS_SOFT, color: COLOURS.GREEN }}>▲ Healthy</span>
                  </div>
                </div>

                {/* ── Asset composition + Capital structure ── */}
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px", marginBottom: "10px" }}>

                  {/* Asset composition donut */}
                  <div style={cardStyle}>
                    <div style={sectionTitle}>Asset Composition</div>
                    <div style={sectionCaption}>Where the {fmtM(bsData.total_assets)} is held — {MONTH_LABEL(bsMonth)}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
                      <BsDonut d={bsData} />
                      <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                        {[
                          { c: COLOURS.NAVY,  label: "Fixed Assets",   v: bsData.total_fixed },
                          { c: COLOURS.BLUE,  label: "Receivables",    v: bsData.receivables },
                          { c: COLOURS.AMBER, label: "Stocks",         v: bsData.stocks },
                          { c: COLOURS.GREEN, label: "Advance Tax",    v: bsData.advance_taxation },
                          { c: COLOURS.SLATE, label: "Cash & Bank",    v: bsData.cash_bank },
                          { c: "#CBD5E1",      label: "Advances",      v: bsData.advances_prepayments },
                        ].map((seg) => (
                          <div key={seg.label} style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "12px", color: COLOURS.INK_700 }}>
                            <div style={{ width: "9px", height: "9px", borderRadius: "50%", background: seg.c, flexShrink: 0 }} />
                            <span>{seg.label}</span>
                            <span style={{ marginLeft: "auto", fontWeight: 700, color: COLOURS.NAVY, fontFamily: "monospace", fontSize: "11px" }}>{fmtM(seg.v)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Capital structure */}
                  <div style={cardStyle}>
                    <div style={sectionTitle}>Capital Structure</div>
                    <div style={sectionCaption}>How total assets are financed — equity-heavy signals low risk</div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "3px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE }}>EQUITY &amp; LIABILITIES</span>
                      <span style={{ fontSize: "11px", color: COLOURS.NAVY, fontWeight: 700, fontFamily: "monospace" }}>{fmtM(bsData.total_assets)}</span>
                    </div>
                    {/* Stacked bar */}
                    <div style={{ width: "100%", height: "10px", borderRadius: "99px", overflow: "hidden", display: "flex", marginBottom: "10px" }}>
                      <div style={{ width: `${bsEqPct}%`, height: "100%", background: COLOURS.NAVY }} />
                      <div style={{ width: `${bsNclPct}%`, height: "100%", background: COLOURS.AMBER }} />
                      <div style={{ width: `${bsClPct}%`, height: "100%", background: COLOURS.RED, opacity: 0.8 }} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "7px", marginBottom: "12px" }}>
                      {[
                        { c: COLOURS.NAVY,  label: "Owner's Equity",           pct: bsEqPct,  v: bsData.total_equity },
                        { c: COLOURS.AMBER, label: "Non-Current Liabilities",  pct: bsNclPct, v: Math.max(0, bsData.total_ncl) },
                        { c: COLOURS.RED,   label: "Current Liabilities",       pct: bsClPct,  v: bsData.total_cl },
                      ].map((seg) => (
                        <div key={seg.label} style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "12px", color: COLOURS.INK_700 }}>
                          <div style={{ width: "9px", height: "9px", borderRadius: "50%", background: seg.c, flexShrink: 0, opacity: seg.c === COLOURS.RED ? 0.8 : 1 }} />
                          <span>{seg.label}</span>
                          <span style={{ marginLeft: "auto", fontWeight: 700, color: COLOURS.NAVY, fontFamily: "monospace", fontSize: "11px" }}>{seg.pct.toFixed(1)}% · {fmtM(seg.v)}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ height: "1px", background: COLOURS.HAIRLINE, margin: "0 0 10px" }} />
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0" }}>
                      {[
                        { label: "Owner Capital",      v: bsData.owner_capital },
                        { label: "Revenue Reserves",   v: bsData.revenue_reserves },
                        { label: "Retained Earnings",  v: bsData.retained_earnings },
                      ].map((item, i) => (
                        <div key={item.label} style={{ padding: "8px 0", borderRight: i < 2 ? `1px solid ${COLOURS.HAIRLINE}` : "none", paddingRight: i < 2 ? "12px" : "0", marginRight: i < 2 ? "12px" : "0" }}>
                          <div style={{ fontSize: "10px", color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: "3px" }}>{item.label}</div>
                          <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY, fontFamily: "monospace" }}>{fmtM(item.v)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ── Full Balance Sheet table ── */}
                <div style={{ ...cardStyle, marginBottom: "10px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", marginBottom: "14px", flexWrap: "wrap" }}>
                    <div>
                      <div style={sectionTitle}>Statement of Financial Position</div>
                      <div style={{ fontSize: "11px", color: COLOURS.INK_400, marginTop: "2px" }}>
                        Unze Trading Pvt. Ltd &nbsp;·&nbsp; As at {MONTH_LABEL(bsMonth)} &nbsp;·&nbsp; Amounts in PKR
                      </div>
                    </div>
                    {bsPrev && (
                      <span style={{ fontSize: "10.5px", color: COLOURS.SLATE, border: `1px solid ${COLOURS.HAIRLINE}`, padding: "4px 10px", borderRadius: "6px", whiteSpace: "nowrap", flexShrink: 0 }}>
                        Comparing vs {MONTH_LABEL(bsPrev.month)}
                      </span>
                    )}
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "520px" }}>
                      <thead>
                        <tr>
                          <th style={{ width: "44%", textAlign: "left", padding: "5px 10px 7px", fontSize: "10.5px", fontWeight: 600, color: COLOURS.SLATE, borderBottom: `1px solid ${COLOURS.SLATE}`, letterSpacing: ".03em", textTransform: "uppercase" }}>Item</th>
                          <th style={{ width: "44px", textAlign: "right", padding: "5px 10px 7px", fontSize: "10.5px", fontWeight: 600, color: COLOURS.SLATE, borderBottom: `1px solid ${COLOURS.SLATE}`, letterSpacing: ".03em", textTransform: "uppercase" }}>Note</th>
                          <th style={{ textAlign: "right", padding: "5px 10px 7px", fontSize: "10.5px", fontWeight: 600, color: COLOURS.SLATE, borderBottom: `1px solid ${COLOURS.SLATE}`, letterSpacing: ".03em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{MONTH_LABEL(bsMonth)} (₨)</th>
                          <th style={{ textAlign: "right", padding: "5px 10px 7px", fontSize: "10.5px", fontWeight: 600, color: COLOURS.SLATE, borderBottom: `1px solid ${COLOURS.SLATE}`, letterSpacing: ".03em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{bsPrev ? MONTH_LABEL(bsPrev.month) : "Prior"} (₨)</th>
                          <th style={{ width: "80px", textAlign: "right", padding: "5px 10px 7px", fontSize: "10.5px", fontWeight: 600, color: COLOURS.SLATE, borderBottom: `1px solid ${COLOURS.SLATE}`, letterSpacing: ".03em", textTransform: "uppercase" }}>vs Prior</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* ASSETS */}
                        <BsSectionHeader label="Assets" />
                        <BsSubHeader label="Fixed Assets" />
                        <BsItem label="Property, Plant & Equipment"  note="1"   cur={bsData.ppe}                  prev={bsPrev?.ppe} />
                        <BsItem label="Long Term Investment"          note="2"   cur={bsData.long_term_investment} prev={bsPrev?.long_term_investment} />
                        <BsSubtotal label="Total Fixed Assets"                  cur={bsData.total_fixed}          prev={bsPrev?.total_fixed} />

                        <BsSpacer />
                        <BsSubHeader label="Current Assets" />
                        <BsItem label="Investment, Deposits & Receivables" note="3"   cur={bsData.receivables}          prev={bsPrev?.receivables} />
                        <BsItem label="Stocks — RM, WIP, FG, Stores & Spares" note="4–5" cur={bsData.stocks}            prev={bsPrev?.stocks} />
                        <BsItem label="Advance & Prepayments"               note="6"   cur={bsData.advances_prepayments} prev={bsPrev?.advances_prepayments} />
                        <BsItem label="Advance Taxation"                     note="7"   cur={bsData.advance_taxation}     prev={bsPrev?.advance_taxation} />
                        <BsItem label="Cash at Bank & in Hand"               note="8"   cur={bsData.cash_bank}            prev={bsPrev?.cash_bank} />
                        <BsSubtotal label="Total Current Assets"                        cur={bsData.total_current}        prev={bsPrev?.total_current} />

                        <BsSpacer />
                        <BsGrandTotal label="TOTAL ASSETS" cur={bsData.total_assets} prev={bsPrev?.total_assets} />

                        {/* EQUITY & LIABILITIES */}
                        <BsSpacer />
                        <BsSectionHeader label="Equity & Liabilities" />
                        <BsSubHeader label="Capital & Reserves" />
                        <BsItem label="Owner Capital"      note="9"  cur={bsData.owner_capital}    prev={bsPrev?.owner_capital} />
                        <BsItem label="Revenue Reserves"             cur={bsData.revenue_reserves}  prev={bsPrev?.revenue_reserves} />
                        <BsItem label="Retained Earnings"            cur={bsData.retained_earnings} prev={bsPrev?.retained_earnings} />
                        <BsSubtotal label="Total Owner's Equity"     cur={bsData.total_equity}      prev={bsPrev?.total_equity} />

                        <BsSpacer />
                        <BsSubHeader label="Non-Current Liabilities" />
                        <BsItem label="HBL Short Term Facility"   note="10" cur={bsData.hbl_stf}          prev={bsPrev?.hbl_stf} />
                        <BsItem label="Loan from Family"           note="11" cur={bsData.loan_family}      prev={bsPrev?.loan_family} />
                        <BsItem label="Mazhar Sb A/c"              note="12" cur={bsData.mazhar_sb_ac}     prev={bsPrev?.mazhar_sb_ac} />
                        <BsItem label="Loan from Associates"       note="13" cur={bsData.loan_associates}  prev={bsPrev?.loan_associates} />
                        <BsItem label="Lease Liabilities"          note="14" cur={bsData.lease_liabilities} prev={bsPrev?.lease_liabilities} />
                        <BsSubtotal label="Total Non-Current Liabilities" cur={bsData.total_ncl} prev={bsPrev?.total_ncl} />

                        <BsSpacer />
                        <BsSubHeader label="Current Liabilities" />
                        <BsItem label="Accrued Liabilities" note="15" cur={bsData.accrued_liabilities} prev={bsPrev?.accrued_liabilities} />
                        <BsItem label="Payable Controls"    note="16" cur={bsData.payable_controls}    prev={bsPrev?.payable_controls} />
                        <BsItem label="Taxation"            note="17" cur={bsData.taxation}             prev={bsPrev?.taxation} />
                        <BsSubtotal label="Total Current Liabilities"  cur={bsData.total_cl}           prev={bsPrev?.total_cl} />

                        <BsSpacer />
                        <BsGrandTotal label="TOTAL EQUITY & LIABILITIES" cur={bsData.total_equity_liabilities} prev={bsPrev?.total_equity_liabilities} />
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ── Key Ratios ── */}
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: "10px", marginBottom: "20px" }}>
                  <div style={cardStyle}>
                    <div style={sectionTitle}>Liquidity</div>
                    <div style={sectionCaption}>Ability to meet short-term obligations</div>
                    <RatioRow label="Current Ratio"  value={bsCurrentRatio !== null ? bsCurrentRatio.toFixed(1) + "×" : "—"} colour={ratioColour(bsCurrentRatio, 2, 1)} />
                    <RatioRow label="Quick Ratio"    value={bsQuickRatio   !== null ? bsQuickRatio.toFixed(1)   + "×" : "—"} colour={ratioColour(bsQuickRatio, 1, 0.5)} />
                    <RatioRow label="Cash Ratio"     value={bsCashRatio    !== null ? bsCashRatio.toFixed(1)    + "×" : "—"} colour={ratioColour(bsCashRatio, 0.5, 0.2)} />
                  </div>
                  <div style={cardStyle}>
                    <div style={sectionTitle}>Solvency</div>
                    <div style={sectionCaption}>Long-term financial stability</div>
                    <RatioRow label="Debt-to-Equity" value={bsDebtToEquity !== null ? bsDebtToEquity.toFixed(2) + "×" : "—"} colour={ratioColour(bsDebtToEquity, 1, 2, false)} />
                    <RatioRow label="Equity Ratio"   value={bsEquityRatio  !== null ? bsEquityRatio.toFixed(1)  + "%" : "—"} colour={ratioColour(bsEquityRatio, 50, 30)} />
                    <RatioRow label="Debt Ratio"     value={bsDebtRatio    !== null ? bsDebtRatio.toFixed(1)    + "%" : "—"} colour={ratioColour(bsDebtRatio, 50, 70, false)} />
                  </div>
                  <div style={cardStyle}>
                    <div style={sectionTitle}>Key Balances</div>
                    <div style={sectionCaption}>Snapshot values for {MONTH_LABEL(bsMonth)}</div>
                    <RatioRow label="Working Capital"    value={fmtM(bsWorkingCapital ?? 0)}   colour={COLOURS.NAVY} />
                    <RatioRow label="Net Fixed Assets"   value={fmtM(bsData.total_fixed)}      colour={COLOURS.NAVY} />
                    <RatioRow label="Cash & Equivalents" value={fmtM(bsData.cash_bank)}        colour={COLOURS.NAVY} />
                  </div>
                </div>
              </>
            )}
          </>
        )}

      </main>
    </AuthWrapper>
  );
}
