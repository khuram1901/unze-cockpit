"use client";

import AuthWrapper from "../lib/AuthWrapper";
import MembersManager from "./MembersManager";
import { useRequireCapability } from "../lib/useRouteGuard";
import { COLOURS } from "../lib/SharedUI";

export default function MembersPage() {
  const { checking } = useRequireCapability("members");

  if (checking) return <AuthWrapper><main style={{ padding: "14px 18px" }}><p style={{ color: `var(--text-secondary, ${COLOURS.SLATE})` }}>Checking permissions...</p></main></AuthWrapper>;

  return (
    <AuthWrapper>
      <MembersManager />
    </AuthWrapper>
  );
}
