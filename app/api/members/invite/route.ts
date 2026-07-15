import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { sendNotificationEmail } from "../../../lib/send-email";
import { requireAuth } from "../../../lib/api-auth";
import { canAddMembers, assignableRoles, type UserCtx, type PermOverrides } from "../../../lib/permissions";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://unze-cockpit.vercel.app";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { email, firstName, lastName, role } = await request.json();

    if (!email) {
      return Response.json({ error: "Email required" }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Found during the 15 Jul 2026 full-app audit: this route only
    // checked "is someone logged in" — any authenticated member could
    // call it directly to create auth accounts and trigger "Welcome,
    // you are Admin" invite emails for arbitrary addresses/roles. The
    // real `members` row insert happens client-side and is now properly
    // role-checked at the database level (migration 121), but this
    // route's own side effects (creating the Supabase Auth account,
    // sending the invite email) need their own server-side gate too.
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
    if (role && !assignableRoles(actorCtx).includes(role)) {
      return Response.json({ error: `You don't have permission to assign the "${role}" role.` }, { status: 403 });
    }

    const displayName = `${firstName || ""} ${lastName || ""}`.trim() || email;

    // Create auth user with a temporary password and send invite
    const tempPassword = `UGD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: email.trim(),
      password: tempPassword,
      email_confirm: true,
    });

    if (authError) {
      // User might already exist in auth — that's OK
      if (!authError.message.includes("already been registered")) {
        console.error("Auth user creation error:", authError.message);
      }
    }

    // Generate a recovery link so user can set their own password
    const { data: resetData } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email: email.trim(),
      options: {
        redirectTo: `${APP_URL}/reset-password`,
      },
    });

    // Build proper verification URL through Supabase's auth endpoint
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    let setupLink = `${APP_URL}/forgot-password`;
    if (resetData?.properties?.hashed_token && supabaseUrl) {
      setupLink = `${supabaseUrl}/auth/v1/verify?token=${resetData.properties.hashed_token}&type=recovery&redirect_to=${encodeURIComponent(`${APP_URL}/reset-password`)}`;
    }

    // Send welcome email
    await sendNotificationEmail({
      to: email.trim(),
      subject: `Welcome to Unze Group Dashboard - Set Up Your Account`,
      heading: `Welcome ${displayName}`,
      body: `
        <p>You have been added to the <strong>Unze Group Dashboard</strong> as <strong>${role}</strong>.</p>
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

    return Response.json({ success: true, emailSent: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
