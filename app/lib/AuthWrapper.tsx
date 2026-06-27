"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { useRouter, usePathname } from "next/navigation";
import SidebarLayout from "./SidebarLayout";
import type { UserCtx, PermOverrides } from "./permissions";

type Member = {
  id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  role: string;
  department: string | null;
  company: string | null;
};

const SLATE = "#64748b";

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

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [userCtx, setUserCtx] = useState<UserCtx | null>(null);
  const [notifCount, setNotifCount] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ type: string; label: string; sub: string; href: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifItems, setNotifItems] = useState<{ label: string; count: number; href: string }[]>([]);
  const notifRef = useRef<HTMLDivElement>(null);

  // Auth check
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
        .select("id, name, first_name, last_name, role, department, company")
        .eq("email", user.email)
        .single();
      if (memberData) {
        setMember(memberData);
        // Build UserCtx for sidebar permission checks
        let overrides: PermOverrides | null = null;
        const { data: perms } = await supabase
          .from("member_permissions").select("*").eq("member_id", memberData.id).maybeSingle();
        if (perms) overrides = perms as PermOverrides;
        setUserCtx({
          email: user.email,
          role: memberData.role,
          department: memberData.department,
          company: memberData.company,
          overrides,
        });
      }
      setLoading(false);
    }
    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        router.push("/login");
      }
    });

    return () => { subscription.unsubscribe(); };
  }, [router]);

  // Register service worker for push notifications
  useEffect(() => {
    if (!loading && email && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, [loading, email]);

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

      const { data: pendingMins } = await supabase.from("pending_minutes").select("id").eq("status", "pending");
      if (pendingMins && pendingMins.length > 0) items.push({ label: "Minutes pending", count: pendingMins.length, href: "/meetings" });
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
        .on("postgres_changes", { event: "*", schema: "public", table: "pending_minutes" }, () => loadNotifications())
        .subscribe();
      return () => { supabase.removeChannel(channel); };
    }
  }, [loading, email, member]);

  // Global search
  async function runSearch(q: string) {
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const lower = q.toLowerCase();
    const results: { type: string; label: string; sub: string; href: string }[] = [];

    const { data: tasks } = await supabase.from("tasks").select("id, description, assigned_to, status").limit(100);
    for (const t of (tasks || [])) {
      if (t.description?.toLowerCase().includes(lower) || t.assigned_to?.toLowerCase().includes(lower)) {
        results.push({ type: "Task", label: t.description, sub: `${t.assigned_to || "Unassigned"} · ${t.status}`, href: `/tasks?task=${t.id}` });
      }
      if (results.length >= 8) break;
    }

    const { data: members } = await supabase.from("members").select("name, email, role, department").limit(50);
    for (const m of (members || [])) {
      if (m.name?.toLowerCase().includes(lower) || m.email?.toLowerCase().includes(lower)) {
        const roleLabel = m.email === "k.saleem@unzegroup.com" ? "CEO" : m.role;
        results.push({ type: "Member", label: m.name || m.email || "", sub: `${roleLabel} · ${m.department || "—"}`, href: "/members" });
      }
      if (results.length >= 12) break;
    }

    const { data: meetings } = await supabase.from("meetings").select("id, title, meeting_date").limit(30);
    for (const mt of (meetings || [])) {
      if (mt.title?.toLowerCase().includes(lower)) {
        results.push({ type: "Meeting", label: mt.title, sub: mt.meeting_date, href: `/my-minutes?meeting=${mt.id}` });
      }
      if (results.length >= 15) break;
    }

    setSearchResults(results.slice(0, 10));
    setSearching(false);
  }

  useEffect(() => {
    const timer = setTimeout(() => { if (searchQuery) runSearch(searchQuery); else setSearchResults([]); }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) { setSearchOpen(false); setSearchQuery(""); setSearchResults([]); }
    }
    if (notifOpen || searchOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [notifOpen, searchOpen]);

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
  const displayRoleLabel = email === "k.saleem@unzegroup.com" ? "CEO" : currentRole;

  const roleColor =
    email === "k.saleem@unzegroup.com"
      ? "#2563eb"
      : currentRole === "Admin"
      ? "#111827"
      : currentRole === "Executive"
      ? "#7c3aed"
      : currentRole === "Manager"
      ? "#16a34a"
      : SLATE;

  return (
    <SidebarLayout
      userCtx={userCtx}
      userName={displayName(member, email)}
      userEmail={email || ""}
      userRole={displayRoleLabel}
      roleColor={roleColor}
      notifCount={notifCount}
      notifItems={notifItems}
      searchOpen={searchOpen}
      setSearchOpen={setSearchOpen}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      searchResults={searchResults}
      searching={searching}
      searchRef={searchRef}
      notifOpen={notifOpen}
      setNotifOpen={setNotifOpen}
      notifRef={notifRef}
      onSignOut={handleSignOut}
    >
      {children}
    </SidebarLayout>
  );
}
