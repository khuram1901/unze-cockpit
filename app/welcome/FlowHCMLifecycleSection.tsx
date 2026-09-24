"use client";

import Link from "next/link";
import { COLOURS, RADII } from "../lib/SharedUI";

const { NAVY, SLATE, HAIRLINE, GREEN, AMBER, RED, INK_400, INK_700, CARD_ALT } = COLOURS;
const AMBER_SOFT  = "#FBF1DE";
const RED_SOFT    = "#F8E4E2";
const GREEN_SOFT  = "#E6F4EF";
const SLATE_SOFT  = "#F1F3F5";

type Props = {
  leaverCount:      number;   // leaver_flagged distinct members (last 30d)
  deactivatedCount: number;   // deactivated distinct members (last 30d)
  exemptCount:      number;   // left_but_exempt active members (last 30d)
  ambiguousCount:   number;   // manager_ambiguous distinct members (last 7d)
};

export default function FlowHCMLifecycleSection({
  leaverCount,
  deactivatedCount,
  exemptCount,
  ambiguousCount,
}: Props) {
  const total = leaverCount + deactivatedCount + exemptCount + ambiguousCount;
  if (total === 0) return null;

  const rows: { label: string; value: number; bg: string; fg: string; description: string }[] = [];

  if (leaverCount > 0) {
    rows.push({
      label: "Possible leavers flagged",
      value: leaverCount,
      bg: RED_SOFT,
      fg: RED,
      description: "FlowHCM shows these employees may have left — review and handle task handover.",
    });
  }
  if (deactivatedCount > 0) {
    rows.push({
      label: "Deactivated this month",
      value: deactivatedCount,
      bg: RED_SOFT,
      fg: RED,
      description: "Members deactivated after FlowHCM leaver detection.",
    });
  }
  if (exemptCount > 0) {
    rows.push({
      label: "Exempt leavers (active)",
      value: exemptCount,
      bg: AMBER_SOFT,
      fg: AMBER,
      description: "FlowHCM shows as left but accounts are lifecycle-exempt — verify still employed.",
    });
  }
  if (ambiguousCount > 0) {
    rows.push({
      label: "Ambiguous manager matches",
      value: ambiguousCount,
      bg: AMBER_SOFT,
      fg: AMBER,
      description: "FlowHCM manager name matches multiple app members — assign manager_id in app.",
    });
  }

  const urgentCount = leaverCount + deactivatedCount;

  return (
    <div style={{ padding: "0 40px 24px" }}>
      <div style={{
        background: CARD_ALT,
        border: `1px solid ${urgentCount > 0 ? "#e8b4b2" : "#e8d4a2"}`,
        borderRadius: RADII.CARD,
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "14px 20px 12px",
          borderBottom: `1px solid ${HAIRLINE}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          background: urgentCount > 0 ? "#fff8f7" : "#fffdf5",
        }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 15 }}>🔄</span>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: NAVY, margin: 0 }}>
                FlowHCM Lifecycle Monitor
              </h3>
              <span style={{
                fontSize: 11, fontWeight: 700,
                background: urgentCount > 0 ? RED : AMBER,
                color: "#fff",
                padding: "1px 8px",
                borderRadius: 20,
              }}>
                {total} alert{total !== 1 ? "s" : ""}
              </span>
            </div>
            <p style={{ fontSize: 11, color: INK_400, margin: "3px 0 0 23px" }}>
              Admin-only · data synced from FlowHCM payroll system
            </p>
          </div>
          <Link
            href="/members"
            style={{
              fontSize: 12, fontWeight: 700,
              color: urgentCount > 0 ? RED : AMBER,
              textDecoration: "none",
              whiteSpace: "nowrap",
              padding: "6px 14px",
              border: `1px solid ${urgentCount > 0 ? "#e8b4b2" : "#e8d4a2"}`,
              borderRadius: RADII.PILL,
              background: urgentCount > 0 ? RED_SOFT : AMBER_SOFT,
            }}
          >
            Review in Members →
          </Link>
        </div>

        {/* Rows */}
        <div style={{ padding: "4px 20px 8px" }}>
          {rows.map(row => (
            <div
              key={row.label}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                padding: "12px 0",
                borderBottom: `1px solid ${HAIRLINE}`,
              }}
            >
              <span style={{
                minWidth: 36, height: 36,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: row.bg,
                borderRadius: 8,
                fontFamily: "var(--font-display,'Inter Tight',sans-serif)",
                fontWeight: 800, fontSize: 17, color: row.fg,
              }}>
                {row.value}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: INK_700, marginBottom: 2 }}>
                  {row.label}
                </div>
                <div style={{ fontSize: 11.5, color: SLATE, lineHeight: 1.45 }}>
                  {row.description}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer CTA */}
        <div style={{ padding: "10px 20px 14px", display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link
            href="/members"
            style={{
              fontSize: 12, fontWeight: 600, color: NAVY,
              textDecoration: "none", padding: "6px 14px",
              border: `1px solid ${HAIRLINE}`, borderRadius: RADII.PILL,
              background: SLATE_SOFT,
            }}
          >
            Open Members Manager →
          </Link>
          {leaverCount > 0 && (
            <span style={{ fontSize: 11.5, color: SLATE, padding: "7px 0", lineHeight: 1.4 }}>
              Leaver task handover: go to Members → select person → Handover Tasks
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
