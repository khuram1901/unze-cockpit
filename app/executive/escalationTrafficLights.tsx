"use client";

import { useState } from "react";

type Escalation = {
  plantId: string;
  plantName: string;
  metric: "Production" | "Dispatch" | "Breakage";
  detail: string;
  sourceLabel: string;
};

const NAVY = "#1e293b";
const SLATE = "#64748b";
const BORDER = "#e2e8f0";

const RED = { dot: "#dc2626", bg: "#fef2f2", border: "#fecaca", text: "#991b1b" };
const GREEN = { dot: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0", text: "#166534" };

const METRICS: Array<"Production" | "Dispatch" | "Breakage"> = [
  "Production",
  "Dispatch",
  "Breakage",
];

export default function EscalationTrafficLights({
  escalations,
}: {
  escalations: Escalation[];
}) {
  // which metric is expanded; null = collapsed, just tiles
  const [open, setOpen] = useState<"Production" | "Dispatch" | "Breakage" | null>(null);

  const byMetric = {
    Production: escalations.filter((e) => e.metric === "Production"),
    Dispatch: escalations.filter((e) => e.metric === "Dispatch"),
    Breakage: escalations.filter((e) => e.metric === "Breakage"),
  };

  function Tile({ metric }: { metric: "Production" | "Dispatch" | "Breakage" }) {
    const list = byMetric[metric];
    const hasIssues = list.length > 0;
    const c = hasIssues ? RED : GREEN;
    const isOpen = open === metric;

    return (
      <button
        onClick={() => (hasIssues ? setOpen(isOpen ? null : metric) : null)}
        style={{
          flex: 1,
          minWidth: "130px",
          cursor: hasIssues ? "pointer" : "default",
          backgroundColor: c.bg,
          border: `1px solid ${isOpen ? c.dot : c.border}`,
          borderRadius: "10px",
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          textAlign: "left",
          outline: isOpen ? `2px solid ${c.dot}` : "none",
        }}
      >
        <span
          style={{
            width: "14px",
            height: "14px",
            borderRadius: "50%",
            backgroundColor: c.dot,
            flexShrink: 0,
          }}
        />
        <span style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: "24px", fontWeight: 800, color: c.text, lineHeight: 1 }}>
            {list.length}
          </span>
          <span style={{ fontSize: "12px", fontWeight: 600, color: c.text }}>
            {metric}
          </span>
        </span>
      </button>
    );
  }

  return (
    <section style={{ marginBottom: "24px" }}>
      {/* Traffic-light tiles — always visible, just numbers + colour */}
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        {METRICS.map((m) => (
          <Tile key={m} metric={m} />
        ))}
      </div>

      {/* Drill-down — only when a tile with issues is clicked */}
      {open && byMetric[open].length > 0 && (
        <div
          style={{
            marginTop: "12px",
            border: `1px solid ${BORDER}`,
            borderRadius: "10px",
            overflow: "hidden",
          }}
        >
          {byMetric[open].map((e, i) => (
            <div
              key={e.sourceLabel}
              style={{
                display: "flex",
                gap: "12px",
                padding: "10px 14px",
                borderLeft: `4px solid ${RED.dot}`,
                borderBottom:
                  i < byMetric[open].length - 1 ? `1px solid ${BORDER}` : "none",
                backgroundColor: "white",
              }}
            >
              <span
                style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  backgroundColor: RED.dot,
                  flexShrink: 0,
                  marginTop: "4px",
                }}
              />
              <div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: NAVY }}>
                  {e.metric} lagging — {e.plantName}
                </div>
                <div style={{ fontSize: "12px", color: SLATE, marginTop: "2px" }}>
                  {e.detail} A task has been raised with the owner.
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
