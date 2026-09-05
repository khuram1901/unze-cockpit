/**
 * GET /api/hr/overview?section=people|payroll|movement|attendance|people_list|filters
 * ─────────────────────────────────────────────────────────────────
 * Thin wrapper over the HR dashboard RPCs (migration 216).
 * All aggregation happens in Postgres — this route only checks auth,
 * calls the RPC, and returns the jsonb payload.
 *
 * Params:
 *   people:     ?company=&department=&station=
 *   payroll:    ?year=2026&month=8&company=&department=&location=
 *   movement:   ?from=2026-08-01&to=2026-08-31&company=&department=
 *   attendance: ?date=2026-08-30&company=&station=
 *   people_list: ?search=&company=&department=&station=&active=1&limit=100&offset=0
 *   filters:    dropdown options (companies, departments, stations, locations, payroll months)
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

    // Optional filter params (migration 233). UUIDs validated; blank = null.
    const uuidOrNull = (k: string) => {
      const v = (searchParams.get(k) ?? "").trim();
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
    };
    const textOrNull = (k: string) => {
      const v = (searchParams.get(k) ?? "").trim();
      return v ? v : null;
    };

    if (section === "filters") {
      const { data, error } = await db.rpc("get_hr_filter_options");
      if (error) throw new Error(error.message);
      return NextResponse.json(data);
    }

    if (section === "people") {
      const { data, error } = await db.rpc("get_hr_people_overview", {
        p_company: uuidOrNull("company"),
        p_department: uuidOrNull("department"),
        p_station: textOrNull("station"),
      });
      if (error) throw new Error(error.message);
      return NextResponse.json(data);
    }

    if (section === "payroll") {
      const now = new Date();
      const year  = parseInt(searchParams.get("year")  ?? String(now.getFullYear()));
      const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1));
      const { data, error } = await db.rpc("get_hr_payroll_insights", {
        p_year: year, p_month: month,
        p_company: uuidOrNull("company"),
        p_department: uuidOrNull("department"),
        p_location: uuidOrNull("location"),
      });
      if (error) throw new Error(error.message);
      return NextResponse.json(data);
    }

    if (section === "movement") {
      const to   = searchParams.get("to")   ?? new Date().toISOString().slice(0, 10);
      const from = searchParams.get("from") ?? new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
      const { data, error } = await db.rpc("get_hr_movement", {
        p_from: from, p_to: to,
        p_company: uuidOrNull("company"),
        p_department: uuidOrNull("department"),
      });
      if (error) throw new Error(error.message);
      return NextResponse.json(data);
    }

    if (section === "attendance") {
      const date = searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
      const { data, error } = await db.rpc("get_hr_attendance_overview", {
        p_date: date,
        p_company: uuidOrNull("company"),
        p_station: textOrNull("station"),
      });
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

      // hr_employees_view joins flw_employees with members on employee_code,
      // preferring members.first_name+last_name as display_name when linked.
      let q = db.from("hr_employees_view")
        .select("employee_code, display_name, flw_name, designation, department, department_id, station, grade, status, email, mobile, joining_date, company_id, is_active, member_id, member_role, member_photo", { count: "exact" })
        .order("display_name", { ascending: true })
        .range(offset, offset + limit - 1);

      const deptId  = uuidOrNull("department");
      const station = textOrNull("station");
      if (active) q = q.eq("is_active", true);
      if (company) q = q.eq("company_id", company);
      if (deptId) q = q.eq("department_id", deptId);
      if (station) q = q.eq("station", station);
      if (search) q = q.or(`employee_code.ilike.%${search}%,display_name.ilike.%${search}%,flw_name.ilike.%${search}%,designation.ilike.%${search}%`);

      const { data, count, error } = await q;
      if (error) throw new Error(error.message);
      return NextResponse.json({ rows: data ?? [], total: count ?? 0 });
    }

    return NextResponse.json({ error: "Unknown section" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
