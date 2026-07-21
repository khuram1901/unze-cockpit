"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { COLOURS, SHADOWS, PageHeader } from "../lib/SharedUI";
import { useUserCtx } from "../lib/useUserCtx";
import {
  canCreateAssignments as checkCanCreate,
  canSeeAllTasks, canReviewTasks, canImportExport, isPrivileged,
} from "../lib/permissions";
import Modal from "../lib/Modal";
import NewTaskForm from "./NewTaskForm";
import QuickAddTask from "./QuickAddTask";
import TasksList from "./TasksList";
import AuditTasksPanel from "./AuditTasksPanel";

export default function TasksPageClient() {
  const { ctx, loading } = useUserCtx();
  const searchParams = useSearchParams();

  // ?voice=1 in the URL (Siri shortcut / Android home screen shortcut) —
  // open quick panel immediately and auto-trigger the mic.
  const voiceParam = searchParams.get("voice") === "1";

  // ?text=... in the URL — Siri dictation shortcut passes transcribed text
  // directly without needing the browser mic. When present, open the panel
  // and pre-fill the form via parseVoiceTask (same as voice input does).
  const textParam = searchParams.get("text") || "";

  const [showQuick,      setShowQuick]      = useState(voiceParam || !!textParam);
  const [showFull,       setShowFull]       = useState(false);
  const [autoStartVoice, setAutoStartVoice] = useState(voiceParam);

  if (loading) return <p style={{ color: COLOURS.SLATE }}>Loading tasks…</p>;

  const role      = ctx?.role || "Member";
  const canCreate = ctx ? checkCanCreate(ctx) : false;
  const seeAll    = ctx ? canSeeAllTasks(ctx) : false;
  const review    = ctx ? canReviewTasks(ctx) : false;
  const canDelete = ctx ? isPrivileged(ctx) : false;
  const impExp    = ctx ? canImportExport(ctx) : false;

  function openFull() {
    setShowQuick(false);
    setShowFull(true);
  }

  return (
    <>
      {/* ── Header row ──────────────────────────────────────────────── */}
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "flex-start", flexWrap: "wrap",
        gap: "10px", marginBottom: "16px",
      }}>
        <PageHeader />
        {canCreate && (
          <button
            onClick={() => { setShowQuick((v) => !v); setAutoStartVoice(false); }}
            title={showQuick ? "Close" : "Quick task"}
            style={{
              backgroundColor: showQuick ? COLOURS.HAIRLINE : COLOURS.NAVY,
              color:           showQuick ? COLOURS.SLATE    : COLOURS.CARD,
              border: "none", borderRadius: "50%",
              width: "38px", height: "38px",
              fontSize: "20px", fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, boxShadow: SHADOWS.MODAL, transition: "background-color 0.15s",
            }}
          >
            {showQuick ? "×" : "+"}
          </button>
        )}
      </div>

      {/* ── Quick-add panel (inline) ─────────────────────────────────── */}
      {canCreate && showQuick && (
        <QuickAddTask
          onCreated={() => { setShowQuick(false); setAutoStartVoice(false); }}
          onMoreOptions={openFull}
          autoStartVoice={autoStartVoice}
          prefillText={textParam}
        />
      )}

      {/* ── Full form modal ──────────────────────────────────────────── */}
      {canCreate && (
        <Modal open={showFull} onClose={() => setShowFull(false)}>
          <NewTaskForm onCreated={() => setShowFull(false)} />
        </Modal>
      )}

      {ctx?.department === "Audit" ? (
        /* ── Audit members: two-column layout ─────────────────────────────
           Left  (wider) : audit project stage tasks
           Right (narrower): general tasks assigned to this person         */
        <div style={{ display: "flex", gap: "24px", alignItems: "flex-start", flexWrap: "wrap" }}>
          {/* Left column — Audit Projects */}
          <div style={{ flex: "3 1 320px", minWidth: 0 }}>
            <AuditTasksPanel />
          </div>

          {/* Right column — General Tasks */}
          <div style={{ flex: "2 1 260px", minWidth: 0 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px",
            }}>
              <span style={{
                fontSize: "12px", fontWeight: 700, color: COLOURS.SLATE,
                textTransform: "uppercase", letterSpacing: "0.06em",
              }}>General Tasks</span>
              <div style={{ flex: 1, height: "1px", backgroundColor: COLOURS.HAIRLINE }} />
            </div>
            <TasksList
              currentRole={role} canSeeAll={seeAll} canReview={review}
              canDelete={canDelete} canImport={impExp}
              department={ctx?.department ?? null}
            />
          </div>
        </div>
      ) : (
        <TasksList
          currentRole={role} canSeeAll={seeAll} canReview={review}
          canDelete={canDelete} canImport={impExp}
          department={ctx?.department ?? null}
        />
      )}
    </>
  );
}
