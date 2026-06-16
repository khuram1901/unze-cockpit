"use client";

import React, { useState, useEffect } from "react";
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
      return "#64748b";
  }
}

function formatDateUK(dateString: string | null) {
  if (!dateString) return "—";
  const [year, month, day] = dateString.slice(0, 10).split("-");
  return `${day}-${month}-${year}`;
}

function normaliseProject(raw: string | null): string {
  if (!raw) return "Unassigned";
  const trimmed = raw.trim();
  if (!trimmed) return "Unassigned";
  return trimmed;
}

const todayStr = new Date().toISOString().slice(0, 10);

function isRed(task: Task) {
  if (task.status === "Completed" || task.status === "Cancelled") return false;
  if (task.status === "Waiting Reply") return true;
  if (task.due_date && task.due_date < todayStr) return true;
  return false;
}

export default function TasksList({ currentRole }: { currentRole: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [openProjects, setOpenProjects] = useState<Set<string>>(new Set());
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const isPrivileged = currentRole === "Admin" || currentRole === "Executive";

  async function loadTasks() {
    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email || null;
    setMyEmail(email);

    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) setErrorMsg(error.message);
    else setTasks(data || []);
    setLoading(false);
  }

  useEffect(() => {
    loadTasks();
  }, []);

  function toggleProject(name: string) {
    setOpenProjects((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  if (loading) return <p style={{ color: SLATE }}>Loading tasks…</p>;
  if (errorMsg) return <p style={{ color: "red" }}>Error loading tasks: {errorMsg}</p>;

  const scopedTasks = isPrivileged
    ? tasks
    : tasks.filter((t) => t.assigned_to_email && t.assigned_to_email === myEmail);

  if (scopedTasks.length === 0) {
    return <p style={{ color: SLATE, fontSize: "13px" }}>No assignments yet.</p>;
  }

  const completedCount = scopedTasks.filter((t) => t.status === "Completed").length;
  const visibleTasks = showCompleted
    ? scopedTasks
    : scopedTasks.filter((t) => t.status !== "Completed");

  // Group by normalised project (merges whitespace / blank variants)
  const groups = new Map<string, Task[]>();
  for (const t of visibleTasks) {
    const key = normaliseProject(t.project);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  const projectNames = Array.from(groups.keys()).sort((a, b) => {
    const aRed = groups.get(a)!.some(isRed) ? 1 : 0;
    const bRed = groups.get(b)!.some(isRed) ? 1 : 0;
    if (aRed !== bRed) return bRed - aRed;
    return a.localeCompare(b);
  });

  const totalActive = scopedTasks.filter(
    (t) => t.status !== "Completed" && t.status !== "Cancelled"
  ).length;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", flexWrap: "wrap", gap: "8px" }}>
        <h2 style={{ fontSize: "14px", fontWeight: 700, color: NAVY, margin: 0, paddingLeft: "9px", borderLeft: `3px solid ${NAVY}` }}>
          All Tasks {isPrivileged ? "" : "(yours)"} · {totalActive} active
        </h2>
        {completedCount > 0 && (
          <button
            onClick={() => setShowCompleted((v) => !v)}
            style={{ fontSize: "12px", fontWeight: 600, color: NAVY, backgroundColor: "white", border: `1px solid ${BORDER}`, borderRadius: "6px", padding: "5px 11px", cursor: "pointer" }}
          >
            {showCompleted ? "Hide completed" : `Show completed (${completedCount})`}
          </button>
        )}
      </div>

      <div style={{ border: `1px solid ${BORDER}`, borderRadius: "8px", backgroundColor: "white", overflow: "hidden" }}>
        {projectNames.map((projectName, pIndex) => {
          const projectTasks = groups.get(projectName)!;
          const isOpen = openProjects.has(projectName);
          const redCount = projectTasks.filter(isRed).length;
          const activeCount = projectTasks.filter(
            (t) => t.status !== "Completed" && t.status !== "Cancelled"
          ).length;

          return (
            <div key={projectName} style={{ borderTop: pIndex === 0 ? "none" : `1px solid ${BORDER}` }}>
              {/* Project row */}
              <div
                onClick={() => toggleProject(projectName)}
                style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", cursor: "pointer", backgroundColor: "#f8fafc" }}
              >
                <span style={{ width: "18px", height: "18px", display: "inline-flex", alignItems: "center", justifyContent: "center", border: `1px solid ${BORDER}`, borderRadius: "4px", fontSize: "13px", fontWeight: 700, color: NAVY, backgroundColor: "white" }}>
                  {isOpen ? "−" : "+"}
                </span>
                <span style={{ fontSize: "13px", fontWeight: 700, color: NAVY }}>{projectName}</span>
                <span style={{ fontSize: "12px", color: SLATE }}>· {activeCount} active</span>
                {redCount > 0 && (
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "white", backgroundColor: "#dc2626", borderRadius: "10px", padding: "2px 8px" }}>
                    {redCount} need attention
                  </span>
                )}
              </div>

              {/* Tasks within project */}
              {isOpen && (
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <tbody>
                    {projectTasks.map((task) => {
                      const taskOpen = expandedTaskId === task.id;
                      return (
                        <React.Fragment key={task.id}>
                          <tr
                            onClick={() => setExpandedTaskId(taskOpen ? null : task.id)}
                            style={{ cursor: "pointer", backgroundColor: taskOpen ? "#f8fafc" : "white" }}
                          >
                            <td style={{ ...td, paddingLeft: "42px", fontWeight: 600, color: NAVY, maxWidth: "420px" }}>
                              {task.description}
                            </td>
                            <td style={td}>{task.priority || "—"}</td>
                            <td style={td}>{task.assigned_to || "—"}</td>
                            <td style={td}>{formatDateUK(task.due_date)}</td>
                            <td style={td}>
                              <span style={{ fontSize: "11px", fontWeight: 700, padding: "3px 9px", borderRadius: "10px", color: "white", backgroundColor: statusColor(task.status), whiteSpace: "nowrap" }}>
                                {task.status}
                              </span>
                            </td>
                          </tr>

                          {taskOpen && (
                            <tr>
                              <td colSpan={5} style={{ ...td, backgroundColor: "#f8fafc", padding: "14px 16px 14px 42px" }}>
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
                                  <div style={{ padding: "10px 12px", border: "1px solid #bbf7d0", backgroundColor: "#f0fdf4", borderRadius: "8px", color: "#166534", fontSize: "13px", marginBottom: "8px" }}>
                                    <strong>Explanation:</strong> {task.reply_text}
                                    {task.corrective_action && (
                                      <div style={{ marginTop: "5px" }}><strong>Corrective action:</strong> {task.corrective_action}</div>
                                    )}
                                    {task.recovery_date && (
                                      <div style={{ marginTop: "5px" }}><strong>Expected recovery:</strong> {formatDateUK(task.recovery_date)}</div>
                                    )}
                                    <div style={{ marginTop: "5px", fontSize: "11px" }}>
                                      By {task.reply_by || "unknown"} {task.reply_at ? `on ${formatDateUK(task.reply_at)}` : ""}
                                    </div>
                                  </div>
                                )}

                                <TaskStatus task={task} currentRole={currentRole} onChanged={loadTasks} />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const td: React.CSSProperties = {
  borderBottom: `1px solid #f1f5f9`,
  padding: "8px 10px",
  fontSize: "13px",
  verticalAlign: "top",
};
