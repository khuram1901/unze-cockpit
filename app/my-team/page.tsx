"use client";

import { useRequireCapability } from "../lib/useRouteGuard";
import MyTeamPerformance from "./MyTeamPerformance";

export default function MyTeamPage() {
  const { checking } = useRequireCapability("team_performance");
  if (checking) return null;
  return <MyTeamPerformance />;
}
