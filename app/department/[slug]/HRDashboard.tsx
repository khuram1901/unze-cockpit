"use client";

import { useState } from "react";
import { COLOURS, RADII, PageHeader } from "../../lib/SharedUI";
import { useMobile } from "../../lib/useMobile";
import { useUserCtx } from "../../lib/useUserCtx";
import { widgetVisible } from "../../lib/permissions";
import HRRecruitment from "./hr/HRRecruitment";
import HROnboarding from "./hr/HROnboarding";
import HROffboarding from "./hr/HROffboarding";
import HRPayroll from "./hr/HRPayroll";
import HREobi from "./hr/HREobi";
import HRTraining from "./hr/HRTraining";
import HRTasks from "./hr/HRTasks";
import HRWorkforce from "./hr/HRWorkforce";
import HRInsights from "./hr/HRInsights";
import HRLegal from "./hr/HRLegal";
import HRPerformance from "./hr/HRPerformance";
import HRFlowData from "./hr/HRFlowData";

// ─── Tab definitions ────────────────────────────────────────────────────────
const ALL_HR_TABS = [
  { key: "workforce",   label: "Workforce",              widgetKey: "hr_tabs.workforce" },
  { key: "insights",    label: "HR Insights",            widgetKey: "hr_tabs.insights" },
  { key: "performance", label: "Performance",            widgetKey: "hr_tabs.performance" },
  { key: "recruitment", label: "Recruitment",            widgetKey: "hr_tabs.recruitment" },
  { key: "onboarding",  label: "Onboarding",             widgetKey: "hr_tabs.onboarding" },
  { key: "offboarding", label: "Off-boarding",           widgetKey: "hr_tabs.offboarding" },
  { key: "payroll",     label: "Payroll",                widgetKey: "hr_tabs.payroll" },
  { key: "eobi",        label: "EOBI & Social Security", widgetKey: "hr_tabs.eobi" },
  { key: "od",          label: "OD Interventions",       widgetKey: "hr_tabs.od" },
  { key: "td",          label: "T&D Calendar",           widgetKey: "hr_tabs.td" },
  { key: "tasks",       label: "HR Tasks",               widgetKey: "hr_tabs.tasks" },
  { key: "legal",       label: "Legal Cases",            widgetKey: "hr_tabs.legal" },
  { key: "flowdata",    label: "Live HR Data",           widgetKey: "hr_tabs.flowdata" },
] as const;

type HRTab = (typeof ALL_HR_TABS)[number]["key"];

// ─── Placeholder for tabs not yet built ─────────────────────────────────────
function ComingSoon({ label }: { label: string }) {
  return (
    <div style={{
      border: `1px solid ${COLOURS.HAIRLINE}`,
      borderRadius: RADII.CARD,
      padding: "40px 24px",
      textAlign: "center",
      backgroundColor: COLOURS.CARD,
      color: COLOURS.SLATE,
      fontSize: "14px",
    }}>
      <div style={{ fontSize: "32px", marginBottom: "12px" }}>🚧</div>
      <div style={{ fontWeight: 600, color: COLOURS.NAVY, marginBottom: "6px" }}>{label}</div>
      <div>Coming soon — being built next.</div>
    </div>
  );
}

// ─── Main dashboard ─────────────────────────────────────────────────────────
export default function HRDashboard() {
  const isMobile = useMobile();
  const { ctx } = useUserCtx();
  const [activeTab, setActiveTab] = useState<HRTab>("workforce");

  // Filter tabs based on per-member widget visibility settings (default: show all)
  const HR_TABS = ALL_HR_TABS.filter((t) =>
    !ctx || widgetVisible(ctx, t.widgetKey, true)
  );

  // If the active tab was hidden, fall back to the first visible tab
  const safeTab = (HR_TABS.some((t) => t.key === activeTab)
    ? activeTab
    : HR_TABS[0]?.key ?? "workforce") as HRTab;

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
      {safeTab === "workforce"    && <HRWorkforce />}
      {safeTab === "insights"     && <HRInsights />}
      {safeTab === "recruitment"  && <HRRecruitment />}
      {safeTab === "onboarding"   && <HROnboarding />}
      {safeTab === "offboarding"  && <HROffboarding />}
      {safeTab === "payroll"      && <HRPayroll />}
      {safeTab === "eobi"         && <HREobi />}
      {safeTab === "od"           && <ComingSoon label="OD Interventions" />}
      {safeTab === "td"           && <HRTraining />}
      {safeTab === "tasks"        && <HRTasks />}
      {safeTab === "performance"  && <HRPerformance />}
      {safeTab === "legal"        && <HRLegal />}
      {safeTab === "flowdata"     && <HRFlowData />}
    </main>
  );
}
