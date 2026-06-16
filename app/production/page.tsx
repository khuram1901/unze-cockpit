import AuthWrapper from "../lib/AuthWrapper";
import ProductionForm from "./ProductionForm";

export default function ProductionPage() {
  return (
    <AuthWrapper>
      <main style={{ padding: "40px", fontFamily: "sans-serif" }}>
        <h1 style={{ fontSize: "28px", fontWeight: "bold", marginBottom: "8px" }}>
          Daily Entry
        </h1>
        <p style={{ color: "#666", fontSize: "14px", marginBottom: "24px" }}>
          Enter today&apos;s production and dispatch for your plant. Anyone can submit.
        </p>
        <ProductionForm />
      </main>
    </AuthWrapper>
  );
}
