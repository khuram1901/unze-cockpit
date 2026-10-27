import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";

// GET /api/tasks/comments-inbox
// Returns tasks with unread comments for the current user.
// Used by the CommentsInboxPanel to populate the slide-in drawer.
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const userEmail = auth.email;
  if (!userEmail) return NextResponse.json({ error: "No email on session" }, { status: 400 });

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("get_comments_inbox", {
    p_email: userEmail.toLowerCase(),
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data ?? [] });
}
