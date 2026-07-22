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
  assignedToEmail: string | null | undefined,
  // Khuram (17/07/2026): a self-created task doesn't need a manager in
  // the loop at all — Submitted is just a label for it, not a handoff.
  // Defaults to true so every existing call site keeps its old behaviour
  // unless it explicitly knows the task is self-created (see migration
  // 143 for the matching DB-side guard on route_submitted_task()).
  requiresManagerSignoff: boolean = true
): Promise<Record<string, unknown>> {
  if (!requiresManagerSignoff) return {};
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

// ── Waiting Reply routing ─────────────────────────────────────────────────
//
// When someone sets a task to "Waiting Reply" they can tag a specific person
// whose reply they need. If they don't tag anyone, the task routes to their
// reporting-line manager (same chain-walk logic as routeSubmittedTask).
//
// The current assignee's details are captured in waiting_reply_by_email/name
// so the reply-to person can hand the task straight back.
//
// explicitReplyToEmail — the person the asker explicitly tagged (optional).
//   When supplied, skip the manager chain walk and go directly to them.
//
type MemberRow = {
  id: string; name: string; email: string | null;
  department: string | null; business_unit: string | null;
  is_active: boolean | null; manager_id: string | null;
};

async function findActiveManager(startMemberId: string): Promise<MemberRow | null> {
  let nextId: string | null = startMemberId;
  const seen = new Set<string>();
  for (let hop = 0; hop < 10 && nextId && !seen.has(nextId); hop++) {
    seen.add(nextId);
    const { data } = await supabase
      .from("members")
      .select("id, name, email, department, business_unit, is_active, manager_id")
      .eq("id", nextId)
      .maybeSingle() as { data: MemberRow | null; error: unknown };
    if (!data?.email) break;
    if (data.is_active !== false) return data;
    nextId = data.manager_id;
  }
  return null;
}

export async function routeWaitingReplyTask(
  taskId: string,
  currentAssignedTo: string | null | undefined,
  currentAssignedToEmail: string | null | undefined,
  explicitReplyToEmail: string | null | undefined,
): Promise<Record<string, unknown>> {
  if (!currentAssignedToEmail) return {};

  let target: MemberRow | null = null;

  if (explicitReplyToEmail) {
    // Route to the explicitly tagged person
    const { data } = await supabase
      .from("members")
      .select("id, name, email, department, business_unit, is_active, manager_id")
      .ilike("email", explicitReplyToEmail)
      .maybeSingle();
    if (data?.email && data.is_active !== false) target = data as MemberRow;
  }

  if (!target) {
    // No explicit person (or they're inactive) — walk up the reporting line
    const { data: me } = await supabase
      .from("members")
      .select("manager_id, role")
      .ilike("email", currentAssignedToEmail)
      .maybeSingle();
    if (!me?.manager_id) return {}; // top of chain — no one to route to
    target = await findActiveManager(me.manager_id);
  }

  if (!target?.email) return {};

  await supabase.from("task_assignees").delete().eq("task_id", taskId);
  await supabase.from("task_assignees").insert({
    task_id: taskId, member_id: target.id,
    member_name: target.name, member_email: target.email,
  });

  return {
    assigned_to: target.name,
    assigned_to_email: target.email,
    assigned_to_department: target.department,
    assigned_to_business_unit: target.business_unit,
    // Capture who was waiting so the reply-to person can hand it back
    waiting_reply_by_email: currentAssignedToEmail,
    waiting_reply_by_name: currentAssignedTo,
  };
}

// Called when the reply-to person clicks "Reply & Return".
// Routes the task back to the person who set "Waiting Reply".
export async function returnFromWaitingReply(
  taskId: string,
  waitingReplyByEmail: string | null | undefined,
): Promise<Record<string, unknown>> {
  if (!waitingReplyByEmail) return {};

  const { data: original } = await supabase
    .from("members")
    .select("id, name, email, department, business_unit")
    .ilike("email", waitingReplyByEmail)
    .maybeSingle();

  if (!original?.email) return {};

  await supabase.from("task_assignees").delete().eq("task_id", taskId);
  await supabase.from("task_assignees").insert({
    task_id: taskId, member_id: original.id,
    member_name: original.name, member_email: original.email,
  });

  return {
    assigned_to: original.name,
    assigned_to_email: original.email,
    assigned_to_department: original.department,
    assigned_to_business_unit: original.business_unit,
    // Clear all waiting-reply routing fields
    waiting_reply_by_email: null,
    waiting_reply_by_name: null,
    waiting_reply_note: null,
    waiting_reply_to_email: null,
    waiting_reply_to_name: null,
    manager_reply_at: new Date().toISOString(),
  };
}
