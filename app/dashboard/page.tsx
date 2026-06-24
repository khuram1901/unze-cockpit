"use client";

import AuthWrapper from "../lib/AuthWrapper";
import DashboardView from "./DashboardView";
import { useMobile } from "../lib/useMobile";

export default function DashboardPage() {
  const isMobile = useMobile();
  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "16px" : "40px", fontFamily: "sans-serif" }}>
        <a href="/home" style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px", fontWeight: 600, color: "#64748b", textDecoration: "none", marginBottom: "6px" }}>← Home</a>
        <h1 style={{ fontSize: isMobile ? "22px" : "28px", fontWeight: "bold", marginBottom: "8px" }}>
          Operations Dashboard
        </h1>
        <DashboardView />
      </main>
    </AuthWrapper>
  );
}
