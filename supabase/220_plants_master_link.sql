-- 220: Phase 3a — plants linked to the locations master
-- ─────────────────────────────────────────────────────────────────
-- Compatibility approach: the plants table stays (production, stock,
-- dispatch, targets, receivables and member assignments all key on
-- plants.id and none of that changes) but every plant now links to its
-- master location via location_id. New plant-type locations — whether
-- auto-created from a FlowHCM station or added in Admin — automatically
-- get a plants row (active=false so it stays out of production dropdowns
-- until Khuram activates it). Every auto-creation is logged.
--
-- Name mapping applied: FIEDMC→FIEDMC, MEPCO→MEPCO, PESCO→PESCO,
-- Smart Meter Plant→Meter Factory. BINC + FESCO get inactive plants rows.
-- ─────────────────────────────────────────────────────────────────

alter table plants add column if not exists location_id uuid references admin_locations(id);

-- Backfill existing plants → master locations
update plants p set location_id = l.id
from admin_locations l
where l.location_type = 'plant' and p.location_id is null
  and (l.name = p.name or (p.name = 'Smart Meter Plant' and l.name = 'Meter Factory'));

-- Inactive plants rows for plant locations that had none (BINC, FESCO)
insert into plants (name, type, active, location_id)
select l.name, 'pole', false, l.id
from admin_locations l
where l.location_type = 'plant'
  and not exists (select 1 from plants p where p.location_id = l.id);

-- Trigger: any future plant-type location gets a plants row automatically
create or replace function create_plant_for_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.location_type = 'plant'
     and not exists (select 1 from plants p where p.location_id = new.id) then
    insert into plants (name, type, active, location_id)
    values (new.name, 'pole', false, new.id);
    insert into flw_lifecycle_events (event_type, detail)
    values ('plant_created',
            'Plants row auto-created (inactive) for new plant location "' || new.name || '" — activate it to enable production entry');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_create_plant_for_location on admin_locations;
create trigger trg_create_plant_for_location
after insert on admin_locations
for each row execute function create_plant_for_location();
