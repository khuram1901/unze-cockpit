"use client";

import AuthWrapper from "../lib/AuthWrapper";
import FinanceManager from "./FinanceManager";

export default function FinancePage() {
  return (
    <AuthWrapper>
      <main style={{ padding: "40px", fontFamily: "sans-serif" }}>
        <h1 style={{ fontSize: "30px", fontWeight: "bold", marginBottom: "8px" }}>
          Finance — Cash Position
        </h1>
        <p style={{ color: "#666", marginBottom: "28px" }}>
          Set the one-off opening balance, enter each month&apos;s expected receivables and payouts,
          and record the daily cash figures from the accountant&apos;s statement.
        </p>
        <FinanceManager />
      </main>
    </AuthWrapper>
  );
}
