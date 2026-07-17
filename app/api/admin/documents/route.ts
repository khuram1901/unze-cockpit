import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// GET — ?type=ntn | ?type=licences
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");

  const supabase = createServiceClient();

  if (type === "licences") {
    const { data, error } = await supabase.rpc("get_admin_restaurant_licences");
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data });
  }

  // Default: NTN docs
  const { data, error } = await supabase.rpc("get_admin_ntn_docs");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ data });
}

// POST — update a document record (NTN or licence)
// body: { doc_type: "ntn" | "licence", ... }
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const { doc_type } = body;

  const supabase = createServiceClient();

  if (doc_type === "licence") {
    const { location_id, licence_type, status, folderit_link, expiry_date } = body;
    if (!location_id || !licence_type) {
      return Response.json({ error: "location_id and licence_type are required" }, { status: 400 });
    }
    const { error } = await supabase
      .from("admin_restaurant_licences")
      .upsert(
        { location_id, licence_type, status, folderit_link: folderit_link || null, expiry_date: expiry_date || null, updated_at: new Date().toISOString() },
        { onConflict: "location_id,licence_type" }
      );
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  // NTN doc
  const { doc_id, location_id, meter_label, ntn_number, status, folderit_link } = body;
  if (!location_id) {
    return Response.json({ error: "location_id is required" }, { status: 400 });
  }

  if (doc_id) {
    // Update existing
    const { error } = await supabase
      .from("admin_ntn_docs")
      .update({ ntn_number: ntn_number || null, status, folderit_link: folderit_link || null, updated_at: new Date().toISOString() })
      .eq("id", doc_id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  } else {
    // Insert new
    const { error } = await supabase
      .from("admin_ntn_docs")
      .insert({ location_id, meter_label: meter_label || "Meter 1", ntn_number: ntn_number || null, status: status || "Pending", folderit_link: folderit_link || null });
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
