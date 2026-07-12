-- ============================================================
-- 081: Fold daily ops / weekly / monthly-PO reports into the CEO digest
--
-- Khuram wants ONE email a day covering everything currently split across
-- separate reports (daily ops summary, weekly report, monthly PO report,
-- investments, tax alerts). These three RPCs replicate the JS-side
-- aggregation from those report routes in Postgres (project rule: never
-- aggregate raw rows in JS), condensed to headline figures rather than
-- the full per-PO/per-person breakdown those reports show — the point is
-- a summary, not a re-send of the whole report.
--
-- Investments already has a reusable RPC (get_portfolio_daily_summary) —
-- no change needed there. Tax alerts are read directly from the
-- tax_deadline_alerts table by the digest route — no new RPC needed.
-- ============================================================

-- ── Daily ops snapshot (was app/api/reports/daily-pdf/route.ts) ──
create or replace function get_daily_ops_snapshot(p_today date, p_yesterday date)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'utpl_cash', (
      select jsonb_build_object('closing_balance', closing_balance, 'closing_after_post_dated', closing_after_post_dated, 'position_date', position_date)
      from daily_cash_position
      where company_id = '15884c2d-48a4-4d43-be90-0ef6e130790c'
      order by position_date desc limit 1
    ),
    'ifpl_cash', (
      select jsonb_build_object('closing_balance', closing_balance, 'closing_after_post_dated', closing_after_post_dated, 'position_date', position_date)
      from daily_cash_position
      where company_id = '77921705-8a15-4406-847a-b234f84b5ec3'
      order by position_date desc limit 1
    ),
    'overdue_tasks_count', (
      select count(*) from tasks
      where status in ('Not Started', 'In Progress', 'Waiting Reply') and due_date < p_today
    ),
    'overdue_tasks_top5', (
      select coalesce(jsonb_agg(jsonb_build_object('description', description, 'assigned_to', assigned_to, 'due_date', due_date)), '[]'::jsonb)
      from (
        select description, assigned_to, due_date from tasks
        where status in ('Not Started', 'In Progress', 'Waiting Reply') and due_date < p_today
        order by due_date limit 5
      ) x
    ),
    'waiting_reply_count', (select count(*) from tasks where status = 'Waiting Reply'),
    'machines_down_count', (select count(*) from machine_issues where issue_status = 'Down'),
    'machines_down', (
      select coalesce(jsonb_agg(jsonb_build_object('plant_name', plant_name, 'machine_name', machine_name)), '[]'::jsonb)
      from machine_issues where issue_status = 'Down'
    ),
    'stuck_bills_count', (
      select count(*)
      from receivables b
      join receivable_stages s on s.stage_order = b.current_stage_order
      where b.status <> 'Collected'
        and (
          (select count(*) from generate_series(b.current_stage_entered_date, p_today, interval '1 day') d where extract(dow from d) not in (0, 6)) - 1
        ) >= s.working_day_budget
    ),
    'stuck_bills_top5', (
      select coalesce(jsonb_agg(jsonb_build_object('utility', x.utility, 'amount', x.amount)), '[]'::jsonb)
      from (
        select b.utility, b.amount
        from receivables b
        join receivable_stages s on s.stage_order = b.current_stage_order
        where b.status <> 'Collected'
          and (
            (select count(*) from generate_series(b.current_stage_entered_date, p_today, interval '1 day') d where extract(dow from d) not in (0, 6)) - 1
          ) >= s.working_day_budget
        order by b.amount desc
        limit 5
      ) x
    ),
    'aging_0_30', (select coalesce(sum(amount), 0) from receivables where status <> 'Collected' and (p_today - date_submitted) <= 30),
    'aging_31_60', (select coalesce(sum(amount), 0) from receivables where status <> 'Collected' and (p_today - date_submitted) between 31 and 60),
    'aging_61_90', (select coalesce(sum(amount), 0) from receivables where status <> 'Collected' and (p_today - date_submitted) between 61 and 90),
    'aging_90_plus', (select coalesce(sum(amount), 0) from receivables where status <> 'Collected' and (p_today - date_submitted) > 90),
    'yesterday_production', (select coalesce(sum(qty_31 + qty_36 + qty_45 + qty_meter), 0) from production_entries where entry_date = p_yesterday)
  )
$$;

