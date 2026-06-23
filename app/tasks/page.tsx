import AuthWrapper from "../lib/AuthWrapper";
import TasksPageClient from "./TasksPageClient";

export default function TasksPage() {
  return (
    <AuthWrapper>
      <main style={{ padding: "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
        <TasksPageClient />
      </main>
    </AuthWrapper>
  );
}
