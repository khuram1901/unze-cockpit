-- ============================================================
-- 075: Folderit HR sub-categories (Stage 1.5)
--
-- HR's Folderit account (2ztVT0f2yX) has 12 top-level folders —
-- Khuram wants these surfaced as browsable categories on the HR
-- section of the Folderit page, starting with just "Policies/SOP".
-- Rest (Payroll Approvals, Off Boarding, Performance Management,
-- Operations, Organisation Development, Payroll, TA & TM,
-- Training & Development, Common Folder) can be added later by
-- inserting more rows here — no code change needed to add a category,
-- same pattern as folderit_account_map.
-- ============================================================

create table if not exists folderit_hr_categories (
  category_name text primary key,
  account_uid   text not null references folderit_account_map(account_uid),
  folder_uid    text not null,
  is_active     boolean not null default true,
  sort_order    integer not null default 0,
  updated_at    timestamptz not null default now()
);

insert into folderit_hr_categories (category_name, account_uid, folder_uid, sort_order) values
  ('Policies & SOPs', '2ztVT0f2yX', 'I_HCJ0UZc6', 1)
on conflict (category_name) do update set
  account_uid = excluded.account_uid,
  folder_uid  = excluded.folder_uid,
  updated_at  = now();

-- Files found inside HR category folders (separate from the generic
-- account-level inbox cache in folderit_inbox_files).
create table if not exists folderit_hr_category_files (
  file_uid      text primary key,
  category_name text not null references folderit_hr_categories(category_name),
  name          text,
  created_at    timestamptz,
  synced_at     timestamptz not null default now()
);
create index if not exists idx_folderit_hr_cat_files_category on folderit_hr_category_files(category_name);
