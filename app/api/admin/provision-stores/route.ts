/**
 * POST /api/admin/provision-stores
 *
 * TEMPORARY endpoint — delete after all 33 store accounts are provisioned.
 * Admin-only (k.saleem@unzegroup.com or kamran@unze.co.uk).
 *
 * Creates missing store accounts in Supabase Auth, plus store_users,
 * members and member_permissions rows. Idempotent — skips existing accounts.
 */
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../lib/api-auth";

const ADMIN_EMAILS = /k\.saleem@unzegroup\.com|kamran@unze\.co\.uk/i;

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  if (!ADMIN_EMAILS.test(auth.email ?? "")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const initialPassword = process.env.INITIAL_STORE_PASSWORD;
  if (!initialPassword) {
    return Response.json({ error: "INITIAL_STORE_PASSWORD not set in env" }, { status: 500 });
  }

  // Get all stores
  const { data: stores, error: storesErr } = await adminClient
    .from("stores")
    .select("id, email, name, fm_code")
    .order("fm_code");
  if (storesErr) return Response.json({ error: storesErr.message }, { status: 500 });

  // Get existing auth users (list all, up to 1000)
  const { data: authData, error: usersErr } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
  if (usersErr) return Response.json({ error: (usersErr as Error).message }, { status: 500 });

  const existingEmails = new Set(
    (authData.users ?? []).map((u) => (u.email ?? "").toLowerCase())
  );

  type Result = { email: string; status: string; error?: string };
  const results: Result[] = [];

  for (const store of stores ?? []) {
    const email = (store.email as string).toLowerCase();

    if (existingEmails.has(email)) {
      results.push({ email, status: "already_exists" });
      continue;
    }

    // 1. Create auth user (NEVER via SQL — must use admin.createUser)
    const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      email_confirm: true,
      password: initialPassword,
      app_metadata: { store_user: true, must_change_password: true },
    });

    if (createErr || !newUser?.user) {
      results.push({ email, status: "auth_error", error: (createErr as Error | null)?.message ?? "no user returned" });
      continue;
    }

    const userId = newUser.user.id;

    // 2. Create store_users row
    const { error: suErr } = await adminClient.from("store_users").upsert(
      { user_id: userId, store_id: store.id as string, is_primary: true },
      { onConflict: "user_id,store_id" }
    );
    if (suErr) {
      results.push({ email, status: "store_users_error", error: suErr.message });
      continue;
    }

    // 3. Create members row (upsert on email)
    const { data: member, error: memberErr } = await adminClient
      .from("members")
      .upsert(
        {
          email,
          name: "Store login: /daily-sales only",
          role: "Member",
          is_active: true,
          lifecycle_exempt: true,
        },
        { onConflict: "email" }
      )
      .select("id")
      .single();

    if (memberErr || !member) {
      results.push({ email, status: "member_error", error: memberErr?.message ?? "no member returned" });
      continue;
    }

    // 4. Create member_permissions row
    const { error: mpErr } = await adminClient
      .from("member_permissions")
      .upsert(
        { member_id: (member as { id: string }).id, can_access_daily_sales: true },
        { onConflict: "member_id" }
      );
    if (mpErr) {
      results.push({ email, status: "member_permissions_error", error: mpErr.message });
      continue;
    }

    results.push({ email, status: "created" });
  }

  const created  = results.filter((r) => r.status === "created").length;
  const skipped  = results.filter((r) => r.status === "already_exists").length;
  const errored  = results.filter((r) => r.status.includes("error"));

  return Response.json({
    summary: { total: results.length, created, already_existed: skipped, errors: errored.length },
    results,
  });
}
