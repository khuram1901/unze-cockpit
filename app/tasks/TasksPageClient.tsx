"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { COLOURS, PageHeader } from "../lib/SharedUI";
import NewTaskForm from "./NewTaskForm";
import TasksList from "./TasksList";

type Member = {
  name: string;
  role: string;
};

export default function TasksPageClient() {
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    async function loadMember() {
      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email;

      if (!email) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("members")
        .select("name, role")
        .eq("email", email)
        .single();

      if (data) setMember(data);
      setLoading(false);
    }

    loadMember();
  }, []);

  if (loading) return <p style={{ color: COLOURS.SLATE }}>Loading tasks…</p>;

  const role = member?.role || "Member";
  const canCreateAssignments = role === "Admin" || role === "Executive";

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
        <PageHeader title="Tasks & Assignments" subtitle={canCreateAssignments ? "Create, assign, track, and close tasks" : "Update your assigned tasks and submit replies"} />
        {canCreateAssignments && (
          <button onClick={() => setShowForm(!showForm)} style={{
            backgroundColor: COLOURS.NAVY, color: "white", border: "none", borderRadius: "50%",
            width: "38px", height: "38px", fontSize: "20px", fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
          }} title="Create task">{showForm ? "×" : "+"}</button>
        )}
      </div>

      {canCreateAssignments && showForm && (
        <div style={{ border: `1px solid ${COLOURS.BORDER}`, borderTop: `3px solid ${COLOURS.NAVY}`, borderRadius: "8px", marginBottom: "14px", overflow: "hidden" }}>
          <NewTaskForm />
        </div>
      )}

      <TasksList currentRole={role} />
    </>
  );
}