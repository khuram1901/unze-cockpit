import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { sendNotificationEmail } from "../../../lib/send-email";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://unze-cockpit.vercel.app";

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();
    if (!email) return Response.json({ error: "Email required" }, { status: 400 });

    const supabase = createServiceClient();

    // Check if user exists in members
    const { data: member } = await supabase
      .from("members")
      .select("first_name, last_name, name")
      .eq("email", email.trim())
      .maybeSingle();

    if (!member) {
      // Don't reveal whether the email exists
      return Response.json({ success: true });
    }

    const memberName = `${member.first_name || ""} ${member.last_name || ""}`.trim() || member.name || email;

    // Ensure auth user exists — create if not
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const authUserExists = existingUsers?.users?.some((u) => u.email === email.trim());

    if (!authUserExists) {
      const tempPassword = `Cockpit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await supabase.auth.admin.createUser({
        email: email.trim(),
        password: tempPassword,
        email_confirm: true,
      });
    }

    // Generate a magic link via Supabase Admin
    const { data: linkData } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: email.trim(),
      options: {
        redirectTo: `${APP_URL}/reset-password`,
      },
    });

    let resetLink = `${APP_URL}/forgot-password`;
    if (linkData?.properties?.hashed_token) {
      resetLink = `${APP_URL}/reset-password#access_token=${linkData.properties.hashed_token}&type=magiclink`;
    }

    // Send via our own Gmail
    await sendNotificationEmail({
      to: email.trim(),
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
    return Response.json({ success: true }); // Don't reveal errors
  }
}
