"use client";

import AuthWrapper from "../lib/AuthWrapper";
import ProductionForm from "./ProductionForm";
import { useMobile } from "../lib/useMobile";

export default function ProductionPage() {
  const isMobile = useMobile();
  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "16px" : "40px", fontFamily: "sans-serif" }}>
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
