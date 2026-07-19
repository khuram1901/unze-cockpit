import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";
import { flowhcm } from "../../../../lib/flowhcm-client";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const db = createServiceClient();

  const [workforce, attendance, leave, syncLog] = await Promise.all([
    db.rpc("get_flw_workforce_summary"),
    db.rpc("get_flw_attendance_today"),
    db.rpc("get_flw_on_leave_today"),
    db.rpc("get_flw_sync_status"),
  ]);

  return NextResponse.json({
    configured: flowhcm.isConfigured(),
    workforce:  workforce.data,
    attendance: attendance.data,
    leave:      leave.data,
    sync_log:   syncLog.data,
  });
}
