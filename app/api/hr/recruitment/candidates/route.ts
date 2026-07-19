import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../../../lib/api-auth";
import { createServiceClient } from "../../../../lib/supabase-server";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const positionId = new URL(request.url).searchParams.get("position_id");
  if (!positionId) return NextResponse.json({ error: "position_id required" }, { status: 400 });

  const db = createServiceClient();
  const { data, error } = await db.rpc("get_position_candidates", { p_position_id: positionId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ candidates: data ?? [] });
}
