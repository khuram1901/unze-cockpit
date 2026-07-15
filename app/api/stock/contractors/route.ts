import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

function canManage(role: string, department: string | null) {
  return role === "Admin" || role === "Executive" ||
    (role === "Manager" && department === "Unze Trading Ops");
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const poId = searchParams.get("poId");
  const search = searchParams.get("search");

  if (poId) {
    // Return contractors linked to a specific PO
    const { data, error } = await supabase
      .from("po_contractors")
      .select("contractor_id, contractors(id, name, cnic_or_id, contact_phone, contact_address)")
      .eq("po_id", poId)
      .order("created_at", { ascending: true });

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ contractors: (data || []).map((r) => r.contractors) });
  }

  // Search all contractors (for lookup/add) — no cap, Khuram wants every
  // contractor to show regardless of list size (was hard-limited to 50).
  let query = supabase.from("contractors").select("id, name, cnic_or_id, contact_phone, contact_address").order("name");
  if (search) query = query.ilike("name", `%${search}%`);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ contractors: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { data: member } = await supabase
    .from("members").select("role, department").eq("email", auth.email).single();

  if (!member || !canManage(member.role, member.department)) {
    return Response.json({ error: "Ops Manager or Admin required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { name, cnic_or_id, contact_phone, contact_address, notes, po_id } = body;

  if (!name) return Response.json({ error: "name is required" }, { status: 400 });

  // Create contractor
  const { data: contractor, error: cErr } = await supabase
    .from("contractors")
    .insert({ name, cnic_or_id, contact_phone, contact_address, notes, created_by: auth.email })
    .select().single();

  if (cErr) return Response.json({ error: cErr.message }, { status: 500 });

  // Link to PO if provided
  if (po_id && contractor) {
    await supabase.from("po_contractors").insert({ po_id, contractor_id: contractor.id });
  }

  return Response.json({ contractor }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { data: member } = await supabase
    .from("members").select("role, department").eq("email", auth.email).single();

  if (!member || !canManage(member.role, member.department)) {
    return Response.json({ error: "Ops Manager or Admin required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { id, name, cnic_or_id, contact_phone, contact_address, notes } = body;

  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  if (name !== undefined && !name) return Response.json({ error: "name cannot be empty" }, { status: 400 });

  // Note: contractors has no updated_at column (unlike purchase_orders) —
  // same bug as authority_letters, fixed at the same time.
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (cnic_or_id !== undefined) updates.cnic_or_id = cnic_or_id || null;
  if (contact_phone !== undefined) updates.contact_phone = contact_phone || null;
  if (contact_address !== undefined) updates.contact_address = contact_address || null;
  if (notes !== undefined) updates.notes = notes || null;

  const { data, error } = await supabase
    .from("contractors").update(updates).eq("id", id).select().single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ contractor: data });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { data: member } = await supabase
    .from("members").select("role, department").eq("email", auth.email).single();

  if (!member || !canManage(member.role, member.department)) {
    return Response.json({ error: "Ops Manager or Admin required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { id } = body;
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const { error } = await supabase.from("contractors").delete().eq("id", id);
  if (error) {
    // Postgres foreign-key "on delete restrict" violation (still linked to a
    // PO via po_contractors, or has authority letters issued) — friendlier
    // message than the raw Postgres error text, same pattern as PO/letter DELETE.
    if (error.code === "23503") {
      return Response.json(
        { error: "This contractor is linked to a PO or has authority letters issued — remove those links first." },
        { status: 409 }
      );
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ success: true });
}
