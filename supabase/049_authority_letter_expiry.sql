-- Migration 049: Add expiry_date to authority_letters
-- Applied manually via Supabase SQL Editor

alter table authority_letters
  add column if not exists expiry_date date;
