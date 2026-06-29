"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase, loadMyPermissions, authFetch } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import { useMobile } from "../lib/useMobile";
import { COLOURS, PageHeader, SectionTitle, CountCard, StatusBadge } from "../lib/SharedUI";
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
  const [savingNewTask, setSavingNewTask] = useState(false);
  const [allMembers, setAllMembers] = useState<{ name: string; email: string | null; department: string | null }[]>([]);

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
      // Admin / CEO / PA / override-granted: see ALL meetings
      const { data } = await supabase.from("meetings").select("*").order("meeting_date", { ascending: false });
      meetingsData = data || [];
    } else {
      // Everyone else: see meetings they attended OR have tasks assigned from
      const { data: attendeeLinks } = await supabase
        .from("meeting_attendees")
        .select("meeting_id")
        .eq("member_email", email);

      const meetingIds = new Set((attendeeLinks || []).map((a) => a.meeting_id));

      // Also match by full name in the attendees JSON array
      const fullName = memberData ? `${memberData.first_name || ""} ${memberData.last_name || ""}`.trim() || memberData.name : "";
      if (fullName && fullName.length >= 3) {
        const { data: allMeetings } = await supabase.from("meetings").select("id, attendees").order("meeting_date", { ascending: false });
        for (const m of allMeetings || []) {
          if (m.attendees?.some((a: string) => a.toLowerCase() === fullName.toLowerCase())) {
            meetingIds.add(m.id);
          }
        }
      }

      // Include meetings where user has assigned tasks (so "View Minutes" link works)
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
          .select("*")
          .in("id", Array.from(meetingIds))
          .order("meeting_date", { ascending: false });
        meetingsData = data || [];
      }
    }

    setMeetings(meetingsData);

    // Load members for task creation
    const { data: membersData } = await supabase.from("members").select("name, first_name, last_name, email, department");
    if (membersData) {
      setAllMembers(membersData.map((m) => ({
        name: `${m.first_name || ""} ${m.last_name || ""}`.trim() || m.name || "",
        email: m.email, department: m.department,
      })).filter((m) => m.name));
    }

    // Load meeting tasks
    const { data: mtData } = await supabase.from("meeting_tasks").select("*");
    setMeetingTasks(mtData || []);

    // Load tasks linked to meetings
    const { data: taskData } = await supabase.from("tasks").select("id, description, assigned_to, due_date, priority, status, meeting_id").not("meeting_id", "is", null);
    setTasks(taskData || []);

    // Mark as viewed
    if (!privUser && email) {
      for (const m of meetingsData) {
        await supabase.from("meeting_attendees").update({ viewed_at: new Date().toISOString() }).eq("meeting_id", m.id).eq("member_email", email).is("viewed_at", null);
      }
    }

    setLoading(false);
  }

  function getTasksForMeeting(meetingId: string): Task[] {
    const taskIds = meetingTasks.filter((mt) => mt.meeting_id === meetingId).map((mt) => mt.task_id);
    const fromLink = tasks.filter((t) => taskIds.includes(t.id));
    const fromField = tasks.filter((t) => t.meeting_id === meetingId && !taskIds.includes(t.id));
    return [...fromLink, ...fromField];
  }

  const filtered = filter
    ? meetings.filter((m) =>
        m.title.toLowerCase().includes(filter.toLowerCase()) ||
        m.executive_summary?.toLowerCase().includes(filter.toLowerCase()) ||
        m.attendees?.some((a) => a.toLowerCase().includes(filter.toLowerCase()))
      )
    : meetings;

  async function addTaskToMeeting(meetingId: string) {
    if (!newTaskDesc.trim() || !newTaskOwner) return;
    setSavingNewTask(true);
    const member = allMembers.find((m) => m.name === newTaskOwner);
    const { data: userData } = await supabase.auth.getUser();
    const creatorEmail = userData.user?.email || null;
    const { data: task } = await supabase.from("tasks").insert({
      description: newTaskDesc.trim(),
      assigned_to: newTaskOwner,
      assigned_to_email: member?.email || null,
      assigned_to_department: member?.department || null,
      assigned_by: "Meeting Minutes",
      assigned_by_email: creatorEmail,
      assigned_date: new Date().toISOString().slice(0, 10),
      due_date: newTaskDue || null,
      priority: newTaskPriority,
      status: "Not Started",
      meeting_id: meetingId,
      task_type: "Task",
    }).select("id").single();

    if (task) {
      await supabase.from("meeting_tasks").insert({ meeting_id: meetingId, task_id: task.id });
      if (member?.email) {
        authFetch("/api/notifications/send", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "task_assigned", taskId: task.id, recipientEmail: member.email }),
        }).catch(() => {});
      }
    }

    setNewTaskDesc(""); setNewTaskOwner(""); setNewTaskDue(""); setNewTaskPriority("Normal");
    setAddingTaskFor(null);
    setSavingNewTask(false);
    loadData();
  }

  if (!loading && meetings.length === 0 && !isAdmin) {
    return (
      <AuthWrapper>
        <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
          <PageHeader />
          <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderLeft: `4px solid ${COLOURS.AMBER}`, borderRadius: "6px", padding: "12px 16px", backgroundColor: "var(--bg-card, #ffffff)", fontSize: "15px", color: "var(--text-primary, #1e293b)" }}>
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

        {!loading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "8px", marginBottom: "14px" }}>
            <CountCard label="Total" value={meetings.length} color={COLOURS.BLUE} />
            <CountCard label="This Month" value={meetings.filter((m) => m.meeting_date >= new Date().toISOString().slice(0, 7)).length} color={COLOURS.NAVY} />
            <CountCard label="Action Items" value={meetings.reduce((s, m) => s + getTasksForMeeting(m.id).length, 0)} color={COLOURS.AMBER} />
          </div>
        )}

        <div style={{ marginBottom: "14px" }}>
          <input type="text" placeholder="Search meetings by title, summary, or attendee..." value={filter} onChange={(e) => setFilter(e.target.value)}
            style={{ width: "100%", maxWidth: "400px", padding: "7px 12px", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "6px", fontSize: "16px", boxSizing: "border-box" }} />
        </div>

        {loading ? (
          <p style={{ color: "var(--text-secondary, #64748b)" }}>Loading minutes...</p>
        ) : filtered.length === 0 ? (
          <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", padding: "14px", backgroundColor: "var(--bg-card, #ffffff)", color: "var(--text-secondary, #64748b)", textAlign: "center" }}>
            {filter ? "No meetings match your search." : "No meeting minutes yet."}
          </div>
        ) : (
          <div>
            {filtered.map((meeting) => {
              const isOpen = expandedId === meeting.id;
              const mTasks = getTasksForMeeting(meeting.id);
              const openTasks = mTasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled");
              return (
                <div key={meeting.id} style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "8px", backgroundColor: "var(--bg-card, #ffffff)", overflow: "hidden", marginBottom: "10px" }}>
                  {/* Meeting header */}
                  <div onClick={() => setExpandedId(isOpen ? null : meeting.id)} style={{
                    padding: "12px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
                    backgroundColor: isOpen ? "var(--bg-card-hover, #f8fafc)" : "var(--bg-card, #ffffff)",
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary, #1e293b)" }}>{meeting.title}</div>
                      <div style={{ fontSize: "14px", color: "var(--text-secondary, #64748b)", marginTop: "2px" }}>
                        {formatDateUK(meeting.meeting_date)}
                        {meeting.attendees && <span> · {meeting.attendees.length} attendee{meeting.attendees.length > 1 ? "s" : ""}</span>}
                        {mTasks.length > 0 && <span> · {mTasks.length} action item{mTasks.length > 1 ? "s" : ""}</span>}
                        {openTasks.length > 0 && <span style={{ color: COLOURS.AMBER, fontWeight: 700 }}> · {openTasks.length} open</span>}
                      </div>
                    </div>
                    <span style={{ color: "var(--text-secondary, #64748b)", fontSize: "14px" }}>{isOpen ? "▲" : "▼"}</span>
                  </div>

                  {/* Expanded content */}
                  {isOpen && (
                    <div style={{ padding: "14px", borderTop: "1px solid var(--border-color, #e2e8f0)" }}>
                      {/* Executive Summary */}
                      {meeting.executive_summary && (
                        <div style={{ marginBottom: "12px" }}>
                          <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary, #1e293b)", marginBottom: "4px" }}>Summary</div>
                          <div style={{ fontSize: "16px", color: "var(--text-secondary, #64748b)", lineHeight: 1.6 }}>{meeting.executive_summary}</div>
                        </div>
                      )}

                      {/* Attendees */}
                      {meeting.attendees && meeting.attendees.length > 0 && (
                        <div style={{ marginBottom: "12px" }}>
                          <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary, #1e293b)", marginBottom: "4px" }}>Attendees</div>
                          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                            {meeting.attendees.map((a, i) => (
                              <span key={i} style={{ fontSize: "12px", padding: "2px 8px", backgroundColor: "var(--border-light, #f1f5f9)", borderRadius: "10px", color: "var(--text-primary, #1e293b)" }}>{a}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Decisions */}
                      {meeting.decisions && meeting.decisions.length > 0 && (
                        <div style={{ marginBottom: "12px" }}>
                          <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.GREEN, marginBottom: "4px" }}>Decisions</div>
                          {meeting.decisions.map((d, i) => (
                            <div key={i} style={{ fontSize: "16px", color: "var(--text-primary, #1e293b)", padding: "3px 0", borderBottom: "1px solid var(--border-light, #f1f5f9)" }}>• {d}</div>
                          ))}
                        </div>
                      )}

                      {/* Risks */}
                      {meeting.risks && meeting.risks.length > 0 && (
                        <div style={{ marginBottom: "12px" }}>
                          <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.RED, marginBottom: "4px" }}>Risks</div>
                          {meeting.risks.map((r, i) => (
                            <div key={i} style={{ fontSize: "16px", color: "var(--text-primary, #1e293b)", padding: "3px 0", borderBottom: "1px solid var(--border-light, #f1f5f9)" }}>• {r}</div>
                          ))}
                        </div>
                      )}

                      {/* Opportunities */}
                      {meeting.opportunities && meeting.opportunities.length > 0 && (
                        <div style={{ marginBottom: "12px" }}>
                          <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.BLUE, marginBottom: "4px" }}>Opportunities</div>
                          {meeting.opportunities.map((o, i) => (
                            <div key={i} style={{ fontSize: "16px", color: "var(--text-primary, #1e293b)", padding: "3px 0", borderBottom: "1px solid var(--border-light, #f1f5f9)" }}>• {o}</div>
                          ))}
                        </div>
                      )}

                      {/* Action Items / Tasks */}
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                          <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.AMBER }}>Action Items ({mTasks.length})</div>
                          {isAdmin && (
                            <button onClick={() => setAddingTaskFor(addingTaskFor === meeting.id ? null : meeting.id)} style={{
                              backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "5px",
                              padding: "4px 12px", fontSize: "12px", fontWeight: 700, cursor: "pointer",
                            }}>{addingTaskFor === meeting.id ? "Cancel" : "+ Add Task"}</button>
                          )}
                        </div>

                        {/* Inline add task form */}
                        {addingTaskFor === meeting.id && (
                          <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderTop: `3px solid ${COLOURS.NAVY}`, borderRadius: "6px", padding: "10px", marginBottom: "8px", backgroundColor: "var(--bg-card, #ffffff)" }}>
                            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr 1fr 1fr", gap: "6px", marginBottom: "6px" }}>
                              <input placeholder="Task description" value={newTaskDesc} onChange={(e) => setNewTaskDesc(e.target.value)} required
                                style={{ padding: "6px 8px", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "5px", fontSize: "15px" }} />
                              <select value={newTaskOwner} onChange={(e) => setNewTaskOwner(e.target.value)} required
                                style={{ padding: "6px 8px", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "5px", fontSize: "15px" }}>
                                <option value="">Assign to...</option>
                                {allMembers.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                              </select>
                              <input type="date" value={newTaskDue} onChange={(e) => setNewTaskDue(e.target.value)}
                                style={{ padding: "6px 8px", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "5px", fontSize: "15px" }} />
                              <select value={newTaskPriority} onChange={(e) => setNewTaskPriority(e.target.value)}
                                style={{ padding: "6px 8px", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "5px", fontSize: "15px" }}>
                                <option>Low</option><option>Normal</option><option>High</option><option>Urgent</option>
                              </select>
                            </div>
                            <button onClick={() => addTaskToMeeting(meeting.id)} disabled={savingNewTask || !newTaskDesc.trim() || !newTaskOwner}
                              style={{ backgroundColor: COLOURS.GREEN, color: "white", border: "none", borderRadius: "5px", padding: "6px 14px", fontSize: "15px", fontWeight: 700, cursor: "pointer", opacity: savingNewTask || !newTaskDesc.trim() || !newTaskOwner ? 0.5 : 1 }}>
                              {savingNewTask ? "Adding..." : "Add Task"}
                            </button>
                          </div>
                        )}

                        {mTasks.length > 0 && (
                          <div style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "6px", overflow: "hidden" }}>
                            {mTasks.map((t) => (
                              <a key={t.id} href={`/tasks?task=${t.id}`} style={{
                                display: "flex", justifyContent: "space-between", alignItems: "center",
                                padding: "8px 12px", borderBottom: "1px solid var(--border-light, #f1f5f9)",
                                textDecoration: "none", color: "inherit",
                              }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "var(--bg-card-hover, #f8fafc)"; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "var(--bg-card, #ffffff)"; }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary, #1e293b)" }}>{t.description}</div>
                                  <div style={{ fontSize: "14px", color: "var(--text-secondary, #64748b)" }}>{t.assigned_to || "Unassigned"}{t.due_date && ` · Due: ${formatDateUK(t.due_date)}`}</div>
                                </div>
                                <div style={{ display: "flex", gap: "5px", alignItems: "center", flexShrink: 0 }}>
                                  <StatusBadge status={t.status} />
                                  <span style={{ fontSize: "14px", color: COLOURS.BLUE, fontWeight: 600 }}>Open →</span>
                                </div>
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
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
