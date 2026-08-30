-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 211: FlowHCM extended endpoints — new tables
-- Apply via: Supabase SQL Editor → paste and Run
-- ─────────────────────────────────────────────────────────────────────────────
-- Creates tables for the 10 new FlowHCM API endpoints added in flowhcm-client.ts:
--   GetEmployeeList, GetEmployeeTransfer, GetAttendanceExemptionAPI,
--   GetEmployeeLeaving, GetEmployeeAdvanceSalary, GetAllowanceRequestData,
--   GetEmployeeDeductionData, GetEmployeePFData, GetEmployeeLoan,
--   GetEmployeeOvertimeRequest, GetEmployeeSalarySetup, GetTaxAdjustmentRequest
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Employee transfers ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flw_transfers (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_code       text,
  employee_name       text,
  from_department     text,
  to_department       text,
  from_company        text,
  to_company          text,
  transfer_date       date,
  effective_date      date,
  transfer_type       text,
  reason              text,
  status              text,
  raw                 jsonb NOT NULL DEFAULT '{}',
  synced_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS flw_transfers_uq
  ON flw_transfers (employee_code, transfer_date, to_department)
  WHERE employee_code IS NOT NULL AND transfer_date IS NOT NULL;

-- ── 2. Attendance exemptions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flw_exemptions (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_code       text,
  employee_name       text,
  exemption_date      date,
  exemption_type      text,
  reason              text,
  status              text,
  approved_by         text,
  raw                 jsonb NOT NULL DEFAULT '{}',
  synced_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS flw_exemptions_uq
  ON flw_exemptions (employee_code, exemption_date, exemption_type)
  WHERE employee_code IS NOT NULL AND exemption_date IS NOT NULL;

-- ── 3. Employee exits / leavers ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flw_employee_exits (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_code       text UNIQUE,
  employee_name       text,
  department          text,
  designation         text,
  joining_date        date,
  leaving_date        date,
  exit_type           text,   -- Resignation | Termination | Retirement | etc.
  reason              text,
  notice_period_days  integer,
  clearance_status    text,
  raw                 jsonb NOT NULL DEFAULT '{}',
  synced_at           timestamptz NOT NULL DEFAULT now()
);

-- ── 4. Salary advances ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flw_advance_salary (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_code       text,
  employee_name       text,
  request_date        date,
  amount              numeric(14, 2),
  approved_amount     numeric(14, 2),
  repayment_months    integer,
  status              text,
  approved_by         text,
  remarks             text,
  raw                 jsonb NOT NULL DEFAULT '{}',
  synced_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS flw_advance_salary_uq
  ON flw_advance_salary (employee_code, request_date, amount)
  WHERE employee_code IS NOT NULL AND request_date IS NOT NULL;

-- ── 5. Allowances ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flw_allowances (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_code       text,
  employee_name       text,
  year                integer,
  month               integer,
  allowance_type      text,
  amount              numeric(14, 2),
  status              text,
  raw                 jsonb NOT NULL DEFAULT '{}',
  synced_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS flw_allowances_uq
  ON flw_allowances (employee_code, year, month, allowance_type)
  WHERE employee_code IS NOT NULL;

-- ── 6. Deductions ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flw_deductions (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_code       text,
  employee_name       text,
  year                integer,
  month               integer,
  deduction_type      text,
  amount              numeric(14, 2),
  status              text,
  raw                 jsonb NOT NULL DEFAULT '{}',
  synced_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS flw_deductions_uq
  ON flw_deductions (employee_code, year, month, deduction_type)
  WHERE employee_code IS NOT NULL;

-- ── 7. Provident / pension fund ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flw_pf_data (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_code       text,
  employee_name       text,
  pf_type             text,
  employee_contribution numeric(14, 2),
  employer_contribution numeric(14, 2),
  effective_date      date,
  status              text,
  raw                 jsonb NOT NULL DEFAULT '{}',
  synced_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS flw_pf_data_uq
  ON flw_pf_data (employee_code, pf_type, effective_date)
  WHERE employee_code IS NOT NULL;

-- ── 8. Overtime ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flw_overtime (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_code       text,
  employee_name       text,
  overtime_date       date,
  hours               numeric(6, 2),
  rate_multiplier     numeric(4, 2),
  amount              numeric(14, 2),
  status              text,
  approved_by         text,
  raw                 jsonb NOT NULL DEFAULT '{}',
  synced_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS flw_overtime_uq
  ON flw_overtime (employee_code, overtime_date)
  WHERE employee_code IS NOT NULL AND overtime_date IS NOT NULL;

-- ── 9. Salary setup / grade structure ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flw_salary_setup (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_code       text UNIQUE,
  employee_name       text,
  grade               text,
  basic_salary        numeric(14, 2),
  gross_salary        numeric(14, 2),
  currency            text DEFAULT 'PKR',
  effective_date      date,
  raw                 jsonb NOT NULL DEFAULT '{}',
  synced_at           timestamptz NOT NULL DEFAULT now()
);

-- ── 10. Tax adjustments ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flw_tax_adjustments (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_code       text,
  employee_name       text,
  tax_year            integer,
  adjustment_type     text,
  amount              numeric(14, 2),
  reason              text,
  status              text,
  raw                 jsonb NOT NULL DEFAULT '{}',
  synced_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS flw_tax_adjustments_uq
  ON flw_tax_adjustments (employee_code, tax_year, adjustment_type)
  WHERE employee_code IS NOT NULL;

-- ── RLS: authenticated users can read, service role writes ────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'flw_transfers','flw_exemptions','flw_employee_exits',
    'flw_advance_salary','flw_allowances','flw_deductions',
    'flw_pf_data','flw_overtime','flw_salary_setup','flw_tax_adjustments'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY IF NOT EXISTS "authenticated_read_%s" ON %I FOR SELECT TO authenticated USING (true)',
      t, t
    );
  END LOOP;
END $$;
