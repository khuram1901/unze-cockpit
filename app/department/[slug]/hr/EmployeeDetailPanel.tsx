"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../../../lib/supabase";
import { COLOURS, RADII } from "../../../lib/SharedUI";
import { formatDateUK } from "../../../lib/dateUtils";

// ── Types ─────────────────────────────────────────────────────────────────────

type Summary = {
  total:           number;
  completed:       number;
  on_time:         number;
  late:            number;
  overdue:         number;
  employee_credit: number;
  running:         number;
  excluded:        number;
  completion_pct:  number | null;
  ontime_pct:      number | null;
};

type WeekRow = {
  week_start: string;
  total:      number;
  completed:  number;
  on_time:    number;
  overdue:    number;
  submitted:  number;
};

type TaskRow = {
  id:            string;
  title:         string;
  status:        string;
  perf_cat:      string;
  due_date:      string;
  assigned_date: string;
  completed_at:  string | null;
  department:    string | null;
  company_name:  string | null;
};

type EmpDetail = {
  email:        string;
  name:         string;
  department:   string | null;
  period_days:  number;
  summary:      Summary;
  weekly_trend: WeekRow[];
  categories:   Record<string, number>;
  tasks:        TaskRow[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function ragColor(pct: number | null, field: "completion" | "ontime"): string {
  if (pct === null) return COLOURS.SLATE;
  const [green, amber] = field === "completion" ? [60, 30] : [50, 25];
  if (pct >= green) return COLOURS.GREEN;
  if (pct >= amber) return COLOURS.AMBER;
  return COLOURS.RED;
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");
}

function weekLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

const CAT_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  on_time:         { label: "On time",   color: COLOURS.GREEN, bg: COLOURS.SUCCESS_SOFT },
  late:            { label: "Late",      color: COLOURS.AMBER, bg: COLOURS.WARNING_SOFT },
  overdue:         { label: "Overdue",   color: COLOURS.RED,   bg: COLOURS.DANGER_SOFT  },
  employee_credit: { label: "Submitted", color: "#6366F1",     bg: "#EEF2FF"            },
  running:         { label: "In progress", color: COLOURS.SLATE, bg: COLOURS.TRACK     },
  excluded:        { label: "Cancelled", color: COLOURS.SLATE, bg: COLOURS.TRACK       },
};

const STATUS_DOT: Record<string, string> = {
  on_time:         COLOURS.GREEN,
  late:            COLOURS.AMBER,
  overdue:         COLOURS.RED,
  employee_credit: "#6366F1",
  running:         COLOURS.SLATE,
  excluded:        COLOURS.SLATE,
};

// ── Mini bar chart ─────────────────────────────────────────────────────────────

function WeeklyChart({ weeks }: { weeks: WeekRow[] }) {
  if (!weeks.length) {
    return <div style={{ color: COLOURS.SLATE, fontSize: "13px", padding: "20px 0" }}>No weekly data.</div>;
  }
  const maxTotal = Math.max(...weeks.map(w => w.total), 1);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "6px", height: "100px" }}>
        {weeks.map((w, i) => {
          const heightPct = w.total / maxTotal;
          const onTimePct = w.total > 0 ? w.on_time / w.total : 0;
          const latePct   = w.total > 0 ? w.late    / w.total : 0; // not directly in WeekRow but computed
          const overduePct = w.total > 0 ? w.overdue / w.total : 0;
          const completedPct = w.total > 0 ? w.completed / w.total : 0;

          return (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
              {/* Stacked bar */}
              <div style={{
                width: "100%", height: `${Math.round(heightPct * 80)}px`,
                minHeight: w.total > 0 ? "6px" : "0",
                borderRadius: "4px 4px 0 0", overflow: "hidden",
                display: "flex", flexDirection: "column-reverse",
                background: COLOURS.TRACK,
              }}>
                {/* overdue (red) at top */}
                {w.overdue > 0 && (
                  <div style={{ width: "100%", height: `${overduePct * 100}%`, background: COLOURS.RED, flexShrink: 0 }} />
                )}
                {/* completed (green) */}
                {w.completed > 0 && (
                  <div style={{ width: "100%", height: `${completedPct * 100}%`, background: COLOURS.GREEN, flexShrink: 0 }} />
                )}
              </div>
              <span style={{ fontSize: "10px", color: COLOURS.SLATE, whiteSpace: "nowrap" }}>{weekLabel(w.week_start)}</span>
            </div>
          );
        })}
      </div>
      {/* Legend */}
      <div style={{ display: "flex", gap: "14px", marginTop: "8px" }}>
        {[{ color: COLOURS.GREEN, label: "Completed" }, { color: COLOURS.RED, label: "Overdue" }, { color: COLOURS.TRACK, label: "Other" }].map(l => (
          <div key={l.label} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <div style={{ width: "10px", height: "10px", borderRadius: "2px", background: l.color, border: `1px solid ${COLOURS.HAIRLINE}` }} />
            <span style={{ fontSize: "11px", color: COLOURS.SLATE }}>{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Engagement score ────────────────────────────────────────────────────────────
// Engagement = how proactively the employee manages their workload.
// Score: submitted tasks (positive) minus overdue (negative), as a % of total.

function EngagementBar({ summary }: { summary: Summary }) {
  const { total, employee_credit, overdue, running } = summary;
  if (total === 0) return null;

  // Engagement = (employee_credit + completed on_time) / total — penalise overdue
  const proactive = employee_credit + summary.on_time;
  const score     = Math.max(0, Math.min(100, Math.round((proactive / total) * 100)));
  const color     = score >= 60 ? COLOURS.GREEN : score >= 30 ? COLOURS.AMBER : COLOURS.RED;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
        <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>Engagement score</span>
        <span style={{ fontSize: "13px", fontWeight: 700, color }}>{score}%</span>
      </div>
      <div style={{ height: "8px", background: COLOURS.TRACK, borderRadius: "4px", overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", background: color, borderRadius: "4px", transition: "width 0.4s ease" }} />
      </div>
      <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "4px" }}>
        {employee_credit > 0 && <span>{employee_credit} submitted for review · </span>}
        {overdue > 0 && <span style={{ color: COLOURS.RED }}>{overdue} overdue · </span>}
        {running > 0 && <span>{running} in progress</span>}
      </div>
    </div>
  );
}

// ── Task list ───────────────────────────────────────────────────────────────────

function TaskList({ tasks }: { tasks: TaskRow[] }) {
  const [filter, setFilter] = useState<string>("all");

  const categories = Array.from(new Set(tasks.map(t => t.perf_cat)));
  const filtered   = filter === "all" ? tasks : tasks.filter(t => t.perf_cat === filter);

  const pillStyle = (active: boolean): React.CSSProperties => ({
    padding: "4px 12px", borderRadius: RADII.PILL, fontSize: "11px", fontWeight: 500,
    cursor: "pointer", border: `1px solid ${active ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
    background: active ? COLOURS.NAVY : COLOURS.CARD, color: active ? "#fff" : COLOURS.SLATE,
  });

  return (
    <div>
      {/* Filter pills */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}>
        <button style={pillStyle(filter === "all")} onClick={() => setFilter("all")}>All ({tasks.length})</button>
        {categories.map(cat => {
          const meta = CAT_LABELS[cat] ?? { label: cat, color: COLOURS.SLATE, bg: COLOURS.TRACK };
          const count = tasks.filter(t => t.perf_cat === cat).length;
          return (
            <button key={cat} style={pillStyle(filter === cat)} onClick={() => setFilter(cat)}>
              {meta.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Task rows */}
      <div style={{ maxHeight: "300px", overflowY: "auto" }}>
        {filtered.length === 0 && (
          <div style={{ color: COLOURS.SLATE, fontSize: "13px", padding: "12px 0" }}>No tasks in this category.</div>
        )}
        {filtered.map((t, i) => {
          const isLast = i === filtered.length - 1;
          const dot    = STATUS_DOT[t.perf_cat] ?? COLOURS.SLATE;
          const meta   = CAT_LABELS[t.perf_cat];
          return (
            <div key={t.id} style={{
              display: "flex", alignItems: "flex-start", gap: "10px", padding: "9px 0",
              borderBottom: isLast ? "none" : `1px solid ${COLOURS.HAIRLINE}`,
            }}>
              <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: dot, marginTop: "4px", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13px", color: COLOURS.NAVY, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.title ?? "(Untitled)"}
                </div>
                <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "2px" }}>
                  Due {formatDateUK(t.due_date)}
                  {t.completed_at && <span style={{ color: COLOURS.GREEN }}> · Done {formatDateUK(t.completed_at)}</span>}
                  {t.department && <span> · {t.department}</span>}
                </div>
              </div>
              {meta && (
                <div style={{
                  padding: "2px 8px", borderRadius: RADII.PILL, fontSize: "11px",
                  fontWeight: 600, background: meta.bg, color: meta.color, flexShrink: 0,
                }}>
                  {meta.label}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export default function EmployeeDetailPanel({
  email, days, onClose,
}: {
  email: string; days: number; onClose: () => void;
}) {
  const [data,    setData]    = useState<EmpDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await authFetch(`/api/hr/employee-performance?email=${encodeURIComponent(email)}&days=${days}`);
      const json = await res.json() as EmpDetail;
      if ("error" in json) throw new Error((json as { error: string }).error);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [email, days]);

  useEffect(() => { load(); }, [load]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const s = data?.summary;

  const cardStyle: React.CSSProperties = {
    background: COLOURS.CARD_ALT, border: `1px solid ${COLOURS.HAIRLINE}`,
    borderRadius: RADII.CARD, padding: "14px 16px",
  };

  const sectionLabel: React.CSSProperties = {
    fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE,
    textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px",
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(15,23,32,0.35)",
          zIndex: 200, backdropFilter: "blur(2px)",
        }}
      />

      {/* Panel */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: "min(520px, 100vw)",
        background: COLOURS.CARD, zIndex: 201, overflowY: "auto",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
        display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          padding: "20px 24px 16px",
          borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
          background: COLOURS.NAVY,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div style={{
              width: "48px", height: "48px", borderRadius: "50%",
              background: "rgba(255,255,255,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "18px", fontWeight: 700, color: "#fff", flexShrink: 0,
            }}>
              {initials(data?.name ?? email)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "17px", fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {loading ? "Loading…" : (data?.name ?? email)}
              </div>
              <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)", marginTop: "2px" }}>
                {data?.department ?? ""}
                {data?.department && " · "}
                Last {days} days
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: "rgba(255,255,255,0.1)", border: "none", borderRadius: "50%",
                width: "32px", height: "32px", cursor: "pointer",
                color: "#fff", fontSize: "16px", display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 24px", flex: 1 }}>
          {error && <div style={{ color: COLOURS.RED, fontSize: "13px", marginBottom: "16px" }}>{error}</div>}

          {/* KPI row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px", marginBottom: "16px" }}>
            {[
              { label: "Completion", value: s?.completion_pct != null ? `${s.completion_pct}%` : loading ? "…" : "—", color: ragColor(s?.completion_pct ?? null, "completion") },
              { label: "On time",    value: s?.ontime_pct    != null ? `${s.ontime_pct}%`    : loading ? "…" : "—", color: ragColor(s?.ontime_pct    ?? null, "ontime")     },
              { label: "Overdue",    value: loading ? "…" : String(s?.overdue ?? 0),  color: (s?.overdue ?? 0) > 0 ? COLOURS.RED   : COLOURS.GREEN },
              { label: "Total tasks",value: loading ? "…" : String(s?.total   ?? 0),  color: COLOURS.NAVY },
            ].map(k => (
              <div key={k.label} style={{ ...cardStyle, textAlign: "center" }}>
                <div style={{ fontSize: "22px", fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</div>
                <div style={{ fontSize: "11px", color: COLOURS.SLATE, marginTop: "4px" }}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* Engagement */}
          {s && (
            <div style={{ ...cardStyle, marginBottom: "16px" }}>
              <EngagementBar summary={s} />
            </div>
          )}

          {/* Category breakdown */}
          {s && (
            <div style={{ ...cardStyle, marginBottom: "16px" }}>
              <div style={sectionLabel}>Task breakdown</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {Object.entries(CAT_LABELS).map(([cat, meta]) => {
                  const count = (data?.categories ?? {})[cat] ?? 0;
                  if (count === 0) return null;
                  return (
                    <div key={cat} style={{
                      display: "flex", alignItems: "center", gap: "6px",
                      padding: "5px 12px", borderRadius: RADII.PILL,
                      background: meta.bg, border: `1px solid ${COLOURS.HAIRLINE}`,
                    }}>
                      <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: meta.color }} />
                      <span style={{ fontSize: "12px", fontWeight: 600, color: meta.color }}>{count}</span>
                      <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{meta.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Weekly chart */}
          {!loading && data && data.weekly_trend.length > 0 && (
            <div style={{ ...cardStyle, marginBottom: "16px" }}>
              <div style={sectionLabel}>Weekly activity</div>
              <WeeklyChart weeks={data.weekly_trend} />
            </div>
          )}

          {/* Task list */}
          {!loading && data && (
            <div style={{ ...cardStyle }}>
              <div style={sectionLabel}>Task history</div>
              <TaskList tasks={data.tasks} />
            </div>
          )}

          {/* Placeholder for future data */}
          <div style={{
            marginTop: "16px", padding: "14px 16px",
            border: `1px dashed ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD,
            textAlign: "center",
          }}>
            <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>
              Attendance, KPIs, and appraisal data will appear here once connected.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
