// PUBLIC ROUTE — intentionally unauthenticated.
// This is the forgot-password endpoint: the caller has no session by
// definition (they can't log in). Identity is not verified here; a
// one-time recovery link is emailed to the address on record. Rate
// limiting (3 per 10 min per IP) is the primary abuse control.
// Do NOT add requireAuth() — it would break the password-reset flow.

import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { sendNotificationEmail } from "../../../lib/send-email";
import { rateLimitByIP, rateLimitResponse } from "../../../lib/rate-limit";

// Production domain is pulse.unze.co.uk — must match NEXT_PUBLIC_APP_URL in Vercel env vars
// and the allowed redirect URLs in Supabase Auth → URL Configuration.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://pulse.unze.co.uk";

export async function POST(request: NextRequest) {
  const rl = rateLimitByIP(request, 3, 600000);
  if (!rl.allowed) return rateLimitResponse();
  try {
    const { email } = await request.json();
    if (!email) return Response.json({ error: "Email required" }, { status: 400 });

    const supabase = createServiceClient();
    const normalised = email.trim().toLowerCase();

    // Check if user exists in members (case-insensitive)
    const { data: member } = await supabase
      .from("members")
      .select("first_name, last_name, name")
      .ilike("email", normalised)
      .maybeSingle();

    if (!member) {
      // Always return success to avoid email enumeration
      return Response.json({ success: true });
    }

    const memberName = `${member.first_name || ""} ${member.last_name || ""}`.trim() || member.name || email;

    // Ensure auth user exists — try to create, ignore if already exists
    await supabase.auth.admin.createUser({
      email: normalised,
      password: `UGD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      email_confirm: true,
    });

    // Generate a recovery link via Supabase Admin API.
    // redirectTo must be in Supabase Auth → URL Configuration → Redirect URLs.
    const redirectTo = `${APP_URL}/reset-password`;
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email: normalised,
      options: { redirectTo },
    });

    if (linkError) {
      console.error("[reset-password] generateLink failed:", linkError.message, { email: normalised, redirectTo });
    }

    // Build the full verification URL Supabase expects.
    // The user clicks this → Supabase verifies token → redirects to /reset-password#access_token=...
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const token = linkData?.properties?.hashed_token;

    if (!token || !supabaseUrl) {
      console.error("[reset-password] Reset link generation failed — missing token or Supabase URL.", {
        hasToken: !!token,
        hasSupabaseUrl: !!supabaseUrl,
        appUrl: APP_URL,
        linkError: linkError?.message,
      });
      // Fall through: send email pointing to forgot-password so user can try again
    }

    const resetLink = token && supabaseUrl
      ? `${supabaseUrl}/auth/v1/verify?token=${token}&type=recovery&redirect_to=${encodeURIComponent(redirectTo)}`
      : `${APP_URL}/forgot-password`;

    const emailResult = await sendNotificationEmail({
      to: normalised,
      subject: "Password Reset - Unze Group Dashboard",
      heading: "Reset Your Password",
      body: `
        <p>Hi <strong>${memberName}</strong>,</p>
        <p>You requested a password reset for your Unze Group Dashboard account.</p>
        <p>Click the button below to set a new password. This link expires in 1 hour.</p>
        <p style="background:#f1f5f9;padding:12px;border-radius:6px;border-left:3px solid #2563eb;font-size:14px;margin-top:12px">
          If you did not request this, you can safely ignore this email.
        </p>
      `,
      linkUrl: resetLink,
      linkLabel: "Reset Password",
      triggerType: "password_reset",
      recipientName: memberName,
    });

    if (!emailResult.success && !emailResult.skipped) {
      console.error("[reset-password] Email send failed:", emailResult.error, { to: normalised });
    }

    // Always return success — do not reveal whether the email exists or the send failed
    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[reset-password] Unexpected error:", message);
    return Response.json({ success: true });
  }
}
