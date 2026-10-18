import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import * as XLSX from "xlsx";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const from       = searchParams.get("from")   ?? undefined;
  const to         = searchParams.get("to")     ?? undefined;
  const status     = searchParams.get("status") ?? undefined;
  const department = searchParams.get("dept")   ?? undefined;
  const search     = searchParams.get("search") ?? undefined;

  const { data, error } = await supabase.rpc("visitor_list_paged", {
    p_date_from:  from       ?? null,
    p_date_to:    to         ?? null,
    p_status:     status     ?? null,
    p_department: department ?? null,
    p_search:     search     ?? null,
    p_limit:      10000,
    p_offset:     0,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows: Record<string, unknown>[] =
    (data as { rows: Record<string, unknown>[] })?.rows ?? [];

  function fmtTime(iso: string): string {
    return new Date(iso).toLocaleTimeString("en-GB", {
      timeZone: "Asia/Karachi",
      hour: "2-digit", minute: "2-digit",
    });
  }
  function fmtDate(iso: string): string {
    return iso ? iso.split("-").reverse().join("/") : "";
  }
  function fmtDur(mins: unknown): string {
    if (mins == null) return "";
    const m = Number(mins);
    const h = Math.floor(m / 60);
    return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
  }

  const sheetRows = rows.map((r) => ({
    "Date":            fmtDate(r.visit_date as string),
    "Time In (PKT)":   r.time_in  ? fmtTime(r.time_in  as string) : "",
    "Time Out (PKT)":  r.time_out ? fmtTime(r.time_out as string) : "",
    "Duration":        fmtDur(r.duration_mins),
    "Visitor Name":    r.visitor_name   ?? "",
    "Mobile":          r.mobile_masked  ?? "",
    "CNIC":            r.cnic_masked    ?? "",
    "Department":      r.department_name ?? "",
    "Host":            r.host_name      ?? "",
    "Purpose":         r.purpose === "Other" ? (r.purpose_other ?? "Other") : (r.purpose ?? ""),
    "Notes":           r.comments       ?? "",
    "Status":          r.is_inside ? "Inside" : "Checked Out",
    "Flag":            r.flag_type      ?? "",
    "Entered By":      r.entered_by_name ?? "",
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetRows);

  // Column widths
  ws["!cols"] = [
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
    { wch: 22 }, { wch: 14 }, { wch: 16 }, { wch: 18 },
    { wch: 18 }, { wch: 16 }, { wch: 24 }, { wch: 12 },
    { wch: 10 }, { wch: 18 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Visitor Log");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const filename = `visitor-log-${from ?? "all"}-to-${to ?? "all"}.xlsx`;

  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
