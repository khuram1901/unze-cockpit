"use client";

// Audit department page. Since 18/07/2026 everything lives in the Annual
// Internal Audit Plan (AnnualAuditPlan.tsx) — the legacy ad-hoc records list
// was merged into the plan (migration 150) and removed from this page.

import { useEffect, useState } from "react";
import { supabase, loadMyPermissions } from "../../lib/supabase";
import { useMobile } from "../../lib/useMobile";
import { COLOURS, RADII, PageHeader, useToast } from "../../lib/SharedUI";
import type { UserCtx, PermOverrides } from "../../lib/permissions";
import AnnualAuditPlan from "./AnnualAuditPlan";

export default function AuditDashboard() {
  const isMobile = useMobile();
  const toast = useToast();
  const [userCtx, setUserCtx] = useState<UserCtx | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user?.email) {
        const { data: memberData } = await supabase.from("members").select("role, department, company").eq("email", userData.user.email).maybeSingle();
        if (memberData) {
          let overrides: PermOverrides | null = null;
          const p = await loadMyPermissions();
          if (p) overrides = p as PermOverrides;
          setUserCtx({ email: userData.user.email, role: memberData.role, department: memberData.department, company: memberData.company, overrides });
        }
      }
    })();
  }, []);

  function showMsg(text: string) { setMessage(text); setTimeout(() => setMessage(""), 4000); }

  return (
    <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", overflowX: "hidden" }}>
      {toast.element}
      <div style={{ marginBottom: "16px" }}>
        <PageHeader />
      </div>

      {message && (
        <div style={{ border: `1px solid ${COLOURS.HAIRLINE}`, borderLeft: `4px solid ${message.startsWith("Error") ? COLOURS.RED : COLOURS.GREEN}`, borderRadius: RADII.SM, padding: "10px 14px", marginBottom: "14px", backgroundColor: COLOURS.CARD, fontSize: "14px", color: COLOURS.NAVY }}>{message}</div>
      )}

      <AnnualAuditPlan userCtx={userCtx} showMsg={showMsg} />
    </main>
  );
}
