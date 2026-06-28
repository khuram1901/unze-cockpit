"use client";

import { useState } from "react";

type Escalation = {
  plantId: string;
  plantName: string;
  metric: "Production" | "Dispatch" | "Breakage";
  detail: string;
  sourceLabel: string;
};

const NAVY = "var(--text-primary, #1e293b)";
const SLATE = "var(--text-secondary, #64748b)";
const BORDER = "var(--border-color, #e2e8f0)";

const METRICS: Escalation["metric"][] = ["Production", "Dispatch", "Breakage"];

export default function EscalationTrafficLights({
  escalations,
}: {
  escalations: Escalation[];
}) {
  const [openMetric, setOpenMetric] = useState<Escalation["metric"] | null>(null);

  const countFor = (metric: Escalation["metric"]) =>
    escalations.filter((e) => e.metric === metric).length;

  const selected =
    openMetric === null ? [] : escalations.filter((e) => e.metric === openMetric);

  if (escalations.length === 0) {
    return (
      <div
        style={{
          border: `1px solid ${BORDER}`,
          borderLeft: "4px solid #16a34a",
          borderRadius: "6px",
          padding: "10px 14px",
          backgroundColor: "var(--bg-card, #ffffff)",
          fontSize: "17px",
          color: NAVY,
          marginBottom: "14px",
        }}
      >
        No active executive escalations. All tracked metrics are within tolerance.
      </div>
    );
  }

  return (
    <div style={{ marginBottom: "14px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
          gap: "8px",
        }}
      >
        {METRICS.map((metric) => {
          const count = countFor(metric);
          const isRed = count > 0;
          const isActive = openMetric === metric;
          return (
            <button
              key={metric}
              onClick={() => setOpenMetric(isActive ? null : metric)}
              disabled={count === 0}
              style={{
                minWidth: "100px",
                padding: "8px 10px",
                border: `1px solid ${BORDER}`,
                borderTop: `3px solid ${isRed ? "#dc2626" : "#16a34a"}`,
                borderRadius: "7px",
                backgroundColor: isActive ? "var(--bg-card-hover, #f8fafc)" : "var(--bg-card, #ffffff)",
                cursor: count === 0 ? "default" : "pointer",
                textAlign: "left",
                opacity: count === 0 ? 0.6 : 1,
              }}
            >
              <div
                style={{
                  color: SLATE,
                  fontSize: "15px",
                  marginBottom: "2px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {metric}
              </div>
              <div
                style={{
                  fontSize: "19px",
                  fontWeight: 800,
                  color: isRed ? "#dc2626" : "#16a34a",
                }}
              >
                {count}
              </div>
            </button>
          );
        })}
      </div>

      {openMetric !== null && selected.length > 0 && (
        <div
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: "8px",
            backgroundColor: "var(--bg-card, #ffffff)",
            marginTop: "8px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "8px 12px",
              backgroundColor: "var(--bg-card-hover, #f8fafc)",
              borderBottom: `1px solid ${BORDER}`,
              fontSize: "16px",
              fontWeight: 700,
              color: NAVY,
            }}
          >
            {openMetric} escalations ({selected.length})
          </div>
          {selected.map((e, i) => (
            <div
              key={e.sourceLabel}
              style={{
                padding: "9px 12px",
                borderTop: i === 0 ? "none" : `1px solid ${BORDER}`,
              }}
            >
              <div style={{ fontSize: "17px", fontWeight: 700, color: NAVY }}>
                {e.plantName}
              </div>
              <div style={{ fontSize: "16px", color: SLATE, marginTop: "2px" }}>
                {e.detail}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
