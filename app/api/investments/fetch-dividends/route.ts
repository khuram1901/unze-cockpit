import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

const CRON_SECRET = process.env.CRON_SECRET;

// PSX face value assumption: Rs 10 for most listed stocks.
// Dividend announcements are expressed as a percentage of face value:
//   "90% (D)" means Rs 9.00 per share (90% × Rs 10).
// Override per ticker if a stock has a different face value.
const FACE_VALUE_OVERRIDES: Record<string, number> = {
  // e.g. "TGL": 5,  // Rs 5 face value
};
const DEFAULT_FACE_VALUE = 10;

// Vercel Cron: runs at 06:00 UTC Mon–Fri (11:00 PKT), after the daily price update (04:30)
// and the daily summary (05:00). Can also be triggered manually with the cron secret.
export async function GET(request: NextRequest) {
  // Accept either cron (Bearer secret) or authenticated Admin/CEO user
  const authHeader = request.headers.get("authorization") ?? "";
  const isCron = CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`;

  let callerEmail = "cron";
  if (!isCron) {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;
    const supabase = createServiceClient();
    const { data: m } = await supabase
      .from("members")
      .select("role")
      .eq("email", auth.email.toLowerCase())
      .maybeSingle();
    const role = m?.role ?? null;
    const isAdmin =
      auth.email.toLowerCase() === "khuram1901@gmail.com" ||
      role === "Admin" ||
      role === "CEO";
    if (!isAdmin) return Response.json({ error: "Forbidden" }, { status: 403 });
    callerEmail = auth.email;
  }

  const supabase = createServiceClient();

  // ── 1. Get the list of tickers we hold ─────────────────────────────────────
  const { data: holdings, error: hErr } = await supabase
    .from("holdings")
    .select("ticker");
  if (hErr) return Response.json({ error: hErr.message }, { status: 500 });

  const tickers = [...new Set((holdings ?? []).map((h) => h.ticker as string))];
  if (tickers.length === 0) return Response.json({ ok: true, fetched: 0, upserted: 0, skipped: 0 });

  // ── 2. Fetch PSX payout announcements per ticker ────────────────────────────
  const results: UpsertCandidate[] = [];
  const errors: string[] = [];

  for (const ticker of tickers) {
    try {
      const rows = await fetchPsxPayouts(ticker);
      for (const row of rows) {
        const parsed = parsePayoutRow(ticker, row);
        if (parsed) results.push(parsed);
      }
    } catch (e) {
      errors.push(`${ticker}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (results.length === 0) {
    return Response.json({ ok: true, fetched: 0, upserted: 0, skipped: 0, errors });
  }

  // ── 3. Filter to dividends in the future or within the last 30 days ─────────
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const relevant = results.filter((r) => r.ex_dividend_date >= cutoff);

  // ── 4. Upsert — only insert if no row exists for (ticker, ex_dividend_date).
  //     On conflict, skip if confirmed=true (manual entry wins).
  //     Update amount/source only if the existing row is unconfirmed.
  let upserted = 0;
  let skipped = 0;

  for (const candidate of relevant) {
    // Check for existing confirmed record — manual entries are authoritative
    const { data: existing } = await supabase
      .from("stock_dividends")
      .select("id, confirmed, dividend_per_share")
      .eq("ticker", candidate.ticker)
      .eq("ex_dividend_date", candidate.ex_dividend_date)
      .maybeSingle();

    if (existing?.confirmed) {
      // A confirmed (manual) entry already exists — never overwrite
      skipped++;
      continue;
    }

    if (existing) {
      // Unconfirmed row exists — update the amount if PSX differs
      if (existing.dividend_per_share !== candidate.dividend_per_share) {
        await supabase
          .from("stock_dividends")
          .update({
            dividend_per_share: candidate.dividend_per_share,
            source: "auto-psx",
            notes: candidate.notes,
          })
          .eq("id", existing.id);
      }
      upserted++;
    } else {
      // New — insert as unconfirmed auto-psx entry
      const { error: insErr } = await supabase.from("stock_dividends").insert({
        ticker: candidate.ticker,
        dividend_per_share: candidate.dividend_per_share,
        ex_dividend_date: candidate.ex_dividend_date,
        payment_date: candidate.payment_date ?? null,
        announced_date: candidate.announced_date ?? null,
        status: candidate.status,
        source: "auto-psx",
        confirmed: false,
        notes: candidate.notes,
        entered_by: callerEmail,
      });
      if (!insErr) upserted++;
    }
  }

  return Response.json({
    ok: true,
    tickers_checked: tickers.length,
    fetched: results.length,
    relevant: relevant.length,
    upserted,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
  });
}

