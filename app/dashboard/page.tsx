"use client";

import AuthWrapper from "../lib/AuthWrapper";
import DashboardView from "./DashboardView";
import { useMobile } from "../lib/useMobile";
import { useRequireCapability } from "../lib/useRouteGuard";
import { COLOURS } from "../lib/SharedUI";

export default function DashboardPage() {
  const isMobile = useMobile();
  const { checking } = useRequireCapability("operations");
  if (checking) return <AuthWrapper><main style={{ padding: "14px 18px" }}><p style={{ color: `var(--text-secondary, ${COLOURS.SLATE})` }}>Checking permissions...</p></main></AuthWrapper>;
  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
        <DashboardView />
      </main>
    </AuthWrapper>
  );
}
