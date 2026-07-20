import { requireAuth } from "@/app/lib/api-auth";
import { createServiceClient } from "@/app/lib/supabase-server";

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

  return Response.json(message, { status: 201 });
}
