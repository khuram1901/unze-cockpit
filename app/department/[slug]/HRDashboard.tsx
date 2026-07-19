"use client";

import { useState } from "react";
import { COLOURS, RADII, PageHeader } from "../../lib/SharedUI";
import { useMobile } from "../../lib/useMobile";
import HRRecruitment from "./hr/HRRecruitment";
import HROnboarding from "./hr/HROnboarding";
import HROffboarding from "./hr/HROffboarding";
import HRPayroll from "./hr/HRPayroll";
import HREobi from "./hr/HREobi";
import HRTraining from "./hr/HRTraining";
import HRTasks from "./hr/HRTasks";

// ─── Tab definitions ────────────────────────────────────────────────────────
const HR_TABS = [
  { key: "recruitment",  label: "Recruitment" },
  { key: "onboarding",   label: "Onboarding" },
  { key: "offboarding",  label: "Off-boarding" },
  { key: "payroll",      label: "Payroll" },
  { key: "eobi",         label: "EOBI & Social Security" },
  { key: "od",           label: "OD Interventions" },
  { key: "td",           label: "T&D Calendar" },
  { key: "tasks",        label: "HR Tasks" },
] as const;

type HRTab = (typeof HR_TABS)[number]["key"];

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
  const [activeTab, setActiveTab] = useState<HRTab>("recruitment");

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
    color: activeTab === key ? COLOURS.NAVY : COLOURS.SLATE,
    background: "none",
    border: "none",
    borderBottom: activeTab === key ? `2px solid ${COLOURS.NAVY}` : "2px solid transparent",
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
      {activeTab === "recruitment"  && <HRRecruitment />}
      {activeTab === "onboarding"   && <HROnboarding />}
      {activeTab === "offboarding"  && <HROffboarding />}
      {activeTab === "payroll"      && <HRPayroll />}
      {activeTab === "eobi"         && <HREobi />}
      {activeTab === "od"           && <ComingSoon label="OD Interventions" />}
      {activeTab === "td"           && <HRTraining />}
      {activeTab === "tasks"        && <HRTasks />}
    </main>
  );
}
