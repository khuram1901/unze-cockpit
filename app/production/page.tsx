"use client";

import AuthWrapper from "../lib/AuthWrapper";
import ProductionForm from "./ProductionForm";
import { useMobile } from "../lib/useMobile";
import { useRequireCapability } from "../lib/useRouteGuard";
import { COLOURS } from "../lib/SharedUI";

export default function ProductionPage() {
  const isMobile = useMobile();
  const { checking } = useRequireCapability("daily_entry");
  if (checking) return <AuthWrapper><main style={{ padding: "14px 18px" }}><p style={{ color: `var(--text-secondary, ${COLOURS.SLATE})` }}>Checking permissions...</p></main></AuthWrapper>;
  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
        <ProductionForm />
      </main>
    </AuthWrapper>
  );
}
