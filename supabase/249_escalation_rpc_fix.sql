-- Migration 249: Fix get_my_escalated_tasks() — honour tasks with no due_time
--
-- Bug: The previous version required `due_time IS NOT NULL`. As of 2026-10-09,
-- 903 of 1033 tasks have no due_time (only due_date). Those tasks could never
-- escalate, so managers/CEOs saw 0 escalations despite many overdue items.
--
-- Fix: Replace `due_time IS NOT NULL` guards with COALESCE(due_time, '23:59:59').
-- A task with only a due_date is treated as due at 23:59:59 on that day, so
-- overdue hours start accumulating from the end of the due date.

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

  -- Downward chain from me — used for L2/L3 scoping.
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
    round(
      (extract(epoch from (
        now() - (t.due_date::timestamptz + coalesce(t.due_time, '23:59:59'::time))
      )) / 3600.0)::numeric, 1
    )                                                                 as hours_overdue,
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
    and t.priority != 'Low'
    and coalesce(t.priority, 'Normal') != 'Low'
    and a.manager_id = me.id
    and (extract(epoch from (
      now() - (t.due_date::timestamptz + coalesce(t.due_time, '23:59:59'::time))
    )) / 3600.0) >= th.l1_h

  union all

  -- Level 2: caller is HOD and the assignee is within their reporting chain.
  select
    t.id,
    t.description,
    t.assigned_to,
    t.assigned_to_email,
    t.priority,
    t.status,
    t.due_date,
    t.due_time,
    round(
      (extract(epoch from (
        now() - (t.due_date::timestamptz + coalesce(t.due_time, '23:59:59'::time))
      )) / 3600.0)::numeric, 1
    ),
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
    and t.priority != 'Low'
    and coalesce(t.priority, 'Normal') != 'Low'
    and me.is_hod = true
    and (extract(epoch from (
      now() - (t.due_date::timestamptz + coalesce(t.due_time, '23:59:59'::time))
    )) / 3600.0) >= th.l2_h

  union all

  -- Level 3: caller is CEO or Director and the assignee is within their chain.
  select
    t.id,
    t.description,
    t.assigned_to,
    t.assigned_to_email,
    t.priority,
    t.status,
    t.due_date,
    t.due_time,
    round(
      (extract(epoch from (
        now() - (t.due_date::timestamptz + coalesce(t.due_time, '23:59:59'::time))
      )) / 3600.0)::numeric, 1
    ),
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
    and t.priority != 'Low'
    and coalesce(t.priority, 'Normal') != 'Low'
    and me.role in ('CEO', 'Director')
    and (extract(epoch from (
      now() - (t.due_date::timestamptz + coalesce(t.due_time, '23:59:59'::time))
    )) / 3600.0) >= th.l3_h

  order by escalation_level asc, hours_overdue desc;
$$;

grant execute on function public.get_my_escalated_tasks() to authenticated;

commit;
