"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import AuthWrapper from "../../lib/AuthWrapper";
import { getCompanyBySlug } from "../../lib/constants";
import { PageHeader } from "../../lib/SharedUI";
import { useMobile } from "../../lib/useMobile";
import { useRequireCapability } from "../../lib/useRouteGuard";
import { useUserCtx } from "../../lib/useUserCtx";
import { financeCompanies, widgetVisible } from "../../lib/permissions";
import FinanceManager from "../FinanceManager";
import RetailSalesTab from "../RetailSalesTab";

export default function CompanyFinancePage({ params }: { params: Promise<{ company: string }> }) {
  const { company } = use(params);
  const isMobile = useMobile();
  const router = useRouter();
  const { checking } = useRequireCapability("finance");
  const { ctx, loading: ctxLoading } = useUserCtx();
  const config = getCompanyBySlug(company);
  const [activeTab, setActiveTab] = useState<"overview" | "retail">("overview");

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

  // Retail Sales tab is only visible to users who have the imperial.retail_sales
  // widget enabled (explicit override row required — default is false).
  // The tab is only available on the imperial company page.
  const canSeeRetailTab =
    company === "imperial" && !!ctx && widgetVisible(ctx, "imperial.retail_sales", false);

  // Tab bar is only rendered when there are 2 tabs to show (Finance Overview +
  // Retail Sales).  A plain finance user sees the Finance Overview content
  // directly with no tab chrome above it.
  const showTabBar = canSeeRetailTab; // Finance Overview is always available for any user who reaches this page

  const TAB_STYLE_BASE: React.CSSProperties = {
    padding: "10px 20px",
    fontSize: 13,
    fontWeight: 500,
    color: "#64748B",
    cursor: "pointer",
    borderBottom: "2px solid transparent",
    marginBottom: -1,
    background: "none",
    border: "none",
    borderBottomStyle: "solid",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    transition: "color 0.15s",
    fontFamily: "inherit",
  };

  const TAB_ACTIVE_EXTRA: React.CSSProperties = {
    color: "#0F1720",
    borderBottomColor: "#0F1720",
    fontWeight: 600,
  };

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
        <PageHeader />

        {showTabBar && (
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid #EEF0F3",
              marginBottom: 20,
              gap: 0,
            }}
          >
            <button
              style={{
                ...TAB_STYLE_BASE,
                ...(activeTab === "overview" ? TAB_ACTIVE_EXTRA : {}),
              }}
              onClick={() => setActiveTab("overview")}
            >
              Finance Overview
            </button>
            <button
              style={{
                ...TAB_STYLE_BASE,
                ...(activeTab === "retail" ? TAB_ACTIVE_EXTRA : {}),
              }}
              onClick={() => setActiveTab("retail")}
            >
              Retail Sales
            </button>
          </div>
        )}

        {/* FinanceManager is only mounted when the Finance Overview tab is active.
            It is never mounted for widget-only users viewing the Retail Sales tab. */}
        {activeTab === "overview" && (
          <FinanceManager companyId={config.id} companyName={config.name} />
        )}

        {activeTab === "retail" && canSeeRetailTab && (
          <RetailSalesTab companyId={config.id} />
        )}
      </main>
    </AuthWrapper>
  );
}
