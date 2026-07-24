"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { COLOURS, RADII, cardStyle } from "../lib/SharedUI";

// ── Workload scoreboard (Khuram, 24/07/2026) ─────────────────────────────
// "we need to create filters where i can see which tasks are outstanding
// by the teams, department, per person". One row per department, expandable
// to its people, with Open / Overdue / Stuck / Waiting / Submitted counts.
// Clicking any count drills into the List view filtered to exactly those
// tasks (via onDrill, wired up in TasksList).
//
// All aggregation happens in get_task_workload() (migration 191) — a single
// round-trip returns department rollups AND person rows via GROUPING SETS,
// per house rule 0. This component only renders and sorts for display.

type WorkloadRow = {
  is_department: boolean;
  department: string;
  person_name: string | null;
  person_email: string | null;
  open_count: number;
  overdue_count: number;
  stuck_count: number;
  waiting_count: number;
  submitted_count: number;
  oldest_overdue_days: number | null;
  on_time_rate: number | null;
};

export type WorkloadDrill = {
  department?: string;
  owner?: string;
  status?: string;
  due?: "overdue";
};

export default function TeamStats({ onDrill }: { onDrill?: (d: WorkloadDrill) => void }) {
  const [rows, setRows] = useState<WorkloadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());

  useEffect(() => {
    supabase.rpc("get_task_workload").then(({ data, error }) => {
      if (error) setErrorMsg(error.message);
      else setRows(data || []);
      setLoading(false);
    });
  }, []);

  if (loading) return <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>Loading workload…</p>;
  if (errorMsg) return <p style={{ color: COLOURS.RED, fontSize: "13px" }}>Error loading workload: {errorMsg}</p>;
  if (rows.length === 0) return <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No task data to show yet.</p>;

  // Group person rows under their department rollup. Sorting for display
  // only — no numbers are computed here.
  const deptRollups = rows.filter((r) => r.is_department).sort((a, b) => b.overdue_count - a.overdue_count || b.open_count - a.open_count);
  const peopleByDept = new Map<string, WorkloadRow[]>();
  for (const r of rows) {
    if (r.is_department) continue;
    if (!peopleByDept.has(r.department)) peopleByDept.set(r.department, []);
    peopleByDept.get(r.department)!.push(r);
  }

  function toggleDept(dept: string) {
    setExpandedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept); else next.add(dept);
      return next;
    });
  }

  const GRID = "minmax(150px, 1.8fr) 0.7fr 0.7fr 0.7fr 0.7fr 0.8fr 1fr";

  function CountCell({ value, colour, drill, bold }: { value: number; colour: string; drill?: WorkloadDrill; bold?: boolean }) {
    const clickable = !!onDrill && value > 0 && !!drill;
    return (
      <div
        onClick={clickable ? () => onDrill!(drill!) : undefined}
        title={clickable ? "Show these tasks" : undefined}
        style={{
          fontSize: "14.5px", fontWeight: bold ? 700 : 600,
          color: value === 0 ? COLOURS.INK_400 : colour,
          cursor: clickable ? "pointer" : "default",
          textDecoration: clickable ? "underline" : "none",
          textDecorationColor: clickable ? COLOURS.HAIRLINE : undefined,
          textUnderlineOffset: "3px",
        }}
      >
        {value}
      </div>
    );
  }

  return (
    <div style={{ ...cardStyle, overflow: "hidden", padding: 0, marginBottom: "14px" }}>
      <div style={{
        display: "grid", gridTemplateColumns: GRID, gap: "8px",
        padding: "10px 16px", backgroundColor: COLOURS.CARD_ALT, borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
        fontSize: "10.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: COLOURS.SLATE,
      }}>
        <div>Department / Person</div><div>Open</div><div>Overdue</div><div>Stuck</div><div>Waiting</div><div>Submitted</div><div>On-time rate</div>
      </div>

      {deptRollups.map((d) => {
        const people = (peopleByDept.get(d.department) || []);
        const isOpen = expandedDepts.has(d.department);
        return (
          <div key={d.department}>
            {/* Department rollup row */}
            <div style={{
              display: "grid", gridTemplateColumns: GRID, gap: "8px",
              padding: "11px 16px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, alignItems: "center",
              backgroundColor: d.overdue_count > 0 ? "#FDF6F5" : COLOURS.CARD,
            }}>
              <div
                onClick={() => toggleDept(d.department)}
                style={{ display: "flex", alignItems: "center", gap: "7px", cursor: "pointer", fontSize: "13.5px", fontWeight: 700, color: COLOURS.NAVY }}
              >
                <span style={{ fontSize: "10px", color: COLOURS.SLATE, display: "inline-block", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.12s" }}>▶</span>
                {d.department}
                {d.oldest_overdue_days != null && d.oldest_overdue_days > 0 && (
                  <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.RED }}>
                    · oldest {d.oldest_overdue_days}d overdue
                  </span>
                )}
              </div>
              <CountCell value={d.open_count} colour={COLOURS.NAVY} bold drill={{ department: d.department }} />
              <CountCell value={d.overdue_count} colour={COLOURS.RED} bold drill={{ department: d.department, due: "overdue" }} />
              <CountCell value={d.stuck_count} colour={COLOURS.AMBER} bold drill={{ department: d.department, status: "Stuck" }} />
              <CountCell value={d.waiting_count} colour={COLOURS.AMBER} bold drill={{ department: d.department, status: "Waiting Reply" }} />
              <CountCell value={d.submitted_count} colour={COLOURS.GREEN} bold drill={{ department: d.department, status: "Submitted" }} />
              <div style={{ fontSize: "12px", color: COLOURS.INK_400 }}>—</div>
            </div>

            {/* Person rows */}
            {isOpen && people.map((p) => (
              <div key={`${d.department}-${p.person_email || p.person_name}`} style={{
                display: "grid", gridTemplateColumns: GRID, gap: "8px",
                padding: "9px 16px 9px 36px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, alignItems: "center",
              }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY }}>
                  {p.person_name}
                  {p.oldest_overdue_days != null && p.oldest_overdue_days > 0 && (
                    <span style={{ fontSize: "11px", fontWeight: 600, color: COLOURS.RED, marginLeft: "6px" }}>
                      {p.oldest_overdue_days}d
                    </span>
                  )}
                </div>
                <CountCell value={p.open_count} colour={COLOURS.NAVY} drill={{ owner: p.person_name || undefined }} />
                <CountCell value={p.overdue_count} colour={COLOURS.RED} drill={{ owner: p.person_name || undefined, due: "overdue" }} />
                <CountCell value={p.stuck_count} colour={COLOURS.AMBER} drill={{ owner: p.person_name || undefined, status: "Stuck" }} />
                <CountCell value={p.waiting_count} colour={COLOURS.AMBER} drill={{ owner: p.person_name || undefined, status: "Waiting Reply" }} />
                <CountCell value={p.submitted_count} colour={COLOURS.GREEN} drill={{ owner: p.person_name || undefined, status: "Submitted" }} />
                <div style={{ fontSize: "12.5px", fontWeight: 600, color: p.on_time_rate === null ? COLOURS.INK_400 : p.on_time_rate >= 80 ? COLOURS.GREEN : p.on_time_rate >= 50 ? COLOURS.AMBER : COLOURS.RED }}>
                  {p.on_time_rate === null ? "—" : `${p.on_time_rate}%`}
                </div>
              </div>
            ))}
          </div>
        );
      })}

      <div style={{ padding: "10px 16px", fontSize: "11.5px", color: COLOURS.SLATE, borderRadius: `0 0 ${RADII.CARD} ${RADII.CARD}` }}>
        Click a department to expand its people; click any number to see those exact tasks. Departments with the most overdue tasks sort first. On-time rate = tasks completed on or before their original due date, out of all completed tasks (tracked since migration 098).
      </div>
    </div>
  );
}
