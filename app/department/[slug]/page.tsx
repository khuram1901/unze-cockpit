"use client";

import { use } from "react";
import AuthWrapper from "../../lib/AuthWrapper";
import RoleGuard from "../../lib/RoleGuard";
import { getDepartmentConfig } from "../../lib/department-config";
import DepartmentDashboard from "./DepartmentDashboard";
import AuditDashboard from "./AuditDashboard";

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
        {slug === "audit" ? <AuditDashboard /> : <DepartmentDashboard config={config} />}
      </RoleGuard>
    </AuthWrapper>
  );
}
