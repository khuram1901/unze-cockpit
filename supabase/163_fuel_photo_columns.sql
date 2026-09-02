-- Migration 163: add station and finished photo columns to admin_fuel_log
-- Apply in Supabase SQL Editor

ALTER TABLE admin_fuel_log
  ADD COLUMN IF NOT EXISTS station_image_url  TEXT,
  ADD COLUMN IF NOT EXISTS finished_image_url TEXT;
