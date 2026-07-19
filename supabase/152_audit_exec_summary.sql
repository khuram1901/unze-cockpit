-- 152_audit_exec_summary.sql
-- Lightweight audit portfolio RPC for the CEO executive dashboard.
-- Returns per-team aggregates + overall totals — no individual process detail.
-- Accessible to any admin/exec (is_admin_or_exec()); audit managers also see it.

create or replace function audit_executive_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  if not (is_admin_or_exec() or get_user_department() = 'Audit') then
    return jsonb_build_object('error', 'not_authorised');
  end if;

  with proc_stats as (
    -- One row per process with completion % (day-weighted; stage-count fallback)
    select
      p.id,
      p.status,
      p.target_date,
      atc.team_id,
      case
        when p.status = 'Completed' then 100
        when coalesce(agg.total_days, 0) > 0
          then round(100.0 * coalesce(agg.done_days, 0) / agg.total_days)::int
        when coalesce(agg.total_stages, 0) > 0
          then round(100.0 * coalesce(agg.done_stages, 0) / agg.total_stages)::int
        else 0
      end as pct
    from audit_plan_processes p
    join audit_team_companies atc on atc.company_id = p.company_id
    left join lateral (
      select
        sum(coalesce(t.total_days, 0))                              as total_days,
        sum(coalesce(t.total_days, 0)) filter (where t.status = 'Completed') as done_days,
        count(*)                                                     as total_stages,
        count(*) filter (where t.status = 'Completed')              as done_stages
      from audit_stage_tasks t
      where t.process_id = p.id
    ) agg on true
    where p.status <> 'Cancelled'
  ),
  team_agg as (
    select
      t.id,
      t.name,
      t.code,
      t.sort_order,
      count(*)                                                                   as total,
      count(*) filter (where ps.status = 'Completed')                            as done,
      count(*) filter (where ps.status = 'In Progress')                          as running,
      count(*) filter (where ps.status = 'Planned')                              as planned,
      -- overdue: not completed and target date already passed
      count(*) filter (where ps.status in ('Planned','In Progress')
                         and ps.target_date is not null
                         and ps.target_date < current_date)                      as overdue,
      -- on_track: in progress and target still ahead (or no target)
      count(*) filter (where ps.status = 'In Progress'
                         and (ps.target_date is null or ps.target_date >= current_date)) as on_track,
      round(coalesce(avg(ps.pct), 0))::int                                       as avg_pct,
      min(ps.target_date) filter (where ps.status in ('Planned','In Progress')
                                    and ps.target_date >= current_date)          as next_deadline
    from audit_teams t
    join audit_team_companies atc on atc.team_id = t.id
    join proc_stats ps on ps.team_id = t.id
    -- Exclude pre-audit team from the portfolio view (they do daily checks, not projects)
    where t.code <> 'PREAUDIT'
    group by t.id, t.name, t.code, t.sort_order
  )
  select jsonb_build_object(
    'overall', (
      select jsonb_build_object(
        'total',    sum(total),
        'done',     sum(done),
        'running',  sum(running),
        'planned',  sum(planned),
        'overdue',  sum(overdue),
        'on_track', sum(on_track),
        'avg_pct',  round(coalesce(avg(avg_pct), 0))::int
      )
      from team_agg
    ),
    'teams', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',           ta.id,
          'name',         ta.name,
          'code',         ta.code,
          'total',        ta.total,
          'done',         ta.done,
          'running',      ta.running,
          'planned',      ta.planned,
          'overdue',      ta.overdue,
          'on_track',     ta.on_track,
          'avg_pct',      ta.avg_pct,
          'next_deadline',ta.next_deadline
        ) order by ta.sort_order
      )
      from team_agg ta
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

grant execute on function audit_executive_summary() to authenticated;
