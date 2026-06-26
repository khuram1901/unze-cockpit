"use client";

import { use } from "react";
import AuthWrapper from "../../lib/AuthWrapper";
import RoleGuard from "../../lib/RoleGuard";
import { useRequireDepartment } from "../../lib/useRouteGuard";
import { getDepartmentConfig } from "../../lib/department-config";
import DepartmentDashboard from "./DepartmentDashboard";
import AuditDashboard from "./AuditDashboard";
import HRDashboard from "./HRDashboard";
import TaxationDashboard from "./TaxationDashboard";
import AdminDashboard from "./AdminDashboard";

const CUSTOM_DASHBOARDS: Record<string, React.ComponentType> = {
  audit: AuditDashboard,
  hr: HRDashboard,
  taxation: TaxationDashboard,
  admin: AdminDashboard,
};

export default function DepartmentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const config = getDepartmentConfig(slug);

  if (!config) {
    return (
      <AuthWrapper>
        <main style={{ padding: "20px 24px" }}>
          <h1 style={{ fontSize: "26px", fontWeight: 800, color: "#1e293b" }}>Department not found</h1>
          <p style={{ color: "#64748b", fontSize: "16px" }}>No department configured for &ldquo;{slug}&rdquo;.</p>
        </main>
      </AuthWrapper>
    );
  }

  return (
    <AuthWrapper>
      <RoleGuard allowedRoles={config.allowedRoles}>
        <DepartmentGuarded slug={slug} departmentName={config.departmentName} config={config} />
      </RoleGuard>
    </AuthWrapper>
  );
}

function DepartmentGuarded({ slug, departmentName, config }: { slug: string; departmentName: string; config: ReturnType<typeof getDepartmentConfig> }) {
  const { checking } = useRequireDepartment(departmentName);
  if (checking) return null;
  const CustomDashboard = CUSTOM_DASHBOARDS[slug];
  return CustomDashboard ? <CustomDashboard /> : <DepartmentDashboard config={config!} />;
}
