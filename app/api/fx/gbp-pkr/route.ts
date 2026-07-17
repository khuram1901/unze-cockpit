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
