-- Phase 4 hardening (full sweep): revoke anonymous execution of every
-- security definer function in public. Functions called from the browser
-- with the user's login (64, audited from the codebase — see array below)
-- keep EXECUTE for authenticated. Everything else is server-only (API
-- routes with the service role), so authenticated is revoked too.
-- Trigger functions are excluded (not callable via PostgREST; their
-- execution is checked at trigger-creation time, not per caller).
-- Result: 178 security definer functions — anon can execute 0,
-- authenticated can execute 63, service_role all 178.
-- Applied via Supabase MCP 30/08/2026.
do $$
declare
  r record;
  n_client int := 0;
  n_server int := 0;
  client_fns text[] := array[
    'audit_assign_team','audit_daily_log_summary','audit_executive_summary',
    'audit_my_tasks','audit_start_new_cycle','audit_team_overview',
    'daily_cash_continuity','get_audit_log_department_breakdown',
    'get_audit_log_stats','get_balance_sheet','get_balance_sheet_ifl',
    'get_balance_sheet_ifl_months','get_balance_sheet_months',
    'get_balance_sheet_notes','get_collected_receivables_by_plant',
    'get_company_cash_yearly_comparison','get_department_budget_summary',
    'get_department_kpi_counts','get_hr_tasks_summary',
    'get_monthly_plant_actuals','get_my_conversations',
    'get_notification_badge_counts','get_pdc_outlook',
    'get_pension_comparison_performance','get_pension_fund_breakdown',
    'get_pension_fund_movement','get_pension_summary','get_plant_kpis',
    'get_pnl_commentary','get_pnl_restatements','get_portfolio_summary_full',
    'get_production_summary','get_psx_stock_movement',
    'get_realised_gains_by_ticker','get_realised_gains_summary',
    'get_receivable_aging_by_customer','get_receivable_aging_totals',
    'get_receivable_rag_by_customer','get_recurring_task_cycle_status',
    'get_task_workload','get_tasks_department_breakdown',
    'get_tasks_kpi_summary','get_tax_dashboard_summary','get_td_calendar',
    'get_td_summary','get_upcoming_dividends','ifpl_branch_league',
    'ifpl_check_details','ifpl_kpi_by_month','ifpl_line_totals',
    'ifpl_validation_summary','pnl_cost_structure','pnl_kpi_summary',
    'pnl_kpi_summary_plant','pnl_new_account_flags',
    'pnl_overheads_breakdown','pnl_plant_margin_trend',
    'pnl_plant_scoreboard','pnl_validation_summary','rest_branch_league',
    'rest_check_details','rest_kpi_by_month','rest_line_totals',
    'rest_validation_summary'
  ];
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.prorettype <> 'trigger'::regtype
      and p.prokind = 'f'
  loop
    if r.proname = any(client_fns) then
      execute format('revoke execute on function public.%I(%s) from public, anon', r.proname, r.args);
      execute format('grant execute on function public.%I(%s) to authenticated, service_role', r.proname, r.args);
      n_client := n_client + 1;
    else
      execute format('revoke execute on function public.%I(%s) from public, anon, authenticated', r.proname, r.args);
      execute format('grant execute on function public.%I(%s) to service_role', r.proname, r.args);
      n_server := n_server + 1;
    end if;
  end loop;
  raise notice 'client-callable (authenticated kept): %, server-only: %', n_client, n_server;
end $$;
