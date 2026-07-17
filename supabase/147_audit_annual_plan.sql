-- 147_audit_annual_plan.sql
-- Annual Internal Audit Plan (FY 2025-26, year end 30/06/2026) — built from the audit manager's
-- "Audit activities" workbook. Structure: company -> business process -> 7-stage lifecycle -> sub-tasks.
-- Companies covered: UTPL (Unze tab), IFPL (Imperial tab), HD + BRNH (Hospitality tab). ALM excluded by design.

-- === Tables ===

create table if not exists audit_plan_processes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  fiscal_year text not null default '2025-26',
  s_no int not null,
  process_name text not null,
  reference_no int,
  frequency text not null check (frequency in ('Daily basis','Monthly','Quarterly','Semi-annually','Annually')),
  period_label text,
  status text not null default 'Planned' check (status in ('Planned','In Progress','Completed','Cancelled')),
  status_note text,
  target_date date,
  next_period_label text,
  next_target_date date,
  legacy_item_id uuid references audit_plan_items(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, fiscal_year, s_no)
);

create table if not exists audit_stage_templates (
  id uuid primary key default gen_random_uuid(),
  reference_no int not null,
  reference_title text,
  stage_no int not null check (stage_no between 1 and 7),
  stage_label text not null,
  sub_task text,
  responsible text,
  responsible_2 text,
  days numeric,
  days_2 numeric,
  total_days numeric,
  sort_order int not null
);

create table if not exists audit_stage_tasks (
  id uuid primary key default gen_random_uuid(),
  process_id uuid not null references audit_plan_processes(id) on delete cascade,
  stage_no int not null check (stage_no between 1 and 7),
  stage_label text not null,
  sub_task text,
  responsible text,
  responsible_2 text,
  days numeric,
  days_2 numeric,
  total_days numeric,
  sort_order int not null default 0,
  status text not null default 'Not Started' check (status in ('Not Started','In Progress','Completed')),
  completed_at timestamptz,
  updated_by text,
  updated_at timestamptz not null default now()
);
create index if not exists idx_audit_stage_tasks_process on audit_stage_tasks(process_id);

create table if not exists audit_daily_activities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  s_no int not null,
  activity text not null,
  frequency text not null default 'Daily basis',
  transferred_to text,
  note text
);

-- === RLS (same pattern as audit_plan_items: Audit dept + admin/exec) ===
alter table audit_plan_processes enable row level security;
alter table audit_stage_templates enable row level security;
alter table audit_stage_tasks enable row level security;
alter table audit_daily_activities enable row level security;

drop policy if exists "dept_access" on audit_plan_processes;
create policy "dept_access" on audit_plan_processes for all
  using (is_admin_or_exec() or get_user_department() = 'Audit')
  with check (is_admin_or_exec() or get_user_department() = 'Audit');
drop policy if exists "dept_access" on audit_stage_tasks;
create policy "dept_access" on audit_stage_tasks for all
  using (is_admin_or_exec() or get_user_department() = 'Audit')
  with check (is_admin_or_exec() or get_user_department() = 'Audit');
drop policy if exists "dept_read" on audit_stage_templates;
create policy "dept_read" on audit_stage_templates for select
  using (is_admin_or_exec() or get_user_department() = 'Audit');
drop policy if exists "dept_read" on audit_daily_activities;
create policy "dept_read" on audit_daily_activities for select
  using (is_admin_or_exec() or get_user_department() = 'Audit');

-- === Trigger: roll sub-task status up to the parent process ===
create or replace function audit_process_rollup() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pid uuid := coalesce(new.process_id, old.process_id);
  n_total int; n_done int; n_started int; cur text;
begin
  select count(*), count(*) filter (where status = 'Completed'),
         count(*) filter (where status <> 'Not Started')
    into n_total, n_done, n_started
    from audit_stage_tasks where process_id = pid;
  select status into cur from audit_plan_processes where id = pid;
  if cur is distinct from 'Cancelled' then
    if n_total > 0 and n_done = n_total then
      update audit_plan_processes set status = 'Completed', updated_at = now() where id = pid;
    elsif n_started > 0 and cur = 'Planned' then
      update audit_plan_processes set status = 'In Progress', updated_at = now() where id = pid;
    elsif n_done < n_total and cur = 'Completed' then
      update audit_plan_processes set status = 'In Progress', updated_at = now() where id = pid;
    else
      update audit_plan_processes set updated_at = now() where id = pid;
    end if;
  end if;
  return null;
end $$;

drop trigger if exists trg_audit_process_rollup on audit_stage_tasks;
create trigger trg_audit_process_rollup
  after insert or update of status or delete on audit_stage_tasks
  for each row execute function audit_process_rollup();

