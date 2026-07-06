import AuthWrapper from "../lib/AuthWrapper";
import AccountsTaxDashboard from "./AccountsTaxDashboard";

export default function AccountsTaxPage() {
  return (
    <AuthWrapper>
      <AccountsTaxDashboard />
    </AuthWrapper>
  );
}
