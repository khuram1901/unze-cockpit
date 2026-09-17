"use client";

import AuthWrapper from "../lib/AuthWrapper";
import MyTeamPerformance from "./MyTeamPerformance";
import { useMobile } from "../lib/useMobile";

export default function MyTeamPage() {
  const isMobile = useMobile();
  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
        <MyTeamPerformance />
      </main>
    </AuthWrapper>
  );
}
