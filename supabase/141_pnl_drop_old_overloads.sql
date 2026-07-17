-- 140 added p_allocate_ho to pnl_segment_breakdown and pnl_overheads_breakdown,
-- but Postgres treats a different parameter count as a different function —
-- "create or replace" didn't replace the old ones, it left them sitting
-- alongside the new ones as overloads. A call using the old argument count
-- would now be ambiguous between the two. Drop the old signatures outright.
-- Apply manually via the Supabase SQL Editor, after 140 — do not auto-run.

drop function if exists pnl_segment_breakdown(uuid, date);
drop function if exists pnl_overheads_breakdown(uuid, text, date, date);
