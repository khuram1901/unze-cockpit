"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, loadMyPermissions } from "./supabase";
import {
  canViewFinance, canViewReceivables, canViewExecutiveDashboard, canViewDepartment,
  canViewOperations, canSeeAllMinutes, canSeeAllTasks, canManageRecurringTasks,
  canManageMembers, canViewAuditLog, canImportExport,
  canAccessDailyEntry, canAccessAdminOps, canAccessAdminEntry,
  canViewPADashboard, canViewInvestments,
  canViewStock, canViewGuarantees, canViewIfplPnl, canAccessFolderit,
  isPrivileged, isAdminTier, isMainAdmin,
  type UserCtx, type PermOverrides,
} from "./permissions";

type Capability = "finance" | "receivables" | "executive" | "operations"
  | "minutes" | "meetings_admin" | "recurring_tasks" | "members"
  | "audit_log" | "import_export" | "daily_entry"
  | "pa_dashboard" | "investments" | "system_backups" | "stock" | "guarantees"
  | "ifpl_pnl" | "admin_ops" | "admin_entry" | "folderit";

const CHECKS: Record<Capability, (u: UserCtx) => boolean> = {
  finance: canViewFinance,
  guarantees: canViewGuarantees,
  receivables: canViewReceivables,
  executive: canViewExecutiveDashboard,
  operations: canViewOperations,
  minutes: (u) => isPrivileged(u) || canSeeAllMinutes(u),
  meetings_admin: isPrivileged,
  recurring_tasks: canManageRecurringTasks,
  members: canManageMembers,
  audit_log: canViewAuditLog,
  import_export: canImportExport,
  daily_entry: canAccessDailyEntry,
  pa_dashboard: canViewPADashboard,
  investments: canViewInvestments,
  system_backups: isMainAdmin,
  admin_ops: canAccessAdminOps,
  admin_entry: canAccessAdminEntry,
  stock: canViewStock,
  ifpl_pnl: canViewIfplPnl,
  folderit: canAccessFolderit,
};

async function loadUserCtx(email: string): Promise<UserCtx> {
  const { data: m } = await supabase
    .from("members").select("id, role, department, company").eq("email", email).maybeSingle();
  let overrides: PermOverrides | null = null;
  const permData = await loadMyPermissions();
  if (permData) overrides = permData as PermOverrides;
  return {
    email,
    role: m?.role ?? null,
    department: m?.department ?? null,
    company: m?.company ?? null,
    overrides,
  };
}

export function useRequireCapability(cap: Capability): { checking: boolean; ctx: UserCtx | null } {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [ctx, setCtx] = useState<UserCtx | null>(null);

  useEffect(() => {
    let active = true;
    async function check() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!active) return;
      if (!user?.email) { router.replace("/login"); return; }
      const loaded = await loadUserCtx(user.email);
      if (!active) return;
      if (!CHECKS[cap](loaded)) {
        router.replace("/welcome");
        return;
      }
      setCtx(loaded);
      setChecking(false);
    }
    check();
    return () => { active = false; };
  }, [cap, router]);

  return { checking, ctx };
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
      if (departmentName === "Tax" &&
          (ctx.email || "").toLowerCase() === "shakeel@unze.co.uk") {
        setChecking(false);
        return;
      }
      if (!canViewDepartment(ctx, departmentName)) {
        router.replace("/welcome");
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
