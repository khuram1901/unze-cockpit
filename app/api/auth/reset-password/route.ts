import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { sendNotificationEmail } from "../../../lib/send-email";
import { rateLimitByIP, rateLimitResponse } from "../../../lib/rate-limit";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://unze-cockpit.vercel.app";

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
      return Response.json({ success: true });
    }

    const memberName = `${member.first_name || ""} ${member.last_name || ""}`.trim() || member.name || email;

    // Ensure auth user exists — try to create, ignore if already exists
    await supabase.auth.admin.createUser({
      email: normalised,
      password: `Cockpit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      email_confirm: true,
    });

    // Generate a recovery link via Supabase Admin
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email: normalised,
      options: {
        redirectTo: `${APP_URL}/reset-password`,
      },
    });

    if (linkError) {
      console.error("generateLink failed:", linkError.message);
    }

    // Build the verification URL
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const token = linkData?.properties?.hashed_token;

    if (!token || !supabaseUrl) {
      console.error("Reset link generation failed — no token.", {
        hasToken: !!token,
        hasSupabaseUrl: !!supabaseUrl,
        linkError: linkError?.message,
      });
    }

    const resetLink = token && supabaseUrl
      ? `${supabaseUrl}/auth/v1/verify?token=${token}&type=recovery&redirect_to=${encodeURIComponent(`${APP_URL}/reset-password`)}`
      : `${APP_URL}/forgot-password`;

    await sendNotificationEmail({
      to: normalised,
      subject: "Password Reset - Unze Group Cockpit",
      heading: "Reset Your Password",
      body: `
        <p>Hi <strong>${memberName}</strong>,</p>
        <p>You requested a password reset for your Unze Group Cockpit account.</p>
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

    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Password reset error:", message);
    return Response.json({ success: true });
  }
}
