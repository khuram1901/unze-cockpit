import AuthWrapper from "../lib/AuthWrapper";
import OpeningBalancesForm from "./OpeningBalancesForm";

export default function OpeningBalancesPage() {
  return (
    <AuthWrapper>
      <main style={{ padding: "40px", fontFamily: "sans-serif" }}>
        <h1 style={{ fontSize: "28px", fontWeight: "bold", marginBottom: "8px" }}>
          Set Opening Balances
        </h1>
        <p style={{ color: "#666", fontSize: "14px", marginBottom: "24px" }}>
          Admin only. Set the starting stock for each plant. The dashboard counts
          forward from here using daily entries.
        </p>
        <OpeningBalancesForm />
      </main>
    </AuthWrapper>
  );
}
