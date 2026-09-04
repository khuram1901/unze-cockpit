/**
 * GET /api/flowhcm/debug?code=7
 * Temporary: returns raw FlowHCM fields for a single employee so we can
 * identify the correct name field. Delete after diagnosing.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { flowhcm } from "../../../../lib/flowhcm-client";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const code = new URL(request.url).searchParams.get("code") ?? "";
  const employees = await flowhcm.getEmployees();
  const emp = (employees as any[]).find(
    (e: any) => String(e.EmployeeRefNo ?? e.EmployeeCode ?? e.employeeCode ?? "") === code
              || String(e.EmployeeCode ?? e.employeeCode ?? "") === code
  );
  if (!emp) return NextResponse.json({ error: "not found", code });
  return NextResponse.json(emp);
}
