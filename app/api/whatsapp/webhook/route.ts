import { NextRequest } from "next/server";
import crypto from "crypto";
import { createServiceClient } from "../../../lib/supabase-server";
import { createTaskCore } from "../../../lib/task-creation";

// WhatsApp → tasks. Staff message the company's WhatsApp Business number
// ("@Ali Prepare the June VAT return, due Friday") and the task lands in
// the app through createTaskCore — the same gate as the New Task form, so
// the assignee gets the normal notification and My Tasks entry.
//
// Mapping: the sender's phone must match a member's phone_e164 AND that
// member must have wa_can_issue_tasks enabled (managed at
// /settings/whatsapp). If no due date is given, the bot replies asking for
// one and holds the draft until the sender answers (or replies "cancel").
//
// Meta setup (see WHATSAPP_SETUP.md): env vars WHATSAPP_VERIFY_TOKEN,
// WHATSAPP_APP_SECRET, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID.

export const maxDuration = 30;

const GRAPH = "https://graph.facebook.com/v20.0";

// ── Helpers ──────────────────────────────────────────────────────────────────

const digits = (p: string | null | undefined) => (p || "").replace(/\D/g, "");

async function sendReply(to: string, text: string) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return; // not configured — silently skip replies
  try {
    await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text.slice(0, 4000) },
      }),
    });
  } catch (e) {
    console.error("[whatsapp] reply failed:", e);
  }
}

// "Today" in Pakistan time — WhatsApp tasks are issued against PKT dates.
function pktToday(): Date {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// Parses a human due date: today, tomorrow, monday…sunday (next occurrence),
// 5 sep / sep 5, 05/09 (DD/MM), 2026-09-05. Returns YYYY-MM-DD or null.
function parseDueDate(raw: string): string | null {
  // Strip time expressions so "tomorrow 10:30am", "Friday at 3 PM",
  // "9:00 am Tuesday", "14:00 tomorrow" all parse correctly.
  const s = raw.trim().toLowerCase()
    .replace(/\b(?:at\s+)?\d{1,2}:\d{2}\s*(?:am|pm)?\b/gi, "")  // HH:MM or HH:MM am/pm
    .replace(/\b(?:at\s+)?\d{1,2}\s*(?:am|pm)\b/gi, "")           // H am/pm
    .replace(/\bat\s+\d{1,2}\b/gi, "")                              // "at 9"
    .replace(/^(due|by|on|next|coming)\s+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const today = pktToday();
  if (!s) return null;
  if (s === "this week" || s === "week") {
    const d = new Date(today);
    const daysToFri = ((5 - d.getUTCDay()) + 7) % 7 || 7;
    d.setUTCDate(d.getUTCDate() + daysToFri);
    return iso(d);
  }
  if (s === "next week") {
    const d = new Date(today);
    const daysToFri = ((5 - d.getUTCDay()) + 7) % 7 + 7;
    d.setUTCDate(d.getUTCDate() + daysToFri);
    return iso(d);
  }
  if (s === "today" || s === "eod") return iso(today);
  if (s === "tomorrow" || s === "tmrw") { const d = new Date(today); d.setUTCDate(d.getUTCDate() + 1); return iso(d); }
  // Weekday name (full, 3-letter, or unambiguous prefix ≥3 chars) → next occurrence
  if (s.length >= 3 && /^[a-z]+$/.test(s)) {
    const target = DAY_NAMES.findIndex((d) => d === s || d.slice(0, 3) === s || d.startsWith(s));
    if (target >= 0) {
      const d = new Date(today);
      let add = (target - d.getUTCDay() + 7) % 7;
      if (add === 0) add = 7; // "friday" on a Friday means NEXT Friday
      d.setUTCDate(d.getUTCDate() + add);
      return iso(d);
    }
  }
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/); // DD/MM(/YY)
  if (m) {
    const dd = +m[1], mm = +m[2];
    let yy = m[3] ? +m[3] : today.getUTCFullYear();
    if (yy < 100) yy += 2000;
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      const d = new Date(Date.UTC(yy, mm - 1, dd));
      if (d.getTime() >= today.getTime() - 86400000) return iso(d);
    }
  }
  m = s.match(/^(\d{1,2})\s+([a-z]{3,9})(?:\s+(\d{4}))?$/) || s.match(/^([a-z]{3,9})\s+(\d{1,2})(?:\s+(\d{4}))?$/);
  if (m) {
    const a = m[1], b = m[2];
    const dd = /^\d/.test(a) ? +a : +b;
    const monName = (/^\d/.test(a) ? b : a).slice(0, 3);
    const mon = MONTHS[monName];
    if (mon !== undefined && dd >= 1 && dd <= 31) {
      let yy = m[3] ? +m[3] : today.getUTCFullYear();
      let d = new Date(Date.UTC(yy, mon, dd));
      if (!m[3] && d.getTime() < today.getTime()) d = new Date(Date.UTC(yy + 1, mon, dd));
      return iso(d);
    }
  }
  return null;
}

