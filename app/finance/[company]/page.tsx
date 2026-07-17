"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import AuthWrapper from "../../lib/AuthWrapper";
import { getCompanyBySlug } from "../../lib/constants";
import { PageHeader } from "../../lib/SharedUI";
import { useMobile } from "../../lib/useMobile";
import { useRequireCapability } from "../../lib/useRouteGuard";
import { useUserCtx } from "../../lib/useUserCtx";
import { financeCompanies } from "../../lib/permissions";
import FinanceManager from "../FinanceManager";

export default function CompanyFinancePage({ params }: { params: Promise<{ company: string }> }) {
  const { company } = use(params);
  const isMobile = useMobile();
  const router = useRouter();
  const { checking } = useRequireCapability("finance");
  const { ctx, loading: ctxLoading } = useUserCtx();
  const config = getCompanyBySlug(company);

  // useRequireCapability("finance") only checks whether the user can view
  // finance at all — it has no idea which company the URL is for. Found 16
  // Jul 2026 while reviewing Kamran's access: his finance_company_scope was
  // "IFPL" but the sidebar just hid the Unze Trading link rather than the
  // page actually blocking it, so the URL alone would have let him in and
  // let him edit it. This is the real per-company enforcement.
  if (!checking && !ctxLoading && ctx && config) {
    const scope = financeCompanies(ctx);
    const allowed = scope === "both" || scope === config.shortCode;
    if (!allowed) {
      router.replace("/home");
      return null;
    }
  }

  if (checking || ctxLoading) return null;

  if (!config) {
    return (
      <AuthWrapper>
        <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
          <PageHeader />
        </main>
      </AuthWrapper>
    );
  }

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
        <PageHeader />
        <FinanceManager companyId={config.id} companyName={config.name} />
      </main>
    </AuthWrapper>
  );
}
