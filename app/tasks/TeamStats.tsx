"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { COLOURS, RADII, cardStyle } from "../lib/SharedUI";

type TeamRow = {
  person_name: string;
  person_email: string | null;
  open_count: number;
  overdue_count: number;
  completed_count: number;
  on_time_rate: number | null;
};

// Aggregation happens entirely in the get_tasks_team_stats() RPC (see
// supabase/101_task_summary_rpcs.sql) — this component only renders
// what the database already computed, per house rule 0.
export default function TeamStats() {
  const [rows, setRows] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    supabase.rpc("get_tasks_team_stats").then(({ data, error }) => {
      if (error) setErrorMsg(error.message);
      else setRows(data || []);
      setLoading(false);
    });
  }, []);

  if (loading) return <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>Loading team performance…</p>;
  if (errorMsg) return <p style={{ color: COLOURS.RED, fontSize: "13px" }}>Error loading team stats: {errorMsg}</p>;
  if (rows.length === 0) return <p style={{ color: COLOURS.SLATE, fontSize: "13px" }}>No task data to show yet.</p>;

  return (
    <div style={{ ...cardStyle, overflow: "hidden", padding: 0, marginBottom: "14px" }}>
      <div style={{
        display: "grid", gridTemplateColumns: "1.6fr 0.7fr 0.7fr 0.7fr 1fr", gap: "10px",
        padding: "10px 16px", backgroundColor: COLOURS.CARD_ALT, borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
        fontSize: "10.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: COLOURS.SLATE,
      }}>
        <div>Person</div><div>Open</div><div>Overdue</div><div>Completed</div><div>On-time rate</div>
      </div>
      {rows.map((r) => (
        <div key={r.person_email || r.person_name} style={{
          display: "grid", gridTemplateColumns: "1.6fr 0.7fr 0.7fr 0.7fr 1fr", gap: "10px",
          padding: "11px 16px", borderBottom: `1px solid ${COLOURS.HAIRLINE}`, alignItems: "center",
        }}>
          <div style={{ fontSize: "13.5px", fontWeight: 600, color: COLOURS.NAVY }}>{r.person_name}</div>
          <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY }}>{r.open_count}</div>
          <div style={{ fontSize: "15px", fontWeight: 600, color: r.overdue_count > 0 ? COLOURS.RED : COLOURS.GREEN }}>{r.overdue_count}</div>
          <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY }}>{r.completed_count}</div>
          <div style={{ fontSize: "13px", color: r.on_time_rate === null ? COLOURS.INK_400 : r.on_time_rate >= 80 ? COLOURS.GREEN : r.on_time_rate >= 50 ? COLOURS.AMBER : COLOURS.RED, fontWeight: 600 }}>
            {r.on_time_rate === null ? "No completions yet" : `${r.on_time_rate}%`}
          </div>
        </div>
      ))}
      <div style={{ padding: "10px 16px", fontSize: "11.5px", color: COLOURS.SLATE, borderRadius: `0 0 ${RADII.CARD} ${RADII.CARD}` }}>
        On-time rate = tasks completed on or before their original due date, out of all their completed tasks. Only counts tasks completed since the completion-date tracking (migration 098) went live — earlier completions were backfilled from their last-edited timestamp as a best available estimate.
      </div>
    </div>
  );
}
