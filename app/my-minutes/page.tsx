"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase, loadMyPermissions, authFetch } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import DateInputWithCalendar from "../lib/DateInputWithCalendar";
import { useMobile } from "../lib/useMobile";
import { COLOURS, RADII, cardStyle, PageHeader, CountCard, StatusBadge, inputStyle, primaryButtonStyle, labelStyle, TASK_DESCRIPTION_LIMIT, TASK_COMPANY_CODES } from "../lib/SharedUI";
import { canSeeAllMinutes, type UserCtx, type PermOverrides } from "../lib/permissions";

type Meeting = {
  id: string;
  meeting_date: string;
  title: string;
  executive_summary: string | null;
  decisions: string[] | null;
  risks: string[] | null;
  opportunities: string[] | null;
  attendees: string[] | null;
  department: string | null;
  company: string | null;
  created_at: string;
};

type MeetingTask = {
  id: string;
  meeting_id: string;
  task_id: string;
};

type Task = {
  id: string;
  description: string;
  assigned_to: string | null;
  due_date: string | null;
  priority: string | null;
  status: string;
  meeting_id: string | null;
};

const DEPT_ACCENT: Record<string, string> = {
  "Finance": COLOURS.GREEN,
  "HR": COLOURS.AMBER,
  "Admin": COLOURS.SLATE,
  "Audit": COLOURS.RED,
  "Taxation": COLOURS.RED,
  "IT": COLOURS.BLUE,
  "Unze Trading Ops": COLOURS.BLUE,
  "Executive Office": COLOURS.NAVY,
};
const deptAccent = (dept: string) => DEPT_ACCENT[dept] || COLOURS.SLATE;

function taskDotColour(status: string) {
  if (status === "Completed") return COLOURS.GREEN;
  if (status === "In Progress") return COLOURS.RED;
  return COLOURS.AMBER;
}

export default function MyMinutesPageWrapper() {
  return <Suspense fallback={<p>Loading...</p>}><MyMinutesPage /></Suspense>;
}

