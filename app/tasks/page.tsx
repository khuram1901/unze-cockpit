import AuthWrapper from "../lib/AuthWrapper";
import TasksPageClient from "./TasksPageClient";

export default function TasksPage() {
  return (
    <AuthWrapper>
      <main style={{ padding: "20px 24px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#1e293b", marginBottom: "16px" }}>
          Tasks & Assignments
        </h1>

        <TasksPageClient />
      </main>
    </AuthWrapper>
  );
}
