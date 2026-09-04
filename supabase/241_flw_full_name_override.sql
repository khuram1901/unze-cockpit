-- Migration 241: full_name_override for flw_employees
-- When set, the sync can never overwrite the name — survives every FlowHCM refresh.

ALTER TABLE flw_employees ADD COLUMN IF NOT EXISTS full_name_override text;

-- Trigger: enforce override on every INSERT or UPDATE
CREATE OR REPLACE FUNCTION enforce_full_name_override()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NEW.full_name_override IS NOT NULL THEN
    NEW.full_name := trim(NEW.full_name_override);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_full_name_override ON flw_employees;
CREATE TRIGGER trg_enforce_full_name_override
  BEFORE INSERT OR UPDATE ON flw_employees
  FOR EACH ROW EXECUTE FUNCTION enforce_full_name_override();

-- Set correct names for employees whose FlowHCM data is wrong
UPDATE flw_employees SET full_name_override = 'Muhammad Shakeel' WHERE employee_code = '7';
UPDATE flw_employees SET full_name_override = 'Nadeem Khan'      WHERE employee_code = '2';
