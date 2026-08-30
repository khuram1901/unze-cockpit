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
    const failed = checks.filter((c) => !c.passed && c.blocking).length;
    // Server decides from the checks; a month with NO checks at all is never
    // accepted (a parser regression or hand-crafted payload must not bypass
    // validation).
    let accepted = checks.length > 0 && failed === 0;

    // ── Server-side recomputation of the blocking identities ──────────
    // Acceptance is re-derived from the posted lines themselves, so a buggy
    // or hand-crafted client can never store figures that don't add up.
    // Mirrors the parser: tol = max(2000, |expected| * 0.005); amounts are
    // posted as positive cost magnitudes (the parser normalises signs).
    if (accepted) {
      const sumLine = (line: string) =>
        m.lines.filter((l) => l?.line === line).reduce((s, l) => s + fin(l.amount), 0);
      const sumCat = (cat: string) =>
        m.lines.filter((l) => l?.category === cat).reduce((s, l) => s + fin(l.amount), 0);
      const tol = (expected: number) => Math.max(2000, Math.abs(expected) * 0.005);
      const serverChecks: { name: string; expected: number; reported: number }[] = [
        { name: "Server: operating profit = GP − admin expenses", expected: sumLine("Gross Profit") - sumLine("Total Administrative Expenses"), reported: sumLine("Profit after Operations") },
        { name: "Server: net profit = op profit ± below-the-line", expected: sumLine("Profit after Operations") + sumCat("below_add") - sumCat("below_less"), reported: sumLine("Net Profit") },
      ];
      for (const c of serverChecks) {
        const diff = c.reported - c.expected;
        const ok = Math.abs(diff) <= tol(c.expected);
        checks.push({ name: c.name, expected: c.expected, reported: c.reported, diff, passed: ok, blocking: true });
        if (!ok) accepted = false;
      }
    }

    // ── Restatement detection (transparency log) ──────────────────
    // If this month already exists, compare stored net sales / net profit
    // per branch against the incoming figures BEFORE overwriting, and
    // record every change permanently in pnl_restatements.
    const restated: Restated[] = [];
    if (accepted) {
      const { data: storedSums } = await supabase.rpc("get_rest_pnl_line_sums", {
        p_company: company,
        p_month: m.month,
        p_lines: ["Net Sales", "Net Profit"],
      });
      const stored = (storedSums || []) as Array<{ scope: string; line: string; total: number }>;
      if (stored.length > 0) {
        const oldMap = new Map<string, number>();
        for (const e of stored) oldMap.set(`${e.scope}|${e.line}`, Number(e.total));
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
        // NOTE: the pnl_restatements insert + CEO alert happen only AFTER the
        // new month's lines are fully stored (below).
      }
      // Delete-last: the previously accepted upload is removed only after
      // the replacement has fully landed, so a mid-write failure can never
      // destroy an already-accepted month.
    }
    const { data: upload, error: upErr } = await supabase
      .from("rest_pnl_uploads")
      .insert({
        company,
        month: m.month,
        file_name: fileName,
        status: accepted ? "accepted" : "rejected",
        checks_passed: checks.filter((c) => c.passed).length,
        checks_failed: checks.filter((c) => !c.passed && c.blocking).length,
        warnings: checks.filter((c) => !c.passed && !c.blocking).length,
        rejection_summary: accepted
          ? null
          : (checks.some((c) => !c.passed && c.blocking && c.name.startsWith("Server:"))
            ? "Server-side identity check failed: " + checks.filter((c) => !c.passed && c.blocking).map((c) => c.name).join("; ").slice(0, 450)
            : String(m.summary || "").slice(0, 500)),
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
          // Roll back only the NEW upload — the previously accepted month is
          // untouched (deleted below, only after everything has landed).
          results.push({ month: m.month, accepted: false, summary: "Database error while saving lines: " + lineErr.message + " — previously stored figures for this month are unchanged." });
          await supabase.from("rest_pnl_uploads").delete().eq("id", upload.id);
          lineError = true;
          break;
        }
      }
      if (lineError) continue;

      // Delete-LAST: remove the previously accepted upload(s) now that the
      // replacement is fully stored; on failure roll back the new upload so
      // the month never shows doubled figures.
      const { error: oldDelErr } = await supabase
        .from("rest_pnl_uploads")
        .delete()
        .eq("company", company)
        .eq("month", m.month)
        .eq("status", "accepted")
        .neq("id", upload.id);
      if (oldDelErr) {
        await supabase.from("rest_pnl_uploads").delete().eq("id", upload.id);
        results.push({ month: m.month, accepted: false, summary: "Could not replace the previously stored month (" + oldDelErr.message + ") — previous figures kept, new upload rolled back. Try again." });
        continue;
      }

      // Restatement log — only now that the new figures actually landed.
      if (restated.length > 0) {
        await supabase.from("pnl_restatements").insert(
          restated.map((r) => ({ company, month: m.month, scope: r.scope, line: r.line, old_value: r.old_value, new_value: r.new_value, changed_by: auth.email })),
        );
        allRestated.push(...restated.map((r) => ({ ...r, month: m.month })));
      }
    }
    const serverFailed = checks.filter((c) => !c.passed && c.blocking && c.name.startsWith("Server:"));
    results.push({
      month: m.month,
      accepted,
      summary: !accepted && serverFailed.length > 0
        ? `Rejected by server-side verification: ${serverFailed.map((c) => c.name.replace("Server: ", "")).join("; ")}`.slice(0, 300)
        : String(m.summary || "").slice(0, 300),
      restated: restated.length > 0 ? restated : undefined,
    });
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

  // Link uploaded branch lines to the locations master (migration 221).
  // Unmatched branches are logged as 'branch_unmapped' lifecycle events.
  await supabase.rpc("match_pnl_branches");

  return Response.json({ results });
}
