// ──────────────────────────────────────────────────────────────────
// Central permission model — SINGLE SOURCE OF TRUTH for access rights.
//
// Every UI gate should consult these helpers instead of inlining
// `role === "Admin" || role === "Executive"` checks. RLS in Supabase
// mirrors the data-level rules (see supabase/027_role_model.sql).
//
// Overrides: the member_permissions table stores per-member boolean
// overrides. When present (non-null), they take precedence over the
// role-based default. Pass them in UserCtx.overrides.
//
// Roles:
//   Admin      — khuram1901@gmail.com only. Everything, unconditionally.
//                The one account that is fully locked in the Access
//                Matrix (no toggle can ever change it) and whose role
//                can never be reassigned.
//   CEO        — added 16 Jul 2026 (was previously two hardcoded email
//                addresses — k.saleem@unzegroup.com, kamran@unze.co.uk —
//                baked directly into isCEO()/isSecondaryCEO() with no
//                override hook at all, so Khuram could not use the
//                Access Matrix to control what Kamran saw; every change
//                had to go through a direct database edit). CEO is now a
//                normal role: full rights by default (same ballpark as
//                Admin), but every one of those defaults is a real
//                member_permissions override like Manager/Member get, so
//                it's fully matrix-controllable per person. Both
//                k.saleem@unzegroup.com (Khuram's second account) and
//                kamran@unze.co.uk are role=CEO. A handful of things stay
//                Admin-only no matter what (see isMainAdmin() call sites):
//                assigning the Admin role to someone, editing/deleting
//                the Admin account, and system backups/restore.
//   Executive  — THE PA (Sundas). Almost-admin EXCEPT finance,
//                receivables, executive dashboard, and HR/Tax/Audit depts
//   Manager    — department-scoped
//   Member     — own tasks only
// ──────────────────────────────────────────────────────────────────

export const CEO_EMAIL = "k.saleem@unzegroup.com";   // Khuram's second account — role CEO
export const CEO2_EMAIL = "kamran@unze.co.uk";       // Kamran Saleem — role CEO, IFPL-scoped via the matrix
export const ADMIN_EMAIL = "khuram1901@gmail.com";
export const PA_EMAIL = "pa.ceo@unze.co.uk";
export const OPS_HOD_EMAIL = "nadeem.khan@unze.co.uk";

// Both of Khuram's own accounts: undeletable, role can never be reassigned
// away, email can never be changed. Kamran and the PA are deliberately
// NOT here any more — as of 16 Jul 2026 they're ordinary (if senior)
// accounts whose role and permissions Khuram can actually edit.
export const PROTECTED_EMAILS = [ADMIN_EMAIL, CEO_EMAIL];

// Fully locked in the Access Matrix UI — every toggle greyed out, nothing
// clickable. Narrowed to true Admin only (16 Jul 2026); it used to also
// cover both CEO emails and the PA, which is what made Kamran's row
// completely uneditable through the UI despite him having real, distinct
// permissions underneath.
export const MATRIX_LOCKED_EMAILS = [ADMIN_EMAIL];

export type PermOverrides = Record<string, boolean | string | null>;

// Widget-level visibility — see supabase/136_widget_visibility.sql and
// app/lib/widgetRegistry.ts. Keyed by widget key (e.g. "home.cash_flow_waterfall"),
// value true/false when Khuram has explicitly set it for this person; absent
// means "use the widget's own default".
export type WidgetOverrides = Record<string, boolean>;

export type UserCtx = {
  email: string | null | undefined;
  role: string | null | undefined;
  department?: string | null;
  company?: string | null;
  overrides?: PermOverrides | null;
  widgetOverrides?: WidgetOverrides | null;
};

function lc(s: string | null | undefined) { return (s || "").toLowerCase(); }

function ov(u: UserCtx, key: string): boolean | null {
  const v = u.overrides?.[key];
  if (v === true || v === false) return v;
  return null;
}

