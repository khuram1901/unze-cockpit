-- Fix RLS on members table to allow all authenticated users to read/write
-- Previously only the original Admin could insert/update via client-side Supabase
-- Run this in the Supabase SQL Editor

-- Drop any existing restrictive policies on members
DO $$
BEGIN
  -- Drop all existing policies on the members table
  FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'members' AND schemaname = 'public')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON members', r.policyname);
  END LOOP;
END $$;

-- Ensure RLS is enabled
ALTER TABLE members ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users full access
CREATE POLICY "Allow all for authenticated" ON members
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Also fix member_plants if it has restrictive policies
DO $$
BEGIN
  FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'member_plants' AND schemaname = 'public')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON member_plants', r.policyname);
  END LOOP;
END $$;

ALTER TABLE member_plants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated" ON member_plants
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
