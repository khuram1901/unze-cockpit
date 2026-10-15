"use client";

import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthWrapper from "../../lib/AuthWrapper";
import { getCompanyBySlug } from "../../lib/constants";
import { PageHeader } from "../../lib/SharedUI";
import { useMobile } from "../../lib/useMobile";
import { useUserCtx } from "../../lib/useUserCtx";
import { financeCompanies, canViewFinance, widgetVisible } from "../../lib/permissions";
import FinanceManager from "../FinanceManager";
import RetailSalesTab from "../RetailSalesTab";

export default function CompanyFinancePage({ params }: { params: Promise<{ company: string }> }) {
  const { company } = use(params);
  const isMobile = useMobile();
  const router = useRouter();
  // No useRequireCapability("finance") here — imperial lets in widget-only users
  // (retail_sales or finance_overview), while other companies still need canViewFinance.
  // The redirect logic below enforces access rather than the capability hook.
  const { ctx, loading: ctxLoading } = useUserCtx();
  const config = getCompanyBySlug(company);
  const [activeTab, setActiveTab] = useState<"overview" | "retail">("overview");

  const isAdminOrCEO = ctx?.role === "Admin" || ctx?.role === "CEO";
  const hasFullFinance = !!ctx && canViewFinance(ctx);

  // Per-tab access for the imperial page.
  // Finance Overview: finance role by default, or explicit widget override.
  const canSeeFinanceOverview =
    company === "imperial" && !!ctx &&
    (hasFullFinance || isAdminOrCEO || widgetVisible(ctx, "imperial.finance_overview", false));

  // Retail Sales: Admin/CEO always; others need explicit imperial.retail_sales widget.
  const canSeeRetailTab =
    company === "imperial" && !!ctx &&
    (isAdminOrCEO || widgetVisible(ctx, "imperial.retail_sales", false));

  // Access enforcement: run once ctx is loaded.
  useEffect(() => {
    if (ctxLoading || !ctx) return;

    if (company === "imperial") {
      // Imperial: allow if user has any access (role or either tab widget).
      const canAccess =
        hasFullFinance || isAdminOrCEO ||
        widgetVisible(ctx, "imperial.retail_sales", false) ||
        widgetVisible(ctx, "imperial.finance_overview", false);
      if (!canAccess) { router.replace("/home"); return; }

      // Finance-role users: additionally enforce company scope.
      if (hasFullFinance && !isAdminOrCEO) {
        const scope = financeCompanies(ctx);
        if (scope !== "both" && scope !== "IFPL") { router.replace("/home"); return; }
      }
    } else {
      // Non-imperial: must have full finance role with correct company scope.
      // (mirrors the original useRequireCapability("finance") + per-company check)
      if (!hasFullFinance && !isAdminOrCEO) { router.replace("/home"); return; }
      if (config) {
        const scope = financeCompanies(ctx);
        const allowed = scope === "both" || scope === config.shortCode;
        if (!allowed) { router.replace("/home"); return; }
      }
    }
  }, [ctxLoading, ctx, company, config, hasFullFinance, isAdminOrCEO, router]);

  if (ctxLoading) return null;

  if (!config) {
    return (
      <AuthWrapper>
        <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
          <PageHeader />
        </main>
      </AuthWrapper>
    );
  }

  // Show the tab bar only when the user can access BOTH tabs.
  // A finance-only user sees Finance Overview directly (no tab chrome).
  // A retail-only user sees Retail Sales directly (no tab chrome).
  const showTabBar = canSeeFinanceOverview && canSeeRetailTab;

  // If the user has no Finance Overview access, lock them to the retail tab.
  const displayTab = (!canSeeFinanceOverview && canSeeRetailTab) ? "retail" : activeTab;

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

        {/* FinanceManager: only when user can see Finance Overview AND that tab is active.
            Widget-only Retail-Sales users never see or mount this component. */}
        {canSeeFinanceOverview && displayTab === "overview" && (
          <FinanceManager companyId={config.id} companyName={config.name} />
        )}

        {canSeeRetailTab && displayTab === "retail" && (
          <RetailSalesTab companyId={config.id} />
        )}
      </main>
    </AuthWrapper>
  );
}
