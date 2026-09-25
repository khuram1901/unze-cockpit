"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabase";
import { COLOURS, RADII } from "../lib/SharedUI";

const { NAVY, SLATE, HAIRLINE, RED, AMBER, CARD_ALT } = COLOURS;
const RED_SOFT   = "#F8E4E2";
const AMBER_SOFT = "#FBF1DE";

type EscalatedTask = {
  task_id: string;
  description: string;
  assigned_to: string;
  priority: string;
  status: string;
  due_date: string;
  hours_overdue: number;
  escalation_level: number;
  department: string | null;
};

export default function EscalationAlertSection() {
  const [tasks, setTasks]     = useState<EscalatedTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .rpc("get_my_escalated_tasks")
      .then(({ data, error }) => {
        if (!error && data) setTasks(data as EscalatedTask[]);
        setLoading(false);
      });
  }, []);

  if (loading) return null;

  if (tasks.length === 0) {
    return (
      <div style={{
        border: "1.5px solid #D1FAE5",
        borderRadius: RADII.CARD,
        padding: "12px 16px",
        marginTop: "16px",
        background: "#F0FDF4",
        display: "flex",
        alignItems: "center",
        gap: "8px",
      }}>
        <span style={{ fontSize: "13px", fontWeight: 600, color: "#0F7B5F" }}>
          ✓ No escalated tasks — all caught up
        </span>
      </div>
    );
  }

  const l1 = tasks.filter((t) => t.escalation_level === 1);
  const l2 = tasks.filter((t) => t.escalation_level === 2);
  const l3 = tasks.filter((t) => t.escalation_level === 3);

  const levelBadge = (label: string, count: number, urgent: boolean) =>
    count === 0 ? null : (
      <span style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        fontSize: "11px",
        fontWeight: 700,
        color: urgent ? RED : AMBER,
        background: urgent ? RED_SOFT : AMBER_SOFT,
        borderRadius: "99px",
        padding: "2px 8px",
      }}>
        {label}: {count}
      </span>
    );

  return (
    <div style={{
      border: `1.5px solid ${RED}`,
      borderRadius: RADII.CARD,
      overflow: "hidden",
      marginTop: "16px",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 16px",
        background: RED_SOFT,
        borderBottom: `1px solid ${HAIRLINE}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "14px", fontWeight: 700, color: RED }}>
            ⚠ Escalated Tasks
          </span>
          <span style={{
            fontSize: "11px",
            fontWeight: 800,
            color: "white",
            background: RED,
            borderRadius: "99px",
            padding: "1px 7px",
          }}>
            {tasks.length}
          </span>
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          {levelBadge("L1", l1.length, true)}
          {levelBadge("L2", l2.length, true)}
          {levelBadge("L3", l3.length, false)}
        </div>
      </div>

      {/* Task rows — show up to 5 */}
      <div style={{ background: CARD_ALT }}>
        {tasks.slice(0, 5).map((t) => (
          <div
            key={t.task_id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 16px",
              borderBottom: `1px solid ${HAIRLINE}`,
              gap: "8px",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: "13px",
                fontWeight: 600,
                color: NAVY,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}>
                {t.description}
              </div>
              <div style={{ fontSize: "11px", color: SLATE, marginTop: "2px" }}>
                {t.assigned_to} · {t.department ?? "—"}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
              <span style={{
                fontSize: "11px",
                fontWeight: 700,
                color: t.escalation_level === 3 ? AMBER : RED,
                background: t.escalation_level === 3 ? AMBER_SOFT : RED_SOFT,
                borderRadius: "99px",
                padding: "2px 7px",
              }}>
                L{t.escalation_level}
              </span>
              <span style={{ fontSize: "11px", color: RED, fontWeight: 600 }}>
                {Math.round(t.hours_overdue)}h overdue
              </span>
            </div>
          </div>
        ))}
        {tasks.length > 5 && (
          <div style={{ padding: "8px 16px", fontSize: "12px", color: SLATE }}>
            + {tasks.length - 5} more escalated task{tasks.length - 5 !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: "8px 16px",
        background: RED_SOFT,
        borderTop: `1px solid ${HAIRLINE}`,
        textAlign: "right",
      }}>
        <Link
          href="/tasks"
          style={{ fontSize: "12px", fontWeight: 700, color: RED, textDecoration: "none" }}
        >
          View all tasks →
        </Link>
      </div>
    </div>
  );
}
