import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// Returns performance metrics per contractor for a given plant
// Metrics: letters issued, total authorised, total collected, collection %, avg days to full collection, partial count
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const plantId = searchParams.get("plantId");

  if (!plantId) return Response.json({ error: "plantId is required" }, { status: 400 });

  // 1. Get all POs for this plant (to scope contractors)
  const { data: pos, error: poErr } = await supabase
    .from("purchase_orders")
    .select("id")
    .eq("plant_id", plantId);
  if (poErr) return Response.json({ error: poErr.message }, { status: 500 });

  const poIds = (pos || []).map((p) => p.id);
  if (poIds.length === 0) return Response.json({ performance: [] });

  // 2. Fetch all authority letters for these POs, with contractor info + dispatch records
  const { data: letters, error: lErr } = await supabase
    .from("authority_letters")
    .select(`
      id, po_id, contractor_id, letter_number, issue_date, expiry_date,
      qty_31, qty_36, qty_45, qty_meter,
      opening_dispatched_31, opening_dispatched_36, opening_dispatched_45, opening_dispatched_meter,
      contractors(id, name, contact_phone),
      dispatch_records(dispatch_date, qty_31, qty_36, qty_45, qty_meter)
    `)
    .in("po_id", poIds)
    .order("issue_date", { ascending: true });

  if (lErr) return Response.json({ error: lErr.message }, { status: 500 });

  // 3. Aggregate per contractor
  type ContractorPerf = {
    contractor_id: string;
    contractor_name: string;
    contractor_phone: string | null;
    letters_issued: number;
    total_authorised: number;
    total_collected: number;
    collection_pct: number;
    letters_fully_collected: number;
    letters_partial: number;
    letters_not_started: number;
    avg_days_to_full_collection: number | null; // null if no letter has been fully collected yet
    fastest_days: number | null;
    slowest_days: number | null;
  };

  const contractorMap = new Map<string, ContractorPerf>();

  for (const l of letters || []) {
    const rawContractor = l.contractors as unknown;
    const contractor = (Array.isArray(rawContractor) ? rawContractor[0] : rawContractor) as { id: string; name: string; contact_phone: string | null } | null;
    if (!contractor) continue;

    const cid = contractor.id;
    if (!contractorMap.has(cid)) {
      contractorMap.set(cid, {
        contractor_id: cid,
        contractor_name: contractor.name,
        contractor_phone: contractor.contact_phone,
        letters_issued: 0,
        total_authorised: 0,
        total_collected: 0,
        collection_pct: 0,
        letters_fully_collected: 0,
        letters_partial: 0,
        letters_not_started: 0,
        avg_days_to_full_collection: null,
        fastest_days: null,
        slowest_days: null,
      });
    }

    const perf = contractorMap.get(cid)!;
    const records = (l.dispatch_records || []) as { dispatch_date: string; qty_31: number; qty_36: number; qty_45: number; qty_meter: number }[];

    const authorised = (l.qty_31 || 0) + (l.qty_36 || 0) + (l.qty_45 || 0) + (l.qty_meter || 0);
    const openingDispatched = (l.opening_dispatched_31 || 0) + (l.opening_dispatched_36 || 0) + (l.opening_dispatched_45 || 0) + (l.opening_dispatched_meter || 0);
    const liveDispatched = records.reduce((s, r) => s + (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0) + (r.qty_meter || 0), 0);
    const collected = openingDispatched + liveDispatched;
    const remaining = Math.max(0, authorised - collected);

    perf.letters_issued += 1;
    perf.total_authorised += authorised;
    perf.total_collected += collected;

    if (authorised > 0 && remaining === 0) {
      perf.letters_fully_collected += 1;

      // Avg days to full collection: from issue_date to last dispatch_date
      // Only count live dispatch records (opening balance has no date)
      const dates = records.map((r) => r.dispatch_date).filter(Boolean).sort();
      if (dates.length > 0) {
        const issueMs = new Date(l.issue_date).getTime();
        const lastDispatchMs = new Date(dates[dates.length - 1]).getTime();
        const days = Math.round((lastDispatchMs - issueMs) / 86400000);

        // Accumulate for average — store sum and count separately via a side channel
        // We'll use a trick: store running sum in avg_days_to_full_collection and count in fastest_days temporarily
        // then normalise after the loop. Use a separate accumulator object.
        const prev = (perf as unknown as { _daysSum: number; _daysCount: number });
        prev._daysSum = (prev._daysSum || 0) + days;
        prev._daysCount = (prev._daysCount || 0) + 1;

        if (perf.fastest_days === null || days < perf.fastest_days) perf.fastest_days = days;
        if (perf.slowest_days === null || days > perf.slowest_days) perf.slowest_days = days;
      }
    } else if (collected > 0 && remaining > 0) {
      perf.letters_partial += 1;
    } else if (collected === 0) {
      perf.letters_not_started += 1;
    }
  }

  // Finalise averages and collection_pct
  const performance = Array.from(contractorMap.values()).map((perf) => {
    const raw = perf as unknown as { _daysSum?: number; _daysCount?: number };
    const avg = raw._daysCount && raw._daysCount > 0 ? Math.round(raw._daysSum! / raw._daysCount) : null;
    return {
      contractor_id: perf.contractor_id,
      contractor_name: perf.contractor_name,
      contractor_phone: perf.contractor_phone,
      letters_issued: perf.letters_issued,
      total_authorised: perf.total_authorised,
      total_collected: perf.total_collected,
      collection_pct: perf.total_authorised > 0 ? Math.round((perf.total_collected / perf.total_authorised) * 100) : 0,
      letters_fully_collected: perf.letters_fully_collected,
      letters_partial: perf.letters_partial,
      letters_not_started: perf.letters_not_started,
      avg_days_to_full_collection: avg,
      fastest_days: perf.fastest_days,
      slowest_days: perf.slowest_days,
    };
  }).sort((a, b) => b.total_collected - a.total_collected); // best collectors first

  return Response.json({ performance });
}
