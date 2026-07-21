"use client";

// AuditTasksPanel — surfaces the calling audit member's project stage tasks
// on the Tasks page so they can mark progress without navigating to /department/audit.
// Status updates write directly to audit_stage_tasks (same as the Audit page does)
// so the progress bars there stay in sync automatically.
// Only shown for Audit dept members who have a team assignment — managers and
// members with no team get null from audit_my_tasks() and this panel hides.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabase";
import { COMPANIES } from "../lib/constants";
import { formatDateUK } from "../lib/dateUtils";
import { COLOURS, RADII } from "../lib/SharedUI";
import { logAction } from "../lib/audit-log";

type StageTask = {
  id: string;
  stage_no: number;
  stage_label: string;
  sub_task: string | null;
  responsible: string | null;
  responsible_2: string | null;
  total_days: number | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  sort_order: number;
};

type AuditProject = {
  id: string;
  s_no: number;
  process_name: string;
  company_id: string;
  period_label: string | null;
  status: string;
  status_note: string | null;
  target_date: string | null;
  total_days: number;
  done_days: number;
  completion_pct: number;
  stages: StageTask[];
};

type MyTasksData = {
  team_name: string | null;
  projects: AuditProject[];
};

const STATUS_CYCLE: Record<string, string> = {
  "Not Started": "In Progress",
  "In Progress": "Completed",
  "Completed": "Not Started",
};

const TASK_STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  "Not Started": { bg: COLOURS.TRACK,        fg: COLOURS.SLATE, label: "Not Started" },
  "In Progress": { bg: COLOURS.INFO_SOFT,    fg: COLOURS.BLUE,  label: "In Progress" },
  "Completed":   { bg: COLOURS.SUCCESS_SOFT, fg: COLOURS.GREEN, label: "Done"        },
};

const PROCESS_STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  "Completed":  { bg: COLOURS.SUCCESS_SOFT, fg: COLOURS.GREEN },
  "In Progress":{ bg: COLOURS.INFO_SOFT,   fg: COLOURS.BLUE  },
  "Planned":    { bg: COLOURS.TRACK,        fg: COLOURS.SLATE },
  "Stuck":      { bg: COLOURS.DANGER_SOFT,  fg: COLOURS.RED   },
};

const COMPANY_BADGE: Record<string, { color: string; background: string }> = {
  UTPL: { color: COLOURS.BLUE,   background: COLOURS.INFO_SOFT    },
  IFPL: { color: COLOURS.GREEN,  background: COLOURS.SUCCESS_SOFT },
  BRNH: { color: COLOURS.AMBER,  background: COLOURS.WARNING_SOFT },
  HD:   { color: "#6E45B8",      background: "#F3EEF9"            },
};

