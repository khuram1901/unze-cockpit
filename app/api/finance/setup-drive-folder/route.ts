import { NextRequest } from "next/server";
import { google } from "googleapis";
import { createServiceClient } from "../../../lib/supabase-server";
import { safeDecrypt, encrypt } from "../../../lib/crypto";

const TARGET_EMAIL = "k.saleem@unzegroup.com";
const ROOT_FOLDER_NAME = "Cockpit Cash Sheets";
const INBOX_FOLDER_NAME = "Drop Here";
const PROCESSED_FOLDER_NAME = "Processed";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data: tokenRow } = await supabase
    .from("google_oauth_tokens").select("*").eq("user_email", TARGET_EMAIL).single();

  if (!tokenRow) {
    return Response.json({ error: `No token for ${TARGET_EMAIL} — reconnect Google on the Calendar page` }, { status: 400 });
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || ""
  );
  oauth2Client.setCredentials({
    access_token: safeDecrypt(tokenRow.access_token),
    refresh_token: safeDecrypt(tokenRow.refresh_token),
    expiry_date: tokenRow.token_expiry ? new Date(tokenRow.token_expiry).getTime() : undefined,
  });
  const tokenReadAt = tokenRow.updated_at;
  oauth2Client.on("tokens", async (t) => {
    const u: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (t.access_token) u.access_token = encrypt(t.access_token);
    if (t.expiry_date) u.token_expiry = new Date(t.expiry_date).toISOString();
    let q = supabase.from("google_oauth_tokens").update(u).eq("id", tokenRow.id);
    if (tokenReadAt) q = q.eq("updated_at", tokenReadAt);
    await q;
  });

  const drive = google.drive({ version: "v3", auth: oauth2Client });

  async function findOrCreate(name: string, parentId?: string): Promise<{ id: string; action: string }> {
    const q = parentId
      ? `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
      : `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const res = await drive.files.list({ q, fields: "files(id,name)", spaces: "drive" });
    if (res.data.files && res.data.files.length > 0) {
      return { id: res.data.files[0].id!, action: "already exists" };
    }
    const created = await drive.files.create({
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.folder",
        ...(parentId ? { parents: [parentId] } : {}),
      },
      fields: "id",
    });
    return { id: created.data.id!, action: "created" };
  }

  const root = await findOrCreate(ROOT_FOLDER_NAME);
  const inbox = await findOrCreate(INBOX_FOLDER_NAME, root.id);
  const processed = await findOrCreate(PROCESSED_FOLDER_NAME, root.id);

  // Save folder IDs to DB so the cron can find them without searching each time
  await supabase.from("app_settings").upsert([
    { key: "drive_inbox_folder_id", value: inbox.id },
    { key: "drive_processed_folder_id", value: processed.id },
  ], { onConflict: "key" });

  return Response.json({
    ok: true,
    folders: {
      root: { name: ROOT_FOLDER_NAME, id: root.id, action: root.action },
      inbox: { name: INBOX_FOLDER_NAME, id: inbox.id, action: inbox.action },
      processed: { name: PROCESSED_FOLDER_NAME, id: processed.id, action: processed.action },
    },
    instruction: `Share the "${ROOT_FOLDER_NAME}/${INBOX_FOLDER_NAME}" folder with your team. They drop PDFs in there; the cron picks them up automatically every 10 minutes.`,
  });
}
