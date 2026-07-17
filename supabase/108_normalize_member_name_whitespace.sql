-- 108_normalize_member_name_whitespace.sql
--
-- Khuram spotted "Muhammad Shakeel" listed twice in the Tasks Owner
-- filter, even though there's only one such person in `members`.
--
-- Root cause: 10 member rows were imported with a stray trailing space on
-- first_name and/or last_name (e.g. first_name = "Muhammad ", last_name =
-- "Shakeel "), so their `name` column ended up with a double space
-- ("Muhammad  Shakeel"). A browser collapses that double space when
-- rendering text, so it looks completely normal on screen — but a few
-- tasks were separately entered with a clean single space
-- ("Muhammad Shakeel"). Anywhere the app deduplicates or groups by the
-- raw assigned_to string (the Owner filter dropdown, the Tasks Tree
-- view's per-person grouping, and the get_tasks_team_stats() RPC's
-- GROUP BY), these two spellings count as different people even though
-- they render identically — hence "the same person twice".
--
-- This fixes it at the source: collapse any run of whitespace to a
-- single space and trim, everywhere a member's name is stored or copied.
-- The 6 affected people (2 of whom already show visibly split today —
-- Muhammad Shakeel and Muhammad Akhlaq; the other 8 rows below are
-- either not yet duplicated in tasks or have no matching tasks yet, but
-- are fixed pre-emptively): Asif Shakoor, Usman Arshad, Muhammad Nadeem,
-- Awais Zaman, Muhammad Shakeel, Sania Saleem, Shahid Masaud, Muhammad
-- Akhlaq, Shahida Naseem, Zuhair Khalid.

-- 1. Fix the source of truth.
update public.members
set
  first_name = regexp_replace(trim(first_name), '\s+', ' ', 'g'),
  last_name  = regexp_replace(trim(last_name),  '\s+', ' ', 'g'),
  name       = regexp_replace(trim(name), '\s+', ' ', 'g')
where first_name != regexp_replace(trim(first_name), '\s+', ' ', 'g')
   or last_name  != regexp_replace(trim(last_name),  '\s+', ' ', 'g')
   or name       != regexp_replace(trim(name), '\s+', ' ', 'g');

-- 2. Normalize every task's copy of the assignee/assigner name so rows
--    that already differ only by whitespace merge back into one person
--    everywhere the app groups by this string (Owner filter, Tree view,
--    Team RPC).
update public.tasks
set assigned_to = regexp_replace(trim(assigned_to), '\s+', ' ', 'g')
where assigned_to is not null
  and assigned_to != regexp_replace(trim(assigned_to), '\s+', ' ', 'g');

update public.tasks
set assigned_by = regexp_replace(trim(assigned_by), '\s+', ' ', 'g')
where assigned_by is not null
  and assigned_by != regexp_replace(trim(assigned_by), '\s+', ' ', 'g');

-- 3. Same fix for recurring task templates.
update public.recurring_tasks
set assigned_to = regexp_replace(trim(assigned_to), '\s+', ' ', 'g')
where assigned_to is not null
  and assigned_to != regexp_replace(trim(assigned_to), '\s+', ' ', 'g');

-- 4. Same fix for department owner display names (cosmetic only — these
--    columns are just shown next to the department, not deduplicated
--    anywhere — but worth cleaning up while we're here).
update public.department_owners
set
  primary_owner_name    = regexp_replace(trim(primary_owner_name), '\s+', ' ', 'g'),
  secondary_owner_name  = regexp_replace(trim(secondary_owner_name), '\s+', ' ', 'g'),
  escalation_owner_name = regexp_replace(trim(escalation_owner_name), '\s+', ' ', 'g')
where primary_owner_name    != regexp_replace(trim(primary_owner_name), '\s+', ' ', 'g')
   or secondary_owner_name  != regexp_replace(trim(secondary_owner_name), '\s+', ' ', 'g')
   or escalation_owner_name != regexp_replace(trim(escalation_owner_name), '\s+', ' ', 'g');
