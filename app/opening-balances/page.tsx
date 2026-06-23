import AuthWrapper from "../lib/AuthWrapper";
import OpeningBalancesForm from "./OpeningBalancesForm";
import { PageHeader } from "../lib/SharedUI";

export default function OpeningBalancesPage() {
  return (
    <AuthWrapper>
      <main style={{ padding: "20px 24px" }}>
        <PageHeader title="Opening Balances" subtitle="Set starting stock for each plant — dashboard counts forward from here" />
        <OpeningBalancesForm />
      </main>
    </AuthWrapper>
  );
}
