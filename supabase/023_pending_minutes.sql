-- Pending minutes queue + meeting department/company columns

CREATE TABLE IF NOT EXISTS pending_minutes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  gmail_message_id text NOT NULL UNIQUE,
  subject text,
  from_address text,
  email_date text,
  raw_text text NOT NULL,
  status text DEFAULT 'pending',
  reviewed_by text,
  reviewed_at timestamptz,
  meeting_id uuid REFERENCES meetings(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_minutes_status ON pending_minutes(status);

ALTER TABLE pending_minutes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pending_minutes_all" ON pending_minutes FOR ALL USING (true) WITH CHECK (true);

-- Add department and company to meetings for grouping
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS department text;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS company text;
