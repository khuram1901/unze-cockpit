/**
 * /api/admin/generators — generator meta, fuel log, maintenance log
 *
 * GET  ?type=meta                        → generators + locations for dropdowns
 * GET  ?type=last_refuel&generator_id=…  → previous hours for next refuel entry
 * GET  ?type=fuel_table&…                → admin fuel table (paginated)
 * GET  ?type=maint_table&…               → admin maintenance table (paginated)
 * GET  ?type=summary                     → summary cards + flag data
 * POST ?type=fuel                        → insert fuel refuel
 * POST ?type=maintenance                 → insert maintenance record
 * POST ?type=upsert_generator            → add or edit generator master
 * POST ?type=upsert_thresholds           → update alert thresholds
 * PATCH ?type=fuel                       → edit fuel row (admin only)
 * PATCH ?type=maintenance                → edit maintenance row (admin only)
 * DELETE ?type=fuel                      → soft-delete fuel row
 * DELETE ?type=maintenance               → soft-delete maintenance row
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

// ── Auth helpers ──────────────────────────────────────────────────────────────

async function isAdmin(_email: string): Promise<boolean> {
  const sb = createServiceClient();
  const { data } = await sb.rpc("is_generator_admin");
  return !!data;
}

/** Creates a Supabase client that carries the user's JWT so auth.email() works inside RPCs. */
function createUserClient(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } },
  );
}


// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "meta";
  const sb = createServiceClient();

  // ── meta: flat rows for entry dropdowns ──────────────────────────────────
  // Returns [{location_id, location_name, generator_id, kva, model, label}]
  // The page groups by location_id itself using <optgroup>.
  if (type === "meta") {
    const { data, error } = await sb.rpc("get_generators_meta");
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data: data ?? [] });
  }

  // ── last_refuel: previous hours for a generator ───────────────────────────
  if (type === "last_refuel") {
    const generator_id = searchParams.get("generator_id");
    if (!generator_id) return Response.json({ data: null });
    const { data, error } = await sb.rpc("get_last_generator_refuel", { p_generator_id: generator_id });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data: data?.[0] ?? null });
  }

  // ── fuel_table: admin diesel table ────────────────────────────────────────
  if (type === "fuel_table") {
    const { data, error } = await sb.rpc("get_generator_fuel_table", {
      p_location_id:    searchParams.get("location_id")    || null,
      p_generator_id:   searchParams.get("generator_id")   || null,
      p_date_from:      searchParams.get("date_from")      || null,
      p_date_to:        searchParams.get("date_to")        || null,
      p_search:         searchParams.get("search")         || null,
      p_limit:          parseInt(searchParams.get("limit") ?? "100"),
      p_offset:         parseInt(searchParams.get("offset") ?? "0"),
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data: data ?? [] });
  }

  // ── maint_table: admin maintenance table ──────────────────────────────────
  if (type === "maint_table") {
    const { data, error } = await sb.rpc("get_generator_maintenance_table", {
      p_location_id:    searchParams.get("location_id")    || null,
      p_generator_id:   searchParams.get("generator_id")   || null,
      p_date_from:      searchParams.get("date_from")      || null,
      p_date_to:        searchParams.get("date_to")        || null,
      p_search:         searchParams.get("search")         || null,
      p_limit:          parseInt(searchParams.get("limit") ?? "100"),
      p_offset:         parseInt(searchParams.get("offset") ?? "0"),
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data: data ?? [] });
  }

  // ── summary: KPI cards + alerts ───────────────────────────────────────────
  if (type === "summary") {
    const [summaryRes, maintCatRes] = await Promise.all([
      sb.rpc("get_generator_summary"),
      sb.rpc("get_generator_maintenance_by_category", {
        p_date_from: searchParams.get("date_from") || null,
        p_date_to:   searchParams.get("date_to")   || null,
      }),
    ]);
    if (summaryRes.error)  return Response.json({ error: summaryRes.error.message },  { status: 500 });
    if (maintCatRes.error) return Response.json({ error: maintCatRes.error.message }, { status: 500 });
    return Response.json({ summary: summaryRes.data ?? [], maint_by_cat: maintCatRes.data ?? [] });
  }

  // ── analytics: per-location fuel + maintenance infographics ──────────────
  if (type === "analytics") {
    const { data, error } = await sb.rpc("get_generator_analytics", {
      p_date_from: searchParams.get("from") || null,
      p_date_to:   searchParams.get("to")   || null,
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ data: data ?? [] });
  }

  return Response.json({ error: "Unknown type" }, { status: 400 });
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "fuel";
  const body = await request.json();
  // User-context client: carries the caller's JWT so auth.email() works inside entry RPCs
  const userSb = createUserClient(request);
  const sb = createServiceClient(); // service client for admin-only ops

  // ── fuel entry ────────────────────────────────────────────────────────────
  if (type === "fuel") {
    const { generator_id, refuel_date, previous_hours, present_hours, rate_per_litre, qty_litres, remarks } = body;
    if (!generator_id || !refuel_date || !present_hours || !rate_per_litre || !qty_litres) {
      return Response.json({ error: "generator_id, refuel_date, present_hours, rate_per_litre, qty_litres are required" }, { status: 400 });
    }
    // RPC uses auth.email() internally — must use userSb (user JWT), NOT service client
    const { error } = await userSb.rpc("insert_generator_fuel", {
      p_generator_id:   generator_id,
      p_refuel_date:    refuel_date,
      p_previous_hours: previous_hours != null ? parseFloat(previous_hours) : null,
      p_present_hours:  parseFloat(present_hours),
      p_rate_per_litre: parseFloat(rate_per_litre),
      p_qty_litres:     parseFloat(qty_litres),
      p_remarks:        remarks || null,
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  // ── maintenance entry ─────────────────────────────────────────────────────
  if (type === "maintenance") {
    const {
      generator_id, service_date,
      engine_oil, oil_filter, fuel_filter, air_filter,
      radiator_service, periodic_maintenance, other_mechanical, others,
      vendor, previous_hours, service_hours,
      remarks,
    } = body;
    if (!generator_id || !service_date) {
      return Response.json({ error: "generator_id and service_date are required" }, { status: 400 });
    }
    // RPC uses auth.email() internally — must use userSb (user JWT), NOT service client
    const { error } = await userSb.rpc("insert_generator_maintenance", {
      p_generator_id:          generator_id,
      p_maintenance_date:      service_date,
      p_engine_oil:            parseFloat(engine_oil || "0"),
      p_oil_filter:            parseFloat(oil_filter || "0"),
      p_fuel_filter:           parseFloat(fuel_filter || "0"),
      p_air_filter:            parseFloat(air_filter || "0"),
      p_radiator_service:      parseFloat(radiator_service || "0"),
      p_periodic_maintenance:  parseFloat(periodic_maintenance || "0"),
      p_other_mechanical_work: parseFloat(other_mechanical || "0"),
      p_others:                parseFloat(others || "0"),
      p_vendor:                vendor || null,
      p_previous_hours:        previous_hours ? parseFloat(previous_hours) : null,
      p_service_hours:         service_hours  ? parseFloat(service_hours)  : null,
      p_remarks:               remarks || null,
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  // ── upsert generator master ───────────────────────────────────────────────
  if (type === "upsert_generator") {
    const admin = await isAdmin(auth.email);
    if (!admin) return Response.json({ error: "Admin access required" }, { status: 403 });
    const { id, location_id, kva, model, label, is_active } = body;
    if (!location_id || !kva || !model) {
      return Response.json({ error: "location_id, kva, model are required" }, { status: 400 });
    }
    const { error } = await sb.rpc("upsert_generator", {
      p_id:          id || null,
      p_location_id: location_id,
      p_kva:         parseInt(kva),
      p_model:       model,
      p_label:       label || null,
      p_is_active:   is_active ?? true,
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  // ── update thresholds ─────────────────────────────────────────────────────
  if (type === "upsert_thresholds") {
    const admin = await isAdmin(auth.email);
    if (!admin) return Response.json({ error: "Admin access required" }, { status: 403 });
    const { unusual_pct, service_hours, days_amber, days_red } = body;
    const { error } = await sb.rpc("update_generator_thresholds", {
      p_unusual_pct:   parseFloat(unusual_pct  || "50"),
      p_service_hours: parseFloat(service_hours || "250"),
      p_days_amber:    parseInt(days_amber      || "7"),
      p_days_red:      parseInt(days_red        || "14"),
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unknown type" }, { status: 400 });
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const admin = await isAdmin(auth.email);
  if (!admin) return Response.json({ error: "Admin access required" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "fuel";
  const body = await request.json();
  const sb = createServiceClient();

  if (type === "fuel") {
    const { id, generator_id, refuel_date, previous_hours, present_hours, rate_per_litre, qty_litres, remarks } = body;
    if (!id) return Response.json({ error: "id required" }, { status: 400 });
    const { error } = await sb.rpc("update_generator_fuel", {
      p_id:             id,
      p_generator_id:   generator_id || null,
      p_refuel_date:    refuel_date,
      p_previous_hours: previous_hours != null ? parseFloat(previous_hours) : null,
      p_present_hours:  present_hours  != null ? parseFloat(present_hours)  : null,
      p_rate_per_litre: parseFloat(rate_per_litre),
      p_qty_litres:     parseFloat(qty_litres),
      p_remarks:        remarks || null,
      p_updated_by:     auth.email,
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  if (type === "maintenance") {
    const { id, engine_oil, oil_filter, fuel_filter, air_filter, radiator_service, periodic_maintenance, other_mechanical, others, remarks } = body;
    if (!id) return Response.json({ error: "id required" }, { status: 400 });
    // Direct table update (no RPC needed for maintenance edits)
    // Column is other_mechanical_work, not other_mechanical
    const { error } = await sb.from("generator_maintenance_log").update({
      engine_oil:           parseFloat(engine_oil            || "0"),
      oil_filter:           parseFloat(oil_filter            || "0"),
      fuel_filter:          parseFloat(fuel_filter           || "0"),
      air_filter:           parseFloat(air_filter            || "0"),
      radiator_service:     parseFloat(radiator_service      || "0"),
      periodic_maintenance: parseFloat(periodic_maintenance  || "0"),
      other_mechanical_work: parseFloat(other_mechanical     || "0"),
      others:               parseFloat(others                || "0"),
      remarks:              remarks || null,
      updated_at:           new Date().toISOString(),
    }).eq("id", id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unknown type" }, { status: 400 });
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const admin = await isAdmin(auth.email);
  if (!admin) return Response.json({ error: "Admin access required" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "fuel";
  const id   = searchParams.get("id");
  const reason = searchParams.get("reason") || "Deleted by admin";

  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const sb = createServiceClient();

  if (type === "fuel") {
    const { error } = await sb.rpc("soft_delete_generator_fuel", { p_id: id, p_reason: reason });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  if (type === "maintenance") {
    const { error } = await sb.rpc("soft_delete_generator_maintenance", { p_id: id, p_reason: reason });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unknown type" }, { status: 400 });
}
