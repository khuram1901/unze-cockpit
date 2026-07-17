"use client";

// Annual Internal Audit Plan — team-based view (approved redesign 18/07/2026).
// Three audit teams (pairs): Unze Trading, Imperial, Restaurants (HD + Baranh).
// CEO/Admin + audit manager see all teams, the stuck strip, and can edit team
// membership; team members see only their own team's checklist and update
// sub-tasks with Start / Mark done. Dates record automatically; anything over
// its day budget or idle 5+ days is flagged as stuck.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { COMPANIES } from "../../lib/constants";
import { formatDateUK } from "../../lib/dateUtils";
import DateInputWithCalendar from "../../lib/DateInputWithCalendar";
import { useMobile } from "../../lib/useMobile";
import { COLOURS, RADII, SectionTitle, WARNING_BANNER_STYLE, WARNING_TITLE_COLOR } from "../../lib/SharedUI";
import { logAction } from "../../lib/audit-log";
import { widgetVisible } from "../../lib/permissions";
import type { UserCtx } from "../../lib/permissions";
import { useUserCtx } from "../../lib/useUserCtx";

const STAGE_LABELS: Record<number, string> = {
  1: "Audit Planning",
  2: "Data Collection",
  3: "Data Verification",
  4: "Draft Audit Findings",
  5: "Review of IA Report",
  6: "Communication to Process Owner",
  7: "Submission to Senior Management",
};

const FREQ_BADGE: Record<string, { bg: string; text: string }> = {
  Monthly:         { bg: "#EEF1FC", text: COLOURS.BLUE },
  Quarterly:       { bg: COLOURS.WARNING_SOFT, text: COLOURS.AMBER },
  "Semi-annually": { bg: "#F3EEF9", text: "#6E45B8" },
  Annually:        { bg: COLOURS.SUCCESS_SOFT, text: COLOURS.GREEN },
};

type Viewer = { is_manager: boolean; team_id: string | null };

type Team = {
  id: string; code: string; name: string; sort_order: number;
  members: { id: string; name: string }[];
  company_ids: string[];
  done: number; running: number; total: number; stuck: number; overdue: number;
  next_target: string | null;
};

type StuckItem = {
  team_id: string; process_id: string; process_name: string; company_id: string;
  stage_no: number; stage_label: string; sub_task: string | null; who: string;
  days_in: number | null; total_days: number | null; over_days: number; idle_days: number | null;
};

type PlanProcess = {
  id: string; company_id: string; team_id: string; s_no: number; process_name: string;
  frequency: string; period_label: string | null; status: string; status_note: string | null;
  target_date: string | null; next_period_label: string | null; next_target_date: string | null;
  total_days: number; done_days: number; current_stage_no: number | null;
  started_on: string | null; stuck_count: number; completion_pct: number;
};

type StageTask = {
  id: string; process_id: string; stage_no: number; stage_label: string; sub_task: string | null;
  responsible: string | null; responsible_2: string | null; days: number | null; days_2: number | null;
  total_days: number | null; sort_order: number; status: string;
  started_at: string | null; completed_at: string | null;
};

type DailyActivity = {
  id: string; company_id: string; s_no: number; activity: string;
  transferred_to: string | null; note: string | null;
};

type AuditMember = { id: string; name: string; team_id: string | null };

const today = new Date().toISOString().slice(0, 10);

function daysBetween(fromIso: string): number {
  return Math.max(1, Math.ceil((Date.now() - new Date(fromIso).getTime()) / 86400000));
}
function overdueDays(targetDate: string | null): number {
  if (!targetDate || targetDate >= today) return 0;
  return Math.floor((new Date(today + "T00:00:00").getTime() - new Date(targetDate + "T00:00:00").getTime()) / 86400000);
}
const microLbl: React.CSSProperties = {
  fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE,
  textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "3px",
};
const inp: React.CSSProperties = {
  display: "block", width: "100%", padding: "7px 10px", marginTop: "3px",
  border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, fontSize: "14px",
  boxSizing: "border-box", color: COLOURS.NAVY,
};
const btnPrimary: React.CSSProperties = {
  backgroundColor: COLOURS.GREEN, color: "#FFFFFF", border: "none", borderRadius: RADII.PILL,
  padding: "5px 12px", fontSize: "12px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
};
const btnGhost: React.CSSProperties = {
  backgroundColor: COLOURS.CARD, color: COLOURS.NAVY, border: `1px solid ${COLOURS.HAIRLINE}`,
  borderRadius: RADII.PILL, padding: "5px 12px", fontSize: "12px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
};

