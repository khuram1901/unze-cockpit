-- Security fix (18/07/2026), found by the Supabase security advisor while
-- verifying the P&L work: security-definer functions are EXECUTE-granted to
-- PUBLIC by default, so the `anon` role (no login) could call every P&L RPC
-- through the REST API and read financial data. Revoke anon/public execute
-- on all P&L read RPCs; logged-in users and the service role keep access.
--
-- Note honestly recorded: `authenticated` still means ANY logged-in member
-- can technically call these RPCs directly (outside the page's permission
-- gates). Closing that fully needs permission checks inside each function —
-- flagged for a future pass across the app's whole RPC surface, which has
-- the same pattern. Apply manually via the Supabase SQL Editor.

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'pnl_kpi_summary(uuid, date, date)',
    'pnl_segment_breakdown(uuid, date, boolean)',
    'pnl_overheads_breakdown(uuid, text, date, date, boolean)',
    'pnl_ytd_summary(uuid, date)',
    'pnl_profit_bridge(uuid, date)',
    'pnl_new_account_flags(uuid, date)',
    'pnl_plant_margin_trend(uuid, date, date)',
    'pnl_cost_structure(uuid, date, date, text)',
    'pnl_validation_summary(uuid)',
    'pnl_kpi_summary_plant(uuid, date, date, text)',
    'pnl_plant_scoreboard(uuid, date, date)',
    'ifpl_kpi_by_month(date, date, text, text)',
    'ifpl_branch_league(date, date)',
    'ifpl_line_totals(date, date, text, text)',
    'ifpl_validation_summary()',
    'get_pnl_commentary(text, text, date, date)'
  ]
  loop
    begin
      execute format('revoke execute on function public.%s from public, anon', fn);
      execute format('grant execute on function public.%s to authenticated, service_role', fn);
    exception when undefined_function then
      raise notice 'skipped (not found): %', fn;
    end;
  end loop;
end $$;
