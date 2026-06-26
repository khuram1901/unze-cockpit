// ──────────────────────────────────────────────────────────────────
// Central permission model — SINGLE SOURCE OF TRUTH for access rights.
//
// Every UI gate should consult these helpers instead of inlining
// `role === "Admin" || role === "Executive"` checks. RLS in Supabase
// mirrors the data-level rules (see supabase/027_role_model.sql).
//
// Roles:
//   Admin      — everything; locked, undeletable, role unchangeable
//   CEO        — k.saleem by email; same as Admin, different dashboard
//   Executive  — THE PA (Sundas). Almost-admin EXCEPT finance,
//                receivables, executive dashboard, and HR/Tax/Audit depts
//   Manager    — department-scoped
//   Member     — own tasks only
// ──────────────────────────────────────────────────────────────────

export const CEO_EMAIL = "k.saleem@unzegroup.com";
export const ADMIN_EMAIL = "khuram1901@gmail.com";
export const PA_EMAIL = "pa.ceo@unze.co.uk";

// Accounts that are locked: cannot be deleted, role cannot be changed.
export const LOCKED_EMAILS = [ADMIN_EMAIL, CEO_EMAIL, PA_EMAIL];
export const PROTECTED_EMAILS = [ADMIN_EMAIL, CEO_EMAIL]; // truly undeletable admins

export type UserCtx = {
  email: string | null | undefined;
  role: string | null | undefined;
  department?: string | null;
  company?: string | null;
};

function lc(s: string | null | undefined) { return (s || "").toLowerCase(); }

// ── Identity ──────────────────────────────────────────────────────
export function isCEO(u: UserCtx) { return lc(u.email) === CEO_EMAIL; }
export function isMainAdmin(u: UserCtx) { return lc(u.email) === ADMIN_EMAIL; }
export function isPA(u: UserCtx) { return lc(u.email) === PA_EMAIL || u.role === "Executive"; }

/** Admin or CEO — the truly full-access tier (incl. finance). */
export function isAdminTier(u: UserCtx) {
  return isCEO(u) || isMainAdmin(u) || u.role === "Admin";
}

/** Admin/CEO PLUS the PA — the "privileged operations" tier (tasks, members, etc). */
export function isPrivileged(u: UserCtx) {
  return isAdminTier(u) || u.role === "Executive";
}

// ── Finance (Admin/CEO + Finance Managers only — NEVER the PA) ─────
export function canViewFinance(u: UserCtx) {
  if (isPA(u)) return false;               // PA explicitly blocked
  if (isAdminTier(u)) return true;
  return u.role === "Manager" && u.department === "Finance";
}
export const canEditFinance = canViewFinance;

/** Which company finance a user may see. */
export function financeCompanies(u: UserCtx): "both" | "UTPL" | "IFPL" | "none" {
  if (!canViewFinance(u)) return "none";
  if (isAdminTier(u) || !u.company) return "both";
  if (u.company.startsWith("Unze Trading")) return "UTPL";
  if (u.company.startsWith("Imperial")) return "IFPL";
  return "both";
}

// ── Receivables (finance-related — PA blocked) ────────────────────
export function canViewReceivables(u: UserCtx) {
  if (isPA(u)) return false;
  if (isAdminTier(u)) return true;
  return u.role === "Manager" && (u.department === "Finance" || u.department === "Unze Trading Ops");
}
export function canEditReceivables(u: UserCtx) {
  return canViewReceivables(u); // edit/view split handled by EDIT_EMAILS at call site for now
}

// ── Executive dashboard (Admin/CEO only — PA blocked) ─────────────
export function canViewExecutiveDashboard(u: UserCtx) {
  return isAdminTier(u); // PA = Executive role, but NOT allowed here
}

// ── Operations dashboard (privileged + ops staff) ─────────────────
export function canViewOperations(u: UserCtx) {
  return isPrivileged(u) || u.department === "Unze Trading Ops";
}

// ── Tasks & meetings (privileged tier incl. PA) ───────────────────
export function canReviewTasks(u: UserCtx) { return isPrivileged(u); }      // edit due dates, close, reassign
export function canCreateAssignments(u: UserCtx) { return isPrivileged(u); } // assign tasks to others
export function canManageRecurringTasks(u: UserCtx) { return isPrivileged(u); }
export function canManageCalendarRequests(u: UserCtx) { return isPrivileged(u); }
export function canSeeAllTasks(u: UserCtx) { return isPrivileged(u); }       // vs own tasks only
export function canSeeAllMinutes(u: UserCtx) { return isPrivileged(u); }

// ── Members / settings (privileged tier incl. PA) ─────────────────
export function canManageMembers(u: UserCtx) { return isPrivileged(u); }
export function canViewAuditLog(u: UserCtx) { return isPrivileged(u); }
export function canViewExceptions(u: UserCtx) { return isPrivileged(u); }
export function canSeeSettings(u: UserCtx) { return isPrivileged(u); }

// ── Member administration rules ───────────────────────────────────
/** Roles this user may assign when creating/editing a member. */
export function assignableRoles(u: UserCtx): string[] {
  if (isAdminTier(u)) return ["Admin", "Executive", "Manager", "Member"];
  if (u.role === "Executive") return ["Manager", "Member"]; // PA cannot mint admins/execs
  return [];
}

/** Whether `actor` may change the password of `target`. */
export function canChangePasswordFor(actor: UserCtx, target: UserCtx): boolean {
  if (isAdminTier(actor)) return true;
  if (actor.role === "Executive") {
    // PA: only herself and plain Members (not Managers, Admin, CEO)
    if (lc(actor.email) === lc(target.email)) return true;
    return target.role === "Member";
  }
  return false;
}

/** Whether `actor` may edit/delete the `target` member record. */
export function canEditMember(actor: UserCtx, target: UserCtx): boolean {
  if (LOCKED_EMAILS.includes(lc(target.email)) && lc(actor.email) !== lc(target.email)) {
    // locked accounts editable only by an Admin-tier actor (never the PA)
    return isAdminTier(actor);
  }
  if (isAdminTier(actor)) return true;
  if (actor.role === "Executive") return target.role === "Manager" || target.role === "Member";
  return false;
}

export function canDeleteMember(actor: UserCtx, target: UserCtx): boolean {
  if (PROTECTED_EMAILS.includes(lc(target.email))) return false; // Admin/CEO never deletable
  return canEditMember(actor, target);
}

// ── Departments the PA may view ───────────────────────────────────
// PA: no HR/Taxation/Audit; CAN view Admin dept.
const PA_BLOCKED_DEPTS = ["HR", "Tax", "Legal", "Audit"]; // Tax==Legal canonical handled elsewhere
export function canViewDepartment(u: UserCtx, departmentName: string): boolean {
  if (isAdminTier(u)) return true;
  if (u.role === "Executive") return !PA_BLOCKED_DEPTS.includes(departmentName);
  if (u.role === "Manager") return u.department === departmentName;
  return false;
}
