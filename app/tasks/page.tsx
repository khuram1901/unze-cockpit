import AuthWrapper from "../lib/AuthWrapper";
import TasksPageClient from "./TasksPageClient";

export default function TasksPage() {
  return (
    <AuthWrapper>
      <main style={{ padding: "40px", fontFamily: "sans-serif" }}>
        <h1 style={{ fontSize: "28px", fontWeight: "bold", marginBottom: "24px" }}>
          Tasks & Assignments
        </h1>

        <TasksPageClient />
      </main>
    </AuthWrapper>
  );
}