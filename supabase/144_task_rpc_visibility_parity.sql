-- 144_task_rpc_visibility_parity.sql
--
-- Follow-up to 142 (manager-hierarchy task visibility). Found while
-- re-checking that work: the tasks_select RLS policy is what TasksList.tsx's
-- main row-fetching query relies on, and 142 correctly widened that policy.
-- But three "security definer" RPCs the same page also calls -- for the
-- KPI stat strip, the department breakdown drawer, and the Team tab --
-- run with elevated privilege and do their OWN hand-written visibility
-- check inside the function body instead of going through RLS at all.
-- That hand-written check was already missing the co-assignee clause
-- (is_task_assignee) that RLS has had since migration 112, and now also
-- lacks the manager-hierarchy clause added in 142 -- so a manager's KPI
-- tiles and (especially) the Team tab, which exists specifically to let a
-- manager review their team, silently excluded their own direct reports'
-- tasks even though the List/Board/Tree views right next to them (on the
-- same page) now show those same tasks correctly.
--
-- This brings all three back in line with the real tasks_select policy:
-- can_access_all_tasks() OR assigned_to_email = me OR assigned_by = my name
-- OR is_task_assignee(id) OR is_manager_of_assignee(assigned_to_email).
-- Same signatures as before, so create-or-replace genuinely replaces
-- these in place (no arg-count change, unlike the pnl_* overload issue).

create or replace function public.get_tasks_kpi_summary(p_company_id uuid default null::uuid, p_group_only boolean default false)
returns table(open_count bigint, overdue_count bigint, due_today_count bigint, waiting_reply_count bigint, stuck_count bigint, completed_count bigint, urgent_open_count bigint)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    count(*) filter (where status not in ('Completed', 'Cancelled')) as open_count,
    count(*) filter (where status not in ('Completed', 'Cancelled') and due_date < current_date) as overdue_count,
    count(*) filter (where status not in ('Completed', 'Cancelled') and due_date = current_date) as due_today_count,
    count(*) filter (where status = 'Waiting Reply') as waiting_reply_count,
    count(*) filter (where status = 'Stuck') as stuck_count,
    count(*) filter (where status = 'Completed') as completed_count,
    count(*) filter (where status not in ('Completed', 'Cancelled') and priority = 'Urgent') as urgent_open_count
  from public.tasks
  where
    (
      can_access_all_tasks()
      or assigned_to_email = (select auth.email())
      or assigned_by = (select m.name from public.members m where m.email = (select auth.email()))
      or is_task_assignee(id)
      or is_manager_of_assignee(assigned_to_email)
    )
    and (
      (p_group_only and company_id is null)
      or (not p_group_only and p_company_id is not null and company_id = p_company_id)
      or (not p_group_only and p_company_id is null)
    );
$$;

create or replace function public.get_tasks_department_breakdown()
returns table(department text, open_count bigint, overdue_count bigint)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    coalesce(assigned_to_department, project, 'Unassigned') as department,
    count(*) filter (where status not in ('Completed', 'Cancelled')) as open_count,
    count(*) filter (where status not in ('Completed', 'Cancelled') and due_date < current_date) as overdue_count
  from public.tasks
  where
    can_access_all_tasks()
    or assigned_to_email = (select auth.email())
    or assigned_by = (select m.name from public.members m where m.email = (select auth.email()))
    or is_task_assignee(id)
    or is_manager_of_assignee(assigned_to_email)
  group by coalesce(assigned_to_department, project, 'Unassigned')
  order by overdue_count desc, open_count desc;
$$;

create or replace function public.get_tasks_team_stats()
returns table(person_name text, person_email text, open_count bigint, overdue_count bigint, completed_count bigint, on_time_rate numeric)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    coalesce(assigned_to, 'Unassigned') as person_name,
    assigned_to_email as person_email,
    count(*) filter (where status not in ('Completed', 'Cancelled')) as open_count,
    count(*) filter (where status not in ('Completed', 'Cancelled') and due_date < current_date) as overdue_count,
    count(*) filter (where status = 'Completed') as completed_count,
    round(
      100.0 * count(*) filter (
        where status = 'Completed'
          and completed_at is not null
          and completed_at::date <= coalesce(original_due_date, due_date)
      )
      / nullif(count(*) filter (where status = 'Completed' and completed_at is not null), 0),
      0
    ) as on_time_rate
  from public.tasks
  where
    can_access_all_tasks()
    or assigned_to_email = (select auth.email())
    or assigned_by = (select m.name from public.members m where m.email = (select auth.email()))
    or is_task_assignee(id)
    or is_manager_of_assignee(assigned_to_email)
  group by coalesce(assigned_to, 'Unassigned'), assigned_to_email
  order by overdue_count desc, open_count desc;
$$;
