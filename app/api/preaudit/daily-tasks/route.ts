// Cron endpoint: GET /api/preaudit/daily-tasks
// Runs Mon–Fri at 08:00 PKT (03:00 UTC).
// For each preaudit_assignment, creates one task in the tasks table
// for today (PKT date) unless one already exists for that assignment + date.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  // Today in PKT (Pakistan Standard Time)
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" }); // YYYY-MM-DD
  const todayUK = today.split("-").reverse().join("/"); // DD/MM/YYYY for display

  const sb = createServiceClient();

  // Fetch all active assignments with member email/name and company name
  const { data: assignments, error: aErr } = await sb
    .from("preaudit_assignments")
    .select("id, member_id, company_id, members(email, name), companies(name)");

  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  if (!assignments || assignments.length === 0) {
    return NextResponse.json({ created: 0, skipped: 0, reason: "No assignments" });
  }

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const a of assignments) {
    const memberEmail = (a.members as { email: string; name: string } | null)?.email;
    const memberName  = (a.members as { email: string; name: string } | null)?.name ?? "";
    const companyName = (a.companies as { name: string } | null)?.name ?? "Company";

    if (!memberEmail) { skipped++; continue; }

    // Check if a task already exists for this assignment + today
    const { data: existing } = await sb
      .from("tasks")
      .select("id")
      .eq("source_type", "preaudit")
      .eq("assigned_to_email", memberEmail)
      .eq("company_id", a.company_id)
      .eq("due_date", today)
      .maybeSingle();

    if (existing) { skipped++; continue; }

    // Create the task — description is the primary display field (NOT NULL)
    const { error: tErr } = await sb.from("tasks").insert({
      description: `Pre-Audit: ${companyName} — ${todayUK}`,
      assigned_to: memberName,
      assigned_to_email: memberEmail,
      assigned_by_email: "system@unze.co.uk",   // required by check constraint
      company_id: a.company_id,
      due_date: today,
      source_type: "preaudit",
      source_record_id: a.id,   // links back to preaudit_assignments.id
      status: "Not Started",
      priority: "Normal",
      task_type: "Task",
      whatsapp_auto_remind: false,
      requires_manager_signoff: false,
    });

    if (tErr) {
      errors.push(`${memberEmail}/${a.company_id}: ${tErr.message}`);
    } else {
      created++;
    }
  }

  return NextResponse.json({ created, skipped, errors, today });
}
