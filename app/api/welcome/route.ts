import { NextRequest } from "next/server";
import { createServiceClient } from "../../lib/supabase-server";
import { requireAuth } from "../../lib/api-auth";
import {
  isPrivileged,
  canViewFinance,
  canViewReceivables,
  canViewInvestments,
  canViewOperations,
  canSeeAllMinutes,
  canManageMembers,
  canViewGuarantees,
  canViewExecutiveDashboard,
  canViewPADashboard,
  canViewAuditLog,
  type UserCtx,
} from "../../lib/permissions";

// ── date helpers ──────────────────────────────────────────────
function todayStr() { return new Date().toISOString().slice(0, 10); }
function offsetStr(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}
function monthStartStr() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1).toISOString().slice(0, 10);
}

// ── quick links ───────────────────────────────────────────────
type QuickLink = { href: string; title: string; icon: string; color: string };

const DEPT_PAGES: Record<string, { href: string; icon: string }> = {
  "HR":             { href: "/department/hr",       icon: "🧑‍💼" },
  "Admin":          { href: "/department/admin",     icon: "🏛️"  },
  "Audit":          { href: "/department/audit",     icon: "🔎"  },
  "Tax":            { href: "/department/tax",       icon: "🧾"  },
  "IT":             { href: "/department/it",        icon: "🖥️"  },
  "Unze Trading Ops": { href: "/dashboard",          icon: "🏗️"  },
};

function computeQuickLinks(ctx: UserCtx): QuickLink[] {
  // ── Kamran-specific quick links ───────────────────────────────
  // Customised set: no PA Dashboard, no Investments.
  // Imperial P&L + Imperial Footwear + HR instead.
  if (ctx.email?.toLowerCase() === "kamran@unze.co.uk") {
    return [
      { href: "/home",                 title: "Dashboard",          icon: "📊", color: "navy"   },
      { href: "/tasks",                title: "Tasks",              icon: "🎯", color: "blue"   },
      { href: "/finance/imperial-pnl", title: "Imperial P&L",       icon: "👟", color: "green"  },
      { href: "/finance/imperial",     title: "Imperial Footwear",  icon: "👞", color: "amber"  },
      { href: "/department/hr",        title: "HR",                 icon: "🧑‍💼", color: "purple" },
      { href: "/my-minutes",           title: "My Minutes",         icon: "🗒️", color: "green"  },
      { href: "/folderit",             title: "Folder-it",          icon: "📁", color: "amber"  },
      { href: "/profile",              title: "Profile",            icon: "👤", color: "slate"  },
    ];
  }

  const links: QuickLink[] = [];

  // Executive dashboard shortcut (CEO/Admin)
  if (canViewExecutiveDashboard(ctx))
    links.push({ href: "/home", title: "Exec Dashboard", icon: "📊", color: "navy" });

  // PA dashboard shortcut
  if (canViewPADashboard(ctx))
    links.push({ href: "/pa", title: "PA Dashboard", icon: "⚡", color: "purple" });

  // Tasks — everyone
  links.push({ href: "/tasks", title: "Tasks", icon: "🎯", color: "blue" });

  // Dept page for managers (inserted right after Tasks)
  if (ctx.role === "Manager" && ctx.department) {
    const dl = DEPT_PAGES[ctx.department];
    if (dl) links.push({ href: dl.href, title: ctx.department, icon: dl.icon, color: "amber" });
  }

  // My Minutes — everyone
  links.push({ href: "/my-minutes", title: "My Minutes", icon: "🗒️", color: "green" });

  // Folder-it — everyone
  links.push({ href: "/folderit", title: "Folder-it", icon: "📁", color: "amber" });

  // Finance pages
  if (canViewFinance(ctx))
    links.push({ href: "/finance/profit-and-loss", title: "Finance", icon: "📉", color: "green" });
  if (canViewReceivables(ctx))
    links.push({ href: "/receivables", title: "Receivables", icon: "💳", color: "red" });
  if (canViewInvestments(ctx))
    links.push({ href: "/investments", title: "Investments", icon: "📈", color: "amber" });
  if (canViewGuarantees(ctx))
    links.push({ href: "/finance/guarantees", title: "Bank Facilities", icon: "🔐", color: "green" });

  // Operations
  if (canViewOperations(ctx))
    links.push({ href: "/dashboard", title: "Operations", icon: "🏗️", color: "purple" });

  // Members
  if (canManageMembers(ctx))
    links.push({ href: "/members", title: "Members", icon: "👥", color: "slate" });

  // Audit Log
  if (canViewAuditLog(ctx))
    links.push({ href: "/audit-log", title: "Audit Log", icon: "📋", color: "navy" });

  // Profile — everyone (always last)
  links.push({ href: "/profile", title: "Profile", icon: "👤", color: "slate" });

  // Cap at 9 items (3×3 quick-link grid)
  return links.slice(0, 9);
}

