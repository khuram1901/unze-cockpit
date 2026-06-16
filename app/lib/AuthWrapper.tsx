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
        .select("name, first_name, last_name, role")
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
          padding: "40px",
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
  ];

  const visibleNavItems = navItems.filter((item) =>
    item.allowedRoles.includes(currentRole)
  );

  const roleColor =
    currentRole === "Admin"
      ? "#0070f3"
      : currentRole === "Executive"
      ? "#7c3aed"
      : currentRole === "Manager"
      ? "#16a34a"
      : "#888";

  return (
    <div style={{ fontFamily: "sans-serif" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 24px",
          borderBottom: "1px solid #e0e0e0",
          backgroundColor: "#fafafa",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "24px",
            flexWrap: "wrap",
          }}
        >
          <strong style={{ fontSize: "16px" }}>Unze Group Cockpit</strong>

          <nav
            style={{
              display: "flex",
              gap: "16px",
              flexWrap: "wrap",
            }}
          >
            {visibleNavItems.map((item) => {
              const active = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    textDecoration: "none",
                    fontSize: "14px",
                    fontWeight: active ? "bold" : "normal",
                    color: active ? "#0070f3" : "#444",
                    borderBottom: active
                      ? "2px solid #0070f3"
                      : "2px solid transparent",
                    paddingBottom: "4px",
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontSize: "14px", color: "#555" }}>
            {displayName(member, email)}

            <span
              style={{
                marginLeft: "6px",
                fontSize: "12px",
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
              padding: "6px 14px",
              fontSize: "14px",
              cursor: "pointer",
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {children}
    </div>
  );
}