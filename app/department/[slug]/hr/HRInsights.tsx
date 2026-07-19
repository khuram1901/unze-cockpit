"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { formatDateUK } from "../../../lib/dateUtils";
import { COLOURS, RADII, CountCard, SectionTitle, SkeletonRows } from "../../../lib/SharedUI";
import { useMobile } from "../../../lib/useMobile";

async function authedFetch(url: string, opts: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers ?? {}), Authorization: `Bearer ${session?.access_token}` },
  });
}

// ── Types ───────────────────────────────────────────────────────────────────────

type StageRow   = { stage: string; count: number };
type DeptPayrow = { department: string; headcount: number; gross_total: number; net_total: number; avg_gross: number };
type PerfDeptRow = { department: string; completed: number; pending: number; overdue: number; avg_rating: number | null };
type TrainDeptRow = { department: string; total: number; attended: number; absent: number; compliance_pct: number };

type RecruitFunnel = {
  open_positions:    number;
  filled_this_month: number;
  total_candidates:  number;
  by_stage:          StageRow[] | null;
  positions_by_status: { status: string; count: number }[] | null;
  long_open:         { position_title: string; flw_company: string; days_open: number }[] | null;
};

type PayrollDept = {
  month:          string | null;
  total_gross:    number;
  total_net:      number;
  head_count:     number;
  by_department:  DeptPayrow[] | null;
};

type PerformanceSummary = {
  total:       number;
  pending:     number;
  overdue:     number;
  completed:   number;
  avg_rating:  number | null;
  pending_list: { employee_name: string; department: string; review_type: string; due_date: string | null; reviewer_name: string | null; days_overdue: number }[] | null;
  by_department: PerfDeptRow[] | null;
};

type TrainingCompliance = {
  total_records:  number;
  attended:       number;
  absent:         number;
  pending:        number;
  compliance_pct: number;
  by_department:  TrainDeptRow[] | null;
  recent_sessions: { training_title: string; training_date: string; training_type: string; attendees: number }[] | null;
};

type Disciplinary = {
  open_count:      number;
  total_this_year: number;
  by_type:         { notice_type: string; count: number }[] | null;
  open_cases:      { employee_name: string; department: string; notice_type: string; issue_date: string; response_due_date: string | null; status: string }[] | null;
};

type Loans = {
  active_count:      number;
  total_outstanding: number;
  total_principal:   number;
  monthly_recovery:  number;
  by_type:           { loan_type: string; count: number; outstanding: number }[] | null;
  active_loans:      { employee_name: string; department: string; loan_type: string; outstanding_amount: number; monthly_deduction: number; expected_end_date: string | null }[] | null;
};

type InsightsPayload = {
  configured:          boolean;
  sync_log:            { module: string; synced_at: string; status: string; records_synced: number; error_message?: string | null }[] | null;
  recruitment_funnel:  RecruitFunnel | null;
  payroll_dept:        PayrollDept | null;
  performance:         PerformanceSummary | null;
  training_compliance: TrainingCompliance | null;
  disciplinary:        Disciplinary | null;
  loans:               Loans | null;
};

// ── Helpers ─────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function pct(n: number | null): string {
  return n == null ? "—" : `${n}%`;
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: COLOURS.CARD,
      border: `1px solid ${COLOURS.HAIRLINE}`,
      borderRadius: RADII.CARD,
      padding: "20px",
      ...style,
    }}>
      {children}
    </div>
  );
}

function LastSynced({ log, module }: { log: InsightsPayload["sync_log"]; module: string }) {
  const entry = log?.find(l => l.module === module);
  if (!entry) return <span style={{ fontSize: "11px", color: COLOURS.SLATE }}>Not synced yet</span>;
  const ok = entry.status === "success";
  return (
    <span style={{ fontSize: "11px", color: ok ? COLOURS.SLATE : COLOURS.RED }}>
      {ok ? `Last sync: ${formatDateUK(entry.synced_at.slice(0, 10))} · ${entry.records_synced} records` : `Sync error · ${entry.error_message ?? ""}`}
    </span>
  );
}

