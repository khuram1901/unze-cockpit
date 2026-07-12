import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const email = (auth as { email: string }).email.toLowerCase();

  const db = createServiceClient();
  const { data: member } = await db
    .from("members")
    .select("role, company_id")
    .eq("email", email)
    .maybeSingle();

  const isAdmin =
    email === "khuram1901@gmail.com" ||
    member?.role === "Admin" ||
    member?.role === "CEO";

  // Admin/CEO see everything (both params null); everyone else is scoped
  // to their own approvals + their own company's inbox.
  const { data, error } = await db.rpc("get_folderit_summary", {
    p_user_email: isAdmin ? null : email,
    p_company_uuid: isAdmin ? null : member?.company_id ?? null,
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const row = data?.[0] ?? { pending_approval_count: 0, company_inbox_count: 0, hr_inbox_count: 0 };
  return Response.json(row);
}
