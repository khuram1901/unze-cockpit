"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "./supabase";
import { canViewFinance, canViewReceivables, canViewExecutiveDashboard, canViewDepartment, type UserCtx } from "./permissions";

type Capability = "finance" | "receivables" | "executive";

const CHECKS: Record<Capability, (u: UserCtx) => boolean> = {
  finance: canViewFinance,
  receivables: canViewReceivables,
  executive: canViewExecutiveDashboard,
};

/**
 * Route-level guard. Redirects to /home unless the current user has the
 * given capability. Returns `checking` — render nothing until resolved so
 * blocked users never momentarily see protected content.
 */
export function useRequireCapability(cap: Capability): { checking: boolean } {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    async function check() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!active) return;
      let role: string | null = null;
      let department: string | null = null;
      let company: string | null = null;
      if (user?.email) {
        const { data: m } = await supabase
          .from("members").select("role, department, company").eq("email", user.email).maybeSingle();
        role = m?.role ?? null;
        department = m?.department ?? null;
        company = m?.company ?? null;
      }
      const ctx: UserCtx = { email: user?.email, role, department, company };
      if (!CHECKS[cap](ctx)) {
        router.replace("/home");
        return;
      }
      setChecking(false);
    }
    check();
    return () => { active = false; };
  }, [cap, router]);

  return { checking };
}

/** Back-compat: block the PA specifically (kept for existing imports). */
export function useBlockPA(): { checking: boolean } {
  return useRequireCapability("finance");
}

/**
 * Guard a department dashboard by its canonical department name.
 * Redirects to /home if the user may not view that department.
 */
export function useRequireDepartment(departmentName: string): { checking: boolean } {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    async function check() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!active) return;
      let role: string | null = null;
      let department: string | null = null;
      if (user?.email) {
        const { data: m } = await supabase
          .from("members").select("role, department").eq("email", user.email).maybeSingle();
        role = m?.role ?? null;
        department = m?.department ?? null;
      }
      const ctx: UserCtx = { email: user?.email, role, department };
      if (!canViewDepartment(ctx, departmentName)) {
        router.replace("/home");
        return;
      }
      setChecking(false);
    }
    check();
    return () => { active = false; };
  }, [departmentName, router]);

  return { checking };
}
