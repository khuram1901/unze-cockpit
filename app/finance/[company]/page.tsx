"use client";

import { use } from "react";
import AuthWrapper from "../../lib/AuthWrapper";
import { getCompanyBySlug } from "../../lib/constants";
import { PageHeader } from "../../lib/SharedUI";
import { useMobile } from "../../lib/useMobile";
import { useRequireCapability } from "../../lib/useRouteGuard";
import FinanceManager from "../FinanceManager";

export default function CompanyFinancePage({ params }: { params: Promise<{ company: string }> }) {
  const { company } = use(params);
  const isMobile = useMobile();
  const { checking } = useRequireCapability("finance");
  const config = getCompanyBySlug(company);

  if (checking) return null;

  if (!config) {
    return (
      <AuthWrapper>
        <main style={{ padding: isMobile ? "12px 14px" : "20px 24px" }}>
          <PageHeader title="Company not found" subtitle={`No finance data configured for "${company}".`} />
        </main>
      </AuthWrapper>
    );
  }

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", overflowX: "hidden" }}>
        <PageHeader title={`Finance — ${config.name}`} subtitle="Opening balance, monthly plan, daily cash position, and forecasts" />
        <FinanceManager companyId={config.id} companyName={config.name} />
      </main>
    </AuthWrapper>
  );
}
