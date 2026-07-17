import { NextResponse } from "next/server";
import { requireAuth } from "../../../lib/api-auth";
import { createServiceClient } from "../../../lib/supabase-server";
import { canRefreshInvestmentPrices, type UserCtx, type PermOverrides } from "../../../lib/permissions";

const CRON_SECRET = process.env.CRON_SECRET;

async function fetchPricePSX(ticker: string): Promise<number | null> {
  try {
    const res = await fetch(`https://dps.psx.com.pk/timeseries/eod/${ticker}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const rows = json?.data;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const latest = rows[0];
    const close = latest[3];
    return typeof close === "number" && close > 0 ? close : null;
  } catch {
    return null;
  }
}

async function fetchPriceYahoo(ticker: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.KA?interval=1d&range=5d`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return null;
    const json = await res.json();
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (!Array.isArray(closes) || closes.length === 0) return null;
    for (let i = closes.length - 1; i >= 0; i--) {
      if (typeof closes[i] === "number" && closes[i] > 0) return closes[i];
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchPrice(ticker: string): Promise<{ price: number; source: string } | null> {
  const psx = await fetchPricePSX(ticker);
  if (psx !== null) return { price: psx, source: "psx_dps" };
  const yahoo = await fetchPriceYahoo(ticker);
  if (yahoo !== null) return { price: Math.round(yahoo * 100) / 100, source: "yahoo" };
  return null;
}

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const isCron = authHeader === `Bearer ${CRON_SECRET}`;

  const sb = createServiceClient();

  if (!isCron) {
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;

    const { data: member } = await sb
      .from("members").select("id, role, department, company").eq("email", auth.email).maybeSingle();
    let overrides: PermOverrides | null = null;
    if (member) {
      const { data: perms } = await sb
        .from("member_permissions").select("*").eq("member_id", member.id).maybeSingle();
      overrides = (perms as PermOverrides) || null;
    }
    const ctx: UserCtx = {
      email: auth.email,
      role: member?.role ?? null,
      department: member?.department ?? null,
      company: member?.company ?? null,
      overrides,
    };
    if (!canRefreshInvestmentPrices(ctx)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: holdings } = await sb
    .from("holdings")
    .select("ticker")
    .order("ticker");

  if (!holdings || holdings.length === 0) {
    return NextResponse.json({ message: "No holdings found" });
  }

  const tickers = [...new Set(holdings.map((h) => h.ticker))];
  const today = new Date().toISOString().slice(0, 10);

  const results: { ticker: string; price: number | null; source: string; error?: string }[] = [];

  const BATCH = 5;
  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch = tickers.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(async (ticker) => {
        const result = await fetchPrice(ticker);
        if (result) {
          const { error } = await sb.from("price_history").upsert(
            { ticker, price: result.price, as_of_date: today, source: result.source },
            { onConflict: "ticker,as_of_date" },
          );
          return { ticker, price: result.price, source: result.source, error: error?.message };
        }
        return { ticker, price: null, source: "none" as const, error: "All sources failed" };
      }),
    );
    for (const s of settled) {
      results.push(s.status === "fulfilled" ? s.value : { ticker: "?", price: null, source: "none", error: String(s.reason) });
    }
  }

  const succeeded = results.filter((r) => r.price !== null).length;
  const failed = results.filter((r) => r.price === null).length;

  return NextResponse.json({
    date: today,
    total: tickers.length,
    succeeded,
    failed,
    results,
  });
}
