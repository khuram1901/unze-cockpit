/**
 * GET /api/members/bulk-invite?confirm=yes
 * ─────────────────────────────────────────────────────────────────
 * Admin bulk onboarding (09/09/2026, built for the 45-member Excel
 * import). For every ACTIVE member without a Supabase Auth account:
 * creates the auth user, generates a password-recovery link, and
 * sends the same "Set Your Password" welcome email as the single
 * /api/members/invite route. Idempotent — members who already have
 * an auth account are skipped, so it is safe to run again for
 * future batches.
 *
 * GET so Khuram can trigger it from the browser while logged in.
 * Gated by canAddMembers (same as single invite). Without
 * ?confirm=yes it only reports who WOULD be invited (dry run).
 */

import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { sendNotificationEmail } from "../../../lib/send-email";
import { requireAuth } from "../../../lib/api-auth";
import { canAddMembers, type UserCtx, type PermOverrides } from "../../../lib/permissions";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://unze-cockpit.vercel.app";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();

  // Same server-side gate as /api/members/invite
  const { data: actorMember } = await supabase
    .from("members").select("id, role, department, company").eq("email", auth.email).maybeSingle();
  let actorOverrides: PermOverrides | null = null;
  if (actorMember) {
    const { data: perms } = await supabase
      .from("member_permissions").select("*").eq("member_id", actorMember.id).maybeSingle();
    actorOverrides = (perms as PermOverrides) || null;
  }
  const actorCtx: UserCtx = {
    email: auth.email,
    role: actorMember?.role ?? null,
    department: actorMember?.department ?? null,
    company: actorMember?.company ?? null,
    overrides: actorOverrides,
  };
  if (!canAddMembers(actorCtx)) {
    return Response.json({ error: "You don't have permission to add members." }, { status: 403 });
  }

  const confirm = new URL(request.url).searchParams.get("confirm") === "yes";

  // Active members
  const { data: members, error: mErr } = await supabase
    .from("members")
    .select("id, name, first_name, last_name, email, role")
    .eq("is_active", true);
  if (mErr) return Response.json({ error: mErr.message }, { status: 500 });

  // Existing auth accounts (paged; plenty for current scale)
  const existing = new Set<string>();
  for (let page = 1; page <= 10; page++) {
    const { data: list } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    for (const u of list?.users ?? []) if (u.email) existing.add(u.email.toLowerCase());
    if (!list || list.users.length < 200) break;
  }

  const pending = (members ?? []).filter(m => m.email && !existing.has(m.email.toLowerCase()));

  if (!confirm) {
    return Response.json({
      dryRun: true,
      wouldInvite: pending.map(m => ({ name: m.name, email: m.email })),
      count: pending.length,
      hint: "Add ?confirm=yes to create accounts and send the password emails.",
    });
  }

  const results: { email: string; status: string }[] = [];
  for (const m of pending) {
    try {
      const tempPassword = `UGD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { error: authError } = await supabase.auth.admin.createUser({
        email: m.email.trim(),
        password: tempPassword,
        email_confirm: true,
      });
      if (authError && !authError.message.includes("already been registered")) {
        results.push({ email: m.email, status: `auth error: ${authError.message}` });
        continue;
      }

      const { data: resetData } = await supabase.auth.admin.generateLink({
        type: "recovery",
        email: m.email.trim(),
        options: { redirectTo: `${APP_URL}/reset-password` },
      });
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      let setupLink = `${APP_URL}/forgot-password`;
      if (resetData?.properties?.hashed_token && supabaseUrl) {
        setupLink = `${supabaseUrl}/auth/v1/verify?token=${resetData.properties.hashed_token}&type=recovery&redirect_to=${encodeURIComponent(`${APP_URL}/reset-password`)}`;
      }

      const displayName = `${m.first_name || ""} ${m.last_name || ""}`.trim() || m.name || m.email;
      await sendNotificationEmail({
        to: m.email.trim(),
        subject: `Welcome to Unze Group Dashboard - Set Up Your Account`,
        heading: `Welcome ${displayName}`,
        body: `
          <p>You have been added to the <strong>Unze Group Dashboard</strong> as <strong>${m.role}</strong>.</p>
          <p>Please click the button below to set your password and log in for the first time.</p>
          <p style="background:#f1f5f9;padding:12px;border-radius:6px;border-left:3px solid #2563eb;font-size:14px">
            If the button doesn't work, go to <strong>${APP_URL}/forgot-password</strong> and enter your email to receive a password reset link.
          </p>
        `,
        linkUrl: setupLink,
        linkLabel: "Set Your Password",
        triggerType: "welcome_invite",
        recipientName: displayName,
      });
      results.push({ email: m.email, status: "invited" });
    } catch (e) {
      results.push({ email: m.email, status: `error: ${e instanceof Error ? e.message : "unknown"}` });
    }
  }

  return Response.json({
    invited: results.filter(r => r.status === "invited").length,
    failed: results.filter(r => r.status !== "invited"),
    results,
  });
}
