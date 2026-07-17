"use client";

import AuthWrapper from "../lib/AuthWrapper";
import TasksPageClient from "./TasksPageClient";
import { useMobile } from "../lib/useMobile";

export default function TasksPage() {
  const isMobile = useMobile();
  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", minWidth: 0 }}>
        <TasksPageClient />
      </main>
    </AuthWrapper>
  );
}
