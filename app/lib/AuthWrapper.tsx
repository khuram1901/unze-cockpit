"use client";

import { useState, useEffect, useRef } from "react";
import { supabase, loadMyPermissions } from "./supabase";
import { useRouter, usePathname } from "next/navigation";
import SidebarLayout from "./SidebarLayout";
import { canSeeAllTasks, isSecondaryCEO, myIdentityEmails, type UserCtx, type PermOverrides } from "./permissions";
import { COLOURS } from "./SharedUI";

type Member = {
  id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  role: string;
  department: string | null;
  company: string | null;
};

const { SLATE } = COLOURS;

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
  const searchCacheRef = useRef<{
    tasks: { id: string; description: string; assigned_to: string | null; status: string }[];
    members: { name: string | null; email: string | null; role: string; department: string | null }[];
    meetings: { id: string; title: string; meeting_date: string }[];
  } | null>(null);

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
        let overrides: PermOverrides | null = null;
        const permData = await loadMyPermissions(session.access_token);
        if (permData) overrides = permData as PermOverrides;
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

  // Load notification counts — always scoped to the logged-in user's own tasks
  async function loadNotifications() {
    if (!email || !member) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    const role = member.role;
    const isAdmin = userCtx ? canSeeAllTasks(userCtx) : (role === "Admin" || role === "CEO" || role === "Executive");

    const { data } = await supabase.rpc("get_notification_badge_counts", {
      p_emails: myIdentityEmails(email),
      p_today: todayStr,
      p_is_admin: isAdmin,
    });
    const counts = data?.[0];
    if (!counts) return;

    const items: { label: string; count: number; href: string }[] = [];
    if (counts.overdue_count > 0) items.push({ label: "Overdue tasks", count: counts.overdue_count, href: "/tasks" });
    if (counts.waiting_count > 0) items.push({ label: "Waiting reply", count: counts.waiting_count, href: "/tasks" });
    if (counts.submitted_count > 0) items.push({ label: "Submitted — awaiting your sign-off", count: counts.submitted_count, href: "/tasks" });
    if (counts.exception_count > 0) items.push({ label: "Needs explanation", count: counts.exception_count, href: "/tasks" });
    if (isAdmin && counts.machines_down_count > 0) items.push({ label: "Machines down", count: counts.machines_down_count, href: "/dashboard" });
    if (isAdmin && counts.pending_minutes_count > 0) items.push({ label: "Minutes pending", count: counts.pending_minutes_count, href: "/meetings" });

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

  // Global search — data is fetched once per session and cached in memory
  async function runSearch(q: string) {
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const lower = q.toLowerCase();
    const results: { type: string; label: string; sub: string; href: string }[] = [];

    if (!searchCacheRef.current) {
      const [{ data: tasksData }, { data: membersData }, { data: meetingsData }] = await Promise.all([
        supabase.from("tasks").select("id, description, assigned_to, status").not("status", "in", '("Completed","Cancelled")').order("created_at", { ascending: false }).limit(200),
        supabase.from("members").select("name, email, role, department").limit(50),
        supabase.from("meetings").select("id, title, meeting_date").order("meeting_date", { ascending: false }).limit(50),
      ]);
      searchCacheRef.current = { tasks: tasksData || [], members: membersData || [], meetings: meetingsData || [] };
    }

    const { tasks, members: membersList, meetings } = searchCacheRef.current;
    for (const t of tasks) {
      if (t.description?.toLowerCase().includes(lower) || t.assigned_to?.toLowerCase().includes(lower)) {
        results.push({ type: "Task", label: t.description, sub: `${t.assigned_to || "Unassigned"} · ${t.status}`, href: `/tasks?task=${t.id}` });
      }
      if (results.length >= 8) break;
    }

    for (const m of (membersList || [])) {
      if (m.name?.toLowerCase().includes(lower) || m.email?.toLowerCase().includes(lower)) {
        const roleLabel = m.email === "k.saleem@unzegroup.com" ? "CEO" : m.role;
        results.push({ type: "Member", label: m.name || m.email || "", sub: `${roleLabel} · ${m.department || "—"}`, href: "/members" });
      }
      if (results.length >= 12) break;
    }

    for (const mt of meetings) {
      if (mt.title?.toLowerCase().includes(lower)) {
        results.push({ type: "Meeting", label: mt.title, sub: mt.meeting_date ? mt.meeting_date.split("-").reverse().join("/") : "—", href: `/my-minutes?meeting=${mt.id}` });
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
      <main style={{ padding: "24px", maxWidth: "100%", overflowX: "hidden" }}>
        <p style={{ color: SLATE }}>Loading…</p>
      </main>
    );
  }

  const currentRole = member?.role || "Member";
  const isCEOUser = userCtx ? (userCtx.email === "k.saleem@unzegroup.com" || userCtx.email === "kamran@unze.co.uk") : false;
  const displayRoleLabel = isCEOUser ? "CEO" : currentRole;

  const roleColor = isCEOUser
    ? COLOURS.BLUE
    : currentRole === "Admin"
    ? "#111827"
    : currentRole === "Executive"
    ? COLOURS.PURPLE
    : currentRole === "Manager"
    ? COLOURS.GREEN
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
