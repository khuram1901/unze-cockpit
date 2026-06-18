import { NextRequest } from "next/server";
import { google } from "googleapis";
import { createServiceClient } from "../../lib/supabase-server";

const BACKUP_FOLDER_NAME = "cockpit-backups";
const MAX_BACKUPS = 35;

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
  "meetings", "meeting_tasks", "monthly_budgets", "quarterly_forecasts",
  "google_oauth_tokens", "audit_log", "notification_log",
];

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
    const filename = `cockpit-backup-${today}.json`;

    // Get Google Drive auth from the notification account
    const { data: token } = await supabase
      .from("google_oauth_tokens")
      .select("*")
      .eq("user_email", "unzegrouppk@gmail.com")
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
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expiry_date: token.token_expiry ? new Date(token.token_expiry).getTime() : undefined,
    });

    const drive = google.drive({ version: "v3", auth: oauth2Client });

    // Find or create the backup folder
    const folderSearch = await drive.files.list({
      q: `name='${BACKUP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id, name)",
    });

    let folderId: string;
    if (folderSearch.data.files && folderSearch.data.files.length > 0) {
      folderId = folderSearch.data.files[0].id!;
    } else {
      const folder = await drive.files.create({
        requestBody: {
          name: BACKUP_FOLDER_NAME,
          mimeType: "application/vnd.google-apps.folder",
        },
        fields: "id",
      });
      folderId = folder.data.id!;
    }

    // Upload the backup
    const { Readable } = await import("stream");
    await drive.files.create({
      requestBody: {
        name: filename,
        parents: [folderId],
      },
      media: {
        mimeType: "application/json",
        body: Readable.from(backupBuffer),
      },
    });

    // Clean up old backups (keep only MAX_BACKUPS)
    const existingFiles = await drive.files.list({
      q: `'${folderId}' in parents and name contains 'cockpit-backup-' and trashed=false`,
      fields: "files(id, name, createdTime)",
      orderBy: "createdTime desc",
    });

    const files = existingFiles.data.files || [];
    if (files.length > MAX_BACKUPS) {
      const toDelete = files.slice(MAX_BACKUPS);
      for (const file of toDelete) {
        if (file.id) {
          await drive.files.delete({ fileId: file.id });
        }
      }
    }

    const tableCount = Object.keys(backup).length;
    const rowCount = Object.values(backup).reduce((s, rows) => s + rows.length, 0);

    return Response.json({
      ok: true,
      filename,
      tables: tableCount,
      totalRows: rowCount,
      sizeKB: Math.round(backupBuffer.length / 1024),
      oldBackupsDeleted: Math.max(0, files.length - MAX_BACKUPS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Backup error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
