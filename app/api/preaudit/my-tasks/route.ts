import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const monthParam = searchParams.get("month");
  const month = monthParam || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" }).slice(0, 7) + "-01";

  const sb = createServiceClient();
  const { data, error } = await sb.rpc("get_preaudit_my_tasks", {
    p_email: auth.email,
    p_month: month,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data });
}
