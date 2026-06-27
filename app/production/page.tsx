"use client";

import AuthWrapper from "../lib/AuthWrapper";
import ProductionForm from "./ProductionForm";
import { useMobile } from "../lib/useMobile";

export default function ProductionPage() {
  const isMobile = useMobile();
  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", fontFamily: "sans-serif", maxWidth: "100%", overflowX: "hidden" }}>
        <ProductionForm />
      </main>
    </AuthWrapper>
  );
}
