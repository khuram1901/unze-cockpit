"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "./ThemeProvider";
import { COLOURS } from "./SharedUI";
import {
  PAGE_REGISTRY, GROUP_ORDER,
  type PageCard,
} from "./pageRegistry";
import {
  isAdminTier, canViewFinance, canEditFinance, financeCompanies,
  canViewExecutiveDashboard, canViewOperations, canViewReceivables,
  canSeeAllTasks, canCreateAssignments, canReviewTasks,
  canManageRecurringTasks, canManageCalendarRequests, canSeeAllMinutes,
  canViewDepartment, canManageMembers, canAddMembers,
  canViewAuditLog, canViewExceptions, canImportExport,
  canAccessDailyEntry, canViewPADashboard, canViewInvestments,
  canViewStock, canManageStock, canViewGuarantees, canViewTaxAccounts,
  isMainAdmin, isCEO,
  type UserCtx,
} from "./permissions";

// ── Permission check (mirrors home page logic exactly) ──────────
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
  can_view_exceptions: canViewExceptions,
  can_import_export: canImportExport,
  can_access_daily_entry: canAccessDailyEntry,
  can_view_investments: canViewInvestments,
  can_view_stock: canViewStock,
  can_manage_stock: canManageStock,
  can_view_guarantees: canViewGuarantees,
  can_view_dept_tax_accounts: canViewTaxAccounts,
};

