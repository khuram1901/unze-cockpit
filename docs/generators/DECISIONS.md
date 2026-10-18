# Generators — Architecture & Decisions

_Last updated: 2026-10-18_

## Scope

Diesel refuelling and maintenance logging for the Unze Group's generator fleet,
accessible from `/daily-entry` (entry users) and Admin Operations → Generators tab
(admin/CEO users).

---

## Database

### Tables

| Table | Purpose |
|---|---|
| `generators` | Master list of generators linked to `admin_locations` |
| `generator_fuel_log` | Per-refuel records; generated columns for hours_run, litres_per_hour, cost_per_hour |
| `generator_maintenance_log` | Per-service records; generated column for total_cost |
| `generator_thresholds` | Admin-editable alert thresholds (unusual_pct, service_hours, days_amber, days_red) |

### Generated columns (all calculations in Supabase, never JS)

- `generator_fuel_log.hours_run` = `present_hours - previous_hours`
- `generator_fuel_log.litres_per_hour` = `qty_litres / hours_run`
- `generator_fuel_log.cost_per_hour` = `total_cost / hours_run`
- `generator_fuel_log.total_cost` = `rate_per_litre * qty_litres`
- `generator_maintenance_log.total_cost` = sum of all 8 cost columns

### Migrations (numbered)

| # | File | Description |
|---|---|---|
| 276 | `276_generators_schema.sql` | Tables, generated columns, RLS policies |
| 277 | `277_generators_rpcs.sql` | All RPCs: insert, fetch, update, soft-delete, summary, thresholds |
| 278 | `278_generators_import.sql` | Historical diesel data import (23 generators, Diesel Format rows) |
| 279 | _(skipped)_ | — |
| 280 | `280_generator_analytics.sql` | Analytics RPC for per-location infographics |
| 281 | `281_generator_entry_widget_grants.sql` | Widget grants for 5 named users |
| 282 | `282_fix_generator_entry_user_rpc.sql` | Fix `is_generator_entry_user()` to check widget overrides |

---

## Access Control

### Decision: two-tier access

**Rationale:** Entry users (drivers, admin officers) should be able to log fuel
without seeing admin dashboards. Widget overrides provide fine-grained grant
without touching `auth.users`.

| Who | Access |
|---|---|
| `khuram1901@gmail.com` (main admin) | Always allowed (`isMainAdmin` in `permissions.ts`) |
| Role = CEO or Admin in `members` | Always allowed (`isAdminTier`) |
| Role = Manager/Member AND dept = Admin | Allowed by role check in `is_generator_entry_user()` |
| Anyone with `admin_ops.generators_entry = true` in `member_widget_overrides` | Allowed (widget override path added in migration 282) |
| Everyone else | Blocked at RPC level with `RAISE EXCEPTION 'Access denied'` |

### Widget keys

- `admin_ops.generators` — Admin Operations → Generators tab
- `admin_ops.generators_entry` — `/daily-entry` generator forms (off by default)

Both appear in `WIDGET_REGISTRY` and render as toggles in the Member Access Matrix.

---

## Generator Data

### Seeded generators (23 rows from Excel)

Linked to `admin_locations` by name match (case-insensitive, trimmed).

**Unmatched locations** (no `admin_locations` row; imported with `location_id = NULL`):
- Family Residence Lahore
- Family Residence Islamabad
- Baranh Y-Block
- Baranh DHA Raya
- Warehouse Gajumatta

→ **Decision:** Imported with `location_id = NULL` pending approval to add these
locations to `admin_locations`. Do not create `admin_locations` rows without owner approval.

### Name corrections applied during import

| Excel spelling | Corrected to |
|---|---|
| Jhondeer | John Deere |
| Kharrian | Kharian |

---

## UI Decisions

### /daily-entry — form shape

**Decision:** Generator fuel and maintenance forms are added as separate form buttons
(`"gen_fuel"` and `"gen_maintenance"`) rather than as a Vehicles/Generators switch
inside the existing buttons. This was pragmatic given the existing FORMS array pattern;
a switch-inside-button redesign would require restructuring the form list significantly.

→ **Outstanding:** Spec originally called for `Vehicles | Generators` toggle inside
the Fuel and Maintenance buttons. Revisit if UX feedback calls for it.

### Previous hours auto-lock

Once a generator has refuel history, `previous_hours` is auto-filled from the last
refuel's `present_hours` and locked (read-only). Only the very first entry allows
manual entry of `previous_hours`. This prevents meter drift.

### Seed rows

Historical import rows are tagged `is_seed = true` and excluded from the "last refuel"
context hint displayed on the form. Only real entries update the hint.

---

## Admin Operations tab

- Positioned **before** Visitors in the tab list.
- Sub-tabs: Diesel | Maintenance | Master | Analytics
- All table data fetched via RPCs (never raw table reads from the client).
- Soft delete: rows marked `deleted_at` / `deleted_by` / `delete_reason`; not shown by default.
- Edit with audit trail: `updated_at` and `updated_by` columns.

---

## Open Items

- [ ] Create `admin_locations` rows for 5 unmatched locations (needs owner approval)
- [ ] Run full test-user workflow (CEO, manager toggle on/off, member blocked)
- [ ] Record production rollback ID after first push to main
- [ ] Take screenshots: `/daily-entry` fuel+maintenance on 360px phone, Admin Generators tab
- [ ] Clean up test data after smoke test
