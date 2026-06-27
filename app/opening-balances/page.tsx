"use client";

import AuthWrapper from "../lib/AuthWrapper";
import OpeningBalancesForm from "./OpeningBalancesForm";
import { PageHeader } from "../lib/SharedUI";
import { useMobile } from "../lib/useMobile";
import { useRequireCapability } from "../lib/useRouteGuard";

export default function OpeningBalancesPage() {
  const { checking } = useRequireCapability("finance");
  const isMobile = useMobile();

  if (checking) return <AuthWrapper><main style={{ padding: "20px 24px" }}><p style={{ color: "#64748b" }}>Checking permissions...</p></main></AuthWrapper>;

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", overflowX: "hidden" }}>
        <PageHeader title="Opening Balances" subtitle="Set starting stock for each plant — dashboard counts forward from here" />
        <OpeningBalancesForm />
      </main>
    </AuthWrapper>
  );
}
