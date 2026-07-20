import { requireAuth } from "@/app/lib/api-auth";
import { createServiceClient } from "@/app/lib/supabase-server";

// GET /api/chat/conversations
// Returns all conversations for the authenticated user via the
// get_my_conversations RPC — one round-trip, fully assembled.
export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const db = createServiceClient();

  // Resolve member id from email
  const { data: member, error: memberErr } = await db
    .from("members")
    .select("id")
    .eq("email", auth.email)
    .single();

  if (memberErr || !member) {
    return Response.json({ error: "Member not found" }, { status: 404 });
  }

  const { data, error } = await db.rpc("get_my_conversations", {
    p_member_id: member.id,
  });

  if (error) {
    console.error("[chat/conversations GET]", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data ?? []);
}

// POST /api/chat/conversations
// Body (1-to-1): { participant_emails: [string] }
// Body (group):  { participant_emails: [string, ...], name: string, is_group: true }
//
// For 1-to-1 conversations the route first checks whether a direct
// conversation already exists (via find_direct_conversation RPC) and
// returns the existing one if so, rather than creating a duplicate.
export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json();
  const { participant_emails, name, is_group } = body as {
    participant_emails: string[];
    name?: string;
    is_group?: boolean;
  };

  if (!Array.isArray(participant_emails) || participant_emails.length === 0) {
    return Response.json({ error: "participant_emails required" }, { status: 400 });
  }

  if (is_group && !name?.trim()) {
    return Response.json({ error: "Group name required" }, { status: 400 });
  }

  const db = createServiceClient();

  // Resolve all participant member ids (including the creator)
  const allEmails = Array.from(new Set([auth.email, ...participant_emails]));
  const { data: members, error: membersErr } = await db
    .from("members")
    .select("id, email")
    .in("email", allEmails);

  if (membersErr || !members || members.length < 2) {
    return Response.json({ error: "Could not resolve all participants" }, { status: 400 });
  }

  const creatorRow = members.find((m) => m.email === auth.email);
  if (!creatorRow) {
    return Response.json({ error: "Creator not found in members" }, { status: 403 });
  }

  // For 1-to-1: check if a conversation already exists
  if (!is_group && members.length === 2) {
    const other = members.find((m) => m.email !== auth.email)!;
    const { data: existingId } = await db.rpc("find_direct_conversation", {
      p_member_id_1: creatorRow.id,
      p_member_id_2: other.id,
    });
    if (existingId) {
      return Response.json({ conversation_id: existingId, existing: true });
    }
  }

  // Create new conversation
  const { data: conv, error: convErr } = await db
    .from("chat_conversations")
    .insert({
      name: is_group ? name!.trim() : null,
      is_group: is_group ?? false,
      created_by: creatorRow.id,
    })
    .select("id")
    .single();

  if (convErr || !conv) {
    console.error("[chat/conversations POST] create conv", convErr);
    return Response.json({ error: "Failed to create conversation" }, { status: 500 });
  }

  // Add all participants
  const participantRows = members.map((m) => ({
    conversation_id: conv.id,
    member_id: m.id,
  }));

  const { error: partErr } = await db
    .from("chat_participants")
    .insert(participantRows);

  if (partErr) {
    console.error("[chat/conversations POST] add participants", partErr);
    // Roll back the conversation
    await db.from("chat_conversations").delete().eq("id", conv.id);
    return Response.json({ error: "Failed to add participants" }, { status: 500 });
  }

  return Response.json({ conversation_id: conv.id, existing: false }, { status: 201 });
}
