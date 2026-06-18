"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { formatDateUK } from "./dateUtils";
import { COLOURS, SectionTitle, StatusBadge } from "./SharedUI";

type UserTask = {
  id: string;
  description: string;
  due_date: string | null;
  priority: string | null;
  status: string;
};

export default function MyTasks() {
  const [tasks, setTasks] = useState<UserTask[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) { setLoaded(true); return; }

      const { data: member } = await supabase
        .from("members").select("first_name, last_name, name")
        .eq("email", user.email).maybeSingle();

      if (!member) { setLoaded(true); return; }

      const userName = `${member.first_name || ""} ${member.last_name || ""}`.trim() || member.name || user.email;

      const { data } = await supabase
        .from("tasks")
        .select("id, description, due_date, priority, status")
        .eq("assigned_to", userName)
        .not("status", "in", '("Completed","Cancelled")')
        .order("due_date", { ascending: true })
        .limit(10);

      setTasks(data || []);
      setLoaded(true);
    }
    load();
  }, []);

  if (!loaded || tasks.length === 0) return null;

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <SectionTitle title={`Your Tasks (${tasks.length})`} />
      <div style={{
        border: `1px solid ${COLOURS.BORDER}`,
        borderRadius: "8px",
        backgroundColor: "white",
        overflow: "hidden",
        marginBottom: "14px",
      }}>
        {tasks.map((t) => {
          const overdue = t.due_date && t.due_date < today;
          return (
            <a key={t.id} href="/tasks" style={{ textDecoration: "none", display: "block", borderBottom: `1px solid ${COLOURS.BORDER}`, padding: "7px 12px", backgroundColor: overdue ? "#fef2f2" : undefined }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY, minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.description}
                </div>
                <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0 }}>
                  {t.due_date && (
                    <span style={{ fontSize: "13px", color: overdue ? COLOURS.RED : COLOURS.SLATE, fontWeight: overdue ? 700 : 400 }}>
                      {formatDateUK(t.due_date)}
                    </span>
                  )}
                  <StatusBadge status={t.status} />
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </>
  );
}
