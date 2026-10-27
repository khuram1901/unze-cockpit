import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";
import { myIdentityEmails } from "../../../lib/permissions";

// GET /api/tasks/comments-inbox
// Returns tasks with unread comments for the current user.
// Uses all identity emails so dual-identity users (e.g. CEO with two emails)
// see tasks assigned under either email and the bell badge stays in sync.
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const userEmail = auth.email;
  if (!userEmail) return NextResponse.json({ error: "No email on session" }, { status: 400 });

  const emails = myIdentityEmails(userEmail).map(e => e.toLowerCase());

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("get_comments_inbox", {
    p_emails: emails,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data ?? [] });
}
