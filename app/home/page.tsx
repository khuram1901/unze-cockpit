"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import { COLOURS, PageHeader } from "../lib/SharedUI";
import { useMobile } from "../lib/useMobile";
import { COMPANIES, UTPL_COMPANY_ID, IFPL_COMPANY_ID } from "../lib/constants";

type Badge = { value: string; color: string };
type CardDef = { title: string; subtitle: string; href: string; badge?: Badge; icon: string };
type GroupDef = { title: string; colour: string; cards: CardDef[] };

const CEO_EMAIL = "k.saleem@unzegroup.com";
const ADMIN_EMAIL = "khuram1901@gmail.com";

export default function HomePage() {
  const isMobile = useMobile();
  const [loading, setLoading] = useState(true);
  const [badges, setBadges] = useState<Record<string, Badge>>({});
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    async function loadBadges() {
      const { data: { user } } = await supabase.auth.getUser();
      setUserEmail(user?.email || "");
      const today = new Date().toISOString().slice(0, 10);
      const month = today.slice(0, 7);

      const [
        tasksRes, machinesRes, pendingMinsRes,
        utplCashRes, ifplCashRes,
        meetingsRes, membersRes, auditsRes, receivablesRes,
      ] = await Promise.all([
        supabase.from("tasks").select("id, status, due_date").in("status", ["Not Started", "In Progress", "Waiting Reply"]),
        supabase.from("machine_issues").select("id").eq("issue_status", "Down"),
        supabase.from("pending_minutes").select("id").eq("status", "pending"),
        supabase.from("daily_cash_position").select("closing_after_post_dated, position_date").eq("company_id", UTPL_COMPANY_ID).order("position_date", { ascending: false }).limit(1),
        supabase.from("daily_cash_position").select("closing_after_post_dated, position_date").eq("company_id", IFPL_COMPANY_ID).order("position_date", { ascending: false }).limit(1),
        supabase.from("meetings").select("id").gte("meeting_date", month + "-01"),
        supabase.from("members").select("id"),
        supabase.from("audit_items").select("id, status").in("status", ["Open", "In Progress"]),
        supabase.from("receivables").select("id").neq("status", "Collected"),
      ]);

      const tasks = tasksRes.data || [];
      const overdue = tasks.filter((t) => t.due_date && t.due_date < today);
      const b: Record<string, Badge> = {};

      b.executive = { value: `${overdue.length} overdue`, color: overdue.length > 0 ? COLOURS.RED : COLOURS.GREEN };
      b.pa = { value: `${tasks.length} open tasks`, color: tasks.length > 0 ? "#d97706" : COLOURS.GREEN };
      b.operations = { value: `${(machinesRes.data || []).length} down`, color: (machinesRes.data || []).length > 0 ? COLOURS.RED : COLOURS.GREEN };
      b.tasks = { value: `${tasks.length} open`, color: tasks.length > 0 ? "#d97706" : COLOURS.GREEN };
      b.calendar = { value: `${tasks.filter((t) => t.due_date && t.due_date >= today && t.due_date <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)).length} this week`, color: COLOURS.BLUE };

      const utplCash = utplCashRes.data?.[0];
      const ifplCash = ifplCashRes.data?.[0];
      const fmtPKR = (n: number) => `PKR ${Math.abs(n) >= 1000000 ? (n / 1000000).toFixed(1) + "M" : n.toLocaleString()}`;
      b.utplFinance = utplCash ? { value: fmtPKR(utplCash.closing_after_post_dated), color: utplCash.closing_after_post_dated >= 0 ? COLOURS.GREEN : COLOURS.RED } : { value: "No data", color: COLOURS.SLATE };
      b.ifplFinance = ifplCash ? { value: fmtPKR(ifplCash.closing_after_post_dated), color: ifplCash.closing_after_post_dated >= 0 ? COLOURS.GREEN : COLOURS.RED } : { value: "No data", color: COLOURS.SLATE };

      b.meetings = { value: `${(meetingsRes.data || []).length} this month`, color: COLOURS.BLUE };
      b.minutes = { value: `${(pendingMinsRes.data || []).length} pending`, color: (pendingMinsRes.data || []).length > 0 ? "#d97706" : COLOURS.GREEN };
      b.members = { value: `${(membersRes.data || []).length} members`, color: COLOURS.NAVY };
      b.audit = { value: `${(auditsRes.data || []).length} open`, color: (auditsRes.data || []).length > 0 ? "#d97706" : COLOURS.GREEN };
      b.receivables = { value: `${(receivablesRes.data || []).length} active`, color: (receivablesRes.data || []).length > 0 ? "#d97706" : COLOURS.GREEN };

      setBadges(b);
      setLoading(false);
    }

    loadBadges();
  }, []);

  const isCEO = userEmail.toLowerCase() === CEO_EMAIL;
  const isMainAdmin = userEmail.toLowerCase() === ADMIN_EMAIL;
  const showIcons = !isMainAdmin;

  const groups: GroupDef[] = isCEO ? [
    {
      title: "Command Centre",
      colour: COLOURS.NAVY,
      cards: [
        { title: "Executive Dashboard", subtitle: "Full company overview — operations, finance, tasks", href: "/executive", icon: "📊", badge: badges.executive },
        { title: "Operations Dashboard", subtitle: "Production, dispatch, stock, machines", href: "/dashboard", icon: "🏭", badge: badges.operations },
      ],
    },
    {
      title: "Finance",
      colour: "#16a34a",
      cards: [
        { title: "Unze Trading", subtitle: "Cash position, forecasts, budgets", href: "/finance/unze-trading", icon: "🏢", badge: badges.utplFinance },
        { title: "Imperial Footwear", subtitle: "Cash position, forecasts, budgets", href: "/finance/imperial", icon: "👟", badge: badges.ifplFinance },
      ],
    },
    {
      title: "Tasks & Meetings",
      colour: "#d97706",
      cards: [
        { title: "Tasks", subtitle: "All tasks across departments", href: "/tasks", icon: "✅", badge: badges.tasks },
        { title: "Calendar", subtitle: "Tasks and deadlines view", href: "/calendar", icon: "📅", badge: badges.calendar },
        { title: "Meetings", subtitle: "Minutes, approvals, action items", href: "/meetings", icon: "🤝", badge: badges.meetings },
        { title: "My Minutes", subtitle: "Meeting minutes for HODs", href: "/my-minutes", icon: "📄", badge: badges.minutes },
      ],
    },
    {
      title: "Departments",
      colour: "#7c3aed",
      cards: [
        { title: "Audit", subtitle: "Internal audit tracking", href: "/department/audit", icon: "🔍", badge: badges.audit },
        { title: "HR", subtitle: "Human resources dashboard", href: "/department/hr", icon: "👥" },
        { title: "Taxation", subtitle: "Tax notices and compliance", href: "/department/taxation", icon: "📑" },
        { title: "Admin", subtitle: "Administration dashboard", href: "/department/admin", icon: "🏛️" },
      ],
    },
    {
      title: "Settings",
      colour: COLOURS.SLATE,
      cards: [
        { title: "Exceptions", subtitle: "Exception management and alerts", href: "/exceptions", icon: "⚠️" },
        { title: "Audit Log", subtitle: "System activity trail", href: "/audit-log", icon: "📜" },
        { title: "My Profile", subtitle: "Your account and preferences", href: "/profile", icon: "⚙️" },
      ],
    },
  ] : [
    {
      title: "Command Centre",
      colour: COLOURS.NAVY,
      cards: [
        { title: "Executive Dashboard", subtitle: "Full company overview — operations, finance, tasks", href: "/executive", icon: "📊", badge: badges.executive },
        { title: "PA Dashboard", subtitle: "Assistant view — tasks, notes, quick actions", href: "/pa", icon: "📋", badge: badges.pa },
      ],
    },
    {
      title: "Operations",
      colour: "#2563eb",
      cards: [
        { title: "Operations Dashboard", subtitle: "Production, dispatch, stock, machines", href: "/dashboard", icon: "🏭", badge: badges.operations },
        { title: "Daily Entry", subtitle: "Log daily production and dispatch", href: "/production", icon: "📝" },
        { title: "Receivables", subtitle: "Track bills in progress", href: "/receivables", icon: "💰", badge: badges.receivables },
      ],
    },
    {
      title: "Finance",
      colour: "#16a34a",
      cards: [
        { title: "Unze Trading", subtitle: "Cash position, forecasts, budgets", href: "/finance/unze-trading", icon: "🏢", badge: badges.utplFinance },
        { title: "Imperial Footwear", subtitle: "Cash position, forecasts, budgets", href: "/finance/imperial", icon: "👟", badge: badges.ifplFinance },
        { title: "Opening Balances", subtitle: "Set starting balances for companies", href: "/opening-balances", icon: "💵" },
      ],
    },
    {
      title: "Tasks & Meetings",
      colour: "#d97706",
      cards: [
        { title: "Tasks", subtitle: "All tasks across departments", href: "/tasks", icon: "✅", badge: badges.tasks },
        { title: "Calendar", subtitle: "Tasks and deadlines view", href: "/calendar", icon: "📅", badge: badges.calendar },
        { title: "Meetings", subtitle: "Minutes, approvals, action items", href: "/meetings", icon: "🤝", badge: badges.meetings },
        { title: "My Minutes", subtitle: "Meeting minutes for HODs", href: "/my-minutes", icon: "📄", badge: badges.minutes },
        { title: "Recurring Tasks", subtitle: "Manage recurring task templates", href: "/recurring-tasks", icon: "🔄" },
      ],
    },
    {
      title: "Departments",
      colour: "#7c3aed",
      cards: [
        { title: "Audit", subtitle: "Internal audit tracking", href: "/department/audit", icon: "🔍", badge: badges.audit },
        { title: "HR", subtitle: "Human resources dashboard", href: "/department/hr", icon: "👥" },
        { title: "Taxation", subtitle: "Tax notices and compliance", href: "/department/taxation", icon: "📑" },
        { title: "Admin", subtitle: "Administration dashboard", href: "/department/admin", icon: "🏛️" },
      ],
    },
    {
      title: "Settings",
      colour: COLOURS.SLATE,
      cards: [
        { title: "Members", subtitle: "Team members, roles, department owners", href: "/members", icon: "👤", badge: badges.members },
        { title: "Exceptions", subtitle: "Exception management and alerts", href: "/exceptions", icon: "⚠️" },
        { title: "Audit Log", subtitle: "System activity trail", href: "/audit-log", icon: "📜" },
        { title: "My Profile", subtitle: "Your account and preferences", href: "/profile", icon: "⚙️" },
      ],
    },
  ];

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
        <PageHeader title="Dashboard" subtitle="Your command centre — everything at a glance" hideHome />

        {loading ? (
          <p style={{ color: COLOURS.SLATE }}>Loading...</p>
        ) : (
          groups.map((group) => (
            <div key={group.title} style={{ marginBottom: "20px" }}>
              <div style={{
                fontSize: "15px", fontWeight: 700, color: group.colour,
                padding: "6px 0", marginBottom: "8px",
                borderBottom: `2px solid ${group.colour}`,
                display: "flex", alignItems: "center", gap: "8px",
              }}>
                {group.title}
              </div>
              <div style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(220px, 1fr))",
                gap: "10px",
              }}>
                {group.cards.map((card) => (
                  <a
                    key={card.href}
                    href={card.href}
                    style={{
                      textDecoration: "none",
                      border: `1px solid ${COLOURS.BORDER}`,
                      borderRadius: "10px",
                      padding: "14px 16px",
                      backgroundColor: "white",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                      position: "relative",
                      overflow: "hidden",
                      borderTop: `3px solid ${group.colour}`,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLAnchorElement).style.boxShadow = "0 4px 16px rgba(0,0,0,0.1)";
                      (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(-2px)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLAnchorElement).style.boxShadow = "none";
                      (e.currentTarget as HTMLAnchorElement).style.transform = "none";
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      {showIcons && <span style={{ fontSize: "24px" }}>{card.icon}</span>}
                      {card.badge && (
                        <span style={{
                          fontSize: "11px", fontWeight: 700, color: "white",
                          backgroundColor: card.badge.color, borderRadius: "10px",
                          padding: "2px 8px", whiteSpace: "nowrap",
                        }}>
                          {card.badge.value}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>{card.title}</div>
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE, lineHeight: 1.4 }}>{card.subtitle}</div>
                  </a>
                ))}
              </div>
            </div>
          ))
        )}
      </main>
    </AuthWrapper>
  );
}
