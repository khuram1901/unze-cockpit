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
};

type NavItem = {
  label: string;
  href: string;
  allowedRoles: string[];
  // For Finance: also allow Manager if they're in Finance department.
  financeManagerException?: boolean;
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
  { label: "Operations", href: "/dashboard", allowedRoles: ["Admin", "Executive", "Manager"] },
  { label: "Daily Entry", href: "/production", allowedRoles: ["Admin", "Executive", "Manager", "Member"] },
  { label: "Monthly Targets", href: "/monthly-operations-targets", allowedRoles: ["Admin", "Executive", "Manager"] },
  { label: "Tasks", href: "/tasks", allowedRoles: ["Admin", "Executive", "Manager", "Member"] },
  { label: "Calendar", href: "/calendar", allowedRoles: ["Admin", "Executive", "Manager", "Member"] },
  { label: "Finance", href: "/finance", allowedRoles: ["Admin", "Executive"], financeManagerException: true },
  { label: "Machine Issues", href: "/machine-issues", allowedRoles: ["Admin", "Executive", "Manager", "Member"] },
  { label: "Weekly Targets", href: "/weekly-production-targets", allowedRoles: ["Admin"] },
  { label: "Opening Balances", href: "/opening-balances", allowedRoles: ["Admin"] },
];

// ─────────────────────────────────────────────────────────────────
// Settings — admin/executive configuration, not used daily
// ─────────────────────────────────────────────────────────────────
const SETTINGS_NAV: NavItem[] = [
  { label: "Members", href: "/members", allowedRoles: ["Admin", "Executive"] },
  { label: "Department Owners", href: "/department-owners", allowedRoles: ["Admin", "Executive"] },
  { label: "Exceptions", href: "/exceptions", allowedRoles: ["Admin", "Executive"] },
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

  const settingsRef = useRef<HTMLDivElement>(null);

  // Detect mobile
  useEffect(() => {
    function checkWidth() {
      setIsMobile(window.innerWidth < 900);
    }
    checkWidth();
    window.addEventListener("resize", checkWidth);
    return () => window.removeEventListener("resize", checkWidth);
  }, []);

  // Auth check
  useEffect(() => {
    async function checkAuth() {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) {
        router.push("/login");
        return;
      }
      setEmail(user.email ?? null);
      const { data: memberData } = await supabase
        .from("members")
        .select("name, first_name, last_name, role, department")
        .eq("email", user.email)
        .single();
      if (memberData) {
        setMember(memberData);
      }
      setLoading(false);
    }
    checkAuth();
  }, [router]);

  // Close settings dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        settingsRef.current &&
        !settingsRef.current.contains(e.target as Node)
      ) {
        setSettingsOpen(false);
      }
    }
    if (settingsOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [settingsOpen]);

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
    // Finance — Manager only sees it if they're in Finance department
    if (item.financeManagerException) {
      return (
        currentRole === "Admin" ||
        currentRole === "Executive" ||
        (currentRole === "Manager" && currentDepartment === "Finance")
      );
    }
    return item.allowedRoles.includes(currentRole);
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
                fontSize: "13.5px",
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
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            {isMobile && (
              <button
                onClick={() => setMenuOpen((prev) => !prev)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "42px",
                  height: "42px",
                  border: `1px solid ${BORDER}`,
                  borderRadius: "8px",
                  backgroundColor: LIGHT,
                  cursor: "pointer",
                  fontSize: "20px",
                  color: NAVY,
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
              style={{ height: "54px", width: "auto", objectFit: "contain" }}
              priority
            />

            <span
              style={{
                fontSize: "15px",
                fontWeight: 700,
                color: NAVY,
                whiteSpace: "nowrap",
                borderLeft: `1px solid ${BORDER}`,
                paddingLeft: "14px",
              }}
            >
              Cockpit
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
            <span
              style={{
                fontSize: "13px",
                color: NAVY,
                fontWeight: 600,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "220px",
              }}
            >
              {displayName(member, email)}
              <span
                style={{
                  marginLeft: "8px",
                  fontSize: "11px",
                  fontWeight: 700,
                  backgroundColor: roleColor,
                  color: "white",
                  padding: "2px 9px",
                  borderRadius: "10px",
                }}
              >
                {currentRole}
              </span>
            </span>

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
                    fontSize: "13px",
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
                  <span style={{ fontSize: "14px" }}>⚙</span> Settings
                  <span style={{ fontSize: "10px", color: SLATE }}>▾</span>
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
                        fontSize: "10px",
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
                            fontSize: "13px",
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
                padding: "8px 14px",
                fontSize: "13px",
                fontWeight: 600,
                color: "white",
                cursor: "pointer",
                whiteSpace: "nowrap",
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
                    fontSize: "10px",
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
                        fontSize: "13.5px",
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
