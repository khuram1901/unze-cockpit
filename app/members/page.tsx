import AuthWrapper from "../lib/AuthWrapper";
import RoleGuard from "../lib/RoleGuard";
import MembersManager from "./MembersManager";

export default function MembersPage() {
  return (
    <AuthWrapper>
      <RoleGuard allowedRoles={["Admin", "Executive"]}>
        <MembersManager />
      </RoleGuard>
    </AuthWrapper>
  );
}
