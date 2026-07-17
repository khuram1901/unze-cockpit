"use client";

import { useEffect } from "react";
import { COLOURS, RADII, SHADOWS } from "./SharedUI";

// Small, generic centred-overlay modal — used by the Tasks page's task
// detail popup (and available for anything else that needs the same
// pattern) instead of duplicating the backdrop/close logic per caller.

export default function Modal({
  open,
  onClose,
  children,
  maxWidth = "620px",
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,32,0.45)", zIndex: 200,
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        overflowY: "auto", padding: "40px 16px",
      }}
    >
      <div style={{
        background: COLOURS.CARD, borderRadius: RADII.CARD, width: "100%", maxWidth,
        overflow: "hidden", boxShadow: SHADOWS.MODAL,
      }}>
        {children}
      </div>
    </div>
  );
}
