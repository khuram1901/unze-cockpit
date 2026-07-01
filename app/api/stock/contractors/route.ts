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
      .select("contractor_id, contractors(*)")
      .eq("po_id", poId)
      .order("created_at", { ascending: true });

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ contractors: (data || []).map((r) => r.contractors) });
  }

  // Search all contractors (for lookup/add)
  let query = supabase.from("contractors").select("*").order("name");
  if (search) query = query.ilike("name", `%${search}%`);

  const { data, error } = await query.limit(50);
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
