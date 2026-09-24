-- Migration 248: get_my_escalated_tasks() RPC
-- Returns tasks that have escalated to the calling user based on their position
-- in the management hierarchy and the task's overdue duration + priority tier.
--
-- Active priority model (post-rationalisation):
--   Critical  →  6 h / 12 h / 60 h   (L1 / L2 / L3)
--   Urgent    → 24 h / 48 h / 120 h
--   Normal    → 48 h / 96 h / 216 h
--   Low       → NOT escalated at all  (excluded from this RPC)
--
-- Legacy values that may exist on older tasks:
--   High   → treated as Urgent  (retired)
--   Medium → treated as Normal  (retired)
--
-- Escalation levels:
--   Level 1 → the assignee's direct manager (manager_id)
--   Level 2 → HOD found in the assignee's manager chain (is_hod = true).
--             Chain membership (my_reports) is the authority — NOT department text.
--             This prevents cross-company false-positives from shared dept names.
--   Level 3 → CEO or Director found within the assignee's manager chain.
--             Scoped via my_reports — NOT a global broadcast.
--             Executive role intentionally excluded.
--
-- Exclusions:
--   · priority = 'Low'            (never escalates)
--   · due_time IS NULL            (no escalation without a due time)
--   · status IN (Completed, Cancelled, Submitted)
--   · escalation_exempt = true
--
-- Schema notes (discovered during first apply):
--   · members has no is_director column — Director is a role value
--   · tasks has no department column — use assigned_to_department
--   · The function body avoids CTEs referencing computed-column aliases
--     in ORDER BY (PostgreSQL WITH RECURSIVE limitation); hours_overdue
--     is aliased explicitly in the first SELECT of the UNION ALL.

begin;

create or replace function public.get_my_escalated_tasks()
returns table (
  task_id            uuid,
  description        text,
  assigned_to        text,
  assigned_to_email  text,
  priority           text,
  status             text,
  due_date           date,
  due_time           time,
  hours_overdue      numeric,
  escalation_level   int,
  company_id         uuid,
  department         text
)
language sql
stable
security definer
set search_path = public
as $$
  with recursive

  me as (
    select id, email, department, is_hod, role
    from members
    where email = (select auth.email())
      and is_active = true
    limit 1
  ),

  -- Downward chain from me.
  -- Used for L2 (HOD) and L3 (Director/CEO) scoping.
  -- Chain membership is the authority — no department text used at any level.
  -- Depth guard (< 15) protects against circular manager_id data.
  my_reports as (
    select m.id, 1 as depth
    from members m
    where m.manager_id = (select id from me limit 1)
      and m.is_active = true
    union all
    select m.id, r.depth + 1
    from members m
    join my_reports r on m.manager_id = r.id
    where m.is_active = true
      and r.depth < 15
  ),

  thresholds(tier, l1_h, l2_h, l3_h) as (
    values
      ('Normal'::text,   48,  96, 216),
      ('Urgent'::text,   24,  48, 120),
      ('Critical'::text,  6,  12,  60)
  )

  -- Level 1: caller is the assignee's direct manager
  select
    t.id                                                              as task_id,
    t.description,
    t.assigned_to,
    t.assigned_to_email,
    t.priority,
    t.status,
    t.due_date,
    t.due_time,
    round((extract(epoch from (now() - (t.due_date::timestamptz + t.due_time))) / 3600.0)::numeric, 1)
                                                                      as hours_overdue,
    1                                                                 as escalation_level,
    t.company_id,
    t.assigned_to_department                                          as department
  from tasks t
  join members a on a.email = t.assigned_to_email and a.is_active = true
  join thresholds th on th.tier = case
    when t.priority in ('Normal', 'Medium') then 'Normal'
    when t.priority in ('Urgent', 'High')   then 'Urgent'
    when t.priority = 'Critical'            then 'Critical'
  end
  , me
  where t.status not in ('Completed', 'Cancelled', 'Submitted')
    and t.escalation_exempt = false
    and t.due_date is not null
    and t.due_time is not null
    and t.priority != 'Low'
    and coalesce(t.priority, 'Normal') != 'Low'
    and a.manager_id = me.id
    and (extract(epoch from (now() - (t.due_date::timestamptz + t.due_time))) / 3600.0) >= th.l1_h

  union all

  -- Level 2: caller is HOD and the assignee is within their reporting chain.
  -- Chain membership (my_reports) is the authority — no department text used.
  -- Prevents cross-company false-positives from shared department names.
  select
    t.id,
    t.description,
    t.assigned_to,
    t.assigned_to_email,
    t.priority,
    t.status,
    t.due_date,
    t.due_time,
    round((extract(epoch from (now() - (t.due_date::timestamptz + t.due_time))) / 3600.0)::numeric, 1),
    2,
    t.company_id,
    t.assigned_to_department
  from tasks t
  join members a on a.email = t.assigned_to_email and a.is_active = true
  join thresholds th on th.tier = case
    when t.priority in ('Normal', 'Medium') then 'Normal'
    when t.priority in ('Urgent', 'High')   then 'Urgent'
    when t.priority = 'Critical'            then 'Critical'
  end
  join my_reports mr on mr.id = a.id
  , me
  where t.status not in ('Completed', 'Cancelled', 'Submitted')
    and t.escalation_exempt = false
    and t.due_date is not null
    and t.due_time is not null
    and t.priority != 'Low'
    and coalesce(t.priority, 'Normal') != 'Low'
    and me.is_hod = true
    and (extract(epoch from (now() - (t.due_date::timestamptz + t.due_time))) / 3600.0) >= th.l2_h

  union all

  -- Level 3: caller is CEO or Director and the assignee is within their chain.
  -- Scoped via my_reports — not a global broadcast.
  -- Executive role intentionally excluded from L3.
  select
    t.id,
    t.description,
    t.assigned_to,
    t.assigned_to_email,
    t.priority,
    t.status,
    t.due_date,
    t.due_time,
    round((extract(epoch from (now() - (t.due_date::timestamptz + t.due_time))) / 3600.0)::numeric, 1),
    3,
    t.company_id,
    t.assigned_to_department
  from tasks t
  join members a on a.email = t.assigned_to_email and a.is_active = true
  join thresholds th on th.tier = case
    when t.priority in ('Normal', 'Medium') then 'Normal'
    when t.priority in ('Urgent', 'High')   then 'Urgent'
    when t.priority = 'Critical'            then 'Critical'
  end
  join my_reports mr on mr.id = a.id
  , me
  where t.status not in ('Completed', 'Cancelled', 'Submitted')
    and t.escalation_exempt = false
    and t.due_date is not null
    and t.due_time is not null
    and t.priority != 'Low'
    and coalesce(t.priority, 'Normal') != 'Low'
    and me.role in ('CEO', 'Director')
    and (extract(epoch from (now() - (t.due_date::timestamptz + t.due_time))) / 3600.0) >= th.l3_h

  order by escalation_level asc, hours_overdue desc;
$$;

grant execute on function public.get_my_escalated_tasks() to authenticated;

commit;
