"use client";

// Annual Internal Audit Plan — v3 (Shahid's Recommendation.docx, 18/07/2026).
// Pre-audit / post-audit split: three post-audit members (Amina/Unze,
// Junaid/Imperial, Khizar/Hospitality) run Audit Projects; the Pre-audit team
// (Fraz, Attia, Abdul Rehman) records the number of unapproved documents
// (PO / AP / Outgoing / Bank portal / JE) at close of business daily — target
// zero. Managers see all teams, the stuck strip, and can edit project titles,
// steps, responsibles, day budgets and daily-task assignments.

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

const DOC_TYPE_LABELS: Record<string, string> = {
  PO: "Purchase orders",
  AP: "Accounts payable",
  OUT: "Outgoing payments",
  BANK: "Bank portal payments",
  JE: "Journal entries",
};

const FREQ_BADGE: Record<string, { bg: string; text: string }> = {
  Monthly:         { bg: "#EEF1FC", text: COLOURS.BLUE },
  Quarterly:       { bg: COLOURS.WARNING_SOFT, text: COLOURS.AMBER },
  "Semi-annually": { bg: "#F3EEF9", text: "#6E45B8" },
  Annually:        { bg: COLOURS.SUCCESS_SOFT, text: COLOURS.GREEN },
};
const FREQUENCIES = ["Monthly", "Quarterly", "Semi-annually", "Annually"];

type Viewer = { is_manager: boolean; team_id: string | null; member_id: string | null; member_company_ids: string[] };

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

type AuditMember = { id: string; name: string; team_id: string | null };

type DailyItem = {
  company_id: string; doc_type: string; activity: string;
  assigned_member_id: string | null; assigned_name: string | null;
  pending: number | null; reason: string | null; recorded_by: string | null; entered: boolean;
};

type DailySummary = {
  as_of: string; items: DailyItem[]; today_total: number;
  entered_count: number; expected_count: number;
  yesterday_total: number | null; week: { date: string; total: number }[];
};

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
const inpSm: React.CSSProperties = { ...inp, marginTop: 0, padding: "4px 8px", fontSize: "13px" };
const btnPrimary: React.CSSProperties = {
  backgroundColor: COLOURS.GREEN, color: "#FFFFFF", border: "none", borderRadius: RADII.PILL,
  padding: "5px 12px", fontSize: "12px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
};
const btnGhost: React.CSSProperties = {
  backgroundColor: COLOURS.CARD, color: COLOURS.NAVY, border: `1px solid ${COLOURS.HAIRLINE}`,
  borderRadius: RADII.PILL, padding: "5px 12px", fontSize: "12px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
};
const btnNavy: React.CSSProperties = {
  backgroundColor: COLOURS.NAVY, color: "#FFFFFF", border: "none", borderRadius: RADII.PILL,
  padding: "6px 14px", fontSize: "12px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
};

