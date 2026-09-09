-- KPI alert log — tracks when each cash/production alert was first raised
-- so the notification cron knows when to escalate to the next person.
-- source_label mirrors the same format used in tasks.source_label, e.g.:
--   kpi_escalation:cash_receivables:2026-09:15884c2d-...
--   kpi_escalation:breakage:plant-uuid:2026-09

CREATE TABLE IF NOT EXISTS kpi_alert_log (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_label     text        NOT NULL UNIQUE,
  company_id       uuid        REFERENCES companies(id),
  metric           text        NOT NULL, -- 'cash_receivables' | 'cash_payouts' | 'breakage'
  detail           text        NOT NULL DEFAULT '',
  first_alerted_at timestamptz NOT NULL DEFAULT now(),
  last_alerted_at  timestamptz NOT NULL DEFAULT now(),
  -- 0 = primary only notified; 1 = secondary notified; 2 = tertiary notified
  escalation_level integer     NOT NULL DEFAULT 0,
  resolved         boolean     NOT NULL DEFAULT false,
  resolved_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_kpi_alert_log_source   ON kpi_alert_log(source_label);
CREATE INDEX IF NOT EXISTS idx_kpi_alert_log_active   ON kpi_alert_log(resolved) WHERE NOT resolved;
CREATE INDEX IF NOT EXISTS idx_kpi_alert_log_company  ON kpi_alert_log(company_id);

-- Only the service role can read/write this table.
ALTER TABLE kpi_alert_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_only" ON kpi_alert_log USING (false);
