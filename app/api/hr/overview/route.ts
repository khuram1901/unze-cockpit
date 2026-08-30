/**
 * GET /api/hr/overview?section=people|payroll|movement|attendance|people_list
 * ─────────────────────────────────────────────────────────────────
 * Thin wrapper over the HR dashboard RPCs (migration 216).
 * All aggregation happens in Postgres — this route only checks auth,
 * calls the RPC, and returns the jsonb payload.
 *
 * Params:
 *   payroll:    ?year=2026&month=8
 *   movement:   ?from=2026-08-01&to=2026-08-31
 *   attendance: ?date=2026-08-30
 *   people_list: ?search=&company=&active=1&limit=100&offset=0
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const section = searchParams.get("section") ?? "people";
  const db = createServiceClient();

  try {
    // Role gate (30/08/2026 audit): HR overview data — including the employee
    // directory with contact details — is for management roles, not every
    // logged-in member. Payroll is stricter still: financial data, so
    // Admin/CEO + HR/Finance Managers only (PA never sees it — rule 6).
    const { data: member } = await db
      .from("members")
      .select("role, department")
      .eq("email", auth.email)
      .maybeSingle();
    const role = member?.role ?? "";
    const dept = member?.department ?? "";
    const isManagement =
      role === "Admin" || role === "CEO" || role === "Manager" || role === "Executive";
    if (!isManagement) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (section === "payroll") {
      const payrollAllowed =
        role === "Admin" || role === "CEO" ||
        (role === "Manager" && (dept === "HR" || dept === "Finance"));
      if (!payrollAllowed) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    if (section === "people") {
      const { data, error } = await db.rpc("get_hr_people_overview");
      if (error) throw new Error(error.message);
      return NextResponse.json(data);
    }

    if (section === "payroll") {
      const now = new Date();
      const year  = parseInt(searchParams.get("year")  ?? String(now.getFullYear()));
      const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1));
      const { data, error } = await db.rpc("get_hr_payroll_insights", { p_year: year, p_month: month });
      if (error) throw new Error(error.message);
      return NextResponse.json(data);
    }

    if (section === "movement") {
      const to   = searchParams.get("to")   ?? new Date().toISOString().slice(0, 10);
      const from = searchParams.get("from") ?? new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
      const { data, error } = await db.rpc("get_hr_movement", { p_from: from, p_to: to });
      if (error) throw new Error(error.message);
      return NextResponse.json(data);
    }

    if (section === "attendance") {
      const date = searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
      const { data, error } = await db.rpc("get_hr_attendance_overview", { p_date: date });
      if (error) throw new Error(error.message);
      return NextResponse.json(data);
    }

    if (section === "people_list") {
      // Sanitise: commas/parens/percent would corrupt the PostgREST or() filter
      const search  = (searchParams.get("search") ?? "").trim().replace(/[,()%]/g, "");
      const company = searchParams.get("company") ?? "";
      const active  = searchParams.get("active") !== "0";   // default: active only
      const limit   = Math.min(parseInt(searchParams.get("limit") ?? "100"), 500);
      const offset  = parseInt(searchParams.get("offset") ?? "0");

      let q = db.from("flw_employees")
        .select("employee_code, full_name, designation, department, station, grade, status, email, mobile, joining_date, company_id, is_active", { count: "exact" })
        .order("full_name", { ascending: true })
        .range(offset, offset + limit - 1);

      if (active) q = q.eq("is_active", true);
      if (company) q = q.eq("company_id", company);
      if (search) q = q.or(`employee_code.ilike.%${search}%,full_name.ilike.%${search}%,designation.ilike.%${search}%`);

      const { data, count, error } = await q;
      if (error) throw new Error(error.message);
      return NextResponse.json({ rows: data ?? [], total: count ?? 0 });
    }

    return NextResponse.json({ error: "Unknown section" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
