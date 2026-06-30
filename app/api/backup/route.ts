import { NextRequest } from "next/server";
import { google } from "googleapis";
import zlib from "zlib";
import { createServiceClient } from "../../lib/supabase-server";
import { safeDecrypt, encrypt } from "../../lib/crypto";

const BACKUP_RECIPIENT = "khuram1901@gmail.com";

const TABLES = [
  "companies", "members", "member_plants", "plants",
  "department_owners", "tasks", "meeting_requests",
  "production_entries", "dispatch_entries", "breakage_entries",
  "scrap_processed_entries", "machine_issues",
  "opening_balances", "broken_opening_balances",
  "monthly_production_targets", "monthly_dispatch_targets",
  "daily_cash_position", "monthly_cash_plan", "cash_opening_balance",
  "bank_position_snapshots", "receivables", "receivable_stages",
  "audit_plan_items", "audit_findings",
  "recruitment_positions", "performance_evaluations", "hr_strategy_goals",
  "legal_notices", "admin_categories", "admin_spend",
  "meetings", "meeting_tasks", "meeting_attendees", "monthly_budgets", "quarterly_forecasts",
  "audit_log", "notification_log",
  "department_budgets", "member_permissions", "recurring_tasks",
  "holdings", "price_history", "pending_minutes", "push_subscriptions",
];

function buildBackupEmail(to: string, from: string, subject: string, bodyText: string, attachment: { filename: string; mimeType: string; data: Buffer }): string {
  const boundary = "boundary_" + Date.now();
  const raw = [
    `From: Unze Group Dashboard (No Reply) <${from}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    bodyText,
    ``,
    `--${boundary}`,
    `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`,
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    attachment.data.toString("base64"),
    ``,
    `--${boundary}--`,
  ].join("\r\n");

  return Buffer.from(raw).toString("base64url");
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const today = new Date().toISOString().slice(0, 10);

    // Export all tables as JSON
    const backup: Record<string, unknown[]> = {};
    for (const table of TABLES) {
      const { data } = await supabase.from(table).select("*");
      backup[table] = data || [];
    }

    const backupJson = JSON.stringify(backup, null, 2);
    const backupBuffer = Buffer.from(backupJson);
    const gzipped = zlib.gzipSync(backupBuffer);
    const filename = `cockpit-backup-${today}.json.gz`;

    const { data: token } = await supabase
      .from("google_oauth_tokens")
      .select("*")
      .eq("user_email", BACKUP_RECIPIENT)
      .single();

    if (!token) {
      return Response.json({ error: "Google account not connected" }, { status: 500 });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      (process.env.GOOGLE_REDIRECT_URI || "").replace("/callback", "/callback-notifications")
    );
    oauth2Client.setCredentials({
      access_token: safeDecrypt(token.access_token),
      refresh_token: safeDecrypt(token.refresh_token),
      expiry_date: token.token_expiry ? new Date(token.token_expiry).getTime() : undefined,
    });

    oauth2Client.on("tokens", async (newTokens) => {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (newTokens.access_token) updates.access_token = encrypt(newTokens.access_token);
      if (newTokens.expiry_date) updates.token_expiry = new Date(newTokens.expiry_date).toISOString();
      await supabase.from("google_oauth_tokens").update(updates).eq("id", token.id);
    });

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const tableCount = Object.keys(backup).length;
    const rowCount = Object.values(backup).reduce((s, rows) => s + rows.length, 0);

    const raw = buildBackupEmail(
      BACKUP_RECIPIENT,
      BACKUP_RECIPIENT,
      `Unze Cockpit Backup — ${today}`,
      `Nightly database backup attached.\n\nTables: ${tableCount}\nTotal rows: ${rowCount}\nUncompressed size: ${Math.round(backupBuffer.length / 1024)} KB\nCompressed size: ${Math.round(gzipped.length / 1024)} KB`,
      { filename, mimeType: "application/gzip", data: gzipped }
    );

    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });

    return Response.json({
      ok: true,
      filename,
      tables: tableCount,
      totalRows: rowCount,
      sizeKB: Math.round(backupBuffer.length / 1024),
      compressedKB: Math.round(gzipped.length / 1024),
      emailedTo: BACKUP_RECIPIENT,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Backup error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
