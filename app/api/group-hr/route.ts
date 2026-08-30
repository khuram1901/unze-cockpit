/**
 * GET /api/group-hr?company=&department=
 * ─────────────────────────────────────────────────────────────────
 * The CEO-level Group HR dashboard — one RPC round-trip (migration 234).
 * Access: Admin/CEO by default; others via the Access Matrix toggle
 * member_permissions.can_view_group_hr. PA never (rule 6 — payroll
 * figures are financial data).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../lib/api-auth";
import { createServiceClient } from "../../lib/supabase-server";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const db = createServiceClient();
  const { searchParams } = new URL(request.url);

  try {
    const { data: member } = await db
      .from("members")
      .select("id, role, department")
      .eq("email", auth.email)
      .maybeSingle();
    const role = member?.role ?? "";

    // PA blocked unconditionally (rule 6), before any override.
    if (role === "Executive") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    let allowed = role === "Admin" || role === "CEO";
    if (!allowed && member?.id) {
      const { data: perms } = await db
        .from("member_permissions")
        .select("can_view_group_hr")
        .eq("member_id", member.id)
        .maybeSingle();
      allowed = perms?.can_view_group_hr === true;
    }
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const uuidOrNull = (k: string) => {
      const v = (searchParams.get(k) ?? "").trim();
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
    };

    const { data, error } = await db.rpc("get_group_hr_dashboard", {
      p_company: uuidOrNull("company"),
      p_department: uuidOrNull("department"),
    });
    if (error) throw new Error(error.message);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
