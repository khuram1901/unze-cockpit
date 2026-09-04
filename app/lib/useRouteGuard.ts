"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, loadMyPermissions } from "./supabase";
import {
  canViewFinance, canViewReceivables, canViewExecutiveDashboard, canViewDepartment,
  canViewOperations, canSeeAllMinutes, canSeeAllTasks, canManageRecurringTasks,
  canManageMembers, canViewAuditLog, canImportExport,
  canAccessDailyEntry, canAccessAdminOps, canAccessAdminEntry, canAccessBanking,
  canViewPADashboard, canViewInvestments,
  canViewStock, canViewGuarantees, canViewIfplPnl, canViewRestaurantsPnl, canViewGroupHR, canAccessFolderit,
  canViewTaxAccounts,
  isPrivileged, isAdminTier, isMainAdmin,
  type UserCtx, type PermOverrides,
} from "./permissions";

type Capability = "finance" | "receivables" | "executive" | "operations"
  | "minutes" | "meetings_admin" | "recurring_tasks" | "members"
  | "audit_log" | "import_export" | "daily_entry"
  | "pa_dashboard" | "investments" | "system_backups" | "stock" | "guarantees"
  | "ifpl_pnl" | "restaurants_pnl" | "admin_ops" | "admin_entry" | "folderit" | "banking" | "group_hr"
  | "dept_tax_accounts";

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
  restaurants_pnl: canViewRestaurantsPnl,
  group_hr: canViewGroupHR,
  folderit: canAccessFolderit,
  banking: canAccessBanking,
  dept_tax_accounts: canViewTaxAccounts,
};

// ── In-memory cache ────────────────────────────────────────────────────────
// UserCtx (role + permissions) is fetched once and reused for the whole
// browser session. Navigating between pages costs zero extra round trips.
// Cache is keyed by email and expires after 5 minutes so a permission change
// made by an admin takes effect within one natural refresh cycle.
let _ctxCache: { email: string; ctx: UserCtx; ts: number } | null = null;
const CTX_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function invalidateUserCtxCache() { _ctxCache = null; }

async function loadUserCtx(email: string): Promise<UserCtx> {
  if (_ctxCache && _ctxCache.email === email && Date.now() - _ctxCache.ts < CTX_TTL_MS) {
    return _ctxCache.ctx;
  }
  // Parallelise the two independent DB calls
  const [{ data: m }, permData] = await Promise.all([
    supabase.from("members").select("id, role, department, company").eq("email", email).maybeSingle(),
    loadMyPermissions(),
  ]);
  const ctx: UserCtx = {
    email,
    role: m?.role ?? null,
    department: m?.department ?? null,
    company: m?.company ?? null,
    overrides: (permData as PermOverrides | null) ?? null,
  };
  _ctxCache = { email, ctx, ts: Date.now() };
  return ctx;
}

// ── Shared guard ───────────────────────────────────────────────────────────
// Every page guard does the same four things: read the session, redirect to
// /login if there isn't one, load the user context, then redirect to /welcome
// if the context fails the page's test. Only that last test differs, so it is
// the only thing the public hooks below pass in.
//
// `allow` is read through a ref rather than listed as an effect dependency:
// callers pass an inline arrow that is a new function on every render, which
// would re-run the guard (and re-redirect) on every render if it were a dep.
// `guardKey` is the real dependency — it changes exactly when the test does.
function useAuthGuard(
  allow: (ctx: UserCtx) => boolean,
  guardKey: string,
): { checking: boolean; ctx: UserCtx | null } {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [ctx, setCtx] = useState<UserCtx | null>(null);

  const allowRef = useRef(allow);
  useEffect(() => { allowRef.current = allow; });

  useEffect(() => {
    let active = true;
    async function check() {
      // getSession() reads from localStorage — no network call.
      // getUser() hits the Supabase Auth server on every navigation — slow.
      const { data: { session } } = await supabase.auth.getSession();
      if (!active) return;
      if (!session?.user?.email) { router.replace("/login"); return; }
      const loaded = await loadUserCtx(session.user.email);
      if (!active) return;
      if (!allowRef.current(loaded)) {
        router.replace("/welcome");
        return;
      }
      setCtx(loaded);
      setChecking(false);
    }
    check().catch(() => {
      // If the auth check itself throws (network failure, unexpected error),
      // send to login rather than leaving the page stuck on a blank screen.
      if (active) router.replace("/login");
    });
    return () => { active = false; };
  }, [guardKey, router]);

  return { checking, ctx };
}

export function useRequireCapability(cap: Capability): { checking: boolean; ctx: UserCtx | null } {
  return useAuthGuard((u) => CHECKS[cap](u), `cap:${cap}`);
}

export function useBlockPA(): { checking: boolean } {
  return useRequireCapability("finance");
}

export function useRequireDepartment(departmentName: string): { checking: boolean } {
  // The Tax consultant exemption that used to sit here now lives in
  // canViewDepartment() — see TAX_CONSULTANT_EMAIL in permissions.ts.
  const { checking } = useAuthGuard(
    (u) => canViewDepartment(u, departmentName),
    `dept:${departmentName}`,
  );
  return { checking };
}

export { loadUserCtx };
