"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "./lib/supabase";

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    async function check() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        router.replace("/home");
      } else {
        router.replace("/login");
      }
    }
    check();
  }, [router]);

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f4f6f9" }}>
      <p style={{ color: "var(--text-secondary, #64748b)", fontSize: "16px" }}>Loading...</p>
    </main>
  );
}
