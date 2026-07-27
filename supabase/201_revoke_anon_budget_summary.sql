-- Migration 201: Revoke anon execute on get_department_budget_summary
-- Migration 126 granted EXECUTE to authenticated but never explicitly revoked anon.
-- Postgres default grants execute to PUBLIC (which includes anon), so anonymous
-- callers could invoke this RPC directly against the Supabase REST API.

REVOKE EXECUTE ON FUNCTION public.get_department_budget_summary(uuid, text) FROM anon;
