"use client";

import AuthWrapper from "../lib/AuthWrapper";
import DashboardView from "./DashboardView";
import { useMobile } from "../lib/useMobile";
import { useRequireCapability } from "../lib/useRouteGuard";

export default function DashboardPage() {
  const isMobile = useMobile();
  const { checking } = useRequireCapability("operations");
  if (checking) return <AuthWrapper><main style={{ padding: "20px 24px" }}><p style={{ color: "var(--text-secondary, #64748b)" }}>Checking permissions...</p></main></AuthWrapper>;
  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", fontFamily: "sans-serif", maxWidth: "100%", overflowX: "hidden" }}>
        <DashboardView />
      </main>
    </AuthWrapper>
  );
}
