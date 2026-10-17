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

## Expiry alerts (approved 17/10/2026)
- Daily email at 09:00 PKT via `/api/cron/guarantee-alerts` (Vercel cron, `CRON_SECRET`).
- Recipient: Shakeel, whenever anything is overdue or due within 30 days. Silent otherwise.
- Khuram is copied only when the oldest overdue guarantee is **more than 15 days** past due.
- All decisions come from `get_guarantee_alert_digest()` (migration 272); the route only renders and sends.

## Migrations
060–064, 097, 203, **270** (write policies disabled via ALTER POLICY), **271** (SELECT policies follow toggles via `can_view_guarantees_db()`), **272** (alert digest RPC). All applied 17/10/2026, rollback in each file.

## Open items
- `is_finance_manager()` (used by migration 015 policies on other finance tables)
  still checks `department = 'Finance'`, which no longer exists. Cross-page
  decision — not changed here.
- Explicit `false` denies kept for the 4 Unze Trading Ops managers and taxation@unze.co.uk (role default would otherwise grant them); 28 other stale `false` values cleared 17/10/2026.
