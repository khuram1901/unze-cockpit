// Server-side guarantee permissions — the single source of truth for the
// Bank Facilities API routes (guarantees, guarantee-facilities,
// guarantee-alerts).
//
// 17/10/2026: the three routes each had their own copy of a role+department
// check that ignored member_permissions.can_view_guarantees /
// can_manage_guarantees and the guarantees.financials widget. Result: the
// Access Matrix toggle showed the page in the sidebar (client-side
// permissions.ts honours overrides) but every API call returned 403
// (Shakeel, Abbasi). This mirrors canViewGuarantees / canManageGuarantees /
// canViewGuaranteeFinancials in app/lib/permissions.ts exactly — keep the
// two in sync.
import { createServiceClient } from "./supabase-server";
import { PA_EMAIL } from "./permissions";
import { isAdmin } from "./admin-config";

export type GuaranteePerms = {
  /** Can open the page and read the guarantee list (counts, names, dates). */
  canView: boolean;
  /** Can see PKR figures: amounts, cash margin, bank charges, facility limits. */
  canViewFinancials: boolean;
  /** Can add / edit / convert / release / delete guarantees and facilities. */
  canManage: boolean;
};

const NONE: GuaranteePerms = { canView: false, canViewFinancials: false, canManage: false };

export async function resolveGuaranteePerms(email: string): Promise<GuaranteePerms> {
  const db = createServiceClient();
  const lcEmail = email.toLowerCase();

  // Two-step lookup (not an embedded join) — see api-auth.ts getMemberAccess
  // for why the PostgREST embed silently fails in production.
  const { data: m, error: mErr } = await db
    .from("members")
    .select("id, role, department")
    .eq("email", email)
    .maybeSingle();
  if (mErr) console.error("resolveGuaranteePerms members lookup failed:", mErr.message);
  if (!m) return NONE;

  const role = m.role ?? null;
  const dept = m.department ?? null;

  // PA (Executive role) never sees financial pages — checked first, unconditionally.
  if (lcEmail === PA_EMAIL || role === "Executive") return NONE;

  const [{ data: perms, error: pErr }, { data: widget, error: wErr }] = await Promise.all([
    db.from("member_permissions")
      .select("can_view_guarantees, can_manage_guarantees")
      .eq("member_id", m.id)
      .maybeSingle(),
    db.from("member_widget_overrides")
      .select("visible")
      .eq("member_id", m.id)
      .eq("widget_key", "guarantees.financials")
      .maybeSingle(),
  ]);
  if (pErr) console.error("resolveGuaranteePerms perms lookup failed:", pErr.message);
  if (wErr) console.error("resolveGuaranteePerms widget lookup failed:", wErr.message);

  const isAdminTier = isAdmin(email) || role === "Admin" || role === "CEO";
  const isManagerTier = role === "Manager" || role === "Director";
  const isFinance = isManagerTier && dept === "Finance & Tax";
  const isOps = isManagerTier && dept === "Unze Trading Operations";

  const ovView = typeof perms?.can_view_guarantees === "boolean" ? perms.can_view_guarantees : null;
  const ovManage = typeof perms?.can_manage_guarantees === "boolean" ? perms.can_manage_guarantees : null;
  const ovFinancials = typeof widget?.visible === "boolean" ? widget.visible : null;

  const canView = ovView ?? (isAdminTier || isFinance || isOps);
  const canManage = ovManage ?? (isAdminTier || isFinance);
  // Role default for figures is Admin/CEO or Finance managers; the
  // guarantees.financials widget toggle overrides it per person
  // (Members → Access Control). Nobody sees figures without view access.
  const canViewFinancials = canView && (ovFinancials ?? (isAdminTier || isFinance));

  return { canView, canViewFinancials, canManage };
}
