"use client";

import React from "react";

// ─────────────────────────────────────────────────────────────────
// Design tokens — Genspark design system v1
// Source of truth for all colours, radii, and shadows.
// ─────────────────────────────────────────────────────────────────

export const COLOURS = {
  // Surfaces
  CANVAS:      "#F7F5F1", // page background
  CARD:        "#FFFFFF", // card surface
  CARD_ALT:    "#FBFAF7", // tinted / alternate card
  HAIRLINE:    "#EEF0F3", // borders, dividers
  TRACK:       "#F1F3F6", // progress bar background

  // Ink (text)
  NAVY:        "#0F1720", // Ink 900 — headlines, numbers (was #1e293b)
  INK_700:     "#334155", // body copy
  SLATE:       "#64748B", // Ink 500 — labels, secondary (unchanged)
  INK_400:     "#94A3B8", // captions, meta
  INK_300:     "#CBD5E1", // disabled

  // Accent
  BLUE:        "#3B4CCA", // Accent — links, CTAs, active (was #2563eb)

  // Status — solid
  GREEN:       "#0F7B5F", // Success (was #16a34a)
  AMBER:       "#B4791F", // Warning (was #d97706)
  RED:         "#B3261E", // Danger (was #dc2626)

  // Status — soft backgrounds
  SUCCESS_SOFT: "#E7F2ED",
  WARNING_SOFT: "#FBF1DE",
  DANGER_SOFT:  "#F8E4E2",
  INFO_SOFT:    "#EEF1FC",

  // Legacy aliases kept for backward compatibility
  BG:     "#F7F5F1", // = CANVAS
  LIGHT:  "#F1F3F6", // = TRACK
  BORDER: "#EEF0F3", // = HAIRLINE

  // Role identity (Members/Admin area only)
  PURPLE: "#3B4CCA", // remapped from #7c3aed → Accent
  TEAL:   "#0F7B5F", // remapped from #059669 → Success
};

export const RADII = {
  XS:     "6px",   // small chips
  SM:     "10px",  // inputs, small chips
  CARD:   "14px",  // standard cards (was 12px)
  LG:     "20px",  // hero / feature cards
  PILL:   "999px", // buttons, tab strips, filter pills
  BUTTON: "999px", // alias for PILL (backward compat)
  BADGE:  "6px",   // alias for XS (backward compat)
};

// Shadows removed from card spec by design system — kept only for modals/dropdowns
export const SHADOWS = {
  CARD:     "none",
  ELEVATED: "0 2px 8px rgba(15,23,32,0.06)",
  DROPDOWN: "0 8px 30px rgba(15,23,32,0.12)",
  MODAL:    "0 20px 60px rgba(15,23,32,0.15)",
  HOVER:    "0 1px 4px rgba(15,23,32,0.08)",
};

// ─────────────────────────────────────────────────────────────────
// Shared card style — use as the base for any card container
// ─────────────────────────────────────────────────────────────────
export const cardStyle: React.CSSProperties = {
  background:   COLOURS.CARD,
  border:       `1px solid ${COLOURS.HAIRLINE}`,
  borderRadius: RADII.CARD,
  padding:      "24px",
};

export const cardAltStyle: React.CSSProperties = {
  ...cardStyle,
  background: COLOURS.CARD_ALT,
};

