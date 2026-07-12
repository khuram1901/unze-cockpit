"use client";

import AuthWrapper from "../lib/AuthWrapper";
import OpeningBalancesForm from "./OpeningBalancesForm";
import { PageHeader, COLOURS } from "../lib/SharedUI";
import { useMobile } from "../lib/useMobile";
import { useRequireCapability } from "../lib/useRouteGuard";

export default function OpeningBalancesPage() {
  const { checking } = useRequireCapability("finance");
  const isMobile = useMobile();

  if (checking) return <AuthWrapper><main style={{ padding: "14px 18px" }}><p style={{ color: `var(--text-secondary, ${COLOURS.SLATE})` }}>Checking permissions...</p></main></AuthWrapper>;

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
        <PageHeader />
        <OpeningBalancesForm />
      </main>
    </AuthWrapper>
  );
}
