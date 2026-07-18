-- Migration 163 — Add default_disco to admin_locations + update RPC
-- Apply in Supabase SQL Editor.

-- 1. Add default_disco column (nullable — sites without a mapping show no auto-fill)
ALTER TABLE admin_locations
  ADD COLUMN IF NOT EXISTS default_disco text;

-- 2. Populate known DISCO mappings
-- IFPL stores (all Lahore → LESCO)
UPDATE admin_locations SET default_disco = 'LESCO' WHERE entity = 'IFPL' AND name = 'DHA';
UPDATE admin_locations SET default_disco = 'LESCO' WHERE entity = 'IFPL' AND name = 'Head Office 62-XX';
UPDATE admin_locations SET default_disco = 'LESCO' WHERE entity = 'IFPL' AND name = 'Head Office 61-XX';
UPDATE admin_locations SET default_disco = 'LESCO' WHERE entity = 'IFPL' AND name = 'Iqbal Town';
UPDATE admin_locations SET default_disco = 'LESCO' WHERE entity = 'IFPL' AND name = 'Packages Mall';

-- Baranh restaurants
UPDATE admin_locations SET default_disco = 'LESCO'  WHERE entity = 'Baranh' AND name = 'Raya';
UPDATE admin_locations SET default_disco = 'LESCO'  WHERE entity = 'Baranh' AND name = 'DHA Y Block';
UPDATE admin_locations SET default_disco = 'LESCO'  WHERE entity = 'Baranh' AND name = 'Packages Mall';
UPDATE admin_locations SET default_disco = 'LESCO'  WHERE entity = 'Baranh' AND name = 'Gulberg';
UPDATE admin_locations SET default_disco = 'FESCO'  WHERE entity = 'Baranh' AND name = 'Jhang';

-- UTPL plants
UPDATE admin_locations SET default_disco = 'LESCO'  WHERE entity = 'UTPL'   AND name = 'Meter Factory';
UPDATE admin_locations SET default_disco = 'MEPCO'  WHERE entity = 'UTPL'   AND name = 'MEPCO';
UPDATE admin_locations SET default_disco = 'PESCO'  WHERE entity = 'UTPL'   AND name = 'PESCO';
UPDATE admin_locations SET default_disco = 'FESCO'  WHERE entity = 'UTPL'   AND name = 'FIEDMC';
UPDATE admin_locations SET default_disco = 'MEPCO'  WHERE entity = 'UTPL'   AND name = 'BINC';

-- 3. Update get_active_locations() to return default_disco
-- Must DROP first because the return type is changing
DROP FUNCTION IF EXISTS get_active_locations();
CREATE OR REPLACE FUNCTION get_active_locations()
RETURNS TABLE (id uuid, name text, entity text, default_disco text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, entity, default_disco
  FROM admin_locations
  WHERE is_active = true
  ORDER BY entity, name;
$$;
