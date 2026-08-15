"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "./ThemeProvider";
import { COLOURS } from "./SharedUI";
import {
  PAGE_REGISTRY,
  type PageCard,
} from "./pageRegistry";
import {
  canViewFinance, canEditFinance, financeCompanies,
  canViewExecutiveDashboard, canViewOperations, canViewReceivables,
  canSeeAllTasks, canCreateAssignments, canReviewTasks,
  canManageRecurringTasks, canManageCalendarRequests, canSeeAllMinutes,
  canViewDepartment, canManageMembers, canAddMembers,
  canViewAuditLog, canImportExport,
  canAccessDailyEntry, canAccessAdminOps, canAccessAdminEntry, canAccessBanking,
  canViewPADashboard, canViewInvestments,
  canViewStock, canManageStock, canViewGuarantees, canViewTaxAccounts,
  canViewIfplPnl, canViewRestaurantsPnl,
  isMainAdmin, isSecondaryCEO, isDailyEntryOnly,
  type UserCtx,
} from "./permissions";

// ── Permission map (mirrors home page logic exactly) ─────────────
const PERM_FUNC: Record<string, (ctx: UserCtx) => boolean> = {
  can_view_executive_dashboard: canViewExecutiveDashboard,
  can_view_operations_dashboard: canViewOperations,
  can_view_pa_dashboard: canViewPADashboard,
  can_view_finance: canViewFinance,
  can_edit_finance: canEditFinance,
  can_view_receivables: canViewReceivables,
  can_see_all_tasks: canSeeAllTasks,
  can_create_tasks: canCreateAssignments,
  can_review_tasks: canReviewTasks,
  can_manage_recurring_tasks: canManageRecurringTasks,
  can_manage_calendar: canManageCalendarRequests,
  can_see_all_minutes: canSeeAllMinutes,
  can_view_dept_ops: (c) => canViewDepartment(c, "Unze Trading Ops"),
  can_view_dept_hr: (c) => canViewDepartment(c, "HR"),
  can_view_dept_tax: (c) => canViewDepartment(c, "Tax"),
  can_view_dept_audit: (c) => canViewDepartment(c, "Audit"),
  can_view_dept_admin: (c) => canViewDepartment(c, "Admin"),
  can_view_dept_it: (c) => canViewDepartment(c, "IT"),
  can_view_members: canManageMembers,
  can_add_members: canAddMembers,
  can_view_audit_log: canViewAuditLog,
  can_import_export: canImportExport,
  can_access_daily_entry: canAccessDailyEntry,
  can_access_admin_ops: canAccessAdminOps,
  can_access_admin_entry: canAccessAdminEntry,
  can_view_investments: canViewInvestments,
  can_view_stock: canViewStock,
  can_manage_stock: canManageStock,
  can_view_guarantees: canViewGuarantees,
  can_view_dept_tax_accounts: canViewTaxAccounts,
  can_view_ifpl_pnl: canViewIfplPnl,
  can_view_restaurants_pnl: canViewRestaurantsPnl,
  can_access_banking: canAccessBanking,
};

function isCardVisible(card: PageCard, ctx: UserCtx): boolean {
  // The Tax consultant exemption that used to be inlined here is now part of
  // canViewDepartment(), which can_view_dept_tax already calls above.
  const perms = ctx.overrides as Record<string, boolean | string | null> | null;
  if (card.permKey === "_admin_settings") return isMainAdmin(ctx);
  if (card.permKey === "_backups") return ["khuram1901@gmail.com", "k.saleem@unzegroup.com"].includes((ctx.email || "").toLowerCase());
  if (card.permKey.startsWith("_")) return true;
  // PA dashboard + exec dashboard added via alwaysItems — hide from registry to avoid duplicates
  if (card.permKey === "can_view_pa_dashboard") return false;
  if (card.permKey === "can_view_executive_dashboard") return false;
  // Opening Balances: secondary CEO (Kamran) can't edit finance
  if (isSecondaryCEO(ctx) && card.permKey === "can_edit_finance") return false;
  if (card.permKey === "can_view_finance_utpl") {
    if (!canViewFinance(ctx)) return false;
    const scope = financeCompanies(ctx);
    return scope === "both" || scope === "UTPL";
  }
  if (card.permKey === "can_view_finance_ifpl") {
    if (!canViewFinance(ctx)) return false;
    const scope = financeCompanies(ctx);
    return scope === "both" || scope === "IFPL";
  }
  if (perms) {
    const val = perms[card.permKey];
    if (val === true) return true;
    if (val === false) return false;
  }
  const fn = PERM_FUNC[card.permKey];
  if (fn) return fn(ctx);
  return false;
}

