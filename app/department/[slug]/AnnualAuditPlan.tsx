"use client";

// Annual Internal Audit Plan — built from the audit manager's "Audit activities" workbook.
// Structure: company → business process → 7-stage audit lifecycle → sub-tasks with day budgets.
// Executive overview for CEO / audit manager; audit-department members update sub-task status.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { COMPANIES } from "../../lib/constants";
import { formatDateUK } from "../../lib/dateUtils";
import DateInputWithCalendar from "../../lib/DateInputWithCalendar";
import { useMobile } from "../../lib/useMobile";
import { COLOURS, RADII, CountCard, SectionTitle, WARNING_BANNER_STYLE, WARNING_BANNER_INNER, WARNING_TITLE_COLOR } from "../../lib/SharedUI";
import { logAction } from "../../lib/audit-log";
import type { UserCtx } from "../../lib/permissions";

const STAGE_LABELS: Record<number, string> = {
  1: "Audit Planning",
  2: "Data Collection",
  3: "Data Verification",
  4: "Draft Audit Findings",
  5: "Review of IA Report",
  6: "Communication to Process Owner",
  7: "Submission to Senior Management",
};

const PLAN_COMPANY_CODES = ["UTPL", "IFPL", "HD", "BRNH"];
const AUDITOR_NOTES: Record<string, string> = {
  UTPL: "Three auditors",
  IFPL: "Two auditors",
  HD: "One auditor",
  BRNH: "One auditor",
};

const FREQ_BADGE: Record<string, { bg: string; text: string }> = {
  Monthly:         { bg: "#EEF1FC", text: COLOURS.BLUE },
  Quarterly:       { bg: COLOURS.WARNING_SOFT, text: COLOURS.AMBER },
  "Semi-annually": { bg: "#F3EEF9", text: "#6E45B8" },
  Annually:        { bg: COLOURS.SUCCESS_SOFT, text: COLOURS.GREEN },
};

const PROCESS_STATUSES = ["Planned", "In Progress", "Completed", "Cancelled"];
const TASK_STATUSES = ["Not Started", "In Progress", "Completed"];

type PlanKpis = { total: number; planned: number; in_progress: number; completed: number; overdue: number; avg_pct: number };

type PlanProcess = {
  id: string;
  company_id: string;
  fiscal_year: string;
  s_no: number;
  process_name: string;
  reference_no: number | null;
  frequency: string;
  period_label: string | null;
  status: string;
  status_note: string | null;
  target_date: string | null;
  next_period_label: string | null;
  next_target_date: string | null;
  total_days: number;
  done_days: number;
  task_count: number;
  done_count: number;
  current_stage_no: number | null;
  completion_pct: number;
};

type StageTask = {
  id: string;
  process_id: string;
  stage_no: number;
  stage_label: string;
  sub_task: string | null;
  responsible: string | null;
  responsible_2: string | null;
  days: number | null;
  days_2: number | null;
  total_days: number | null;
  sort_order: number;
  status: string;
};

type DailyActivity = {
  id: string;
  company_id: string;
  s_no: number;
  activity: string;
  transferred_to: string | null;
  note: string | null;
};

const today = new Date().toISOString().slice(0, 10);

function overdueDays(targetDate: string | null): number {
  if (!targetDate || targetDate >= today) return 0;
  return Math.floor((new Date(today + "T00:00:00").getTime() - new Date(targetDate + "T00:00:00").getTime()) / 86400000);
}

const inp: React.CSSProperties = {
  display: "block", width: "100%", padding: "7px 10px", marginTop: "3px",
  border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, fontSize: "14px", boxSizing: "border-box",
  color: COLOURS.NAVY,
};
const microLbl: React.CSSProperties = {
  fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE,
  textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "3px",
};

function FrequencyBadge({ frequency }: { frequency: string }) {
  const s = FREQ_BADGE[frequency] || { bg: COLOURS.HAIRLINE, text: COLOURS.SLATE };
  return (
    <span style={{ fontSize: "10px", fontWeight: 600, padding: "2px 6px", borderRadius: RADII.PILL, backgroundColor: s.bg, color: s.text, border: `1px solid ${s.text}22`, whiteSpace: "nowrap" }}>
      {frequency}
    </span>
  );
}

