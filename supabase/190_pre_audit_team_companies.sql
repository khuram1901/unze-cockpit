-- Migration 190: Link Pre-audit team to all four audit companies
--
-- The "Pre-audit team" (Attia, Abdul Rehman, Fraz) had no rows in
-- audit_team_companies, so audit_my_tasks() returned zero projects for
-- them and the left column on their Tasks page was blank.
--
-- Pre-audit covers all four active audit companies before the dedicated
-- post-audit teams take over the formal review. Link them to all four.

insert into audit_team_companies (team_id, company_id)
select
  (select id from audit_teams where name = 'Pre-audit team') as team_id,
  c.id
from companies c
where c.short_code in ('UTPL', 'IFPL', 'HD', 'BRNH')
on conflict do nothing;