// ── Layout constants ─────────────────────────────────────────────
const ACTIVITY_W = 52;   // icon strip
const PANEL_W    = 176;  // pages list
const SIDEBAR_W  = ACTIVITY_W + PANEL_W; // 228px total

// ── Groups shown in the activity bar (in display order) ─────────
const SIDEBAR_GROUPS = [
  "Departments",
  "Finance",
  "My Workspace",
  "Operations",
  "Settings",
] as const;
type SidebarGroup = typeof SIDEBAR_GROUPS[number];

const GROUP_META: Record<SidebarGroup, { icon: string }> = {
  Operations:     { icon: "🏗️" },
  Departments:    { icon: "🏛️" },
  Finance:        { icon: "💰" },
  "My Workspace": { icon: "📋" },
  Settings:       { icon: "⚙️" },
};

// ── Page link inside the panel ───────────────────────────────────
function PanelItem({ item, active }: { item: PageCard; active: boolean }) {
  return (
    <Link
      href={item.href}
      onClick={item.permKey === "_exec"
        ? () => { if (typeof window !== "undefined") sessionStorage.setItem("exec_nav", "1"); }
        : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "7px 10px 7px 9px",
        marginBottom: "1px",
        borderRadius: "7px",
        borderLeft: `3px solid ${active ? COLOURS.BLUE : "transparent"}`,
        backgroundColor: active ? COLOURS.NAVY : "transparent",
        color: active ? "#ffffff" : "var(--text-sidebar)",
        textDecoration: "none",
        fontSize: "13px",
        fontWeight: active ? 500 : 400,
        lineHeight: 1.3,
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.backgroundColor = "var(--sidebar-hover-bg)"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = "transparent"; }}
    >
      <span style={{ fontSize: "13px", width: "16px", textAlign: "center", flexShrink: 0 }}>
        {item.icon}
      </span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.title}
      </span>
    </Link>
  );
}

