-- 149_audit_pre_post_split.sql
-- Shahid's feedback (Recommendation.docx, 18/07/2026):
--  1. Teams restructured: post-audit is one member per company (Amina/Unze,
--     Junaid/Imperial, Khizar/Hospitality); Fraz, Attia and Abdul Rehman form a
--     new Pre-audit team. Post-audit project tasks reassigned to the post member.
--  2. Pre-audit becomes a daily measurable: count of unapproved documents
--     (PO / AP / Outgoing / Bank portal / JE) recorded at close of business,
--     target zero. New audit_daily_approval_log table + summary RPC (also feeds
--     an Executive Dashboard widget).
--  3. Merged quarterly P&L projects split into one project per quarter.
--  4. Legacy audit_plan_items wrongly tagged UTPL retagged by their titles.
--  5. Daily activities get an assigned audit member (Shahid assigns in-app).

-- === 1a. Teams restructure ===
do $mig$
declare
  t_unze uuid; t_imp uuid; t_rest uuid; t_pre uuid;
begin
  select id into t_unze from audit_teams where code = 'UNZE';
  select id into t_imp  from audit_teams where code = 'IMPERIAL';
  select id into t_rest from audit_teams where code = 'RESTAURANTS';

  update audit_teams set name = 'Post-audit — Unze Trading' where id = t_unze;
  update audit_teams set name = 'Post-audit — Imperial' where id = t_imp;
  update audit_teams set name = 'Post-audit — Hospitality' where id = t_rest;

  if not exists (select 1 from audit_teams where code = 'PREAUDIT') then
    insert into audit_teams (code, name, sort_order) values ('PREAUDIT', 'Pre-audit team', 4) returning id into t_pre;
  else
    select id into t_pre from audit_teams where code = 'PREAUDIT';
  end if;

  delete from audit_team_members;
  insert into audit_team_members (team_id, member_id)
  select t_unze, id from members where department = 'Audit' and regexp_replace(name, '\s+', ' ', 'g') = 'Amina Sikandar';
  insert into audit_team_members (team_id, member_id)
  select t_imp, id from members where department = 'Audit' and regexp_replace(name, '\s+', ' ', 'g') = 'Junaid Sheikh';
  insert into audit_team_members (team_id, member_id)
  select t_rest, id from members where department = 'Audit' and regexp_replace(name, '\s+', ' ', 'g') = 'Khizar Javiad';
  insert into audit_team_members (team_id, member_id)
  select t_pre, id from members where department = 'Audit' and regexp_replace(name, '\s+', ' ', 'g') in ('Muhammad Fraz', 'Attia Iftikhar', 'Abdul Rehman');
end $mig$;

-- === 1b. Post-audit task responsibles: working-level tasks go to the post member ===
-- Shahid keeps his stages (planning / review / communication / submission).
update audit_stage_tasks t
   set responsible = x.post_member, responsible_2 = null,
       days = t.total_days, days_2 = null
  from (
    select p.id as process_id,
           case c.short_code when 'UTPL' then 'Amina'
                             when 'IFPL' then 'Junaid'
                             else 'Khizar' end as post_member
      from audit_plan_processes p join companies c on c.id = p.company_id
  ) x
 where t.process_id = x.process_id
   and t.responsible is distinct from 'Shahid';

-- === 2. Daily unapproved-documents log ===
create table if not exists audit_daily_approval_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  log_date date not null default current_date,
  doc_type text not null check (doc_type in ('PO','AP','OUT','BANK','JE')),
  pending_count int not null default 0 check (pending_count >= 0),
  reason text,
  recorded_by text,
  created_at timestamptz not null default now(),
  unique (company_id, log_date, doc_type)
);
alter table audit_daily_approval_log enable row level security;
drop policy if exists "dept_access" on audit_daily_approval_log;
create policy "dept_access" on audit_daily_approval_log for all
  using (is_admin_or_exec() or get_user_department() = 'Audit')
  with check (is_admin_or_exec() or get_user_department() = 'Audit');

-- Daily activities: assigned audit member + doc_type mapping; now manager-editable
alter table audit_daily_activities add column if not exists assigned_member_id uuid references members(id);
alter table audit_daily_activities add column if not exists doc_type text
  check (doc_type in ('PO','AP','OUT','BANK','JE'));
drop policy if exists "mgr_write" on audit_daily_activities;
create policy "mgr_write" on audit_daily_activities for update
  using (is_audit_manager()) with check (is_audit_manager());

update audit_daily_activities set doc_type = case
  when activity ilike 'purchase order%' then 'PO'
  when activity ilike 'accounts payable%' then 'AP'
  when activity ilike 'outgoing%' then 'OUT'
  when activity ilike 'bank portal%' then 'BANK'
  when activity ilike 'journal entry%' then 'JE'
end where doc_type is null;

