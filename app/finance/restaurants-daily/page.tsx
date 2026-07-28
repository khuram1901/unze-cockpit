"use client";

// ─────────────────────────────────────────────────────────────────────────
// Restaurants Finance — Baranh, Haute Dolci, K&K Jhang (built 28/07/2026)
// Daily cash sheet entries for the three restaurant companies, mirroring
// the Imperial / Unze Trading finance tabs. Reads from cash_sheet_uploads +
// cash_sheet_transactions via the existing /api/banking/cash-sheets endpoint.
// Three company tabs; 30-day area chart; recent entries table; KPI hero row.
// Requires can_view_restaurants_pnl permission (same gate as the P&L page).
// ─────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import AuthWrapper from "../../lib/AuthWrapper";
import { authFetch } from "../../lib/supabase";
import { COLOURS, RADII, cardStyle, PageHeader, SkeletonRows, useToast } from "../../lib/SharedUI";
import { formatDateUK } from "../../lib/dateUtils";
import { useRequireCapability } from "../../lib/useRouteGuard";
import { useMobile } from "../../lib/useMobile";

// ── Types ─────────────────────────────────────────────────────────────────────

type TxnSummary = { id: string; txn_type: "payment" | "receipt"; amount_pkr: number };

type CashSheet = {
  id: string;
  company: string;
  sheet_date: string;
  opening_balance_pkr: number | null;
  closing_balance_pkr: number | null;
  notes: string | null;
  uploaded_by: string;
  created_at: string;
  cash_sheet_transactions: TxnSummary[];
};

type CompanyTab = { id: "BRNH" | "HD" | "KKJ"; label: string; color: string; lightColor: string };

// ── Constants ─────────────────────────────────────────────────────────────────

const COMPANY_TABS: CompanyTab[] = [
  { id: "BRNH", label: "Baranh",       color: "#7C3AED", lightColor: "#EDE9FE" },
  { id: "HD",   label: "Haute Dolci",  color: "#DB2777", lightColor: "#FCE7F3" },
  { id: "KKJ",  label: "K&K Jhang",   color: "#0891B2", lightColor: "#CFFAFE" },
];

// ── Formatting helpers ────────────────────────────────────────────────────────

function pkr(n: number | null | undefined): string {
  if (n == null) return "—";
  return "₨ " + Math.round(n).toLocaleString();
}

function shortPkr(n: number | null | undefined): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return sign + "₨ " + (Math.round(abs / 100_000) / 10).toLocaleString() + "m";
  if (abs >= 1_000) return sign + "₨ " + (Math.round(abs / 100) / 10).toLocaleString() + "k";
  return sign + "₨ " + Math.round(abs).toLocaleString();
}

function getMonthOptions(): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    opts.push({ value, label });
  }
  return opts;
}

function currentMonthISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function RestaurantsFinancePage() {
  const { checking } = useRequireCapability("restaurants_pnl");
  const isMobile = useMobile();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<"BRNH" | "HD" | "KKJ">("BRNH");
  const [month, setMonth] = useState(currentMonthISO());
  const [sheets, setSheets] = useState<CashSheet[]>([]);
  const [loading, setLoading] = useState(true);

  const monthOptions = getMonthOptions();
  const tab = COMPANY_TABS.find((t) => t.id === activeTab)!;

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchSheets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/banking/cash-sheets?company=${activeTab}&month=${month}`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setSheets(json.data ?? []);
    } catch (err) {
      toast.show("Failed to load cash sheets: " + String(err), "error");
      setSheets([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab, month]);

  useEffect(() => { fetchSheets(); }, [fetchSheets]);

  // ── Derived values ─────────────────────────────────────────────────────────

  const sorted = [...sheets].sort((a, b) => a.sheet_date.localeCompare(b.sheet_date));

  // Most recent entry (for KPI)
  const latest = sorted.length > 0 ? sorted[sorted.length - 1] : null;

  // Net movement for the period (latest closing - earliest opening)
  const first = sorted.length > 0 ? sorted[0] : null;
  const netMovement = (latest?.closing_balance_pkr ?? null) !== null && (first?.opening_balance_pkr ?? null) !== null
    ? (latest!.closing_balance_pkr! - first!.opening_balance_pkr!)
    : null;

  // Total receipts & payments for the period
  const periodReceipts = sheets.reduce((sum, s) =>
    sum + s.cash_sheet_transactions.filter((t) => t.txn_type === "receipt").reduce((s2, t) => s2 + t.amount_pkr, 0), 0);
  const periodPayments = sheets.reduce((sum, s) =>
    sum + s.cash_sheet_transactions.filter((t) => t.txn_type === "payment").reduce((s2, t) => s2 + t.amount_pkr, 0), 0);

  // Chart data — one point per day in the period
  const chartData = sorted
    .filter((s) => s.closing_balance_pkr != null)
    .map((s) => ({
      date: s.sheet_date.slice(5), // MM-DD
      closing: s.closing_balance_pkr!,
      opening: s.opening_balance_pkr ?? 0,
    }));

  if (checking) return null;

  // ── Styles ─────────────────────────────────────────────────────────────────

  const MONO = "var(--font-mono, 'JetBrains Mono', monospace)";
  const DISPLAY = "var(--font-display, 'Inter Tight', sans-serif)";

  const heroCard = (label: string, value: string | null, sub?: string, positive?: boolean | null): React.ReactNode => (
    <div style={{
      ...cardStyle,
      flex: 1,
      minWidth: isMobile ? "calc(50% - 6px)" : 180,
      padding: "16px 18px",
    }}>
      <div style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.INK_400, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{
        fontSize: isMobile ? "18px" : "22px",
        fontWeight: 700,
        fontFamily: MONO,
        color: positive === true ? COLOURS.GREEN : positive === false ? COLOURS.RED : COLOURS.NAVY,
        lineHeight: 1.1,
      }}>
        {value ?? "—"}
      </div>
      {sub && (
        <div style={{ fontSize: "11px", color: COLOURS.INK_400, marginTop: 4 }}>{sub}</div>
      )}
    </div>
  );

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
        <PageHeader />

        {/* ── Page title ── */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: isMobile ? "20px" : "24px", fontWeight: 700, fontFamily: DISPLAY, color: COLOURS.NAVY, margin: 0 }}>
            Restaurants Finance
          </h1>
          <p style={{ fontSize: "13px", color: COLOURS.INK_400, margin: "4px 0 0" }}>
            Daily cash positions for restaurant companies
          </p>
        </div>

        {/* ── Company tabs ── */}
        <div style={{
          display: "flex",
          gap: 6,
          marginBottom: 20,
          borderBottom: `2px solid ${COLOURS.HAIRLINE}`,
          paddingBottom: 0,
        }}>
          {COMPANY_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: "10px 18px",
                fontSize: "13px",
                fontWeight: 600,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: activeTab === t.id ? t.color : COLOURS.INK_400,
                borderBottom: `3px solid ${activeTab === t.id ? t.color : "transparent"}`,
                marginBottom: "-2px",
                transition: "color 0.15s, border-color 0.15s",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Month filter ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <label style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.INK_400 }}>Month</label>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{
              padding: "6px 10px",
              borderRadius: RADII.SM,
              border: `1px solid ${COLOURS.HAIRLINE}`,
              background: COLOURS.CARD,
              color: COLOURS.NAVY,
              fontSize: "13px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {monthOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={fetchSheets}
            style={{
              padding: "6px 14px",
              borderRadius: RADII.SM,
              border: `1px solid ${tab.color}`,
              background: tab.lightColor,
              color: tab.color,
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
          <span style={{ fontSize: "12px", color: COLOURS.INK_400 }}>
            {sheets.length} {sheets.length === 1 ? "entry" : "entries"}
          </span>
        </div>

        {/* ── KPI hero row ── */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 20 }}>
          {heroCard(
            "Latest Opening Balance",
            latest?.opening_balance_pkr != null ? shortPkr(latest.opening_balance_pkr) : null,
            latest ? formatDateUK(latest.sheet_date) : undefined,
          )}
          {heroCard(
            "Latest Closing Balance",
            latest?.closing_balance_pkr != null ? shortPkr(latest.closing_balance_pkr) : null,
            latest ? formatDateUK(latest.sheet_date) : undefined,
          )}
          {heroCard(
            "Period Net Movement",
            netMovement != null ? shortPkr(netMovement) : null,
            "closing vs opening",
            netMovement != null ? netMovement >= 0 : null,
          )}
          {heroCard(
            "Period Receipts",
            periodReceipts > 0 ? shortPkr(periodReceipts) : "—",
            "from transactions",
            true,
          )}
          {heroCard(
            "Period Payments",
            periodPayments > 0 ? shortPkr(periodPayments) : "—",
            "from transactions",
            false,
          )}
        </div>

        {/* ── 30-day closing balance chart ── */}
        {!loading && chartData.length > 1 && (
          <div style={{ ...cardStyle, marginBottom: 20, padding: "16px 18px" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: 12 }}>
              Closing Balance — {monthOptions.find((o) => o.value === month)?.label}
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={tab.color} stopOpacity={0.18} />
                    <stop offset="95%" stopColor={tab.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={COLOURS.HAIRLINE} vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: COLOURS.INK_400 }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 10, fill: COLOURS.INK_400 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => shortPkr(v)}
                  width={62}
                />
                <Tooltip
                  formatter={(v: number) => [pkr(v), "Closing Balance"]}
                  labelFormatter={(l) => `Date: ${l}`}
                  contentStyle={{ fontSize: "12px", borderRadius: RADII.SM, border: `1px solid ${COLOURS.HAIRLINE}` }}
                />
                <Area
                  type="monotone"
                  dataKey="closing"
                  stroke={tab.color}
                  strokeWidth={2}
                  fill="url(#areaGrad)"
                  dot={{ r: 3, fill: tab.color, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Recent entries table ── */}
        <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY }}>
              Cash Sheet Entries
            </span>
            <span style={{
              fontSize: "11px",
              fontWeight: 600,
              padding: "3px 10px",
              borderRadius: RADII.PILL,
              background: tab.lightColor,
              color: tab.color,
            }}>
              {tab.label}
            </span>
          </div>

          {loading ? (
            <div style={{ padding: "16px 18px" }}>
              <SkeletonRows n={4} />
            </div>
          ) : sheets.length === 0 ? (
            <div style={{ padding: "32px 18px", textAlign: "center", color: COLOURS.INK_400, fontSize: "13px" }}>
              No cash sheet entries for this month.
              Upload PDFs via <strong>Banking → Cash Sheets</strong> to populate this view.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ background: COLOURS.CARD_ALT }}>
                    <th style={thStyle}>Date</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Opening</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Receipts</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Payments</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Closing</th>
                    <th style={thStyle}>Notes</th>
                    <th style={thStyle}>Uploaded By</th>
                  </tr>
                </thead>
                <tbody>
                  {[...sheets]
                    .sort((a, b) => b.sheet_date.localeCompare(a.sheet_date))
                    .map((s) => {
                      const receipts = s.cash_sheet_transactions
                        .filter((t) => t.txn_type === "receipt")
                        .reduce((sum, t) => sum + t.amount_pkr, 0);
                      const payments = s.cash_sheet_transactions
                        .filter((t) => t.txn_type === "payment")
                        .reduce((sum, t) => sum + t.amount_pkr, 0);
                      const net = (s.closing_balance_pkr ?? 0) - (s.opening_balance_pkr ?? 0);

                      return (
                        <tr key={s.id} style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>
                          <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: "nowrap" }}>
                            {formatDateUK(s.sheet_date)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", fontFamily: MONO, fontSize: "12px" }}>
                            {pkr(s.opening_balance_pkr)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", fontFamily: MONO, fontSize: "12px", color: receipts > 0 ? COLOURS.GREEN : COLOURS.INK_400 }}>
                            {receipts > 0 ? pkr(receipts) : "—"}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", fontFamily: MONO, fontSize: "12px", color: payments > 0 ? COLOURS.RED : COLOURS.INK_400 }}>
                            {payments > 0 ? pkr(payments) : "—"}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", fontFamily: MONO, fontSize: "12px", fontWeight: 600 }}>
                            <span style={{ color: net >= 0 ? COLOURS.GREEN : COLOURS.RED }}>
                              {pkr(s.closing_balance_pkr)}
                            </span>
                          </td>
                          <td style={{ ...tdStyle, color: COLOURS.INK_400, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.notes || "—"}
                          </td>
                          <td style={{ ...tdStyle, color: COLOURS.INK_400, fontSize: "12px" }}>
                            {s.uploaded_by.split("@")[0]}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Upload hint ── */}
        <div style={{ marginTop: 16, padding: "12px 16px", borderRadius: RADII.SM, background: COLOURS.CARD_ALT, border: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ fontSize: "16px" }}>ℹ️</span>
          <div>
            <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: 2 }}>
              Uploading cash sheets for restaurants
            </div>
            <div style={{ fontSize: "12px", color: COLOURS.INK_400, lineHeight: 1.5 }}>
              Go to <strong>Banking → Cash Sheets</strong> and select the <strong>{tab.label}</strong> tab to upload the daily PDF.
              Balances auto-populate from the PDF and appear here immediately.
            </div>
          </div>
        </div>

      </main>
    </AuthWrapper>
  );
}

// ── Table styles ──────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: "10px 14px",
  textAlign: "left",
  fontSize: "11px",
  fontWeight: 700,
  color: COLOURS.INK_400,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 14px",
  verticalAlign: "middle",
  color: COLOURS.NAVY,
};
