"use client";

import { useState } from "react";
import { COLOURS } from "./SharedUI";

type Escalation = {
  plantId: string;
  plantName: string;
  metric: "Production" | "Dispatch" | "Breakage";
  detail: string;
  sourceLabel: string;
};

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
          border: `1px solid ${COLOURS.HAIRLINE}`,
          borderLeft: `4px solid ${COLOURS.GREEN}`,
          borderRadius: "6px",
          padding: "10px 14px",
          backgroundColor: COLOURS.CARD,
          fontSize: "15px",
          color: COLOURS.NAVY,
          marginBottom: "14px",
        }}
      >
        No active escalations. All tracked metrics are within tolerance.
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
                border: `1px solid ${COLOURS.HAIRLINE}`,
                borderTop: `3px solid ${isRed ? COLOURS.RED : COLOURS.GREEN}`,
                borderRadius: "7px",
                backgroundColor: isActive ? COLOURS.CARD_ALT : COLOURS.CARD,
                cursor: count === 0 ? "default" : "pointer",
                textAlign: "left",
                opacity: count === 0 ? 0.6 : 1,
              }}
            >
              <div
                style={{
                  color: COLOURS.SLATE,
                  fontSize: "13px",
                  marginBottom: "4px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  fontWeight: 500,
                }}
              >
                {metric}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-display, 'Inter Tight', sans-serif)",
                  fontSize: "28px",
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: isRed ? COLOURS.RED : COLOURS.GREEN,
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
            border: `1px solid ${COLOURS.HAIRLINE}`,
            borderRadius: "8px",
            backgroundColor: COLOURS.CARD,
            marginTop: "8px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "8px 12px",
              backgroundColor: COLOURS.CARD_ALT,
              borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
              fontSize: "13px",
              fontWeight: 600,
              color: COLOURS.NAVY,
            }}
          >
            {openMetric} escalations ({selected.length})
          </div>
          {selected.map((e, i) => (
            <div
              key={e.sourceLabel}
              style={{
                padding: "10px 12px",
                borderTop: i === 0 ? "none" : `1px solid ${COLOURS.HAIRLINE}`,
              }}
            >
              <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>
                {e.plantName}
              </div>
              <div style={{ fontSize: "13px", color: COLOURS.SLATE, marginTop: "2px" }}>
                {e.detail}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
