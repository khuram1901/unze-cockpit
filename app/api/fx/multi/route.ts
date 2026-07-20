import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Uses Open Exchange Rates free endpoint — no API key, no sign-up.
// Single call returns all rates from USD base. We derive GBP and CNY
// cross-rates from the same response.
export async function GET() {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error("FX fetch failed");
    const data = await res.json();
    const rates = data.rates as Record<string, number>;

    const usdPkr = rates.PKR ?? 0;
    const gbpPkr = usdPkr / (rates.GBP ?? 1);
    const cnyPkr = usdPkr / (rates.CNY ?? 1);

    return NextResponse.json({
      USD: Math.round(usdPkr * 100) / 100,
      GBP: Math.round(gbpPkr * 100) / 100,
      CNY: Math.round(cnyPkr * 100) / 100,
      updatedAt: data.time_last_update_utc ?? null,
    });
  } catch {
    // Sensible fallbacks if API is unavailable
    return NextResponse.json({ USD: 278, GBP: 356, CNY: 38, updatedAt: null });
  }
}
