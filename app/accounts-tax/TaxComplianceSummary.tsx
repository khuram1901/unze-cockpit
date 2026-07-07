"use client";

import React from "react";
import { COLOURS, RADII } from "../lib/SharedUI";

type ScheduleStatus = "Not Started" | "In Progress" | "External Auditors" | "Completed";

interface TaxComplianceSummaryProps {
  scheduleEntries: Map<string, ScheduleStatus>;
  returnFilings: Map<string, boolean>;
  selectedYear: string;
  onClick?: () => void;
}

// Fiscal year start calendar year derived from "2025-26" → 2025
function fiscalYearStart(year: string): number {
  return parseInt(year.split("-")[0], 10);
}

// All 12 months of a fiscal year (Jul–Jun)
function fiscalMonths(year: string): string[] {
  const s = fiscalYearStart(year);
  const n = s + 1;
  return [
    `${s}-07`, `${s}-08`, `${s}-09`,
    `${s}-10`, `${s}-11`, `${s}-12`,
    `${n}-01`, `${n}-02`, `${n}-03`,
    `${n}-04`, `${n}-05`, `${n}-06`,
  ];
}

const QUARTERLY_ENTITIES = ["UT", "IMP", "BARANH", "HD", "ALMAHAR"];
const QUARTERLY_STEPS_COUNT = 5; // steps 1–5

const RETURN_ROWS = [
  {
    key: "FBR_SALES_TAX" as const,
    label: "FBR Sales Tax",
    entities: ["UT", "IMP", "ALMAHAR"],
    frequency: "monthly" as const,
  },
  {
    key: "PRA_TAX" as const,
    label: "PRA Tax",
    entities: ["UT", "IMP", "BARANH", "HD", "ALMAHAR"],
    frequency: "monthly" as const,
  },
  {
    key: "INCOME_TAX" as const,
    label: "Income Tax",
    entities: ["UT", "IMP", "BARANH", "HD", "ALMAHAR"],
    frequency: "quarterly" as const,
  },
];

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;

export default function TaxComplianceSummary({
  scheduleEntries,
  returnFilings,
  selectedYear,
  onClick,
}: TaxComplianceSummaryProps) {
  const { NAVY, GREEN, SLATE, AMBER, HAIRLINE, CARD, CARD_ALT, TRACK, SUCCESS_SOFT, WARNING_SOFT } = COLOURS;

  const months = fiscalMonths(selectedYear);

  // ── Return filing counts ──
  const filingRows = RETURN_ROWS.map((rt) => {
    const periods = rt.frequency === "monthly" ? months : QUARTERS;
    const total = rt.entities.length * periods.length;
    let filed = 0;
    for (const ek of rt.entities) {
      for (const p of periods) {
        if (returnFilings.get(`${selectedYear}:${rt.key}:${ek}:${p}`) === true) filed++;
      }
    }
    return { label: rt.label, filed, total };
  });

  // ── Schedule quarter completion ──
  const quarterChips = QUARTERS.map((q) => {
    const total = QUARTERLY_ENTITIES.length * QUARTERLY_STEPS_COUNT; // 25
    let completed = 0;
    for (const ek of QUARTERLY_ENTITIES) {
      for (let i = 1; i <= QUARTERLY_STEPS_COUNT; i++) {
        const status = scheduleEntries.get(`${selectedYear}:${q}:${i}:${ek}`);
        if (status === "Completed") completed++;
      }
    }
    return { q, completed, total };
  });

  // ── All-clear detection (for green border on Executive Dashboard) ──
  const allFilingsFiled = filingRows.every((r) => r.filed === r.total);
  const allScheduleDone = quarterChips.every((c) => c.completed === c.total);
  const allClear = allFilingsFiled && allScheduleDone;

  // ── Progress bar fill colour ──
  function barColour(filed: number, total: number): string {
    if (filed === total) return GREEN;
    if (filed === 0) return SLATE;
    return AMBER;
  }

  // ── Quarter chip style ──
  function chipStyle(completed: number, total: number): React.CSSProperties {
    if (completed === total) {
      return { backgroundColor: SUCCESS_SOFT, color: GREEN, border: `1px solid #9ED4A3` };
    }
    if (completed === 0) {
      return { backgroundColor: CARD_ALT, color: SLATE, border: `1px solid ${HAIRLINE}` };
    }
    return { backgroundColor: WARNING_SOFT, color: AMBER, border: `1px solid #F6D28A` };
  }

  function chipLabel(completed: number, total: number): string {
    if (completed === total) return "✓ Done";
    if (completed === 0) return "—";
    return `⚠ ${completed}/${total}`;
  }

  const kicker: React.CSSProperties = {
    fontSize: "10.5px",
    fontWeight: 600,
    color: SLATE,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginBottom: "10px",
    fontFamily: "var(--font-sans, Inter, sans-serif)",
  };

  return (
    <div
      onClick={onClick}
      style={{
        border: `1px solid ${HAIRLINE}`,
        borderTop: `3px solid ${allClear ? GREEN : NAVY}`,
        borderRadius: RADII.CARD,
        padding: "16px 20px",
        backgroundColor: CARD,
        cursor: onClick ? "pointer" : "default",
        marginBottom: "20px",
        fontFamily: "var(--font-sans, Inter, sans-serif)",
      }}
    >
      {/* ── Section A: Return Filings ── */}
      <div style={kicker}>Return Filings</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {filingRows.map((row) => (
          <div key={row.label} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "12px", color: NAVY, fontWeight: 500, minWidth: "110px", flexShrink: 0 }}>
              {row.label}
            </span>
            <div style={{ flex: 1, height: "6px", backgroundColor: TRACK, borderRadius: RADII.PILL, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${row.total > 0 ? (row.filed / row.total) * 100 : 0}%`,
                  backgroundColor: barColour(row.filed, row.total),
                  borderRadius: RADII.PILL,
                  transition: "width 0.3s",
                }}
              />
            </div>
            <span style={{ fontSize: "11px", color: SLATE, minWidth: "42px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {row.filed}/{row.total}
            </span>
          </div>
        ))}
      </div>

      {/* ── Divider ── */}
      <div style={{ borderTop: `1px solid ${HAIRLINE}`, margin: "14px 0" }} />

      {/* ── Section B: Accounts Schedule ── */}
      <div style={kicker}>Accounts Schedule</div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {quarterChips.map(({ q, completed, total }) => (
          <div key={q} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <span style={{ fontSize: "11px", fontWeight: 600, color: SLATE }}>{q}</span>
            <span
              style={{
                ...chipStyle(completed, total),
                fontSize: "11px",
                fontWeight: 600,
                padding: "3px 9px",
                borderRadius: RADII.PILL,
                whiteSpace: "nowrap",
              }}
            >
              {chipLabel(completed, total)}
            </span>
          </div>
        ))}
        {onClick && (
          <span style={{ fontSize: "11px", color: SLATE, alignSelf: "center", marginLeft: "auto" }}>
            View Accounts (Tax) →
          </span>
        )}
      </div>
    </div>
  );
}
