import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  let body: { company_id?: string; task_date?: string; notes?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { company_id, task_date, notes } = body;
  if (!company_id || !task_date) {
    return NextResponse.json({ error: "company_id and task_date are required" }, { status: 400 });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(task_date)) {
    return NextResponse.json({ error: "task_date must be YYYY-MM-DD" }, { status: 400 });
  }

  // Prevent future date completion
  const todayPKT = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
  if (task_date > todayPKT) {
    return NextResponse.json({ error: "Cannot complete a future task" }, { status: 400 });
  }

  const sb = createServiceClient();
  const { data, error } = await sb.rpc("complete_preaudit_task", {
    p_email:      auth.email,
    p_company_id: company_id,
    p_task_date:  task_date,
    p_notes:      notes || null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data });
}
