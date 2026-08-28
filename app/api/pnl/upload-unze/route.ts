import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { parseUnzePnl } from "../../../lib/excel-parsers/pnl-unze-parser";
import { UTPL_COMPANY_ID } from "../../../lib/constants";
import { requireAuth } from "../../../lib/api-auth";
import { financeCompanies, type UserCtx, type PermOverrides } from "../../../lib/permissions";
import { sendRestatementAlert } from "../../../lib/pnl-restatement-alert";

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

  // ── Restatement detection (transparency log) ────────────────────────
  // If this month already exists, compare the stored gross sale / final
  // net profit per plant against the incoming file BEFORE overwriting and
  // record every change permanently in pnl_restatements.
  const restated: { scope: string; line: string; old_value: number; new_value: number }[] = [];
  if (parsed.accepted) {
    const { data: existing } = await supabase
      .from("pnl_line_items")
      .select("plant, line, amount")
      .eq("company_id", UTPL_COMPANY_ID)
      .eq("month", parsed.month)
      .in("line", ["Gross Sale", "Net Profit Final"]);
    if (existing && existing.length > 0) {
      const oldMap = new Map<string, number>();
      for (const e of existing) {
        const k = `${e.plant}|${e.line}`;
        oldMap.set(k, (oldMap.get(k) || 0) + Number(e.amount));
      }
      const newMap = new Map<string, number>();
      for (const l of parsed.lineItems) {
        if (l.line !== "Gross Sale" && l.line !== "Net Profit Final") continue;
        const k = `${l.plant}|${l.line}`;
        newMap.set(k, (newMap.get(k) || 0) + l.amount);
      }
      for (const k of new Set([...oldMap.keys(), ...newMap.keys()])) {
        const oldV = oldMap.get(k) || 0;
        const newV = newMap.get(k) || 0;
        if (Math.abs(newV - oldV) > 1000) {
          const [scope, line] = k.split("|");
          restated.push({ scope, line: line === "Net Profit Final" ? "Net Profit" : "Gross Sales", old_value: oldV, new_value: newV });
        }
      }
      // NOTE: the pnl_restatements insert happens AFTER the new data is
      // successfully stored (below) — a restatement must never be logged
      // for figures that failed to land.
    }
  }

  // pnl_uploads has UNIQUE (company_id, month, status). To replace an
  // accepted month WITHOUT deleting the old data first (a mid-write failure
  // must never destroy an accepted month), the new upload is inserted as
  // 'pending', its data written, the old accepted upload deleted, and only
  // then is the new row flipped to 'accepted'. Stale leftovers from any
  // earlier crashed attempt are cleared up front.
  await supabase
    .from("pnl_uploads")
    .delete()
    .eq("company_id", UTPL_COMPANY_ID)
    .eq("month", parsed.month)
    .eq("status", parsed.accepted ? "pending" : "rejected");

  const { data: upload, error: uploadError } = await supabase
    .from("pnl_uploads")
    .insert({
      company_id: UTPL_COMPANY_ID,
      month: parsed.month,
      file_name: file.name,
      status: parsed.accepted ? "pending" : status,
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

  const { error: checksLogErr } = await supabase.from("pnl_validation_checks").insert(
    parsed.checks.map((c) => ({
      upload_id: upload.id,
      check_name: c.name,
      expected: Number.isFinite(c.expected) ? c.expected : null,
      reported: Number.isFinite(c.reported) ? c.reported : null,
      diff: Number.isFinite(c.diff) ? c.diff : null,
      passed: c.passed,
    })),
  );
  // Non-fatal, but never silent — the check drill-down is part of the
  // integrity story, so a failure to store it is surfaced to the uploader.
  const checksLogWarning = checksLogErr
    ? `Check results could not be stored for the audit trail (${checksLogErr.message}) — figures unaffected.`
    : null;

  if (!parsed.accepted) {
    // Nothing else gets written — the whole file is rejected, exactly as
    // asked: no figure reaches the dashboard unless every check passes.
    return Response.json({
      accepted: false,
      month: parsed.month,
      checks: parsed.checks,
      auditIssues: parsed.auditIssues,
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
    // Roll back the NEW upload rather than leave a half-written month.
    // The previously accepted month (if any) is still intact — it is only
    // deleted below, after everything new has landed.
    await supabase.from("pnl_uploads").delete().eq("id", upload.id);
    return Response.json({ error: "Checks passed but saving failed: " + writeError.message + " — the previously stored month is unchanged." }, { status: 500 });
  }

  // ── Replace-old-with-new, delete-LAST ────────────────────────────────
  // Only now that the new upload's data is fully stored do we remove the
  // previously accepted upload(s) for this month (cascades to their line
  // items, ledger lines, allocation % and checks). If this delete fails we
  // roll back the NEW upload so the month never shows doubled figures.
  const { error: oldDelErr } = await supabase
    .from("pnl_uploads")
    .delete()
    .eq("company_id", UTPL_COMPANY_ID)
    .eq("month", parsed.month)
    .eq("status", "accepted")
    .neq("id", upload.id);
  if (oldDelErr) {
    await supabase.from("pnl_uploads").delete().eq("id", upload.id);
    return Response.json({ error: "Could not replace the previously stored month (" + oldDelErr.message + ") — the previously stored figures were kept and the new upload was rolled back. Try again." }, { status: 500 });
  }

  // Flip the fully-written new upload from 'pending' to 'accepted'. Retried
  // once; a persistent failure leaves the new data stored but invisible
  // (dashboards only read accepted uploads) and says so explicitly.
  let { error: acceptErr } = await supabase.from("pnl_uploads").update({ status: "accepted" }).eq("id", upload.id);
  if (acceptErr) {
    ({ error: acceptErr } = await supabase.from("pnl_uploads").update({ status: "accepted" }).eq("id", upload.id));
  }
  if (acceptErr) {
    return Response.json({ error: "The month's data was written but could not be activated (" + acceptErr.message + "). Re-upload the same file to complete the replacement." }, { status: 500 });
  }

  // ── Restatement log + CEO alert — only after the data actually landed ──
  if (restated.length > 0) {
    await supabase.from("pnl_restatements").insert(
      restated.map((r) => ({ company: "UTPL", month: parsed.month, scope: r.scope, line: r.line, old_value: r.old_value, new_value: r.new_value, changed_by: auth.email })),
    );
  }
  // (email failure never affects the upload)
  await sendRestatementAlert({
    companyLabel: "Unze Trading",
    pagePath: "/finance/profit-and-loss",
    uploadedBy: auth.email,
    fileName: file.name || "unze-pnl.xlsx",
    items: restated.map((r) => ({ ...r, month: parsed.month })),
  });

  return Response.json({
    accepted: true,
    month: parsed.month,
    checks: parsed.checks,
    auditIssues: parsed.auditIssues,
    restated: restated.length > 0 ? restated : undefined,
    lineItems: parsed.lineItems.length,
    ledgerLines: parsed.ledgerLines.length,
    summary: (parsed.auditIssues.length > 0
      ? `All ${parsed.checks.length} checks passed (${parsed.auditIssues.length} Excel audit warning${parsed.auditIssues.length > 1 ? "s" : ""} below).`
      : `All ${parsed.checks.length} checks passed.`) + (checksLogWarning ? ` ⚠ ${checksLogWarning}` : ""),
  });
}
