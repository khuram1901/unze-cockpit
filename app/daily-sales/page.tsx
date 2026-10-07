"use client";

// /daily-sales — Retail Sales entry point for store users.
//
// PLACEHOLDER — Screen design not yet approved. This page exists so that:
//   1. Store users redirected here (via STORE_USER_RE) don't hit a 404.
//   2. The route can be tested end-to-end before the UI is designed.
//
// DO NOT build out this screen's UI until Khuram gives the explicit go-ahead
// (STOP condition A from the retail-sales plan).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
import { STORE_USER_RE } from "../lib/useRouteGuard";

export default function DailySalesPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    async function check() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.email) {
        router.replace("/login");
        return;
      }
      // Only store users and admin/CEO may access this page.
      // Regular staff who navigate here are bounced back to /welcome.
      const e = session.user.email;
      const isStoreUser = STORE_USER_RE.test(e);
      const isAdmin = e === "k.saleem@unzegroup.com" || e === "kamran@unze.co.uk";
      // Allow if store user OR admin (admins can preview/test the page)
      if (!isStoreUser && !isAdmin) {
        router.replace("/welcome");
        return;
      }
      setEmail(e);
      setChecking(false);
    }
    check();
  }, [router]);

  if (checking) {
    return (
      <main style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f4f6f9",
      }}>
        <p style={{ color: "#64748B", fontFamily: "var(--font-source-sans, system-ui)" }}>
          Loading…
        </p>
      </main>
    );
  }

  // ── Placeholder UI ─────────────────────────────────────────────────────────
  // Replace this block when the screen design is approved.
  return (
    <main style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "#f4f6f9",
      padding: "20px",
      fontFamily: "var(--font-source-sans, system-ui)",
    }}>
      <div style={{
        background: "#ffffff",
        border: "1px solid #EEF0F3",
        borderRadius: "12px",
        padding: "40px 32px",
        maxWidth: "480px",
        width: "100%",
        textAlign: "center",
      }}>
        {/* Unze wordmark */}
        <p style={{ fontSize: "13px", color: "#64748B", marginBottom: "8px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Unze Group
        </p>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#0F1720", margin: "0 0 8px" }}>
          Daily Sales
        </h1>
        <p style={{ fontSize: "15px", color: "#64748B", margin: "0 0 32px" }}>
          This page is being set up. Check back soon.
        </p>
        <p style={{ fontSize: "13px", color: "#94A3B8" }}>
          Signed in as {email}
        </p>
        <button
          onClick={() => supabase.auth.signOut().then(() => router.replace("/login"))}
          style={{
            marginTop: "24px",
            padding: "10px 24px",
            borderRadius: "8px",
            border: "1px solid #EEF0F3",
            background: "transparent",
            color: "#64748B",
            fontSize: "14px",
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
