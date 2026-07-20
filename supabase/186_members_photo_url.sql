-- Add photo_url column to members table.
-- Run in Supabase SQL Editor.
ALTER TABLE members ADD COLUMN IF NOT EXISTS photo_url text;
