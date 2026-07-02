import { NextRequest } from "next/server";
import { google } from "googleapis";
import zlib from "zlib";
import { createServiceClient } from "../../lib/supabase-server";
import { safeDecrypt, encrypt } from "../../lib/crypto";
import { BACKUP_TABLES } from "../../lib/backup-tables";

const BACKUP_RECIPIENT = "k.saleem@unzegroup.com";
const BACKUPS_BUCKET = "backups";
const TABLES = BACKUP_TABLES;

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

    // Write to Storage first so a backup copy exists independently of the
    // Gmail account / email delivery below — two unrelated failure points.
    const { error: storageError } = await supabase.storage
      .from(BACKUPS_BUCKET)
      .upload(filename, gzipped, { contentType: "application/gzip", upsert: true });

    if (storageError) {
      console.error("Backup storage upload failed:", storageError.message);
    }

    const { data: token } = await supabase
      .from("google_oauth_tokens")
      .select("*")
      .eq("user_email", BACKUP_RECIPIENT)
      .single();

    if (!token) {
      return Response.json({
        error: "Google account not connected",
        storageBackup: storageError ? "failed" : "saved",
      }, { status: 500 });
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
      storageBackup: storageError ? `failed — ${storageError.message}` : "saved",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Backup error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
