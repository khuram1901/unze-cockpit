import { requireAuth } from "@/app/lib/api-auth";
import { createServiceClient } from "@/app/lib/supabase-server";
import { sendNotificationEmail } from "@/app/lib/send-email";
import { TRIGGER_CHAT_MESSAGE } from "@/app/lib/notification-types";
import webpush from "web-push";

if (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    "mailto:k.saleem@unzegroup.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// GET /api/chat/messages?conversation_id=...&before=<ISO>
// Returns the last 50 messages for the conversation (paginated via `before`).
// Also stamps last_read_at for the requesting user so unread counts reset.
export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversation_id");
  const before = url.searchParams.get("before"); // ISO timestamp for pagination

  if (!conversationId) {
    return Response.json({ error: "conversation_id required" }, { status: 400 });
  }

  const db = createServiceClient();

  // Verify the requesting user is a participant
  const { data: member } = await db
    .from("members")
    .select("id")
    .eq("email", auth.email)
    .single();

  if (!member) {
    return Response.json({ error: "Member not found" }, { status: 404 });
  }

  const { data: participation } = await db
    .from("chat_participants")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("member_id", member.id)
    .single();

  if (!participation) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch messages (most recent 50, newest last)
  let query = db
    .from("chat_messages")
    .select("id, conversation_id, sender_id, sender_name, sender_email, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (before) {
    query = query.lt("created_at", before);
  }

  const { data: messages, error } = await query;

  if (error) {
    console.error("[chat/messages GET]", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  const now = new Date().toISOString();

  // Stamp last_read_at so unread count resets for this user
  await db
    .from("chat_participants")
    .update({ last_read_at: now })
    .eq("conversation_id", conversationId)
    .eq("member_id", member.id);

  // Fetch other participants' last_read_at for read receipts (✓✓)
  const { data: otherParticipants } = await db
    .from("chat_participants")
    .select("last_read_at")
    .eq("conversation_id", conversationId)
    .neq("member_id", member.id);

  // The latest read timestamp among all other participants
  const othersLastReadAt = otherParticipants?.reduce<string | null>((latest, p) => {
    if (!latest) return p.last_read_at;
    return p.last_read_at > latest ? p.last_read_at : latest;
  }, null) ?? null;

  // Return in chronological order (oldest first for display)
  return Response.json({
    messages: (messages ?? []).reverse(),
    others_last_read_at: othersLastReadAt,
  });
}

// POST /api/chat/messages
// Body: { conversation_id: string, content: string }
export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  const { conversation_id, content } = body as {
    conversation_id: string;
    content: string;
  };

  if (!conversation_id || !content?.trim()) {
    return Response.json({ error: "conversation_id and content required" }, { status: 400 });
  }

  if (content.trim().length > 2000) {
    return Response.json({ error: "Message too long (max 2000 characters)" }, { status: 400 });
  }

  const db = createServiceClient();

  // Resolve member
  const { data: member } = await db
    .from("members")
    .select("id, name, first_name, last_name")
    .eq("email", auth.email)
    .single();

  if (!member) {
    return Response.json({ error: "Member not found" }, { status: 404 });
  }

  // Verify participation
  const { data: participation } = await db
    .from("chat_participants")
    .select("id")
    .eq("conversation_id", conversation_id)
    .eq("member_id", member.id)
    .single();

  if (!participation) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const senderName =
    `${member.first_name || ""} ${member.last_name || ""}`.trim() ||
    member.name ||
    auth.email;

  const { data: message, error } = await db
    .from("chat_messages")
    .insert({
      conversation_id,
      sender_id: member.id,
      sender_name: senderName,
      sender_email: auth.email,
      content: content.trim(),
    })
    .select("id, conversation_id, sender_id, sender_name, sender_email, content, created_at")
    .single();

  if (error || !message) {
    console.error("[chat/messages POST]", error);
    return Response.json({ error: "Failed to send message" }, { status: 500 });
  }

  // Fire-and-forget: push + email to other participants who haven't read recently
  notifyOtherParticipants(db, conversation_id, member.id, senderName, auth.email, content.trim()).catch(console.error);

  return Response.json(message, { status: 201 });
}

// ── Notification helper ───────────────────────────────────────────
// Runs after the message is saved. Sends a push notification and/or
// email to each participant who is NOT the sender.
// Email is skipped if they've read the conversation in the last 5 minutes
// (i.e. they're actively in the app and don't need an email).

async function notifyOtherParticipants(
  db: ReturnType<typeof createServiceClient>,
  conversationId: string,
  senderId: string,
  senderName: string,
  senderEmail: string,
  messageContent: string,
) {
  // Fetch all other participants with their email, push subscriptions, and last_read_at
  const { data: others } = await db
    .from("chat_participants")
    .select("member_id, last_read_at, members(email, name, first_name, last_name, notify_email)")
    .eq("conversation_id", conversationId)
    .neq("member_id", senderId);

  if (!others?.length) return;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://pulse.unze.co.uk";
  const preview = messageContent.length > 80 ? messageContent.slice(0, 80) + "…" : messageContent;
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  await Promise.allSettled(
    others.map(async (participant) => {
      const m = participant.members as unknown as {
        email: string;
        name: string | null;
        first_name: string | null;
        last_name: string | null;
        notify_email: boolean | null;
      } | null;
      if (!m?.email) return;

      const recipientEmail = m.email;
      const recipientName = `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || m.name || recipientEmail;
      const wasRecentlyActive = participant.last_read_at >= fiveMinutesAgo;

      // ── Push notification (always, if they have a subscription) ──
      const { data: subs } = await db
        .from("push_subscriptions")
        .select("subscription")
        .eq("user_email", recipientEmail);

      if (subs?.length && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        const payload = JSON.stringify({
          title: `New message from ${senderName}`,
          body: preview,
          url: appUrl,
        });
        for (const row of subs) {
          webpush.sendNotification(row.subscription, payload).catch(async (err: unknown) => {
            const code = (err as { statusCode?: number })?.statusCode;
            if (code === 410 || code === 404) {
              await db.from("push_subscriptions").delete()
                .eq("user_email", recipientEmail).eq("subscription", row.subscription);
            }
          });
        }
      }

      // ── Email (only if they haven't been active in the last 5 minutes) ──
      if (!wasRecentlyActive && m.notify_email !== false) {
        await sendNotificationEmail({
          to: recipientEmail,
          subject: `New message from ${senderName}`,
          heading: `${senderName} sent you a message`,
          body: `<p style="font-style:italic;color:#334155">"${preview}"</p><p style="margin-top:12px;color:#64748b;font-size:13px">Open the app to reply.</p>`,
          linkUrl: appUrl,
          linkLabel: "Open Dashboard",
          triggerType: TRIGGER_CHAT_MESSAGE,
          triggerRecordId: conversationId,
          recipientName,
        });
      }
    })
  );
}
