import AuthWrapper from "../lib/AuthWrapper";
import RoleGuard from "../lib/RoleGuard";
import MembersManager from "./MembersManager";

export default function MembersPage() {
  return (
    <AuthWrapper>
      <main style={{ padding: "40px", fontFamily: "sans-serif" }}>
        <RoleGuard allowedRoles={["Admin"]}>
          <h1 style={{ fontSize: "28px", fontWeight: "bold", marginBottom: "24px" }}>
            Members
          </h1>

          <MembersManager />
        </RoleGuard>
      </main>
    </AuthWrapper>
  );
}