// ── route ─────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const today        = todayStr();
  const tomorrow     = offsetStr(1);
  const dayAfterTmrw = offsetStr(2);
  const weekEnd      = offsetStr(7);
  const monthStart   = monthStartStr();

  // ── 1. Member profile ───────────────────────────────────────
  const { data: member } = await supabase
    .from("members")
    .select("id, first_name, name, role, department, company, photo_url")
    .eq("email", auth.email)
    .maybeSingle();

  const firstName = member?.first_name || member?.name?.split(" ")[0] || auth.email.split("@")[0];
  const role       = member?.role       ?? null;
  const department = member?.department ?? null;
  const photoUrl   = member?.photo_url  ?? null;
  const memberId   = member?.id         ?? null;

  // Build permission context (no per-row overrides needed for home page quick links)
  const ctx: UserCtx = {
    email:      auth.email,
    role,
    department,
    company:    member?.company ?? null,
  };

  const quickLinks = computeQuickLinks(ctx);

  // ── 2. Personal task counts ─────────────────────────────────
  const [overdueRes, todayRes, tomorrowRes, weekRes, myTasksRes] = await Promise.all([
    // Overdue: due_date < today, not done
    supabase.from("tasks").select("id", { count: "exact", head: true })
      .eq("assigned_to_email", auth.email)
      .not("status", "in", "(Completed,Cancelled)")
      .lt("due_date", today),
    // Today
    supabase.from("tasks").select("id", { count: "exact", head: true })
      .eq("assigned_to_email", auth.email)
      .not("status", "in", "(Completed,Cancelled)")
      .eq("due_date", today),
    // Tomorrow
    supabase.from("tasks").select("id", { count: "exact", head: true })
      .eq("assigned_to_email", auth.email)
      .not("status", "in", "(Completed,Cancelled)")
      .eq("due_date", tomorrow),
    // This week (day-after-tomorrow through 7 days out, non-overlapping)
    supabase.from("tasks").select("id", { count: "exact", head: true })
      .eq("assigned_to_email", auth.email)
      .not("status", "in", "(Completed,Cancelled)")
      .gte("due_date", dayAfterTmrw)
      .lte("due_date", weekEnd),
    // Task list for the card (overdue + today + upcoming, capped at 12)
    supabase.from("tasks")
      .select("id, description, due_date, priority, status, assigned_to, assigned_to_email, assigned_by")
      .eq("assigned_to_email", auth.email)
      .not("status", "in", "(Completed,Cancelled)")
      .lte("due_date", weekEnd)
      .order("due_date", { ascending: true })
      .limit(12),
  ]);

  const base = {
    firstName,
    name:             member?.name ?? firstName,
    role,
    department,
    photoUrl,
    quickLinks,
    myOverdueCount:   overdueRes.count  ?? 0,
    myTodayCount:     todayRes.count    ?? 0,
    myTomorrowCount:  tomorrowRes.count ?? 0,
    myWeekCount:      weekRes.count     ?? 0,
    myTasks:          myTasksRes.data   ?? [],
  };

  // ── 3. Manager: team data ───────────────────────────────────
  if (role === "Manager" && department && memberId) {
    const { data: teamMembers } = await supabase
      .from("members")
      .select("email, first_name, name")
      .eq("department", department)
      .eq("role", "Member")
      .neq("email", auth.email);

    const emails = (teamMembers ?? []).map((m) => m.email);

    if (emails.length > 0) {
      const [tOvRes, tTdRes, tCmRes, tOvTasksRes] = await Promise.all([
        supabase.from("tasks").select("id", { count: "exact", head: true })
          .in("assigned_to_email", emails)
          .not("status", "in", "(Completed,Cancelled)")
          .lt("due_date", today),
        supabase.from("tasks").select("id", { count: "exact", head: true })
          .in("assigned_to_email", emails)
          .not("status", "in", "(Completed,Cancelled)")
          .eq("due_date", today),
        supabase.from("tasks").select("id", { count: "exact", head: true })
          .in("assigned_to_email", emails)
          .eq("status", "Completed")
          .gte("due_date", monthStart),
        supabase.from("tasks")
          .select("id, description, due_date, priority, status, assigned_to, assigned_to_email")
          .in("assigned_to_email", emails)
          .not("status", "in", "(Completed,Cancelled)")
          .lt("due_date", today)
          .order("due_date", { ascending: true })
          .limit(8),
      ]);

      // Per-member overdue/today counts (up to 8 members to keep it fast)
      const memberStatusList = await Promise.all(
        (teamMembers ?? []).slice(0, 8).map(async (m) => {
          const [ov, td] = await Promise.all([
            supabase.from("tasks").select("id", { count: "exact", head: true })
              .eq("assigned_to_email", m.email)
              .not("status", "in", "(Completed,Cancelled)")
              .lt("due_date", today),
            supabase.from("tasks").select("id", { count: "exact", head: true })
              .eq("assigned_to_email", m.email)
              .not("status", "in", "(Completed,Cancelled)")
              .eq("due_date", today),
          ]);
          return {
            name:         m.first_name || m.name?.split(" ")[0] || m.email.split("@")[0],
            email:        m.email,
            overdueCount: ov.count ?? 0,
            todayCount:   td.count ?? 0,
          };
        })
      );

      return Response.json({
        ...base,
        teamSize:            emails.length + 1,
        teamOverdueCount:    tOvRes.count  ?? 0,
        teamTodayCount:      tTdRes.count  ?? 0,
        teamCompletedMonth:  tCmRes.count  ?? 0,
        teamOverdueTasks:    tOvTasksRes.data ?? [],
        teamMemberStatus:    memberStatusList,
      });
    }
  }

  // ── 4. Privileged (CEO / Admin / Exec): group stats ────────
  if (isPrivileged(ctx)) {
    const [grpOvRes, machRes] = await Promise.all([
      supabase.from("tasks").select("id", { count: "exact", head: true })
        .not("status", "in", "(Completed,Cancelled)")
        .lt("due_date", today),
      supabase.from("machine_issues").select("id", { count: "exact", head: true })
        .neq("issue_status", "Resolved"),
    ]);

    return Response.json({
      ...base,
      groupOverdueCount: grpOvRes.count ?? 0,
      machineIssueCount: machRes.count  ?? 0,
    });
  }

  return Response.json(base);
}