// ── Identity ──────────────────────────────────────────────────────
// Role-based since 16 Jul 2026 (was email-based — see the CEO role note
// in the header comment above for why that was a problem).
export function isCEO(u: UserCtx) { return u.role === "CEO"; }
// True only for Khuram's k.saleem account — for routing/identity purposes
// (which dashboard, which Gmail/Drive integration owns), not permissions.
export function isPrimaryCEO(u: UserCtx) { return lc(u.email) === CEO_EMAIL; }
// True only for Kamran — used to route him to his own dashboard.
export function isSecondaryCEO(u: UserCtx) { return lc(u.email) === CEO2_EMAIL; }
export function isMainAdmin(u: UserCtx) { return lc(u.email) === ADMIN_EMAIL; }
export function isPA(u: UserCtx) { return lc(u.email) === PA_EMAIL || u.role === "Executive"; }

// Khuram has two real login identities (khuram1901@gmail.com = Admin,
// k.saleem@unzegroup.com = CEO) that are the same person for any "does
// this belong to me" comparison. Found 18 Jul 2026: a task got routed
// (on Submit) to whichever of his accounts is set as a report's
// manager_id — if he happened to be logged in as the OTHER account, the
// "Mine" task filter compared his session email to that literal string
// and the task silently never showed up as his, even though he could
// still find and act on it via "Everyone" (isPrivileged() covers that
// part). Anywhere the UI decides "is this task/record mine" by exact
// email equality, compare against this list instead of the raw session
// email so it doesn't matter which of his two accounts routed it or
// which one he's currently logged into.
export function myIdentityEmails(email: string | null | undefined): string[] {
  const e = lc(email);
  if (!e) return [];
  if (e === ADMIN_EMAIL || e === CEO_EMAIL) return [ADMIN_EMAIL, CEO_EMAIL];
  return [e];
}

export function isAdminTier(u: UserCtx) {
  return isMainAdmin(u) || u.role === "Admin" || isCEO(u);
}

export function isPrivileged(u: UserCtx) {
  return isAdminTier(u) || u.role === "Executive";
}

// ── Finance ───────────────────────────────────────────────────────
export function canViewFinance(u: UserCtx) {
  // Found during the 15 Jul 2026 audit: isPA() used to be checked AFTER
  // the per-member override, so a mis-set Access Matrix override could
  // let a PA account see finance data through this shared helper — in
  // direct conflict with the standing rule "PA never sees financial
  // data. Ever." isPA() is now checked first, unconditionally, so no
  // override can ever grant a PA account finance access via this path.
  if (isPA(u)) return false;
  const o = ov(u, "can_view_finance");
  if (o !== null) return o;
  if (isAdminTier(u)) return true;
  return u.role === "Manager" && u.department === "Finance";
}

export function canEditFinance(u: UserCtx) {
  const o = ov(u, "can_edit_finance");
  if (o !== null) return o;
  return canViewFinance(u);
}

export function financeCompanies(u: UserCtx): "both" | "UTPL" | "IFPL" | "none" {
  if (!canViewFinance(u)) return "none";
  const scopeOv = u.overrides?.finance_company_scope;
  if (scopeOv === "UTPL" || scopeOv === "IFPL" || scopeOv === "both") return scopeOv;
  if (isAdminTier(u) || !u.company || u.company === "Unze Group") return "both";
  if (u.company.startsWith("Unze Trading")) return "UTPL";
  if (u.company.startsWith("Imperial")) return "IFPL";
  return "both";
}

// ── Imperial Footwear P&L (named access) ──────────────────────────
// The Imperial P&L page is restricted to Khuram, Kamran, Shakeel and
// Shahida. Admin + CEO roles pass by default (Khuram's accounts, Kamran);
// Shakeel and Shahida hold per-member overrides (migration 144). PA is
// blocked unconditionally, before any override — house rule 6.
export function canViewIfplPnl(u: UserCtx) {
  if (isPA(u)) return false;
  const o = ov(u, "can_view_ifpl_pnl");
  if (o !== null) return o;
  return isAdminTier(u);
}

