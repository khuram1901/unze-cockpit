import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import type { ParsedIfplMonth } from "../../../lib/excel-parsers/pnl-ifpl-parser";
import { requireAuth } from "../../../lib/api-auth";
import { canViewIfplPnl, type UserCtx, type PermOverrides } from "../../../lib/permissions";
import { sendRestatementAlert, type RestatementItem } from "../../../lib/pnl-restatement-alert";

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

  type Restated = { scope: string; line: string; old_value: number; new_value: number };
  const results: { month: string; accepted: boolean; summary: string; restated?: Restated[] }[] = [];
  const allRestated: RestatementItem[] = [];
  for (const m of months) {
    const checks = m.checks.filter((c) => typeof c?.name === "string");
    const failed = checks.filter((c) => !c.passed && c.blocking).length;
    // The server decides acceptance from the checks it was given — a month
    // with any failed blocking check is never stored, whatever the client
    // says. A month with NO checks at all is never accepted either (a parser
    // regression or hand-crafted payload must not bypass validation).
    let accepted = checks.length > 0 && failed === 0;

    // ── Server-side recomputation of the blocking identities ──────────
    // The client's checks are advisory context; the identities that gate
    // acceptance are re-derived here from the posted lines themselves, so
    // a buggy or hand-crafted client can never store figures that don't
    // add up. Mirrors the parser: tol = max(2000, |expected| * 0.001).
    if (accepted) {
      const sumLine = (line: string) =>
        m.lines.filter((l) => l?.line === line).reduce((s, l) => s + fin(l.actual), 0);
      const sumCat = (cat: string) =>
        m.lines.filter((l) => l?.category === cat).reduce((s, l) => s + fin(l.actual), 0);
      const tol = (expected: number) => Math.max(2000, Math.abs(expected) * 0.001);
      const serverChecks: { name: string; expected: number; reported: number }[] = [
        { name: "Server: net sales = gross − tax", expected: sumLine("Gross Sales") - sumLine("Tax"), reported: sumLine("Net Sales") },
        { name: "Server: operating profit = GP − overheads", expected: sumLine("Gross Profit") - sumLine("Total Overheads"), reported: sumLine("Net Operating Profit") },
        { name: "Server: final profit = op profit ± below-the-line", expected: sumLine("Net Operating Profit") + sumCat("below_add") - sumCat("below_less"), reported: sumLine("Final Profit") },
      ];
      for (const c of serverChecks) {
        const diff = c.reported - c.expected;
        const ok = Math.abs(diff) <= tol(c.expected);
        checks.push({ name: c.name, expected: c.expected, reported: c.reported, diff, passed: ok, blocking: true });
        if (!ok) accepted = false;
      }
    }

    // ── Restatement detection (transparency log) ──────────────────
    // Compare stored actual net sales / final profit per branch against the
    // incoming figures BEFORE overwriting; record every change permanently.
    const restated: Restated[] = [];
    if (accepted) {
      const { data: existing } = await supabase
        .from("ifpl_pnl_lines")
        .select("branch, line, actual")
        .eq("month", m.month)
        .in("line", ["Net Sales", "Final Profit"]);
      if (existing && existing.length > 0) {
        const oldMap = new Map<string, number>();
        for (const e of existing) {
          const k = `${e.branch}|${e.line}`;
          oldMap.set(k, (oldMap.get(k) || 0) + Number(e.actual));
        }
        const newMap = new Map<string, number>();
        for (const l of m.lines) {
          if (l.line !== "Net Sales" && l.line !== "Final Profit") continue;
          const k = `${l.branch}|${l.line}`;
          newMap.set(k, (newMap.get(k) || 0) + fin(l.actual));
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
        // new month's lines are fully stored (below) — never for figures that
        // failed to land.
      }
      // The previously accepted upload is deliberately NOT deleted here.
      // New data is written first; the old upload is removed only after
      // everything has landed (delete-last), so a mid-write failure can
      // never destroy an already-accepted month.
    }
    const { data: upload, error: upErr } = await supabase
      .from("ifpl_pnl_uploads")
      .insert({
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
          // Roll back only the NEW upload — the previously accepted month is
          // untouched (it is deleted below, after everything has landed).
          results.push({ month: m.month, accepted: false, summary: "Database error while saving lines: " + lineErr.message + " — previously stored figures for this month are unchanged." });
          await supabase.from("ifpl_pnl_uploads").delete().eq("id", upload.id);
          lineError = true;
          break;
        }
      }
      if (lineError) continue;

      // Delete-LAST: remove the previously accepted upload(s) for this month
      // now that the replacement is fully stored. On failure, roll back the
      // new upload so the month never shows doubled figures.
      const { error: oldDelErr } = await supabase
        .from("ifpl_pnl_uploads")
        .delete()
        .eq("month", m.month)
        .eq("status", "accepted")
        .neq("id", upload.id);
      if (oldDelErr) {
        await supabase.from("ifpl_pnl_uploads").delete().eq("id", upload.id);
        results.push({ month: m.month, accepted: false, summary: "Could not replace the previously stored month (" + oldDelErr.message + ") — previous figures kept, new upload rolled back. Try again." });
        continue;
      }

      // Restatement log — only now that the new figures actually landed.
      if (restated.length > 0) {
        await supabase.from("pnl_restatements").insert(
          restated.map((r) => ({ company: "IFPL", month: m.month, scope: r.scope, line: r.line, old_value: r.old_value, new_value: r.new_value, changed_by: auth.email })),
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

  // ── Prior-year consistency check ────────────────────────────────
  // The workbook's own summary sheets claim what previous fiscal years did;
  // compare against the app's stored, confirmed records. A mismatch means
  // the file's history tabs disagree with what the CEO already signed off.
  const priorYearWarnings: string[] = [];
  const seenClaims = new Set<string>();
  for (const m of months) {
    for (const c of m.priorYearClaims || []) {
      const fy = Math.trunc(fin(c.fy_start_year));
      const claimed = fin(c.net_sales);
      const source = String(c.source || "summary").slice(0, 60);
      const key = `${source}|${fy}`;
      if (fy < 2015 || fy > 2100 || claimed <= 0 || seenClaims.has(key)) continue;
      seenClaims.add(key);
      const { data: total } = await supabase.rpc("ifpl_net_sales_total", {
        p_from: `${fy}-07-01`,
        p_to: `${fy + 1}-06-01`,
      });
      const stored = Number(total) || 0;
      if (stored <= 0) continue; // nothing confirmed for that year — nothing to compare
      const diff = claimed - stored;
      if (Math.abs(diff) > Math.max(stored * 0.01, 1_000_000)) {
        priorYearWarnings.push(
          `The file's "${source}" sheet says FY ${fy}-${String(fy + 1).slice(2)} net sales were PKR ${(claimed / 1e6).toFixed(1)}m, ` +
          `but the app's confirmed records total PKR ${(stored / 1e6).toFixed(1)}m — out by PKR ${(diff / 1e6).toFixed(1)}m.`,
        );
      }
    }
  }

  // Restatements found anywhere in this upload → email the CEO immediately
  // (also permanently logged above; email failure never affects the upload).
  await sendRestatementAlert({
    companyLabel: "Imperial Footwear",
    pagePath: "/finance/imperial-pnl",
    uploadedBy: auth.email,
    fileName,
    items: allRestated,
  });
  if (priorYearWarnings.length > 0) {
    const { sendNotificationEmail } = await import("../../../lib/send-email");
    await sendNotificationEmail({
      to: "khuram1901@gmail.com",
      subject: `⚠ Imperial P&L upload: file's prior-year summary doesn't match confirmed records`,
      heading: "Prior-year figures don't match",
      body:
        `<p>An upload to the <strong>Imperial Footwear P&amp;L</strong> contains year-summary figures that disagree with the app's confirmed records.</p>` +
        `<p><strong>Uploaded by:</strong> ${auth.email}<br/><strong>File:</strong> ${fileName}</p>` +
        `<ul style="padding-left:18px">${priorYearWarnings.map((w) => `<li style="margin-bottom:6px">${w}</li>`).join("")}</ul>` +
        `<p>The app's stored months remain unchanged — this flags that the file's own history tabs are wrong or have been altered.</p>`,
      linkUrl: "https://pulse.unze.co.uk/finance/imperial-pnl",
      linkLabel: "Open Imperial P&L",
      triggerType: "pnl_prior_year_mismatch",
    }).catch((err) => console.error("[upload-ifpl] prior-year email failed:", err));
  }

  // Link uploaded branch lines to the locations master (migration 221).
  // Unmatched branches are logged as 'branch_unmapped' lifecycle events.
  await supabase.rpc("match_pnl_branches");

  return Response.json({ results, priorYearWarnings: priorYearWarnings.length > 0 ? priorYearWarnings : undefined });
}
