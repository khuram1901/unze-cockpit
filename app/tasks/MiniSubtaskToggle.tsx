"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";
import { COLOURS, RADII } from "../lib/SharedUI";

// The two-ways-into-subtasks pattern from the finalised mockup: click the
// task to open the full detail modal, OR click this small caret for a
// quick tick-off right on the row/card without opening anything. Both
// read and write the same task_subtasks rows (via onChanged, which
// refetches the parent task list), so — unlike the static mockup, which
// honestly flagged its inline and full-panel checklists as separate demo
// copies that wouldn't match — these always agree with each other.

type Subtask = { id: string; title: string; is_complete: boolean; position: number };
type Task = { id: string; task_subtasks?: { id: string; is_complete: boolean }[] };

export default function MiniSubtaskToggle({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newTitle, setNewTitle] = useState("");

  const embeddedTotal = task.task_subtasks?.length ?? 0;
  const embeddedDone = task.task_subtasks?.filter((s) => s.is_complete).length ?? 0;
  const total = loaded ? subtasks.length : embeddedTotal;
  const done = loaded ? subtasks.filter((s) => s.is_complete).length : embeddedDone;

  if (total === 0 && !open) return null;

  async function load() {
    const { data } = await supabase.from("task_subtasks").select("id, title, is_complete, position").eq("task_id", task.id).order("position", { ascending: true });
    setSubtasks(data || []);
    setLoaded(true);
  }

  async function toggleOne(sub: Subtask) {
    await supabase.from("task_subtasks").update({ is_complete: !sub.is_complete }).eq("id", sub.id);
    await load();
    onChanged();
  }

  async function addOne() {
    const title = newTitle.trim();
    if (!title) return;
    await supabase.from("task_subtasks").insert({ task_id: task.id, title, position: subtasks.length });
    setNewTitle("");
    await load();
    onChanged();
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ padding: "5px 16px 8px 16px", borderTop: total > 0 ? `1px solid ${COLOURS.HAIRLINE}` : "none", backgroundColor: COLOURS.CARD }}
    >
      <div
        onClick={() => { const next = !open; setOpen(next); if (next && !loaded) load(); }}
        style={{ cursor: "pointer", fontSize: "10.5px", fontWeight: 600, color: COLOURS.SLATE, display: "flex", alignItems: "center", gap: "5px" }}
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>Subtasks</span>
        <span style={{ fontSize: "10.5px", fontWeight: 700, color: COLOURS.SLATE, backgroundColor: COLOURS.TRACK, borderRadius: RADII.XS, padding: "1px 7px" }}>
          {done}/{total}
        </span>
      </div>
      {open && (
        <div style={{ marginTop: "6px" }}>
          {subtasks.map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "3px 0" }}>
              <input type="checkbox" checked={s.is_complete} onChange={() => toggleOne(s)} style={{ width: "14px", height: "14px", accentColor: COLOURS.GREEN, cursor: "pointer" }} />
              <span style={{ fontSize: "12.5px", color: s.is_complete ? COLOURS.SLATE : COLOURS.NAVY, textDecoration: s.is_complete ? "line-through" : "none" }}>{s.title}</span>
            </div>
          ))}
          <div style={{ display: "flex", gap: "6px", marginTop: "5px" }}>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOne(); } }}
              placeholder="Add a subtask…"
              style={{ flex: 1, border: `1px solid ${COLOURS.HAIRLINE}`, borderRadius: RADII.SM, padding: "5px 8px", fontSize: "12px", color: COLOURS.NAVY }}
            />
            <button onClick={addOne} style={{ border: `1px solid ${COLOURS.HAIRLINE}`, backgroundColor: COLOURS.CARD_ALT, borderRadius: RADII.SM, padding: "5px 10px", fontSize: "11.5px", fontWeight: 600, color: COLOURS.NAVY, cursor: "pointer" }}>+</button>
          </div>
        </div>
      )}
    </div>
  );
}
