import { NextRequest } from "next/server";
import { createServiceClient } from "../../lib/supabase-server";
import { requireAuth } from "../../lib/api-auth";

const todayStr = () => new Date().toISOString().slice(0, 10);

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();

  const [memberRes, overdueRes, machineRes] = await Promise.all([
    supabase.from("members").select("first_name, name").eq("email", auth.email).maybeSingle(),
    supabase.from("tasks")
      .select("id", { count: "exact", head: true })
      .not("status", "in", "(Completed,Cancelled)")
      .lt("due_date", todayStr()),
    supabase.from("machine_issues")
      .select("id", { count: "exact", head: true })
      .neq("issue_status", "Resolved"),
  ]);

  const member = memberRes.data;
  const firstName = member?.first_name || member?.name?.split(" ")[0] || auth.email.split("@")[0];

  return Response.json({
    firstName,
    overdueTaskCount: overdueRes.count ?? 0,
    machineIssueCount: machineRes.count ?? 0,
  });
}
