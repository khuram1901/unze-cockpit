-- Sprint 6: Calendar V2 schema changes
-- Run this in the Supabase SQL Editor

-- Add is_hod to members
ALTER TABLE members ADD COLUMN IF NOT EXISTS is_hod boolean DEFAULT false;

-- Enhance meeting_requests
ALTER TABLE meeting_requests ADD COLUMN IF NOT EXISTS meeting_type text DEFAULT 'Ad-hoc';
ALTER TABLE meeting_requests ADD COLUMN IF NOT EXISTS attendees text[];
ALTER TABLE meeting_requests ADD COLUMN IF NOT EXISTS decision_required boolean DEFAULT false;
ALTER TABLE meeting_requests ADD COLUMN IF NOT EXISTS approved_by text;
ALTER TABLE meeting_requests ADD COLUMN IF NOT EXISTS calendar_event_id text;
