"use client";

import { supabase } from "./supabase";

// Khuram: "every time a task is submitted, it should go to their HOD...
// it should now become part of their task to review the work." This used
// to live only inside TaskStatus.tsx's status dropdown, so any other
// surface that could flip a task to "Submitted" — the bulk "Change
// status" dropdown and the Kanban board's drag-and-drop (both in
// TasksList.tsx / TasksBoard.tsx) — silently skipped it: the task stayed
// assigned to whoever submitted it, so it never showed up on the
// manager's own My Tasks and nobody could close it. Pulled out here so
// every one of those surfaces calls the exact same logic.
//
// Looks up the current owner's manager and reassigns the task to them.
// Returns {} (no reassignment) when the owner has no manager on file
// (e.g. Khuram/Kamran at the top of the chain) or is the Executive
// (closes her own tasks directly, per Khuram).
//
// Found during the 15 Jul 2026 full-app audit: if manager_id pointed to
// someone who'd since been offboarded (is_active = false), the task
// still got routed to them — and since inactive members are filtered
// out of every picker in the app (task #166), the task became invisible
// and effectively stuck forever. Khuram's decision: skip up the chain
// to that manager's own manager, repeating until an active one is
// found. Capped at 10 hops as a guard against a bad/circular manager_id
// chain in the data; if the chain runs out or loops, falls back to no
// reassignment (same as "no manager on file") rather than routing
// somewhere wrong.
export async function routeSubmittedTask(
  taskId: string,
  assignedTo: string | null | undefined,
  assignedToEmail: string | null | undefined
): Promise<Record<string, unknown>> {
  if (!assignedToEmail) return {};
  const { data: me } = await supabase.from("members").select("manager_id, role").eq("email", assignedToEmail).maybeSingle();
  if (!me?.manager_id || me.role === "Executive") return {};

  let mgr: { id: string; name: string; email: string | null; department: string | null; business_unit: string | null; is_active: boolean | null; manager_id: string | null } | null = null;
  let nextId: string | null = me.manager_id;
  const seen = new Set<string>();
  for (let hop = 0; hop < 10 && nextId && !seen.has(nextId); hop++) {
    seen.add(nextId);
    const { data: candidate } = await supabase
      .from("members")
      .select("id, name, email, department, business_unit, is_active, manager_id")
      .eq("id", nextId)
      .maybeSingle();
    if (!candidate?.email) break;
    if (candidate.is_active !== false) { mgr = candidate; break; }
    nextId = candidate.manager_id;
  }
  if (!mgr?.email) return {};

  await supabase.from("task_assignees").delete().eq("task_id", taskId);
  await supabase.from("task_assignees").insert({ task_id: taskId, member_id: mgr.id, member_name: mgr.name, member_email: mgr.email });
  return {
    assigned_to: mgr.name,
    assigned_to_email: mgr.email,
    assigned_to_department: mgr.department,
    assigned_to_business_unit: mgr.business_unit,
    submitted_by_name: assignedTo,
    submitted_by_email: assignedToEmail,
  };
}