function isCardVisible(card: PageCard, ctx: UserCtx): boolean {
  if (card.permKey === "can_view_dept_tax" &&
      (ctx.email || "").toLowerCase() === "shakeel@unze.co.uk") return true;
  const perms = ctx.overrides as Record<string, boolean | string | null> | null;
  if (card.permKey === "_admin_settings") return isMainAdmin(ctx);
  if (card.permKey.startsWith("_")) return true;
  const isPACtx = ctx.role === "Executive" || (ctx.email || "").toLowerCase() === "pa.ceo@unze.co.uk";
  if (isPACtx && card.permKey === "can_view_pa_dashboard") return false;
  if ((isMainAdmin(ctx) || isCEO(ctx)) && (card.permKey === "can_view_executive_dashboard" || card.permKey === "can_view_pa_dashboard")) return false;
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

// ── Sidebar nav groups ────────────────────────────────────────────
const SIDEBAR_GROUPS = [
  "Overview",
  "Operations",
  "Departments",
  "Finance",
  "My Workspace",
  "Settings",
] as const;

// ── Sidebar width ────────────────────────────────────────────────
const SIDEBAR_W = 256;
const SIDEBAR_COLLAPSED_W = 68;

type SidebarLayoutProps = {
  children: React.ReactNode;
  userCtx: UserCtx | null;
  userName: string;
  userEmail: string;
  userRole: string;
  roleColor: string;
  notifCount: number;
  notifItems: { label: string; count: number; href: string }[];
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

export default function SidebarLayout({
  children,
  userCtx,
  userName,
  userEmail,
  userRole,
  roleColor,
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
}: SidebarLayoutProps) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    function check() {
      const w = window.innerWidth;
      setIsMobile(w < 768);
      setIsTablet(w >= 768 && w < 1024);
      if (w < 768) setCollapsed(false);
      else if (w < 1024) setCollapsed(true);
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Build visible nav items from registry + permissions
  const visibleCards = userCtx ? PAGE_REGISTRY.filter((card) => isCardVisible(card, userCtx)) : [];

  const isPAUser = userCtx ? (userCtx.role === "Executive" || (userCtx.email || "").toLowerCase() === "pa.ceo@unze.co.uk") : false;

  const alwaysItems: PageCard[] = [
    { permKey: "_home", title: "Executive Dashboard", subtitle: "", href: isPAUser ? "/pa" : "/home", icon: "🏠", group: "_top" },
  ];

  const sidebarW = isMobile ? 0 : collapsed ? SIDEBAR_COLLAPSED_W : SIDEBAR_W;

  const initials = userName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "U";

  function isActive(href: string) {
    if (href === "/home") return pathname === "/home";
    return pathname === href || pathname.startsWith(href + "/");
  }

  // ── Sidebar content (shared between mobile overlay and desktop fixed) ──
  function SidebarContent() {
    const sideItemStyle = (active: boolean): React.CSSProperties => ({
      display: "flex", alignItems: "center",
      gap: "10px",
      justifyContent: collapsed ? "center" : "flex-start",
      padding: collapsed ? "8px" : "8px 10px",
      borderRadius: "8px",
      backgroundColor: active ? COLOURS.NAVY : "transparent",
      color: active ? "#FFFFFF" : "var(--text-sidebar)",
      textDecoration: "none",
      fontSize: "13.5px",
      fontWeight: active ? 500 : 400,
      fontFamily: "var(--font-sans, Inter, sans-serif)",
      transition: "background-color 0.15s ease",
      marginBottom: "2px",
      cursor: "pointer",
      border: "none",
      width: "100%",
      textAlign: "left" as const,
    });

    return (
      <div style={{
        display: "flex", flexDirection: "column", height: "100%",
        backgroundColor: "var(--bg-sidebar)",
        color: "var(--text-sidebar)",
      }}>
        {/* ── Brand ── */}
        <div style={{
          padding: collapsed ? "20px 10px 20px" : "20px 16px 20px",
          borderBottom: `1px solid var(--sidebar-border)`,
          display: "flex", alignItems: "center", gap: "10px",
          justifyContent: collapsed ? "center" : "flex-start",
        }}>
          {/* Brand mark — dark square with "U" */}
          <div style={{
            width: "28px", height: "28px", borderRadius: "8px",
            backgroundColor: COLOURS.NAVY, color: "#fff",
            display: "grid", placeItems: "center",
            fontFamily: "var(--font-display, 'Inter Tight', sans-serif)",
            fontWeight: 700, fontSize: "14px", letterSpacing: "-0.02em",
            flexShrink: 0,
          }}>U</div>
          {!collapsed && (
            <div>
              <div style={{
                fontFamily: "var(--font-display, 'Inter Tight', sans-serif)",
                fontWeight: 600, fontSize: "15px", letterSpacing: "-0.01em",
                color: "var(--text-sidebar-active)", lineHeight: 1.2,
              }}>Unze Group</div>
              <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "1px" }}>Operations</div>
            </div>
          )}
        </div>

        {/* ── Nav sections ── */}
        <nav style={{ flex: 1, overflowY: "auto", padding: collapsed ? "8px 6px" : "8px 12px" }}>
          {/* OVERVIEW group — always-visible Executive Dashboard + Overview items */}
          <div style={{ marginBottom: "4px" }}>
            {!collapsed && (
              <div style={{
                fontSize: "10.5px", fontWeight: 500, color: "var(--text-muted)",
                textTransform: "uppercase", letterSpacing: "0.12em",
                padding: "16px 10px 6px",
              }}>Overview</div>
            )}
            {collapsed && <div style={{ width: "24px", height: "1px", backgroundColor: "var(--sidebar-border)", margin: "10px auto 6px" }} />}
            {/* Executive Dashboard — always first */}
            {alwaysItems.map((item) => (
              <NavItem key={item.href} item={item} active={isActive(item.href)} collapsed={collapsed} />
            ))}
            {/* Overview-group permission-gated items (PA Dashboard) */}
            {visibleCards
              .filter((c) => c.group === "Overview")
              .sort((a, b) => a.title.localeCompare(b.title))
              .map((card) => (
                <NavItem key={card.href} item={card} active={isActive(card.href)} collapsed={collapsed} />
              ))}
          </div>

          {/* Permission-gated groups */}
          {SIDEBAR_GROUPS.filter((g) => g !== "Overview").map((groupName) => {
            const groupCards = visibleCards
              .filter((c) => c.group === groupName)
              .sort((a, b) => a.title.trim().toLowerCase().localeCompare(b.title.trim().toLowerCase()));
            if (groupCards.length === 0) return null;
            return (
              <div key={groupName} style={{ marginBottom: "4px" }}>
                {!collapsed && (
                  <div style={{
                    fontSize: "10px", fontWeight: 500, color: "var(--text-muted)",
                    textTransform: "uppercase", letterSpacing: "0.12em",
                    padding: "16px 10px 6px",
                  }}>
                    {groupName}
                  </div>
                )}
                {collapsed && (
                  <div style={{
                    width: "24px", height: "1px", backgroundColor: "var(--sidebar-border)",
                    margin: "10px auto 6px",
                  }} />
                )}
                {groupCards.map((card) => (
                  <NavItem key={card.href} item={card} active={isActive(card.href)} collapsed={collapsed} />
                ))}
              </div>
            );
          })}

          {/* PREFERENCES — dark mode */}
          <div style={{ marginBottom: "4px" }}>
            {!collapsed && (
              <div style={{
                fontSize: "10.5px", fontWeight: 500, color: "var(--text-muted)",
                textTransform: "uppercase", letterSpacing: "0.12em",
                padding: "16px 10px 6px",
              }}>Preferences</div>
            )}
            {collapsed && <div style={{ width: "24px", height: "1px", backgroundColor: "var(--sidebar-border)", margin: "10px auto 6px" }} />}
            <button
              onClick={toggleTheme}
              style={sideItemStyle(false)}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--sidebar-hover-bg)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
              title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            >
              <span style={{ fontSize: "16px", flexShrink: 0, width: "18px", textAlign: "center" }}>
                {theme === "light" ? "🌙" : "☀️"}
              </span>
              {!collapsed && <span>{theme === "light" ? "Dark Mode" : "Light Mode"}</span>}
            </button>
          </div>
        </nav>

        {/* ── User card + bottom controls ── */}
        <div style={{
          borderTop: "1px solid var(--sidebar-border)",
          padding: collapsed ? "12px 6px" : "12px 12px",
          display: "flex", flexDirection: "column", gap: "2px",
        }}>
          {/* User card */}
          <div style={{
            display: "flex", alignItems: "center", gap: "10px",
            padding: collapsed ? "8px" : "8px 10px",
            justifyContent: collapsed ? "center" : "flex-start",
          }}>
            <div style={{
              width: "32px", height: "32px", borderRadius: "50%", flexShrink: 0,
              background: "linear-gradient(135deg, #3B4CCA, #6E7AE0)",
              color: "#fff", display: "grid", placeItems: "center",
              fontSize: "12px", fontWeight: 600,
            }}>
              {initials}
            </div>
            {!collapsed && (
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  fontSize: "13px", fontWeight: 600, color: "var(--text-sidebar-active)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{userName}</div>
                <div style={{
                  fontSize: "11px", color: "var(--text-muted)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{userRole}</div>
              </div>
            )}
          </div>

          {/* Collapse toggle — desktop only */}
          {!isMobile && (
            <button
              onClick={() => setCollapsed((v) => !v)}
              style={sideItemStyle(false)}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--sidebar-hover-bg)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <span style={{ fontSize: "14px", flexShrink: 0, width: "18px", textAlign: "center" }}>
                {collapsed ? "»" : "«"}
              </span>
              {!collapsed && <span style={{ color: "var(--text-muted)" }}>Collapse</span>}
            </button>
          )}

          {/* Sign out */}
          <button
            onClick={onSignOut}
            style={{ ...sideItemStyle(false), color: COLOURS.RED }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = COLOURS.DANGER_SOFT; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
            title="Sign out"
          >
            <span style={{ fontSize: "14px", flexShrink: 0, width: "18px", textAlign: "center" }}>↪</span>
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </div>
    );
  }

  function NavItem({ item, active, collapsed: isCollapsed }: { item: PageCard; active: boolean; collapsed: boolean }) {
    return (
      <Link
        href={item.href}
        title={isCollapsed ? item.title : undefined}
        style={{
          display: "flex", alignItems: "center", gap: "10px",
          justifyContent: isCollapsed ? "center" : "flex-start",
          padding: isCollapsed ? "8px" : "8px 10px 8px 7px",
          borderRadius: "8px",
          backgroundColor: active ? COLOURS.NAVY : "transparent",
          borderLeft: active && !isCollapsed ? `3px solid ${COLOURS.BLUE}` : "3px solid transparent",
          color: active ? "#FFFFFF" : "var(--text-sidebar)",
          textDecoration: "none",
          fontSize: "13.5px",
          fontWeight: active ? 500 : 400,
          fontFamily: "var(--font-sans, Inter, sans-serif)",
          transition: "background-color 0.15s ease",
          marginBottom: "2px",
        }}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.backgroundColor = "var(--sidebar-hover-bg)"; }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = "transparent"; }}
      >
        {!isCollapsed && (
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.title}
          </span>
        )}
        {isCollapsed && (
          <span style={{ fontSize: "14px", flexShrink: 0, width: "18px", textAlign: "center" }}>
            {item.icon}
          </span>
        )}
      </Link>
    );
  }

  // Derive page title from current path
  const currentPage = [...alwaysItems, ...PAGE_REGISTRY].find((p) => isActive(p.href));
  const pageTitle = currentPage?.title || "Dashboard";
  const pageSubtitle = currentPage?.subtitle || "";

  return (
    <div style={{ display: "flex", minHeight: "100vh", backgroundColor: "var(--bg-page)" }}>
      {/* ── Desktop sidebar ── */}
      {!isMobile && (
        <aside style={{
          position: "fixed", top: 0, left: 0, bottom: 0,
          width: `${sidebarW}px`,
          zIndex: 30,
          transition: "width 0.2s ease",
          overflowX: "hidden",
          borderRight: "1px solid var(--sidebar-border)",
        }}>
          <SidebarContent />
        </aside>
      )}

      {/* ── Mobile overlay ── */}
      {isMobile && mobileMenuOpen && (
        <>
          <div
            onClick={() => setMobileMenuOpen(false)}
            style={{
              position: "fixed", inset: 0, zIndex: 40,
              backgroundColor: "rgba(0,0,0,0.5)",
              transition: "opacity 0.2s",
            }}
          />
          <aside style={{
            position: "fixed", top: 0, left: 0, bottom: 0,
            width: `${SIDEBAR_W}px`, zIndex: 50,
            boxShadow: "4px 0 20px rgba(0,0,0,0.3)",
          }}>
            <SidebarContent />
          </aside>
        </>
      )}

      {/* ── Main content ── */}
      <div style={{
        flex: 1,
        minWidth: 0,
        marginLeft: isMobile ? 0 : `${sidebarW}px`,
        transition: "margin-left 0.2s ease",
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
            {isMobile && (
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
              {pageSubtitle && (
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
                  minWidth: "280px", maxWidth: "380px",
                  backgroundColor: "var(--bg-card)",
                  border: "1px solid var(--border-color)", borderRadius: "12px",
                  boxShadow: "var(--shadow-md)", zIndex: 30, overflow: "hidden",
                }}>
                  {searchResults.map((r, i) => (
                    <a key={i} href={r.href}
                      onClick={() => { setSearchOpen(false); setSearchQuery(""); }}
                      style={{
                        display: "block", padding: "8px 14px",
                        borderBottom: `1px solid var(--border-light)`,
                        textDecoration: "none", color: "inherit",
                        transition: "background-color 0.1s",
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
                style={{ color: notifCount > 0 ? "#dc2626" : "var(--text-primary)" }}
              >
                🔔
                {notifCount > 0 && (
                  <span style={{
                    position: "absolute", top: "-2px", right: "-2px",
                    backgroundColor: "#dc2626", color: "white",
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
                      <a key={item.label} href={item.href} onClick={() => setNotifOpen(false)}
                        style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          padding: "10px 14px", borderBottom: "1px solid var(--border-light)",
                          textDecoration: "none", color: "inherit", transition: "background-color 0.1s",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-card-hover)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                      >
                        <span style={{ fontSize: "13px", color: "var(--text-primary)", fontWeight: 500 }}>{item.label}</span>
                        <span style={{
                          fontSize: "11px", fontWeight: 700, color: "white",
                          backgroundColor: "#dc2626", borderRadius: "10px", padding: "2px 7px",
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
        <div style={{
          flex: 1,
          minWidth: 0,
          overflowX: "auto",
        }}>
          {children}
        </div>

        {/* Footer */}
        <div style={{
          textAlign: "center", color: "var(--text-muted)",
          fontSize: "12px", padding: "12px 16px",
          borderTop: "1px solid var(--border-color)",
        }}>
          © Unze Group 1989–2026 · v3.0 · All Rights Reserved
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
