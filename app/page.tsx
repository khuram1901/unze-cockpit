"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "./lib/supabase";
import { SkeletonRows } from "./lib/SharedUI";
import { STORE_USER_RE } from "./lib/useRouteGuard";

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    async function check() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Store users (store{3-digit-code}@unze.co.uk) go straight to
        // /daily-sales — they have no access to the main app.
        if (user.email && STORE_USER_RE.test(user.email)) {
          router.replace("/daily-sales");
        } else {
          router.replace("/welcome");
        }
      } else {
        router.replace("/login");
      }
    }
    check();
  }, [router]);

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f4f6f9", padding: "20px" }}>
      <div style={{ width: "100%", maxWidth: "400px" }}>
        <SkeletonRows count={3} height="40px" />
      </div>
    </main>
  );
}
