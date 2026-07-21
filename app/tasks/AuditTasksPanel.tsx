"use client";

// AuditTasksPanel — surfaces the calling audit member's project stage tasks
// on the Tasks page so they can mark progress without navigating to /department/audit.
// Redesigned 22/07/2026: sorted sections (In Progress / Planned / Completed),
// current stage shown inline on every card, red left border for overdue projects,
// completed projects collapsed behind a toggle.
// Status updates write directly to audit_stage_tasks so the Audit page progress
// bars stay in sync automatically.

import { useCallback, useEffect, useRef, useState } from "react";
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
  "Completed":   "Not Started",
};

const TASK_STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  "Not Started": { bg: COLOURS.TRACK,        fg: COLOURS.SLATE, label: "Not Started" },
  "In Progress": { bg: COLOURS.INFO_SOFT,    fg: COLOURS.BLUE,  label: "In Progress" },
  "Completed":   { bg: COLOURS.SUCCESS_SOFT, fg: COLOURS.GREEN, label: "Done"        },
};

const COMPANY_BADGE: Record<string, { color: string; background: string }> = {
  UTPL: { color: COLOURS.BLUE,   background: COLOURS.INFO_SOFT    },
  IFPL: { color: COLOURS.GREEN,  background: COLOURS.SUCCESS_SOFT },
  BRNH: { color: COLOURS.AMBER,  background: COLOURS.WARNING_SOFT },
  HD:   { color: "#6E45B8",      background: "#F3EEF9"            },
};

const todayStr = new Date().toISOString().slice(0, 10);

function isOverdue(proj: AuditProject): boolean {
  return !!proj.target_date && proj.target_date < todayStr && proj.status !== "Completed";
}

function daysOverdue(proj: AuditProject): number {
  if (!proj.target_date || !isOverdue(proj)) return 0;
  return Math.floor((Date.now() - new Date(proj.target_date + "T00:00:00").getTime()) / 86400000);
}

