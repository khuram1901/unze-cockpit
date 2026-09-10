"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../lib/supabase";
import { COLOURS, RADII, SectionTitle, SkeletonRows } from "../lib/SharedUI";

// ── Types ─────────────────────────────────────────────────────────────────────

type StatusKey = "star" | "on_track" | "at_risk" | "needs_help";

type EmpRow = {
  email:           string;
  emp_name:        string;
  department:      string;
  company?:        string;
  employee_code:   string;
  total_tasks:     number;
  self_gen_count:  number;
  on_time_count:   number;
  submitted_count: number;
  overdue_count:   number;
  stuck_count:     number;
  efficiency_score:number;
  status:          StatusKey;
};

type StuckTask = {
  task_id:      string;
  task_name:    string;
  emp_name:     string;
  employee_code:string;
  department?:  string;
  status:       string;
  stuck_reason: string | null;
  due_date:     string;
  days_overdue: number;
};

type TeamData = {
  period_days:  number;
  department:   string;
  company:      string;
  kpis: {
    total_tasks:      number;
    self_gen_count:   number;
    on_time_count:    number;
    submitted_count:  number;
    overdue_count:    number;
    stuck_count:      number;
    total_employees:  number;
    efficiency_score: number;
  };
  task_breakdown: {
    on_time:   number;
    late:      number;
    submitted: number;
    overdue:   number;
    stuck:     number;
    running:   number;
    self_gen:  number;
  };
  employees:   EmpRow[];
  stuck_tasks: StuckTask[];
};

// ── Design tokens ─────────────────────────────────────────────────────────────

const PERIODS = [
  { label: "30 days",  value: 30  },
  { label: "90 days",  value: 90  },
  { label: "180 days", value: 180 },
];

const STATUS_CONFIG: Record<StatusKey, { label: string; color: string; bg: string }> = {
  star:       { label: "Star",       color: "#0F7B5F", bg: "#E6F4EF" },
  on_track:   { label: "On track",   color: "#3B4CCA", bg: "#EEF0FC" },
  at_risk:    { label: "At risk",    color: "#B4791F", bg: "#FBF1DE" },
  needs_help: { label: "Needs help", color: "#B3261E", bg: "#FCECEA" },
};

function card(extra?: React.CSSProperties): React.CSSProperties {
  return {
    background: COLOURS.CARD,
    border: `1px solid ${COLOURS.HAIRLINE}`,
    borderRadius: RADII.CARD,
    padding: "16px 18px",
    ...extra,
  };
}

const thS: React.CSSProperties = {
  textAlign: "left", fontSize: "11px", fontWeight: 600,
  color: COLOURS.SLATE, padding: "8px 10px",
  borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
  whiteSpace: "nowrap",
};
const tdS: React.CSSProperties = { padding: "10px 10px", verticalAlign: "middle", fontSize: "13px" };
const tdR: React.CSSProperties = { ...tdS, textAlign: "right" };

