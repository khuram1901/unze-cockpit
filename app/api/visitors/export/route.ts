import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? undefined;
  const to   = searchParams.get("to")   ?? undefined;

  // Reuse visitor_list_paged — masking is already role-aware (is_admin_tier / has_widget)
  const { data, error } = await supabase.rpc("visitor_list_paged", {
    p_date_from: from ?? null,
    p_date_to:   to   ?? null,
    p_limit:     10000,
    p_offset:    0,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows: Record<string, unknown>[] =
    (data as { rows: Record<string, unknown>[] })?.rows ?? [];

  // Build CSV
  const headers = [
    "Date", "Time In (PKT)", "Time Out (PKT)", "Duration (mins)",
    "Visitor Name", "Mobile", "CNIC", "Department", "Host",
    "Purpose", "Notes", "Flag", "Entered By",
  ];

  function fmtTime(iso: string): string {
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: "Asia/Karachi",
      hour: "2-digit", minute: "2-digit", day: "2-digit",
      month: "2-digit", year: "numeric",
    });
  }

  function csv(v: unknown): string {
    const s = v == null ? "" : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`; 
    }
    return s;
  }

  const lines: string[] = [headers.map(csv).join(",")];
  for (const r of rows) {
    lines.push([
      csv(r.visit_date),
      csv(r.time_in ? fmtTime(r.time_in as string) : ""),
      csv(r.time_out ? fmtTime(r.time_out as string) : ""),
      csv(r.duration_mins ?? ""),
      csv(r.visitor_name),
      csv(r.mobile_masked),
      csv(r.cnic_masked ?? ""),
      csv(r.department_name),
      csv(r.host_name),
      csv(r.purpose),
      csv(r.comments ?? ""),
      csv(r.flag_type ?? ""),
      csv(r.entered_by_name ?? ""),
    ].join(","));
  }

  const body = lines.join("\r\n");
  const filename = `visitor-log-${from ?? "all"}-to-${to ?? "all"}.csv`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
