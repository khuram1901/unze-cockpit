"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase, authFetch } from "../lib/supabase";
import { COLOURS, StatusBadge, WARNING_BANNER_STYLE, WARNING_TITLE_COLOR, FreshnessBadge } from "../lib/SharedUI";
import { useMobile } from "../lib/useMobile";
import { formatDateUK } from "../lib/dateUtils";
import { useUserCtx } from "../lib/useUserCtx";
import { isPA, isPrivileged, canCreateAssignments } from "../lib/permissions";
import { displayRole } from "../lib/SharedUI";
import { logAction } from "../lib/audit-log";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { COMPANIES } from "../lib/constants";

type TaskRow = { id: string; description: string; status: string; due_date: string | null; assigned_to: string | null; assigned_to_email: string | null; assigned_by: string | null; project: string | null; priority: string | null; updated_at: string | null };
type MeetingRow = { id: string; title: string; meeting_date: string };
type WorkloadEntry = { name: string; count: number };
type AttentionItem = { label: string; detail: string; href: string };
type AuditEntry = { id: string; action: string; table_name: string; details: string | null; created_at: string };

const STATUS_DOT: Record<string, string> = {
  "In Progress": COLOURS.AMBER,
  "Waiting Reply": COLOURS.RED,
  "Not Started": COLOURS.SLATE,
  "Approved": COLOURS.GREEN,
  "To do": COLOURS.SLATE,
  "Blocked": COLOURS.RED,
};

const todayStr = new Date().toISOString().slice(0, 10);

function isOverdue(t: TaskRow) {
  if (t.status === "Completed" || t.status === "Cancelled") return false;
  return !!t.due_date && t.due_date < todayStr;
}

function daysOverdue(t: TaskRow): number {
  if (!t.due_date || !isOverdue(t)) return 0;
  return Math.floor((Date.now() - new Date(t.due_date + "T00:00:00").getTime()) / 86400000);
}

function daysUntil(dateStr: string): number {
  return Math.floor((new Date(dateStr + "T00:00:00").getTime() - Date.now()) / 86400000);
}

