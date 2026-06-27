"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import { COLOURS } from "../lib/SharedUI";
import { useMobile } from "../lib/useMobile";
import { UTPL_COMPANY_ID, IFPL_COMPANY_ID } from "../lib/constants";
import { useUserCtx } from "../lib/useUserCtx";
import {
  PAGE_REGISTRY, GROUP_ORDER, GROUP_COLOURS,
  type PageCard,
} from "../lib/pageRegistry";
import {
  isAdminTier, isCEO as checkIsCEO, canViewFinance, canEditFinance, financeCompanies,
  canViewExecutiveDashboard, canViewOperations, canViewReceivables,
  canSeeAllTasks, canCreateAssignments, canReviewTasks,
  canManageRecurringTasks, canManageCalendarRequests, canSeeAllMinutes,
  canViewDepartment, canManageMembers, canAddMembers,
  canViewAuditLog, canViewExceptions, canImportExport,
  canAccessDailyEntry, isPA as checkIsPA,
  type UserCtx,
} from "../lib/permissions";

const PERM_FUNC: Record<string, (ctx: UserCtx) => boolean> = {
  can_view_executive_dashboard: canViewExecutiveDashboard,
  can_view_operations_dashboard: canViewOperations,
  can_view_pa_dashboard: (c) => checkIsPA(c) || isAdminTier(c),
  can_view_finance: canViewFinance,
  can_edit_finance: canEditFinance,
  can_view_receivables: canViewReceivables,
  can_see_all_tasks: canSeeAllTasks,
  can_create_tasks: canCreateAssignments,
  can_review_tasks: canReviewTasks,
  can_manage_recurring_tasks: canManageRecurringTasks,
  can_manage_calendar: canManageCalendarRequests,
  can_see_all_minutes: canSeeAllMinutes,
  can_view_dept_ops: (c) => canViewDepartment(c, "Unze Trading Ops"),
  can_view_dept_hr: (c) => canViewDepartment(c, "HR"),
  can_view_dept_tax: (c) => canViewDepartment(c, "Tax"),
  can_view_dept_audit: (c) => canViewDepartment(c, "Audit"),
  can_view_dept_admin: (c) => canViewDepartment(c, "Admin"),
  can_view_dept_it: (c) => canViewDepartment(c, "IT"),
  can_view_members: canManageMembers,
  can_add_members: canAddMembers,
  can_view_audit_log: canViewAuditLog,
  can_view_exceptions: canViewExceptions,
  can_import_export: canImportExport,
  can_access_daily_entry: canAccessDailyEntry,
};

function isCardVisible(card: PageCard, ctx: UserCtx): boolean {
  const perms = ctx.overrides as Record<string, boolean | string | null> | null;
  if (card.permKey.startsWith("_")) return true;
  if (card.permKey === "can_view_finance_utpl") {
    if (!canViewFinance(ctx)) return false;
    const scope = financeCompanies(ctx);
    return scope === "both" || scope === "UTPL";
  }
  if (card.permKey === "can_view_finance_ifpl") {
    if (!canViewFinance(ctx)) return false;
    const scope = financeCompanies(ctx);
    return scope === "both" || scope === "IFPL";
  }
  if (perms) {
    const val = perms[card.permKey];
    if (val === true) return true;
    if (val === false) return false;
  }
  const fn = PERM_FUNC[card.permKey];
  if (fn) return fn(ctx);
  return false;
}

type TaskRow = { id: string; description: string; status: string; due_date: string | null; assigned_to: string | null; assigned_to_email: string | null; project: string | null };
type MeetingRow = { id: string; title: string; meeting_date: string };
type WorkloadEntry = { name: string; count: number };
type AttentionItem = { label: string; detail: string; href: string };

const STATUS_DOT: Record<string, string> = {
  "In Progress": COLOURS.BLUE,
  "Waiting Reply": COLOURS.AMBER,
  "Not Started": COLOURS.SLATE,
  "Approved": COLOURS.GREEN,
  "To do": COLOURS.SLATE,
  "Blocked": COLOURS.RED,
};

