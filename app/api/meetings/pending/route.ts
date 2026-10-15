import { NextRequest } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";

// POST /api/meetings/pending
//
// Used by PA (Executive role) to insert or update a pending_minutes row.
// Must use the service client — the Executive role is excluded from the
// pending_minutes_admin RLS policy (which resolves to is_admin_tier()).
//
// Body:
//   id?          — if present, UPDATE that row; if absent, INSERT a new one
//   status       — always "pa_approved" for PA submissions
//   pa_approved_by
//   pa_approved_at
//   extracted_data
//   source_type
//   raw_text?    — required for INSERT (the pasted transcript / upload text)
//   from_address? — submitter email, stored for INSERT rows

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await request.json();
    const { id, raw_text, from_address, ...updates } = body;

    const supabase = createServiceClient();

    if (id) {
      // UPDATE existing row (PA came from the email queue)
      const { error } = await supabase
        .from("pending_minutes")
        .update(updates)
        .eq("id", id);

      if (error) {
        console.error("[pending/route] update error:", error);
        return Response.json({ error: error.message }, { status: 500 });
      }
      return Response.json({ success: true, id });
    } else {
      // INSERT new row (PA used direct paste / upload — no gmail row exists)
      // gmail_message_id is NOT NULL UNIQUE — use a prefixed UUID for manual entries
      const manualId = `manual-${crypto.randomUUID()}`;

      const { data, error } = await supabase
        .from("pending_minutes")
        .insert({
          gmail_message_id: manualId,
          raw_text: raw_text ?? "",
          from_address: from_address ?? null,
          ...updates,
        })
        .select("id")
        .single();

      if (error) {
        console.error("[pending/route] insert error:", error);
        return Response.json({ error: error.message }, { status: 500 });
      }
      return Response.json({ success: true, id: data.id });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[pending/route] unexpected error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