// ── Horizontal bar component ─────────────────────────────────────────────────────
function HBar({ label, value, max, color, subtitle }: {
  label:    string;
  value:    number;
  max:      number;
  color?:   string;
  subtitle?: string;
}) {
  const pctW = max === 0 ? 0 : Math.max(2, (value / max) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
      <div style={{ width: "150px", fontSize: "12px", color: COLOURS.SLATE, flexShrink: 0, textAlign: "right", lineHeight: 1.3 }}>
        {label}
        {subtitle && <div style={{ fontSize: "10px", opacity: 0.7 }}>{subtitle}</div>}
      </div>
      <div style={{ flex: 1, background: COLOURS.HAIRLINE, borderRadius: "4px", height: "10px" }}>
        <div style={{ width: `${pctW}%`, background: color ?? COLOURS.NAVY, borderRadius: "4px", height: "10px", transition: "width 0.4s ease" }} />
      </div>
      <div style={{ width: "60px", fontSize: "12px", color: COLOURS.NAVY, fontWeight: 600, flexShrink: 0 }}>
        {fmt(value)}
      </div>
    </div>
  );
}

// ── Recruitment funnel section ────────────────────────────────────────────────────
function RecruitmentSection({ data, loading, syncLog }: { data: RecruitFunnel | null; loading: boolean; syncLog: InsightsPayload["sync_log"] }) {
  const STAGE_COLOURS: Record<string, string> = {
    Applied:        COLOURS.SLATE,
    Screening:      "#64748B",
    Shortlisted:    COLOURS.AMBER,
    Interviewed:    "#2563EB",
    Offer:          "#7C3AED",
    "Offer Accepted": COLOURS.GREEN,
    Hired:          COLOURS.GREEN,
    Rejected:       COLOURS.RED,
  };

  const stages = data?.by_stage ?? [];
  const maxStage = Math.max(...stages.map(s => s.count), 1);

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <SectionTitle title="Recruitment Pipeline" />
        <LastSynced log={syncLog} module="recruitment" />
      </div>

      {loading ? <SkeletonRows count={5} /> : (
        <>
          {/* KPI strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: "20px" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "28px", fontWeight: 700, color: COLOURS.AMBER }}>{data?.open_positions ?? "—"}</div>
              <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>Open Positions</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "28px", fontWeight: 700, color: COLOURS.NAVY }}>{data?.total_candidates ?? "—"}</div>
              <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>Total Candidates</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "28px", fontWeight: 700, color: COLOURS.GREEN }}>{data?.filled_this_month ?? "—"}</div>
              <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>Filled This Month</div>
            </div>
          </div>

          {/* Funnel */}
          {stages.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              {stages.filter(s => s.stage !== "Rejected").map(s => (
                <HBar
                  key={s.stage}
                  label={s.stage}
                  value={s.count}
                  max={maxStage}
                  color={STAGE_COLOURS[s.stage] ?? COLOURS.SLATE}
                />
              ))}
              {stages.filter(s => s.stage === "Rejected").map(s => (
                <HBar key="Rejected" label="Rejected" value={s.count} max={maxStage} color={COLOURS.RED} />
              ))}
            </div>
          )}

          {/* Long open alert */}
          {(data?.long_open ?? []).length > 0 && (
            <div style={{
              background: `${COLOURS.AMBER}12`, border: `1px solid ${COLOURS.AMBER}55`,
              borderLeft: `3px solid ${COLOURS.AMBER}`, borderRadius: RADII.SM, padding: "10px 12px",
            }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.AMBER, marginBottom: "6px" }}>
                ⚠ POSITIONS OPEN 45+ DAYS
              </div>
              {(data?.long_open ?? []).map((p, i) => (
                <div key={i} style={{ fontSize: "12px", color: COLOURS.NAVY, marginBottom: "3px" }}>
                  {p.position_title} · {p.flw_company} · <span style={{ color: COLOURS.RED, fontWeight: 600 }}>{p.days_open}d</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ── Payroll by department section ─────────────────────────────────────────────────
function PayrollSection({ data, loading, syncLog }: { data: PayrollDept | null; loading: boolean; syncLog: InsightsPayload["sync_log"] }) {
  const depts = data?.by_department ?? [];
  const maxGross = Math.max(...depts.map(d => d.gross_total), 1);

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <SectionTitle title={`Payroll by Department${data?.month ? ` · ${data.month.slice(0, 7)}` : ""}`} />
        <LastSynced log={syncLog} module="payroll" />
      </div>

      {loading ? <SkeletonRows count={6} /> : !data?.month ? (
        <div style={{ color: COLOURS.SLATE, fontSize: "13px", textAlign: "center", padding: "24px" }}>
          No processed payroll data yet. Will populate once FlowHCM payroll is run for the month.
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: "20px" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "22px", fontWeight: 700, color: COLOURS.NAVY }}>PKR {fmt(data.total_gross)}</div>
              <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>Total Gross</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "22px", fontWeight: 700, color: COLOURS.GREEN }}>PKR {fmt(data.total_net)}</div>
              <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>Total Net</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "22px", fontWeight: 700, color: COLOURS.SLATE }}>{data.head_count}</div>
              <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>Employees</div>
            </div>
          </div>

          {depts.map(d => (
            <HBar
              key={d.department}
              label={d.department || "—"}
              value={d.gross_total}
              max={maxGross}
              subtitle={`${d.headcount} employees · avg PKR ${fmt(d.avg_gross)}`}
            />
          ))}
        </>
      )}
    </Card>
  );
}

