"use client";

import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, Cell } from "recharts";
import AuthWrapper from "../../lib/AuthWrapper";
import { supabase } from "../../lib/supabase";
import { COLOURS, RADII, cardStyle, PageHeader, SectionTitle, SkeletonRows } from "../../lib/SharedUI";
import { useRequireCapability } from "../../lib/useRouteGuard";
import { canEditFinance, financeCompanies, type UserCtx } from "../../lib/permissions";
import { useUserCtx } from "../../lib/useUserCtx";
import { UTPL_COMPANY_ID, IFPL_COMPANY_ID } from "../../lib/constants";

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
type SegmentRow = { plant: string; gross_profit: number };
type OverheadRow = { month: string; plant: string; account_group: string; amount: number };
type YtdRow = { ytd_sales: number; ytd_sales_last_year: number; ytd_profit: number; ytd_profit_last_year: number };
type CheckRow = { name: string; expected: number; reported: number; diff: number; passed: boolean };

const MONTH_LABEL = (m: string) => {
  const d = new Date(m + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
};
const fmtM = (n: number | null | undefined) => {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return (Math.round((n / 1_000_000) * 10) / 10).toLocaleString() + "m";
};
const fmtPct = (n: number) => (Math.round(n * 10) / 10) + "%";

async function authedFetch(url: string, opts: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${session?.access_token}` } });
}

const chipBtn = (active: boolean): React.CSSProperties => ({
  padding: "6px 14px",
  borderRadius: RADII.PILL,
  border: `1px solid ${active ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
  background: active ? COLOURS.NAVY : COLOURS.CARD,
  color: active ? "white" : COLOURS.INK_700,
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
});

export default function ProfitAndLossPage() {
  const { checking } = useRequireCapability("finance");
  const { ctx } = useUserCtx();

  const scope = ctx ? financeCompanies(ctx) : "none";
  const canUploadUnze = ctx ? canEditFinance(ctx) : false;

  const availableCompanies = useMemo(() => {
    const list: { id: string; label: string }[] = [];
    if (scope === "both" || scope === "UTPL") list.push({ id: UTPL_COMPANY_ID, label: "Unze Trading" });
    if (scope === "both" || scope === "IFPL") list.push({ id: IFPL_COMPANY_ID, label: "Imperial Footwear" });
    return list;
  }, [scope]);

  // No sync-effect needed to pick a default — derive it directly. setCompanyId
  // is only ever called from the chip buttons after that (user-driven).
  const [companyIdOverride, setCompanyIdOverride] = useState<string>("");
  const companyId = companyIdOverride || availableCompanies[0]?.id || "";
  const setCompanyId = setCompanyIdOverride;

  const [loading, setLoading] = useState(true);
  // Every month on file, independent of the current from/to filter — this is
  // what the two dropdowns are built from. Using the filtered kpiRows for the
  // dropdown options was the bug: narrowing the range shrank the option list
  // itself, so you could never widen it back out.
  const [allMonths, setAllMonths] = useState<string[]>([]);
  const [kpiRows, setKpiRows] = useState<KpiRow[]>([]);
  const [segmentRows, setSegmentRows] = useState<SegmentRow[]>([]);
  const [overheadRows, setOverheadRows] = useState<OverheadRow[]>([]);
  const [ytd, setYtd] = useState<YtdRow | null>(null);
  const [newFlags, setNewFlags] = useState<{ plant: string; account_group: string; amount: number }[]>([]);

  const [monthFrom, setMonthFrom] = useState("");
  const [monthTo, setMonthTo] = useState("");
  const [plantFilter, setPlantFilter] = useState("All plants");
  const [allocateHo, setAllocateHo] = useState(false);

  const [showUpload, setShowUpload] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<{ fileName: string; accepted: boolean; summary: string; checks: CheckRow[] }[]>([]);

  const isUnze = companyId === UTPL_COMPANY_ID;

  // Load every month on file for this company first, to size the range
  // pickers and default to the latest 12 months — one RPC call, no JS sums.
  useEffect(() => {
    let active = true;
    async function loadAll() {
      if (!companyId || !isUnze) { if (active) setLoading(false); return; }
      setLoading(true);
      const { data } = await supabase.rpc("pnl_kpi_summary", { p_company_id: companyId, p_from: "2000-01-01", p_to: "2100-01-01" });
      if (!active) return;
      const rows = (data || []) as KpiRow[];
      setAllMonths(rows.map((r) => r.month));
      if (rows.length > 0) {
        const last = rows[rows.length - 1].month;
        const firstIdx = Math.max(0, rows.length - 12);
        setMonthFrom(rows[firstIdx].month);
        setMonthTo(last);
      }
      setLoading(false);
    }
    loadAll();
    return () => { active = false; };
  }, [companyId, isUnze]);

  // Main data load whenever the filters change.
  useEffect(() => {
    if (!companyId || !isUnze || !monthFrom || !monthTo) return;
    let active = true;
    async function load() {
      const [kpiRes, segRes, ohRes, ytdRes, flagsRes] = await Promise.all([
        supabase.rpc("pnl_kpi_summary", { p_company_id: companyId, p_from: monthFrom, p_to: monthTo }),
        supabase.rpc("pnl_segment_breakdown", { p_company_id: companyId, p_month: monthTo, p_allocate_ho: allocateHo }),
        supabase.rpc("pnl_overheads_breakdown", { p_company_id: companyId, p_plant: plantFilter, p_from: monthFrom, p_to: monthTo, p_allocate_ho: allocateHo }),
        supabase.rpc("pnl_ytd_summary", { p_company_id: companyId, p_month: monthTo }),
        supabase.rpc("pnl_new_account_flags", { p_company_id: companyId, p_month: monthTo }),
      ]);
      if (!active) return;
      setKpiRows((kpiRes.data || []) as KpiRow[]);
      setSegmentRows((segRes.data || []) as SegmentRow[]);
      setOverheadRows((ohRes.data || []) as OverheadRow[]);
      setYtd((ytdRes.data && ytdRes.data[0]) || null);
      setNewFlags((flagsRes.data || []) as { plant: string; account_group: string; amount: number }[]);
    }
    load();
    return () => { active = false; };
  }, [companyId, isUnze, monthFrom, monthTo, plantFilter, allocateHo]);

  async function handleUpload() {
    if (uploadFiles.length === 0) return;
    setUploading(true);
    setUploadResults([]);
    let anyAccepted = false;
    // Sequential, not Promise.all — each file goes through its own full
    // check-then-accept-or-reject pass, and running them one at a time
    // means a later month's checks always see the earlier months already
    // committed (relevant for the "new account this month" comparison).
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
      // Reload after uploads so any new months show up in the dropdowns too.
      const { data } = await supabase.rpc("pnl_kpi_summary", { p_company_id: companyId, p_from: "2000-01-01", p_to: "2100-01-01" });
      const rows = (data || []) as KpiRow[];
      setAllMonths(rows.map((r) => r.month));
      if (rows.length > 0) {
        const last = rows[rows.length - 1].month;
        const firstIdx = Math.max(0, rows.length - 12);
        setMonthFrom(rows[firstIdx].month);
        setMonthTo(last);
      }
    }
  }

  if (checking) return null;

  const trendData = kpiRows.map((r) => ({
    month: MONTH_LABEL(r.month),
    sales: Math.round(r.gross_sale / 1000) / 1000,
    profit: Math.round(r.net_profit_final / 1000) / 1000,
    margin: r.gross_sale ? Math.round((r.gross_profit / r.gross_sale) * 1000) / 10 : 0,
  }));

  const latest = kpiRows[kpiRows.length - 1];
  const prev = kpiRows[kpiRows.length - 2];
  const kpiCards = latest ? [
    { label: "Gross sales", val: latest.gross_sale, prevVal: prev?.gross_sale },
    { label: "Gross profit", val: latest.gross_profit, prevVal: prev?.gross_profit },
    { label: "Operating expenses", val: latest.operating_expenses, prevVal: prev?.operating_expenses },
    { label: "Net profit (final)", val: latest.net_profit_final, prevVal: prev?.net_profit_final },
  ] : [];

  const ohMonths = [...new Set(overheadRows.map((r) => r.month))].sort();
  const ohGroups = [...new Set(overheadRows.map((r) => r.account_group))];

  // Top expense groups for the latest month only — a ranked list of at most
  // 8, matching what was agreed, not a full group x month spreadsheet.
  const topExpenses = ohGroups
    .map((g) => ({ group: g, amount: overheadRows.filter((r) => r.account_group === g && r.month === monthTo).reduce((s, r) => s + r.amount, 0) }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);
  const maxExpense = Math.max(1, ...topExpenses.map((r) => r.amount));

  // Biggest movers: this month vs prior month per account group, comparing
  // two already-aggregated totals (not re-summing raw ledger rows).
  const movers = ohMonths.length >= 2 ? ohGroups.map((g) => {
    const curM = ohMonths[ohMonths.length - 1];
    const prevM = ohMonths[ohMonths.length - 2];
    const cur = overheadRows.filter((r) => r.account_group === g && r.month === curM).reduce((s, r) => s + r.amount, 0);
    const before = overheadRows.filter((r) => r.account_group === g && r.month === prevM).reduce((s, r) => s + r.amount, 0);
    return { group: g, delta: cur - before };
  }).filter((m) => Math.abs(m.delta) > 1000).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5) : [];

  const cogsData = kpiRows.map((r) => ({
    month: MONTH_LABEL(r.month),
    sales: Math.round(r.gross_sale / 1000) / 1000,
    cogs: Math.round(Math.abs(r.cost_of_sale) / 1000) / 1000,
    ratio: r.gross_sale ? Math.round((Math.abs(r.cost_of_sale) / r.gross_sale) * 1000) / 10 : 0,
  }));

  return (
    <AuthWrapper>
      <main style={{ padding: "14px 18px", maxWidth: "1100px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
          <PageHeader />
        </div>

        {availableCompanies.length === 0 ? (
          <div style={cardStyle}>
            <p style={{ color: COLOURS.SLATE, fontSize: "14px" }}>You don&apos;t have access to any company&apos;s P&amp;L.</p>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
              {availableCompanies.map((c) => (
                <button key={c.id} style={chipBtn(companyId === c.id)} onClick={() => setCompanyId(c.id)}>{c.label}</button>
              ))}
            </div>

            {!isUnze ? (
              <div style={cardStyle}>
                <p style={{ color: COLOURS.SLATE, fontSize: "14px" }}>Imperial Footwear&apos;s P&amp;L upload is Phase 2 — not built yet. Unze Trading is live below.</p>
              </div>
            ) : (
              <>
                {canUploadUnze && (
                  <div style={{ marginBottom: "16px" }}>
                    <button
                      onClick={() => { setShowUpload(!showUpload); setUploadResults([]); }}
                      style={{ ...chipBtn(showUpload), display: "inline-flex", alignItems: "center", gap: "6px" }}
                    >
                      {showUpload ? "Close upload" : "Upload months"}
                    </button>
                    {showUpload && (
                      <div style={{ ...cardStyle, marginTop: "10px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                          <input
                            type="file"
                            accept=".xlsx"
                            multiple
                            onChange={(e) => setUploadFiles(Array.from(e.target.files || []))}
                            style={{ fontSize: "13px" }}
                          />
                          <button
                            onClick={handleUpload}
                            disabled={uploadFiles.length === 0 || uploading}
                            style={{
                              ...chipBtn(true),
                              opacity: uploadFiles.length === 0 || uploading ? 0.5 : 1,
                              cursor: uploadFiles.length === 0 || uploading ? "not-allowed" : "pointer",
                            }}
                          >
                            {uploading ? "Checking…" : uploadFiles.length > 1 ? `Upload ${uploadFiles.length} files` : "Upload"}
                          </button>
                        </div>
                        <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "6px" }}>
                          Select as many months as you like — each one is checked and accepted or rejected on its own.
                        </div>
                        {uploadResults.map((r, idx) => (
                          <div key={idx} style={{
                            marginTop: "12px", padding: "12px 14px", borderRadius: RADII.SM,
                            background: r.accepted ? COLOURS.SUCCESS_SOFT : COLOURS.DANGER_SOFT,
                          }}>
                            <div style={{ fontSize: "13px", fontWeight: 700, color: r.accepted ? COLOURS.GREEN : COLOURS.RED, marginBottom: "6px" }}>
                              {r.fileName} — {r.accepted ? "Accepted — " : "Rejected — "}{r.summary}
                            </div>
                            {!r.accepted && (
                              <div style={{ fontSize: "12px", color: COLOURS.RED, lineHeight: 1.6 }}>
                                {r.checks.filter((c) => !c.passed).map((c, i) => (
                                  <div key={i}>· {c.name}: expected {fmtM(c.expected)}, got {fmtM(c.reported)} (diff {fmtM(c.diff)})</div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {loading ? (
                  <SkeletonRows count={4} />
                ) : kpiRows.length === 0 ? (
                  <div style={cardStyle}>
                    <p style={{ color: COLOURS.SLATE, fontSize: "14px" }}>No months uploaded yet for Unze Trading.</p>
                  </div>
                ) : (
                  <>
                    <div style={{ ...cardStyle, padding: "14px 18px", marginBottom: "20px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
                        <span style={{ fontSize: "12px", color: COLOURS.SLATE, fontWeight: 600 }}>PERIOD</span>
                        <select value={monthFrom} onChange={(e) => setMonthFrom(e.target.value)} style={{ padding: "6px 10px", borderRadius: RADII.SM, border: `1px solid ${COLOURS.HAIRLINE}`, fontSize: "13px" }}>
                          {allMonths.map((m) => <option key={m} value={m}>{MONTH_LABEL(m)}</option>)}
                        </select>
                        <span style={{ color: COLOURS.SLATE, fontSize: "13px" }}>to</span>
                        <select value={monthTo} onChange={(e) => setMonthTo(e.target.value)} style={{ padding: "6px 10px", borderRadius: RADII.SM, border: `1px solid ${COLOURS.HAIRLINE}`, fontSize: "13px" }}>
                          {allMonths.map((m) => <option key={m} value={m}>{MONTH_LABEL(m)}</option>)}
                        </select>
                        <span style={{ width: "1px", height: "20px", background: COLOURS.HAIRLINE, margin: "0 4px" }} />
                        <span style={{ fontSize: "12px", color: COLOURS.SLATE, fontWeight: 600 }}>PLANT</span>
                        <select value={plantFilter} onChange={(e) => setPlantFilter(e.target.value)} style={{ padding: "6px 10px", borderRadius: RADII.SM, border: `1px solid ${COLOURS.HAIRLINE}`, fontSize: "13px" }}>
                          {["All plants", "FEDMIC", "MEPCO", "PESCO", "HO"].map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <span style={{ width: "1px", height: "20px", background: COLOURS.HAIRLINE, margin: "0 4px" }} />
                        <button style={chipBtn(!allocateHo)} onClick={() => setAllocateHo(false)}>As reported</button>
                        <button style={chipBtn(allocateHo)} onClick={() => setAllocateHo(true)}>Allocated to plants</button>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px", marginBottom: "20px" }}>
                      {kpiCards.map((k) => {
                        const delta = k.prevVal !== undefined ? k.val - k.prevVal : 0;
                        const up = delta >= 0;
                        return (
                          <div key={k.label} style={{ ...cardStyle, borderLeft: `3px solid ${COLOURS.NAVY}` }}>
                            <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "6px" }}>{k.label}</div>
                            <div style={{ fontSize: "24px", fontWeight: 700, color: COLOURS.NAVY }}>{fmtM(k.val)}</div>
                            {k.prevVal !== undefined && (
                              <div style={{ fontSize: "12px", color: up ? COLOURS.GREEN : COLOURS.RED, marginTop: "4px" }}>
                                {up ? "▲" : "▼"} {fmtM(Math.abs(delta))} vs prior month
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {ytd && (
                      <div style={{ ...cardStyle, marginBottom: "20px" }}>
                        <SectionTitle title="Year to date" />
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "16px", marginTop: "10px" }}>
                          <div>
                            <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>Sales YTD</div>
                            <div style={{ fontSize: "18px", fontWeight: 700 }}>{fmtM(ytd.ytd_sales)}</div>
                            <div style={{ fontSize: "12px", color: ytd.ytd_sales >= ytd.ytd_sales_last_year ? COLOURS.GREEN : COLOURS.RED }}>
                              vs last year {fmtM(ytd.ytd_sales_last_year)}
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>Profit YTD</div>
                            <div style={{ fontSize: "18px", fontWeight: 700 }}>{fmtM(ytd.ytd_profit)}</div>
                            <div style={{ fontSize: "12px", color: ytd.ytd_profit >= ytd.ytd_profit_last_year ? COLOURS.GREEN : COLOURS.RED }}>
                              vs last year {fmtM(ytd.ytd_profit_last_year)}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div style={{ ...cardStyle, marginBottom: "20px" }}>
                      <SectionTitle title="Sales and profit trend" />
                      <div style={{ height: "220px", marginTop: "10px" }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={trendData}>
                            <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.HAIRLINE} />
                            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Legend wrapperStyle={{ fontSize: "12px" }} />
                            <Line type="monotone" dataKey="sales" name="Gross sales (m)" stroke={COLOURS.BLUE} strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="profit" name="Net profit (m)" stroke={COLOURS.GREEN} strokeWidth={2} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div style={{ ...cardStyle, marginBottom: "20px" }}>
                      <SectionTitle title="Rolling gross margin" />
                      <div style={{ height: "180px", marginTop: "10px" }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={trendData}>
                            <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.HAIRLINE} />
                            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} unit="%" />
                            <Tooltip />
                            <Line type="monotone" dataKey="margin" name="Gross margin %" stroke={COLOURS.AMBER} strokeWidth={2} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div style={{ ...cardStyle, marginBottom: "20px" }}>
                      <SectionTitle title="Cost of goods sold vs sales" />
                      <div style={{ height: "220px", marginTop: "10px" }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={cogsData}>
                            <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.HAIRLINE} />
                            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Legend wrapperStyle={{ fontSize: "12px" }} />
                            <Bar dataKey="sales" name="Sales (m)" fill={COLOURS.BLUE} />
                            <Bar dataKey="cogs" name="COGS (m)" fill={COLOURS.AMBER} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div style={{ ...cardStyle, marginBottom: "20px" }}>
                      <SectionTitle title={`By plant — ${allocateHo ? "allocated" : "as reported"} (${MONTH_LABEL(monthTo)})`} />
                      <div style={{ height: "180px", marginTop: "10px" }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={segmentRows.map((r) => ({ plant: r.plant, gp: Math.round(r.gross_profit / 1000) / 1000 }))} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.HAIRLINE} />
                            <XAxis type="number" tick={{ fontSize: 11 }} />
                            <YAxis type="category" dataKey="plant" tick={{ fontSize: 11 }} width={60} />
                            <Tooltip />
                            <Bar dataKey="gp" name="Gross profit (m)">
                              {segmentRows.map((r, i) => <Cell key={i} fill={r.gross_profit >= 0 ? COLOURS.GREEN : COLOURS.RED} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div style={{ ...cardStyle, marginBottom: "20px" }}>
                      <SectionTitle title={`Top expense groups — ${MONTH_LABEL(monthTo)}`} />
                      <div style={{ marginTop: "12px" }}>
                        {topExpenses.length === 0 && <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No overhead activity this month.</p>}
                        {topExpenses.map((r) => (
                          <div key={r.group} style={{ marginBottom: "10px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "3px" }}>
                              <span>{r.group}</span>
                              <span style={{ color: COLOURS.SLATE }}>{fmtM(r.amount)}</span>
                            </div>
                            <div style={{ background: COLOURS.TRACK, borderRadius: "4px", height: "6px" }}>
                              <div style={{ width: `${(r.amount / maxExpense) * 100}%`, background: COLOURS.BLUE, height: "6px", borderRadius: "4px" }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {movers.length > 0 && (
                      <div style={{ ...cardStyle, marginBottom: "20px" }}>
                        <SectionTitle title="Biggest movers this month" />
                        {movers.map((m) => (
                          <div key={m.group} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: `1px solid ${COLOURS.HAIRLINE}`, fontSize: "13px" }}>
                            <span>{m.group}</span>
                            <span style={{ color: m.delta >= 0 ? COLOURS.RED : COLOURS.GREEN, fontWeight: 600 }}>
                              {m.delta >= 0 ? "+" : ""}{fmtM(m.delta)} vs prior month
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {newFlags.length > 0 && (
                      <div style={{ ...cardStyle, marginBottom: "20px" }}>
                        <SectionTitle title="New account activity this month" />
                        {newFlags.map((f, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: `1px solid ${COLOURS.HAIRLINE}`, fontSize: "13px" }}>
                            <span>{f.plant} — {f.account_group}</span>
                            <span style={{ fontWeight: 600 }}>{fmtM(f.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </main>
    </AuthWrapper>
  );
}
