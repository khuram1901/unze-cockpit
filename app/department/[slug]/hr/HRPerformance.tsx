"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../../../lib/supabase";
import { COLOURS, RADII, SectionTitle, SkeletonRows } from "../../../lib/SharedUI";
import EmployeeDetailPanel from "./EmployeeDetailPanel";

// ── Types ─────────────────────────────────────────────────────────────────────

type StatusKey = "star" | "on_track" | "at_risk" | "needs_help";

type CompanyStrip = {
  company:         string;
  efficiency_score:number;
  total_tasks:     number;
  overdue_count:   number;
  stuck_count:     number;
  submitted_count: number;
};

type DeptRow = {
  department:      string;
  company?:        string;
  total_tasks:     number;
  on_time_count:   number;
  overdue_count:   number;
  stuck_count:     number;
  efficiency_score:number;
  status:          StatusKey;
};

type EmpRow = {
  email:           string;
  name:            string;
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

type OverviewData = {
  period_days: number;
  companies:   CompanyStrip[];
  kpis: {
    group_efficiency: number;
    total_overdue:    number;
    total_stuck:      number;
    total_awaiting:   number;
    total_tasks:      number;
  };
  departments: DeptRow[];
  employees:   EmpRow[];
};

type CompanyData = {
  period_days:   number;
  company:       string;
  all_companies: CompanyStrip[];
  kpis: {
    efficiency_score: number;
    total_tasks:      number;
    total_overdue:    number;
    total_stuck:      number;
    total_awaiting:   number;
    total_employees:  number;
  };
  departments:  DeptRow[];
  employees:    EmpRow[];
  stuck_tasks:  StuckTask[];
};

type DeptData = {
  period_days: number;
  department:  string;
  company:     string;
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

// ── Design helpers ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<StatusKey, { icon: string; label: string; color: string; bg: string }> = {
  star:       { icon: "⭐", label: "Star",      color: "#0F7B5F", bg: "#E7F2ED" },
  on_track:   { icon: "✓",  label: "On track",  color: "#0F7B5F", bg: "#E7F2ED" },
  at_risk:    { icon: "⚠",  label: "At risk",   color: "#B4791F", bg: "#FBF1DE" },
  needs_help: { icon: "🚫", label: "Needs help", color: "#B3261E", bg: "#FEE2E2" },
};

function effColor(score: number, overdue = 1): string {
  if (score >= 65 && overdue === 0) return "#0F7B5F";
  if (score >= 55) return "#0F7B5F";
  if (score >= 30) return "#B4791F";
  return "#B3261E";
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");
}

function StatusBadge({ status }: { status: StatusKey }) {
  const c = STATUS_CONFIG[status];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "3px",
      fontSize: "11px", fontWeight: 600, padding: "3px 9px",
      borderRadius: "999px", background: c.bg, color: c.color, whiteSpace: "nowrap",
    }}>{c.icon} {c.label}</span>
  );
}

function EffBar({ score, status }: { score: number; status: StatusKey }) {
  const c = STATUS_CONFIG[status].color;
  const bg = STATUS_CONFIG[status].bg;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: "120px" }}>
      <div style={{ flex: 1, height: "6px", background: "#F1F3F6", borderRadius: "3px" }}>
        <div style={{ width: `${score}%`, height: "100%", background: c, borderRadius: "3px" }} />
      </div>
      <span style={{
        fontSize: "11px", fontWeight: 600, color: c, background: bg,
        padding: "1px 7px", borderRadius: "999px", minWidth: "34px", textAlign: "center",
      }}>{score}</span>
    </div>
  );
}

const thS: React.CSSProperties = {
  padding: "8px 12px", textAlign: "left", color: COLOURS.SLATE,
  fontWeight: 500, fontSize: "11px", textTransform: "uppercase",
  letterSpacing: "0.05em", background: COLOURS.CARD_ALT,
  borderBottom: `1px solid ${COLOURS.HAIRLINE}`, whiteSpace: "nowrap",
};
const tdS: React.CSSProperties = {
  padding: "10px 12px", color: COLOURS.NAVY, fontSize: "13px",
  borderBottom: `1px solid ${COLOURS.HAIRLINE}`, verticalAlign: "middle",
};
const tdR: React.CSSProperties = { ...tdS, textAlign: "right" };

