/**
 * GET /api/flowhcm/data?module=salary_setup&search=ali&limit=100
 * ─────────────────────────────────────────────────────────────────
 * Serves all new FlowHCM tables for the HR "Live HR Data" tab.
 * Returns { rows, total, last_synced }
 */

import { NextRequest } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";

const ALLOWED_MODULES: Record<string, { table: string; cols: string }> = {
  employees:      { table: "flw_employees",      cols: "employee_code,full_name,designation,department,station,company,status,joining_date,email,mobile,grade,synced_at" },
  salary_setup:   { table: "flw_salary_setup",   cols: "employee_code,employee_name,grade,basic_salary,gross_salary,currency,effective_date,synced_at" },
  advances:       { table: "flw_advance_salary",  cols: "employee_code,employee_name,request_date,amount,approved_amount,repayment_months,status,approved_by,remarks,synced_at" },
  allowances:     { table: "flw_allowances",      cols: "employee_code,employee_name,year,month,allowance_type,amount,status,synced_at" },
  deductions:     { table: "flw_deductions",      cols: "employee_code,employee_name,year,month,deduction_type,amount,status,synced_at" },
  overtime:       { table: "flw_overtime",        cols: "employee_code,employee_name,overtime_date,hours,rate_multiplier,amount,status,approved_by,synced_at" },
  pf_data:        { table: "flw_pf_data",         cols: "employee_code,employee_name,pf_type,employee_contribution,employer_contribution,effective_date,status,synced_at" },
  tax:            { table: "flw_tax_adjustments", cols: "employee_code,employee_name,tax_year,adjustment_type,amount,reason,status,synced_at" },
  transfers:      { table: "flw_transfers",       cols: "employee_code,employee_name,from_department,to_department,from_company,to_company,transfer_date,effective_date,transfer_type,status,synced_at" },
  exits:          { table: "flw_employee_exits",  cols: "employee_code,employee_name,department,designation,joining_date,leaving_date,exit_type,reason,notice_period_days,clearance_status,synced_at" },
  exemptions:     { table: "flw_exemptions",      cols: "employee_code,employee_name,exemption_date,exemption_type,reason,status,approved_by,synced_at" },
  loans:          { table: "flw_loans",           cols: "employee_code,employee_name,loan_type,principal_amount,outstanding_amount,monthly_deduction,start_date,expected_end_date,status,synced_at" },
};

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const module = searchParams.get("module") ?? "";
  const search = searchParams.get("search") ?? "";
  const limit  = Math.min(500, Math.max(10, parseInt(searchParams.get("limit") ?? "200", 10)));

  const cfg = ALLOWED_MODULES[module];
  if (!cfg) {
    return Response.json({ error: `Unknown module. Valid: ${Object.keys(ALLOWED_MODULES).join(", ")}` }, { status: 400 });
  }

  const db = createServiceClient();

  // Get last sync time for this module
  const { data: logRow } = await db
    .from("flw_sync_log")
    .select("synced_at, records_synced, status, error_message")
    .eq("module", module === "advances" ? "advance_salary" : module === "tax" ? "tax_adjustments" : module)
    .order("synced_at", { ascending: false })
    .limit(1)
    .single();

  // Fetch rows
  let query = db
    .from(cfg.table)
    .select(cfg.cols, { count: "exact" })
    .order("synced_at", { ascending: false })
    .limit(limit);

  // Simple search across employee_code and employee_name / full_name
  if (search) {
    const nameCol = module === "employees" ? "full_name" : "employee_name";
    query = query.or(`employee_code.ilike.%${search}%,${nameCol}.ilike.%${search}%`);
  }

  const { data: rows, error, count } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    module,
    rows:        rows ?? [],
    total:       count ?? 0,
    last_synced: logRow?.synced_at ?? null,
    sync_status: logRow?.status ?? null,
    sync_error:  logRow?.error_message ?? null,
  });
}
