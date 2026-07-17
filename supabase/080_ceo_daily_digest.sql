-- ============================================================
-- 080: CEO daily digest
--
-- Khuram was getting 50-70 individual emails a day from task assignments
-- (every task/escalation fires its own email — see app/lib/send-email.ts).
-- This replaces that with a single daily digest: everything he needs —
-- open tasks, escalations, and things waiting on his approval (meeting
-- requests, Folderit) — assembled in one round-trip, per the app's
-- rule that all aggregation happens in Postgres, never in JS.
--
-- Note: leave-request approvals were originally planned as a section here,
-- but the leave_records table (migration 019) was never actually applied
-- to the live database and nothing in the app references it — dropped
-- from this digest rather than blocking on an unrelated migration.
--
-- Sent by a new cron route (app/api/notifications/ceo-digest/route.ts),
-- weekdays only, 11:30am Pakistan time.
-- ============================================================

create or replace function get_ceo_daily_digest(p_emails text[])
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'tasks_open', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id,
        'description', t.description,
        'priority', t.priority,
        'due_date', t.due_date,
        'assigned_by', t.assigned_by,
        'is_overdue', (t.due_date is not null and t.due_date < current_date)
      ) order by t.due_date nulls last), '[]'::jsonb)
      from tasks t
      where t.assigned_to_email = any(p_emails)
        and t.status not in ('Completed', 'Cancelled')
        and coalesce(t.source_type, '') not in ('kpi_escalation', 'receivable_escalation')
    ),
    'tasks_open_count', (
      select count(*)::int from tasks t
      where t.assigned_to_email = any(p_emails)
        and t.status not in ('Completed', 'Cancelled')
        and coalesce(t.source_type, '') not in ('kpi_escalation', 'receivable_escalation')
    ),
    'tasks_overdue_count', (
      select count(*)::int from tasks t
      where t.assigned_to_email = any(p_emails)
        and t.status not in ('Completed', 'Cancelled')
        and t.due_date is not null and t.due_date < current_date
        and coalesce(t.source_type, '') not in ('kpi_escalation', 'receivable_escalation')
    ),
    'escalations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id,
        'description', t.description,
        'exception_type', t.exception_type,
        'due_date', t.due_date
      ) order by t.due_date nulls last), '[]'::jsonb)
      from tasks t
      where t.assigned_to_email = any(p_emails)
        and t.status not in ('Completed', 'Cancelled')
        and t.source_type in ('kpi_escalation', 'receivable_escalation')
    ),
    'meeting_approvals', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id,
        'meeting_title', m.meeting_title,
        'requested_by_name', m.requested_by_name,
        'requested_date', m.requested_date,
        'preferred_time', m.preferred_time
      ) order by m.requested_date nulls last), '[]'::jsonb)
      from meeting_requests m
      where m.status = 'Pending'
    ),
    'folderit_approval_count', (
      select count(*)::int
      from folderit_resolution_invites ri
      join folderit_account_map am on am.account_uid = ri.account_uid
      where am.is_active
        and ri.status in ('pending', 'pendingInvite', 'active')
        and ri.email = any(p_emails)
    ),
    'folderit_company_inbox_count', (
      select count(*)::int
      from folderit_inbox_files f
      join folderit_account_map am on am.account_uid = f.account_uid
      where am.is_active and am.scope = 'company'
    )
  )
$$;
