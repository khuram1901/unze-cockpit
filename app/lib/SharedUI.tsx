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
  BLUE: "#2563eb",
  TEAL: "#059669",
  PURPLE: "#7c3aed",
};

export const RADII = { CARD: "12px", BUTTON: "8px", BADGE: "6px", PILL: "16px" };
export const SHADOWS = { CARD: "0 1px 3px rgba(15,23,42,0.06)", ELEVATED: "0 4px 12px rgba(15,23,42,0.08)", DROPDOWN: "0 8px 30px rgba(15,23,42,0.12)" };

export function displayRole(role: string, email?: string | null): string {
  if (email === "k.saleem@unzegroup.com") return "CEO";
  return role;
}

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
    case "In Progress":
    case "Pending":
    case "Partially Working":
      return COLOURS.AMBER;
    case "Submitted":
      return COLOURS.BLUE;
    case "Waiting Reply":
    case "Open":
    case "Down":
    case "Rejected":
      return COLOURS.RED;
    case "Cancelled":
      return COLOURS.SLATE;
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
        color: "var(--text-primary, #1e293b)",
        margin: "20px 0 10px",
        paddingLeft: "9px",
        borderLeft: "3px solid var(--text-primary, #1e293b)",
      }}
    >
      {title}
    </h2>
  );
}

export function PageHeader({ hideHome }: { hideHome?: boolean } = {}) {
  if (hideHome) return null;
  return (
    <div style={{ marginBottom: "8px" }}>
      <a href="/home" style={{
        display: "inline-flex", alignItems: "center", gap: "6px",
        fontSize: "15px", fontWeight: 600, color: "var(--text-primary, #1e293b)", textDecoration: "none",
        padding: "5px 12px 5px 8px",
        borderRadius: "16px", backgroundColor: "var(--bg-card-hover, #f1f5f9)",
        border: "1px solid var(--border-color, #e2e8f0)", cursor: "pointer",
        transition: "background-color 0.15s",
      }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "var(--border-color, #e2e8f0)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "var(--bg-card-hover, #f1f5f9)"; }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 12L6 8l4-4" />
        </svg>
        Home
      </a>
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
        border: "1px solid var(--border-color, #e2e8f0)",
        borderTop: `3px solid ${color}`,
        borderRadius: "8px",
        padding: "8px 10px",
        backgroundColor: "var(--bg-card, #ffffff)",
      }}
    >
      <div
        style={{
          color: "var(--text-secondary, #64748b)",
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
        <div style={{ fontSize: "14px", color: "var(--text-secondary, #64748b)", marginTop: "2px" }}>
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
          <div style={{ fontSize: "14px", color: "var(--text-secondary, #64748b)" }}>{detail}</div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Data freshness badge — shows how recent the data is
// ─────────────────────────────────────────────────────────────────
export function FreshnessBadge({ date, label }: { date: string | null; label?: string }) {
  if (!date) return null;
  const now = new Date();
  const dataDate = new Date(date + (date.length <= 10 ? "T00:00:00" : ""));
  const diffMs = now.getTime() - dataDate.getTime();
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  let text: string;
  let color: string;
  if (diffDays === 0) {
    text = diffHours <= 1 ? "Just now" : `${diffHours}h ago`;
    color = COLOURS.GREEN;
  } else if (diffDays === 1) {
    text = "Yesterday";
    color = COLOURS.GREEN;
  } else if (diffDays <= 3) {
    text = `${diffDays}d ago`;
    color = COLOURS.AMBER;
  } else {
    text = `${diffDays}d ago`;
    color = COLOURS.RED;
  }

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "4px",
      fontSize: "12px", fontWeight: 600, color,
      padding: "2px 8px", borderRadius: "8px",
      backgroundColor: `${color}10`,
    }}>
      <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: color }} />
      {label ? `${label}: ${text}` : text}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────
// Warning / alert banner wrapper
// ─────────────────────────────────────────────────────────────────
export const WARNING_BANNER_STYLE: React.CSSProperties = {
  border: "1px solid #fecaca",
  borderLeft: "4px solid #dc2626",
  borderRadius: "8px",
  backgroundColor: "#fef2f2",
  overflow: "hidden",
  marginBottom: "14px",
};

export const WARNING_BANNER_INNER: React.CSSProperties = {
  borderTop: "1px solid #fecaca",
  backgroundColor: "var(--bg-card, #ffffff)",
};

export const WARNING_TITLE_COLOR = "#991b1b";

// ─────────────────────────────────────────────────────────────────
// Shared table styles
// ─────────────────────────────────────────────────────────────────
export const tableHeaderStyle: React.CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid var(--border-color, #e2e8f0)",
  padding: "6px 10px",
  fontSize: "15px",
  color: "var(--text-secondary, #64748b)",
  fontWeight: 700,
};

export const tableCellStyle: React.CSSProperties = {
  borderBottom: "1px solid var(--border-light, #f1f5f9)",
  padding: "7px 10px",
  fontSize: "16px",
  color: "var(--text-primary, #1e293b)",
};

export const tableCellBoldStyle: React.CSSProperties = {
  ...tableCellStyle,
  fontWeight: 700,
};

// ─────────────────────────────────────────────────────────────────
// Shared form styles
// ─────────────────────────────────────────────────────────────────
export const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "16px",
  fontWeight: 600,
  color: "var(--text-primary, #1e293b)",
  marginBottom: "10px",
};

export const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "8px 10px",
  marginTop: "3px",
  border: "1px solid var(--border-color, #e2e8f0)",
  borderRadius: "6px",
  fontSize: "17px",
  boxSizing: "border-box",
  backgroundColor: "var(--bg-input, #ffffff)",
  color: "var(--text-primary, #1e293b)",
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
