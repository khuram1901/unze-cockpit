import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { isAdminTier } from "../../../lib/permissions";

// Returns FlowHCM-flagged leavers (leaver_flagged, deactivated, left_but_exempt)
// with their open task counts, for the Offboard tab leaver alert panel.
// CEO/Admin only — role === 'CEO', role === 'Admin', or khuram1901@gmail.com.
// Executive (PA) and HOD are explicitly excluded.
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();

  // Resolve member context for permission check
  const { data: member } = await supabase
    .from("members")
    .select("role, department, company, is_hod")
    .eq("email", auth.email)
    .maybeSingle();

  const ctx = {
    email:      auth.email,
    role:       member?.role ?? null,
    department: member?.department ?? null,
    company:    member?.company ?? null,
  };

  if (!isAdminTier(ctx)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  // Fetch lifecycle events for leaver types in last 30 days
  const { data: events } = await supabase
    .from("flw_lifecycle_events")
    .select("member_id, event_type, detail, created_at, employee_code")
    .in("event_type", ["leaver_flagged", "deactivated", "left_but_exempt"])
    .gte("created_at", thirtyDaysAgo)
    .order("created_at", { ascending: false });

  if (!events || events.length === 0) {
    return Response.json({ leavers: [] });
  }

  // Deduplicate: one entry per member_id — keep most severe / latest event
  const priority: Record<string, number> = { leaver_flagged: 3, deactivated: 2, left_but_exempt: 1 };
  const seen = new Map<string, typeof events[0]>();
  for (const ev of events) {
    const existing = seen.get(ev.member_id);
    if (!existing || (priority[ev.event_type] ?? 0) > (priority[existing.event_type] ?? 0)) {
      seen.set(ev.member_id, ev);
    }
  }

  const memberIds = Array.from(seen.keys());

  // Fetch member details
  const { data: memberRows } = await supabase
    .from("members")
    .select("id, name, email, is_active, department, company, manager_id")
    .in("id", memberIds);

  // Fetch open task counts per member email
  const emails = (memberRows ?? []).map((m) => m.email).filter(Boolean);
  const taskCountMap = new Map<string, number>();
  if (emails.length > 0) {
    const { data: taskRows } = await supabase
      .from("tasks")
      .select("assigned_to_email")
      .in("assigned_to_email", emails)
      .not("status", "in", "(Completed,Cancelled)");
    for (const t of taskRows ?? []) {
      taskCountMap.set(t.assigned_to_email, (taskCountMap.get(t.assigned_to_email) ?? 0) + 1);
    }
  }

  const leavers = (memberRows ?? []).map((m) => {
    const ev = seen.get(m.id)!;
    return {
      memberId:    m.id,
      name:        m.name,
      email:       m.email,
      isActive:    m.is_active,
      department:  m.department,
      company:     m.company,
      managerId:   m.manager_id,
      eventType:   ev.event_type,
      eventDetail: ev.detail,
      flaggedAt:   ev.created_at,
      openTasks:   taskCountMap.get(m.email) ?? 0,
    };
  }).sort((a, b) => {
    // Sort: leaver_flagged first, then deactivated, then exempt; within each, by open tasks desc
    const pa = priority[a.eventType] ?? 0;
    const pb = priority[b.eventType] ?? 0;
    if (pb !== pa) return pb - pa;
    return b.openTasks - a.openTasks;
  });

  return Response.json({ leavers });
}
