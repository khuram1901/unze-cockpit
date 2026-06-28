"use client";

import { useEffect, useState } from "react";
import { supabase, loadMyPermissions } from "./supabase";
import { formatDateUK } from "./dateUtils";
import { COLOURS, SectionTitle, StatusBadge, PriorityBadge } from "./SharedUI";
import { canSeeAllTasks, type UserCtx, type PermOverrides } from "./permissions";

type UserTask = {
  id: string;
  description: string;
  due_date: string | null;
  priority: string | null;
  status: string;
  assigned_to: string | null;
  assigned_to_department: string | null;
};

export default function MyTasks() {
  const [tasks, setTasks] = useState<UserTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);

  const [seeAll, setSeeAll] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) { setLoaded(true); return; }

      const { data: member } = await supabase
        .from("members").select("id, first_name, last_name, name, role, department, company")
        .eq("email", user.email).maybeSingle();

      if (!member) { setLoaded(true); return; }

      const name = `${member.first_name || ""} ${member.last_name || ""}`.trim() || member.name || user.email;
      setUserName(name);
      setRole(member.role);

      let overrides: PermOverrides | null = null;
      const p = await loadMyPermissions();
      if (p) overrides = p as PermOverrides;
      const ctx: UserCtx = { email: user.email, role: member.role, department: member.department, company: member.company, overrides };
      const canSeeAll = canSeeAllTasks(ctx);
      setSeeAll(canSeeAll);

      let query = supabase
        .from("tasks")
        .select("id, description, due_date, priority, status, assigned_to, assigned_to_department")
        .not("status", "in", '("Completed","Cancelled")')
        .order("due_date", { ascending: true });

      if (!canSeeAll) {
        query = query.eq("assigned_to", name);
      }

      const { data } = await query.limit(canSeeAll ? 30 : 15);
      setTasks(data || []);
      setLoaded(true);
    }
    load();
  }, []);

  if (!loaded || tasks.length === 0) return null;
  if (seeAll) return null;

  const today = new Date().toISOString().slice(0, 10);
  const title = `Your Tasks (${tasks.length})`;

  return (
    <>
      <SectionTitle title={title} />
      <div style={{
        border: `1px solid ${COLOURS.BORDER}`,
        borderRadius: "8px",
        backgroundColor: "var(--bg-card, #ffffff)",
        overflow: "hidden",
        marginBottom: "14px",
      }}>
        {tasks.map((t) => {
          const overdue = t.due_date && t.due_date < today;
          return (
            <a key={t.id} href="/tasks" style={{ textDecoration: "none", display: "block", borderBottom: `1px solid ${COLOURS.BORDER}`, padding: "7px 12px", backgroundColor: overdue ? "#fef2f2" : undefined }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                  <div style={{ fontSize: "15px", fontWeight: 600, color: COLOURS.NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.description}
                  </div>
                  {seeAll && (
                    <div style={{ fontSize: "12px", color: COLOURS.SLATE, marginTop: "1px" }}>
                      {t.assigned_to || "Unassigned"} {t.assigned_to_department ? `· ${t.assigned_to_department}` : ""}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0 }}>
                  {t.due_date && (
                    <span style={{ fontSize: "13px", color: overdue ? COLOURS.RED : COLOURS.SLATE, fontWeight: overdue ? 700 : 400 }}>
                      {formatDateUK(t.due_date)}
                    </span>
                  )}
                  <PriorityBadge priority={t.priority} />
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
