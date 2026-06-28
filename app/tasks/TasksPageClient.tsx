"use client";

import { useState } from "react";
import { COLOURS, PageHeader } from "../lib/SharedUI";
import { useUserCtx } from "../lib/useUserCtx";
import {
  canCreateAssignments as checkCanCreate,
  canSeeAllTasks, canReviewTasks, canImportExport,
} from "../lib/permissions";
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
  const impExp = ctx ? canImportExport(ctx) : false;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
        <PageHeader />
        {canCreate && (
          <button onClick={() => setShowForm(!showForm)} style={{
            backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "50%",
            width: "38px", height: "38px", fontSize: "20px", fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
          }} title="Create task">{showForm ? "×" : "+"}</button>
        )}
      </div>

      {canCreate && showForm && (
        <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: `3px solid ${COLOURS.NAVY}`, borderRadius: "8px", marginBottom: "14px", overflow: "hidden" }}>
          <NewTaskForm />
        </div>
      )}

      <TasksList currentRole={role} canSeeAll={seeAll} canReview={review} canDelete={review} canImport={impExp} />
    </>
  );
}