// ─────────────────────────────────────────────────────────────────
// Role display helper
// ─────────────────────────────────────────────────────────────────
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
export function SectionTitle({ title, style }: { title: string; style?: React.CSSProperties }) {
  return (
    <h2
      style={{
        fontFamily:    "var(--font-display, 'Inter Tight', sans-serif)",
        fontSize:      "22px",
        fontWeight:    600,
        letterSpacing: "-0.01em",
        color:         COLOURS.NAVY,
        margin:        "32px 0 16px",
        ...style,
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
      <a
        href="/home"
        style={{
          display:         "inline-flex",
          alignItems:      "center",
          gap:             "6px",
          fontSize:        "13px",
          fontWeight:      500,
          color:           COLOURS.SLATE,
          textDecoration:  "none",
          padding:         "5px 12px 5px 8px",
          borderRadius:    RADII.PILL,
          backgroundColor: COLOURS.CARD_ALT,
          border:          `1px solid ${COLOURS.HAIRLINE}`,
          cursor:          "pointer",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 12L6 8l4-4" />
        </svg>
        Home
      </a>
    </div>
  );
}

export function StatusBadge({ status }: { status: string | null }) {
  const colour = statusColor(status);
  const softMap: Record<string, string> = {
    [COLOURS.GREEN]: COLOURS.SUCCESS_SOFT,
    [COLOURS.AMBER]: COLOURS.WARNING_SOFT,
    [COLOURS.RED]:   COLOURS.DANGER_SOFT,
  };
  const soft = softMap[colour] ?? COLOURS.HAIRLINE;
  return (
    <span
      style={{
        display:       "inline-block",
        fontSize:      "11px",
        fontWeight:    600,
        padding:       "3px 10px",
        borderRadius:  RADII.PILL,
        color:         colour,
        backgroundColor: soft,
        whiteSpace:    "nowrap",
      }}
    >
      {status || "—"}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string | null }) {
  const colour = priorityColor(priority);
  const softMap: Record<string, string> = {
    [COLOURS.RED]:   COLOURS.DANGER_SOFT,
    [COLOURS.AMBER]: COLOURS.WARNING_SOFT,
    [COLOURS.BLUE]:  "#EEF1FC",
    [COLOURS.SLATE]: COLOURS.HAIRLINE,
  };
  const soft = softMap[colour] ?? COLOURS.HAIRLINE;
  return (
    <span
      style={{
        display:         "inline-block",
        fontSize:        "11px",
        fontWeight:      600,
        padding:         "3px 10px",
        borderRadius:    RADII.PILL,
        color:           colour,
        backgroundColor: soft,
        whiteSpace:      "nowrap",
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
        ...cardStyle,
        padding:   "16px 20px",
        borderTop: `3px solid ${color}`,
      }}
    >
      <div
        style={{
          fontFamily:    "var(--font-sans, Inter, sans-serif)",
          fontSize:      "10.5px",
          fontWeight:    500,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color:         COLOURS.SLATE,
          marginBottom:  "10px",
          whiteSpace:    "nowrap",
          overflow:      "hidden",
          textOverflow:  "ellipsis",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily:         "var(--font-display, 'Inter Tight', sans-serif)",
          fontSize:           "26px",
          fontWeight:         600,
          letterSpacing:      "-0.02em",
          fontVariantNumeric: "tabular-nums",
          color,
        }}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {sub && (
        <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "6px" }}>
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
          width:           "8px",
          height:          "8px",
          borderRadius:    "50%",
          backgroundColor: colour,
          flexShrink:      0,
        }}
      />
      <div>
        <div style={{ fontFamily: "var(--font-display, 'Inter Tight', sans-serif)", fontSize: "15px", fontWeight: 600, color: colour }}>{label}</div>
        {detail && (
          <div style={{ fontSize: "12px", color: COLOURS.SLATE }}>{detail}</div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Data freshness badge
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

  const softMap: Record<string, string> = {
    [COLOURS.GREEN]: COLOURS.SUCCESS_SOFT,
    [COLOURS.AMBER]: COLOURS.WARNING_SOFT,
    [COLOURS.RED]:   COLOURS.DANGER_SOFT,
  };

  return (
    <span style={{
      display:         "inline-flex",
      alignItems:      "center",
      gap:             "4px",
      fontSize:        "11px",
      fontWeight:      500,
      color,
      padding:         "2px 8px",
      borderRadius:    RADII.PILL,
      backgroundColor: softMap[color] ?? COLOURS.HAIRLINE,
    }}>
      <span style={{ width: "5px", height: "5px", borderRadius: "50%", backgroundColor: color }} />
      {label ? `${label}: ${text}` : text}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────
// Warning / alert banner wrapper
// ─────────────────────────────────────────────────────────────────
export const WARNING_BANNER_STYLE: React.CSSProperties = {
  border:          `1px solid #F1D9A9`,
  borderLeft:      `4px solid ${COLOURS.AMBER}`,
  borderRadius:    RADII.CARD,
  backgroundColor: COLOURS.WARNING_SOFT,
  overflow:        "hidden",
  marginBottom:    "16px",
};

export const WARNING_BANNER_INNER: React.CSSProperties = {
  borderTop:       `1px solid #F1D9A9`,
  backgroundColor: COLOURS.CARD,
};

export const WARNING_TITLE_COLOR = COLOURS.AMBER;

// ─────────────────────────────────────────────────────────────────
// Shared table styles
// ─────────────────────────────────────────────────────────────────
export const tableHeaderStyle: React.CSSProperties = {
  textAlign:     "left",
  borderBottom:  `1px solid ${COLOURS.HAIRLINE}`,
  padding:       "12px 20px",
  fontSize:      "10.5px",
  fontWeight:    500,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color:         COLOURS.SLATE,
  backgroundColor: COLOURS.CARD_ALT,
  fontFamily:    "var(--font-sans, Inter, sans-serif)",
};

export const tableCellStyle: React.CSSProperties = {
  borderBottom:       `1px solid ${COLOURS.HAIRLINE}`,
  padding:            "12px 20px",
  fontSize:           "13px",
  color:              COLOURS.NAVY,
  fontVariantNumeric: "tabular-nums",
};

export const tableCellBoldStyle: React.CSSProperties = {
  ...tableCellStyle,
  fontWeight: 500,
};

// ─────────────────────────────────────────────────────────────────
// Shared form styles
// ─────────────────────────────────────────────────────────────────
export const labelStyle: React.CSSProperties = {
  display:       "block",
  fontSize:      "10.5px",
  fontWeight:    500,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color:         COLOURS.SLATE,
  marginBottom:  "6px",
  fontFamily:    "var(--font-sans, Inter, sans-serif)",
};

export const inputStyle: React.CSSProperties = {
  display:         "block",
  width:           "100%",
  padding:         "8px 12px",
  marginTop:       "3px",
  border:          `1px solid ${COLOURS.HAIRLINE}`,
  borderRadius:    RADII.SM,
  fontSize:        "13px",
  boxSizing:       "border-box",
  backgroundColor: COLOURS.CARD,
  color:           COLOURS.NAVY,
  fontFamily:      "var(--font-sans, Inter, sans-serif)",
};

export const primaryButtonStyle: React.CSSProperties = {
  backgroundColor: COLOURS.NAVY,
  color:           "white",
  border:          "none",
  borderRadius:    RADII.PILL,
  padding:         "8px 20px",
  fontSize:        "13px",
  fontWeight:      500,
  cursor:          "pointer",
  fontFamily:      "var(--font-sans, Inter, sans-serif)",
};

// ─────────────────────────────────────────────────────────────────
// Toast notification
// ─────────────────────────────────────────────────────────────────
type ToastType = "success" | "error" | "info";

const TOAST_COLORS: Record<ToastType, { bg: string; border: string; text: string; icon: string }> = {
  success: { bg: COLOURS.SUCCESS_SOFT, border: "#A8D5C2", text: COLOURS.GREEN, icon: "✓" },
  error:   { bg: COLOURS.DANGER_SOFT,  border: "#EDB5B2", text: COLOURS.RED,   icon: "✗" },
  info:    { bg: "#EEF1FC",            border: "#C0C8EF", text: COLOURS.BLUE,  icon: "ℹ" },
};

export function Toast({ message, type = "info", onClose }: { message: string; type?: ToastType; onClose: () => void }) {
  const c = TOAST_COLORS[type];
  React.useEffect(() => { const t = setTimeout(onClose, type === "error" ? 6000 : 4000); return () => clearTimeout(t); }, [onClose, type]);
  return (
    <div style={{
      position:        "fixed",
      bottom:          "24px",
      right:           "24px",
      zIndex:          9999,
      backgroundColor: c.bg,
      border:          `1px solid ${c.border}`,
      borderRadius:    RADII.CARD,
      padding:         "14px 20px",
      maxWidth:        "420px",
      boxShadow:       SHADOWS.DROPDOWN,
      display:         "flex",
      alignItems:      "center",
      gap:             "10px",
      animation:       "loginFadeIn 0.2s ease-out",
    }}>
      <span style={{ fontSize: "14px", fontWeight: 600, color: c.text }}>{c.icon}</span>
      <span style={{ fontSize: "13px", color: c.text, lineHeight: 1.4, flex: 1, whiteSpace: "pre-wrap" }}>{message}</span>
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
// Confirm dialog
// ─────────────────────────────────────────────────────────────────
export function ConfirmDialog({ message, onConfirm, onCancel, confirmLabel = "Confirm", danger = false }: {
  message: string; onConfirm: () => void; onCancel: () => void; confirmLabel?: string; danger?: boolean;
}) {
  return (
    <div style={{
      position:        "fixed",
      inset:           0,
      zIndex:          9998,
      backgroundColor: "rgba(15,23,32,0.4)",
      display:         "flex",
      alignItems:      "center",
      justifyContent:  "center",
      padding:         "16px",
    }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{
        backgroundColor: COLOURS.CARD,
        borderRadius:    RADII.CARD,
        padding:         "28px",
        maxWidth:        "420px",
        width:           "100%",
        boxShadow:       SHADOWS.MODAL,
      }}>
        <p style={{ fontSize: "14px", color: COLOURS.NAVY, lineHeight: 1.6, margin: "0 0 20px", whiteSpace: "pre-wrap" }}>{message}</p>
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{
            padding:         "8px 18px",
            borderRadius:    RADII.PILL,
            fontSize:        "13px",
            fontWeight:      500,
            border:          `1px solid ${COLOURS.HAIRLINE}`,
            backgroundColor: COLOURS.CARD,
            color:           COLOURS.NAVY,
            cursor:          "pointer",
          }}>Cancel</button>
          <button onClick={onConfirm} style={{
            padding:         "8px 18px",
            borderRadius:    RADII.PILL,
            fontSize:        "13px",
            fontWeight:      500,
            border:          "none",
            backgroundColor: danger ? COLOURS.RED : COLOURS.NAVY,
            color:           "white",
            cursor:          "pointer",
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
// Error banner
// ─────────────────────────────────────────────────────────────────
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div style={{
      backgroundColor: COLOURS.DANGER_SOFT,
      border:          `1px solid #EDB5B2`,
      borderRadius:    RADII.CARD,
      padding:         "12px 16px",
      marginBottom:    "16px",
      display:         "flex",
      alignItems:      "center",
      gap:             "10px",
    }}>
      <span style={{ fontSize: "13px", color: COLOURS.RED, flex: 1 }}>{message}</span>
      {onRetry && (
        <button onClick={onRetry} style={{
          padding:         "6px 14px",
          borderRadius:    RADII.PILL,
          fontSize:        "12px",
          fontWeight:      500,
          border:          `1px solid #EDB5B2`,
          backgroundColor: COLOURS.CARD,
          color:           COLOURS.RED,
          cursor:          "pointer",
        }}>Retry</button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Loading skeleton
// ─────────────────────────────────────────────────────────────────
export function SkeletonCard({ width = "100%", height = "80px" }: { width?: string; height?: string }) {
  return (
    <div style={{
      width,
      height,
      borderRadius: RADII.CARD,
      background:   `linear-gradient(90deg, ${COLOURS.CARD_ALT} 25%, ${COLOURS.HAIRLINE} 50%, ${COLOURS.CARD_ALT} 75%)`,
      backgroundSize: "200% 100%",
      animation:    "shimmer 1.5s infinite linear",
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
