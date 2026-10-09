-- Migration 251: get_my_escalated_tasks v3
-- Treats due_date + due_time as Pakistan Standard Time (Asia/Karachi = UTC+5).
-- Previously (migration 249) the timestamp was interpreted as UTC, causing
-- hours_overdue to be 5 hours too low. This fix uses AT TIME ZONE 'Asia/Karachi'
-- so the grace window is measured from the correct PKT moment.
-- COALESCE fallback: 09:00:00 PKT (beginning of business day).

CREATE OR REPLACE FUNCTION public.get_my_escalated_tasks()
RETURNS TABLE (
  task_id          uuid,
  description      text,
  assigned_to      text,
  assigned_to_email text,
  priority         text,
  status           text,
  due_date         date,
  due_time         time,
  hours_overdue    numeric,
  escalation_level integer,
  company_id       uuid,
  department       text
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$

  with recursive

  me as (
    select id, email, department, is_hod, role
    from members
    where email = (select auth.email())
      and is_active = true
    limit 1
  ),

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

  -- L1: tasks assigned directly to the viewer's direct reports
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
        now() - ((t.due_date::timestamp + coalesce(t.due_time, '09:00:00'::time))
                 AT TIME ZONE 'Asia/Karachi')
      )) / 3600.0)::numeric, 1
    ) as hours_overdue,
    1 as escalation_level,
    t.company_id,
    t.assigned_to_department
  from tasks t
  join members a on a.email = t.assigned_to_email and a.is_active = true
  join thresholds th on th.tier = case
    when t.priority in ('Normal', 'Medium') then 'Normal'
    when t.priority in ('Urgent', 'High')   then 'Urgent'
    when t.priority = 'Critical'            then 'Critical'
    else 'Normal'
  end
  , me
  where t.status not in ('Completed', 'Cancelled', 'Submitted')
    and t.escalation_exempt = false
    and t.due_date is not null
    and t.priority not in ('Low')
    and a.manager_id = me.id
    and (extract(epoch from (
      now() - ((t.due_date::timestamp + coalesce(t.due_time, '09:00:00'::time))
               AT TIME ZONE 'Asia/Karachi')
    )) / 3600.0) >= th.l1_h

  union all

  -- L2: HOD sees entire department reporting chain
  select
    t.id, t.description, t.assigned_to, t.assigned_to_email,
    t.priority, t.status, t.due_date, t.due_time,
    round(
      (extract(epoch from (
        now() - ((t.due_date::timestamp + coalesce(t.due_time, '09:00:00'::time))
                 AT TIME ZONE 'Asia/Karachi')
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
    else 'Normal'
  end
  join my_reports mr on mr.id = a.id
  , me
  where t.status not in ('Completed', 'Cancelled', 'Submitted')
    and t.escalation_exempt = false
    and t.due_date is not null
    and t.priority not in ('Low')
    and me.is_hod = true
    and (extract(epoch from (
      now() - ((t.due_date::timestamp + coalesce(t.due_time, '09:00:00'::time))
               AT TIME ZONE 'Asia/Karachi')
    )) / 3600.0) >= th.l2_h

  union all

  -- L3: CEO / Director sees all org-wide escalations
  select
    t.id, t.description, t.assigned_to, t.assigned_to_email,
    t.priority, t.status, t.due_date, t.due_time,
    round(
      (extract(epoch from (
        now() - ((t.due_date::timestamp + coalesce(t.due_time, '09:00:00'::time))
                 AT TIME ZONE 'Asia/Karachi')
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
    else 'Normal'
  end
  join my_reports mr on mr.id = a.id
  , me
  where t.status not in ('Completed', 'Cancelled', 'Submitted')
    and t.escalation_exempt = false
    and t.due_date is not null
    and t.priority not in ('Low')
    and me.role in ('CEO', 'Director')
    and (extract(epoch from (
      now() - ((t.due_date::timestamp + coalesce(t.due_time, '09:00:00'::time))
               AT TIME ZONE 'Asia/Karachi')
    )) / 3600.0) >= th.l3_h

  order by escalation_level asc, hours_overdue desc;
$$;
