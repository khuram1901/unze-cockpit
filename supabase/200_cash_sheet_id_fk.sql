-- Migration 200: Add cash_sheet_id FK to daily_cash_position
-- This links each daily summary row to its source cash_sheet_uploads record,
-- allowing Finance pages to drill through to individual transaction detail.
-- Apply manually in the Supabase SQL Editor.

alter table daily_cash_position
  add column if not exists cash_sheet_id uuid
    references cash_sheet_uploads(id) on delete set null;

-- Index for fast lookup when Finance page drills into detail
create index if not exists idx_daily_cash_position_cash_sheet_id
  on daily_cash_position(cash_sheet_id);

-- Backfill: link any existing daily_cash_position rows to a matching
-- cash_sheet_uploads row (same company + date) that may already exist.
update daily_cash_position dcp
set cash_sheet_id = csu.id
from cash_sheet_uploads csu
where dcp.cash_sheet_id is null
  and csu.sheet_date = dcp.position_date
  and (
    (dcp.company_id = '15884c2d-48a4-4d43-be90-0ef6e130790c' and csu.company = 'UTPL') or
    (dcp.company_id = '77921705-8a15-4406-847a-b234f84b5ec3' and csu.company = 'IFPL')
  );

-- NOTE: The backfill UPDATE above uses placeholder company IDs. If your app
-- constants differ, replace them with the actual UUIDs from your constants file,
-- or run the backfill manually after confirming the correct IDs.
-- New uploads (via parse-cash-flow or check-inbox) will set this FK automatically.
