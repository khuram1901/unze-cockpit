-- My Minutes: link meetings to HOD attendees
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS meeting_attendees (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  member_email text NOT NULL,
  member_name text,
  viewed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meeting_attendees_email ON meeting_attendees(member_email);
CREATE INDEX IF NOT EXISTS idx_meeting_attendees_meeting ON meeting_attendees(meeting_id);

-- Unique: one link per person per meeting
ALTER TABLE meeting_attendees ADD CONSTRAINT meeting_attendees_unique UNIQUE (meeting_id, member_email);

-- RLS
ALTER TABLE meeting_attendees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendees_read" ON meeting_attendees FOR SELECT USING (
  is_admin_or_exec() OR member_email = auth.email()
);
CREATE POLICY "attendees_write" ON meeting_attendees FOR INSERT WITH CHECK (true);
CREATE POLICY "attendees_update" ON meeting_attendees FOR UPDATE USING (
  is_admin_or_exec() OR member_email = auth.email()
);

-- Add meeting_id to tasks if not exists (for linking tasks back to meetings)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS meeting_id uuid;
