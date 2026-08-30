-- 223: Drop empty HR tables from deleted tabs (Khuram approved 30/08/2026)
-- All 8 tables: 0 rows, 0 code references. Payroll/onboarding/offboarding
-- data now comes from FlowHCM. recruitment_* kept (flowhcm sync writes
-- them); performance_evaluations + hr_strategy_goals kept pending
-- orphaned-route cleanup.
drop table if exists hr_payroll_exceptions;
drop table if exists hr_payroll_employees;
drop table if exists hr_payroll_runs;
drop table if exists hr_onboarding_completions;
drop table if exists hr_onboarding_quiz_questions;
drop table if exists hr_onboarding_sections;
drop table if exists hr_onboarding_modules;
drop table if exists hr_offboarding_exits;
