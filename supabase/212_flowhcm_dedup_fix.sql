-- 212: Fix FlowHCM sync duplication
-- ─────────────────────────────────────────────────────────────────
-- Problem: 8 flw_* tables were duplicating on every 10-min sync because
-- their upsert conflict keys contained NULL date columns (NULL never
-- matches NULL in a unique index), or the response wrapper wasn't
-- unwrapped so junk single-rows accumulated.
-- Fix: each table gets a deterministic flw_key (computed in the sync
-- route from raw FlowHCM fields) with a full unique index. Old
-- conflict-key indexes dropped. Tables truncated — data is fully
-- re-syncable from FlowHCM within 10 minutes.
-- ─────────────────────────────────────────────────────────────────

-- 1. Add flw_key columns
alter table flw_advance_salary add column if not exists flw_key text;
alter table flw_pf_data        add column if not exists flw_key text;
alter table flw_overtime       add column if not exists flw_key text;
alter table flw_transfers      add column if not exists flw_key text;
alter table flw_employee_exits add column if not exists flw_key text;
alter table flw_exemptions     add column if not exists flw_key text;
alter table flw_salary_setup   add column if not exists flw_key text;
alter table flw_allowances     add column if not exists flw_key text;

-- 2. Drop old unique indexes that no longer match the upsert strategy
drop index if exists flw_advance_salary_uq;
drop index if exists flw_pf_data_uq;
drop index if exists flw_overtime_uq;
drop index if exists flw_transfers_uq;
drop index if exists flw_exemptions_uq;
drop index if exists flw_allowances_uq;
alter table flw_employee_exits drop constraint if exists flw_employee_exits_employee_code_key;
alter table flw_salary_setup   drop constraint if exists flw_salary_setup_employee_code_key;

-- 3. Purge duplicated data (fully re-synced by next cron run)
truncate flw_advance_salary;
truncate flw_pf_data;
truncate flw_overtime;
truncate flw_transfers;
truncate flw_employee_exits;
truncate flw_exemptions;
truncate flw_salary_setup;
truncate flw_allowances;

-- 4. New unique indexes on flw_key (full, not partial — usable as ON CONFLICT targets)
create unique index flw_advance_salary_key_uq on flw_advance_salary (flw_key);
create unique index flw_pf_data_key_uq        on flw_pf_data (flw_key);
create unique index flw_overtime_key_uq       on flw_overtime (flw_key);
create unique index flw_transfers_key_uq      on flw_transfers (flw_key);
create unique index flw_employee_exits_key_uq on flw_employee_exits (flw_key);
create unique index flw_exemptions_key_uq     on flw_exemptions (flw_key);
create unique index flw_salary_setup_key_uq   on flw_salary_setup (flw_key);
create unique index flw_allowances_key_uq     on flw_allowances (flw_key);