-- ── Weekly ops snapshot (was app/api/reports/weekly/route.ts) ──
-- Called with a rolling 7-day window every day, not just Fridays, so the
-- digest always shows a current "week so far" picture.
create or replace function get_weekly_ops_snapshot(p_since date, p_today date)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'created_this_week', (select count(*) from tasks where created_at::date >= p_since),
    'completed_this_week', (select count(*) from tasks where status = 'Completed' and updated_at::date >= p_since),
    'open_total', (select count(*) from tasks where status not in ('Completed', 'Cancelled')),
    'overdue_count', (select count(*) from tasks where status not in ('Completed', 'Cancelled') and due_date < p_today),
    'waiting_reply_count', (select count(*) from tasks where status = 'Waiting Reply'),
    'escalations_count', (
      select count(*) from tasks
      where status not in ('Completed', 'Cancelled') and source_type in ('kpi_escalation', 'receivable_escalation')
    ),
    'top_people', (
      select coalesce(jsonb_agg(jsonb_build_object('name', name, 'open', open_ct, 'overdue', overdue_ct) order by overdue_ct desc, open_ct desc), '[]'::jsonb)
      from (
        select coalesce(assigned_to, 'Unassigned') as name,
          count(*) as open_ct,
          count(*) filter (where due_date < p_today) as overdue_ct
        from tasks
        where status not in ('Completed', 'Cancelled')
        group by coalesce(assigned_to, 'Unassigned')
        order by overdue_ct desc, open_ct desc
        limit 5
      ) x
    ),
    'produced_this_week', (select coalesce(sum(qty_31 + qty_36 + qty_45 + qty_meter), 0) from production_entries where entry_date between p_since and p_today),
    'dispatched_this_week', (select coalesce(sum(qty_31 + qty_36 + qty_45 + qty_meter), 0) from dispatch_entries where entry_date between p_since and p_today),
    'machines_down_count', (select count(*) from machine_issues where issue_status = 'Down'),
    'cash_balance', (select closing_balance from daily_cash_position order by position_date desc limit 1),
    'week_receipts', (select coalesce(sum(total_receipts), 0) from daily_cash_position where position_date >= p_since),
    'week_payments', (select coalesce(sum(total_payments), 0) from daily_cash_position where position_date >= p_since),
    'total_receivables', (select coalesce(sum(amount), 0) from receivables),
    'collected_receivables', (select coalesce(sum(amount), 0) from receivables where status = 'Collected')
  )
$$;

-- ── Monthly PO snapshot (was app/api/reports/monthly-po/route.ts) ──
-- Condensed to headline totals + near-exhausted authority letters, rather
-- than the full per-plant/per-PO breakdown the standalone report shows —
-- that level of detail belongs in the Stock page, not a daily email.
create or replace function get_monthly_po_snapshot(p_month_start date, p_month_end date)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with letter_dispatched as (
    select
      al.id as letter_id,
      al.po_id,
      (al.qty_31 + al.qty_36 + al.qty_45 + al.qty_meter) as authorized_total,
      (al.opening_dispatched_31 + al.opening_dispatched_36 + al.opening_dispatched_45 + al.opening_dispatched_meter)
        + coalesce((select sum(dr.qty_31 + dr.qty_36 + dr.qty_45 + dr.qty_meter) from dispatch_records dr where dr.authority_letter_id = al.id), 0) as dispatched_total,
      coalesce((select sum(dr.qty_31 + dr.qty_36 + dr.qty_45 + dr.qty_meter) from dispatch_records dr where dr.authority_letter_id = al.id and dr.dispatch_date between p_month_start and p_month_end), 0) as month_dispatched
    from authority_letters al
  ),
  near_exhausted as (
    select al.letter_number, c.name as contractor_name, po.customer_name
    from letter_dispatched ld
    join authority_letters al on al.id = ld.letter_id
    join purchase_orders po on po.id = al.po_id
    left join contractors c on c.id = al.contractor_id
    where po.status = 'Active'
      and ld.authorized_total > 0
      and (ld.authorized_total - ld.dispatched_total) / ld.authorized_total < 0.1
  ),
  po_totals as (
    select
      po.id,
      (po.ordered_31 + po.ordered_36 + po.ordered_45 + po.ordered_meter) as ordered,
      (po.opening_produced_31 + po.opening_produced_36 + po.opening_produced_45 + po.opening_produced_meter)
        + coalesce((select sum(pa.qty_31 + pa.qty_36 + pa.qty_45 + pa.qty_meter) from production_allocations pa where pa.po_id = po.id), 0) as produced_total,
      coalesce((
        select sum(pa.qty_31 + pa.qty_36 + pa.qty_45 + pa.qty_meter)
        from production_allocations pa
        join production_entries pe on pe.id = pa.production_entry_id
        where pa.po_id = po.id and pe.entry_date between p_month_start and p_month_end
      ), 0) as month_produced,
      coalesce((select sum(ld.dispatched_total) from letter_dispatched ld where ld.po_id = po.id), 0) as dispatched_total,
      coalesce((select sum(ld.month_dispatched) from letter_dispatched ld where ld.po_id = po.id), 0) as month_dispatched
    from purchase_orders po
    where po.is_system_unallocated = false
  )
  select jsonb_build_object(
    'total_ordered', (select coalesce(sum(ordered), 0) from po_totals),
    'total_produced', (select coalesce(sum(produced_total), 0) from po_totals),
    'total_dispatched', (select coalesce(sum(dispatched_total), 0) from po_totals),
    'month_produced', (select coalesce(sum(month_produced), 0) from po_totals),
    'month_dispatched', (select coalesce(sum(month_dispatched), 0) from po_totals),
    'near_exhausted_count', (select count(*) from near_exhausted),
    'near_exhausted_items', (
      select coalesce(jsonb_agg(jsonb_build_object('letter_number', letter_number, 'contractor_name', contractor_name, 'customer_name', customer_name)), '[]'::jsonb)
      from (select * from near_exhausted limit 5) y
    )
  )
$$;
