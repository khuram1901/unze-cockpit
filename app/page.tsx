"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "./lib/supabase";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    async function redirectUser() {
      const { data } = await supabase.auth.getUser();

      if (data.user) {
        router.replace("/executive");
      } else {
        router.replace("/login");
      }
    }

    redirectUser();
  }, [router]);

  return (
    <main style={{ padding: "40px", fontFamily: "sans-serif" }}>
      Loading...
    </main>
  );
}