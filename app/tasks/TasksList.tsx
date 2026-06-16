"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import TaskStatus from "./TaskStatus";

type Task = {
  id: string;
  task_type: string | null;
  description: string;
  project: string | null;
  priority: string | null;
  due_date: string | null;
  assigned_date: string | null;
  assigned_to: string | null;
  assigned_by: string | null;
  status: string;
  stuck_reason: string | null;
  notes: string | null;
  reply_required: boolean | null;
  reply_text: string | null;
  reply_by: string | null;
  reply_at: string | null;
  corrective_action: string | null;
  recovery_date: string | null;
  impact_on_monthly_target: string | null;
};

function statusColor(status: string) {
  switch (status) {
    case "Completed":
      return "#16a34a";
    case "Submitted":
      return "#d97706";
    case "Waiting Reply":
      return "#dc2626";
    case "Cancelled":
      return "#888";
    case "In Progress":
      return "#0070f3";
    default:
      return "#64748b"; // Not Started
  }
}

export default function TasksList({ currentRole }: { currentRole: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  async function loadTasks() {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMsg(error.message);
    } else {
      setTasks(data || []);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadTasks();
  }, []);

  if (loading) return <p>Loading tasks…</p>;
  if (errorMsg) return <p style={{ color: "red" }}>Error loading tasks: {errorMsg}</p>;
  if (tasks.length === 0) return <p>No assignments yet.</p>;

  return (
       <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "10px", alignItems: "start" }}>
      {tasks.map((task) => {
        const type = task.task_type || "Task";

        return (
          <div
            key={task.id}
            style={{
              border: "1px solid #e0e0e0",
              borderRadius: "8px",
              padding: "16px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
              <div>
                <div style={{ fontWeight: "bold", fontSize: "16px" }}>{task.description}</div>

                <div style={{ marginTop: "8px", color: "#555", fontSize: "14px" }}>
                  Type: <strong>{type}</strong> &nbsp;|&nbsp; Project: {task.project || "—"}{" "}
                  &nbsp;|&nbsp; Priority: {task.priority || "—"}
                </div>
              </div>

              <span
                style={{
                  fontSize: "12px",
                  fontWeight: "bold",
                  padding: "4px 10px",
                  borderRadius: "12px",
                  color: "white",
                  height: "fit-content",
                  backgroundColor: statusColor(task.status),
                }}
              >
                {task.status}
              </span>
            </div>

            <div style={{ marginTop: "8px", color: "#555", fontSize: "14px" }}>
              Assigned date: {task.assigned_date || "—"} &nbsp;|&nbsp; Due: {task.due_date || "—"}
            </div>

            <div style={{ marginTop: "8px", fontSize: "14px" }}>
              Assigned to: <strong>{task.assigned_to || "—"}</strong> &nbsp;|&nbsp; Assigned by:{" "}
              <strong>{task.assigned_by || "—"}</strong>
            </div>

            {task.notes && (
              <div style={{ marginTop: "8px", color: "#555", fontSize: "14px" }}>
                Notes: {task.notes}
              </div>
            )}

            {task.reply_text && (
              <div
                style={{
                  marginTop: "12px",
                  padding: "12px",
                  border: "1px solid #bbf7d0",
                  backgroundColor: "#f0fdf4",
                  borderRadius: "8px",
                  color: "#166534",
                  fontSize: "14px",
                }}
              >
                <strong>Explanation:</strong> {task.reply_text}
                {task.corrective_action && (
                  <div style={{ marginTop: "6px" }}>
                    <strong>Corrective action:</strong> {task.corrective_action}
                  </div>
                )}
                {task.recovery_date && (
                  <div style={{ marginTop: "6px" }}>
                    <strong>Expected recovery:</strong> {task.recovery_date}
                  </div>
                )}
                <div style={{ marginTop: "6px", fontSize: "12px" }}>
                  By {task.reply_by || "unknown"}{" "}
                  {task.reply_at ? `on ${task.reply_at.slice(0, 10)}` : ""}
                </div>
              </div>
            )}

            <TaskStatus task={task} currentRole={currentRole} onChanged={loadTasks} />
          </div>
        );
      })}
    </div>
  );
}