// ── Mobile sidebar — flat list with group sections ───────────────
function MobileSidebarContent({
  alwaysItems,
  visibleCards,
  isActive,
  toggleTheme,
  theme,
  initials,
  userName,
  userRole,
  userPhotoUrl,
  onSignOut,
}: {
  alwaysItems: PageCard[];
  visibleCards: PageCard[];
  isActive: (href: string) => boolean;
  toggleTheme: () => void;
  theme: string;
  initials: string;
  userName: string;
  userRole: string;
  userPhotoUrl?: string | null;
  onSignOut: () => void;
}) {
  const mobileItemStyle = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: "10px",
    padding: "12px 16px",          // 44px touch target (12+12+~20 line height)
    minHeight: "44px",
    backgroundColor: active ? COLOURS.NAVY : "transparent",
    borderLeft: `3px solid ${active ? COLOURS.BLUE : "transparent"}`,
    color: active ? "#fff" : "var(--text-sidebar)",
    textDecoration: "none",
    fontSize: "15px",
    fontWeight: active ? 500 : 400,
  });

  return (
    <div style={{
      height: "100%",
      backgroundColor: "var(--bg-sidebar)",
      display: "flex", flexDirection: "column",
      overflowY: "auto",
      // iOS momentum scrolling + prevent background scroll
      WebkitOverflowScrolling: "touch" as React.CSSProperties["WebkitOverflowScrolling"],
      overscrollBehavior: "contain",
    }}>
      {/* Header — pad top for notch/Dynamic Island */}
      <div style={{
        padding: "max(20px, calc(env(safe-area-inset-top) + 12px)) 16px 14px",
        borderBottom: "1px solid var(--sidebar-border)",
        display: "flex", alignItems: "center", gap: "10px",
      }}>
        <div style={{
          width: "32px", height: "32px", borderRadius: "50%",
          background: "linear-gradient(135deg, #3B4CCA, #6E7AE0)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fff", fontSize: "13px", fontWeight: 600, flexShrink: 0,
          overflow: "hidden", position: "relative",
        }}>
          {userPhotoUrl
            ? <img src={userPhotoUrl} alt={initials} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }} />
            : initials}
        </div>
        <div>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-sidebar-active)", lineHeight: 1.2 }}>{userName}</div>
          <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "1px" }}>{userRole}</div>
        </div>
      </div>

      <nav style={{ flex: 1, padding: "8px 0" }}>
        {/* Always items */}
        {alwaysItems.map((item) => (
          <Link key={item.href} href={item.href} style={mobileItemStyle(isActive(item.href))}
            onMouseEnter={(e) => { if (!isActive(item.href)) e.currentTarget.style.backgroundColor = "var(--sidebar-hover-bg)"; }}
            onMouseLeave={(e) => { if (!isActive(item.href)) e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            <span style={{ fontSize: "16px", width: "20px", textAlign: "center" }}>{item.icon}</span>
            <span>{item.title}</span>
          </Link>
        ))}

        {/* Groups */}
        {SIDEBAR_GROUPS.map((groupName) => {
          const groupCards = visibleCards
            .filter((c) => c.group === groupName)
            .sort((a, b) => a.title.localeCompare(b.title));
          if (groupCards.length === 0) return null;
          return (
            <div key={groupName}>
              <div style={{
                padding: "14px 16px 4px",
                fontSize: "10px", fontWeight: 600,
                textTransform: "uppercase", letterSpacing: "0.1em",
                color: "var(--text-muted)",
                display: "flex", alignItems: "center", gap: "6px",
              }}>
                <span>{GROUP_META[groupName].icon}</span>
                {groupName}
              </div>
              {groupCards.map((card) => (
                <Link key={card.href} href={card.href} style={mobileItemStyle(isActive(card.href))}
                  onMouseEnter={(e) => { if (!isActive(card.href)) e.currentTarget.style.backgroundColor = "var(--sidebar-hover-bg)"; }}
                  onMouseLeave={(e) => { if (!isActive(card.href)) e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  <span style={{ fontSize: "16px", width: "20px", textAlign: "center" }}>{card.icon}</span>
                  <span>{card.title}</span>
                </Link>
              ))}
            </div>
          );
        })}
      </nav>

      {/* Footer — pad bottom for iPhone home indicator */}
      <div style={{
        borderTop: "1px solid var(--sidebar-border)",
        padding: "4px 0",
        paddingBottom: "max(8px, env(safe-area-inset-bottom))",
      }}>
        <button onClick={toggleTheme} style={{
          display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px",
          minHeight: "44px", width: "100%", background: "none", border: "none",
          cursor: "pointer", color: "var(--text-sidebar)", fontSize: "15px",
        }}>
          <span style={{ fontSize: "18px", width: "20px", textAlign: "center" }}>
            {theme === "light" ? "🌙" : "☀️"}
          </span>
          <span>{theme === "light" ? "Dark Mode" : "Light Mode"}</span>
        </button>
        <button onClick={onSignOut} style={{
          display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px",
          minHeight: "44px", width: "100%", background: "none", border: "none",
          cursor: "pointer", color: COLOURS.RED, fontSize: "15px",
        }}>
          <span style={{ fontSize: "18px", width: "20px", textAlign: "center" }}>↪</span>
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );
}

// ── SidebarLayout types ──────────────────────────────────────────
type SidebarLayoutProps = {
  children: React.ReactNode;
  userCtx: UserCtx | null;
  userName: string;
  userEmail: string;
  userRole: string;
  roleColor: string;
  userPhotoUrl?: string | null;
  notifCount: number;
  notifItems: { label: string; count: number; href: string; action?: () => void }[];
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  searchResults: { type: string; label: string; sub: string; href: string }[];
  searching: boolean;
  searchRef: React.RefObject<HTMLDivElement | null>;
  notifOpen: boolean;
  setNotifOpen: (v: boolean) => void;
  notifRef: React.RefObject<HTMLDivElement | null>;
  onSignOut: () => void;
};

// ── Main layout ──────────────────────────────────────────────────
export default function SidebarLayout({
  children,
  userCtx,
  userName,
  userRole,
  notifCount,
  notifItems,
  searchOpen,
  setSearchOpen,
  searchQuery,
  setSearchQuery,
  searchResults,
  searching,
  searchRef,
  notifOpen,
  setNotifOpen,
  notifRef,
  onSignOut,
  userPhotoUrl,
}: SidebarLayoutProps) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const [isMobile, setIsMobile] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<SidebarGroup>("Finance");

  // Auto-select the group that contains the current page
  useEffect(() => {
    const currentCard = PAGE_REGISTRY.find((c) => c.href === pathname);
    if (currentCard?.group && SIDEBAR_GROUPS.includes(currentCard.group as SidebarGroup)) {
      setActiveGroup(currentCard.group as SidebarGroup);
    }
  }, [pathname]);

  useEffect(() => {
    function check() { setIsMobile(window.innerWidth < 768); }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => { setMobileMenuOpen(false); }, [pathname]);

  // Lock body scroll when mobile menu is open (prevents background scroll on iOS)
  useEffect(() => {
    if (isMobile && mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isMobile, mobileMenuOpen]);

  // Build visible pages from registry + permissions
  const visibleCards = userCtx ? PAGE_REGISTRY.filter((card) => isCardVisible(card, userCtx)) : [];
  const entryOnly = userCtx ? isDailyEntryOnly(userCtx) : false;
  const isPAUser = userCtx
    ? (userCtx.role === "Executive" || (userCtx.email || "").toLowerCase() === "pa.ceo@unze.co.uk")
    : false;

  const alwaysItems: PageCard[] = [
    { permKey: "_home", title: "Home", subtitle: "Your daily brief", href: "/welcome", icon: "🏠", group: "_top" },
  ];
  if (isPAUser) {
    alwaysItems.push({ permKey: "_pa", title: "PA Dashboard", subtitle: "", href: "/pa", icon: "⚡", group: "_top" });
  }

  // Groups that have at least one visible page
  const visibleGroups = SIDEBAR_GROUPS.filter((g) =>
    visibleCards.some((c) => c.group === g)
  );

  // Ensure activeGroup is always a visible one
  const effectiveGroup: SidebarGroup = visibleGroups.includes(activeGroup)
    ? activeGroup
    : (visibleGroups[0] ?? "Finance");

  // Pages in the current panel — sorted A–Z
  const panelPages = visibleCards
    .filter((c) => c.group === effectiveGroup)
    .sort((a, b) => a.title.localeCompare(b.title));

  const initials = userName.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "U";
  function isActive(href: string) { return pathname === href; }

  const sidebarW = (isMobile || entryOnly) ? 0 : SIDEBAR_W;

  // Page title for the top bar
  const extraPages = [{ href: "/welcome", title: "Home", subtitle: "Your daily brief" }];
  const currentPage = [...alwaysItems, ...extraPages, ...PAGE_REGISTRY].find((p) => isActive(p.href));
  const pageTitle = currentPage?.title || "Dashboard";
  const pageSubtitle = currentPage?.subtitle || "";

  // ── Activity bar icon button ──
  const iconBtnBase: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center",
    width: "36px", height: "36px", borderRadius: "9px",
    background: "none", border: "none", cursor: "pointer",
    margin: "2px auto", fontSize: "17px",
    flexShrink: 0,
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", backgroundColor: "var(--bg-page)" }}>

      {/* ── Desktop sidebar ── */}
      {!isMobile && !entryOnly && (
        <aside style={{
          position: "fixed", top: 0, left: 0, bottom: 0,
          width: `${SIDEBAR_W}px`,
          zIndex: 30,
          display: "flex", flexDirection: "row",
          borderRight: "1px solid var(--sidebar-border)",
        }}>

          {/* ── Activity bar (52px) ── */}
          <div style={{
            width: `${ACTIVITY_W}px`,
            flexShrink: 0,
            backgroundColor: "var(--bg-sidebar)",
            borderRight: "1px solid var(--sidebar-border)",
            display: "flex", flexDirection: "column",
            alignItems: "center",
            padding: "10px 0",
          }}>
            {/* Always items at top */}
            {alwaysItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                title={item.title}
                onClick={item.permKey === "_exec"
                  ? () => { if (typeof window !== "undefined") sessionStorage.setItem("exec_nav", "1"); }
                  : undefined}
                style={{
                  ...iconBtnBase,
                  backgroundColor: isActive(item.href) ? COLOURS.NAVY : "transparent",
                  color: isActive(item.href) ? "#fff" : "var(--text-sidebar)",
                  textDecoration: "none",
                }}
                onMouseEnter={(e) => { if (!isActive(item.href)) e.currentTarget.style.backgroundColor = "var(--sidebar-hover-bg)"; }}
                onMouseLeave={(e) => { if (!isActive(item.href)) e.currentTarget.style.backgroundColor = isActive(item.href) ? COLOURS.NAVY : "transparent"; }}
              >
                {item.icon}
              </Link>
            ))}

            {/* Divider */}
            <div style={{ width: "24px", height: "1px", backgroundColor: "var(--sidebar-border)", margin: "8px 0" }} />

            {/* Group icons */}
            {visibleGroups.map((g) => {
              const isGroupActive = effectiveGroup === g;
              return (
                <button
                  key={g}
                  onClick={() => setActiveGroup(g)}
                  title={g}
                  style={{
                    ...iconBtnBase,
                    backgroundColor: isGroupActive ? COLOURS.NAVY : "transparent",
                    color: "var(--text-sidebar)",
                    position: "relative",
                  }}
                  onMouseEnter={(e) => { if (!isGroupActive) e.currentTarget.style.backgroundColor = "var(--sidebar-hover-bg)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isGroupActive ? COLOURS.NAVY : "transparent"; }}
                >
                  {GROUP_META[g].icon}
                  {/* Active indicator dot */}
                  {isGroupActive && (
                    <span style={{
                      position: "absolute", right: "3px", top: "50%",
                      transform: "translateY(-50%)",
                      width: "3px", height: "16px",
                      backgroundColor: COLOURS.BLUE,
                      borderRadius: "2px",
                    }} />
                  )}
                </button>
              );
            })}

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              title={theme === "light" ? "Dark mode" : "Light mode"}
              style={{ ...iconBtnBase }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--sidebar-hover-bg)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              {theme === "light" ? "🌙" : "☀️"}
            </button>

            {/* Profile avatar — links to profile page */}
            <Link
              href="/profile"
              title={`${userName} · Profile`}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: "32px", height: "32px", borderRadius: "50%",
                background: isActive("/profile") ? COLOURS.NAVY : "linear-gradient(135deg, #3B4CCA, #6E7AE0)",
                color: "#fff", fontSize: "12px", fontWeight: 600,
                textDecoration: "none", margin: "4px auto",
                overflow: "hidden", position: "relative", flexShrink: 0,
              }}
            >
              {userPhotoUrl
                ? <img src={userPhotoUrl} alt={initials} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }} />
                : initials}
            </Link>

            {/* Sign out */}
            <button
              onClick={onSignOut}
              title="Sign out"
              style={{ ...iconBtnBase, color: COLOURS.RED, marginBottom: "4px" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--sidebar-hover-bg)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              ↪
            </button>
          </div>

          {/* ── Pages panel (176px) ── */}
          <div style={{
            width: `${PANEL_W}px`,
            flexShrink: 0,
            backgroundColor: "var(--bg-sidebar)",
            display: "flex", flexDirection: "column",
            overflowY: "auto",
          }}>
            {/* Group title */}
            <div style={{
              padding: "16px 12px 10px",
              borderBottom: "1px solid var(--sidebar-border)",
              display: "flex", alignItems: "center", gap: "7px",
            }}>
              <span style={{ fontSize: "14px" }}>{GROUP_META[effectiveGroup]?.icon}</span>
              <span style={{
                fontSize: "12px", fontWeight: 600,
                textTransform: "uppercase", letterSpacing: "0.06em",
                color: "var(--text-sidebar-active)",
              }}>
                {effectiveGroup}
              </span>
            </div>

            {/* Page list */}
            <nav style={{ flex: 1, padding: "8px 6px" }}>
              {panelPages.map((card) => (
                <PanelItem key={card.href} item={card} active={isActive(card.href)} />
              ))}
              {panelPages.length === 0 && (
                <div style={{ padding: "12px", fontSize: "12px", color: "var(--text-muted)" }}>
                  No pages available
                </div>
              )}
            </nav>
          </div>
        </aside>
      )}

      {/* ── Mobile overlay ── */}
      {isMobile && mobileMenuOpen && !entryOnly && (
        <>
          <div
            onClick={() => setMobileMenuOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 40, backgroundColor: "rgba(0,0,0,0.5)" }}
          />
          <aside style={{
            position: "fixed", top: 0, left: 0, bottom: 0,
            width: "min(280px, 85vw)", zIndex: 50,
            boxShadow: "4px 0 20px rgba(0,0,0,0.3)",
          }}>
            <MobileSidebarContent
              alwaysItems={alwaysItems}
              visibleCards={visibleCards}
              isActive={isActive}
              toggleTheme={toggleTheme}
              theme={theme}
              initials={initials}
              userName={userName}
              userRole={userRole}
              userPhotoUrl={userPhotoUrl}
              onSignOut={onSignOut}
            />
          </aside>
        </>
      )}

      {/* ── Main content area ── */}
      <div style={{
        flex: 1,
        minWidth: 0,
        width: isMobile ? "100%" : `calc(100% - ${sidebarW}px)`,
        marginLeft: isMobile ? 0 : `${sidebarW}px`,
        display: "flex", flexDirection: "column", minHeight: "100vh",
      }}>
        {/* Content header */}
        <header style={{
          position: "sticky", top: 0, zIndex: 20,
          backgroundColor: "var(--bg-header)",
          borderBottom: "1px solid var(--border-color)",
          boxShadow: "var(--shadow-sm)",
          padding: isMobile ? "12px 16px" : "14px 28px",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
            {isMobile && !entryOnly && (
              <button
                onClick={() => setMobileMenuOpen(true)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: "36px", height: "36px", border: "1px solid var(--border-color)",
                  borderRadius: "8px", backgroundColor: "var(--bg-card)",
                  cursor: "pointer", fontSize: "18px", color: "var(--text-primary)", flexShrink: 0,
                }}
                aria-label="Open menu"
              >
                ☰
              </button>
            )}
            <div>
              <h1 style={{
                fontSize: isMobile ? "18px" : "22px", fontWeight: 700,
                color: "var(--text-primary)", margin: 0, lineHeight: 1.2,
              }}>
                {pageTitle}
              </h1>
              {pageSubtitle && !isMobile && (
                <p style={{
                  fontSize: "15px", color: "var(--text-secondary)",
                  margin: "2px 0 0", lineHeight: 1.3,
                }}>
                  {pageSubtitle}
                </p>
              )}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
            {/* Global search */}
            <div ref={searchRef} style={{ position: "relative" }}>
              {searchOpen ? (
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                  style={{
                    width: isMobile ? "140px" : "200px", padding: "7px 12px",
                    border: "1px solid var(--border-color)", borderRadius: "8px",
                    fontSize: "13px", backgroundColor: "var(--bg-input)",
                    color: "var(--text-primary)", outline: "none",
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setSearchOpen(false); setSearchQuery(""); }
                  }}
                />
              ) : (
                <HeaderButton onClick={() => setSearchOpen(true)} title="Search">
                  🔍
                </HeaderButton>
              )}
              {searchOpen && searchResults.length > 0 && (
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0,
                  width: isMobile ? "calc(100vw - 32px)" : undefined,
                  minWidth: isMobile ? undefined : "280px",
                  maxWidth: isMobile ? undefined : "380px",
                  backgroundColor: "var(--bg-card)",
                  border: "1px solid var(--border-color)", borderRadius: "12px",
                  boxShadow: "var(--shadow-md)", zIndex: 30, overflow: "hidden",
                }}>
                  {searchResults.map((r, i) => (
                    <a key={i} href={r.href}
                      onClick={() => { setSearchOpen(false); setSearchQuery(""); }}
                      style={{
                        display: "block", padding: "8px 14px",
                        borderBottom: "1px solid var(--border-light)",
                        textDecoration: "none", color: "inherit",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-card-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                    >
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <span style={{
                          fontSize: "10px", fontWeight: 700, padding: "1px 6px", borderRadius: "4px",
                          backgroundColor: r.type === "Task" ? "#fef3c7" : r.type === "Member" ? "#dbeafe" : "#dcfce7",
                          color: r.type === "Task" ? "#92400e" : r.type === "Member" ? "#1e40af" : "#166534",
                        }}>{r.type}</span>
                        <span style={{
                          fontSize: "13px", fontWeight: 600, color: "var(--text-primary)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>{r.label}</span>
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>{r.sub}</div>
                    </a>
                  ))}
                </div>
              )}
              {searchOpen && searchQuery.length >= 2 && searchResults.length === 0 && !searching && (
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0, minWidth: "180px",
                  backgroundColor: "var(--bg-card)", border: "1px solid var(--border-color)",
                  borderRadius: "12px", boxShadow: "var(--shadow-md)",
                  padding: "12px", zIndex: 30, textAlign: "center",
                  fontSize: "13px", color: "var(--text-secondary)",
                }}>No results found</div>
              )}
            </div>

            {/* Notification bell */}
            <div ref={notifRef} style={{ position: "relative" }}>
              <HeaderButton
                onClick={() => setNotifOpen(!notifOpen)}
                title="Notifications"
                style={{ color: notifCount > 0 ? COLOURS.RED : "var(--text-primary)" }}
              >
                🔔
                {notifCount > 0 && (
                  <span style={{
                    position: "absolute", top: "-2px", right: "-2px",
                    backgroundColor: COLOURS.RED, color: "white",
                    fontSize: "10px", fontWeight: 700,
                    width: "16px", height: "16px",
                    borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                  }}>{notifCount > 9 ? "9+" : notifCount}</span>
                )}
              </HeaderButton>

              {notifOpen && (
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0,
                  minWidth: "260px", backgroundColor: "var(--bg-card)",
                  border: "1px solid var(--border-color)", borderRadius: "12px",
                  boxShadow: "var(--shadow-md)", zIndex: 30, overflow: "hidden",
                }}>
                  <div style={{
                    padding: "10px 14px", borderBottom: "1px solid var(--border-color)",
                    fontSize: "13px", fontWeight: 700, color: "var(--text-primary)",
                  }}>Notifications</div>
                  {notifItems.length === 0 ? (
                    <div style={{ padding: "14px", fontSize: "13px", color: "var(--text-secondary)", textAlign: "center" }}>
                      All clear — nothing needs attention
                    </div>
                  ) : (
                    notifItems.map((item) => (
                      <a key={item.label} href={item.href}
                        onClick={(e) => { if (item.action) { e.preventDefault(); item.action(); } setNotifOpen(false); }}
                        style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          padding: "10px 14px", borderBottom: "1px solid var(--border-light)",
                          textDecoration: "none", color: "inherit",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-card-hover)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                      >
                        <span style={{ fontSize: "13px", color: "var(--text-primary)", fontWeight: 500 }}>{item.label}</span>
                        <span style={{
                          fontSize: "11px", fontWeight: 700, color: "white",
                          backgroundColor: COLOURS.RED, borderRadius: "10px", padding: "2px 7px",
                        }}>{item.count}</span>
                      </a>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <div style={{ flex: 1, minWidth: 0, overflowX: "auto" }}>
          {children}
        </div>

        {/* Footer */}
        <div style={{
          textAlign: "center", color: "var(--text-muted)",
          fontSize: "12px", padding: "12px 16px",
          borderTop: "1px solid var(--border-color)",
        }}>
          © Unze Group 1989–2026 · v4.0 · All Rights Reserved
        </div>
      </div>
    </div>
  );
}

function HeaderButton({
  children,
  onClick,
  title,
  style,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        position: "relative",
        display: "flex", alignItems: "center", justifyContent: "center",
        width: "36px", height: "36px",
        border: "1px solid var(--border-color)", borderRadius: "8px",
        backgroundColor: "var(--bg-card)", cursor: "pointer",
        fontSize: "16px", transition: "background-color 0.15s",
        ...style,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-card-hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-card)"; }}
    >
      {children}
    </button>
  );
}
