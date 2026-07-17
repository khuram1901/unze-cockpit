import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { canViewFolderitHr } from "../../../lib/permissions";
import { loadFolderitUserCtx } from "../_shared";

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

  // Approvals are always personal — even the CEO/Admin only sees their own
  // outstanding approvals, never everyone else's. Company inbox stays
  // org-wide for Admin/CEO (it's a shared inbox, not assigned to a person),
  // scoped to just their own company for everyone else.
  const { data, error } = await db.rpc("get_folderit_summary", {
    p_user_email: email,
    p_company_uuid: isAdmin ? null : member?.company_id ?? null,
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const row = data?.[0] ?? { pending_approval_count: 0, company_inbox_count: 0, hr_inbox_count: 0 };

  // HR documents are locked behind can_view_folderit_hr — withhold even
  // the count for anyone without it, so the HR section is invisible end
  // to end, not just missing its file list.
  const ctx = await loadFolderitUserCtx(db, email);
  if (!canViewFolderitHr(ctx)) row.hr_inbox_count = 0;

  return Response.json(row);
}
