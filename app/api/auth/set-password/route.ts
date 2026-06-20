import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return Response.json({ error: "Email and password required" }, { status: 400 });
    }
    if (password.length < 6) {
      return Response.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Find the auth user by listing and matching email
    const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const authUser = users?.find((u) => u.email === email.trim());

    if (!authUser) {
      return Response.json({ error: "No auth account found for this email" }, { status: 404 });
    }

    const { error } = await supabase.auth.admin.updateUserById(authUser.id, { password });

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
