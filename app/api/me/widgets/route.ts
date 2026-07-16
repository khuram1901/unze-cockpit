import { NextResponse } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";

// Mirrors /api/me/permissions — a member's own client can't read
// member_widget_overrides directly (RLS is admin-tier-only, same as
// member_permissions), so self-reads go through this service-role route
// instead, scoped to the authenticated caller's own member_id only.
export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();

  const { data: member } = await supabase
    .from("members").select("id").eq("email", auth.email).maybeSingle();
  if (!member) return NextResponse.json({ overrides: null });

  const { data: rows } = await supabase
    .from("member_widget_overrides").select("widget_key, visible").eq("member_id", member.id);

  const overrides: Record<string, boolean> = {};
  for (const r of rows || []) overrides[r.widget_key] = r.visible;

  return NextResponse.json({ overrides });
}
