-- Migration 279: Unze Trading P&L page audit — named access, Smart Meters
-- plant, Supabase-side period summary, plant-level balance sheets.
-- 18/10/2026. Applied to production 18/10/2026 via execute_sql; this file
-- records the live definitions.
--
-- NOTE on numbering: 276–278 were used twice (Banking/Imperial and the
-- Generators feature). Nothing to resolve — both sets are applied — but new
-- migrations start at 279.
--
-- 1. Access (Khuram, 18/10/2026): the Unze P&L is strictly Khuram, Kamran,
--    Sania and Shakeel. New Access Matrix toggle member_permissions.
--    can_view_unze_pnl (Admin/CEO pass by default, PA never); mirrored in
--    the database by can_view_unze_pnl_db() and enforced on every RPC via
--    assert_company_finance_access(company) — which routes IFPL to the
--    Imperial rule, UTPL to this one, and anything else to
--    can_see_company_finance(). The pnl_* / get_balance_sheet* RPCs were
--    SECURITY DEFINER with no caller check (any signed-in user could read
--    the whole P&L directly). get_pnl_commentary / get_pnl_restatements
--    route UTPL through the same rule (can_view_pnl_company_db).
-- 2. Plants live in pnl_plants (Smart Meters added, HO flagged as the cost
--    centre). The parser, filter bar, scoreboard and RPCs read it rather
--    than a hard-coded list.
-- 3. utpl_period_summary() computes every headline figure, the plant
--    scoreboard, cost structure %, expense movement and a structured
--    "needs attention" list in Postgres; utpl_plant_true_profit() is the
--    new insight (plant profit after its share of HO cost);
--    utpl_data_coverage() drives the presets and the data strip.
-- 4. Balance sheets are held per plant: balance_sheet.plant /
--    balance_sheet_notes.plant ("Company" = consolidated), unique on
--    (company_id, month, plant). utpl_balance_sheet*(plant) replace the
--    company-only RPCs; the old names remain as thin wrappers.

begin;

-- ───────────────────────── 1. Access ─────────────────────────────────────
alter table public.member_permissions add column if not exists can_view_unze_pnl boolean;

CREATE OR REPLACE FUNCTION public.can_view_unze_pnl_db()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select case
      when m.role = 'Executive' or m.email = 'pa.ceo@unze.co.uk' then false
      when p.can_view_unze_pnl is not null then p.can_view_unze_pnl
      else m.role in ('Admin','CEO') or m.email = 'khuram1901@gmail.com'
    end
    from members m left join member_permissions p on p.member_id = m.id
    where m.email = auth.email() and m.is_active), false);
$function$;
revoke execute on function public.can_view_unze_pnl_db() from anon, public;
grant execute on function public.can_view_unze_pnl_db() to authenticated;

CREATE OR REPLACE FUNCTION public.assert_unze_pnl_access()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return; end if;
  if not can_view_unze_pnl_db() then
    raise exception 'Not authorised to view Unze Trading''s P&L' using errcode = '42501';
  end if;
end $function$;
revoke execute on function public.assert_unze_pnl_access() from anon, public;
grant execute on function public.assert_unze_pnl_access() to authenticated;

