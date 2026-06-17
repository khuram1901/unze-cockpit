"use client";

import React from "react";

// ─────────────────────────────────────────────────────────────────
// Shared design tokens — single source of truth for colours
// ─────────────────────────────────────────────────────────────────
export const COLOURS = {
  NAVY: "#1e293b",
  SLATE: "#64748b",
  BORDER: "#e2e8f0",
  LIGHT: "#f1f5f9",
  BG: "#f8fafc",
  GREEN: "#16a34a",
  AMBER: "#d97706",
  RED: "#dc2626",
  BLUE: "#0070f3",
  PURPLE: "#7c3aed",
};

// ─────────────────────────────────────────────────────────────────
// Status colour map — for tasks, exceptions, calendar, etc.
// ─────────────────────────────────────────────────────────────────
export function statusColor(status: string | null): string {
  if (!status) return COLOURS.SLATE;
  switch (status) {
    case "Completed":
    case "Closed":
    case "Approved":
    case "Resolved":
    case "Collected":
      return COLOURS.GREEN;
    case "Submitted":
    case "In Progress":
    case "Pending":
    case "Partially Working":
      return COLOURS.AMBER;
    case "Waiting Reply":
    case "Open":
    case "Down":
    case "Rejected":
      return COLOURS.RED;
    case "Cancelled":
      return "#888";
    default:
      return COLOURS.SLATE;
  }
}

export function priorityColor(priority: string | null): string {
  if (!priority) return COLOURS.BLUE;
  switch (priority) {
    case "Urgent":
    case "High":
      return COLOURS.RED;
    case "Medium":
    case "Normal":
      return COLOURS.BLUE;
    case "Low":
      return COLOURS.SLATE;
    default:
      return COLOURS.BLUE;
  }
}

// ─────────────────────────────────────────────────────────────────
// Reusable layout components
// ─────────────────────────────────────────────────────────────────
export function SectionTitle({ title }: { title: string }) {
  return (
    <h2
      style={{
        fontSize: "17px",
        fontWeight: 700,
        color: COLOURS.NAVY,
        margin: "20px 0 10px",
        paddingLeft: "9px",
        borderLeft: `3px solid ${COLOURS.NAVY}`,
      }}
    >
      {title}
    </h2>
  );
}

export function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div style={{ marginBottom: "16px" }}>
      <h1 style={{ fontSize: "24px", fontWeight: 800, color: COLOURS.NAVY, margin: 0 }}>
        {title}
      </h1>
      {subtitle && (
        <p style={{ color: COLOURS.SLATE, fontSize: "16px", marginTop: "5px" }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: string | null }) {
  const colour = statusColor(status);
  return (
    <span
      style={{
        fontSize: "14px",
        fontWeight: 700,
        padding: "3px 9px",
        borderRadius: "10px",
        color: "white",
        backgroundColor: colour,
        whiteSpace: "nowrap",
      }}
    >
      {status || "—"}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string | null }) {
  const colour = priorityColor(priority);
  return (
    <span
      style={{
        fontSize: "14px",
        fontWeight: 700,
        padding: "3px 9px",
        borderRadius: "10px",
        color: "white",
        backgroundColor: colour,
        whiteSpace: "nowrap",
      }}
    >
      {priority || "Normal"}
    </span>
  );
}

export function CountCard({
  label,
  value,
  color,
  sub,
}: {
  label: string;
  value: string | number;
  color: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        border: `1px solid ${COLOURS.BORDER}`,
        borderTop: `3px solid ${color}`,
        borderRadius: "7px",
        padding: "8px 10px",
        backgroundColor: "white",
      }}
    >
      <div
        style={{
          color: COLOURS.SLATE,
          fontSize: "15px",
          marginBottom: "2px",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "21px", fontWeight: 800, color }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {sub && (
        <div style={{ fontSize: "14px", color: COLOURS.SLATE, marginTop: "2px" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Traffic light — three-state status indicator
// ─────────────────────────────────────────────────────────────────
export type RAGStatus = "GREEN" | "AMBER" | "RED";

export function ragColour(status: RAGStatus): string {
  if (status === "GREEN") return COLOURS.GREEN;
  if (status === "AMBER") return COLOURS.AMBER;
  return COLOURS.RED;
}

export function TrafficLight({
  status,
  label,
  detail,
}: {
  status: RAGStatus;
  label: string;
  detail?: string;
}) {
  const colour = ragColour(status);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <span
        style={{
          width: "12px",
          height: "12px",
          borderRadius: "50%",
          backgroundColor: colour,
          flexShrink: 0,
          boxShadow: `0 0 4px ${colour}40`,
        }}
      />
      <div>
        <div style={{ fontSize: "16px", fontWeight: 700, color: colour }}>{label}</div>
        {detail && (
          <div style={{ fontSize: "14px", color: COLOURS.SLATE }}>{detail}</div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Shared table styles
// ─────────────────────────────────────────────────────────────────
export const tableHeaderStyle: React.CSSProperties = {
  textAlign: "left",
  borderBottom: `1px solid ${COLOURS.BORDER}`,
  padding: "6px 10px",
  fontSize: "15px",
  color: COLOURS.SLATE,
  fontWeight: 700,
};

export const tableCellStyle: React.CSSProperties = {
  borderBottom: `1px solid #f1f5f9`,
  padding: "7px 10px",
  fontSize: "16px",
};

export const tableCellBoldStyle: React.CSSProperties = {
  ...tableCellStyle,
  fontWeight: 700,
  color: COLOURS.NAVY,
};

// ─────────────────────────────────────────────────────────────────
// Shared form styles
// ─────────────────────────────────────────────────────────────────
export const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "16px",
  fontWeight: 600,
  color: COLOURS.NAVY,
  marginBottom: "10px",
};

export const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "8px 10px",
  marginTop: "3px",
  border: `1px solid ${COLOURS.BORDER}`,
  borderRadius: "6px",
  fontSize: "17px",
  boxSizing: "border-box",
};

export const primaryButtonStyle: React.CSSProperties = {
  backgroundColor: COLOURS.NAVY,
  color: "white",
  border: "none",
  borderRadius: "6px",
  padding: "10px 20px",
  fontSize: "17px",
  fontWeight: 700,
  cursor: "pointer",
};
