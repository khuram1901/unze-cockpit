import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { rateLimitByIP, rateLimitResponse } from "../../../lib/rate-limit";
import { requireAuth } from "../../../lib/api-auth";
import { canChangePasswordFor, type UserCtx, type PermOverrides } from "../../../lib/permissions";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const rl = rateLimitByIP(request, 5, 300000);
  if (!rl.allowed) return rateLimitResponse();
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return Response.json({ error: "Email and password required" }, { status: 400 });
    }
    if (password.length < 6) {
      return Response.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const supabase = createServiceClient();
    const normalised = email.trim().toLowerCase();

    // Found during the 15 Jul 2026 full-app audit: this route previously
    // only checked "is someone logged in," with the actual "who's allowed
    // to change whose password" logic (canChangePasswordFor) living only
    // client-side in MembersManager.tsx — so any authenticated member
    // could call this route directly and set any other account's
    // password, including Admin/CEO. This mirrors the same check
    // server-side, using the exact function the UI already trusts.
    const { data: actorMember } = await supabase
      .from("members").select("id, role, department, company").eq("email", auth.email).maybeSingle();
    let actorOverrides: PermOverrides | null = null;
    if (actorMember) {
      const { data: perms } = await supabase
        .from("member_permissions").select("*").eq("member_id", actorMember.id).maybeSingle();
      actorOverrides = (perms as PermOverrides) || null;
    }
    const actorCtx: UserCtx = {
      email: auth.email,
      role: actorMember?.role ?? null,
      department: actorMember?.department ?? null,
      company: actorMember?.company ?? null,
      overrides: actorOverrides,
    };

    const { data: targetMember } = await supabase
      .from("members").select("role").eq("email", normalised).maybeSingle();
    const targetCtx: UserCtx = { email: normalised, role: targetMember?.role ?? null };

    if (!canChangePasswordFor(actorCtx, targetCtx)) {
      return Response.json({ error: "You don't have permission to change this account's password." }, { status: 403 });
    }

    // Find the auth user by paginating (handles >1000 users)
    let authUser: { id: string } | null = null;
    let page = 1;
    while (!authUser) {
      const { data: listData, error: listErr } = await supabase.auth.admin.listUsers({ page, perPage: 500 });
      if (listErr) {
        console.error("listUsers failed:", listErr.message);
        return Response.json({ error: "Failed to look up user: " + listErr.message }, { status: 500 });
      }
      if (!listData?.users?.length) break;
      const found = listData.users.find((u) => u.email?.toLowerCase() === normalised);
      if (found) { authUser = found; break; }
      if (listData.users.length < 500) break;
      page++;
    }

    if (!authUser) {
      // Create the auth account with the desired password
      const { error: createErr } = await supabase.auth.admin.createUser({
        email: normalised,
        password,
        email_confirm: true,
      });
      if (createErr) {
        console.error("createUser failed:", createErr.message);
        return Response.json({ error: "Could not create auth account: " + createErr.message }, { status: 500 });
      }
      return Response.json({ success: true });
    }

    // Update existing user's password
    const { error } = await supabase.auth.admin.updateUserById(authUser.id, { password });

    if (error) {
      console.error("updateUserById failed:", error.message);
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("set-password error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
