"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase, loadMyPermissions, authFetch } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import DateInputWithCalendar from "../lib/DateInputWithCalendar";
import { useMobile } from "../lib/useMobile";
import { COLOURS, RADII, cardStyle, PageHeader, SectionTitle, CountCard, StatusBadge, inputStyle, primaryButtonStyle, labelStyle, TASK_DESCRIPTION_LIMIT, TASK_COMPANY_CODES } from "../lib/SharedUI";
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

const formatMonthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  const months = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${months[parseInt(m)]} ${y}`;
};

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
  const [isHOD, setIsHOD] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
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

  // Expanded state for dept→month hierarchy
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email || null;
    setUserEmail(email);

    if (!email) { setLoading(false); return; }

    const { data: memberData } = await supabase
      .from("members")
      .select("id, role, is_hod, name, first_name, last_name, department, company")
      .eq("email", email)
      .maybeSingle();

    const role = memberData?.role || "Member";
    const hod = memberData?.is_hod || false;

    let overrides: PermOverrides | null = null;
    const p = await loadMyPermissions();
    if (p) overrides = p as PermOverrides;
    const ctx: UserCtx = { email, role, department: memberData?.department, company: memberData?.company, overrides };
    const privUser = canSeeAllMinutes(ctx);

    setIsHOD(hod);
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

  function getTaskStatsFor(meetingList: Meeting[]) {
    const ts = meetingList.flatMap((m) => getTasksForMeeting(m.id));
    return {
      total: ts.length,
      open: ts.filter((t) => t.status === "In Progress").length,
      pending: ts.filter((t) => t.status === "Not Started" || t.status === "Waiting Reply").length,
      completed: ts.filter((t) => t.status === "Completed").length,
    };
  }

  // Build dept → month → meetings structure
  const filtered = filter
    ? meetings.filter((m) =>
        m.title.toLowerCase().includes(filter.toLowerCase()) ||
        m.executive_summary?.toLowerCase().includes(filter.toLowerCase()) ||
        m.attendees?.some((a) => a.toLowerCase().includes(filter.toLowerCase()))
      )
    : meetings;

  const deptMonthGroups: [string, [string, Meeting[]][]][] = (() => {
    const deptMap = new Map<string, Map<string, Meeting[]>>();
    for (const m of filtered) {
      const dept = m.department || m.company || "Executive Office";
      const mo = m.meeting_date.slice(0, 7);
      if (!deptMap.has(dept)) deptMap.set(dept, new Map());
      const monthMap = deptMap.get(dept)!;
      if (!monthMap.has(mo)) monthMap.set(mo, []);
      monthMap.get(mo)!.push(m);
    }
    return Array.from(deptMap.entries())
      .map(([dept, monthMap]) => [
        dept,
        Array.from(monthMap.entries()).sort(([a], [b]) => b.localeCompare(a)),
      ] as [string, [string, Meeting[]][]])
      .sort(([a], [b]) => a.localeCompare(b));
  })();

  // Auto-expand first dept and its latest month on first load
  if (expandedDepts.size === 0 && deptMonthGroups.length > 0) {
    expandedDepts.add(deptMonthGroups[0][0]);
    if (deptMonthGroups[0][1].length > 0) {
      expandedMonths.add(`${deptMonthGroups[0][0]}:${deptMonthGroups[0][1][0][0]}`);
    }
  }

  const toggleDept = (dept: string) => {
    setExpandedDepts((prev) => { const n = new Set(prev); n.has(dept) ? n.delete(dept) : n.add(dept); return n; });
  };
  const toggleMonth = (key: string) => {
    setExpandedMonths((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };

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

  // Total stats for the header summary strip
  const totalTasks = filtered.reduce((s, m) => s + getTasksForMeeting(m.id).length, 0);
  const totalOpen = filtered.reduce((s, m) => s + getTasksForMeeting(m.id).filter((t) => t.status === "In Progress").length, 0);
  const totalPending = filtered.reduce((s, m) => s + getTasksForMeeting(m.id).filter((t) => t.status === "Not Started" || t.status === "Waiting Reply").length, 0);
  const totalCompleted = filtered.reduce((s, m) => s + getTasksForMeeting(m.id).filter((t) => t.status === "Completed").length, 0);

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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: "8px", marginBottom: "14px" }}>
            <CountCard label="Meetings" value={filtered.length} color={COLOURS.BLUE} />
            <CountCard label="Depts" value={deptMonthGroups.length} color={COLOURS.NAVY} />
            <CountCard label="In Progress" value={totalOpen} color={totalOpen > 0 ? COLOURS.RED : COLOURS.SLATE} />
            <CountCard label="Pending" value={totalPending} color={totalPending > 0 ? COLOURS.AMBER : COLOURS.SLATE} />
            <CountCard label="Completed" value={totalCompleted} color={COLOURS.GREEN} />
          </div>
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
          /* ── Department → Month → Meeting hierarchy ── */
          <div>
            {deptMonthGroups.map(([dept, months]) => {
              const isDeptOpen = expandedDepts.has(dept);
              const allDeptMeetings = months.flatMap(([, ms]) => ms);
              const stats = getTaskStatsFor(allDeptMeetings);

              return (
                <div key={dept} style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.CARD, overflow: "hidden", marginBottom: "12px" }}>

                  {/* Department header with task stats dashboard */}
                  <div
                    onClick={() => toggleDept(dept)}
                    style={{
                      padding: "16px 20px", cursor: "pointer",
                      backgroundColor: isDeptOpen ? COLOURS.NAVY : COLOURS.CARD,
                      display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap",
                      borderBottom: isDeptOpen ? `1px solid ${COLOURS.BORDER}` : "none",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontSize: "16px", fontWeight: 700, color: isDeptOpen ? "white" : COLOURS.NAVY }}>{dept}</div>
                      <div style={{ fontSize: "12px", color: isDeptOpen ? "rgba(255,255,255,0.55)" : COLOURS.SLATE, marginTop: "2px" }}>
                        {allDeptMeetings.length} meeting{allDeptMeetings.length !== 1 ? "s" : ""} · {months.length} month{months.length !== 1 ? "s" : ""}
                        {stats.total > 0 && <span> · {stats.total} task{stats.total !== 1 ? "s" : ""} total</span>}
                      </div>
                    </div>
                    {/* Task stats pills */}
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                      {stats.open > 0 && (
                        <span style={{ fontSize: "11px", fontWeight: 700, padding: "3px 10px", borderRadius: RADII.PILL, backgroundColor: isDeptOpen ? "rgba(239,68,68,0.25)" : COLOURS.DANGER_SOFT, color: isDeptOpen ? "#fca5a5" : COLOURS.RED }}>
                          {stats.open} in progress
                        </span>
                      )}
                      {stats.pending > 0 && (
                        <span style={{ fontSize: "11px", fontWeight: 700, padding: "3px 10px", borderRadius: RADII.PILL, backgroundColor: isDeptOpen ? "rgba(245,158,11,0.25)" : COLOURS.WARNING_SOFT, color: isDeptOpen ? "#fcd34d" : COLOURS.AMBER }}>
                          {stats.pending} pending
                        </span>
                      )}
                      {stats.completed > 0 && (
                        <span style={{ fontSize: "11px", fontWeight: 700, padding: "3px 10px", borderRadius: RADII.PILL, backgroundColor: isDeptOpen ? "rgba(34,197,94,0.2)" : COLOURS.SUCCESS_SOFT, color: isDeptOpen ? "#86efac" : COLOURS.GREEN }}>
                          {stats.completed} completed
                        </span>
                      )}
                      {stats.total === 0 && (
                        <span style={{ fontSize: "11px", color: isDeptOpen ? "rgba(255,255,255,0.4)" : COLOURS.SLATE }}>no tasks</span>
                      )}
                    </div>
                    <span style={{ color: isDeptOpen ? "white" : COLOURS.SLATE, fontSize: "16px", flexShrink: 0 }}>{isDeptOpen ? "▲" : "▼"}</span>
                  </div>

                  {/* Month sub-groups */}
                  {isDeptOpen && (
                    <div style={{ padding: "10px 12px", backgroundColor: COLOURS.CARD_ALT }}>
                      {months.map(([month, monthMeetings]) => {
                        const monthKey = `${dept}:${month}`;
                        const isMonthOpen = expandedMonths.has(monthKey);
                        const monthStats = getTaskStatsFor(monthMeetings);

                        return (
                          <div key={monthKey} style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: RADII.CARD, backgroundColor: COLOURS.CARD, overflow: "hidden", marginBottom: "8px" }}>
                            {/* Month header */}
                            <div
                              onClick={() => toggleMonth(monthKey)}
                              style={{
                                padding: "10px 16px", cursor: "pointer",
                                display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px",
                                backgroundColor: isMonthOpen ? COLOURS.CARD_ALT : COLOURS.CARD,
                                borderBottom: isMonthOpen ? `1px solid ${COLOURS.BORDER}` : "none",
                              }}
                            >
                              <div>
                                <span style={{ fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>{formatMonthLabel(month)}</span>
                                <span style={{ fontSize: "12px", color: COLOURS.SLATE, marginLeft: "10px" }}>
                                  {monthMeetings.length} meeting{monthMeetings.length !== 1 ? "s" : ""}
                                  {monthStats.open > 0 && <span style={{ color: COLOURS.RED, fontWeight: 700 }}> · {monthStats.open} in progress</span>}
                                  {monthStats.pending > 0 && <span style={{ color: COLOURS.AMBER, fontWeight: 700 }}> · {monthStats.pending} pending</span>}
                                  {monthStats.completed > 0 && <span style={{ color: COLOURS.GREEN, fontWeight: 700 }}> · {monthStats.completed} done</span>}
                                </span>
                              </div>
                              <span style={{ color: COLOURS.SLATE, fontSize: "14px", flexShrink: 0 }}>{isMonthOpen ? "▲" : "▼"}</span>
                            </div>

                            {/* Individual meetings within month */}
                            {isMonthOpen && (
                              <div style={{ padding: "8px" }}>
                                {monthMeetings.map((meeting) => {
                                  const isOpen = expandedId === meeting.id;
                                  const mTasks = getTasksForMeeting(meeting.id);
                                  const completedCount = mTasks.filter((t) => t.status === "Completed").length;
                                  const openCount = mTasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled").length;

                                  return (
                                    <div key={meeting.id} style={{ ...cardStyle, padding: 0, overflow: "hidden", marginBottom: "6px" }}>
                                      {/* Meeting header row */}
                                      <div onClick={() => setExpandedId(isOpen ? null : meeting.id)} style={{
                                        padding: "12px 16px", cursor: "pointer",
                                        display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
                                        backgroundColor: isOpen ? COLOURS.CARD_ALT : COLOURS.CARD,
                                      }}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                                            <span style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: "12px", color: COLOURS.SLATE }}>{formatDateUK(meeting.meeting_date)}</span>
                                            <span style={{ fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontSize: "14px", fontWeight: 600, color: COLOURS.NAVY }}>{meeting.title}</span>
                                            {meeting.company && (
                                              <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: RADII.XS, backgroundColor: COLOURS.HAIRLINE, color: COLOURS.BLUE, fontWeight: 600 }}>{meeting.company}</span>
                                            )}
                                          </div>
                                          <div style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: "12px", color: COLOURS.SLATE, marginTop: "4px" }}>
                                            {meeting.attendees && <span>{meeting.attendees.length} attendee{meeting.attendees.length > 1 ? "s" : ""}</span>}
                                            {mTasks.length > 0 && (
                                              <>
                                                <span> · </span>
                                                <span style={{ color: COLOURS.AMBER }}>{mTasks.length} task{mTasks.length > 1 ? "s" : ""}</span>
                                                {openCount > 0 && <span style={{ color: COLOURS.AMBER, fontWeight: 700 }}> · {openCount} open</span>}
                                              </>
                                            )}
                                          </div>
                                          {mTasks.length > 0 && (
                                            <div style={{ marginTop: "6px", display: "flex", alignItems: "center", gap: "8px" }}>
                                              <div style={{ flex: 1, maxWidth: "100px", height: "4px", backgroundColor: COLOURS.TRACK, borderRadius: "2px", overflow: "hidden" }}>
                                                <div style={{ height: "100%", width: `${(completedCount / mTasks.length) * 100}%`, backgroundColor: completedCount === mTasks.length ? COLOURS.GREEN : COLOURS.AMBER, borderRadius: "2px", transition: "width 0.3s" }} />
                                              </div>
                                              <span style={{ fontSize: "11px", color: COLOURS.SLATE }}>{completedCount}/{mTasks.length} done</span>
                                            </div>
                                          )}
                                        </div>
                                        <span style={{ color: COLOURS.SLATE, fontSize: "13px" }}>{isOpen ? "▲" : "▼"}</span>
                                      </div>

                                      {/* Expanded meeting content */}
                                      {isOpen && (
                                        <div style={{ padding: "20px 22px 24px", borderTop: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: COLOURS.CARD_ALT, ...(!isAdmin ? { userSelect: "none", WebkitUserSelect: "none" } as React.CSSProperties : {}) }}
                                          onCopy={!isAdmin ? (e) => e.preventDefault() : undefined}>
                                          {isAdmin && (
                                            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px" }}>
                                              <button onClick={() => downloadMinutesPDF(meeting, mTasks)} style={{ ...primaryButtonStyle, padding: "6px 14px", display: "flex", alignItems: "center", gap: "6px" }}>
                                                PDF Download
                                              </button>
                                            </div>
                                          )}

                                          {/* Executive Summary */}
                                          {meeting.executive_summary && (
                                            <div style={{ padding: "16px 20px", backgroundColor: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, marginBottom: "16px" }}>
                                              <div style={{ fontSize: "10.5px", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, color: COLOURS.SLATE, marginBottom: "8px" }}>Summary</div>
                                              <div style={{ fontSize: "13px", color: COLOURS.INK_700, lineHeight: 1.6 }}>{meeting.executive_summary}</div>
                                              {meeting.attendees && meeting.attendees.length > 0 && (
                                                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "12px", paddingTop: "12px", borderTop: `1px solid ${COLOURS.HAIRLINE}` }}>
                                                  {meeting.attendees.map((a, i) => (
                                                    <span key={i} style={{ fontSize: "11.5px", padding: "4px 10px", backgroundColor: COLOURS.CARD_ALT, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.PILL, color: COLOURS.INK_700 }}>{a}</span>
                                                  ))}
                                                </div>
                                              )}
                                            </div>
                                          )}

                                          {/* Decisions / Risks / Opportunities */}
                                          {((meeting.decisions?.length ?? 0) > 0 || (meeting.risks?.length ?? 0) > 0 || (meeting.opportunities?.length ?? 0) > 0) && (
                                            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "12px", marginBottom: "16px" }}>
                                              {meeting.decisions && meeting.decisions.length > 0 && (
                                                <div style={{ padding: "16px 20px", backgroundColor: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, position: "relative", overflow: "hidden" }}>
                                                  <div style={{ position: "absolute", top: "16px", bottom: "16px", left: 0, width: "3px", borderRadius: "0 3px 3px 0", backgroundColor: COLOURS.GREEN }} />
                                                  <div style={{ fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontSize: "13.5px", fontWeight: 600, color: COLOURS.GREEN, marginBottom: "10px", paddingLeft: "8px" }}>Decisions</div>
                                                  {meeting.decisions.map((d, i) => (
                                                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "8px", padding: "5px 8px", fontSize: "12px", color: COLOURS.INK_700, lineHeight: 1.5, borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                                                      <span style={{ color: COLOURS.GREEN, flexShrink: 0, marginTop: "2px" }}>•</span>{d}
                                                    </div>
                                                  ))}
                                                </div>
                                              )}
                                              {meeting.risks && meeting.risks.length > 0 && (
                                                <div style={{ padding: "16px 20px", backgroundColor: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, position: "relative", overflow: "hidden" }}>
                                                  <div style={{ position: "absolute", top: "16px", bottom: "16px", left: 0, width: "3px", borderRadius: "0 3px 3px 0", backgroundColor: COLOURS.RED }} />
                                                  <div style={{ fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontSize: "13.5px", fontWeight: 600, color: COLOURS.RED, marginBottom: "10px", paddingLeft: "8px" }}>Risks</div>
                                                  {meeting.risks.map((r, i) => (
                                                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "8px", padding: "5px 8px", fontSize: "12px", color: COLOURS.INK_700, lineHeight: 1.5, borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                                                      <span style={{ color: COLOURS.RED, flexShrink: 0, marginTop: "2px" }}>•</span>{r}
                                                    </div>
                                                  ))}
                                                </div>
                                              )}
                                              {meeting.opportunities && meeting.opportunities.length > 0 && (
                                                <div style={{ padding: "16px 20px", backgroundColor: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, position: "relative", overflow: "hidden" }}>
                                                  <div style={{ position: "absolute", top: "16px", bottom: "16px", left: 0, width: "3px", borderRadius: "0 3px 3px 0", backgroundColor: COLOURS.BLUE }} />
                                                  <div style={{ fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontSize: "13.5px", fontWeight: 600, color: COLOURS.BLUE, marginBottom: "10px", paddingLeft: "8px" }}>Opportunities</div>
                                                  {meeting.opportunities.map((o, i) => (
                                                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "8px", padding: "5px 8px", fontSize: "12px", color: COLOURS.INK_700, lineHeight: 1.5, borderBottom: `1px solid ${COLOURS.HAIRLINE}` }}>
                                                      <span style={{ color: COLOURS.BLUE, flexShrink: 0, marginTop: "2px" }}>•</span>{o}
                                                    </div>
                                                  ))}
                                                </div>
                                              )}
                                            </div>
                                          )}

                                          {/* Action Items / Tasks */}
                                          <div>
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                                              <div style={{ fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontSize: "13.5px", fontWeight: 600, color: COLOURS.AMBER }}>Action Items ({mTasks.length})</div>
                                              {isAdmin && (
                                                <button onClick={() => setAddingTaskFor(addingTaskFor === meeting.id ? null : meeting.id)} style={{ ...primaryButtonStyle, padding: "4px 12px" }}>
                                                  {addingTaskFor === meeting.id ? "Cancel" : "+ Add Task"}
                                                </button>
                                              )}
                                            </div>

                                            {addingTaskFor === meeting.id && (
                                              <div style={{ ...cardStyle, padding: "12px", marginBottom: "8px" }}>
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
                                                    <DateInputWithCalendar value={newTaskDue} onChange={(e) => setNewTaskDue(e.target.value)} required
                                                      style={{ ...inputStyle, borderColor: !newTaskDue ? COLOURS.RED : undefined }} />
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

                                            {mTasks.length > 0 ? (
                                              <div style={{ backgroundColor: COLOURS.CARD, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.CARD, overflow: "hidden" }}>
                                                {mTasks.map((t) => (
                                                  <a key={t.id} href={`/tasks?task=${t.id}`} style={{
                                                    display: "flex", justifyContent: "space-between", alignItems: "center",
                                                    padding: "10px 14px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
                                                    textDecoration: "none", color: "inherit",
                                                  }}
                                                  onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = COLOURS.CARD_ALT; }}
                                                  onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = COLOURS.CARD; }}>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                      <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>{t.description}</div>
                                                      <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "2px" }}>
                                                        {t.assigned_to || "Unassigned"}{t.due_date && ` · Due: ${formatDateUK(t.due_date)}`}
                                                      </div>
                                                    </div>
                                                    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexShrink: 0 }}>
                                                      <StatusBadge status={t.status} />
                                                      <span style={{ fontSize: "12px", color: COLOURS.BLUE, fontWeight: 600 }}>Open →</span>
                                                    </div>
                                                  </a>
                                                ))}
                                              </div>
                                            ) : (
                                              <div style={{ fontSize: "13px", color: COLOURS.SLATE }}>No action items recorded.</div>
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
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </AuthWrapper>
  );
}
