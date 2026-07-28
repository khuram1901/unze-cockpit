-- Migration 202: Revoke anon execute on all P&L and IFPL RPCs
-- Postgres grants EXECUTE to PUBLIC by default, which includes the anon role.
-- None of these functions had explicit REVOKE statements, meaning an unauthenticated
-- caller could invoke them directly via the Supabase REST API.
-- All RPCs are security definer so they bypass RLS — revoke is the only guard.

-- IFPL P&L RPCs (migration 144)
REVOKE EXECUTE ON FUNCTION public.ifpl_kpi_by_month(date, date, text, text)    FROM anon;
REVOKE EXECUTE ON FUNCTION public.ifpl_branch_league(date, date)               FROM anon;
REVOKE EXECUTE ON FUNCTION public.ifpl_line_totals(date, date, text, text)     FROM anon;
REVOKE EXECUTE ON FUNCTION public.ifpl_validation_summary()                    FROM anon;

-- IFPL check details (migration 150)
REVOKE EXECUTE ON FUNCTION public.ifpl_check_details()                         FROM anon;

-- P&L commentary (migration 145)
REVOKE EXECUTE ON FUNCTION public.get_pnl_commentary(text, text, date, date)   FROM anon;

-- UTPL P&L RPCs (migrations 139 / 140 — same class of issue)
REVOKE EXECUTE ON FUNCTION public.pnl_kpi_summary(uuid, date, date)            FROM anon;
REVOKE EXECUTE ON FUNCTION public.pnl_segment_breakdown(uuid, date)            FROM anon;
REVOKE EXECUTE ON FUNCTION public.pnl_overheads_breakdown(uuid, text, date, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pnl_ytd_summary(uuid, date)                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.pnl_profit_bridge(uuid, date)                FROM anon;
REVOKE EXECUTE ON FUNCTION public.pnl_new_account_flags(uuid, date)            FROM anon;

-- Guarantee summary RPC (migration 060)
REVOKE EXECUTE ON FUNCTION public.get_guarantee_summary()                      FROM anon;
