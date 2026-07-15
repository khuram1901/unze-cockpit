import { NextResponse } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const serviceClient = createServiceClient();

  const { data: member } = await serviceClient
    .from("members").select("id").eq("email", auth.email).maybeSingle();
  if (!member) return NextResponse.json({ overrides: null });

  const { data: perms } = await serviceClient
    .from("member_permissions").select("*").eq("member_id", member.id).maybeSingle();

  return NextResponse.json({ overrides: perms || null });
}
