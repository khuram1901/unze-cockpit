import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "../../../lib/supabase-server";

export async function POST(request: NextRequest) {
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
    const { data: listData } = await serviceClient.auth.admin.listUsers({ perPage: 1000 });
    const authUser = listData?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());

    if (!authUser) {
      return Response.json({ error: "User not found." }, { status: 404 });
    }

    const { error } = await serviceClient.auth.admin.updateUserById(authUser.id, { password: newPassword });

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
