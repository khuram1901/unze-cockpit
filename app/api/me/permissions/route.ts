import { NextResponse } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const serviceClient = createServiceClient();

  // Single query: join members → member_permissions in one round-trip
  // instead of two sequential queries (members first, then permissions).
  const { data: member } = await serviceClient
    .from("members")
    .select("id, member_permissions(*)")
    .eq("email", auth.email)
    .maybeSingle();

  if (!member) return NextResponse.json({ overrides: null });

  // member_permissions is an array from the embedded select; take first row.
  const perms = Array.isArray(member.member_permissions)
    ? (member.member_permissions[0] ?? null)
    : null;

  return NextResponse.json({ overrides: perms });
}
