import AuthWrapper from "../lib/AuthWrapper";
import DashboardView from "./DashboardView";

export default function DashboardPage() {
  return (
    <AuthWrapper>
      <main style={{ padding: "40px", fontFamily: "sans-serif" }}>
        <h1 style={{ fontSize: "28px", fontWeight: "bold", marginBottom: "8px" }}>
          Operations Dashboard
        </h1>
        <DashboardView />
      </main>
    </AuthWrapper>
  );
}
