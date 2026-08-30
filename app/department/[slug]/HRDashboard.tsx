"use client";

import { useState } from "react";
import { COLOURS, RADII, PageHeader } from "../../lib/SharedUI";
import { useMobile } from "../../lib/useMobile";
import { useUserCtx } from "../../lib/useUserCtx";
import { widgetVisible } from "../../lib/permissions";
import HRPeople from "./hr/HRPeople";
import HRPayrollInsights from "./hr/HRPayrollInsights";
import HRMovement from "./hr/HRMovement";
import HRAttendance from "./hr/HRAttendance";
import HRTraining from "./hr/HRTraining";
import HRTasks from "./hr/HRTasks";
import HRLegal from "./hr/HRLegal";
import HRFlowData from "./hr/HRFlowData";

// ─── Tab definitions ────────────────────────────────────────────────────────
// CEO-level 7-tab layout (30/08/2026). Old tabs backed by permanently-empty
// tables (Workforce, Insights, Performance, Recruitment, On/Off-boarding,
// EOBI, OD) removed — live data now comes from FlowHCM via master tables.
const ALL_HR_TABS = [
  { key: "people",     label: "People",             widgetKey: "hr_tabs.people" },
  { key: "payroll",    label: "Payroll",            widgetKey: "hr_tabs.payroll" },
  { key: "movement",   label: "Workforce Movement", widgetKey: "hr_tabs.movement" },
  { key: "attendance", label: "Attendance",         widgetKey: "hr_tabs.attendance" },
  { key: "td",         label: "T&D Calendar",       widgetKey: "hr_tabs.td" },
  { key: "taskslegal", label: "Tasks & Legal",      widgetKey: "hr_tabs.tasks" },
  { key: "flowdata",   label: "Live HR Data",       widgetKey: "hr_tabs.flowdata" },
] as const;

type HRTab = (typeof ALL_HR_TABS)[number]["key"];

// ─── Main dashboard ─────────────────────────────────────────────────────────
export default function HRDashboard() {
  const isMobile = useMobile();
  const { ctx } = useUserCtx();
  const [activeTab, setActiveTab] = useState<HRTab>("people");

  // Filter tabs based on per-member widget visibility settings (default: show all)
  const HR_TABS = ALL_HR_TABS.filter((t) =>
    !ctx || widgetVisible(ctx, t.widgetKey, true)
  );

  // If the active tab was hidden, fall back to the first visible tab
  const safeTab = (HR_TABS.some((t) => t.key === activeTab)
    ? activeTab
    : HR_TABS[0]?.key ?? "people") as HRTab;

  const tabBarStyle: React.CSSProperties = {
    display: "flex",
    gap: "0",
    overflowX: "auto",
    borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
    marginBottom: "16px",
    WebkitOverflowScrolling: "touch",
    scrollbarWidth: "none",
  };

  const tabStyle = (key: HRTab): React.CSSProperties => ({
    padding: isMobile ? "8px 12px" : "9px 16px",
    fontSize: "13px",
    fontWeight: 500,
    color: safeTab === key ? COLOURS.NAVY : COLOURS.SLATE,
    background: "none",
    border: "none",
    borderBottom: safeTab === key ? `2px solid ${COLOURS.NAVY}` : "2px solid transparent",
    cursor: "pointer",
    whiteSpace: "nowrap",
    marginBottom: "-1px",
    transition: "color 0.15s",
  });

  return (
    <main style={{ padding: isMobile ? "12px 14px" : "20px 24px", maxWidth: "100%", overflowX: "hidden" }}>
      <PageHeader />

      {/* Tab strip */}
      <div style={tabBarStyle}>
        {HR_TABS.map((t) => (
          <button key={t.key} style={tabStyle(t.key)} onClick={() => setActiveTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {safeTab === "people"     && <HRPeople />}
      {safeTab === "payroll"    && <HRPayrollInsights />}
      {safeTab === "movement"   && <HRMovement />}
      {safeTab === "attendance" && <HRAttendance />}
      {safeTab === "td"         && <HRTraining />}
      {safeTab === "taskslegal" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <HRTasks />
          <HRLegal />
        </div>
      )}
      {safeTab === "flowdata"   && <HRFlowData />}
    </main>
  );
}
