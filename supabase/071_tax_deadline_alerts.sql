-- 071_tax_deadline_alerts.sql
-- Pre-computed two-tier tax deadline alert storage.
-- Apply manually in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS tax_deadline_alerts (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_year            text        NOT NULL,
  alert_type          text        NOT NULL,
  period_key          text        NOT NULL,
  tier                integer     NOT NULL CHECK (tier IN (1, 2)),
  overdue_count       integer     NOT NULL DEFAULT 0,
  alert_message       text        NOT NULL,
  resolved            boolean     NOT NULL DEFAULT false,
  first_triggered_at  timestamptz DEFAULT now(),
  last_checked_at     timestamptz DEFAULT now(),
  resolved_at         timestamptz,
  UNIQUE(tax_year, alert_type, period_key, tier)
);

CREATE INDEX IF NOT EXISTS idx_tax_deadline_alerts_active
  ON tax_deadline_alerts(resolved, tier, tax_year);

ALTER TABLE tax_deadline_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tax_alerts_read"  ON tax_deadline_alerts;
DROP POLICY IF EXISTS "tax_alerts_write" ON tax_deadline_alerts;

CREATE POLICY "tax_alerts_read" ON tax_deadline_alerts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "tax_alerts_write" ON tax_deadline_alerts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
