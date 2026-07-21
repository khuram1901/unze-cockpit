/**
 * Shared server-side Folderit visibility resolver.
 *
 * ONE rule for every Folderit API route — who can see which cabinets:
 *
 *   1. Admin / CEO             → all active cabinets (accountUids = null)
 *   2. HR grant                → ONLY the HR cabinet(s). No company cabinets
 *                                at all, even their own. Khuram: "if the HR
 *                                manager is given access to Folderit, he
 *                                should only see the HR part of the company."
 *   3. Everyone else           → own company's cabinet(s) + any extra
 *                                companies ticked in the Members Access
 *                                Matrix (Folderit section). Multi-company
 *                                users see all their companies.
 *
 * Khuram (22/07/2026): "you need to map their companies and only show it
 * according to their company. If one person has more than one company, he
 * or she gets to see both of the companies."
 */

// Matrix permission key → DB company short codes it unlocks.
// RST is one grant covering both restaurant companies (Baranh + Haute
// Dolci share a single Folderit cabinet).
const FOLDERIT_PERM_TO_SHORTCODES: [string, string[]][] = [
  ["folderit_can_view_utpl", ["UTPL"]],
  ["folderit_can_view_ifpl", ["IFPL"]],
  ["folderit_can_view_rst",  ["BRNH", "HD"]],
  ["folderit_can_view_smi",  ["SMI"]],
  ["folderit_can_view_uzl",  ["UZL"]],
  ["folderit_can_view_dir",  ["DIR"]],
];

export type FolderitAccess = {
  isAdmin: boolean;
  /** True when the user's access is the HR cabinet only */
  hrOnly: boolean;
  role: string | null;
  /** null = all accounts (admin). Empty array = sees nothing. */
  accountUids: string[] | null;
};

// db is the Supabase service client — typed loosely so this helper doesn't
// need the generated database types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveFolderitAccess(db: any, email: string): Promise<FolderitAccess> {
  const { data: member } = await db
    .from("members")
    .select("id, role, company_id")
    .eq("email", email)
    .maybeSingle();

  const role: string | null = member?.role ?? null;

  const isAdmin =
    email === "khuram1901@gmail.com" ||
    role === "Admin" ||
    role === "CEO";

  if (isAdmin) return { isAdmin: true, hrOnly: false, role, accountUids: null };

  // Load the member's Access Matrix overrides
  let perms: Record<string, unknown> | null = null;
  if (member?.id) {
    const { data } = await db
      .from("member_permissions")
      .select("*")
      .eq("member_id", member.id)
      .maybeSingle();
    perms = data ?? null;
  }

  // ── Rule 2: HR grant → HR cabinet(s) only ─────────────────────────────
  if (perms?.["can_view_folderit_hr"] === true) {
    const { data: hrAccounts } = await db
      .from("folderit_hr_categories")
      .select("account_uid");
    const uids = [...new Set(((hrAccounts ?? []) as { account_uid: string }[]).map((r) => r.account_uid))];
    return { isAdmin: false, hrOnly: true, role, accountUids: uids };
  }

  // ── Rule 3: own company + Matrix company grants ───────────────────────
  const grantedShortCodes = new Set<string>();
  for (const [key, codes] of FOLDERIT_PERM_TO_SHORTCODES) {
    if (perms?.[key] === true) codes.forEach((c) => grantedShortCodes.add(c));
  }

  const companyIds = new Set<string>();
  if (member?.company_id) companyIds.add(member.company_id);

  if (grantedShortCodes.size) {
    const { data: cos } = await db
      .from("companies")
      .select("id, short_code")
      .in("short_code", [...grantedShortCodes]);
    ((cos ?? []) as { id: string }[]).forEach((c) => companyIds.add(c.id));
  }

  if (!companyIds.size) return { isAdmin: false, hrOnly: false, role, accountUids: [] };

  const { data: links } = await db
    .from("folderit_account_companies")
    .select("account_uid")
    .in("company_uuid", [...companyIds]);

  const uids = [...new Set(((links ?? []) as { account_uid: string }[]).map((r) => r.account_uid))];
  return { isAdmin: false, hrOnly: false, role, accountUids: uids };
}