// ── PSX fetch ─────────────────────────────────────────────────────────────────

type PayoutRow = {
  announcement: string;       // e.g. "90%(i) (D)"
  announcedAt: string;        // e.g. "April 23, 2026 3:56 PM"
  bookClosureRange: string;   // e.g. "06/05/2026  - 08/05/2026"
};

async function fetchPsxPayouts(ticker: string): Promise<PayoutRow[]> {
  const body = new URLSearchParams({ symbol: ticker });
  const res = await fetch("https://dps.psx.com.pk/payouts", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (compatible; UnzeDashboard/1.0)",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return parsePayoutsHtml(html);
}

function parsePayoutsHtml(html: string): PayoutRow[] {
  // Extract <tr> rows from tbody — simple regex parse (no DOM available in Next.js edge)
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return [];

  const rows: PayoutRow[] = [];
  const trMatches = tbodyMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi);

  for (const trMatch of trMatches) {
    const tds = [...trMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (m) => stripTags(m[1]).trim()
    );
    // Columns: Symbol | Company | Sector | Dividend Announcement | Date/Time | Book Closure Date
    if (tds.length < 6) continue;
    const announcement = tds[3];
    const announcedAt = tds[4];
    const bookClosureRange = tds[5];
    if (!announcement || !bookClosureRange) continue;
    rows.push({ announcement, announcedAt, bookClosureRange });
  }
  return rows;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// ── Parsing ───────────────────────────────────────────────────────────────────

type UpsertCandidate = {
  ticker: string;
  dividend_per_share: number;
  ex_dividend_date: string;   // YYYY-MM-DD
  payment_date: string | null;
  announced_date: string | null;
  status: "upcoming" | "paid";
  notes: string;
};

function parsePayoutRow(ticker: string, row: PayoutRow): UpsertCandidate | null {
  // Parse dividend amount: "90%(i) (D)" → 9.00 (90% of face value Rs 10)
  const pctMatch = row.announcement.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!pctMatch) return null;
  const pct = parseFloat(pctMatch[1]);
  const faceValue = FACE_VALUE_OVERRIDES[ticker] ?? DEFAULT_FACE_VALUE;
  const dividend_per_share = Math.round((pct / 100) * faceValue * 10000) / 10000;

  // Parse book closure date range: "06/05/2026  - 08/05/2026"
  // First date = ex-dividend / book opening date
  const dateRangeMatch = row.bookClosureRange.match(
    /(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/
  );
  if (!dateRangeMatch) return null;

  const [, d1, m1, y1, d2, m2, y2] = dateRangeMatch;
  const ex_dividend_date = `${y1}-${m1}-${d1}`;
  const payment_date = `${y2}-${m2}-${d2}`;

  // Parse announced_at to YYYY-MM-DD
  const announced_date = parseAnnouncedDate(row.announcedAt);

  // Determine status: if ex_dividend_date is in the past, mark as paid
  const today = new Date().toISOString().slice(0, 10);
  const status: "upcoming" | "paid" = ex_dividend_date < today ? "paid" : "upcoming";

  // Preserve the raw PSX label in notes for traceability
  const notes = `PSX: ${row.announcement.trim()} | Book closure: ${row.bookClosureRange.trim()}`;

  return { ticker, dividend_per_share, ex_dividend_date, payment_date, announced_date, status, notes };
}

function parseAnnouncedDate(s: string): string | null {
  // "April 23, 2026 3:56 PM" → "2026-04-23"
  const m = s.match(/(\w+)\s+(\d+),\s+(\d{4})/);
  if (!m) return null;
  const months: Record<string, string> = {
    January: "01", February: "02", March: "03", April: "04",
    May: "05", June: "06", July: "07", August: "08",
    September: "09", October: "10", November: "11", December: "12",
  };
  const month = months[m[1]];
  if (!month) return null;
  return `${m[3]}-${month}-${m[2].padStart(2, "0")}`;
}
