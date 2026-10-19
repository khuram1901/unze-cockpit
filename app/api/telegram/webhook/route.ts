// Telegram integration removed. Webhook returns 410 Gone.
import { NextRequest } from "next/server";

export const maxDuration = 10;

export async function POST(_request: NextRequest) {
  return Response.json({ error: "Telegram integration has been removed." }, { status: 410 });
}
