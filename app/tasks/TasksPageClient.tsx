"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import NewTaskForm from "./NewTaskForm";
import TasksList from "./TasksList";

type Member = {
  name: string;
  role: string;
};

export default function TasksPageClient() {
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) return <p>Loading tasks…</p>;

  const role = member?.role || "Member";
  const canCreateAssignments = role === "Admin" || role === "Executive";

  return (
    <>
      {canCreateAssignments ? (
        <NewTaskForm />
      ) : (
        <div
          style={{
            border: "1px solid #e0e0e0",
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "24px",
            backgroundColor: "#fafafa",
            color: "#555",
          }}
        >
          You can update your assigned tasks and submit replies here.
        </div>
      )}

      <TasksList currentRole={role} />
    </>
  );
}