CREATE OR REPLACE FUNCTION public.assert_company_finance_access(p_company_id text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return; end if;
  if p_company_id = '77921705-8a15-4406-847a-b234f84b5ec3' then
    if not can_view_ifpl_pnl_db() then raise exception 'Not authorised to view Imperial Footwear''s figures' using errcode = '42501'; end if;
    return;
  end if;
  if p_company_id = '15884c2d-48a4-4d43-be90-0ef6e130790c' then
    if not can_view_unze_pnl_db() then raise exception 'Not authorised to view Unze Trading''s figures' using errcode = '42501'; end if;
    return;
  end if;
  if not can_see_company_finance(p_company_id::uuid) then
    raise exception 'Not authorised to view this company''s figures' using errcode = '42501';
  end if;
end $function$;
revoke execute on function public.assert_company_finance_access(text) from anon, public;
grant execute on function public.assert_company_finance_access(text) to authenticated;

CREATE OR REPLACE FUNCTION public.can_view_pnl_company_db(p_company text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare co uuid;
begin
  if p_company = 'IFPL' then return can_view_ifpl_pnl_db(); end if;
  if p_company = 'UTPL' then return can_view_unze_pnl_db(); end if;
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
end $function$;

-- Named access (Khuram, 18/10/2026). Admin/CEO accounts pass by role.
update member_permissions set can_view_unze_pnl = true
where member_id in (select id from members where email in ('sania.saleem@unze.co.uk','shakeel@unze.co.uk'));

-- ───────────────────────── 2. Plants ─────────────────────────────────────
create table if not exists public.pnl_plants (
  company_id uuid not null references companies(id),
  code text not null,
  label text not null,
  is_cost_centre boolean not null default false,
  sort_order integer not null default 100,
  active boolean not null default true,
  primary key (company_id, code)
);
alter table public.pnl_plants enable row level security;  -- RPC-only, no policies
insert into public.pnl_plants (company_id, code, label, is_cost_centre, sort_order) values
  ('15884c2d-48a4-4d43-be90-0ef6e130790c', 'FEDMIC', 'FEDMIC', false, 10),
  ('15884c2d-48a4-4d43-be90-0ef6e130790c', 'MEPCO', 'MEPCO', false, 20),
  ('15884c2d-48a4-4d43-be90-0ef6e130790c', 'PESCO', 'PESCO', false, 30),
  ('15884c2d-48a4-4d43-be90-0ef6e130790c', 'SMART METERS', 'Smart Meters', false, 40),
  ('15884c2d-48a4-4d43-be90-0ef6e130790c', 'HO', 'HO', true, 90)
on conflict (company_id, code) do nothing;

CREATE OR REPLACE FUNCTION public.utpl_plants(p_company_id uuid)
 RETURNS TABLE(code text, label text, is_cost_centre boolean, has_data boolean, first_month date, last_month date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_company_finance_access(p_company_id::text);
  return query
  select pl.code, pl.label, pl.is_cost_centre, exists(select 1 from pnl_line_items li where li.company_id = pl.company_id and li.plant = pl.code),
    (select min(li.month) from pnl_line_items li where li.company_id = pl.company_id and li.plant = pl.code),
    (select max(li.month) from pnl_line_items li where li.company_id = pl.company_id and li.plant = pl.code)
  from pnl_plants pl where pl.company_id = p_company_id and pl.active order by pl.sort_order;
end $function$;
revoke execute on function public.utpl_plants(uuid) from anon, public;
grant execute on function public.utpl_plants(uuid) to authenticated;

-- ───────────────────────── 3. Guarded P&L RPCs ───────────────────────────
-- Same signatures and return types as before; plant filters are no longer a
-- hard-coded list (any plant except 'Total').
CREATE OR REPLACE FUNCTION public.pnl_kpi_summary(p_company_id uuid, p_from date, p_to date)
 RETURNS TABLE(month date, gross_sale numeric, cost_of_sale numeric, gross_profit numeric, operating_expenses numeric, taxation numeric, net_profit_after_tax numeric, non_operating numeric, net_profit_final numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_company_finance_access(p_company_id::text);
  return query
  select li.month,
    sum(li.amount) filter (where li.line = 'Gross Sale'), sum(li.amount) filter (where li.line = 'Total Cost of Sale'),
    sum(li.amount) filter (where li.line = 'GP'), sum(li.amount) filter (where li.line = 'Operating Expenses'),
    sum(li.amount) filter (where li.line = 'Taxation'), sum(li.amount) filter (where li.line = 'Net Profit After Tax'),
    sum(li.amount) filter (where li.line = 'Non Operating Income and Exp'), sum(li.amount) filter (where li.line = 'Net Profit Final')
  from pnl_line_items li
  where li.company_id = p_company_id and li.plant <> 'Total' and li.month between p_from and p_to
  group by li.month order by li.month;
end $function$;

CREATE OR REPLACE FUNCTION public.pnl_kpi_summary_plant(p_company_id uuid, p_from date, p_to date, p_plant text DEFAULT 'All'::text)
 RETURNS TABLE(month date, gross_sale numeric, cost_of_sale numeric, gross_profit numeric, operating_expenses numeric, taxation numeric, net_profit_after_tax numeric, non_operating numeric, net_profit_final numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_company_finance_access(p_company_id::text);
  return query
  select li.month,
    sum(li.amount) filter (where li.line = 'Gross Sale'), sum(li.amount) filter (where li.line = 'Total Cost of Sale'),
    sum(li.amount) filter (where li.line = 'GP'), sum(li.amount) filter (where li.line = 'Operating Expenses'),
    sum(li.amount) filter (where li.line = 'Taxation'), sum(li.amount) filter (where li.line = 'Net Profit After Tax'),
    sum(li.amount) filter (where li.line = 'Non Operating Income and Exp'), sum(li.amount) filter (where li.line = 'Net Profit Final')
  from pnl_line_items li
  where li.company_id = p_company_id and li.month between p_from and p_to
    and case when p_plant = 'All' then li.plant <> 'Total' else li.plant = p_plant end
  group by li.month order by li.month;
end $function$;

CREATE OR REPLACE FUNCTION public.pnl_plant_scoreboard(p_company_id uuid, p_from date, p_to date)
 RETURNS TABLE(plant text, gross_sale numeric, gross_profit numeric, net_profit numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_company_finance_access(p_company_id::text);
  return query
  select li.plant, sum(li.amount) filter (where li.line = 'Gross Sale'), sum(li.amount) filter (where li.line = 'GP'), sum(li.amount) filter (where li.line = 'Net Profit Final')
  from pnl_line_items li
  where li.company_id = p_company_id and li.plant <> 'Total' and li.month between p_from and p_to
  group by li.plant order by li.plant;
end $function$;

CREATE OR REPLACE FUNCTION public.pnl_plant_margin_trend(p_company_id uuid, p_from date, p_to date)
 RETURNS TABLE(month date, plant text, gross_sale numeric, gross_profit numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_company_finance_access(p_company_id::text);
  return query
  select li.month, li.plant, sum(li.amount) filter (where li.line = 'Gross Sale'), sum(li.amount) filter (where li.line = 'GP')
  from pnl_line_items li
  where li.company_id = p_company_id and li.plant <> 'Total'
    and li.plant not in (select pl.code from pnl_plants pl where pl.company_id = p_company_id and pl.is_cost_centre)
    and li.month between p_from and p_to
  group by li.month, li.plant order by li.month, li.plant;
end $function$;

CREATE OR REPLACE FUNCTION public.pnl_overheads_breakdown(p_company_id uuid, p_plant text, p_from date, p_to date, p_allocate_ho boolean DEFAULT false)
 RETURNS TABLE(month date, plant text, account_group text, amount numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_company_finance_access(p_company_id::text);
  return query
  with raw as (
    select l.month, l.plant, l.account_group, sum(l.amount) as amount
    from pnl_ledger_lines l where l.company_id = p_company_id and l.month between p_from and p_to
    group by l.month, l.plant, l.account_group
  ), ho as (select r.month, r.account_group, r.amount as ho_amount from raw r where r.plant = 'HO')
  select r.month, r.plant, r.account_group, r.amount from raw r
  where not p_allocate_ho and (p_plant = 'All plants' or r.plant = p_plant)
  union all
  select r.month, r.plant, r.account_group, r.amount + coalesce(a.pct, 0) / 100.0 * coalesce(h.ho_amount, 0)
  from raw r
  left join ho h on h.month = r.month and h.account_group = r.account_group
  left join pnl_allocation_pct a on a.company_id = p_company_id and a.month = r.month and a.plant = r.plant
  where p_allocate_ho and r.plant <> 'HO' and (p_plant = 'All plants' or r.plant = p_plant)
  order by 1, 3, 2;
end $function$;

CREATE OR REPLACE FUNCTION public.pnl_cost_structure(p_company_id uuid, p_from date, p_to date, p_plant text DEFAULT 'All'::text)
 RETURNS TABLE(month date, bucket text, amount numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_company_finance_access(p_company_id::text);
  return query
  select l.month,
    case
      when l.account_group like 'Admin-%' or l.account_group = 'Computer and Internet Expense' then 'Admin'
      when l.account_group like 'S&D%' then 'Selling & distribution'
      when l.account_group in ('Bank Charges', 'Interest') then 'Finance costs'
      when l.account_group in ('Misc Income', 'Sale of Material') then 'Other income'
      when l.account_group = 'Misc Expenses' then 'Other expenses'
      else 'Production / COGS'
    end as bucket,
    sum(l.amount)
  from pnl_ledger_lines l
  where l.company_id = p_company_id and l.month between p_from and p_to
    and l.account_group not in ('Gross Sales', 'Taxation')
    and (p_plant = 'All' or l.plant = p_plant)
  group by 1, 2 order by 1, 2;
end $function$;

CREATE OR REPLACE FUNCTION public.pnl_validation_summary(p_company_id uuid)
 RETURNS TABLE(month date, file_name text, status text, checks_passed integer, checks_failed integer, uploaded_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_company_finance_access(p_company_id::text);
  return query
  select distinct on (u.month) u.month, u.file_name, u.status, u.checks_passed, u.checks_failed, u.uploaded_at
  from pnl_uploads u where u.company_id = p_company_id order by u.month, u.uploaded_at desc;
end $function$;

CREATE OR REPLACE FUNCTION public.pnl_new_account_flags(p_company_id uuid, p_month date)
 RETURNS TABLE(plant text, account_group text, amount numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_company_finance_access(p_company_id::text);
  return query
  select cur.plant, cur.account_group, sum(cur.amount)
  from pnl_ledger_lines cur
  where cur.company_id = p_company_id and cur.month = p_month
    and not exists (select 1 from pnl_ledger_lines prior where prior.company_id = cur.company_id and prior.plant = cur.plant and prior.account_group = cur.account_group and prior.month < cur.month)
  group by cur.plant, cur.account_group having sum(cur.amount) <> 0;
end $function$;

-- ───────────────────────── 4. Period summary + insight + coverage ────────
CREATE OR REPLACE FUNCTION public.utpl_data_coverage(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare first_m date; last_m date; cur_m date := date_trunc('month', now() at time zone 'Asia/Karachi')::date;
begin
  perform assert_company_finance_access(p_company_id::text);
  select min(li.month), max(li.month) into first_m, last_m from pnl_line_items li where li.company_id = p_company_id;
  return jsonb_build_object(
    'first_month', first_m, 'last_month', last_m, 'current_month', cur_m,
    'months', (select coalesce(jsonb_agg(x.m order by x.m), '[]'::jsonb) from (select distinct li.month m from pnl_line_items li where li.company_id = p_company_id) x),
    'rejected', (select coalesce(jsonb_agg(jsonb_build_object('month', u.month, 'uploaded_at', u.uploaded_at, 'reason', coalesce(
        (select string_agg(c.check_name || ' (out by ' || to_char(c.diff, 'FM999,999,999,999') || ')', '; ') from pnl_validation_checks c where c.upload_id = u.id and c.passed = false),
        u.rejection_summary, 'Validation failed')) order by u.month), '[]'::jsonb)
      from pnl_uploads u
      where u.company_id = p_company_id and u.status <> 'accepted'
        and u.uploaded_at = (select max(u2.uploaded_at) from pnl_uploads u2 where u2.company_id = p_company_id and u2.month = u.month)
        and not exists (select 1 from pnl_line_items li where li.company_id = p_company_id and li.month = u.month)),
    'warnings', (select coalesce(jsonb_agg(jsonb_build_object('month', u.month, 'checks', (select jsonb_agg(c.check_name) from pnl_validation_checks c where c.upload_id = u.id and c.passed = false)) order by u.month), '[]'::jsonb)
      from pnl_uploads u
      where u.company_id = p_company_id and u.status = 'accepted' and u.checks_failed > 0
        and u.uploaded_at = (select max(u2.uploaded_at) from pnl_uploads u2 where u2.company_id = p_company_id and u2.month = u.month)),
    'missing', (select coalesce(jsonb_agg(g.m::date order by g.m), '[]'::jsonb)
      from generate_series(coalesce(first_m, cur_m), cur_m - interval '1 month', interval '1 month') g(m)
      where not exists (select 1 from pnl_line_items li where li.company_id = p_company_id and li.month = g.m::date)),
    'last_upload_at', (select max(u.uploaded_at) from pnl_uploads u where u.company_id = p_company_id));
end $function$;
revoke execute on function public.utpl_data_coverage(uuid) from anon, public;
grant execute on function public.utpl_data_coverage(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.utpl_period_summary(p_company_id uuid, p_from date, p_to date, p_plant text DEFAULT 'All'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  kpi jsonb; tot jsonb; latest record; prev record; streak int := 0; streak_sum numeric := 0; streak_from date; r record;
  board jsonb; ho jsonb; cost jsonb; watch jsonb; attention jsonb := '[]'::jsonb;
  avg_sales numeric; avg_margin numeric; latest_margin numeric; n_months int; cov jsonb; scope_label text;
begin
  perform assert_company_finance_access(p_company_id::text);
  scope_label := case when p_plant = 'All' then '' else ' (' || p_plant || ')' end;

  select coalesce(jsonb_agg(to_jsonb(k) order by k.month), '[]'::jsonb) into kpi from pnl_kpi_summary_plant(p_company_id, p_from, p_to, p_plant) k;
  n_months := jsonb_array_length(kpi);

  select jsonb_build_object('months', count(*), 'sales', coalesce(sum(k.gross_sale),0), 'cogs', coalesce(sum(k.cost_of_sale),0), 'gp', coalesce(sum(k.gross_profit),0),
    'opex', coalesce(sum(abs(k.operating_expenses)),0), 'np', coalesce(sum(k.net_profit_final),0),
    'avg_sales', case when count(*) > 0 then sum(k.gross_sale) / count(*) end,
    'gm_pct', case when sum(k.gross_sale) > 0 then round(sum(k.gross_profit) / sum(k.gross_sale) * 100, 1) end,
    'np_pct', case when sum(k.gross_sale) > 0 then round(sum(k.net_profit_final) / sum(k.gross_sale) * 100, 1) end)
  into tot from pnl_kpi_summary_plant(p_company_id, p_from, p_to, p_plant) k;

  select k.* into latest from pnl_kpi_summary_plant(p_company_id, p_from, p_to, p_plant) k order by k.month desc limit 1;
  select k.* into prev from pnl_kpi_summary_plant(p_company_id, p_from, p_to, p_plant) k order by k.month desc limit 1 offset 1;
  select avg(k.gross_sale), avg(case when k.gross_sale > 0 then k.gross_profit / k.gross_sale * 100 end) into avg_sales, avg_margin
  from pnl_kpi_summary_plant(p_company_id, p_from, p_to, p_plant) k where latest.month is null or k.month < latest.month;
  latest_margin := case when latest.gross_sale > 0 then latest.gross_profit / latest.gross_sale * 100 end;

  for r in select k.month mth, k.net_profit_final np from pnl_kpi_summary_plant(p_company_id, p_from, p_to, p_plant) k order by k.month desc loop
    exit when r.np >= 0; streak := streak + 1; streak_sum := streak_sum + r.np; streak_from := r.mth;
  end loop;

  with s as (
    select li.plant, count(distinct li.month) months,
      coalesce(sum(li.amount) filter (where li.line = 'Gross Sale'),0) sales,
      coalesce(sum(li.amount) filter (where li.line = 'GP'),0) gp,
      coalesce(sum(li.amount) filter (where li.line = 'Net Profit Final'),0) np,
      coalesce(sum(li.amount) filter (where li.line = 'Gross Sale' and li.month = (select max(m.month) from pnl_line_items m where m.company_id = p_company_id and m.month between p_from and p_to)),0) latest_sales
    from pnl_line_items li where li.company_id = p_company_id and li.month between p_from and p_to and li.plant <> 'Total'
    group by li.plant
  ), ops as (select s.* from s left join pnl_plants pl on pl.company_id = p_company_id and pl.code = s.plant where coalesce(pl.is_cost_centre, s.plant = 'HO') = false),
  t as (select sum(o.sales) tot_sales, sum(o.np) tot_np from ops o)
  select
    (select coalesce(jsonb_agg(jsonb_build_object('plant', o.plant, 'label', coalesce(pl.label, o.plant), 'months', o.months, 'sales', o.sales, 'gp', o.gp, 'np', o.np,
        'margin_pct', case when o.sales > 0 then round(o.gp / o.sales * 100, 1) end,
        'share_pct', case when t.tot_sales > 0 then round(o.sales / t.tot_sales * 100, 1) end,
        'zero_latest', o.latest_sales = 0) order by o.sales desc), '[]'::jsonb)
      from ops o cross join t left join pnl_plants pl on pl.company_id = p_company_id and pl.code = o.plant),
    (select jsonb_build_object('np', coalesce(sum(s.np),0), 'pct_of_sales', case when (select tot_sales from t) > 0 then round(abs(sum(s.np)) / (select tot_sales from t) * 100, 1) end)
      from s where s.plant = 'HO')
  into board, ho;

  select coalesce(jsonb_agg(x order by (x->>'month')), '[]'::jsonb) into cost from (
    select jsonb_build_object('month', c.month, 'bucket', c.bucket, 'amount', c.amount,
      'pct_of_sales', case when k.gross_sale > 0 then round(c.amount / k.gross_sale * 100, 1) end) x
    from pnl_cost_structure(p_company_id, p_from, p_to, p_plant) c
    left join pnl_kpi_summary_plant(p_company_id, p_from, p_to, p_plant) k on k.month = c.month) s;

  with g as (
    select l.account_group, sum(l.amount) filter (where l.month = latest.month) cur, sum(l.amount) filter (where l.month = prev.month) before
    from pnl_ledger_lines l where l.company_id = p_company_id and l.month in (latest.month, prev.month)
      and (p_plant = 'All' or l.plant = p_plant) and l.account_group not in ('Gross Sales','Taxation')
    group by l.account_group having sum(l.amount) filter (where l.month = latest.month) > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object('group', g.account_group, 'amount', g.cur, 'delta', case when prev.month is null then null else g.cur - coalesce(g.before,0) end) order by g.cur desc), '[]'::jsonb)
  into watch from (select * from g order by cur desc limit 6) g;

  cov := utpl_data_coverage(p_company_id);
  if jsonb_array_length(cov->'missing') > 0 then
    attention := attention || jsonb_build_object('severity', 'urgent', 'kind', 'missing',
      'title', jsonb_array_length(cov->'missing') || ' month' || case when jsonb_array_length(cov->'missing') > 1 then 's' else '' end || ' not uploaded',
      'detail', (select string_agg(to_char((e#>>'{}')::date, 'Mon YY'), ', ') from jsonb_array_elements(cov->'missing') e) || ' — the dashboard stops at ' || to_char((cov->>'last_month')::date, 'Mon YY') || '. Upload the missing P&L files.');
  end if;
  for r in select e from jsonb_array_elements(cov->'rejected') e loop
    attention := attention || jsonb_build_object('severity', 'urgent', 'kind', 'rejected',
      'title', to_char((r.e->>'month')::date, 'Mon YY') || ' upload rejected — figures not in the dashboard', 'detail', (r.e->>'reason') || '. Fix the file and re-upload.');
  end loop;
  if streak >= 2 then
    attention := attention || jsonb_build_object('severity', 'urgent', 'kind', 'loss_streak',
      'title', streak || ' consecutive loss months' || scope_label,
      'detail', 'PKR ' || to_char(streak_sum, 'FM999,999,999,999') || ' lost over ' || to_char(streak_from, 'Mon YY') || '–' || to_char(latest.month, 'Mon YY') || '.');
  elsif latest.net_profit_final < 0 then
    attention := attention || jsonb_build_object('severity', 'watch', 'kind', 'loss',
      'title', to_char(latest.month, 'Mon YY') || ' was loss-making' || scope_label, 'detail', 'Net profit PKR ' || to_char(latest.net_profit_final, 'FM999,999,999,999') || '.');
  end if;
  if p_plant <> 'HO' and latest.month is not null and avg_sales > 0 and latest.gross_sale < avg_sales * 0.7 then
    attention := attention || jsonb_build_object('severity', 'watch', 'kind', 'sales_drop',
      'title', to_char(latest.month, 'Mon YY') || ' sales ' || round((1 - latest.gross_sale / avg_sales) * 100, 1) || '% below the period average',
      'detail', 'PKR ' || to_char(latest.gross_sale, 'FM999,999,999,999') || ' against an average of PKR ' || to_char(avg_sales, 'FM999,999,999,999') || ' a month. Sales are tender-driven — check dispatch schedules before reading this as demand loss.');
  end if;
  if p_plant <> 'HO' and latest_margin is not null and n_months >= 3 and latest_margin < avg_margin - 5 then
    attention := attention || jsonb_build_object('severity', 'watch', 'kind', 'margin',
      'title', 'Gross margin ' || round(latest_margin, 1) || '% vs ' || round(avg_margin, 1) || '% period average',
      'detail', case when latest_margin < 0 then 'Sold below cost in ' || to_char(latest.month, 'Mon YY') || ' — cost of sales exceeded sales.' else 'Margin is ' || round(avg_margin - latest_margin, 1) || ' points under the run-rate.' end);
  end if;
  if (ho->>'pct_of_sales')::numeric > 10 then
    attention := attention || jsonb_build_object('severity', 'watch', 'kind', 'ho',
      'title', 'Head office costs ' || (ho->>'pct_of_sales') || '% of plant sales',
      'detail', 'PKR ' || to_char(abs((ho->>'np')::numeric), 'FM999,999,999,999') || ' of HO cost over the period — above the 10% line. See "True profit after HO" for what each plant really makes.');
  end if;
  for r in select e from jsonb_array_elements(board) e where (e->>'zero_latest')::boolean loop
    attention := attention || jsonb_build_object('severity', 'watch', 'kind', 'plant_idle',
      'title', (r.e->>'label') || ' had no sales in ' || to_char(latest.month, 'Mon YY'), 'detail', 'Confirm the plant was inactive; its costs still ran through the month.');
  end loop;
  if jsonb_array_length(cov->'warnings') > 0 then
    attention := attention || jsonb_build_object('severity', 'watch', 'kind', 'warnings',
      'title', jsonb_array_length(cov->'warnings') || ' month' || case when jsonb_array_length(cov->'warnings') > 1 then 's' else '' end || ' accepted with warnings',
      'detail', (select string_agg(to_char((e->>'month')::date, 'Mon YY') || ': ' || (select string_agg(c#>>'{}', '; ') from jsonb_array_elements(e->'checks') c), ' · ') from jsonb_array_elements(cov->'warnings') e));
  end if;
  if exists (select 1 from pnl_restatements pr where pr.company = 'UTPL' and pr.changed_at > now() - interval '30 days') then
    attention := attention || jsonb_build_object('severity', 'watch', 'kind', 'restated',
      'title', (select count(*) from pnl_restatements pr where pr.company = 'UTPL' and pr.changed_at > now() - interval '30 days') || ' previously reported figures changed in the last 30 days',
      'detail', 'A re-uploaded file altered months already reported. Open the restatement log for the exact lines.');
  end if;

  return jsonb_build_object('from', p_from, 'to', p_to, 'plant', p_plant,
    'totals', tot, 'latest', to_jsonb(latest), 'prev', to_jsonb(prev),
    'avg_sales_before_latest', avg_sales, 'avg_margin_before_latest', round(avg_margin, 1), 'latest_margin_pct', round(latest_margin, 1),
    'loss_streak', streak, 'loss_streak_total', streak_sum,
    'scoreboard', board, 'ho', ho, 'cost_structure', cost, 'expense_watch', watch, 'attention', attention);
end $function$;
revoke execute on function public.utpl_period_summary(uuid, date, date, text) from anon, public;
grant execute on function public.utpl_period_summary(uuid, date, date, text) to authenticated;

-- New insight: plant profit after its share of head-office cost.
CREATE OR REPLACE FUNCTION public.utpl_plant_true_profit(p_company_id uuid, p_from date, p_to date)
 RETURNS TABLE(plant text, label text, gross_sale numeric, net_profit numeric, ho_share numeric, true_profit numeric, true_margin_pct numeric, alloc_basis text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_company_finance_access(p_company_id::text);
  return query
  with m as (
    select li.month, li.plant,
      sum(li.amount) filter (where li.line = 'Gross Sale') sales,
      sum(li.amount) filter (where li.line = 'Net Profit Final') np
    from pnl_line_items li where li.company_id = p_company_id and li.month between p_from and p_to and li.plant <> 'Total'
    group by li.month, li.plant
  ), ho as (select m.month, m.np ho_np from m where m.plant = 'HO'),
  ops as (select m.* from m where m.plant <> 'HO'),
  tot as (select o.month, sum(o.sales) tot_sales from ops o group by o.month),
  alloc as (
    select o.month, o.plant, o.sales, o.np,
      coalesce(a.pct / 100.0, case when t.tot_sales > 0 then o.sales / t.tot_sales else 0 end) share,
      case when a.pct is not null then 'allocation %' else 'sales share' end basis,
      coalesce(h.ho_np, 0) ho_np
    from ops o
    left join pnl_allocation_pct a on a.company_id = p_company_id and a.month = o.month and a.plant = o.plant
    left join tot t on t.month = o.month
    left join ho h on h.month = o.month
  )
  select al.plant, coalesce(pl.label, al.plant), sum(al.sales), sum(al.np), sum(al.share * al.ho_np), sum(al.np + al.share * al.ho_np),
    case when sum(al.sales) > 0 then round(sum(al.np + al.share * al.ho_np) / sum(al.sales) * 100, 1) end,
    string_agg(distinct al.basis, ' / ')
  from alloc al left join pnl_plants pl on pl.company_id = p_company_id and pl.code = al.plant
  group by al.plant, pl.label, pl.sort_order order by pl.sort_order nulls last, al.plant;
end $function$;
revoke execute on function public.utpl_plant_true_profit(uuid, date, date) from anon, public;
grant execute on function public.utpl_plant_true_profit(uuid, date, date) to authenticated;

-- ───────────────────────── 5. Balance sheet per plant ────────────────────
alter table public.balance_sheet add column if not exists plant text not null default 'Company';
alter table public.balance_sheet_notes add column if not exists plant text not null default 'Company';
-- The old UNIQUE (company_id, month) was replaced by:
create unique index if not exists balance_sheet_company_month_plant_ux on public.balance_sheet (company_id, month, plant);
create unique index if not exists balance_sheet_notes_company_month_plant_row_ux on public.balance_sheet_notes (company_id, month, plant, row_order);

CREATE OR REPLACE FUNCTION public.utpl_balance_sheet(p_company_id text, p_month text, p_plant text DEFAULT 'Company'::text)
 RETURNS TABLE(month text, ppe numeric, long_term_investment numeric, total_fixed numeric, receivables numeric, stocks numeric, advances_prepayments numeric, advance_taxation numeric, cash_bank numeric, total_current numeric, total_assets numeric, owner_capital numeric, revenue_reserves numeric, retained_earnings numeric, total_equity numeric, hbl_stf numeric, loan_family numeric, mazhar_sb_ac numeric, loan_associates numeric, lease_liabilities numeric, total_ncl numeric, accrued_liabilities numeric, payable_controls numeric, taxation numeric, total_cl numeric, total_equity_liabilities numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_company_finance_access(p_company_id);
  return query
  with target as (
    select b.* from balance_sheet b where b.company_id = p_company_id and b.plant = p_plant and b.month <= p_month::date order by b.month desc limit 2
  )
  select to_char(t.month, 'YYYY-MM-DD'), t.ppe, t.long_term_investment, t.ppe + t.long_term_investment,
    t.receivables, t.stocks, t.advances_prepayments, t.advance_taxation, t.cash_bank,
    t.receivables + t.stocks + t.advances_prepayments + t.advance_taxation + t.cash_bank,
    t.ppe + t.long_term_investment + t.receivables + t.stocks + t.advances_prepayments + t.advance_taxation + t.cash_bank,
    t.owner_capital, t.revenue_reserves, t.retained_earnings, t.owner_capital + t.revenue_reserves + t.retained_earnings,
    t.hbl_stf, t.loan_family, t.mazhar_sb_ac, t.loan_associates, t.lease_liabilities,
    t.hbl_stf + t.loan_family + t.mazhar_sb_ac + t.loan_associates + t.lease_liabilities,
    t.accrued_liabilities, t.payable_controls, t.taxation, t.accrued_liabilities + t.payable_controls + t.taxation,
    t.owner_capital + t.revenue_reserves + t.retained_earnings + t.hbl_stf + t.loan_family + t.mazhar_sb_ac + t.loan_associates + t.lease_liabilities + t.accrued_liabilities + t.payable_controls + t.taxation
  from target t order by t.month desc;
end $function$;
revoke execute on function public.utpl_balance_sheet(text, text, text) from anon, public;
grant execute on function public.utpl_balance_sheet(text, text, text) to authenticated;

CREATE OR REPLACE FUNCTION public.utpl_balance_sheet_months(p_company_id text)
 RETURNS TABLE(month text, plant text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_company_finance_access(p_company_id);
  return query select to_char(b.month, 'YYYY-MM-DD'), b.plant from balance_sheet b where b.company_id = p_company_id order by b.plant, b.month;
end $function$;
revoke execute on function public.utpl_balance_sheet_months(text) from anon, public;
grant execute on function public.utpl_balance_sheet_months(text) to authenticated;

CREATE OR REPLACE FUNCTION public.utpl_balance_sheet_notes(p_company_id text, p_month text, p_plant text DEFAULT 'Company'::text, p_note_no integer DEFAULT NULL::integer)
 RETURNS TABLE(note_no integer, section text, account_code text, account_name text, amount numeric, is_total boolean, is_header boolean, row_order integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_company_finance_access(p_company_id);
  return query
  select n.note_no, n.section, n.account_code, n.account_name, n.amount, n.is_total, n.is_header, n.row_order
  from balance_sheet_notes n
  where n.company_id = p_company_id and n.plant = p_plant and n.month = p_month::date and (p_note_no is null or n.note_no = p_note_no)
  order by n.row_order;
end $function$;
revoke execute on function public.utpl_balance_sheet_notes(text, text, text, integer) from anon, public;
grant execute on function public.utpl_balance_sheet_notes(text, text, text, integer) to authenticated;

-- Old names kept as guarded wrappers (consolidated statement).
CREATE OR REPLACE FUNCTION public.get_balance_sheet(p_company_id text, p_month text)
 RETURNS TABLE(month text, ppe numeric, long_term_investment numeric, total_fixed numeric, receivables numeric, stocks numeric, advances_prepayments numeric, advance_taxation numeric, cash_bank numeric, total_current numeric, total_assets numeric, owner_capital numeric, revenue_reserves numeric, retained_earnings numeric, total_equity numeric, hbl_stf numeric, loan_family numeric, mazhar_sb_ac numeric, loan_associates numeric, lease_liabilities numeric, total_ncl numeric, accrued_liabilities numeric, payable_controls numeric, taxation numeric, total_cl numeric, total_equity_liabilities numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query select * from utpl_balance_sheet(p_company_id, p_month, 'Company');
end $function$;

CREATE OR REPLACE FUNCTION public.get_balance_sheet_months(p_company_id text)
 RETURNS TABLE(month text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_company_finance_access(p_company_id);
  return query select to_char(b.month, 'YYYY-MM-DD') from balance_sheet b where b.company_id = p_company_id order by b.month;
end $function$;

CREATE OR REPLACE FUNCTION public.get_balance_sheet_notes(p_company_id text, p_month text, p_note_no integer DEFAULT NULL::integer)
 RETURNS TABLE(note_no integer, section text, account_code text, account_name text, amount numeric, is_total boolean, is_header boolean, row_order integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform assert_company_finance_access(p_company_id);
  return query
  select n.note_no, n.section, n.account_code, n.account_name, n.amount, n.is_total, n.is_header, n.row_order
  from balance_sheet_notes n
  where n.company_id = p_company_id and n.month = p_month::date and (p_note_no is null or n.note_no = p_note_no)
  order by n.row_order;
end $function$;

commit;

-- ─── ROLLBACK ────────────────────────────────────────────────────────────────
-- The pnl_* and get_balance_sheet* functions can be restored to their
-- pre-279 SQL bodies (see migration 143 / 182 in this folder) — the guard
-- call is the only functional change; plant lists were ('FEDMIC','MEPCO',
-- 'PESCO','HO'). Then:
--   drop function utpl_period_summary(uuid,date,date,text);
--   drop function utpl_plant_true_profit(uuid,date,date); drop function utpl_data_coverage(uuid);
--   drop function utpl_plants(uuid); drop function utpl_balance_sheet(text,text,text);
--   drop function utpl_balance_sheet_months(text); drop function utpl_balance_sheet_notes(text,text,text,integer);
--   drop function assert_unze_pnl_access(); drop function can_view_unze_pnl_db();
--   (assert_company_finance_access / can_view_pnl_company_db: remove the UTPL branch)
--   drop table pnl_plants; alter table member_permissions drop column can_view_unze_pnl;
--   balance_sheet.plant: all rows are 'Company' today — restore the (company_id, month)
--   unique index before dropping the column.
