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
  assigned_to_email: string | null;
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

const NAVY = "#1e293b";
const SLATE = "#64748b";
const BORDER = "#e2e8f0";

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

function formatDateUK(dateString: string | null) {
  if (!dateString) return "—";
  const [year, month, day] = dateString.slice(0, 10).split("-");
  return `${day}-${month}-${year}`;
}

export default function TasksList({ currentRole }: { currentRole: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const isPrivileged = currentRole === "Admin" || currentRole === "Executive";

  async function loadTasks() {
    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email || null;
    setMyEmail(email);

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

  if (loading) return <p style={{ color: SLATE }}>Loading tasks…</p>;
  if (errorMsg) return <p style={{ color: "red" }}>Error loading tasks: {errorMsg}</p>;

  // Privileged users see all tasks; others see only tasks assigned to their email.
  const scopedTasks = isPrivileged
    ? tasks
    : tasks.filter((t) => t.assigned_to_email && t.assigned_to_email === myEmail);

  const activeTasks = scopedTasks.filter((t) => t.status !== "Completed");
  const completedTasks = scopedTasks.filter((t) => t.status === "Completed");

  const visibleTasks = showCompleted ? scopedTasks : activeTasks;

  if (scopedTasks.length === 0) {
    return <p style={{ color: SLATE, fontSize: "13px" }}>No assignments yet.</p>;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", flexWrap: "wrap", gap: "8px" }}>
        <h2 style={{ fontSize: "14px", fontWeight: 700, color: NAVY, margin: 0, paddingLeft: "9px", borderLeft: `3px solid ${NAVY}` }}>
          All Tasks {isPrivileged ? "" : "(yours)"} · {activeTasks.length} active
        </h2>
        {completedTasks.length > 0 && (
          <button
            onClick={() => setShowCompleted((v) => !v)}
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: NAVY,
              backgroundColor: "white",
              border: `1px solid ${BORDER}`,
              borderRadius: "6px",
              padding: "5px 11px",
              cursor: "pointer",
            }}
          >
            {showCompleted ? "Hide completed" : `Show completed (${completedTasks.length})`}
          </button>
        )}
      </div>

      <div style={{ overflowX: "auto", border: `1px solid ${BORDER}`, borderRadius: "8px", backgroundColor: "white" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ backgroundColor: "#f8fafc" }}>
              <th style={th}>Task</th>
              <th style={th}>Project</th>
              <th style={th}>Priority</th>
              <th style={th}>Assigned To</th>
              <th style={th}>Due</th>
              <th style={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleTasks.map((task) => {
              const isOpen = expandedId === task.id;
              return (
                <>
                  <tr
                    key={task.id}
                    onClick={() => setExpandedId(isOpen ? null : task.id)}
                    style={{ cursor: "pointer", backgroundColor: isOpen ? "#f8fafc" : "white" }}
                  >
                    <td style={{ ...td, fontWeight: 600, color: NAVY, maxWidth: "360px" }}>
                      {task.description}
                    </td>
                    <td style={td}>{task.project || "—"}</td>
                    <td style={td}>{task.priority || "—"}</td>
                    <td style={td}>{task.assigned_to || "—"}</td>
                    <td style={td}>{formatDateUK(task.due_date)}</td>
                    <td style={td}>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "3px 9px",
                          borderRadius: "10px",
                          color: "white",
                          backgroundColor: statusColor(task.status),
                          whiteSpace: "nowrap",
                        }}
                      >
                        {task.status}
                      </span>
                    </td>
                  </tr>

                  {isOpen && (
                    <tr key={`${task.id}-detail`}>
                      <td colSpan={6} style={{ ...td, backgroundColor: "#f8fafc", padding: "14px 16px" }}>
                        <div style={{ fontSize: "13px", color: SLATE, marginBottom: "6px" }}>
                          Type: <strong>{task.task_type || "Task"}</strong> &nbsp;|&nbsp;
                          Assigned date: {formatDateUK(task.assigned_date)} &nbsp;|&nbsp;
                          Assigned by: <strong>{task.assigned_by || "—"}</strong>
                        </div>

                        {task.notes && (
                          <div style={{ fontSize: "13px", color: SLATE, marginBottom: "8px" }}>
                            Notes: {task.notes}
                          </div>
                        )}

                        {task.reply_text && (
                          <div
                            style={{
                              padding: "10px 12px",
                              border: "1px solid #bbf7d0",
                              backgroundColor: "#f0fdf4",
                              borderRadius: "8px",
                              color: "#166534",
                              fontSize: "13px",
                              marginBottom: "8px",
                            }}
                          >
                            <strong>Explanation:</strong> {task.reply_text}
                            {task.corrective_action && (
                              <div style={{ marginTop: "5px" }}>
                                <strong>Corrective action:</strong> {task.corrective_action}
                              </div>
                            )}
                            {task.recovery_date && (
                              <div style={{ marginTop: "5px" }}>
                                <strong>Expected recovery:</strong> {formatDateUK(task.recovery_date)}
                              </div>
                            )}
                            <div style={{ marginTop: "5px", fontSize: "11px" }}>
                              By {task.reply_by || "unknown"}{" "}
                              {task.reply_at ? `on ${formatDateUK(task.reply_at)}` : ""}
                            </div>
                          </div>
                        )}

                        <TaskStatus task={task} currentRole={currentRole} onChanged={loadTasks} />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  borderBottom: `1px solid ${BORDER}`,
  padding: "8px 10px",
  fontSize: "11px",
  color: SLATE,
  fontWeight: 700,
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  borderBottom: `1px solid #f1f5f9`,
  padding: "8px 10px",
  fontSize: "13px",
  verticalAlign: "top",
};
