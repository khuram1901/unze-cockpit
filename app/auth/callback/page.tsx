"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, loadMyPermissions } from "../../lib/supabase";
import { COLOURS } from "../../lib/SharedUI";
import { isDailyEntryOnly, type PermOverrides } from "../../lib/permissions";

type MemberProfile = {
  role: string | null;
  department: string | null;
};

// Mirrors app/login/page.tsx's getLandingRoute — kept in sync manually
// (small enough that a shared import isn't worth the extra indirection).
function getLandingRoute(profile: MemberProfile | null, email: string) {
  const lower = email.toLowerCase();
  if (lower === "khuram1901@gmail.com") return "/home";
  if (lower === "pa.ceo@unze.co.uk") return "/pa";
  const role = profile?.role || "Member";
  if (role === "Executive") return "/pa";
  if (role === "Admin") return "/home";
  return "/home";
}

// Landing page after "Sign in with Google". Handles both OAuth flow
// styles Supabase can use (PKCE ?code= or implicit #access_token=) so
// this works regardless of which one the project is configured for.
//
// Critically: signing in with Google never creates access on its own.
// Every other login path in this app only works for people Khuram has
// already added in Members — this does the same check here, and signs
// anyone without a matching row straight back out. Otherwise "Sign in
// with Google" would let literally any Google account in the door,
// which is exactly the kind of gap the rest of this security pass was
// about closing, not reopening.
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          router.replace(`/login?error=${encodeURIComponent(exchangeError.message)}`);
          return;
        }
      }

      const { data: { session } } = await supabase.auth.getSession();
      const email = session?.user?.email;

      if (!session || !email) {
        router.replace(`/login?error=${encodeURIComponent("Sign-in failed — please try again.")}`);
        return;
      }

      const { data: memberData } = await supabase
        .from("members")
        .select("role, department")
        .eq("email", email)
        .maybeSingle();

      if (!memberData) {
        await supabase.auth.signOut();
        router.replace(
          `/login?error=${encodeURIComponent("This Google account isn't registered. Contact your Unze Group administrator.")}`
        );
        return;
      }

      // Check if this is a daily-entry-only user (no broader app access)
      const permData = await loadMyPermissions();
      const overrides = (permData as PermOverrides | null);
      const ctx = { email, role: memberData.role ?? null, department: memberData.department ?? null, company: null, overrides, widgetOverrides: null };
      if (isDailyEntryOnly(ctx)) {
        router.replace("/daily-entry");
        return;
      }

      router.replace(getLandingRoute(memberData, email));
    })().catch(() => {
      setError("Something went wrong signing you in.");
      router.replace(`/login?error=${encodeURIComponent("Something went wrong signing you in.")}`);
    });
  }, [router]);

  return (
    <main style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>{error || "Signing you in…"}</p>
    </main>
  );
}
