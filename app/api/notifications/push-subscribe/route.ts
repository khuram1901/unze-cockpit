import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { rateLimitByIP, rateLimitResponse } from "../../../lib/rate-limit";
import { requireAuth } from "../../../lib/api-auth";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const rl = rateLimitByIP(request, 10, 60000);
  if (!rl.allowed) return rateLimitResponse();

  try {
    const { email, subscription } = await request.json();

    if (!email || !subscription || !subscription.endpoint) {
      return Response.json({ error: "email and subscription are required" }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Remove any existing subscription for this endpoint (upsert by endpoint)
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_email", email)
      .eq("subscription->>endpoint", subscription.endpoint);

    // Insert the new subscription
    const { error } = await supabase
      .from("push_subscriptions")
      .insert({ user_email: email, subscription });

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const rl = rateLimitByIP(request, 10, 60000);
  if (!rl.allowed) return rateLimitResponse();

  try {
    const { email } = await request.json();

    if (!email) {
      return Response.json({ error: "email is required" }, { status: 400 });
    }

    const supabase = createServiceClient();
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_email", email);

    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
