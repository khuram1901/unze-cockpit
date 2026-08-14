import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import type { ParsedRestMonth, RestCompany } from "../../../lib/excel-parsers/pnl-restaurant-parser";
import { requireAuth } from "../../../lib/api-auth";
import { canViewRestaurantsPnl, type UserCtx, type PermOverrides } from "../../../lib/permissions";
import { sendRestatementAlert, type RestatementItem } from "../../../lib/pnl-restatement-alert";

// Restaurant P&L upload — same pattern as Imperial: the workbook is parsed
// in the BROWSER (pnl-restaurant-parser) and the extracted months arrive
// here as JSON, one company per request ('BARANH' or 'HD'). Each accepted
// month replaces whatever was stored for that company+month; rejected
// months leave old data alone.
export const maxDuration = 60;

const CHUNK = 1000;
const MAX_MONTHS = 100;
const MAX_LINES_PER_MONTH = 3000;
const COMPANIES = new Set(["BARANH", "HD"]);
const CATEGORIES = new Set(["core", "bank_discount", "cogs_detail", "expense", "below_less", "below_add", "other"]);
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
  if (!canViewRestaurantsPnl(ctx)) {
    return Response.json({ error: "Not authorised to upload restaurant P&L data." }, { status: 403 });
  }

  let fileName = "restaurant-pnl.xlsx";
  let company: RestCompany;
  let months: ParsedRestMonth[];
  try {
    const body = await request.json();
    if (typeof body.fileName === "string" && body.fileName) fileName = body.fileName.slice(0, 200);
    company = body.company;
    months = body.months;
    if (!COMPANIES.has(company)) throw new Error("bad company");
    if (!Array.isArray(months) || months.length === 0 || months.length > MAX_MONTHS) throw new Error("bad months");
    for (const m of months) {
      if (!/^\d{4}-\d{2}-01$/.test(m.month)) throw new Error("bad month date");
      if (!Array.isArray(m.checks) || !Array.isArray(m.lines) || m.lines.length > MAX_LINES_PER_MONTH) throw new Error("bad month payload");
    }
  } catch {
    return Response.json({ error: "Invalid upload payload — refresh the page and try again." }, { status: 400 });
  }

  type Restated = { scope: string; line: string; old_value: number; new_value: number };
  const results: { month: string; accepted: boolean; summary: string; restated?: Restated[] }[] = [];
  const allRestated: RestatementItem[] = [];
  for (const m of months) {
    const checks = m.checks.filter((c) => typeof c?.name === "string");
    const warnings = checks.filter((c) => !c.passed && !c.blocking).length;
    const failed = checks.filter((c) => !c.passed && c.blocking).length;
    const passed = checks.filter((c) => c.passed).length;
    const accepted = failed === 0; // server decides from the checks

    // ── Restatement detection (transparency log) ──────────────────
    // If this month already exists, compare stored net sales / net profit
    // per branch against the incoming figures BEFORE overwriting, and
    // record every change permanently in pnl_restatements.
    const restated: Restated[] = [];
    if (accepted) {
      const { data: existing } = await supabase
        .from("rest_pnl_lines")
        .select("branch, line, amount")
        .eq("company", company)
        .eq("month", m.month)
        .in("line", ["Net Sales", "Net Profit"]);
      if (existing && existing.length > 0) {
        const oldMap = new Map<string, number>();
        for (const e of existing) {
          const k = `${e.branch}|${e.line}`;
          oldMap.set(k, (oldMap.get(k) || 0) + Number(e.amount));
        }
        const newMap = new Map<string, number>();
        for (const l of m.lines) {
          if (l.line !== "Net Sales" && l.line !== "Net Profit") continue;
          const k = `${l.branch}|${l.line}`;
          newMap.set(k, (newMap.get(k) || 0) + fin(l.amount));
        }
        for (const k of new Set([...oldMap.keys(), ...newMap.keys()])) {
          const oldV = oldMap.get(k) || 0;
          const newV = newMap.get(k) || 0;
          if (Math.abs(newV - oldV) > 1000) {
            const [scope, line] = k.split("|");
            restated.push({ scope, line, old_value: oldV, new_value: newV });
          }
        }
        if (restated.length > 0) {
          await supabase.from("pnl_restatements").insert(
            restated.map((r) => ({ company, month: m.month, scope: r.scope, line: r.line, old_value: r.old_value, new_value: r.new_value, changed_by: auth.email })),
          );
          allRestated.push(...restated.map((r) => ({ ...r, month: m.month })));
        }
      }
      await supabase.from("rest_pnl_uploads").delete().eq("company", company).eq("month", m.month).eq("status", "accepted");
    }
    const { data: upload, error: upErr } = await supabase
      .from("rest_pnl_uploads")
      .insert({
        company,
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

    await supabase.from("rest_pnl_checks").insert(
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
          company,
          month: m.month,
          branch: l.branch.slice(0, 60),
          line: l.line.slice(0, 120),
          category: l.category,
          amount: fin(l.amount),
        }));
      let lineError = false;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error: lineErr } = await supabase.from("rest_pnl_lines").insert(rows.slice(i, i + CHUNK));
        if (lineErr) {
          results.push({ month: m.month, accepted: false, summary: "Database error while saving lines: " + lineErr.message });
          await supabase.from("rest_pnl_uploads").delete().eq("id", upload.id);
          lineError = true;
          break;
        }
      }
      if (lineError) continue;
    }
    results.push({ month: m.month, accepted, summary: String(m.summary || "").slice(0, 300), restated: restated.length > 0 ? restated : undefined });
  }

  // Restatements found anywhere in this upload → email the CEO immediately
  // (also permanently logged above; email failure never affects the upload).
  await sendRestatementAlert({
    companyLabel: company === "BARANH" ? "Baranh" : "Haute Dolci",
    pagePath: "/finance/restaurants",
    uploadedBy: auth.email,
    fileName,
    items: allRestated,
  });

  return Response.json({ results });
}
