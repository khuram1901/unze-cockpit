"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

type Member = {
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  role: string;
  department: string | null;
  company: string | null;
};

type NavItem = {
  label: string;
  href: string;
  allowedRoles: string[];
  financeManagerException?: boolean;
  managerDepartments?: string[];
};

const NAVY = "#1e293b";
const SLATE = "#64748b";
const LIGHT = "#f1f5f9";
const BORDER = "#e2e8f0";

function displayName(member: Member | null, email: string | null) {
  if (!member) return email || "User";
  const fullName = `${member.first_name || ""} ${member.last_name || ""}`.trim();
  return fullName || member.name || email || "User";
}

// ─────────────────────────────────────────────────────────────────
// Main navigation — daily work
// ─────────────────────────────────────────────────────────────────
const MAIN_NAV: NavItem[] = [
  { label: "Executive", href: "/executive", allowedRoles: ["Admin", "Executive"] },
  { label: "PA Dashboard", href: "/pa", allowedRoles: ["Admin", "Executive"] },
  { label: "Operations", href: "/dashboard", allowedRoles: ["Admin", "Executive", "Manager"], managerDepartments: ["Unze Trading Ops"] },
  { label: "Daily Entry", href: "/production", allowedRoles: ["Admin", "Executive", "Manager", "Member"], managerDepartments: ["Unze Trading Ops"] },
  { label: "Monthly Targets", href: "/monthly-operations-targets", allowedRoles: ["Admin", "Executive", "Manager"], managerDepartments: ["Unze Trading Ops"] },
  { label: "Tasks", href: "/tasks", allowedRoles: ["Admin", "Executive", "Manager", "Member"] },
  { label: "Calendar", href: "/calendar", allowedRoles: ["Admin", "Executive", "Manager", "Member"] },
  { label: "Meetings", href: "/meetings", allowedRoles: ["Admin", "Executive"] },
  { label: "Finance", href: "/finance", allowedRoles: ["Admin"], financeManagerException: true },
  { label: "Audit", href: "/department/audit", allowedRoles: ["Admin", "Executive", "Manager"], managerDepartments: ["Audit"] },
  { label: "HR", href: "/department/hr", allowedRoles: ["Admin", "Executive", "Manager"], managerDepartments: ["HR"] },
  { label: "Taxation", href: "/department/taxation", allowedRoles: ["Admin", "Executive", "Manager"], managerDepartments: ["Tax"] },
  { label: "Admin Dept", href: "/department/admin", allowedRoles: ["Admin", "Executive", "Manager"], managerDepartments: ["Admin"] },
];

// ─────────────────────────────────────────────────────────────────
// Settings — admin/executive configuration, not used daily
// ─────────────────────────────────────────────────────────────────
const SETTINGS_NAV: NavItem[] = [
  { label: "Members", href: "/members", allowedRoles: ["Admin", "Executive"] },
  { label: "Department Owners", href: "/department-owners", allowedRoles: ["Admin", "Executive"] },
  { label: "Opening Balances", href: "/opening-balances", allowedRoles: ["Admin", "Executive"] },
  { label: "Exceptions", href: "/exceptions", allowedRoles: ["Admin", "Executive"] },
  { label: "Audit Log", href: "/audit-log", allowedRoles: ["Admin"] },
  { label: "My Profile", href: "/profile", allowedRoles: ["Admin", "Executive", "Manager", "Member"] },
];

