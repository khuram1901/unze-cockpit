"use client";

import AuthWrapper from "../lib/AuthWrapper";
import DashboardView from "./DashboardView";
import { useMobile } from "../lib/useMobile";

export default function DashboardPage() {
  const isMobile = useMobile();
  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", fontFamily: "sans-serif", maxWidth: "100%", overflowX: "hidden" }}>
        <DashboardView />
      </main>
    </AuthWrapper>
  );
}
