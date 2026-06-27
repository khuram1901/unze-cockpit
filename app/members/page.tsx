"use client";

import AuthWrapper from "../lib/AuthWrapper";
import MembersManager from "./MembersManager";
import { useRequireCapability } from "../lib/useRouteGuard";

export default function MembersPage() {
  const { checking } = useRequireCapability("members");

  if (checking) return <AuthWrapper><main style={{ padding: "20px 24px" }}><p style={{ color: "#64748b" }}>Checking permissions...</p></main></AuthWrapper>;

  return (
    <AuthWrapper>
      <MembersManager />
    </AuthWrapper>
  );
}
