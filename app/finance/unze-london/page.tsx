"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthWrapper from "../../lib/AuthWrapper";
import { PageHeader } from "../../lib/SharedUI";
import { useMobile } from "../../lib/useMobile";
import { useUserCtx } from "../../lib/useUserCtx";
import { canViewUnzeLondonFinance } from "../../lib/permissions";

export default function UnzeLondonCashFlowPage() {
  const isMobile = useMobile();
  const router = useRouter();
  const { ctx, loading } = useUserCtx();

  useEffect(() => {
    if (loading || !ctx) return;
    if (!canViewUnzeLondonFinance(ctx)) {
      router.replace("/home");
    }
  }, [loading, ctx, router]);

  if (loading) return null;

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
        <PageHeader />

        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px 24px",
          textAlign: "center",
          gap: 20,
        }}>
          {/* Logo / icon area */}
          <div style={{
            width: 72,
            height: 72,
            borderRadius: 16,
            background: "#EEF0F3",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 36,
          }}>
            🔗
          </div>

          <div style={{ maxWidth: 480 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#0F1720", marginBottom: 10 }}>
              Xero Cashflow — Coming Soon
            </div>
            <div style={{ fontSize: 15, color: "#64748B", lineHeight: 1.7, marginBottom: 24 }}>
              Unze London UK accounts are managed in Xero. Once the Xero API
              connection is set up, live cashflow, bank positions and PDC outlook
              will appear here automatically.
            </div>

            {/* Detail chips */}
            <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 10 }}>
              <div style={{
                padding: "8px 16px",
                background: "#EEF0F3",
                borderRadius: 8,
                fontSize: 13,
                color: "#64748B",
              }}>
                Company: Unze London (UZL)
              </div>
              <div style={{
                padding: "8px 16px",
                background: "#EEF0F3",
                borderRadius: 8,
                fontSize: 13,
                color: "#64748B",
              }}>
                Currency: GBP (£)
              </div>
              <div style={{
                padding: "8px 16px",
                background: "#EEF0F3",
                borderRadius: 8,
                fontSize: 13,
                color: "#64748B",
              }}>
                Store: Ilford Exchange (FM: 005)
              </div>
            </div>
          </div>

          {/* P&L link */}
          <div style={{ marginTop: 8, fontSize: 13, color: "#64748B" }}>
            Looking for the profit &amp; loss view?{" "}
            <a href="/finance/unze-london-pnl" style={{ color: "#0F7B5F", textDecoration: "none", fontWeight: 600 }}>
              Unze-UK P&amp;L →
            </a>
          </div>
        </div>
      </main>
    </AuthWrapper>
  );
}
