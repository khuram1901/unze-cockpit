import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "../../../lib/supabase-server";
import { rateLimitByIP, rateLimitResponse } from "../../../lib/rate-limit";

export async function POST(request: NextRequest) {
  const rl = rateLimitByIP(request, 5, 300000);
  if (!rl.allowed) return rateLimitResponse();
  try {
    const { email, currentPassword, newPassword } = await request.json();

    if (!email || !currentPassword || !newPassword) {
      return Response.json({ error: "All fields are required." }, { status: 400 });
    }
    if (newPassword.length < 6) {
      return Response.json({ error: "New password must be at least 6 characters." }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const tempClient = createClient(url, anonKey);

    const { error: signInError } = await tempClient.auth.signInWithPassword({
      email,
      password: currentPassword,
    });

    if (signInError) {
      return Response.json({ error: "Current password is incorrect." }, { status: 401 });
    }

    const serviceClient = createServiceClient();

    // Find user by paginating through auth users (handles >1000 users)
    let authUserId: string | null = null;
    const normalised = email.toLowerCase();
    let page = 1;
    while (!authUserId) {
      const { data } = await serviceClient.auth.admin.listUsers({ page, perPage: 500 });
      if (!data?.users?.length) break;
      const found = data.users.find((u) => u.email?.toLowerCase() === normalised);
      if (found) { authUserId = found.id; break; }
      if (data.users.length < 500) break;
      page++;
    }

    if (!authUserId) {
      return Response.json({ error: "User not found." }, { status: 404 });
    }

    const { error } = await serviceClient.auth.admin.updateUserById(authUserId, { password: newPassword });

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
