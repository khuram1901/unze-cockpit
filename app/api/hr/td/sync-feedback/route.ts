import { NextRequest } from "next/server";
import { google } from "googleapis";
import { createServiceClient } from "../../../../lib/supabase-server";
import { requireAuth } from "../../../../lib/api-auth";

// ── Google Sheets auth ───────────────────────────────────────────────────────
// Requires GOOGLE_SERVICE_ACCOUNT_KEY env var — the full service account JSON
// key (as a single-line string). The Sheet must be shared with the service
// account email address.

function getGoogleAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY env var is not set.");
  const key = JSON.parse(keyJson);
  return new google.auth.GoogleAuth({
    credentials: key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

// ── Column name fuzzy mapper ─────────────────────────────────────────────────
// Maps Google Form column headers (which vary) to our feedback fields.
// Returns the 0-based column index for each field, or -1 if not found.

type ColMap = {
  employee_name:    number;
  overall_rating:   number;
  content_rating:   number;
  trainer_rating:   number;
  relevance_rating: number;
  comments:         number;
  timestamp:        number;
};

function mapColumns(headers: string[]): ColMap {
  const lower = headers.map(h => h.toLowerCase().trim());

  function find(...terms: string[]): number {
    for (const term of terms) {
      const idx = lower.findIndex(h => h.includes(term));
      if (idx !== -1) return idx;
    }
    return -1;
  }

  return {
    timestamp:        find("timestamp", "time"),
    employee_name:    find("employee name", "your name", "name", "employee"),
    overall_rating:   find("overall rating", "overall", "general rating"),
    content_rating:   find("content rating", "content quality", "content"),
    trainer_rating:   find("trainer rating", "trainer", "facilitator", "instructor"),
    relevance_rating: find("relevance rating", "relevance", "relevant", "applicability"),
    comments:         find("comments", "additional", "feedback", "suggestions", "any other"),
  };
}

// ── Sync one session ──────────────────────────────────────────────────────────

async function syncSession(
  sheetId: string,
  sessionId: string,
  db: ReturnType<typeof createServiceClient>
) {
  const auth  = getGoogleAuth();
  const sheets = google.sheets({ version: "v4", auth });

  // Read all data from first sheet tab
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "A:Z",
  });

  const rows = resp.data.values;
  if (!rows || rows.length < 2) return { synced: 0, skipped: 0 };

  const headers = rows[0] as string[];
  const cols    = mapColumns(headers);
  const dataRows = rows.slice(1);

  const feedbackRows = dataRows
    .filter(row => row[cols.employee_name])
    .map(row => {
      const get = (idx: number) => (idx >= 0 ? (row[idx] ?? null) : null);
      const parseRating = (v: string | null) => {
        if (v == null) return null;
        const n = parseInt(v, 10);
        return isNaN(n) || n < 1 || n > 5 ? null : n;
      };

      return {
        session_id:       sessionId,
        employee_name:    String(get(cols.employee_name) ?? "").trim(),
        overall_rating:   parseRating(get(cols.overall_rating)),
        content_rating:   parseRating(get(cols.content_rating)),
        trainer_rating:   parseRating(get(cols.trainer_rating)),
        relevance_rating: parseRating(get(cols.relevance_rating)),
        comments:         get(cols.comments) ? String(get(cols.comments)).trim() : null,
        submitted_at:     cols.timestamp >= 0 && row[cols.timestamp]
          ? new Date(row[cols.timestamp]).toISOString()
          : new Date().toISOString(),
      };
    })
    .filter(r => r.employee_name && r.overall_rating != null);

  if (feedbackRows.length === 0) return { synced: 0, skipped: dataRows.length };

  const { error } = await db
    .from("hr_td_feedback")
    .upsert(feedbackRows, { onConflict: "session_id,employee_name" });

  if (error) throw new Error(`DB upsert failed: ${error.message}`);

  // Update last sync timestamp on the session
  await db
    .from("hr_td_sessions")
    .update({ feedback_synced_at: new Date().toISOString() })
    .eq("id", sessionId);

  return { synced: feedbackRows.length, skipped: dataRows.length - feedbackRows.length - 1 };
}

// ── Route handlers ────────────────────────────────────────────────────────────

// POST — sync all sessions that have a feedback_sheet_id, or a specific sessionId
// Body: { session_id?: string }  (omit to sync all)
// Also called by the scheduler (no auth body, just the Bearer token)
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  let body: { session_id?: string } = {};
  try { body = await request.json(); } catch { /* empty body is fine */ }

  const db = createServiceClient();

  // Fetch sessions to sync
  let query = db
    .from("hr_td_sessions")
    .select("id, title, feedback_sheet_id")
    .not("feedback_sheet_id", "is", null)
    .neq("feedback_sheet_id", "")
    .in("status", ["Planned", "Completed"]);

  if (body.session_id) {
    query = query.eq("id", body.session_id);
  }

  const { data: sessions, error: fetchErr } = await query;
  if (fetchErr) return Response.json({ error: fetchErr.message }, { status: 500 });
  if (!sessions || sessions.length === 0) {
    return Response.json({ ok: true, message: "No sessions with a linked Google Sheet found.", results: [] });
  }

  const results: { session_id: string; title: string; synced: number; skipped: number; error?: string }[] = [];

  for (const session of sessions) {
    try {
      const { synced, skipped } = await syncSession(session.feedback_sheet_id!, session.id, db);
      results.push({ session_id: session.id, title: session.title, synced, skipped });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ session_id: session.id, title: session.title, synced: 0, skipped: 0, error: msg });
    }
  }

  const totalSynced = results.reduce((s, r) => s + r.synced, 0);
  return Response.json({ ok: true, total_synced: totalSynced, results });
}
