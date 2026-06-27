"use client";

import { useEffect, useState } from "react";
import AuthWrapper from "../lib/AuthWrapper";
import { supabase } from "../lib/supabase";
import { COLOURS, PageHeader } from "../lib/SharedUI";
import { useMobile } from "../lib/useMobile";
import { UTPL_COMPANY_ID, IFPL_COMPANY_ID } from "../lib/constants";
import { useUserCtx } from "../lib/useUserCtx";
import {
  PAGE_REGISTRY, GROUP_ORDER, GROUP_COLOURS,
  type PageCard,
} from "../lib/pageRegistry";
import {
  isAdminTier, isCEO as checkIsCEO, canViewFinance, canEditFinance, financeCompanies,
  canViewExecutiveDashboard, canViewOperations, canViewReceivables,
  canSeeAllTasks, canCreateAssignments, canReviewTasks,
  canManageRecurringTasks, canManageCalendarRequests, canSeeAllMinutes,
  canViewDepartment, canManageMembers, canAddMembers,
  canViewAuditLog, canViewExceptions, canImportExport,
  canAccessDailyEntry, isPA as checkIsPA,
  type UserCtx,
} from "../lib/permissions";

type Badge = { value: string; color: string };

const PERM_FUNC: Record<string, (ctx: UserCtx) => boolean> = {
  can_view_executive_dashboard: canViewExecutiveDashboard,
  can_view_operations_dashboard: canViewOperations,
  can_view_pa_dashboard: (c) => checkIsPA(c) || isAdminTier(c),
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
};

function isCardVisible(card: PageCard, ctx: UserCtx): boolean {
  const perms = ctx.overrides as Record<string, boolean | string | null> | null;

  if (card.permKey.startsWith("_")) return true;

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

export default function HomePage() {
  const isMobile = useMobile();
  const { ctx, loading: ctxLoading } = useUserCtx();
  const [badges, setBadges] = useState<Record<string, Badge>>({});
  const [badgesLoading, setBadgesLoading] = useState(true);

  useEffect(() => {
    async function loadBadges() {
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
      b.members = { value: `${(membersRes.data || []).length} members`, color: "#0f172a" };
      b.audit = { value: `${(auditsRes.data || []).length} open`, color: (auditsRes.data || []).length > 0 ? "#d97706" : COLOURS.GREEN };
      b.receivables = { value: `${(receivablesRes.data || []).length} active`, color: (receivablesRes.data || []).length > 0 ? "#d97706" : COLOURS.GREEN };

      setBadges(b);
      setBadgesLoading(false);
    }

    loadBadges();
  }, []);

  const loading = ctxLoading || badgesLoading;

  const visibleCards = ctx ? PAGE_REGISTRY.filter((card) => isCardVisible(card, ctx)) : [];

  const groups = GROUP_ORDER
    .map((groupName) => ({
      title: groupName,
      colour: GROUP_COLOURS[groupName] || COLOURS.SLATE,
      cards: visibleCards.filter((c) => c.group === groupName),
    }))
    .filter((g) => g.cards.length > 0);

  const showIcons = ctx ? !isAdminTier(ctx) || checkIsCEO(ctx) : true;

  return (
    <AuthWrapper>
      <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100vw", overflowX: "hidden" }}>
        <PageHeader title="Dashboard" subtitle="Your command centre — everything at a glance" hideHome />

        <div style={{
          backgroundColor: "white", border: `1px solid ${COLOURS.BORDER}`, borderLeft: `4px solid ${COLOURS.NAVY}`,
          borderRadius: "8px", padding: isMobile ? "12px 14px" : "14px 20px", marginBottom: "16px",
          fontSize: isMobile ? "13px" : "15px", color: COLOURS.NAVY, lineHeight: 1.7, fontStyle: "italic", fontWeight: 600,
        }}>
          &ldquo;Through service and sustainable business growth, we create opportunities that enhance the lifestyle of our employees, customers, and the community we operate in.&rdquo;
        </div>

        {loading ? (
          <HomeSkeleton isMobile={isMobile} />
        ) : groups.length === 0 ? (
          <div style={{
            border: `1px solid ${COLOURS.BORDER}`, borderRadius: "8px", padding: "40px 20px",
            backgroundColor: "white", textAlign: "center", color: COLOURS.SLATE,
          }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>🔒</div>
            <div style={{ fontSize: "16px", fontWeight: 600, color: COLOURS.NAVY, marginBottom: "4px" }}>No pages assigned</div>
            <div style={{ fontSize: "14px" }}>Contact your Admin to get access to dashboard sections.</div>
          </div>
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
                {group.cards.map((card) => {
                  const badge = card.badgeKey ? badges[card.badgeKey] : undefined;
                  return (
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
                        {badge && (
                          <span style={{
                            fontSize: "11px", fontWeight: 700, color: "white",
                            backgroundColor: badge.color, borderRadius: "10px",
                            padding: "2px 8px", whiteSpace: "nowrap",
                          }}>
                            {badge.value}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: "15px", fontWeight: 700, color: COLOURS.NAVY }}>{card.title}</div>
                      <div style={{ fontSize: "12px", color: COLOURS.SLATE, lineHeight: 1.4 }}>{card.subtitle}</div>
                    </a>
                  );
                })}
              </div>
            </div>
          ))
        )}

        <div style={{ textAlign: "center", color: COLOURS.SLATE, fontSize: "12px", marginTop: "20px", paddingBottom: "10px" }}>
          © Unze Group 1989–2026 · v3.0 · All Rights Reserved
        </div>
      </main>
    </AuthWrapper>
  );
}

function SkeletonPulse({ width, height, borderRadius = "6px", style }: { width: string; height: string; borderRadius?: string; style?: React.CSSProperties }) {
  return (
    <div style={{
      width, height, borderRadius,
      background: "linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%)",
      backgroundSize: "200% 100%",
      animation: "shimmer 1.5s ease-in-out infinite",
      ...style,
    }} />
  );
}

function SkeletonCard() {
  return (
    <div style={{
      border: `1px solid ${COLOURS.BORDER}`, borderRadius: "10px",
      borderTop: `3px solid ${COLOURS.BORDER}`,
      padding: "14px 16px", backgroundColor: "white",
      display: "flex", flexDirection: "column", gap: "8px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <SkeletonPulse width="28px" height="28px" borderRadius="6px" />
        <SkeletonPulse width="70px" height="20px" borderRadius="10px" />
      </div>
      <SkeletonPulse width="65%" height="16px" />
      <SkeletonPulse width="90%" height="12px" />
    </div>
  );
}

function HomeSkeleton({ isMobile }: { isMobile: boolean }) {
  const groups = [
    { width: "140px", cards: 3 },
    { width: "90px", cards: 4 },
    { width: "110px", cards: 5 },
  ];

  return (
    <>
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      {groups.map((g, gi) => (
        <div key={gi} style={{ marginBottom: "20px" }}>
          <div style={{ paddingBottom: "8px", marginBottom: "8px", borderBottom: `2px solid ${COLOURS.BORDER}` }}>
            <SkeletonPulse width={g.width} height="16px" />
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(220px, 1fr))",
            gap: "10px",
          }}>
            {Array.from({ length: g.cards }).map((_, ci) => (
              <SkeletonCard key={ci} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
