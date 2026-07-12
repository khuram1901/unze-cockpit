import { createServiceClient } from "../../lib/supabase-server";
import type { UserCtx, PermOverrides } from "../../lib/permissions";

// Shared by every Folderit API route that needs to check a fine-grained
// capability (e.g. canViewFolderitHr) rather than just the coarse
// isAdmin/member split most of these routes already do. Mirrors the
// UserCtx-building pattern used in app/api/investments/update-prices —
// there's no generic helper elsewhere in the codebase, each route builds
// its own; this one is just shared across the Folderit routes since
// several of them need it.
export async function loadFolderitUserCtx(
  db: ReturnType<typeof createServiceClient>,
  email: string
): Promise<UserCtx> {
  const { data: member } = await db
    .from("members")
    .select("id, role, department")
    .eq("email", email)
    .maybeSingle();

  let overrides: PermOverrides | null = null;
  if (member?.id) {
    const { data: perms } = await db
      .from("member_permissions")
      .select("*")
      .eq("member_id", member.id)
      .maybeSingle();
    overrides = (perms as PermOverrides) || null;
  }

  return {
    email,
    role: member?.role ?? null,
    department: member?.department ?? null,
    overrides,
  };
}
