"use client";

/**
 * /group-hr — Group HR dashboard (CEO view; Khuram's "Option C", 30/08/2026)
 * ─────────────────────────────────────────────────────────────────
 * Dark group strip + company scoreboard cards (from design Option B) over
 * payroll trend, cost per head, 12-month movement and a turnover league
 * (from Option A). One RPC round-trip via /api/group-hr.
 *
 * Access: Admin/CEO by default; others via the Access Matrix toggle
 * "Group HR (CEO view)". PA never (rule 6). The API enforces the same
 * gate server-side.
 */

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { authFetch } from "../lib/supabase";
import { useRequireCapability } from "../lib/useRouteGuard";
import { COLOURS, RADII } from "../lib/SharedUI";
import { useMobile } from "../lib/useMobile";
import { formatDateUK } from "../lib/dateUtils";

type CompanyRow = {
  id: string; name: string; code: string | null;
  active: number; gross: number; cost_head: number;
  joined_30d: number; left_30d: number; turnover_pct: number;
};
type TrendMonth = { month: string; total: number; by_company: { code: string; gross: number }[] };
type MovementMonth = { month: string; joined: number; left: number };
type Dashboard = {
  as_of: string;
  group: {
    gross: number; heads: number; heads_on_payroll: number; avg_cost: number;
    joined_30d: number; left_30d: number; turnover_pct: number;
    present_today: number; on_leave_today: number;
  };
  companies: CompanyRow[];
  payroll_trend: TrendMonth[];
  movement_12m: MovementMonth[];
};
type FilterOptions = {
  companies: { id: string; name: string; department_ids: string[] }[];
  departments: { id: string; name: string }[];
};

const PKR = (v: number | null | undefined) =>
  v != null ? `PKR ${Number(v).toLocaleString("en-PK")}` : "—";
const PKR_M = (v: number) => `${(v / 1_000_000).toFixed(1)}M`;
const K = (v: number) => v >= 1000 ? `${Math.round(v / 1000)}K` : String(v);

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(ym: string) {
  // "2026-08" or "2026-08-01" → "Aug 26"
  const [y, m] = ym.split("-").map(Number);
  return `${MONTH_SHORT[m - 1]} ${String(y).slice(2)}`;
}

// Company series colours for the stacked payroll columns — accent family
// plus the existing status colours, consistent order by size.
const SERIES = ["#3B4CCA", "#6B77D9", "#9AA3E6", "#B4791F", "#0F7B5F", "#64748B", "#B3261E", "#334155"];

