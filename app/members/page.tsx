import AuthWrapper from "../lib/AuthWrapper";
import RoleGuard from "../lib/RoleGuard";
import MembersManager from "./MembersManager";

const NAVY = "#1e293b";
const SLATE = "#64748b";

export default function MembersPage() {
  return (
    <AuthWrapper>
      <main style={{ padding: "20px 24px" }}>
        <RoleGuard allowedRoles={["Admin"]}>
          <div style={{ marginBottom: "16px" }}>
            <h1 style={{ fontSize: "22px", fontWeight: 800, color: NAVY, margin: 0 }}>
              Members
            </h1>
            <p style={{ color: SLATE, fontSize: "14px", marginTop: "5px" }}>
              Manage team members, roles, departments, and plant assignments.
            </p>
          </div>
          <MembersManager />
        </RoleGuard>
      </main>
    </AuthWrapper>
  );
}
