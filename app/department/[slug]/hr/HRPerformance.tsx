"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../../../lib/supabase";
import { COLOURS, RADII, SectionTitle, SkeletonRows } from "../../../lib/SharedUI";
import { useMobile } from "../../../lib/useMobile";

// ── Types ───────────────────────────────────────────────────────────────────

type DeptRow = {
  department:      string;
  company_id:      string;
  company_name:    string;
  total:           number;
  completed:       number;
  on_time:         number;
  late:            number;
  overdue:         number;
  employee_credit: number;
  completion_pct:  number | null;
  ontime_pct:      number | null;
};

type EmpRow = {
  email:           string;
  name:            string;
  department:      string;
  company_id:      string;
  company_name:    string;
  total:           number;
  completed:       number;
  on_time:         number;
  late:            number;
  overdue:         number;
  employee_credit: number;
  completion_pct:  number | null;
  ontime_pct:      number | null;
};

type MgrRow = {
  email:           string;
  name:            string;
  pending_review:  number;
  tasks_completed: number;
  tasks_assigned:  number;
};

type Totals = {
  total_assigned:    number;
  total_completed:   number;
  total_on_time:     number;
  total_overdue:     number;
  total_submitted:   number;
  avg_completion_pct: number | null;
  avg_ontime_pct:    number | null;
};

type PerfData = {
  period_days:  number;
  totals:       Totals;
  departments:  DeptRow[];
  employees:    EmpRow[];
  managers:     MgrRow[];
};

const PERIOD_OPTIONS = [
  { label: "Last 30 days",  value: 30  },
  { label: "Last 90 days",  value: 90  },
  { label: "Last 180 days", value: 180 },
] as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

function ragColor(pct: number | null, field: "completion" | "ontime"): string {
  if (pct === null) return COLOURS.SLATE;
  // Thresholds: completion ≥60% green, ≥30% amber, else red
  //             ontime    ≥50% green, ≥25% amber, else red
  const [green, amber] = field === "completion" ? [60, 30] : [50, 25];
  if (pct >= green) return COLOURS.GREEN;
  if (pct >= amber) return COLOURS.AMBER;
  return COLOURS.RED;
}

function ragBg(pct: number | null, field: "completion" | "ontime"): string {
  if (pct === null) return COLOURS.HAIRLINE;
  const [green, amber] = field === "completion" ? [60, 30] : [50, 25];
  if (pct >= green) return COLOURS.SUCCESS_SOFT;
  if (pct >= amber) return COLOURS.WARNING_SOFT;
  return COLOURS.DANGER_SOFT;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function shortName(name: string): string {
  // If it looks like an email, use the part before @
  if (name.includes("@")) return name.split("@")[0];
  return name;
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, valueColor,
}: { label: string; value: string | number; sub?: string; valueColor?: string }) {
  return (
    <div style={{
      background:   COLOURS.CARD,
      border:       `1px solid ${COLOURS.HAIRLINE}`,
      borderRadius: RADII.CARD,
      padding:      "16px 18px",
    }}>
      <div style={{ fontSize: "11px", color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
        {label}
      </div>
      <div style={{ fontSize: "28px", fontWeight: 600, color: valueColor ?? COLOURS.NAVY, lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "4px" }}>{sub}</div>
      )}
    </div>
  );
}

// ── Score bar ─────────────────────────────────────────────────────────────────

function ScoreBar({ completion, ontime }: { completion: number | null; ontime: number | null }) {
  const compColor = ragColor(completion, "completion");
  const bg        = ragBg(completion, "completion");
  const pct       = completion ?? 0;
  return (
    <div style={{ minWidth: "160px" }}>
      {/* Bar */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div style={{
          flex: 1, height: "6px", background: COLOURS.TRACK, borderRadius: "3px",
        }}>
          <div style={{
            width:        `${pct}%`,
            height:       "100%",
            background:   compColor,
            borderRadius: "3px",
            minWidth:     pct > 0 ? "4px" : "0",
          }} />
        </div>
        <span style={{
          display:      "inline-block",
          padding:      "2px 8px",
          borderRadius: "20px",
          fontSize:     "12px",
          fontWeight:   600,
          background:   bg,
          color:        compColor,
          minWidth:     "42px",
          textAlign:    "center",
        }}>
          {completion !== null ? `${completion}%` : "—"}
        </span>
      </div>
      {/* On-time sub-label */}
      <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "3px" }}>
        {ontime !== null
          ? <span style={{ color: ragColor(ontime, "ontime") }}>{ontime}% on time</span>
          : <span>no completions yet</span>}
      </div>
    </div>
  );
}

