-- Sprint C1: Meeting minutes tables
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS meetings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_date date NOT NULL,
  title text NOT NULL,
  executive_summary text,
  decisions jsonb,
  risks jsonb,
  opportunities jsonb,
  attendees jsonb,
  raw_transcript text,
  created_by text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meeting_tasks (
  meeting_id uuid REFERENCES meetings(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (meeting_id, task_id)
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS meeting_id uuid REFERENCES meetings(id);
