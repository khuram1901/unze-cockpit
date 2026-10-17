# Bank Facilities (`/finance/guarantees`) — Decisions

Source of truth for this page. Created 17/10/2026 from the page audit + fix session (PR #34).

## Purpose
Track bank guarantees (Bid, Performance, Pay Order, Other) against bank facilities
(Faysal Bank, HBL), with facility utilisation, cash margin, bank charges and
expiry / release chasing. All calculations live in Postgres
(`get_guarantee_summary`, `get_facility_used`, `get_guarantee_alerts`).

## Who has access (approved by Khuram 17/10/2026)
Khuram (CEO), Kamran (CEO), Shakeel, Sania, Abbasi — all with PKR figures.

Access is driven by toggles so it can be changed per person in Members → Access
Control without code changes:

| Toggle | Column / widget | Effect |
|---|---|---|
| Bank Facilities (view) | `member_permissions.can_view_guarantees` | Sidebar card + page + `GET /api/finance/guarantees` + `/guarantee-alerts` |
| Bank Facilities (manage) | `member_permissions.can_manage_guarantees` | Add / edit / convert / release / delete guarantees and facilities |
| Financial Figures | widget `guarantees.financials` | Amounts, cash margin, bank charges, facility limits (stripped server-side when off) |

Role defaults when a toggle is unset (null): Admin / CEO → everything;
Manager or Director in **Finance & Tax** → view + manage + figures;
Manager or Director in **Unze Trading Operations** → view only (chase list, no figures).
PA (Executive role) → never.

A stored `false` is an explicit deny and beats the role default (this is how the
Ops managers are currently kept out).

## Rules
- Server and client must agree: `app/lib/guarantee-access.ts` (API) mirrors
  `canViewGuarantees` / `canManageGuarantees` / `canViewGuaranteeFinancials` in
  `app/lib/permissions.ts`. Change both together.
- Nobody sees figures without view access.
- The app only writes `guarantees` / `guarantee_facilities` through the API
  (service role). Direct authenticated writes are disabled (migration 270).
- Facility limits are enforced on every insert / amount change / conversion (422).
- Facilities with guarantees cannot be deleted (FK `on delete restrict`).

## Migrations
060–064, 097, 203, **270** (write policies disabled via ALTER POLICY, rollback in file).

## Open items
- `is_finance_manager()` (used by migration 015 policies on other finance tables)
  still checks `department = 'Finance'`, which no longer exists. Cross-page
  decision — not changed here.
- 21 members hold an explicit `false` for `can_view_guarantees` from an old
  Access Matrix save; left as-is (equivalent to the approved access list).
- Expiry alerts by email / WhatsApp (alerts RPC already exists) — later.
