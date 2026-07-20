-- Migration 181: get_tax_dashboard_summary RPC
-- Replaces 5 parallel Supabase queries + 8 JS aggregation loops in AccountsTaxDashboard.tsx
-- with a single database round-trip (Rule 0 compliance).
--
-- Returns JSON with:
--   schedule_entries   — raw rows for interactive schedule grid
--   return_filings     — raw rows for interactive filing grid
--   signoffs           — raw rows for sign-off button state
--   available_years    — distinct years that have data
--   schedule_kpis      — {not_started, in_progress, ext_auditors, completed} across all sections
--   filing_kpis        — {filed, not_filed, overdue} across all return types
--   overdue_items      — list of {entity_label, return_label, period} past due and not filed
--   pending_signoffs   — list of {entity_label, section_label} all steps done but not signed off
--   section_summaries  — per-section {completed, in_progress, not_started, total, pct}

create or replace function get_tax_dashboard_summary(p_tax_year text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sy   int  := split_part(p_tax_year, '-', 1)::int;
  v_ny   int;

  -- All 12 months of the fiscal year (Jul–Jun)
  v_all_months text[];

  -- Entity lists (mirrors JS constants)
  v_q_entities   text[] := array['UT','IMP','BARANH','HD'];
  v_ann_entities text[] := array['UT','IMP','BARANH','HD','ALMAHAR','KK_JHANG','K_SALEEM','KA_SALEEM','W_SALEEM','SH_SALEEM'];

  -- Step counts
  v_q_steps   int := 5;
  v_ann_steps int := 6;

  -- Total expected schedule steps across all sections/entities
  -- Q1+Q2+Q3+Q4: 4 sections × 4 entities × 5 steps = 80
  -- Annual:       1 section  × 10 entities × 6 steps = 60
  -- Grand total: 140
  v_total_expected int := 140;

  -- Accumulators for schedule KPIs
  v_completed    int := 0;
  v_in_progress  int := 0;
  v_ext_auditors int := 0;

  -- Result pieces
  r_schedule_entries  json;
  r_return_filings    json;
  r_signoffs          json;
  r_available_years   json;
  r_schedule_kpis     json;
  r_filing_kpis       json;
  r_overdue_items     json;
  r_pending_signoffs  json;
  r_section_summaries json;
begin
  v_ny := v_sy + 1;

  v_all_months := array[
    v_sy::text||'-07', v_sy::text||'-08', v_sy::text||'-09',
    v_sy::text||'-10', v_sy::text||'-11', v_sy::text||'-12',
    v_ny::text||'-01', v_ny::text||'-02', v_ny::text||'-03',
    v_ny::text||'-04', v_ny::text||'-05', v_ny::text||'-06'
  ];

  -- ── 1. Raw data for interactive grids ─────────────────────────────

  select coalesce(json_agg(row_to_json(t)), '[]'::json)
  into r_schedule_entries
  from (
    select section, step_index, entity_key, status
    from   tax_schedule_entries
    where  tax_year = p_tax_year
  ) t;

  select coalesce(json_agg(row_to_json(t)), '[]'::json)
  into r_return_filings
  from (
    select return_type, entity_key, period_key, filed
    from   tax_return_filings
    where  tax_year = p_tax_year
  ) t;

  select coalesce(json_agg(row_to_json(t)), '[]'::json)
  into r_signoffs
  from (
    select section, entity_key, signed_off, signed_off_by, signed_off_at
    from   tax_accounts_signoffs
    where  tax_year = p_tax_year
  ) t;

  -- ── 2. Available years (union of both tables) ─────────────────────

  select coalesce(json_agg(y order by y), '[]'::json)
  into   r_available_years
  from (
    select tax_year as y from tax_schedule_entries
    union
    select tax_year         from tax_return_filings
  ) years;

  -- ── 3. Schedule KPIs ──────────────────────────────────────────────
  -- Count actual statuses; subtract from expected total for not_started.

  select
    coalesce(sum(case when status = 'Completed'         then 1 else 0 end), 0),
    coalesce(sum(case when status = 'In Progress'       then 1 else 0 end), 0),
    coalesce(sum(case when status = 'External Auditors' then 1 else 0 end), 0)
  into v_completed, v_in_progress, v_ext_auditors
  from tax_schedule_entries
  where tax_year = p_tax_year;

  r_schedule_kpis := json_build_object(
    'not_started',  v_total_expected - v_completed - v_in_progress - v_ext_auditors,
    'in_progress',  v_in_progress,
    'ext_auditors', v_ext_auditors,
    'completed',    v_completed
  );

  -- ── 4. Section summaries ──────────────────────────────────────────
  -- All five sections always present; missing sections default to all not_started.

  with all_sections(sec, total_steps) as (
    values ('Q1', 20), ('Q2', 20), ('Q3', 20), ('Q4', 20), ('Annual', 60)
  ),
  actual as (
    select
      section,
      coalesce(sum(case when status = 'Completed'                           then 1 else 0 end), 0) as done,
      coalesce(sum(case when status in ('In Progress','External Auditors')   then 1 else 0 end), 0) as wip
    from  tax_schedule_entries
    where tax_year = p_tax_year
    group by section
  )
  select json_object_agg(
    s.sec,
    json_build_object(
      'completed',   coalesce(a.done, 0),
      'in_progress', coalesce(a.wip, 0),
      'not_started', s.total_steps - coalesce(a.done, 0) - coalesce(a.wip, 0),
      'total',       s.total_steps,
      'pct',         case when s.total_steps > 0
                       then round((coalesce(a.done, 0)::numeric / s.total_steps) * 100)
                       else 0 end
    )
  )
  into r_section_summaries
  from all_sections s
  left join actual a on a.section = s.sec;

  -- ── 5. Filing KPIs + overdue items ────────────────────────────────
  -- Build full expected matrix then left-join to actual filings.
  -- Due dates: monthly → period_key-15; INCOME_TAX quarterly → hardcoded dates.

  with expected as (
    -- FBR_SALES_TAX: UT, IMP × 12 months
    select 'FBR_SALES_TAX'::text as rt,
           'FBR Sales Tax'::text as rl,
           e.ek,
           m.mo,
           'monthly'::text        as freq
    from unnest(array['UT','IMP']) as e(ek)
    cross join unnest(v_all_months) as m(mo)

    union all

    -- PRA_TAX: UT, IMP, BARANH, HD × 12 months
    select 'PRA_TAX', 'PRA Tax', e.ek, m.mo, 'monthly'
    from unnest(array['UT','IMP','BARANH','HD']) as e(ek)
    cross join unnest(v_all_months) as m(mo)

    union all

    -- INCOME_TAX: UT, IMP, BARANH, HD × 4 quarters
    select 'INCOME_TAX', 'Income Tax', e.ek, q.qk, 'quarterly'
    from unnest(array['UT','IMP','BARANH','HD']) as e(ek)
    cross join unnest(array['Q1','Q2','Q3','Q4']) as q(qk)
  ),
  with_dates as (
    select
      exp.rt,
      exp.rl,
      exp.ek,
      exp.mo,
      case
        when exp.freq = 'monthly' then (exp.mo || '-15')::date
        when exp.mo = 'Q1'        then make_date(v_sy, 10, 15)
        when exp.mo = 'Q2'        then make_date(v_ny,  1, 15)
        when exp.mo = 'Q3'        then make_date(v_ny,  4, 15)
        when exp.mo = 'Q4'        then make_date(v_ny,  7, 15)
      end as due_date,
      coalesce(rf.filed, false) as filed
    from expected exp
    left join tax_return_filings rf
      on  rf.tax_year    = p_tax_year
      and rf.return_type = exp.rt
      and rf.entity_key  = exp.ek
      and rf.period_key  = exp.mo
  )
  select
    -- Filing KPIs
    json_build_object(
      'filed',     count(*) filter (where filed),
      'overdue',   count(*) filter (where not filed and current_date > due_date),
      'not_filed', count(*) filter (where not filed and current_date <= due_date)
    ),
    -- Overdue items list
    coalesce(
      json_agg(
        json_build_object(
          'entity_label', case ek
            when 'UT'     then 'Unze Trading'
            when 'IMP'    then 'Imperial'
            when 'BARANH' then 'Baranh'
            when 'HD'     then 'Haute Dolci'
            else ek end,
          'return_label', rl,
          'period',       mo
        )
      ) filter (where not filed and current_date > due_date),
      '[]'::json
    )
  into r_filing_kpis, r_overdue_items
  from with_dates;

  -- ── 6. Pending sign-offs ──────────────────────────────────────────
  -- An entity/section is "pending" when every step is Completed and
  -- no signed-off signoff record exists yet.

  with all_steps_done as (
    -- Quarterly sections (Q1–Q4): must have all v_q_steps completed
    select section, entity_key,
           count(*) filter (where status = 'Completed') >= v_q_steps as all_done
    from  tax_schedule_entries
    where tax_year  = p_tax_year
      and section   in ('Q1','Q2','Q3','Q4')
      and entity_key = any(v_q_entities)
    group by section, entity_key

    union all

    -- Annual section: must have all v_ann_steps completed
    select section, entity_key,
           count(*) filter (where status = 'Completed') >= v_ann_steps as all_done
    from  tax_schedule_entries
    where tax_year  = p_tax_year
      and section   = 'Annual'
      and entity_key = any(v_ann_entities)
    group by section, entity_key
  ),
  signed as (
    select section, entity_key
    from  tax_accounts_signoffs
    where tax_year  = p_tax_year
      and signed_off = true
  )
  select coalesce(
    json_agg(
      json_build_object(
        'entity_label', case asd.entity_key
          when 'UT'        then 'Unze Trading'
          when 'IMP'       then 'Imperial'
          when 'BARANH'    then 'Baranh'
          when 'HD'        then 'Haute Dolci'
          when 'ALMAHAR'   then 'Almahar'
          when 'KK_JHANG'  then 'K&K Jhang'
          when 'K_SALEEM'  then 'Khuram Saleem'
          when 'KA_SALEEM' then 'Kamran Saleem'
          when 'W_SALEEM'  then 'Waqas Saleem'
          when 'SH_SALEEM' then 'Mrs. Shahida Saleem'
          else asd.entity_key end,
        'section_label', asd.section
      )
    ),
    '[]'::json
  )
  into r_pending_signoffs
  from all_steps_done asd
  left join signed s
    on s.section   = asd.section
   and s.entity_key = asd.entity_key
  where asd.all_done
    and s.entity_key is null;

  -- ── 7. Return assembled result ─────────────────────────────────────

  return json_build_object(
    'schedule_entries',  r_schedule_entries,
    'return_filings',    r_return_filings,
    'signoffs',          r_signoffs,
    'available_years',   r_available_years,
    'schedule_kpis',     r_schedule_kpis,
    'filing_kpis',       r_filing_kpis,
    'overdue_items',     r_overdue_items,
    'pending_signoffs',  r_pending_signoffs,
    'section_summaries', coalesce(r_section_summaries, '{}'::json)
  );
end;
$$;
