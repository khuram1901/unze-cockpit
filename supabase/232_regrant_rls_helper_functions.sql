-- Hotfix to migration 230: functions referenced inside RLS policy
-- expressions execute as the querying role (authenticated), so the blanket
-- revoke broke every policy-gated table read ("permission denied for
-- function can_access_all_tasks" on the Tasks page). Re-grant EXECUTE to
-- authenticated for every function referenced in any public RLS policy
-- (23 helpers: is_admin, can_access_all_tasks, get_user_role, ...).
-- Views and column defaults were checked the same way — none affected.
-- Applied via Supabase MCP 30/08/2026.
do $$
declare r record; n int := 0;
begin
  for r in
    with pol as (
      select coalesce(qual,'') || ' ' || coalesce(with_check,'') as expr
      from pg_policies where schemaname = 'public'
    )
    select distinct p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and exists (select 1 from pol where pol.expr like '%' || p.proname || '%')
  loop
    execute format('grant execute on function public.%I(%s) to authenticated', r.proname, r.args);
    n := n + 1;
  end loop;
  raise notice 're-granted % RLS helper functions to authenticated', n;
end $$;
