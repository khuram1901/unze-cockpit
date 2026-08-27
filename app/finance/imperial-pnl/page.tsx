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
import { IFPL_COMPANY_ID } from "../../lib/constants";
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
type RestatedItem = { scope: string; line: string; old_value: number; new_value: number };
type UploadResult = { month: string; accepted: boolean; summary: string; failed?: CheckDetail[]; warnings?: CheckDetail[]; restated?: RestatedItem[] };
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

// ═══════════════════════════════════════════════════════════════════════════
// Balance Sheet (mirrors the Unze Trading BS tab, adapted to Imperial's
// statement structure: partner-funded equity, supplier-credit-heavy current
// liabilities, retail stock as the dominant asset).
// ═══════════════════════════════════════════════════════════════════════════

// Row returned by get_balance_sheet_ifl RPC (raw table row)
type IflBsRow = {
  month: string;
  partner_waqas: number; partner_remon: number; partner_samira: number;
  retained_earnings: number;
  lt_payable_khurram: number; lt_provident_fund: number;
  trade_creditors: number; security_deposits: number; charity_uk: number;
  payable_related_parties: number; intercompany_payables: number;
  other_payables: number; accrued_expenses: number;
  fixed_assets: number; receivables_kamran: number; long_term_investments: number;
  provident_fund_asset: number;
  stock: number; intercompany_receivables: number; receivables_directors: number;
  trade_debtors: number; supplier_deposits: number; prepayments: number;
  employee_loans: number; advance_income_tax: number; cash_bank: number;
  audit_warnings?: string[] | null;
};

// Account-level note line returned by get_balance_sheet_notes RPC
type BsNoteLine = {
  note_no: number;
  section: string | null;
  account_code: string | null;
  account_name: string;
  amount: number | null;
  is_total: boolean;
  is_header: boolean;
  row_order: number;
};

// Format full PKR integer with commas; negatives in parentheses
const fmtPKR = (n: number | null | undefined): string => {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.round(Math.abs(n)).toLocaleString();
  return n < 0 ? `(${abs})` : abs;
};

// % change string with arrow
const chgLabel = (cur: number, prev: number | null | undefined): { text: string; up: boolean } | null => {
  if (prev === null || prev === undefined || prev === 0) return null;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  if (!Number.isFinite(pct)) return null;
  const rounded = Math.round(pct * 10) / 10;
  return { text: `${rounded > 0 ? "▲" : rounded < 0 ? "▼" : ""} ${Math.abs(rounded)}%`, up: rounded >= 0 };
};

