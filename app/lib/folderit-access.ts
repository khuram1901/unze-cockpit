/**
 * Shared server-side Folderit visibility resolver.
 *
 * ONE rule for every Folderit API route — who can see which cabinets:
 *
 *   1. Admin / CEO   → all active cabinets (accountUids = null)
 *   2. Everyone else → EXACTLY what's ticked in the Members Access Matrix
 *                      (Folderit section). HR tick → HR cabinet; company
 *                      tick → that company's cabinet(s). Multiple ticks →
 *                      all of them. NO ticks → no access at all.
 *
 * There is deliberately no automatic own-company access. Khuram
 * (22/07/2026): "i have removed folder it with many users but they can
 * still see folder it on the side bar and access it" — unticking every
 * Folderit box in the matrix must remove the page completely. The matrix
 * is the single source of truth; the HR manager with only the HR tick
 * sees only HR, Sania with only the UTPL tick sees only UTPL.
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

  // ── Rule 2: matrix ticks only — union of everything ticked ────────────
  const visibleUids = new Set<string>();

  // HR tick → HR cabinet(s)
  const hasHrGrant = perms?.["can_view_folderit_hr"] === true;
  if (hasHrGrant) {
    const { data: hrAccounts } = await db
      .from("folderit_hr_categories")
      .select("account_uid");
    ((hrAccounts ?? []) as { account_uid: string }[]).forEach((r) => visibleUids.add(r.account_uid));
  }

  // Company ticks → those companies' cabinets
  const grantedShortCodes = new Set<string>();
  for (const [key, codes] of FOLDERIT_PERM_TO_SHORTCODES) {
    if (perms?.[key] === true) codes.forEach((c) => grantedShortCodes.add(c));
  }

  if (grantedShortCodes.size) {
    const { data: cos } = await db
      .from("companies")
      .select("id, short_code")
      .in("short_code", [...grantedShortCodes]);
    const companyIds = ((cos ?? []) as { id: string }[]).map((c) => c.id);
    if (companyIds.length) {
      const { data: links } = await db
        .from("folderit_account_companies")
        .select("account_uid")
        .in("company_uuid", companyIds);
      ((links ?? []) as { account_uid: string }[]).forEach((r) => visibleUids.add(r.account_uid));
    }
  }

  return {
    isAdmin: false,
    hrOnly: hasHrGrant && grantedShortCodes.size === 0,
    role,
    accountUids: [...visibleUids],
  };
}