// ── Receivables ───────────────────────────────────────────────────
export function canViewReceivables(u: UserCtx) {
  // Same override-before-PA ordering bug as canViewFinance, fixed the
  // same way on 15 Jul 2026 — isPA() checked first, unconditionally.
  if (isPA(u)) return false;
  const o = ov(u, "can_view_receivables");
  if (o !== null) return o;
  if (isAdminTier(u)) return true;
  return u.role === "Manager" && (u.department === "Finance" || u.department === "Unze Trading Ops");
}

export function canEditReceivables(u: UserCtx) {
  const o = ov(u, "can_edit_receivables");
  if (o !== null) return o;
  return isAdminTier(u) || u.department === "Unze Trading Ops";
}

// ── Executive dashboard ───────────────────────────────────────────
export function canViewExecutiveDashboard(u: UserCtx) {
  const o = ov(u, "can_view_executive_dashboard");
  if (o !== null) return o;
  return isAdminTier(u);
}

// ── Operations dashboard ──────────────────────────────────────────
export function canViewOperations(u: UserCtx) {
  const o = ov(u, "can_view_operations_dashboard");
  if (o !== null) return o;
  return isAdminTier(u) || u.department === "Unze Trading Ops";
}

export function canViewStock(u: UserCtx) {
  const o = ov(u, "can_view_stock");
  if (o !== null) return o;
  return isAdminTier(u) || u.department === "Unze Trading Ops";
}

// Guarantees: Finance dept + Unze Trading Ops (they chase releases)
export function canViewGuarantees(u: UserCtx) {
  // Same override-before-PA ordering bug as canViewFinance, fixed the
  // same way on 15 Jul 2026 — isPA() checked first, unconditionally.
  if (isPA(u)) return false;
  const o = ov(u, "can_view_guarantees");
  if (o !== null) return o;
  if (isAdminTier(u)) return true;
  return u.role === "Manager" && (u.department === "Finance" || u.department === "Unze Trading Ops");
}

// Full guarantee details (limits, cash margin, bank charges, facility utilisation)
// Ops team gets chase-only view — no financial figures
export function canViewGuaranteeFinancials(u: UserCtx) {
  if (isPA(u)) return false;
  if (isAdminTier(u)) return true;
  return u.role === "Manager" && u.department === "Finance";
}

export function canManageGuarantees(u: UserCtx): boolean {
  // Same override-before-PA ordering bug as canViewFinance, fixed the
  // same way on 15 Jul 2026 — isPA() checked first, unconditionally.
  if (isPA(u)) return false;
  const o = ov(u, "can_manage_guarantees");
  if (o !== null) return o;
  if (isAdminTier(u)) return true;
  return u.role === "Manager" && u.department === "Finance";
}

export function canManageStock(u: UserCtx) {
  const o = ov(u, "can_manage_stock");
  if (o !== null) return o;
  return isAdminTier(u) || (u.role === "Manager" && u.department === "Unze Trading Ops");
}

// ── Tasks & meetings ──────────────────────────────────────────────
export function canSeeAllTasks(u: UserCtx) {
  const o = ov(u, "can_see_all_tasks");
  if (o !== null) return o;
  return isPrivileged(u);
}

export function canCreateAssignments(u: UserCtx) {
  const o = ov(u, "can_create_tasks");
  if (o !== null) return o;
  return isPrivileged(u) || (u.role === "Manager" && u.department === "Unze Trading Ops");
}

export function canReviewTasks(u: UserCtx) {
  const o = ov(u, "can_review_tasks");
  if (o !== null) return o;
  return isPrivileged(u);
}

export function canManageRecurringTasks(u: UserCtx) {
  const o = ov(u, "can_manage_recurring_tasks");
  if (o !== null) return o;
  return isPrivileged(u);
}

export function canManageCalendarRequests(u: UserCtx) {
  const o = ov(u, "can_manage_calendar");
  if (o !== null) return o;
  return isPrivileged(u);
}

