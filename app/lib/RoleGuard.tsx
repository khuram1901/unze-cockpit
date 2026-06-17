"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";

type RoleGuardProps = {
  allowedRoles: string[];
  children: React.ReactNode;
};

export default function RoleGuard({ allowedRoles, children }: RoleGuardProps) {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [role, setRole] = useState<string>("");

  useEffect(() => {
    async function checkRole() {
      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email;

      if (!email) {
        setAllowed(false);
        setLoading(false);
        return;
      }

      const { data: memberData } = await supabase
        .from("members")
        .select("role")
        .eq("email", email)
        .single();

      const currentRole = memberData?.role || "Member";

      setRole(currentRole);
      setAllowed(allowedRoles.includes(currentRole));
      setLoading(false);
    }

    checkRole();
  }, [allowedRoles]);

  if (loading) {
    return <p>Checking permissions...</p>;
  }

  if (!allowed) {
    return (
      <div
        style={{
          border: "1px solid #fecaca",
          backgroundColor: "#fef2f2",
          color: "#991b1b",
          borderRadius: "10px",
          padding: "20px",
          maxWidth: "700px",
        }}
      >
        <h2 style={{ fontSize: "22px", fontWeight: "bold", marginBottom: "8px" }}>
          Access Denied
        </h2>

        <p style={{ marginBottom: "8px" }}>
          You do not have permission to view this page.
        </p>

        <p style={{ fontSize: "16px" }}>
          Current role: <strong>{role || "Unknown"}</strong>
        </p>
      </div>
    );
  }

  return <>{children}</>;
}