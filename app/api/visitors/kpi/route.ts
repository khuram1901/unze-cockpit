import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

/** GET /api/visitors/kpi
 * Returns KPI summary + dept summary + peak hours + exceptions.
 * Query: date_from, date_to, view (kpi|league|heatmap|exceptions)
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const sp = request.nextUrl.searchParams;
  const view = sp.get("view") || "kpi";
  const dateFrom = sp.get("date_from") || null;
  const dateTo   = sp.get("date_to")   || null;

  if (view === "kpi") {
    const { data, error } = await supabase.rpc("visitor_kpi", {
      p_date_from: dateFrom,
      p_date_to:   dateTo,
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json(data);
  }

  if (view === "league") {
    const { data, error } = await supabase.rpc("visitor_dept_summary", {
      p_date_from: dateFrom,
      p_date_to:   dateTo,
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json(data);
  }

  if (view === "heatmap") {
    const { data, error } = await supabase.rpc("visitor_peak_hours", {
      p_date_from: dateFrom,
      p_date_to:   dateTo,
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json(data);
  }

  if (view === "exceptions") {
    const { data, error } = await supabase.rpc("visitor_exceptions", {
      p_date_from: dateFrom,
      p_date_to:   dateTo,
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json(data);
  }

  return Response.json({ error: "Unknown view" }, { status: 400 });
}
