"use client";

import AuthWrapper from "../lib/AuthWrapper";
import OpeningBalancesForm from "./OpeningBalancesForm";
import { PageHeader } from "../lib/SharedUI";
import { useMobile } from "../lib/useMobile";

export default function OpeningBalancesPage() {
  const isMobile = useMobile();
  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
        <PageHeader title="Opening Balances" subtitle="Set starting stock for each plant — dashboard counts forward from here" />
        <OpeningBalancesForm />
      </main>
    </AuthWrapper>
  );
}