function initials(name: string) {
  return (name || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

function effColor(score: number) {
  if (score >= 65) return STATUS_CONFIG.star.color;
  if (score >= 55) return STATUS_CONFIG.on_track.color;
  if (score >= 30) return STATUS_CONFIG.at_risk.color;
  return STATUS_CONFIG.needs_help.color;
}

function EffBar({ score, status }: { score: number; status: StatusKey }) {
  const c = STATUS_CONFIG[status].color;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <div style={{ flex: 1, height: "6px", background: "#F1F3F6", borderRadius: "3px", minWidth: "60px" }}>
        <div style={{ width: `${score}%`, height: "100%", background: c, borderRadius: "3px" }} />
      </div>
      <span style={{ fontSize: "12px", fontWeight: 700, color: c, width: "28px", textAlign: "right" }}>
        {score}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: StatusKey }) {
  const s = STATUS_CONFIG[status];
  return (
    <span style={{
      fontSize: "10px", fontWeight: 600, padding: "2px 8px",
      borderRadius: "999px", color: s.color, background: s.bg,
      whiteSpace: "nowrap",
    }}>{s.label}</span>
  );
}

function KpiCard({ label, value, color, sub }: {
  label: string; value: number | string; color?: string; sub?: string;
}) {
  return (
    <div style={card({ textAlign: "center" })}>
      <div style={{ fontSize: "28px", fontWeight: 800, color: color ?? COLOURS.NAVY, lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "4px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
      {sub && <div style={{ fontSize: "10px", color: COLOURS.SLATE, marginTop: "2px" }}>{sub}</div>}
    </div>
  );
}

// ── Root component ─────────────────────────────────────────────────────────────

export default function MyTeamPerformance() {
  const [days, setDays]       = useState(90);
  const [data, setData]       = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/my-team/performance?days=${d}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      setData(json as TeamData);
    } catch (e: unknown) {
      setError((e as Error).message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(days); }, [days, load]);

  const k  = data?.kpis;
  const b  = data?.task_breakdown;
  const eff = k?.efficiency_score ?? 0;
  const effS: StatusKey = eff >= 65 ? "star" : eff >= 55 ? "on_track" : eff >= 30 ? "at_risk" : "needs_help";

  const breakdownTiles = b ? [
    { label: "On time",   value: b.on_time,   color: "#0F7B5F" },
    { label: "Submitted", value: b.submitted,  color: "#3B4CCA" },
    { label: "Overdue",   value: b.overdue,    color: "#B3261E" },
    { label: "Stuck",     value: b.stuck,      color: "#B4791F" },
    { label: "Running",   value: b.running,    color: "#64748B" },
  ] : [];

  return (
    <div style={{ padding: "24px 20px", maxWidth: "1100px", margin: "0 auto" }}>

      {/* Header */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{ fontSize: "20px", fontWeight: 800, color: COLOURS.NAVY }}>
          My Team · Performance
        </div>
        {data && (
          <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginTop: "3px" }}>
            {data.department} · {data.kpis.total_employees} members
          </div>
        )}
      </div>

      {/* Period selector */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "18px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>Period:</span>
        {PERIODS.map(p => (
          <button key={p.value} onClick={() => setDays(p.value)} style={{
            fontSize: "12px", fontWeight: days === p.value ? 700 : 400,
            padding: "5px 12px", borderRadius: RADII.PILL, cursor: "pointer",
            background: days === p.value ? COLOURS.NAVY : COLOURS.CARD,
            color: days === p.value ? "#fff" : COLOURS.SLATE,
            border: `1px solid ${days === p.value ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
          }}>{p.label}</button>
        ))}
      </div>

      {error && (
        <div style={{ ...card({ background: "#FCECEA", borderColor: "#B3261E", marginBottom: "16px" }), color: "#B3261E", fontSize: "13px" }}>
          ⚠ {error}
        </div>
      )}

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: "10px", marginBottom: "16px" }}>
        <KpiCard label="Efficiency"  value={loading ? "…" : eff}
          color={STATUS_CONFIG[effS].color} sub={STATUS_CONFIG[effS].label} />
        <KpiCard label="Total tasks"  value={loading ? "…" : k?.total_tasks ?? "—"}
          sub={k?.self_gen_count ? `${k.self_gen_count} self-generated` : undefined} />
        <KpiCard label="On time"      value={loading ? "…" : k?.on_time_count ?? "—"}
          color="#0F7B5F" />
        <KpiCard label="Overdue"      value={loading ? "…" : k?.overdue_count ?? "—"}
          color={(k?.overdue_count ?? 0) > 0 ? "#B3261E" : COLOURS.GREEN} />
        <KpiCard label="Stuck"        value={loading ? "…" : k?.stuck_count ?? "—"}
          color={(k?.stuck_count ?? 0) > 0 ? "#B4791F" : COLOURS.GREEN} />
      </div>

      {/* Task breakdown tiles */}
      {!loading && b && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: "8px", marginBottom: "16px" }}>
          {breakdownTiles.map(t => (
            <div key={t.label} style={card({ padding: "12px 14px", textAlign: "center" })}>
              <div style={{ fontSize: "22px", fontWeight: 700, color: t.color }}>{t.value}</div>
              <div style={{ fontSize: "10px", color: COLOURS.SLATE, marginTop: "3px", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Employee table */}
      <div style={{ ...card(), marginBottom: "16px" }}>
        <SectionTitle title={`${data?.department ?? "Your team"} — All members`} />
        <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "12px", marginTop: "2px" }}>
          Ranked by efficiency · last {days} days
        </div>
        {loading ? <SkeletonRows count={5} /> : (data?.employees?.length ?? 0) === 0 ? (
          <div style={{ padding: "24px 0", textAlign: "center", color: COLOURS.SLATE, fontSize: "13px" }}>
            No task activity in this period.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead><tr>
                <th style={thS}>#</th>
                <th style={thS}>Employee</th>
                <th style={thS}>Dept</th>
                <th style={{ ...thS, textAlign: "right" }}>Tasks</th>
                <th style={{ ...thS, textAlign: "right", color: "#0F7B5F" }}>On time</th>
                <th style={{ ...thS, textAlign: "right", color: "#3B4CCA" }}>Self-gen</th>
                <th style={{ ...thS, textAlign: "right", color: "#B3261E" }}>Overdue</th>
                <th style={{ ...thS, textAlign: "right", color: "#B4791F" }}>Stuck</th>
                <th style={{ ...thS, minWidth: "140px" }}>Efficiency</th>
                <th style={thS}>Status</th>
              </tr></thead>
              <tbody>
                {(data?.employees ?? []).map((e, i) => (
                  <tr key={e.email}
                    onMouseEnter={ev => (ev.currentTarget.style.background = COLOURS.CARD_ALT)}
                    onMouseLeave={ev => (ev.currentTarget.style.background = "")}
                  >
                    <td style={{ ...tdS, width: "32px", color: COLOURS.SLATE }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: "22px", height: "22px", borderRadius: "50%", fontSize: "11px", fontWeight: 700,
                        background: i < 3 ? STATUS_CONFIG.star.bg : COLOURS.CARD_ALT,
                        color: i < 3 ? STATUS_CONFIG.star.color : COLOURS.SLATE,
                      }}>{i + 1}</span>
                    </td>
                    <td style={tdS}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{
                          width: "30px", height: "30px", borderRadius: "50%", flexShrink: 0,
                          background: STATUS_CONFIG[e.status].bg, color: STATUS_CONFIG[e.status].color,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: "11px", fontWeight: 700,
                        }}>{initials(e.emp_name)}</div>
                        <div>
                          <div style={{ fontWeight: 600, color: COLOURS.NAVY }}>{e.emp_name}</div>
                          {e.employee_code && <div style={{ fontSize: "10px", color: COLOURS.SLATE }}>{e.employee_code}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{ ...tdS, fontSize: "12px", color: COLOURS.SLATE }}>{e.department}</td>
                    <td style={tdR}>{e.total_tasks}</td>
                    <td style={{ ...tdR, color: "#0F7B5F" }}>{e.on_time_count}</td>
                    <td style={{ ...tdR, color: "#3B4CCA" }}>{e.self_gen_count}</td>
                    <td style={{ ...tdR, color: e.overdue_count > 0 ? "#B3261E" : COLOURS.SLATE, fontWeight: e.overdue_count > 0 ? 600 : 400 }}>{e.overdue_count}</td>
                    <td style={{ ...tdR, color: e.stuck_count > 0 ? "#B4791F" : COLOURS.SLATE }}>{e.stuck_count}</td>
                    <td style={tdS}><EffBar score={e.efficiency_score} status={e.status} /></td>
                    <td style={tdS}><StatusBadge status={e.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Stuck tasks */}
      {!loading && (data?.stuck_tasks?.length ?? 0) > 0 && (
        <div style={card()}>
          <SectionTitle title="Stuck & Waiting — needs your attention" />
          <div style={{ marginTop: "8px" }}>
            {(data?.stuck_tasks ?? []).map((t, i) => (
              <div key={t.task_id} style={{
                display: "flex", alignItems: "flex-start", gap: "10px",
                padding: "10px 0",
                borderBottom: i < (data?.stuck_tasks?.length ?? 0) - 1 ? `1px solid ${COLOURS.HAIRLINE}` : "none",
              }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#B4791F", marginTop: "5px", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>{t.task_name}</div>
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>
                    {t.emp_name}{t.employee_code ? ` · ${t.employee_code}` : ""}
                    {t.department ? ` · ${t.department}` : ""} · Due {t.due_date}
                  </div>
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>
                    Status: {t.status}{t.stuck_reason ? ` · ${t.stuck_reason}` : ""}
                  </div>
                </div>
                <span style={{
                  fontSize: "11px", fontWeight: 700, color: "#B4791F",
                  background: "#FBF1DE", padding: "2px 8px", borderRadius: "999px",
                  whiteSpace: "nowrap", flexShrink: 0,
                }}>
                  {t.days_overdue > 0 ? `${t.days_overdue}d` : "today"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
