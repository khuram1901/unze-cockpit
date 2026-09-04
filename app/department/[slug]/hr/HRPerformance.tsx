"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../../../lib/supabase";
import { COLOURS, RADII, SectionTitle, SkeletonRows } from "../../../lib/SharedUI";
import { useMobile } from "../../../lib/useMobile";
import EmployeeDetailPanel from "./EmployeeDetailPanel";

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
  total_assigned:     number;
  total_completed:    number;
  total_on_time:      number;
  total_overdue:      number;
  total_submitted:    number;
  avg_completion_pct: number | null;
  avg_ontime_pct:     number | null;
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

// System accounts that should never appear as managers or employees
const SYSTEM_ACCOUNTS = ["meeting minutes", "recurring template", "system", "auto"];

function isSystemAccount(name: string): boolean {
  return SYSTEM_ACCOUNTS.some(s => name.toLowerCase().includes(s));
}

// ── Merge helpers ─────────────────────────────────────────────────────────────

/** Collapse same-named departments across companies into one row */
function mergeDepts(rows: DeptRow[]): DeptRow[] {
  const map = new Map<string, DeptRow>();
  for (const r of rows) {
    const existing = map.get(r.department);
    if (existing) {
      existing.total           += r.total;
      existing.completed       += r.completed;
      existing.on_time         += r.on_time;
      existing.late            += r.late;
      existing.overdue         += r.overdue;
      existing.employee_credit += r.employee_credit;
      existing.company_name     = ""; // multiple companies
      existing.completion_pct   = existing.total > 0
        ? Math.round(existing.completed / existing.total * 100) : null;
      existing.ontime_pct       = existing.completed > 0
        ? Math.round(existing.on_time / existing.completed * 100) : null;
    } else {
      map.set(r.department, { ...r });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

/** Collapse same-email employees across companies/departments into one row */
function mergeEmps(rows: EmpRow[]): EmpRow[] {
  const map = new Map<string, EmpRow>();
  for (const r of rows) {
    if (isSystemAccount(r.name || r.email)) continue;
    const existing = map.get(r.email);
    if (existing) {
      existing.total           += r.total;
      existing.completed       += r.completed;
      existing.on_time         += r.on_time;
      existing.late            += r.late;
      existing.overdue         += r.overdue;
      existing.employee_credit += r.employee_credit;
      existing.completion_pct   = existing.total > 0
        ? Math.round(existing.completed / existing.total * 100) : null;
      existing.ontime_pct       = existing.completed > 0
        ? Math.round(existing.on_time / existing.completed * 100) : null;
    } else {
      map.set(r.email, { ...r });
    }
  }
  return Array.from(map.values());
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function ragColor(pct: number | null, field: "completion" | "ontime"): string {
  if (pct === null) return COLOURS.SLATE;
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
  return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");
}

function shortName(name: string): string {
  if (name.includes("@")) return name.split("@")[0];
  return name;
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, valueColor }: {
  label: string; value: string | number; sub?: string; valueColor?: string;
}) {
  return (
    <div style={{
      background: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`,
      borderRadius: RADII.CARD, padding: "16px 18px",
    }}>
      <div style={{ fontSize: "11px", color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
        {label}
      </div>
      <div style={{ fontSize: "28px", fontWeight: 600, color: valueColor ?? COLOURS.NAVY, lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "4px" }}>{sub}</div>}
    </div>
  );
}

// ── Score bar ─────────────────────────────────────────────────────────────────

function ScoreBar({ completion, ontime }: { completion: number | null; ontime: number | null }) {
  const compColor = ragColor(completion, "completion");
  const bg        = ragBg(completion, "completion");
  const pct       = completion ?? 0;
  return (
    <div style={{ minWidth: "150px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div style={{ flex: 1, height: "6px", background: COLOURS.TRACK, borderRadius: "3px" }}>
          <div style={{
            width: `${pct}%`, height: "100%", background: compColor,
            borderRadius: "3px", minWidth: pct > 0 ? "4px" : "0",
          }} />
        </div>
        <span style={{
          display: "inline-block", padding: "2px 8px", borderRadius: "20px",
          fontSize: "12px", fontWeight: 600, background: bg, color: compColor,
          minWidth: "42px", textAlign: "center",
        }}>
          {completion !== null ? `${completion}%` : "—"}
        </span>
      </div>
      <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "3px" }}>
        {ontime !== null
          ? <span style={{ color: ragColor(ontime, "ontime") }}>{ontime}% on time</span>
          : <span>no completions yet</span>}
      </div>
    </div>
  );
}

// ── Department table ──────────────────────────────────────────────────────────

function DeptTable({ rows, loading, deptFilter, setDeptFilter, showCompany }: {
  rows: DeptRow[]; loading: boolean;
  deptFilter: string; setDeptFilter: (d: string) => void;
  showCompany: boolean;
}) {
  const thStyle: React.CSSProperties = {
    padding: "8px 12px", textAlign: "left", color: COLOURS.SLATE,
    fontWeight: 500, fontSize: "11px", textTransform: "uppercase",
    letterSpacing: "0.05em", background: COLOURS.CARD_ALT,
    borderBottom: `1px solid ${COLOURS.HAIRLINE}`, whiteSpace: "nowrap",
  };
  const tdStyle: React.CSSProperties = {
    padding: "10px 12px", color: COLOURS.NAVY, fontSize: "13px",
    borderBottom: `1px solid ${COLOURS.HAIRLINE}`, verticalAlign: "middle",
  };
  const numTd: React.CSSProperties = { ...tdStyle, color: COLOURS.SLATE, textAlign: "right" };

  if (loading) return <SkeletonRows count={6} />;
  if (!rows.length) {
    return <div style={{ color: COLOURS.SLATE, fontSize: "13px", textAlign: "center", padding: "24px" }}>No data for this period.</div>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead>
          <tr>
            <th style={thStyle}>Department</th>
            {showCompany && <th style={thStyle}>Company</th>}
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
              {showCompany && <td style={{ ...tdStyle, color: COLOURS.SLATE, fontSize: "12px" }}>{r.company_name}</td>}
              <td style={numTd}>{r.total}</td>
              <td style={numTd}>{r.completed}</td>
              <td style={{ ...numTd, color: COLOURS.GREEN }}>{r.on_time}</td>
              <td style={{ ...numTd, color: r.late > 0 ? COLOURS.AMBER : COLOURS.SLATE }}>{r.late}</td>
              <td style={{ ...numTd, color: r.overdue > 0 ? COLOURS.RED : COLOURS.SLATE, fontWeight: r.overdue > 0 ? 600 : 400 }}>{r.overdue}</td>
              <td style={tdStyle}><ScoreBar completion={r.completion_pct} ontime={r.ontime_pct} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Employee spotlight ─────────────────────────────────────────────────────────

function EmpSpotlight({ employees, loading, deptFilter, onSelect }: {
  employees: EmpRow[]; loading: boolean; deptFilter: string; onSelect: (email: string) => void;
}) {
  const filtered = deptFilter
    ? employees.filter(e => e.department === deptFilter)
    : employees;

  const top = [...filtered]
    .filter(e => (e.completion_pct ?? 0) > 0)
    .sort((a, b) => (b.ontime_pct ?? 0) - (a.ontime_pct ?? 0) || b.completed - a.completed)
    .slice(0, 5);

  const bottom = [...filtered]
    .filter(e => e.overdue > 0 || (e.completion_pct ?? 100) < 40)
    .sort((a, b) => b.overdue - a.overdue || (a.completion_pct ?? 0) - (b.completion_pct ?? 0))
    .slice(0, 5);

  const rowStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: "10px",
    padding: "9px 0", borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
  };
  const lastRow: React.CSSProperties = { ...rowStyle, borderBottom: "none", paddingBottom: 0 };

  function Avatar({ name, bg, color }: { name: string; bg: string; color: string }) {
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
    const c  = accent === "green" ? COLOURS.GREEN : COLOURS.RED;
    const bg = accent === "green" ? COLOURS.SUCCESS_SOFT : COLOURS.DANGER_SOFT;
    return (
      <div
        onClick={() => onSelect(emp.email)}
        style={{ ...(isLast ? lastRow : rowStyle), cursor: "pointer" }}
      >
        <Avatar name={emp.name} bg={bg} color={c} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {shortName(emp.name)}
          </div>
          <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>
            {emp.department ?? "—"}
            {emp.total > 0 && <span style={{ marginLeft: "6px" }}>· {emp.total} tasks</span>}
          </div>
          {accent === "red" && emp.overdue > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "5px", marginTop: "2px" }}>
              <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: COLOURS.RED, flexShrink: 0 }} />
              <span style={{ fontSize: "11px", color: COLOURS.RED }}>{emp.overdue} overdue</span>
            </div>
          )}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: c }}>
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
      <div style={card}>
        <SectionTitle title="Top performers" style={{ color: COLOURS.GREEN }} />
        {top.length === 0
          ? <div style={{ color: COLOURS.SLATE, fontSize: "13px", padding: "16px 0" }}>No data yet.</div>
          : top.map((e, i) => <EmpRow key={e.email} emp={e} isLast={i === top.length - 1} accent="green" />)}
      </div>
      <div style={card}>
        <SectionTitle title="Needs attention" style={{ color: COLOURS.RED }} />
        {bottom.length === 0
          ? <div style={{ color: COLOURS.SLATE, fontSize: "13px", padding: "16px 0" }}>No red flags this period.</div>
          : bottom.map((e, i) => <EmpRow key={e.email} emp={e} isLast={i === bottom.length - 1} accent="red" />)}
      </div>
    </div>
  );
}

// ── Submitted tasks awaiting HOD ──────────────────────────────────────────────

function SubmittedAwaitingHOD({ managers, loading }: { managers: MgrRow[]; loading: boolean }) {
  const real = managers.filter(m => m.pending_review > 0 && !isSystemAccount(m.name || m.email));

  if (loading) return <SkeletonRows count={2} />;
  if (!real.length) {
    return (
      <div style={{ color: COLOURS.SLATE, fontSize: "13px", padding: "8px 0" }}>
        No submitted tasks are currently waiting for a response.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
      {real.map((m, i) => {
        const isLast = i === real.length - 1;
        const color  = m.pending_review >= 10 ? COLOURS.RED : m.pending_review >= 3 ? COLOURS.AMBER : COLOURS.SLATE;
        return (
          <div key={m.email} style={{
            display: "flex", alignItems: "center", gap: "12px",
            padding: "10px 0", borderBottom: isLast ? "none" : `1px solid ${COLOURS.HAIRLINE}`,
          }}>
            <div style={{
              width: "34px", height: "34px", borderRadius: "50%",
              background: COLOURS.CARD_ALT, border: `1px solid ${COLOURS.HAIRLINE}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY, flexShrink: 0,
            }}>
              {initials(m.name || "?")}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>
                {shortName(m.name)}
              </div>
              <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>
                Assigned {m.tasks_assigned} tasks this period
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: "18px", fontWeight: 700, color }}>
                {m.pending_review}
              </div>
              <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>awaiting review</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Filter pill ────────────────────────────────────────────────────────────────

function FilterPill({ label, value, options, onChange }: {
  label: string; value: number | string;
  options: { label: string; value: number | string }[];
  onChange: (v: number | string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{label}:</span>
      <select
        value={value}
        onChange={e => onChange(typeof value === "number" ? parseInt(e.target.value, 10) : e.target.value)}
        style={{
          fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY,
          background: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`,
          borderRadius: RADII.SM, padding: "5px 10px", cursor: "pointer",
        }}
      >
        {options.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────────

export default function HRPerformance() {
  const isMobile                        = useMobile();
  const [data,          setData]        = useState<PerfData | null>(null);
  const [loading,       setLoading]     = useState(true);
  const [error,         setError]       = useState<string | null>(null);
  const [days,          setDays]        = useState<number>(90);
  const [deptFilter,    setDeptFilter]  = useState<string>("");
  const [compFilter,    setCompFilter]  = useState<string>("all");
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);

  const load = useCallback(async (d: number) => {
    setLoading(true); setError(null);
    try {
      const res  = await authFetch(`/api/hr/performance?days=${d}`);
      const json = await res.json() as PerfData;
      if ("error" in json) throw new Error((json as { error: string }).error);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(days); }, [load, days]);

  const rawDepts = data?.departments ?? [];
  const rawEmps  = data?.employees   ?? [];

  const filteredDepts = compFilter === "all" ? rawDepts : rawDepts.filter(d => d.company_name === compFilter);
  const filteredEmps  = compFilter === "all" ? rawEmps  : rawEmps.filter(e => e.company_name === compFilter);

  const mergedDeptRows = compFilter === "all" ? mergeDepts(filteredDepts) : filteredDepts;
  const mergedEmpRows  = mergeEmps(filteredEmps);

  const deptRows = deptFilter ? mergedDeptRows.filter(d => d.department === deptFilter) : mergedDeptRows;

  const companies = Array.from(new Set(rawDepts.map(d => d.company_name).filter(Boolean))).sort();

  const t = data?.totals;

  const kpiGrid: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, minmax(0, 1fr))",
    gap: "10px", marginBottom: "20px",
  };
  const cardStyle: React.CSSProperties = {
    background: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`,
    borderRadius: RADII.CARD, padding: "18px 20px",
  };

  return (
    <div>
      {/* ── Toolbar ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center", marginBottom: "18px" }}>
        <FilterPill
          label="Company"
          value={compFilter}
          options={[{ label: "All companies", value: "all" }, ...companies.map(c => ({ label: c, value: c }))]}
          onChange={v => { setCompFilter(String(v)); setDeptFilter(""); }}
        />
        <FilterPill
          label="Period"
          value={days}
          options={PERIOD_OPTIONS.map(o => ({ label: o.label, value: o.value }))}
          onChange={v => setDays(Number(v))}
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

      {error && <div style={{ color: COLOURS.RED, fontSize: "13px", marginBottom: "16px" }}>{error}</div>}

      {/* ── KPI Cards ── */}
      <div style={kpiGrid}>
        <KpiCard
          label="Avg on-time rate"
          value={loading ? "…" : t?.avg_ontime_pct != null ? `${t.avg_ontime_pct}%` : "—"}
          sub={t?.avg_ontime_pct != null && t.avg_ontime_pct < 40 ? "below target" : `last ${days} days`}
          valueColor={loading ? COLOURS.SLATE : ragColor(t?.avg_ontime_pct ?? null, "ontime")}
        />
        <KpiCard
          label="Avg completion"
          value={loading ? "…" : t?.avg_completion_pct != null ? `${t.avg_completion_pct}%` : "—"}
          sub={`${t?.total_assigned ?? "…"} tasks assigned`}
          valueColor={loading ? COLOURS.SLATE : ragColor(t?.avg_completion_pct ?? null, "completion")}
        />
        <KpiCard
          label="Overdue now"
          value={loading ? "…" : t?.total_overdue ?? "—"}
          sub="past due date, not done"
          valueColor={loading ? COLOURS.SLATE : (t?.total_overdue ?? 0) > 0 ? COLOURS.RED : COLOURS.GREEN}
        />
        <KpiCard
          label="Awaiting sign-off"
          value={loading ? "…" : t?.total_submitted ?? "—"}
          sub="submitted by employee"
          valueColor={loading ? COLOURS.SLATE : (t?.total_submitted ?? 0) > 0 ? COLOURS.AMBER : COLOURS.GREEN}
        />
      </div>

      {/* ── Department table ── */}
      <div style={{ ...cardStyle, marginBottom: "16px" }}>
        <SectionTitle title={`Department performance${deptFilter ? ` · ${deptFilter}` : ""}`} />
        <div style={{ marginTop: "4px", fontSize: "12px", color: COLOURS.SLATE, marginBottom: "12px" }}>
          Click a row to filter the employee lists below. Score = tasks completed ÷ total assigned.
        </div>
        <DeptTable
          rows={deptRows}
          loading={loading}
          deptFilter={deptFilter}
          setDeptFilter={setDeptFilter}
          showCompany={compFilter !== "all"}
        />
      </div>

      {/* ── Employee spotlight ── */}
      <div style={{ marginBottom: "16px" }}>
        <SectionTitle title={`Employee spotlight${deptFilter ? ` · ${deptFilter}` : ""}`} />
        <div style={{ marginTop: "10px" }}>
          <EmpSpotlight employees={mergedEmpRows} loading={loading} deptFilter={deptFilter} onSelect={setSelectedEmail} />
        </div>
      </div>

      {/* ── Submitted tasks awaiting HOD ── */}
      <div style={cardStyle}>
        <SectionTitle title="Submitted tasks awaiting response" />
        <div style={{ marginTop: "4px", fontSize: "12px", color: COLOURS.SLATE, marginBottom: "12px" }}>
          Employees have submitted these tasks for review. The number shows how many are sitting with each manager, unresponded.
        </div>
        <SubmittedAwaitingHOD managers={data?.managers ?? []} loading={loading} />
      </div>

      {/* Employee detail panel */}
      {selectedEmail && (
        <EmployeeDetailPanel
          email={selectedEmail}
          days={days}
          onClose={() => setSelectedEmail(null)}
        />
      )}
    </div>
  );
}