-- === 2b. Summary RPC (audit page + Executive Dashboard widget) ===
create or replace function audit_daily_log_summary()
returns jsonb language sql stable security definer set search_path = public as $$
select case
  when not (is_admin_or_exec() or get_user_department() = 'Audit')
  then jsonb_build_object('error', 'not_authorised')
  else (
    with expected as (
      select da.company_id, da.doc_type, da.activity, da.assigned_member_id,
             regexp_replace(m.name, '\s+', ' ', 'g') as assigned_name
        from audit_daily_activities da
        left join members m on m.id = da.assigned_member_id
       where da.doc_type is not null
    ),
    today as (
      select l.company_id, l.doc_type, l.pending_count, l.reason, l.recorded_by
        from audit_daily_approval_log l where l.log_date = current_date
    ),
    week as (
      select l.log_date, sum(l.pending_count) as total
        from audit_daily_approval_log l
       where l.log_date >= current_date - 6
       group by l.log_date
    )
    select jsonb_build_object(
      'as_of', current_date,
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'company_id', e.company_id, 'doc_type', e.doc_type, 'activity', e.activity,
          'assigned_member_id', e.assigned_member_id, 'assigned_name', e.assigned_name,
          'pending', t.pending_count, 'reason', t.reason, 'recorded_by', t.recorded_by,
          'entered', t.pending_count is not null
        ) order by e.company_id, e.doc_type) from expected e
        left join today t on t.company_id = e.company_id and t.doc_type = e.doc_type), '[]'::jsonb),
      'today_total', coalesce((select sum(pending_count) from today), 0),
      'entered_count', (select count(*) from today),
      'expected_count', (select count(*) from expected),
      'yesterday_total', coalesce((select sum(pending_count) from audit_daily_approval_log where log_date = current_date - 1), null),
      'week', coalesce((select jsonb_agg(jsonb_build_object('date', w.log_date, 'total', w.total) order by w.log_date) from week w), '[]'::jsonb)
    )
  ) end;
$$;
grant execute on function audit_daily_log_summary() to authenticated;

-- === 3. Split merged quarterly P&L projects ===
do $mig$
declare
  r record; new_id uuid; next_sno int;
begin
  for r in
    select p.id, p.company_id, p.s_no, p.process_name, p.reference_no, p.frequency,
           p.period_label, p.status, p.target_date, c.short_code
      from audit_plan_processes p join companies c on c.id = p.company_id
     where p.period_label in ('2nd, 3rd & 4th Quarter', '3rd & 4th Quarter')
  loop
    -- existing row becomes the earliest quarter, stays In Progress
    update audit_plan_processes
       set period_label = case when r.period_label = '2nd, 3rd & 4th Quarter' then '2nd Quarter' else '3rd Quarter' end
     where id = r.id;

    select coalesce(max(s_no), 0) + 1 into next_sno from audit_plan_processes where company_id = r.company_id;

    if r.period_label = '2nd, 3rd & 4th Quarter' then
      -- add 3rd and 4th quarter projects
      insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, target_date)
      values (r.company_id, next_sno, r.process_name, r.reference_no, r.frequency, '3rd Quarter', 'Planned', r.target_date)
      returning id into new_id;
      insert into audit_stage_tasks (process_id, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order)
      select new_id, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order
        from audit_stage_tasks where process_id = r.id;

      insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, target_date)
      values (r.company_id, next_sno + 1, r.process_name, r.reference_no, r.frequency, '4th Quarter', 'Planned', r.target_date)
      returning id into new_id;
      insert into audit_stage_tasks (process_id, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order)
      select new_id, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order
        from audit_stage_tasks where process_id = r.id;
    else
      -- '3rd & 4th Quarter' -> add 4th quarter project
      insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, target_date)
      values (r.company_id, next_sno, r.process_name, r.reference_no, r.frequency, '4th Quarter', 'Planned', r.target_date)
      returning id into new_id;
      insert into audit_stage_tasks (process_id, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order)
      select new_id, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order
        from audit_stage_tasks where process_id = r.id;
    end if;
  end loop;
end $mig$;

-- (New copies start clean automatically — status/started_at/completed_at are not copied.)

-- === 4. Legacy ad-hoc records: retag wrongly-assigned companies by title ===
update audit_plan_items set company_id = (select id from companies where short_code = 'IFPL')
 where audit_area ilike '%imperial%' and company_id <> (select id from companies where short_code = 'IFPL');
update audit_plan_items set company_id = (select id from companies where short_code = 'HD')
 where (audit_area ilike '%- HD%' or audit_area ilike '%-HD%' or audit_area ilike '%haute%')
   and company_id <> (select id from companies where short_code = 'HD');
update audit_plan_items set company_id = (select id from companies where short_code = 'BRNH')
 where audit_area ilike '%baranh%' and company_id <> (select id from companies where short_code = 'BRNH');
