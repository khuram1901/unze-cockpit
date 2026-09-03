// PUBLIC ROUTE — intentionally unauthenticated.
// Returns the GBP/PKR exchange rate from the public Frankfurter API.
// Contains no user-specific data. Called via plain fetch() from server
// components (home/page.tsx, investments/page.tsx) where no Authorization
// header is available. Adding requireAuth() here would break those callers
// without a larger refactor. Abuse is bounded by the upstream API's own
// rate limit and the absence of any sensitive data in the response.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(
      "https://api.frankfurter.app/latest?from=GBP&to=PKR",
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) throw new Error("FX fetch failed");
    const data = await res.json();
    return NextResponse.json({ rate: data?.rates?.PKR ?? 0 });
  } catch {
    return NextResponse.json({ rate: 356 });
  }
}