function shortCode(companyId: string): string {
  return COMPANIES.find((c) => c.id === companyId)?.shortCode || "—";
}
function companyName(companyId: string): string {
  return COMPANIES.find((c) => c.id === companyId)?.name || "—";
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
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [dailyDraft, setDailyDraft] = useState<Record<string, { pending: string; reason: string }>>({});
  const [dailySaving, setDailySaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tasksByProcess, setTasksByProcess] = useState<Record<string, StageTask[]>>({});
  const [tasksLoading, setTasksLoading] = useState<string | null>(null);
  const [teamEditOpen, setTeamEditOpen] = useState(false);
  const [editStepsFor, setEditStepsFor] = useState<string | null>(null);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [newProj, setNewProj] = useState({ company_id: "", name: "", frequency: "Monthly", period: "", target: "" });
  const [dailyOpen, setDailyOpen] = useState(false);
  const [editingAssignKey, setEditingAssignKey] = useState<string | null>(null);
  const [projectPage, setProjectPage] = useState(0);
  const { ctx: widgetCtx } = useUserCtx();
  const wv = (key: string, def: boolean) => !!widgetCtx && widgetVisible(widgetCtx, key, def);

  const isManager = !!viewer?.is_manager;

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

  const loadDaily = useCallback(async () => {
    const { data, error } = await supabase.rpc("audit_daily_log_summary");
    if (!error && data && !data.error) setDailySummary(data as DailySummary);
  }, []);

  useEffect(() => { loadOverview(); loadDaily(); }, [loadOverview, loadDaily]);

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

  async function updateTaskField(task: StageTask, field: string, value: unknown) {
    const updates: Record<string, unknown> = { [field]: value, updated_at: new Date().toISOString() };
    if (field === "days") updates.total_days = value;
    const { error } = await supabase.from("audit_stage_tasks").update(updates).eq("id", task.id);
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Updated", "audit_stage_tasks", `${field} edited`, task.id);
    await loadTasks(task.process_id);
    loadOverview();
  }

  async function addStep(processId: string, stageNo: number, tasks: StageTask[]) {
    const maxSort = Math.max(0, ...tasks.map((t) => t.sort_order));
    const team = teams.find((t) => t.id === processes.find((p) => p.id === processId)?.team_id);
    const { error } = await supabase.from("audit_stage_tasks").insert({
      process_id: processId, stage_no: stageNo, stage_label: STAGE_LABELS[stageNo],
      sub_task: "New step", responsible: team?.members[0]?.name.split(" ")[0] || null,
      sort_order: maxSort + 1, status: "Not Started",
    });
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Created", "audit_stage_tasks", `New step in ${STAGE_LABELS[stageNo]}`, processId);
    await loadTasks(processId);
    loadOverview();
  }

  async function deleteStep(task: StageTask) {
    if (!window.confirm("Delete this step?")) return;
    const { error } = await supabase.from("audit_stage_tasks").delete().eq("id", task.id);
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Deleted", "audit_stage_tasks", task.sub_task || task.stage_label, task.id);
    await loadTasks(task.process_id);
    loadOverview();
  }

  async function updateProcessField(id: string, field: string, value: unknown) {
    const { error } = await supabase.from("audit_plan_processes").update({ [field]: value, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Updated", "audit_plan_processes", `${field} → ${value}`, id);
    loadOverview();
  }

  async function addProject() {
    if (!newProj.company_id || !newProj.name.trim()) { showMsg("Error: company and project name are required."); return; }
    const sNos = processes.filter((p) => p.company_id === newProj.company_id).map((p) => p.s_no);
    const nextSno = Math.max(0, ...sNos) + 1;
    const { data, error } = await supabase.from("audit_plan_processes").insert({
      company_id: newProj.company_id, s_no: nextSno, process_name: newProj.name.trim(),
      frequency: newProj.frequency, period_label: newProj.period.trim() || null,
      status: "Planned", target_date: newProj.target || null,
    }).select("id").single();
    if (error || !data) { showMsg("Error: " + (error?.message || "could not create")); return; }
    const team = teams.find((t) => t.company_ids.includes(newProj.company_id));
    const postMember = team?.members[0]?.name.split(" ")[0] || null;
    const rows = Object.entries(STAGE_LABELS).map(([no, label], i) => ({
      process_id: data.id, stage_no: Number(no), stage_label: label,
      responsible: Number(no) === 1 || Number(no) >= 5 ? "Shahid" : postMember,
      sort_order: i + 1, status: "Not Started",
    }));
    await supabase.from("audit_stage_tasks").insert(rows);
    logAction("Created", "audit_plan_processes", newProj.name.trim(), data.id);
    setAddProjectOpen(false);
    setNewProj({ company_id: "", name: "", frequency: "Monthly", period: "", target: "" });
    showMsg("Project created.");
    loadOverview();
  }

  async function deleteProcess(id: string, name: string) {
    if (!window.confirm(`Delete "${name}" permanently? This cannot be undone.`)) return;
    const { error } = await supabase.from("audit_plan_processes").delete().eq("id", id);
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Deleted", "audit_plan_processes", name, id);
    if (expandedId === id) setExpandedId(null);
    setTasksByProcess((prev) => { const n = { ...prev }; delete n[id]; return n; });
    showMsg(`"${name}" deleted.`);
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

  async function assignDailyTask(item: DailyItem, memberId: string | null) {
    const { error } = await supabase.from("audit_daily_activities")
      .update({ assigned_member_id: memberId })
      .eq("company_id", item.company_id).eq("doc_type", item.doc_type);
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Updated", "audit_daily_activities", `${item.activity} assigned`);
    loadDaily();
  }

  async function saveDailyCounts() {
    if (!dailySummary) return;
    const rows = Object.entries(dailyDraft)
      .filter(([, v]) => v.pending !== "")
      .map(([key, v]) => {
        const [company_id, doc_type] = key.split("|");
        return {
          company_id, doc_type, log_date: today,
          pending_count: Math.max(0, parseInt(v.pending, 10) || 0),
          reason: v.reason.trim() || null,
          recorded_by: userCtx?.email || null,
        };
      });
    if (rows.length === 0) { showMsg("Nothing to save — enter at least one count."); return; }
    setDailySaving(true);
    const { error } = await supabase.from("audit_daily_approval_log").upsert(rows, { onConflict: "company_id,log_date,doc_type" });
    setDailySaving(false);
    if (error) { showMsg("Error: " + error.message); return; }
    logAction("Updated", "audit_daily_approval_log", `Daily counts saved (${rows.length})`);
    setDailyDraft({});
    showMsg("Today's counts saved.");
    loadDaily();
  }

  if (loading) return <p style={{ color: COLOURS.SLATE }}>Loading audit plan…</p>;

  const selectedTeam = teams.find((t) => t.id === selectedTeamId) || teams[0] || null;
  const isPreauditView = selectedTeam?.code === "PREAUDIT";
  const teamProcesses = processes.filter((p) => p.team_id === selectedTeam?.id);
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name || "";
  const canUpdateTeam = (teamId: string) => isManager || viewer?.team_id === teamId;
  const isPreauditMember = !isManager && teams.length === 1 && teams[0]?.code === "PREAUDIT";
  const canEnterDaily = isManager || isPreauditMember || (!!userCtx && userCtx.department === "Audit");

  const statusOrder = ["In Progress", "Planned", "Completed", "Cancelled"];
  const sorted = [...teamProcesses].sort((a, b) =>
    statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status) || a.company_id.localeCompare(b.company_id) || a.s_no - b.s_no);

  const dailyItems = dailySummary?.items || [];
  const draftKey = (d: DailyItem) => `${d.company_id}|${d.doc_type}`;

  // ═══ Daily entry grid — pass filterCompanyIds to show only that team's companies ═══
  function renderDailyGrid(filterCompanyIds?: string[]) {
    if (!dailySummary) return null;
    const items = filterCompanyIds
      ? dailySummary.items.filter((d) => filterCompanyIds.includes(d.company_id))
      : dailySummary.items;
    const companies = COMPANIES.filter((c) => items.some((d) => d.company_id === c.id));
    const filteredTotal = items.reduce((s, d) => s + (d.pending || 0), 0);
    const filteredEntered = items.filter((d) => d.entered).length;
    const filteredExpected = items.length;
    return (
      <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD, overflow: "hidden", marginBottom: "14px" }}>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
          <div>
            <span style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY }}>Audit Tasks — daily approvals check</span>
            <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>
              Enter the number of unapproved documents at close of business. Target: zero.
              {!filterCompanyIds && dailySummary.yesterday_total !== null && <> Yesterday: <strong style={{ color: dailySummary.yesterday_total > 0 ? COLOURS.RED : COLOURS.GREEN }}>{dailySummary.yesterday_total} pending</strong>.</>}
            </div>
          </div>
          <span style={{ fontSize: "12px", fontWeight: 600, color: filteredEntered < filteredExpected ? COLOURS.AMBER : COLOURS.GREEN }}>
            {filteredEntered}/{filteredExpected} entered today · {filteredTotal} pending
          </span>
        </div>
        {companies.map((c) => (
          <div key={c.id}>
            <div style={{ padding: "7px 16px", fontSize: "11px", fontWeight: 600, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", backgroundColor: COLOURS.CARD_ALT, borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>{c.name}</div>
            {items.filter((d) => d.company_id === c.id).map((d) => {
              const key = draftKey(d);
              const draft = dailyDraft[key] ?? { pending: d.pending !== null ? String(d.pending) : "", reason: d.reason || "" };
              const shownPending = draft.pending;
              return (
                <div key={key} style={{ padding: "8px 16px", borderTop: `1px solid ${COLOURS.TRACK}`, display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: "160px" }}>
                    <div style={{ fontSize: "13px", color: COLOURS.NAVY }}>{DOC_TYPE_LABELS[d.doc_type] || d.activity}</div>
                  </div>
                  {canEnterDaily ? (
                    <>
                      <input type="number" min={0} placeholder="0" value={shownPending}
                        onChange={(e) => setDailyDraft((prev) => ({ ...prev, [key]: { pending: e.target.value, reason: draft.reason } }))}
                        style={{ ...inpSm, width: "70px", textAlign: "center", fontWeight: 600, color: parseInt(shownPending || "0", 10) > 0 ? COLOURS.RED : COLOURS.GREEN }} />
                      {parseInt(shownPending || "0", 10) > 0 && (
                        <input placeholder="Reason (why pending?)" value={draft.reason}
                          onChange={(e) => setDailyDraft((prev) => ({ ...prev, [key]: { pending: draft.pending, reason: e.target.value } }))}
                          style={{ ...inpSm, flex: 1, minWidth: "140px" }} />
                      )}
                      {d.entered && <span style={{ fontSize: "11px", color: COLOURS.GREEN }}>✓ saved</span>}
                    </>
                  ) : (
                    <span style={{ fontSize: "13px", fontWeight: 700, color: (d.pending || 0) > 0 ? COLOURS.RED : COLOURS.GREEN }}>
                      {d.entered ? `${d.pending} pending${d.reason ? ` — ${d.reason}` : ""}` : "not entered yet"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {canEnterDaily && (
          <div style={{ padding: "10px 16px", borderTop: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "flex-end" }}>
            <button disabled={dailySaving} onClick={saveDailyCounts} style={btnNavy}>{dailySaving ? "Saving…" : "Save today's counts"}</button>
          </div>
        )}
      </div>
    );
  }

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

      {/* ═══ Team cards — managers ═══ */}
      {isManager && wv("dept_audit.team_cards", true) && (
        <>
          {/* ═══ Post-audit cards + pre-audit mini cards side by side ═══ */}
          <div style={{ display: "flex", gap: "12px", marginBottom: "8px", flexWrap: isMobile ? "wrap" : "nowrap" }}>
            {teams.filter((t) => t.code !== "PREAUDIT").map((t) => {
              const active = t.id === selectedTeam?.id;
              const preTeam = teams.find((x) => x.code === "PREAUDIT");
              const compItems = dailySummary?.items.filter((d) => t.company_ids.includes(d.company_id)) || [];
              const visibleCompanies = COMPANIES.filter((c) => compItems.some((d) => d.company_id === c.id));
              return (
                <div key={t.id} style={{ display: "flex", gap: "8px", flex: 1, minWidth: isMobile ? "100%" : 0 }}>
                  {/* Post-audit card */}
                  <div onClick={() => { setSelectedTeamId(t.id); setExpandedId(null); setProjectPage(0); }} style={{
                    flex: 2, backgroundColor: COLOURS.CARD, borderRadius: RADII.CARD, padding: "14px 16px", cursor: "pointer",
                    border: active ? `2px solid ${COLOURS.NAVY}` : `1px solid ${COLOURS.HAIRLINE}`,
                  }}>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>{t.name}</div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE, margin: "2px 0 8px" }}>
                      {t.members.length > 0 ? t.members.map((m) => m.name.split(" ")[0]).join(" + ") : "No members"}
                      {t.company_ids.length > 0 && <> · {t.company_ids.map(shortCode).join(" + ")}</>}
                    </div>
                    <div style={{ height: "6px", backgroundColor: COLOURS.TRACK, borderRadius: RADII.PILL, marginBottom: "8px" }}>
                      <div style={{ width: `${t.total > 0 ? Math.round((100 * t.done) / t.total) : 0}%`, height: "100%", backgroundColor: COLOURS.GREEN, borderRadius: RADII.PILL }} />
                    </div>
                    <div style={{ display: "flex", gap: "8px", fontSize: "12px", flexWrap: "wrap" }}>
                      <span style={{ color: COLOURS.GREEN, fontWeight: 600 }}>{t.done} done</span>
                      <span style={{ color: COLOURS.AMBER, fontWeight: 600 }}>{t.running} running</span>
                      <span style={{ color: t.stuck > 0 ? COLOURS.RED : COLOURS.SLATE, fontWeight: 600 }}>{t.stuck} stuck</span>
                      {t.overdue > 0 && <span style={{ color: COLOURS.RED, fontWeight: 600 }}>{t.overdue} overdue</span>}
                    </div>
                  </div>

                  {/* Pre-audit mini card — click to open pre-audit view */}
                  <div onClick={() => { setSelectedTeamId(preTeam?.id || null); setExpandedId(null); setProjectPage(0); }} style={{
                    flex: 1, backgroundColor: COLOURS.CARD, borderRadius: RADII.CARD, padding: "12px 14px", cursor: "pointer",
                    border: `1px solid ${COLOURS.HAIRLINE}`,
                  }}>
                    <div style={{ fontSize: "10px", fontWeight: 600, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "8px" }}>Pre-audit</div>
                    {dailySummary && visibleCompanies.length > 0 ? visibleCompanies.map((c) => {
                      const cItems = compItems.filter((d) => d.company_id === c.id);
                      const cPending = cItems.reduce((s, d) => s + (d.pending || 0), 0);
                      const cEntered = cItems.filter((d) => d.entered).length;
                      const allEntered = cEntered === cItems.length;
                      const color = cPending > 0 ? COLOURS.RED : allEntered ? COLOURS.GREEN : COLOURS.AMBER;
                      return (
                        <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                          <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{c.shortCode}</span>
                          <span style={{ fontSize: "12px", fontWeight: 700, color }}>
                            {cEntered === 0 ? "—" : cPending > 0 ? `${cPending} pending` : "✓ clear"}
                          </span>
                        </div>
                      );
                    }) : (
                      <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>No data</span>
                    )}
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
                    <select value={m.team_id || ""} onChange={(e) => assignTeam(m.id, e.target.value || null)} style={{ ...inpSm, width: "auto" }}>
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

      {/* ═══ Member banner ═══ */}
      {!isManager && selectedTeam && (
        <div style={{ backgroundColor: "#EEF1FC", borderRadius: RADII.SM, padding: "10px 14px", marginBottom: "14px", fontSize: "13px", color: COLOURS.BLUE }}>
          Your team: <strong>{selectedTeam.name}</strong>
          {(viewer?.member_company_ids?.length ?? 0) > 0 && (
            <> · {(viewer!.member_company_ids).map(shortCode).join(" + ")}</>
          )}
          {selectedTeam.code !== "PREAUDIT" && selectedTeam.total > 0 && (
            <> · {selectedTeam.done} of {selectedTeam.total} projects done</>
          )}
        </div>
      )}
      {!isManager && !selectedTeam && (
        <div style={{ backgroundColor: COLOURS.WARNING_SOFT, borderRadius: RADII.SM, padding: "10px 14px", marginBottom: "14px", fontSize: "13px", color: COLOURS.AMBER }}>
          You are not assigned to an audit team yet — ask the audit manager to add you.
        </div>
      )}

      {/* ═══ Pre-audit view: the daily grid IS the main content (all companies) ═══ */}
      {isPreauditView && wv("dept_audit.daily_activities", true) && renderDailyGrid()}

      {/* ═══ Audit Projects — post-audit teams ═══ */}
      {selectedTeam && !isPreauditView && wv("dept_audit.plan_checklist", true) && (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD, overflow: "hidden", marginBottom: "14px" }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
            <span style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY }}>{selectedTeam.name} — Audit Projects</span>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>
                {sorted.length <= 10 ? `${sorted.length} projects` : `${projectPage * 10 + 1}–${Math.min((projectPage + 1) * 10, sorted.length)} of ${sorted.length} projects`}
              </span>
              {isManager && <button onClick={() => setAddProjectOpen(!addProjectOpen)} style={btnGhost}>{addProjectOpen ? "Cancel" : "+ Add project"}</button>}
            </div>
          </div>

          {addProjectOpen && isManager && (
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: COLOURS.CARD_ALT }}>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "10px" }}>
                <div>
                  <div style={microLbl}>Company</div>
                  <select style={inp} value={newProj.company_id} onChange={(e) => setNewProj({ ...newProj, company_id: e.target.value })}>
                    <option value="">— Select —</option>
                    {selectedTeam.company_ids.map((cid) => <option key={cid} value={cid}>{companyName(cid)}</option>)}
                  </select>
                </div>
                <div>
                  <div style={microLbl}>Project name</div>
                  <input style={inp} value={newProj.name} onChange={(e) => setNewProj({ ...newProj, name: e.target.value })} placeholder="e.g. Financial Audit - P&L Audit" />
                </div>
                <div>
                  <div style={microLbl}>Frequency</div>
                  <select style={inp} value={newProj.frequency} onChange={(e) => setNewProj({ ...newProj, frequency: e.target.value })}>
                    {FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
                  </select>
                </div>
                <div>
                  <div style={microLbl}>Period (optional)</div>
                  <input style={inp} value={newProj.period} onChange={(e) => setNewProj({ ...newProj, period: e.target.value })} placeholder="e.g. 4th Quarter" />
                </div>
                <div>
                  <div style={microLbl}>Target date</div>
                  <DateInputWithCalendar style={inp} value={newProj.target} onChange={(e) => setNewProj({ ...newProj, target: e.target.value })} />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <button onClick={addProject} style={btnNavy}>Create project</button>
                </div>
              </div>
            </div>
          )}

          {/* ── Pagination controls ── */}
          {sorted.length > 10 && (
            <div style={{ padding: "10px 16px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", alignItems: "center", justifyContent: "space-between", backgroundColor: COLOURS.CARD_ALT }}>
              <button
                disabled={projectPage === 0}
                onClick={() => { setProjectPage((p) => p - 1); setExpandedId(null); }}
                style={{ ...btnGhost, opacity: projectPage === 0 ? 0.4 : 1, cursor: projectPage === 0 ? "default" : "pointer" }}
              >← Previous</button>
              <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>
                Page {projectPage + 1} of {Math.ceil(sorted.length / 10)}
              </span>
              <button
                disabled={(projectPage + 1) * 10 >= sorted.length}
                onClick={() => { setProjectPage((p) => p + 1); setExpandedId(null); }}
                style={{ ...btnGhost, opacity: (projectPage + 1) * 10 >= sorted.length ? 0.4 : 1, cursor: (projectPage + 1) * 10 >= sorted.length ? "default" : "pointer" }}
              >Next →</button>
            </div>
          )}

          {sorted.slice(projectPage * 10, (projectPage + 1) * 10).map((p) => {
            const isOpen = expandedId === p.id;
            const od = overdueDays(p.target_date);
            const isOverdue = od > 0 && (p.status === "Planned" || p.status === "In Progress");
            const tasks = tasksByProcess[p.id] || [];
            const stageNos = Array.from(new Set(tasks.map((t) => t.stage_no))).sort((a, b) => a - b);
            const multiCompany = selectedTeam.company_ids.length > 1;
            const editSteps = editStepsFor === p.id && isManager;
            const canUpdate = canUpdateTeam(p.team_id);

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
                      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                        <div>
                          <div style={microLbl}>Project title</div>
                          <input style={inp} defaultValue={p.process_name}
                            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== p.process_name) updateProcessField(p.id, "process_name", v); }} />
                        </div>
                        <div>
                          <div style={microLbl}>Period</div>
                          <input style={inp} defaultValue={p.period_label || ""} placeholder="e.g. 3rd Quarter"
                            onBlur={(e) => { if (e.target.value.trim() !== (p.period_label || "")) updateProcessField(p.id, "period_label", e.target.value.trim() || null); }} />
                        </div>
                        <div>
                          <div style={microLbl}>Target date</div>
                          <DateInputWithCalendar style={inp} value={p.target_date || ""} onChange={(e) => updateProcessField(p.id, "target_date", e.target.value || null)} />
                        </div>
                      </div>
                    )}
                    {isManager && (
                      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap", alignItems: "center" }}>
                        <button onClick={() => setEditStepsFor(editSteps ? null : p.id)} style={btnGhost}>{editSteps ? "Done editing steps" : "Edit steps"}</button>
                        {p.status === "Completed" && <button onClick={() => startNewCycle(p)} style={btnNavy}>Start new cycle</button>}
                        <button onClick={() => deleteProcess(p.id, `${p.process_name}${p.period_label ? ` — ${p.period_label}` : ""}`)}
                          style={{ ...btnGhost, marginLeft: "auto", color: COLOURS.RED, borderColor: `${COLOURS.RED}55` }}>
                          Delete project
                        </button>
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

                      const renderTaskRow = (t: StageTask) => {
                        const who = [t.responsible, t.responsible_2].filter(Boolean).join(" + ") || "Unassigned";
                        const budget = Number(t.total_days) || 0;
                        const daysIn = t.status === "In Progress" && t.started_at ? daysBetween(t.started_at) : 0;
                        const over = daysIn > budget && budget > 0 ? daysIn - budget : 0;
                        if (editSteps) {
                          return (
                            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 0 6px 28px", borderTop: `1px solid ${COLOURS.TRACK}`, flexWrap: "wrap" }}>
                              <input style={{ ...inpSm, flex: 2, minWidth: "150px" }} defaultValue={t.sub_task || ""} placeholder="Step description"
                                onBlur={(e) => { if (e.target.value.trim() !== (t.sub_task || "")) updateTaskField(t, "sub_task", e.target.value.trim() || null); }} />
                              <input style={{ ...inpSm, width: "110px" }} defaultValue={t.responsible || ""} placeholder="Responsible"
                                onBlur={(e) => { if (e.target.value.trim() !== (t.responsible || "")) updateTaskField(t, "responsible", e.target.value.trim() || null); }} />
                              <input style={{ ...inpSm, width: "60px", textAlign: "center" }} type="number" min={0} defaultValue={budget || ""} placeholder="Days"
                                onBlur={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); if (v !== (t.total_days ?? null)) updateTaskField(t, "days", v); }} />
                              {t.status === "Not Started" && <button onClick={() => deleteStep(t)} style={{ ...btnGhost, color: COLOURS.RED, borderColor: `${COLOURS.RED}44` }}>Delete</button>}
                            </div>
                          );
                        }
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
                      };

                      if (allDone && !editSteps) {
                        return (
                          <div key={sn} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 0" }}>
                            {circle(COLOURS.SUCCESS_SOFT, COLOURS.GREEN, "✓")}
                            <span style={{ fontSize: "13px", color: COLOURS.NAVY, flex: 1 }}>{sn} · {STAGE_LABELS[sn]}</span>
                            <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{doneDate ? `done ${formatDateUK(doneDate.slice(0, 10))} · ` : ""}{stageDays > 0 ? `${stageDays}d` : ""}</span>
                          </div>
                        );
                      }
                      if (!isCurrent && !anyStarted && !editSteps) {
                        return (
                          <div key={sn} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 0" }}>
                            {circle(COLOURS.TRACK, COLOURS.SLATE, sn)}
                            <span style={{ fontSize: "13px", color: COLOURS.SLATE, flex: 1 }}>{sn} · {STAGE_LABELS[sn]}</span>
                            <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{stageDays > 0 ? `${stageDays}d · waiting` : "waiting"}</span>
                          </div>
                        );
                      }
                      return (
                        <div key={sn} style={{ border: `1px solid ${editSteps ? COLOURS.HAIRLINE : COLOURS.AMBER + "55"}`, borderRadius: RADII.SM, padding: "8px 12px", margin: "6px 0", backgroundColor: COLOURS.CARD }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                            {circle(editSteps ? COLOURS.TRACK : COLOURS.WARNING_SOFT, editSteps ? COLOURS.SLATE : COLOURS.AMBER, sn)}
                            <span style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, flex: 1 }}>{STAGE_LABELS[sn]}</span>
                            <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>{stageDays > 0 ? `${stageDays} days budgeted` : ""}</span>
                            {editSteps && <button onClick={() => addStep(p.id, sn, tasks)} style={btnGhost}>+ Add step</button>}
                          </div>
                          {stageTasks.map(renderTaskRow)}
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

      {/* ═══ Daily approvals check — collapsible card for managers on post-audit view ═══ */}
      {!isPreauditView && isManager && wv("dept_audit.daily_activities", true) && (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden", marginBottom: "14px" }}>
          <button
            onClick={() => setDailyOpen((o) => !o)}
            style={{
              width: "100%", background: "none", border: "none", cursor: "pointer",
              padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px",
              backgroundColor: dailyOpen ? COLOURS.CARD_ALT : COLOURS.CARD,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>Daily Approvals Check</span>
              {dailySummary && (
                <span style={{
                  fontSize: "11px", fontWeight: 700, padding: "2px 9px", borderRadius: RADII.PILL,
                  backgroundColor: dailySummary.today_total > 0 ? "#FEE2E2" : COLOURS.SUCCESS_SOFT,
                  color: dailySummary.today_total > 0 ? COLOURS.RED : COLOURS.GREEN,
                }}>
                  {dailySummary.today_total === 0 ? "✓ All clear" : `${dailySummary.today_total} pending`}
                </span>
              )}
              {dailySummary && (
                <span style={{ fontSize: "12px", color: COLOURS.SLATE }}>
                  {dailySummary.entered_count}/{dailySummary.expected_count} entries today
                </span>
              )}
            </div>
            <span style={{ fontSize: "12px", color: COLOURS.SLATE, flexShrink: 0 }}>{dailyOpen ? "▲ Hide" : "▼ Show"}</span>
          </button>
          {dailyOpen && <div style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>{renderDailyGrid(selectedTeam?.company_ids)}</div>}
        </div>
      )}
    </section>
  );
}
