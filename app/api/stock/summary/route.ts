import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// Returns a full summary for the stock tree:
// Plants → POs (with produced/dispatched totals + delivery forecast) → Contractors → Letters (with remaining balance + expiry)
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const plantId = searchParams.get("plantId");

  // 1. Fetch all POs (active + closed for greyed-out display)
  let poQuery = supabase
    .from("purchase_orders")
    .select("*")
    .order("is_system_unallocated", { ascending: true })
    .order("status", { ascending: true }) // Active first
    .order("customer_name");
  if (plantId) poQuery = poQuery.eq("plant_id", plantId);
  const { data: pos, error: poErr } = await poQuery;
  if (poErr) return Response.json({ error: poErr.message }, { status: 500 });

  const poIds = (pos || []).map((p) => p.id);
  if (poIds.length === 0) return Response.json({ summary: [] });

  // 2a. Fetch opening stock allocations per PO (pre-go-live stock split by PO)
  const { data: openingAllocs } = await supabase
    .from("opening_stock_allocations")
    .select("po_id, qty_31, qty_36, qty_40, qty_45, qty_meter")
    .in("po_id", poIds);

  const openingByPO: Record<string, { qty_31: number; qty_36: number; qty_40: number; qty_45: number; qty_meter: number }> = {};
  for (const r of openingAllocs || []) {
    openingByPO[r.po_id] = {
      qty_31:    Number(r.qty_31)    || 0,
      qty_36:    Number(r.qty_36)    || 0,
      qty_40:    Number(r.qty_40)    || 0,
      qty_45:    Number(r.qty_45)    || 0,
      qty_meter: Number(r.qty_meter) || 0,
    };
  }

  // 2b. Fetch production allocations totals per PO
  const { data: prodAllocs } = await supabase
    .from("production_allocations")
    .select("po_id, qty_31, qty_36, qty_40, qty_45, qty_meter")
    .in("po_id", poIds);

  const prodByPO: Record<string, { qty_31: number; qty_36: number; qty_40: number; qty_45: number; qty_meter: number }> = {};
  for (const r of prodAllocs || []) {
    if (!prodByPO[r.po_id]) prodByPO[r.po_id] = { qty_31: 0, qty_36: 0, qty_40: 0, qty_45: 0, qty_meter: 0 };
    prodByPO[r.po_id].qty_31 += r.qty_31 || 0;
    prodByPO[r.po_id].qty_36 += r.qty_36 || 0;
    prodByPO[r.po_id].qty_40 += r.qty_40 || 0;
    prodByPO[r.po_id].qty_45 += r.qty_45 || 0;
    prodByPO[r.po_id].qty_meter += r.qty_meter || 0;
  }

  // 2b. Fetch recent production entries (last 14 days) for delivery forecast
  // Join through production_allocations to get daily totals per PO
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 14);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);

  const { data: recentAllocs } = await supabase
    .from("production_allocations")
    .select("po_id, qty_31, qty_36, qty_45, qty_meter, production_entries!inner(entry_date)")
    .in("po_id", poIds)
    .filter("production_entries.entry_date", "gte", cutoffStr);

  // Map: po_id → Set of distinct days with total production per day
  const dailyByPO: Record<string, Record<string, number>> = {};
  for (const r of recentAllocs || []) {
    const entries = r.production_entries as unknown as { entry_date: string }[] | { entry_date: string } | null;
    const date = Array.isArray(entries) ? entries[0]?.entry_date : entries?.entry_date;
    if (!date) continue;
    if (!dailyByPO[r.po_id]) dailyByPO[r.po_id] = {};
    const dayTotal = (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0) + (r.qty_meter || 0);
    dailyByPO[r.po_id][date] = (dailyByPO[r.po_id][date] || 0) + dayTotal;
  }

  // avg daily rate per PO (total produced in window / 14 days, not just active days — smooths weekends/stoppages)
  const avgDailyRateByPO: Record<string, number> = {};
  for (const [poId, days] of Object.entries(dailyByPO)) {
    const totalInWindow = Object.values(days).reduce((s, v) => s + v, 0);
    avgDailyRateByPO[poId] = totalInWindow / 14;
  }

  // 3. Fetch authority letters with dispatch totals and expiry_date
  const { data: letters } = await supabase
    .from("authority_letters")
    .select("*, contractors(name, contact_phone), dispatch_records(qty_31, qty_36, qty_40, qty_45, qty_meter)")
    .in("po_id", poIds)
    .order("issue_date", { ascending: false });

  // Build per-letter dispatch totals (opening + records)
  type LetterSummary = {
    id: string;
    po_id: string;
    contractor_id: string;
    contractor_name: string;
    contractor_phone: string | null;
    letter_number: string;
    issue_date: string;
    expiry_date: string | null;
    issued_by: string;
    qty_31: number; qty_36: number; qty_40: number; qty_45: number; qty_meter: number;
    dispatched_31: number; dispatched_36: number; dispatched_40: number; dispatched_45: number; dispatched_meter: number;
    remaining_31: number; remaining_36: number; remaining_40: number; remaining_45: number; remaining_meter: number;
    notes: string | null;
  };

  const letterSummaries: LetterSummary[] = (letters || []).map((l) => {
    const dispatched_31 = (l.opening_dispatched_31 || 0) + (l.dispatch_records || []).reduce((s: number, d: { qty_31: number }) => s + (d.qty_31 || 0), 0);
    const dispatched_36 = (l.opening_dispatched_36 || 0) + (l.dispatch_records || []).reduce((s: number, d: { qty_36: number }) => s + (d.qty_36 || 0), 0);
    const dispatched_40 = (l.opening_dispatched_40 || 0) + (l.dispatch_records || []).reduce((s: number, d: { qty_40: number }) => s + (d.qty_40 || 0), 0);
    const dispatched_45 = (l.opening_dispatched_45 || 0) + (l.dispatch_records || []).reduce((s: number, d: { qty_45: number }) => s + (d.qty_45 || 0), 0);
    const dispatched_meter = (l.opening_dispatched_meter || 0) + (l.dispatch_records || []).reduce((s: number, d: { qty_meter: number }) => s + (d.qty_meter || 0), 0);
    return {
      id: l.id,
      po_id: l.po_id,
      contractor_id: l.contractor_id,
      contractor_name: l.contractors?.name || "",
      contractor_phone: l.contractors?.contact_phone || null,
      letter_number: l.letter_number,
      issue_date: l.issue_date,
      expiry_date: l.expiry_date || null,
      issued_by: l.issued_by,
      qty_31: l.qty_31, qty_36: l.qty_36, qty_40: l.qty_40 || 0, qty_45: l.qty_45, qty_meter: l.qty_meter,
      dispatched_31, dispatched_36, dispatched_40, dispatched_45, dispatched_meter,
      remaining_31: Math.max(0, l.qty_31 - dispatched_31),
      remaining_36: Math.max(0, l.qty_36 - dispatched_36),
      remaining_40: Math.max(0, (l.qty_40 || 0) - dispatched_40),
      remaining_45: Math.max(0, l.qty_45 - dispatched_45),
      remaining_meter: Math.max(0, l.qty_meter - dispatched_meter),
      notes: l.notes,
    };
  });

  // 4. Group letters by contractor per PO
  type ContractorGroup = {
    contractor_id: string;
    contractor_name: string;
    contractor_phone: string | null;
    letters: LetterSummary[];
    total_authorized_31: number; total_authorized_36: number; total_authorized_40: number; total_authorized_45: number; total_authorized_meter: number;
    total_dispatched_31: number; total_dispatched_36: number; total_dispatched_40: number; total_dispatched_45: number; total_dispatched_meter: number;
    total_remaining_31: number; total_remaining_36: number; total_remaining_40: number; total_remaining_45: number; total_remaining_meter: number;
  };

  // 5. Build the final PO summary with nested contractors/letters
  const summary = (pos || []).map((po) => {
    const poLetters = letterSummaries.filter((l) => l.po_id === po.id);

    // Group by contractor
    const contractorMap = new Map<string, ContractorGroup>();
    for (const l of poLetters) {
      if (!contractorMap.has(l.contractor_id)) {
        contractorMap.set(l.contractor_id, {
          contractor_id: l.contractor_id,
          contractor_name: l.contractor_name,
          contractor_phone: l.contractor_phone,
          letters: [],
          total_authorized_31: 0, total_authorized_36: 0, total_authorized_40: 0, total_authorized_45: 0, total_authorized_meter: 0,
          total_dispatched_31: 0, total_dispatched_36: 0, total_dispatched_40: 0, total_dispatched_45: 0, total_dispatched_meter: 0,
          total_remaining_31: 0, total_remaining_36: 0, total_remaining_40: 0, total_remaining_45: 0, total_remaining_meter: 0,
        });
      }
      const cg = contractorMap.get(l.contractor_id)!;
      cg.letters.push(l);
      cg.total_authorized_31 += l.qty_31; cg.total_authorized_36 += l.qty_36;
      cg.total_authorized_40 += l.qty_40; cg.total_authorized_45 += l.qty_45; cg.total_authorized_meter += l.qty_meter;
      cg.total_dispatched_31 += l.dispatched_31; cg.total_dispatched_36 += l.dispatched_36;
      cg.total_dispatched_40 += l.dispatched_40; cg.total_dispatched_45 += l.dispatched_45; cg.total_dispatched_meter += l.dispatched_meter;
      cg.total_remaining_31 += l.remaining_31; cg.total_remaining_36 += l.remaining_36;
      cg.total_remaining_40 += l.remaining_40; cg.total_remaining_45 += l.remaining_45; cg.total_remaining_meter += l.remaining_meter;
    }

    const prod = prodByPO[po.id] || { qty_31: 0, qty_36: 0, qty_40: 0, qty_45: 0, qty_meter: 0 };
    const opening = openingByPO[po.id] || { qty_31: 0, qty_36: 0, qty_40: 0, qty_45: 0, qty_meter: 0 };
    // opening_stock_allocations (PO-level) takes precedence over the legacy opening_produced_* backfill fields
    const hasAllocation = opening.qty_31 > 0 || opening.qty_36 > 0 || opening.qty_40 > 0 || opening.qty_45 > 0 || opening.qty_meter > 0;
    const produced_31 = prod.qty_31 + (hasAllocation ? opening.qty_31 : (po.opening_produced_31 || 0));
    const produced_36 = prod.qty_36 + (hasAllocation ? opening.qty_36 : (po.opening_produced_36 || 0));
    const produced_40 = prod.qty_40 + (hasAllocation ? opening.qty_40 : (po.opening_produced_40 || 0));
    const produced_45 = prod.qty_45 + (hasAllocation ? opening.qty_45 : (po.opening_produced_45 || 0));
    const produced_meter = prod.qty_meter + (hasAllocation ? opening.qty_meter : (po.opening_produced_meter || 0));

    const totalDispatched_31 = poLetters.reduce((s, l) => s + l.dispatched_31, 0);
    const totalDispatched_36 = poLetters.reduce((s, l) => s + l.dispatched_36, 0);
    const totalDispatched_40 = poLetters.reduce((s, l) => s + l.dispatched_40, 0);
    const totalDispatched_45 = poLetters.reduce((s, l) => s + l.dispatched_45, 0);
    const totalDispatched_meter = poLetters.reduce((s, l) => s + l.dispatched_meter, 0);

    const ordered_total = po.ordered_31 + po.ordered_36 + (po.ordered_40 || 0) + po.ordered_45 + po.ordered_meter;
    const produced_total = produced_31 + produced_36 + produced_45 + produced_meter;
    const fulfillment_pct = ordered_total > 0 ? Math.round((produced_total / ordered_total) * 100) : null;

    // Delivery forecast: estimate completion date from 14-day avg daily production rate
    const daily_rate = avgDailyRateByPO[po.id] || 0;
    let estimated_completion_date: string | null = null;
    if (po.status === "Active" && !po.is_system_unallocated && daily_rate > 0 && ordered_total > produced_total) {
      const remaining_total = ordered_total - produced_total;
      const daysNeeded = Math.ceil(remaining_total / daily_rate);
      const est = new Date();
      est.setDate(est.getDate() + daysNeeded);
      estimated_completion_date = est.toISOString().slice(0, 10);
    }

    return {
      po: {
        id: po.id, plant_id: po.plant_id, plant_name: po.plant_name,
        customer_name: po.customer_name, po_number: po.po_number, po_label: po.po_label,
        ordered_31: po.ordered_31, ordered_36: po.ordered_36, ordered_40: po.ordered_40 || 0, ordered_45: po.ordered_45, ordered_meter: po.ordered_meter,
        variance_pct: po.variance_pct, status: po.status, is_system_unallocated: po.is_system_unallocated,
        start_date: po.start_date, notes: po.notes,
        produced_31, produced_36, produced_40, produced_45, produced_meter,
        dispatched_31: totalDispatched_31, dispatched_36: totalDispatched_36,
        dispatched_40: totalDispatched_40, dispatched_45: totalDispatched_45, dispatched_meter: totalDispatched_meter,
        in_stock_31: Math.max(0, produced_31 - totalDispatched_31),
        in_stock_36: Math.max(0, produced_36 - totalDispatched_36),
        in_stock_40: Math.max(0, produced_40 - totalDispatched_40),
        in_stock_45: Math.max(0, produced_45 - totalDispatched_45),
        in_stock_meter: Math.max(0, produced_meter - totalDispatched_meter),
        fulfillment_pct,
        daily_rate: Math.round(daily_rate),
        estimated_completion_date,
      },
      contractors: Array.from(contractorMap.values()),
    };
  });

  return Response.json({ summary });
}