function MyMinutesPage() {
  const isMobile = useMobile();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [meetingTasks, setMeetingTasks] = useState<MeetingTask[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const searchParams = useSearchParams();
  const meetingIdFromUrl = searchParams.get("meeting");
  const [expandedId, setExpandedId] = useState<string | null>(meetingIdFromUrl);
  const [isAdmin, setIsAdmin] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedDept, setSelectedDept] = useState<string>("All");
  const [addingTaskFor, setAddingTaskFor] = useState<string | null>(null);
  const [newTaskDesc, setNewTaskDesc] = useState("");
  const [newTaskOwner, setNewTaskOwner] = useState("");
  const [newTaskDue, setNewTaskDue] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState("Normal");
  const [newTaskCompanyId, setNewTaskCompanyId] = useState("");
  const [newTaskError, setNewTaskError] = useState("");
  const [savingNewTask, setSavingNewTask] = useState(false);
  const [allMembers, setAllMembers] = useState<{ name: string; email: string | null; department: string | null }[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string; short_code: string | null }[]>([]);

  // Task filter panel (click a summary card to drill in)
  const [taskFilter, setTaskFilter] = useState<"in_progress" | "pending" | "completed" | null>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email || null;

    if (!email) { setLoading(false); return; }

    const { data: memberData } = await supabase
      .from("members")
      .select("id, role, is_hod, name, first_name, last_name, department, company")
      .eq("email", email)
      .maybeSingle();

    const role = memberData?.role || "Member";

    let overrides: PermOverrides | null = null;
    const p = await loadMyPermissions();
    if (p) overrides = p as PermOverrides;
    const ctx: UserCtx = { email, role, department: memberData?.department, company: memberData?.company, overrides };
    const privUser = canSeeAllMinutes(ctx);

    setIsAdmin(privUser);

    let meetingsData: Meeting[] = [];

    if (privUser) {
      const { data } = await supabase.from("meetings").select("id, meeting_date, title, executive_summary, decisions, risks, opportunities, attendees, department, company, created_at").order("meeting_date", { ascending: false });
      meetingsData = data || [];
    } else {
      const { data: attendeeLinks } = await supabase
        .from("meeting_attendees")
        .select("meeting_id")
        .eq("member_email", email);

      const meetingIds = new Set((attendeeLinks || []).map((a) => a.meeting_id));

      const fullName = memberData ? `${memberData.first_name || ""} ${memberData.last_name || ""}`.trim() || memberData.name : "";
      if (fullName && fullName.length >= 3) {
        const { data: allMeetings } = await supabase.from("meetings").select("id, attendees").order("meeting_date", { ascending: false });
        for (const m of allMeetings || []) {
          if (m.attendees?.some((a: string) => a.toLowerCase() === fullName.toLowerCase())) {
            meetingIds.add(m.id);
          }
        }
      }

      const { data: taskMeetings } = await supabase
        .from("tasks")
        .select("meeting_id")
        .eq("assigned_to_email", email)
        .not("meeting_id", "is", null);
      for (const t of taskMeetings || []) {
        if (t.meeting_id) meetingIds.add(t.meeting_id);
      }

      if (meetingIds.size > 0) {
        const { data } = await supabase
          .from("meetings")
          .select("id, meeting_date, title, executive_summary, decisions, risks, opportunities, attendees, department, company, created_at")
          .in("id", Array.from(meetingIds))
          .order("meeting_date", { ascending: false });
        meetingsData = data || [];
      }
    }

    setMeetings(meetingsData);

    const { data: membersData } = await supabase.from("members").select("name, first_name, last_name, email, department").eq("is_active", true);
    if (membersData) {
      setAllMembers(membersData.map((m) => ({
        name: `${m.first_name || ""} ${m.last_name || ""}`.trim() || m.name || "",
        email: m.email, department: m.department,
      })).filter((m) => m.name));
    }

    const { data: companiesData } = await supabase.from("companies").select("id, name, short_code").in("short_code", TASK_COMPANY_CODES).order("name", { ascending: true });
    setCompanies(companiesData || []);

    const { data: mtData } = await supabase.from("meeting_tasks").select("id, meeting_id, task_id");
    setMeetingTasks(mtData || []);

    const { data: taskData } = await supabase.from("tasks").select("id, description, assigned_to, due_date, priority, status, meeting_id").not("meeting_id", "is", null);
    setTasks(taskData || []);

    if (!privUser && email) {
      for (const m of meetingsData) {
        await supabase.from("meeting_attendees").update({ viewed_at: new Date().toISOString() }).eq("meeting_id", m.id).eq("member_email", email).is("viewed_at", null);
      }
    }

    setLoading(false);
  }

  function downloadMinutesPDF(meeting: Meeting, mTasks: Task[]) {
    const html = `
      <html><head><title>${meeting.title}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 30px; color: #1e293b; max-width: 800px; margin: 0 auto; }
        h1 { font-size: 20px; margin-bottom: 4px; }
        .meta { font-size: 13px; color: #64748b; margin-bottom: 16px; }
        h2 { font-size: 15px; margin: 16px 0 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
        .summary { font-size: 14px; line-height: 1.6; color: #475569; }
        .badge { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 8px; background: #f1f5f9; margin-right: 4px; }
        ul { padding-left: 20px; margin: 4px 0; }
        li { font-size: 14px; margin-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th, td { border: 1px solid #e2e8f0; padding: 6px 10px; text-align: left; }
        th { background: #f8fafc; font-weight: 700; }
        @media print { body { padding: 10px; } }
      </style></head><body>
      <h1>${meeting.title}</h1>
      <div class="meta">
        ${formatDateUK(meeting.meeting_date)}
        ${meeting.department ? ` · ${meeting.department}` : ""}
        ${meeting.company ? ` · ${meeting.company}` : ""}
      </div>
      ${meeting.attendees?.length ? `<h2>Attendees</h2><div>${meeting.attendees.map((a) => `<span class="badge">${a}</span>`).join(" ")}</div>` : ""}
      ${meeting.executive_summary ? `<h2>Executive Summary</h2><div class="summary">${meeting.executive_summary}</div>` : ""}
      ${meeting.decisions?.length ? `<h2>Decisions</h2><ul>${meeting.decisions.map((d) => `<li>${d}</li>`).join("")}</ul>` : ""}
      ${meeting.risks?.length ? `<h2>Risks</h2><ul>${meeting.risks.map((r) => `<li>${r}</li>`).join("")}</ul>` : ""}
      ${meeting.opportunities?.length ? `<h2>Opportunities</h2><ul>${meeting.opportunities.map((o) => `<li>${o}</li>`).join("")}</ul>` : ""}
      ${mTasks.length ? `<h2>Action Items (${mTasks.length})</h2>
        <table><tr><th>Task</th><th>Owner</th><th>Due</th><th>Priority</th><th>Status</th></tr>
        ${mTasks.map((t) => `<tr><td>${t.description}</td><td>${t.assigned_to || "—"}</td><td>${t.due_date ? formatDateUK(t.due_date) : "—"}</td><td>${t.priority || "Normal"}</td><td>${t.status}</td></tr>`).join("")}
        </table>` : ""}
      <div style="margin-top:20px;font-size:11px;color:#94a3b8;text-align:center">Generated from Unze Group · ${new Date().toLocaleDateString("en-GB")}</div>
      </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.print(); }
  }

  function getTasksForMeeting(meetingId: string): Task[] {
    const taskIds = meetingTasks.filter((mt) => mt.meeting_id === meetingId).map((mt) => mt.task_id);
    const fromLink = tasks.filter((t) => taskIds.includes(t.id));
    const fromField = tasks.filter((t) => t.meeting_id === meetingId && !taskIds.includes(t.id));
    return [...fromLink, ...fromField];
  }

  // Search filter
  const filtered = filter
    ? meetings.filter((m) =>
        m.title.toLowerCase().includes(filter.toLowerCase()) ||
        m.executive_summary?.toLowerCase().includes(filter.toLowerCase()) ||
        m.attendees?.some((a) => a.toLowerCase().includes(filter.toLowerCase()))
      )
    : meetings;

  // Unique dept list for tabs
  const deptList = Array.from(
    new Set(filtered.map((m) => m.department || m.company || "Executive Office"))
  ).sort();

  // Meetings shown — filtered by tab + search, newest first
  const displayedMeetings = (selectedDept === "All"
    ? filtered
    : filtered.filter((m) => (m.department || m.company || "Executive Office") === selectedDept)
  ).slice().sort((a, b) => b.meeting_date.localeCompare(a.meeting_date));

  // Total stats for the header summary strip
  const totalTasks = filtered.reduce((s, m) => s + getTasksForMeeting(m.id).length, 0);
  const totalOpen = filtered.reduce((s, m) => s + getTasksForMeeting(m.id).filter((t) => t.status === "In Progress").length, 0);
  const totalPending = filtered.reduce((s, m) => s + getTasksForMeeting(m.id).filter((t) => t.status === "Not Started" || t.status === "Waiting Reply").length, 0);
  const totalCompleted = filtered.reduce((s, m) => s + getTasksForMeeting(m.id).filter((t) => t.status === "Completed").length, 0);

  // Suppress unused variable warning — totalTasks is kept for potential future use
  void totalTasks;

  // Task aging by department — always-visible breakdown table
  const taskAgingByDept = (() => {
    const today = new Date();
    const map = new Map<string, { open: number; pending: number; oldestDays: number }>();
    for (const m of filtered) {
      const dept = m.department || "Executive Office";
      const mTasks = getTasksForMeeting(m.id).filter((t) => t.status !== "Completed" && t.status !== "Cancelled");
      if (mTasks.length === 0) continue;
      const days = Math.floor((today.getTime() - new Date(m.meeting_date).getTime()) / 86400000);
      const entry = map.get(dept) || { open: 0, pending: 0, oldestDays: 0 };
      for (const t of mTasks) {
        if (t.status === "In Progress") entry.open++;
        else entry.pending++;
      }
      entry.oldestDays = Math.max(entry.oldestDays, days);
      map.set(dept, entry);
    }
    return Array.from(map.entries())
      .map(([dept, v]) => ({ dept, ...v }))
      .sort((a, b) => b.oldestDays - a.oldestDays);
  })();

  // Task panel: flat list of tasks for the active filter, with meeting context
  const taskPanelItems = taskFilter ? filtered.flatMap((m) =>
    getTasksForMeeting(m.id)
      .filter((t) => {
        if (taskFilter === "in_progress") return t.status === "In Progress";
        if (taskFilter === "pending") return t.status === "Not Started" || t.status === "Waiting Reply";
        if (taskFilter === "completed") return t.status === "Completed";
        return false;
      })
      .map((t) => ({ ...t, meetingTitle: m.title, meetingDate: m.meeting_date }))
  ).sort((a, b) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  }) : [];

  async function addTaskToMeeting(meetingId: string) {
    if (!newTaskDesc.trim() || !newTaskOwner || !newTaskDue || !newTaskCompanyId) return;
    setSavingNewTask(true);
    setNewTaskError("");
    const member = allMembers.find((m) => m.name === newTaskOwner);

    const res = await authFetch("/api/tasks/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: newTaskDesc.trim(),
        companyId: newTaskCompanyId,
        assignedTo: newTaskOwner,
        assignedToEmail: member?.email || null,
        assignedToDepartment: member?.department || null,
        dueDate: newTaskDue || null,
        priority: newTaskPriority,
        status: "Not Started",
        meetingId,
        taskType: "Task",
      }),
    });
    const result = await res.json().catch(() => ({}));

    if (!res.ok || result?.error) {
      setSavingNewTask(false);
      setNewTaskError(result?.error || "Couldn't add the task. Please try again.");
      return;
    }

    if (result?.taskId) {
      await supabase.from("meeting_tasks").insert({ meeting_id: meetingId, task_id: result.taskId });
    }

    setNewTaskDesc(""); setNewTaskOwner(""); setNewTaskDue(""); setNewTaskPriority("Normal"); setNewTaskCompanyId("");
    setAddingTaskFor(null);
    setSavingNewTask(false);
    loadData();
  }

  if (!loading && meetings.length === 0 && !isAdmin) {
    return (
      <AuthWrapper>
        <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
          <PageHeader />
          <div style={{ ...cardStyle, backgroundColor: COLOURS.WARNING_SOFT, fontSize: "13px", color: COLOURS.AMBER }}>
            No meeting minutes found. You will see minutes here once you are added as an attendee to a meeting.
          </div>
        </main>
      </AuthWrapper>
    );
  }

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
        <PageHeader />

        {/* Summary strip */}
        {!loading && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: "8px", marginBottom: taskFilter ? "0" : "14px" }}>
              <CountCard label="Meetings" value={filtered.length} color={COLOURS.BLUE} />
              {/* Clickable task cards */}
              {(["in_progress", "pending", "completed"] as const).map((key) => {
                const value = key === "in_progress" ? totalOpen : key === "pending" ? totalPending : totalCompleted;
                const colour = key === "in_progress" ? COLOURS.RED : key === "pending" ? COLOURS.AMBER : COLOURS.GREEN;
                const label = key === "in_progress" ? "In Progress" : key === "pending" ? "Pending" : "Completed";
                const active = taskFilter === key;
                return (
                  <div key={key} onClick={() => setTaskFilter(active ? null : key)} style={{
                    ...cardStyle as React.CSSProperties,
                    padding: "16px 20px",
                    borderTop: `3px solid ${colour}`,
                    cursor: "pointer",
                    outline: active ? `2px solid ${colour}` : "none",
                    outlineOffset: "-1px",
                    position: "relative",
                  }}>
                    <div style={{ fontSize: "10.5px", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: COLOURS.SLATE, marginBottom: "10px" }}>{label}</div>
                    <div style={{ fontSize: "26px", fontWeight: 600, letterSpacing: "-0.02em", color: colour }}>{value.toLocaleString()}</div>
                    {active && <div style={{ position: "absolute", bottom: "6px", right: "8px", fontSize: "10px", color: colour }}>▼ showing</div>}
                  </div>
                );
              })}
            </div>

            {/* Task Aging by Department — always visible when there are open tasks */}
            {taskAgingByDept.length > 0 && (
              <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.CARD, overflow: "hidden", marginBottom: taskFilter ? "0" : "14px", marginTop: "8px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 90px", padding: "6px 14px", borderBottom: `1px solid ${COLOURS.BORDER}`, backgroundColor: COLOURS.CARD_ALT }}>
                  <span style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase" as const, color: COLOURS.SLATE, letterSpacing: "0.07em" }}>Dept · Open Tasks</span>
                  <span style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase" as const, color: COLOURS.RED, letterSpacing: "0.07em", textAlign: "center" }}>In Progress</span>
                  <span style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase" as const, color: COLOURS.AMBER, letterSpacing: "0.07em", textAlign: "center" }}>Pending</span>
                  <span style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase" as const, color: COLOURS.SLATE, letterSpacing: "0.07em", textAlign: "right" }}>Oldest Task</span>
                </div>
                {taskAgingByDept.map((row) => {
                  const ageColour = row.oldestDays > 30 ? COLOURS.RED : row.oldestDays > 14 ? COLOURS.AMBER : COLOURS.GREEN;
                  return (
                    <div key={row.dept} style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 90px", padding: "8px 14px", borderBottom: `1px solid ${COLOURS.BORDER}`, alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: deptAccent(row.dept), flexShrink: 0 }} />
                        <span style={{ fontSize: "12px", fontWeight: 600, color: COLOURS.NAVY }}>{row.dept}</span>
                      </div>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: row.open > 0 ? COLOURS.RED : COLOURS.SLATE, textAlign: "center" }}>{row.open}</span>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: row.pending > 0 ? COLOURS.AMBER : COLOURS.SLATE, textAlign: "center" }}>{row.pending}</span>
                      <span style={{ fontSize: "12px", fontWeight: 600, color: ageColour, textAlign: "right" }}>{row.oldestDays} day{row.oldestDays !== 1 ? "s" : ""}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Task panel — shown when a card is clicked */}
            {taskFilter && (
              <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.CARD, overflow: "hidden", marginBottom: "14px", marginTop: "8px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", borderBottom: `1px solid ${COLOURS.BORDER}`, backgroundColor: COLOURS.CARD_ALT }}>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: taskFilter === "in_progress" ? COLOURS.RED : taskFilter === "pending" ? COLOURS.AMBER : COLOURS.GREEN }}>
                    {taskPanelItems.length} {taskFilter === "in_progress" ? "In Progress" : taskFilter === "pending" ? "Pending" : "Completed"} Task{taskPanelItems.length !== 1 ? "s" : ""}
                  </span>
                  <button onClick={() => setTaskFilter(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "16px", color: COLOURS.SLATE, padding: "0 4px", lineHeight: 1 }}>×</button>
                </div>
                {taskPanelItems.length === 0 ? (
                  <div style={{ padding: "16px 14px", fontSize: "12px", color: COLOURS.SLATE }}>No tasks in this category.</div>
                ) : taskPanelItems.map((t) => (
                  <a key={t.id} href={`/tasks?task=${t.id}`} style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    padding: "8px 14px", borderBottom: `1px solid ${COLOURS.BORDER}`,
                    textDecoration: "none", backgroundColor: COLOURS.CARD,
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = COLOURS.CARD_ALT; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = COLOURS.CARD; }}>
                    <div style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: taskDotColour(t.status), flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: "12px", color: COLOURS.NAVY, minWidth: 0 }}>{t.description}</span>
                    <span style={{ fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0, maxWidth: "140px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.meetingTitle}</span>
                    <span style={{ fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0 }}>{t.assigned_to || "—"}</span>
                    <span style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0, minWidth: "74px", textAlign: "right" }}>{t.due_date ? formatDateUK(t.due_date) : "—"}</span>
                    <StatusBadge status={t.status} />
                    <span style={{ fontSize: "11px", color: COLOURS.BLUE, fontWeight: 600, flexShrink: 0 }}>Open →</span>
                  </a>
                ))}
              </div>
            )}
          </>
        )}

        {/* Search */}
        <div style={{ marginBottom: "16px" }}>
          <input type="text" placeholder="Search by title, summary, or attendee..." value={filter} onChange={(e) => setFilter(e.target.value)}
            style={{ ...inputStyle, maxWidth: "400px" }} />
        </div>

        {loading ? (
          <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>Loading minutes...</p>
        ) : filtered.length === 0 ? (
          <div style={{ ...cardStyle, color: COLOURS.SLATE, fontSize: "13px", textAlign: "center", padding: "32px 24px" }}>
            {filter ? "No meetings match your search." : "No meeting minutes yet."}
          </div>
        ) : (
          <div>
            {/* Dept filter tabs */}
            <div style={{ display: "flex", overflowX: "auto", marginBottom: "10px", border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.CARD, overflow: "hidden", backgroundColor: COLOURS.CARD_ALT }}>
              {["All", ...deptList].map((dept, i) => {
                const deptMeetings = dept === "All" ? filtered : filtered.filter((m) => (m.department || m.company || "Executive Office") === dept);
                const openCount = deptMeetings.reduce((s, m) => s + getTasksForMeeting(m.id).filter((t) => t.status === "In Progress").length, 0);
                const pendingCount = deptMeetings.reduce((s, m) => s + getTasksForMeeting(m.id).filter((t) => t.status === "Not Started" || t.status === "Waiting Reply").length, 0);
                const active = selectedDept === dept;
                const pillColour = openCount > 0 ? COLOURS.RED : pendingCount > 0 ? COLOURS.AMBER : null;
                const pillBg = openCount > 0 ? COLOURS.DANGER_SOFT : pendingCount > 0 ? COLOURS.WARNING_SOFT : null;
                const isLast = i === deptList.length; // "All" + deptList
                return (
                  <button key={dept} onClick={() => setSelectedDept(dept)} style={{
                    padding: "8px 14px", fontSize: "12px", fontWeight: active ? 600 : 400,
                    color: active ? COLOURS.NAVY : COLOURS.SLATE,
                    backgroundColor: active ? COLOURS.CARD : "transparent",
                    border: "none", borderRight: isLast ? "none" : `1px solid ${COLOURS.BORDER}`,
                    cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}>
                    {dept}
                    {pillColour && (
                      <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: RADII.PILL, backgroundColor: pillBg!, color: pillColour, fontWeight: 600 }}>
                        {openCount > 0 ? openCount : pendingCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Flat meeting list */}
            {displayedMeetings.length === 0 ? (
              <div style={{ ...cardStyle, padding: "24px", textAlign: "center" as const, color: COLOURS.SLATE, fontSize: "13px" }}>
                {selectedDept !== "All" ? `No meetings for ${selectedDept}.` : "No meetings match your search."}
              </div>
            ) : (
              <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.CARD, overflow: "hidden" }}>
                {displayedMeetings.map((meeting) => {
                  const isOpen = expandedId === meeting.id;
                  const mTasks = getTasksForMeeting(meeting.id);
                  const completedCount = mTasks.filter((t) => t.status === "Completed").length;
                  const pct = mTasks.length ? Math.round((completedCount / mTasks.length) * 100) : 0;
                  const barColour = pct === 100 ? COLOURS.GREEN : pct > 0 ? COLOURS.AMBER : COLOURS.BORDER;

                  return (
                    <div key={meeting.id} id={`meeting-row-${meeting.id}`} style={{ borderBottom: `1px solid ${COLOURS.BORDER}`, backgroundColor: COLOURS.CARD }}>
                      {/* Compact meeting row */}
                      <div onClick={() => setExpandedId(isOpen ? null : meeting.id)} style={{
                        display: "flex", alignItems: "center", gap: "10px",
                        padding: "10px 14px", cursor: "pointer",
                        backgroundColor: isOpen ? COLOURS.CARD_ALT : COLOURS.CARD,
                      }}>
                        <span style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0, minWidth: "74px" }}>{formatDateUK(meeting.meeting_date)}</span>
                        <span style={{ flex: 1, fontSize: "13px", fontWeight: 500, color: COLOURS.NAVY, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{meeting.title}</span>
                        {meeting.company && (
                          <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: RADII.XS, backgroundColor: COLOURS.HAIRLINE, color: COLOURS.BLUE, fontWeight: 600, flexShrink: 0 }}>{meeting.company}</span>
                        )}
                        {selectedDept === "All" && meeting.department && (
                          <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: RADII.XS, backgroundColor: COLOURS.HAIRLINE, color: deptAccent(meeting.department), fontWeight: 600, flexShrink: 0 }}>{meeting.department}</span>
                        )}
                        {mTasks.length > 0 ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                            <div style={{ width: "48px", height: "4px", backgroundColor: COLOURS.TRACK, borderRadius: "2px", overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${pct}%`, backgroundColor: barColour, borderRadius: "2px" }} />
                            </div>
                            <span style={{ fontSize: "11px", color: COLOURS.SLATE, minWidth: "28px", textAlign: "right" }}>{completedCount}/{mTasks.length}</span>
                          </div>
                        ) : (
                          <span style={{ fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0 }}>no tasks</span>
                        )}
                        <span style={{ fontSize: "10px", color: COLOURS.SLATE, flexShrink: 0 }}>{isOpen ? "▲" : "▼"}</span>
                      </div>

                      {/* Expanded content */}
                      {isOpen && (
                        <div style={{ borderTop: `1px solid ${COLOURS.BORDER}`, backgroundColor: COLOURS.CARD_ALT, ...(!isAdmin ? { userSelect: "none", WebkitUserSelect: "none" } as React.CSSProperties : {}) }}
                          onCopy={!isAdmin ? (e) => e.preventDefault() : undefined}>

                          {/* Summary + attendees + PDF */}
                          <div style={{ padding: "12px 14px", borderBottom: `1px solid ${COLOURS.BORDER}` }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", marginBottom: meeting.executive_summary ? "8px" : "0" }}>
                              {meeting.attendees && meeting.attendees.length > 0 && (
                                <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", flex: 1 }}>
                                  {meeting.attendees.map((a, i) => (
                                    <span key={i} style={{ fontSize: "11px", padding: "2px 8px", backgroundColor: COLOURS.CARD, border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.PILL, color: COLOURS.SLATE }}>{a}</span>
                                  ))}
                                </div>
                              )}
                              {isAdmin && (
                                <button onClick={() => downloadMinutesPDF(meeting, mTasks)} style={{ ...primaryButtonStyle, padding: "4px 10px", fontSize: "11px", flexShrink: 0 }}>PDF</button>
                              )}
                            </div>
                            {meeting.executive_summary && (
                              <div style={{ fontSize: "12px", color: COLOURS.INK_700, lineHeight: 1.6 }}>{meeting.executive_summary}</div>
                            )}
                          </div>

                          {/* Decisions / Risks / Opps */}
                          {((meeting.decisions?.length ?? 0) > 0 || (meeting.risks?.length ?? 0) > 0 || (meeting.opportunities?.length ?? 0) > 0) && (
                            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", borderBottom: `1px solid ${COLOURS.BORDER}` }}>
                              {meeting.decisions && meeting.decisions.length > 0 && (
                                <div style={{ borderRight: isMobile ? "none" : `1px solid ${COLOURS.BORDER}`, padding: "10px 14px" }}>
                                  <div style={{ fontSize: "10px", fontWeight: 600, color: COLOURS.GREEN, textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: "6px" }}>Decisions ({meeting.decisions.length})</div>
                                  {meeting.decisions.map((d, i) => (
                                    <div key={i} style={{ display: "flex", gap: "6px", fontSize: "11.5px", color: COLOURS.INK_700, lineHeight: 1.5, paddingBottom: "4px" }}>
                                      <span style={{ color: COLOURS.GREEN, flexShrink: 0 }}>•</span>{d}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {meeting.risks && meeting.risks.length > 0 && (
                                <div style={{ borderRight: isMobile ? "none" : `1px solid ${COLOURS.BORDER}`, padding: "10px 14px" }}>
                                  <div style={{ fontSize: "10px", fontWeight: 600, color: COLOURS.RED, textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: "6px" }}>Risks ({meeting.risks.length})</div>
                                  {meeting.risks.map((r, i) => (
                                    <div key={i} style={{ display: "flex", gap: "6px", fontSize: "11.5px", color: COLOURS.INK_700, lineHeight: 1.5, paddingBottom: "4px" }}>
                                      <span style={{ color: COLOURS.RED, flexShrink: 0 }}>•</span>{r}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {meeting.opportunities && meeting.opportunities.length > 0 && (
                                <div style={{ padding: "10px 14px" }}>
                                  <div style={{ fontSize: "10px", fontWeight: 600, color: COLOURS.BLUE, textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: "6px" }}>Opportunities ({meeting.opportunities.length})</div>
                                  {meeting.opportunities.map((o, i) => (
                                    <div key={i} style={{ display: "flex", gap: "6px", fontSize: "11.5px", color: COLOURS.INK_700, lineHeight: 1.5, paddingBottom: "4px" }}>
                                      <span style={{ color: COLOURS.BLUE, flexShrink: 0 }}>•</span>{o}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Action Items */}
                          <div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", borderBottom: `1px solid ${COLOURS.BORDER}` }}>
                              <span style={{ fontSize: "10px", fontWeight: 600, color: COLOURS.AMBER, textTransform: "uppercase" as const, letterSpacing: "0.07em" }}>Action Items ({mTasks.length})</span>
                              {isAdmin && (
                                <button onClick={() => setAddingTaskFor(addingTaskFor === meeting.id ? null : meeting.id)} style={{ ...primaryButtonStyle, padding: "3px 10px", fontSize: "11px" }}>
                                  {addingTaskFor === meeting.id ? "Cancel" : "+ Add Task"}
                                </button>
                              )}
                            </div>
                            {addingTaskFor === meeting.id && (
                              <div style={{ padding: "10px 14px", borderBottom: `1px solid ${COLOURS.BORDER}`, backgroundColor: COLOURS.CARD }}>
                                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr 1fr 1fr 1fr", gap: "6px", marginBottom: "8px" }}>
                                  <div>
                                    <label style={labelStyle}>Description ({newTaskDesc.length}/{TASK_DESCRIPTION_LIMIT})</label>
                                    <input placeholder="Task description" value={newTaskDesc} onChange={(e) => setNewTaskDesc(e.target.value.slice(0, TASK_DESCRIPTION_LIMIT))} maxLength={TASK_DESCRIPTION_LIMIT} required style={inputStyle} />
                                  </div>
                                  <div>
                                    <label style={labelStyle}>Assign to</label>
                                    <select value={newTaskOwner} onChange={(e) => setNewTaskOwner(e.target.value)} required style={inputStyle}>
                                      <option value="">Assign to...</option>
                                      {allMembers.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                                    </select>
                                  </div>
                                  <div>
                                    <label style={labelStyle}>Company</label>
                                    <select value={newTaskCompanyId} onChange={(e) => setNewTaskCompanyId(e.target.value)} required style={inputStyle}>
                                      <option value="">Select...</option>
                                      {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                  </div>
                                  <div>
                                    <label style={labelStyle}>Due date</label>
                                    <DateInputWithCalendar value={newTaskDue} onChange={(e) => setNewTaskDue(e.target.value)} required style={{ ...inputStyle, borderColor: !newTaskDue ? COLOURS.RED : undefined }} />
                                  </div>
                                  <div>
                                    <label style={labelStyle}>Priority</label>
                                    <select value={newTaskPriority} onChange={(e) => setNewTaskPriority(e.target.value)} style={inputStyle}>
                                      <option>Low</option><option>Normal</option><option>High</option><option>Urgent</option>
                                    </select>
                                  </div>
                                </div>
                                {newTaskError && <div style={{ color: COLOURS.RED, fontSize: "12.5px", marginBottom: "8px" }}>{newTaskError}</div>}
                                <button onClick={() => addTaskToMeeting(meeting.id)} disabled={savingNewTask || !newTaskDesc.trim() || !newTaskOwner || !newTaskDue || !newTaskCompanyId}
                                  style={{ ...primaryButtonStyle, backgroundColor: COLOURS.GREEN, opacity: savingNewTask || !newTaskDesc.trim() || !newTaskOwner || !newTaskDue || !newTaskCompanyId ? 0.5 : 1 }}>
                                  {savingNewTask ? "Adding..." : "Add Task"}
                                </button>
                              </div>
                            )}
                            {mTasks.length > 0 ? mTasks.map((t) => (
                              <a key={t.id} href={`/tasks?task=${t.id}`} style={{
                                display: "flex", alignItems: "center", gap: "10px",
                                padding: "8px 14px", borderBottom: `1px solid ${COLOURS.BORDER}`,
                                textDecoration: "none", backgroundColor: COLOURS.CARD,
                              }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = COLOURS.CARD_ALT; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = COLOURS.CARD; }}>
                                <div style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: taskDotColour(t.status), flexShrink: 0 }} />
                                <span style={{ flex: 1, fontSize: "12px", color: COLOURS.NAVY, minWidth: 0 }}>{t.description}</span>
                                <span style={{ fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0 }}>{t.assigned_to || "—"}</span>
                                <span style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: "11px", color: COLOURS.SLATE, flexShrink: 0, minWidth: "74px", textAlign: "right" }}>{t.due_date ? formatDateUK(t.due_date) : "—"}</span>
                                <StatusBadge status={t.status} />
                                <span style={{ fontSize: "11px", color: COLOURS.BLUE, fontWeight: 600, flexShrink: 0 }}>Open →</span>
                              </a>
                            )) : (
                              <div style={{ padding: "10px 14px", fontSize: "12px", color: COLOURS.SLATE }}>No action items recorded.</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </AuthWrapper>
  );
}
