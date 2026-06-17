"use client";

import AuthWrapper from "../lib/AuthWrapper";
import FinanceManager from "./FinanceManager";

const NAVY = "#1e293b";
const SLATE = "#64748b";

export default function FinancePage() {
  return (
    <AuthWrapper>
      <main style={{ padding: "20px 24px" }}>
        <div style={{ marginBottom: "16px" }}>
          <h1 style={{ fontSize: "26px", fontWeight: 800, color: NAVY, margin: 0 }}>
            Finance — Cash Position
          </h1>
          <p style={{ color: SLATE, fontSize: "16px", marginTop: "5px" }}>
            Set the opening balance, enter each month's expected receivables and payouts, and record daily cash figures.
          </p>
        </div>
        <FinanceManager />
      </main>
    </AuthWrapper>
  );
}