export default function HomePage() {
  const isMobile = useMobile();
  const { ctx, loading: ctxLoading } = useUserCtx();
  const [loading, setLoading] = useState(true);

  // KPI data
  const [kpis, setKpis] = useState({ tasksDueToday: 0, activeTasks: 0, machinesDown: 0, openTasks: 0 });

  // Dashboard widgets
  const [todayTasks, setTodayTasks] = useState<TaskRow[]>([]);
  const [completedToday, setCompletedToday] = useState(0);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [workload, setWorkload] = useState<WorkloadEntry[]>([]);
  const [attention, setAttention] = useState<AttentionItem[]>([]);

  // Page nav (kept for fallback / non-admin views)
  const [badges, setBadges] = useState<Record<string, { value: string; color: string }>>({});

  useEffect(() => {
    async function loadDashboard() {
      const today = new Date().toISOString().slice(0, 10);
      const month = today.slice(0, 7);
      const weekFromNow = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

      const [
        tasksRes, machinesRes, pendingMinsRes,
        utplCashRes, ifplCashRes,
        meetingsRes, membersRes, auditsRes, receivablesRes,
      ] = await Promise.all([
        supabase.from("tasks").select("id, description, status, due_date, assigned_to, assigned_to_email, project").in("status", ["Not Started", "In Progress", "Waiting Reply"]),
        supabase.from("machine_issues").select("id").eq("issue_status", "Down"),
        supabase.from("pending_minutes").select("id").eq("status", "pending"),
        supabase.from("daily_cash_position").select("closing_after_post_dated, position_date").eq("company_id", UTPL_COMPANY_ID).order("position_date", { ascending: false }).limit(1),
        supabase.from("daily_cash_position").select("closing_after_post_dated, position_date").eq("company_id", IFPL_COMPANY_ID).order("position_date", { ascending: false }).limit(1),
        supabase.from("meetings").select("id, title, meeting_date").gte("meeting_date", today).order("meeting_date", { ascending: true }).limit(5),
        supabase.from("members").select("id"),
        supabase.from("audit_items").select("id, status").in("status", ["Open", "In Progress"]),
        supabase.from("receivables").select("id").neq("status", "Collected"),
      ]);

      const tasks = tasksRes.data || [] as TaskRow[];
      const overdue = tasks.filter((t) => t.due_date && t.due_date < today);
      const dueToday = tasks.filter((t) => t.due_date === today);

      // Completed today count
      const { count: doneToday } = await supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "Completed").gte("updated_at", today + "T00:00:00");

      // KPIs
      setKpis({
        tasksDueToday: dueToday.length,
        activeTasks: tasks.length,
        machinesDown: (machinesRes.data || []).length,
        openTasks: tasks.length,
      });
      setCompletedToday(doneToday || 0);

      // Today's tasks — due today or overdue, sorted by due date
      const todayAndOverdue = tasks
        .filter((t) => t.due_date && t.due_date <= today)
        .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));
      const upcoming = tasks
        .filter((t) => t.due_date && t.due_date > today && t.due_date <= weekFromNow)
        .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));
      setTodayTasks([...todayAndOverdue, ...upcoming].slice(0, 15));

      // Meetings
      setMeetings(meetingsRes.data || []);

      // Team workload — open tasks per person
      const countMap: Record<string, number> = {};
      for (const t of tasks) {
        const name = t.assigned_to || "Unassigned";
        countMap[name] = (countMap[name] || 0) + 1;
      }
      const wl = Object.entries(countMap)
        .map(([name, count]) => ({ name: name.split(" ")[0] + (name.split(" ")[1] ? " " + name.split(" ")[1][0] + "." : ""), count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);
      setWorkload(wl);

      // Needs attention
      const att: AttentionItem[] = [];
      for (const t of overdue) {
        att.push({ label: t.description, detail: `overdue${t.due_date ? " / due " + t.due_date : ""} · ${t.assigned_to || "Unassigned"}`, href: "/tasks" });
        if (att.length >= 5) break;
      }
      const blocked = tasks.filter((t) => t.status === "Waiting Reply");
      for (const t of blocked) {
        if (att.length >= 5) break;
        att.push({ label: t.description, detail: `waiting reply · ${t.assigned_to || "Unassigned"}`, href: "/tasks" });
      }
      setAttention(att);

      // Badges for nav section
      const b: Record<string, { value: string; color: string }> = {};
      b.executive = { value: `${overdue.length} overdue`, color: overdue.length > 0 ? COLOURS.RED : COLOURS.GREEN };
      b.pa = { value: `${tasks.length} open`, color: tasks.length > 0 ? "#d97706" : COLOURS.GREEN };
      b.operations = { value: `${(machinesRes.data || []).length} down`, color: (machinesRes.data || []).length > 0 ? COLOURS.RED : COLOURS.GREEN };
      b.tasks = { value: `${tasks.length} open`, color: tasks.length > 0 ? "#d97706" : COLOURS.GREEN };
      b.calendar = { value: `${tasks.filter((t) => t.due_date && t.due_date >= today && t.due_date <= weekFromNow).length} this week`, color: COLOURS.BLUE };
      const utplCash = utplCashRes.data?.[0];
      const ifplCash = ifplCashRes.data?.[0];
      const fmtPKR = (n: number) => `PKR ${Math.abs(n) >= 1000000 ? (n / 1000000).toFixed(1) + "M" : n.toLocaleString()}`;
      b.utplFinance = utplCash ? { value: fmtPKR(utplCash.closing_after_post_dated), color: utplCash.closing_after_post_dated >= 0 ? COLOURS.GREEN : COLOURS.RED } : { value: "No data", color: COLOURS.SLATE };
      b.ifplFinance = ifplCash ? { value: fmtPKR(ifplCash.closing_after_post_dated), color: ifplCash.closing_after_post_dated >= 0 ? COLOURS.GREEN : COLOURS.RED } : { value: "No data", color: COLOURS.SLATE };
      b.meetings = { value: `${(meetingsRes.data || []).length} upcoming`, color: COLOURS.BLUE };
      b.minutes = { value: `${(pendingMinsRes.data || []).length} pending`, color: (pendingMinsRes.data || []).length > 0 ? "#d97706" : COLOURS.GREEN };
      b.members = { value: `${(membersRes.data || []).length} members`, color: "#0f172a" };
      b.audit = { value: `${(auditsRes.data || []).length} open`, color: (auditsRes.data || []).length > 0 ? "#d97706" : COLOURS.GREEN };
      b.receivables = { value: `${(receivablesRes.data || []).length} active`, color: (receivablesRes.data || []).length > 0 ? "#d97706" : COLOURS.GREEN };
      setBadges(b);

      setLoading(false);
    }

    loadDashboard();
  }, []);

  const allLoading = ctxLoading || loading;
  const visibleCards = ctx ? PAGE_REGISTRY.filter((card) => isCardVisible(card, ctx)) : [];
  const groups = GROUP_ORDER
    .map((groupName) => ({
      title: groupName,
      colour: GROUP_COLOURS[groupName] || COLOURS.SLATE,
      cards: visibleCards.filter((c) => c.group === groupName),
    }))
    .filter((g) => g.cards.length > 0);
  const showIcons = ctx ? !isAdminTier(ctx) || checkIsCEO(ctx) : true;

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const now = new Date();
  const dateStr = `${dayNames[now.getDay()]}, ${now.getDate()} ${monthNames[now.getMonth()]} ${now.getFullYear()}`;

  const maxWorkload = workload.length > 0 ? Math.max(...workload.map((w) => w.count)) : 1;

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>

        {/* Date subtitle */}
        <p style={{ color: "var(--text-secondary)", fontSize: "14px", margin: "0 0 20px" }}>
          {dateStr} &middot; here is your day
        </p>

        {allLoading ? (
          <HomeSkeleton isMobile={isMobile} />
        ) : (
          <>
            {/* ── KPI Cards ── */}
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)",
              gap: "14px", marginBottom: "24px",
            }}>
              <KPICard icon="📋" value={kpis.tasksDueToday} label="Tasks due today" />
              <KPICard icon="📅" value={kpis.activeTasks} label="Open tasks" />
              <KPICard icon="🏭" value={kpis.machinesDown} label={kpis.machinesDown === 0 ? "All machines up" : "Machines down"} alert={kpis.machinesDown > 0} />
              <KPICard icon="✅" value={completedToday} label="Completed today" />
            </div>

            {/* ── Two-column body ── */}
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "1fr 340px",
              gap: "20px", marginBottom: "28px",
            }}>
              {/* Left — Today's Tasks */}
              <div style={{
                backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                borderRadius: "12px", overflow: "hidden",
              }}>
                <div style={{
                  padding: "14px 18px", borderBottom: "1px solid var(--border-color)",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "15px" }}>📋</span>
                    <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary)" }}>Today&apos;s Tasks</span>
                  </div>
                  <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                    {completedToday}/{todayTasks.length + completedToday} done
                  </span>
                </div>

                {todayTasks.length === 0 ? (
                  <div style={{ padding: "32px 18px", textAlign: "center", color: "var(--text-muted)", fontSize: "14px" }}>
                    No tasks due today or this week. You&apos;re all clear!
                  </div>
                ) : (
                  todayTasks.map((task) => (
                    <a
                      key={task.id}
                      href="/tasks"
                      style={{
                        display: "flex", alignItems: "center", gap: "10px",
                        padding: "10px 18px",
                        borderBottom: "1px solid var(--border-light)",
                        textDecoration: "none", color: "inherit",
                        transition: "background-color 0.1s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-card-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                    >
                      <span style={{
                        width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0,
                        backgroundColor: STATUS_DOT[task.status] || COLOURS.SLATE,
                      }} />
                      <span style={{
                        flex: 1, fontSize: "13px", color: "var(--text-primary)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {task.description}
                      </span>
                      {task.project && (
                        <span style={{
                          fontSize: "11px", color: "var(--text-muted)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          maxWidth: "120px",
                        }}>
                          {task.project}
                        </span>
                      )}
                      {task.due_date && task.due_date < new Date().toISOString().slice(0, 10) && (
                        <span style={{
                          fontSize: "11px", fontWeight: 600, color: COLOURS.RED, whiteSpace: "nowrap",
                        }}>
                          due {task.due_date.slice(5)}
                        </span>
                      )}
                      <span style={{
                        fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap",
                        color: STATUS_DOT[task.status] || COLOURS.SLATE,
                      }}>
                        {task.status}
                      </span>
                    </a>
                  ))
                )}

                <div style={{
                  padding: "10px 18px", fontSize: "12px", color: "var(--text-muted)",
                  borderTop: "1px solid var(--border-light)",
                }}>
                  Tasks you scheduled for today, plus anything overdue or due this week.
                </div>
              </div>

              {/* Right — Widgets */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* Meetings widget */}
                <div style={{
                  backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                  borderRadius: "12px", overflow: "hidden",
                }}>
                  <div style={{
                    padding: "12px 16px", borderBottom: "1px solid var(--border-color)",
                    display: "flex", alignItems: "center", gap: "8px",
                  }}>
                    <span style={{ fontSize: "14px" }}>📅</span>
                    <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>Meetings</span>
                  </div>
                  <div style={{ padding: "12px 16px" }}>
                    {meetings.length === 0 ? (
                      <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>
                        No upcoming meetings scheduled.
                      </p>
                    ) : (
                      meetings.map((m) => (
                        <a key={m.id} href="/meetings" style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          padding: "6px 0", textDecoration: "none", color: "inherit",
                        }}>
                          <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>{m.title}</span>
                          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{m.meeting_date}</span>
                        </a>
                      ))
                    )}
                  </div>
                </div>

                {/* Team Workload widget */}
                <div style={{
                  backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                  borderRadius: "12px", overflow: "hidden",
                }}>
                  <div style={{
                    padding: "12px 16px", borderBottom: "1px solid var(--border-color)",
                    display: "flex", alignItems: "center", gap: "8px",
                  }}>
                    <span style={{ fontSize: "14px" }}>👥</span>
                    <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>Team Workload</span>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "auto" }}>open tasks per person</span>
                  </div>
                  <div style={{ padding: "12px 16px" }}>
                    {workload.map((w) => (
                      <div key={w.name} style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                        <span style={{
                          fontSize: "12px", color: "var(--text-primary)", width: "90px",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0,
                        }}>
                          {w.name}
                        </span>
                        <div style={{
                          flex: 1, height: "8px", backgroundColor: "var(--border-light)", borderRadius: "4px", overflow: "hidden",
                        }}>
                          <div style={{
                            height: "100%", borderRadius: "4px",
                            width: `${(w.count / maxWorkload) * 100}%`,
                            backgroundColor: COLOURS.BLUE,
                            transition: "width 0.3s ease",
                          }} />
                        </div>
                        <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)", width: "20px", textAlign: "right" }}>
                          {w.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Needs Attention widget */}
                {attention.length > 0 && (
                  <div style={{
                    backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                    borderRadius: "12px", overflow: "hidden",
                  }}>
                    <div style={{
                      padding: "12px 16px", borderBottom: "1px solid var(--border-color)",
                      display: "flex", alignItems: "center", gap: "8px",
                    }}>
                      <span style={{ fontSize: "14px" }}>⚠️</span>
                      <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>Needs Attention</span>
                    </div>
                    <div style={{ padding: "8px 16px" }}>
                      {attention.map((a, i) => (
                        <a key={i} href={a.href} style={{
                          display: "block", padding: "6px 0",
                          textDecoration: "none", color: "inherit",
                          borderBottom: i < attention.length - 1 ? "1px solid var(--border-light)" : "none",
                        }}>
                          <div style={{ fontSize: "13px", color: "var(--text-primary)", fontWeight: 500 }}>{a.label}</div>
                          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{a.detail}</div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Quick Nav — page links grouped ── */}
            {groups.length > 0 && (
              <div style={{
                backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                borderRadius: "12px", padding: "16px 18px",
              }}>
                {groups.map((group, gi) => (
                  <div key={group.title} style={{ marginBottom: gi < groups.length - 1 ? "12px" : 0 }}>
                    <div style={{
                      fontSize: "10px", fontWeight: 700, color: "var(--text-muted)",
                      textTransform: "uppercase", letterSpacing: "1.2px",
                      padding: "0 0 4px", marginBottom: "2px",
                      borderBottom: "1px solid var(--border-light)",
                    }}>
                      {group.title}
                    </div>
                    {group.cards.map((card) => {
                      const badge = card.badgeKey ? badges[card.badgeKey] : undefined;
                      return (
                        <a
                          key={card.href}
                          href={card.href}
                          style={{
                            textDecoration: "none",
                            display: "flex", alignItems: "center", gap: "10px",
                            padding: "7px 8px",
                            borderRadius: "6px",
                            cursor: "pointer",
                            transition: "background-color 0.15s",
                            color: "inherit",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-card-hover)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                        >
                          {showIcons && (
                            <span style={{ fontSize: "15px", flexShrink: 0, width: "20px", textAlign: "center" }}>
                              {card.icon}
                            </span>
                          )}
                          <span style={{
                            flex: 1, fontSize: "13px", fontWeight: 500,
                            color: "var(--text-primary)",
                          }}>
                            {card.title}
                          </span>
                          {badge && (
                            <span style={{
                              fontSize: "11px", fontWeight: 600, color: badge.color,
                              whiteSpace: "nowrap",
                            }}>
                              {badge.value}
                            </span>
                          )}
                        </a>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            {groups.length === 0 && (
              <div style={{
                border: "1px solid var(--border-color)", borderRadius: "12px", padding: "48px 20px",
                backgroundColor: "var(--bg-card)", textAlign: "center", color: "var(--text-secondary)",
              }}>
                <div style={{ fontSize: "36px", marginBottom: "12px" }}>🔒</div>
                <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>No pages assigned</div>
                <div style={{ fontSize: "14px" }}>Contact your Admin to get access to dashboard sections.</div>
              </div>
            )}
          </>
        )}
      </main>
    </AuthWrapper>
  );
}

function KPICard({ icon, value, label, alert }: { icon: string; value: number; label: string; alert?: boolean }) {
  return (
    <div style={{
      backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
      borderRadius: "12px", padding: "16px 18px",
    }}>
      <div style={{ fontSize: "20px", marginBottom: "8px", opacity: 0.8 }}>{icon}</div>
      <div style={{
        fontSize: "28px", fontWeight: 800, lineHeight: 1,
        color: alert ? COLOURS.RED : "var(--text-primary)",
      }}>
        {value}
      </div>
      <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "4px" }}>{label}</div>
    </div>
  );
}

function SkeletonPulse({ width, height, borderRadius = "6px", style }: { width: string; height: string; borderRadius?: string; style?: React.CSSProperties }) {
  return (
    <div style={{
      width, height, borderRadius,
      background: "linear-gradient(90deg, var(--border-color) 25%, var(--border-light) 50%, var(--border-color) 75%)",
      backgroundSize: "200% 100%",
      animation: "shimmer 1.5s ease-in-out infinite",
      ...style,
    }} />
  );
}

function HomeSkeleton({ isMobile }: { isMobile: boolean }) {
  return (
    <>
      {/* KPI skeleton */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: "14px", marginBottom: "24px" }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: "12px", padding: "16px 18px" }}>
            <SkeletonPulse width="24px" height="24px" borderRadius="6px" />
            <div style={{ marginTop: "10px" }}><SkeletonPulse width="50px" height="28px" /></div>
            <div style={{ marginTop: "6px" }}><SkeletonPulse width="80px" height="13px" /></div>
          </div>
        ))}
      </div>
      {/* Content skeleton */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 340px", gap: "20px" }}>
        <div style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: "12px", padding: "16px 18px" }}>
          <SkeletonPulse width="120px" height="16px" />
          <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
            {[1, 2, 3, 4, 5].map((i) => <SkeletonPulse key={i} width="100%" height="14px" />)}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {[1, 2].map((i) => (
            <div key={i} style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: "12px", padding: "16px" }}>
              <SkeletonPulse width="90px" height="14px" />
              <div style={{ marginTop: "12px" }}><SkeletonPulse width="100%" height="10px" /></div>
              <div style={{ marginTop: "8px" }}><SkeletonPulse width="70%" height="10px" /></div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
