/**
 * /api/notifications/whatsapp-weekly-digest
 *
 * Sends a Friday morning WhatsApp summary to Khuram and Kamran showing all
 * outstanding tasks they personally issued that haven't been completed yet.
 *
 * Called by Vercel cron: every Friday at 03:00 UTC (08:00 PKT).
 * Also callable manually: GET /api/notifications/whatsapp-weekly-digest
 * with Authorization: Bearer <CRON_SECRET>
 */

import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { sendWhatsAppPush } from "../../../lib/whatsapp-push";

// The two issuers who receive the weekly digest.
// emails: all email addresses the person uses when assigning tasks
// memberEmail: the email on their members record (for phone lookup)
const DIGEST_RECIPIENTS: { memberEmail: string; emails: string[] }[] = [
  { memberEmail: "k.saleem@unzegroup.com", emails: ["k.saleem@unzegroup.com"] },
  { memberEmail: "kamran@unze.co.uk",    emails: ["kamran@unze.co.uk"] },
];

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

function buildDigestMessage(
  recipientName: string,
  tasks: { description: string; assigned_to: string | null; due_date: string | null; status: string }[],
  today: string
): string {
  if (tasks.length === 0) {
    return [
      `✅ *Weekly Task Digest — Unze Group*`,
      ``,
      `Hi ${recipientName.split(" ")[0]},`,
      ``,
      `Good news — you have no outstanding tasks issued by you as at ${formatDate(today)}.`,
      ``,
      `Have a great weekend! 🎉`,
    ].join("\n");
  }

  const overdue = tasks.filter(t => t.due_date && t.due_date < today);
  const dueThisWeek = tasks.filter(t => {
    if (!t.due_date || t.due_date < today) return false;
    const diff = (new Date(t.due_date).getTime() - new Date(today).getTime()) / 86400000;
    return diff <= 7;
  });
  const upcoming = tasks.filter(t => {
    if (!t.due_date) return true;
    const diff = (new Date(t.due_date).getTime() - new Date(today).getTime()) / 86400000;
    return diff > 7;
  });

  const lines: string[] = [
    `📊 *Weekly Outstanding Tasks — Unze Group*`,
    ``,
    `Hi ${recipientName.split(" ")[0]}, here are your outstanding tasks as at ${formatDate(today)}:`,
    ``,
  ];

  if (overdue.length > 0) {
    lines.push(`🔴 *OVERDUE (${overdue.length})*`);
    for (const t of overdue.slice(0, 15)) {
      lines.push(`• ${t.description.slice(0, 70)}${t.description.length > 70 ? "…" : ""} — ${t.assigned_to || "Unassigned"} — due ${formatDate(t.due_date)}`);
    }
    if (overdue.length > 15) lines.push(`  _…and ${overdue.length - 15} more_`);
    lines.push(``);
  }

  if (dueThisWeek.length > 0) {
    lines.push(`🟡 *DUE THIS WEEK (${dueThisWeek.length})*`);
    for (const t of dueThisWeek.slice(0, 10)) {
      lines.push(`• ${t.description.slice(0, 70)}${t.description.length > 70 ? "…" : ""} — ${t.assigned_to || "Unassigned"} — due ${formatDate(t.due_date)}`);
    }
    if (dueThisWeek.length > 10) lines.push(`  _…and ${dueThisWeek.length - 10} more_`);
    lines.push(``);
  }

  if (upcoming.length > 0) {
    lines.push(`🟢 *UPCOMING (${upcoming.length})*`);
    for (const t of upcoming.slice(0, 8)) {
      lines.push(`• ${t.description.slice(0, 70)}${t.description.length > 70 ? "…" : ""} — ${t.assigned_to || "Unassigned"}${t.due_date ? ` — due ${formatDate(t.due_date)}` : ""}`);
    }
    if (upcoming.length > 8) lines.push(`  _…and ${upcoming.length - 8} more_`);
    lines.push(``);
  }

  lines.push(`*Total outstanding: ${tasks.length} task${tasks.length !== 1 ? "s" : ""}*`);
  lines.push(``);
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
  const results: { email: string; tasks: number; sent: boolean; error?: string }[] = [];

  for (const recipient of DIGEST_RECIPIENTS) {
    // Get recipient's name and phone from their primary member record
    const { data: member } = await supabase
      .from("members")
      .select("first_name, last_name, name, phone_e164")
      .eq("email", recipient.memberEmail)
      .maybeSingle();

    if (!member?.phone_e164) {
      results.push({ email: recipient.memberEmail, tasks: 0, sent: false, error: "no_phone" });
      continue;
    }

    const recipientName = `${member.first_name || ""} ${member.last_name || ""}`.trim() || member.name || recipient.memberEmail;

    // Get all outstanding tasks issued by this person across all their emails
    const { data: tasks } = await supabase
      .from("tasks")
      .select("description, assigned_to, due_date, status")
      .in("assigned_by_email", recipient.emails)
      .in("status", OPEN_STATUSES)
      .order("due_date", { ascending: true, nullsFirst: false });

    const taskList = tasks || [];
    const message = buildDigestMessage(recipientName, taskList, today);
    const result = await sendWhatsAppPush(member.phone_e164, message);

    results.push({ email: recipient.memberEmail, tasks: taskList.length, sent: result.ok, error: result.error });
  }

  return Response.json({ ok: true, date: today, results });
}
