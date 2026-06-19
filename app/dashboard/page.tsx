"use client";

import AuthWrapper from "../lib/AuthWrapper";
import DashboardView from "./DashboardView";
import { useMobile } from "../lib/useMobile";

export default function DashboardPage() {
  const isMobile = useMobile();
  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "16px" : "40px", fontFamily: "sans-serif" }}>
        <h1 style={{ fontSize: isMobile ? "22px" : "28px", fontWeight: "bold", marginBottom: "8px" }}>
          Operations Dashboard
        </h1>
        <DashboardView />
      </main>
    </AuthWrapper>
  );
}
