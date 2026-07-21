"use client";

import { useState, useEffect, useRef } from "react";
import { supabase, loadMyPermissions } from "./supabase";
import { useRouter, usePathname } from "next/navigation";
import SidebarLayout from "./SidebarLayout";
import ChatPanel from "./ChatPanel";
import FloatingTaskButton from "./FloatingTaskButton";
import { canSeeAllTasks, canCreateAssignments, isSecondaryCEO, myIdentityEmails, type UserCtx, type PermOverrides } from "./permissions";
import { COLOURS } from "./SharedUI";

type Member = {
  id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  role: string;
  department: string | null;
  company: string | null;
  photo_url?: string | null;
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
  const [userPhotoUrl, setUserPhotoUrl] = useState<string | null>(null);
  const [userCtx, setUserCtx] = useState<UserCtx | null>(null);
  const [notifCount, setNotifCount] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ type: string; label: string; sub: string; href: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifItems, setNotifItems] = useState<{ label: string; count: number; href: string; action?: () => void }[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
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
        .select("id, name, first_name, last_name, role, department, company, photo_url")
        .eq("email", user.email)
        .single();
      if (memberData) {
        setMember(memberData);
        setUserPhotoUrl(memberData.photo_url ?? null);
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

  // Listen for photo uploads so the sidebar updates instantly without a reload.
  // Only update if it's the current user's own photo (memberId absent = self-upload from Profile).
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (e: any) => {
      const { url, memberId: uploadedFor } = e.detail ?? {};
      if (!url) return;
      // Profile page fires without memberId → always our own photo
      // MembersManager fires with memberId → only update if it matches our row
      setMember((prev) => {
        if (!uploadedFor || uploadedFor === prev?.id) {
          setUserPhotoUrl(url);
        }
        return prev; // don't mutate member itself
      });
    };
    window.addEventListener("unze:photo-updated", handler);
    return () => window.removeEventListener("unze:photo-updated", handler);
  }, []);

  // Register service worker + auto-subscribe to push on login.
  // Shows the browser "Allow notifications?" prompt automatically.
  // If granted, saves the subscription silently. User can disable from Profile.
  useEffect(() => {
    if (loading || !email || !("serviceWorker" in navigator)) return;

    async function setupPush() {
      if (!("Notification" in window)) return;
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) return;

      try {
        const reg = await navigator.serviceWorker.register("/sw.js");

        // Request permission if not yet decided
        let permission = Notification.permission;
        if (permission === "default") {
          permission = await Notification.requestPermission();
        }
        if (permission !== "granted") return;

        // Get or create subscription
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: vapidKey,
          });
        }

        // Save to DB (fire and forget — failures are silent)
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        fetch("/api/notifications/push-subscribe", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ email, subscription: sub.toJSON() }),
        }).catch(() => {});
      } catch {
        // Push not supported or blocked — fail silently
      }
    }

    setupPush();
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

    // Khuram (18/07/2026): each item deep-links straight into the matching
    // Tasks-page filter (?filter=...&scope=mine) instead of the bare /tasks
    // URL — clicking "Overdue" now actually shows only overdue tasks, not
    // the whole list. See TasksList.tsx's filterFromUrl/scopeFromUrl read.
    const items: { label: string; count: number; href: string; action?: () => void }[] = [];
    if (counts.overdue_count > 0) items.push({ label: "Overdue tasks", count: counts.overdue_count, href: "/tasks?filter=overdue&scope=mine" });
    if (counts.waiting_count > 0) items.push({ label: "Waiting reply", count: counts.waiting_count, href: "/tasks?filter=waiting&scope=mine" });
    if (counts.submitted_count > 0) items.push({ label: "Submitted — awaiting your sign-off", count: counts.submitted_count, href: "/tasks?filter=submitted&scope=mine" });
    if (counts.exception_count > 0) items.push({ label: "Needs explanation", count: counts.exception_count, href: "/tasks?filter=exception&scope=mine" });
    if (isAdmin && counts.machines_down_count > 0) items.push({ label: "Machines down", count: counts.machines_down_count, href: "/dashboard" });
    if (isAdmin && counts.pending_minutes_count > 0) items.push({ label: "Minutes pending", count: counts.pending_minutes_count, href: "/meetings" });
    if (counts.chat_unread_count > 0) items.push({ label: "Unread messages", count: counts.chat_unread_count, href: "#", action: () => setChatOpen(true) });

    setNotifItems(items);
    setNotifCount(items.reduce((s, i) => s + i.count, 0));
  }

  useEffect(() => {
    if (!loading && email && member) {
      loadNotifications();

      // Realtime — fires instantly when DB changes
      const channel = supabase
        .channel("notif-bell")
        .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => loadNotifications())
        .on("postgres_changes", { event: "*", schema: "public", table: "machine_issues" }, () => loadNotifications())
        .on("postgres_changes", { event: "*", schema: "public", table: "pending_minutes" }, () => loadNotifications())
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, () => loadNotifications())
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_participants" }, () => loadNotifications())
        .subscribe();

      // Polling fallback — Realtime on RLS-protected tables can silently drop
      // events if the auth token isn't forwarded. 15 s poll ensures the bell
      // is never stale by more than one check interval.
      const poll = setInterval(loadNotifications, 15_000);

      return () => {
        supabase.removeChannel(channel);
        clearInterval(poll);
      };
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
    <>
      <SidebarLayout
        userCtx={userCtx}
        userName={displayName(member, email)}
        userEmail={email || ""}
        userRole={displayRoleLabel}
        roleColor={roleColor}
        userPhotoUrl={userPhotoUrl}
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
      <ChatPanel
        email={email}
        memberId={member?.id ?? null}
        memberName={displayName(member, email)}
        isOpen={chatOpen}
        onToggle={() => setChatOpen((o) => !o)}
        onClose={() => setChatOpen(false)}
        unreadCount={notifItems.find((i) => i.label === "Unread messages")?.count ?? 0}
      />
      {userCtx && canCreateAssignments(userCtx) && (
        <FloatingTaskButton />
      )}
    </>
  );
}
