import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { parseIfplPnl } from "../../../lib/excel-parsers/pnl-ifpl-parser";
import { requireAuth } from "../../../lib/api-auth";
import { canViewIfplPnl, type UserCtx, type PermOverrides } from "../../../lib/permissions";

// The Imperial workbook is cumulative (~10 MB, one sheet per month), so a
// single upload refreshes EVERY month with actual activity: each parsed
// month is validated independently and, when accepted, replaces whatever
// was stored for that month before. Rejected months leave the previous
// accepted data untouched.
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

// Parsing ~12 month sheets and inserting ~17k line rows takes longer than
// the default serverless window — allow up to 60s for this route.
export const maxDuration = 60;

const CHUNK = 1000;

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

  let file: File | null;
  try {
    const formData = await request.formData();
    file = formData.get("file") as File | null;
  } catch {
    return Response.json({ error: "Could not read the uploaded file." }, { status: 400 });
  }
  if (!file) return Response.json({ error: "An Excel file is required." }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return Response.json({ error: "File exceeds 20 MB limit." }, { status: 413 });

  let months;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    months = parseIfplPnl(buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: "Could not read this file: " + message }, { status: 400 });
  }
  if (months.length === 0) {
    return Response.json({ error: "No month sheets with activity were found — is this the right workbook?" }, { status: 400 });
  }

  const results: { month: string; accepted: boolean; summary: string }[] = [];
  for (const m of months) {
    const warnings = m.checks.filter((c) => !c.passed && !c.blocking).length;
    const failed = m.checks.filter((c) => !c.passed && c.blocking).length;
    const passed = m.checks.filter((c) => c.passed).length;

    if (m.accepted) {
      await supabase.from("ifpl_pnl_uploads").delete().eq("month", m.month).eq("status", "accepted");
    }
    const { data: upload, error: upErr } = await supabase
      .from("ifpl_pnl_uploads")
      .insert({
        month: m.month,
        file_name: file.name,
        status: m.accepted ? "accepted" : "rejected",
        checks_passed: passed,
        checks_failed: failed,
        warnings,
        rejection_summary: m.accepted ? null : m.summary,
        uploaded_by: auth.email,
      })
      .select("id")
      .single();
    if (upErr || !upload) {
      results.push({ month: m.month, accepted: false, summary: "Database error: " + (upErr?.message || "insert failed") });
      continue;
    }

    await supabase.from("ifpl_pnl_checks").insert(
      m.checks.map((c) => ({
        upload_id: upload.id,
        check_name: c.name,
        expected: c.expected,
        reported: c.reported,
        diff: c.diff,
        passed: c.passed,
        blocking: c.blocking,
      })),
    );

    if (m.accepted) {
      const rows = m.lines.map((l) => ({
        upload_id: upload.id,
        month: m.month,
        branch: l.branch,
        channel: l.channel,
        line: l.line,
        category: l.category,
        projection: l.projection,
        actual: l.actual,
      }));
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error: lineErr } = await supabase.from("ifpl_pnl_lines").insert(rows.slice(i, i + CHUNK));
        if (lineErr) {
          results.push({ month: m.month, accepted: false, summary: "Database error while saving lines: " + lineErr.message });
          await supabase.from("ifpl_pnl_uploads").delete().eq("id", upload.id);
          break;
        }
      }
    }
    if (!results.find((r) => r.month === m.month)) {
      results.push({ month: m.month, accepted: m.accepted, summary: m.summary });
    }
  }

  return Response.json({ results });
}
