import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { sendNotificationEmail } from "../../../lib/send-email";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://unze-cockpit.vercel.app";

export async function POST(request: NextRequest) {
  try {
    const { email, firstName, lastName, role } = await request.json();

    if (!email) {
      return Response.json({ error: "Email required" }, { status: 400 });
    }

    const supabase = createServiceClient();
    const displayName = `${firstName || ""} ${lastName || ""}`.trim() || email;

    // Create auth user with a temporary password and send invite
    const tempPassword = `Cockpit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
      subject: `Welcome to Unze Group Cockpit - Set Up Your Account`,
      heading: `Welcome ${displayName}`,
      body: `
        <p>You have been added to the <strong>Unze Group Cockpit</strong> as <strong>${role}</strong>.</p>
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
