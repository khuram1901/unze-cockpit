-- Migration 272: daily guarantee expiry digest — 17/10/2026 (applied to production same day)
-- Thin wrapper over get_guarantee_alerts() (single source of urgency logic) that
-- adds the DB-computed decisions the cron route needs, so the route does no
-- filtering/aggregation in JS. Service-role only.

begin;

create or replace function public.get_guarantee_alert_digest()
returns jsonb language sql stable security definer set search_path = public as $$
  with a as (select get_guarantee_alerts() as j)
  select a.j
    || jsonb_build_object(
         'max_days_overdue', coalesce((select max((o->>'days_overdue')::int) from jsonb_array_elements(a.j->'overdue') o), 0),
         'escalate_to_ceo',  coalesce((select max((o->>'days_overdue')::int) from jsonb_array_elements(a.j->'overdue') o), 0) > 15,
         'has_alerts',       (a.j->>'overdue_count')::int + (a.j->>'due_soon_count')::int > 0
       )
  from a;
$$;
revoke execute on function public.get_guarantee_alert_digest() from anon, public, authenticated;

commit;

-- ─── ROLLBACK ────────────────────────────────────────────────────────────────
-- drop function if exists public.get_guarantee_alert_digest();