const card: React.CSSProperties = {
  backgroundColor: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`,
  borderRadius: RADII.CARD, padding: "18px 20px",
};
const display: React.CSSProperties = { fontFamily: "var(--font-display, 'Inter Tight', sans-serif)" };

function GroupHRContent() {
  const isMobile = useMobile();
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [company, setCompany] = useState("");
  const [department, setDepartment] = useState("");
  const [filterOpts, setFilterOpts] = useState<FilterOptions | null>(null);

  const handleCompanyChange = (v: string) => { setCompany(v); setDepartment(""); };
  const selectedCo = company ? (filterOpts?.companies ?? []).find(c => c.id === company) : null;
  const visibleDepts = selectedCo
    ? (filterOpts?.departments ?? []).filter(d => (selectedCo.department_ids ?? []).includes(d.id))
    : (filterOpts?.departments ?? []);

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch("/api/hr/overview?section=filters");
        if (res.ok) setFilterOpts(await res.json());
      } catch { /* dropdowns stay empty — page still works */ }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const params = new URLSearchParams();
        if (company) params.set("company", company);
        if (department) params.set("department", department);
        const res = await authFetch(`/api/group-hr?${params.toString()}`);
        const json = await res.json();
        if (!res.ok) { setErrorMsg(json.error || "Failed to load"); return; }
        setData(json);
      } catch {
        setErrorMsg("Failed to load");
      } finally { setLoading(false); }
    })();
  }, [company, department]);

  const g = data?.group;
  const net = g ? g.joined_30d - g.left_30d : 0;
  const presentPct = g && g.heads > 0 ? Math.round((g.present_today / g.heads) * 100) : 0;
  const companies = data?.companies ?? [];
  const maxGross = companies[0]?.gross || 1;
  const trend = data?.payroll_trend ?? [];
  const maxTrend = Math.max(...trend.map(t => t.total), 1);
  const seriesColour = new Map<string, string>();
  (trend[trend.length - 1]?.by_company ?? companies.map(c => ({ code: c.code ?? c.name, gross: c.gross })))
    .forEach((s, i) => seriesColour.set(s.code, SERIES[i % SERIES.length]));
  const movement = data?.movement_12m ?? [];
  const maxMove = Math.max(...movement.map(m => Math.max(m.joined, m.left)), 1);
  const costSorted = [...companies].sort((a, b) => b.cost_head - a.cost_head);
  const maxCost = costSorted[0]?.cost_head || 1;
  const turnoverSorted = [...companies].sort((a, b) => b.turnover_pct - a.turnover_pct);

  const filterStyle = (active: boolean): React.CSSProperties => ({
    minWidth: 150, padding: "8px 10px", fontSize: "13px",
    border: `1px solid ${active ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
    borderRadius: RADII.SM, outline: "none", cursor: "pointer",
    color: active ? COLOURS.NAVY : COLOURS.SLATE,
    backgroundColor: COLOURS.CARD, fontWeight: active ? 600 : 400,
  });

  const darkLabel: React.CSSProperties = {
    fontSize: "11px", color: "#9AA3B2", textTransform: "uppercase",
    letterSpacing: "0.8px", marginBottom: "4px",
  };
  const darkValue: React.CSSProperties = { ...display, fontSize: isMobile ? "20px" : "26px", fontWeight: 700, color: "#FFFFFF" };

  return (
    <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "1440px", minWidth: 0 }}>
      {/* Header + filters */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "16px", flexWrap: "wrap", marginBottom: "16px" }}>
        <div>
          <h1 style={{ ...display, fontSize: "26px", fontWeight: 800, color: COLOURS.NAVY, margin: 0 }}>Group HR</h1>
          <p style={{ fontSize: "14px", color: COLOURS.SLATE, margin: "2px 0 0" }}>
            People and payroll across the Unze Group · live from FlowHCM{data ? ` · ${formatDateUK(data.as_of)}` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <select value={company} onChange={e => handleCompanyChange(e.target.value)} aria-label="Company filter" style={filterStyle(!!company)}>
            <option value="">All companies</option>
            {(filterOpts?.companies ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={department} onChange={e => setDepartment(e.target.value)} aria-label="Department filter" style={filterStyle(!!department)}>
            <option value="">All departments</option>
            {visibleDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {(company || department) && (
            <button onClick={() => { setCompany(""); setDepartment(""); }} style={{
              padding: "8px 12px", fontSize: "13px", cursor: "pointer", color: COLOURS.SLATE,
              border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, backgroundColor: COLOURS.CARD,
            }}>Clear</button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div style={{ ...card, borderColor: COLOURS.RED, color: COLOURS.RED, fontSize: "14px", marginBottom: "16px" }}>{errorMsg}</div>
      )}

      {/* Dark group strip */}
      <div style={{
        backgroundColor: COLOURS.NAVY, borderRadius: RADII.CARD, padding: isMobile ? "14px 18px" : "18px 26px",
        display: "flex", alignItems: "center", gap: isMobile ? "18px" : "40px", flexWrap: "wrap", marginBottom: "16px",
      }}>
        <div>
          <div style={darkLabel}>Group payroll</div>
          <div style={darkValue}>{loading ? "…" : g ? `PKR ${PKR_M(g.gross)}` : "—"}</div>
        </div>
        <div style={{ width: 1, height: 36, backgroundColor: "#2A3441" }} />
        <div>
          <div style={darkLabel}>Headcount</div>
          <div style={darkValue}>{loading ? "…" : (g?.heads ?? 0).toLocaleString("en-GB")}</div>
        </div>
        <div style={{ width: 1, height: 36, backgroundColor: "#2A3441" }} />
        <div>
          <div style={darkLabel}>Cost / head</div>
          <div style={darkValue}>{loading ? "…" : g ? K(g.avg_cost) : "—"}</div>
        </div>
        <div style={{ width: 1, height: 36, backgroundColor: "#2A3441" }} />
        <div>
          <div style={darkLabel}>Net movement (30d)</div>
          <div style={{ ...darkValue, color: net >= 0 ? "#7BC4A9" : "#E58E88" }}>{loading ? "…" : `${net > 0 ? "+" : ""}${net}`}</div>
        </div>
        <div style={{ width: 1, height: 36, backgroundColor: "#2A3441" }} />
        <div>
          <div style={darkLabel}>Turnover (30d)</div>
          <div style={{ ...darkValue, color: "#E0B36A" }}>{loading ? "…" : `${g?.turnover_pct ?? 0}%`}</div>
        </div>
        <div style={{ flexGrow: 1 }} />
        <div style={{ textAlign: "right" }}>
          <div style={darkLabel}>Present today</div>
          <div style={darkValue}>{loading ? "…" : `${presentPct}%`}</div>
        </div>
      </div>

      {/* Company scoreboard cards */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))", gap: "14px", marginBottom: "16px" }}>
        {companies.map(c => {
          const share = g && g.gross > 0 ? Math.round((c.gross / g.gross) * 100) : 0;
          const delta = g && g.avg_cost > 0 ? c.cost_head - g.avg_cost : 0;
          return (
            <div key={c.id} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <div style={{ ...display, fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>{c.name}</div>
                <span style={{
                  fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, backgroundColor: COLOURS.CARD_ALT,
                  border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.XS, padding: "2px 8px",
                }}>{c.code ?? "—"}</span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "12px", marginBottom: "8px" }}>
                <div style={{ ...display, fontSize: "28px", fontWeight: 700, color: COLOURS.NAVY }}>{c.active.toLocaleString("en-GB")}</div>
                <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>staff · PKR {PKR_M(c.gross)} payroll</div>
              </div>
              <div style={{ height: 6, backgroundColor: COLOURS.TRACK, borderRadius: 3, marginBottom: "10px" }}>
                <div style={{ width: `${Math.max(2, share)}%`, height: 6, backgroundColor: COLOURS.BLUE, borderRadius: 3 }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", flexWrap: "wrap", gap: "4px" }}>
                <span style={{ color: COLOURS.INK_700 }}>
                  <span style={{ color: COLOURS.GREEN, fontWeight: 600 }}>+{c.joined_30d}</span> joined ·{" "}
                  <span style={{ color: c.left_30d > 0 ? COLOURS.RED : COLOURS.SLATE, fontWeight: 600 }}>{c.left_30d}</span> left
                </span>
                <span style={{ color: COLOURS.INK_700 }}>
                  Cost/head <strong style={{ color: COLOURS.NAVY }}>{K(c.cost_head)}</strong>{" "}
                  {Math.abs(delta) < (g?.avg_cost ?? 0) * 0.05
                    ? <span style={{ color: COLOURS.SLATE }}>≈ avg</span>
                    : delta > 0
                    ? <span style={{ color: COLOURS.AMBER }}>▲ over avg</span>
                    : <span style={{ color: COLOURS.GREEN }}>▼ under avg</span>}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Payroll trend + cost per head */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr", gap: "16px", marginBottom: "16px" }}>
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ ...display, fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY }}>Payroll by company — month by month</div>
            <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>PKR millions</div>
          </div>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE, margin: "4px 0 16px" }}>
            History builds from August 2026 — FlowHCM keeps no earlier salary data. Each new month adds a column automatically.
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: isMobile ? "24px" : "48px", height: 190, padding: "0 12px", overflowX: "auto" }}>
            {trend.map(t => (
              <div key={t.month} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", flexGrow: 1, minWidth: 70 }}>
                <div style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY }}>{PKR_M(t.total)}</div>
                <div style={{ width: 72, display: "flex", flexDirection: "column", borderRadius: "6px 6px 0 0", overflow: "hidden" }}>
                  {t.by_company.map(s => (
                    <div key={s.code} style={{
                      height: Math.max(2, Math.round((s.gross / maxTrend) * 150)),
                      backgroundColor: seriesColour.get(s.code) ?? COLOURS.SLATE,
                    }} />
                  ))}
                </div>
                <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>{monthLabel(t.month)}</div>
              </div>
            ))}
            {/* Next-month placeholder — makes the "grows monthly" promise visible */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", flexGrow: 1, minWidth: 70, opacity: 0.35 }}>
              <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>—</div>
              <div style={{ width: 72, height: 150, border: `2px dashed ${COLOURS.SLATE}`, borderRadius: "6px 6px 0 0", boxSizing: "border-box" }} />
              <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>next month</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "14px", marginTop: "14px", flexWrap: "wrap" }}>
            {[...seriesColour.entries()].map(([code, colour]) => (
              <div key={code} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: COLOURS.INK_700 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: colour }} />{code}
              </div>
            ))}
          </div>
        </div>
        <div style={card}>
          <div style={{ ...display, fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "14px" }}>Cost per head by company</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {costSorted.map(c => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "12px", color: COLOURS.INK_700, width: 120, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                <div style={{ flexGrow: 1, height: 8, backgroundColor: COLOURS.TRACK, borderRadius: 4 }}>
                  <div style={{ width: `${Math.max(2, Math.round((c.cost_head / maxCost) * 100))}%`, height: 8, backgroundColor: COLOURS.BLUE, borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY, width: 48, textAlign: "right" }}>{K(c.cost_head)}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: `1px solid ${COLOURS.HAIRLINE}`, fontSize: "12px", color: COLOURS.SLATE }}>
            Group average <span style={{ fontWeight: 600, color: COLOURS.NAVY }}>{g ? PKR(g.avg_cost) : "—"}</span> · {g?.heads_on_payroll ?? 0} on payroll
          </div>
        </div>
      </div>

      {/* Movement + turnover league */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr", gap: "16px", marginBottom: "16px" }}>
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
            <div style={{ ...display, fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY }}>Joiners vs leavers — last 12 months</div>
            <div style={{ display: "flex", gap: "14px", fontSize: "12px", color: COLOURS.INK_700 }}>
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><span style={{ width: 10, height: 3, borderRadius: 2, backgroundColor: COLOURS.GREEN }} />Joiners</span>
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><span style={{ width: 10, height: 3, borderRadius: 2, backgroundColor: COLOURS.RED }} />Leavers</span>
            </div>
          </div>
          {movement.length > 0 && (
            <>
              <svg width="100%" height="170" viewBox="0 0 800 170" preserveAspectRatio="none">
                <line x1="0" y1="150" x2="800" y2="150" stroke={COLOURS.HAIRLINE} strokeWidth="1" />
                <line x1="0" y1="95" x2="800" y2="95" stroke={COLOURS.HAIRLINE} strokeWidth="1" />
                <line x1="0" y1="40" x2="800" y2="40" stroke={COLOURS.HAIRLINE} strokeWidth="1" />
                <path
                  d={movement.map((m, i) => `${i === 0 ? "M" : "L"}${(i / (movement.length - 1)) * 800},${150 - (m.joined / maxMove) * 130}`).join(" ")}
                  fill="none" stroke={COLOURS.GREEN} strokeWidth="2.5" strokeLinejoin="round" />
                <path
                  d={movement.map((m, i) => `${i === 0 ? "M" : "L"}${(i / (movement.length - 1)) * 800},${150 - (m.left / maxMove) * 130}`).join(" ")}
                  fill="none" stroke={COLOURS.RED} strokeWidth="2.5" strokeLinejoin="round" />
              </svg>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: COLOURS.SLATE, paddingTop: "6px" }}>
                {movement.filter((_, i) => i % 2 === 0).map(m => <span key={m.month}>{monthLabel(m.month)}</span>)}
              </div>
            </>
          )}
        </div>
        <div style={{ ...card, padding: "18px 20px" }}>
          <div style={{ ...display, fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "10px" }}>Turnover league (30 days)</div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, fontSize: "11px", color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              <span>Company</span><span>Left / heads</span>
            </div>
            {turnoverSorted.map(c => (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                <span style={{ fontSize: "13px", color: COLOURS.NAVY, fontWeight: 500 }}>{c.name}</span>
                <span style={{
                  fontSize: "13px", fontWeight: 600,
                  color: c.turnover_pct >= 10 ? COLOURS.RED : c.turnover_pct >= 5 ? COLOURS.AMBER : COLOURS.GREEN,
                }}>{c.left_30d} / {c.active} · {c.turnover_pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p style={{ fontSize: "12px", color: COLOURS.SLATE }}>
        Gross salaries are the current FlowHCM salary setup (live snapshot). Turnover = leavers in the last 30 days ÷ active headcount.
        Present today counts FlowHCM sign-ins — weekend and off-day staff read as absent.
      </p>
    </main>
  );
}

export default function GroupHRPage() {
  return (
    <AuthWrapper>
      <GroupHRGuarded />
    </AuthWrapper>
  );
}

function GroupHRGuarded() {
  const { checking } = useRequireCapability("group_hr");
  if (checking) return <p style={{ padding: "14px 18px", color: COLOURS.SLATE }}>Checking permissions...</p>;
  return <GroupHRContent />;
}
