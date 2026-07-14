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
export async function routeSubmittedTask(
  taskId: string,
  assignedTo: string | null | undefined,
  assignedToEmail: string | null | undefined
): Promise<Record<string, unknown>> {
  if (!assignedToEmail) return {};
  const { data: me } = await supabase.from("members").select("manager_id, role").eq("email", assignedToEmail).maybeSingle();
  if (!me?.manager_id || me.role === "Executive") return {};
  const { data: mgr } = await supabase.from("members").select("id, name, email, department, business_unit").eq("id", me.manager_id).maybeSingle();
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
