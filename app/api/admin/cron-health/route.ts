import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult;

  const { data: member } = await supabaseAdmin
    .from("members")
    .select("role")
    .eq("email", authResult.email)
    .single();

  if (!member || member.role !== "Admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const now = Date.now();

  const checks = await Promise.all([
    supabaseAdmin
      .from("notification_log")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => ({
        name: "Notifications",
        lastRun: data?.[0]?.created_at || null,
      })),

    supabaseAdmin
      .from("recurring_tasks")
      .select("last_created_at")
      .not("last_created_at", "is", null)
      .order("last_created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => ({
        name: "Recurring Tasks",
        lastRun: data?.[0]?.last_created_at || null,
      })),

    supabaseAdmin
      .from("pending_minutes")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => ({
        name: "Meeting Inbox",
        lastRun: data?.[0]?.created_at || null,
      })),

    supabaseAdmin
      .from("daily_cash_position")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => ({
        name: "Finance Inbox",
        lastRun: data?.[0]?.created_at || null,
      })),

    supabaseAdmin
      .from("price_history")
      .select("fetched_at")
      .order("fetched_at", { ascending: false })
      .limit(1)
      .then(({ data }) => ({
        name: "Price Update",
        lastRun: data?.[0]?.fetched_at || null,
      })),

    supabaseAdmin
      .from("audit_log")
      .select("created_at")
      .eq("action", "Backup")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => ({
        name: "Backup",
        lastRun: data?.[0]?.created_at || null,
      })),
  ]);

  const results = checks.map((c) => {
    const hoursAgo = c.lastRun
      ? Math.round((now - new Date(c.lastRun).getTime()) / 3600000)
      : null;
    return {
      ...c,
      hoursAgo,
      status: hoursAgo === null ? "unknown" : hoursAgo <= 25 ? "healthy" : hoursAgo <= 49 ? "warning" : "error",
    };
  });

  return NextResponse.json({ checks: results });
}
