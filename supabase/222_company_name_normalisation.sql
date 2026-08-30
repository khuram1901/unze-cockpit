-- 222: Phase 3c — normalise legacy company name spellings
-- ─────────────────────────────────────────────────────────────────
-- members.company had FIVE spellings for two companies ("Unze Trading
-- PVT Limited", "Unze Trading Pvt Ltd", "Barahn PVT Limited", "BRNH"…).
-- All text values normalised to the canonical companies.name, and
-- company_id backfilled from the master wherever it was missing.
-- legal_notices.company_name likewise. Code-side, constants.ts now
-- carries the canonical names + a legacy-alias resolver so old data
-- keeps resolving even if any stragglers remain.
-- ─────────────────────────────────────────────────────────────────

-- Normalise members.company text + backfill company_id
update members set
  company = c.name,
  company_id = coalesce(company_id, c.id)
from companies c
where members.company is not null
  and (
    lower(members.company) = lower(c.name)
    or (c.short_code = 'UTPL' and lower(members.company) in ('unze trading pvt limited','unze trading pvt ltd'))
    or (c.short_code = 'IFPL' and lower(members.company) in ('imperial footwear pvt limited','imperial footwear pvt ltd'))
    or (c.short_code = 'BRNH' and lower(members.company) in ('barahn pvt limited','brnh','baranh'))
    or (c.short_code = 'HD'   and lower(members.company) = 'haute dolci')
    or (c.short_code = 'SMI'  and lower(members.company) = 's&m investments')
  );

-- Normalise legal_notices.company_name + backfill company_id
update legal_notices set
  company_name = c.name,
  company_id = coalesce(company_id, c.id)
from companies c
where legal_notices.company_name is not null
  and (
    lower(legal_notices.company_name) = lower(c.name)
    or (c.short_code = 'UTPL' and lower(legal_notices.company_name) in ('unze trading pvt limited','unze trading pvt ltd'))
    or (c.short_code = 'IFPL' and lower(legal_notices.company_name) in ('imperial footwear pvt limited','imperial footwear pvt ltd'))
    or (c.short_code = 'BRNH' and lower(legal_notices.company_name) in ('barahn pvt limited','brnh'))
    or (c.short_code = 'HD'   and lower(legal_notices.company_name) = 'haute dolci')
  );
