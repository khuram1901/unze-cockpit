import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// Mirrors canViewGuarantees() from permissions.ts — Admin/CEO + Finance/Ops managers
async function resolveGuaranteePerms(supabase: ReturnType<typeof createServiceClient>, email: string) {
  const lc = email.toLowerCase();
  const isAdminByEmail = lc === "khuram1901@gmail.com" || lc === "k.saleem@unzegroup.com";
  const { data: m } = await supabase
    .from("members")
    .select("role, department")
    .eq("email", lc)
    .maybeSingle();
  const role = m?.role ?? null;
  const dept = m?.department ?? null;
  const isAdminTier = isAdminByEmail || role === "Admin" || role === "CEO";
  const canView = isAdminTier || (role === "Manager" && (dept === "Finance" || dept === "Unze Trading Ops"));
  const canViewFinancials = isAdminTier || (role === "Manager" && dept === "Finance");
  return { canView, canViewFinancials };
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { canView } = await resolveGuaranteePerms(supabase, auth.email);
  if (!canView) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await supabase.rpc("get_guarantee_summary");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json(data);
}

async function checkFacilityCapacity(
  supabase: ReturnType<typeof createServiceClient>,
  facility_id: string,
  newAmount: number,
  excludeGuaranteeId?: string
): Promise<string | null> {
  const { data: fac, error: facErr } = await supabase
    .from("guarantee_facilities")
    .select("total_limit, facility_name, facility_type, bank_name")
    .eq("id", facility_id)
    .single();
  if (facErr || !fac) return "Facility not found.";

  const { data: used, error: usedErr } = await supabase.rpc("get_facility_used", {
    p_facility_id: facility_id,
    p_exclude_guarantee_id: excludeGuaranteeId ?? null,
  });
  if (usedErr) return "Could not check facility capacity.";

  const currentUsed = Number(used) || 0;
  const limit = Number(fac.total_limit);
  if (currentUsed + newAmount > limit) {
    const available = limit - currentUsed;
    const facilityLabel = fac.facility_name || fac.facility_type;
    return `This would exceed the ${fac.bank_name} — ${facilityLabel} limit. ` +
      `Limit: PKR ${Math.round(limit).toLocaleString()}, ` +
      `already used: PKR ${Math.round(currentUsed).toLocaleString()}, ` +
      `available: PKR ${Math.round(Math.max(0, available)).toLocaleString()}.`;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { canViewFinancials } = await resolveGuaranteePerms(supabase, auth.email);
  if (!canViewFinancials) return Response.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const {
    facility_id, guarantee_type, guarantee_number, bank_name,
    issue_date, expiry_date, amount, cash_margin_pct, bank_charges,
    customer_name, tender_reference, purpose,
    performance_bill_date, first_bill_receivable_id, linked_guarantee_id, notes,
  } = body;

  if (!guarantee_type || !guarantee_number || !bank_name || !issue_date || !amount || !customer_name) {
    return Response.json({ error: "guarantee_type, guarantee_number, bank_name, issue_date, amount and customer_name are required" }, { status: 400 });
  }

  if (!facility_id) {
    return Response.json({ error: "A bank facility must be selected. Link this guarantee to a facility before saving." }, { status: 400 });
  }

  const limitError = await checkFacilityCapacity(supabase, facility_id, Number(amount));
  if (limitError) return Response.json({ error: limitError }, { status: 422 });

  const { data, error } = await supabase
    .from("guarantees")
    .insert({
      facility_id,
      guarantee_type, guarantee_number, bank_name,
      issue_date, expiry_date: expiry_date || null,
      amount: Number(amount),
      cash_margin_pct: Number(cash_margin_pct) || 5,
      bank_charges: Number(bank_charges) || 0,
      customer_name, tender_reference: tender_reference || null,
      purpose: purpose || null,
      status: "Active",
      linked_guarantee_id: linked_guarantee_id || null,
      first_bill_receivable_id: first_bill_receivable_id || null,
      performance_bill_date: performance_bill_date || null,
      notes: notes || null,
      created_by: auth.email,
    })
    .select().single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ guarantee: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { canViewFinancials } = await resolveGuaranteePerms(supabase, auth.email);
  if (!canViewFinancials) return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const { id, action, ...fields } = body;

  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  // Special action: convert Bid Guarantee → Performance Guarantee
  if (action === "convert") {
    const {
      guarantee_number, bank_name, issue_date, expiry_date,
      amount, cash_margin_pct, bank_charges,
      customer_name, tender_reference, purpose, notes,
      facility_id, performance_bill_date, first_bill_receivable_id,
    } = fields;

    if (!guarantee_number || !bank_name || !issue_date || !amount) {
      return Response.json({ error: "guarantee_number, bank_name, issue_date and amount are required for conversion" }, { status: 400 });
    }

    if (!facility_id) {
      return Response.json({ error: "A bank facility must be selected for the Performance Guarantee." }, { status: 400 });
    }

    // The original Bid Guarantee will be marked Converted (no longer Active), so we don't exclude it
    const limitError = await checkFacilityCapacity(supabase, facility_id, Number(amount));
    if (limitError) return Response.json({ error: limitError }, { status: 422 });

    // Mark original as Converted
    const { error: convertErr } = await supabase
      .from("guarantees")
      .update({ status: "Converted", updated_at: new Date().toISOString() })
      .eq("id", id);
    if (convertErr) return Response.json({ error: convertErr.message }, { status: 500 });

    // Create Performance Guarantee linked to original
    const { data: newG, error: createErr } = await supabase
      .from("guarantees")
      .insert({
        facility_id,
        guarantee_type: "Performance Guarantee",
        guarantee_number, bank_name,
        issue_date, expiry_date: expiry_date || null,
        amount: Number(amount),
        cash_margin_pct: Number(cash_margin_pct) || 5,
        bank_charges: Number(bank_charges) || 0,
        customer_name, tender_reference: tender_reference || null,
        purpose: purpose || null,
        status: "Active",
        linked_guarantee_id: id,
        first_bill_receivable_id: first_bill_receivable_id || null,
        performance_bill_date: performance_bill_date || null,
        notes: notes || null,
        created_by: auth.email,
      })
      .select().single();
    if (createErr) return Response.json({ error: createErr.message }, { status: 500 });

    return Response.json({ guarantee: newG }, { status: 201 });
  }

  // Standard update — check limit if amount or facility_id is changing
  if (fields.amount !== undefined || fields.facility_id !== undefined) {
    // Determine effective facility_id and amount after update
    let targetFacilityId = fields.facility_id;
    let targetAmount = fields.amount !== undefined ? Number(fields.amount) : undefined;

    if (targetFacilityId || targetAmount !== undefined) {
      // Fetch current record to fill in missing values
      const { data: current } = await supabase
        .from("guarantees")
        .select("facility_id, amount, status")
        .eq("id", id)
        .single();

      if (current && current.status === "Active") {
        const effectiveFacilityId = targetFacilityId ?? current.facility_id;
        const effectiveAmount = targetAmount ?? current.amount;

        if (effectiveFacilityId) {
          const limitError = await checkFacilityCapacity(supabase, effectiveFacilityId, effectiveAmount, id);
          if (limitError) return Response.json({ error: limitError }, { status: 422 });
        }
      }
    }
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const allowed = [
    "facility_id", "guarantee_number", "bank_name", "issue_date", "expiry_date",
    "amount", "cash_margin_pct", "bank_charges", "customer_name", "tender_reference",
    "purpose", "status", "performance_bill_date", "first_bill_receivable_id", "returned_date", "notes",
  ];
  for (const key of allowed) {
    if (fields[key] !== undefined) updates[key] = fields[key] || null;
  }
  if (fields.amount !== undefined)          updates.amount          = Number(fields.amount);
  if (fields.cash_margin_pct !== undefined) updates.cash_margin_pct = Number(fields.cash_margin_pct);
  if (fields.bank_charges !== undefined)    updates.bank_charges    = Number(fields.bank_charges);

  const { data, error } = await supabase
    .from("guarantees").update(updates).eq("id", id).select().single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ guarantee: data });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { canViewFinancials } = await resolveGuaranteePerms(supabase, auth.email);
  if (!canViewFinancials) return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const { id } = body;
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const { error } = await supabase.from("guarantees").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
