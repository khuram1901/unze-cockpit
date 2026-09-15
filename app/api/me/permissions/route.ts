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

  // If this member is scoped to another person, resolve their email so
  // client code can filter tasks/minutes without an extra round-trip.
  let enriched: Record<string, unknown> | null = perms ?? null;
  if (perms?.scoped_to_member_id) {
    const { data: scopedMember } = await serviceClient
      .from("members")
      .select("email, name")
      .eq("id", perms.scoped_to_member_id)
      .maybeSingle();
    if (scopedMember) {
      enriched = { ...perms, scoped_to_member_email: scopedMember.email, scoped_to_member_name: scopedMember.name };
    }
  }

  return NextResponse.json({ overrides: enriched });
}