export function canManageTaxNotices(u: UserCtx): boolean {
  // Same override-before-PA ordering bug as canViewFinance, fixed the
  // same way on 15 Jul 2026 — isPA() checked first, unconditionally.
  if (isPA(u)) return false;
  const o = ov(u, "can_manage_tax_notices");
  if (o !== null) return o;
  if (isAdminTier(u)) return true;
  return false;
}

export function canSeeAllMinutes(u: UserCtx) {
  const o = ov(u, "can_see_all_minutes");
  if (o !== null) return o;
  return isPrivileged(u);
}

export function canManageMeetings(u: UserCtx): boolean {
  const o = ov(u, "can_manage_meetings");
  if (o !== null) return o;
  return isPrivileged(u);
}

// ── Members / settings ────────────────────────────────────────────
export function canManageMembers(u: UserCtx) {
  const o = ov(u, "can_view_members");
  if (o !== null) return o;
  return isPrivileged(u);
}

export function canAddMembers(u: UserCtx) {
  const o = ov(u, "can_add_members");
  if (o !== null) return o;
  return isPrivileged(u);
}

export function canViewAuditLog(u: UserCtx) {
  const o = ov(u, "can_view_audit_log");
  if (o !== null) return o;
  return isPrivileged(u);
}

export function canViewExceptions(u: UserCtx) {
  const o = ov(u, "can_view_exceptions");
  if (o !== null) return o;
  return isPrivileged(u);
}

export function canSeeSettings(u: UserCtx) {
  return canManageMembers(u) || canViewAuditLog(u) || canViewExceptions(u);
}

export function canImportExport(u: UserCtx) {
  const o = ov(u, "can_import_export");
  if (o !== null) return o;
  return isPrivileged(u);
}

// ── Member administration rules ───────────────────────────────────
export function assignableRoles(u: UserCtx): string[] {
  // Assigning the Admin role is the one thing CEO-tier can't do, even
  // though CEO otherwise defaults to full rights — see the CEO role note
  // at the top of this file.
  if (isMainAdmin(u) || u.role === "Admin") return ["Admin", "CEO", "Executive", "Manager", "Member"];
  if (isCEO(u)) return ["CEO", "Executive", "Manager", "Member"];
  if (u.role === "Executive") return ["Manager", "Member"];
  return [];
}

export function canChangePasswordFor(actor: UserCtx, target: UserCtx): boolean {
  const o = ov(actor, "can_reset_passwords");
  if (o === false) return lc(actor.email) === lc(target.email);
  if (isAdminTier(actor)) return true;
  if (o === true) return true;
  if (actor.role === "Executive") {
    if (lc(actor.email) === lc(target.email)) return true;
    return target.role === "Member";
  }
  return lc(actor.email) === lc(target.email);
}

export function canEditMember(actor: UserCtx, target: UserCtx): boolean {
  // Khuram's own two accounts: only the true Admin account can edit them
  // (not just any CEO-tier actor) — tightened 16 Jul 2026 alongside making
  // CEO a real, assignable role.
  if (PROTECTED_EMAILS.includes(lc(target.email)) && lc(actor.email) !== lc(target.email)) {
    return isMainAdmin(actor) || actor.role === "Admin";
  }
  const o = ov(actor, "can_edit_members");
  if (o !== null) return o;
  if (isAdminTier(actor)) return true;
  if (actor.role === "Executive") return target.role === "Manager" || target.role === "Member";
  return false;
}

export function canDeleteMember(actor: UserCtx, target: UserCtx): boolean {
  if (PROTECTED_EMAILS.includes(lc(target.email))) return false;
  const o = ov(actor, "can_delete_members");
  if (o === false) return false;
  return canEditMember(actor, target);
}

// ── Departments ───────────────────────────────────────────────────
const DEPT_PERM_KEY: Record<string, string> = {
  "Unze Trading Ops": "can_view_dept_ops",
  HR: "can_view_dept_hr",
  Tax: "can_view_dept_tax",
  Legal: "can_view_dept_legal",
  Audit: "can_view_dept_audit",
  Admin: "can_view_dept_admin",
  IT: "can_view_dept_it",
};