function BsSectionHeader({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={5} style={{ padding: "8px 10px 4px", fontSize: "10px", fontWeight: 700, color: COLOURS.SLATE, letterSpacing: ".08em", textTransform: "uppercase", background: COLOURS.TRACK }}>{label}</td>
    </tr>
  );
}
function BsSubHeader({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={5} style={{ padding: "8px 10px 3px 10px", fontSize: "10px", fontWeight: 600, color: COLOURS.SLATE, letterSpacing: ".05em", textTransform: "uppercase" }}>{label}</td>
    </tr>
  );
}
function BsItem({ label, note, cur, prev, onNoteClick }: { label: string; note?: string; cur: number; prev?: number | null; onNoteClick?: (n: string) => void }) {
  const chg = prev != null ? chgLabel(cur, prev) : null;
  const isNeg = cur < 0;
  const prevNeg = prev != null && prev < 0;
  return (
    <tr style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
      <td style={{ padding: "5px 10px 5px 22px", fontSize: "12px", color: COLOURS.INK_700 }}>{label}</td>
      <td style={{ padding: "5px 10px", fontSize: "10px", textAlign: "right", whiteSpace: "nowrap" }}>
        {note && onNoteClick
          ? <button onClick={() => onNoteClick(note)} style={{ background: "none", border: "none", cursor: "pointer", color: COLOURS.BLUE, fontSize: "10px", fontWeight: 700, textDecoration: "underline", padding: 0, fontFamily: "inherit" }}>{note}</button>
          : <span style={{ color: COLOURS.INK_400 }}>{note}</span>}
      </td>
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
function RatioRow({ label, value, colour }: { label: string; value: string; colour: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
      <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{label}</span>
      <span style={{ fontSize: "12.5px", fontWeight: 700, fontFamily: "monospace", color: colour }}>{value}</span>
    </div>
  );
}

// Note summaries shown above the account-level breakdown in the note panel.
const IFL_BS_NOTES: Record<string, { title: string; description: string }> = {
  "1": { title: "Partner Investments", description: "Capital invested by the partners — Waqas Saleem, Remon Ahmed and Samira Waqas. Movements reflect new investment, transfers to related ventures and dividends." },
  "2": { title: "Retained Earnings", description: "Accumulated profit kept in the business: opening balance plus the period's profit, less dividends and charity." },
  "3": { title: "Supplier Deposits", description: "Security deposits held against rental properties and advances paid to suppliers (local and China)." },
  "4": { title: "Long Term Investments", description: "Investments outside day-to-day retail — Jhang Phase 2 shop fit-out and the KKBJ investment account." },
  "5": { title: "Stock", description: "Inventory across warehouse and shops: retail stock, packing material and office supplies. The single largest asset on the balance sheet." },
  "6": { title: "Prepayments", description: "Expenses paid ahead of use — prepaid expenses, store prepayments, China shipment costs, insurance and the customs PD account." },
  "7": { title: "Employee Loans & Advances", description: "Advances against salary and loans to head-office staff." },
  "8": { title: "Cash & Bank", description: "Cash in hand and every bank account, plus credit-card balances. The note lists each account with its balance." },
  "9": { title: "Advance Income Tax", description: "Withholding and advance income tax already paid — on imports, services, utilities, bank profit and customer collections — recoverable against the final tax bill." },
};

// Plain-English CEO insights — every sentence computed from the selected
// period's numbers.
function IflInsightsCard({ monthLabel, data, prev }: { monthLabel: string; data: IflBsRow; prev: IflBsRow | null }) {
  const t = (d: IflBsRow) => {
    const equity = d.partner_waqas + d.partner_remon + d.partner_samira + d.retained_earnings;
    const ltLiab = d.lt_payable_khurram + d.lt_provident_fund;
    const stLiab = d.trade_creditors + d.security_deposits + d.charity_uk + d.payable_related_parties + d.intercompany_payables + d.other_payables + d.accrued_expenses;
    const ltAssets = d.fixed_assets + d.receivables_kamran + d.long_term_investments + d.provident_fund_asset;
    const curAssets = d.stock + d.intercompany_receivables + d.receivables_directors + d.trade_debtors + d.supplier_deposits + d.prepayments + d.employee_loans + d.advance_income_tax + d.cash_bank;
    return { equity, ltLiab, stLiab, ltAssets, curAssets, assets: ltAssets + curAssets };
  };
  const c = t(data);
  const p = prev ? t(prev) : null;
  const currentRatio = c.stLiab > 0 ? c.curAssets / c.stLiab : null;
  const quickRatio = c.stLiab > 0 ? (c.curAssets - data.stock) / c.stLiab : null;
  const cashRatio = c.stLiab > 0 ? data.cash_bank / c.stLiab : null;
  const debtToEquity = c.equity > 0 ? (c.ltLiab + c.stLiab) / c.equity : null;
  const equityRatio = c.assets > 0 ? (c.equity / c.assets) * 100 : null;
  const workingCapital = c.curAssets - c.stLiab;
  const cashPct = cashRatio !== null ? Math.round(cashRatio * 100) : null;
  const rs = (n: number) => `₨${fmtM(n)}`;

  const liqVerdict = currentRatio === null ? null
    : currentRatio >= 2 ? { word: "comfortable", colour: COLOURS.GREEN }
    : currentRatio >= 1 ? { word: "adequate but worth watching", colour: COLOURS.AMBER }
    : { word: "strained — bills due exceed liquid assets", colour: COLOURS.RED };
  const levVerdict = debtToEquity === null ? null
    : debtToEquity < 0.5 ? { word: "very low reliance on borrowed money", colour: COLOURS.GREEN }
    : debtToEquity < 1 ? { word: "moderate reliance on outside money", colour: COLOURS.AMBER }
    : { word: "heavy reliance on outside money — mostly supplier credit", colour: COLOURS.RED };

  const overall = liqVerdict && levVerdict
    ? currentRatio! >= 2 && debtToEquity! < 0.5
      ? "Overall this is a strong position: the business owns far more than it owes, carries little debt, and can cover its short-term bills several times over."
      : currentRatio! >= 1 && debtToEquity! < 1.5
      ? "Overall the position is workable, but the balance sheet leans on supplier credit and stock — the items below deserve regular attention."
      : "Overall the position needs attention: short-term obligations are large relative to the resources available to pay them."
    : "";

  const watch: string[] = [];
  if (cashRatio !== null && cashRatio < 0.5) {
    watch.push(`Actual cash covers only ${cashPct}% of short-term bills (${rs(data.cash_bank)} against ${rs(c.stLiab)}). Everything else depends on selling stock and collecting receivables on time — if sales slow, cash gets tight quickly.`);
  }
  if (c.curAssets > 0 && data.stock / c.curAssets > 0.5) {
    watch.push(`Stock is ${Math.round((data.stock / c.curAssets) * 100)}% of current assets (${rs(data.stock)}). Stock only becomes money when it sells — slow-moving lines quietly tie up working capital and risk end-of-season markdowns.`);
  }
  if (c.stLiab > 0 && data.trade_creditors / c.stLiab > 0.7) {
    watch.push(`Trade creditors are ${Math.round((data.trade_creditors / c.stLiab) * 100)}% of what the business owes short-term (${rs(data.trade_creditors)}). Growth financed by supplier credit is cheap, but it means suppliers effectively fund the shelves — keep relationships and payment terms healthy.`);
  }
  if (p && prev && prev.cash_bank > 0 && Math.abs(data.cash_bank - prev.cash_bank) / prev.cash_bank > 0.3) {
    const dir = data.cash_bank > prev.cash_bank ? "rose" : "fell";
    watch.push(`Cash ${dir} sharply vs the prior period (${rs(prev.cash_bank)} → ${rs(data.cash_bank)}). One-off movements are fine; a repeating slide is the earliest warning a CEO gets.`);
  }
  const watchShown = watch.slice(0, 3);
  const wcChange = p ? workingCapital - (p.curAssets - p.stLiab) : null;

  const para: React.CSSProperties = { fontSize: "12px", color: COLOURS.INK_700, lineHeight: 1.7, marginBottom: "10px" };
  const h: React.CSSProperties = { fontSize: "11px", fontWeight: 700, color: COLOURS.NAVY, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px", marginTop: "12px" };

  return (
    <div style={{ ...cardStyle, marginBottom: "20px" }}>
      <div style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "2px" }}>What these numbers mean — {monthLabel}</div>
      <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginBottom: "10px" }}>A plain-English read of the ratios above. Every figure updates with the period you select.</div>

      {overall && <div style={{ ...para, fontWeight: 600, color: COLOURS.NAVY }}>{overall}</div>}

      <div style={h}>Can the business pay its bills? (Liquidity)</div>
      <div style={para}>
        {currentRatio !== null && <>For every ₨1 of bills due within the year, the business holds <b>₨{currentRatio.toFixed(2)}</b> in assets that are cash or will soon become cash — {liqVerdict && <span style={{ color: liqVerdict.colour, fontWeight: 600 }}>{liqVerdict.word}</span>}. (Above 2 is comfortable; below 1 means bills exceed liquid resources.) </>}
        {quickRatio !== null && <>Strip out stock — which must sell first — and that drops to <b>₨{quickRatio.toFixed(2)}</b> per ₨1 owed. </>}
        {cashRatio !== null && <>In actual cash at the bank today, there is <b>₨{cashRatio.toFixed(2)}</b> per ₨1 owed — roughly <b>{cashPct}%</b> of short-term dues could be settled immediately.</>}
      </div>

      <div style={h}>Whose money runs the business? (Solvency)</div>
      <div style={para}>
        {equityRatio !== null && <><b>{equityRatio.toFixed(0)}%</b> of everything the company owns is funded by the partners&apos; own money and retained profits; <b>{(100 - equityRatio).toFixed(0)}%</b> comes from suppliers and other creditors. </>}
        {debtToEquity !== null && <>Put differently, the business owes <b>₨{debtToEquity.toFixed(2)}</b> for every ₨1 of the partners&apos; capital — {levVerdict && <span style={{ color: levVerdict.colour, fontWeight: 600 }}>{levVerdict.word}</span>}.</>}
      </div>

      <div style={h}>The cushion (Working Capital)</div>
      <div style={para}>
        <>If every short-term bill were paid tomorrow, <b>{rs(workingCapital)}</b> would remain working inside the business — the shock absorber for late seasons, slow lines and surprises. </>
        {wcChange !== null && Math.abs(wcChange) > 1_000_000 && <>The cushion {wcChange > 0 ? "grew" : "shrank"} by <b>{rs(Math.abs(wcChange))}</b> versus the prior period{wcChange < 0 ? " — worth understanding why before it becomes a trend" : ""}.</>}
      </div>

      {watchShown.length > 0 && (
        <>
          <div style={h}>What to watch</div>
          {watchShown.map((w, i) => (
            <div key={i} style={{ ...para, marginBottom: "6px", paddingLeft: "10px", borderLeft: `2.5px solid ${COLOURS.AMBER}` }}>{w}</div>
          ))}
        </>
      )}

      <div style={{ fontSize: "10px", color: COLOURS.INK_400, marginTop: "8px", fontStyle: "italic" }}>
        Rule of thumb: liquidity ratios answer &ldquo;can I pay this year&apos;s bills?&rdquo;, solvency ratios answer &ldquo;who really owns this business?&rdquo;, and working capital is the shock absorber between the two.
      </div>
    </div>
  );
}

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
  const [showRestatements, setShowRestatements] = useState(false);
  const [restatements, setRestatements] = useState<(RestatedItem & { month: string; changed_by: string; changed_at: string })[] | null>(null);
  const [checkIssues, setCheckIssues] = useState<CheckIssue[] | null>(null);

  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);

  // ── Tabs: P&L | Balance Sheet ────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"pnl" | "bs">("pnl");

  // ── Balance Sheet state ──────────────────────────────────────────────
  const [bsMonths, setBsMonths] = useState<string[]>([]);
  const [bsMonth, setBsMonth] = useState<string>("");
  const [bsData, setBsData] = useState<IflBsRow | null>(null);
  const [bsPrev, setBsPrev] = useState<IflBsRow | null>(null);
  const [bsLoading, setBsLoading] = useState(false);
  const [bsNoteLines, setBsNoteLines] = useState<BsNoteLine[]>([]);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [showBsUpload, setShowBsUpload] = useState(false);
  const [bsUploadFile, setBsUploadFile] = useState<File | null>(null);
  const [bsUploading, setBsUploading] = useState(false);
  const [bsUploadResult, setBsUploadResult] = useState<{
    accepted?: boolean; month?: string; sheetUsed?: string; error?: string; summary?: string;
    checks?: { name: string; expected: number; reported: number; diff: number; passed: boolean; note?: string }[];
    auditWarnings?: string[];
  } | null>(null);

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

  // ── BS: load available months ────────────────────────────────────────
  useEffect(() => {
    let active = true;
    async function loadBsMonths() {
      const { data } = await supabase.rpc("get_balance_sheet_ifl_months", { p_company_id: IFPL_COMPANY_ID });
      if (!active) return;
      const months = ((data || []) as { month: string }[]).map((r) => r.month);
      setBsMonths(months);
      if (months.length > 0) setBsMonth(months[months.length - 1]);
    }
    loadBsMonths();
    return () => { active = false; };
  }, []);

  // ── BS: load data + note lines for selected month ───────────────────
  useEffect(() => {
    if (!bsMonth) return;
    let active = true;
    async function loadBs() {
      setBsLoading(true);
      const [bsRes, notesRes] = await Promise.all([
        supabase.rpc("get_balance_sheet_ifl", { p_company_id: IFPL_COMPANY_ID, p_month: bsMonth }),
        supabase.rpc("get_balance_sheet_notes", { p_company_id: IFPL_COMPANY_ID, p_month: bsMonth }),
      ]);
      if (!active) return;
      const rows = (bsRes.data || []) as IflBsRow[];
      setBsData(rows[0] || null);
      setBsPrev(rows[1] || null);
      setBsNoteLines((notesRes.data || []) as BsNoteLine[]);
      setBsLoading(false);
    }
    loadBs();
    return () => { active = false; };
  }, [bsMonth]);

  async function handleBsUpload() {
    if (!bsUploadFile) return;
    setBsUploading(true);
    setBsUploadResult(null);
    const form = new FormData();
    form.append("file", bsUploadFile);
    // Month is auto-detected server-side from the filename
    const res = await authFetch("/api/finance/ifl-bs-upload", { method: "POST", body: form });
    const body = await res.json();
    setBsUploadResult(body);
    setBsUploading(false);
    if (body.accepted) {
      const { data } = await supabase.rpc("get_balance_sheet_ifl_months", { p_company_id: IFPL_COMPANY_ID });
      const months = ((data || []) as { month: string }[]).map((r) => r.month);
      setBsMonths(months);
      if (body.month) setBsMonth(body.month);
    }
  }

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
      let body: { results?: UploadResult[]; error?: string; priorYearWarnings?: string[] } = {};
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
      const mapped = ((body.results || []) as UploadResult[]).map((r) => ({
        ...r,
        failed: detail(r.month, true),
        warnings: detail(r.month, false),
      }));
      // Prior-year consistency: the file's own summary tabs vs the app's
      // confirmed records — rendered as an extra warning row (also emailed
      // to the CEO by the server).
      for (const w of body.priorYearWarnings || []) {
        mapped.push({ month: "", accepted: false, summary: `⚠ ${w}`, failed: [], warnings: [] });
      }
      setUploadResults(mapped);
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

  async function toggleRestatements() {
    const next = !showRestatements;
    setShowRestatements(next);
    if (next && restatements === null) {
      const { data } = await supabase.rpc("get_pnl_restatements", { p_company: "IFPL", p_limit: 100 });
      setRestatements((data || []) as (RestatedItem & { month: string; changed_by: string; changed_at: string })[]);
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

  // ── BS derived totals & ratios ───────────────────────────────────────
  const bsT = bsData ? {
    equity: bsData.partner_waqas + bsData.partner_remon + bsData.partner_samira + bsData.retained_earnings,
    ltLiab: bsData.lt_payable_khurram + bsData.lt_provident_fund,
    stLiab: bsData.trade_creditors + bsData.security_deposits + bsData.charity_uk + bsData.payable_related_parties + bsData.intercompany_payables + bsData.other_payables + bsData.accrued_expenses,
    ltAssets: bsData.fixed_assets + bsData.receivables_kamran + bsData.long_term_investments + bsData.provident_fund_asset,
    curAssets: bsData.stock + bsData.intercompany_receivables + bsData.receivables_directors + bsData.trade_debtors + bsData.supplier_deposits + bsData.prepayments + bsData.employee_loans + bsData.advance_income_tax + bsData.cash_bank,
  } : null;
  const bsPrevT = bsPrev ? {
    equity: bsPrev.partner_waqas + bsPrev.partner_remon + bsPrev.partner_samira + bsPrev.retained_earnings,
    ltLiab: bsPrev.lt_payable_khurram + bsPrev.lt_provident_fund,
    stLiab: bsPrev.trade_creditors + bsPrev.security_deposits + bsPrev.charity_uk + bsPrev.payable_related_parties + bsPrev.intercompany_payables + bsPrev.other_payables + bsPrev.accrued_expenses,
    ltAssets: bsPrev.fixed_assets + bsPrev.receivables_kamran + bsPrev.long_term_investments + bsPrev.provident_fund_asset,
    curAssets: bsPrev.stock + bsPrev.intercompany_receivables + bsPrev.receivables_directors + bsPrev.trade_debtors + bsPrev.supplier_deposits + bsPrev.prepayments + bsPrev.employee_loans + bsPrev.advance_income_tax + bsPrev.cash_bank,
  } : null;
  const bsCurrentRatio = bsT && bsT.stLiab > 0 ? bsT.curAssets / bsT.stLiab : null;
  const bsQuickRatio   = bsT && bsData && bsT.stLiab > 0 ? (bsT.curAssets - bsData.stock) / bsT.stLiab : null;
  const bsCashRatio    = bsT && bsData && bsT.stLiab > 0 ? bsData.cash_bank / bsT.stLiab : null;
  const bsDebtToEquity = bsT && bsT.equity > 0 ? (bsT.ltLiab + bsT.stLiab) / bsT.equity : null;
  const bsEquityRatio  = bsT ? (bsT.equity / (bsT.ltAssets + bsT.curAssets)) * 100 : null;
  const bsDebtRatio    = bsEquityRatio !== null ? 100 - bsEquityRatio : null;
  const bsWorkingCapital = bsT ? bsT.curAssets - bsT.stLiab : null;
  const ratioColour = (v: number | null, good: number, warn: number, higherIsBetter = true) => {
    if (v === null) return COLOURS.INK_400;
    if (higherIsBetter) return v >= good ? COLOURS.GREEN : v >= warn ? COLOURS.AMBER : COLOURS.RED;
    return v <= good ? COLOURS.GREEN : v <= warn ? COLOURS.AMBER : COLOURS.RED;
  };

  return (
    <AuthWrapper>
      <main style={{ padding: "14px 18px", maxWidth: "1100px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "12px" }}>
          <PageHeader />
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {activeTab === "pnl" && (
              <button onClick={() => { setShowUpload(!showUpload); setUploadResults([]); }} style={chipBtn(showUpload)}>
                {showUpload ? "Close upload" : "Upload workbook"}
              </button>
            )}
            {activeTab === "bs" && (
              <button onClick={() => { setShowBsUpload(!showBsUpload); setBsUploadResult(null); }} style={chipBtn(showBsUpload)}>
                {showBsUpload ? "Close upload" : "Upload period"}
              </button>
            )}
          </div>
        </div>

        {/* ── Tabs ── */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "14px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, paddingBottom: "10px" }}>
          <button style={chipBtn(activeTab === "pnl")} onClick={() => setActiveTab("pnl")}>PNL</button>
          <button style={chipBtn(activeTab === "bs")} onClick={() => setActiveTab("bs")}>
            BS{bsMonths.length > 0 ? ` · ${MONTH_LABEL(bsMonths[bsMonths.length - 1])}` : ""}
          </button>
        </div>

        {activeTab === "pnl" && showUpload && (
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

        {activeTab === "pnl" && (loading ? (
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
                        These are the source file&apos;s own inconsistencies — the exact cells that don&apos;t reconcile. Fix them in the workbook and re-upload; each one clears automatically once its month passes.
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
                      <div style={{ fontSize: "11px", color: COLOURS.INK_400 }}>
                        Known cause for Aug 25: Hakim Mall has 2.0m net sales recorded with no COGS or gross profit entered. Oct 25&apos;s two are in the projection columns — a GP cell and a hardcoded Total Overheads that don&apos;t match their own parts.
                      </div>
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
                  <div>· Pakistan&apos;s footwear market growing ~6.5% a year; overall retail ~8.2% — driven by a young population, urbanisation and a growing middle class. (<a href="https://www.6wresearch.com/industry-report/pakistan-footwear-market-2020-2026" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>6Wresearch</a>, <a href="https://www.6wresearch.com/industry-report/pakistan-retail-industry-market-outlook" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>retail outlook</a>)</div>
                  <div>· E-commerce is the growth engine: online sales projected past PKR 1.2 trillion in 2026, 85%+ of orders on mobile, fashion the top marketplace category — plays directly to Online PK&apos;s strength. (<a href="https://www.digitalmediatrend.com/pakistan-e-commerce-in-2026-pakistans-e-commerce-growth-and-market-share/" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>Digital Media Trend</a>, <a href="https://www.statista.com/outlook/emo/ecommerce/pakistan" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>Statista</a>)</div>
                  <div>· Social commerce (Facebook/Instagram/TikTok/WhatsApp selling) heading toward ~35% of online retail; cash on delivery still ~95% of orders.</div>
                  <div style={{ fontWeight: 700, fontSize: "11px", color: COLOURS.NAVY, margin: "8px 0 3px" }}>COMPETITIVE SET — THREE FRONTS</div>
                  <div>· <b>Premium ladies</b>: Stylo (200+ outlets, plus premium sister brand Insignia), Metro Shoes (40+ outlets), ECS — the fight is design, bridal/festive range and mall presence.</div>
                  <div>· <b>Mid-market volume</b>: Bata, Service (with youth brand Ndure), Borjan (145+ outlets, Rafum Group) — they compete on price and reach; matching them on price erodes the premium position.</div>
                  <div>· <b>Online</b>: marketplaces, social sellers and D2C brands — fashion is the top online category and Online PK is already your biggest profit centre; the risk is rivals catching up digitally. (<a href="https://www.brandsynario.com/top-10-shoe-brands-in-pakistan/" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>brand rankings</a>, <a href="https://www.pacra.com/view/storage/app/Footwear%20-%20PACRA%20Research%20-%20Sep'25_1757929234.pdf" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>PACRA</a>)</div>
                  <div style={{ fontWeight: 700, fontSize: "11px", color: COLOURS.NAVY, margin: "8px 0 3px" }}>CITIES &amp; REGIONS</div>
                  <div>· <b>Lahore</b> (your largest store cluster): mall supply just jumped — Dolmen Mall Lahore, the country&apos;s biggest, opened Dec-24 — more premium space, more competition for the same footfall, and rent pressure on older locations. (<a href="https://www.brecorder.com/news/2006789" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>BR mall economy</a>)</div>
                  <div>· <b>Islamabad</b> tolerates higher price points than other cities; <b>Karachi</b> is mall-anchored (Dolmen, Lucky One). Second-tier cities (Faisalabad, Multan, Gujranwala, Sialkot) are where retail expansion is heading — your stores there ride that wave at lower rents.</div>
                  <div>· <b>KP stores</b> (Peshawar, Mardan, Swat): lower rents and less brand competition, but smaller baskets — watch plan variance rather than absolute sales.</div>
                  <div>· <b>UK</b> (Green Street, Online UK): diaspora niche — sterling revenue is a natural rupee hedge.</div>
                  <div style={{ fontWeight: 700, fontSize: "11px", color: COLOURS.RED, margin: "8px 0 3px" }}>COSTS — HEADWINDS</div>
                  <div>· Inflation still elevated (7–11% range through 2026); SBP policy rate 11.5% — squeezes wallets and keeps borrowing dear. (<a href="https://tradingeconomics.com/pakistan/inflation-cpi" target="_blank" rel="noopener noreferrer" style={{ color: COLOURS.BLUE }}>Trading Economics</a>)</div>
                  <div>· Store economics under pressure: mall rents, wages and electricity rising while online scales cheaper — visible in your own numbers (rent + wages are the two biggest overheads).</div>
                  <div style={{ fontSize: "11px", color: COLOURS.INK_400, marginTop: "8px" }}>Researched 29/07/2026 — directional context, not live data.</div>
                </div>
              )}
            </div>
            )}
          </>
        ))}

        {/* ═══════════════ BALANCE SHEET TAB ═══════════════ */}
        {activeTab === "bs" && (
          <>
            {showBsUpload && (
              <div style={{ ...cardStyle, marginBottom: "12px" }}>
                <div style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "8px" }}>Upload Balance Sheet</div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <input type="file" accept=".xlsx" onChange={(e) => setBsUploadFile((e.target.files || [])[0] || null)} style={{ fontSize: "13px" }} />
                  <button
                    onClick={handleBsUpload}
                    disabled={!bsUploadFile || bsUploading}
                    style={{ ...chipBtn(true), opacity: !bsUploadFile || bsUploading ? 0.5 : 1, cursor: !bsUploadFile || bsUploading ? "not-allowed" : "pointer" }}
                  >
                    {bsUploading ? "Checking…" : "Upload"}
                  </button>
                  <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>
                    Period is detected automatically from the filename (e.g. &quot;Balance Sheet June 2026.xlsx&quot;). The parser reads the &quot;BS&quot; sheet and the &quot;Notes&quot; sheet.
                  </span>
                </div>
                {bsUploadResult && (
                  <div style={{ marginTop: "10px" }}>
                    {bsUploadResult.error ? (
                      <div style={{ padding: "8px 12px", borderRadius: RADII.SM, background: COLOURS.DANGER_SOFT, fontSize: "12px", fontWeight: 600, color: COLOURS.RED }}>
                        ✗ {bsUploadResult.error}
                      </div>
                    ) : (
                      <>
                        <div style={{ padding: "8px 12px", borderRadius: RADII.SM, background: bsUploadResult.accepted ? COLOURS.SUCCESS_SOFT : COLOURS.DANGER_SOFT, fontSize: "12px", fontWeight: 600, color: bsUploadResult.accepted ? COLOURS.GREEN : COLOURS.RED }}>
                          {bsUploadResult.accepted ? "✓ " : "✗ "}{bsUploadResult.summary}
                          {bsUploadResult.sheetUsed && <span style={{ fontWeight: 400, color: COLOURS.SLATE }}> — sheet &quot;{bsUploadResult.sheetUsed}&quot;{bsUploadResult.month ? ` · ${bsUploadResult.month.slice(0, 7)}` : ""}</span>}
                        </div>
                        {(bsUploadResult.checks || []).length > 0 && (
                          <div style={{ marginTop: "6px", fontSize: "12px", lineHeight: 1.7 }}>
                            {(bsUploadResult.checks || []).map((c, i) => (
                              <div key={i} style={{ color: c.passed ? COLOURS.GREEN : COLOURS.RED }}>
                                {c.passed ? "✓" : "✗"} {c.name}{!c.passed && c.note ? <span style={{ color: COLOURS.SLATE }}> — {c.note}</span> : null}
                              </div>
                            ))}
                          </div>
                        )}
                        {(bsUploadResult.auditWarnings || []).length > 0 && (
                          <div style={{ marginTop: "6px", padding: "8px 12px", borderRadius: RADII.SM, background: COLOURS.WARNING_SOFT, fontSize: "12px", color: COLOURS.AMBER, lineHeight: 1.7 }}>
                            {(bsUploadResult.auditWarnings || []).map((w, i) => <div key={i}>⚠ {w}</div>)}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {bsLoading ? (
              <SkeletonRows count={4} />
            ) : !bsData || !bsT ? (
              <div style={cardStyle}>
                <p style={{ color: COLOURS.SLATE, fontSize: "14px" }}>
                  No Balance Sheet data yet — press &quot;Upload period&quot; and select the Balance Sheet workbook.
                </p>
              </div>
            ) : (
              <>
                {/* ── Period selector ── */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "12px", color: COLOURS.SLATE, fontWeight: 600 }}>Period:</span>
                  {bsMonths.map((m) => (
                    <button key={m} style={chipBtn(m === bsMonth)} onClick={() => { setBsMonth(m); setSelectedNote(null); }}>{MONTH_LABEL(m)}</button>
                  ))}
                </div>

                {/* ── Statement ── */}
                <div style={{ ...cardStyle, marginBottom: "16px", overflowX: "auto" }}>
                  <div style={sectionTitle}>Balance Sheet — Imperial Footwear</div>
                  <div style={sectionCaption}>As at {MONTH_LABEL(bsMonth)}{bsPrev ? ` · compared with ${MONTH_LABEL(bsPrev.month)}` : ""} · amounts in ₨</div>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "640px" }}>
                    <thead>
                      <tr style={{ borderBottom: `2px solid ${COLOURS.NAVY}` }}>
                        <th style={{ padding: "6px 10px", fontSize: "10px", fontWeight: 700, color: COLOURS.INK_400, textAlign: "left", textTransform: "uppercase", letterSpacing: "0.05em" }}>Line</th>
                        <th style={{ padding: "6px 10px", fontSize: "10px", fontWeight: 700, color: COLOURS.INK_400, textAlign: "right" }}>NOTE</th>
                        <th style={{ padding: "6px 10px", fontSize: "10px", fontWeight: 700, color: COLOURS.INK_400, textAlign: "right", textTransform: "uppercase" }}>{MONTH_LABEL(bsMonth)}</th>
                        <th style={{ padding: "6px 10px", fontSize: "10px", fontWeight: 700, color: COLOURS.INK_400, textAlign: "right", textTransform: "uppercase" }}>{bsPrev ? MONTH_LABEL(bsPrev.month) : "Prior"}</th>
                        <th style={{ padding: "6px 10px", fontSize: "10px", fontWeight: 700, color: COLOURS.INK_400, textAlign: "right" }}>Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* EQUITY */}
                      <BsSectionHeader label="Equity" />
                      <BsSubHeader label="Partner Investments & Reserves" />
                      <BsItem label="Waqas Saleem Investment"   note="1" cur={bsData.partner_waqas}  prev={bsPrev?.partner_waqas}  onNoteClick={setSelectedNote} />
                      <BsItem label="Remon Ahmed Investment"    note="1" cur={bsData.partner_remon}  prev={bsPrev?.partner_remon}  onNoteClick={setSelectedNote} />
                      <BsItem label="Samira Waqas Investment"   note="1" cur={bsData.partner_samira} prev={bsPrev?.partner_samira} onNoteClick={setSelectedNote} />
                      <BsItem label="Retained Earnings"         note="2" cur={bsData.retained_earnings} prev={bsPrev?.retained_earnings} onNoteClick={setSelectedNote} />
                      <BsSubtotal label="Total Owner's Equity" cur={bsT.equity} prev={bsPrevT?.equity} />

                      <BsSpacer />
                      <BsSubHeader label="Long Term Liabilities" />
                      <BsItem label="Payable — Mr. Khurram Saleem" cur={bsData.lt_payable_khurram} prev={bsPrev?.lt_payable_khurram} />
                      <BsItem label="Provident Fund"                cur={bsData.lt_provident_fund}  prev={bsPrev?.lt_provident_fund} />
                      <BsSubtotal label="Total Long Term Liabilities" cur={bsT.ltLiab} prev={bsPrevT?.ltLiab} />

                      <BsSpacer />
                      <BsSubHeader label="Short Term Liabilities" />
                      <BsItem label="Trade Creditors"             cur={bsData.trade_creditors}         prev={bsPrev?.trade_creditors} />
                      <BsItem label="Security Deposits"           cur={bsData.security_deposits}       prev={bsPrev?.security_deposits} />
                      <BsItem label="Charity UK"                  cur={bsData.charity_uk}              prev={bsPrev?.charity_uk} />
                      <BsItem label="Payable to Related Parties"  cur={bsData.payable_related_parties} prev={bsPrev?.payable_related_parties} />
                      <BsItem label="Intercompany Balances"       cur={bsData.intercompany_payables}   prev={bsPrev?.intercompany_payables} />
                      <BsItem label="Other Payables"              cur={bsData.other_payables}          prev={bsPrev?.other_payables} />
                      <BsItem label="Accrued Expenses"            cur={bsData.accrued_expenses}        prev={bsPrev?.accrued_expenses} />
                      <BsSubtotal label="Total Short Term Liabilities" cur={bsT.stLiab} prev={bsPrevT?.stLiab} />

                      <BsSpacer />
                      <BsGrandTotal label="TOTAL EQUITY & LIABILITIES" cur={bsT.equity + bsT.ltLiab + bsT.stLiab} prev={bsPrevT ? bsPrevT.equity + bsPrevT.ltLiab + bsPrevT.stLiab : null} />

                      {/* ASSETS */}
                      <BsSpacer />
                      <BsSectionHeader label="Assets" />
                      <BsSubHeader label="Long Term Assets" />
                      <BsItem label="Fixed Assets"                       cur={bsData.fixed_assets}          prev={bsPrev?.fixed_assets} />
                      <BsItem label="Receivables — Mr. Kamran Saleem"   cur={bsData.receivables_kamran}    prev={bsPrev?.receivables_kamran} />
                      <BsItem label="Long Term Investments"    note="4" cur={bsData.long_term_investments} prev={bsPrev?.long_term_investments} onNoteClick={setSelectedNote} />
                      <BsItem label="Provident Fund (Asset)"            cur={bsData.provident_fund_asset}  prev={bsPrev?.provident_fund_asset} />
                      <BsSubtotal label="Total Long Term Assets" cur={bsT.ltAssets} prev={bsPrevT?.ltAssets} />

                      <BsSpacer />
                      <BsSubHeader label="Current Assets" />
                      <BsItem label="Stock"                       note="5" cur={bsData.stock}                    prev={bsPrev?.stock}                    onNoteClick={setSelectedNote} />
                      <BsItem label="Intercompany Receivables"             cur={bsData.intercompany_receivables} prev={bsPrev?.intercompany_receivables} />
                      <BsItem label="Receivables from Directors"           cur={bsData.receivables_directors}    prev={bsPrev?.receivables_directors} />
                      <BsItem label="Trade Debtors"                        cur={bsData.trade_debtors}            prev={bsPrev?.trade_debtors} />
                      <BsItem label="Supplier Deposits"           note="3" cur={bsData.supplier_deposits}        prev={bsPrev?.supplier_deposits}        onNoteClick={setSelectedNote} />
                      <BsItem label="Prepayments"                 note="6" cur={bsData.prepayments}              prev={bsPrev?.prepayments}              onNoteClick={setSelectedNote} />
                      <BsItem label="Employee Loans & Advances"   note="7" cur={bsData.employee_loans}           prev={bsPrev?.employee_loans}           onNoteClick={setSelectedNote} />
                      <BsItem label="Advance Income Tax"          note="9" cur={bsData.advance_income_tax}       prev={bsPrev?.advance_income_tax}       onNoteClick={setSelectedNote} />
                      <BsItem label="Cash & Bank"                 note="8" cur={bsData.cash_bank}                prev={bsPrev?.cash_bank}                onNoteClick={setSelectedNote} />
                      <BsSubtotal label="Total Current Assets" cur={bsT.curAssets} prev={bsPrevT?.curAssets} />

                      <BsSpacer />
                      <BsGrandTotal label="TOTAL ASSETS" cur={bsT.ltAssets + bsT.curAssets} prev={bsPrevT ? bsPrevT.ltAssets + bsPrevT.curAssets : null} />
                    </tbody>
                  </table>
                </div>

                {/* ── Note Detail Panel ── */}
                {selectedNote && IFL_BS_NOTES[selectedNote] && (
                  <div style={{ marginBottom: "16px", border: `1.5px solid ${COLOURS.BLUE}`, borderRadius: RADII.SM, background: COLOURS.INFO_SOFT, padding: "16px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ background: COLOURS.BLUE, color: "#fff", borderRadius: RADII.PILL, fontWeight: 700, fontSize: "11px", padding: "2px 9px", letterSpacing: "0.02em" }}>
                          Note {selectedNote}
                        </span>
                        <span style={{ fontWeight: 700, fontSize: "13px", color: COLOURS.NAVY }}>
                          {IFL_BS_NOTES[selectedNote].title}
                        </span>
                      </div>
                      <button
                        onClick={() => setSelectedNote(null)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: COLOURS.SLATE, fontSize: "16px", lineHeight: 1, padding: "2px 4px", fontFamily: "inherit" }}
                        aria-label="Close note"
                      >×</button>
                    </div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE, lineHeight: 1.6, marginBottom: "10px" }}>
                      {IFL_BS_NOTES[selectedNote].description}
                    </div>
                    {(() => {
                      const wanted = parseInt(selectedNote, 10);
                      const lines = bsNoteLines.filter((l) => l.note_no === wanted);
                      if (lines.length === 0) {
                        return (
                          <div style={{ fontSize: "11px", color: COLOURS.INK_400, fontStyle: "italic" }}>
                            No account-level detail available for this period — re-upload the period&apos;s file to load it.
                          </div>
                        );
                      }
                      return (
                        <div style={{ overflowX: "auto", background: COLOURS.CARD, borderRadius: RADII.SM, border: `1px solid ${COLOURS.HAIRLINE}` }}>
                          <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                              <tr style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                                <th style={{ padding: "6px 12px", fontSize: "9px", fontWeight: 700, color: COLOURS.INK_400, textAlign: "left", textTransform: "uppercase", letterSpacing: "0.05em" }}>Description</th>
                                <th style={{ padding: "6px 12px", fontSize: "9px", fontWeight: 700, color: COLOURS.INK_400, textAlign: "right", textTransform: "uppercase", letterSpacing: "0.05em" }}>{MONTH_LABEL(bsMonth)} (₨)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {lines.map((l) => l.is_header ? (
                                <tr key={l.row_order} style={{ background: COLOURS.TRACK }}>
                                  <td style={{ padding: "6px 12px", fontSize: "10px", fontWeight: 700, color: COLOURS.NAVY }}>{l.account_name}</td>
                                  <td style={{ padding: "6px 12px", fontSize: "10px", fontWeight: 700, color: COLOURS.NAVY, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.amount !== null ? fmtPKR(l.amount) : ""}</td>
                                </tr>
                              ) : l.is_total ? (
                                <tr key={l.row_order} style={{ borderTop: `1.5px solid ${COLOURS.NAVY}` }}>
                                  <td style={{ padding: "5px 12px", fontSize: "10px", fontWeight: 700, color: COLOURS.NAVY }}>{l.account_name}</td>
                                  <td style={{ padding: "5px 12px", fontSize: "10px", fontWeight: 700, color: l.amount !== null && l.amount < 0 ? COLOURS.RED : COLOURS.NAVY, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtPKR(l.amount)}</td>
                                </tr>
                              ) : (
                                <tr key={l.row_order} style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>
                                  <td style={{ padding: "5px 12px", fontSize: "10px", color: COLOURS.INK_700 }}>{l.account_name}</td>
                                  <td style={{ padding: "5px 12px", fontSize: "10px", color: l.amount !== null && l.amount < 0 ? COLOURS.RED : COLOURS.INK_700, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtPKR(l.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* ── Key Ratios ── */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "10px", marginBottom: "20px" }}>
                  <div style={cardStyle}>
                    <div style={sectionTitle}>Liquidity</div>
                    <div style={sectionCaption}>Ability to meet short-term obligations</div>
                    <RatioRow label="Current Ratio"  value={bsCurrentRatio !== null ? bsCurrentRatio.toFixed(1) + "×" : "—"} colour={ratioColour(bsCurrentRatio, 2, 1)} />
                    <RatioRow label="Quick Ratio"    value={bsQuickRatio   !== null ? bsQuickRatio.toFixed(1)   + "×" : "—"} colour={ratioColour(bsQuickRatio, 1, 0.5)} />
                    <RatioRow label="Cash Ratio"     value={bsCashRatio    !== null ? bsCashRatio.toFixed(2)    + "×" : "—"} colour={ratioColour(bsCashRatio, 0.5, 0.2)} />
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
                    <RatioRow label="Working Capital"    value={fmtM(bsWorkingCapital ?? 0)}    colour={COLOURS.NAVY} />
                    <RatioRow label="Stock"              value={fmtM(bsData.stock)}             colour={COLOURS.NAVY} />
                    <RatioRow label="Cash & Equivalents" value={fmtM(bsData.cash_bank)}         colour={COLOURS.NAVY} />
                  </div>
                </div>

                {/* ── Plain-English CEO insights ── */}
                <IflInsightsCard monthLabel={MONTH_LABEL(bsMonth)} data={bsData} prev={bsPrev} />

                {/* ── Audit warnings stored with this period ── */}
                {(bsData.audit_warnings || []).length > 0 && (
                  <div style={{ marginBottom: "20px", padding: "12px 16px", borderRadius: RADII.SM, background: COLOURS.WARNING_SOFT, fontSize: "12px", color: COLOURS.AMBER, lineHeight: 1.7 }}>
                    <div style={{ fontWeight: 700, marginBottom: "4px", textTransform: "uppercase", fontSize: "10px", letterSpacing: "0.05em" }}>Audit warnings</div>
                    {(bsData.audit_warnings || []).map((w, i) => <div key={i}>⚠ {w}</div>)}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>
    </AuthWrapper>
  );
}
