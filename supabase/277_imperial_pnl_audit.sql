-- Migration 277: Imperial P&L page audit — access checks, store identity,
-- Supabase-side period summary, FY growth, like-for-like, data coverage.
-- 18/10/2026. Applied to production 18/10/2026 via execute_sql.
--
-- 1. Every IFPL RPC was SECURITY DEFINER with EXECUTE granted to
--    `authenticated` and NO caller check — any signed-in user (e.g. a store
--    account) could read the whole P&L by calling the RPC directly. All of
--    them now call assert_ifpl_pnl_access(), which mirrors canViewIfplPnl()
--    in app/lib/permissions.ts (PA never; Access Matrix toggle
--    can_view_ifpl_pnl; otherwise Admin/CEO/main admin). The service role
--    (server routes) passes through.
-- 2. The page grouped by the branch TEXT in each month's workbook, so the
--    same store appeared twice when the file spelt it differently
--    ("Sialkot Store"/"Mall of Sailkot", "Kooh I Noor"/"Faisalabad KN") or
--    when the master location list held a duplicate (Emporium Mall, Iqbal
--    Town). ifpl_pnl_lines_v groups by master location (location_id) and
--    normalises the channel from location_type, so "Retail" = retail stores
--    only and "Sukkur" (parsed as "UK" because s-UK-kur) is Retail.
--    Data fix run the same day (UPDATEs only, no deletes): P&L rows moved
--    onto the location record HR/Stores use; 6 compliance + 2 NTN docs
--    repointed; the two duplicate admin_locations set inactive and renamed
--    "(duplicate — merged 18/10/26)"; Sukkur channel UK→Retail (79 rows);
--    Head Office location_type retail→office; 029 renamed "Mall of Sialkot",
--    061 renamed "Faisalabad KN"; aliases added for Emporium Mall and Iqbal
--    Town so future uploads land on the right record.
-- 3. ifpl_period_summary() computes every headline figure, channel total,
--    star, watch-list entry, expense-vs-plan line and "needs attention" item
--    in Postgres for the selected period/scope (GOLDEN RULE — no JS reduces).
-- 4. ifpl_store_league(), ifpl_sales_by_fy(), ifpl_yoy_stores(),
--    ifpl_data_coverage() — new, see comments inline.
-- 5. get_pnl_commentary / get_pnl_restatements are shared with the UTPL and
--    restaurants pages, so they check per company via can_view_pnl_company_db().

begin;

-- ───────────────────────── 1. Access ─────────────────────────────────────
create or replace function public.can_view_ifpl_pnl_db()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when m.role = 'Executive' or m.email = 'pa.ceo@unze.co.uk' then false
      when p.can_view_ifpl_pnl is not null then p.can_view_ifpl_pnl
      else m.role in ('Admin','CEO') or m.email = 'khuram1901@gmail.com'
    end
    from members m
    left join member_permissions p on p.member_id = m.id
    where m.email = auth.email() and m.is_active
  ), false);
$$;
revoke execute on function public.can_view_ifpl_pnl_db() from anon, public;
grant execute on function public.can_view_ifpl_pnl_db() to authenticated;

