"use client";

import AuthWrapper from "../lib/AuthWrapper";
import ProductionForm from "./ProductionForm";
import { useMobile } from "../lib/useMobile";

export default function ProductionPage() {
  const isMobile = useMobile();
  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", fontFamily: "sans-serif", maxWidth: "100%", overflowX: "hidden" }}>
        <button onClick={() => window.history.back()} style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: 600, color: "#1e293b", textDecoration: "none", marginBottom: "8px", padding: "4px 10px 4px 6px", borderRadius: "16px", backgroundColor: "#f1f5f9", border: "none", cursor: "pointer" }}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 12L6 8l4-4" /></svg>Back</button>
        <h1 style={{ fontSize: isMobile ? "22px" : "28px", fontWeight: "bold", marginBottom: "8px" }}>
          Daily Entry
        </h1>
        <p style={{ color: "#666", fontSize: "16px", marginBottom: isMobile ? "16px" : "24px" }}>
          Enter today&apos;s production and dispatch for your plant.
        </p>
        <ProductionForm />
      </main>
    </AuthWrapper>
  );
}
