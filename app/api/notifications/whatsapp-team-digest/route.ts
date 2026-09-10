/**
 * /api/notifications/whatsapp-team-digest
 *
 * Sends a personalised Friday morning WhatsApp digest to every team member
 * who has a phone number configured. Each person sees ONLY:
 *   1. Tasks assigned TO them that are still outstanding
 *   2. Tasks they have ASSIGNED to others that are still outstanding
 *
 * No-one sees another person's tasks or assignments.
 *
 * Vercel cron: every Friday at 03:00 UTC (08:00 PKT).
 * Manual: GET with Authorization: Bearer <CRON_SECRET>
 */

import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { sendWhatsAppNotification } from "../../../lib/whatsapp-push";

// These are the CEO/MD accounts that have their own separate digest
// (whatsapp-weekly-digest). Exclude them here to avoid double-messaging.
const EXCLUDE_EMAILS = new Set([
  "k.saleem@unzegroup.com",
  "khuram1901@gmail.com",
  "kamran@unze.co.uk",
]);

const OPEN_STATUSES = ["Open", "In Progress", "Waiting Reply", "Stuck", "Submitted"];

function formatDate(iso: string | null): string {
  if (!iso) return "no date";
  return iso.split("-").reverse().join("/");
}

function pktToday(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function taskLine(t: { description: string; due_date: string | null }, today: string, showDue = true): string {
  const overdue = t.due_date && t.due_date < today;
  const desc = t.description.slice(0, 65) + (t.description.length > 65 ? "…" : "");
  const due = showDue && t.due_date ? ` — due ${formatDate(t.due_date)}${overdue ? " ⚠️" : ""}` : "";
  return `• ${desc}${due}`;
}

function buildPersonalDigest({
  firstName,
  assignedToMe,
  assignedByMe,
  today,
}: {
  firstName: string;
  assignedToMe: { description: string; due_date: string | null; assigned_by: string | null }[];
  assignedByMe: { description: string; due_date: string | null; assigned_to: string | null }[];
  today: string;
}): string {
  const hasWork = assignedToMe.length > 0 || assignedByMe.length > 0;

  if (!hasWork) {
    return [
      `✅ *Weekly Task Digest — Unze Group*`,
      ``,
      `Hi ${firstName},`,
      ``,
      `You have no outstanding tasks as at ${formatDate(today)}. Keep it up! 🎉`,
    ].join("\n");
  }

  const lines: string[] = [
    `📋 *Weekly Task Digest — Unze Group*`,
    ``,
    `Hi ${firstName}, here's your Friday update as at ${formatDate(today)}:`,
    ``,
  ];

  // Section 1: Tasks assigned to me
  if (assignedToMe.length > 0) {
    const overdue = assignedToMe.filter(t => t.due_date && t.due_date < today);
    const current = assignedToMe.filter(t => !t.due_date || t.due_date >= today);

    lines.push(`📥 *ASSIGNED TO YOU (${assignedToMe.length} outstanding)*`);
    if (overdue.length > 0) {
      lines.push(`_Overdue:_`);
      overdue.slice(0, 8).forEach(t => lines.push(taskLine(t, today)));
      if (overdue.length > 8) lines.push(`  _…and ${overdue.length - 8} more overdue_`);
    }
    if (current.length > 0) {
      if (overdue.length > 0) lines.push(`_Upcoming:_`);
      current.slice(0, 8).forEach(t => lines.push(taskLine(t, today)));
      if (current.length > 8) lines.push(`  _…and ${current.length - 8} more_`);
    }
    lines.push(``);
  } else {
    lines.push(`📥 *ASSIGNED TO YOU* — none outstanding ✅`);
    lines.push(``);
  }

  // Section 2: Tasks I issued to others
  if (assignedByMe.length > 0) {
    const overdue = assignedByMe.filter(t => t.due_date && t.due_date < today);
    const current = assignedByMe.filter(t => !t.due_date || t.due_date >= today);

    lines.push(`📤 *TASKS YOU ISSUED (${assignedByMe.length} outstanding)*`);
    if (overdue.length > 0) {
      lines.push(`_Overdue:_`);
      overdue.slice(0, 8).forEach(t => {
        const who = t.assigned_to ? `[${t.assigned_to.split(" ")[0]}] ` : "";
        const desc = t.description.slice(0, 60) + (t.description.length > 60 ? "…" : "");
        lines.push(`• ${who}${desc} — due ${formatDate(t.due_date)} ⚠️`);
      });
      if (overdue.length > 8) lines.push(`  _…and ${overdue.length - 8} more overdue_`);
    }
    if (current.length > 0) {
      if (overdue.length > 0) lines.push(`_Upcoming:_`);
      current.slice(0, 8).forEach(t => {
        const who = t.assigned_to ? `[${t.assigned_to.split(" ")[0]}] ` : "";
        const desc = t.description.slice(0, 60) + (t.description.length > 60 ? "…" : "");
        const due = t.due_date ? ` — due ${formatDate(t.due_date)}` : "";
        lines.push(`• ${who}${desc}${due}`);
      });
      if (current.length > 8) lines.push(`  _…and ${current.length - 8} more_`);
    }
    lines.push(``);
  } else {
    lines.push(`📤 *TASKS YOU ISSUED* — all done ✅`);
    lines.push(``);
  }

  lines.push(`https://unze-cockpit.vercel.app/tasks`);
  return lines.join("\n");
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const today = pktToday();

  // Load all members with a phone number (excluding CEO digest recipients)
  const { data: members } = await supabase
    .from("members")
    .select("email, first_name, last_name, name, phone_e164")
    .not("phone_e164", "is", null);

  const eligible = (members || []).filter(m => m.email && !EXCLUDE_EMAILS.has(m.email));

  // Load all open tasks once — filter in memory per member (avoids N+1 queries)
  const { data: allTasks } = await supabase
    .from("tasks")
    .select("description, assigned_to, assigned_to_email, assigned_by, assigned_by_email, due_date, status")
    .in("status", OPEN_STATUSES);

  const tasks = allTasks || [];
  const results: { email: string; toMe: number; byMe: number; sent: boolean; error?: string }[] = [];

  for (const member of eligible) {
    const email = member.email!;
    const firstName = (member.first_name || member.name || email).split(" ")[0];

    // Tasks assigned to this person
    const assignedToMe = tasks
      .filter(t => t.assigned_to_email === email)
      .sort((a, b) => (a.due_date || "9999") < (b.due_date || "9999") ? -1 : 1);

    // Tasks this person assigned to someone else (not to themselves)
    const assignedByMe = tasks
      .filter(t => t.assigned_by_email === email && t.assigned_to_email !== email)
      .sort((a, b) => (a.due_date || "9999") < (b.due_date || "9999") ? -1 : 1);

    // Skip if nothing to report and no tasks at all
    if (assignedToMe.length === 0 && assignedByMe.length === 0) {
      results.push({ email, toMe: 0, byMe: 0, sent: false, error: "no_tasks" });
      continue;
    }

    const message = buildPersonalDigest({ firstName, assignedToMe, assignedByMe, today });
    const result = await sendWhatsAppNotification(member.phone_e164, firstName, message);
    results.push({ email, toMe: assignedToMe.length, byMe: assignedByMe.length, sent: result.ok, error: result.error });
  }

  const sent = results.filter(r => r.sent).length;
  return Response.json({ ok: true, date: today, sent, total: eligible.length, results });
}
