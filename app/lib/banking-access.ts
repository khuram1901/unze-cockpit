// Server-side Banking access — the single source of truth for every
// /api/banking/* route and /api/admin/payments.
//
// 18/10/2026: seven routes each carried their own copy of this check, built
// from a hard-coded email list + the can_access_banking toggle. None of them
// looked at the member's ROLE, so an Admin/CEO by role who wasn't in the
// email lists would see Banking in the sidebar (client checks role) and get
// 403 from every API — the same bug class fixed on Bank Facilities on 17/10.
// Mirrors canAccessBanking() in app/lib/permissions.ts: PA never; explicit
// toggle wins; otherwise Admin/CEO tier.
import { createServiceClient } from "./supabase-server";
import { isAdmin } from "./admin-config";
import { PA_EMAIL } from "./permissions";

const RESTAURANT_COMPANIES = ["BRNH", "HD", "KKJ"];

type Access = { banking: boolean; adminOps: boolean; restaurantsPnl: boolean; role: string | null };

async function load(email: string): Promise<Access> {
  const db = createServiceClient();
  const { data: m, error: mErr } = await db.from("members").select("id, role").eq("email", email).maybeSingle();
  if (mErr) console.error("banking-access members lookup failed:", mErr.message);
  if (!m) return { banking: isAdmin(email), adminOps: false, restaurantsPnl: false, role: null };
  const { data: p, error: pErr } = await db
    .from("member_permissions")
    .select("can_access_banking, can_access_admin_ops, can_view_restaurants_pnl")
    .eq("member_id", m.id)
    .maybeSingle();
  if (pErr) console.error("banking-access perms lookup failed:", pErr.message);

  const isPA = email.toLowerCase() === PA_EMAIL || m.role === "Executive";
  const adminTier = isAdmin(email) || m.role === "Admin" || m.role === "CEO";
  const ov = typeof p?.can_access_banking === "boolean" ? p.can_access_banking : null;
  const banking = isPA ? false : (ov ?? adminTier);
  return {
    banking,
    adminOps: !isPA && (p?.can_access_admin_ops === true || adminTier),
    restaurantsPnl: !isPA && p?.can_view_restaurants_pnl === true,
    role: m.role ?? null,
  };
}

/** Full Banking access (upload, edit, delete cash sheets; record EOBI payments). */
export async function hasBankingAccess(email: string): Promise<boolean> {
  return (await load(email)).banking;
}

/** Read cash sheets for one company: banking users, or restaurants-P&L users for the restaurant companies. */
export async function hasCashSheetReadAccess(email: string, company?: string): Promise<boolean> {
  const a = await load(email);
  if (a.banking) return true;
  return !!company && a.restaurantsPnl && RESTAURANT_COMPANIES.includes(company);
}

/** EOBI / Social Security payment calendar: banking or Admin Operations users. */
export async function hasEobiAccess(email: string): Promise<boolean> {
  const a = await load(email);
  return a.banking || a.adminOps;
}
