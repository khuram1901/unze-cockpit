"use client";

import React, { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { supabase, authFetch } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import { downloadCSV } from "../lib/exportUtils";
import ImportExportButtons from "../lib/ImportExportButtons";
import { COLOURS, RADII, cardStyle, StatusBadge, PriorityBadge, useToast, ErrorBanner, SkeletonRows, TASK_COMPANY_CODES, TASK_DESCRIPTION_LIMIT } from "../lib/SharedUI";
import { useMobile } from "../lib/useMobile";
import { canCompleteSubmittedTask, canReopenCompletedTask, myIdentityEmails, filterAssignableMembers } from "../lib/permissions";
import { routeSubmittedTask } from "../lib/taskRouting";
import TeamStats from "./TeamStats";
import TaskDetailModal from "./TaskDetailModal";
import MiniSubtaskToggle from "./MiniSubtaskToggle";
import TasksBoard from "./TasksBoard";
import RecurringTasksPanel from "./RecurringTasksPanel";

type Task = {
  id: string;
  task_type: string | null;
  description: string;
  project: string | null;
  priority: string | null;
  due_date: string | null;
  original_due_date: string | null;
  assigned_date: string | null;
  assigned_to: string | null;
  assigned_to_email: string | null;
  assigned_by: string | null;
  assigned_by_email: string | null;
  status: string;
  stage: string | null;
  stuck_reason: string | null;
  notes: string | null;
  reply_required: boolean | null;
  reply_text: string | null;
  reply_by: string | null;
  reply_at: string | null;
  corrective_action: string | null;
  recovery_date: string | null;
  impact_on_monthly_target: string | null;
  meeting_id: string | null;
  time_spent_minutes: number | null;
  whatsapp_auto_remind: boolean;
  created_at: string | null;
  completed_at: string | null;
  assigned_to_department: string | null;
  company_id: string | null;
  // Khuram (17/07/2026): false = self-created task, can be closed
  // directly by the assignee — no Submitted step, no manager sign-off.
  // See migration 143.
  requires_manager_signoff?: boolean | null;
  explanation_required?: boolean | null;
  submitted_by_name?: string | null;
  submitted_by_email?: string | null;
  // Waiting Reply routing fields (migration 189)
  waiting_reply_note?: string | null;
  waiting_reply_to_email?: string | null;
  waiting_reply_to_name?: string | null;
  waiting_reply_by_email?: string | null;
  waiting_reply_by_name?: string | null;
  manager_reply_text?: string | null;
  manager_reply_at?: string | null;
  task_subtasks?: { id: string; is_complete: boolean }[];
  task_comments?: { id: string }[];
};

type CompanyLite = { id: string; name: string; short_code: string | null };

// Kept in sync with TaskStatus.tsx / NewTaskForm.tsx's own STATUSES list —
// used here only for the bulk-change dropdown. "Completed" is deliberately
// left out: bulk status change is a raw, ungated update with no per-task
// HOD check, so it can't be allowed to touch Completed at all now that
// only the assignee's HOD (or Executive, for Khuram/Kamran's queue) can
// close a task — see canCompleteSubmittedTask in lib/permissions.ts.
// "Cancelled" removed per Khuram (24/07/2026) — no longer a selectable
// status anywhere; the 4 historical Cancelled tasks keep their status.
const STATUS_OPTIONS = ["Not Started", "In Progress", "Waiting Reply", "Stuck", "Submitted"];

const COMPANY_BADGE_COLOURS: Record<string, { color: string; background: string }> = {
  UTPL: { color: COLOURS.BLUE, background: COLOURS.INFO_SOFT },
  IFPL: { color: COLOURS.GREEN, background: COLOURS.SUCCESS_SOFT },
  BRNH: { color: COLOURS.AMBER, background: COLOURS.WARNING_SOFT },
  HD:   { color: "#6E45B8", background: "#F3EEF9" },
  DIR:  { color: COLOURS.SLATE, background: COLOURS.HAIRLINE },
};

type KpiSummary = {
  open_count: number;
  overdue_count: number;
  due_today_count: number;
  waiting_reply_count: number;
  stuck_count: number;
  completed_count: number;
  urgent_open_count: number;
};

type DeptBreakdownRow = { department: string; open_count: number; overdue_count: number };

const todayStr = new Date().toISOString().slice(0, 10);

function isOverdue(task: Task) {
  if (task.status === "Completed" || task.status === "Cancelled") return false;
  if (!task.due_date) return false;
  return task.due_date < todayStr;
}

function daysOverdue(task: Task): number {
  if (!task.due_date || !isOverdue(task)) return 0;
  return Math.floor((Date.now() - new Date(task.due_date + "T00:00:00").getTime()) / 86400000);
}

// Some member records were imported with stray double spaces in their name
// (e.g. "Muhammad  Shakeel") that a browser collapses when rendering text,
// so it looks fine on screen — but a handful of tasks were entered with a
// single-spaced "Muhammad Shakeel" instead, and since the Owner dropdown
// dedupes on the raw string, the same person showed up twice. Comparing
// (and building option lists) on the normalized form fixes it regardless
// of which spacing any individual row happens to have.
function normName(s: string | null | undefined): string {
  return (s || "").trim().replace(/\s+/g, " ");
}

function getWeekStart(d: Date): string {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  return monday.toISOString().slice(0, 10);
}

// getMonthLabel/getQuarterLabel removed — labels now come straight from
// get_tasks_monthly_chart()/get_tasks_quarterly_chart() (migration 102).

export default function TasksList({ currentRole, canSeeAll, canReview, canDelete, canImport, department }: { currentRole: string; canSeeAll?: boolean; canReview?: boolean; canDelete?: boolean; canImport?: boolean; department?: string | null }) {
  const isMobile = useMobile();
  const searchParams = useSearchParams();
  const taskIdFromUrl = searchParams.get("task");
  // Khuram (18/07/2026): the notification bell deep-links here with
  // ?filter=overdue|waiting|exception|submitted&scope=mine so clicking a
  // bell item actually narrows the page down to that item, instead of
  // dumping the whole Tasks list on you. Read once on mount to seed the
  // matching filter state below.
  const filterFromUrl = searchParams.get("filter");
  const scopeFromUrl = searchParams.get("scope");
  const toast = useToast();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(taskIdFromUrl);
  // Board/Tree/List/Timeline are the icon-switcher views; Team/Recurring
  // stay as separate pills since they aren't task-list views. Weekly/
  // Monthly/Quarterly were removed as separate tabs — folded into the
  // periodFilter dropdown below instead, per Khuram.
  const [timeView, setTimeView] = useState<"list" | "board" | "tree" | "timeline" | "team" | "recurring">("list");
  const [filter, setFilter] = useState<"all" | "overdue" | "waiting" | "exception" | "submitted">(
    filterFromUrl === "overdue" || filterFromUrl === "waiting" || filterFromUrl === "exception" || filterFromUrl === "submitted" ? filterFromUrl : "all"
  );
  const [memberPhones, setMemberPhones] = useState<Record<string, string>>({});
  const [companies, setCompanies] = useState<CompanyLite[]>([]);
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [allDepartments, setAllDepartments] = useState<string[]>([]);
  const [kpi, setKpi] = useState<KpiSummary | null>(null);
  const [deptBreakdown, setDeptBreakdown] = useState<DeptBreakdownRow[]>([]);
  const [deptBreakdownOpen, setDeptBreakdownOpen] = useState(false);
  const [kpiDrawer, setKpiDrawer] = useState<string | null>(null);
  // Default to "mine" — the CEO lands on their own action items first,
  // not the whole company's task list. "Everyone" is one tap away.
  const [myTasksScope, setMyTasksScope] = useState<"mine" | "everyone">(scopeFromUrl === "everyone" ? "everyone" : "mine");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [periodFilter, setPeriodFilter] = useState<"all" | "week" | "month" | "quarter">("all");
  // Filter panel used to be collapsed behind a "Filters" toggle button —
  // Khuram asked for that reverted, so the full dropdown row is always
  // visible again now. filtersOpen is kept (always true) rather than
  // ripped out everywhere it's referenced, to keep this change small.
  const [filtersOpen] = useState(true);
  // stageFilter removed per Khuram (24/07/2026) — stage values are
  // free-text progress notes, useless as a filter. The Workload
  // scoreboard (Team view) is the way to see who/which dept is delaying.
  const [dueFilter, setDueFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [subtaskFilter, setSubtaskFilter] = useState<string>("all");
  // Explicit status picker (Not Started/In Progress/Waiting Reply/Stuck/
  // Completed/Cancelled) — separate from the all/overdue/waiting quick
  // pills below, and the one way to see Completed/Cancelled tasks in the
  // main list/board/timeline views, which otherwise always hide them.
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [meetingTitles, setMeetingTitles] = useState<Record<string, string>>({});
  // Tracks which department/person groups are EXPANDED — starting empty
  // means every group defaults to closed on mount, per the house rule
  // that collapsible items always start closed.
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());
  const [expandedPeople, setExpandedPeople] = useState<Set<string>>(new Set());
  // Multi-assignee: every task's full owner list, and which tasks the
  // current user is a co-assignee on (not just the primary assigned_to_email)
  // — needed both to display "+N" on rows and so "My Tasks" catches tasks
  // shared with someone else, not only ones where you're the primary owner.
  const [assigneesByTask, setAssigneesByTask] = useState<Map<string, string[]>>(new Map());
  const [myCoAssignedTaskIds, setMyCoAssignedTaskIds] = useState<Set<string>>(new Set());
  // Bulk select — List view only, per Khuram. Move/change status/company/
  // owner across many tasks at once instead of one at a time.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkCompanyId, setBulkCompanyId] = useState("");
  const [bulkOwnerId, setBulkOwnerId] = useState("");
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkMembers, setBulkMembers] = useState<{ id: string; name: string; email: string | null; department: string | null; business_unit: string | null }[]>([]);

  const isPrivileged = canSeeAll ?? (currentRole === "Admin" || currentRole === "CEO" || currentRole === "Executive");

  async function loadTasks() {
    // getSession() reads from the local token cache — no extra network call.
    // We call this first so email is available for the co-assignee lookup,
    // and then we batch setMyEmail + setTasks in the same state update at
    // the end so the Mine filter never runs with tasks but no email.
    const { data: sessionData } = await supabase.auth.getSession();
    const email = sessionData.session?.user?.email || null;

    // Co-assignee ids for the current user — needed even for privileged
    // users (the Mine/Everyone toggle uses it), and critically also used
    // below to widen the fetch filter for non-privileged users: RLS
    // (migration 112) already lets a co-assignee see a task they aren't
    // the primary owner of, but the client-side .or() filter has to be
    // widened to match or it'd never even ask for those rows.
    let myCoAssignedIds: string[] = [];
    if (email) {
      const { data: ca } = await supabase.from("task_assignees").select("task_id").eq("member_email", email);
      myCoAssignedIds = (ca || []).map((r) => r.task_id);
    }
    setMyCoAssignedTaskIds(new Set(myCoAssignedIds));

    // Manager visibility (Khuram, 17/07/2026): a non-privileged user should
    // also see tasks assigned to their direct reports (via members.manager_id
    // — see migration 142), not just tasks they created/are assigned/are a
    // co-assignee on. RLS enforces this server-side regardless; fetching the
    // report list here just means the client actually asks for those rows
    // instead of silently under-requesting them.
    let myReportEmails: string[] = [];
    if (!isPrivileged && email) {
      const { data: myMember } = await supabase.from("members").select("id").eq("email", email).maybeSingle();
      if (myMember?.id) {
        const { data: reports } = await supabase.from("members").select("email").eq("manager_id", myMember.id);
        myReportEmails = (reports || []).map((r) => r.email).filter((e): e is string => !!e);
      }
    }

    let query = supabase
      .from("tasks")
      .select("*, task_subtasks(id, is_complete), task_comments(id)")
      .order("created_at", { ascending: false });

    if (!isPrivileged && email) {
      const idClause = myCoAssignedIds.length > 0 ? `,id.in.(${myCoAssignedIds.join(",")})` : "";
      const reportsClause = myReportEmails.length > 0 ? `,assigned_to_email.in.(${myReportEmails.join(",")})` : "";
      query = query.or(`assigned_to_email.eq.${email},assigned_by_email.eq.${email}${idClause}${reportsClause}`);
    }

    const { data, error } = await query;

    if (error) {
      setErrorMsg(error.message);
    } else {
      // Set email and tasks together so the Mine filter never renders
      // with tasks loaded but myEmail still null (which shows an empty list).
      setMyEmail(email);
      setTasks(data || []);
      const taskIds = (data || []).map((t) => t.id);
      if (taskIds.length > 0) {
        const { data: assigneeRows } = await supabase.from("task_assignees").select("task_id, member_name").in("task_id", taskIds);
        const grouped = new Map<string, string[]>();
        for (const r of assigneeRows || []) {
          if (!grouped.has(r.task_id)) grouped.set(r.task_id, []);
          grouped.get(r.task_id)!.push(r.member_name);
        }
        setAssigneesByTask(grouped);
      } else {
        setAssigneesByTask(new Map());
      }
      const meetingIds = Array.from(new Set((data || []).map((t) => t.meeting_id).filter((id): id is string => !!id)));
      if (meetingIds.length > 0) {
        const { data: meetingRows } = await supabase.from("meetings").select("id, title").in("id", meetingIds);
        const titles: Record<string, string> = {};
        for (const m of meetingRows || []) titles[m.id] = m.title;
        setMeetingTitles(titles);
      }
    }
    setLoading(false);
  }

  async function loadKpi() {
    const params = companyFilter === "all"
      ? {}
      : companyFilter === "group"
      ? { p_group_only: true }
      : { p_company_id: companyFilter };
    const { data, error } = await supabase.rpc("get_tasks_kpi_summary", params).single();
    if (!error && data) setKpi(data as KpiSummary);
  }

  function resetFilters() {
    setCompanyFilter("all");
    setFilter("all");
    setDepartmentFilter("all");
    setPriorityFilter("all");
    setOwnerFilter("all");
    setPeriodFilter("all");
    setDueFilter("all");
    setSourceFilter("all");
    setSubtaskFilter("all");
    setStatusFilter("all");
    setSearchQuery("");
  }

  useEffect(() => {
    loadTasks();
    supabase.from("members").select("name, phone_e164").then(({ data }) => {
      const phones: Record<string, string> = {};
      for (const m of (data || [])) { if (m.name && m.phone_e164) phones[m.name] = m.phone_e164; }
      setMemberPhones(phones);
    });
    supabase.from("companies").select("id, name, short_code").in("short_code", TASK_COMPANY_CODES).then(({ data }) => setCompanies(data || []));
    supabase.from("department_owners").select("department_name").order("department_name").then(({ data }) => setAllDepartments((data || []).map((d) => d.department_name)));
    supabase.rpc("get_tasks_department_breakdown").then(({ data, error }) => { if (!error) setDeptBreakdown(data || []); });
    supabase.from("members").select("id, name, email, department, business_unit").eq("is_active", true).order("name").then(({ data }) => setBulkMembers(data || []));
  }, []);

  // Re-run the KPI RPC whenever the Company filter changes, so the KPI
  // tiles always match what the Company dropdown shows. (The monthly/
  // quarterly chart RPCs this used to also call were dropped along with
  // the Monthly/Quarterly tabs — Khuram asked for those to become a
  // simple period filter instead, with no charts.)
  useEffect(() => {
    loadKpi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyFilter]);

  useEffect(() => {
    if (taskIdFromUrl && tasks.length > 0) {
      const task = tasks.find((t) => t.id === taskIdFromUrl);
      if (task) {
        setExpandedTaskId(taskIdFromUrl);
        setTimeout(() => {
          document.getElementById(`task-${taskIdFromUrl}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
      }
    }
  }, [taskIdFromUrl, tasks]);

  if (loading) return <SkeletonRows count={5} height="48px" />;
  if (errorMsg) return <ErrorBanner message={errorMsg} onRetry={loadTasks} />;

  // Audit members with no general tasks assigned: suppress the full KPI +
  // filter UI (which would be empty and confusing) and show a labelled
  // section with a quiet note instead — so the section is still visually
  // present alongside the AuditTasksPanel above it.
  // Privileged users (canSeeAll = true, e.g. Audit Manager Shahid) still
  // see the full list since they review tasks across the whole team.
  if (department === "Audit" && !isPrivileged && tasks.length === 0) {
    return (
      <p style={{ color: COLOURS.SLATE, fontSize: "13px", margin: 0 }}>
        No general tasks assigned to you right now.
      </p>
    );
  }

  // All the dropdown filters below are simple property filters over the
  // already-fetched rows — not aggregation, so this stays plain JS per
  // house rule 0 (that rule is about sums/counts, not filtering a list).

  // Weekly/Monthly/Quarterly used to be separate tabs (with bar charts);
  // Khuram asked for those to fold into a single "Due period" filter
  // instead, with the charts dropped entirely. Boundaries are calendar-
  // based (this Mon–Sun / this calendar month / this calendar quarter),
  // not a rolling window.
  const now = new Date(todayStr + "T00:00:00");
  const periodWeekStart = getWeekStart(now);
  const periodWeekEndDate = new Date(periodWeekStart + "T00:00:00");
  periodWeekEndDate.setDate(periodWeekEndDate.getDate() + 7);
  const periodWeekEnd = periodWeekEndDate.toISOString().slice(0, 10);
  const periodMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const periodMonthEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const periodMonthEnd = periodMonthEndDate.toISOString().slice(0, 10);
  const periodQuarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
  const periodQuarterStart = `${now.getFullYear()}-${String(periodQuarterStartMonth + 1).padStart(2, "0")}-01`;
  const periodQuarterEndDate = new Date(now.getFullYear(), periodQuarterStartMonth + 3, 1);
  const periodQuarterEnd = periodQuarterEndDate.toISOString().slice(0, 10);

  const scopedTasks = tasks.filter((t) => {
    if (companyFilter !== "all") {
      if (companyFilter === "group" ? !!t.company_id : t.company_id !== companyFilter) return false;
    }
    // Department match uses assigned_to_department ONLY — the old
    // `|| t.project` fallback leaked meeting titles into the department
    // filter as fake departments (Khuram, 24/07/2026).
    if (departmentFilter !== "all" && (t.assigned_to_department || "Unassigned") !== departmentFilter) return false;
    if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (ownerFilter !== "all" && normName(t.assigned_to) !== ownerFilter) return false;
    if (periodFilter !== "all") {
      if (!t.due_date) return false;
      if (periodFilter === "week" && !(t.due_date >= periodWeekStart && t.due_date < periodWeekEnd)) return false;
      if (periodFilter === "month" && !(t.due_date >= periodMonthStart && t.due_date < periodMonthEnd)) return false;
      if (periodFilter === "quarter" && !(t.due_date >= periodQuarterStart && t.due_date < periodQuarterEnd)) return false;
    }
    if (dueFilter !== "all") {
      const isOd = t.status !== "Completed" && t.status !== "Cancelled" && !!t.due_date && t.due_date < todayStr;
      if (dueFilter === "overdue" && !isOd) return false;
      if (dueFilter === "today" && t.due_date !== todayStr) return false;
      if (dueFilter === "none" && t.due_date) return false;
    }
    if (sourceFilter !== "all") {
      const isRecurring = t.assigned_by === "Recurring Template";
      if (sourceFilter === "meeting" && !t.meeting_id) return false;
      if (sourceFilter === "manual" && (t.meeting_id || isRecurring)) return false;
      if (sourceFilter === "recurring" && !isRecurring) return false;
    }
    if (subtaskFilter !== "all") {
      const total = t.task_subtasks?.length ?? 0;
      const done = t.task_subtasks?.filter((s) => s.is_complete).length ?? 0;
      if (subtaskFilter === "has" && total === 0) return false;
      if (subtaskFilter === "complete" && !(total > 0 && done === total)) return false;
      if (subtaskFilter === "none" && total > 0) return false;
    }
    if (searchQuery.trim() && !t.description.toLowerCase().includes(searchQuery.trim().toLowerCase())) return false;
    return true;
  });

  // Dropdown option lists: departments come from the CANONICAL list only
  // (department_owners) plus "Unassigned". The old merge with
  // task-derived values (assigned_to_department || project) leaked
  // meeting titles and stray labels in as fake departments — Khuram:
  // "our departments are getting bigger and bigger... we need to stop
  // this addition" (24/07/2026). Only Khuram edits department_owners.
  const departmentOptions = [...Array.from(new Set(allDepartments)).sort(), "Unassigned"];
  const ownerOptions = Array.from(new Set(tasks.map((t) => normName(t.assigned_to)).filter((n) => !!n))).sort();
  // Counts every filter, including Company (left out of the old boolean
  // check by oversight) — drives the badge on the single "Filters" button.
  const activeFilterCount = [
    companyFilter !== "all", departmentFilter !== "all", priorityFilter !== "all", statusFilter !== "all",
    ownerFilter !== "all", periodFilter !== "all", dueFilter !== "all",
    sourceFilter !== "all", subtaskFilter !== "all", searchQuery.trim() !== "",
  ].filter(Boolean).length;
  const filtersActive = activeFilterCount > 0;

  function refreshAll() {
    loadTasks();
    loadKpi();
    supabase.rpc("get_tasks_department_breakdown").then(({ data, error }) => { if (!error) setDeptBreakdown(data || []); });
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Khuram: "there should be one click that can select multiple items,
  // instead of me going one by one. this should apply to all pages in the
  // tasks." One "Select all" toggle per view (List, Tree, and the KPI-card
  // drawer — the three surfaces with per-row checkboxes; Board and
  // Timeline don't have a per-item selection UI to select into), each
  // scoped to exactly the tasks currently visible in that view — ids
  // already ticked elsewhere stay ticked, this only adds/removes the ones
  // this particular view is offering.
  function isAllSelected(ids: string[]) {
    return ids.length > 0 && ids.every((id) => selectedIds.has(id));
  }
  function toggleSelectAll(ids: string[]) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (ids.length > 0 && ids.every((id) => next.has(id))) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  // Completed tasks are locked — Khuram: "I dont think the task should be
  // allowed to be edited afterwards... unless the administration who has
  // the rights to bring it back." Every bulk action below pre-filters
  // Completed tasks out of the selection unless the actor is Admin-tier,
  // same rule as the single-task view (see TaskStatus.tsx's `locked`).
  function splitLocked(ids: string[]): { eligible: string[]; lockedCount: number } {
    const canReopen = canReopenCompletedTask({ email: myEmail, role: currentRole });
    const eligible: string[] = [];
    let lockedCount = 0;
    for (const id of ids) {
      const t = tasks.find((x) => x.id === id);
      if (!t) continue;
      if (t.status === "Completed" && !canReopen) { lockedCount++; continue; }
      eligible.push(id);
    }
    return { eligible, lockedCount };
  }

  async function applyBulkStatus() {
    if (!bulkStatus || selectedIds.size === 0) return;
    const { eligible, lockedCount } = splitLocked(Array.from(selectedIds));
    if (eligible.length === 0) {
      toast.show("Every selected task is completed and locked — only an admin can change its status.", "error");
      return;
    }
    setBulkApplying(true);

    // "Submitted" routes to each task's own HOD individually — the same
    // rule as the single-task dropdown and the Kanban board — so it can't
    // be one blanket UPDATE the way the other statuses can.
    if (bulkStatus === "Submitted") {
      let routed = 0, failed = 0;
      for (const id of eligible) {
        const t = tasks.find((x) => x.id === id);
        if (!t || t.status === "Submitted") continue;
        const extra = await routeSubmittedTask(id, t.assigned_to, t.assigned_to_email, t.requires_manager_signoff !== false);
        const { error } = await supabase.from("tasks").update({ status: "Submitted", updated_at: new Date().toISOString(), ...extra }).eq("id", id);
        if (error) { failed++; continue; }
        routed++;
        // Notify the HOD who just received this task — fire-and-forget.
        if ((extra as Record<string, unknown>).assigned_to_email) {
          authFetch("/api/tasks/notify-submitted", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ taskId: id, managerEmail: (extra as Record<string, unknown>).assigned_to_email, submittedByName: t.assigned_to || "Unknown" }),
          }).catch((e) => console.error("Submit notification failed (non-blocking)", e));
        }
      }
      setBulkApplying(false);
      const parts = [`Submitted ${routed} task(s)`];
      if (failed > 0) parts.push(`${failed} failed`);
      if (lockedCount > 0) parts.push(`skipped ${lockedCount} completed`);
      toast.show(parts.join(", ") + ".", failed > 0 ? "error" : "success");
    } else {
      const { error } = await supabase.from("tasks").update({ status: bulkStatus, updated_at: new Date().toISOString() }).in("id", eligible);
      setBulkApplying(false);
      if (error) { toast.show("Error: " + error.message, "error"); return; }
      toast.show(`Updated status on ${eligible.length} task(s).${lockedCount > 0 ? ` Skipped ${lockedCount} completed task(s).` : ""}`, "success");
    }
    setBulkStatus(""); setSelectedIds(new Set());
    refreshAll();
  }

  async function applyBulkCompany() {
    if (!bulkCompanyId || selectedIds.size === 0) return;
    const { eligible, lockedCount } = splitLocked(Array.from(selectedIds));
    if (eligible.length === 0) {
      toast.show("Every selected task is completed and locked — only an admin can change it.", "error");
      return;
    }
    setBulkApplying(true);
    const { error } = await supabase.from("tasks").update({ company_id: bulkCompanyId }).in("id", eligible);
    setBulkApplying(false);
    if (error) { toast.show("Error: " + error.message, "error"); return; }
    toast.show(`Updated company on ${eligible.length} task(s).${lockedCount > 0 ? ` Skipped ${lockedCount} completed task(s).` : ""}`, "success");
    setBulkCompanyId(""); setSelectedIds(new Set());
    refreshAll();
  }

  // Bulk owner change replaces the full owner list on every selected task
  // with this one person — a deliberate simplification vs. the per-task
  // Owner(s) picker (which can add/remove individual co-owners). If you
  // need several tasks to end up with several owners each, do that one
  // task at a time from its own detail panel.
  async function applyBulkOwner() {
    if (!bulkOwnerId || selectedIds.size === 0) return;
    const owner = bulkMembers.find((m) => m.id === bulkOwnerId);
    if (!owner) return;
    const { eligible: ids, lockedCount } = splitLocked(Array.from(selectedIds));
    if (ids.length === 0) {
      toast.show("Every selected task is completed and locked — only an admin can reassign it.", "error");
      return;
    }
    setBulkApplying(true);
    const { error } = await supabase.from("tasks").update({
      assigned_to: owner.name,
      assigned_to_email: owner.email,
      assigned_to_department: owner.department,
      assigned_to_business_unit: owner.business_unit,
    }).in("id", ids);
    if (!error) {
      await supabase.from("task_assignees").delete().in("task_id", ids);
      await supabase.from("task_assignees").insert(ids.map((id) => ({ task_id: id, member_id: owner.id, member_name: owner.name, member_email: owner.email })));
    }
    setBulkApplying(false);
    if (error) { toast.show("Error: " + error.message, "error"); return; }
    toast.show(`Reassigned ${ids.length} task(s) to ${owner.name}.${lockedCount > 0 ? ` Skipped ${lockedCount} completed task(s).` : ""}`, "success");
    setBulkOwnerId(""); setSelectedIds(new Set());
    refreshAll();
  }

  // Khuram: "for practical reasons, i would want an options to complete
  // multiple tasks in one go." A single UPDATE statement is all-or-nothing
  // against the database's HOD-completion and subtask gates (migrations
  // 114 and 100) — if even one selected task doesn't qualify, the whole
  // statement is rejected and NOTHING completes. So this filters the
  // selection down to only the tasks the current user is genuinely
  // allowed to close (same rule as the single-task "Mark Complete"
  // button — see canCompleteSubmittedTask in lib/permissions.ts) before
  // sending the update, then reports what it skipped and why rather than
  // failing silently.
  async function applyBulkComplete() {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const eligible: string[] = [];
    let notSubmitted = 0, openSubtasks = 0, notAllowed = 0;
    for (const id of ids) {
      const t = tasks.find((x) => x.id === id);
      if (!t) continue;
      // Self-created tasks (Khuram, 17/07/2026) don't need to be Submitted
      // first — the assignee can close them from any open status.
      const selfCreated = t.requires_manager_signoff === false;
      if (!selfCreated && t.status !== "Submitted") { notSubmitted++; continue; }
      if (selfCreated && (t.status === "Completed" || t.status === "Cancelled")) { notSubmitted++; continue; }
      if ((t.task_subtasks || []).some((s) => !s.is_complete)) { openSubtasks++; continue; }
      if (!canCompleteSubmittedTask({ email: myEmail, role: currentRole }, t.assigned_to_email)) { notAllowed++; continue; }
      eligible.push(id);
    }
    if (eligible.length === 0) {
      toast.show("None of the selected tasks can be completed right now — each must be Submitted and have no open subtasks, and be assigned to you (Khuram, Kamran, and the Executive can close anyone's).", "error");
      return;
    }
    setBulkApplying(true);
    const { error } = await supabase.from("tasks").update({ status: "Completed", updated_at: new Date().toISOString() }).in("id", eligible);
    setBulkApplying(false);
    if (error) { toast.show("Error: " + error.message, "error"); return; }
    const skippedParts: string[] = [];
    if (notSubmitted > 0) skippedParts.push(`${notSubmitted} not yet Submitted`);
    if (openSubtasks > 0) skippedParts.push(`${openSubtasks} with open subtasks`);
    if (notAllowed > 0) skippedParts.push(`${notAllowed} not yours to close`);
    toast.show(`Completed ${eligible.length} task(s).${skippedParts.length > 0 ? ` Skipped: ${skippedParts.join(", ")}.` : ""}`, "success");
    setSelectedIds(new Set());
    refreshAll();
  }

  function companyBadge(companyId: string | null) {
    if (!companyId) return { label: "Group", color: COLOURS.SLATE, background: COLOURS.HAIRLINE };
    const c = companies.find((co) => co.id === companyId);
    const code = c?.short_code || "";
    const found = COMPANY_BADGE_COLOURS[code] || { color: COLOURS.NAVY, background: COLOURS.HAIRLINE };
    // Full name, not the short code — "Unze Trading Pvt Ltd", not "UTPL".
    // short_code is still used above just to pick the badge colour.
    return { label: c?.name || "—", color: found.color, background: found.background };
  }

  // When a specific status is picked, it overrides the default "hide
  // Completed/Cancelled" behaviour entirely — scopedTasks is already
  // narrowed to just that status (see the statusFilter check above), so
  // there's nothing left to additionally exclude.
  const allOpen = statusFilter !== "all"
    ? scopedTasks
    : scopedTasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled");
  const overdueTasks = allOpen.filter(isOverdue);
  const waitingReply = allOpen.filter((t) => t.status === "Waiting Reply");
  const exceptionTasks = allOpen.filter((t) => !!t.explanation_required);
  const completedAll = scopedTasks.filter((t) => t.status === "Completed");

  // ── Weekly grouping ──
  const nextWeekDate = new Date();
  nextWeekDate.setDate(nextWeekDate.getDate() + 7);
  const nextWeekStart = getWeekStart(nextWeekDate);

  // ── My Tasks grouping (default landing view) — Overdue / Due Today /
  // This Week / Next Week & Later, scoped to just me unless "Everyone" is
  // picked. Anyone without full visibility already only sees their own +
  // ones they assigned via RLS, so "Everyone" for them means "everything
  // I can see", not "the whole company".
  const myIdentities = myIdentityEmails(myEmail);
  const myTasksSource = myTasksScope === "mine"
    ? allOpen.filter((t) => {
        const myEmails = myIdentities;
        const byMe = !!(t.assigned_by_email && myEmails.includes(t.assigned_by_email.toLowerCase()));
        const toMe = !!(t.assigned_to_email && myEmails.includes(t.assigned_to_email.toLowerCase()));
        // "Mine" = tasks that need MY personal action right now:
        // 1. Assigned directly to me
        if (toMe) return true;
        // 2. Co-assigned to me
        if (myCoAssignedTaskIds.has(t.id)) return true;
        // 3. I assigned it and the team has Submitted it back for my sign-off
        if (byMe && t.status === "Submitted") return true;
        // 4. I assigned it and the team is waiting for my reply
        if (byMe && t.status === "Waiting Reply" && t.reply_required) return true;
        return false;
      })
    : allOpen;
  function myTaskGroup(task: Task): string {
    if (isOverdue(task)) return "Overdue";
    if (task.due_date === todayStr) return "Due Today";
    if (!task.due_date) return "Next Week & Later";
    if (task.due_date < nextWeekStart) return "This Week";
    return "Next Week & Later";
  }
  const myTasksGroupOrder = ["Overdue", "Due Today", "This Week", "Next Week & Later"];
  const myTasksGroupColor = (g: string) =>
    g === "Overdue" ? COLOURS.RED : g === "Due Today" ? COLOURS.AMBER : g === "This Week" ? COLOURS.BLUE : COLOURS.SLATE;
  const myTasksGroups = new Map<string, Task[]>();
  for (const t of myTasksSource) {
    const g = myTaskGroup(t);
    if (!myTasksGroups.has(g)) myTasksGroups.set(g, []);
    myTasksGroups.get(g)!.push(t);
  }

  // ── "Delegated by me" (Khuram, 24/07/2026) — the Mine view only showed
  // tasks needing HIS action, which hid the 20 tasks he'd handed out via
  // meetings or directly. Shown as a separate section at the bottom of
  // Mine: his own action items stay on top, but everything he's delegated
  // is always visible with its current status. Excludes tasks already in
  // myTasksSource (Submitted back to him / awaiting his reply) so nothing
  // appears twice.
  const delegatedByMe = myTasksScope === "mine"
    ? allOpen.filter((t) => {
        const byMe = !!(t.assigned_by_email && myIdentities.includes(t.assigned_by_email.toLowerCase()));
        if (!byMe) return false;
        const toMe = !!(t.assigned_to_email && myIdentities.includes(t.assigned_to_email.toLowerCase()));
        if (toMe || myCoAssignedTaskIds.has(t.id)) return false;
        // Already surfaced above as an action item
        if (t.status === "Submitted") return false;
        if (t.status === "Waiting Reply" && t.reply_required) return false;
        return true;
      })
    : [];

  // ── Tree view grouping — Department → Person → Tasks. This is the old
  // Department view's grouping brought back as the "Tree" icon view, per
  // Khuram — a real two-level hierarchy now (both levels collapsible),
  // rather than the flat department list + a non-collapsible person strip
  // it was before.
  type DeptNode = { dept: string; tasks: Task[]; open: number; overdue: number };
  const deptMap = new Map<string, Task[]>();
  for (const t of scopedTasks) {
    const dept = t.assigned_to_department || t.project || "Unassigned";
    if (!deptMap.has(dept)) deptMap.set(dept, []);
    deptMap.get(dept)!.push(t);
  }
  const deptNodes: DeptNode[] = Array.from(deptMap.entries()).map(([dept, deptTasks]) => {
    const open = deptTasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled");
    return { dept, tasks: deptTasks, open: open.length, overdue: open.filter(isOverdue).length };
  }).sort((a, b) => b.overdue - a.overdue || b.open - a.open);

  // Flattened ids of every task the Tree view actually renders right now —
  // same per-department filter (all/overdue/waiting pill) the JSX below
  // applies per node — so "Select all" ticks exactly what's on screen.
  const treeVisibleIds = deptNodes.flatMap((d) => {
    const deptFiltered = filter === "overdue" ? d.tasks.filter(isOverdue) : filter === "waiting" ? d.tasks.filter((t) => t.status === "Waiting Reply") : filter === "exception" ? d.tasks.filter((t) => !!t.explanation_required) : filter === "submitted" ? d.tasks.filter((t) => t.status === "Submitted") : d.tasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled");
    return deptFiltered.map((t) => t.id);
  });

  function toggleDept(dept: string) {
    setExpandedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept); else next.add(dept);
      return next;
    });
  }
  function togglePerson(key: string) {
    setExpandedPeople((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // ── Filtered task list ── (used by Timeline/Board views)
  let filteredTasks = allOpen;
  if (filter === "overdue") filteredTasks = overdueTasks;
  else if (filter === "waiting") filteredTasks = waitingReply;
  else if (filter === "exception") filteredTasks = exceptionTasks;
  else if (filter === "submitted") filteredTasks = allOpen.filter((t) => t.status === "Submitted");

  // ── List view (default landing view) flat filter ──
  // List view normally groups myTasksSource into due-date buckets
  // (Overdue/Due Today/This Week/Next Week & Later) and ignores the quick
  // filter pills entirely — which is exactly why clicking "Overdue" or
  // "Waiting" used to do nothing there. When a specific filter is active
  // (either via the pills or a bell deep-link — "submitted" only arrives
  // via the bell, there's no pill for it), show a single flat list of
  // just that category instead of the grouped breakdown.
  const listFilteredTasks = filter === "all" ? null
    : filter === "overdue" ? myTasksSource.filter(isOverdue)
    : filter === "waiting" ? myTasksSource.filter((t) => t.status === "Waiting Reply")
    : filter === "exception" ? myTasksSource.filter((t) => !!t.explanation_required)
    : myTasksSource.filter((t) => t.status === "Submitted");

  // Pill counts shown next to "Overdue"/"Waiting"/"Needs explanation" must
  // match what's actually on screen below them — which is scoped by the
  // My tasks/Everyone toggle. overdueTasks/waitingReply/exceptionTasks
  // above stay org-wide on purpose (the KPI tiles at the top of the page
  // use them), so compute separate scoped counts just for the pills.
  const overdueMineCount = myTasksSource.filter(isOverdue).length;
  const waitingMineCount = myTasksSource.filter((t) => t.status === "Waiting Reply").length;
  const exceptionMineCount = myTasksSource.filter((t) => !!t.explanation_required).length;

  const filterSelectStyle: React.CSSProperties = {
    border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, padding: "6px 10px",
    fontSize: "12.5px", fontWeight: 600, color: COLOURS.NAVY, backgroundColor: COLOURS.CARD,
  };

  const smallActionBtn: React.CSSProperties = {
    border: "none", borderRadius: RADII.SM, padding: "6px 12px", fontSize: "12.5px", fontWeight: 700,
    backgroundColor: COLOURS.NAVY, color: "white", cursor: "pointer",
  };

  // Icon glyphs for the Board/Tree/List/Timeline view-switcher buttons —
  // same plain-inline-SVG approach as the KPI icons above, no dependency.
  const VIEW_ICON_PATHS: Record<string, React.ReactNode> = {
    list: <><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /></>,
    board: <><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="9.5" y="4" width="5" height="10" rx="1" /><rect x="16" y="4" width="5" height="13" rx="1" /></>,
    tree: <><circle cx="12" cy="4.5" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /><line x1="12" y1="6.5" x2="12" y2="12" /><line x1="6" y1="16" x2="6" y2="12" /><line x1="18" y1="16" x2="18" y2="12" /><line x1="6" y1="12" x2="18" y2="12" /></>,
    timeline: <><line x1="3" y1="12" x2="21" y2="12" /><circle cx="7" cy="12" r="2" /><circle cx="13" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></>,
  };
  const VIEW_LABELS: Record<string, string> = { list: "List", board: "Board", tree: "Tree", timeline: "Timeline" };
  function viewIcon(view: string, active: boolean) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={active ? "white" : COLOURS.SLATE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {VIEW_ICON_PATHS[view]}
      </svg>
    );
  }

  function TaskRow({ task, selectable }: { task: Task; selectable?: boolean }) {
    const isOpen = expandedTaskId === task.id;
    const od = daysOverdue(task);
    const overdue = isOverdue(task);
    const otherAssignees = (assigneesByTask.get(task.id) || []).filter((n) => n !== task.assigned_to);
    // Khuram: "once the task is completed then it should be greyed out."
    // Visual-only here — the actual lock (can't edit unless admin) lives
    // in TaskStatus.tsx/TaskDetailPanel.tsx; this just signals at a
    // glance, in every list, that the cycle is closed.
    const done = task.status === "Completed";

    return (
      <div id={`task-${task.id}`} style={{ borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
        <div
          onClick={() => setExpandedTaskId(isOpen ? null : task.id)}
          style={{
            padding: "10px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between",
            alignItems: "center", gap: "8px",
            // A full red-tinted row for every overdue task got cramped and
            // noisy once there were more than a few of them — a left accent
            // bar plus the existing red "Xd late" text carries the same
            // signal without painting the whole row.
            backgroundColor: isOpen ? COLOURS.CARD_ALT : done ? COLOURS.CARD_ALT : COLOURS.CARD,
            borderLeft: `3px solid ${overdue ? COLOURS.RED : "transparent"}`,
            opacity: done ? 0.6 : 1,
          }}
        >
          {selectable && (
            <input
              type="checkbox"
              checked={selectedIds.has(task.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => toggleSelect(task.id)}
              style={{ width: "16px", height: "16px", flexShrink: 0, cursor: "pointer" }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "14px", fontWeight: 600, color: done ? COLOURS.SLATE : COLOURS.NAVY, textDecoration: done ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.description}</div>
            {/* One muted meta line, dot-separated, instead of a row of
                boxed badges — same information, far less visual noise. */}
            <div style={{ fontSize: "12px", color: COLOURS.INK_400, marginTop: "3px", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
              <span title={otherAssignees.length > 0 ? `Also: ${otherAssignees.join(", ")}` : undefined}>
                {task.assigned_to || "Unassigned"}{otherAssignees.length > 0 && ` +${otherAssignees.length}`}
              </span>
              <span>·</span>
              {(() => {
                const badge = companyBadge(task.company_id);
                return (
                  <span style={{ fontSize: "11px", fontWeight: 700, padding: "1px 8px", borderRadius: RADII.PILL, color: badge.color, backgroundColor: badge.background }}>
                    {badge.label}
                  </span>
                );
              })()}
              {task.assigned_to_department && (
                <>
                  <span>·</span>
                  <span>{task.assigned_to_department}</span>
                </>
              )}
              {task.stage && (
                <>
                  <span>·</span>
                  <span>→ {task.stage}</span>
                </>
              )}
              {task.task_subtasks && task.task_subtasks.length > 0 && (
                <>
                  <span>·</span>
                  <span>{task.task_subtasks.filter((s) => s.is_complete).length}/{task.task_subtasks.length} subtasks</span>
                </>
              )}
              {task.task_comments && task.task_comments.length > 0 && (
                <>
                  <span>·</span>
                  <span>{task.task_comments.length} comment{task.task_comments.length > 1 ? "s" : ""}</span>
                </>
              )}
              {task.meeting_id && (
                <>
                  <span>·</span>
                  <a
                    href={`/my-minutes?meeting=${task.meeting_id}`}
                    onClick={(e) => e.stopPropagation()}
                    style={{ fontWeight: 600, color: COLOURS.BLUE, whiteSpace: "nowrap", textDecoration: "none" }}
                  >
                    {meetingTitles[task.meeting_id] || "Meeting"} →
                  </a>
                </>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: isMobile ? "4px" : "8px", alignItems: "center", flexShrink: 0 }}>
            {!isMobile && task.priority && <PriorityBadge priority={task.priority} />}
            <StatusBadge status={task.status} />
            {task.due_date && (
              <span
                title={task.assigned_date ? `Issued ${formatDateUK(task.assigned_date)}` : undefined}
                style={{
                  fontFamily: "var(--font-mono,'JetBrains Mono',monospace)", fontSize: "12px",
                  color: overdue ? COLOURS.RED : COLOURS.SLATE, fontWeight: overdue ? 700 : 500,
                  minWidth: isMobile ? "62px" : "76px", textAlign: "right", whiteSpace: "nowrap",
                }}
              >
                {formatDateUK(task.due_date)}{od > 0 && ` · ${od}d`}
              </span>
            )}
          </div>
        </div>

        <MiniSubtaskToggle task={task} onChanged={refreshAll} myEmail={myEmail} currentRole={currentRole} />
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: isMobile ? 160 : 0 }}>
      {toast.element}

      <TaskDetailModal
        task={tasks.find((t) => t.id === expandedTaskId) || null}
        open={!!expandedTaskId}
        onClose={() => setExpandedTaskId(null)}
        currentRole={currentRole}
        isPrivileged={isPrivileged}
        canReview={canReview}
        canDelete={canDelete}
        myEmail={myEmail}
        memberPhones={memberPhones}
        onChanged={refreshAll}
      />

      {/* ═══ STAT STRIP — one compact row, sourced from get_tasks_kpi_summary()
          RPC. Replaces the old "Needs Your Attention" banner + separate KPI
          card row, which duplicated the same Overdue/Due Today/Stuck
          numbers twice on screen. Overdue and Due Today get a soft tint so
          they still stand out; the urgent count now lives as a small
          sub-label under Overdue instead of its own tile. ═══ */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap", alignItems: "stretch" }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? "88px" : "108px"}, 1fr))`, gap: "8px", flex: 1 }}>
          {[
            { label: "Open",          value: kpi?.open_count ?? allOpen.length,          accent: COLOURS.NAVY, soft: COLOURS.CARD,       border: COLOURS.HAIRLINE },
            { label: "Overdue",       value: kpi?.overdue_count ?? overdueTasks.length,   accent: COLOURS.RED,  soft: COLOURS.DANGER_SOFT, border: COLOURS.RED,
              sub: (kpi?.urgent_open_count ?? 0) > 0 ? `${kpi!.urgent_open_count} urgent` : undefined },
            { label: "Due Today",     value: kpi?.due_today_count ?? 0,                   accent: COLOURS.AMBER, soft: COLOURS.WARNING_SOFT, border: COLOURS.AMBER },
            { label: "Waiting Reply", value: kpi?.waiting_reply_count ?? waitingReply.length, accent: COLOURS.NAVY, soft: COLOURS.CARD, border: COLOURS.HAIRLINE },
            { label: "Stuck",         value: kpi?.stuck_count ?? 0,                        accent: COLOURS.NAVY, soft: COLOURS.CARD, border: COLOURS.HAIRLINE },
            { label: "Completed",     value: kpi?.completed_count ?? completedAll.length,  accent: COLOURS.GREEN, soft: COLOURS.CARD, border: COLOURS.HAIRLINE },
          ].map(({ label, value, accent, soft, border, sub }) => (
            <div
              key={label}
              onClick={() => setKpiDrawer(kpiDrawer === label ? null : label)}
              style={{
                backgroundColor: soft, border: `1px solid ${kpiDrawer === label ? border : COLOURS.HAIRLINE}`,
                borderRadius: RADII.SM, padding: "8px 12px", cursor: "pointer",
              }}
            >
              <div style={{ fontSize: "10.5px", fontWeight: 600, color: COLOURS.SLATE, marginBottom: "2px" }}>{label}</div>
              <div style={{ fontFamily: "var(--font-display,'Inter Tight',sans-serif)", fontSize: "19px", fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: accent }}>{value.toLocaleString()}</div>
              {sub && <div style={{ fontSize: "10px", fontWeight: 700, color: COLOURS.RED, marginTop: "1px" }}>{sub}</div>}
            </div>
          ))}
        </div>
        <button
          onClick={() => setDeptBreakdownOpen(!deptBreakdownOpen)}
          style={{
            border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: COLOURS.CARD, color: COLOURS.SLATE,
            borderRadius: RADII.SM, padding: "0 14px", fontSize: "12px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
          }}
        >
          Breakdown {deptBreakdownOpen ? "▲" : "▼"}
        </button>
      </div>

      {deptBreakdownOpen && (
        <div style={{ ...cardStyle, overflow: "hidden", marginBottom: "14px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 0.8fr 0.8fr", gap: "10px", padding: "9px 16px", backgroundColor: COLOURS.CARD_ALT, fontSize: "10.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: COLOURS.INK_400 }}>
            <div>Department</div><div>Open</div><div>Overdue</div>
          </div>
          {deptBreakdown.length === 0 ? (
            <div style={{ padding: "16px", textAlign: "center", color: COLOURS.SLATE, fontSize: "13px" }}>No data yet.</div>
          ) : deptBreakdown.map((d) => (
            <div key={d.department} style={{ display: "grid", gridTemplateColumns: "1.6fr 0.8fr 0.8fr", gap: "10px", padding: "9px 16px", borderTop: `1px solid ${COLOURS.HAIRLINE}`, alignItems: "center" }}>
              <div style={{ fontSize: "13px", color: COLOURS.NAVY }}>{d.department}</div>
              <div style={{ fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>{d.open_count}</div>
              <div style={{ fontSize: "14px", fontWeight: 600, color: d.overdue_count > 0 ? COLOURS.RED : COLOURS.GREEN }}>{d.overdue_count}</div>
            </div>
          ))}
        </div>
      )}


      {/* Import/export stays as its own row — a deliberate secondary action,
          not competing with the stat strip above for attention. */}
      <div style={{ marginBottom: "14px" }}>
        {(canImport ?? isPrivileged) && (
          <ImportExportButtons
            onExport={() => {
              const headers = ["Description", "Assigned To", "Priority", "Due Date", "Status", "Project"];
              const rows = scopedTasks.map((t) => [t.description, t.assigned_to || "—", t.priority || "—", t.due_date || "—", t.status, t.project || "—"]);
              downloadCSV(`tasks-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
            }}
            onImport={async (rows) => {
              // Strict validation, per Khuram's call: a row with an
              // Assigned By, Department, or Company that doesn't exactly
              // match a real system value is rejected outright — no
              // silent fallback to whatever text was typed in the
              // spreadsheet (see TASK_NOTIFICATION_AUDIT.md). Valid rows
              // in the same file still import; only the bad ones are
              // skipped, listed so they can be fixed and re-imported.
              const { data: allMembers } = await supabase.from("members").select("name, first_name, last_name, email, department, business_unit");
              const memberList = allMembers || [];
              const memberByName = new Map(memberList.map((m) => {
                const full = `${m.first_name || ""} ${m.last_name || ""}`.trim();
                return [(full || m.name || "").toLowerCase(), m];
              }));
              const deptSet = new Set(allDepartments.map((d) => d.toLowerCase()));
              const companyByLabel = new Map(companies.flatMap((c) => [
                [c.name.toLowerCase(), c],
                ...(c.short_code ? [[c.short_code.toLowerCase(), c] as [string, CompanyLite]] : []),
              ]));

              const errors: string[] = [];
              const validRows: { row: Record<string, string>; member: typeof memberList[number] | undefined; companyId: string }[] = [];
              rows.forEach((row, i) => {
                const line = i + 2;
                if (!row["Description"]?.trim()) { errors.push(`Row ${line}: Description is required`); return; }
                if (row["Description"].trim().length > TASK_DESCRIPTION_LIMIT) { errors.push(`Row ${line}: Description exceeds ${TASK_DESCRIPTION_LIMIT} characters`); return; }
                if (!row["Assigned To"]?.trim()) { errors.push(`Row ${line}: Assigned To is required`); return; }
                if (!row["Assigned By"]?.trim()) { errors.push(`Row ${line}: Assigned By is required`); return; }
                const assignedByMember = memberByName.get(row["Assigned By"].trim().toLowerCase());
                if (!assignedByMember) { errors.push(`Row ${line}: Assigned By "${row["Assigned By"].trim()}" doesn't match a real member`); return; }
                if (!row["Due Date"]?.trim()) { errors.push(`Row ${line}: Due Date is required`); return; }
                if (!row["Priority"]?.trim()) { errors.push(`Row ${line}: Priority is required`); return; }
                if (!row["Department / Area"]?.trim()) { errors.push(`Row ${line}: Department / Area is required`); return; }
                if (!deptSet.has(row["Department / Area"].trim().toLowerCase())) { errors.push(`Row ${line}: Department / Area "${row["Department / Area"].trim()}" doesn't match a real department`); return; }
                if (!row["Company"]?.trim()) { errors.push(`Row ${line}: Company is required`); return; }
                const company = companyByLabel.get(row["Company"].trim().toLowerCase());
                if (!company) { errors.push(`Row ${line}: Company "${row["Company"].trim()}" doesn't match a real company`); return; }
                const assignedName = row["Assigned To"].trim();
                const member = memberList.find((m) => {
                  const full = `${m.first_name || ""} ${m.last_name || ""}`.trim();
                  return full.toLowerCase() === assignedName.toLowerCase() || (m.name || "").toLowerCase() === assignedName.toLowerCase();
                });
                if (!member) { errors.push(`Row ${line}: Assigned To "${assignedName}" doesn't match a real member`); return; }
                validRows.push({ row, member, companyId: company.id });
              });
              if (errors.length > 0) {
                toast.show(`Import validation failed:\n${errors.slice(0, 10).join("\n")}${errors.length > 10 ? `\n...and ${errors.length - 10} more` : ""}`, "error");
                return;
              }

              let count = 0;
              const failedRows: string[] = [];
              for (const { row, member, companyId } of validRows) {
                const res = await authFetch("/api/tasks/create", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    description: row["Description"].trim(),
                    companyId,
                    assignedTo: row["Assigned To"].trim(),
                    assignedToEmail: member?.email || null,
                    assignedToDepartment: member?.department || row["Department / Area"].trim(),
                    assignedToBusinessUnit: member?.business_unit || null,
                    priority: row["Priority"].trim(),
                    dueDate: row["Due Date"].trim(),
                    status: row["Starting Status"]?.trim() || "Not Started",
                    project: row["Department / Area"].trim(),
                    notes: row["Notes"]?.trim() || null,
                    taskType: "Task",
                  }),
                });
                const result = await res.json().catch(() => ({}));
                if (res.ok && !result?.error) count++;
                else failedRows.push(row["Description"].trim());
              }
              if (failedRows.length > 0) {
                toast.show(`Imported ${count} task${count !== 1 ? "s" : ""}. ${failedRows.length} failed: ${failedRows.slice(0, 5).join(", ")}${failedRows.length > 5 ? "…" : ""}`, "error");
              } else {
                toast.show(`Successfully imported ${count} task${count !== 1 ? "s" : ""}.`, "success");
              }
              refreshAll();
            }}
            templateHeaders={["Description", "Assigned To", "Assigned By", "Assigned Date", "Due Date", "Priority", "Department / Area", "Company", "Starting Status", "Notes"]}
            templateFilename="tasks-import-template.csv"
            exportLabel="Export all tasks as CSV"
            importLabel="Import tasks from CSV"
          />
        )}
      </div>

      {kpiDrawer && (() => {
        const drawerTasks =
          kpiDrawer === "Open" ? allOpen :
          kpiDrawer === "Overdue" ? overdueTasks :
          kpiDrawer === "Due Today" ? allOpen.filter((t) => t.due_date === todayStr) :
          kpiDrawer === "Waiting Reply" ? waitingReply :
          kpiDrawer === "Stuck" ? scopedTasks.filter((t) => t.status === "Stuck") :
          completedAll;
        return (
          <div style={{ ...cardStyle, overflow: "hidden", marginBottom: "14px" }}>
            <div style={{ padding: "9px 16px", backgroundColor: COLOURS.CARD_ALT, borderBottom: `1px solid ${COLOURS.HAIRLINE}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
              <span style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.NAVY }}>{kpiDrawer} ({drawerTasks.length})</span>
              <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                {drawerTasks.length > 0 && (
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", fontWeight: 600, color: COLOURS.NAVY, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={isAllSelected(drawerTasks.map((t) => t.id))}
                      onChange={() => toggleSelectAll(drawerTasks.map((t) => t.id))}
                      style={{ width: "15px", height: "15px", cursor: "pointer" }}
                    />
                    Select all
                  </label>
                )}
                <span onClick={() => setKpiDrawer(null)} style={{ fontSize: "12px", fontWeight: 700, color: COLOURS.SLATE, cursor: "pointer" }}>Close ✕</span>
              </div>
            </div>
            {drawerTasks.length === 0 ? (
              <div style={{ padding: "16px", textAlign: "center", color: COLOURS.SLATE, fontSize: "13px" }}>Nothing here.</div>
            ) : (
              // Same TaskRow component every other view uses — was a
              // bespoke, non-clickable-looking div before with no checkbox,
              // which is why opening/editing/selecting a task from a KPI
              // card (Open/Overdue/Due Today/etc.) felt different from
              // opening one from the List or Tree view. One row renderer,
              // used everywhere, per Khuram: "this should be universal."
              drawerTasks.sort((a, b) => daysOverdue(b) - daysOverdue(a) || (a.due_date || "9").localeCompare(b.due_date || "9")).map((t) => <TaskRow key={t.id} task={t} selectable />)
            )}
          </div>
        );
      })()}

      {/* ═══ VIEW TOGGLE ═══ Team/Recurring as plain pills on the left
          (they aren't task-list views); Board/Tree/List/Timeline as an
          icon switcher on the right, per Khuram. ═══ */}
      <div style={{
        position: "sticky", top: 0, zIndex: 10,
        backgroundColor: COLOURS.CARD_ALT,
        borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
        padding: "8px 2px 10px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
          <div style={{ display: "flex", gap: "4px" }}>
            {/* Team (Workload scoreboard) is privileged-only — it shows
                every department's outstanding counts (Khuram, 24/07/2026). */}
            {(isPrivileged ? (["team", "recurring"] as const) : (["recurring"] as const)).map((v) => (
              <button key={v} onClick={() => setTimeView(v)} style={{
                backgroundColor: timeView === v ? COLOURS.NAVY : COLOURS.CARD,
                color: timeView === v ? "white" : COLOURS.NAVY,
                border: `1px solid ${timeView === v ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
                borderRadius: RADII.PILL, padding: isMobile ? "6px 10px" : "6px 14px",
                fontSize: isMobile ? "12px" : "13px", fontWeight: 600, cursor: "pointer",
                textTransform: "capitalize",
              }}>{v}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: "4px" }}>
            {(["list", "board", "tree", "timeline"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setTimeView(v)}
                title={VIEW_LABELS[v]}
                aria-label={VIEW_LABELS[v]}
                style={{
                  backgroundColor: timeView === v ? COLOURS.NAVY : COLOURS.CARD,
                  border: `1px solid ${timeView === v ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
                  borderRadius: RADII.SM, width: isMobile ? "30px" : "34px", height: isMobile ? "30px" : "34px",
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                }}
              >
                {viewIcon(v, timeView === v)}
              </button>
            ))}
          </div>
        </div>

        {/* ═══ BULK SELECTION TOOLBAR — selectedIds is one shared,
            page-level set, so this shows above List, Tree, or a KPI-card
            drawer, whichever put tasks into it. Lives inside this sticky
            wrapper (not inside the List view block, where it used to be
            the only place it could appear) so it stays pinned to the top
            of the screen while scrolling through a long selection instead
            of scrolling out of view, per Khuram. ═══ */}
        {selectedIds.size > 0 && (
          <div style={{
            display: "flex", flexDirection: "column", gap: "8px",
            padding: "10px 12px",
            border: `1px solid ${COLOURS.NAVY}`, borderRadius: RADII.SM, backgroundColor: COLOURS.CARD,
            boxShadow: "0 2px 6px rgba(15,23,32,0.08)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: COLOURS.NAVY }}>{selectedIds.size} task{selectedIds.size !== 1 ? "s" : ""} selected</span>
              <button onClick={() => setSelectedIds(new Set())} style={{ ...smallActionBtn, backgroundColor: "transparent", color: COLOURS.SLATE, border: `1px solid ${COLOURS.HAIRLINE}` }}>Clear</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
              <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} style={{ ...filterSelectStyle, flex: "1 1 140px" }}>
                <option value="">Change status…</option>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button onClick={applyBulkStatus} disabled={!bulkStatus || bulkApplying} style={{ ...smallActionBtn, borderRadius: RADII.PILL, opacity: !bulkStatus || bulkApplying ? 0.5 : 1, cursor: !bulkStatus || bulkApplying ? "not-allowed" : "pointer" }}>Apply</button>

              <select value={bulkCompanyId} onChange={(e) => setBulkCompanyId(e.target.value)} style={{ ...filterSelectStyle, flex: "1 1 140px" }}>
                <option value="">Change company…</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button onClick={applyBulkCompany} disabled={!bulkCompanyId || bulkApplying} style={{ ...smallActionBtn, borderRadius: RADII.PILL, opacity: !bulkCompanyId || bulkApplying ? 0.5 : 1, cursor: !bulkCompanyId || bulkApplying ? "not-allowed" : "pointer" }}>Apply</button>

              <select value={bulkOwnerId} onChange={(e) => setBulkOwnerId(e.target.value)} style={{ ...filterSelectStyle, flex: "1 1 140px" }}>
                <option value="">Change owner…</option>
                {/* CEO assignment lock (24/07/2026) — CEOs only pickable
                    by a CEO account or the PA; server twin in createTaskCore */}
                {filterAssignableMembers(bulkMembers, myEmail).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <button onClick={applyBulkOwner} disabled={!bulkOwnerId || bulkApplying} style={{ ...smallActionBtn, borderRadius: RADII.PILL, opacity: !bulkOwnerId || bulkApplying ? 0.5 : 1, cursor: !bulkOwnerId || bulkApplying ? "not-allowed" : "pointer" }}>Apply</button>

              {(() => {
                const eligibleCount = Array.from(selectedIds).filter((id) => {
                  const t = tasks.find((x) => x.id === id);
                  if (!t) return false;
                  // Self-created tasks (requires_manager_signoff === false) can be
                  // completed from any open status — no Submitted step needed.
                  // All other tasks still need to be Submitted first.
                  const selfCreated = t.requires_manager_signoff === false;
                  const statusOk = selfCreated
                    ? (t.status !== "Completed" && t.status !== "Cancelled")
                    : t.status === "Submitted";
                  return statusOk
                    && !(t.task_subtasks || []).some((s) => !s.is_complete)
                    && canCompleteSubmittedTask({ email: myEmail, role: currentRole }, t.assigned_to_email);
                }).length;
                return (
                  <button
                    onClick={applyBulkComplete}
                    disabled={eligibleCount === 0 || bulkApplying}
                    title={eligibleCount === 0 ? "None of your selected tasks are ready for you to close (Submitted tasks or your own self-created tasks)" : undefined}
                    style={{
                      ...smallActionBtn, borderRadius: RADII.PILL,
                      backgroundColor: eligibleCount === 0 ? smallActionBtn.backgroundColor : COLOURS.GREEN,
                      opacity: eligibleCount === 0 || bulkApplying ? 0.5 : 1,
                      cursor: eligibleCount === 0 || bulkApplying ? "not-allowed" : "pointer",
                    }}
                  >
                    Mark Complete{eligibleCount > 0 ? ` (${eligibleCount})` : ""}
                  </button>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* ═══ ONE TOOLBAR ROW — search, Filters, the All/Overdue/Waiting quick
          pills, and (List view only) the My tasks/Everyone scope + Select
          all used to be four separate stacked rows. Folded into one
          wrapping row, matching the single consolidated toolbar Khuram
          approved — everything task-list-level lives together instead of
          reading as a stack of strips. Hidden on Team/Recurring, which
          aren't task lists. ═══ */}
      {timeView !== "team" && timeView !== "recurring" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: filtersOpen ? "8px" : "12px" }}>
          {/* Row 1: search + reset */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "7px", border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: COLOURS.CARD, borderRadius: RADII.PILL, padding: "6px 14px", flex: 1 }}>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tasks…"
                style={{ border: "none", outline: "none", background: "transparent", fontSize: "13px", color: COLOURS.NAVY, width: "100%" }}
              />
            </div>
            {filtersActive && (
              <button onClick={resetFilters} style={{ background: "none", border: "none", color: COLOURS.RED, fontSize: "12.5px", fontWeight: 600, cursor: "pointer", textDecoration: "underline", whiteSpace: "nowrap" }}>
                Reset
              </button>
            )}
          </div>

          {/* Row 2: filter pills + scope toggle (wraps on mobile) */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            {(["all", "overdue", "waiting", "exception"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} style={{
                backgroundColor: filter === f ? COLOURS.NAVY : COLOURS.CARD,
                color: filter === f ? "white" : COLOURS.NAVY,
                border: `1px solid ${filter === f ? COLOURS.NAVY : COLOURS.HAIRLINE}`,
                borderRadius: RADII.PILL, padding: isMobile ? "7px 10px" : "6px 12px", fontSize: isMobile ? "12px" : "13px", fontWeight: 600, cursor: "pointer",
              }}>
                {f === "all" ? "All" : f === "overdue" ? `Overdue (${overdueMineCount})` : f === "waiting" ? `Waiting (${waitingMineCount})` : `Needs exp. (${exceptionMineCount})`}
              </button>
            ))}

            {timeView === "list" && (
              <>
                <div style={{ display: "flex", gap: "4px", backgroundColor: COLOURS.TRACK, borderRadius: RADII.PILL, padding: "3px", marginLeft: isMobile ? 0 : "auto" }}>
                  {(["mine", "everyone"] as const).map((s) => (
                    <button key={s} onClick={() => setMyTasksScope(s)} style={{
                      backgroundColor: myTasksScope === s ? COLOURS.CARD : "transparent",
                      color: myTasksScope === s ? COLOURS.NAVY : COLOURS.SLATE,
                      border: "none", borderRadius: RADII.PILL, padding: "5px 12px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer",
                      boxShadow: myTasksScope === s ? "0 1px 2px rgba(15,23,32,0.08)" : "none",
                    }}>
                      {s === "mine" ? "Mine" : "Everyone"}
                    </button>
                  ))}
                </div>
                {!isMobile && (
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", fontWeight: 600, color: COLOURS.NAVY, cursor: (listFilteredTasks ?? myTasksSource).length > 0 ? "pointer" : "default" }}>
                    <input
                      type="checkbox"
                      checked={isAllSelected((listFilteredTasks ?? myTasksSource).map((t) => t.id))}
                      onChange={() => toggleSelectAll((listFilteredTasks ?? myTasksSource).map((t) => t.id))}
                      disabled={(listFilteredTasks ?? myTasksSource).length === 0}
                      style={{ width: "15px", height: "15px", cursor: (listFilteredTasks ?? myTasksSource).length > 0 ? "pointer" : "default" }}
                    />
                    Select all ({(listFilteredTasks ?? myTasksSource).length})
                  </label>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {timeView !== "team" && timeView !== "recurring" && filtersOpen && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px",
          marginBottom: "12px", padding: "12px", border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, backgroundColor: COLOURS.CARD,
        }}>
          {/* Audit dept non-managers only see their own tasks — company filter is noise for them */}
          {!(department === "Audit" && !isPrivileged) && (
            <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} style={{ ...filterSelectStyle, width: "100%" }}>
              <option value="all">All companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="group">Group / needs review</option>
            </select>
          )}
          <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} style={{ ...filterSelectStyle, width: "100%" }}>
            <option value="all">All departments</option>
            {departmentOptions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} style={{ ...filterSelectStyle, width: "100%" }}>
            <option value="all">All priorities</option>
            <option>Urgent</option><option>High</option><option>Medium</option><option>Low</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...filterSelectStyle, width: "100%" }}>
            <option value="all">All statuses</option>
            <option>Not Started</option>
            <option>In Progress</option>
            <option>Waiting Reply</option>
            <option>Stuck</option>
            <option>Submitted</option>
            <option>Completed</option>
          </select>
          <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} style={{ ...filterSelectStyle, width: "100%" }}>
            <option value="all">All owners</option>
            {ownerOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <select value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value as typeof periodFilter)} style={{ ...filterSelectStyle, width: "100%" }}>
            <option value="all">Any due period</option>
            <option value="week">Due this week</option>
            <option value="month">Due this month</option>
            <option value="quarter">Due this quarter</option>
          </select>
          <select value={dueFilter} onChange={(e) => setDueFilter(e.target.value)} style={{ ...filterSelectStyle, width: "100%" }}>
            <option value="all">Any due date</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="none">No due date</option>
          </select>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} style={{ ...filterSelectStyle, width: "100%" }}>
            <option value="all">All sources</option>
            <option value="meeting">Meeting-sourced only</option>
            <option value="manual">Manually created</option>
            <option value="recurring">Recurring-generated</option>
          </select>
          <select value={subtaskFilter} onChange={(e) => setSubtaskFilter(e.target.value)} style={{ ...filterSelectStyle, width: "100%" }}>
            <option value="all">Any subtask state</option>
            <option value="has">Has subtasks</option>
            <option value="complete">All subtasks complete</option>
            <option value="none">No subtasks</option>
          </select>
        </div>
      )}

      {/* ═══ LIST VIEW (default landing view) ═══ */}
      {timeView === "list" && (
        <div>
          {listFilteredTasks ? (
            // A specific quick-filter (or bell deep-link) is active — show
            // one flat list of just that category instead of the usual
            // due-date grouping, so "Overdue" etc. actually means "only
            // these tasks", not "the whole list with a pill highlighted".
            <div style={{ ...cardStyle, overflow: "hidden" }}>
              {listFilteredTasks.length === 0 ? (
                <div style={{ padding: "14px", textAlign: "center", color: COLOURS.INK_400, fontSize: "12.5px" }}>Nothing here. Nice.</div>
              ) : (
                listFilteredTasks
                  .slice()
                  .sort((a, b) => daysOverdue(b) - daysOverdue(a) || (a.due_date || "9").localeCompare(b.due_date || "9"))
                  .map((t) => <TaskRow key={t.id} task={t} selectable />)
              )}
            </div>
          ) : (
            myTasksGroupOrder.filter((g) => myTasksGroups.has(g)).map((group) => {
              const groupTasks = myTasksGroups.get(group)!;
              return (
                <div key={group} style={{ marginBottom: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: myTasksGroupColor(group), display: "inline-block" }} />
                    <span style={{ fontSize: "12.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: COLOURS.NAVY }}>{group}</span>
                    <span style={{ fontSize: "12px", color: COLOURS.SLATE, fontWeight: 600 }}>{groupTasks.length}</span>
                  </div>
                  <div style={{ ...cardStyle, overflow: "hidden" }}>
                    {groupTasks.length === 0 ? (
                      <div style={{ padding: "14px", textAlign: "center", color: COLOURS.INK_400, fontSize: "12.5px" }}>Nothing here. Nice.</div>
                    ) : (
                      groupTasks.sort((a, b) => daysOverdue(b) - daysOverdue(a) || (a.due_date || "9").localeCompare(b.due_date || "9")).map((t) => <TaskRow key={t.id} task={t} selectable />)
                    )}
                  </div>
                </div>
              );
            })
          )}
          {myTasksSource.length === 0 && (
            <div style={{ ...cardStyle, padding: "24px", textAlign: "center", color: COLOURS.SLATE, marginBottom: "16px" }}>
              {myTasksScope === "mine" ? "Nothing needs your action right now." : "No tasks to show."}
            </div>
          )}

          {/* ═══ DELEGATED BY ME — tasks I allocated (meetings or direct)
              that others are still working on. Not action items, so they
              sit below my own groups — but always visible. ═══ */}
          {!listFilteredTasks && delegatedByMe.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: COLOURS.SLATE, display: "inline-block" }} />
                <span style={{ fontSize: "12.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: COLOURS.NAVY }}>Delegated by me</span>
                <span style={{ fontSize: "12px", color: COLOURS.SLATE, fontWeight: 600 }}>{delegatedByMe.length}</span>
                <span style={{ fontSize: "11.5px", color: COLOURS.SLATE }}>— with your team, watching only</span>
              </div>
              <div style={{ ...cardStyle, overflow: "hidden" }}>
                {delegatedByMe
                  .slice()
                  .sort((a, b) => daysOverdue(b) - daysOverdue(a) || (a.due_date || "9").localeCompare(b.due_date || "9"))
                  .map((t) => <TaskRow key={t.id} task={t} selectable />)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ TREE VIEW — Department → Person → Tasks, both levels collapsible ═══ */}
      {timeView === "tree" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "14px" }}>
          {deptNodes.length > 0 && (
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", fontWeight: 600, color: COLOURS.NAVY, cursor: "pointer", alignSelf: "flex-end" }}>
              <input
                type="checkbox"
                checked={isAllSelected(treeVisibleIds)}
                onChange={() => toggleSelectAll(treeVisibleIds)}
                style={{ width: "15px", height: "15px", cursor: "pointer" }}
              />
              Select all ({treeVisibleIds.length})
            </label>
          )}
          {deptNodes.length === 0 ? (
            <div style={{ ...cardStyle, padding: "24px", textAlign: "center", color: COLOURS.SLATE }}>No tasks to show.</div>
          ) : deptNodes.map((d) => {
            const isDeptCollapsed = !expandedDepts.has(d.dept);
            const deptFiltered = filter === "overdue" ? d.tasks.filter(isOverdue) : filter === "waiting" ? d.tasks.filter((t) => t.status === "Waiting Reply") : filter === "exception" ? d.tasks.filter((t) => !!t.explanation_required) : filter === "submitted" ? d.tasks.filter((t) => t.status === "Submitted") : d.tasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled");
            if (deptFiltered.length === 0 && filter !== "all") return null;

            const personGroups = new Map<string, Task[]>();
            for (const t of deptFiltered) {
              const p = normName(t.assigned_to) || "Unassigned";
              if (!personGroups.has(p)) personGroups.set(p, []);
              personGroups.get(p)!.push(t);
            }
            const persons = Array.from(personGroups.entries()).sort((a, b) => b[1].length - a[1].length);

            return (
              <div key={d.dept} style={{
                border: `1px solid ${COLOURS.HAIRLINE}`,
                borderLeft: `4px solid ${d.overdue > 0 ? COLOURS.RED : COLOURS.GREEN}`,
                borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD, overflow: "hidden",
              }}>
                <div
                  onClick={() => toggleDept(d.dept)}
                  style={{ padding: "11px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: COLOURS.CARD_ALT }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ color: COLOURS.SLATE, fontSize: "11px" }}>{isDeptCollapsed ? "▶" : "▼"}</span>
                    <span style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY }}>{d.dept}</span>
                  </div>
                  <div style={{ display: "flex", gap: "12px" }}>
                    <span style={{ fontSize: "12px", color: COLOURS.BLUE, fontWeight: 600 }}>{d.open} open</span>
                    {d.overdue > 0 && <span style={{ fontSize: "12px", color: COLOURS.RED, fontWeight: 700 }}>{d.overdue} overdue</span>}
                  </div>
                </div>

                {!isDeptCollapsed && persons.map(([person, ptasks]) => {
                  const key = `${d.dept}::${person}`;
                  const isPersonCollapsed = !expandedPeople.has(key);
                  return (
                    <div key={key} style={{ borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>
                      <div
                        onClick={() => togglePerson(key)}
                        style={{ padding: "8px 16px 8px 32px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: COLOURS.CARD }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ color: COLOURS.SLATE, fontSize: "10px" }}>{isPersonCollapsed ? "▶" : "▼"}</span>
                          <span style={{ fontSize: "12.5px", fontWeight: 600, color: COLOURS.NAVY }}>{person}</span>
                        </div>
                        <span style={{ fontSize: "11.5px", color: COLOURS.SLATE, fontWeight: 600 }}>{ptasks.length}</span>
                      </div>
                      {!isPersonCollapsed && (
                        <div style={{ paddingLeft: "24px", borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>
                          {ptasks.sort((a, b) => daysOverdue(b) - daysOverdue(a) || (a.due_date || "9").localeCompare(b.due_date || "9")).map((t) => <TaskRow key={t.id} task={t} selectable />)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ TIMELINE VIEW ═══ */}
      {timeView === "timeline" && (() => {
        const tasksWithDates = filteredTasks.filter((t) => t.due_date);
        if (tasksWithDates.length === 0) return (
          <div style={{ ...cardStyle, padding: "24px", marginBottom: "14px", textAlign: "center", color: COLOURS.SLATE }}>
            No tasks with due dates to show on timeline.
          </div>
        );

        const sorted = [...tasksWithDates].sort((a, b) => a.due_date!.localeCompare(b.due_date!));
        const today = new Date();
        const minDate = new Date(Math.min(today.getTime(), new Date(sorted[0].due_date! + "T00:00:00").getTime()));
        minDate.setDate(minDate.getDate() - 2);
        const maxDate = new Date(sorted[sorted.length - 1].due_date! + "T00:00:00");
        maxDate.setDate(maxDate.getDate() + 5);
        const range = maxDate.getTime() - minDate.getTime();

        const toX = (dateStr: string) => {
          const d = new Date(dateStr + "T00:00:00").getTime();
          return 60 + ((d - minDate.getTime()) / range) * 680;
        };
        const todayX = 60 + ((today.getTime() - minDate.getTime()) / range) * 680;

        const ROW_H = 28;
        const svgH = Math.max(100, sorted.length * ROW_H + 50);

        const tickDates: string[] = [];
        const tickStep = Math.max(1, Math.round(range / 86400000 / 6));
        const cur = new Date(minDate);
        while (cur <= maxDate) {
          tickDates.push(cur.toISOString().slice(0, 10));
          cur.setDate(cur.getDate() + tickStep);
        }

        return (
          <div style={{ ...cardStyle, padding: "20px 24px", marginBottom: "14px", overflowX: "auto" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 500, color: COLOURS.SLATE, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>Due Date Timeline — {sorted.length} tasks</div>
            <svg width="780" height={svgH} style={{ display: "block", minWidth: "780px" }}>
              <line x1="60" y1="20" x2="740" y2="20" stroke={COLOURS.HAIRLINE} strokeWidth="1" />
              {tickDates.map((d) => {
                const x = toX(d);
                return (
                  <g key={d}>
                    <line x1={x} y1="16" x2={x} y2={svgH - 10} stroke={COLOURS.TRACK} strokeWidth="1" />
                    <text x={x} y="12" textAnchor="middle" fontSize="11" fill={COLOURS.SLATE}>
                      {new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </text>
                  </g>
                );
              })}
              <line x1={todayX} y1="16" x2={todayX} y2={svgH - 10} stroke={COLOURS.RED} strokeWidth="1.5" strokeDasharray="4 3" />
              <text x={todayX} y={svgH - 2} textAnchor="middle" fontSize="10" fill={COLOURS.RED} fontWeight="700">Today</text>
              {sorted.map((t, i) => {
                const x = toX(t.due_date!);
                const y = 36 + i * ROW_H;
                const od = isOverdue(t);
                const color = od ? COLOURS.RED : t.status === "Waiting Reply" ? COLOURS.AMBER : t.priority === "High" || t.priority === "Urgent" ? COLOURS.AMBER : COLOURS.BLUE;
                const label = t.description.length > 32 ? t.description.slice(0, 30) + "…" : t.description;
                return (
                  <g key={t.id} style={{ cursor: "pointer" }} onClick={() => { setTimeView("list"); setExpandedTaskId(t.id); setTimeout(() => document.getElementById(`task-${t.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 100); }}>
                    <circle cx={x} cy={y} r="5" fill={color} />
                    <text x={x + 8} y={y + 4} fontSize="12" fill={COLOURS.NAVY} fontWeight="600">{label}</text>
                    <text x="4" y={y + 4} fontSize="11" fill={COLOURS.SLATE}>{t.assigned_to?.split(" ")[0] || "?"}</text>
                  </g>
                );
              })}
            </svg>
          </div>
        );
      })()}

      {/* ═══ BOARD (KANBAN) VIEW ═══ */}
      {timeView === "board" && (
        <TasksBoard
          tasks={scopedTasks}
          currentRole={currentRole}
          isPrivileged={isPrivileged}
          canReview={canReview}
          canDelete={canDelete}
          myEmail={myEmail}
          memberPhones={memberPhones}
          meetingTitles={meetingTitles}
          companies={companies}
          onChanged={refreshAll}
        />
      )}

      {/* ═══ TEAM VIEW — Workload scoreboard. Clicking a count drills
          into the List view with the matching filters applied, so a
          number is never a dead end (Khuram, 24/07/2026). ═══ */}
      {timeView === "team" && isPrivileged && (
        <TeamStats
          onDrill={(d) => {
            // Reset every list filter first so the drill shows exactly
            // what was clicked, not what was left over from last time.
            setCompanyFilter("all");
            setDepartmentFilter(d.department ?? "all");
            setOwnerFilter(d.owner ?? "all");
            setStatusFilter(d.status ?? "all");
            setDueFilter(d.due ?? "all");
            setPriorityFilter("all");
            setPeriodFilter("all");
            setSourceFilter("all");
            setSubtaskFilter("all");
            setSearchQuery("");
            setFilter("all");
            setMyTasksScope("everyone");
            setTimeView("list");
          }}
        />
      )}

      {/* ═══ RECURRING VIEW ═══ */}
      {timeView === "recurring" && <RecurringTasksPanel isPrivileged={isPrivileged} />}

      {scopedTasks.length === 0 && (
        <p style={{ color: COLOURS.SLATE, fontSize: "14px" }}>No tasks yet.</p>
      )}
    </div>
  );
}
