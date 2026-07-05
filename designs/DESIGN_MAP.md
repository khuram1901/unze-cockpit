# Unze Dashboard — Genspark Design Map

Maps every Genspark design file to its corresponding code file.
Use this as the reference for all future restyling sessions.

| Design File | Code File | Notes |
|-------------|-----------|-------|
| `Design System.html` | `app/lib/SharedUI.tsx` | Foundation only — colours, type scale, card spec, spacing |
| `Executive Dashboard.html` | `app/executive/page.tsx` | |
| `Operations Dashboard.html` | `app/dashboard/page.tsx` | |
| `Daily Entry.html` | `app/production/page.tsx` | |
| `Tasks.html` | `app/tasks/page.tsx` | |
| `Calendar.html` | `app/calendar/page.tsx` | |
| `Meetings.html` | `app/meetings/page.tsx` | |
| `My Minutes.html` | `app/my-minutes/page.tsx` | |
| `Recurring Tasks.html` | `app/recurring-tasks/page.tsx` | |
| `Members.html` | `app/members/page.tsx` and `MembersManager.tsx` | |
| `My Profile.html` | `app/profile/page.tsx` | |
| `Opening Balances.html` | `app/opening-balances/page.tsx` | |
| `Stock.html` | `app/stock/page.tsx` | |
| `Manage POs.html` | `app/stock/manage/page.tsx` | |
| `Receivables.html` | `app/receivables/page.tsx` | |
| `Investments.html` | `app/investments/page.tsx` | |
| `Admin.html` | `app/department/[slug]/AdminDashboard.tsx` | |
| `Audit.html` | `app/department/[slug]/AuditDashboard.tsx` | |
| `HR.html` | `app/department/[slug]/HRDashboard.tsx` | |
| `Taxation.html` | `app/department/[slug]/TaxationDashboard.tsx` | |
| `IT.html` | `app/department/[slug]/ITDashboard.tsx` | **Does not exist yet** — create following same pattern as other dashboard components |
| `Bank Facilities.html` | `app/finance/guarantees/page.tsx` | |
| `Imperial Footwear.html` | Section within `app/finance/page.tsx` | Confirm exact scope at restyling time |