function CompletionBar({ pct }: { pct: number }) {
  const color = pct === 100 ? COLOURS.GREEN : pct >= 60 ? COLOURS.AMBER : COLOURS.BLUE;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
      <div style={{ flex: 1, height: "6px", backgroundColor: COLOURS.TRACK, borderRadius: RADII.PILL, minWidth: "40px" }}>
        <div style={{ width: `${pct}%`, height: "100%", backgroundColor: color, borderRadius: RADII.PILL, transition: "width 0.3s" }} />
      </div>
      <span style={{ fontSize: "11px", fontWeight: 600, color, minWidth: "28px", fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)" }}>{pct}%</span>
    </div>
  );
}

export default function AnnualAuditPlan({ userCtx, showMsg }: { userCtx: UserCtx | null; showMsg: (text: string) => void }) {
  const isMobile = useMobile();
  const [kpis, setKpis] = useState<PlanKpis | null>(null);
  const [processes, setProcesses] = useState<PlanProcess[]>([]);
  const [daily, setDaily] = useState<DailyActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tasksByProcess, setTasksByProcess] = useState<Record<string, StageTask[]>>({});
  const [tasksLoading, setTasksLoading] = useState<string | null>(null);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [dailyOpen, setDailyOpen] = useState(false);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);

  const planCompanies = COMPANIES.filter((c) => PLAN_COMPANY_CODES.includes(c.shortCode));
  const canEdit = !!userCtx && (userCtx.department === "Audit" || userCtx.role === "Admin" || userCtx.role === "CEO");

  const loadOverview = useCallback(async (companyId: string) => {
    setLoading(true);
    const { data, error } = await supabase.rpc("audit_annual_plan_overview", {
      p_company_id: companyId === "all" ? null : companyId,
    });
    if (!error && data) {
      setKpis(data.kpis as PlanKpis);
      setProcesses((data.processes as PlanProcess[]) || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadOverview(companyFilter); }, [companyFilter, loadOverview]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("audit_daily_activities")
        .select("id, company_id, s_no, activity, transferred_to, note")
        .order("s_no");
      setDaily(data || []);
    })();
  }, []);

  async function loadTasks(processId: string) {
    setTasksLoading(processId);
    const { data } = await supabase
      .from("audit_stage_tasks")
      .select("id, process_id, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order, status")
      .eq("process_id", processId)
      .order("sort_order");
    setTasksByProcess((prev) => ({ ...prev, [processId]: data || [] }));
    setTasksLoading(null);
  }

  function toggleExpand(processId: string) {
    const next = expandedId === processId ? null : processId;
    setExpandedId(next);
    if (next && !tasksByProcess[next]) loadTasks(next);
  }

  async function updateTaskStatus(task: StageTask, newStatus: string) {
    setSavingTaskId(task.id);
    const { error } = await supabase.from("audit_stage_tasks").update({
      status: newStatus,
      completed_at: newStatus === "Completed" ? new Date().toISOString() : null,
      updated_by: userCtx?.email || null,
      updated_at: new Date().toISOString(),
    }).eq("id", task.id);
    setSavingTaskId(null);
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Updated", "audit_stage_tasks", `${task.stage_label}${task.sub_task ? ` — ${task.sub_task}` : ""} → ${newStatus}`, task.id);
    await loadTasks(task.process_id);
    loadOverview(companyFilter);
  }

  async function updateProcessField(id: string, field: string, value: unknown) {
    const { error } = await supabase.from("audit_plan_processes").update({ [field]: value, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Updated", "audit_plan_processes", `${field} → ${value}`, id);
    loadOverview(companyFilter);
  }

  async function startNewCycle(p: PlanProcess) {
    if (!window.confirm(`Start a new ${p.frequency.toLowerCase()} cycle for "${p.process_name}"? All stage tasks will reset to Not Started.`)) return;
    const { error } = await supabase.rpc("audit_start_new_cycle", { p_process_id: p.id });
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Updated", "audit_plan_processes", `New cycle started — ${p.process_name}`, p.id);
    setTasksByProcess((prev) => { const n = { ...prev }; delete n[p.id]; return n; });
    showMsg("New cycle started.");
    loadOverview(companyFilter);
  }

  // Display-only ordering/grouping of rows already aggregated by the database
  const statusOrder = ["In Progress", "Planned", "Completed", "Cancelled"];
  const sorted = [...processes].sort((a, b) =>
    statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status) || a.company_id.localeCompare(b.company_id) || a.s_no - b.s_no);
  const overdueList = processes.filter((p) => (p.status === "Planned" || p.status === "In Progress") && overdueDays(p.target_date) > 0);

  const companyOf = (id: string) => COMPANIES.find((c) => c.id === id);
  const dailyFiltered = companyFilter === "all" ? daily : daily.filter((d) => d.company_id === companyFilter);

  const companyTabs = [{ id: "all", label: "All" }, ...planCompanies.map((c) => ({ id: c.id, label: c.shortCode }))];

  return (
    <section style={{ marginBottom: "22px" }}>
      {/* Section header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "8px", marginBottom: "4px" }}>
        <SectionTitle title="Annual Internal Audit Plan" />
        <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>FY 2025-26 · Year end closed 30/06/2026</span>
      </div>

      {/* Company tabs */}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "10px", alignItems: "center" }}>
        {companyTabs.map((t) => {
          const isActive = t.id === companyFilter;
          return (
            <button key={t.id} onClick={() => { setCompanyFilter(t.id); setExpandedId(null); }} style={{
              padding: "5px 12px", borderRadius: RADII.PILL, fontSize: "12px", fontWeight: 600, cursor: "pointer",
              border: `1px solid ${isActive ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
              backgroundColor: isActive ? COLOURS.NAVY : COLOURS.CARD,
              color: isActive ? "#FFFFFF" : COLOURS.NAVY,
            }}>{t.label}</button>
          );
        })}
        {companyFilter !== "all" && (
          <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>
            {AUDITOR_NOTES[companyOf(companyFilter)?.shortCode || ""] || ""}
          </span>
        )}
      </div>

      {/* Overdue banner */}
      {!loading && overdueList.length > 0 && (
        <div style={WARNING_BANNER_STYLE}>
          <div onClick={() => setBannerOpen(!bannerOpen)} style={{ padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>⚠</span>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 700, color: WARNING_TITLE_COLOR }}>{overdueList.length} planned audit{overdueList.length > 1 ? "s" : ""} past target date</div>
                <div style={{ fontSize: "12px", color: WARNING_TITLE_COLOR, marginTop: "1px" }}>{overdueList.slice(0, 3).map((p) => `${p.process_name} (${overdueDays(p.target_date)}d)`).join(" · ")}</div>
              </div>
            </div>
            <span style={{ fontSize: "13px", fontWeight: 700, color: WARNING_TITLE_COLOR }}>{bannerOpen ? "▲" : "▼"}</span>
          </div>
          {bannerOpen && (
            <div style={WARNING_BANNER_INNER}>
              {overdueList.sort((a, b) => overdueDays(b.target_date) - overdueDays(a.target_date)).map((p) => (
                <div key={p.id} onClick={() => { setBannerOpen(false); toggleExpand(p.id); }} style={{ padding: "8px 16px 8px 48px", borderBottom: `1px solid ${COLOURS.TRACK}`, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY }}>{p.process_name}</div>
                    <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>{companyOf(p.company_id)?.shortCode} · {p.current_stage_no ? STAGE_LABELS[p.current_stage_no] : "Not started"}</div>
                  </div>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.RED }}>{overdueDays(p.target_date)}d overdue</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* KPI cards */}
      {!loading && kpis && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "8px", marginBottom: "14px" }}>
          <CountCard label="Processes" value={kpis.total} color={COLOURS.NAVY} />
          <CountCard label="In Progress" value={kpis.in_progress} color={COLOURS.AMBER} />
          <CountCard label="Planned" value={kpis.planned} color={COLOURS.BLUE} />
          <CountCard label="Completed" value={kpis.completed} color={COLOURS.GREEN} />
          <CountCard label="Overdue" value={kpis.overdue} color={COLOURS.RED} />
          <CountCard label="Avg %" value={kpis.avg_pct} color={COLOURS.PURPLE} />
        </div>
      )}

      {/* Plan records grouped by status */}
      {loading ? <p style={{ color: COLOURS.SLATE }}>Loading…</p> : sorted.length === 0 ? (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, padding: "24px", backgroundColor: COLOURS.CARD, color: COLOURS.SLATE }}>
          No plan records yet. The annual plan will appear here once the migration has been applied.
        </div>
      ) : (
        statusOrder.filter((s) => sorted.some((p) => p.status === s)).map((status) => {
          const group = sorted.filter((p) => p.status === status);
          const statusColor = status === "In Progress" ? COLOURS.AMBER : status === "Completed" ? COLOURS.GREEN : status === "Cancelled" ? COLOURS.SLATE : COLOURS.BLUE;
          return (
            <div key={status} style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD, overflow: "hidden", marginBottom: "10px" }}>
              <div style={{ padding: "10px 18px", backgroundColor: COLOURS.CARD_ALT, borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: statusColor }} />
                  <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.INK_700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{status}</span>
                </div>
                <span style={{ fontSize: "13px", color: COLOURS.SLATE }}>{group.length} process{group.length > 1 ? "es" : ""}</span>
              </div>

              {group.map((p) => {
                const isOpen = expandedId === p.id;
                const od = overdueDays(p.target_date);
                const isOverdue = od > 0 && (p.status === "Planned" || p.status === "In Progress");
                const tasks = tasksByProcess[p.id] || [];
                const stageNos = Array.from(new Set(tasks.map((t) => t.stage_no))).sort((a, b) => a - b);

                return (
                  <div key={p.id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                    <div onClick={() => toggleExpand(p.id)} style={{
                      padding: "12px 18px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
                      backgroundColor: isOverdue ? COLOURS.DANGER_SOFT : isOpen ? COLOURS.CARD_ALT : COLOURS.CARD,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.s_no}. {p.process_name}{p.period_label ? ` — ${p.period_label}` : ""}
                        </div>
                        <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginTop: "3px", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                          <span style={{
                            fontSize: "10px", fontWeight: 600, padding: "2px 6px", borderRadius: RADII.PILL,
                            backgroundColor: COLOURS.CARD_ALT, color: COLOURS.NAVY, border: `1px solid ${COLOURS.HAIRLINE}`, whiteSpace: "nowrap",
                          }}>{companyOf(p.company_id)?.shortCode || "—"}</span>
                          <FrequencyBadge frequency={p.frequency} />
                          {p.status !== "Completed" && p.current_stage_no && <span>{STAGE_LABELS[p.current_stage_no]}</span>}
                          {p.total_days > 0 && <span>{p.done_days}/{p.total_days} days</span>}
                          {p.target_date && (
                            <span style={{ color: isOverdue ? COLOURS.RED : COLOURS.SLATE, fontWeight: isOverdue ? 600 : 400 }}>
                              Target: {formatDateUK(p.target_date)}{isOverdue ? ` (${od}d late)` : ""}
                            </span>
                          )}
                          {p.status_note && <span style={{ fontStyle: "italic" }}>{p.status_note}</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0, minWidth: isMobile ? "60px" : "120px" }}>
                        <CompletionBar pct={p.completion_pct} />
                        <span style={{ color: COLOURS.SLATE, fontSize: "14px" }}>{isOpen ? "▼" : "▶"}</span>
                      </div>
                    </div>

                    {isOpen && (
                      <div style={{ padding: "16px 18px", backgroundColor: COLOURS.CARD_ALT, borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>
                        {/* Process controls */}
                        {canEdit && (
                          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "10px", marginBottom: "14px" }}>
                            <div>
                              <div style={microLbl}>Status</div>
                              <select style={inp} value={p.status} onChange={(e) => updateProcessField(p.id, "status", e.target.value)}>
                                {PROCESS_STATUSES.map((s) => <option key={s}>{s}</option>)}
                              </select>
                            </div>
                            <div>
                              <div style={microLbl}>Target Date</div>
                              <DateInputWithCalendar style={inp} value={p.target_date || ""} onChange={(e) => updateProcessField(p.id, "target_date", e.target.value || null)} />
                            </div>
                            <div>
                              <div style={microLbl}>Note</div>
                              <input style={inp} defaultValue={p.status_note || ""} placeholder="e.g. Updated till May"
                                onBlur={(e) => { if (e.target.value.trim() !== (p.status_note || "")) updateProcessField(p.id, "status_note", e.target.value.trim() || null); }} />
                            </div>
                          </div>
                        )}

                        {(p.next_period_label || p.next_target_date) && (
                          <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginBottom: "10px" }}>
                            Next cycle: {p.next_period_label || "—"}{p.next_target_date ? ` · target ${formatDateUK(p.next_target_date)}` : ""}
                          </div>
                        )}

                        {canEdit && p.status === "Completed" && (
                          <button onClick={() => startNewCycle(p)} style={{
                            backgroundColor: COLOURS.NAVY, color: COLOURS.CARD, border: "none", borderRadius: RADII.PILL,
                            padding: "6px 14px", fontSize: "12px", fontWeight: 600, cursor: "pointer", marginBottom: "12px",
                          }}>Start new cycle</button>
                        )}

                        {/* Stage checklist */}
                        {tasksLoading === p.id ? <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>Loading stages…</p> : stageNos.map((sn) => {
                          const stageTasks = tasks.filter((t) => t.stage_no === sn);
                          const allDone = stageTasks.every((t) => t.status === "Completed");
                          const anyStarted = stageTasks.some((t) => t.status !== "Not Started");
                          const stageDays = stageTasks.reduce((s, t) => s + (Number(t.total_days) || 0), 0);
                          const dot = allDone ? COLOURS.GREEN : anyStarted ? COLOURS.AMBER : COLOURS.SLATE;
                          return (
                            <div key={sn} style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, backgroundColor: COLOURS.CARD, marginBottom: "6px", overflow: "hidden" }}>
                              <div style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: stageTasks.length > 0 ? `1px solid ${COLOURS.HAIRLINE}` : "none" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: dot }} />
                                  <span style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>{sn}. {STAGE_LABELS[sn]}</span>
                                </div>
                                <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{stageDays > 0 ? `${stageDays} day${stageDays > 1 ? "s" : ""}` : ""}</span>
                              </div>
                              {stageTasks.map((t) => {
                                const people = [t.responsible, t.responsible_2].filter(Boolean).join(" + ");
                                const dayBits = [t.days, t.days_2].filter((d) => d !== null && d !== undefined).map(String).join(" + ");
                                return (
                                  <div key={t.id} style={{ padding: "7px 12px 7px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", borderBottom: `1px solid ${COLOURS.TRACK}` }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontSize: "13px", color: COLOURS.NAVY }}>{t.sub_task || STAGE_LABELS[t.stage_no]}</div>
                                      <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "1px" }}>
                                        {people || "Unassigned"}{dayBits ? ` · ${dayBits} day${(Number(t.days) || 0) + (Number(t.days_2) || 0) > 1 ? "s" : ""}` : ""}
                                      </div>
                                    </div>
                                    {canEdit ? (
                                      <select
                                        value={t.status}
                                        disabled={savingTaskId === t.id}
                                        onChange={(e) => updateTaskStatus(t, e.target.value)}
                                        style={{
                                          padding: "4px 8px", fontSize: "12px", fontWeight: 600, borderRadius: RADII.SM,
                                          border: `1px solid ${COLOURS.HAIRLINE}`, cursor: "pointer",
                                          color: t.status === "Completed" ? COLOURS.GREEN : t.status === "In Progress" ? COLOURS.AMBER : COLOURS.SLATE,
                                          backgroundColor: COLOURS.CARD,
                                        }}>
                                        {TASK_STATUSES.map((s) => <option key={s}>{s}</option>)}
                                      </select>
                                    ) : (
                                      <span style={{ fontSize: "12px", fontWeight: 600, color: t.status === "Completed" ? COLOURS.GREEN : t.status === "In Progress" ? COLOURS.AMBER : COLOURS.SLATE }}>{t.status}</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })
      )}

      {/* Pre-audit daily activities — reference panel */}
      {dailyFiltered.length > 0 && (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD, overflow: "hidden", marginTop: "4px" }}>
          <div onClick={() => setDailyOpen(!dailyOpen)} style={{ padding: "10px 18px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: COLOURS.CARD_ALT }}>
            <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.INK_700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Pre-Audit Activities (Daily Basis)</span>
            <span style={{ fontSize: "13px", color: COLOURS.SLATE }}>{dailyFiltered.length} activit{dailyFiltered.length > 1 ? "ies" : "y"} {dailyOpen ? "▲" : "▼"}</span>
          </div>
          {dailyOpen && (
            <div>
              {planCompanies.filter((c) => dailyFiltered.some((d) => d.company_id === c.id)).map((c) => (
                <div key={c.id}>
                  {companyFilter === "all" && (
                    <div style={{ padding: "6px 18px", fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>{c.name}</div>
                  )}
                  {dailyFiltered.filter((d) => d.company_id === c.id).map((d) => (
                    <div key={d.id} style={{ padding: "8px 18px", borderTop: `1px solid ${COLOURS.TRACK}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "13px", color: COLOURS.NAVY }}>{d.s_no}. {d.activity}{d.note ? ` (${d.note})` : ""}</span>
                      <span style={{ fontSize: "12px", color: COLOURS.SLATE, whiteSpace: "nowrap" }}>
                        Daily basis{d.transferred_to ? ` · responsibility → ${d.transferred_to}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
