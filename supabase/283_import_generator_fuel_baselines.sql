-- Migration 283: Import historical generator fuel baselines
-- Source: Present_Hours_Detail_Genset_Diesel_Refill.xlsx
-- Purpose: Seed opening baseline readings for all 23 generators
--          previous_hours = 0 (these are the opening baselines)
--          hours_run = present_hours - previous_hours (computed column in DB)
--          entered_by = 'imported'
--
-- Applied manually via Supabase SQL Editor
--
-- ROLLBACK:
--   DELETE FROM generator_fuel_log WHERE entered_by = 'imported';

INSERT INTO generator_fuel_log
  (generator_id, refuel_date, previous_hours, present_hours, qty_litres, rate_per_litre, total_cost, remarks, entered_by)
VALUES

-- 482XX - Kamran | 30KVA YD-China
('fd9bbf68-bda5-403d-abb4-693bada6dd92', '2026-09-07', 0, 20, 200, 376, 75200, NULL, 'imported'),

-- W210 - Khuram | 30KVA YD-China  (spreadsheet: "Khurram Saleem Home")
('5d8b0c53-aa99-45a3-9d72-eef22df7a0e3', '2026-09-09', 0, 40, 400, 389, 155600, NULL, 'imported'),

-- Head Office 62-XX | 100KVA Cummins (Gen-62)
('c38ae2ae-5326-4e9c-aaa9-387ba84c363e', '2026-09-02', 0, 25, 250, 369, 92250, NULL, 'imported'),

-- Head Office 62-XX | 50KVA Perkins (Gen-61)
('e176fb85-3dd0-490d-943a-1f7af6047dda', '2026-09-02', 0, 20, 250, 369, 92250, NULL, 'imported'),

-- Head Office 62-XX | 80KVA Perkins in spreadsheet → mapped to Gen-61 50KVA Perkins (confirmed by owner)
-- NOTE: spreadsheet said 80KVA but DB has 50KVA — owner confirmed 50KVA is correct
-- This entry maps to the same Gen-61 on a different date
('e176fb85-3dd0-490d-943a-1f7af6047dda', '2026-09-07', 0, 30, 355, 371, 131705, NULL, 'imported'),

-- Warehouse Gajumatta | 13KVA Perkins
('8e77216a-0551-44a2-94da-ab1bd5ecfe84', '2026-09-04', 0, 18, 150, 372, 55800, NULL, 'imported'),

-- DHA Y Block | 50KVA Perkins
('a11e7d49-6a80-4c2c-8e03-f1a76d74ff83', '2026-09-02', 0, 20, 300, 369, 110700, NULL, 'imported'),

-- Iqbal Town | 30KVA YD-China
('5745af82-af1a-4529-b15f-e4e9e01e4329', '2026-07-07', 0, 20, 250, 369, 92250, NULL, 'imported'),

-- LDS Jhang | 100KVA Perkins
('93138ddc-1fb3-4a8a-a112-01a500dd5de3', '2026-07-18', 0, 20, 1500, 357, 535500, NULL, 'imported'),

-- Peshawar | 30KVA John Deere  (spreadsheet: "Jhondeer")
('36af1fe0-d5e3-4c0f-92f7-deb1662a3dd4', '2026-10-10', 0, 84, 250, 401, 100250, NULL, 'imported'),

-- Gujranwala | 30KVA Perkins
('45915730-6ec8-425b-ab45-8ba12316116e', '2026-09-15', 0, 20, 300, 407, 122100, NULL, 'imported'),

-- Liberty Store | 30KVA YD-China
('31e1b9d5-7c74-4872-a69a-74b98089e23b', '2026-09-01', 0, 40, 305, 369, 112545, NULL, 'imported'),

-- Tariq Road | 50KVA John Deere  (spreadsheet: "Jhondeer")
('7ecbdb17-b940-41c3-9c45-9234f7bb73db', '2026-09-06', 0, 20, 372, 375, 139500, NULL, 'imported'),

-- Sahiwal | 30KVA Perkins
('7a39e84f-859e-42fa-98ff-54c07eafdffc', '2026-09-17', 0, 20, 150, 417, 62550, NULL, 'imported'),

-- V Mall Sialkot | 30KVA Perkins
('31cf16bc-4b11-41db-a6ad-43a1e8b78840', '2026-08-11', 0, 20, 350, 378, 132300, NULL, 'imported'),

-- Hurrianwala | 30KVA John Deere  (spreadsheet: "Jhondeer")
('81c80cad-901c-47d3-b043-319e57b8ecba', '2026-10-09', 0, 20, 350, 400, 140000, NULL, 'imported'),

-- Mardan | 20KVA John Deere  (spreadsheet: "Jhondeer")
('069ce622-316a-472a-a891-f6a85aff575c', '2026-09-03', 0, 20, 300, 371, 111300, NULL, 'imported'),

-- Swat | 30KVA Perkins
('88e4d9f8-9852-4f4f-bb7c-3384a1d80a47', '2026-08-24', 0, 20, 400, 368, 147200, NULL, 'imported'),

-- Kharian | 30KVA Perkins  (spreadsheet: "Kharrian")
('594eef42-44b3-44d5-ab1c-73bf7ef2c6d8', '2026-09-21', 0, 20, 300, 421, 126300, NULL, 'imported'),

-- Faisalabad KN | 30KVA John Deere  (spreadsheet: "Jhondeer")
('2a23c80b-08c7-4032-8e4e-4d996bdace7e', '2026-09-12', 0, 20, 268, 401, 107468, NULL, 'imported'),

-- Sukkur | 30KVA John Deere  (spreadsheet: "Jhondeer")
('20dcb50a-33a4-4602-8876-7069b792ac81', '2026-09-03', 0, 21, 150, 371, 55650, NULL, 'imported'),

-- Baranh Y-Block | 100KVA John Deere  (spreadsheet: "Jhondeer")
('f32a5cde-12c3-4a8e-9938-d17e805f8612', '2026-10-06', 0, 335, 700, 403, 282100, NULL, 'imported'),

-- Baranh Raya | 200KVA Cummins  (spreadsheet: "Baranh DHA Raya")
('08cf9bcc-6cb1-487a-9f66-2ca7532aed9e', '2026-10-10', 0, 31, 500, 400, 200000, NULL, 'imported');

-- Verify
SELECT
  al.name        AS location,
  g.kva,
  g.model,
  fl.refuel_date,
  fl.previous_hours,
  fl.present_hours,
  fl.qty_litres,
  fl.rate_per_litre,
  fl.total_cost
FROM generator_fuel_log fl
JOIN generators g       ON g.id  = fl.generator_id
JOIN admin_locations al ON al.id = g.location_id
WHERE fl.entered_by = 'imported'
ORDER BY al.name, fl.refuel_date;
