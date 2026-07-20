"use client";

import { useState } from "react";
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

  // quick = inline quick-add panel; full = full NewTaskForm modal
  const [showQuick, setShowQuick] = useState(false);
  const [showFull,  setShowFull]  = useState(false);

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
        display:        "flex",
        justifyContent: "space-between",
        alignItems:     "flex-start",
        flexWrap:       "wrap",
        gap:            "10px",
        marginBottom:   "16px",
      }}>
        <PageHeader />
        {canCreate && (
          <button
            onClick={() => setShowQuick((v) => !v)}
            title={showQuick ? "Close" : "Quick task"}
            style={{
              backgroundColor: showQuick ? COLOURS.HAIRLINE : COLOURS.NAVY,
              color:           showQuick ? COLOURS.SLATE    : COLOURS.CARD,
              border:          "none",
              borderRadius:    "50%",
              width:           "38px",
              height:          "38px",
              fontSize:        "20px",
              fontWeight:      700,
              cursor:          "pointer",
              display:         "flex",
              alignItems:      "center",
              justifyContent:  "center",
              flexShrink:      0,
              boxShadow:       SHADOWS.MODAL,
              transition:      "background-color 0.15s",
            }}
          >
            {showQuick ? "×" : "+"}
          </button>
        )}
      </div>

      {/* ── Quick-add panel (inline, slides in above the list) ────── */}
      {canCreate && showQuick && (
        <QuickAddTask
          onCreated={() => setShowQuick(false)}
          onMoreOptions={openFull}
        />
      )}

      {/* ── Full form (modal, for edge-cases) ───────────────────────── */}
      {canCreate && (
        <Modal open={showFull} onClose={() => setShowFull(false)}>
          <NewTaskForm onCreated={() => setShowFull(false)} />
        </Modal>
      )}

      <TasksList
        currentRole={role}
        canSeeAll={seeAll}
        canReview={review}
        canDelete={canDelete}
        canImport={impExp}
        department={ctx?.department ?? null}
      />
    </>
  );
}