// Splits "…, due Friday" / "… by 5 Sep" / "… tomorrow …" off the description.
// 1. Looks for explicit "by/due <date>" anywhere in the message (takes last match).
// 2. Falls back to bare date keywords (today, tomorrow, weekday names, DD/MM).
function extractDue(text: string): { description: string; due: string | null } {
  // Pass 1: explicit "by/due <date>"
  const pattern = /[,;\s]\b(?:due|by)\s+([a-z0-9\/\-]+(?:\s+[a-z0-9\/\-]+){0,3})\b/gi;
  let lastMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) lastMatch = m;
  if (lastMatch) {
    const due = parseDueDate(lastMatch[1]);
    if (due) {
      const before = text.slice(0, lastMatch.index).replace(/[,;\s]+$/, "").trim();
      const after = text.slice(lastMatch.index + lastMatch[0].length).replace(/^[.,;\s]+/, "").trim();
      const description = after ? (before + " — " + after) : before;
      return { description: description.trim(), due };
    }
  }
  // Pass 2: bare date keywords — today, tomorrow, tmrw, weekday names, DD/MM
  const bare = /\b(today|eod|tomorrow|tmrw|this\s+week|next\s+week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|\d{1,2}[\/-]\d{1,2})\b/gi;
  let bareMatch: RegExpExecArray | null = null;
  while ((m = bare.exec(text)) !== null) bareMatch = m;
  if (bareMatch) {
    const due = parseDueDate(bareMatch[1]);
    if (due) {
      // Strip the matched date word and any time suffix immediately after it
      const cleaned = text
        .slice(0, bareMatch.index)
        .concat(text.slice(bareMatch.index + bareMatch[0].length))
        .replace(/\s*\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      return { description: cleaned, due };
    }
  }
  return { description: text.trim(), due: null };
}

type MemberRow = {
  id: string; email: string | null; first_name: string | null; last_name: string | null;
  name: string | null; department: string | null; company_id: string | null;
  phone_e164: string | null; wa_can_issue_tasks: boolean | null;
};

const fullName = (m: MemberRow) =>
  (`${m.first_name || ""} ${m.last_name || ""}`.trim() || m.name || m.email || "Unknown");

// Resolve the assignee from the words after "@" / "task for". Tries the
// longest name match first ("@Ali Nasir …" beats "@Ali …").
// Matches on: full name, first name, last name, or any word in the full name.
function resolveAssignee(text: string, members: MemberRow[]): { member?: MemberRow; rest?: string; ambiguous?: MemberRow[] } {
  const words = text.trim().split(/\s+/);
  for (let take = Math.min(4, words.length); take >= 1; take--) {
    const candidate = words.slice(0, take).join(" ").toLowerCase().replace(/[:,]+$/, "").trim();
    if (!candidate || candidate.length < 2) continue;
    const matches = members.filter((m) => {
      const fn = (m.first_name || "").trim().toLowerCase();
      const ln = (m.last_name || "").trim().toLowerCase();
      const full = fullName(m).toLowerCase();
      return (
        full === candidate ||
        fn === candidate ||
        ln === candidate ||
        full.startsWith(candidate + " ") ||
        full.includes(" " + candidate) ||
        fn.startsWith(candidate) ||
        ln.startsWith(candidate)
      );
    });
    if (matches.length === 1) {
      const rest = words.slice(take).join(" ").replace(/^[:\-–,]\s*/, "").trim();
      return { member: matches[0], rest };
    }
    if (matches.length > 1) {
      // If all matches share the same person (duplicate rows), pick first
      const ids = [...new Set(matches.map((m) => m.id))];
      if (ids.length === 1) {
        const rest = words.slice(take).join(" ").replace(/^[:\-–,]\s*/, "").trim();
        return { member: matches[0], rest };
      }
      if (take === 1) return { ambiguous: matches };
    }
  }
  return {};
}

