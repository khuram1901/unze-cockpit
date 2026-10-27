"use client";
import React, { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { authFetch as authedFetch } from "../lib/supabase";
import { formatDateUK } from "../lib/dateUtils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface InboxComment {
  id: string;
  comment_text: string;
  commented_by: string | null;
  commented_by_email: string | null;
  created_at: string;
}

interface InboxTask {
  task_id: string;
  task_title: string;
  task_status: string;
  last_comment_at: string;
  comments: InboxComment[] | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return formatDateUK(iso.slice(0, 10));
}

function initials(name: string | null, email: string | null): string {
  if (name) {
    const parts = name.trim().split(" ");
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return (email?.[0] ?? "?").toUpperCase();
}

const AVATAR_COLOURS = [
  "#0F7B5F", "#B4791F", "#B3261E", "#64748B", "#0F1720",
  "#2563EB", "#7C3AED", "#DB2777",
];
function avatarColour(email: string | null): string {
  if (!email) return "#64748B";
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) & 0xffff;
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface Props {
  open: boolean;
  onClose: () => void;
  userEmail: string;
  userName: string;
  onCommentPosted?: () => void;
}

export default function CommentsInboxPanel({ open, onClose, userEmail, userName, onCommentPosted }: Props) {
  const [tasks, setTasks] = useState<InboxTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [posting, setPosting] = useState<Record<string, boolean>>({});
  const [mounted, setMounted] = useState(false);

  // Portal needs document to exist (client-side only)
  useEffect(() => { setMounted(true); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/api/tasks/comments-inbox");
      if (res.ok) {
        const json = await res.json();
        const loadedTasks: InboxTask[] = json.tasks ?? [];
        setTasks(loadedTasks);
        // Mark every task as read the moment the inbox opens —
        // this clears the bell badge even if the user doesn't reply.
        for (const t of loadedTasks) {
          authedFetch(`/api/tasks/${t.task_id}/mark-comments-read`, { method: "POST" }).catch(() => {});
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
    else setTasks([]);
  }, [open, load]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  async function handleReply(task: InboxTask) {
    const text = (replies[task.task_id] ?? "").trim();
    if (!text) return;
    setPosting(p => ({ ...p, [task.task_id]: true }));

    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const supabaseAuth = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { global: { headers: { Authorization: `Bearer ${session.access_token}` } } }
      );

      const { error } = await supabaseAuth.from("task_comments").insert({
        task_id: task.task_id,
        comment_text: text,
        commented_by: userName || userEmail,
        commented_by_email: userEmail,
      });

      if (error) {
        console.error("CommentsInbox reply error:", error.message);
        return;
      }

      await authedFetch(`/api/tasks/${task.task_id}/mark-comments-read`, { method: "POST" }).catch(() => {});

      authedFetch(`/api/tasks/${task.task_id}/notify-comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commenterEmail: userEmail,
          commenterName: userName || userEmail,
          commentText: text,
        }),
      }).catch(() => {});

      setTasks(prev => prev.filter(t => t.task_id !== task.task_id));
      setReplies(r => { const n = { ...r }; delete n[task.task_id]; return n; });
      onCommentPosted?.();

    } finally {
      setPosting(p => ({ ...p, [task.task_id]: false }));
    }
  }

  function handleOpenTask(taskId: string) {
    window.location.href = `/tasks?task=${taskId}`;
    onClose();
  }

  if (!open || !mounted) return null;

  const panelContent = (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(15,23,32,0.25)",
          zIndex: 9998,
        }}
      />

      {/* Panel — rendered directly into document.body via Portal */}
      <div style={{
        position: "fixed",
        top: 0, right: 0, bottom: 0,
        width: 440,
        background: "#FFFFFF",
        borderLeft: "1.5px solid #EEF0F3",
        display: "flex",
        flexDirection: "column",
        boxShadow: "-8px 0 32px rgba(15,23,32,0.12)",
        zIndex: 9999,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: "#0F1720",
        fontSize: 14,
      }}>

        {/* Header */}
        <div style={{
          padding: "18px 20px 14px",
          borderBottom: "1.5px solid #EEF0F3",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          background: "#FFFFFF",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#0F1720" }}>Comments Inbox</span>
            {tasks.length > 0 && (
              <span style={{
                background: "#B3261E", color: "#fff",
                fontSize: 11, fontWeight: 700,
                padding: "2px 8px", borderRadius: 10,
                lineHeight: "18px",
              }}>
                {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28,
              border: "none", background: "none",
              cursor: "pointer", color: "#64748B",
              fontSize: 18, borderRadius: 6,
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: 0, minHeight: 0,
            }}
          >✕</button>
        </div>

        {/* Scrollable body */}
        <div style={{
          flex: 1,
          overflowY: "auto",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          minHeight: 0,
        }}>

          {loading && (
            <div style={{ textAlign: "center", padding: 40, color: "#64748B", fontSize: 13 }}>
              Loading…
            </div>
          )}

          {!loading && tasks.length === 0 && (
            <div style={{ textAlign: "center", padding: "48px 24px" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0F1720", marginBottom: 6 }}>All caught up</div>
              <div style={{ fontSize: 13, color: "#64748B" }}>No new comments on your tasks.</div>
            </div>
          )}

          {tasks.map(task => {
            const comments = Array.isArray(task.comments) ? task.comments : [];
            return (
              <div key={task.task_id} style={{
                border: "1.5px solid #EEF0F3",
                borderRadius: 10,
                background: "#FFFFFF",
              }}>

                {/* Task header */}
                <div style={{
                  padding: "11px 14px 9px",
                  background: "#F8F9FB",
                  borderBottom: "1.5px solid #EEF0F3",
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 8,
                  borderRadius: "8px 8px 0 0",
                }}>
                  <span style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#0F1720",
                    lineHeight: "1.35",
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {task.task_title}
                  </span>
                  <button
                    onClick={() => handleOpenTask(task.task_id)}
                    style={{
                      fontSize: 11,
                      color: "#64748B",
                      background: "none",
                      border: "1px solid #EEF0F3",
                      borderRadius: 5,
                      padding: "3px 8px",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                      minHeight: 0,
                      lineHeight: "16px",
                      height: "auto",
                    }}
                  >
                    Open task ↗
                  </button>
                </div>

                {/* Comments list */}
                {comments.length > 0 && (
                  <div style={{
                    padding: "10px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    background: "#FFFFFF",
                  }}>
                    {comments.map((c) => (
                      <div key={c.id} style={{
                        display: "flex",
                        flexDirection: "row",
                        gap: 9,
                        alignItems: "flex-start",
                        minHeight: 0,
                      }}>
                        {/* Unread dot */}
                        <div style={{
                          width: 7,
                          height: 7,
                          background: "#B3261E",
                          borderRadius: "50%",
                          flexShrink: 0,
                          marginTop: 8,
                        }} />
                        {/* Avatar */}
                        <div style={{
                          width: 28,
                          height: 28,
                          borderRadius: "50%",
                          background: avatarColour(c.commented_by_email),
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#FFFFFF",
                          flexShrink: 0,
                          lineHeight: 1,
                        }}>
                          {initials(c.commented_by, c.commented_by_email)}
                        </div>
                        {/* Text body */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            display: "flex",
                            flexDirection: "row",
                            alignItems: "baseline",
                            gap: 6,
                            marginBottom: 3,
                          }}>
                            <span style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: "#0F1720",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}>
                              {c.commented_by || c.commented_by_email || "Unknown"}
                            </span>
                            <span style={{ fontSize: 11, color: "#64748B", whiteSpace: "nowrap" }}>
                              {timeAgo(c.created_at)}
                            </span>
                          </div>
                          <div style={{
                            fontSize: 13,
                            color: "#0F1720",
                            lineHeight: "1.45",
                            wordBreak: "break-word",
                            whiteSpace: "pre-wrap",
                          }}>
                            {c.comment_text}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Reply box */}
                <div style={{
                  padding: "9px 14px 12px",
                  borderTop: "1.5px solid #EEF0F3",
                  display: "flex",
                  flexDirection: "row",
                  gap: 8,
                  alignItems: "flex-end",
                  background: "#FFFFFF",
                  borderRadius: "0 0 8px 8px",
                }}>
                  <div style={{
                    flex: 1,
                    border: `1.5px solid ${replies[task.task_id] ? "#0F7B5F" : "#EEF0F3"}`,
                    borderRadius: 8,
                    background: replies[task.task_id] ? "#FFFFFF" : "#F8F9FB",
                    overflow: "hidden",
                  }}>
                    <textarea
                      value={replies[task.task_id] ?? ""}
                      onChange={e => setReplies(r => ({ ...r, [task.task_id]: e.target.value }))}
                      onKeyDown={e => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          handleReply(task);
                        }
                      }}
                      placeholder="Reply… (⌘↵ to send)"
                      rows={1}
                      style={{
                        display: "block",
                        width: "100%",
                        border: "none",
                        background: "transparent",
                        padding: "8px 10px",
                        fontSize: 13,
                        color: "#0F1720",
                        resize: "none",
                        outline: "none",
                        fontFamily: "inherit",
                        minHeight: 36,
                        maxHeight: 80,
                        lineHeight: "1.4",
                        boxSizing: "border-box",
                      }}
                      onInput={e => {
                        const el = e.currentTarget;
                        el.style.height = "auto";
                        el.style.height = Math.min(el.scrollHeight, 80) + "px";
                      }}
                    />
                  </div>
                  <button
                    onClick={() => handleReply(task)}
                    disabled={!replies[task.task_id]?.trim() || posting[task.task_id]}
                    style={{
                      width: 34,
                      height: 34,
                      background: posting[task.task_id] ? "#64748B" : "#0F7B5F",
                      border: "none",
                      borderRadius: 8,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      opacity: !replies[task.task_id]?.trim() ? 0.4 : 1,
                      minHeight: 0,
                      padding: 0,
                    }}
                  >
                    {posting[task.task_id] ? (
                      <span style={{ color: "#fff", fontSize: 11 }}>…</span>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13"/>
                        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                      </svg>
                    )}
                  </button>
                </div>

              </div>
            );
          })}
        </div>
      </div>
    </>
  );

  return createPortal(panelContent, document.body);
}
