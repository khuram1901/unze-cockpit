"use client";

import { use } from "react";
import AuthWrapper from "../../lib/AuthWrapper";
import { getCompanyBySlug } from "../../lib/constants";
import { PageHeader } from "../../lib/SharedUI";
import { useMobile } from "../../lib/useMobile";
import FinanceManager from "../FinanceManager";

export default function CompanyFinancePage({ params }: { params: Promise<{ company: string }> }) {
  const { company } = use(params);
  const isMobile = useMobile();
  const config = getCompanyBySlug(company);

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
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
        <PageHeader title={`Finance — ${config.name}`} subtitle="Opening balance, monthly plan, daily cash position, and forecasts" />
        <FinanceManager companyId={config.id} companyName={config.name} />
      </main>
    </AuthWrapper>
  );
}
