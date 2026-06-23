"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";
import { useMobile } from "../lib/useMobile";
import { COLOURS, PageHeader, SectionTitle, CountCard, StatusBadge, PriorityBadge } from "../lib/SharedUI";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";

type Task = {
  id: string;
  description: string;
  project: string | null;
  priority: string | null;
  due_date: string | null;
  assigned_to: string | null;
  assigned_by: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
};

type AuditEntry = {
  id: string;
  action: string;
  table_name: string;
  details: string | null;
  created_at: string;
};

const today = new Date().toISOString().slice(0, 10);

function isOverdue(t: Task) {
  if (t.status === "Completed" || t.status === "Cancelled") return false;
  return !!t.due_date && t.due_date < today;
}

function daysOverdue(t: Task): number {
  if (!t.due_date || !isOverdue(t)) return 0;
  return Math.floor((Date.now() - new Date(t.due_date + "T00:00:00").getTime()) / 86400000);
}

function daysUntil(dateStr: string): number {
  return Math.floor((new Date(dateStr + "T00:00:00").getTime() - Date.now()) / 86400000);
}

export default function MyDashboardPage() {
  const isMobile = useMobile();
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState("");
  const [userDept, setUserDept] = useState<string | null>(null);
  const [myTasks, setMyTasks] = useState<Task[]>([]);
  const [assignedByMe, setAssignedByMe] = useState<Task[]>([]);
  const [recentActivity, setRecentActivity] = useState<AuditEntry[]>([]);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const email = user?.email;
    if (!email) { setLoading(false); return; }

    const { data: member } = await supabase.from("members").select("first_name, last_name, name, role, department").eq("email", email).maybeSingle();
    if (member) {
      setUserName(`${member.first_name || ""} ${member.last_name || ""}`.trim() || member.name || email);
      setUserRole(member.role);
      setUserDept(member.department);
    }

    const fullName = member ? `${member.first_name || ""} ${member.last_name || ""}`.trim() || member.name : email;

    // My tasks (assigned to me)
    const { data: tasks } = await supabase.from("tasks").select("*").or(`assigned_to_email.eq.${email},assigned_to.eq.${fullName}`).order("created_at", { ascending: false });
    setMyTasks(tasks || []);

    // Tasks I assigned
    const { data: assigned } = await supabase.from("tasks").select("*").eq("assigned_by", fullName).neq("assigned_to", fullName).order("created_at", { ascending: false }).limit(20);
    setAssignedByMe(assigned || []);

    // My recent activity
    const { data: activity } = await supabase.from("audit_log").select("id, action, table_name, details, created_at").eq("user_email", email).order("created_at", { ascending: false }).limit(10);
    setRecentActivity(activity || []);

    setLoading(false);
  }

  const openTasks = myTasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled");
  const overdueTasks = openTasks.filter(isOverdue);
  const waitingReply = openTasks.filter((t) => t.status === "Waiting Reply");
  const completedThisMonth = myTasks.filter((t) => t.status === "Completed" && t.updated_at && t.updated_at.slice(0, 7) === today.slice(0, 7));
  const dueThisWeek = openTasks.filter((t) => t.due_date && t.due_date >= today && daysUntil(t.due_date) <= 7).sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));

  const donutData = [
    { name: "Overdue", value: overdueTasks.length, color: COLOURS.RED },
    { name: "Waiting Reply", value: waitingReply.length, color: "#d97706" },
    { name: "In Progress", value: openTasks.filter((t) => t.status === "In Progress").length, color: COLOURS.BLUE },
    { name: "Not Started", value: openTasks.filter((t) => t.status === "Not Started").length, color: COLOURS.SLATE },
  ].filter((d) => d.value > 0);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
        {loading ? (
          <p style={{ color: COLOURS.SLATE }}>Loading your dashboard...</p>
        ) : (
          <>
            <div style={{ marginBottom: "16px" }}>
              <h1 style={{ fontSize: "24px", fontWeight: 800, color: COLOURS.NAVY, margin: 0 }}>{greeting}, {userName}</h1>
              <p style={{ color: COLOURS.SLATE, fontSize: "14px", marginTop: "4px" }}>
                {userRole}{userDept ? ` · ${userDept}` : ""} · Here&apos;s your pulse for today
              </p>
            </div>

            {/* Overdue banner */}
            {overdueTasks.length > 0 && (
              <div style={{ border: "1px solid #fecaca", borderLeft: "4px solid #dc2626", borderRadius: "8px", backgroundColor: "#fef2f2", padding: "12px 16px", marginBottom: "14px", display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "20px" }}>⚠</span>
                <div>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "#991b1b" }}>{overdueTasks.length} overdue task{overdueTasks.length > 1 ? "s" : ""}</div>
                  <div style={{ fontSize: "13px", color: "#991b1b", marginTop: "1px" }}>{overdueTasks.slice(0, 3).map((t) => t.description.slice(0, 30)).join(" · ")}</div>
                </div>
              </div>
            )}

            {/* KPI cards */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
              <CountCard label="Open" value={openTasks.length} color={COLOURS.BLUE} />
              <CountCard label="Overdue" value={overdueTasks.length} color={COLOURS.RED} />
              <CountCard label="Due This Week" value={dueThisWeek.length} color="#d97706" />
              <CountCard label="Completed (Month)" value={completedThisMonth.length} color={COLOURS.GREEN} />
            </div>

            {/* Two columns: task status donut + due this week */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 2fr", gap: "14px", marginBottom: "14px" }}>
              {/* Donut */}
              {donutData.length > 0 && (
                <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "14px", backgroundColor: "white" }}>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY, marginBottom: "6px" }}>My Task Status</div>
                  <ResponsiveContainer width="100%" height={140}>
                    <PieChart>
                      <Pie data={donutData} cx="50%" cy="50%" innerRadius={35} outerRadius={55} dataKey="value" paddingAngle={2}>
                        {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <Tooltip formatter={(value, name) => [`${value} task${Number(value) > 1 ? "s" : ""}`, name]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" }}>
                    {donutData.map((d) => (
                      <div key={d.name} style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "11px", color: COLOURS.SLATE }}>
                        <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: d.color }} /> {d.name} ({d.value})
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Due this week */}
              <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden" }}>
                <div style={{ padding: "10px 14px", backgroundColor: "#f8fafc", borderBottom: `1px solid ${COLOURS.BORDER}`, fontSize: "14px", fontWeight: 700, color: COLOURS.NAVY }}>
                  Due This Week ({dueThisWeek.length})
                </div>
                {dueThisWeek.length === 0 ? (
                  <div style={{ padding: "14px", color: COLOURS.SLATE, textAlign: "center", fontSize: "14px" }}>Nothing due this week</div>
                ) : (
                  dueThisWeek.map((t) => {
                    const d = daysUntil(t.due_date!);
                    const urgency = d <= 1 ? COLOURS.RED : d <= 3 ? "#d97706" : COLOURS.SLATE;
                    return (
                      <a key={t.id} href={`/tasks?task=${t.id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", borderBottom: `1px solid ${COLOURS.LIGHT}`, textDecoration: "none", color: "inherit" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</div>
                        </div>
                        <div style={{ display: "flex", gap: "5px", alignItems: "center", flexShrink: 0 }}>
                          <span style={{ fontSize: "12px", fontWeight: 700, color: urgency }}>{d === 0 ? "Today" : d === 1 ? "Tomorrow" : `${d}d`}</span>
                          <PriorityBadge priority={t.priority} />
                        </div>
                      </a>
                    );
                  })
                )}
              </div>
            </div>

            {/* Tasks I assigned to others */}
            {assignedByMe.length > 0 && (
              <>
                <SectionTitle title={`Tasks I Assigned (${assignedByMe.filter((t) => t.status !== "Completed" && t.status !== "Cancelled").length} open)`} />
                <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden", marginBottom: "14px" }}>
                  {assignedByMe.filter((t) => t.status !== "Completed" && t.status !== "Cancelled").slice(0, 10).map((t) => (
                    <a key={t.id} href={`/tasks?task=${t.id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", borderBottom: `1px solid ${COLOURS.LIGHT}`, textDecoration: "none", color: "inherit" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</div>
                        <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>{t.assigned_to || "Unassigned"}{t.due_date && ` · Due: ${formatDateUK(t.due_date)}`}</div>
                      </div>
                      <div style={{ display: "flex", gap: "5px", alignItems: "center", flexShrink: 0 }}>
                        {isOverdue(t) && <span style={{ fontSize: "11px", fontWeight: 700, color: COLOURS.RED }}>{daysOverdue(t)}d late</span>}
                        <StatusBadge status={t.status} />
                      </div>
                    </a>
                  ))}
                </div>
              </>
            )}

            {/* All my open tasks */}
            <SectionTitle title={`My Open Tasks (${openTasks.length})`} />
            <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden", marginBottom: "14px" }}>
              {openTasks.length === 0 ? (
                <div style={{ padding: "14px", color: COLOURS.SLATE, textAlign: "center", fontSize: "14px" }}>No open tasks — all clear</div>
              ) : (
                openTasks.sort((a, b) => daysOverdue(b) - daysOverdue(a)).slice(0, 20).map((t) => {
                  const od = daysOverdue(t);
                  return (
                    <a key={t.id} href={`/tasks?task=${t.id}`} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "8px 14px", borderBottom: `1px solid ${COLOURS.LIGHT}`,
                      textDecoration: "none", color: "inherit",
                      backgroundColor: isOverdue(t) ? "#fef2f2" : "white",
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</div>
                        <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>
                          {t.project || "—"}{t.due_date && ` · Due: ${formatDateUK(t.due_date)}`}
                          {od > 0 && <span style={{ color: COLOURS.RED, fontWeight: 700 }}> · {od}d late</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "5px", alignItems: "center", flexShrink: 0 }}>
                        <PriorityBadge priority={t.priority} />
                        <StatusBadge status={t.status} />
                      </div>
                    </a>
                  );
                })
              )}
            </div>

            {/* Recent activity */}
            {recentActivity.length > 0 && (
              <>
                <SectionTitle title="My Recent Activity" />
                <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden", marginBottom: "14px" }}>
                  {recentActivity.map((a) => (
                    <div key={a.id} style={{ padding: "8px 14px", borderBottom: `1px solid ${COLOURS.LIGHT}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13px", color: COLOURS.NAVY }}>
                          <span style={{
                            fontSize: "11px", fontWeight: 700, padding: "1px 6px", borderRadius: "6px", marginRight: "6px",
                            backgroundColor: a.action === "Created" ? "#dcfce7" : a.action.startsWith("Updated") ? "#fef3c7" : "#fee2e2",
                            color: a.action === "Created" ? "#16a34a" : a.action.startsWith("Updated") ? "#d97706" : "#dc2626",
                          }}>{a.action}</span>
                          {a.table_name}{a.details && ` — ${a.details.slice(0, 60)}`}
                        </div>
                      </div>
                      <div style={{ fontSize: "12px", color: COLOURS.SLATE, whiteSpace: "nowrap", flexShrink: 0 }}>
                        {formatDateUK(a.created_at.slice(0, 10))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </AuthWrapper>
  );
}