// ── Performance reviews section ───────────────────────────────────────────────────
function PerformanceSection({ data, loading, syncLog }: { data: PerformanceSummary | null; loading: boolean; syncLog: InsightsPayload["sync_log"] }) {
  const [showAll, setShowAll] = useState(false);
  const pending = data?.pending_list ?? [];
  const shown   = showAll ? pending : pending.slice(0, 5);

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <SectionTitle title="Performance Reviews" />
        <LastSynced log={syncLog} module="performance" />
      </div>

      {loading ? <SkeletonRows count={5} /> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginBottom: "20px" }}>
            <CountCard label="Pending"   value={data?.pending   ?? "—"} color={COLOURS.AMBER} />
            <CountCard label="Overdue"   value={data?.overdue   ?? "—"} color={COLOURS.RED} />
            <CountCard label="Completed" value={data?.completed ?? "—"} color={COLOURS.GREEN} />
            <CountCard label="Avg Rating" value={data?.avg_rating != null ? `${data.avg_rating}/5` : "—"} color={COLOURS.NAVY} />
          </div>

          {/* Pending list */}
          {shown.length > 0 && (
            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
                Pending / Overdue
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                      {["Employee", "Department", "Type", "Due", "Reviewer", "Days Over"].map(h => (
                        <th key={h} style={{ padding: "5px 8px", textAlign: "left", color: COLOURS.SLATE, fontWeight: 500, fontSize: "10.5px", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                        <td style={{ padding: "7px 8px", color: COLOURS.NAVY, fontWeight: 500 }}>{r.employee_name}</td>
                        <td style={{ padding: "7px 8px", color: COLOURS.SLATE }}>{r.department}</td>
                        <td style={{ padding: "7px 8px", color: COLOURS.SLATE }}>{r.review_type}</td>
                        <td style={{ padding: "7px 8px", color: COLOURS.NAVY }}>{r.due_date ? formatDateUK(r.due_date) : "—"}</td>
                        <td style={{ padding: "7px 8px", color: COLOURS.SLATE }}>{r.reviewer_name ?? "—"}</td>
                        <td style={{ padding: "7px 8px", color: r.days_overdue > 0 ? COLOURS.RED : COLOURS.GREEN, fontWeight: 600 }}>
                          {r.days_overdue > 0 ? `${r.days_overdue}d` : "On time"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pending.length > 5 && (
                <button
                  onClick={() => setShowAll(!showAll)}
                  style={{ marginTop: "8px", fontSize: "12px", color: COLOURS.NAVY, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                >
                  {showAll ? "Show less" : `Show all ${pending.length}`}
                </button>
              )}
            </div>
          )}

          {/* By department */}
          {(data?.by_department ?? []).length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
                By Department
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                    {["Department", "Completed", "Pending", "Overdue", "Avg Rating"].map(h => (
                      <th key={h} style={{ padding: "5px 8px", textAlign: "left", color: COLOURS.SLATE, fontWeight: 500, fontSize: "10.5px", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data?.by_department ?? []).map((d, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                      <td style={{ padding: "7px 8px", color: COLOURS.NAVY, fontWeight: 500 }}>{d.department}</td>
                      <td style={{ padding: "7px 8px", color: COLOURS.GREEN, fontWeight: 600 }}>{d.completed}</td>
                      <td style={{ padding: "7px 8px", color: COLOURS.AMBER, fontWeight: 600 }}>{d.pending}</td>
                      <td style={{ padding: "7px 8px", color: d.overdue > 0 ? COLOURS.RED : COLOURS.SLATE, fontWeight: d.overdue > 0 ? 700 : 400 }}>{d.overdue}</td>
                      <td style={{ padding: "7px 8px", color: COLOURS.NAVY }}>{d.avg_rating != null ? `${d.avg_rating}/5` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(!data || data.total === 0) && (
            <div style={{ color: COLOURS.SLATE, fontSize: "13px", textAlign: "center", padding: "24px" }}>
              No performance review data synced yet.
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ── Training compliance section ───────────────────────────────────────────────────
function TrainingSection({ data, loading, syncLog }: { data: TrainingCompliance | null; loading: boolean; syncLog: InsightsPayload["sync_log"] }) {
  const depts = data?.by_department ?? [];
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <SectionTitle title="Training Compliance" />
        <LastSynced log={syncLog} module="training_records" />
      </div>

      {loading ? <SkeletonRows count={5} /> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginBottom: "20px" }}>
            <CountCard label="Overall" value={pct(data?.compliance_pct ?? null)} color={COLOURS.NAVY} />
            <CountCard label="Attended"  value={data?.attended ?? "—"} color={COLOURS.GREEN} />
            <CountCard label="Absent"    value={data?.absent   ?? "—"} color={COLOURS.RED} />
            <CountCard label="Pending"   value={data?.pending  ?? "—"} color={COLOURS.AMBER} />
          </div>

          {/* Department compliance bars */}
          {depts.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              {depts.map(d => (
                <div key={d.department} style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                  <div style={{ width: "150px", fontSize: "12px", color: COLOURS.SLATE, flexShrink: 0, textAlign: "right", lineHeight: 1.3 }}>
                    {d.department || "—"}
                    <div style={{ fontSize: "10px", opacity: 0.7 }}>{d.total} sessions</div>
                  </div>
                  <div style={{ flex: 1, background: COLOURS.HAIRLINE, borderRadius: "4px", height: "10px" }}>
                    <div style={{
                      width: `${Math.max(2, d.compliance_pct ?? 0)}%`,
                      background: (d.compliance_pct ?? 0) >= 80 ? COLOURS.GREEN : (d.compliance_pct ?? 0) >= 50 ? COLOURS.AMBER : COLOURS.RED,
                      borderRadius: "4px", height: "10px", transition: "width 0.4s ease",
                    }} />
                  </div>
                  <div style={{ width: "40px", fontSize: "12px", color: COLOURS.NAVY, fontWeight: 600 }}>
                    {pct(d.compliance_pct)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Recent sessions */}
          {(data?.recent_sessions ?? []).length > 0 && (
            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
                Recent Training Sessions (90 days)
              </div>
              {(data?.recent_sessions ?? []).map((s, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: i < (data?.recent_sessions ?? []).length - 1 ? `1px solid ${COLOURS.HAIRLINE}` : "none" }}>
                  <div>
                    <div style={{ fontSize: "12px", color: COLOURS.NAVY, fontWeight: 500 }}>{s.training_title}</div>
                    <div style={{ fontSize: "11px", color: COLOURS.SLATE }}>{s.training_type} · {s.training_date ? formatDateUK(s.training_date) : "—"}</div>
                  </div>
                  <div style={{ fontSize: "12px", color: COLOURS.SLATE, flexShrink: 0 }}>{s.attendees} attended</div>
                </div>
              ))}
            </div>
          )}

          {(!data || data.total_records === 0) && (
            <div style={{ color: COLOURS.SLATE, fontSize: "13px", textAlign: "center", padding: "24px" }}>
              No training records synced yet.
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ── Disciplinary section ─────────────────────────────────────────────────────────
function DisciplinarySection({ data, loading, syncLog }: { data: Disciplinary | null; loading: boolean; syncLog: InsightsPayload["sync_log"] }) {
  const NOTICE_COLOURS: Record<string, string> = {
    "Verbal Warning":   COLOURS.AMBER,
    "Written Warning":  COLOURS.AMBER,
    "Show Cause":       "#7C3AED",
    "Suspension":       COLOURS.RED,
    "Termination":      COLOURS.RED,
  };

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <SectionTitle title="Disciplinary Cases" />
        <LastSynced log={syncLog} module="disciplinary" />
      </div>

      {loading ? <SkeletonRows count={4} /> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "20px" }}>
            <CountCard label="Open Cases"    value={data?.open_count      ?? "—"} color={COLOURS.RED} />
            <CountCard label="This Year"     value={data?.total_this_year ?? "—"} color={COLOURS.SLATE} />
          </div>

          {/* By type */}
          {(data?.by_type ?? []).length > 0 && (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
              {(data?.by_type ?? []).map((t, i) => {
                const c = NOTICE_COLOURS[t.notice_type] ?? COLOURS.SLATE;
                return (
                  <span key={i} style={{
                    display: "inline-flex", alignItems: "center", gap: "5px",
                    padding: "4px 10px", borderRadius: RADII.PILL, fontSize: "12px",
                    background: c + "18", color: c, fontWeight: 600, border: `1px solid ${c}44`,
                  }}>
                    {t.notice_type} · {t.count}
                  </span>
                );
              })}
            </div>
          )}

          {/* Open cases list */}
          {(data?.open_cases ?? []).length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                    {["Employee", "Department", "Type", "Issued", "Response Due", "Status"].map(h => (
                      <th key={h} style={{ padding: "5px 8px", textAlign: "left", color: COLOURS.SLATE, fontWeight: 500, fontSize: "10.5px", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data?.open_cases ?? []).map((c, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                      <td style={{ padding: "7px 8px", color: COLOURS.NAVY, fontWeight: 500 }}>{c.employee_name}</td>
                      <td style={{ padding: "7px 8px", color: COLOURS.SLATE }}>{c.department}</td>
                      <td style={{ padding: "7px 8px" }}>
                        <span style={{ color: NOTICE_COLOURS[c.notice_type] ?? COLOURS.SLATE, fontWeight: 600, fontSize: "11px" }}>{c.notice_type}</span>
                      </td>
                      <td style={{ padding: "7px 8px", color: COLOURS.NAVY }}>{c.issue_date ? formatDateUK(c.issue_date) : "—"}</td>
                      <td style={{ padding: "7px 8px", color: COLOURS.SLATE }}>{c.response_due_date ? formatDateUK(c.response_due_date) : "—"}</td>
                      <td style={{ padding: "7px 8px", color: COLOURS.AMBER, fontWeight: 500 }}>{c.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ color: COLOURS.SLATE, fontSize: "13px", textAlign: "center", padding: "16px" }}>
              {data ? "No open disciplinary cases." : "No disciplinary data synced yet."}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ── Loans section ────────────────────────────────────────────────────────────────
function LoansSection({ data, loading, syncLog }: { data: Loans | null; loading: boolean; syncLog: InsightsPayload["sync_log"] }) {
  const [showAll, setShowAll] = useState(false);
  const loans = data?.active_loans ?? [];
  const shown = showAll ? loans : loans.slice(0, 6);

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <SectionTitle title="Employee Loans" />
        <LastSynced log={syncLog} module="loans" />
      </div>

      {loading ? <SkeletonRows count={4} /> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px", marginBottom: "20px" }}>
            <CountCard label="Active Loans"     value={data?.active_count      ?? "—"} color={COLOURS.NAVY} />
            <CountCard label="Monthly Recovery" value={data?.monthly_recovery != null ? `PKR ${fmt(data.monthly_recovery)}` : "—"} color={COLOURS.GREEN} />
          </div>

          {/* Outstanding total */}
          {data?.total_outstanding != null && data.total_outstanding > 0 && (
            <div style={{ marginBottom: "16px", padding: "10px 14px", background: COLOURS.HAIRLINE, borderRadius: RADII.SM }}>
              <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginBottom: "2px" }}>Total Outstanding</div>
              <div style={{ fontSize: "20px", fontWeight: 700, color: COLOURS.RED }}>PKR {fmt(data.total_outstanding)}</div>
            </div>
          )}

          {/* By type */}
          {(data?.by_type ?? []).length > 0 && (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
              {(data?.by_type ?? []).map((t, i) => (
                <span key={i} style={{
                  padding: "4px 10px", borderRadius: RADII.PILL, fontSize: "12px",
                  background: COLOURS.NAVY + "12", color: COLOURS.NAVY, fontWeight: 600,
                }}>
                  {t.loan_type} · {t.count} · PKR {fmt(t.outstanding)}
                </span>
              ))}
            </div>
          )}

          {/* Active loans table */}
          {shown.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                    {["Employee", "Department", "Type", "Outstanding", "Monthly", "End Date"].map(h => (
                      <th key={h} style={{ padding: "5px 8px", textAlign: "left", color: COLOURS.SLATE, fontWeight: 500, fontSize: "10.5px", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((l, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                      <td style={{ padding: "7px 8px", color: COLOURS.NAVY, fontWeight: 500 }}>{l.employee_name}</td>
                      <td style={{ padding: "7px 8px", color: COLOURS.SLATE }}>{l.department}</td>
                      <td style={{ padding: "7px 8px", color: COLOURS.SLATE }}>{l.loan_type}</td>
                      <td style={{ padding: "7px 8px", color: COLOURS.RED, fontWeight: 600 }}>PKR {fmt(l.outstanding_amount)}</td>
                      <td style={{ padding: "7px 8px", color: COLOURS.NAVY }}>PKR {fmt(l.monthly_deduction)}</td>
                      <td style={{ padding: "7px 8px", color: COLOURS.SLATE }}>{l.expected_end_date ? formatDateUK(l.expected_end_date) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {loans.length > 6 && (
                <button
                  onClick={() => setShowAll(!showAll)}
                  style={{ marginTop: "8px", fontSize: "12px", color: COLOURS.NAVY, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                >
                  {showAll ? "Show less" : `Show all ${loans.length}`}
                </button>
              )}
            </div>
          ) : (
            <div style={{ color: COLOURS.SLATE, fontSize: "13px", textAlign: "center", padding: "16px" }}>
              {data ? "No active loans." : "No loan data synced yet."}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ── Main component ───────────────────────────────────────────────────────────────
export default function HRInsights() {
  const isMobile = useMobile();
  const [data,    setData]    = useState<InsightsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await authedFetch("/api/flowhcm/status");
      const json = await res.json() as InsightsPayload;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await authedFetch("/api/flowhcm/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modules: ["payroll", "performance", "training_records", "disciplinary", "loans", "recruitment"] }),
      });
      await load();
    } finally {
      setSyncing(false);
    }
  };

  const grid2: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
    gap: "16px",
    marginBottom: "16px",
  };

  const syncLog = data?.sync_log ?? null;

  return (
    <div>
      {/* Not-connected banner */}
      {data && !data.configured && (
        <div style={{
          background: `${COLOURS.AMBER}18`, border: `1px solid ${COLOURS.AMBER}`,
          borderRadius: RADII.CARD, padding: "16px 20px", marginBottom: "20px",
        }}>
          <div style={{ fontWeight: 600, color: COLOURS.NAVY, marginBottom: "4px" }}>FlowHCM not yet connected</div>
          <div style={{ color: COLOURS.SLATE, fontSize: "13px" }}>
            Add <code>FLOWHCM_TOKEN</code> + <code>FLOWHCM_API_URL</code> in Vercel environment variables to activate all analytics below.
          </div>
        </div>
      )}

      {/* Top bar with sync button */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>
          Live data from FlowHCM · read-only · synced every 2 hours
        </div>
        {data?.configured && (
          <button
            onClick={handleSync}
            disabled={syncing}
            style={{
              padding: "6px 16px", fontSize: "12px", fontWeight: 600,
              background: syncing ? COLOURS.HAIRLINE : COLOURS.NAVY,
              color: syncing ? COLOURS.SLATE : "#fff",
              border: "none", borderRadius: "6px",
              cursor: syncing ? "not-allowed" : "pointer",
            }}
          >
            {syncing ? "Syncing…" : "↻ Sync All"}
          </button>
        )}
      </div>

      {error && <div style={{ color: COLOURS.RED, fontSize: "13px", marginBottom: "16px" }}>{error}</div>}

      {/* Row 1: Recruitment + Payroll */}
      <div style={grid2}>
        <RecruitmentSection data={data?.recruitment_funnel ?? null} loading={loading} syncLog={syncLog} />
        <PayrollSection     data={data?.payroll_dept      ?? null} loading={loading} syncLog={syncLog} />
      </div>

      {/* Row 2: Performance + Training */}
      <div style={grid2}>
        <PerformanceSection data={data?.performance         ?? null} loading={loading} syncLog={syncLog} />
        <TrainingSection    data={data?.training_compliance ?? null} loading={loading} syncLog={syncLog} />
      </div>

      {/* Row 3: Disciplinary + Loans */}
      <div style={grid2}>
        <DisciplinarySection data={data?.disciplinary ?? null} loading={loading} syncLog={syncLog} />
        <LoansSection        data={data?.loans        ?? null} loading={loading} syncLog={syncLog} />
      </div>
    </div>
  );
}
