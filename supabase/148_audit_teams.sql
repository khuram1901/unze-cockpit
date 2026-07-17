-- 148_audit_teams.sql
-- Audit teams (three pairs), task start timestamps, and a team-aware overview RPC
-- with "stuck" detection (over day-budget, or idle 5+ days).
-- Teams: UNZE -> UTPL · IMPERIAL -> IFPL · RESTAURANTS -> HD + BRNH.
-- Members see only their team's plan; audit manager (Manager + Audit dept) and
-- CEO/Admin tier see everything and can edit team membership.

-- === Tables ===

create table if not exists audit_teams (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order int not null default 0
);

create table if not exists audit_team_companies (
  team_id uuid not null references audit_teams(id) on delete cascade,
  company_id uuid not null references companies(id),
  primary key (team_id, company_id)
);

create table if not exists audit_team_members (
  team_id uuid not null references audit_teams(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  primary key (member_id)
);

alter table audit_stage_tasks add column if not exists started_at timestamptz;

-- === Helper: audit manager check (Shahid, or CEO/Admin tier) ===
create or replace function is_audit_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin_or_exec() or (get_user_role() = 'Manager' and get_user_department() = 'Audit');
$$;

-- === RLS ===
alter table audit_teams enable row level security;
alter table audit_team_companies enable row level security;
alter table audit_team_members enable row level security;

drop policy if exists "audit_read" on audit_teams;
create policy "audit_read" on audit_teams for select
  using (is_admin_or_exec() or get_user_department() = 'Audit');
drop policy if exists "mgr_write" on audit_teams;
create policy "mgr_write" on audit_teams for all
  using (is_audit_manager()) with check (is_audit_manager());

drop policy if exists "audit_read" on audit_team_companies;
create policy "audit_read" on audit_team_companies for select
  using (is_admin_or_exec() or get_user_department() = 'Audit');
drop policy if exists "mgr_write" on audit_team_companies;
create policy "mgr_write" on audit_team_companies for all
  using (is_audit_manager()) with check (is_audit_manager());

drop policy if exists "audit_read" on audit_team_members;
create policy "audit_read" on audit_team_members for select
  using (is_admin_or_exec() or get_user_department() = 'Audit');
drop policy if exists "mgr_write" on audit_team_members;
create policy "mgr_write" on audit_team_members for all
  using (is_audit_manager()) with check (is_audit_manager());

-- === Seed teams (initial guess — editable in the app by the audit manager) ===
do $seed$
declare
  t_unze uuid; t_imp uuid; t_rest uuid;
begin
if not exists (select 1 from audit_teams) then
  insert into audit_teams (code, name, sort_order) values ('UNZE', 'Team Unze Trading', 1) returning id into t_unze;
  insert into audit_teams (code, name, sort_order) values ('IMPERIAL', 'Team Imperial', 2) returning id into t_imp;
  insert into audit_teams (code, name, sort_order) values ('RESTAURANTS', 'Team Restaurants', 3) returning id into t_rest;

  insert into audit_team_companies (team_id, company_id)
  select t_unze, id from companies where short_code = 'UTPL';
  insert into audit_team_companies (team_id, company_id)
  select t_imp, id from companies where short_code = 'IFPL';
  insert into audit_team_companies (team_id, company_id)
  select t_rest, id from companies where short_code in ('HD', 'BRNH');

  -- name matching tolerant of double spaces in members.name
  -- Pairs confirmed by Khuram 18/07/2026
  insert into audit_team_members (team_id, member_id)
  select t_unze, id from members
   where department = 'Audit' and regexp_replace(name, '\s+', ' ', 'g') in ('Muhammad Fraz', 'Amina Sikandar');
  insert into audit_team_members (team_id, member_id)
  select t_imp, id from members
   where department = 'Audit' and regexp_replace(name, '\s+', ' ', 'g') in ('Junaid Sheikh', 'Attia Iftikhar');
  insert into audit_team_members (team_id, member_id)
  select t_rest, id from members
   where department = 'Audit' and regexp_replace(name, '\s+', ' ', 'g') in ('Khizar Javiad', 'Abdul Rehman');
end if;
end $seed$;

-- === Team-aware overview RPC: one round-trip, visibility enforced in the DB ===
-- Stuck = In Progress and (days since start > day budget, or no update for 5+ days).
create or replace function audit_team_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_email text := auth.email();
  v_is_mgr boolean := is_audit_manager();
  v_team uuid;
  result jsonb;
begin
  select atm.team_id into v_team
    from audit_team_members atm join members m on m.id = atm.member_id
   where m.email = v_email limit 1;

  if not (v_is_mgr or get_user_department() = 'Audit' or is_admin_or_exec()) then
    return jsonb_build_object('error', 'not_authorised');
  end if;

  with vis_teams as (
    select t.* from audit_teams t
    where v_is_mgr or t.id = v_team
  ),
  task_calc as (
    select tk.id, tk.process_id, tk.stage_no, tk.status, tk.sub_task, tk.stage_label,
           tk.responsible, tk.responsible_2, tk.total_days, tk.started_at, tk.updated_at,
           p.company_id, p.process_name,
           atc.team_id,
           case when tk.status = 'In Progress' and tk.started_at is not null
                then ceil(extract(epoch from now() - tk.started_at) / 86400.0)::int end as days_in,
           case when tk.status = 'In Progress' and tk.updated_at < now() - interval '5 days'
                then floor(extract(epoch from now() - tk.updated_at) / 86400.0)::int end as idle_days
    from audit_stage_tasks tk
    join audit_plan_processes p on p.id = tk.process_id
    join audit_team_companies atc on atc.company_id = p.company_id
    where atc.team_id in (select id from vis_teams)
  ),
  stuck as (
    select team_id, process_id, process_name, company_id, stage_no, stage_label, sub_task,
           coalesce(responsible, '') || case when responsible_2 is not null then ' + ' || responsible_2 else '' end as who,
           days_in, total_days,
           greatest(coalesce(days_in, 0) - coalesce(total_days, 0), 0) as over_days,
           idle_days
    from task_calc
    where status = 'In Progress'
      and (coalesce(days_in, 0) > coalesce(total_days, 0) or idle_days is not null)
  ),
  proc as (
    select p.id, p.company_id, atc.team_id, p.s_no, p.process_name, p.frequency,
           p.period_label, p.status, p.status_note, p.target_date,
           p.next_period_label, p.next_target_date,
           coalesce(a.total_days, 0) as total_days,
           coalesce(a.done_days, 0) as done_days,
           a.current_stage_no,
           a.started_on,
           coalesce(a.stuck_count, 0) as stuck_count,
           case when p.status = 'Completed' then 100
                when coalesce(a.total_days, 0) > 0 then round(100.0 * coalesce(a.done_days, 0) / a.total_days)::int
                else 0 end as completion_pct
    from audit_plan_processes p
    join audit_team_companies atc on atc.company_id = p.company_id
    left join lateral (
      select sum(coalesce(t.total_days, 0)) as total_days,
             sum(coalesce(t.total_days, 0)) filter (where t.status = 'Completed') as done_days,
             min(t.stage_no) filter (where t.status <> 'Completed') as current_stage_no,
             min(t.started_at)::date as started_on,
             count(*) filter (where t.status = 'In Progress' and
               (coalesce(ceil(extract(epoch from now() - t.started_at) / 86400.0)::int, 0) > coalesce(t.total_days, 0)
                or t.updated_at < now() - interval '5 days')) as stuck_count
      from audit_stage_tasks t where t.process_id = p.id
    ) a on true
    where atc.team_id in (select id from vis_teams)
  )
  select jsonb_build_object(
    'viewer', jsonb_build_object('is_manager', v_is_mgr, 'team_id', v_team),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', vt.id, 'code', vt.code, 'name', vt.name, 'sort_order', vt.sort_order,
        'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', regexp_replace(m.name, '\s+', ' ', 'g')) order by m.name)
                    from audit_team_members atm join members m on m.id = atm.member_id where atm.team_id = vt.id), '[]'::jsonb),
        'company_ids', coalesce((select jsonb_agg(atc.company_id) from audit_team_companies atc where atc.team_id = vt.id), '[]'::jsonb),
        'done', (select count(*) from proc where proc.team_id = vt.id and proc.status = 'Completed'),
        'running', (select count(*) from proc where proc.team_id = vt.id and proc.status = 'In Progress'),
        'total', (select count(*) from proc where proc.team_id = vt.id),
        'stuck', (select count(*) from stuck where stuck.team_id = vt.id),
        'overdue', (select count(*) from proc where proc.team_id = vt.id and proc.status in ('Planned','In Progress') and proc.target_date < current_date),
        'next_target', (select min(proc.target_date) from proc where proc.team_id = vt.id and proc.status in ('Planned','In Progress') and proc.target_date >= current_date)
      ) order by vt.sort_order) from vis_teams vt), '[]'::jsonb),
    'stuck', coalesce((select jsonb_agg(to_jsonb(s) order by s.over_days desc nulls last) from stuck s), '[]'::jsonb),
    'processes', coalesce((select jsonb_agg(to_jsonb(pr) order by pr.company_id, pr.s_no) from proc pr), '[]'::jsonb),
    'audit_members', case when v_is_mgr then coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'name', regexp_replace(m.name, '\s+', ' ', 'g'),
             'team_id', atm.team_id) order by m.name)
      from members m left join audit_team_members atm on atm.member_id = m.id
      where m.department = 'Audit' and m.is_active and m.role <> 'Manager'), '[]'::jsonb) else '[]'::jsonb end
  ) into result;

  return result;
end $$;
grant execute on function audit_team_overview() to authenticated;

-- === RPC: assign a member to a team (manager only; null team removes) ===
create or replace function audit_assign_team(p_member_id uuid, p_team_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_audit_manager() then
    raise exception 'Not authorised';
  end if;
  delete from audit_team_members where member_id = p_member_id;
  if p_team_id is not null then
    insert into audit_team_members (team_id, member_id) values (p_team_id, p_member_id);
  end if;
end $$;
grant execute on function audit_assign_team(uuid, uuid) to authenticated;
