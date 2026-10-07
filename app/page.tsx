"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "./lib/supabase";
import { SkeletonRows } from "./lib/SharedUI";

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    async function check() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Determine routing via the DB flag, not email pattern.
        // Look up member_permissions.can_access_daily_sales through the
        // members table (joined by email). Only redirect to /daily-sales
        // when the flag is explicitly true; everyone else goes to /welcome.
        let goToDailySales = false;
        if (user.email) {
          const { data } = await supabase
            .from("members")
            .select("member_permissions(can_access_daily_sales)")
            .eq("email", user.email)
            .maybeSingle();
          goToDailySales =
            Array.isArray(data?.member_permissions) &&
            data.member_permissions[0]?.can_access_daily_sales === true;
        }
        router.replace(goToDailySales ? "/daily-sales" : "/welcome");
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