async function createTaskFromWhatsApp(opts: {
  sender: MemberRow; assignee: MemberRow; description: string; due: string;
}): Promise<string> {
  const { sender, assignee, description, due } = opts;
  if (!assignee.company_id) {
    return `⚠ ${fullName(assignee)} has no company set in the dashboard — ask an admin to fix their member record, then resend.`;
  }
  const result = await createTaskCore({
    description,
    companyId: assignee.company_id,
    assignedTo: fullName(assignee),
    assignedToEmail: assignee.email,
    assignedToMemberId: assignee.id,
    assignedToDepartment: assignee.department,
    dueDate: due,
    sourceType: "whatsapp",
    sourceLabel: "WhatsApp",
    notificationStyle: "task_assigned",
    actor: { kind: "user", name: fullName(sender), email: sender.email || "" },
  });
  if (!result.ok) return `⚠ Could not create the task: ${result.error}`;
  const dueLabel = new Date(due + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return `✓ Task created for ${fullName(assignee)}, due ${dueLabel}:\n"${description}"`;
}

// ── Webhook verification (Meta calls this once when you set the URL) ─────────
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  if (sp.get("hub.mode") === "subscribe" && sp.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(sp.get("hub.challenge") || "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

// ── Inbound messages ─────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const raw = await request.text();

  // Authenticate the webhook: Meta signs every delivery with the app secret.
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return new Response("Not configured", { status: 500 });
  const sig = request.headers.get("x-hub-signature-256") || "";
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return new Response("Bad signature", { status: 401 });
  }

  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return new Response("ok", { status: 200 }); }

  const supabase = createServiceClient();

  type WaMessage = { id?: string; from?: string; type?: string; text?: { body?: string } };
  const messages: WaMessage[] = [];
  const p = payload as { entry?: { changes?: { value?: { messages?: WaMessage[] } }[] }[] };
  for (const entry of p.entry || []) {
    for (const change of entry.changes || []) {
      for (const msg of change.value?.messages || []) messages.push(msg);
    }
  }

  for (const msg of messages) {
    if (msg.type !== "text" || !msg.id || !msg.from) continue;
    const body = (msg.text?.body || "").trim();
    const from = digits(msg.from);

    // Dedupe — Meta retries deliveries; the unique index makes this atomic.
    const { error: dupErr } = await supabase.from("whatsapp_inbound_log").insert({
      wa_message_id: msg.id, from_phone: from, body: body.slice(0, 2000), outcome: "received",
    });
    if (dupErr) continue; // already processed

    const logOutcome = (outcome: string) =>
      supabase.from("whatsapp_inbound_log").update({ outcome }).eq("wa_message_id", msg.id!);

    // Load members once per message batch (small table).
    const { data: allMembers } = await supabase
      .from("members")
      .select("id, email, first_name, last_name, name, department, company_id, phone_e164, wa_can_issue_tasks");
    const members = (allMembers || []) as MemberRow[];

    const sender = members.find((m) => digits(m.phone_e164) && digits(m.phone_e164) === from);
    if (!sender) {
      await sendReply(from, "This number isn't linked to the Unze dashboard. Ask an admin to add your WhatsApp number at Settings → WhatsApp.");
      await logOutcome("unmapped_sender");
      continue;
    }
    if (!sender.wa_can_issue_tasks) {
      await sendReply(from, `Hi ${fullName(sender).split(" ")[0]} — your number is linked, but you don't have permission to issue tasks from WhatsApp. Ask an admin to enable it.`);
      await logOutcome("not_permitted");
      continue;
    }

    // Is this a reply to a pending "when is it due?" question?
    const { data: pendingRows } = await supabase
      .from("whatsapp_pending_tasks").select("*").eq("sender_phone", from).limit(1);
    const pending = pendingRows?.[0];
    if (pending) {
      if (/^cancel$/i.test(body)) {
        await supabase.from("whatsapp_pending_tasks").delete().eq("id", pending.id);
        await sendReply(from, "Cancelled — no task was created.");
        await logOutcome("pending_cancelled");
        continue;
      }
      const due = parseDueDate(body);
      if (!due) {
        await sendReply(from, `I couldn't read that as a date. Reply with something like: tomorrow, Friday, 5 Sep, or 05/09 — or reply "cancel".`);
        await logOutcome("pending_bad_date");
        continue;
      }
      const assignee = members.find((m) => m.id === pending.assignee_member_id);
      await supabase.from("whatsapp_pending_tasks").delete().eq("id", pending.id);
      if (!assignee) {
        await sendReply(from, "⚠ The assignee for the pending task no longer exists — please resend the task.");
        await logOutcome("pending_assignee_gone");
        continue;
      }
      const reply = await createTaskFromWhatsApp({ sender, assignee, description: pending.description, due });
      await sendReply(from, reply);
      await logOutcome(reply.startsWith("✓") ? "task_created" : "task_failed");
      continue;
    }

    // New task message. Accepted forms:
    //   @Ali Prepare June VAT return, due Friday
    //   task for Ali Nasir: chase HBL statement by 5 Sep
    //   help — shows usage
    if (/^(help|\?)$/i.test(body)) {
      await sendReply(from, `To create a task, send:\n@Name what needs doing, due Friday\n\nExamples:\n@Ali Prepare June VAT return, due tomorrow\ntask for Sania: chase HBL statement by 5 Sep\n\nDates: today, tomorrow, Mon–Sun, 5 Sep, 05/09. Reply "cancel" to abandon a pending task.`);
      await logOutcome("help");
      continue;
    }

    const m = body.match(/^(?:@|task\s+(?:for\s+)?)([\s\S]+)$/i);
    if (!m) {
      await sendReply(from, `To create a task, start with @Name or "task for Name". Send "help" for examples.`);
      await logOutcome("unrecognised");
      continue;
    }

    const { member: assignee, rest, ambiguous } = resolveAssignee(m[1], members);
    if (ambiguous) {
      const opts = ambiguous.map((x) => `@${fullName(x)}`).join(", ");
      await sendReply(from, `More than one person matches that name — resend using the full name: ${opts}`);
      await logOutcome("ambiguous_assignee");
      continue;
    }
    if (!assignee || !rest) {
      await sendReply(from, assignee && !rest
        ? "The task needs a description after the name — e.g. @" + fullName(assignee) + " prepare the June VAT return, due Friday"
        : "I couldn't find that person in the dashboard. Use their first name or full name as it appears in the app, e.g. @Ali Nasir …");
      await logOutcome("unresolved_assignee");
      continue;
    }

    const { description, due } = extractDue(rest);
    if (!description) {
      await sendReply(from, "The task needs a description — e.g. @" + fullName(assignee) + " prepare the June VAT return, due Friday");
      await logOutcome("empty_description");
      continue;
    }

    if (!due) {
      // Park the draft and ask — every task in the app requires a due date.
      await supabase.from("whatsapp_pending_tasks").upsert({
        sender_phone: from, sender_email: sender.email || "", sender_name: fullName(sender),
        assignee_name: fullName(assignee), assignee_email: assignee.email,
        assignee_member_id: assignee.id, description, created_at: new Date().toISOString(),
      }, { onConflict: "sender_phone" });
      await sendReply(from, `When is this due? Reply with a date (today, tomorrow, Friday, 5 Sep…) — or "cancel".\n\nTask for ${fullName(assignee)}: "${description}"`);
      await logOutcome("awaiting_due_date");
      continue;
    }

    const reply = await createTaskFromWhatsApp({ sender, assignee, description, due });
    await sendReply(from, reply);
    await logOutcome(reply.startsWith("✓") ? "task_created" : "task_failed");
  }

  // Always 200 — Meta retries anything else aggressively.
  return new Response("ok", { status: 200 });
}
