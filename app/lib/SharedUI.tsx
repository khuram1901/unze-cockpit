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
export const SHADOWS = { CARD: "0 1px 3px rgba(15,23,42,0.06)", ELEVATED: "0 4px 12px rgba(15,23,42,0.08)", DROPDOWN: "0 8px 30px rgba(15,23,42,0.12)", MODAL: "0 2px 6px rgba(0,0,0,0.15)", HOVER: "0 2px 8px rgba(0,0,0,0.1)" };

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
        borderTop: `2px solid ${color}`,
        borderRadius: "6px",
        padding: "6px 8px",
        backgroundColor: "var(--bg-card, #ffffff)",
      }}
    >
      <div
        style={{
          color: "var(--text-secondary, #64748b)",
          fontSize: "12px",
          marginBottom: "1px",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "17px", fontWeight: 800, color }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {sub && (
        <div style={{ fontSize: "12px", color: "var(--text-secondary, #64748b)", marginTop: "1px" }}>
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

// ─────────────────────────────────────────────────────────────────
// Toast notification (replaces alert())
// ─────────────────────────────────────────────────────────────────
type ToastType = "success" | "error" | "info";

const TOAST_COLORS: Record<ToastType, { bg: string; border: string; text: string; icon: string }> = {
  success: { bg: "#f0fdf4", border: "#bbf7d0", text: "#166534", icon: "✓" },
  error: { bg: "#fef2f2", border: "#fecaca", text: "#991b1b", icon: "✗" },
  info: { bg: "#eff6ff", border: "#bfdbfe", text: "#1e40af", icon: "ℹ" },
};

export function Toast({ message, type = "info", onClose }: { message: string; type?: ToastType; onClose: () => void }) {
  const c = TOAST_COLORS[type];
  React.useEffect(() => { const t = setTimeout(onClose, type === "error" ? 6000 : 4000); return () => clearTimeout(t); }, [onClose, type]);
  return (
    <div style={{
      position: "fixed", bottom: "24px", right: "24px", zIndex: 9999,
      backgroundColor: c.bg, border: `1px solid ${c.border}`, borderRadius: "10px",
      padding: "12px 20px", maxWidth: "420px", boxShadow: "0 8px 30px rgba(15,23,42,0.12)",
      display: "flex", alignItems: "center", gap: "10px", animation: "loginFadeIn 0.2s ease-out",
    }}>
      <span style={{ fontSize: "16px", fontWeight: 700, color: c.text }}>{c.icon}</span>
      <span style={{ fontSize: "14px", color: c.text, lineHeight: 1.4, flex: 1, whiteSpace: "pre-wrap" }}>{message}</span>
      <button onClick={onClose} style={{ background: "none", border: "none", color: c.text, cursor: "pointer", fontSize: "18px", padding: "0 2px", opacity: 0.6 }}>&times;</button>
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = React.useState<{ message: string; type: ToastType } | null>(null);
  const show = React.useCallback((message: string, type: ToastType = "info") => setToast({ message, type }), []);
  const element = toast ? <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} /> : null;
  return { show, element };
}

// ─────────────────────────────────────────────────────────────────
// Confirm dialog (replaces confirm())
// ─────────────────────────────────────────────────────────────────
export function ConfirmDialog({ message, onConfirm, onCancel, confirmLabel = "Confirm", danger = false }: {
  message: string; onConfirm: () => void; onCancel: () => void; confirmLabel?: string; danger?: boolean;
}) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9998, backgroundColor: "rgba(15,23,42,0.4)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: "16px",
    }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{
        backgroundColor: "var(--bg-card, #ffffff)", borderRadius: "14px", padding: "28px",
        maxWidth: "420px", width: "100%", boxShadow: "0 20px 60px rgba(15,23,42,0.15)",
      }}>
        <p style={{ fontSize: "15px", color: "var(--text-primary, #1e293b)", lineHeight: 1.5, margin: "0 0 20px", whiteSpace: "pre-wrap" }}>{message}</p>
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{
            padding: "8px 18px", borderRadius: "8px", fontSize: "14px", fontWeight: 600,
            border: `1px solid ${COLOURS.BORDER}`, backgroundColor: "var(--bg-card, #fff)", color: COLOURS.NAVY, cursor: "pointer",
          }}>Cancel</button>
          <button onClick={onConfirm} style={{
            padding: "8px 18px", borderRadius: "8px", fontSize: "14px", fontWeight: 600,
            border: "none", backgroundColor: danger ? COLOURS.RED : COLOURS.NAVY, color: "white", cursor: "pointer",
          }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function useConfirm() {
  const [state, setState] = React.useState<{ message: string; resolve: (v: boolean) => void; danger?: boolean } | null>(null);
  const confirm = React.useCallback((message: string, danger = false) => new Promise<boolean>((resolve) => setState({ message, resolve, danger })), []);
  const element = state ? (
    <ConfirmDialog message={state.message} danger={state.danger}
      onConfirm={() => { state.resolve(true); setState(null); }}
      onCancel={() => { state.resolve(false); setState(null); }}
      confirmLabel={state.danger ? "Delete" : "Confirm"}
    />
  ) : null;
  return { confirm, element };
}

// ─────────────────────────────────────────────────────────────────
// Error banner (replaces silent fetch failures)
// ─────────────────────────────────────────────────────────────────
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div style={{
      backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px",
      padding: "12px 16px", marginBottom: "16px", display: "flex", alignItems: "center", gap: "10px",
    }}>
      <span style={{ fontSize: "14px", color: "#991b1b", flex: 1 }}>{message}</span>
      {onRetry && (
        <button onClick={onRetry} style={{
          padding: "6px 14px", borderRadius: "6px", fontSize: "13px", fontWeight: 600,
          border: "1px solid #fecaca", backgroundColor: "#fff", color: "#991b1b", cursor: "pointer",
        }}>Retry</button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Loading skeleton (replaces bare "Loading..." text)
// ─────────────────────────────────────────────────────────────────
export function SkeletonCard({ width = "100%", height = "80px" }: { width?: string; height?: string }) {
  return (
    <div style={{
      width, height, borderRadius: "12px",
      background: "linear-gradient(90deg, var(--bg-card, #f1f5f9) 25%, var(--bg-card-hover, #e8ecf1) 50%, var(--bg-card, #f1f5f9) 75%)",
      backgroundSize: "200% 100%",
      animation: "shimmer 1.5s infinite linear",
    }} />
  );
}

export function SkeletonRows({ count = 4, height = "48px" }: { count?: number; height?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} height={height} />
      ))}
    </div>
  );
}