// ── Department table ──────────────────────────────────────────────────────────

function DeptTable({ rows, loading, deptFilter, setDeptFilter }: {
  rows:          DeptRow[];
  loading:       boolean;
  deptFilter:    string;
  setDeptFilter: (d: string) => void;
}) {
  const thStyle: React.CSSProperties = {
    padding: "8px 12px", textAlign: "left", color: COLOURS.SLATE,
    fontWeight: 500, fontSize: "11px", textTransform: "uppercase",
    letterSpacing: "0.05em", background: COLOURS.CARD_ALT,
    borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
    whiteSpace: "nowrap",
  };
  const tdStyle: React.CSSProperties = {
    padding: "10px 12px", color: COLOURS.NAVY, fontSize: "13px",
    borderBottom: `1px solid ${COLOURS.HAIRLINE}`, verticalAlign: "middle",
  };
  const numStyle: React.CSSProperties = { ...tdStyle, color: COLOURS.SLATE, textAlign: "right" };

  if (loading) return <SkeletonRows count={6} />;
  if (!rows.length) {
    return (
      <div style={{ color: COLOURS.SLATE, fontSize: "13px", textAlign: "center", padding: "24px" }}>
        No data for this period.
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead>
          <tr>
            <th style={thStyle}>Department</th>
            <th style={thStyle}>Company</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Assigned</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Done</th>
            <th style={{ ...thStyle, textAlign: "right" }}>On time</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Late</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Overdue</th>
            <th style={{ ...thStyle, minWidth: "180px" }}>Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              style={{ cursor: "pointer", background: deptFilter === r.department ? COLOURS.TRACK : undefined }}
              onClick={() => setDeptFilter(deptFilter === r.department ? "" : r.department)}
            >
              <td style={{ ...tdStyle, fontWeight: 600 }}>{r.department}</td>
              <td style={{ ...tdStyle, color: COLOURS.SLATE, fontSize: "12px" }}>{r.company_name}</td>
              <td style={numStyle}>{r.total}</td>
              <td style={numStyle}>{r.completed}</td>
              <td style={{ ...numStyle, color: COLOURS.GREEN }}>{r.on_time}</td>
              <td style={{ ...numStyle, color: r.late > 0 ? COLOURS.AMBER : COLOURS.SLATE }}>{r.late}</td>
              <td style={{ ...numStyle, color: r.overdue > 0 ? COLOURS.RED : COLOURS.SLATE, fontWeight: r.overdue > 0 ? 600 : 400 }}>{r.overdue}</td>
              <td style={tdStyle}><ScoreBar completion={r.completion_pct} ontime={r.ontime_pct} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Employee spotlight ─────────────────────────────────────────────────────────

function EmpSpotlight({ employees, loading, deptFilter }: {
  employees:  EmpRow[];
  loading:    boolean;
  deptFilter: string;
}) {
  const filtered = deptFilter
    ? employees.filter((e) => e.department === deptFilter)
    : employees;

  const top     = [...filtered].sort((a, b) => (b.ontime_pct ?? 0) - (a.ontime_pct ?? 0)).slice(0, 5);
  const bottom  = [...filtered]
    .filter((e) => e.overdue > 0 || (e.completion_pct ?? 100) < 40)
    .sort((a, b) => b.overdue - a.overdue || (a.completion_pct ?? 0) - (b.completion_pct ?? 0))
    .slice(0, 5);

  const rowStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: "10px",
    padding: "9px 0", borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
  };
  const lastRowStyle: React.CSSProperties = { ...rowStyle, borderBottom: "none", paddingBottom: 0 };

  function AvatarBadge({ name, bg, color }: { name: string; bg: string; color: string }) {
    return (
      <div style={{
        width: "34px", height: "34px", borderRadius: "50%", background: bg,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "12px", fontWeight: 600, color, flexShrink: 0,
      }}>
        {initials(name || "?")}
      </div>
    );
  }

  function EmpRow({ emp, isLast, accent }: { emp: EmpRow; isLast: boolean; accent: "green" | "red" }) {
    const compColor = accent === "green" ? COLOURS.GREEN : COLOURS.RED;
    const compBg    = accent === "green" ? COLOURS.SUCCESS_SOFT : COLOURS.DANGER_SOFT;
    return (
      <div style={isLast ? lastRowStyle : rowStyle}>
        <AvatarBadge name={emp.name} bg={compBg} color={compColor} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {shortName(emp.name)}
          </div>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>{emp.department}</div>
          {accent === "red" && emp.overdue > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "5px", marginTop: "2px" }}>
              <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: COLOURS.RED, flexShrink: 0 }} />
              <span style={{ fontSize: "11px", color: COLOURS.RED }}>{emp.overdue} overdue</span>
            </div>
          )}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: compColor }}>
            {emp.completion_pct !== null ? `${emp.completion_pct}%` : "—"}
          </div>
          <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>
            {emp.ontime_pct !== null ? `${emp.ontime_pct}% on time` : ""}
          </div>
        </div>
      </div>
    );
  }

  const card: React.CSSProperties = {
    background: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`,
    borderRadius: RADII.CARD, padding: "16px 18px",
  };

  if (loading) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <div style={card}><SkeletonRows count={4} /></div>
        <div style={card}><SkeletonRows count={4} /></div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
      {/* Top performers */}
      <div style={card}>
        <SectionTitle title="Top performers" style={{ color: COLOURS.GREEN }} />
        {top.length === 0 ? (
          <div style={{ color: COLOURS.SLATE, fontSize: "13px", padding: "16px 0" }}>
            {deptFilter ? `No data for ${deptFilter} yet.` : "No data yet."}
          </div>
        ) : (
          top.map((e, i) => <EmpRow key={e.email} emp={e} isLast={i === top.length - 1} accent="green" />)
        )}
      </div>

      {/* Needs attention */}
      <div style={card}>
        <SectionTitle title="Needs attention" style={{ color: COLOURS.RED }} />
        {bottom.length === 0 ? (
          <div style={{ color: COLOURS.SLATE, fontSize: "13px", padding: "16px 0" }}>
            No red flags this period.
          </div>
        ) : (
          bottom.map((e, i) => <EmpRow key={e.email} emp={e} isLast={i === bottom.length - 1} accent="red" />)
        )}
      </div>
    </div>
  );
}

// ── Manager review strip ───────────────────────────────────────────────────────

function ManagerStrip({ managers, loading }: { managers: MgrRow[]; loading: boolean }) {
  const card: React.CSSProperties = {
    background: COLOURS.CARD_ALT, border: `1px solid ${COLOURS.HAIRLINE}`,
    borderRadius: RADII.SM, padding: "12px 14px",
  };

  if (loading) return <SkeletonRows count={2} />;
  if (!managers.length) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "10px" }}>
      {managers.map((m) => {
        const pendingColor = m.pending_review > 5 ? COLOURS.RED : m.pending_review > 0 ? COLOURS.AMBER : COLOURS.GREEN;
        return (
          <div key={m.email} style={card}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {shortName(m.name)}
            </div>
            <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginBottom: "6px" }}>{m.email}</div>
            <div style={{ fontSize: "22px", fontWeight: 700, color: pendingColor }}>
              {m.pending_review}
            </div>
            <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>pending sign-off</div>
            <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>
              {m.tasks_completed} completed assigned
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Filter pill ────────────────────────────────────────────────────────────────

function FilterPill({
  label, value, options, onChange,
}: {
  label:    string;
  value:    number | string;
  options:  { label: string; value: number | string }[];
  onChange: (v: number | string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(typeof value === "number" ? parseInt(e.target.value, 10) : e.target.value)}
        style={{
          fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY,
          background: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`,
          borderRadius: RADII.SM, padding: "5px 10px", cursor: "pointer",
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────────

export default function HRPerformance() {
  const isMobile                  = useMobile();
  const [data,       setData]     = useState<PerfData | null>(null);
  const [loading,    setLoading]  = useState(true);
  const [error,      setError]    = useState<string | null>(null);
  const [days,       setDays]     = useState<number>(90);
  const [deptFilter, setDeptFilter] = useState<string>("");
  const [compFilter, setCompFilter] = useState<string>("all");

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const res  = await authFetch(`/api/hr/performance?days=${d}`);
      const json = await res.json() as PerfData;
      if ("error" in json) throw new Error((json as { error: string }).error);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load performance data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(days); }, [load, days]);

  // Client-side filters
  const allDepts  = data?.departments ?? [];
  const companies = Array.from(new Set(allDepts.map((d) => d.company_name))).sort();
  const depts = (compFilter === "all" ? allDepts : allDepts.filter((d) => d.company_name === compFilter))
    .filter((d) => !deptFilter || d.department === deptFilter);

  const allEmps   = data?.employees ?? [];
  const emps      = compFilter === "all" ? allEmps : allEmps.filter((e) => e.company_name === compFilter);

  const t = data?.totals;

  const avgCompPct = t?.avg_completion_pct ?? null;
  const avgOntime  = t?.avg_ontime_pct ?? null;

  const kpiGrid: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, minmax(0, 1fr))",
    gap: "10px",
    marginBottom: "20px",
  };

  const cardStyle: React.CSSProperties = {
    background:   COLOURS.CARD,
    border:       `1px solid ${COLOURS.HAIRLINE}`,
    borderRadius: RADII.CARD,
    padding:      "18px 20px",
  };

  return (
    <div>
      {/* ── Toolbar ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center", marginBottom: "18px" }}>
        <FilterPill
          label="Company"
          value={compFilter}
          options={[{ label: "All companies", value: "all" }, ...companies.map((c) => ({ label: c, value: c }))]}
          onChange={(v) => { setCompFilter(String(v)); setDeptFilter(""); }}
        />
        <FilterPill
          label="Period"
          value={days}
          options={PERIOD_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
          onChange={(v) => setDays(Number(v))}
        />
        {deptFilter && (
          <button
            onClick={() => setDeptFilter("")}
            style={{
              fontSize: "12px", color: COLOURS.SLATE, background: COLOURS.TRACK,
              border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.PILL,
              padding: "4px 12px", cursor: "pointer",
            }}
          >
            ✕ {deptFilter}
          </button>
        )}
      </div>

      {error && (
        <div style={{ color: COLOURS.RED, fontSize: "13px", marginBottom: "16px" }}>{error}</div>
      )}

      {/* ── KPI Cards ── */}
      <div style={kpiGrid}>
        <KpiCard
          label="Avg on-time rate"
          value={loading ? "…" : avgOntime !== null ? `${avgOntime}%` : "—"}
          sub={avgOntime !== null && avgOntime < 40 ? "below target" : undefined}
          valueColor={loading ? COLOURS.SLATE : ragColor(avgOntime, "ontime")}
        />
        <KpiCard
          label="Avg completion"
          value={loading ? "…" : avgCompPct !== null ? `${avgCompPct}%` : "—"}
          sub={`last ${days} days`}
          valueColor={loading ? COLOURS.SLATE : ragColor(avgCompPct, "completion")}
        />
        <KpiCard
          label="Overdue now"
          value={loading ? "…" : t?.total_overdue ?? "—"}
          sub="past due, not done"
          valueColor={loading ? COLOURS.SLATE : (t?.total_overdue ?? 0) > 0 ? COLOURS.RED : COLOURS.GREEN}
        />
        <KpiCard
          label="Awaiting manager"
          value={loading ? "…" : t?.total_submitted ?? "—"}
          sub="submitted, pending review"
          valueColor={loading ? COLOURS.SLATE : (t?.total_submitted ?? 0) > 0 ? COLOURS.AMBER : COLOURS.GREEN}
        />
      </div>

      {/* ── Department table ── */}
      <div style={{ ...cardStyle, marginBottom: "16px" }}>
        <SectionTitle title={`Department performance${deptFilter ? ` · ${deptFilter}` : ""}`} />
        <div style={{ marginTop: "12px" }}>
          <DeptTable
            rows={depts}
            loading={loading}
            deptFilter={deptFilter}
            setDeptFilter={setDeptFilter}
          />
        </div>
        <div style={{ marginTop: "8px", fontSize: "11px", color: COLOURS.SLATE }}>
          Click a row to filter the employee lists below. Score = tasks done ÷ total assigned. On-time = done before due date ÷ done.
        </div>
      </div>

      {/* ── Employee spotlight ── */}
      <div style={{ marginBottom: "16px" }}>
        <SectionTitle title="Employee spotlight" />
        <div style={{ marginTop: "10px" }}>
          <EmpSpotlight employees={emps} loading={loading} deptFilter={deptFilter} />
        </div>
      </div>

      {/* ── Manager review load ── */}
      {(data?.managers?.length ?? 0) > 0 && (
        <div style={cardStyle}>
          <SectionTitle title="Manager review load" />
          <div style={{ marginTop: "4px", fontSize: "12px", color: COLOURS.SLATE, marginBottom: "12px" }}>
            Tasks submitted by employees, pending sign-off by the assigning manager.
          </div>
          <ManagerStrip managers={data?.managers ?? []} loading={loading} />
        </div>
      )}
    </div>
  );
}
