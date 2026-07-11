import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";

const CRON_SECRET = process.env.CRON_SECRET;

// Morningstar internal IDs keyed by ISIN
const MORNINGSTAR_IDS: Record<string, string> = {
  "GB00BVRZG281": "F00000VBU2",
  "GB00BRDCMX84": "VAUSA0P5GL",
};

// Fallback prices (£) used only if the API fetch fails for a fund
const FALLBACK_PRICES: Record<string, number> = {
  "GB00BVRZG281": 2.4384,
  "GB00BRDCMX84": 1.4881,
};

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
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const results: { isin: string; price: number; date: string; source: string }[] = [];
  const errors: string[] = [];

  // 2. Fetch price for each fund from Morningstar
  for (const fund of funds) {
    const msId = MORNINGSTAR_IDS[fund.isin];
    if (!msId) {
      errors.push(`${fund.isin}: no Morningstar ID mapping`);
      continue;
    }

    let price: number | null = null;
    let source = "morningstar";

    try {
      const url = `https://lt.morningstar.com/api/rest.svc/timeseries_price/9vehuxllxs?id=${msId}&currencyId=GBP&idtype=Morningstar&frequency=daily&startDate=${yesterday}&outputType=COMPACTJSON`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; UnzeDashboard/1.0)" },
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok) {
        const json = await res.json();
        // COMPACTJSON format: { TimeSeries: { Security: [{ HistoryDetail: [{EndDate, Value}] }] } }
        const detail = json?.TimeSeries?.Security?.[0]?.HistoryDetail;
        if (Array.isArray(detail) && detail.length > 0) {
          // Latest entry is last in the array
          const latest = detail[detail.length - 1];
          const val = parseFloat(latest?.Value ?? "");
          if (!isNaN(val) && val > 0) {
            // Morningstar returns prices in pence for GBP funds — convert to pounds
            price = val > 10 ? val / 100 : val;
          }
        }
      }
    } catch (e) {
      errors.push(`${fund.isin}: fetch error — ${e instanceof Error ? e.message : String(e)}`);
    }

    // Fall back to last known fallback if API failed
    if (price === null) {
      price = FALLBACK_PRICES[fund.isin] ?? null;
      source = "fallback";
      if (price === null) {
        errors.push(`${fund.isin}: no price available`);
        continue;
      }
    }

    // 3. Upsert to pension_fund_prices
    const { error: upsertErr } = await db
      .from("pension_fund_prices")
      .upsert(
        { isin: fund.isin, price_date: today, price_gbp: price, source },
        { onConflict: "isin,price_date" }
      );

    if (upsertErr) {
      errors.push(`${fund.isin}: upsert error — ${upsertErr.message}`);
    } else {
      results.push({ isin: fund.isin, price, date: today, source });
    }
  }

  // 4. Fetch live GBP/PKR rate
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
    gbp_pkr_rate: gbpPkrRate,
    errors: errors.length > 0 ? errors : undefined,
  });
}
