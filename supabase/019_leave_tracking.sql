-- Leave/Absence tracking
CREATE TABLE IF NOT EXISTS leave_records (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  member_email text NOT NULL,
  member_name text,
  leave_type text NOT NULL DEFAULT 'Annual',
  start_date date NOT NULL,
  end_date date NOT NULL,
  days integer NOT NULL DEFAULT 1,
  reason text,
  status text NOT NULL DEFAULT 'Pending',
  approved_by text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE leave_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leave_read" ON leave_records FOR SELECT USING (is_admin_or_exec() OR member_email = auth.email());
CREATE POLICY "leave_write" ON leave_records FOR INSERT WITH CHECK (true);
CREATE POLICY "leave_update" ON leave_records FOR UPDATE USING (is_admin_or_exec() OR member_email = auth.email());
CREATE POLICY "leave_delete" ON leave_records FOR DELETE USING (is_admin_or_exec());

CREATE INDEX IF NOT EXISTS idx_leave_dates ON leave_records(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_leave_email ON leave_records(member_email);
