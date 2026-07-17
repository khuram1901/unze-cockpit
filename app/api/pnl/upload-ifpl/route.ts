import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import type { ParsedIfplMonth } from "../../../lib/excel-parsers/pnl-ifpl-parser";
import { requireAuth } from "../../../lib/api-auth";
import { canViewIfplPnl, type UserCtx, type PermOverrides } from "../../../lib/permissions";

// The Imperial workbook is ~9.4 MB — over Vercel's 4.5 MB request-body cap —
// so the FILE never reaches this route. The page parses it in the browser
// (pnl-ifpl-parser runs client-side) and posts the extracted months as JSON
// (~1.5 MB). Each month was validated by the parser; accepted months replace
// whatever was stored for that month, rejected months leave old data alone.
export const maxDuration = 60;

const CHUNK = 1000;
const MAX_MONTHS = 40;
const MAX_LINES_PER_MONTH = 5000;
const CATEGORIES = new Set(["core", "overhead", "below_add", "below_less", "other"]);
const fin = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();

  const { data: member } = await supabase
    .from("members")
    .select("id, role, department, company")
    .eq("email", auth.email)
    .maybeSingle();
  let overrides: PermOverrides | null = null;
  if (member?.id) {
    const { data: perms } = await supabase
      .from("member_permissions")
      .select("*")
      .eq("member_id", member.id)
      .maybeSingle();
    overrides = (perms as PermOverrides) || null;
  }
  const ctx: UserCtx = { email: auth.email, role: member?.role ?? null, department: member?.department ?? null, company: member?.company ?? null, overrides };
  if (!canViewIfplPnl(ctx)) {
    return Response.json({ error: "Not authorised to upload Imperial Footwear's P&L." }, { status: 403 });
  }

  let fileName = "PL-CURRENT.xlsx";
  let months: ParsedIfplMonth[];
  try {
    const body = await request.json();
    if (typeof body.fileName === "string" && body.fileName) fileName = body.fileName.slice(0, 200);
    months = body.months;
    if (!Array.isArray(months) || months.length === 0 || months.length > MAX_MONTHS) throw new Error("bad months");
    for (const m of months) {
      if (!/^\d{4}-\d{2}-01$/.test(m.month)) throw new Error("bad month date");
      if (!Array.isArray(m.checks) || !Array.isArray(m.lines) || m.lines.length > MAX_LINES_PER_MONTH) throw new Error("bad month payload");
    }
  } catch {
    return Response.json({ error: "Invalid upload payload — refresh the page and try again." }, { status: 400 });
  }

  const results: { month: string; accepted: boolean; summary: string }[] = [];
  for (const m of months) {
    const checks = m.checks.filter((c) => typeof c?.name === "string");
    const warnings = checks.filter((c) => !c.passed && !c.blocking).length;
    const failed = checks.filter((c) => !c.passed && c.blocking).length;
    const passed = checks.filter((c) => c.passed).length;
    // The server decides acceptance from the checks it was given — a month
    // with any failed blocking check is never stored, whatever the client says.
    const accepted = failed === 0;

    if (accepted) {
      await supabase.from("ifpl_pnl_uploads").delete().eq("month", m.month).eq("status", "accepted");
    }
    const { data: upload, error: upErr } = await supabase
      .from("ifpl_pnl_uploads")
      .insert({
        month: m.month,
        file_name: fileName,
        status: accepted ? "accepted" : "rejected",
        checks_passed: passed,
        checks_failed: failed,
        warnings,
        rejection_summary: accepted ? null : String(m.summary || "").slice(0, 500),
        uploaded_by: auth.email,
      })
      .select("id")
      .single();
    if (upErr || !upload) {
      results.push({ month: m.month, accepted: false, summary: "Database error: " + (upErr?.message || "insert failed") });
      continue;
    }

    await supabase.from("ifpl_pnl_checks").insert(
      checks.map((c) => ({
        upload_id: upload.id,
        check_name: String(c.name).slice(0, 200),
        expected: fin(c.expected),
        reported: fin(c.reported),
        diff: fin(c.diff),
        passed: !!c.passed,
        blocking: !!c.blocking,
      })),
    );

    if (accepted) {
      const rows = m.lines
        .filter((l) => typeof l?.branch === "string" && typeof l?.line === "string" && CATEGORIES.has(l.category))
        .map((l) => ({
          upload_id: upload.id,
          month: m.month,
          branch: l.branch.slice(0, 100),
          channel: String(l.channel || "Retail").slice(0, 40),
          line: l.line.slice(0, 120),
          category: l.category,
          projection: fin(l.projection),
          actual: fin(l.actual),
        }));
      let lineError = false;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error: lineErr } = await supabase.from("ifpl_pnl_lines").insert(rows.slice(i, i + CHUNK));
        if (lineErr) {
          results.push({ month: m.month, accepted: false, summary: "Database error while saving lines: " + lineErr.message });
          await supabase.from("ifpl_pnl_uploads").delete().eq("id", upload.id);
          lineError = true;
          break;
        }
      }
      if (lineError) continue;
    }
    results.push({ month: m.month, accepted, summary: String(m.summary || "").slice(0, 300) });
  }

  return Response.json({ results });
}