export function canViewDepartment(u: UserCtx, departmentName: string): boolean {
  const permKey = DEPT_PERM_KEY[departmentName];
  if (permKey) {
    const o = ov(u, permKey);
    if (o !== null) return o;
  }
  if (isAdminTier(u)) return true;
  if (u.role === "Executive") return false;
  if (u.role === "Manager") {
    if (u.department === departmentName) return true;
    // Finance HODs can view Tax Notices (closely related)
    if (departmentName === "Tax" && u.department === "Finance") return true;
    return false;
  }
  return false;
}

// ── PA dashboard ─────────────────────────────────────────────────
export function canViewPADashboard(u: UserCtx) {
  const o = ov(u, "can_view_pa_dashboard");
  if (o !== null) return o;
  return isPA(u) || isAdminTier(u);
}

// ── Production ────────────────────────────────────────────────────
export function canAccessDailyEntry(u: UserCtx) {
  const o = ov(u, "can_access_daily_entry");
  if (o !== null) return o;
  return isAdminTier(u) || u.department === "Unze Trading Ops";
}

// ── Investments ──────────────────────────────────────────────────
export function canViewInvestments(u: UserCtx) {
  const o = ov(u, "can_view_investments");
  if (o !== null) return o;
  return isCEO(u) || isMainAdmin(u) || isPA(u);
}

export function canEditInvestments(u: UserCtx) {
  const o = ov(u, "can_edit_investments");
  if (o !== null) return o;
  return isCEO(u) || isMainAdmin(u);
}

// Narrower than canEditInvestments — view + trigger a live price pull
// only, NOT add/edit/delete holdings or manual price overrides. Khuram
// granted this to PA verbally on 12 Jul 2026, then during the full-app
// audit on 15 Jul 2026 decided to pull refresh back to admin-tier-only
// while PA keeps view access (see canViewInvestments). Still toggleable
// per-member via the Access Matrix (Finance > Inv Refresh) without a
// code change, in case it's needed again for a specific person.
export function canRefreshInvestmentPrices(u: UserCtx) {
  const o = ov(u, "can_refresh_investment_prices");
  if (o !== null) return o;
  return isCEO(u) || isMainAdmin(u);
}

// ── Operations targets editing ───────────────────────────────────
export function canEditOperationsTargets(u: UserCtx) {
  const o = ov(u, "can_edit_operations_targets");
  if (o !== null) return o;
  return isPrivileged(u) || lc(u.email) === OPS_HOD_EMAIL;
}

// ── Tax Accounts Schedule ────────────────────────────────────────
export function canViewTaxAccounts(u: UserCtx): boolean {
  // Same override-before-PA ordering bug as canViewFinance, fixed the
  // same way on 15 Jul 2026 — isPA() checked first, unconditionally.
  if (isPA(u)) return false;
  const o = ov(u, "can_view_dept_tax_accounts");
  if (o !== null) return o;
  return true; // all other authenticated users can view by default
}

export function canManageTaxSchedule(u: UserCtx): boolean {
  // Same override-before-PA ordering bug as canViewFinance, fixed the
  // same way on 15 Jul 2026 — isPA() checked first, unconditionally.
  if (isPA(u)) return false;
  const o = ov(u, "can_manage_tax_schedule");
  if (o !== null) return o;
  if (isAdminTier(u)) return true;
  return false;
}

// ── Folderit (document status dashboard) ──────────────────────────
// HR documents (Policies & SOPs, etc.) are locked down by default — only
// Admin/CEO can see them until explicitly granted via the Members access
// matrix ("Folderit" box → "HR" toggle).
export function canViewFolderitHr(u: UserCtx): boolean {
  const o = ov(u, "can_view_folderit_hr");
  if (o !== null) return o;
  return isAdminTier(u);
}

