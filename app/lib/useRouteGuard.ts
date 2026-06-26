"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "./supabase";
import { canViewFinance, canViewReceivables, canViewExecutiveDashboard, canViewDepartment, type UserCtx, type PermOverrides } from "./permissions";

type Capability = "finance" | "receivables" | "executive";

const CHECKS: Record<Capability, (u: UserCtx) => boolean> = {
  finance: canViewFinance,
  receivables: canViewReceivables,
  executive: canViewExecutiveDashboard,
};

async function loadUserCtx(email: string): Promise<UserCtx> {
  const { data: m } = await supabase
    .from("members").select("id, role, department, company").eq("email", email).maybeSingle();
  let overrides: PermOverrides | null = null;
  if (m?.id) {
    const { data: p } = await supabase
      .from("member_permissions").select("*").eq("member_id", m.id).maybeSingle();
    if (p) {
      overrides = p as PermOverrides;
    }
  }
  return {
    email,
    role: m?.role ?? null,
    department: m?.department ?? null,
    company: m?.company ?? null,
    overrides,
  };
}

export function useRequireCapability(cap: Capability): { checking: boolean } {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    async function check() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!active) return;
      if (!user?.email) { router.replace("/login"); return; }
      const ctx = await loadUserCtx(user.email);
      if (!active) return;
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

export function useBlockPA(): { checking: boolean } {
  return useRequireCapability("finance");
}

export function useRequireDepartment(departmentName: string): { checking: boolean } {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    async function check() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!active) return;
      if (!user?.email) { router.replace("/login"); return; }
      const ctx = await loadUserCtx(user.email);
      if (!active) return;
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

export { loadUserCtx };