export default function HomePage() {
  const router = useRouter();
  const isMobile = useMobile();
  const { ctx, loading: ctxLoading } = useUserCtx();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ctxLoading && ctx && isPA(ctx)) {
      router.replace("/pa");
    }
  }, [ctxLoading, ctx, router]);

  const [kpis, setKpis] = useState({ tasksDueToday: 0, activeTasks: 0, machinesDown: 0, openTasks: 0 });
  const [todayTasks, setTodayTasks] = useState<TaskRow[]>([]);
  const [completedToday, setCompletedToday] = useState(0);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [workload, setWorkload] = useState<WorkloadEntry[]>([]);
  const [attention, setAttention] = useState<AttentionItem[]>([]);

  const [myOpenTasks, setMyOpenTasks] = useState<TaskRow[]>([]);
  const [myOverdueTasks, setMyOverdueTasks] = useState<TaskRow[]>([]);
  const [myDueThisWeek, setMyDueThisWeek] = useState<TaskRow[]>([]);
  const [assignedByMe, setAssignedByMe] = useState<TaskRow[]>([]);
  const [recentActivity, setRecentActivity] = useState<AuditEntry[]>([]);
  const [myCompletedMonth, setMyCompletedMonth] = useState(0);
  const [userName, setUserName] = useState("");

  // Morning briefing + sparkline data
  const [briefing, setBriefing] = useState<{ cashTotal: number | null; prodPct: number | null; stuckBills: number; cashDate: string | null }>({ cashTotal: null, prodPct: null, stuckBills: 0, cashDate: null });
  const [sparklines, setSparklines] = useState<{ dueByDay: number[]; completedByDay: number[] }>({ dueByDay: [], completedByDay: [] });
  const [toast, setToast] = useState<string | null>(null);

  type ManagerBriefingItem = { label: string; value: string; rag: "GREEN" | "AMBER" | "RED" };
  const [managerBriefing, setManagerBriefing] = useState<ManagerBriefingItem[]>([]);
  const [managerBriefingTitle, setManagerBriefingTitle] = useState("");

  async function quickAction(taskId: string, action: "complete" | "chase", task: TaskRow) {
    if (action === "complete") {
      await supabase.from("tasks").update({ status: "Completed" }).eq("id", taskId);
      logAction("Updated", "tasks", `Completed: ${task.description}`);
      setAssignedByMe((prev) => prev.filter((t) => t.id !== taskId));
      setToast("Task marked complete");
    } else if (action === "chase" && task.assigned_to_email) {
      await authFetch("/api/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "task_chase", taskId, recipientEmail: task.assigned_to_email }),
      });
      setToast(`Chase sent to ${task.assigned_to}`);
    }
    setTimeout(() => setToast(null), 3000);
  }


  useEffect(() => {
    async function loadDashboard() {
      const today = todayStr;
      const month = today.slice(0, 7);
      const weekFromNow = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

      const { data: { user } } = await supabase.auth.getUser();
      const email = user?.email || "";
      let fullName = email;

      const { data: memberData } = await supabase.from("members").select("first_name, last_name, name, role, department, company").eq("email", email).maybeSingle();
      if (memberData) {
        fullName = `${memberData.first_name || ""} ${memberData.last_name || ""}`.trim() || memberData.name || email;
        setUserName(fullName);
      }

      const [
        tasksRes, machinesRes, meetingsRes,
        myTasksRes, assignedByMeRes, activityRes,
      ] = await Promise.all([
        supabase.from("tasks").select("id, description, status, due_date, assigned_to, assigned_to_email, assigned_by, project, priority, updated_at").in("status", ["Not Started", "In Progress", "Waiting Reply"]),
        supabase.from("machine_issues").select("id").eq("issue_status", "Down"),
        supabase.from("meetings").select("id, title, meeting_date").gte("meeting_date", today).order("meeting_date", { ascending: true }).limit(5),
        supabase.from("tasks").select("id, description, status, due_date, assigned_to, assigned_to_email, assigned_by, project, priority, updated_at").or(`assigned_to_email.eq.${email},assigned_to.eq.${fullName}`).order("created_at", { ascending: false }),
        supabase.from("tasks").select("id, description, status, due_date, assigned_to, assigned_to_email, assigned_by, project, priority, updated_at").eq("assigned_by", fullName).neq("assigned_to", fullName).order("created_at", { ascending: false }).limit(20),
        supabase.from("audit_log").select("id, action, table_name, details, created_at").eq("user_email", email).order("created_at", { ascending: false }).limit(8),
      ]);

      const tasks = tasksRes.data || [] as TaskRow[];
      const overdue = tasks.filter((t) => t.due_date && t.due_date < today);
      const dueToday = tasks.filter((t) => t.due_date === today);

      const { count: doneToday } = await supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "Completed").gte("updated_at", today + "T00:00:00");

      setKpis({
        tasksDueToday: dueToday.length,
        activeTasks: tasks.length,
        machinesDown: (machinesRes.data || []).length,
        openTasks: tasks.length,
      });
      setCompletedToday(doneToday || 0);

      const todayAndOverdue = tasks
        .filter((t) => t.due_date && t.due_date <= today)
        .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));
      const upcoming = tasks
        .filter((t) => t.due_date && t.due_date > today && t.due_date <= weekFromNow)
        .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));
      setTodayTasks([...todayAndOverdue, ...upcoming].slice(0, 15));

      setMeetings(meetingsRes.data || []);

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

      const myAll = myTasksRes.data || [];
      const myOpen = myAll.filter((t) => t.status !== "Completed" && t.status !== "Cancelled");
      const myOD = myOpen.filter(isOverdue);
      const myDTW = myOpen.filter((t) => t.due_date && t.due_date >= today && daysUntil(t.due_date) <= 7).sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));
      setMyOpenTasks(myOpen);
      setMyOverdueTasks(myOD);
      setMyDueThisWeek(myDTW);
      setAssignedByMe((assignedByMeRes.data || []).filter((t) => t.status !== "Completed" && t.status !== "Cancelled"));
      setRecentActivity(activityRes.data || []);
      setMyCompletedMonth(myAll.filter((t) => t.status === "Completed" && t.updated_at && t.updated_at.slice(0, 7) === month).length);

      // Extra queries for briefing + sparklines (non-blocking)
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const [cashRes, recRes, prodRes, targRes, completedWeekRes] = await Promise.all([
        supabase.from("daily_cash_position").select("closing_balance, position_date").order("position_date", { ascending: false }).limit(2),
        supabase.from("receivables").select("id").in("current_stage", ["Stage 2", "Stage 3"]).eq("status", "In Progress"),
        supabase.from("production_entries").select("pairs_produced").eq("entry_date", yesterday),
        supabase.from("monthly_production_targets").select("target_pairs").eq("month", today.slice(0, 7)),
        supabase.from("tasks").select("due_date, updated_at, status").gte("due_date", sevenDaysAgo).lte("due_date", today),
      ]);

      const cashRows = cashRes.data || [];
      const cashTotal = cashRows.length > 0 ? cashRows.reduce((s, r) => s + (r.closing_balance || 0), 0) : null;
      const cashDate = cashRows.length > 0 ? cashRows[0].position_date : null;
      const stuckBills = (recRes.data || []).length;

      const prodTotal = (prodRes.data || []).reduce((s, r) => s + (r.pairs_produced || 0), 0);
      const targTotal = (targRes.data || []).reduce((s, r) => s + (r.target_pairs || 0), 0);
      const dailyTarget = targTotal > 0 ? Math.round(targTotal / 26) : 0;
      const prodPct = dailyTarget > 0 ? Math.round((prodTotal / dailyTarget) * 100) : null;

      setBriefing({ cashTotal, prodPct, stuckBills, cashDate });

      // 7-day sparkline: tasks due per day and completed per day
      const allWeekTasks = completedWeekRes.data || [];
      const dueByDay: number[] = [];
      const completedByDay: number[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        dueByDay.push(allWeekTasks.filter((t) => t.due_date === d).length);
        completedByDay.push(allWeekTasks.filter((t) => t.status === "Completed" && t.updated_at && t.updated_at.slice(0, 10) === d).length);
      }
      setSparklines({ dueByDay, completedByDay });

      // Manager-specific briefing
      const userRole = memberData?.role || "";
      const userDept = memberData?.department || "";

      if (userRole === "Manager" && userDept === "Unze Trading Ops") {
        const items: ManagerBriefingItem[] = [];
        const mStart = today.slice(0, 7) + "-01";

        const [prodTodayRes, prodYestRes, targRes2, dispRes, breakRes, machRes, deptTasksRes] = await Promise.all([
          supabase.from("production_entries").select("qty_31, qty_36, qty_45, qty_meter").eq("entry_date", today),
          supabase.from("production_entries").select("qty_31, qty_36, qty_45, qty_meter").eq("entry_date", yesterday),
          supabase.from("monthly_production_targets").select("target_pairs").eq("month", today.slice(0, 7)),
          supabase.from("dispatch_entries").select("qty_31, qty_36, qty_45, qty_meter").gte("entry_date", mStart).lte("entry_date", today),
          supabase.from("breakage_entries").select("qty_31, qty_36, qty_45, qty_meter").gte("entry_date", sevenDaysAgo).lte("entry_date", today),
          supabase.from("machine_issues").select("id, issue_status").neq("issue_status", "Resolved"),
          supabase.from("tasks").select("id, status, due_date").eq("assigned_to_department", "Unze Trading Ops").not("status", "in", '("Completed","Cancelled")'),
        ]);

        const sumQty = (rows: { qty_31?: number; qty_36?: number; qty_45?: number; qty_meter?: number }[]) =>
          rows.reduce((s, r) => s + (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0) + (r.qty_meter || 0), 0);

        const todayProd = sumQty(prodTodayRes.data || []);
        const yesterdayProd = sumQty(prodYestRes.data || []);
        const monthTarget = (targRes2.data || []).reduce((s, r) => s + (r.target_pairs || 0), 0);
        const dailyTarget2 = monthTarget > 0 ? Math.round(monthTarget / 26) : 0;

        if (todayProd === 0 && yesterdayProd === 0) {
          items.push({ label: "No production entered", value: "No data for today or yesterday", rag: "RED" });
        } else if (todayProd === 0) {
          items.push({ label: "No production today yet", value: `Yesterday: ${yesterdayProd.toLocaleString()} pairs`, rag: "AMBER" });
        } else {
          const pct = dailyTarget2 > 0 ? Math.round((todayProd / dailyTarget2) * 100) : 100;
          items.push({ label: "Today's production", value: `${todayProd.toLocaleString()} pairs (${pct}% of daily target)`, rag: pct >= 90 ? "GREEN" : pct >= 70 ? "AMBER" : "RED" });
        }

        const monthProdRes = await supabase.from("production_entries").select("qty_31, qty_36, qty_45, qty_meter").gte("entry_date", mStart).lte("entry_date", today);
        const monthProd = sumQty(monthProdRes.data || []);
        const dayOfMonth = new Date().getDate();
        const expectedPct = monthTarget > 0 ? Math.round((dayOfMonth / 26) * 100) : 0;
        const actualPct = monthTarget > 0 ? Math.round((monthProd / monthTarget) * 100) : 100;
        if (monthTarget > 0) {
          const onTrack = actualPct >= expectedPct - 10;
          items.push({ label: "Month-to-date", value: `${monthProd.toLocaleString()} of ${monthTarget.toLocaleString()} (${actualPct}%)`, rag: onTrack ? "GREEN" : actualPct >= expectedPct - 20 ? "AMBER" : "RED" });
        }

        const monthDisp = sumQty(dispRes.data || []);
        const dispatchRatio = monthProd > 0 ? Math.round((monthDisp / monthProd) * 100) : 100;
        items.push({ label: "Dispatch ratio", value: `${monthDisp.toLocaleString()} dispatched (${dispatchRatio}% of produced)`, rag: dispatchRatio >= 85 ? "GREEN" : dispatchRatio >= 70 ? "AMBER" : "RED" });

        const weekBreakage = sumQty(breakRes.data || []);
        const weekProdForBreak = yesterdayProd * 7;
        const breakPct = weekProdForBreak > 0 ? Math.round((weekBreakage / weekProdForBreak) * 100) : 0;
        items.push({ label: "Breakage (7-day)", value: `${weekBreakage.toLocaleString()} pairs (${breakPct}% rate)`, rag: breakPct <= 2 ? "GREEN" : breakPct <= 5 ? "AMBER" : "RED" });

        const machDown = (machRes.data || []).filter((m) => m.issue_status === "Down").length;
        const machPartial = (machRes.data || []).filter((m) => m.issue_status === "Partially Working").length;
        if (machDown > 0) {
          items.push({ label: "Machines down", value: `${machDown} down${machPartial > 0 ? `, ${machPartial} partial` : ""}`, rag: "RED" });
        } else if (machPartial > 0) {
          items.push({ label: "Machine issues", value: `${machPartial} partially working`, rag: "AMBER" });
        } else {
          items.push({ label: "All machines", value: "Running normally", rag: "GREEN" });
        }

        const deptOverdue = (deptTasksRes.data || []).filter((t) => t.due_date && t.due_date < today).length;
        const deptOpen = (deptTasksRes.data || []).length;
        items.push({ label: "Ops tasks", value: `${deptOpen} open${deptOverdue > 0 ? `, ${deptOverdue} overdue` : ""}`, rag: deptOverdue === 0 ? "GREEN" : deptOverdue <= 3 ? "AMBER" : "RED" });

        setManagerBriefing(items);
        setManagerBriefingTitle("Operations Briefing");
      }

      if (userRole === "Manager" && userDept === "Finance") {
        const items: ManagerBriefingItem[] = [];

        const userCompany = memberData?.company || "";
        const matchedCompany = COMPANIES.find((c) => c.name === userCompany || userCompany.startsWith(c.name.split(" ")[0]));
        const companyIds = matchedCompany ? [matchedCompany.id] : COMPANIES.map((c) => c.id);
        const companyLabel = matchedCompany ? matchedCompany.shortCode : "All";

        const [recOpenRes, recStagesRes, deptTasksRes] = await Promise.all([
          supabase.from("receivables").select("id, amount, date_submitted, current_stage_order, current_stage_entered_date, status").neq("status", "Collected"),
          supabase.from("receivable_stages").select("stage_order, stage_name, working_day_budget"),
          supabase.from("tasks").select("id, status, due_date").eq("assigned_to_department", "Finance").not("status", "in", '("Completed","Cancelled")'),
        ]);

        for (const cId of companyIds) {
          const comp = COMPANIES.find((c) => c.id === cId);
          const tag = comp?.shortCode || "?";

          const [cashPosRes, budgetRes] = await Promise.all([
            supabase.from("daily_cash_position").select("closing_balance, total_receipts, total_payments, position_date").eq("company_id", cId).order("position_date", { ascending: false }).limit(7),
            supabase.from("monthly_budgets").select("category, flow_type, budgeted_amount, budget_month").eq("company_id", cId).eq("budget_month", today.slice(0, 7)),
          ]);

          const cashRows = cashPosRes.data || [];
          if (cashRows.length === 0) {
            items.push({ label: `${tag} cash position`, value: "No data entered", rag: "RED" });
          } else {
            const latest = cashRows[0];
            const latestDate = latest.position_date;
            const daysSinceEntry = Math.floor((Date.now() - new Date(latestDate + "T00:00:00").getTime()) / 86400000);
            if (daysSinceEntry > 1) {
              items.push({ label: `${tag} cash stale`, value: `Last entry ${daysSinceEntry} days ago (${latestDate})`, rag: daysSinceEntry > 3 ? "RED" : "AMBER" });
            } else {
              items.push({ label: `${tag} cash position`, value: `PKR ${(latest.closing_balance || 0).toLocaleString()}`, rag: "GREEN" });
            }

            if (cashRows.length >= 3) {
              const declining = cashRows[0].closing_balance < cashRows[1].closing_balance && cashRows[1].closing_balance < cashRows[2].closing_balance;
              if (declining) {
                items.push({ label: `${tag} cash trend`, value: "Declining 3 days straight", rag: "RED" });
              }
            }

            const weekReceipts = cashRows.reduce((s, r) => s + (r.total_receipts || 0), 0);
            const weekPayments = cashRows.reduce((s, r) => s + (r.total_payments || 0), 0);
            const netFlow = weekReceipts - weekPayments;
            items.push({ label: `${tag} net flow (7d)`, value: `PKR ${netFlow.toLocaleString()} (in: ${weekReceipts.toLocaleString()}, out: ${weekPayments.toLocaleString()})`, rag: netFlow >= 0 ? "GREEN" : "RED" });
          }

          const budgets = budgetRes.data || [];
          if (budgets.length > 0) {
            const totalBudget = budgets.reduce((s, r) => s + (r.budgeted_amount || 0), 0);
            items.push({ label: `${tag} monthly budget`, value: `PKR ${totalBudget.toLocaleString()} across ${budgets.length} categories`, rag: "GREEN" });
          }
        }

        const openRec = recOpenRes.data || [];
        const stages = recStagesRes.data || [];
        const totalOutstanding = openRec.reduce((s, r) => s + (r.amount || 0), 0);
        items.push({ label: "Outstanding receivables", value: `PKR ${totalOutstanding.toLocaleString()} across ${openRec.length} bills`, rag: openRec.length > 10 ? "RED" : openRec.length > 5 ? "AMBER" : "GREEN" });

        let overdueRec = 0;
        for (const bill of openRec) {
          const stage = stages.find((s) => s.stage_order === bill.current_stage_order);
          if (stage && bill.current_stage_entered_date) {
            const entered = new Date(bill.current_stage_entered_date + "T00:00:00");
            const daysInStage = Math.floor((Date.now() - entered.getTime()) / 86400000);
            if (daysInStage > stage.working_day_budget) overdueRec++;
          }
        }
        if (overdueRec > 0) {
          items.push({ label: "Overdue receivables", value: `${overdueRec} bill${overdueRec > 1 ? "s" : ""} past stage deadline`, rag: overdueRec > 3 ? "RED" : "AMBER" });
        } else {
          items.push({ label: "Receivable stages", value: "All within deadline", rag: "GREEN" });
        }

        const finOverdue = (deptTasksRes.data || []).filter((t) => t.due_date && t.due_date < today).length;
        const finOpen = (deptTasksRes.data || []).length;
        items.push({ label: "Finance tasks", value: `${finOpen} open${finOverdue > 0 ? `, ${finOverdue} overdue` : ""}`, rag: finOverdue === 0 ? "GREEN" : finOverdue <= 3 ? "AMBER" : "RED" });

        setManagerBriefing(items);
        setManagerBriefingTitle(`Finance Briefing${companyLabel !== "All" ? ` · ${companyLabel}` : ""}`);
      }

      setLoading(false);
    }

    loadDashboard();
  }, []);

  const allLoading = ctxLoading || loading;

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const now = new Date();
  const dateStr = `${dayNames[now.getDay()]}, ${now.getDate()} ${monthNames[now.getMonth()]} ${now.getFullYear()}`;

  const isTeamLead = ctx ? isPrivileged(ctx) || canCreateAssignments(ctx) : false;
  const maxWorkload = workload.length > 0 ? Math.max(...workload.map((w) => w.count)) : 1;

  const donutData = [
    { name: "Overdue", value: myOverdueTasks.length, color: COLOURS.RED },
    { name: "Waiting Reply", value: myOpenTasks.filter((t) => t.status === "Waiting Reply").length, color: "#d97706" },
    { name: "In Progress", value: myOpenTasks.filter((t) => t.status === "In Progress").length, color: COLOURS.BLUE },
    { name: "Not Started", value: myOpenTasks.filter((t) => t.status === "Not Started").length, color: COLOURS.SLATE },
  ].filter((d) => d.value > 0);

  function greetByTime() {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }

  const myTotalMonth = myOpenTasks.length + myCompletedMonth;
  const progressPct = myTotalMonth > 0 ? Math.round((myCompletedMonth / myTotalMonth) * 100) : 0;

  if (!ctxLoading && ctx && isPA(ctx)) {
    return <AuthWrapper><main style={{ padding: "20px 24px" }}><p style={{ color: "var(--text-secondary)" }}>Redirecting...</p></main></AuthWrapper>;
  }

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", overflowX: "hidden" }}>

        {!allLoading && userName && (
          <div style={{ marginBottom: "4px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <span style={{ fontSize: isMobile ? "18px" : "22px", fontWeight: 800, color: "var(--text-primary)" }}>
              {greetByTime()}, {userName.split(" ")[0]}
            </span>
            {ctx?.role && (
              <span style={{
                fontSize: "13px", fontWeight: 700, padding: "2px 10px", borderRadius: "10px",
                backgroundColor: "var(--border-light)", color: "var(--text-secondary)",
              }}>
                {displayRole(ctx.role, ctx.email)}
              </span>
            )}
          </div>
        )}
        <p style={{ color: "var(--text-secondary)", fontSize: "16px", margin: "0 0 20px" }}>
          {dateStr}
        </p>

        {allLoading ? (
          <HomeSkeleton isMobile={isMobile} />
        ) : (
          <>
            {/* ── Overdue banner ── */}
            {myOverdueTasks.length > 0 && (
              <div style={{ ...WARNING_BANNER_STYLE, padding: "10px 16px", marginBottom: "16px", display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "18px" }}>⚠</span>
                <div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: WARNING_TITLE_COLOR }}>
                    {myOverdueTasks.length} overdue task{myOverdueTasks.length > 1 ? "s" : ""} assigned to you
                  </div>
                  <div style={{ fontSize: "14px", color: WARNING_TITLE_COLOR, marginTop: "1px" }}>
                    {myOverdueTasks.slice(0, 3).map((t) => t.description.slice(0, 35)).join(" · ")}
                  </div>
                </div>
              </div>
            )}

            {/* ── Morning Briefing ── */}
            {isTeamLead && (briefing.cashTotal !== null || briefing.prodPct !== null || myOverdueTasks.length > 0 || briefing.stuckBills > 0) && (
              <div style={{
                backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                borderLeft: `4px solid ${myOverdueTasks.length > 2 || briefing.stuckBills > 2 ? COLOURS.RED : myOverdueTasks.length > 0 || briefing.stuckBills > 0 ? COLOURS.AMBER : COLOURS.GREEN}`,
                borderRadius: "8px", padding: "14px 18px", marginBottom: "16px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>Morning Briefing</span>
                  {briefing.cashDate && <FreshnessBadge date={briefing.cashDate} label="Finance" />}
                </div>
                <div style={{ fontSize: "15px", color: "var(--text-secondary)", lineHeight: 1.7 }}>
                  {briefing.cashTotal !== null && (
                    <span>Cash position: <strong style={{ color: "var(--text-primary)" }}>PKR {(briefing.cashTotal / 1000000).toFixed(1)}M</strong> across companies. </span>
                  )}
                  {myOverdueTasks.length > 0 && (
                    <span style={{ color: COLOURS.RED }}><strong>{myOverdueTasks.length} task{myOverdueTasks.length > 1 ? "s" : ""} overdue</strong>. </span>
                  )}
                  {myOverdueTasks.length === 0 && <span style={{ color: COLOURS.GREEN }}>No overdue tasks. </span>}
                  {briefing.prodPct !== null && (
                    <span>Yesterday&apos;s production: <strong style={{ color: briefing.prodPct >= 90 ? COLOURS.GREEN : briefing.prodPct >= 70 ? COLOURS.AMBER : COLOURS.RED }}>{briefing.prodPct}%</strong> of daily target. </span>
                  )}
                  {briefing.stuckBills > 0 && (
                    <span><strong>{briefing.stuckBills}</strong> receivable bill{briefing.stuckBills > 1 ? "s" : ""} stuck at Stage 2/3. </span>
                  )}
                </div>
              </div>
            )}

            {/* ── Manager Briefing (Ops / Finance) ── */}
            {managerBriefing.length > 0 && (
              <div style={{
                backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                borderRadius: "8px", overflow: "hidden", marginBottom: "16px",
              }}>
                <div style={{
                  padding: "12px 18px", borderBottom: "1px solid var(--border-color)",
                  display: "flex", alignItems: "center", gap: "8px",
                }}>
                  <span style={{ fontSize: "15px" }}>{managerBriefingTitle.startsWith("Finance") ? "💰" : "🏭"}</span>
                  <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary)" }}>
                    {managerBriefingTitle}
                  </span>
                  <span style={{
                    marginLeft: "auto", fontSize: "12px", fontWeight: 600, padding: "2px 8px",
                    borderRadius: "8px", color: "white",
                    backgroundColor: managerBriefing.some((i) => i.rag === "RED") ? COLOURS.RED : managerBriefing.some((i) => i.rag === "AMBER") ? COLOURS.AMBER : COLOURS.GREEN,
                  }}>
                    {managerBriefing.filter((i) => i.rag === "RED").length > 0
                      ? `${managerBriefing.filter((i) => i.rag === "RED").length} alert${managerBriefing.filter((i) => i.rag === "RED").length > 1 ? "s" : ""}`
                      : managerBriefing.some((i) => i.rag === "AMBER") ? "Needs attention" : "All clear"}
                  </span>
                </div>
                {managerBriefing.map((item, i) => (
                  <div key={i} style={{
                    padding: "10px 18px",
                    borderBottom: i < managerBriefing.length - 1 ? "1px solid var(--border-light)" : "none",
                    display: "flex", alignItems: "center", gap: "10px",
                  }}>
                    <span style={{
                      width: "10px", height: "10px", borderRadius: "50%", flexShrink: 0,
                      backgroundColor: item.rag === "GREEN" ? COLOURS.GREEN : item.rag === "AMBER" ? COLOURS.AMBER : COLOURS.RED,
                      boxShadow: `0 0 4px ${item.rag === "GREEN" ? COLOURS.GREEN : item.rag === "AMBER" ? COLOURS.AMBER : COLOURS.RED}40`,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>{item.label}</div>
                      <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{item.value}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── KPI Cards ── */}
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)",
              gap: "14px", marginBottom: "24px",
            }}>
              <KPICard icon="📋" value={kpis.tasksDueToday} label="Tasks due today" sparkline={sparklines.dueByDay} />
              <KPICard icon="📂" value={myOpenTasks.length} label="My open tasks" />
              <KPICard icon="🏭" value={kpis.machinesDown} label={kpis.machinesDown === 0 ? "All machines up" : "Machines down"} alert={kpis.machinesDown > 0} />
              <KPICard icon="✅" value={completedToday} label="Completed today" sparkline={sparklines.completedByDay} />
            </div>

            {/* ── Two-column body ── */}
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "1fr minmax(280px, 340px)",
              gap: "20px", marginBottom: "24px",
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
                  <span style={{ fontSize: "14px", color: "var(--text-muted)" }}>
                    {completedToday}/{todayTasks.length + completedToday} done
                  </span>
                </div>

                {todayTasks.length === 0 ? (
                  <div style={{ padding: "32px 18px", textAlign: "center", color: "var(--text-muted)", fontSize: "16px" }}>
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
                        flex: 1, fontSize: "15px", color: "var(--text-primary)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {task.description}
                      </span>
                      {task.project && (
                        <span style={{
                          fontSize: "13px", color: "var(--text-muted)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          maxWidth: "120px",
                        }}>
                          {task.project}
                        </span>
                      )}
                      {task.due_date && task.due_date < todayStr && (
                        <span style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.RED, whiteSpace: "nowrap" }}>
                          due {task.due_date.slice(5)}
                        </span>
                      )}
                      <span style={{
                        fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap",
                        color: STATUS_DOT[task.status] || COLOURS.SLATE,
                      }}>
                        {task.status}
                      </span>
                    </a>
                  ))
                )}

                <div style={{
                  padding: "10px 18px", fontSize: "14px", color: "var(--text-muted)",
                  borderTop: "1px solid var(--border-light)",
                }}>
                  Tasks you scheduled for today, plus anything overdue or due this week.
                </div>
              </div>

              {/* Right — Widgets */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {donutData.length > 0 && (
                  <div style={{
                    backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                    borderRadius: "12px", overflow: "hidden",
                  }}>
                    <div style={{
                      padding: "12px 16px", borderBottom: "1px solid var(--border-color)",
                      display: "flex", alignItems: "center", gap: "8px",
                    }}>
                      <span style={{ fontSize: "16px" }}>📊</span>
                      <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>My Task Status</span>
                    </div>
                    <div style={{ padding: "12px 16px" }}>
                      <ResponsiveContainer width="100%" height={130}>
                        <PieChart>
                          <Pie data={donutData} cx="50%" cy="50%" innerRadius={32} outerRadius={50} dataKey="value" paddingAngle={2}>
                            {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                          </Pie>
                          <Tooltip formatter={(value, name) => [`${value} task${Number(value) > 1 ? "s" : ""}`, name]} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" }}>
                        {donutData.map((d) => (
                          <div key={d.name} style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "13px", color: "var(--text-secondary)" }}>
                            <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: d.color }} /> {d.name} ({d.value})
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {myDueThisWeek.length > 0 && (
                  <div style={{
                    backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                    borderRadius: "12px", overflow: "hidden",
                  }}>
                    <div style={{
                      padding: "12px 16px", borderBottom: "1px solid var(--border-color)",
                      display: "flex", alignItems: "center", gap: "8px",
                    }}>
                      <span style={{ fontSize: "16px" }}>📅</span>
                      <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>Due This Week ({myDueThisWeek.length})</span>
                    </div>
                    <div>
                      {myDueThisWeek.slice(0, 5).map((t) => {
                        const d = daysUntil(t.due_date!);
                        const urgency = d <= 1 ? COLOURS.RED : d <= 3 ? "#d97706" : "var(--text-secondary)";
                        return (
                          <a key={t.id} href="/tasks" style={{
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                            padding: "8px 16px", borderBottom: "1px solid var(--border-light)",
                            textDecoration: "none", color: "inherit",
                          }}>
                            <span style={{ flex: 1, fontSize: "15px", color: "var(--text-primary)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                              {t.description}
                            </span>
                            <span style={{ fontSize: "14px", fontWeight: 700, color: urgency, flexShrink: 0, marginLeft: "8px" }}>
                              {d === 0 ? "Today" : d === 1 ? "Tomorrow" : `${d}d`}
                            </span>
                          </a>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div style={{
                  backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                  borderRadius: "12px", overflow: "hidden",
                }}>
                  <div style={{
                    padding: "12px 16px", borderBottom: "1px solid var(--border-color)",
                    display: "flex", alignItems: "center", gap: "8px",
                  }}>
                    <span style={{ fontSize: "16px" }}>🗓️</span>
                    <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>Meetings</span>
                  </div>
                  <div style={{ padding: "12px 16px" }}>
                    {meetings.length === 0 ? (
                      <p style={{ fontSize: "15px", color: "var(--text-muted)", margin: 0 }}>No upcoming meetings scheduled.</p>
                    ) : (
                      meetings.map((m) => (
                        <a key={m.id} href="/meetings" style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          padding: "6px 0", textDecoration: "none", color: "inherit",
                        }}>
                          <span style={{ fontSize: "15px", color: "var(--text-primary)" }}>{m.title}</span>
                          <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>{m.meeting_date}</span>
                        </a>
                      ))
                    )}
                  </div>
                </div>

                {isTeamLead ? (
                  <div style={{
                    backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                    borderRadius: "12px", overflow: "hidden",
                  }}>
                    <div style={{
                      padding: "12px 16px", borderBottom: "1px solid var(--border-color)",
                      display: "flex", alignItems: "center", gap: "8px",
                    }}>
                      <span style={{ fontSize: "16px" }}>👥</span>
                      <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>Team Workload</span>
                      <span style={{ fontSize: "13px", color: "var(--text-muted)", marginLeft: "auto" }}>open tasks per person</span>
                    </div>
                    <div style={{ padding: "12px 16px" }}>
                      {workload.map((w) => (
                        <div key={w.name} style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                          <span style={{
                            fontSize: "14px", color: "var(--text-primary)", width: "90px",
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
                          <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", width: "20px", textAlign: "right" }}>
                            {w.count}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{
                    backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                    borderRadius: "12px", overflow: "hidden",
                  }}>
                    <div style={{
                      padding: "12px 16px", borderBottom: "1px solid var(--border-color)",
                      display: "flex", alignItems: "center", gap: "8px",
                    }}>
                      <span style={{ fontSize: "16px" }}>📊</span>
                      <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>My Progress This Month</span>
                    </div>
                    <div style={{ padding: "16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px" }}>
                        <span style={{ fontSize: "28px", fontWeight: 800, color: "var(--text-primary)" }}>{myCompletedMonth}</span>
                        <span style={{ fontSize: "15px", color: "var(--text-secondary)" }}>of {myTotalMonth} tasks</span>
                      </div>
                      <div style={{
                        height: "10px", backgroundColor: "var(--border-light)", borderRadius: "5px", overflow: "hidden", marginBottom: "8px",
                      }}>
                        <div style={{
                          height: "100%", borderRadius: "5px",
                          width: `${progressPct}%`,
                          backgroundColor: progressPct >= 80 ? COLOURS.GREEN : progressPct >= 50 ? COLOURS.AMBER : COLOURS.BLUE,
                          transition: "width 0.3s ease",
                        }} />
                      </div>
                      <div style={{ fontSize: "14px", color: "var(--text-muted)" }}>
                        {progressPct}% completed {myOpenTasks.length > 0 ? `· ${myOpenTasks.length} still open` : ""}
                      </div>
                    </div>
                  </div>
                )}

                {isTeamLead && attention.length > 0 && (
                  <div style={{
                    backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                    borderRadius: "12px", overflow: "hidden",
                  }}>
                    <div style={{
                      padding: "12px 16px", borderBottom: "1px solid var(--border-color)",
                      display: "flex", alignItems: "center", gap: "8px",
                    }}>
                      <span style={{ fontSize: "16px" }}>⚠️</span>
                      <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>Needs Attention</span>
                    </div>
                    <div style={{ padding: "8px 16px" }}>
                      {attention.map((a, i) => (
                        <a key={i} href={a.href} style={{
                          display: "block", padding: "6px 0",
                          textDecoration: "none", color: "inherit",
                          borderBottom: i < attention.length - 1 ? "1px solid var(--border-light)" : "none",
                        }}>
                          <div style={{ fontSize: "15px", color: "var(--text-primary)", fontWeight: 500 }}>{a.label}</div>
                          <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>{a.detail}</div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {isTeamLead && assignedByMe.length > 0 && (
              <div style={{
                backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                borderRadius: "12px", overflow: "hidden", marginBottom: "20px",
              }}>
                <div style={{
                  padding: "12px 18px", borderBottom: "1px solid var(--border-color)",
                  display: "flex", alignItems: "center", gap: "8px",
                }}>
                  <span style={{ fontSize: "16px" }}>📤</span>
                  <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>Tasks I Assigned ({assignedByMe.length} open)</span>
                </div>
                {assignedByMe.slice(0, 10).map((t) => (
                  <a key={t.id} href="/tasks" style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "8px 18px", borderBottom: "1px solid var(--border-light)",
                    textDecoration: "none", color: "inherit",
                    transition: "background-color 0.1s",
                  }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-card-hover)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.description}
                      </div>
                      <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>
                        {t.assigned_to || "Unassigned"}{t.due_date && ` · Due: ${formatDateUK(t.due_date)}`}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "5px", alignItems: "center", flexShrink: 0 }}>
                      {isOverdue(t) && <span style={{ fontSize: "13px", fontWeight: 700, color: COLOURS.RED }}>{daysOverdue(t)}d late</span>}
                      <StatusBadge status={t.status} />
                      <button
                        title="Mark complete"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); quickAction(t.id, "complete", t); }}
                        style={{ background: "none", border: `1px solid ${COLOURS.GREEN}`, borderRadius: "6px", padding: "6px 12px", fontSize: "13px", fontWeight: 700, color: COLOURS.GREEN, cursor: "pointer", marginLeft: "4px", minHeight: "36px", minWidth: "44px" }}
                      >
                        Done
                      </button>
                      {t.assigned_to_email && (
                        <button
                          title="Send chase email"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); quickAction(t.id, "chase", t); }}
                          style={{ background: "none", border: `1px solid ${COLOURS.AMBER}`, borderRadius: "6px", padding: "6px 12px", fontSize: "13px", fontWeight: 700, color: COLOURS.AMBER, cursor: "pointer", minHeight: "36px", minWidth: "44px" }}
                        >
                          Chase
                        </button>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            )}

            {recentActivity.length > 0 && (
              <div style={{
                backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                borderRadius: "12px", overflow: "hidden", marginBottom: "20px",
              }}>
                <div style={{
                  padding: "12px 18px", borderBottom: "1px solid var(--border-color)",
                  display: "flex", alignItems: "center", gap: "8px",
                }}>
                  <span style={{ fontSize: "16px" }}>🕐</span>
                  <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>Recent Activity</span>
                </div>
                {recentActivity.map((a) => (
                  <div key={a.id} style={{
                    padding: "8px 18px", borderBottom: "1px solid var(--border-light)",
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "15px", color: "var(--text-primary)" }}>
                        <span style={{
                          fontSize: "13px", fontWeight: 700, padding: "1px 6px", borderRadius: "6px", marginRight: "6px",
                          backgroundColor: a.action === "Created" ? "#dcfce7" : a.action.startsWith("Updated") ? "#fef3c7" : "#fee2e2",
                          color: a.action === "Created" ? "#16a34a" : a.action.startsWith("Updated") ? "#d97706" : "#dc2626",
                        }}>{a.action}</span>
                        {a.table_name}{a.details && ` — ${a.details.slice(0, 60)}`}
                      </div>
                    </div>
                    <div style={{ fontSize: "14px", color: "var(--text-secondary)", whiteSpace: "nowrap", flexShrink: 0 }}>
                      {formatDateUK(a.created_at.slice(0, 10))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Purpose Statement ── */}
            <div style={{
              backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
              borderLeft: "4px solid var(--text-primary)",
              borderRadius: "8px", padding: isMobile ? "10px 12px" : "12px 18px",
              fontSize: isMobile ? "14px" : "16px", color: "var(--text-primary)",
              lineHeight: 1.7, fontStyle: "italic", fontWeight: 600,
            }}>
              &ldquo;Through service and sustainable business growth, we create opportunities that enhance the lifestyle of our employees, customers, and the community we operate in.&rdquo;
            </div>
          </>
        )}
        {toast && (
          <div style={{
            position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)",
            backgroundColor: COLOURS.NAVY, color: "white", padding: "10px 20px",
            borderRadius: "8px", fontSize: "14px", fontWeight: 600, zIndex: 1000,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          }}>
            {toast}
          </div>
        )}
      </main>
    </AuthWrapper>
  );
}

function KPICard({ icon, value, label, alert, sparkline }: { icon: string; value: number; label: string; alert?: boolean; sparkline?: number[] }) {
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
      <div style={{ fontSize: "15px", color: "var(--text-secondary)", marginTop: "4px" }}>{label}</div>
      {sparkline && sparkline.length > 1 && <MiniSparkline data={sparkline} color={alert ? COLOURS.RED : COLOURS.BLUE} />}
    </div>
  );
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1);
  const w = 80;
  const h = 24;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * (h - 4) - 2}`).join(" ");
  const lastX = w;
  const lastY = h - (data[data.length - 1] / max) * (h - 4) - 2;
  return (
    <svg width={w} height={h} style={{ marginTop: "6px", display: "block" }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity={0.5} />
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
    </svg>
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
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: "14px", marginBottom: "24px" }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: "12px", padding: "16px 18px" }}>
            <SkeletonPulse width="24px" height="24px" borderRadius="6px" />
            <div style={{ marginTop: "10px" }}><SkeletonPulse width="50px" height="28px" /></div>
            <div style={{ marginTop: "6px" }}><SkeletonPulse width="80px" height="13px" /></div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr minmax(280px, 340px)", gap: "20px" }}>
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
