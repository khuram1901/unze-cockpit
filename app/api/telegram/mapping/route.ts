// Telegram integration removed. All routes return 410 Gone.
import { NextRequest } from "next/server";

export async function GET(_request: NextRequest) {
  return Response.json({ error: "Telegram integration has been removed." }, { status: 410 });
}

export async function POST(_request: NextRequest) {
  return Response.json({ error: "Telegram integration has been removed." }, { status: 410 });
}
