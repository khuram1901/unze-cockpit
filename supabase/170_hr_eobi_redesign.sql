-- 170_hr_eobi_redesign.sql
-- EOBI & Social Security — HR integration with existing admin tables.
-- Removes the duplicate hr_eobi_* tables from migration 169, then alters
-- admin_eobi_payments to support "pending" challans (created by HR before
-- admin deposits the money).
-- Apply via Supabase SQL Editor.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Drop the unused HR-only EOBI tables from migration 169
-- ──────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS hr_essi_payments CASCADE;
DROP TABLE IF EXISTS hr_eobi_payments CASCADE;
DROP TABLE IF EXISTS hr_eobi_registrations CASCADE;
DROP FUNCTION IF EXISTS get_eobi_dashboard();

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Alter admin_eobi_payments to support pending challans
--
--    Before: date_paid NOT NULL, is_late generated from date_paid,
--            no enrolled_count, no challan status
--    After:  date_paid nullable (NULL = challan raised, not yet deposited),
--            is_late handles NULL, enrolled_count added, status derived
-- ──────────────────────────────────────────────────────────────────────────

-- 2a. Make date_paid nullable so HR can raise a challan before deposit
ALTER TABLE admin_eobi_payments ALTER COLUMN date_paid DROP NOT NULL;

-- 2b. Recreate is_late to handle NULL date_paid gracefully
ALTER TABLE admin_eobi_payments DROP COLUMN IF EXISTS is_late;
ALTER TABLE admin_eobi_payments ADD COLUMN is_late boolean
  GENERATED ALWAYS AS (
    date_paid IS NOT NULL AND EXTRACT(DAY FROM date_paid) > 15
  ) STORED;

-- 2c. Add enrolled_count (number of employees enrolled; HR fills this in)
ALTER TABLE admin_eobi_payments
  ADD COLUMN IF NOT EXISTS enrolled_count integer;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. RPC: get_hr_eobi_summary — KPI cards + pending challan list in one hit
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_hr_eobi_summary()
RETURNS TABLE (
  -- KPI scalars
  pending_challans        bigint,
  overdue_challans        bigint,
  paid_this_month         bigint,
  total_pending_pkr       numeric,
  -- Registration counts
  eobi_registered         bigint,
  eobi_pending            bigint,
  ss_registered           bigint,
  ss_pending              bigint,
  -- Pending challan rows (JSON array)
  pending_list            jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH pending AS (
    SELECT id, entity, payment_type, month, amount_pkr, enrolled_count, notes, created_by, created_at
    FROM admin_eobi_payments
    WHERE date_paid IS NULL
    ORDER BY month ASC, entity ASC
  ),
  regs AS (
    SELECT
      COUNT(*) FILTER (WHERE registration_type = 'EOBI'            AND status = 'Registered') AS eobi_registered,
      COUNT(*) FILTER (WHERE registration_type = 'EOBI'            AND status != 'Registered') AS eobi_pending,
      COUNT(*) FILTER (WHERE registration_type = 'Social Security' AND status = 'Registered') AS ss_registered,
      COUNT(*) FILTER (WHERE registration_type = 'Social Security' AND status != 'Registered') AS ss_pending
    FROM admin_registrations
  )
  SELECT
    (SELECT COUNT(*)          FROM pending)                                         AS pending_challans,
    (SELECT COUNT(*)          FROM admin_eobi_payments
       WHERE date_paid IS NULL
         AND month < date_trunc('month', CURRENT_DATE))                             AS overdue_challans,
    (SELECT COUNT(*)          FROM admin_eobi_payments
       WHERE date_trunc('month', date_paid) = date_trunc('month', CURRENT_DATE))   AS paid_this_month,
    (SELECT COALESCE(SUM(amount_pkr), 0) FROM pending)                             AS total_pending_pkr,
    r.eobi_registered,
    r.eobi_pending,
    r.ss_registered,
    r.ss_pending,
    (SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',             p.id,
        'entity',         p.entity,
        'payment_type',   p.payment_type,
        'month',          p.month,
        'amount_pkr',     p.amount_pkr,
        'enrolled_count', p.enrolled_count,
        'notes',          p.notes,
        'created_by',     p.created_by,
        'created_at',     p.created_at,
        'is_overdue',     p.month < date_trunc('month', CURRENT_DATE)
      ) ORDER BY p.month ASC, p.entity ASC
    ), '[]'::jsonb) FROM pending p)                                                 AS pending_list
  FROM regs r;
$$;

REVOKE ALL ON FUNCTION get_hr_eobi_summary() FROM anon;
GRANT EXECUTE ON FUNCTION get_hr_eobi_summary() TO authenticated;
