import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("guarantee_facilities")
    .select("*")
    .order("bank_name");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ facilities: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const body = await request.json().catch(() => ({}));
  const { bank_name, facility_name, facility_type, total_limit, notes } = body;

  if (!bank_name || !facility_name || !total_limit) {
    return Response.json({ error: "bank_name, facility_name and total_limit are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("guarantee_facilities")
    .insert({ bank_name, facility_name, facility_type: facility_type || "Guarantee Limit", total_limit: Number(total_limit), notes: notes || null })
    .select().single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ facility: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const body = await request.json().catch(() => ({}));
  const { id, ...fields } = body;
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (fields.bank_name     !== undefined) updates.bank_name     = fields.bank_name;
  if (fields.facility_name !== undefined) updates.facility_name = fields.facility_name;
  if (fields.facility_type !== undefined) updates.facility_type = fields.facility_type;
  if (fields.total_limit  !== undefined) updates.total_limit  = Number(fields.total_limit);
  if (fields.notes        !== undefined) updates.notes        = fields.notes || null;
  if (fields.active       !== undefined) updates.active       = fields.active;

  const { data, error } = await supabase
    .from("guarantee_facilities").update(updates).eq("id", id).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ facility: data });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const body = await request.json().catch(() => ({}));
  const { id } = body;
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const { error } = await supabase
    .from("guarantee_facilities")
    .delete()
    .eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
