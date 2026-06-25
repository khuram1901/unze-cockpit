import { NextRequest } from "next/server";
import webpush from "web-push";
import { createServiceClient } from "../../../lib/supabase-server";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_EMAIL = "mailto:k.saleem@unzegroup.com";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const { userEmail, title, body, url } = await request.json();

    if (!userEmail || !title || !body) {
      return Response.json({ error: "userEmail, title and body are required" }, { status: 400 });
    }

    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      return Response.json({ error: "VAPID keys not configured" }, { status: 500 });
    }

    const supabase = createServiceClient();
    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("subscription")
      .eq("user_email", userEmail);

    if (!subs || subs.length === 0) {
      return Response.json({ skipped: true, reason: "No push subscription found for user" });
    }

    const payload = JSON.stringify({ title, body, url: url || "/tasks" });
    let sent = 0;
    let failed = 0;

    for (const row of subs) {
      try {
        await webpush.sendNotification(row.subscription, payload);
        sent++;
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        // Remove expired/invalid subscriptions (410 Gone or 404)
        if (statusCode === 410 || statusCode === 404) {
          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("user_email", userEmail)
            .eq("subscription", row.subscription);
        }
        failed++;
      }
    }

    return Response.json({ success: true, sent, failed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
