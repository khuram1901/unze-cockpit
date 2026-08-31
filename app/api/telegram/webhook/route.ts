import { NextRequest } from "next/server";
import crypto from "crypto";
import { createServiceClient } from "../../../lib/supabase-server";
import { createTaskCore } from "../../../lib/task-creation";

// Telegram → tasks. Staff DM the company Telegram bot with:
//   @Ali Prepare the June VAT return, due Friday
//   task for Sundas: chase HBL statement by 5 Sep
//
// Mapping: sender's Telegram chat_id must be stored against a member with
// tg_can_issue_tasks enabled (managed at /settings/telegram). If no due
// date is given, the bot replies asking for one and holds the draft.
//
// Setup (see TELEGRAM_SETUP.md):
//   TELEGRAM_BOT_TOKEN  — token from @BotFather
//   TELEGRAM_WEBHOOK_SECRET — any random string; set when calling setWebhook

export const maxDuration = 30;

// ── Telegram Bot API helper ───────────────────────────────────────────────────

async function sendMessage(chatId: number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096) }),
    });
  } catch (e) {
    console.error("[telegram] sendMessage failed:", e);
  }
}

// ── Date parsing (identical to WhatsApp webhook) ──────────────────────────────

function pktToday(): Date {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseDueDate(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/^(due|by|on|next)\s+/g, "").trim();
  const today = pktToday();
  if (!s) return null;
  if (s === "today" || s === "eod") return iso(today);
  if (s === "tomorrow" || s === "tmrw") {
    const d = new Date(today); d.setUTCDate(d.getUTCDate() + 1); return iso(d);
  }
  if (s.length >= 3 && /^[a-z]+$/.test(s)) {
    const target = DAY_NAMES.findIndex((d) => d === s || d.slice(0, 3) === s || d.startsWith(s));
    if (target >= 0) {
      const d = new Date(today);
      let add = (target - d.getUTCDay() + 7) % 7;
      if (add === 0) add = 7;
      d.setUTCDate(d.getUTCDate() + add);
      return iso(d);
    }
  }
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if (m) {
    const dd = +m[1], mm = +m[2];
    let yy = m[3] ? +m[3] : today.getUTCFullYear();
    if (yy < 100) yy += 2000;
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      const d = new Date(Date.UTC(yy, mm - 1, dd));
      if (d.getTime() >= today.getTime() - 86400000) return iso(d);
    }
  }
  m = s.match(/^(\d{1,2})\s+([a-z]{3,9})(?:\s+(\d{4}))?$/) ||
      s.match(/^([a-z]{3,9})\s+(\d{1,2})(?:\s+(\d{4}))?$/);
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

function extractDue(text: string): { description: string; due: string | null } {
  const m = text.match(/[,;\s]\b(?:due|by)\s+([a-z0-9\s\/\-]{2,30})\s*$/i);
  if (m) {
    const due = parseDueDate(m[1]);
    if (due) return { description: text.slice(0, m.index).replace(/[,;\s]+$/, "").trim(), due };
  }
  return { description: text.trim(), due: null };
}

// ── Member helpers ────────────────────────────────────────────────────────────

type MemberRow = {
  id: string; email: string | null; first_name: string | null; last_name: string | null;
  name: string | null; department: string | null; company_id: string | null;
  telegram_chat_id: number | null; tg_can_issue_tasks: boolean | null;
};

const fullName = (m: MemberRow) =>
  (`${m.first_name || ""} ${m.last_name || ""}`.trim() || m.name || m.email || "Unknown");

function resolveAssignee(text: string, members: MemberRow[]): {
  member?: MemberRow; rest?: string; ambiguous?: MemberRow[];
} {
  const words = text.trim().split(/\s+/);
  for (let take = Math.min(3, words.length); take >= 1; take--) {
    const candidate = words.slice(0, take).join(" ").toLowerCase().replace(/[:,]+$/, "");
    if (!candidate) continue;
    const matches = members.filter((m) => {
      const fn = (m.first_name || "").toLowerCase();
      const full = fullName(m).toLowerCase();
      return full === candidate || fn === candidate || full.startsWith(candidate + " ");
    });
    if (matches.length === 1) {
      const rest = words.slice(take).join(" ").replace(/^[:\-–,]\s*/, "").trim();
      return { member: matches[0], rest };
    }
    if (matches.length > 1 && take === 1) return { ambiguous: matches };
  }
  return {};
}

