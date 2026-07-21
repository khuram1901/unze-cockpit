"use client";

/**
 * FloatingTaskButton
 *
 * A persistent floating "Add task" button that appears on every page,
 * just above the chat bubble. Clicking it slides up a compact panel
 * with the full QuickAddTask form (description, assignee, due date,
 * voice input). Works identically to the quick-add on the Tasks page.
 */

import { useState } from "react";
import { COLOURS, RADII, SHADOWS } from "./SharedUI";
import { useMobile } from "./useMobile";
import QuickAddTask from "../tasks/QuickAddTask";
import Modal from "./Modal";
import NewTaskForm from "../tasks/NewTaskForm";

const NAVY = COLOURS.NAVY;

export default function FloatingTaskButton() {
  const isMobile = useMobile();
  const [open,     setOpen]     = useState(false);
  const [showFull, setShowFull] = useState(false);

  function handleMoreOptions() {
    setOpen(false);
    setShowFull(true);
  }

  return (
    <>
      {/* ── Mobile backdrop — dims page when sheet is open ── */}
      {isMobile && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 1198,
            background: "rgba(15,23,32,0.4)",
            opacity: open ? 1 : 0,
            pointerEvents: open ? "auto" : "none",
            transition: "opacity 0.2s ease",
          }}
        />
      )}

      {/* ── FAB — sits just above the chat bubble ── */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close quick task" : "Add task"}
        title={open ? "Close" : "Add task"}
        style={{
          position: "fixed",
          bottom: isMobile ? 80 : 88,
          right: isMobile ? 16 : 24,
          width: isMobile ? 46 : 52, height: isMobile ? 46 : 52, borderRadius: "50%",
          background: open ? COLOURS.SLATE : NAVY,
          border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: SHADOWS.MODAL, zIndex: 1200,
          transition: "background 0.15s ease, transform 0.15s ease",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.08)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        {open ? (
          /* × close */
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        ) : (
          /* clipboard + plus */
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
            <rect x="9" y="3" width="6" height="4" rx="1"/>
            <line x1="12" y1="11" x2="12" y2="17"/>
            <line x1="9"  y1="14" x2="15" y2="14"/>
          </svg>
        )}
      </button>

      {/* ── Slide-up panel ── */}
      {/* On mobile: full-width bottom sheet; on desktop: corner popover */}
      <div
        role="dialog"
        aria-label="Quick add task"
        aria-modal="false"
        style={isMobile ? {
          position: "fixed",
          bottom: 0, left: 0, right: 0,
          maxHeight: "85vh",
          overflowY: "auto",
          borderRadius: `${RADII.LG} ${RADII.LG} 0 0`,
          background: COLOURS.CARD,
          border: `1px solid ${COLOURS.HAIRLINE}`,
          borderBottom: "none",
          boxShadow: "0 -4px 30px rgba(15,23,32,0.18)",
          zIndex: 1199,
          transform: open ? "translateY(0)" : "translateY(100%)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "transform 0.22s ease, opacity 0.18s ease",
          padding: "8px 4px 32px",
        } : {
          position: "fixed",
          bottom: 152,
          right: 24,
          width: 360,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "calc(100vh - 180px)",
          overflowY: "auto",
          borderRadius: RADII.LG,
          background: COLOURS.CARD,
          border: `1px solid ${COLOURS.HAIRLINE}`,
          boxShadow: SHADOWS.MODAL,
          zIndex: 1199,
          transform: open ? "translateY(0) scale(1)" : "translateY(16px) scale(0.97)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "transform 0.18s ease, opacity 0.18s ease",
          transformOrigin: "bottom right",
          padding: "4px",
        }}
      >
        {/* Handle indicator — mobile only */}
        {isMobile && (
          <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 4px" }}>
            <div style={{ width: 36, height: 4, borderRadius: 99, background: COLOURS.HAIRLINE }} />
          </div>
        )}
        {open && (
          <QuickAddTask
            onCreated={() => setOpen(false)}
            onMoreOptions={handleMoreOptions}
          />
        )}
      </div>

      {/* ── Full form modal (opened via "More options") ── */}
      <Modal open={showFull} onClose={() => setShowFull(false)} maxWidth="640px">
        <NewTaskForm onCreated={() => setShowFull(false)} />
      </Modal>
    </>
  );
}
