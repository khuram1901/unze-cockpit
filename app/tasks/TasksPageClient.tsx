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

export default function TasksPageClient() {
  const { ctx, loading } = useUserCtx();
  const searchParams = useSearchParams();

  // ?voice=1 in the URL (Siri shortcut / Android home screen shortcut) —
  // open quick panel immediately and auto-trigger the mic.
  const voiceParam = searchParams.get("voice") === "1";

  const [showQuick,      setShowQuick]      = useState(voiceParam);
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
        />
      )}

      {/* ── Full form modal ──────────────────────────────────────────── */}
      {canCreate && (
        <Modal open={showFull} onClose={() => setShowFull(false)}>
          <NewTaskForm onCreated={() => setShowFull(false)} />
        </Modal>
      )}

      <TasksList
        currentRole={role} canSeeAll={seeAll} canReview={review}
        canDelete={canDelete} canImport={impExp}
        department={ctx?.department ?? null}
      />
    </>
  );
}
