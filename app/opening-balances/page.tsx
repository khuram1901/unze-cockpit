// app/opening-balances/page.tsx
// Replace the existing page.tsx with this file.
// The OpeningBalancesForm is kept in its own file — only its page wrapper changes.

import AuthWrapper from "../lib/AuthWrapper";
import OpeningBalancesForm from "./OpeningBalancesForm";

const NAVY = "#1e293b";
const SLATE = "#64748b";

export default function OpeningBalancesPage() {
  return (
    <AuthWrapper>
      <main style={{ padding: "20px 24px" }}>
        <div style={{ marginBottom: "16px" }}>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: NAVY, margin: 0 }}>
            Opening Balances
          </h1>
          <p style={{ color: SLATE, fontSize: "16px", marginTop: "5px" }}>
            Admin only. Set the starting stock for each plant. The dashboard counts forward from here using daily entries.
          </p>
        </div>
        <OpeningBalancesForm />
      </main>
    </AuthWrapper>
  );
}
