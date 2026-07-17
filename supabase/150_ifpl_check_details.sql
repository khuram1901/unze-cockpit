-- Clickable data-quality detail on the Imperial P&L page (18/07/2026).
-- Returns every failed check from each month's LATEST upload — warnings
-- (blocking=false, month still accepted) and blocking failures (month
-- rejected) — so the page can show exactly which cell in the workbook is
-- wrong, by how much, and accounts can fix + re-upload. Locked to
-- authenticated like the rest of the P&L RPCs (migration 149 pattern).
-- Apply manually via the Supabase SQL Editor.

create or replace function ifpl_check_details()
returns table (month date, check_name text, expected numeric, reported numeric, diff numeric, blocking boolean, status text)
security definer
set search_path = public
language sql
as $$
  select u.month, c.check_name, c.expected, c.reported, c.diff, c.blocking, u.status
  from ifpl_pnl_checks c
  join ifpl_pnl_uploads u on u.id = c.upload_id
  where c.passed = false
    and u.uploaded_at = (select max(u2.uploaded_at) from ifpl_pnl_uploads u2 where u2.month = u.month)
  order by u.month, c.blocking desc, c.check_name;
$$;

revoke execute on function public.ifpl_check_details() from public, anon;
grant execute on function public.ifpl_check_details() to authenticated, service_role;
