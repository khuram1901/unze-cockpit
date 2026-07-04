import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("get_guarantee_summary");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json(data);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const body = await request.json().catch(() => ({}));
  const {
    facility_id, guarantee_type, guarantee_number, bank_name,
    issue_date, expiry_date, amount, cash_margin_pct, bank_charges,
    customer_name, tender_reference, purpose,
    performance_bill_date, linked_guarantee_id, notes,
  } = body;

  if (!guarantee_type || !guarantee_number || !bank_name || !issue_date || !amount || !customer_name) {
    return Response.json({ error: "guarantee_type, guarantee_number, bank_name, issue_date, amount and customer_name are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("guarantees")
    .insert({
      facility_id: facility_id || null,
      guarantee_type, guarantee_number, bank_name,
      issue_date, expiry_date: expiry_date || null,
      amount: Number(amount),
      cash_margin_pct: Number(cash_margin_pct) || 5,
      bank_charges: Number(bank_charges) || 0,
      customer_name, tender_reference: tender_reference || null,
      purpose: purpose || null,
      status: "Active",
      linked_guarantee_id: linked_guarantee_id || null,
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
  const body = await request.json().catch(() => ({}));
  const { id, action, ...fields } = body;

  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  // Special action: convert Bid Guarantee → Performance Guarantee
  // Creates the Performance Guarantee and marks the original as Converted
  if (action === "convert") {
    const {
      guarantee_number, bank_name, issue_date, expiry_date,
      amount, cash_margin_pct, bank_charges,
      customer_name, tender_reference, purpose, notes,
      facility_id, performance_bill_date,
    } = fields;

    if (!guarantee_number || !bank_name || !issue_date || !amount) {
      return Response.json({ error: "guarantee_number, bank_name, issue_date and amount are required for conversion" }, { status: 400 });
    }

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
        facility_id: facility_id || null,
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
        performance_bill_date: performance_bill_date || null,
        notes: notes || null,
        created_by: auth.email,
      })
      .select().single();
    if (createErr) return Response.json({ error: createErr.message }, { status: 500 });

    return Response.json({ guarantee: newG }, { status: 201 });
  }

  // Standard update
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const allowed = [
    "facility_id", "guarantee_number", "bank_name", "issue_date", "expiry_date",
    "amount", "cash_margin_pct", "bank_charges", "customer_name", "tender_reference",
    "purpose", "status", "performance_bill_date", "returned_date", "notes",
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
