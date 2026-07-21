import { NextRequest } from "next/server";
import { createServiceClient } from "../../lib/supabase-server";
import { requireAuth } from "../../lib/api-auth";

const todayStr = () => new Date().toISOString().slice(0, 10);
const offsetDay = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const today = todayStr();
  const tomorrow = offsetDay(1);
  const nextWeek = offsetDay(7);

  // Always fetch member profile first so we know role + department
  const memberRes = await supabase
    .from("members")
    .select("first_name, name, role, department")
    .eq("email", auth.email)
    .maybeSingle();

  const member = memberRes.data;
  const firstName = member?.first_name || member?.name?.split(" ")[0] || auth.email.split("@")[0];
  const role = member?.role ?? null;
  const department = member?.department ?? null;

  // ── Admin / CEO / Executive ────────────────────────────────────────
  // Return the same counts as before (system-wide overdue + machine issues)
  if (!role || role === "Admin" || role === "CEO" || role === "Executive") {
    const [overdueRes, machineRes] = await Promise.all([
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .not("status", "in", "(Completed,Cancelled)")
        .lt("due_date", today),
      supabase
        .from("machine_issues")
        .select("id", { count: "exact", head: true })
        .neq("issue_status", "Resolved"),
    ]);
    return Response.json({
      firstName,
      role,
      department,
      overdueTaskCount: overdueRes.count ?? 0,
      machineIssueCount: machineRes.count ?? 0,
    });
  }

  // ── Manager (HOD) ──────────────────────────────────────────────────
  if (role === "Manager") {
    const dept = department ?? "";

    const [
      teamOverdueCountRes,
      teamPendingCountRes,
      teamCompletedMonthRes,
      myOverdueCountRes,
      myTodayCountRes,
      teamOverdueListRes,
      myTasksListRes,
    ] = await Promise.all([
      // Team: overdue count
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("assigned_to_department", dept)
        .not("status", "in", "(Completed,Cancelled)")
        .not("due_date", "is", null)
        .lt("due_date", today),

      // Team: pending (active, not overdue) count
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("assigned_to_department", dept)
        .not("status", "in", "(Completed,Cancelled)")
        .or(`due_date.is.null,due_date.gte.${today}`),

      // Team: completed this calendar month count
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("assigned_to_department", dept)
        .eq("status", "Completed")
        .gte("updated_at", today.slice(0, 7) + "-01"),

      // My own: overdue count
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("assigned_to_email", auth.email)
        .not("status", "in", "(Completed,Cancelled)")
        .not("due_date", "is", null)
        .lt("due_date", today),

      // My own: due today count
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("assigned_to_email", auth.email)
        .not("status", "in", "(Completed,Cancelled)")
        .eq("due_date", today),

      // Team overdue list (most overdue first, top 15)
      supabase
        .from("tasks")
        .select("id, description, assigned_to, assigned_to_email, due_date, priority, status")
        .eq("assigned_to_department", dept)
        .not("status", "in", "(Completed,Cancelled)")
        .not("due_date", "is", null)
        .lt("due_date", today)
        .order("due_date", { ascending: true })
        .limit(15),

      // My tasks: overdue + due today (top 10, oldest first)
      supabase
        .from("tasks")
        .select("id, description, due_date, priority, status")
        .eq("assigned_to_email", auth.email)
        .not("status", "in", "(Completed,Cancelled)")
        .not("due_date", "is", null)
        .lte("due_date", today)
        .order("due_date", { ascending: true })
        .limit(10),
    ]);

    return Response.json({
      firstName,
      role,
      department,
      teamOverdueCount: teamOverdueCountRes.count ?? 0,
      teamPendingCount: teamPendingCountRes.count ?? 0,
      teamCompletedMonth: teamCompletedMonthRes.count ?? 0,
      myOverdueCount: myOverdueCountRes.count ?? 0,
      myTodayCount: myTodayCountRes.count ?? 0,
      teamOverdueTasks: teamOverdueListRes.data ?? [],
      myTasks: myTasksListRes.data ?? [],
    });
  }

  // ── Member ─────────────────────────────────────────────────────────
  const [
    myOverdueCountRes,
    myTodayCountRes,
    myUpcomingCountRes,
    myTasksRes,
  ] = await Promise.all([
    // Overdue
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to_email", auth.email)
      .not("status", "in", "(Completed,Cancelled)")
      .not("due_date", "is", null)
      .lt("due_date", today),

    // Due today
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to_email", auth.email)
      .not("status", "in", "(Completed,Cancelled)")
      .eq("due_date", today),

    // Upcoming: tomorrow → +7 days
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to_email", auth.email)
      .not("status", "in", "(Completed,Cancelled)")
      .gte("due_date", tomorrow)
      .lte("due_date", nextWeek),

    // Task list: overdue + today + next 7 days, up to 25, oldest first
    supabase
      .from("tasks")
      .select("id, description, due_date, priority, status")
      .eq("assigned_to_email", auth.email)
      .not("status", "in", "(Completed,Cancelled)")
      .not("due_date", "is", null)
      .lte("due_date", nextWeek)
      .order("due_date", { ascending: true })
      .limit(25),
  ]);

  return Response.json({
    firstName,
    role,
    department,
    myOverdueCount: myOverdueCountRes.count ?? 0,
    myTodayCount: myTodayCountRes.count ?? 0,
    myUpcomingCount: myUpcomingCountRes.count ?? 0,
    myTasks: myTasksRes.data ?? [],
  });
}
