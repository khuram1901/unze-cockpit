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
import TasksList from "./TasksList";

export default function TasksPageClient() {
  const { ctx, loading } = useUserCtx();
  const [showForm, setShowForm] = useState(false);

  if (loading) return <p style={{ color: COLOURS.SLATE }}>Loading tasks…</p>;

  const role = ctx?.role || "Member";
  const canCreate = ctx ? checkCanCreate(ctx) : false;
  const seeAll = ctx ? canSeeAllTasks(ctx) : false;
  const review = ctx ? canReviewTasks(ctx) : false;
  // Found during the 15 Jul 2026 audit: this used to call
  // canDeleteTask(ctx, null), which is always true for ANY logged-in
  // user — isTaskProtected(null) returns false, so "!isTaskProtected"
  // defaults to allowed with no task to check against. This flag is a
  // page-level "does this role generally have delete rights" signal
  // (TaskDetailPanel.tsx falls back to isPrivileged when it's undefined
  // anyway), so it should just BE isPrivileged — the real per-task
  // protected-creator check still happens per-row via canDeleteTask
  // with the actual task's assigned_by_email.
  const canDelete = ctx ? isPrivileged(ctx) : false;
  const impExp = ctx ? canImportExport(ctx) : false;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
        <PageHeader />
        {canCreate && (
          <button onClick={() => setShowForm(!showForm)} style={{
            backgroundColor: COLOURS.NAVY, color: COLOURS.CARD, border: "none", borderRadius: "50%",
            width: "38px", height: "38px", fontSize: "20px", fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            boxShadow: SHADOWS.MODAL,
          }} title="Create task">{showForm ? "×" : "+"}</button>
        )}
      </div>

      {canCreate && (
        <Modal open={showForm} onClose={() => setShowForm(false)}>
          <NewTaskForm onCreated={() => setShowForm(false)} />
        </Modal>
      )}

      <TasksList currentRole={role} canSeeAll={seeAll} canReview={review} canDelete={canDelete} canImport={impExp} department={ctx?.department ?? null} />
    </>
  );
}