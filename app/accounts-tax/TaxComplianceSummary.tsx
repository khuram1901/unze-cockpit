"use client";

import React from "react";
import { COLOURS, RADII } from "../lib/SharedUI";

type ScheduleStatus = "Not Started" | "In Progress" | "External Auditors" | "Completed";

interface TaxComplianceSummaryProps {
  scheduleEntries: Map<string, ScheduleStatus>;
  returnFilings: Map<string, boolean>;
  selectedYear: string;
  scheduleEntries2?: Map<string, ScheduleStatus>;
  returnFilings2?: Map<string, boolean>;
  selectedYear2?: string;
  onClick?: () => void;
}

function fiscalYearStart(year: string): number {
  return parseInt(year.split("-")[0], 10);
}

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
const QUARTERLY_STEPS_COUNT = 5;

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

function computeFilingRows(returnFilings: Map<string, boolean>, year: string) {
  const months = fiscalMonths(year);
  return RETURN_ROWS.map((rt) => {
    const periods = rt.frequency === "monthly" ? months : QUARTERS;
    const total = rt.entities.length * periods.length;
    let filed = 0;
    for (const ek of rt.entities) {
      for (const p of periods) {
        if (returnFilings.get(`${year}:${rt.key}:${ek}:${p}`) === true) filed++;
      }
    }
    return { label: rt.label, filed, total };
  });
}

function computeQuarterChips(scheduleEntries: Map<string, ScheduleStatus>, year: string) {
  return QUARTERS.map((q) => {
    const total = QUARTERLY_ENTITIES.length * QUARTERLY_STEPS_COUNT;
    let completed = 0;
    for (const ek of QUARTERLY_ENTITIES) {
      for (let i = 1; i <= QUARTERLY_STEPS_COUNT; i++) {
        if (scheduleEntries.get(`${year}:${q}:${i}:${ek}`) === "Completed") completed++;
      }
    }
    return { q, completed, total };
  });
}

export default function TaxComplianceSummary({
  scheduleEntries,
  returnFilings,
  selectedYear,
  scheduleEntries2,
  returnFilings2,
  selectedYear2,
  onClick,
}: TaxComplianceSummaryProps) {
  const { NAVY, GREEN, SLATE, AMBER, HAIRLINE, CARD, CARD_ALT, TRACK, SUCCESS_SOFT, WARNING_SOFT } = COLOURS;

  const hasTwoYears = !!(scheduleEntries2 && returnFilings2 && selectedYear2);

  const filingRows1 = computeFilingRows(returnFilings, selectedYear);
  const quarterChips1 = computeQuarterChips(scheduleEntries, selectedYear);

  const filingRows2 = hasTwoYears ? computeFilingRows(returnFilings2!, selectedYear2!) : [];
  const quarterChips2 = hasTwoYears ? computeQuarterChips(scheduleEntries2!, selectedYear2!) : [];

  const allFilingsFiled1 = filingRows1.every((r) => r.filed === r.total);
  const allScheduleDone1 = quarterChips1.every((c) => c.completed === c.total);
  const allFilingsFiled2 = hasTwoYears ? filingRows2.every((r) => r.filed === r.total) : true;
  const allScheduleDone2 = hasTwoYears ? quarterChips2.every((c) => c.completed === c.total) : true;
  const allClear = allFilingsFiled1 && allScheduleDone1 && allFilingsFiled2 && allScheduleDone2;

  function barColour(filed: number, total: number): string {
    if (filed === total) return GREEN;
    if (filed === 0) return SLATE;
    return AMBER;
  }

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

  const yearPill = (label: string): React.CSSProperties => ({
    fontSize: "11px",
    fontWeight: 600,
    color: SLATE,
    backgroundColor: CARD_ALT,
    borderRadius: RADII.PILL,
    padding: "2px 8px",
    whiteSpace: "nowrap" as const,
  });

  function ProgressBar({ filed, total }: { filed: number; total: number }) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1 }}>
        <div style={{ flex: 1, height: "6px", backgroundColor: TRACK, borderRadius: RADII.PILL, overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${total > 0 ? (filed / total) * 100 : 0}%`,
              backgroundColor: barColour(filed, total),
              borderRadius: RADII.PILL,
              transition: "width 0.3s",
            }}
          />
        </div>
        <span style={{ fontSize: "11px", color: SLATE, minWidth: "42px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
          {filed}/{total}
        </span>
      </div>
    );
  }

  function QuarterRow({ chips, year }: { chips: { q: string; completed: number; total: number }[]; year: string }) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
        <span style={{ ...yearPill(year), marginRight: "2px" }}>{year}</span>
        {chips.map(({ q, completed, total }) => (
          <div key={q} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
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
      </div>
    );
  }

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
      {/* ── Card header year pills ── */}
      {hasTwoYears && (
        <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
          <span style={yearPill(selectedYear)}>{selectedYear}</span>
          <span style={yearPill(selectedYear2!)}>{selectedYear2}</span>
        </div>
      )}

      {/* ── Section A: Return Filings ── */}
      <div style={kicker}>Return Filings</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {filingRows1.map((row, i) => (
          <div key={row.label}>
            <span style={{ fontSize: "12px", color: NAVY, fontWeight: 500, display: "block", marginBottom: hasTwoYears ? "4px" : "0" }}>
              {row.label}
            </span>
            {hasTwoYears ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={yearPill(selectedYear)}>{selectedYear}</span>
                  <ProgressBar filed={row.filed} total={row.total} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={yearPill(selectedYear2!)}>{selectedYear2}</span>
                  <ProgressBar filed={filingRows2[i].filed} total={filingRows2[i].total} />
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <ProgressBar filed={row.filed} total={row.total} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Divider ── */}
      <div style={{ borderTop: `1px solid ${HAIRLINE}`, margin: "14px 0" }} />

      {/* ── Section B: Accounts Schedule ── */}
      <div style={kicker}>Accounts Schedule</div>
      {hasTwoYears ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <QuarterRow chips={quarterChips1} year={selectedYear} />
          <QuarterRow chips={quarterChips2} year={selectedYear2!} />
          {onClick && (
            <span style={{ fontSize: "11px", color: SLATE, marginTop: "2px" }}>
              View Accounts (Tax) →
            </span>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {quarterChips1.map(({ q, completed, total }) => (
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
      )}
    </div>
  );
}