-- === Overview RPC: one round-trip, all aggregation in the database ===
create or replace function audit_annual_plan_overview(p_company_id uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
with agg as (
  select p.id, p.company_id, p.fiscal_year, p.s_no, p.process_name, p.reference_no,
         p.frequency, p.period_label, p.status, p.status_note, p.target_date,
         p.next_period_label, p.next_target_date, p.updated_at,
         coalesce(t.total_days, 0) as total_days,
         coalesce(t.done_days, 0) as done_days,
         coalesce(t.task_count, 0) as task_count,
         coalesce(t.done_count, 0) as done_count,
         t.current_stage_no,
         case
           when p.status = 'Completed' then 100
           when coalesce(t.total_days, 0) > 0 then round(100.0 * coalesce(t.done_days, 0) / t.total_days)::int
           else 0
         end as completion_pct
  from audit_plan_processes p
  -- optional company filter
  left join lateral (
    select sum(coalesce(total_days, 0)) as total_days,
           sum(coalesce(total_days, 0)) filter (where status = 'Completed') as done_days,
           count(*) as task_count,
           count(*) filter (where status = 'Completed') as done_count,
           min(stage_no) filter (where status <> 'Completed') as current_stage_no
    from audit_stage_tasks where process_id = p.id
  ) t on true
  where p_company_id is null or p.company_id = p_company_id
)
select jsonb_build_object(
  'kpis', (select jsonb_build_object(
      'total',       count(*),
      'planned',     count(*) filter (where status = 'Planned'),
      'in_progress', count(*) filter (where status = 'In Progress'),
      'completed',   count(*) filter (where status = 'Completed'),
      'overdue',     count(*) filter (where status in ('Planned','In Progress') and target_date < current_date),
      'avg_pct',     coalesce(round(avg(completion_pct) filter (where status <> 'Cancelled'))::int, 0)
    ) from agg),
  'processes', coalesce((select jsonb_agg(to_jsonb(a) order by a.company_id, a.s_no) from agg a), '[]'::jsonb)
);
$$;
grant execute on function audit_annual_plan_overview(uuid) to authenticated;

-- === RPC: start a new cycle for a recurring audit (resets stage tasks) ===
create or replace function audit_start_new_cycle(p_process_id uuid, p_period_label text default null, p_target_date date default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin_or_exec() or get_user_department() = 'Audit') then
    raise exception 'Not authorised';
  end if;
  update audit_stage_tasks set status = 'Not Started', completed_at = null, updated_at = now()
   where process_id = p_process_id;
  update audit_plan_processes
     set status = 'Planned',
         period_label = coalesce(p_period_label, next_period_label, period_label),
         target_date = coalesce(p_target_date, next_target_date, target_date),
         next_period_label = null,
         next_target_date = null,
         updated_at = now()
   where id = p_process_id;
end $$;
grant execute on function audit_start_new_cycle(uuid, text, date) to authenticated;

-- === Seed: stage templates (from reference sheets 1-15) ===
do $seed$
begin
if not exists (select 1 from audit_stage_templates) then
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (1, 'P&L Financial Audit (Quarterly)', 1, 'Audit Planning', null, 'Shahid', null, 1, null, 1, 1);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (1, 'P&L Financial Audit (Quarterly)', 2, 'Data Collection', null, 'Shahid', null, 1, null, 1, 2);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (1, 'P&L Financial Audit (Quarterly)', 3, 'Data Verification', 'Working on opening part of audit report', 'Shahid', null, 3, null, 3, 3);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (1, 'P&L Financial Audit (Quarterly)', 3, 'Data Verification', 'Reconcilliation of accounst with GL (SAP)', 'Abdul Rehman', null, 3, null, 3, 4);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (1, 'P&L Financial Audit (Quarterly)', 3, 'Data Verification', 'Reconcilliation of all material record of plant with SAP', 'Abdul Rehman', null, 5, null, 5, 5);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (1, 'P&L Financial Audit (Quarterly)', 3, 'Data Verification', 'Production efficiency- working including  BOM VS Actual and Planned Vs actual', 'Amina', null, 1, null, 1, 6);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (1, 'P&L Financial Audit (Quarterly)', 3, 'Data Verification', 'GL verification- Turnover', 'Abdul Rehman', 'Amina', 5, 6, 11, 7);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (1, 'P&L Financial Audit (Quarterly)', 3, 'Data Verification', 'GL verification- COGS', 'Amina', null, 6, null, 6, 8);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (1, 'P&L Financial Audit (Quarterly)', 3, 'Data Verification', 'GL verfication- Admin', 'Abdul Rehman', null, 6, null, 6, 9);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (1, 'P&L Financial Audit (Quarterly)', 3, 'Data Verification', 'GL verification- S&D', 'Abdul Rehman', 'Amina', 5, 5, 10, 10);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (1, 'P&L Financial Audit (Quarterly)', 3, 'Data Verification', 'GL verification- Other Income', 'Amina', null, 6, null, 6, 11);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (1, 'P&L Financial Audit (Quarterly)', 3, 'Data Verification', 'GL verification- Financial charges', 'Abdul Rehman', null, 3, null, 3, 12);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (1, 'P&L Financial Audit (Quarterly)', 4, 'Draft Audit Findings', null, 'Amina', null, 5, null, 5, 13);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (1, 'P&L Financial Audit (Quarterly)', 5, 'Review of IA Report', null, 'Shahid', null, 3, null, 3, 14);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (1, 'P&L Financial Audit (Quarterly)', 6, 'Communication to Process Owner', null, 'Shahid', null, 5, null, 5, 15);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (1, 'P&L Financial Audit (Quarterly)', 7, 'Submission to Senior Management', null, 'Shahid', null, 1, null, 1, 16);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (2, 'Physical Cash count', 1, 'Audit Planning', null, 'Shahid', null, 1, null, 1, 1);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (2, 'Physical Cash count', 2, 'Data Collection', null, 'Shahid', null, 1, null, 1, 2);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (2, 'Physical Cash count', 3, 'Data Verification', 'Physical cash counting', 'Abdul Rehman', null, 1, null, 1, 3);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (2, 'Physical Cash count', 3, 'Data Verification', 'Recocillitaion with system balances', 'Amina', null, 1, null, 1, 4);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (2, 'Physical Cash count', 4, 'Draft Audit Findings', null, 'Amina', null, 1, null, 1, 5);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (2, 'Physical Cash count', 5, 'Review of IA Report', null, 'Shahid', null, 1, null, 1, 6);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (2, 'Physical Cash count', 6, 'Communication to Process Owner', null, 'Shahid', null, 1, null, 1, 7);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (2, 'Physical Cash count', 7, 'Submission to Senior Management', null, 'Shahid', null, 1, null, 1, 8);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (3, 'Accounts Receivable Verification', 1, 'Audit Planning', null, 'Shahid', null, 1, null, 1, 1);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (3, 'Accounts Receivable Verification', 2, 'Data Collection', null, 'Shahid', null, 1, null, 1, 2);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (3, 'Accounts Receivable Verification', 3, 'Data Verification', 'Verification of receivable balances and ageing in complinace with the contract.', 'Amina', null, 12, null, 12, 3);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (3, 'Accounts Receivable Verification', 4, 'Draft Audit Findings', null, 'Amina', null, 2, null, 2, 4);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (3, 'Accounts Receivable Verification', 5, 'Review of IA Report', null, 'Shahid', null, 3, null, 3, 5);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (3, 'Accounts Receivable Verification', 6, 'Communication to Process Owner', null, 'Shahid', null, 3, null, 3, 6);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (3, 'Accounts Receivable Verification', 7, 'Submission to Senior Management', null, 'Shahid', null, 1, null, 1, 7);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (4, 'Accounts Payable Verification', 1, 'Audit Planning', null, 'Shahid', null, 1, null, 1, 1);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (4, 'Accounts Payable Verification', 2, 'Data Collection', null, 'Shahid', null, 1, null, 1, 2);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (4, 'Accounts Payable Verification', 3, 'Data Verification', 'Verification of payable balances and ageing in complinace with the procurement cycle.', 'Amina', null, 18, null, 18, 3);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (4, 'Accounts Payable Verification', 4, 'Draft Audit Findings', null, 'Amina', null, 3, null, 3, 4);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (4, 'Accounts Payable Verification', 5, 'Review of IA Report', null, 'Shahid', null, 3, null, 3, 5);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (4, 'Accounts Payable Verification', 6, 'Communication to Process Owner', null, 'Shahid', null, 3, null, 3, 6);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (4, 'Accounts Payable Verification', 7, 'Submission to Senior Management', null, 'Shahid', null, 1, null, 1, 7);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (5, 'Bank Reconcilliation Verification', 1, 'Audit Planning', null, 'Shahid', null, 1, null, 1, 1);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (5, 'Bank Reconcilliation Verification', 2, 'Data Collection', null, 'Shahid', null, 1, null, 1, 2);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (5, 'Bank Reconcilliation Verification', 3, 'Data Verification', 'Verification of bank reconcilliations statements.', 'Abdul Rehman', null, 3, null, 3, 3);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (5, 'Bank Reconcilliation Verification', 4, 'Draft Audit Findings', null, 'Abdul Rehman', null, 2, null, 2, 4);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (5, 'Bank Reconcilliation Verification', 5, 'Review of IA Report', null, 'Shahid', null, 1, null, 1, 5);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (5, 'Bank Reconcilliation Verification', 6, 'Communication to Process Owner', null, 'Shahid', null, 2, null, 2, 6);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (5, 'Bank Reconcilliation Verification', 7, 'Submission to Senior Management', null, 'Shahid', null, 1, null, 1, 7);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (6, 'Inventory Count Activity', 1, 'Audit Planning', null, 'Shahid', null, 1, null, 1, 1);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (6, 'Inventory Count Activity', 2, 'Data Collection', null, 'Shahid', null, 1, null, 1, 2);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (6, 'Inventory Count Activity', 3, 'Data Verification', 'Execution of Inventory count activity at all plants', 'Shahid', null, 10, null, 10, 3);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (6, 'Inventory Count Activity', 4, 'Draft Audit Findings', null, 'Shahid', null, 3, null, 3, 4);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (6, 'Inventory Count Activity', 5, 'Review of IA Report', null, 'Shahid', null, 2, null, 2, 5);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (6, 'Inventory Count Activity', 6, 'Communication to Process Owner', null, 'Shahid', null, 1, null, 1, 6);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (6, 'Inventory Count Activity', 7, 'Submission to Senior Management', null, 'Shahid', null, 1, null, 1, 7);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (7, 'Turnover verification', 1, 'Audit Planning', null, 'Shahid', null, 1, null, 1, 1);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (7, 'Turnover verification', 2, 'Data Collection', null, 'Shahid', null, 1, null, 1, 2);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (7, 'Turnover verification', 3, 'Data Verification', 'Quantitative verification of turnover with production and dispatch record', 'Abdul Rehman', null, 3, null, 3, 3);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (7, 'Turnover verification', 3, 'Data Verification', 'Value verification incompliance with contract', 'Amina', null, 1, null, 1, 4);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (7, 'Turnover verification', 4, 'Draft Audit Findings', null, 'Amina', null, 5, null, 5, 5);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (7, 'Turnover verification', 5, 'Review of IA Report', null, 'Shahid', null, 3, null, 3, 6);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (7, 'Turnover verification', 6, 'Communication to Process Owner', null, 'Shahid', null, 5, null, 5, 7);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (7, 'Turnover verification', 7, 'Submission to Senior Management', null, 'Shahid', null, 1, null, 1, 8);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (8, 'Production Efficiency', 1, 'Audit Planning', null, 'Shahid', null, 1, null, 1, 1);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (8, 'Production Efficiency', 2, 'Data Collection', null, 'Shahid', null, 1, null, 1, 2);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (8, 'Production Efficiency', 3, 'Data Verification', 'Production efficiency- BOM VS Actual (RM)', 'Amina', null, 1, null, 1, 3);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (8, 'Production Efficiency', 3, 'Data Verification', 'Production efficiency- Planned VS Actual (FG)', 'Amina', null, 1, null, 0, 4);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (8, 'Production Efficiency', 4, 'Draft Audit Findings', null, 'Amina', null, 2, null, 2, 5);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (8, 'Production Efficiency', 5, 'Review of IA Report', null, 'Shahid', null, 2, null, 2, 6);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (8, 'Production Efficiency', 6, 'Communication to Process Owner', null, 'Shahid', null, 3, null, 3, 7);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (8, 'Production Efficiency', 7, 'Submission to Senior Management', null, 'Shahid', null, 1, null, 1, 8);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (9, 'Inventory reconcilliation Plant VS SAP', 1, 'Audit Planning', null, 'Shahid', null, 1, null, 1, 1);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (9, 'Inventory reconcilliation Plant VS SAP', 2, 'Data Collection', null, 'Shahid', null, 1, null, 1, 2);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (9, 'Inventory reconcilliation Plant VS SAP', 3, 'Data Verification', 'Quatitative reconcilitaion of RM, Store & Spares and FG- Plant production VS SAP', 'Abdul Rehman', null, 7, null, 7, 3);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (9, 'Inventory reconcilliation Plant VS SAP', 4, 'Draft Audit Findings', null, 'Abdul Rehman', null, 2, null, 2, 4);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (9, 'Inventory reconcilliation Plant VS SAP', 5, 'Review of IA Report', null, 'Shahid', null, 2, null, 2, 5);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (9, 'Inventory reconcilliation Plant VS SAP', 6, 'Communication to Process Owner', null, 'Shahid', null, 3, null, 3, 6);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (9, 'Inventory reconcilliation Plant VS SAP', 7, 'Submission to Senior Management', null, 'Shahid', null, 1, null, 1, 7);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (10, 'Income & Sales Tax Liability', 1, 'Audit Planning', null, 'Shahid', null, 1, null, 1, 1);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (10, 'Income & Sales Tax Liability', 2, 'Data Collection', null, 'Shahid', null, 1, null, 1, 2);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (10, 'Income & Sales Tax Liability', 3, 'Data Verification', 'Verification of Income tax deductions and deposits-Payroll', 'Amina', 'Abdul Rehman', 2, 2, 4, 3);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (10, 'Income & Sales Tax Liability', 3, 'Data Verification', 'Verification of Income tax deductions and deposits-Services', 'Amina', 'Abdul Rehman', 4, 3, 7, 4);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (10, 'Income & Sales Tax Liability', 3, 'Data Verification', 'Verification of Income tax deductions and deposits-Supplies', 'Amina', 'Abdul Rehman', 4, 3, 7, 5);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (10, 'Income & Sales Tax Liability', 3, 'Data Verification', 'Verification of Sales tax collection and deposits-Services', 'Amina', 'Abdul Rehman', 4, 3, 7, 6);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (10, 'Income & Sales Tax Liability', 3, 'Data Verification', 'Verifcation of monthly sales tax return', 'Shahid', null, 2, null, 2, 7);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (10, 'Income & Sales Tax Liability', 4, 'Draft Audit Findings', null, 'Amina', null, 2, null, 2, 8);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (10, 'Income & Sales Tax Liability', 5, 'Review of IA Report', null, 'Shahid', null, 2, null, 2, 9);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (10, 'Income & Sales Tax Liability', 6, 'Communication to Process Owner', null, 'Shahid', null, 3, null, 3, 10);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (10, 'Income & Sales Tax Liability', 7, 'Submission to Senior Management', null, 'Shahid', null, 1, null, 1, 11);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (11, 'Short Term Payables', 1, 'Audit Planning', null, 'Shahid', null, 1, null, 1, 1);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (11, 'Short Term Payables', 2, 'Data Collection', null, 'Shahid', null, 1, null, 1, 2);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (11, 'Short Term Payables', 3, 'Data Verification', 'Verification of accruals balances, ageing and its payments', 'Amina', 'Abdul Rehman', 6, 6, 12, 3);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (11, 'Short Term Payables', 4, 'Draft Audit Findings', null, 'Amina', null, 2, null, 2, 4);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (11, 'Short Term Payables', 5, 'Review of IA Report', null, 'Shahid', null, 2, null, 2, 5);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (11, 'Short Term Payables', 6, 'Communication to Process Owner', null, 'Shahid', null, 3, null, 3, 6);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (11, 'Short Term Payables', 7, 'Submission to Senior Management', null, 'Shahid', null, 1, null, 1, 7);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (12, 'Short Term Receivables', 1, 'Audit Planning', null, 'Shahid', null, 1, null, 1, 1);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (12, 'Short Term Receivables', 2, 'Data Collection', null, 'Shahid', null, 1, null, 1, 2);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (12, 'Short Term Receivables', 3, 'Data Verification', 'Verification of receivable balances, ageing and its adjustments', 'Amina', 'Abdul Rehman', 6, 6, 12, 3);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (12, 'Short Term Receivables', 4, 'Draft Audit Findings', null, 'Amina', null, 2, null, 2, 4);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (12, 'Short Term Receivables', 5, 'Review of IA Report', null, 'Shahid', null, 2, null, 2, 5);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (12, 'Short Term Receivables', 6, 'Communication to Process Owner', null, 'Shahid', null, 3, null, 3, 6);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (12, 'Short Term Receivables', 7, 'Submission to Senior Management', null, 'Shahid', null, 1, null, 1, 7);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (13, 'Final settlement verification', 1, 'Audit Planning', null, 'Shahid', null, 1, null, 1, 1);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (13, 'Final settlement verification', 2, 'Data Collection', null, 'Shahid', null, 1, null, 1, 2);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (13, 'Final settlement verification', 3, 'Data Verification', 'Payroll sheet verification', 'Amina', null, 1, null, 1, 3);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (13, 'Final settlement verification', 4, 'Draft Audit Findings', null, 'Amina', null, 1, null, 1, 4);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (13, 'Final settlement verification', 5, 'Review of IA Report', null, 'Shahid', null, 1, null, 1, 5);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (13, 'Final settlement verification', 6, 'Communication to Process Owner', null, 'Shahid', null, 1, null, 1, 6);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (13, 'Final settlement verification', 7, 'Submission to Senior Management', null, 'Shahid', null, 1, null, 1, 7);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (14, 'SOP Review', 1, 'Audit Planning', null, 'Shahid', null, 2, null, 2, 1);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (14, 'SOP Review', 2, 'Data Collection', null, 'Shahid', null, 2, null, 2, 2);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (14, 'SOP Review', 3, 'Data Verification', 'Review of SOPs and development of new SOPs', 'Amina', 'Abdul Rehman', 30, 30, 60, 3);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (14, 'SOP Review', 4, 'Draft Audit Findings', null, 'Amina', null, 3, null, 3, 4);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (14, 'SOP Review', 5, 'Review of IA Report', null, 'Shahid', null, 7, null, 7, 5);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (14, 'SOP Review', 6, 'Communication to Process Owner', null, 'Shahid', null, 7, null, 7, 6);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (14, 'SOP Review', 7, 'Submission to Senior Management', null, 'Shahid', null, 1, null, 1, 7);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (15, 'SAP Authoirzations', 1, 'Audit Planning', null, 'Shahid', null, 2, null, 2, 1);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (15, 'SAP Authoirzations', 2, 'Data Collection', null, 'Shahid', null, 2, null, 2, 2);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (15, 'SAP Authoirzations', 3, 'Data Verification', 'Verification of SAP authorizations  in complinace with assigned JD/role', 'Shahid', null, 45, null, 45, 3);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (15, 'SAP Authoirzations', 4, 'Draft Audit Findings', null, 'Shahid', null, 2, null, 2, 4);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (15, 'SAP Authoirzations', 5, 'Review of IA Report', null, 'Shahid', null, 2, null, 2, 5);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (15, 'SAP Authoirzations', 6, 'Communication to Process Owner', null, 'Shahid', null, 7, null, 7, 6);
insert into audit_stage_templates (reference_no, reference_title, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order) values (15, 'SAP Authoirzations', 7, 'Submission to Senior Management', null, 'Shahid', null, 1, null, 1, 7);
end if;
end $seed$;

-- === Seed: annual plan processes per company ===
do $seed$
begin
if not exists (select 1 from audit_plan_processes) then
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('15884c2d-48a4-4d43-be90-0ef6e130790c', 1, 'Financial Audit - P&L Audit', 1, 'Quarterly', '3rd Quarter', 'In Progress', null, '2026-07-31', '4th Quarter', '2026-09-30');
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('15884c2d-48a4-4d43-be90-0ef6e130790c', 2, 'Monthly cash count', 2, 'Monthly', null, 'Completed', null, null, null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('15884c2d-48a4-4d43-be90-0ef6e130790c', 3, 'Accounts receivable verification', 3, 'Monthly', null, 'Planned', null, '2026-09-30', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('15884c2d-48a4-4d43-be90-0ef6e130790c', 4, 'Accounts payable verification', 4, 'Monthly', null, 'Planned', null, '2026-09-30', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('15884c2d-48a4-4d43-be90-0ef6e130790c', 5, 'Bank reconciliations', 5, 'Monthly', null, 'In Progress', 'Updated till May', null, null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('15884c2d-48a4-4d43-be90-0ef6e130790c', 6, 'Inventory count activity', 6, 'Monthly', null, 'Completed', null, null, null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('15884c2d-48a4-4d43-be90-0ef6e130790c', 7, 'Turnover verification (Valuation part)', 7, 'Monthly', null, 'Planned', null, '2026-08-30', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('15884c2d-48a4-4d43-be90-0ef6e130790c', 8, 'Production efficiency', 8, 'Monthly', null, 'Completed', null, null, null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('15884c2d-48a4-4d43-be90-0ef6e130790c', 9, 'Inventory reconciliation Plant vs SAP', 9, 'Monthly', null, 'Completed', null, null, null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('15884c2d-48a4-4d43-be90-0ef6e130790c', 10, 'Income and Sales tax liability', 10, 'Quarterly', null, 'Planned', null, '2026-08-30', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('15884c2d-48a4-4d43-be90-0ef6e130790c', 11, 'Short term payables', 11, 'Quarterly', null, 'Planned', null, '2026-08-30', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('15884c2d-48a4-4d43-be90-0ef6e130790c', 12, 'Short term receivables', 12, 'Quarterly', null, 'Planned', null, '2026-08-30', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('15884c2d-48a4-4d43-be90-0ef6e130790c', 13, 'Final settlement audit', 13, 'Monthly', null, 'Completed', null, null, null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('15884c2d-48a4-4d43-be90-0ef6e130790c', 14, 'SOP review', 14, 'Semi-annually', null, 'Completed', null, null, null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('15884c2d-48a4-4d43-be90-0ef6e130790c', 15, 'SAP authorizations', 15, 'Annually', null, 'Completed', null, null, null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('77921705-8a15-4406-847a-b234f84b5ec3', 1, 'Financial Audit - P&L Audit', 1, 'Quarterly', '2nd, 3rd & 4th Quarter', 'In Progress', null, '2026-10-31', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('77921705-8a15-4406-847a-b234f84b5ec3', 2, 'Monthly cash count', 2, 'Monthly', null, 'Completed', null, null, null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('77921705-8a15-4406-847a-b234f84b5ec3', 3, 'Accounts receivable verification', 3, 'Monthly', null, 'Planned', null, '2026-09-30', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('77921705-8a15-4406-847a-b234f84b5ec3', 4, 'Accounts payable verification', 4, 'Monthly', null, 'Planned', null, '2026-09-30', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('77921705-8a15-4406-847a-b234f84b5ec3', 5, 'Bank reconciliations', 5, 'Monthly', null, 'Planned', null, '2026-07-31', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('77921705-8a15-4406-847a-b234f84b5ec3', 6, 'Turnover verification (Valuation part)', 7, 'Monthly', null, 'Planned', null, '2026-10-31', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('77921705-8a15-4406-847a-b234f84b5ec3', 7, 'Income and Sales tax liability', 10, 'Quarterly', null, 'Planned', null, '2026-10-31', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('77921705-8a15-4406-847a-b234f84b5ec3', 8, 'Short term payables', 11, 'Quarterly', null, 'Planned', null, '2026-10-31', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('77921705-8a15-4406-847a-b234f84b5ec3', 9, 'Short term receivables', 12, 'Quarterly', null, 'Planned', null, '2026-10-31', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('77921705-8a15-4406-847a-b234f84b5ec3', 10, 'Final settlement audit', 13, 'Monthly', null, 'Completed', null, null, null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('77921705-8a15-4406-847a-b234f84b5ec3', 11, 'SOP review', 14, 'Semi-annually', null, 'Completed', null, null, null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('77921705-8a15-4406-847a-b234f84b5ec3', 12, 'SAP authorizations', 15, 'Annually', null, 'Completed', null, null, null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('16a92b7f-b3fa-4271-819b-c6befb534f12', 1, 'Financial Audit - P&L Audit', 1, 'Quarterly', '3rd & 4th Quarter', 'In Progress', null, '2026-09-30', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('16a92b7f-b3fa-4271-819b-c6befb534f12', 2, 'Accounts receivable verification', 3, 'Monthly', null, 'Planned', null, '2026-09-30', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('16a92b7f-b3fa-4271-819b-c6befb534f12', 3, 'Accounts payable verification', 4, 'Monthly', null, 'Planned', null, '2026-09-30', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('16a92b7f-b3fa-4271-819b-c6befb534f12', 4, 'Bank reconciliations', 5, 'Monthly', null, 'Planned', null, '2026-07-31', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('16a92b7f-b3fa-4271-819b-c6befb534f12', 5, 'Inventory count activity', 6, 'Monthly', null, 'Completed', null, null, null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('16a92b7f-b3fa-4271-819b-c6befb534f12', 6, 'Turnover verification (Valuation part)', 7, 'Monthly', null, 'Planned', null, '2026-09-30', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('16a92b7f-b3fa-4271-819b-c6befb534f12', 7, 'Income and Sales tax liability', 10, 'Quarterly', null, 'Planned', null, '2026-09-30', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('16a92b7f-b3fa-4271-819b-c6befb534f12', 8, 'Short term payables', 11, 'Quarterly', null, 'Planned', null, '2026-09-30', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('16a92b7f-b3fa-4271-819b-c6befb534f12', 9, 'Short term receivables', 12, 'Quarterly', null, 'Planned', null, '2026-09-30', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('16a92b7f-b3fa-4271-819b-c6befb534f12', 10, 'Final settlement audit', 13, 'Monthly', null, 'Completed', null, null, null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('16a92b7f-b3fa-4271-819b-c6befb534f12', 11, 'SOP review', 14, 'Semi-annually', null, 'Planned', null, '2026-12-31', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('16a92b7f-b3fa-4271-819b-c6befb534f12', 12, 'S4U authorizations', 15, 'Annually', null, 'Planned', null, '2026-09-30', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('6401ba75-f297-4617-84c1-305bcaf35a50', 1, 'Financial Audit - P&L Audit', 1, 'Quarterly', '3rd & 4th Quarter', 'In Progress', null, '2026-09-30', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('6401ba75-f297-4617-84c1-305bcaf35a50', 2, 'Accounts receivable verification', 3, 'Monthly', null, 'Planned', null, '2026-09-30', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('6401ba75-f297-4617-84c1-305bcaf35a50', 3, 'Accounts payable verification', 4, 'Monthly', null, 'Planned', null, '2026-09-30', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('6401ba75-f297-4617-84c1-305bcaf35a50', 4, 'Bank reconciliations', 5, 'Monthly', null, 'Planned', null, '2026-07-31', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('6401ba75-f297-4617-84c1-305bcaf35a50', 5, 'Inventory count activity', 6, 'Monthly', null, 'Completed', null, null, null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('6401ba75-f297-4617-84c1-305bcaf35a50', 6, 'Turnover verification (Valuation part)', 7, 'Monthly', null, 'Planned', null, '2026-09-30', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('6401ba75-f297-4617-84c1-305bcaf35a50', 7, 'Income and Sales tax liability', 10, 'Quarterly', null, 'Planned', null, '2026-09-30', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('6401ba75-f297-4617-84c1-305bcaf35a50', 8, 'Short term payables', 11, 'Quarterly', null, 'Planned', null, '2026-09-30', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('6401ba75-f297-4617-84c1-305bcaf35a50', 9, 'Short term receivables', 12, 'Quarterly', null, 'Planned', null, '2026-09-30', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('6401ba75-f297-4617-84c1-305bcaf35a50', 10, 'Final settlement audit', 13, 'Monthly', null, 'Completed', null, null, null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('6401ba75-f297-4617-84c1-305bcaf35a50', 11, 'SOP review', 14, 'Semi-annually', null, 'Planned', null, '2026-12-31', null, null);
insert into audit_plan_processes (company_id, s_no, process_name, reference_no, frequency, period_label, status, status_note, target_date, next_period_label, next_target_date) values ('6401ba75-f297-4617-84c1-305bcaf35a50', 12, 'S4U authorizations', 15, 'Annually', null, 'Planned', null, '2026-09-30', null, null);

insert into audit_stage_tasks (process_id, stage_no, stage_label, sub_task, responsible, responsible_2, days, days_2, total_days, sort_order, status, completed_at)
select p.id, t.stage_no, t.stage_label, t.sub_task, t.responsible, t.responsible_2, t.days, t.days_2, t.total_days, t.sort_order,
       case when p.status = 'Completed' then 'Completed' else 'Not Started' end,
       case when p.status = 'Completed' then now() end
from audit_plan_processes p
join audit_stage_templates t on t.reference_no = p.reference_no;
end if;
end $seed$;

-- === Seed: pre-audit daily activities (reference panel) ===
do $seed$
begin
if not exists (select 1 from audit_daily_activities) then
insert into audit_daily_activities (company_id, s_no, activity, transferred_to, note) values ('15884c2d-48a4-4d43-be90-0ef6e130790c', 1, 'Purchase order approval', 'Accounts', null);
insert into audit_daily_activities (company_id, s_no, activity, transferred_to, note) values ('15884c2d-48a4-4d43-be90-0ef6e130790c', 2, 'Accounts payable approval', 'Accounts', null);
insert into audit_daily_activities (company_id, s_no, activity, transferred_to, note) values ('15884c2d-48a4-4d43-be90-0ef6e130790c', 3, 'Outgoing payments approval', null, null);
insert into audit_daily_activities (company_id, s_no, activity, transferred_to, note) values ('15884c2d-48a4-4d43-be90-0ef6e130790c', 4, 'Bank portal payments approval', null, null);
insert into audit_daily_activities (company_id, s_no, activity, transferred_to, note) values ('15884c2d-48a4-4d43-be90-0ef6e130790c', 5, 'Journal entry approvals', 'Accounts', null);
insert into audit_daily_activities (company_id, s_no, activity, transferred_to, note) values ('77921705-8a15-4406-847a-b234f84b5ec3', 1, 'Purchase order approval', 'Accounts', null);
insert into audit_daily_activities (company_id, s_no, activity, transferred_to, note) values ('77921705-8a15-4406-847a-b234f84b5ec3', 2, 'Accounts payable approval', 'Accounts', null);
insert into audit_daily_activities (company_id, s_no, activity, transferred_to, note) values ('77921705-8a15-4406-847a-b234f84b5ec3', 3, 'Outgoing payments approval', null, null);
insert into audit_daily_activities (company_id, s_no, activity, transferred_to, note) values ('77921705-8a15-4406-847a-b234f84b5ec3', 4, 'Bank portal payments approval', null, null);
insert into audit_daily_activities (company_id, s_no, activity, transferred_to, note) values ('77921705-8a15-4406-847a-b234f84b5ec3', 5, 'Journal entry approvals', 'Accounts', null);
insert into audit_daily_activities (company_id, s_no, activity, transferred_to, note) values ('16a92b7f-b3fa-4271-819b-c6befb534f12', 1, 'Outgoing payments approval', 'Accounts', '12 branches');
insert into audit_daily_activities (company_id, s_no, activity, transferred_to, note) values ('16a92b7f-b3fa-4271-819b-c6befb534f12', 2, 'Bank portal payments approval', null, null);
insert into audit_daily_activities (company_id, s_no, activity, transferred_to, note) values ('6401ba75-f297-4617-84c1-305bcaf35a50', 1, 'Outgoing payments approval', 'Accounts', '12 branches');
insert into audit_daily_activities (company_id, s_no, activity, transferred_to, note) values ('6401ba75-f297-4617-84c1-305bcaf35a50', 2, 'Bank portal payments approval', null, null);
end if;
end $seed$;
