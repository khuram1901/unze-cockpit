import { NextRequest } from "next/server";
import { google } from "googleapis";
import { Readable } from "stream";
import zlib from "zlib";
import { createServiceClient } from "../../lib/supabase-server";
import { safeDecrypt, encrypt } from "../../lib/crypto";
import { BACKUP_TABLES } from "../../lib/backup-tables";

const BACKUP_OWNER  = "k.saleem@unzegroup.com";
const BACKUPS_BUCKET = "backups";
const DRIVE_FOLDER_NAME = "Unze Cockpit Backups";
const TABLES = BACKUP_TABLES;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const isCron = process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron) {
    const { requireAuth } = await import("../../lib/api-auth");
    const { isAdminTier } = await import("../../lib/permissions");
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;
    const supabaseCheck = createServiceClient();
    const { data: member } = await supabaseCheck.from("members").select("role, department").eq("email", auth.email).maybeSingle();
    if (!member || !isAdminTier({ email: auth.email, role: member.role, department: member.department ?? null, overrides: null })) {
      return Response.json({ error: "Unauthorised" }, { status: 401 });
    }
  }

  try {
    const supabase = createServiceClient();
    const today = new Date().toISOString().slice(0, 10);

    // ── 1. Export all tables as JSON ──────────────────────────────────
    const backup: Record<string, unknown[]> = {};
    for (const table of TABLES) {
      const { data } = await supabase.from(table).select("*");
      backup[table] = data || [];
    }

    const backupJson   = JSON.stringify(backup, null, 2);
    const backupBuffer = Buffer.from(backupJson);
    const gzipped      = zlib.gzipSync(backupBuffer);
    const filename     = `cockpit-backup-${today}.json.gz`;

    const tableCount = Object.keys(backup).length;
    const rowCount   = Object.values(backup).reduce((s, rows) => s + rows.length, 0);

    // ── 2. Save to Supabase Storage (always, independent of Drive) ───
    const { error: storageError } = await supabase.storage
      .from(BACKUPS_BUCKET)
      .upload(filename, gzipped, { contentType: "application/gzip", upsert: true });

    if (storageError) {
      console.error("Backup storage upload failed:", storageError.message);
    }

    // ── 3. Set up Google OAuth client ─────────────────────────────────
    const { data: token } = await supabase
      .from("google_oauth_tokens")
      .select("id, access_token, refresh_token, token_expiry")
      .eq("user_email", BACKUP_OWNER)
      .single();

    if (!token) {
      return Response.json({
        error: "Google account not connected — visit /backups to reconnect",
        storageBackup: storageError ? "failed" : "saved",
      }, { status: 500 });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      (process.env.GOOGLE_REDIRECT_URI || "").replace("/callback", "/callback-notifications")
    );
    oauth2Client.setCredentials({
      access_token:  safeDecrypt(token.access_token),
      refresh_token: safeDecrypt(token.refresh_token),
      expiry_date:   token.token_expiry ? new Date(token.token_expiry).getTime() : undefined,
    });

    oauth2Client.on("tokens", async (newTokens) => {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (newTokens.access_token) updates.access_token = encrypt(newTokens.access_token);
      if (newTokens.expiry_date)  updates.token_expiry = new Date(newTokens.expiry_date).toISOString();
      await supabase.from("google_oauth_tokens").update(updates).eq("id", token.id);
    });

    // ── 4. Find or create the backup folder in Drive ──────────────────
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    let folderId: string;
    const folderSearch = await drive.files.list({
      q: `name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id)",
      spaces: "drive",
    });

    if (folderSearch.data.files && folderSearch.data.files.length > 0) {
      folderId = folderSearch.data.files[0].id!;
    } else {
      const newFolder = await drive.files.create({
        requestBody: {
          name:     DRIVE_FOLDER_NAME,
          mimeType: "application/vnd.google-apps.folder",
        },
        fields: "id",
      });
      folderId = newFolder.data.id!;
    }

    // ── 5. Upload the backup file to Drive ────────────────────────────
    const driveFile = await drive.files.create({
      requestBody: {
        name:    filename,
        mimeType: "application/gzip",
        parents: [folderId],
      },
      media: {
        mimeType: "application/gzip",
        body:     Readable.from(gzipped),
      },
      fields: "id, name, webViewLink",
    });

    return Response.json({
      ok:             true,
      filename,
      tables:         tableCount,
      totalRows:      rowCount,
      sizeKB:         Math.round(backupBuffer.length / 1024),
      compressedKB:   Math.round(gzipped.length / 1024),
      driveFileId:    driveFile.data.id,
      driveLink:      driveFile.data.webViewLink,
      driveFolder:    DRIVE_FOLDER_NAME,
      storageBackup:  storageError ? `failed — ${storageError.message}` : "saved",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Backup error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
