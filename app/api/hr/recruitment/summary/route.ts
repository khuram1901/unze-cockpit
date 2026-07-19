import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../../../lib/api-auth";
import { createServiceClient } from "../../../../lib/supabase-server";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const db = createServiceClient();
  const { data, error } = await db.rpc("get_recruitment_summary");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ summary: data });
}
