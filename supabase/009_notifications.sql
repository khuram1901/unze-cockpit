-- Phase D: Notification preferences on members
-- Run this in the Supabase SQL Editor

ALTER TABLE members ADD COLUMN IF NOT EXISTS notify_email boolean DEFAULT true;
ALTER TABLE members ADD COLUMN IF NOT EXISTS notify_whatsapp boolean DEFAULT false;
ALTER TABLE members ADD COLUMN IF NOT EXISTS phone_e164 text;

-- Notification log to track what was sent
CREATE TABLE IF NOT EXISTS notification_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_email text NOT NULL,
  recipient_name text,
  channel text NOT NULL,
  subject text,
  body_preview text,
  trigger_type text NOT NULL,
  trigger_record_id text,
  status text DEFAULT 'sent',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON notification_log FOR ALL USING (true) WITH CHECK (true);
