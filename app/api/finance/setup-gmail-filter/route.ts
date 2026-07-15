import { NextRequest } from "next/server";
import { google } from "googleapis";
import { createServiceClient } from "../../../lib/supabase-server";
import { safeDecrypt, encrypt } from "../../../lib/crypto";
import { GOOGLE_INTEGRATION_EMAIL as TARGET_EMAIL } from "../../../lib/constants";

const LABEL_NAME = "cockpit-cash";

// Keywords that identify cash sheet emails — matches subject or sender
const FILTER_SUBJECT_QUERY = "Cash Flow OR Bank Position OR cash sheet";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data: tokenRow } = await supabase
    .from("google_oauth_tokens")
    .select("*")
    .eq("user_email", TARGET_EMAIL)
    .single();

  if (!tokenRow) {
    return Response.json({ error: `No OAuth token found for ${TARGET_EMAIL} — reconnect Google on the Calendar page first` }, { status: 400 });
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    (process.env.GOOGLE_REDIRECT_URI || "").replace("/callback", "/callback-notifications")
  );
  oauth2Client.setCredentials({
    access_token: safeDecrypt(tokenRow.access_token),
    refresh_token: safeDecrypt(tokenRow.refresh_token),
    expiry_date: tokenRow.token_expiry ? new Date(tokenRow.token_expiry).getTime() : undefined,
  });

  const tokenReadAt = tokenRow.updated_at;
  oauth2Client.on("tokens", async (newTokens) => {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (newTokens.access_token) updates.access_token = encrypt(newTokens.access_token);
    if (newTokens.expiry_date) updates.token_expiry = new Date(newTokens.expiry_date).toISOString();
    let query = supabase.from("google_oauth_tokens").update(updates).eq("id", tokenRow.id);
    if (tokenReadAt) query = query.eq("updated_at", tokenReadAt);
    await query;
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  // ── Step 1: Create label if it doesn't already exist ──
  const labelsRes = await gmail.users.labels.list({ userId: "me" });
  const existing = labelsRes.data.labels?.find(
    (l) => l.name?.toLowerCase() === LABEL_NAME.toLowerCase()
  );

  let labelId: string;
  let labelAction: string;

  if (existing?.id) {
    labelId = existing.id;
    labelAction = `already exists (id: ${labelId})`;
  } else {
    const created = await gmail.users.labels.create({
      userId: "me",
      requestBody: {
        name: LABEL_NAME,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      },
    });
    labelId = created.data.id!;
    labelAction = `created (id: ${labelId})`;
  }

  // ── Step 2: Create filter if one for this label doesn't already exist ──
  const filtersRes = await gmail.users.settings.filters.list({ userId: "me" });
  const existingFilter = (filtersRes.data.filter || []).find((f) =>
    f.action?.addLabelIds?.includes(labelId)
  );

  let filterAction: string;

  if (existingFilter?.id) {
    filterAction = `already exists (id: ${existingFilter.id})`;
  } else {
    const createdFilter = await gmail.users.settings.filters.create({
      userId: "me",
      requestBody: {
        criteria: {
          // Matches emails whose subject contains any of these terms
          subject: FILTER_SUBJECT_QUERY,
          hasAttachment: true,
        },
        action: {
          addLabelIds: [labelId],
          removeLabelIds: [],
        },
      },
    });
    filterAction = `created (id: ${createdFilter.data.id})`;
  }

  return Response.json({
    ok: true,
    account: TARGET_EMAIL,
    label: { name: LABEL_NAME, action: labelAction },
    filter: { query: FILTER_SUBJECT_QUERY, action: filterAction },
    note: "Filter applies to NEW emails going forward. To label existing emails in your inbox, search Gmail for 'subject:(Cash Flow OR Bank Position) has:attachment' and apply the cockpit-cash label manually.",
  });
}
