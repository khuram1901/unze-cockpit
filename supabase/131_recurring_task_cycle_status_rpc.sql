-- 131: Recurring Tasks — next occurrence + missed-cycle tracking (15 Jul 2026,
-- Khuram's request). Per Khuram's choice, this is the "quick version": pure
-- date math off the template's own schedule (frequency/day_of_week/
-- day_of_month/last_created_at) for next_due_date, with no new link column
-- between a template and the task rows the cron has generated from it.
--
-- missed_cycles still needs to look at real task rows though — "has this
-- been done" can only be answered by the generated tasks' status, not the
-- template alone. Rather than add a migration to link them, this reuses
-- columns createTaskCore already writes on every cron-generated task
-- (task_type = 'Recurring', same description/assigned_to_email/company_id
-- as the template) to find that template's own instances and count how
-- many are still open past their due date. Same rule-0 pattern as every
-- other dashboard count: computed here, not in the browser.
--
-- Apply manually via the Supabase SQL Editor, per project convention.

create or replace function get_recurring_task_cycle_status(p_today date)
returns table (
  id uuid,
  next_due_date date,
  missed_cycles int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tmpl record;
  computed_next date;
  dow int;
begin
  for tmpl in
    select r.id, r.frequency, r.day_of_week, r.day_of_month, r.last_created_at,
           r.description, r.assigned_to_email, r.company_id
    from recurring_tasks r
  loop
    -- ── Next occurrence, from the template's own schedule ──
    if tmpl.frequency = 'daily' then
      if tmpl.last_created_at is not null and tmpl.last_created_at::date = p_today then
        computed_next := p_today + 1;
      else
        computed_next := p_today;
      end if;

    elsif tmpl.frequency = 'weekly' then
      dow := extract(dow from p_today)::int;
      computed_next := p_today + (((coalesce(tmpl.day_of_week, 1) - dow) + 7) % 7);
      if computed_next = p_today and tmpl.last_created_at is not null and tmpl.last_created_at::date = p_today then
        computed_next := computed_next + 7;
      end if;

    elsif tmpl.frequency = 'monthly' then
      -- This month's occurrence if it hasn't passed yet, else next month's.
      computed_next := make_date(extract(year from p_today)::int, extract(month from p_today)::int, least(coalesce(tmpl.day_of_month, 1), 28));
      if computed_next < p_today or (computed_next = p_today and tmpl.last_created_at is not null and tmpl.last_created_at::date = p_today) then
        computed_next := make_date(extract(year from computed_next)::int, extract(month from computed_next)::int, 1) + interval '1 month';
        computed_next := make_date(extract(year from computed_next)::int, extract(month from computed_next)::int, least(coalesce(tmpl.day_of_month, 1), 28));
      end if;

    else
      computed_next := null;
    end if;

    return query
      select tmpl.id, computed_next,
        (select count(*)::int from tasks t
         where t.task_type = 'Recurring'
           and t.description = tmpl.description
           and t.assigned_to_email is not distinct from tmpl.assigned_to_email
           and t.company_id is not distinct from tmpl.company_id
           and t.status not in ('Completed', 'Cancelled')
           and t.due_date is not null and t.due_date < p_today);
  end loop;
end;
$$;

grant execute on function get_recurring_task_cycle_status(date) to authenticated;
