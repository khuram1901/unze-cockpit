import { NextResponse } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const serviceClient = createServiceClient();

  // 09/09/2026: the embedded join (members → member_permissions(*)) was
  // silently failing in production — every user got overrides:null, so the
  // app fell back to role defaults (Waleed lost Banking, Sunaina lost Admin
  // Ops, etc.). Switched to the plain two-step lookup used by every other
  // route, and errors are now logged instead of swallowed.
  const { data: member, error: mErr } = await serviceClient
    .from("members")
    .select("id")
    .eq("email", auth.email)
    .maybeSingle();
  if (mErr) console.error("me/permissions members lookup failed:", mErr.message);
  if (!member) return NextResponse.json({ overrides: null });

  const { data: perms, error: pErr } = await serviceClient
    .from("member_permissions")
    .select("*")
    .eq("member_id", member.id)
    .maybeSingle();
  if (pErr) console.error("me/permissions perms lookup failed:", pErr.message);

  return NextResponse.json({ overrides: perms ?? null });
}
