"use client";

import AuthWrapper from "../lib/AuthWrapper";
import DashboardView from "./DashboardView";
import { useMobile } from "../lib/useMobile";

export default function DashboardPage() {
  const isMobile = useMobile();
  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "16px" : "40px", fontFamily: "sans-serif" }}>
        <a href="/home" style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: 600, color: "#1e293b", textDecoration: "none", marginBottom: "8px", padding: "4px 10px 4px 6px", borderRadius: "16px", backgroundColor: "#f1f5f9" }}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 12L6 8l4-4" /></svg>Dashboard</a>
        <h1 style={{ fontSize: isMobile ? "22px" : "28px", fontWeight: "bold", marginBottom: "8px" }}>
          Operations Dashboard
        </h1>
        <DashboardView />
      </main>
    </AuthWrapper>
  );
}
