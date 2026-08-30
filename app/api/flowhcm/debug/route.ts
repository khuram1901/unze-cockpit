/**
 * GET /api/flowhcm/debug?module=employees
 * Admin-only endpoint — returns raw first 2 records from FlowHCM to identify field names.
 * Remove this file after field names are confirmed.
 */

import { NextRequest } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { flowhcm } from "../../../../lib/flowhcm-client";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const module = searchParams.get("module") ?? "employees";

  try {
    let raw: any[] = [];
    if (module === "employees") raw = await flowhcm.getEmployees();
    if (module === "loans")     raw = await flowhcm.getLoans();
    if (module === "overtime")  raw = await flowhcm.getOvertime();

    return Response.json({
      module,
      count: raw.length,
      sample: raw.slice(0, 2),           // first 2 records
      keys:   raw[0] ? Object.keys(raw[0]) : [],  // all field names in first record
    });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