create or replace function public.can_view_pnl_company_db(p_company text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare co uuid;
begin
  if p_company = 'IFPL' then return can_view_ifpl_pnl_db(); end if;
  if p_company in ('BARANH','HD') then
    return coalesce((
      select case
        when m.role = 'Executive' or m.email = 'pa.ceo@unze.co.uk' then false
        when p.can_view_restaurants_pnl is not null then p.can_view_restaurants_pnl
        else m.role in ('Admin','CEO') or m.email = 'khuram1901@gmail.com'
      end
      from members m left join member_permissions p on p.member_id = m.id
      where m.email = auth.email() and m.is_active), false);
  end if;
  select id into co from companies where short_code = p_company limit 1;
  return can_see_company_finance(co);
end $$;
revoke execute on function public.can_view_pnl_company_db(text) from anon, public;
grant execute on function public.can_view_pnl_company_db(text) to authenticated;

create or replace function public.assert_ifpl_pnl_access()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return; end if;
  if not can_view_ifpl_pnl_db() then
    raise exception 'Not authorised to view Imperial Footwear''s P&L' using errcode = '42501';
  end if;
end $$;
revoke execute on function public.assert_ifpl_pnl_access() from anon, public;
grant execute on function public.assert_ifpl_pnl_access() to authenticated;

create or replace function public.assert_pnl_company_access(p_company text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return; end if;
  if not can_view_pnl_company_db(p_company) then
    raise exception 'Not authorised to view this company''s P&L' using errcode = '42501';
  end if;
end $$;
revoke execute on function public.assert_pnl_company_access(text) from anon, public;
grant execute on function public.assert_pnl_company_access(text) to authenticated;

-- ───────────────────────── 2. Store identity ─────────────────────────────
-- One row per P&L line, keyed by MASTER location. branch_name is the master
-- name (falls back to the file's text only for an unmapped branch).
create or replace view public.ifpl_pnl_lines_v as
  select
    p.id, p.upload_id, p.month, p.line, p.category, p.projection, p.actual,
    p.location_id,
    coalesce(p.location_id::text, 'txt:' || p.branch)            as branch_key,
    coalesce(l.name, p.branch)                                   as branch_name,
    case
      when l.location_type = 'online' or p.channel = 'Online PK'            then 'Online PK'
      when l.location_type in ('warehouse','office') or p.channel = 'Cost centre' then 'Cost centre'
      else 'Retail'
    end                                                          as channel_norm
  from ifpl_pnl_lines p
  left join admin_locations l on l.id = p.location_id;
revoke all on public.ifpl_pnl_lines_v from anon, authenticated, public;

create or replace function public.ifpl_kpi_by_month(p_from date, p_to date, p_channel text default 'All', p_branch text default 'All')
returns table(month date, proj_sales numeric, act_sales numeric, proj_gp numeric, act_gp numeric, proj_overheads numeric, act_overheads numeric, proj_final numeric, act_final numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_ifpl_pnl_access();
  return query
  select v.month,
    sum(v.projection) filter (where v.line = 'Net Sales'),
    sum(v.actual)     filter (where v.line = 'Net Sales'),
    sum(v.projection) filter (where v.line = 'Gross Profit'),
    sum(v.actual)     filter (where v.line = 'Gross Profit'),
    sum(v.projection) filter (where v.line = 'Total Overheads'),
    sum(v.actual)     filter (where v.line = 'Total Overheads'),
    sum(v.projection) filter (where v.line = 'Final Profit'),
    sum(v.actual)     filter (where v.line = 'Final Profit')
  from ifpl_pnl_lines_v v
  where v.month between p_from and p_to
    and (p_channel = 'All' or v.channel_norm = p_channel)
    and (p_branch = 'All' or v.branch_name = p_branch)
  group by v.month order by v.month;
end $$;

create or replace function public.ifpl_branch_league(p_from date, p_to date)
returns table(branch text, channel text, proj_sales numeric, act_sales numeric, act_gp numeric, act_final numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_ifpl_pnl_access();
  return query
  select v.branch_name, v.channel_norm,
    sum(v.projection) filter (where v.line = 'Net Sales'),
    sum(v.actual)     filter (where v.line = 'Net Sales'),
    sum(v.actual)     filter (where v.line = 'Gross Profit'),
    sum(v.actual)     filter (where v.line = 'Final Profit')
  from ifpl_pnl_lines_v v
  where v.month between p_from and p_to
  group by v.branch_key, v.branch_name, v.channel_norm
  order by 4 desc nulls last;
end $$;

create or replace function public.ifpl_line_totals(p_from date, p_to date, p_channel text default 'All', p_branch text default 'All')
returns table(line text, category text, projection numeric, actual numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_ifpl_pnl_access();
  return query
  select v.line, v.category, sum(v.projection), sum(v.actual)
  from ifpl_pnl_lines_v v
  where v.month between p_from and p_to
    and v.category in ('overhead','below_add','below_less')
    and (p_channel = 'All' or v.channel_norm = p_channel)
    and (p_branch = 'All' or v.branch_name = p_branch)
  group by v.line, v.category order by 4 desc;
end $$;

create or replace function public.ifpl_validation_summary()
returns table(month date, file_name text, status text, checks_passed integer, checks_failed integer, warnings integer, uploaded_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_ifpl_pnl_access();
  return query
  select distinct on (u.month) u.month, u.file_name, u.status, u.checks_passed, u.checks_failed, u.warnings, u.uploaded_at
  from ifpl_pnl_uploads u order by u.month, u.uploaded_at desc;
end $$;

create or replace function public.ifpl_check_details()
returns table(month date, check_name text, expected numeric, reported numeric, diff numeric, blocking boolean, status text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_ifpl_pnl_access();
  return query
  select u.month, c.check_name, c.expected, c.reported, c.diff, c.blocking, u.status
  from ifpl_pnl_checks c join ifpl_pnl_uploads u on u.id = c.upload_id
  where c.passed = false
    and u.uploaded_at = (select max(u2.uploaded_at) from ifpl_pnl_uploads u2 where u2.month = u.month)
  order by u.month, c.blocking desc, c.check_name;
end $$;

create or replace function public.ifpl_net_sales_total(p_from date, p_to date)
returns numeric language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_ifpl_pnl_access();
  return (select coalesce(sum(actual), 0) from ifpl_pnl_lines where line = 'Net Sales' and month between p_from and p_to);
end $$;

create or replace function public.get_pnl_commentary(p_company text, p_scope text, p_from date, p_to date)
returns table(insights jsonb, actions jsonb, generated_by text, generated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_pnl_company_access(p_company);
  return query
  select c.insights, c.actions, c.generated_by, c.generated_at from pnl_commentary c
  where c.company = p_company and c.scope_key = p_scope and c.month_from = p_from and c.month_to = p_to limit 1;
end $$;

create or replace function public.get_pnl_restatements(p_company text, p_limit integer default 100)
returns table(month date, scope text, line text, old_value numeric, new_value numeric, changed_by text, changed_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_pnl_company_access(p_company);
  return query
  select r.month, r.scope, r.line, r.old_value, r.new_value, r.changed_by, r.changed_at from pnl_restatements r
  where r.company = p_company order by r.changed_at desc, r.month desc limit least(greatest(p_limit, 1), 500);
end $$;

-- Balance sheet (Imperial only — the IFPL page is its only caller).
create or replace function public.get_balance_sheet_ifl(p_company_id text, p_month text)
returns setof balance_sheet_ifl language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_ifpl_pnl_access();
  return query select * from balance_sheet_ifl b where b.company_id = p_company_id and b.month <= p_month::date order by b.month desc limit 2;
end $$;
create or replace function public.get_balance_sheet_ifl_months(p_company_id text)
returns table(month text) language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_ifpl_pnl_access();
  return query select to_char(b.month, 'YYYY-MM-DD') from balance_sheet_ifl b where b.company_id = p_company_id order by b.month;
end $$;
create or replace function public.get_balance_sheet_notes(p_company_id text, p_month text, p_note_no integer default null)
returns table(note_no integer, section text, account_code text, account_name text, amount numeric, is_total boolean, is_header boolean, row_order integer)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_ifpl_pnl_access();
  return query
  select n.note_no, n.section, n.account_code, n.account_name, n.amount, n.is_total, n.is_header, n.row_order
  from balance_sheet_notes n
  where n.company_id = p_company_id and n.month = p_month::date and (p_note_no is null or n.note_no = p_note_no)
  order by n.row_order;
end $$;

-- ───────────────────────── 3. Period summary ─────────────────────────────
-- Everything the page's cards show for one period + scope, in one call.
-- Helper: unpack the per-store jsonb array built inside ifpl_period_summary.
create or replace function public._ifpl_stores_from(j jsonb)
returns table(branch_name text, channel text, months int, proj_sales numeric, act_sales numeric, act_gp numeric, act_final numeric)
language sql immutable as $$
  select * from jsonb_to_recordset(j) as x(branch_name text, channel text, months int, proj_sales numeric, act_sales numeric, act_gp numeric, act_final numeric);
$$;
revoke execute on function public._ifpl_stores_from(jsonb) from anon, authenticated, public;
alter function public._ifpl_stores_from(jsonb) set search_path = public; -- re-audit 18/10: advisor flagged mutable search_path

create or replace function public.ifpl_period_summary(p_from date, p_to date, p_channel text default 'All', p_branch text default 'All')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  stores jsonb; tot jsonb; chan jsonb; stars jsonb; watch jsonb; overheads jsonb; below jsonb; attention jsonb := '[]'::jsonb;
  latest record; r record; n_loss int; n_offplan int; worst_loss record; worst_offplan record;
  gp_pct numeric; gp_plan_pct numeric; oh_var numeric;
begin
  perform assert_ifpl_pnl_access();

  -- Per-store roll-up for the period (whole company, scope-independent),
  -- held as a jsonb array and re-read with jsonb_to_recordset (no temp
  -- table, so the function stays STABLE and MCP-safe).
  select coalesce(jsonb_agg(jsonb_build_object('branch_name', x.branch_name, 'channel', x.channel, 'months', x.months,
    'proj_sales', x.proj_sales, 'act_sales', x.act_sales, 'act_gp', x.act_gp, 'act_final', x.act_final)), '[]'::jsonb)
  into stores from (
    select v.branch_name, v.channel_norm channel, count(distinct v.month) months,
      coalesce(sum(v.projection) filter (where v.line = 'Net Sales'), 0) proj_sales,
      coalesce(sum(v.actual)     filter (where v.line = 'Net Sales'), 0) act_sales,
      coalesce(sum(v.actual)     filter (where v.line = 'Gross Profit'), 0) act_gp,
      coalesce(sum(v.actual)     filter (where v.line = 'Final Profit'), 0) act_final
    from ifpl_pnl_lines_v v where v.month between p_from and p_to
    group by v.branch_key, v.branch_name, v.channel_norm) x;

  -- Headline totals for the SELECTED scope.
  select jsonb_build_object(
    'months', count(distinct v.month),
    'sales', coalesce(sum(v.actual) filter (where v.line = 'Net Sales'), 0),
    'proj_sales', coalesce(sum(v.projection) filter (where v.line = 'Net Sales'), 0),
    'gp', coalesce(sum(v.actual) filter (where v.line = 'Gross Profit'), 0),
    'proj_gp', coalesce(sum(v.projection) filter (where v.line = 'Gross Profit'), 0),
    'overheads', coalesce(sum(v.actual) filter (where v.line = 'Total Overheads'), 0),
    'proj_overheads', coalesce(sum(v.projection) filter (where v.line = 'Total Overheads'), 0),
    'final', coalesce(sum(v.actual) filter (where v.line = 'Final Profit'), 0),
    'proj_final', coalesce(sum(v.projection) filter (where v.line = 'Final Profit'), 0))
  into tot
  from ifpl_pnl_lines_v v
  where v.month between p_from and p_to
    and (p_channel = 'All' or v.channel_norm = p_channel)
    and (p_branch = 'All' or v.branch_name = p_branch);

  -- Channel totals (always whole company).
  select jsonb_build_object(
    'online', (select jsonb_build_object('sales', coalesce(sum(act_sales),0), 'proj_sales', coalesce(sum(proj_sales),0), 'final', coalesce(sum(act_final),0)) from _ifpl_stores_from(stores) where channel = 'Online PK'),
    'retail', (select jsonb_build_object('stores', count(*), 'sales', coalesce(sum(act_sales),0), 'proj_sales', coalesce(sum(proj_sales),0), 'gp', coalesce(sum(act_gp),0), 'final', coalesce(sum(act_final),0)) from _ifpl_stores_from(stores) where channel = 'Retail'),
    'cost_centres', (select jsonb_build_object('final', coalesce(sum(act_final),0),
        'items', coalesce(jsonb_agg(jsonb_build_object('branch', branch_name, 'final', act_final) order by act_final), '[]'::jsonb)) from _ifpl_stores_from(stores) where channel = 'Cost centre'),
    'company', (select jsonb_build_object('sales', coalesce(sum(act_sales),0), 'proj_sales', coalesce(sum(proj_sales),0), 'gp', coalesce(sum(act_gp),0), 'final', coalesce(sum(act_final),0)) from _ifpl_stores_from(stores)))
  into chan;

  -- Stars.
  select jsonb_build_object(
    'top_store', (select jsonb_build_object('branch', branch_name, 'final', act_final) from _ifpl_stores_from(stores) where channel = 'Retail' order by act_final desc limit 1),
    'best_margin', (select jsonb_build_object('branch', branch_name, 'margin_pct', round(act_gp / act_sales * 100, 1)) from _ifpl_stores_from(stores) where channel <> 'Cost centre' and act_sales > 20000000 order by act_gp / act_sales desc limit 1),
    'best_beat', (select jsonb_build_object('branch', branch_name, 'beat_pct', round((act_sales / proj_sales - 1) * 100, 1)) from _ifpl_stores_from(stores) where channel <> 'Cost centre' and proj_sales > 5000000 order by act_sales / proj_sales desc limit 1))
  into stars;

  -- Watch list: loss-making (< -100k contribution) or > 20% below plan.
  select count(*) filter (where act_final < -100000), count(*) filter (where proj_sales > 0 and act_sales < proj_sales * 0.8)
  into n_loss, n_offplan from _ifpl_stores_from(stores) where channel <> 'Cost centre';
  select jsonb_build_object(
    'count', (select count(*) from _ifpl_stores_from(stores) where channel <> 'Cost centre' and (act_final < -100000 or (proj_sales > 0 and act_sales < proj_sales * 0.8))),
    'loss_making', (select coalesce(jsonb_agg(jsonb_build_object('branch', branch_name, 'final', act_final, 'sales', act_sales, 'months', months) order by act_final), '[]'::jsonb)
                    from _ifpl_stores_from(stores) where channel <> 'Cost centre' and act_final < -100000),
    'off_plan', (select coalesce(jsonb_agg(jsonb_build_object('branch', branch_name, 'variance_pct', round((act_sales / proj_sales - 1) * 100, 1), 'sales', act_sales, 'proj_sales', proj_sales) order by act_sales / proj_sales), '[]'::jsonb)
                 from _ifpl_stores_from(stores) where channel <> 'Cost centre' and proj_sales > 0 and act_sales < proj_sales * 0.8))
  into watch;

  -- Expense watch: the six largest overhead lines for the scope, with variance.
  select coalesce(jsonb_agg(x order by (x->>'actual')::numeric desc), '[]'::jsonb) into overheads from (
    select jsonb_build_object('line', v.line, 'actual', sum(v.actual), 'projection', sum(v.projection),
      'variance_pct', case when sum(v.projection) <> 0 then round((sum(v.actual) - sum(v.projection)) / abs(sum(v.projection)) * 100, 1) end) x
    from ifpl_pnl_lines_v v
    where v.month between p_from and p_to and v.category = 'overhead'
      and (p_channel = 'All' or v.channel_norm = p_channel)
      and (p_branch = 'All' or v.branch_name = p_branch)
    group by v.line having sum(v.actual) > 0 order by sum(v.actual) desc limit 6) s;
  select coalesce(jsonb_agg(jsonb_build_object('line', s.line, 'actual', s.actual) order by s.actual desc), '[]'::jsonb) into below from (
    select v.line, sum(v.actual) actual from ifpl_pnl_lines_v v
    where v.month between p_from and p_to and v.category like 'below%'
      and (p_channel = 'All' or v.channel_norm = p_channel)
      and (p_branch = 'All' or v.branch_name = p_branch)
    group by v.line) s;

  -- ── Needs attention (ordered: data problems → plan misses → stores → costs)
  for r in
    select u.month, u.rejection_summary, u.uploaded_at,
      (select string_agg(c.check_name || ' (out by ' || to_char(c.diff, 'FM999,999,999,999') || ')', '; ')
         from ifpl_pnl_checks c where c.upload_id = u.id and c.passed = false and c.blocking) failing
    from ifpl_pnl_uploads u
    where u.status <> 'accepted'
      and u.uploaded_at = (select max(u2.uploaded_at) from ifpl_pnl_uploads u2 where u2.month = u.month)
      and not exists (select 1 from ifpl_pnl_lines p where p.month = u.month)
    order by u.month
  loop
    attention := attention || jsonb_build_object('severity', 'urgent', 'kind', 'rejected',
      'title', to_char(r.month, 'Mon YY') || ' upload rejected — figures not in the dashboard',
      'detail', coalesce(r.failing, r.rejection_summary, 'Blocking validation failed') || '. Fix the workbook and re-upload; the month will replace itself.');
  end loop;

  -- Latest month in the period vs plan.
  select k.* into latest from ifpl_kpi_by_month(p_from, p_to, p_channel, p_branch) k order by k.month desc limit 1;
  if latest.month is not null and latest.proj_sales > 0 and latest.act_sales < latest.proj_sales * 0.9 then
    attention := attention || jsonb_build_object('severity', 'urgent', 'kind', 'plan_miss',
      'title', to_char(latest.month, 'Mon YY') || ' sales ' || round((1 - latest.act_sales / latest.proj_sales) * 100, 1) || '% below plan',
      'detail', 'Actual PKR ' || to_char(latest.act_sales, 'FM999,999,999,999') || ' against a plan of PKR ' || to_char(latest.proj_sales, 'FM999,999,999,999') || ' — short by PKR ' || to_char(latest.proj_sales - latest.act_sales, 'FM999,999,999,999') || '.');
  end if;

  -- Gross margin vs plan (period).
  if (tot->>'sales')::numeric > 0 and (tot->>'proj_sales')::numeric > 0 then
    gp_pct := (tot->>'gp')::numeric / (tot->>'sales')::numeric * 100;
    gp_plan_pct := (tot->>'proj_gp')::numeric / (tot->>'proj_sales')::numeric * 100;
    if gp_pct < gp_plan_pct - 2 then
      attention := attention || jsonb_build_object('severity', 'watch', 'kind', 'margin',
        'title', 'Gross margin ' || round(gp_pct, 1) || '% vs ' || round(gp_plan_pct, 1) || '% planned',
        'detail', 'Margin is ' || round(gp_plan_pct - gp_pct, 1) || ' points under plan for the period — discounting or cost of goods is running ahead of the plan assumptions.');
    end if;
  end if;

  -- Overheads vs plan (period).
  if (tot->>'proj_overheads')::numeric > 0 then
    oh_var := ((tot->>'overheads')::numeric - (tot->>'proj_overheads')::numeric) / (tot->>'proj_overheads')::numeric * 100;
    if oh_var > 5 then
      attention := attention || jsonb_build_object('severity', 'watch', 'kind', 'overheads',
        'title', 'Overheads ' || round(oh_var, 1) || '% over plan',
        'detail', 'PKR ' || to_char((tot->>'overheads')::numeric, 'FM999,999,999,999') || ' spent against PKR ' || to_char((tot->>'proj_overheads')::numeric, 'FM999,999,999,999') || ' planned. Largest over-plan lines: ' ||
          coalesce((select string_agg(x->>'line' || ' +' || (x->>'variance_pct') || '%', ', ') from jsonb_array_elements(overheads) x where (x->>'variance_pct')::numeric > 5), 'none individually over 5%') || '.');
    end if;
  end if;

  -- Loss-making stores.
  if n_loss > 0 then
    select branch_name, act_final into worst_loss from _ifpl_stores_from(stores) where channel <> 'Cost centre' and act_final < -100000 order by act_final limit 1;
    attention := attention || jsonb_build_object('severity', case when n_loss >= 3 then 'urgent' else 'watch' end, 'kind', 'losses',
      'title', n_loss || ' store' || case when n_loss > 1 then 's' else '' end || ' loss-making in this period',
      'detail', 'Worst: ' || worst_loss.branch_name || ' at PKR ' || to_char(worst_loss.act_final, 'FM999,999,999,999') || '. Full list under Watch list in the branch league.');
  end if;

  -- Stores far off plan.
  if n_offplan > 0 then
    select branch_name, round((act_sales / proj_sales - 1) * 100, 1) var_pct into worst_offplan from _ifpl_stores_from(stores) where channel <> 'Cost centre' and proj_sales > 0 and act_sales < proj_sales * 0.8 order by act_sales / proj_sales limit 1;
    attention := attention || jsonb_build_object('severity', 'watch', 'kind', 'off_plan',
      'title', n_offplan || ' store' || case when n_offplan > 1 then 's' else '' end || ' more than 20% below sales plan',
      'detail', 'Furthest off: ' || worst_offplan.branch_name || ' (' || worst_offplan.var_pct || '%). Either the plan was set too high or the store needs intervention — check footfall and stock allocation.');
  end if;

  -- Restatements in the last 30 days.
  if exists (select 1 from pnl_restatements where company = 'IFPL' and changed_at > now() - interval '30 days') then
    attention := attention || jsonb_build_object('severity', 'watch', 'kind', 'restated',
      'title', (select count(*) from pnl_restatements where company = 'IFPL' and changed_at > now() - interval '30 days') || ' previously reported figures changed in the last 30 days',
      'detail', 'A re-uploaded workbook altered months that were already reported. Open the restatement log to see exactly which lines moved.');
  end if;

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'channel', p_channel, 'branch', p_branch,
    'totals', tot, 'channels', chan, 'stars', stars, 'watch', watch,
    'overheads', overheads, 'below_line', below, 'attention', attention);
end $$;
revoke execute on function public.ifpl_period_summary(date, date, text, text) from anon, public;
grant execute on function public.ifpl_period_summary(date, date, text, text) to authenticated;

-- ───────────────────────── 4a. Store league ──────────────────────────────
-- Ranked by the chosen column, trading stores only (cost centres excluded).
-- Every store is returned with its rank, plus ONE aggregated "rest" row
-- (is_rest = true, ranks 11+) so the page can show "Other N stores" without
-- adding anything up in JavaScript.
create or replace function public.ifpl_store_league(p_from date, p_to date, p_sort text default 'sales', p_desc boolean default true)
returns table(rank int, branch text, channel text, location_id uuid, months int, proj_sales numeric, act_sales numeric, act_gp numeric, act_final numeric,
              variance_pct numeric, margin_pct numeric, on_watch boolean, watch_reason text, is_rest boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_ifpl_pnl_access();
  return query
  with s as (
    select v.branch_key, v.branch_name, v.channel_norm, v.location_id, count(distinct v.month)::int months,
      coalesce(sum(v.projection) filter (where v.line = 'Net Sales'), 0) proj_sales,
      coalesce(sum(v.actual)     filter (where v.line = 'Net Sales'), 0) act_sales,
      coalesce(sum(v.actual)     filter (where v.line = 'Gross Profit'), 0) act_gp,
      coalesce(sum(v.actual)     filter (where v.line = 'Final Profit'), 0) act_final
    from ifpl_pnl_lines_v v
    where v.month between p_from and p_to and v.channel_norm <> 'Cost centre'
    group by v.branch_key, v.branch_name, v.channel_norm, v.location_id
  ), c as (
    select s.*,
      case when s.proj_sales <> 0 then round((s.act_sales - s.proj_sales) / s.proj_sales * 100, 1) end variance_pct,
      case when s.act_sales <> 0 then round(s.act_gp / s.act_sales * 100, 1) end margin_pct
    from s
  ), ranked as (
    select c.*, row_number() over (order by
      case when p_desc then case p_sort when 'variance' then c.variance_pct when 'margin' then c.margin_pct when 'contribution' then c.act_final else c.act_sales end end desc nulls last,
      case when not p_desc then case p_sort when 'variance' then c.variance_pct when 'margin' then c.margin_pct when 'contribution' then c.act_final else c.act_sales end end asc nulls last,
      c.branch_name)::int rnk
    from c
  )
  select r.rnk, r.branch_name, r.channel_norm, r.location_id, r.months, r.proj_sales, r.act_sales, r.act_gp, r.act_final, r.variance_pct, r.margin_pct,
    (r.act_final < -100000 or coalesce(r.variance_pct, 0) < -20),
    nullif(concat_ws(' · ', case when r.act_final < -100000 then 'loss-making' end, case when coalesce(r.variance_pct, 0) < -20 then r.variance_pct || '% vs plan' end), ''),
    false
  from ranked r
  union all
  select 0, 'Other ' || count(*) || ' stores', 'Mixed', null, null, sum(r.proj_sales), sum(r.act_sales), sum(r.act_gp), sum(r.act_final),
    case when sum(r.proj_sales) <> 0 then round((sum(r.act_sales) - sum(r.proj_sales)) / sum(r.proj_sales) * 100, 1) end,
    case when sum(r.act_sales) <> 0 then round(sum(r.act_gp) / sum(r.act_sales) * 100, 1) end,
    false, null, true
  from ranked r where r.rnk > 10 having count(*) > 0
  order by 14, 1;
end $$;
revoke execute on function public.ifpl_store_league(date, date, text, boolean) from anon, public;
grant execute on function public.ifpl_store_league(date, date, text, boolean) to authenticated;

-- ───────────────────────── 4b. Growth by fiscal year ─────────────────────
-- Historic years come from the workbook's Sales Growth sheet (not held at
-- line level); live years are summed from ifpl_pnl_lines. Was a hard-coded
-- constant in the page.
create table if not exists public.ifpl_fy_history (
  fy_start_year int primary key,
  net_sales numeric not null,
  source text not null default 'PL-CURRENT Sales Growth sheet',
  updated_at timestamptz not null default now()
);
alter table public.ifpl_fy_history enable row level security;
insert into public.ifpl_fy_history (fy_start_year, net_sales) values
  (2021, 927277513), (2022, 1262859897), (2023, 1600223174), (2024, 2576900112)
on conflict (fy_start_year) do nothing;

create or replace function public.ifpl_sales_by_fy()
returns table(fy text, fy_start_year int, net_sales numeric, months int, is_live boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_ifpl_pnl_access();
  return query
  with live as (
    select (extract(year from p.month)::int - case when extract(month from p.month) >= 7 then 0 else 1 end) fy_start,
           sum(p.actual) filter (where p.line = 'Net Sales') sales, count(distinct p.month)::int months
    from ifpl_pnl_lines p group by 1
  )
  select to_char(to_date(u.y::text, 'YYYY'), 'YY') || '-' || to_char(to_date((u.y + 1)::text, 'YYYY'), 'YY'), u.y, u.s, u.m, u.lv
  from (
    select h.fy_start_year y, h.net_sales s, 12 m, false lv from ifpl_fy_history h
    where not exists (select 1 from live l where l.fy_start = h.fy_start_year and l.months = 12)
    union all
    select l.fy_start, l.sales, l.months, true from live l
  ) u order by u.y;
end $$;
revoke execute on function public.ifpl_sales_by_fy() from anon, public;
grant execute on function public.ifpl_sales_by_fy() to authenticated;

-- ───────────────────────── 4c. Like-for-like vs last year ────────────────
-- For each store: sales in the period vs the SAME calendar months one year
-- earlier, counting only months where both years have data (so a store that
-- opened mid-year is "new", not "+100%"). growth_pct compares like-for-like
-- months only — true like-for-like growth.
create or replace function public.ifpl_yoy_stores(p_from date, p_to date)
returns table(branch text, channel text, location_id uuid, months_compared int, sales numeric, lfl_sales numeric, ly_sales numeric, growth_pct numeric,
              final numeric, ly_final numeric, is_new boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_ifpl_pnl_access();
  return query
  with cur as (
    select v.branch_key, v.branch_name, v.channel_norm, v.location_id, v.month,
      sum(v.actual) filter (where v.line = 'Net Sales') sales, sum(v.actual) filter (where v.line = 'Final Profit') fin
    from ifpl_pnl_lines_v v where v.month between p_from and p_to and v.channel_norm <> 'Cost centre'
    group by 1,2,3,4,5
  ), ly as (
    select v.branch_key, (v.month + interval '1 year')::date as month,
      sum(v.actual) filter (where v.line = 'Net Sales') sales, sum(v.actual) filter (where v.line = 'Final Profit') fin
    from ifpl_pnl_lines_v v where v.month between (p_from - interval '1 year')::date and (p_to - interval '1 year')::date and v.channel_norm <> 'Cost centre'
    group by 1,2
  ), per_store as (
    select c.branch_name, c.channel_norm, c.location_id,
      count(l.month)::int months_compared,
      sum(c.sales) sales,
      sum(c.sales) filter (where l.month is not null) lfl_sales,
      sum(l.sales) ly_sales,
      case when sum(l.sales) > 0 and count(l.month) > 0 then round((sum(c.sales) filter (where l.month is not null) / sum(l.sales) - 1) * 100, 1) end growth_pct,
      sum(c.fin) fin, sum(l.fin) ly_fin,
      count(l.month) = 0 is_new
    from cur c left join ly l on l.branch_key = c.branch_key and l.month = c.month
    group by c.branch_key, c.branch_name, c.channel_norm, c.location_id
  ), u as (
    select p.branch_name, p.channel_norm, p.location_id, p.months_compared, p.sales, p.lfl_sales, p.ly_sales, p.growth_pct, p.fin, p.ly_fin, p.is_new
    from per_store p
    union all
    -- Company like-for-like: comparable stores only (channel = 'Total').
    select 'All comparable stores', 'Total', null, count(*)::int, sum(p.sales), sum(p.lfl_sales), sum(p.ly_sales),
      case when sum(p.ly_sales) > 0 then round((sum(p.lfl_sales) / sum(p.ly_sales) - 1) * 100, 1) end,
      sum(p.fin), sum(p.ly_fin), false
    from per_store p where not p.is_new
  )
  select * from u order by (u.channel_norm = 'Total') desc, u.growth_pct desc nulls last;
end $$;
revoke execute on function public.ifpl_yoy_stores(date, date) from anon, public;
grant execute on function public.ifpl_yoy_stores(date, date) to authenticated;

-- ───────────────────────── 4d. Data coverage ─────────────────────────────
-- What months exist, which are rejected (and why), which are missing up to
-- last month — drives the period presets and the data strip.
create or replace function public.ifpl_data_coverage()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare first_m date; last_m date; cur_m date := date_trunc('month', now() at time zone 'Asia/Karachi')::date;
begin
  perform assert_ifpl_pnl_access();
  select min(month), max(month) into first_m, last_m from ifpl_pnl_lines;
  return jsonb_build_object(
    'first_month', first_m, 'last_month', last_m, 'current_month', cur_m,
    'months', (select coalesce(jsonb_agg(x.m order by x.m), '[]'::jsonb) from (select distinct month m from ifpl_pnl_lines) x),
    'rejected', (select coalesce(jsonb_agg(jsonb_build_object('month', u.month, 'uploaded_at', u.uploaded_at, 'reason', coalesce(
        (select string_agg(c.check_name || ' (out by ' || to_char(c.diff, 'FM999,999,999,999') || ')', '; ') from ifpl_pnl_checks c where c.upload_id = u.id and c.passed = false and c.blocking),
        u.rejection_summary, 'Blocking validation failed')) order by u.month), '[]'::jsonb)
      from ifpl_pnl_uploads u
      where u.status <> 'accepted'
        and u.uploaded_at = (select max(u2.uploaded_at) from ifpl_pnl_uploads u2 where u2.month = u.month)
        and not exists (select 1 from ifpl_pnl_lines p where p.month = u.month)),
    'missing', (select coalesce(jsonb_agg(g.m::date order by g.m), '[]'::jsonb)
      from generate_series(coalesce(first_m, cur_m), cur_m - interval '1 month', interval '1 month') g(m)
      where not exists (select 1 from ifpl_pnl_lines p where p.month = g.m::date)
        and not exists (select 1 from ifpl_pnl_uploads u where u.month = g.m::date)),
    'last_upload_at', (select max(uploaded_at) from ifpl_pnl_uploads),
    'warnings', (select coalesce(sum(u.warnings), 0) from (select distinct on (month) warnings from ifpl_pnl_uploads order by month, uploaded_at desc) u));
end $$;
revoke execute on function public.ifpl_data_coverage() from anon, public;
grant execute on function public.ifpl_data_coverage() to authenticated;

commit;

-- ─── ROLLBACK ────────────────────────────────────────────────────────────────
-- Re-run the previous CREATE OR REPLACE bodies (plain SQL, no assert_* call,
-- grouped by branch text) for ifpl_kpi_by_month, ifpl_branch_league,
-- ifpl_line_totals, ifpl_validation_summary, ifpl_check_details,
-- ifpl_net_sales_total, get_pnl_commentary, get_pnl_restatements,
-- get_balance_sheet_ifl, get_balance_sheet_ifl_months, get_balance_sheet_notes
-- (see supabase/ history), then:
--   drop function ifpl_period_summary(date,date,text,text);
--   drop function ifpl_store_league(date,date,text,boolean);
--   drop function ifpl_sales_by_fy(); drop function ifpl_yoy_stores(date,date);
--   drop function ifpl_data_coverage(); drop view ifpl_pnl_lines_v;
--   drop function assert_ifpl_pnl_access(); drop function assert_pnl_company_access(text);
--   drop function can_view_pnl_company_db(text); drop function can_view_ifpl_pnl_db();
--   drop table ifpl_fy_history;
-- Data fix rollback: the two duplicate admin_locations can be re-activated
-- (is_active = true, strip the "(duplicate …)" suffix); P&L rows for months
-- Jul-25..Jun-26 of Emporium Mall / Iqbal Town moved back by month range.