export default function AuthWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notifCount, setNotifCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifItems, setNotifItems] = useState<{ label: string; count: number; href: string }[]>([]);

  const settingsRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  // Detect mobile
  useEffect(() => {
    function checkWidth() {
      setIsMobile(window.innerWidth < 900);
    }
    checkWidth();
    window.addEventListener("resize", checkWidth);
    return () => window.removeEventListener("resize", checkWidth);
  }, []);

  // Auth check — use getSession() for faster local check + auto-refresh
  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push("/login");
        return;
      }
      const user = session.user;
      setEmail(user.email ?? null);
      const { data: memberData } = await supabase
        .from("members")
        .select("name, first_name, last_name, role, department, company")
        .eq("email", user.email)
        .single();
      if (memberData) {
        setMember(memberData);
      }
      setLoading(false);
    }
    checkAuth();

    // Listen for auth changes (token refresh, sign out)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        router.push("/login");
      }
    });

    return () => { subscription.unsubscribe(); };
  }, [router]);

  // Load notification counts
  async function loadNotifications() {
    if (!email || !member) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    const role = member.role;
    const userName = `${member.first_name || ""} ${member.last_name || ""}`.trim() || member.name || email;
    const isAdmin = role === "Admin" || role === "Executive";

    let query = supabase.from("tasks").select("id, status, due_date, assigned_to_email, assigned_to");
    if (!isAdmin) {
      query = query.eq("assigned_to_email", email);
    }

    const { data: tasks } = await query;
    if (!tasks) return;

    const myTasks = isAdmin ? tasks : tasks.filter((t) => t.assigned_to_email === email || t.assigned_to === userName);
    const open = myTasks.filter((t: Record<string, unknown>) => t.status !== "Completed" && t.status !== "Cancelled");
    const overdue = open.filter((t: Record<string, unknown>) => t.due_date && (t.due_date as string) < todayStr);
    const waiting = open.filter((t: Record<string, unknown>) => t.status === "Waiting Reply");

    const items: { label: string; count: number; href: string }[] = [];
    if (overdue.length > 0) items.push({ label: "Overdue tasks", count: overdue.length, href: "/tasks" });
    if (waiting.length > 0) items.push({ label: "Waiting reply", count: waiting.length, href: "/tasks" });

    if (isAdmin) {
      const { data: machines } = await supabase.from("machine_issues").select("id").eq("issue_status", "Down");
      if (machines && machines.length > 0) items.push({ label: "Machines down", count: machines.length, href: "/dashboard" });
    }

    setNotifItems(items);
    setNotifCount(items.reduce((s, i) => s + i.count, 0));
  }

  useEffect(() => {
    if (!loading && email && member) {
      loadNotifications();
      const channel = supabase
        .channel("notif-bell")
        .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => loadNotifications())
        .on("postgres_changes", { event: "*", schema: "public", table: "machine_issues" }, () => loadNotifications())
        .subscribe();
      return () => { supabase.removeChannel(channel); };
    }
  }, [loading, email, member]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    }
    if (settingsOpen || notifOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [settingsOpen, notifOpen]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading) {
    return (
      <main style={{ padding: "24px" }}>
        <p style={{ color: SLATE }}>Loading…</p>
      </main>
    );
  }

  const currentRole = member?.role || "Member";
  const currentDepartment = member?.department || null;

  // Filter main nav items
  const visibleMainNav = MAIN_NAV.filter((item) => {
    if (!item.allowedRoles.includes(currentRole)) return false;
    // Finance — Manager only sees it if they're in Finance department
    if (item.financeManagerException) {
      return (
        currentRole === "Admin" ||
        currentRole === "Executive" ||
        (currentRole === "Manager" && currentDepartment === "Finance")
      );
    }
    // Department-scoped pages — Managers only see pages matching their department
    if (item.managerDepartments && currentRole === "Manager") {
      return currentDepartment !== null && item.managerDepartments.includes(currentDepartment);
    }
    return true;
  });

  // Filter settings items
  const visibleSettingsNav = SETTINGS_NAV.filter((item) =>
    item.allowedRoles.includes(currentRole)
  );
  const canSeeSettings = visibleSettingsNav.length > 0;

  const roleColor =
    currentRole === "Admin"
      ? "#2563eb"
      : currentRole === "Executive"
      ? "#7c3aed"
      : currentRole === "Manager"
      ? "#16a34a"
      : SLATE;

  function NavLinks({ stacked }: { stacked: boolean }) {
    return (
      <>
        {visibleMainNav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              style={{
                textDecoration: "none",
                fontSize: "15px",
                fontWeight: active ? 700 : 500,
                color: active ? "white" : stacked ? "white" : NAVY,
                backgroundColor: active ? "#2563eb" : "transparent",
                borderRadius: "7px",
                padding: stacked ? "10px 12px" : "7px 12px",
                whiteSpace: "nowrap",
                border: stacked
                  ? `1px solid ${active ? "#2563eb" : "rgba(255,255,255,0.18)"}`
                  : "1px solid transparent",
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </>
    );
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          borderBottom: `3px solid ${NAVY}`,
          backgroundColor: "white",
          boxShadow: "0 1px 3px rgba(15,23,42,0.06)",
        }}
      >
        {/* Top bar: logo + user + settings */}
        <div
          style={{
            maxWidth: "1400px",
            margin: "0 auto",
            padding: "10px 18px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "8px" : "14px", minWidth: 0 }}>
            {isMobile && (
              <button
                onClick={() => setMenuOpen((prev) => !prev)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "38px",
                  height: "38px",
                  border: `1px solid ${BORDER}`,
                  borderRadius: "8px",
                  backgroundColor: LIGHT,
                  cursor: "pointer",
                  fontSize: "18px",
                  color: NAVY,
                  flexShrink: 0,
                }}
                aria-label="Toggle navigation"
              >
                ☰
              </button>
            )}

            <Image
              src="/unze-logo.png"
              alt="Unze Group"
              width={160}
              height={64}
              style={{ height: isMobile ? "32px" : "54px", width: "auto", objectFit: "contain", flexShrink: 0 }}
              priority
            />

            {!isMobile && (
              <span
                style={{
                  fontSize: "17px",
                  fontWeight: 700,
                  color: NAVY,
                  whiteSpace: "nowrap",
                  borderLeft: `1px solid ${BORDER}`,
                  paddingLeft: "14px",
                }}
              >
                Cockpit
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "6px" : "10px", minWidth: 0 }}>
            {!isMobile && (
              <>
                <span
                  style={{
                    fontSize: "17px",
                    color: NAVY,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: "220px",
                  }}
                >
                  {displayName(member, email)}
                </span>
                <span
                  style={{
                    fontSize: "15px",
                    fontWeight: 700,
                    backgroundColor: roleColor,
                    color: "white",
                    padding: "2px 9px",
                    borderRadius: "10px",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {currentRole}
                </span>
              </>
            )}

            {/* Notification bell */}
            <div ref={notifRef} style={{ position: "relative" }}>
              <button
                onClick={() => setNotifOpen((v) => !v)}
                style={{
                  position: "relative",
                  backgroundColor: "white",
                  border: `1px solid ${BORDER}`,
                  borderRadius: "7px",
                  padding: "6px 10px",
                  fontSize: "18px",
                  cursor: "pointer",
                  lineHeight: 1,
                  color: notifCount > 0 ? "#dc2626" : NAVY,
                }}
                aria-label="Notifications"
              >
                🔔
                {notifCount > 0 && (
                  <span style={{
                    position: "absolute", top: "-4px", right: "-4px",
                    backgroundColor: "#dc2626", color: "white",
                    fontSize: "11px", fontWeight: 700,
                    width: "18px", height: "18px",
                    borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                  }}>{notifCount > 9 ? "9+" : notifCount}</span>
                )}
              </button>

              {notifOpen && (
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0,
                  minWidth: "240px", backgroundColor: "white",
                  border: `1px solid ${BORDER}`, borderRadius: "8px",
                  boxShadow: "0 4px 14px rgba(15,23,42,0.10)",
                  zIndex: 30, overflow: "hidden",
                }}>
                  <div style={{ padding: "8px 12px", borderBottom: `1px solid ${BORDER}`, fontSize: "13px", fontWeight: 700, color: NAVY }}>
                    Notifications
                  </div>
                  {notifItems.length === 0 ? (
                    <div style={{ padding: "12px", fontSize: "14px", color: SLATE, textAlign: "center" }}>
                      All clear — nothing needs attention
                    </div>
                  ) : (
                    notifItems.map((item) => (
                      <a key={item.label} href={item.href} onClick={() => setNotifOpen(false)}
                        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 12px", borderBottom: `1px solid ${LIGHT}`, textDecoration: "none", color: "inherit" }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = LIGHT; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "transparent"; }}
                      >
                        <span style={{ fontSize: "14px", color: NAVY, fontWeight: 500 }}>{item.label}</span>
                        <span style={{
                          fontSize: "12px", fontWeight: 700, color: "white",
                          backgroundColor: "#dc2626", borderRadius: "10px", padding: "2px 7px",
                        }}>{item.count}</span>
                      </a>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Settings dropdown — only Admin / Executive */}
            {canSeeSettings && (
              <div ref={settingsRef} style={{ position: "relative" }}>
                <button
                  onClick={() => setSettingsOpen((v) => !v)}
                  style={{
                    backgroundColor: "white",
                    border: `1px solid ${BORDER}`,
                    borderRadius: "7px",
                    padding: "7px 12px",
                    fontSize: "17px",
                    fontWeight: 600,
                    color: NAVY,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                  }}
                  aria-label="Settings menu"
                >
                  <span style={{ fontSize: "16px" }}>⚙</span>{!isMobile && " Settings"}
                  <span style={{ fontSize: "14px", color: SLATE }}>▾</span>
                </button>

                {settingsOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 6px)",
                      right: 0,
                      minWidth: "200px",
                      backgroundColor: "white",
                      border: `1px solid ${BORDER}`,
                      borderRadius: "8px",
                      boxShadow: "0 4px 14px rgba(15,23,42,0.10)",
                      padding: "6px",
                      zIndex: 30,
                    }}
                  >
                    <div
                      style={{
                        fontSize: "14px",
                        fontWeight: 700,
                        color: SLATE,
                        padding: "6px 10px 4px",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                      }}
                    >
                      Configuration
                    </div>
                    {visibleSettingsNav.map((item) => {
                      const active = pathname === item.href;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setSettingsOpen(false)}
                          style={{
                            display: "block",
                            textDecoration: "none",
                            fontSize: "17px",
                            fontWeight: active ? 700 : 500,
                            color: active ? "white" : NAVY,
                            backgroundColor: active ? "#2563eb" : "transparent",
                            borderRadius: "6px",
                            padding: "8px 10px",
                            marginBottom: "2px",
                          }}
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={handleSignOut}
              style={{
                backgroundColor: NAVY,
                border: "none",
                borderRadius: "7px",
                padding: "8px 12px",
                fontSize: "17px",
                fontWeight: 600,
                color: "white",
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Permanent horizontal nav strip — desktop only */}
        {!isMobile && (
          <nav
            style={{
              borderTop: `1px solid ${BORDER}`,
              backgroundColor: LIGHT,
              padding: "8px 18px",
            }}
          >
            <div
              style={{
                maxWidth: "1400px",
                margin: "0 auto",
                display: "flex",
                flexWrap: "wrap",
                gap: "4px",
                alignItems: "center",
              }}
            >
              <NavLinks stacked={false} />
            </div>
          </nav>
        )}

        {/* Mobile dropdown nav */}
        {isMobile && menuOpen && (
          <nav
            style={{
              borderTop: `1px solid ${BORDER}`,
              backgroundColor: NAVY,
              padding: "12px 18px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: "8px",
            }}
          >
            <NavLinks stacked={true} />
            {canSeeSettings && (
              <>
                <div
                  style={{
                    gridColumn: "1 / -1",
                    fontSize: "14px",
                    fontWeight: 700,
                    color: "rgba(255,255,255,0.6)",
                    padding: "8px 4px 4px",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    borderTop: "1px solid rgba(255,255,255,0.18)",
                    marginTop: "4px",
                  }}
                >
                  Settings
                </div>
                {visibleSettingsNav.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMenuOpen(false)}
                      style={{
                        textDecoration: "none",
                        fontSize: "15px",
                        fontWeight: active ? 700 : 500,
                        color: "white",
                        backgroundColor: active ? "#2563eb" : "transparent",
                        borderRadius: "7px",
                        padding: "10px 12px",
                        whiteSpace: "nowrap",
                        border: `1px solid ${
                          active ? "#2563eb" : "rgba(255,255,255,0.18)"
                        }`,
                      }}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </>
            )}
          </nav>
        )}
      </header>

      <div style={{ maxWidth: "1400px", margin: "0 auto", width: "100%" }}>
        {children}
      </div>
    </div>
  );
}