function shortCode(companyId: string): string {
  return COMPANIES.find((c) => c.id === companyId)?.shortCode || "—";
}

function StatusPill({ status, pct }: { status: string; pct: number }) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    "In Progress": { bg: COLOURS.WARNING_SOFT, text: COLOURS.AMBER, label: `In progress · ${pct}%` },
    Planned:       { bg: "#EEF1FC", text: COLOURS.BLUE, label: "Planned" },
    Completed:     { bg: COLOURS.SUCCESS_SOFT, text: COLOURS.GREEN, label: "✓ Done" },
    Cancelled:     { bg: COLOURS.HAIRLINE, text: COLOURS.SLATE, label: "Cancelled" },
  };
  const s = map[status] || map.Planned;
  return (
    <span style={{ fontSize: "12px", fontWeight: 600, padding: "3px 10px", borderRadius: RADII.PILL, backgroundColor: s.bg, color: s.text, whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}

export default function AnnualAuditPlan({ userCtx, showMsg }: { userCtx: UserCtx | null; showMsg: (text: string) => void }) {
  const isMobile = useMobile();
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [stuck, setStuck] = useState<StuckItem[]>([]);
  const [processes, setProcesses] = useState<PlanProcess[]>([]);
  const [auditMembers, setAuditMembers] = useState<AuditMember[]>([]);
  const [daily, setDaily] = useState<DailyActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tasksByProcess, setTasksByProcess] = useState<Record<string, StageTask[]>>({});
  const [tasksLoading, setTasksLoading] = useState<string | null>(null);
  const [dailyOpen, setDailyOpen] = useState(false);
  const [teamEditOpen, setTeamEditOpen] = useState(false);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const { ctx: widgetCtx } = useUserCtx();
  const wv = (key: string, def: boolean) => !!widgetCtx && widgetVisible(widgetCtx, key, def);

  const isManager = !!viewer?.is_manager;
  const canUpdate = isManager || (!!userCtx && userCtx.department === "Audit");

  const loadOverview = useCallback(async () => {
    const { data, error } = await supabase.rpc("audit_team_overview");
    if (!error && data && !data.error) {
      setViewer(data.viewer as Viewer);
      setTeams((data.teams as Team[]) || []);
      setStuck((data.stuck as StuckItem[]) || []);
      setProcesses((data.processes as PlanProcess[]) || []);
      setAuditMembers((data.audit_members as AuditMember[]) || []);
      setSelectedTeamId((prev) => prev || (data.viewer?.team_id as string) || ((data.teams as Team[]) || [])[0]?.id || null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadOverview(); }, [loadOverview]);

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
      .select("id, process_id, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order, status, started_at, completed_at")
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

  async function setTaskStatus(task: StageTask, newStatus: string) {
    setSavingTaskId(task.id);
    const updates: Record<string, unknown> = {
      status: newStatus,
      updated_by: userCtx?.email || null,
      updated_at: new Date().toISOString(),
    };
    if (newStatus === "In Progress" && !task.started_at) updates.started_at = new Date().toISOString();
    updates.completed_at = newStatus === "Completed" ? new Date().toISOString() : null;
    const { error } = await supabase.from("audit_stage_tasks").update(updates).eq("id", task.id);
    setSavingTaskId(null);
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Updated", "audit_stage_tasks", `${task.stage_label}${task.sub_task ? ` — ${task.sub_task}` : ""} → ${newStatus}`, task.id);
    await loadTasks(task.process_id);
    loadOverview();
  }

  async function updateProcessField(id: string, field: string, value: unknown) {
    const { error } = await supabase.from("audit_plan_processes").update({ [field]: value, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Updated", "audit_plan_processes", `${field} → ${value}`, id);
    loadOverview();
  }

  async function startNewCycle(p: PlanProcess) {
    if (!window.confirm(`Start a new ${p.frequency.toLowerCase()} cycle for "${p.process_name}"? All steps reset to not started.`)) return;
    const { error } = await supabase.rpc("audit_start_new_cycle", { p_process_id: p.id });
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Updated", "audit_plan_processes", `New cycle started — ${p.process_name}`, p.id);
    setTasksByProcess((prev) => { const n = { ...prev }; delete n[p.id]; return n; });
    showMsg("New cycle started.");
    loadOverview();
  }

  async function assignTeam(memberId: string, teamId: string | null) {
    const { error } = await supabase.rpc("audit_assign_team", { p_member_id: memberId, p_team_id: teamId });
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Updated", "audit_team_members", `member ${memberId} → team ${teamId || "none"}`);
    loadOverview();
  }

  if (loading) return <p style={{ color: COLOURS.SLATE }}>Loading audit plan…</p>;

  const selectedTeam = teams.find((t) => t.id === selectedTeamId) || teams[0] || null;
  const teamProcesses = processes.filter((p) => p.team_id === selectedTeam?.id);
  const visibleCompanyIds = new Set(teams.flatMap((t) => t.company_ids));
  const dailyVisible = daily.filter((d) => visibleCompanyIds.has(d.company_id));
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name || "";

  const statusOrder = ["In Progress", "Planned", "Completed", "Cancelled"];
  const sorted = [...teamProcesses].sort((a, b) =>
    statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status) || a.company_id.localeCompare(b.company_id) || a.s_no - b.s_no);

  return (
    <section style={{ marginBottom: "22px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "8px", marginBottom: "10px" }}>
        <SectionTitle title="Annual Internal Audit Plan" />
        <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>FY 2025-26 · year end closed 30/06/2026</span>
      </div>

      {/* ═══ Stuck strip — managers only ═══ */}
      {isManager && wv("dept_audit.stuck_strip", true) && stuck.length > 0 && (
        <div style={{ ...WARNING_BANNER_STYLE, marginBottom: "14px" }}>
          <div style={{ padding: "12px 16px" }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: WARNING_TITLE_COLOR, marginBottom: "6px" }}>
              ⚠ Where teams are stuck ({stuck.length})
            </div>
            {stuck.slice(0, 6).map((s, i) => (
              <div key={i} onClick={() => { const t = teams.find((x) => x.id === s.team_id); if (t) setSelectedTeamId(t.id); toggleExpand(s.process_id); }}
                style={{ fontSize: "13px", color: WARNING_TITLE_COLOR, padding: "3px 0", cursor: "pointer" }}>
                {teamName(s.team_id)} · {s.process_name} ({shortCode(s.company_id)}) · {s.sub_task || s.stage_label} — {" "}
                {s.over_days > 0
                  ? <>{s.days_in} days in, budget was {s.total_days ?? 0} <strong>({s.over_days} over)</strong></>
                  : <>no update for {s.idle_days} days</>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ Team cards — managers see all three ═══ */}
      {isManager && wv("dept_audit.team_cards", true) && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "8px" }}>
            {teams.map((t) => {
              const active = t.id === selectedTeam?.id;
              return (
                <div key={t.id} onClick={() => { setSelectedTeamId(t.id); setExpandedId(null); }} style={{
                  backgroundColor: COLOURS.CARD, borderRadius: RADII.CARD, padding: "14px 16px", cursor: "pointer",
                  border: active ? `2px solid ${COLOURS.NAVY}` : `1px solid ${COLOURS.HAIRLINE}`,
                }}>
                  <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY }}>{t.name}</div>
                  <div style={{ fontSize: "12px", color: COLOURS.SLATE, margin: "2px 0 8px" }}>
                    {t.members.length > 0 ? t.members.map((m) => m.name.split(" ")[0]).join(" + ") : "No members assigned"} · {t.company_ids.map(shortCode).join(" + ")}
                  </div>
                  <div style={{ height: "6px", backgroundColor: COLOURS.TRACK, borderRadius: RADII.PILL, marginBottom: "8px" }}>
                    <div style={{ width: `${t.total > 0 ? Math.round((100 * t.done) / t.total) : 0}%`, height: "100%", backgroundColor: COLOURS.GREEN, borderRadius: RADII.PILL }} />
                  </div>
                  <div style={{ display: "flex", gap: "10px", fontSize: "12px", flexWrap: "wrap" }}>
                    <span style={{ color: COLOURS.GREEN, fontWeight: 600 }}>{t.done} done</span>
                    <span style={{ color: COLOURS.AMBER, fontWeight: 600 }}>{t.running} running</span>
                    <span style={{ color: t.stuck > 0 ? COLOURS.RED : COLOURS.SLATE, fontWeight: 600 }}>{t.stuck} stuck</span>
                    {t.overdue > 0 && <span style={{ color: COLOURS.RED, fontWeight: 600 }}>{t.overdue} overdue</span>}
                    {t.next_target && <span style={{ color: COLOURS.SLATE }}>next {formatDateUK(t.next_target)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "10px" }}>
            <button onClick={() => setTeamEditOpen(!teamEditOpen)} style={btnGhost}>{teamEditOpen ? "Close team editor" : "Edit team members"}</button>
          </div>
          {teamEditOpen && (
            <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD, padding: "14px 16px", marginBottom: "14px" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "8px" }}>Assign audit members to teams</div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "8px" }}>
                {auditMembers.map((m) => (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                    <span style={{ fontSize: "13px", color: COLOURS.NAVY }}>{m.name}</span>
                    <select value={m.team_id || ""} onChange={(e) => assignTeam(m.id, e.target.value || null)}
                      style={{ ...inp, width: "auto", marginTop: 0, padding: "5px 8px", fontSize: "13px" }}>
                      <option value="">— No team —</option>
                      {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══ Member banner — team members see only their team ═══ */}
      {!isManager && selectedTeam && (
        <div style={{ backgroundColor: "#EEF1FC", borderRadius: RADII.SM, padding: "10px 14px", marginBottom: "14px", fontSize: "13px", color: COLOURS.BLUE }}>
          Your team: <strong>{selectedTeam.name}</strong> · {selectedTeam.company_ids.map(shortCode).join(" + ")} · {selectedTeam.done} of {selectedTeam.total} audits done
        </div>
      )}
      {!isManager && !selectedTeam && (
        <div style={{ backgroundColor: COLOURS.WARNING_SOFT, borderRadius: RADII.SM, padding: "10px 14px", marginBottom: "14px", fontSize: "13px", color: COLOURS.AMBER }}>
          You are not assigned to an audit team yet — ask the audit manager to add you.
        </div>
      )}

      {/* ═══ Team checklist ═══ */}
      {selectedTeam && wv("dept_audit.plan_checklist", true) && (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD, overflow: "hidden", marginBottom: "14px" }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY }}>{selectedTeam.name} — audit checklist</span>
            <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{sorted.length} audits</span>
          </div>

          {sorted.map((p) => {
            const isOpen = expandedId === p.id;
            const od = overdueDays(p.target_date);
            const isOverdue = od > 0 && (p.status === "Planned" || p.status === "In Progress");
            const tasks = tasksByProcess[p.id] || [];
            const stageNos = Array.from(new Set(tasks.map((t) => t.stage_no))).sort((a, b) => a - b);
            const multiCompany = (selectedTeam.company_ids.length > 1);

            return (
              <div key={p.id} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                <div onClick={() => toggleExpand(p.id)} style={{
                  padding: "11px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between",
                  alignItems: "center", gap: "8px",
                  backgroundColor: isOverdue ? COLOURS.DANGER_SOFT : isOpen ? COLOURS.CARD_ALT : COLOURS.CARD,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.s_no}. {p.process_name}{p.period_label ? ` — ${p.period_label}` : ""}{multiCompany ? ` · ${shortCode(p.company_id)}` : ""}
                    </div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ fontSize: "10px", fontWeight: 600, padding: "1px 6px", borderRadius: RADII.PILL, backgroundColor: (FREQ_BADGE[p.frequency] || FREQ_BADGE.Monthly).bg, color: (FREQ_BADGE[p.frequency] || FREQ_BADGE.Monthly).text }}>{p.frequency}</span>
                      {p.started_on && <span>started {formatDateUK(p.started_on)}</span>}
                      {p.status !== "Completed" && p.total_days > 0 && <span>{p.done_days} of {p.total_days} days</span>}
                      {p.target_date && (
                        <span style={{ color: isOverdue ? COLOURS.RED : COLOURS.SLATE, fontWeight: isOverdue ? 600 : 400 }}>
                          target {formatDateUK(p.target_date)}{isOverdue ? ` (${od}d late)` : ""}
                        </span>
                      )}
                      {p.stuck_count > 0 && <span style={{ color: COLOURS.RED, fontWeight: 600 }}>⚠ {p.stuck_count} stuck</span>}
                      {p.status_note && <span style={{ fontStyle: "italic" }}>{p.status_note}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                    <StatusPill status={p.status} pct={p.completion_pct} />
                    <span style={{ color: COLOURS.SLATE, fontSize: "13px" }}>{isOpen ? "▼" : "▶"}</span>
                  </div>
                </div>

                {isOpen && (
                  <div style={{ padding: "14px 16px", backgroundColor: COLOURS.CARD_ALT, borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>
                    {isManager && (
                      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                        <div>
                          <div style={microLbl}>Target date</div>
                          <DateInputWithCalendar style={inp} value={p.target_date || ""} onChange={(e) => updateProcessField(p.id, "target_date", e.target.value || null)} />
                        </div>
                        <div>
                          <div style={microLbl}>Note</div>
                          <input style={inp} defaultValue={p.status_note || ""} placeholder="e.g. Updated till May"
                            onBlur={(e) => { if (e.target.value.trim() !== (p.status_note || "")) updateProcessField(p.id, "status_note", e.target.value.trim() || null); }} />
                        </div>
                        {p.status === "Completed" && (
                          <div style={{ display: "flex", alignItems: "flex-end" }}>
                            <button onClick={() => startNewCycle(p)} style={{ ...btnGhost, backgroundColor: COLOURS.NAVY, color: "#FFFFFF", border: "none" }}>Start new cycle</button>
                          </div>
                        )}
                      </div>
                    )}
                    {(p.next_period_label || p.next_target_date) && (
                      <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginBottom: "10px" }}>
                        Next cycle: {p.next_period_label || "—"}{p.next_target_date ? ` · target ${formatDateUK(p.next_target_date)}` : ""}
                      </div>
                    )}

                    {tasksLoading === p.id ? <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>Loading steps…</p> : stageNos.map((sn) => {
                      const stageTasks = tasks.filter((t) => t.stage_no === sn);
                      const allDone = stageTasks.every((t) => t.status === "Completed");
                      const anyStarted = stageTasks.some((t) => t.status !== "Not Started");
                      const isCurrent = !allDone && (anyStarted || stageNos.filter((n) => n < sn).every((n) => tasks.filter((t) => t.stage_no === n).every((t) => t.status === "Completed")));
                      const stageDays = stageTasks.reduce((s, t) => s + (Number(t.total_days) || 0), 0);
                      const doneDate = allDone ? stageTasks.map((t) => t.completed_at).filter(Boolean).sort().slice(-1)[0] : null;
                      const circle = (bg: string, fg: string, content: React.ReactNode) => (
                        <span style={{ width: "20px", height: "20px", borderRadius: "50%", backgroundColor: bg, color: fg, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, flexShrink: 0 }}>{content}</span>
                      );

                      if (allDone) {
                        return (
                          <div key={sn} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 0" }}>
                            {circle(COLOURS.SUCCESS_SOFT, COLOURS.GREEN, "✓")}
                            <span style={{ fontSize: "13px", color: COLOURS.NAVY, flex: 1 }}>{sn} · {STAGE_LABELS[sn]}</span>
                            <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{doneDate ? `done ${formatDateUK(doneDate.slice(0, 10))} · ` : ""}{stageDays > 0 ? `${stageDays}d` : ""}</span>
                          </div>
                        );
                      }
                      if (!isCurrent && !anyStarted) {
                        return (
                          <div key={sn} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 0" }}>
                            {circle(COLOURS.TRACK, COLOURS.SLATE, sn)}
                            <span style={{ fontSize: "13px", color: COLOURS.SLATE, flex: 1 }}>{sn} · {STAGE_LABELS[sn]}</span>
                            <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{stageDays > 0 ? `${stageDays}d · waiting` : "waiting"}</span>
                          </div>
                        );
                      }
                      return (
                        <div key={sn} style={{ border: `1px solid ${COLOURS.AMBER}55`, borderRadius: RADII.SM, padding: "8px 12px", margin: "6px 0", backgroundColor: COLOURS.CARD }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                            {circle(COLOURS.WARNING_SOFT, COLOURS.AMBER, sn)}
                            <span style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, flex: 1 }}>{STAGE_LABELS[sn]}</span>
                            <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{stageDays > 0 ? `${stageDays} days budgeted` : ""}</span>
                          </div>
                          {stageTasks.map((t) => {
                            const who = [t.responsible, t.responsible_2].filter(Boolean).join(" + ") || "Unassigned";
                            const budget = Number(t.total_days) || 0;
                            const daysIn = t.status === "In Progress" && t.started_at ? daysBetween(t.started_at) : 0;
                            const over = daysIn > budget && budget > 0 ? daysIn - budget : 0;
                            return (
                              <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", padding: "6px 0 6px 28px", borderTop: `1px solid ${COLOURS.TRACK}` }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: "13px", color: COLOURS.NAVY }}>{t.sub_task || STAGE_LABELS[t.stage_no]}</div>
                                  <div style={{ fontSize: "12px", color: over > 0 ? COLOURS.RED : COLOURS.SLATE, marginTop: "1px", fontWeight: over > 0 ? 600 : 400 }}>
                                    {who}
                                    {t.status === "Completed" && t.completed_at && <> · done {formatDateUK(t.completed_at.slice(0, 10))}</>}
                                    {t.status === "In Progress" && t.started_at && <> · started {formatDateUK(t.started_at.slice(0, 10))} · {daysIn} day{daysIn !== 1 ? "s" : ""} in{budget > 0 ? `, budget ${budget}` : ""}{over > 0 ? ` — ${over} over` : ""}</>}
                                    {t.status === "Not Started" && budget > 0 && <> · {budget} day{budget !== 1 ? "s" : ""} budgeted</>}
                                  </div>
                                </div>
                                {canUpdate ? (
                                  t.status === "Not Started" ? (
                                    <button disabled={savingTaskId === t.id} onClick={() => setTaskStatus(t, "In Progress")} style={btnGhost}>Start</button>
                                  ) : t.status === "In Progress" ? (
                                    <button disabled={savingTaskId === t.id} onClick={() => setTaskStatus(t, "Completed")} style={btnPrimary}>✓ Mark done</button>
                                  ) : (
                                    <button disabled={savingTaskId === t.id} onClick={() => setTaskStatus(t, "In Progress")}
                                      style={{ ...btnGhost, border: "none", color: COLOURS.SLATE, textDecoration: "underline", padding: "2px 4px" }}>reopen</button>
                                  )
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
      )}

      {/* ═══ Pre-audit daily activities — reference panel ═══ */}
      {wv("dept_audit.daily_activities", true) && dailyVisible.length > 0 && (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD, overflow: "hidden" }}>
          <div onClick={() => setDailyOpen(!dailyOpen)} style={{ padding: "10px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: COLOURS.CARD_ALT }}>
            <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.INK_700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Pre-audit activities (daily basis)</span>
            <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{dailyVisible.length} · {dailyOpen ? "▲" : "▼"}</span>
          </div>
          {dailyOpen && COMPANIES.filter((c) => dailyVisible.some((d) => d.company_id === c.id)).map((c) => (
            <div key={c.id}>
              <div style={{ padding: "6px 16px", fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>{c.name}</div>
              {dailyVisible.filter((d) => d.company_id === c.id).map((d) => (
                <div key={d.id} style={{ padding: "7px 16px", borderTop: `1px solid ${COLOURS.TRACK}`, display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "13px" }}>
                  <span style={{ color: COLOURS.NAVY }}>{d.s_no}. {d.activity}{d.note ? ` (${d.note})` : ""}</span>
                  <span style={{ color: COLOURS.SLATE, whiteSpace: "nowrap", fontSize: "12px" }}>{d.transferred_to ? `responsibility → ${d.transferred_to}` : "daily"}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
