-- Migration 267: revoke anon EXECUTE on all visitor RPCs
-- Applied: 2026-10-15
-- Closes the gap where anyone with the public anon key could query
-- visitor data without logging in. Visitor RPCs were created after
-- migration 230 (which revoked anon from earlier RPCs) and inherited
-- the default PUBLIC grant. This removes that grant from all 10
-- visitor functions. Authenticated staff are unaffected.

REVOKE EXECUTE ON FUNCTION
  lookup_visitor(text, text),
  visitor_checkout(uuid, timestamp with time zone),
  visitor_departments_hosts(),
  visitor_dept_summary(date, date),
  visitor_exceptions(date, date),
  visitor_kpi(date, date),
  visitor_list_paged(date, date, text, text, text, integer, integer),
  visitor_peak_hours(date, date),
  visitor_settings_get(),
  set_visitor_log_updated_at()
FROM anon, public;
