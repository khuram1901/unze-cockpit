-- Migration 055: Plant KPI RPC function
-- Replaces the 4-table 90-day raw fetch on home + ops dashboard pages.
-- Instead of downloading ~2000 rows to the browser and computing stock/KPIs
-- in JS, this function returns one summary row per active plant, computed
-- entirely in Postgres.
--
-- Apply manually in Supabase SQL Editor. No tables are modified.

create or replace function get_plant_kpis(as_of_date date, month_start date, month_end date)
returns table (
  plant_id              uuid,
  plant_name            text,
  plant_type            text,

  -- Opening balances (latest snapshot per plant)
  opening_good_31       numeric,
  opening_good_36       numeric,
  opening_good_45       numeric,
  opening_good_meter    numeric,
  opening_broken_31     numeric,
  opening_broken_36     numeric,
  opening_broken_45     numeric,
  opening_cutoff_date   date,
  broken_cutoff_date    date,

  -- Totals since opening balance cutoff up to as_of_date (for closing stock)
  produced_31           numeric,
  produced_36           numeric,
  produced_45           numeric,
  produced_meter        numeric,
  dispatched_31         numeric,
  dispatched_36         numeric,
  dispatched_45         numeric,
  dispatched_meter      numeric,
  broken_31             numeric,
  broken_36             numeric,
  broken_45             numeric,
  scrap_31              numeric,
  scrap_36              numeric,
  scrap_45              numeric,

  -- On the selected date only (for "today's" KPI cards)
  on_date_produced_31   numeric,
  on_date_produced_36   numeric,
  on_date_produced_45   numeric,
  on_date_produced_meter numeric,
  on_date_dispatched_31 numeric,
  on_date_dispatched_36 numeric,
  on_date_dispatched_45 numeric,
  on_date_dispatched_meter numeric,
  on_date_broken_31     numeric,
  on_date_broken_36     numeric,
  on_date_broken_45     numeric,

  -- Month-to-date totals (month_start..as_of_date) for KPI achievement
  mtd_produced          numeric,
  mtd_dispatched        numeric,
  mtd_broken            numeric,

  -- Whether any entry was recorded on the selected date
  entered_on_date       boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with

  -- Latest good-stock opening balance per plant
  good_opening as (
    select distinct on (plant_id)
      plant_id,
      coalesce(bal_31, 0)    as bal_31,
      coalesce(bal_36, 0)    as bal_36,
      coalesce(bal_45, 0)    as bal_45,
      coalesce(bal_meter, 0) as bal_meter,
      created_at::date       as cutoff_date
    from opening_balances
    order by plant_id, created_at desc
  ),

  -- Latest broken-stock opening balance per plant
  broken_opening as (
    select distinct on (plant_id)
      plant_id,
      coalesce(bal_31, 0)  as bal_31,
      coalesce(bal_36, 0)  as bal_36,
      coalesce(bal_45, 0)  as bal_45,
      created_at::date     as cutoff_date
    from broken_opening_balances
    order by plant_id, created_at desc
  ),

  -- Cumulative production since the opening balance cutoff date, up to as_of_date
  prod_totals as (
    select
      pe.plant_id,
      sum(coalesce(pe.qty_31, 0))    as tot_31,
      sum(coalesce(pe.qty_36, 0))    as tot_36,
      sum(coalesce(pe.qty_45, 0))    as tot_45,
      sum(coalesce(pe.qty_meter, 0)) as tot_meter
    from production_entries pe
    join good_opening go on go.plant_id = pe.plant_id
    where pe.entry_date >= go.cutoff_date
      and pe.entry_date <= get_plant_kpis.as_of_date
    group by pe.plant_id
  ),

  -- Cumulative dispatch since the opening balance cutoff date, up to as_of_date
  disp_totals as (
    select
      de.plant_id,
      sum(coalesce(de.qty_31, 0))    as tot_31,
      sum(coalesce(de.qty_36, 0))    as tot_36,
      sum(coalesce(de.qty_45, 0))    as tot_45,
      sum(coalesce(de.qty_meter, 0)) as tot_meter
    from dispatch_entries de
    join good_opening go on go.plant_id = de.plant_id
    where de.entry_date >= go.cutoff_date
      and de.entry_date <= get_plant_kpis.as_of_date
    group by de.plant_id
  ),

  -- Cumulative breakage since the opening balance cutoff date, up to as_of_date
  brk_totals as (
    select
      be.plant_id,
      sum(coalesce(be.qty_31, 0)) as tot_31,
      sum(coalesce(be.qty_36, 0)) as tot_36,
      sum(coalesce(be.qty_45, 0)) as tot_45
    from breakage_entries be
    join good_opening go on go.plant_id = be.plant_id
    where be.entry_date >= go.cutoff_date
      and be.entry_date <= get_plant_kpis.as_of_date
    group by be.plant_id
  ),

  -- Cumulative scrap since the broken-stock opening cutoff, up to as_of_date
  scrap_totals as (
    select
      se.plant_id,
      sum(coalesce(se.qty_31, 0)) as tot_31,
      sum(coalesce(se.qty_36, 0)) as tot_36,
      sum(coalesce(se.qty_45, 0)) as tot_45
    from scrap_processed_entries se
    join broken_opening bo on bo.plant_id = se.plant_id
    where se.entry_date >= bo.cutoff_date
      and se.entry_date <= get_plant_kpis.as_of_date
    group by se.plant_id
  ),

  -- On the selected date only
  prod_on_date as (
    select
      plant_id,
      sum(coalesce(qty_31, 0))    as tot_31,
      sum(coalesce(qty_36, 0))    as tot_36,
      sum(coalesce(qty_45, 0))    as tot_45,
      sum(coalesce(qty_meter, 0)) as tot_meter
    from production_entries
    where entry_date = get_plant_kpis.as_of_date
    group by plant_id
  ),

  disp_on_date as (
    select
      plant_id,
      sum(coalesce(qty_31, 0))    as tot_31,
      sum(coalesce(qty_36, 0))    as tot_36,
      sum(coalesce(qty_45, 0))    as tot_45,
      sum(coalesce(qty_meter, 0)) as tot_meter
    from dispatch_entries
    where entry_date = get_plant_kpis.as_of_date
    group by plant_id
  ),

  brk_on_date as (
    select
      plant_id,
      sum(coalesce(qty_31, 0)) as tot_31,
      sum(coalesce(qty_36, 0)) as tot_36,
      sum(coalesce(qty_45, 0)) as tot_45
    from breakage_entries
    where entry_date = get_plant_kpis.as_of_date
    group by plant_id
  ),

  -- Month-to-date totals (month_start..as_of_date)
  prod_mtd as (
    select
      plant_id,
      sum(coalesce(qty_31, 0) + coalesce(qty_36, 0) + coalesce(qty_45, 0) + coalesce(qty_meter, 0)) as total
    from production_entries
    where entry_date >= get_plant_kpis.month_start
      and entry_date <= get_plant_kpis.as_of_date
    group by plant_id
  ),

  disp_mtd as (
    select
      plant_id,
      sum(coalesce(qty_31, 0) + coalesce(qty_36, 0) + coalesce(qty_45, 0) + coalesce(qty_meter, 0)) as total
    from dispatch_entries
    where entry_date >= get_plant_kpis.month_start
      and entry_date <= get_plant_kpis.as_of_date
    group by plant_id
  ),

  brk_mtd as (
    select
      plant_id,
      sum(coalesce(qty_31, 0) + coalesce(qty_36, 0) + coalesce(qty_45, 0)) as total
    from breakage_entries
    where entry_date >= get_plant_kpis.month_start
      and entry_date <= get_plant_kpis.as_of_date
    group by plant_id
  ),

  -- Whether any entry exists for this plant on as_of_date
  entered_today as (
    select plant_id from production_entries where entry_date = get_plant_kpis.as_of_date
    union
    select plant_id from dispatch_entries   where entry_date = get_plant_kpis.as_of_date
    union
    select plant_id from breakage_entries   where entry_date = get_plant_kpis.as_of_date
  )

  select
    p.id                                         as plant_id,
    p.name                                       as plant_name,
    p.type                                       as plant_type,

    coalesce(go.bal_31, 0)                       as opening_good_31,
    coalesce(go.bal_36, 0)                       as opening_good_36,
    coalesce(go.bal_45, 0)                       as opening_good_45,
    coalesce(go.bal_meter, 0)                    as opening_good_meter,
    coalesce(bo.bal_31, 0)                       as opening_broken_31,
    coalesce(bo.bal_36, 0)                       as opening_broken_36,
    coalesce(bo.bal_45, 0)                       as opening_broken_45,
    go.cutoff_date                               as opening_cutoff_date,
    bo.cutoff_date                               as broken_cutoff_date,

    coalesce(pt.tot_31, 0)                       as produced_31,
    coalesce(pt.tot_36, 0)                       as produced_36,
    coalesce(pt.tot_45, 0)                       as produced_45,
    coalesce(pt.tot_meter, 0)                    as produced_meter,
    coalesce(dt.tot_31, 0)                       as dispatched_31,
    coalesce(dt.tot_36, 0)                       as dispatched_36,
    coalesce(dt.tot_45, 0)                       as dispatched_45,
    coalesce(dt.tot_meter, 0)                    as dispatched_meter,
    coalesce(bt.tot_31, 0)                       as broken_31,
    coalesce(bt.tot_36, 0)                       as broken_36,
    coalesce(bt.tot_45, 0)                       as broken_45,
    coalesce(st.tot_31, 0)                       as scrap_31,
    coalesce(st.tot_36, 0)                       as scrap_36,
    coalesce(st.tot_45, 0)                       as scrap_45,

    coalesce(pod.tot_31, 0)                      as on_date_produced_31,
    coalesce(pod.tot_36, 0)                      as on_date_produced_36,
    coalesce(pod.tot_45, 0)                      as on_date_produced_45,
    coalesce(pod.tot_meter, 0)                   as on_date_produced_meter,
    coalesce(dod.tot_31, 0)                      as on_date_dispatched_31,
    coalesce(dod.tot_36, 0)                      as on_date_dispatched_36,
    coalesce(dod.tot_45, 0)                      as on_date_dispatched_45,
    coalesce(dod.tot_meter, 0)                   as on_date_dispatched_meter,
    coalesce(bod.tot_31, 0)                      as on_date_broken_31,
    coalesce(bod.tot_36, 0)                      as on_date_broken_36,
    coalesce(bod.tot_45, 0)                      as on_date_broken_45,

    coalesce(pm.total, 0)                        as mtd_produced,
    coalesce(dm.total, 0)                        as mtd_dispatched,
    coalesce(bm.total, 0)                        as mtd_broken,

    (et.plant_id is not null)                    as entered_on_date

  from plants p
  left join good_opening   go  on go.plant_id  = p.id
  left join broken_opening bo  on bo.plant_id  = p.id
  left join prod_totals    pt  on pt.plant_id  = p.id
  left join disp_totals    dt  on dt.plant_id  = p.id
  left join brk_totals     bt  on bt.plant_id  = p.id
  left join scrap_totals   st  on st.plant_id  = p.id
  left join prod_on_date   pod on pod.plant_id = p.id
  left join disp_on_date   dod on dod.plant_id = p.id
  left join brk_on_date    bod on bod.plant_id = p.id
  left join prod_mtd       pm  on pm.plant_id  = p.id
  left join disp_mtd       dm  on dm.plant_id  = p.id
  left join brk_mtd        bm  on bm.plant_id  = p.id
  left join entered_today  et  on et.plant_id  = p.id
  where p.active = true
  order by p.name;
$$;

grant execute on function get_plant_kpis(date, date, date) to authenticated;
