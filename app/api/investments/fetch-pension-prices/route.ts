import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

const CRON_SECRET = process.env.CRON_SECRET;

// Morningstar internal IDs keyed by ISIN
const MORNINGSTAR_IDS: Record<string, string> = {
  "GB00BVRZG281": "F00000VBU2",
  "GB00BRDCMX84": "VAUSA0P5GL",
};

// Morningstar API tokens — listed in order of preference. The lt. endpoint
// uses rotating session tokens. When one stops working, we fall through to
// the next. Update these when Morningstar rotates their public widget tokens
// (check by inspecting any embedded Morningstar chart on morningstar.co.uk).
const MS_TOKENS = ["klr5zyak8x", "9vehuxllxs", "bzxpplv0mi"];

// Parse a Morningstar COMPACTJSON timeseries response and extract the latest price (in £).
// Morningstar returns prices in pence for GBP funds, so values > 10 are divided by 100.
function parseMorningstarPrice(json: unknown): number | null {
  const detail = (json as Record<string, unknown>)?.TimeSeries
    ? ((json as Record<string, unknown>).TimeSeries as Record<string, unknown>)?.Security
    : null;
  const historyDetail = Array.isArray(detail)
    ? (detail[0] as Record<string, unknown>)?.HistoryDetail
    : null;
  if (!Array.isArray(historyDetail) || historyDetail.length === 0) return null;
  const latest = historyDetail[historyDetail.length - 1] as Record<string, string>;
  const val = parseFloat(latest?.Value ?? "");
  if (isNaN(val) || val <= 0) return null;
  // Morningstar returns prices in pence for GBP funds — convert to pounds
  return val > 10 ? val / 100 : val;
}

async function fetchMorningstarPrice(msId: string, startDate: string): Promise<{ price: number; token: string } | null> {
  for (const token of MS_TOKENS) {
    const url = `https://lt.morningstar.com/api/rest.svc/timeseries_price/${token}?id=${msId}&currencyId=GBP&idtype=Morningstar&frequency=daily&startDate=${startDate}&outputType=COMPACTJSON`;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          "Referer": "https://www.morningstar.co.uk/",
          "Origin": "https://www.morningstar.co.uk",
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "en-GB,en;q=0.9",
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) continue; // try next token

      const json = await res.json();
      const price = parseMorningstarPrice(json);
      if (price !== null) return { price, token };
    } catch {
      // Network error / timeout — try next token
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const isCron = CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`;

  if (!isCron) {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;
    const db = createServiceClient();
    const { data: m } = await db
      .from("members")
      .select("role")
      .eq("email", (auth as { email: string }).email.toLowerCase())
      .maybeSingle();
    const role = m?.role ?? null;
    const isAdmin =
      (auth as { email: string }).email.toLowerCase() === "khuram1901@gmail.com" ||
      role === "Admin" ||
      role === "CEO";
    if (!isAdmin) return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = createServiceClient();

  // 1. Load active funds
  const { data: funds, error: fundsErr } = await db
    .from("pension_funds")
    .select("isin, fund_name")
    .eq("active", true);

  if (fundsErr || !funds?.length) {
    return Response.json({ error: fundsErr?.message ?? "No active pension funds" }, { status: 500 });
  }

  const today = new Date().toISOString().slice(0, 10);
  // Fetch a wider window (7 days back) so we can catch prices on days when
  // Morningstar hasn't published today's price yet (e.g. early morning runs).
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const results: { isin: string; price: number; date: string; source: string }[] = [];
  const errors: string[] = [];
  const skipped: string[] = [];

  // 2. Fetch price for each fund from Morningstar
  for (const fund of funds) {
    const msId = MORNINGSTAR_IDS[fund.isin];
    if (!msId) {
      errors.push(`${fund.isin}: no Morningstar ID mapping`);
      continue;
    }

    const fetched = await fetchMorningstarPrice(msId, weekAgo);

    if (fetched === null) {
      // API failed — do NOT insert a hardcoded fallback price. Instead, skip
      // this fund so the DB retains its last genuine price. This means the
      // "last updated" date on screen will honestly reflect when we last got
      // a real price, rather than repeating a stale seed value every day.
      errors.push(`${fund.isin}: all Morningstar tokens failed — skipping insert, DB retains last known price`);
      skipped.push(fund.isin);
      continue;
    }

    // 3. Upsert to pension_fund_prices using today's date
    const { error: upsertErr } = await db
      .from("pension_fund_prices")
      .upsert(
        { isin: fund.isin, price_date: today, price_gbp: fetched.price, source: `morningstar:${fetched.token}` },
        { onConflict: "isin,price_date" }
      );

    if (upsertErr) {
      errors.push(`${fund.isin}: upsert error — ${upsertErr.message}`);
    } else {
      results.push({ isin: fund.isin, price: fetched.price, date: today, source: `morningstar:${fetched.token}` });
    }
  }

  // 4. Fetch comparison fund prices from Morningstar
  // ISINs are placeholders until verified — skip any fund whose ISIN starts with "PLACEHOLDER"
  const compResults: { isin: string; price: number; date: string }[] = [];
  const { data: compFunds } = await db
    .from("pension_comparison_funds")
    .select("isin, fund_name, morningstar_id")
    .eq("active", true);

  for (const cf of compFunds ?? []) {
    if (!cf.morningstar_id || cf.isin.startsWith("PLACEHOLDER")) continue;

    const fetched = await fetchMorningstarPrice(cf.morningstar_id, weekAgo);
    if (fetched === null) {
      errors.push(`comp ${cf.isin}: all tokens failed`);
      continue;
    }

    const { error: compErr } = await db
      .from("pension_comparison_prices")
      .upsert(
        { isin: cf.isin, price_date: today, price_gbp: fetched.price, source: `morningstar:${fetched.token}` },
        { onConflict: "isin,price_date" }
      );
    if (compErr) {
      errors.push(`comp ${cf.isin}: upsert error — ${compErr.message}`);
    } else {
      compResults.push({ isin: cf.isin, price: fetched.price, date: today });
    }
  }

  // 5. Fetch live GBP/PKR rate
  let gbpPkrRate: number | null = null;
  try {
    const fxRes = await fetch("https://api.frankfurter.app/latest?from=GBP&to=PKR", {
      signal: AbortSignal.timeout(8_000),
    });
    if (fxRes.ok) {
      const fxData = await fxRes.json();
      gbpPkrRate = fxData?.rates?.PKR ?? null;
    }
  } catch {
    // Non-fatal — rate is fetched client-side too
  }

  return Response.json({
    ok: true,
    funds: results,
    comparison_funds: compResults,
    gbp_pkr_rate: gbpPkrRate,
    skipped: skipped.length > 0 ? skipped : undefined,
    errors: errors.length > 0 ? errors : undefined,
  });
}
