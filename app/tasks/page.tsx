"use client";

import AuthWrapper from "../lib/AuthWrapper";
import TasksPageClient from "./TasksPageClient";
import { useMobile } from "../lib/useMobile";

export default function TasksPage() {
  const isMobile = useMobile();
  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
        <TasksPageClient />
      </main>
    </AuthWrapper>
  );
}