async function createTaskFromTelegram(opts: {
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
    sourceType: "telegram",
    sourceLabel: "Telegram",
    notificationStyle: "task_assigned",
    actor: { kind: "user", name: fullName(sender), email: sender.email || "" },
  });
  if (!result.ok) return `⚠ Could not create the task: ${result.error}`;
  const dueLabel = new Date(due + "T00:00:00Z").toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
  });
  return `✓ Task created for ${fullName(assignee)}, due ${dueLabel}:\n"${description}"`;
}

// ── Webhook (Telegram POSTs updates here) ────────────────────────────────────

export async function POST(request: NextRequest) {
  // Verify the request is from Telegram using the secret token we set at
  // webhook registration time. If TELEGRAM_WEBHOOK_SECRET is set, the header
  // must match. This prevents arbitrary POSTs from creating tasks.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const header = request.headers.get("x-telegram-bot-api-secret-token") || "";
    const a = Buffer.from(header), b = Buffer.from(secret);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  let payload: unknown;
  try { payload = JSON.parse(await request.text()); } catch {
    return new Response("ok", { status: 200 });
  }

  // Telegram update shape we care about: message or edited_message with text.
  type TgFrom = { id?: number; first_name?: string; username?: string };
  type TgChat = { id?: number; type?: string };
  type TgMsg  = { message_id?: number; from?: TgFrom; chat?: TgChat; text?: string };
  type TgUpdate = { update_id?: number; message?: TgMsg; edited_message?: TgMsg };

  const update = payload as TgUpdate;
  const updateId = update.update_id;
  const msg: TgMsg | undefined = update.message; // ignore edited_message — no task re-issuing
  if (!updateId || !msg?.text || !msg.chat?.id) {
    return new Response("ok", { status: 200 });
  }

  const chatId  = msg.chat.id;
  const body    = msg.text.trim();
  const supabase = createServiceClient();

  // Dedupe by update_id — Telegram retries if we don't respond quickly.
  const { error: dupErr } = await supabase.from("telegram_inbound_log").insert({
    tg_update_id: updateId, from_chat_id: chatId, body: body.slice(0, 2000), outcome: "received",
  });
  if (dupErr) return new Response("ok", { status: 200 }); // already processed

  const logOutcome = (outcome: string) =>
    supabase.from("telegram_inbound_log").update({ outcome }).eq("tg_update_id", updateId);

  // Load all members (small table; Telegram chats are private 1-1 with the bot).
  const { data: allMembers } = await supabase
    .from("members")
    .select("id, email, first_name, last_name, name, department, company_id, telegram_chat_id, tg_can_issue_tasks");
  const members = (allMembers || []) as MemberRow[];

  // /link or /start — tell the user their Telegram ID so the admin can map it.
  if (/^\/(?:start|link)(?:@\S+)?$/i.test(body)) {
    const alreadyMapped = members.find((m) => m.telegram_chat_id === chatId);
    if (alreadyMapped) {
      await sendMessage(chatId, `✓ You're already linked as ${fullName(alreadyMapped)}. Send @Name to issue a task, or "help" for usage.`);
    } else {
      await sendMessage(chatId, `Your Telegram ID is: ${chatId}\n\nSend this number to your admin — they'll paste it into Settings → Telegram to link your account.`);
    }
    await logOutcome("link_request");
    return new Response("ok", { status: 200 });
  }

  // Identify sender by telegram_chat_id.
  const sender = members.find((m) => m.telegram_chat_id === chatId);
  if (!sender) {
    await sendMessage(chatId,
      `Your Telegram account isn't linked to the dashboard yet.\n\nSend /link to get your ID, then ask an admin to add it at Settings → Telegram.`);
    await logOutcome("unmapped_sender");
    return new Response("ok", { status: 200 });
  }
  if (!sender.tg_can_issue_tasks) {
    await sendMessage(chatId,
      `Hi ${fullName(sender).split(" ")[0]} — your account is linked, but you don't have permission to issue tasks via Telegram. Ask an admin to enable it at Settings → Telegram.`);
    await logOutcome("not_permitted");
    return new Response("ok", { status: 200 });
  }

  // Check for a pending "when is it due?" draft from a previous message.
  const { data: pendingRows } = await supabase
    .from("telegram_pending_tasks").select("*").eq("sender_chat_id", chatId).limit(1);
  const pending = pendingRows?.[0];
  if (pending) {
    if (/^cancel$/i.test(body)) {
      await supabase.from("telegram_pending_tasks").delete().eq("id", pending.id);
      await sendMessage(chatId, "Cancelled — no task was created.");
      await logOutcome("pending_cancelled");
      return new Response("ok", { status: 200 });
    }
    const due = parseDueDate(body);
    if (!due) {
      await sendMessage(chatId,
        `I couldn't read that as a date. Reply with something like: tomorrow, Friday, 5 Sep, or 05/09 — or send "cancel".`);
      await logOutcome("pending_bad_date");
      return new Response("ok", { status: 200 });
    }
    const assignee = members.find((m) => m.id === pending.assignee_member_id);
    await supabase.from("telegram_pending_tasks").delete().eq("id", pending.id);
    if (!assignee) {
      await sendMessage(chatId, "⚠ The assignee for the pending task no longer exists — please resend the task.");
      await logOutcome("pending_assignee_gone");
      return new Response("ok", { status: 200 });
    }
    const reply = await createTaskFromTelegram({ sender, assignee, description: pending.description, due });
    await sendMessage(chatId, reply);
    await logOutcome(reply.startsWith("✓") ? "task_created" : "task_failed");
    return new Response("ok", { status: 200 });
  }

  // Help command.
  if (/^(help|\?)$/i.test(body)) {
    await sendMessage(chatId,
      `To create a task, send:\n@Name what needs doing, due Friday\n\nExamples:\n@Ali Prepare June VAT return, due tomorrow\ntask for Sundas: chase HBL statement by 5 Sep\n\nDates: today, tomorrow, Mon–Sun, 5 Sep, 05/09\n\nSend "cancel" to abandon a pending task.`);
    await logOutcome("help");
    return new Response("ok", { status: 200 });
  }

  // New task message — must start with @Name or "task for Name".
  const m = body.match(/^(?:@|task\s+(?:for\s+)?)([\s\S]+)$/i);
  if (!m) {
    await sendMessage(chatId,
      `To create a task, start with @Name or "task for Name". Send "help" for examples.`);
    await logOutcome("unrecognised");
    return new Response("ok", { status: 200 });
  }

  const { member: assignee, rest, ambiguous } = resolveAssignee(m[1], members);
  if (ambiguous) {
    const opts = ambiguous.map((x) => `@${fullName(x)}`).join(", ");
    await sendMessage(chatId,
      `More than one person matches that name — resend using the full name: ${opts}`);
    await logOutcome("ambiguous_assignee");
    return new Response("ok", { status: 200 });
  }
  if (!assignee || !rest) {
    await sendMessage(chatId, assignee && !rest
      ? `The task needs a description after the name — e.g. @${fullName(assignee)} prepare the June VAT return, due Friday`
      : `I couldn't find that person in the dashboard. Use their first name or full name as it appears in the app, e.g. @Ali Nasir …`);
    await logOutcome("unresolved_assignee");
    return new Response("ok", { status: 200 });
  }

  const { description, due } = extractDue(rest);
  if (!description) {
    await sendMessage(chatId,
      `The task needs a description — e.g. @${fullName(assignee)} prepare the June VAT return, due Friday`);
    await logOutcome("empty_description");
    return new Response("ok", { status: 200 });
  }

  if (!due) {
    // Park the draft and ask for the due date.
    await supabase.from("telegram_pending_tasks").upsert({
      sender_chat_id: chatId,
      sender_email: sender.email || "",
      sender_name: fullName(sender),
      assignee_name: fullName(assignee),
      assignee_email: assignee.email,
      assignee_member_id: assignee.id,
      description,
      created_at: new Date().toISOString(),
    }, { onConflict: "sender_chat_id" });
    await sendMessage(chatId,
      `When is this due? Reply with a date (today, tomorrow, Friday, 5 Sep…) — or "cancel".\n\nTask for ${fullName(assignee)}: "${description}"`);
    await logOutcome("awaiting_due_date");
    return new Response("ok", { status: 200 });
  }

  const reply = await createTaskFromTelegram({ sender, assignee, description, due });
  await sendMessage(chatId, reply);
  await logOutcome(reply.startsWith("✓") ? "task_created" : "task_failed");
  return new Response("ok", { status: 200 });
}
