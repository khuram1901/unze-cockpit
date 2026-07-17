-- Migration 123: Backfill legal_notices.company_id from the stored company_name
--
-- Found during the 15 Jul 2026 full-app audit: TaxationDashboard.tsx
-- always wrote company_id as UTPL regardless of which company was
-- actually picked in the form — the real choice only ever reached the
-- free-text company_name column. The app-side fix (resolveCompanyId in
-- TaxationDashboard.tsx) is in place going forward; this backfills
-- every existing row using the company_name that was correctly
-- recorded all along.
--
-- Only touches rows currently tagged UTPL where company_name says
-- otherwise (i.e. rows the bug actually mislabelled) — never touches a
-- row that's already correctly UTPL, and never invents a company for
-- "K&K Jhang" (no such company exists in public.companies yet — left
-- as NULL, same "needs review" convention used elsewhere, until Khuram
-- decides what that should map to).
--
-- Run the SELECT preview first and check the row count/company split
-- looks right before running the UPDATE. Apply via Supabase SQL Editor,
-- after 122.

-- Preview — run this first:
-- select company_name, count(*) from public.legal_notices
-- where company_id = '15884c2d-48a4-4d43-be90-0ef6e130790c'
--   and company_name is not null
--   and company_name not ilike 'unze trading%'
-- group by company_name order by company_name;

begin;

update public.legal_notices
set company_id = case
  when company_name ilike 'imperial footwear%' then '77921705-8a15-4406-847a-b234f84b5ec3'
  when company_name ilike 'haute dolci%'        then '16a92b7f-b3fa-4271-819b-c6befb534f12'
  when company_name ilike 'barahn%' or company_name ilike 'baranh%' then '6401ba75-f297-4617-84c1-305bcaf35a50'
  when company_name ilike 'directors%'          then 'e867582b-2093-4d10-8eaf-de54a168ee55'
  when company_name ilike 'k&k jhang%'          then null  -- no matching company row yet — flagged to Khuram
  else company_id  -- unrecognised label: leave untouched rather than guess
end
where company_id = '15884c2d-48a4-4d43-be90-0ef6e130790c'  -- only rows currently mislabelled as UTPL
  and company_name is not null
  and company_name not ilike 'unze trading%';

commit;
