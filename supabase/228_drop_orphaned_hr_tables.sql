-- Phase 4: drop the last two orphaned HR tables. Both empty (0 rows) and
-- unreferenced after the 30/08/2026 HR rebuild deleted their tabs and this
-- cleanup deleted their API routes. Confirmed by Khuram 30/08/2026.
-- recruitment_* tables are KEPT — the FlowHCM sync still writes them.
-- Applied via Supabase MCP 30/08/2026.
drop table if exists public.performance_evaluations;
drop table if exists public.hr_strategy_goals;
