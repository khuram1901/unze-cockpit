-- 150_audit_merge_legacy.sql
-- Khuram (18/07/2026): remove legacy audit_plan_items that duplicate the annual
-- plan; merge the rest into audit_plan_processes. After this the legacy section
-- disappears from the audit page — one structure for everything.
--
-- Duplicates (progress carried into the existing plan project, then removed):
--   UTPL P&L 3rd Q (60% Draft Findings), HD P&L 3rd Q (30% Data Verification),
--   BRNH P&L 3rd Q (20% Data Collection), IFPL P&L 2nd Q (30% Data Verification),
--   UTPL cash count completed 30/06 (already Completed in plan) and the planned
--   07/07 cycle (becomes the plan project's new cycle, target 20/07).
-- Merged as new projects: HD P&L 1st Q (done), IFPL P&L 1st Q (90%),
--   HD P&L 2nd Q (30%), BRNH P&L 2nd Q (30%), plus ad-hoc: Office supplies SAP
--   (IFPL, done), PF withdrawal SOP (UTPL, done), Cash payments audit (UTPL 30%),
--   Fixed asset audit (UTPL 90%), Sales audit 2025-26 (UTPL 30%).

-- Allow ad-hoc projects
alter table audit_plan_processes drop constraint if exists audit_plan_processes_frequency_check;
alter table audit_plan_processes add constraint audit_plan_processes_frequency_check
  check (frequency in ('Daily basis','Monthly','Quarterly','Semi-annually','Annually','Ad-hoc'));

-- === Helper mapping for this migration only ===
create or replace function _stage_no(p_stage text) returns int language sql immutable as $$
  select case p_stage
    when 'Audit Planning' then 1
    when 'Data Collection' then 2
    when 'Data Verification' then 3
    when 'Draft Audit Findings' then 4
    when 'Review of IA Report' then 5
    when 'Communication to Process Owner' then 6
    when 'Submission to Senior Management' then 7
    else 1 end;
$$;

-- === 1. Carry progress into the four duplicate P&L plan projects ===
do $mig$
declare
  r record; v_proc uuid; v_stage int;
begin
  for r in
    select * from (values
      ('UTPL', '3rd Quarter', 4),  -- legacy: Draft Audit Findings
      ('HD',   '3rd Quarter', 3),  -- legacy: Data Verification
      ('BRNH', '3rd Quarter', 2),  -- legacy: Data Collection
      ('IFPL', '2nd Quarter', 3)   -- legacy: Data Verification
    ) as v(short_code, period, cur_stage)
  loop
    select p.id into v_proc
      from audit_plan_processes p join companies c on c.id = p.company_id
     where c.short_code = r.short_code and p.period_label = r.period
       and p.process_name ilike '%P&L%' limit 1;
    if v_proc is null then continue; end if;
    v_stage := r.cur_stage;

    update audit_stage_tasks set status = 'Completed',
           started_at = coalesce(started_at, now()), completed_at = coalesce(completed_at, now()),
           updated_at = now()
     where process_id = v_proc and stage_no < v_stage and status <> 'Completed';
    update audit_stage_tasks set status = 'In Progress',
           started_at = coalesce(started_at, now()), completed_at = null, updated_at = now()
     where process_id = v_proc and stage_no = v_stage and status <> 'In Progress';
    update audit_plan_processes set status = 'In Progress', updated_at = now() where id = v_proc;
  end loop;
end $mig$;

-- === 2. UTPL Monthly cash count: the legacy "planned 07/07" row becomes the new cycle ===
do $mig$
declare v_proc uuid;
begin
  select p.id into v_proc
    from audit_plan_processes p join companies c on c.id = p.company_id
   where c.short_code = 'UTPL' and p.process_name ilike 'Monthly cash count%' limit 1;
  if v_proc is not null then
    update audit_stage_tasks set status = 'Not Started', started_at = null, completed_at = null, updated_at = now()
     where process_id = v_proc;
    update audit_plan_processes
       set status = 'Planned', target_date = '2026-07-20',
           status_note = 'Head Office count — Amina', updated_at = now()
     where id = v_proc;
  end if;
end $mig$;

-- === 3. Merge the nine non-duplicate legacy audits as plan projects ===
do $mig$
declare
  m record; v_company uuid; v_sno int; v_proc uuid; v_stage int; v_post text; v_done boolean;
begin
  for m in
    select * from (values
      ('HD',   'Financial Audit - P&L Audit', '1st Quarter', 'Quarterly', 'Submission to Senior Management', true,  null::date,        '2026-05-31'::date),
      ('IFPL', 'Financial Audit - P&L Audit', '1st Quarter', 'Quarterly', 'Communication to Process Owner',  false, '2026-04-01'::date, '2026-07-31'::date),
      ('HD',   'Financial Audit - P&L Audit', '2nd Quarter', 'Quarterly', 'Data Verification',               false, '2026-07-01'::date, '2026-07-31'::date),
      ('BRNH', 'Financial Audit - P&L Audit', '2nd Quarter', 'Quarterly', 'Data Verification',               false, '2026-07-01'::date, '2026-07-31'::date),
      ('IFPL', 'Office supplies recording in SAP and inventory count', null, 'Ad-hoc', 'Submission to Senior Management', true, null, '2026-07-05'::date),
      ('UTPL', 'PF withdrawal SOP', null, 'Ad-hoc', 'Submission to Senior Management', true, null, '2026-06-30'::date),
      ('UTPL', 'Cash payments audit', null, 'Ad-hoc', 'Data Verification', false, '2026-05-01'::date, '2026-07-31'::date),
      ('UTPL', 'Fixed asset audit', null, 'Ad-hoc', 'Communication to Process Owner', false, '2026-05-01'::date, '2026-07-20'::date),
      ('UTPL', 'Sales audit (2025-26)', null, 'Ad-hoc', 'Data Verification', false, '2026-06-01'::date, '2026-07-31'::date)
    ) as v(short_code, pname, period, freq, cur_stage, is_done, started, target)
  loop
    select id into v_company from companies where short_code = m.short_code;
    -- skip if already merged (idempotency)
    if exists (select 1 from audit_plan_processes where company_id = v_company
                and process_name = m.pname and coalesce(period_label,'') = coalesce(m.period,'')) then
      continue;
    end if;
    select coalesce(max(s_no), 0) + 1 into v_sno from audit_plan_processes where company_id = v_company;
    v_stage := _stage_no(m.cur_stage);
    v_done := m.is_done;
    v_post := case m.short_code when 'UTPL' then 'Amina' when 'IFPL' then 'Junaid' else 'Khizar' end;

    insert into audit_plan_processes (company_id, s_no, process_name, frequency, period_label, status, target_date, status_note)
    values (v_company, v_sno, m.pname, m.freq, m.period,
            case when v_done then 'Completed' else 'In Progress' end,
            m.target, 'Merged from pre-plan audit records')
    returning id into v_proc;

    insert into audit_stage_tasks (process_id, stage_no, stage_label, responsible, sort_order, status, started_at, completed_at)
    select v_proc, n, case n when 1 then 'Audit Planning' when 2 then 'Data Collection'
                             when 3 then 'Data Verification' when 4 then 'Draft Audit Findings'
                             when 5 then 'Review of IA Report' when 6 then 'Communication to Process Owner'
                             else 'Submission to Senior Management' end,
           case when n in (1,5,6,7) then 'Shahid' else v_post end,
           n,
           case when v_done or n < v_stage then 'Completed'
                when n = v_stage then 'In Progress'
                else 'Not Started' end,
           case when v_done or n <= v_stage then coalesce(m.started, now())::timestamptz end,
           case when v_done or n < v_stage then coalesce(m.target, current_date)::timestamptz end
      from generate_series(1, 7) n;
  end loop;
end $mig$;

drop function if exists _stage_no(text);

-- === 4. Remove the legacy records (all now represented in the plan) ===
delete from audit_findings;   -- table is empty in production; safety for re-runs
delete from audit_plan_items;

-- === 5. Department KPI counts: audit branch now reads audit_plan_processes ===
-- (audit_plan_items is empty after the merge; the Department Scorecard and the
-- audit department health card must count the annual plan instead.)
create or replace function get_department_kpi_counts(
  p_slug text,
  p_department_name text,
  p_company_id uuid,
  p_today date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if p_slug = 'audit' then
    select jsonb_build_object(
      'planned',        count(*) filter (where p.status = 'Planned'),
      'in_progress',    count(*) filter (where p.status = 'In Progress'),
      'completed',      count(*) filter (where p.status = 'Completed'),
      'overdue',        count(*) filter (where p.status not in ('Completed', 'Cancelled') and p.target_date is not null and p.target_date < p_today),
      'avg_completion', round(coalesce(avg(
        case when p.status = 'Completed' then 100
             when coalesce(t.total_days, 0) > 0 then 100.0 * coalesce(t.done_days, 0) / t.total_days
             else 0 end
      ) filter (where p.status <> 'Cancelled'), 0))
    )
    into result
    from audit_plan_processes p
    left join lateral (
      select sum(coalesce(total_days, 0)) as total_days,
             sum(coalesce(total_days, 0)) filter (where status = 'Completed') as done_days
      from audit_stage_tasks where process_id = p.id
    ) t on true
    where p.company_id = p_company_id;

  elsif p_slug = 'hr' then
    select jsonb_build_object(
      'open',      count(*) filter (where status in ('Open', 'Interviewing')),
      'filled',    count(*) filter (where status = 'Filled'),
      'long_open', count(*) filter (where status in ('Open', 'Interviewing') and date_opened is not null and (p_today - date_opened) > 60),
      'total',     count(*)
    )
    into result
    from recruitment_positions
    where company_id = p_company_id;

  elsif p_slug = 'taxation' then
    select jsonb_build_object(
      'pending',       count(*) filter (where resolution_status = 'pending'),
      'hearing_soon',  count(*) filter (where resolution_status = 'pending' and hearing_deadline is not null and hearing_deadline >= p_today and hearing_deadline < p_today + 7),
      'high_exposure', count(*) filter (where resolution_status = 'pending' and financial_exposure > 500000),
      'resolved',      count(*) filter (where resolution_status <> 'pending')
    )
    into result
    from legal_notices
    where company_id = p_company_id;

  elsif p_slug in ('admin', 'it', 'ops') then
    select jsonb_build_object(
      'open',      count(*) filter (where status not in ('Completed', 'Cancelled')),
      'overdue',   count(*) filter (where status not in ('Completed', 'Cancelled') and due_date is not null and due_date < p_today),
      'completed', count(*) filter (where status = 'Completed'),
      'total',     count(*)
    )
    into result
    from tasks
    where assigned_to_department = p_department_name;

  else
    result := '{}'::jsonb;
  end if;

  return result;
end;
$$;

grant execute on function get_department_kpi_counts(text, text, uuid, date) to authenticated;
