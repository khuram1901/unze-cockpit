"use client";

import { useState, useEffect } from "react";
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

  useEffect(() => {
    function checkWidth() {
      setIsMobile(window.innerWidth < 900);
    }
    checkWidth();
    window.addEventListener("resize", checkWidth);
    return () => window.removeEventListener("resize", checkWidth);
  }, []);

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

  const navItems: NavItem[] = [
  { label: "Executive", href: "/executive", allowedRoles: ["Admin", "Executive"] },
  { label: "Operations", href: "/dashboard", allowedRoles: ["Admin", "Executive", "Manager"] },
  { label: "Daily Entry", href: "/production", allowedRoles: ["Admin", "Executive", "Manager", "Member"] },
  { label: "Monthly Targets", href: "/monthly-operations-targets", allowedRoles: ["Admin", "Executive"] },
  { label: "Tasks", href: "/tasks", allowedRoles: ["Admin", "Executive", "Manager", "Member"] },
  { label: "Exceptions", href: "/exceptions", allowedRoles: ["Admin", "Executive", "Manager", "Member"] },

  { label: "Calendar", href: "/calendar", allowedRoles: ["Admin", "Executive", "Manager", "Member"] },

  { label: "Opening Balances", href: "/opening-balances", allowedRoles: ["Admin"] },
  { label: "Members", href: "/members", allowedRoles: ["Admin"] },
  { label: "Department Owners", href: "/department-owners", allowedRoles: ["Admin", "Executive"] },
  { label: "Finance", href: "/finance", allowedRoles: ["Admin", "Executive"] },
];

  const currentDepartment = member?.department || null;

  const visibleNavItems = navItems.filter((item) => {
    if (item.href === "/finance") {
      return (
        currentRole === "Admin" ||
        currentRole === "Executive" ||
        (currentRole === "Manager" && currentDepartment === "Finance")
      );
    }
    return item.allowedRoles.includes(currentRole);
  });

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
        {visibleNavItems.map((item) => {
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
        {/* Top bar: logo + user */}
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

          <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
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
          </nav>
        )}
      </header>

      <div style={{ maxWidth: "1400px", margin: "0 auto", width: "100%" }}>
        {children}
      </div>
    </div>
  );
}