function daysBetween(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

// Returns the label of the first stage group that is not fully completed.
// If all stages are done, returns null (project is effectively complete).
function getCurrentStage(stages: StageTask[]): string | null {
  if (!stages.length) return null;
  const sorted = [...stages].sort((a, b) =>
    a.stage_no !== b.stage_no ? a.stage_no - b.stage_no : a.sort_order - b.sort_order
  );
  const stageNos = Array.from(new Set(sorted.map((t) => t.stage_no)));
  for (const sn of stageNos) {
    const group = sorted.filter((t) => t.stage_no === sn);
    if (!group.every((t) => t.status === "Completed")) {
      return group[0]?.stage_label ?? null;
    }
  }
  return null;
}

function sortByOverdueFirst(projects: AuditProject[]): AuditProject[] {
  return [...projects].sort((a, b) => {
    const aOD = isOverdue(a), bOD = isOverdue(b);
    if (aOD && !bOD) return -1;
    if (!aOD && bOD) return 1;
    if (!a.target_date && !b.target_date) return 0;
    if (!a.target_date) return 1;
    if (!b.target_date) return -1;
    return a.target_date < b.target_date ? -1 : 1;
  });
}

function sortByDate(projects: AuditProject[]): AuditProject[] {
  return [...projects].sort((a, b) => {
    if (!a.target_date && !b.target_date) return 0;
    if (!a.target_date) return 1;
    if (!b.target_date) return -1;
    return a.target_date < b.target_date ? -1 : 1;
  });
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
  const [data, setData]         = useState<MyTasksData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [expandedIds, setExpandedIds]     = useState<Set<string>>(new Set());
  const [showCompletedStepsIds, setShowCompletedStepsIds] = useState<Set<string>>(new Set());
  const [showCompletedSection, setShowCompletedSection]   = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const didAutoExpand = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: result, error } = await supabase.rpc("audit_my_tasks").single();
    if (!error && result && !("error" in (result as object))) {
      setData(result as MyTasksData);
    } else {
      setData(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-expand overdue in-progress projects once on first data load
  useEffect(() => {
    if (data && !didAutoExpand.current) {
      didAutoExpand.current = true;
      const autoIds = new Set<string>();
      for (const p of data.projects) {
        if (isOverdue(p) && (p.status === "In Progress" || p.status === "Stuck")) {
          autoIds.add(p.id);
        }
      }
      if (autoIds.size > 0) setExpandedIds(autoIds);
    }
  }, [data]);

  async function cycleStatus(task: StageTask) {
    if (savingId) return;
    const next = STATUS_CYCLE[task.status] ?? "In Progress";
    setSavingId(task.id);
    const updates: Record<string, unknown> = { status: next, updated_at: new Date().toISOString() };
    if (next === "In Progress" && !task.started_at) updates.started_at = new Date().toISOString();
    updates.completed_at = next === "Completed" ? new Date().toISOString() : null;
    await supabase.from("audit_stage_tasks").update(updates).eq("id", task.id);
    logAction(
      "Updated", "audit_stage_tasks",
      `${task.stage_label}${task.sub_task ? ` — ${task.sub_task}` : ""} → ${next}`,
      task.id
    );
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

  function toggleShowCompletedSteps(id: string) {
    setShowCompletedStepsIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ── Loading ────────────────────────────────────────────────────────────────
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

  // No data at all — manager (team_name = null) or some error
  if (!data || !data.team_name) return null;

  // Team exists but no projects — pre-audit team or unassigned team
  if (data.projects.length === 0) {
    return (
      <div style={{
        border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD,
        backgroundColor: COLOURS.CARD, padding: "16px", marginBottom: "20px",
        display: "flex", alignItems: "center", gap: "12px",
      }}>
        <div style={{ flex: 1 }}>
          <p style={{ margin: "0 0 4px 0", fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>
            {data.team_name}
          </p>
          <p style={{ margin: 0, fontSize: "13px", color: COLOURS.SLATE }}>
            Your audit work is the daily document check.{" "}
            <Link href="/department/audit" style={{ color: COLOURS.BLUE, textDecoration: "none" }}>
              Go to Audit page →
            </Link>
          </p>
        </div>
      </div>
    );
  }

  // ── Classify + sort projects ───────────────────────────────────────────────
  const activeProjects    = sortByOverdueFirst(data.projects.filter((p) => p.status === "In Progress" || p.status === "Stuck"));
  const plannedProjects   = sortByDate(data.projects.filter((p) => p.status !== "In Progress" && p.status !== "Stuck" && p.status !== "Completed"));
  const completedProjects = data.projects.filter((p) => p.status === "Completed");
  const overdueCount      = activeProjects.filter(isOverdue).length;

  // ── Renders a project card ────────────────────────────────────────────────
  function renderCard(proj: AuditProject, opts: { isCompleted?: boolean } = {}) {
    const { isCompleted = false } = opts;
    const expanded      = expandedIds.has(proj.id);
    const showDoneSteps = showCompletedStepsIds.has(proj.id);
    const overdue       = isOverdue(proj);
    const od            = daysOverdue(proj);
    const currentStage  = getCurrentStage(proj.stages);
    const doneCount     = proj.stages.filter((t) => t.status === "Completed").length;
    const totalCount    = proj.stages.length;
    const completedStepCount = proj.stages.filter((t) => t.status === "Completed").length;

    const stageNos = Array.from(new Set(proj.stages.map((t) => t.stage_no))).sort((a, b) => a - b);

    // Border accent: red for overdue, blue for in-progress, soft for planned/completed
    const leftBorderColor =
      isCompleted ? COLOURS.GREEN :
      overdue     ? COLOURS.RED   :
      proj.status === "In Progress" || proj.status === "Stuck" ? COLOURS.BLUE :
      COLOURS.HAIRLINE;

    // Progress bar colour
    const barColor =
      isCompleted             ? COLOURS.GREEN :
      proj.completion_pct > 0 ? COLOURS.BLUE  : COLOURS.TRACK;

    return (
      <div key={proj.id} style={{
        border: `1px solid ${COLOURS.HAIRLINE}`,
        borderLeft: `4px solid ${leftBorderColor}`,
        borderRadius: RADII.CARD,
        backgroundColor: COLOURS.CARD,
        overflow: "hidden",
        opacity: isCompleted ? 0.75 : 1,
      }}>
        {/* ── Card header (click to expand) ── */}
        <button
          onClick={() => toggleExpand(proj.id)}
          style={{
            width: "100%", display: "flex", alignItems: "flex-start", gap: "12px",
            padding: "12px 14px", background: "none", border: "none", cursor: "pointer", textAlign: "left",
          }}
        >
          {/* Left column: title + meta */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Row 1: name + badges */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginBottom: "4px" }}>
              <span style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>{proj.process_name}</span>
              <CompanyBadge companyId={proj.company_id} />
              {proj.period_label && (
                <span style={{ fontSize: "11px", color: COLOURS.SLATE }}>{proj.period_label}</span>
              )}
              {overdue && (
                <span style={{
                  fontSize: "10px", fontWeight: 700, padding: "1px 6px", borderRadius: RADII.PILL,
                  backgroundColor: "#FEE2E2", color: COLOURS.RED,
                }}>⚠ {od}d overdue</span>
              )}
              {!overdue && proj.target_date && !isCompleted && (
                <span style={{ fontSize: "11px", color: COLOURS.SLATE, marginLeft: "auto" }}>
                  Due {formatDateUK(proj.target_date)}
                </span>
              )}
              {isCompleted && proj.target_date && (
                <span style={{ fontSize: "11px", color: COLOURS.GREEN }}>
                  ✓ Completed
                </span>
              )}
            </div>

            {/* Row 2: current stage (only for non-completed) */}
            {!isCompleted && currentStage && (
              <p style={{ margin: "0 0 6px 0", fontSize: "12px", color: COLOURS.SLATE }}>
                Currently on: <span style={{ fontWeight: 500, color: COLOURS.NAVY }}>{currentStage}</span>
              </p>
            )}
            {!isCompleted && !currentStage && proj.stages.length > 0 && (
              <p style={{ margin: "0 0 6px 0", fontSize: "12px", color: COLOURS.GREEN }}>
                All stages complete
              </p>
            )}

            {/* Row 3: progress bar */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{
                flex: 1, height: "4px", backgroundColor: COLOURS.TRACK,
                borderRadius: "2px", overflow: "hidden",
              }}>
                <div style={{
                  height: "100%", borderRadius: "2px",
                  width: `${proj.completion_pct}%`,
                  backgroundColor: barColor,
                  transition: "width 0.3s ease",
                }} />
              </div>
              <span style={{ fontSize: "11px", color: COLOURS.SLATE, whiteSpace: "nowrap" }}>
                {proj.completion_pct}% · {doneCount}/{totalCount} steps
              </span>
            </div>
          </div>

          {/* Chevron */}
          <span style={{ fontSize: "12px", color: COLOURS.SLATE, flexShrink: 0, marginTop: "2px" }}>
            {expanded ? "▲" : "▼"}
          </span>
        </button>

        {/* ── Expanded: stage tasks ── */}
        {expanded && (
          <div style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>
            {stageNos.map((sn) => {
              const stageTasks = proj.stages
                .filter((t) => t.stage_no === sn)
                .sort((a, b) => a.sort_order - b.sort_order);
              const stageLabel = stageTasks[0]?.stage_label ?? `Stage ${sn}`;
              const allDone    = stageTasks.every((t) => t.status === "Completed");
              const visible    = showDoneSteps
                ? stageTasks
                : stageTasks.filter((t) => t.status !== "Completed");

              return (
                <div key={sn}>
                  {/* Stage group header */}
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
                    const s        = TASK_STATUS_STYLE[task.status] ?? TASK_STATUS_STYLE["Not Started"];
                    const isSaving = savingId === task.id;
                    const daysIn   = task.status === "In Progress" && task.started_at
                      ? daysBetween(task.started_at) : 0;
                    const budget   = Number(task.total_days) || 0;
                    const over     = daysIn > budget && budget > 0 ? daysIn - budget : 0;
                    const who      = [task.responsible, task.responsible_2].filter(Boolean).join(" + ") || "—";

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

                        {/* Task content */}
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

            {/* Card footer */}
            <div style={{
              padding: "10px 16px", borderTop: `1px solid ${COLOURS.HAIRLINE}`,
              display: "flex", alignItems: "center", justifyContent: "space-between",
              backgroundColor: COLOURS.CANVAS,
            }}>
              <Link href="/department/audit" style={{
                fontSize: "12px", color: COLOURS.BLUE, textDecoration: "none", fontWeight: 500,
              }}>
                View full project in Audit →
              </Link>
              {completedStepCount > 0 && (
                <button
                  onClick={() => toggleShowCompletedSteps(proj.id)}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: "11px", color: COLOURS.SLATE, padding: 0 }}
                >
                  {showDoneSteps
                    ? "Hide completed steps"
                    : `Show ${completedStepCount} completed step${completedStepCount > 1 ? "s" : ""}`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Section label ─────────────────────────────────────────────────────────
  function SectionLabel({ label, count, badge }: { label: string; count: number; badge?: string }) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "16px 0 6px 0" }}>
        <span style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {label}
        </span>
        <span style={{
          fontSize: "11px", fontWeight: 600, padding: "1px 7px", borderRadius: RADII.PILL,
          backgroundColor: COLOURS.TRACK, color: COLOURS.SLATE,
        }}>{count}</span>
        {badge && (
          <span style={{
            fontSize: "11px", fontWeight: 600, padding: "1px 7px", borderRadius: RADII.PILL,
            backgroundColor: "#FEE2E2", color: COLOURS.RED,
          }}>{badge}</span>
        )}
        <div style={{ flex: 1, height: "1px", backgroundColor: COLOURS.HAIRLINE }} />
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div style={{ marginBottom: "28px" }}>
      {/* Panel header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>My Audit Projects</span>
          {data.team_name && (
            <span style={{
              fontSize: "11px", color: COLOURS.SLATE, padding: "2px 8px",
              border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.PILL,
            }}>{data.team_name}</span>
          )}
        </div>
        <button
          onClick={load}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: "12px", color: COLOURS.SLATE, padding: "2px 6px" }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* ── In progress section ─────────────────────────────────────────── */}
      {activeProjects.length > 0 && (
        <>
          <SectionLabel
            label="In progress"
            count={activeProjects.length}
            badge={overdueCount > 0 ? `${overdueCount} overdue` : undefined}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {activeProjects.map((proj) => renderCard(proj))}
          </div>
        </>
      )}

      {/* ── Planned section ─────────────────────────────────────────────── */}
      {plannedProjects.length > 0 && (
        <>
          <SectionLabel label="Planned" count={plannedProjects.length} />
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {plannedProjects.map((proj) => renderCard(proj))}
          </div>
        </>
      )}

      {/* ── Completed accordion ─────────────────────────────────────────── */}
      {completedProjects.length > 0 && (
        <div style={{ marginTop: "16px" }}>
          <button
            onClick={() => setShowCompletedSection((v) => !v)}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              background: "none", border: "none", cursor: "pointer",
              fontSize: "12px", color: COLOURS.SLATE, padding: "4px 0",
            }}
          >
            <div style={{ flex: 1, height: "1px", backgroundColor: COLOURS.HAIRLINE, width: "20px" }} />
            <span style={{ fontWeight: 600 }}>
              {showCompletedSection
                ? `Hide ${completedProjects.length} completed project${completedProjects.length > 1 ? "s" : ""}`
                : `${completedProjects.length} completed project${completedProjects.length > 1 ? "s" : ""} — show`}
            </span>
            <span>{showCompletedSection ? "▲" : "▼"}</span>
          </button>
          {showCompletedSection && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
              {completedProjects.map((proj) => renderCard(proj, { isCompleted: true }))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {activeProjects.length === 0 && plannedProjects.length === 0 && completedProjects.length === 0 && (
        <p style={{ color: COLOURS.SLATE, fontSize: "13px", margin: "12px 0 0 0" }}>
          No audit projects assigned to your team yet.
        </p>
      )}
    </div>
  );
}
