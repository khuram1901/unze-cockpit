"use client";

import { use } from "react";
import AuthWrapper from "../../lib/AuthWrapper";
import { getCompanyBySlug } from "../../lib/constants";
import FinanceManager from "../FinanceManager";

export default function CompanyFinancePage({ params }: { params: Promise<{ company: string }> }) {
  const { company } = use(params);
  const config = getCompanyBySlug(company);

  if (!config) {
    return (
      <AuthWrapper>
        <main style={{ padding: "20px 24px" }}>
          <h1 style={{ fontSize: "26px", fontWeight: 800, color: "#1e293b" }}>Company not found</h1>
          <p style={{ color: "#64748b", fontSize: "16px" }}>
            No finance data configured for &ldquo;{company}&rdquo;.
          </p>
        </main>
      </AuthWrapper>
    );
  }

  return (
    <AuthWrapper>
      <main style={{ padding: "20px 24px" }}>
        <div style={{ marginBottom: "16px" }}>
          <h1 style={{ fontSize: "26px", fontWeight: 800, color: "#1e293b", margin: 0 }}>
            Finance &mdash; {config.name}
          </h1>
          <p style={{ color: "#64748b", fontSize: "16px", marginTop: "5px" }}>
            Set the opening balance, enter each month&rsquo;s expected receivables and payouts, and record daily cash figures.
          </p>
        </div>
        <FinanceManager companyId={config.id} companyName={config.name} />
      </main>
    </AuthWrapper>
  );
}