// ── Task ownership ──────────────────────────────────────────────
// Kamran (CEO2_EMAIL) added 16 Jul 2026 — his tasks get the same
// protection Khuram's and the PA's already did; a pre-existing gap since
// isCEO() covered him for other checks but this list never had.
const PROTECTED_CREATOR_EMAILS = [ADMIN_EMAIL, CEO_EMAIL, CEO2_EMAIL, PA_EMAIL];

// Khuram: "no task can be completed until it's submitted to their HOD, and
// only the HOD can mark the task completed... rest of the members submit
// their tasks, only their HOD completes the tasks." Then, after finding
// he couldn't close a task assigned to someone outside his own direct
// reports: "i thought i can close any tasks, complete any task. You must
// allow me, sundus and Kamran to do this" — Khuram, Kamran, and the
// Executive (Sundas) are a blanket override on top of the HOD rule, not
// limited to tasks that happen to have routed to them specifically.
// Everyone else can only close what's actually theirs: submitting a task
// (see routeSubmittedTask in TaskStatus.tsx) reassigns it to the
// assignee's manager, so "the current owner while it's Submitted" is the
// right HOD for the general case.
export function canCompleteSubmittedTask(u: UserCtx, assignedToEmail: string | null | undefined): boolean {
  if (!assignedToEmail) return false;
  if (lc(u.email) === lc(assignedToEmail)) return true;
  return isPrivileged(u);
}

export function isTaskProtected(assignedByEmail: string | null | undefined): boolean {
  if (!assignedByEmail) return false;
  return PROTECTED_CREATOR_EMAILS.includes(assignedByEmail.toLowerCase());
}

export function canEditTask(u: UserCtx, assignedByEmail: string | null | undefined): boolean {
  if (isAdminTier(u) || isPA(u)) return true;
  return !isTaskProtected(assignedByEmail);
}

export function canDeleteTask(u: UserCtx, assignedByEmail: string | null | undefined): boolean {
  if (isAdminTier(u) || isPA(u)) return true;
  return !isTaskProtected(assignedByEmail);
}

// Khuram: "once the task is completed then it should be greyed out. I
// dont think the task should be allowed to be edited afterwards... unless
// the administration who has the rights to bring it back." Deliberately
// narrower than isPrivileged — the Executive is not "administration" in
// Khuram's wording here, so only Admin-tier (Khuram, Kamran, or role
// Admin) can reopen or edit a Completed task. Used by TaskStatus.tsx and
// TaskDetailPanel.tsx to lock every field on a completed task for anyone
// else, and by the DB trigger (migration 117) as the same rule enforced
// server-side.
export function canReopenCompletedTask(u: UserCtx): boolean {
  return isAdminTier(u);
}

// ── Admin Operations (registrations, compliance, documents, ops) ─
// CEO / Admin role, or any Manager in the Admin department.
export function canAccessAdminOps(u: UserCtx): boolean {
  const o = ov(u, "can_access_admin_ops");
  if (o !== null) return o;
  return isAdminTier(u) || (u.role === "Manager" && u.department === "Admin");
}

// ── Admin Entry (fuel, solar, utility, maintenance — mobile form) ─
// Off by default — granted explicitly per member via the Access Matrix.
export function canAccessAdminEntry(u: UserCtx): boolean {
  const o = ov(u, "can_access_admin_entry");
  if (o !== null) return o;
  return false;
}

// ── Widget-level visibility ───────────────────────────────────────
// One level below page-level access: canViewExecutiveDashboard() etc.
// decide whether someone can reach a page at all; this decides which
// individual sections/widgets they see once there. defaultVisible is
// what applies when no override row exists for this member+widget —
// normally isAdminTier(u), but callers can pass a narrower default for
// widgets that shouldn't be on for everyone with page access (e.g.
// something Finance-scoped within a page open to more than Finance).
export function widgetVisible(u: UserCtx, key: string, defaultVisible: boolean): boolean {
  const v = u.widgetOverrides?.[key];
  if (v === true || v === false) return v;
  return defaultVisible;
}
