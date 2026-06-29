import { createClient } from "@supabase/supabase-js";

export async function requireAuth(req: Request): Promise<{ email: string } | Response> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }
  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user?.email) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }
  return { email: user.email };
}
