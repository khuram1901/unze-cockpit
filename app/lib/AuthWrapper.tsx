"use client";

import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

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
      <main
        style={{
          padding: "24px",
          fontFamily: "sans-serif",
        }}
      >
        <p>Loading…</p>
      </main>
    );
  }

  const currentRole = member?.role || "Member";

  const navItems: NavItem[] = [
    {
      label: "Executive",
      href: "/executive",
      allowedRoles: ["Admin", "Executive"],
    },
    {
      label: "Operations",
      href: "/dashboard",
      allowedRoles: ["Admin", "Executive", "Manager"],
    },
    {
      label: "Daily Entry",
      href: "/production",
      allowedRoles: ["Admin", "Executive", "Manager", "Member"],
    },
    {
      label: "Monthly Targets",
      href: "/monthly-operations-targets",
      allowedRoles: ["Admin", "Executive"],
    },
    {
      label: "Tasks",
      href: "/tasks",
      allowedRoles: ["Admin", "Executive", "Manager", "Member"],
    },
    {
      label: "Exceptions",
      href: "/exceptions",
      allowedRoles: ["Admin", "Executive", "Manager", "Member"],
    },
    {
      label: "Opening Balances",
      href: "/opening-balances",
      allowedRoles: ["Admin"],
    },
    {
      label: "Members",
      href: "/members",
      allowedRoles: ["Admin"],
    },
    {
      label: "Department Owners",
      href: "/department-owners",
      allowedRoles: ["Admin", "Executive"],
    },
    {
      label: "Finance",
      href: "/finance",
      allowedRoles: ["Admin", "Executive"],
    },
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
      ? "#0070f3"
      : currentRole === "Executive"
      ? "#7c3aed"
      : currentRole === "Manager"
      ? "#16a34a"
      : "#888";

  return (
    <div style={{ fontFamily: "sans-serif", minHeight: "100vh" }}>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          borderBottom: "1px solid #e0e0e0",
          backgroundColor: "#fafafa",
        }}
      >
        <div
          style={{
            maxWidth: "1400px",
            margin: "0 auto",
            padding: "12px 16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              onClick={() => setMenuOpen((prev) => !prev)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "38px",
                height: "38px",
                border: "1px solid #ddd",
                borderRadius: "8px",
                backgroundColor: "white",
                cursor: "pointer",
                fontSize: "20px",
              }}
              aria-label="Toggle navigation"
            >
              ☰
            </button>

            <strong style={{ fontSize: "16px", whiteSpace: "nowrap" }}>
              Unze Group Cockpit
            </strong>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontSize: "13px",
                color: "#555",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "220px",
              }}
            >
              {displayName(member, email)}

              <span
                style={{
                  marginLeft: "6px",
                  fontSize: "11px",
                  backgroundColor: roleColor,
                  color: "white",
                  padding: "2px 8px",
                  borderRadius: "10px",
                }}
              >
                {currentRole}
              </span>
            </span>

            <button
              onClick={handleSignOut}
              style={{
                backgroundColor: "white",
                border: "1px solid #ccc",
                borderRadius: "6px",
                padding: "7px 12px",
                fontSize: "13px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Sign out
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav
            style={{
              borderTop: "1px solid #e0e0e0",
              backgroundColor: "white",
              padding: "10px 16px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "8px",
            }}
          >
            {visibleNavItems.map((item) => {
              const active = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  style={{
                    textDecoration: "none",
                    fontSize: "14px",
                    fontWeight: active ? "bold" : "normal",
                    color: active ? "#0070f3" : "#333",
                    backgroundColor: active ? "#eff6ff" : "#fafafa",
                    border: active ? "1px solid #bfdbfe" : "1px solid #eee",
                    borderRadius: "8px",
                    padding: "10px 12px",
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}
      </header>

      <div
        style={{
          maxWidth: "1400px",
          margin: "0 auto",
          width: "100%",
        }}
      >
        {children}
      </div>
    </div>
  );
}