function card(extra?: React.CSSProperties): React.CSSProperties {
  return {
    background: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`,
    borderRadius: RADII.CARD, padding: "18px 20px", ...extra,
  };
}

function KpiCard({ label, value, sub, color }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div style={card()}>
      <div style={{ fontSize: "11px", color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>{label}</div>
      <div style={{ fontSize: "30px", fontWeight: 700, color: color ?? COLOURS.NAVY, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "4px" }}>{sub}</div>}
    </div>
  );
}

// ── Period selector ────────────────────────────────────────────────────────────

const PERIODS = [{ label: "30 days", value: 30 }, { label: "90 days", value: 90 }, { label: "180 days", value: 180 }];

// ── Group view ────────────────────────────────────────────────────────────────

function GroupView({
  data, loading, days, setDays,
  onCompanyClick, onDeptClick, onEmpClick,
}: {
  data: OverviewData | null; loading: boolean; days: number; setDays: (d: number) => void;
  onCompanyClick: (co: string) => void;
  onDeptClick: (dept: string, co: string) => void;
  onEmpClick: (email: string) => void;
}) {
  const k = data?.kpis;

  return (
    <>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "18px", flexWrap: "wrap" }}>
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

      {/* Company health strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: "10px", marginBottom: "18px" }}>
        {loading
          ? [1,2,3,4].map(i => <div key={i} style={{ ...card(), minHeight: "100px", opacity: 0.5 }} />)
          : (data?.companies ?? []).map(co => {
              const s = (co.efficiency_score >= 65 ? "star" : co.efficiency_score >= 55 ? "on_track" : co.efficiency_score >= 30 ? "at_risk" : "needs_help") as StatusKey;
              const c = STATUS_CONFIG[s as StatusKey].color;
              const bg = STATUS_CONFIG[s as StatusKey].bg;
              return (
                <div key={co.company} onClick={() => onCompanyClick(co.company)}
                  style={{ ...card({ cursor: "pointer", transition: "box-shadow .15s" }), position: "relative" }}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,.08)")}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = "none")}
                >
                  <div style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "8px" }}>{co.company}</div>
                  <div style={{ fontSize: "34px", fontWeight: 800, color: c, lineHeight: 1 }}>{co.efficiency_score}</div>
                  <div style={{ fontSize: "10px", color: COLOURS.SLATE, marginTop: "2px", marginBottom: "8px" }}>efficiency</div>
                  <div style={{ height: "4px", background: "#F1F3F6", borderRadius: "2px", marginBottom: "8px" }}>
                    <div style={{ width: `${co.efficiency_score}%`, height: "100%", background: c, borderRadius: "2px" }} />
                  </div>
                  <div style={{ display: "flex", gap: "10px", fontSize: "11px" }}>
                    {co.overdue_count > 0 && <span style={{ color: "#B3261E" }}>⚠ {co.overdue_count} overdue</span>}
                    {co.stuck_count > 0   && <span style={{ color: "#B4791F" }}>🔒 {co.stuck_count} stuck</span>}
                    {co.overdue_count === 0 && co.stuck_count === 0 && <span style={{ color: c }}>✓ clean</span>}
                  </div>
                  <span style={{
                    position: "absolute", top: "12px", right: "12px", fontSize: "10px",
                    color: COLOURS.SLATE, background: COLOURS.CARD_ALT,
                    padding: "2px 7px", borderRadius: "999px", border: `1px solid ${COLOURS.HAIRLINE}`,
                  }}>tap to drill in ↗</span>
                </div>
              );
            })}
      </div>

      {/* Group KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: "10px", marginBottom: "18px" }}>
        <KpiCard label="Group efficiency" value={loading ? "…" : k?.group_efficiency ?? "—"}
          color={loading ? COLOURS.SLATE : effColor(k?.group_efficiency ?? 0, 1)} />
        <KpiCard label="Overdue tasks" value={loading ? "…" : k?.total_overdue ?? "—"}
          color={(k?.total_overdue ?? 0) > 0 ? "#B3261E" : COLOURS.GREEN} />
        <KpiCard label="Stuck / blocked" value={loading ? "…" : k?.total_stuck ?? "—"}
          color={(k?.total_stuck ?? 0) > 0 ? "#B4791F" : COLOURS.GREEN} />
        <KpiCard label="Awaiting sign-off" value={loading ? "…" : k?.total_awaiting ?? "—"}
          color={(k?.total_awaiting ?? 0) > 0 ? "#B4791F" : COLOURS.SLATE} />
      </div>

      {/* Department leaderboard */}
      <div style={{ ...card(), marginBottom: "16px" }}>
        <SectionTitle title="Department leaderboard — all companies" />
        <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "12px", marginTop: "2px" }}>
          Ranked by efficiency score · click a row to drill into that department
        </div>
        {loading ? <SkeletonRows count={6} /> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead><tr>
                <th style={thS}>#</th>
                <th style={thS}>Department</th>
                <th style={thS}>Company</th>
                <th style={{ ...thS, textAlign: "right" }}>Tasks</th>
                <th style={{ ...thS, textAlign: "right" }}>On time</th>
                <th style={{ ...thS, textAlign: "right" }}>Overdue</th>
                <th style={{ ...thS, textAlign: "right" }}>Stuck</th>
                <th style={{ ...thS, minWidth: "140px" }}>Efficiency</th>
                <th style={thS}>Status</th>
              </tr></thead>
              <tbody>
                {(data?.departments ?? []).map((d, i) => (
                  <tr key={`${d.company}-${d.department}`}
                    style={{ cursor: "pointer" }}
                    onClick={() => onDeptClick(d.department, d.company ?? "")}
                    onMouseEnter={e => (e.currentTarget.style.background = COLOURS.CARD_ALT)}
                    onMouseLeave={e => (e.currentTarget.style.background = "")}
                  >
                    <td style={{ ...tdS, color: COLOURS.SLATE, width: "32px" }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: "22px", height: "22px", borderRadius: "50%", fontSize: "11px", fontWeight: 700,
                        background: i < 3 ? STATUS_CONFIG.star.bg : COLOURS.CARD_ALT,
                        color: i < 3 ? STATUS_CONFIG.star.color : COLOURS.SLATE,
                      }}>{i + 1}</span>
                    </td>
                    <td style={{ ...tdS, fontWeight: 600 }}>{d.department}</td>
                    <td style={{ ...tdS, color: COLOURS.SLATE, fontSize: "12px" }}>{d.company}</td>
                    <td style={tdR}>{d.total_tasks}</td>
                    <td style={{ ...tdR, color: "#0F7B5F" }}>{d.on_time_count}</td>
                    <td style={{ ...tdR, color: d.overdue_count > 0 ? "#B3261E" : COLOURS.SLATE, fontWeight: d.overdue_count > 0 ? 600 : 400 }}>{d.overdue_count}</td>
                    <td style={{ ...tdR, color: d.stuck_count > 0 ? "#B4791F" : COLOURS.SLATE }}>{d.stuck_count}</td>
                    <td style={tdS}><EffBar score={d.efficiency_score} status={d.status} /></td>
                    <td style={tdS}><StatusBadge status={d.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Employee rankings */}
      <div style={card()}>
        <SectionTitle title="All employees — ranked by efficiency" />
        <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "12px", marginTop: "2px" }}>
          Click any row to open the employee detail panel
        </div>
        {loading ? <SkeletonRows count={8} /> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead><tr>
                <th style={thS}>#</th>
                <th style={thS}>Employee</th>
                <th style={thS}>Company</th>
                <th style={thS}>Dept</th>
                <th style={{ ...thS, textAlign: "right" }}>Tasks</th>
                <th style={{ ...thS, textAlign: "right", color: "#3B4CCA" }}>Self-gen</th>
                <th style={{ ...thS, textAlign: "right" }}>Overdue</th>
                <th style={{ ...thS, textAlign: "right" }}>Stuck</th>
                <th style={{ ...thS, minWidth: "140px" }}>Efficiency</th>
                <th style={thS}>Status</th>
              </tr></thead>
              <tbody>
                {(data?.employees ?? []).map((e, i) => (
                  <tr key={e.email} style={{ cursor: "pointer" }}
                    onClick={() => onEmpClick(e.email)}
                    onMouseEnter={ev => (ev.currentTarget.style.background = COLOURS.CARD_ALT)}
                    onMouseLeave={ev => (ev.currentTarget.style.background = "")}
                  >
                    <td style={{ ...tdS, color: COLOURS.SLATE, width: "32px" }}>
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
                        }}>{initials(e.name)}</div>
                        <div>
                          <div style={{ fontWeight: 600, color: COLOURS.NAVY }}>{e.name}</div>
                          {e.employee_code && <div style={{ fontSize: "10px", color: COLOURS.SLATE }}>{e.employee_code}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{ ...tdS, fontSize: "12px", color: COLOURS.SLATE }}>{e.company}</td>
                    <td style={{ ...tdS, fontSize: "12px", color: COLOURS.SLATE }}>{e.department}</td>
                    <td style={tdR}>
                      <div style={{ fontWeight: 600 }}>{e.total_tasks}</div>
                      {e.self_gen_count > 0 && <div style={{ fontSize: "10px", color: "#3B4CCA" }}>{e.self_gen_count} self-gen</div>}
                    </td>
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
    </>
  );
}

// ── Company view ───────────────────────────────────────────────────────────────

function CompanyView({
  data, loading, days, setDays,
  onBack, onSwitchCompany, onDeptClick, onEmpClick,
}: {
  data: CompanyData | null; loading: boolean; days: number; setDays: (d: number) => void;
  onBack: () => void; onSwitchCompany: (co: string) => void;
  onDeptClick: (dept: string, co: string) => void;
  onEmpClick: (email: string) => void;
}) {
  const k = data?.kpis;
  const eff = k?.efficiency_score ?? 0;
  const effS = (eff >= 65 ? "star" : eff >= 55 ? "on_track" : eff >= 30 ? "at_risk" : "needs_help") as StatusKey;

  return (
    <>
      {/* Breadcrumb */}
      <div style={{
        display: "flex", alignItems: "center", gap: "8px", marginBottom: "18px",
        padding: "10px 14px", background: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`,
        borderRadius: RADII.CARD, width: "fit-content", fontSize: "13px",
      }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: "5px", fontWeight: 600, color: "#3B4CCA", background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: "13px" }}>← Group</button>
        <span style={{ color: "#94A3B8" }}>›</span>
        <span style={{ fontWeight: 700, color: COLOURS.NAVY }}>{data?.company ?? "…"}</span>
      </div>

      {/* Other companies mini-strip */}
      {(data?.all_companies?.length ?? 0) > 1 && (
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
          {(data?.all_companies ?? []).map(co => {
            const isCurrent = co.company === data?.company;
            const s = (co.efficiency_score >= 65 ? "star" : co.efficiency_score >= 55 ? "on_track" : co.efficiency_score >= 30 ? "at_risk" : "needs_help") as StatusKey;
            const c = STATUS_CONFIG[s as StatusKey].color;
            return (
              <div key={co.company} onClick={() => !isCurrent && onSwitchCompany(co.company)}
                style={{
                  padding: "8px 14px", borderRadius: RADII.CARD, fontSize: "12px", fontWeight: 600,
                  cursor: isCurrent ? "default" : "pointer",
                  background: isCurrent ? COLOURS.NAVY : COLOURS.CARD,
                  color: isCurrent ? "#fff" : COLOURS.NAVY,
                  border: `1px solid ${isCurrent ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
                  opacity: isCurrent ? 1 : 0.75,
                  display: "flex", alignItems: "center", gap: "6px",
                }}
              >
                {co.company}
                <span style={{ fontWeight: 700, color: isCurrent ? "#fff" : c }}>{co.efficiency_score}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Period toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "16px" }}>
        {PERIODS.map(p => (
          <button key={p.value} onClick={() => setDays(p.value)} style={{
            fontSize: "12px", fontWeight: days === p.value ? 700 : 400,
            padding: "4px 10px", borderRadius: RADII.PILL, cursor: "pointer",
            background: days === p.value ? COLOURS.NAVY : COLOURS.CARD,
            color: days === p.value ? "#fff" : COLOURS.SLATE,
            border: `1px solid ${days === p.value ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
          }}>{p.label}</button>
        ))}
      </div>

      {/* Company KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: "10px", marginBottom: "18px" }}>
        <KpiCard label="Efficiency score" value={loading ? "…" : eff} color={STATUS_CONFIG[effS as StatusKey].color} sub={STATUS_CONFIG[effS as StatusKey].label} />
        <KpiCard label="Total tasks" value={loading ? "…" : k?.total_tasks ?? "—"} sub={`last ${days} days`} />
        <KpiCard label="Overdue" value={loading ? "…" : k?.total_overdue ?? "—"} color={(k?.total_overdue ?? 0) > 0 ? "#B3261E" : COLOURS.GREEN} />
        <KpiCard label="Stuck / blocked" value={loading ? "…" : k?.total_stuck ?? "—"} color={(k?.total_stuck ?? 0) > 0 ? "#B4791F" : COLOURS.GREEN} />
        <KpiCard label="Awaiting sign-off" value={loading ? "…" : k?.total_awaiting ?? "—"} color={COLOURS.AMBER ?? "#B4791F"} />
        <KpiCard label="Employees" value={loading ? "…" : k?.total_employees ?? "—"} />
      </div>

      {/* Departments */}
      <div style={{ ...card(), marginBottom: "16px" }}>
        <SectionTitle title={`Departments · ${data?.company ?? "…"}`} />
        <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "12px", marginTop: "2px" }}>Click a row to drill into that department</div>
        {loading ? <SkeletonRows count={4} /> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead><tr>
                <th style={thS}>#</th><th style={thS}>Department</th>
                <th style={{ ...thS, textAlign: "right" }}>Tasks</th>
                <th style={{ ...thS, textAlign: "right" }}>On time</th>
                <th style={{ ...thS, textAlign: "right" }}>Overdue</th>
                <th style={{ ...thS, textAlign: "right" }}>Stuck</th>
                <th style={{ ...thS, minWidth: "140px" }}>Efficiency</th>
                <th style={thS}>Status</th>
              </tr></thead>
              <tbody>
                {(data?.departments ?? []).map((d, i) => (
                  <tr key={d.department} style={{ cursor: "pointer" }}
                    onClick={() => onDeptClick(d.department, data?.company ?? "")}
                    onMouseEnter={e => (e.currentTarget.style.background = COLOURS.CARD_ALT)}
                    onMouseLeave={e => (e.currentTarget.style.background = "")}
                  >
                    <td style={{ ...tdS, color: COLOURS.SLATE, width: "32px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "22px", height: "22px", borderRadius: "50%", fontSize: "11px", fontWeight: 700, background: i < 3 ? STATUS_CONFIG.star.bg : COLOURS.CARD_ALT, color: i < 3 ? STATUS_CONFIG.star.color : COLOURS.SLATE }}>{i + 1}</span>
                    </td>
                    <td style={{ ...tdS, fontWeight: 600 }}>{d.department}</td>
                    <td style={tdR}>{d.total_tasks}</td>
                    <td style={{ ...tdR, color: "#0F7B5F" }}>{d.on_time_count}</td>
                    <td style={{ ...tdR, color: d.overdue_count > 0 ? "#B3261E" : COLOURS.SLATE, fontWeight: d.overdue_count > 0 ? 600 : 400 }}>{d.overdue_count}</td>
                    <td style={{ ...tdR, color: d.stuck_count > 0 ? "#B4791F" : COLOURS.SLATE }}>{d.stuck_count}</td>
                    <td style={tdS}><EffBar score={d.efficiency_score} status={d.status} /></td>
                    <td style={tdS}><StatusBadge status={d.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Employees */}
      <div style={{ ...card(), marginBottom: "16px" }}>
        <SectionTitle title={`Employees · ${data?.company ?? "…"}`} />
        {loading ? <SkeletonRows count={6} /> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead><tr>
                <th style={thS}>#</th><th style={thS}>Employee</th><th style={thS}>Dept</th>
                <th style={{ ...thS, textAlign: "right" }}>Tasks</th>
                <th style={{ ...thS, textAlign: "right", color: "#3B4CCA" }}>Self-gen</th>
                <th style={{ ...thS, textAlign: "right" }}>Overdue</th>
                <th style={{ ...thS, textAlign: "right" }}>Stuck</th>
                <th style={{ ...thS, minWidth: "140px" }}>Efficiency</th>
                <th style={thS}>Status</th>
              </tr></thead>
              <tbody>
                {(data?.employees ?? []).map((e, i) => (
                  <tr key={e.email} style={{ cursor: "pointer" }}
                    onClick={() => onEmpClick(e.email)}
                    onMouseEnter={ev => (ev.currentTarget.style.background = COLOURS.CARD_ALT)}
                    onMouseLeave={ev => (ev.currentTarget.style.background = "")}
                  >
                    <td style={{ ...tdS, width: "32px", color: COLOURS.SLATE }}>
                      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "22px", height: "22px", borderRadius: "50%", fontSize: "11px", fontWeight: 700, background: i < 3 ? STATUS_CONFIG.star.bg : COLOURS.CARD_ALT, color: i < 3 ? STATUS_CONFIG.star.color : COLOURS.SLATE }}>{i + 1}</span>
                    </td>
                    <td style={tdS}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ width: "30px", height: "30px", borderRadius: "50%", flexShrink: 0, background: STATUS_CONFIG[e.status].bg, color: STATUS_CONFIG[e.status].color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700 }}>{initials(e.name)}</div>
                        <div><div style={{ fontWeight: 600 }}>{e.name}</div>{e.employee_code && <div style={{ fontSize: "10px", color: COLOURS.SLATE }}>{e.employee_code}</div>}</div>
                      </div>
                    </td>
                    <td style={{ ...tdS, fontSize: "12px", color: COLOURS.SLATE }}>{e.department}</td>
                    <td style={tdR}>{e.total_tasks}</td>
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
          <SectionTitle title={`Stuck tasks · ${data?.company ?? "…"}`} />
          <div style={{ marginTop: "8px" }}>
            {(data?.stuck_tasks ?? []).map((t, i) => (
              <div key={t.task_id} style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "10px 0", borderBottom: i < (data?.stuck_tasks?.length ?? 0) - 1 ? `1px solid ${COLOURS.HAIRLINE}` : "none" }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#B4791F", marginTop: "5px", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>{t.task_name}</div>
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>
                    {t.emp_name} {t.employee_code ? `· ${t.employee_code}` : ""} {t.department ? `· ${t.department}` : ""}
                  </div>
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Status: {t.status}{t.stuck_reason ? ` · ${t.stuck_reason}` : ""}</div>
                </div>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#B4791F", background: "#FBF1DE", padding: "2px 8px", borderRadius: "999px", whiteSpace: "nowrap", flexShrink: 0 }}>
                  {t.days_overdue > 0 ? `${t.days_overdue}d overdue` : t.due_date}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ── Department view ────────────────────────────────────────────────────────────

function DeptView({
  data, loading, days, setDays,
  company, onBackGroup, onBackCompany, onEmpClick,
}: {
  data: DeptData | null; loading: boolean; days: number; setDays: (d: number) => void;
  company: string;
  onBackGroup: () => void; onBackCompany: () => void;
  onEmpClick: (email: string) => void;
}) {
  const k  = data?.kpis;
  const b  = data?.task_breakdown;
  const eff = k?.efficiency_score ?? 0;
  const effS: StatusKey = eff >= 65 ? "star" : eff >= 55 ? "on_track" : eff >= 30 ? "at_risk" : "needs_help";

  const breakdownTiles = [
    { label: "On time",   value: b?.on_time  ?? 0, color: "#0F7B5F" },
    { label: "Submitted", value: b?.submitted ?? 0, color: "#3B4CCA" },
    { label: "Overdue",   value: b?.overdue   ?? 0, color: "#B3261E" },
    { label: "Stuck",     value: b?.stuck     ?? 0, color: "#B4791F" },
    { label: "Running",   value: b?.running   ?? 0, color: "#64748B" },
  ];

  return (
    <>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "18px", padding: "10px 14px", background: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, width: "fit-content", fontSize: "13px" }}>
        <button onClick={onBackGroup} style={{ fontWeight: 600, color: "#3B4CCA", background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: "13px" }}>← Group</button>
        <span style={{ color: "#94A3B8" }}>›</span>
        <button onClick={onBackCompany} style={{ fontWeight: 600, color: "#3B4CCA", background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: "13px" }}>{company}</button>
        <span style={{ color: "#94A3B8" }}>›</span>
        <span style={{ fontWeight: 700, color: COLOURS.NAVY }}>{data?.department ?? "…"}</span>
      </div>

      {/* Period toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "16px" }}>
        {PERIODS.map(p => (
          <button key={p.value} onClick={() => setDays(p.value)} style={{ fontSize: "12px", fontWeight: days === p.value ? 700 : 400, padding: "4px 10px", borderRadius: RADII.PILL, cursor: "pointer", background: days === p.value ? COLOURS.NAVY : COLOURS.CARD, color: days === p.value ? "#fff" : COLOURS.SLATE, border: `1px solid ${days === p.value ? COLOURS.NAVY : COLOURS.HAIRLINE}` }}>{p.label}</button>
        ))}
      </div>

      {/* Dept KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: "10px", marginBottom: "16px" }}>
        <KpiCard label="Efficiency" value={loading ? "…" : eff} color={STATUS_CONFIG[effS].color} sub={STATUS_CONFIG[effS].label} />
        <KpiCard label="Total tasks" value={loading ? "…" : k?.total_tasks ?? "—"} sub={k?.self_gen_count ? `${k.self_gen_count} self-generated` : undefined} />
        <KpiCard label="Overdue" value={loading ? "…" : k?.overdue_count ?? "—"} color={(k?.overdue_count ?? 0) > 0 ? "#B3261E" : COLOURS.GREEN} />
        <KpiCard label="Stuck" value={loading ? "…" : k?.stuck_count ?? "—"} color={(k?.stuck_count ?? 0) > 0 ? "#B4791F" : COLOURS.GREEN} />
      </div>

      {/* Task breakdown tiles */}
      {!loading && b && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: "8px", marginBottom: "16px" }}>
          {breakdownTiles.map(t => (
            <div key={t.label} style={{ ...card({ padding: "12px 14px", textAlign: "center" }) }}>
              <div style={{ fontSize: "22px", fontWeight: 700, color: t.color }}>{t.value}</div>
              <div style={{ fontSize: "10px", color: COLOURS.SLATE, marginTop: "3px", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Employee table */}
      <div style={{ ...card(), marginBottom: "16px" }}>
        <SectionTitle title={`${data?.department ?? "…"} — All employees`} />
        <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "12px", marginTop: "2px" }}>Click any row to open the employee detail panel</div>
        {loading ? <SkeletonRows count={5} /> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead><tr>
                <th style={thS}>#</th><th style={thS}>Employee</th>
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
                  <tr key={e.email} style={{ cursor: "pointer" }}
                    onClick={() => onEmpClick(e.email)}
                    onMouseEnter={ev => (ev.currentTarget.style.background = COLOURS.CARD_ALT)}
                    onMouseLeave={ev => (ev.currentTarget.style.background = "")}
                  >
                    <td style={{ ...tdS, width: "32px", color: COLOURS.SLATE }}>
                      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "22px", height: "22px", borderRadius: "50%", fontSize: "11px", fontWeight: 700, background: i < 3 ? STATUS_CONFIG.star.bg : COLOURS.CARD_ALT, color: i < 3 ? STATUS_CONFIG.star.color : COLOURS.SLATE }}>{i + 1}</span>
                    </td>
                    <td style={tdS}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ width: "30px", height: "30px", borderRadius: "50%", flexShrink: 0, background: STATUS_CONFIG[e.status].bg, color: STATUS_CONFIG[e.status].color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700 }}>{initials(e.name)}</div>
                        <div><div style={{ fontWeight: 600 }}>{e.name}</div>{e.employee_code && <div style={{ fontSize: "10px", color: COLOURS.SLATE }}>{e.employee_code}</div>}</div>
                      </div>
                    </td>
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
          <SectionTitle title={`Stuck tasks · ${data?.department ?? "…"}`} />
          <div style={{ marginTop: "8px" }}>
            {(data?.stuck_tasks ?? []).map((t, i) => (
              <div key={t.task_id} style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "10px 0", borderBottom: i < (data?.stuck_tasks?.length ?? 0) - 1 ? `1px solid ${COLOURS.HAIRLINE}` : "none" }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#B4791F", marginTop: "5px", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>{t.task_name}</div>
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>{t.emp_name}{t.employee_code ? ` · ${t.employee_code}` : ""} · Due {t.due_date}</div>
                  <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>Status: {t.status}{t.stuck_reason ? ` · ${t.stuck_reason}` : ""}</div>
                </div>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#B4791F", background: "#FBF1DE", padding: "2px 8px", borderRadius: "999px", whiteSpace: "nowrap", flexShrink: 0 }}>
                  {t.days_overdue > 0 ? `${t.days_overdue}d` : "today"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ── Root component ─────────────────────────────────────────────────────────────

type ViewKind = "group" | "company" | "department";

export default function HRPerformance() {
  const [view,            setView]           = useState<ViewKind>("group");
  const [selectedCompany, setSelectedCompany]= useState<string>("");
  const [selectedDept,    setSelectedDept]   = useState<string>("");
  const [days,            setDays]           = useState(90);

  const [overviewData, setOverviewData] = useState<OverviewData | null>(null);
  const [companyData,  setCompanyData]  = useState<CompanyData  | null>(null);
  const [deptData,     setDeptData]     = useState<DeptData     | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);

  // ── Loaders ──

  const loadOverview = useCallback(async (d: number) => {
    setLoading(true); setError(null);
    try {
      const res  = await authFetch(`/api/hr/performance/overview?days=${d}`);
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      setOverviewData(json as OverviewData);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, []);

  const loadCompany = useCallback(async (co: string, d: number) => {
    setLoading(true); setError(null);
    try {
      const res  = await authFetch(`/api/hr/performance/company?company=${encodeURIComponent(co)}&days=${d}`);
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      setCompanyData(json as CompanyData);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, []);

  const loadDept = useCallback(async (dept: string, co: string, d: number) => {
    setLoading(true); setError(null);
    try {
      const res  = await authFetch(`/api/hr/performance/department?department=${encodeURIComponent(dept)}&company=${encodeURIComponent(co)}&days=${d}`);
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      setDeptData(json as DeptData);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, []);

  // ── Effects ──

  useEffect(() => {
    if (view === "group")      loadOverview(days);
  }, [view, days, loadOverview]);

  useEffect(() => {
    if (view === "company" && selectedCompany) loadCompany(selectedCompany, days);
  }, [view, selectedCompany, days, loadCompany]);

  useEffect(() => {
    if (view === "department" && selectedDept && selectedCompany) loadDept(selectedDept, selectedCompany, days);
  }, [view, selectedDept, selectedCompany, days, loadDept]);

  // ── Navigation ──

  function goCompany(co: string) {
    setSelectedCompany(co);
    setCompanyData(null);
    setView("company");
  }

  function goDept(dept: string, co: string) {
    setSelectedDept(dept);
    if (co && co !== selectedCompany) setSelectedCompany(co);
    setDeptData(null);
    setView("department");
  }

  function goGroup() {
    setView("group");
    setSelectedCompany("");
    setSelectedDept("");
  }

  function goBackToCompany() {
    setView("company");
    setSelectedDept("");
    setDeptData(null);
  }

  return (
    <div>
      {error && <div style={{ color: "#B3261E", fontSize: "13px", marginBottom: "16px", padding: "10px 14px", background: "#FEE2E2", borderRadius: RADII.CARD }}>{error}</div>}

      {view === "group" && (
        <GroupView
          data={overviewData} loading={loading} days={days} setDays={setDays}
          onCompanyClick={goCompany} onDeptClick={goDept} onEmpClick={setSelectedEmail}
        />
      )}

      {view === "company" && (
        <CompanyView
          data={companyData} loading={loading} days={days} setDays={setDays}
          onBack={goGroup} onSwitchCompany={goCompany}
          onDeptClick={goDept} onEmpClick={setSelectedEmail}
        />
      )}

      {view === "department" && (
        <DeptView
          data={deptData} loading={loading} days={days} setDays={setDays}
          company={selectedCompany}
          onBackGroup={goGroup} onBackCompany={goBackToCompany}
          onEmpClick={setSelectedEmail}
        />
      )}

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