function daysBetween(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

function CompanyBadge({ companyId }: { companyId: string }) {
  const c = COMPANIES.find((x) => x.id === companyId);
  if (!c) return null;
  const p = COMPANY_BADGE[c.shortCode] || { color: COLOURS.SLATE, background: COLOURS.TRACK };
  return (
    <span style={{
      fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: RADII.PILL,
      backgroundColor: p.background, color: p.color,
      textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0,
    }}>{c.shortCode}</span>
  );
}

export default function AuditTasksPanel() {
  const [data, setData]           = useState<MyTasksData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [expandedIds, setExpandedIds]       = useState<Set<string>>(new Set());
  const [showCompletedIds, setShowCompletedIds] = useState<Set<string>>(new Set());
  const [savingId, setSavingId]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: result, error } = await supabase.rpc("audit_my_tasks").single();
    if (!error && result && !("error" in (result as object)) && (result as MyTasksData).projects?.length > 0) {
      setData(result as MyTasksData);
    } else {
      setData(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function cycleStatus(task: StageTask) {
    if (savingId) return;
    const next = STATUS_CYCLE[task.status] ?? "In Progress";
    setSavingId(task.id);
    const updates: Record<string, unknown> = { status: next, updated_at: new Date().toISOString() };
    if (next === "In Progress" && !task.started_at) updates.started_at = new Date().toISOString();
    updates.completed_at = next === "Completed" ? new Date().toISOString() : null;
    await supabase.from("audit_stage_tasks").update(updates).eq("id", task.id);
    logAction("Updated", "audit_stage_tasks",
      `${task.stage_label}${task.sub_task ? ` — ${task.sub_task}` : ""} → ${next}`, task.id);
    setSavingId(null);
    await load();
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleShowCompleted(id: string) {
    setShowCompletedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div style={{
        border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD,
        backgroundColor: COLOURS.CARD, padding: "16px", marginBottom: "20px",
      }}>
        <p style={{ color: COLOURS.SLATE, fontSize: "13px", margin: 0 }}>Loading audit projects…</p>
      </div>
    );
  }

  if (!data) return null;

  const totalActive = data.projects.filter((p) => p.status !== "Completed" && p.status !== "Cancelled").length;

  return (
    <div style={{ marginBottom: "28px" }}>
      {/* Section header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>My Audit Projects</span>
          {data.team_name && (
            <span style={{
              fontSize: "11px", color: COLOURS.SLATE, padding: "2px 8px",
              border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.PILL,
            }}>{data.team_name}</span>
          )}
          <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>
            {totalActive} active · {data.projects.length} total
          </span>
        </div>
        <button
          onClick={load}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: "12px", color: COLOURS.SLATE, padding: "2px 6px" }}
        >↻ Refresh</button>
      </div>

      {/* Project cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {data.projects.map((proj) => {
          const isExpanded   = expandedIds.has(proj.id);
          const showDone     = showCompletedIds.has(proj.id);
          const procStyle    = PROCESS_STATUS_STYLE[proj.status] ?? PROCESS_STATUS_STYLE["Planned"];
          const doneCount    = proj.stages.filter((t) => t.status === "Completed").length;
          const totalCount   = proj.stages.length;
          const completedCount = proj.stages.filter((t) => t.status === "Completed").length;

          // Group tasks by stage number, sorted
          const stageNos = Array.from(new Set(proj.stages.map((t) => t.stage_no))).sort((a, b) => a - b);

          return (
            <div key={proj.id} style={{
              border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD,
              backgroundColor: COLOURS.CARD, overflow: "hidden",
            }}>
              {/* ── Project header (click to expand) ── */}
              <button
                onClick={() => toggleExpand(proj.id)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: "12px",
                  padding: "12px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left",
                }}
              >
                {/* Dot */}
                <div style={{
                  width: "10px", height: "10px", borderRadius: "50%", flexShrink: 0,
                  backgroundColor:
                    proj.status === "Completed"  ? COLOURS.GREEN :
                    proj.status === "In Progress" ? COLOURS.BLUE  : COLOURS.INK_300,
                }} />

                {/* Title + badges */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginBottom: "5px" }}>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>{proj.process_name}</span>
                    <CompanyBadge companyId={proj.company_id} />
                    {proj.period_label && (
                      <span style={{ fontSize: "11px", color: COLOURS.SLATE }}>{proj.period_label}</span>
                    )}
                    <span style={{
                      fontSize: "10px", fontWeight: 600, padding: "1px 6px", borderRadius: RADII.PILL,
                      backgroundColor: procStyle.bg, color: procStyle.fg,
                    }}>{proj.status}</span>
                    {proj.target_date && (
                      <span style={{ fontSize: "11px", color: COLOURS.SLATE, marginLeft: "auto" }}>
                        Due {formatDateUK(proj.target_date)}
                      </span>
                    )}
                  </div>
                  {/* Progress bar */}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ flex: 1, height: "4px", backgroundColor: COLOURS.TRACK, borderRadius: "2px", overflow: "hidden" }}>
                      <div style={{
                        height: "100%", borderRadius: "2px",
                        width: `${proj.completion_pct}%`,
                        backgroundColor: proj.completion_pct === 100 ? COLOURS.GREEN : COLOURS.BLUE,
                        transition: "width 0.3s ease",
                      }} />
                    </div>
                    <span style={{ fontSize: "11px", color: COLOURS.SLATE, whiteSpace: "nowrap" }}>
                      {proj.completion_pct}% · {doneCount}/{totalCount} steps
                    </span>
                  </div>
                </div>

                <span style={{ fontSize: "12px", color: COLOURS.SLATE, flexShrink: 0 }}>
                  {isExpanded ? "▲" : "▼"}
                </span>
              </button>

              {/* ── Expanded stage tasks ── */}
              {isExpanded && (
                <div style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>
                  {stageNos.map((sn) => {
                    const stageTasks = proj.stages.filter((t) => t.stage_no === sn);
                    const stageLabel = stageTasks[0]?.stage_label ?? `Stage ${sn}`;
                    const allDone    = stageTasks.every((t) => t.status === "Completed");
                    const visible    = showDone ? stageTasks : stageTasks.filter((t) => t.status !== "Completed");

                    return (
                      <div key={sn}>
                        {/* Stage group label */}
                        <div style={{
                          padding: "6px 16px",
                          backgroundColor: allDone ? COLOURS.SUCCESS_SOFT : COLOURS.CANVAS,
                          borderTop: `1px solid ${COLOURS.HAIRLINE}`,
                          display: "flex", alignItems: "center", gap: "8px",
                        }}>
                          <span style={{
                            width: "18px", height: "18px", borderRadius: "50%", flexShrink: 0,
                            backgroundColor: allDone ? COLOURS.GREEN : COLOURS.TRACK,
                            color: allDone ? COLOURS.CARD : COLOURS.SLATE,
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            fontSize: "10px", fontWeight: 700,
                          }}>{allDone ? "✓" : sn}</span>
                          <span style={{ fontSize: "12px", fontWeight: 600, color: allDone ? COLOURS.GREEN : COLOURS.NAVY }}>
                            {stageLabel}
                          </span>
                        </div>

                        {/* Task rows */}
                        {visible.map((task) => {
                          const s       = TASK_STATUS_STYLE[task.status] ?? TASK_STATUS_STYLE["Not Started"];
                          const isSaving= savingId === task.id;
                          const daysIn  = task.status === "In Progress" && task.started_at
                            ? daysBetween(task.started_at) : 0;
                          const budget  = Number(task.total_days) || 0;
                          const over    = daysIn > budget && budget > 0 ? daysIn - budget : 0;
                          const who     = [task.responsible, task.responsible_2].filter(Boolean).join(" + ") || "—";

                          return (
                            <div key={task.id} style={{
                              padding: "10px 16px",
                              borderTop: `1px solid ${COLOURS.HAIRLINE}`,
                              display: "flex", alignItems: "flex-start", gap: "12px",
                              opacity: isSaving ? 0.55 : 1, transition: "opacity 0.15s",
                            }}>
                              {/* Clickable status circle */}
                              <button
                                onClick={() => cycleStatus(task)}
                                disabled={!!savingId}
                                title={`Mark as ${STATUS_CYCLE[task.status] ?? "In Progress"}`}
                                style={{
                                  width: "22px", height: "22px", borderRadius: "50%", flexShrink: 0,
                                  border: `2px solid ${s.fg}`,
                                  backgroundColor: task.status === "Completed" ? s.fg : "transparent",
                                  cursor: savingId ? "wait" : "pointer",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  padding: 0, marginTop: "1px",
                                }}
                              >
                                {task.status === "Completed" && (
                                  <span style={{ color: COLOURS.CARD, fontSize: "11px", fontWeight: 700, lineHeight: 1 }}>✓</span>
                                )}
                                {task.status === "In Progress" && (
                                  <span style={{ color: s.fg, fontSize: "9px", lineHeight: 1 }}>▶</span>
                                )}
                              </button>

                              {/* Content */}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                  fontSize: "13px",
                                  fontWeight: task.status === "Completed" ? 400 : 500,
                                  textDecoration: task.status === "Completed" ? "line-through" : "none",
                                  color: task.status === "Completed" ? COLOURS.SLATE : COLOURS.NAVY,
                                }}>
                                  {task.sub_task ?? task.stage_label}
                                </div>
                                <div style={{ display: "flex", gap: "10px", marginTop: "3px", flexWrap: "wrap", alignItems: "center" }}>
                                  <span style={{ fontSize: "11px", color: COLOURS.SLATE }}>{who}</span>
                                  {budget > 0 && (
                                    <span style={{ fontSize: "11px", color: COLOURS.SLATE }}>{budget}d budget</span>
                                  )}
                                  {daysIn > 0 && (
                                    <span style={{ fontSize: "11px", color: over > 0 ? COLOURS.RED : COLOURS.SLATE }}>
                                      {daysIn}d elapsed{over > 0 ? ` · ${over}d over budget` : ""}
                                    </span>
                                  )}
                                  {task.status === "Completed" && task.completed_at && (
                                    <span style={{ fontSize: "11px", color: COLOURS.GREEN }}>
                                      Done {formatDateUK(task.completed_at.slice(0, 10))}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Status pill */}
                              <span style={{
                                fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: RADII.PILL,
                                backgroundColor: s.bg, color: s.fg, flexShrink: 0, marginTop: "2px",
                              }}>{s.label}</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}

                  {/* Footer */}
                  <div style={{
                    padding: "10px 16px", borderTop: `1px solid ${COLOURS.HAIRLINE}`,
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    backgroundColor: COLOURS.CANVAS,
                  }}>
                    <Link href="/department/audit" style={{
                      fontSize: "12px", color: COLOURS.BLUE, textDecoration: "none", fontWeight: 500,
                    }}>View full project in Audit →</Link>

                    {completedCount > 0 && (
                      <button
                        onClick={() => toggleShowCompleted(proj.id)}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: "11px", color: COLOURS.SLATE, padding: 0 }}
                      >
                        {showDone ? "Hide completed steps" : `Show ${completedCount} completed step${completedCount > 1 ? "s" : ""}`}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
