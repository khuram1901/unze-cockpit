import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { parseUnzePnl } from "../../../lib/excel-parsers/pnl-unze-parser";
import { UTPL_COMPANY_ID } from "../../../lib/constants";
import { requireAuth } from "../../../lib/api-auth";
import { financeCompanies, type UserCtx, type PermOverrides } from "../../../lib/permissions";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();

  // Same UserCtx-from-email pattern used across the other finance routes
  // (see app/api/tasks/create/route.ts) — requireAuth only gives us an
  // email, so we look up role/department/company + overrides ourselves.
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

  const scope = financeCompanies(ctx);
  if (scope !== "both" && scope !== "UTPL") {
    return Response.json({ error: "Not authorised to upload Unze Trading's P&L." }, { status: 403 });
  }

  let file: File | null;
  try {
    const formData = await request.formData();
    file = formData.get("file") as File | null;
  } catch {
    return Response.json({ error: "Could not read the uploaded file." }, { status: 400 });
  }

  if (!file) {
    return Response.json({ error: "An Excel file is required." }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return Response.json({ error: "File exceeds 10 MB limit." }, { status: 413 });
  }

  let parsed;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    parsed = parseUnzePnl(buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: "Could not read this file: " + message }, { status: 400 });
  }

  const checksFailed = parsed.checks.filter((c) => !c.passed);
  const status = parsed.accepted ? "accepted" : "rejected";

  // Reuploading a corrected file for a month that was already accepted
  // replaces it outright — cascades to delete the old line items, ledger
  // lines, allocation %, and validation checks tied to that upload.
  if (parsed.accepted) {
    await supabase
      .from("pnl_uploads")
      .delete()
      .eq("company_id", UTPL_COMPANY_ID)
      .eq("month", parsed.month)
      .eq("status", "accepted");
  }

  const { data: upload, error: uploadError } = await supabase
    .from("pnl_uploads")
    .insert({
      company_id: UTPL_COMPANY_ID,
      month: parsed.month,
      file_name: file.name,
      status,
      uploaded_by: auth.email,
      checks_passed: parsed.checks.length - checksFailed.length,
      checks_failed: checksFailed.length,
      rejection_summary: parsed.accepted
        ? null
        : `${checksFailed.length} of ${parsed.checks.length} checks failed: ${checksFailed.map((c) => c.name).join("; ")}`,
    })
    .select("id")
    .single();

  if (uploadError || !upload) {
    return Response.json({ error: "Could not log this upload: " + (uploadError?.message ?? "unknown error") }, { status: 500 });
  }

  await supabase.from("pnl_validation_checks").insert(
    parsed.checks.map((c) => ({
      upload_id: upload.id,
      check_name: c.name,
      expected: Number.isFinite(c.expected) ? c.expected : null,
      reported: Number.isFinite(c.reported) ? c.reported : null,
      diff: Number.isFinite(c.diff) ? c.diff : null,
      passed: c.passed,
    })),
  );

  if (!parsed.accepted) {
    // Nothing else gets written — the whole file is rejected, exactly as
    // asked: no figure reaches the dashboard unless every check passes.
    return Response.json({
      accepted: false,
      month: parsed.month,
      checks: parsed.checks,
      summary: `${checksFailed.length} of ${parsed.checks.length} checks failed.`,
    }, { status: 422 });
  }

  const commonWrite = { upload_id: upload.id, company_id: UTPL_COMPANY_ID, month: parsed.month };

  const { error: lineErr } = await supabase.from("pnl_line_items").insert(
    parsed.lineItems.map((l) => ({ ...commonWrite, plant: l.plant, line: l.line, amount: l.amount })),
  );
  const { error: ledgerErr } = await supabase.from("pnl_ledger_lines").insert(
    parsed.ledgerLines.map((l) => ({ ...commonWrite, plant: l.plant, account_group: l.accountGroup, account_code: l.accountCode, account_name: l.accountName, amount: l.amount })),
  );
  const { error: allocErr } = await supabase.from("pnl_allocation_pct").insert(
    parsed.allocationPct.map((a) => ({ ...commonWrite, plant: a.plant, pct: a.pct })),
  );

  const writeError = lineErr || ledgerErr || allocErr;
  if (writeError) {
    // Roll back the whole upload rather than leave a half-written month —
    // "accepted" must mean everything is actually there.
    await supabase.from("pnl_uploads").delete().eq("id", upload.id);
    return Response.json({ error: "Checks passed but saving failed: " + writeError.message }, { status: 500 });
  }

  return Response.json({
    accepted: true,
    month: parsed.month,
    checks: parsed.checks,
    lineItems: parsed.lineItems.length,
    ledgerLines: parsed.ledgerLines.length,
    summary: `All ${parsed.checks.length} checks passed.`,
  });
}
