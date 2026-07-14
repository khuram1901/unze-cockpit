# Changelog — Unze Group Dashboard

Most recent entry at the top. **Append-only — never delete or edit old entries.**

---

## 2026-07-14 — Tasks: universal edit/select on KPI cards, sticky bulk toolbar, and a real HOD-only completion rule

Khuram: "when i click cards in tasks, like open overdue, due tday it expands list but i cannot edit the tasks, this should be universal. multiple select this should also be universal... that tool bar needs to be visible whether scrolling down or being static." Three fixes in TasksList.tsx: the Open/Overdue/Due Today/etc. KPI-card drawer had its own bespoke, non-selectable row markup instead of the shared `TaskRow` component every other view uses — replaced it with `TaskRow` (now also used in Tree view) so opening a task from a KPI card behaves identically to opening one from List, with the same checkbox for multi-select. The bulk-selection toolbar moved out of the List-view-only block into the sticky view-toggle wrapper at the top of the page, so it now appears above every view (not just List) and never scrolls out of sight while a selection is active.

The bigger piece: "no task can be completed until its submitted to their HOD and only HOD can mark the task completed... This is very important." Two things were quietly bypassing this before: the free status dropdown let anyone jump straight to Completed from any state, and a "Mark task complete" button (gated only on subtasks, not on who was clicking it) sat right next to it. Both removed. The only door to Completed now is the existing "Accept & Close" button, shown only once a task is Submitted, and only to whoever is allowed to close it.

Khuram's exact rule, clarified mid-session: "Myself and Kamran are at the top of the food chain — all people reporting to us, we are the only ones to complete their task, or we will allow our Executive to check and complete the task status. Executive's tasks can be completed by themselves. rest of the members submit their tasks, only their HOD completes the tasks." Added `canCompleteSubmittedTask()` to permissions.ts as the one place this lives: the task's current owner may close it (submitting already reassigns a task to the assignee's manager via the existing `routeSubmittedTask`, so the current owner post-submission is genuinely their HOD); additionally the Executive (Sundas) may close anything that landed with Khuram or Kamran specifically (a new `TOP_TIER_EMAILS` list — separate from the role-based `isAdminTier`, since this needs to name the two specific people, not "whoever holds Admin"). `routeSubmittedTask` also now skips reassignment when the assignee is the Executive, so her own tasks close under her own sign-off instead of routing further up.

Closed the same gap in two other places that could set status directly and would otherwise have bypassed the whole rule: the bulk "Change status…" dropdown (TasksList.tsx) no longer offers Completed at all (it's a raw ungated update with no per-task check), and the Kanban board's drag-to-Completed column now runs the same `canCompleteSubmittedTask` check plus a Submitted-only guard before allowing the drop, instead of writing the status unconditionally.

Note: all of this is enforced client-side, consistent with how the rest of the app's permission model works (no DB-level trigger/RLS for who's allowed to complete a task, unlike the existing subtask-completion gate which is enforced in the database). Worth knowing if this ever needs to be airtight against someone hitting the API directly rather than going through the UI.

---

## 2026-07-14 — Recurring-task cron migrated onto the shared createTaskCore gate

Last of the 7 original task-insert call sites from TASK_NOTIFICATION_AUDIT.md. `app/api/tasks/recurring/route.ts` used to insert into `tasks` directly; now it calls `createTaskCore()` in-process (no HTTP round-trip — this cron has no user session to authenticate an `/api/tasks/create` call with, unlike the cash-escalation path which goes through the browser).

Caught before shipping: `createTaskCore` hard-requires a company on every task, and all 8 active recurring templates (Sundas's PA payment follow-ups — Fee Challan, Bilal Engineer, Pak Qatar, Shapes, Stock Sheet, Transworld Bill, Umer Ahmad Shah Hostel Fee, Follow Up - Bilal) had `company_id = null`. Flipping the switch without fixing this would have silently stopped all 8 from firing. Asked Khuram — tagged all 8 to the existing "Directors" company (personal/CEO-level items, not tied to UTPL/IFPL). The cron also now skips (and reports back, rather than crashing) any future template missing a company or an assignee, instead of failing the whole run.

---

## 2026-07-14 — "Unze Group" as an explicit company, replacing the blank-company convention

Khuram, after the Kamran group-level fix: "instead of keeping them blank why don't we create Unze Group, which we can allocate everyone into... will this be better?" Yes — leaving Company blank to mean "sees the whole group" only worked because it happened to be undocumented behaviour; anyone editing a member later couldn't tell blank-on-purpose from blank-because-nobody-filled-it-in.

Added "Unze Group" as a real option in the Members Company picker (`MEMBER_COMPANIES` in MembersManager.tsx). Moved the 9 people who had `company = null` (Khuram — both accounts, Kamran, Akhlaq, Nadeem, Awais Zaman, Shakeel, Shahid Masaud, Sundas Hussain) onto it via a direct data update — same one-row-fix pattern used all session, no schema change since `company` was already free text.

Tightened `financeCompanies()` in permissions.ts and the mirrored preview logic in AccessMatrix.tsx to explicitly check `company === "Unze Group"` rather than relying on the fact that any non-UTPL/non-Imperial string fell through to "both" anyway. Scope: Members only, per Khuram's choice — the separate `companies` table used for tagging Tasks (UTPL/IFPL/etc.) is untouched.

---

## 2026-07-14 — Task detail: Company/Department/Priority/Owner(s) always editable

Khuram: "when you click the task it opens up the card and in there, we cannot amend the company, department, priority — these all options should be available everywhere." Those fields already existed in the edit panel, but were hidden behind an "Edit task" button (or clicking the modal's title) that toggled a separate edit mode — evidently not being found. Removed the toggle: Description, Priority, Department, Company, and Owner(s) now render as live, always-visible, auto-saving controls every time a task is opened, matching how the Status and Stage controls below them already worked (plain dropdown, saves immediately, no Save/Cancel step).

Side effect: the click-to-edit plumbing this replaced (forwardRef/useImperativeHandle wiring between TaskDetailModal and TaskDetailPanel) is no longer needed and was removed — the modal header is just a header now.

---

## 2026-07-14 — Submitted tasks auto-route to the owner's manager

The last piece of the org-structure work from earlier this session: Khuram's original ask ("every time a task is submitted, it should go to their HOD... become part of their task to review and complete") had been deliberately deferred until the reporting-line data existed. Checked live data before building: 10 of 15 active people already had a manager set; the remaining 4 HODs (Akhlaq/Admin, M. Nadeem/IT, Naseem/Accounts, Zuhair/HR) had none, because the plan was for every HOD to report to Khuram or Kamran and Kamran's account still doesn't exist. Khuram confirmed pointing those 4 to himself for now — applied directly as a one-row data fix (same treatment as the Yahya Saleem HOD-conflict fix in the Phase 1 session), not a migration.

Built: migration 113 adds `submitted_by_name`/`submitted_by_email` to tasks — remembers who a task belonged to right before it's reassigned. In TaskStatus.tsx, moving a task's status to Submitted (either the plain status dropdown, or submitting an explanation on a reply-required task — both paths landed here) now looks up the current owner's manager and reassigns the task to them, so it shows up in the manager's own My Tasks rather than just being visible to them. If the owner has no manager on file (Khuram/Kamran at the top), it just saves the status with no reassignment. Moving it away from Submitted to anything except Completed/Cancelled hands it back to the original owner automatically — which also covers the existing "Reopen (send back)" reviewer button for free, since that goes through the same save path.

Not done: no notification fires on this handoff (matches how every other status change in the app already works — only task *creation* sends notifications today). The manager finds out by seeing it appear in their own task list, not via an alert.

---

## 2026-07-14 — Tasks: multi-assignee support + bulk actions

Khuram: "select multiple tasks at the same time and move them, change their status, change their company, or change their ownership" plus "in a task I can't change the company or the user, or assign it to multiple people by multi-selecting it."

Investigated first: Company was already editable in the task edit panel (added in an earlier session) — the real gap was that there was no way at all to change who a task is assigned to after creation, and no way to assign more than one person. Asked Khuram to confirm the model: real shared ownership (every person added sees it as their own task) rather than a lighter "notify others" version — he confirmed shared ownership.

Built: migration 112 adds a `task_assignees` join table. `tasks.assigned_to`/`assigned_to_email`/etc. stay as the "primary" owner so every existing report, filter, notification, and WhatsApp reminder keeps working untouched; task_assignees holds the full owner list, primary included. Critical detail caught during build: task visibility is enforced by RLS on the `tasks` table itself, not just the app's query filters — a co-assignee who wasn't the primary owner would've been silently blocked from ever seeing their own task. Fixed by extending `tasks_select`/`tasks_update` via security-definer helper functions (`is_task_assignee`, `owns_or_created_task`, `is_task_creator`) rather than having the two tables' RLS policies check each other directly, which would recurse.

NewTaskForm's single assignee dropdown became a checkbox multi-select (first ticked = primary). TaskDetailPanel's edit-task panel gained an "Owner(s)" field — previously missing entirely. TasksList/the home My Tasks widget now also catch tasks you're a co-assignee on, not just ones where you're the primary owner, and rows show "+N" when there's more than one owner.

Bulk actions: List view rows got checkboxes, with a bar that appears once something's ticked — change status, change company, or change owner across every selected task in one action. Owner change in bulk is single-select (replaces the full owner list on the tasks you pick) — for setting several tasks to several different owners each, that's still a one-at-a-time job via each task's own Owner(s) picker.

Known gap, flagged not fixed: the overdue-alert and digest cron jobs still only notify the primary owner, not co-assignees — a bigger follow-up if Khuram wants every co-owner reminded, not just the first one.

---

## 2026-07-14 — Org Chart: redesign as branching tree view

Khuram: "can we make it a tree view, so its easier to view it." Replaced the indented-list layout with an actual branching tree — stem down from each node, a horizontal bar across siblings, then a stem down to each child — using plain inline-styled divs (no CSS pseudo-elements, matching the codebase's inline-styles-only rule). Horizontally scrollable for wide trees; separate root chains (Khuram/Kamran) sit side by side.

---

## 2026-07-14 — Offboard action: is_active flag, Reassign Tasks folded in

Khuram asked whether Reassign Tasks was still needed now that manager_id/HOD structure exists, and separately asked to map a departure across everything a person is linked to — not just their org-chart spot, but tasks, reports, and ownership too, in one place, "so it stays with them all the way."

Answer: manager_id only governs who reports to whom going forward — it does nothing to a leaver's already-existing open tasks. Reassign Tasks was the tool that actually moved those. So the two weren't redundant, but they were two separate manual steps for what's really one event. Folded them into a single Offboard action.

Built: migration 111 adds `members.is_active` (default true) — not yet applied. The Offboard tab (replacing Reassign Tasks) lets an Admin or a HOD (for their own team) pick a leaver and an optional replacement; submitting moves the leaver's open tasks (matched by name, same mechanism as the old tool), their direct reports (manager_id), and any department they're Primary Owner of, all to the replacement — or to the leaver's own manager as interim cover if no replacement is picked yet, per Khuram's call. The leaver is then marked `is_active = false` rather than deleted, so old tasks/minutes/reports keep showing their name correctly, but they vanish from every picker going forward: Team Members, Org Chart, Department Ownership, and every place a new task gets assigned (Tasks page, PA quick-add, My Minutes follow-ups). A manual "Active" checkbox on each person's edit panel also allows reactivating a returning employee, or archiving someone directly without a handover.

Not touched: `assigned_to` on tasks is still a name string, not a member_id link — that's the real reason the reassignment logic has to match by name rather than ID (same root cause as the earlier "two Nadeems"/"Muhammad Shakeel twice" bugs). Fixing that properly would mean adding an `assigned_to_member_id` column and backfilling every existing task — a bigger, separate piece of work, not done here.

---

## 2026-07-14 — Fix Members page stuck-on-edit bug; hide already-assigned people from other HODs

Khuram reported First Name, Last Name, and Position Title fields "getting stuck" while typing on the Members page. Root cause: those three inputs used `value` + `onChange` calling straight into `updateMember()`, which ended with a full `loadData()` — 5+ Supabase queries — on every single keystroke. Email/Phone already used the correct `defaultValue` + `onBlur` pattern (fires once, on leaving the field); First Name/Last Name/Position Title didn't. Fixed by matching that pattern, and by replacing `loadData()` in `updateMember()`'s and `toggleTeamMember()`'s success paths with a local state patch — no full reload needed for a single-row update.

Also requested: once someone is ticked as reporting to a HOD, hide them from every other HOD's "Team members" picker — one person, one manager. Implemented: the picker list now excludes anyone whose `manager_id` already points elsewhere, with a small note showing how many people are hidden for that reason.

---

## 2026-07-14 — Org structure cleanup: drop is_director, dead owner fields, use position_title

Khuram reviewed Phase 1 (below) and caught two things: (1) Director doesn't need its own flag — it's just Kamran's title sitting at the top next to Khuram's CEO title, not a rank anyone else holds, so `is_director` was removed in favour of the existing (previously UI-less) `position_title` field, now editable on the Members page and used as the org chart's label when set. (2) Secondary Owner and Escalation Owner on Department Ownership were confirmed dead via a full codebase search — read nowhere except the screen that sets them, and Escalation Owner in particular was meant to do exactly what the new HOD/manager_id chain now does properly. Dropped both, kept Primary Owner (which the Executive Dashboard does actively use). Migration 110, not yet applied.

---

## 2026-07-14 — Org structure Phase 1: manager_id, is_director, team picker, org chart

Khuram wants "Submitted" tasks to auto-route to the submitter's HOD for review, HODs alerted when their team's tasks go overdue, and a clean handoff tool for departures. Before enabling any of that, he asked for an honest read of the existing "who reports to whom" setup.

Finding: the `members` table already had a `manager_name` column — completely unused. 0 of 15 members had it set, no page anywhere (checked Members management directly) selected or displayed it, and it was a free-typed name rather than a real link — the same fragile pattern that caused the task-assignment bugs fixed earlier this session (the system already has two people named Nadeem). Also found: every one of the 15 accounts is Manager/Admin/Executive — zero plain "Member" accounts — and two people (Nadeem Khan, Yahya Saleem) were both flagged HOD for Unze Trading Ops at once.

Agreed design: a real `manager_id` link (not text), a new `is_director` tier above HOD (chain: team member → HOD → Director → Khuram/Kamran), driven from the manager's side ("tick your team members") rather than each person picking their own manager, and the existing Reassign Tasks tool opened up to HODs for their own team.

Built this session: migration 109 (`manager_id`, `is_director`, drops `manager_name` — not yet applied); `is_director` checkbox and a "Team members" ticklist on every HOD/Director/Admin/Executive row in Members; a new Org Chart tab rendering the reporting tree recursively (cycle-guarded); Reassign Tasks now available to HODs/Directors scoped to their own team, not just Admin/Exec. Unflagged Yahya Saleem as HOD so Nadeem Khan is sole HOD for Unze Trading Ops (applied directly — a one-row data fix, not a schema change).

Still blocked: Kamran's account doesn't exist yet (need name/email/role), and which HODs report to Khuram vs Kamran. "Submitted" as an actual task status, the auto-reassign-on-submit logic, and HOD overdue alerts are separate follow-up phases once the org data is populated — not built yet.

---

## 2026-07-14 — Manage POs: delete/edit rights fixed, plus contractor cap and edit bug

Khuram asked to give himself and Nadeem Khan (Manager, Unze Trading Ops) rights to delete POs/letters and amend anything on the Manage POs page. Turned out not to be a permissions problem — both already passed the existing `canManagePOs`/`canManage` role checks (Admin, or Manager in Unze Trading Ops) used by every write route on this page. The actual gaps:

- **No `DELETE` handler existed** on `/api/stock/purchase-orders` or `/api/stock/authority-letters` at all — the "Delete selected" button in the UI called an endpoint that was never built, so it always failed. Added both, gated the same way as the existing POST/PATCH on each route, with friendly error messages when Postgres's own `on delete restrict` foreign keys block a delete (letters/production still linked to a PO, dispatch records still linked to a letter) — no new safety logic needed, the schema already protects this.
- **No way to edit an existing PO's core fields** (customer, PO number, label, quantities, dates, notes) — only create, close, and the broken bulk-delete existed. Added an Edit PO panel mirroring the existing Edit Letter pattern.
- **No delete button on individual letters** — added one next to Edit.

While testing, also hit and fixed a live bug: amending a letter or a contractor failed with *"Could not find the updated_at column of 'authority_letters' in the schema cache"* — both routes were unconditionally setting `updated_at` on every edit, but only `purchase_orders` actually has that column. Removed it from both PATCH payloads.

Separately, Khuram flagged the Contractors tab was hard-capped at 50 with no search. Removed the `.limit(50)` in `/api/stock/contractors` and added a name/phone/CNIC/address search box to the tab.

`tsc --noEmit` clean; `eslint` shows only pre-existing warnings on this file (unrelated `useEffect` patterns, one unused variable) — nothing new. 3 commits, not yet pushed (no git credentials in this sandbox — push from your own machine).

---

## 2026-07-14 — Directors re-added to the Tasks company list (reverses earlier exclusion)

While tagging the 8 personal/admin recurring tasks with a company (see stage 2 below), Khuram identified they're genuinely Directors-level personal items, not trading-company work — but still wants a company required, not left blank. Re-added `DIR` to `TASK_COMPANY_CODES` in `SharedUI.tsx`, app-wide (his explicit choice, not scoped to just Recurring Tasks). This **reverses** the Almahar/Directors exclusion from earlier the same day — Almahar stays excluded. Added a badge colour for `DIR` in `TasksList.tsx`. Directors is now selectable on every task company picker: New Task form, PA, meeting minutes, CSV import, filters, and Recurring Tasks.

---

## 2026-07-14 — Task-creation consolidation, stage 2 (remaining 4 client paths migrated)

Continuation of stage 1 (below). All 7 task-creation paths now route through the shared `/api/tasks/create` gate:

- **Recurring Tasks**: added a company picker to `RecurringTasksPanel.tsx`'s add/edit forms (migration 106 already added the `company_id` column). Read-only rows flag "No company set" in amber. The cron itself (`api/tasks/recurring/route.ts`) is **not yet migrated** — none of the 8 currently-active templates have a company set, so switching the cron to require one would silently stop generating tasks. Waiting on Khuram to tag all 8 before this is flipped.
- **PA quick-add** (`pa/page.tsx`): added a required company dropdown and the 150-char description limit (neither existed before); `createNewTask` now calls `/api/tasks/create`.
- **Meeting minutes manual add** (`my-minutes/page.tsx`) and **meeting AI-extraction** (`meetings/page.tsx`): both added a required company selector (per action item, for the AI-extraction case — the meeting's own free-text `company` label is a fixed list of 6 strings that doesn't reliably map to the `companies` table, so it isn't used as a default) and the character limit. Both now call `/api/tasks/create`, which also fixes `assigned_by` to the real logged-in user instead of the hardcoded `"Meeting Minutes"` label both paths used before.
- **CSV bulk import** (`TasksList.tsx`): added a required Company column to the template; per Khuram's call, Assigned By / Assigned To / Department / Company must each exactly match a real member/department/company or the row is rejected (case-insensitive) — other valid rows in the same file still import. Now calls `/api/tasks/create` per row, so CSV-imported tasks get a real notification email for the first time.
- **New Task form** (`NewTaskForm.tsx`): last path migrated. Also removed the "Group / needs review" company option — company is now genuinely required with no opt-out, closing the loophole that survived an earlier "required" pass (task history above).

Verification: `tsc --noEmit` clean across the whole project; `eslint` shows only the same pre-existing warnings/errors as before this work (react-hooks/set-state-in-effect patterns, a few unused-var warnings, two `any` types, one unescaped apostrophe) — nothing new introduced. 5 commits, not yet pushed to `origin/main` (this sandbox has no git credentials configured — push from your own machine, or re-authorise here).

Still open: apply `supabase/106_task_creation_hardening.sql` if not already done; tag all 8 active recurring-task templates with a company, then the cron can be migrated onto the shared gate.

---

## 2026-07-14 — Task-creation consolidation, stage 1 (server-side paths + alert/task split)

Khuram asked for a full map of how notifications and task-assignment worked across the app, suspecting duplication/inconsistency. Delivered `TASK_NOTIFICATION_AUDIT.md`: notifications were already centralised and fine (one `sendNotificationEmail()` function, working CEO-digest suppression), but task **creation** had 7 independent, uncoordinated insert call sites with wildly inconsistent field population.

Agreed fix, stage 1 (server-side, lowest-risk paths):

- **New shared gate**: `app/lib/task-creation.ts` (`createTaskCore`) + `app/api/tasks/create/route.ts`. Validates company required (Khuram's rule — no more silent "Group" fallback going forward), 150-char description limit, resolves `assigned_by` from the real actor (never a raw unchecked string), always fires a notification. Every task-creation path will route through this one gate.
- **Notification email logic extracted** into `app/lib/task-notifications.ts` (`notifyTaskAssigned`, `notifyEscalationTask`), shared by `/api/notifications/send` (kept as a thin wrapper for not-yet-migrated call sites) and `createTaskCore` directly.
- **Trigger-type constants** (`app/lib/notification-types.ts`) replace the free-typed `"task_assigned"`/`"escalation"` strings in `send-email.ts`'s digest-suppression list, so a typo can't create an unsuppressed new type.
- **Alert vs. task, differentiated for the first time**: Khuram's rule — if the exception is already visible somewhere the owner checks anyway and nothing needs to be explicitly "completed," it's an alert (bell + "Needs Your Attention" banner), not a task. KPI escalations (production/dispatch/breakage lagging) and stuck receivables are reclassified from auto-created "Explanation Required" tasks to alert-only; the existing "Escalations" attention row already covered KPI visibility, added a new "Stuck Receivables" row so nothing disappears. Cash escalation stays a task (Khuram's call — a written explanation is wanted, tracked to completion) but now routes through the shared gate with a real company tag and an actual notification email (previously silent — one of the 3 auto-escalation functions in `home/page.tsx` fired zero notifications).
- **Recurring tasks**: added a company picker to `RecurringTasksPanel.tsx`'s add/edit forms, prep for enforcing company-required on the cron. None of the 8 currently-active templates have one set yet — several (fee challans, personal payments) don't look company-specific — so Khuram is going through them before the cron itself is migrated (`app/api/tasks/recurring/route.ts` still inserts directly for now).
- **Migration 106** (not yet applied): `company_id` on `recurring_tasks`; two `NOT VALID` check constraints on `tasks` (description ≤150 chars, `assigned_by_email` not null) as a DB-level backstop behind the new gate — grandfathers in existing rows (10 tasks already exceed 150 chars from before the character-limit rule).

Still to do: PA quick-add + meeting-minutes company pickers and real-actor `assigned_by`, CSV import strict validation, migrate NewTaskForm onto the shared gate, migrate the recurring cron once Khuram's tagged the 8 templates.

Verification: `tsc --noEmit` clean, `eslint` shows only pre-existing warnings/errors (same baseline as before these changes — none introduced).

---

## 2026-07-14 — Full company names, Almahar/Directors excluded, Department filter shows all departments

Three more fixes from Khuram:

- **Full company names, not codes** — Tasks badges/filters/board cards were showing "UTPL"/"IFPL" instead of the real company name. Now show `companies.name` ("Unze Trading Pvt Ltd", "Imperial Footwear Pvt Ltd", etc.) everywhere; short_code is only still used internally to pick the badge colour.
- **Almahar and Directors excluded everywhere on Tasks** — `NewTaskForm.tsx` already excluded them (`TASK_COMPANY_CODES`, agreed with Khuram previously), but the task-edit form (`TaskDetailPanel.tsx`) and the Company filter dropdown (`TasksList.tsx`) were still fetching every company unfiltered. `TASK_COMPANY_CODES` moved to `SharedUI.tsx` so all three screens share one list instead of drifting. Confirmed 0 existing tasks reference either company, so nothing was orphaned.
- **Department filter was only showing departments already used on a task** — so the 7 departments Khuram added in the last round (with no tasks yet) never appeared as filter options. Now merges the canonical `department_owners` list with whatever's on existing tasks, so all departments show up regardless of usage.

Verification: `tsc --noEmit` clean, `eslint` shows only the same pre-existing `react-hooks/set-state-in-effect` pattern.

---

## 2026-07-14 — Fixed "Muhammad Shakeel twice" + removed duplicate week filter

Khuram spotted Muhammad Shakeel listed twice in the Tasks Owner filter despite there being only one such member. Root cause: 10 member rows (Asif Shakoor, Usman Arshad, Muhammad Nadeem, Awais Zaman, Muhammad Shakeel, Sania Saleem, Shahid Masaud, Muhammad Akhlaq, Shahida Naseem, Zuhair Khalid) were imported with a stray trailing space on first/last name, producing a double space in `name`. Browsers collapse that visually, so it looked fine — but some tasks were entered with a clean single space instead, and anywhere the app deduped/grouped by the raw string (Owner filter, Tree view person grouping, `get_tasks_team_stats()`), the two spellings counted as different people.

- Code fix: `normName()` helper in `TasksList.tsx` collapses whitespace before building the Owner filter options, the owner-filter comparison, and the Tree view's per-person grouping.
- Data fix: migration 108 normalizes whitespace in `members` (first_name/last_name/name), `tasks` (assigned_to/assigned_by), `recurring_tasks.assigned_to`, and `department_owners`' owner-name columns. Not yet applied.
- Also removed the "Due this week" option from More Filters — it duplicated the new primary Due Period filter from the last round.
- Confirmed with Khuram: keep the 5 existing departments not on his list (BINC, Legal, S&M Investment, Sales, Unze Trading Ops) — no deletion.

Verification: `tsc --noEmit` clean.

---

## 2026-07-14 — Sidebar cleanup + Tasks view-switcher rebuild (Khuram's follow-up round)

- **Sidebar**: Recurring Tasks and Calendar removed (Recurring lives inside Tasks now; Calendar hidden everywhere until it's finished — route still works directly). Profile moved from My Workspace to Settings.
- **Task description capped at 150 characters** wherever it's typed by hand (New Task, task edit, recurring templates) — `TASK_DESCRIPTION_LIMIT` in `SharedUI.tsx`, with a live counter. CSV import and meeting-minutes action items left uncapped (separate flows).
- **Overdue rows no longer get a full red background** — Khuram: "looks really messy." Replaced with a left accent bar + a small "Overdue" pill badge.
- **7 missing departments added** to `department_owners` (Accounts, Tax, Retail, Marketing, Online, Executive Office, Procurement / Purchase) — migration 107, owners left blank for Khuram to assign. 5 existing departments not on his list left untouched.
- **View switcher rebuilt**: Weekly/Monthly/Quarterly tabs and their bar charts removed entirely, replaced by a single "Due period" filter (All/week/month/quarter) available on every view. Board/Tree/List/Timeline are now icon-only buttons, right-aligned; Team/Recurring stay as text pills, left-aligned. "List" = the old "My Tasks" tab, renamed. "Tree" = the old Department view, rebuilt as a real collapsible Department → Person → Tasks hierarchy (both levels collapsible, not just a flat list with a static person strip).

Verification: `tsc --noEmit` clean throughout; new `react-hooks/set-state-in-effect` ESLint flags checked against the pre-change file and confirmed pre-existing.

Migrations 106–107 written, **not yet applied** — run via Supabase SQL Editor, after 098–105.

---

## 2026-07-14 — Tasks: live-testing feedback round (9 points from Khuram)

Khuram tried the live page and sent 9 issues. Addressed all:

- **One attention banner, not two** — removed the older collapsible overdue-list banner; its unique value (click to see the actual tasks) was folded into making every KPI tile clickable.
- **Every KPI tile is now clickable** (previously only Open/Overdue) — clicking any tile (Open, Overdue, Due Today, Waiting Reply, Stuck, Completed) opens a drawer of the matching tasks underneath.
- **Recurring task templates can now be edited** (previously only Pause/Resume/Delete).
- **Regular tasks can now be edited too** — new "Edit task" button in the task detail modal (description/priority/department/company), since `TaskStatus.tsx`'s `canEditTask` prop existed but had no UI wired to it.
- **People/Owner filter** — already existed but was only visible on Board/Department/Weekly; now visible on every tab (My Tasks, Monthly, Quarterly, Timeline included).
- **Escape key** now closes the New Task modal, Task Detail modal, and the calendar date-picker popover.
- **KPI tiles now show a small icon square** (clock, alert triangle, calendar, chat bubble, checkmark) per Khuram's request to match the reference design — plain inline SVGs, no new dependency.
- **Department tab removed** — the reference image Khuram attached turned out to be the status-column Kanban board (Inbox/Doing/Waiting/Review/Done), which is what the existing Board tab already is. Department is now just a filter dropdown on every tab instead of a separate grouped view.
- **Data backfill for the 77 pre-redesign tasks** — migration `106_backfill_task_company_department.sql` (not yet applied) tags all 77 with company_id = UTPL and fills in department ("Executive Office") for the 11 rows missing it. **Correction to Khuram's request:** priority and owner were *not* backfilled — a live query showed 0 of 77 tasks are missing either field (priorities are already a real mix: 38 High/19 Medium/11 Normal/8 Urgent/1 Low; owners are all populated). Setting everything to "High" as asked would have destroyed real data, so that part was skipped.

Verification: `tsc --noEmit` clean. New `react-hooks/set-state-in-effect` ESLint flags checked against the pre-change file and confirmed pre-existing, not introduced by this round.

Migration 106 is written, **not yet applied** — run via Supabase SQL Editor. Commits are local only; the sandbox has no push credentials, so `git push` needs to run from Khuram's own terminal.

---

## 2026-07-14 — Tasks Phase 5: mockup reconciliation after Khuram flagged the live page didn't match the design

Khuram, after checking the live page: "It's almost 40% of the design, and 60% of the elements are not there... I thought we designed it so we don't have to do this now." He was right. Going back to the finalised mockup line-by-line found a real, sizeable gap beyond the three items Phase 4 had already closed — the Phase 3/4 handoff had only called out three deferred items when in fact many more mockup features had quietly not made it into the real build. That was a process failure: no systematic reconciliation was done before reporting the rebuild as complete. Fixed properly this time, one pass, seven commits:

- **Company is now genuinely required** on `NewTaskForm.tsx` — it previously defaulted silently to "Group / needs review" and would save without ever being actively chosen, the opposite of what was designed.
- **"Needs Your Attention" banner** — Critical (Urgent, open) / Overdue / Due Today / Stuck stats + a "View breakdown" drawer, finally wiring `get_tasks_department_breakdown()` (built in migration 101, sitting unused until now) into the UI. Migration 103 adds `urgent_open_count` to `get_tasks_kpi_summary()`.
- **"My Tasks" tab**, now the default landing view — Overdue/Due Today/This Week/Next Week & Later groups, with a My tasks/Everyone scope toggle.
- **Department, Priority, Owner filters + a "More Filters" panel** (Stage, Due date, Source, Subtask state) — all real, functional filters, not just visual like the mockup's own draft.
- **Search box** over task descriptions.
- **Task detail is now a modal popup** (new `TaskDetailModal.tsx` + `app/lib/Modal.tsx`), replacing the inline expand-in-row/card pattern, matching the finalised design.
- **Inline mini-subtask-checklist** (`MiniSubtaskToggle.tsx`) — quick tick-off on List rows and Board cards without opening the full modal, reading/writing the same `task_subtasks` rows so it never drifts.
- **Comments** — new `task_comments` table (migration 104), flat/oldest-first/append-only, RLS mirrors `tasks_select`.
- **WhatsApp auto-remind toggle** — new `whatsapp_auto_remind` column (migration 105); captures intent only, still needs the pending WhatsApp Business API setup to actually auto-send.
- **Calendar-popover date picker** (`app/lib/DateInputWithCalendar.tsx`) — "Pick" button + popover calendar alongside the existing DateInput text field, on the New Task due date and current-due-date editor. Still not a native `<input type="date">`.
- **Meeting-source chip** — compact "From: [meeting] →" chip directly on List rows and Board cards, not only inside the full detail view.

Verification: `tsc --noEmit` clean throughout. One new ESLint purity error (`Date.now()` called during render) was caught and fixed by computing the date from the already-fixed `todayStr` instead. Remaining ESLint flags are the same pre-existing `react-hooks/set-state-in-effect` pattern already used everywhere else in this file.

Migrations 103–105 are written to `supabase/`, **not yet applied** — run after 098–102, same manual process via the Supabase SQL Editor.

---

## 2026-07-14 — Tasks Phase 4: Stuck is red, Kanban board, Recurring merged in, monthly/quarterly moved to RPCs

Khuram, on the previous entry's three deferred items: "these three things that you've not done — I need you to solve them" plus "Stuck... should be red, because Stuck means red alert." Five small commits:

- **Stuck status → red.** Moved out of the neutral-grey bucket in `statusColor()` (`SharedUI.tsx`). Added a dashed border on Stuck badges to keep it visually distinct from Waiting Reply, which is also red — my own call, not something Khuram asked for, flagging it in case he'd rather they look identical.
- **Kanban board.** New `TasksBoard.tsx` — native HTML5 drag-and-drop (no external library), one column per status plus an "Other" column for anything unrecognised. Dragging onto Completed while subtasks are open is rejected by the migration-100 database trigger; the rejection message now surfaces as a toast instead of a raw Postgres error. Extracted the task detail view out of the List row into shared `TaskDetailPanel.tsx` so List and Board don't carry two copies of the same logic.
- **Recurring tab.** New `RecurringTasksPanel.tsx`, same `recurring_tasks` table and cron engine as the standalone `/recurring-tasks` page (untouched, still works). Emoji removed from the example cards per the earlier "no emojis" instruction.
- **Monthly/quarterly RPCs (migration 102).** `get_tasks_monthly_chart()` and `get_tasks_quarterly_chart()` replace the JS for-loops that built those two bar charts, per house rule 0. Department/weekly/timeline grouping deliberately left as client-side — those views need full task rows to render, not just counts.

Verification: `tsc --noEmit` clean. ESLint flagged the same pre-existing `react-hooks/set-state-in-effect` pattern already present elsewhere in this file (and now also in the new `RecurringTasksPanel.tsx`, following the same established convention) — not a new class of problem, disclosed rather than hidden. Two small pre-existing lint warnings (unused `TaskStatus` import, unused `thisWeekStart` variable) cleaned up while in the file.

Migration 102 is written to `supabase/`, **not yet applied** — run it via the Supabase SQL Editor after 098–101, same as always.

---

## 2026-07-14 — Tasks visibility audit (no code change needed) + removed Shakeel's can_see_all_tasks override

Khuram asked for confirmation that "every member can only see their own tasks unless they're Admin/CEO/PA" — checked the live database rather than assuming. The `tasks_select` RLS policy (migrations 027/030/090) already enforces exactly this: `can_access_all_tasks() OR assigned_to_email = me OR assigned_by = my name`, and `can_access_all_tasks()` defaults to Admin tier + Executive (PA) only, with a per-member override checked first. This is a real database-level rule, not just a client-side filter, so it holds even for direct API calls. No code or migration needed — verified via `pg_policies` and the function definitions live on the project.

One live exception found: Muhammad Shakeel (Manager, Finance) had `member_permissions.can_see_all_tasks = true`, an undocumented manual override giving him company-wide task visibility. Flagged to Khuram, who confirmed removing it. Set to `false` via direct SQL update (data change, not a migration — no schema change involved). Only the two Admin accounts and the PA (Sundas Hussain) now have `can_see_all_tasks = true`.

Also, on `Tasks_Page_Redesign_Proposal.md` / `Tasks_Page_Mockup.html` (still a standalone design file, not wired into the app): removed the left sidebar per Khuram's feedback (screenshot was layout inspiration only, not a request for new navigation structure), replaced the Company/Department pill rows with real dropdown selects, added a working "More Filters" panel and a "Reset Filters" control, and removed all emoji from the mockup in favour of the app's existing text-first style.

---

## 2026-07-14 — Tasks redesign built into real code (migrations 098–101 + NewTaskForm/TaskStatus/TasksList)

Khuram asked to turn the approved Tasks mockup into the real `/tasks` page and confirmed doing it as one full pass with one review at the end. Four migrations (written to `supabase/`, **not yet applied** — apply via SQL Editor, in order, before this code takes effect):

- **098** — `tasks.company_id` (FK → companies, null = "Group / needs review"), `stage` (optional free-text pipeline label), `original_due_date` and `completed_at`. Two triggers make the rules real rather than UI conventions: `assigned_date`/`original_due_date` are locked forever (any UPDATE attempt is silently reverted), and `completed_at` is stamped/cleared automatically on status transitions.
- **099** — `task_due_date_history`, populated entirely by an AFTER UPDATE trigger — every due-date move logged automatically (old date, new date, who, when), no app code has to remember to log it.
- **100** — `task_subtasks` (one flat checklist level, no nesting) + a BEFORE UPDATE trigger that blocks setting a task to `Completed` at the database level while any subtask is still open — same escalation pattern as migration 045's protected-task rule.
- **101** — `get_tasks_kpi_summary()`, `get_tasks_department_breakdown()`, `get_tasks_team_stats()` — read-only RPCs replacing client-side counting for the KPI row and the new Team tab, each re-implementing the `tasks_select` visibility rule by hand since `security definer` functions don't inherit the caller's RLS automatically.

Code changes, four small commits: `NewTaskForm.tsx` (required Company select, locked "today, locked" assigned date, optional Stage field, inline subtask list, Urgent priority, Stuck status), `TaskStatus.tsx` (subtasks checklist with completion gating, Stage editing, due-date history + locked original date shown above the now-freely-editable current due date), `TasksList.tsx` (company badges + Stage chip + subtask count on each row, a Company filter dropdown with Reset Filters, KPI row now RPC-sourced with new Due Today/Stuck tiles, new Team tab via `TeamStats.tsx` — on-time completion rate is genuinely computable for the first time, no longer "not trackable yet").

Verification: `tsc --noEmit` passes clean across the whole app. `next build` couldn't be run end-to-end in the sandbox (no network access to fetch the platform SWC binary) — Vercel's own build is the real confirmation once this is pushed. ESLint flagged some `react-hooks/set-state-in-effect` errors; confirmed these are pre-existing in the original file (checked against the last committed version), not introduced by this change.

Deliberately not attempted, flagged rather than silently skipped: a true drag-and-drop Kanban board, merging Recurring Tasks into this page as a tab, and rewriting the existing client-side department/weekly/monthly/quarterly/timeline grouping into RPCs (pre-existing debt, untouched beyond the KPI row). Held back as separate, safer follow-ups rather than one very large, hard-to-review change to a production tool.

---

## 2026-07-11 — UI designer audit (7 styling fixes), pension cache fix, pension price cron, AGENTS.md, Audit multi-company, dispatch/letter safety hardening, constants/permissions/AccessMatrix extended

### AGENTS.md added
**File:** `.claude/AGENTS.md`

Quick-reference table of all 8 custom agents (ui-designer, blueprint-keeper, code-auditor, db-architect, perf-optimizer, security-auditor, api-designer, test-writer) with their `/agents <name>` invocation commands. Committed to the repo.

---

### UI designer audit — 7 styling fixes

**Files changed:** `app/login/page.tsx`, `app/monthly-operations-targets/page.tsx`, `app/admin/page.tsx`, `app/home/page.tsx`, `app/receivables/page.tsx`, `app/lib/SidebarLayout.tsx`, `app/globals.css`

Fix 1 — **Monthly Operations Targets** (`app/monthly-operations-targets/page.tsx`):
- Full replacement of all `var(--*)` CSS variable references and raw hex with `COLOURS.*` tokens
- Imported `tableHeaderStyle`, `tableCellStyle`, `tableCellBoldStyle`, `WARNING_BANNER_STYLE`, `WARNING_BANNER_INNER` from SharedUI; removed local `tdS`, `inp`, `lbl` constants
- Progress bar height `10px → 8px`, track colour `var(--border-light) → COLOURS.TRACK`
- Font sizes 13–14px body (was 15–16px), submit button `RADII.PILL`, weight 500 (was 700)
- Chart fills: hardcoded hex → `COLOURS.INK_300`, `COLOURS.GREEN`, `COLOURS.HAIRLINE`, `COLOURS.TEAL`

Fix 2 — **Admin / Data & Backups** (`app/admin/page.tsx`):
- All `var(--bg-card)`, `var(--border-color)` → `COLOURS.CARD`, `COLOURS.HAIRLINE`
- `borderRadius: "8px"` → `RADII.CARD`; buttons `→ RADII.PILL`; selects `→ RADII.SM`
- Status message: `#dcfce7/#fee2e2` → `COLOURS.SUCCESS_SOFT/COLOURS.DANGER_SOFT`
- Badge backgrounds: `#eff6ff → "#EEF1FC"`, `#f1f5f9 → COLOURS.HAIRLINE`
- Restore modal: `RADII.CARD`, `RADII.SM`, `RADII.PILL` throughout

Fix 3 — **Login** (`app/login/page.tsx`):
- Branding corrected: "PulseDesk" → **"Unze Group"** in both mobile strip and desktop header
- `#3b82f6` → `COLOURS.BLUE` throughout (event handlers and style props)
- Error/success message banner uses `COLOURS.SUCCESS_SOFT/DANGER_SOFT` and `COLOURS.GREEN/RED`

Fix 4 — **cardStyle dark mode** — **deferred** (too systemic; COLOURS tokens are static and don't adapt to dark mode CSS variables)

Fix 5 — **Home page** (`app/home/page.tsx`):
- All 9 occurrences of `color: "var(--text-muted)"` → `color: COLOURS.INK_400`

Fix 6 — **Receivables** (`app/receivables/page.tsx`):
- Stage header: `color: "#fff"` → `color: "white"` (avoids raw hex in inline style)

Fix 7 — **Sidebar active accent** (`app/lib/SidebarLayout.tsx`):
- Active nav items in expanded state now have a `3px solid COLOURS.BLUE` left border
- `3px solid transparent` in collapsed state — no layout shift on sidebar toggle
- Left padding reduced by 3px when expanded to compensate for the border

Fix 8 — **Globals tooltip** (`app/globals.css`):
- Tooltip CSS rule: `background: #1e293b` → `background: var(--text-primary)` for dark-mode correctness

---

### Pension cache fix
**File:** `app/home/page.tsx`

- Root cause: `loadExecutiveData()` has a 2-minute `sessionStorage` cache. On a cache hit, it returned early before reaching the pension RPC, and the pension result was never stored in the cache payload.
- Fix: captured pension result into `computedPensionSummary` variable before setting state; added it to the cache payload write; added restore from cache on cache hit.
- Result: UK Pension value now displays correctly on the Executive Dashboard whether loading fresh or from cache.

---

### UK Pension — price fetch cron
**File:** `app/api/investments/fetch-pension-prices/route.ts` (new), `vercel.json`

- Weekday cron at 23:00 UTC — fetches NAV prices for UK pension funds from Morningstar
- Funds tracked: L&G (ISIN GB00BVRZG281, Morningstar ID F00000VBU2), Vanguard (ISIN GB00BRDCMX84, Morningstar ID VAUSA0P5GL)
- Upserts to `pension_fund_prices` table. Fallback hardcoded prices for outage resilience.
- Auth: CRON_SECRET Bearer token OR Admin/CEO Supabase session
- `vercel.json` updated: new cron entry `{ path: "/api/investments/fetch-pension-prices", schedule: "0 23 * * 1-5" }`

---

### UK Pension — tables and RPCs
**Database: applied directly (no numbered migration file)**

- `pension_funds` table — active UK pension funds: id, fund_name, isin, morningstar_id, active, notes
- `pension_fund_prices` table — daily NAV prices: id, fund_id (FK), price_date, price_gbp, source. UNIQUE(fund_id, price_date)
- `get_pension_summary()` RPC — returns single row: total_value_gbp, net_gain_gbp, return_pct, contributed_gbp, fees_gbp, fund_count, last_price_date
- `get_pension_fund_breakdown()` RPC — returns per-fund rows: fund_name, isin, units_held, price_gbp, value_gbp, allocation_pct, price_date, value_pkr

---

### Investments page — UK Pension section
**File:** `app/investments/page.tsx`

- New "UK Pension" section showing: total value (GBP + PKR equivalent), net gain, return %, amount contributed, fees, and a per-fund breakdown table (fund name, ISIN, units, price, value, allocation %)
- Calls `get_pension_summary` and `get_pension_fund_breakdown` RPCs directly; no sessionStorage cache (always fresh)

---

### Audit Dashboard — multi-company
**File:** `app/department/[slug]/AuditDashboard.tsx`

- Company filter tabs: All / UTPL / IFPL / BRNH / HD / ALM / DIR — using `PillTabs` component
- `company_id` column on audit records; filter applied client-side via `filteredByCompany`
- `CompanyBadge` component added: UTPL = blue (#EEF1FC bg + COLOURS.BLUE text), IFPL = green (SUCCESS_SOFT + COLOURS.GREEN)
- 6 audit entity types, including Directors

---

### Stock system — dispatch/letter safety hardening
**Files:** `app/api/stock/authority-letters/route.ts`, `app/api/stock/dispatch-records/route.ts`, `app/production/ProductionForm.tsx`

- Authority letters API: expired letters flagged server-side; dispatch against expired letters blocked at API level
- Dispatch records API: over-quantity hard block — rejects if dispatch would exceed letter's remaining balance
- ProductionForm.tsx: client-side expiry and over-quantity validation before submitting dispatch

---

### constants.ts — 6 companies
**File:** `app/lib/constants.ts`

- COMPANIES array expanded to 6 entities: UTPL, IFPL, BRNH (Baranh), HD (Haute Dolci), ALM (Almahar), DIR (Directors)
- Each entry: id (UUID), name, shortCode, slug, currency
- Added helpers: `getCompanyBySlug()`, `getCompanyById()`, `getCompanyByName()`
- Used by admin page (company filter), audit dashboard (company filter), and any future multi-company feature

---

### permissions.ts — new functions
**File:** `app/lib/permissions.ts`

- `canEditOperationsTargets(u)` — Privileged + OPS_HOD_EMAIL (nadeem.khan@unze.co.uk)
- `canViewTaxAccounts(u)` — all authenticated (except PA); NULL defaults true
- `canManageTaxSchedule(u)` — Admin/CEO only; NULL defaults false
- `OPS_HOD_EMAIL` constant exported
- All permission functions fully documented with override key names

---

### AccessMatrix — new permission columns
**File:** `app/members/AccessMatrix.tsx`

- 38 permission columns across 9 groups (Dashboards, Finance, Recv., Tasks, Depts, Tax Mgmt, Prod., Members, Admin)
- New columns added (vs previous): `can_view_investments`, `can_edit_investments`, `can_view_dept_tax_accounts`, `can_manage_tax_schedule`, `can_manage_tax_notices`, `can_edit_operations_targets`
- `finance_company_scope` renders as a `<select>` (UTPL/IFPL/both); only shown when `can_view_finance` is ON for that member
- Override cells highlighted with blue border (`3px solid #3b82f6`)
- Protected rows (Admin/CEO/PA) render as locked (border-only cells, no toggle)

---

### BLUEPRINT.md
Updated to reflect all changes above: login branding, 7 styling fixes, pension cache fix, pension RPCs/tables/cron, audit multi-company, dispatch/letter safety, constants expansion, permissions additions, AccessMatrix columns, sidebar active accent, globals tooltip fix.

---

## 2026-07-07 — Sidebar restructure, Accounts & Returns, Tax Notices enhancements, Tax Compliance summary, tax deadline alerts

### Sidebar restructured
**File:** `app/lib/SidebarLayout.tsx`, `app/lib/pageRegistry.ts`

- Group order changed to: **Overview → Operations → Departments → Finance → My Workspace → Settings**
- "Tasks & Meetings" group renamed **My Workspace** — same items (Calendar, Meetings, My Minutes, Profile, Recurring Tasks, Tasks), just renamed group
- "Command Centre" group removed entirely
- Items within each group sorted A–Z case-insensitively at render time
- GROUP_COLOURS updated: Overview = NAVY, Departments = AMBER (was BLUE)

### Accounts & Returns — NEW page (`/accounts-tax`)
**Files:** `app/accounts-tax/page.tsx`, `app/accounts-tax/AccountsTaxDashboard.tsx`, `app/accounts-tax/TaxComplianceSummary.tsx`

- Full quarterly accounts schedule tracker: 4 quarters × 5 entities (UT, IMP, BARANH, HD, ALMAHAR) × 5 steps = 25 checkboxes per quarter
- Annual accounts schedule: 10 entities × 6 steps = 60 checkboxes
- Return filings grid: FBR Sales Tax (monthly, 3 entities), PRA Tax (monthly, 5 entities), Income Tax (quarterly, 5 entities)
- Fiscal-year navigation (Pakistan fiscal year Jul–Jun, format '2025-26')
- Overdue detection: returns unfiled after the 15th are marked red
- Status options: Not Started / In Progress / External Auditors / Completed
- After every save, fires POST to `/api/cron/tax-alerts` to recompute deadline alerts in the background
- Access: all authenticated users can view (except PA). Manage access (editing) requires `canManageTaxSchedule` — defaults false, explicitly granted to Admin/CEO/Shakeel/Avess/Awais
- Sidebar entry: "Accounts & Returns" in the Departments group (permKey: `can_view_dept_tax_accounts`)

### Tax Notices — sidebar label renamed + enhanced filters
**File:** `app/department/[slug]/TaxationDashboard.tsx`

- Sidebar label changed from "Taxation" to **"Tax Notices"** for clarity
- Three new columns on `legal_notices` (migration 069):
  - `is_active` (boolean, default true) — Active/Inactive toggle per notice
  - `notice_status` — 'Order', 'Notice', or 'Show Cause' dropdown
  - `legal_stage` — 'Authority', 'Department', 'CIR Appeal', 'Tribunal', 'High Court', 'Supreme Court'
- Filter tabs: All / Active / Inactive
- New permission: `can_manage_tax_notices` (migration 069) — defaults false, granted to Admin/CEO/Shakeel/Avess/Awais

### Tax Compliance summary card on home page
**File:** `app/home/page.tsx`, `app/accounts-tax/TaxComplianceSummary.tsx`

- CEO/Admin home page now shows a Tax Compliance summary tile between the Ops section and Investments
- Shows filing % and schedule completion chips for current fiscal year (and previous if data exists)
- Clicking the card navigates to `/accounts-tax`
- Data loaded from `tax_schedule_entries` and `tax_return_filings` for current + previous fiscal year (4 parallel queries)

### Tax deadline alert engine
**Files:** `app/lib/taxAlertEngine.ts` (NEW), `app/api/cron/tax-alerts/route.ts` (NEW)

- `computeAndStoreTaxAlerts(supabase, taxYear)` — reads schedule and filing data, computes which deadlines have been missed, upserts `tax_deadline_alerts` rows, emails CEO on new alerts
- Two-tier alert system: tier 1 = first warning (approaching), tier 2 = overdue
- Covers: quarterly/annual schedule deadlines, FBR/PRA monthly returns, Income Tax quarterly returns, annual personal returns (31 Aug internal / 30 Sep legal), annual company returns
- Cron runs twice daily at 00:00 UTC and 06:00 UTC via GET `/api/cron/tax-alerts` (CRON_SECRET Bearer auth)
- Also called fire-and-forget from AccountsTaxDashboard via POST after each save (Supabase session auth)

### Database migrations applied
- **Migration 068** — `can_view_guarantees`, `can_manage_guarantees`, `can_view_stock`, `can_manage_stock`, `can_manage_meetings` columns added to `member_permissions` (Access Matrix new columns)
- **Migration 069** — `is_active`, `notice_status`, `legal_stage` columns on `legal_notices`; `can_manage_tax_notices` permission column
- **Migration 070** — `tax_schedule_entries` table, `tax_return_filings` table, `can_view_dept_tax_accounts` and `can_manage_tax_schedule` permission columns
- **Migration 071** — `tax_deadline_alerts` table
- **Migration 072** — Recurring tasks RLS fix: changed from `is_admin_or_exec()` to `is_privileged()` so PA (Executive role) can read and write recurring tasks

### BLUEPRINT.md
Fully rewritten to reflect all changes since the last update (sidebar, accounts & returns, tax notices, tax compliance summary, tax alert engine, all new DB tables, updated permission functions, updated cron schedule).

---

## 2026-07-06 — Restyle Finance page to Genspark design system

**Files changed:** `app/finance/FinanceManager.tsx`, `app/finance/page.tsx`

### What changed (visual only — no logic, queries, or data flows touched)

- **15 hardcoded hex values replaced** with `COLOURS.*` tokens (`#2563eb`, `#16a34a`, `#dc2626`, `#d97706`, alert palette, etc.)
- **Net Position hero card** — dark NAVY background, white text, Inter Tight 36px tabular-nums; signals the primary CEO cash figure
- **3 other summary cards** — hairline borders (no colour accent strips), Inter Tight 22px numbers, uppercase kicker labels (10.5px), 20px padding
- **Edit buttons on summary cards** — secondary style: white bg, hairline border, `RADII.PILL` radius, NAVY text
- **Daily position table** — JetBrains Mono for all amount columns, tabular-nums, kicker-style headers, HAIRLINE row dividers; DANGER_SOFT bg on mismatch rows
- **Charts** — grid lines use `COLOURS.HAIRLINE`; bar/line fills use `COLOURS.BLUE`, `COLOURS.GREEN`, `COLOURS.RED`
- **Alert banner** — `COLOURS.DANGER_SOFT` / `COLOURS.WARNING_SOFT` backgrounds, `COLOURS.RED` / `COLOURS.AMBER` for text and border
- **All card containers** — `borderRadius: "14px"`, `24px` padding, `COLOURS.HAIRLINE` borders, no drop shadows, no top-accent colour strips
- **Modals (Opening Balance, Monthly Cash Plan)** — `RADII.CARD` (14px), 24px padding, hairline border, kicker labels on fields, pill close button
- **Tabs (Upload PDF / Manual Entry, Upload Excel / Manual Entry)** — 1px hairline underline, weight 600 active state
- **PDF drop zone** — `CARD_ALT` background, `HAIRLINE` dashed border, no accent colour on drag-over
- **Budget mini-cards** — `CARD_ALT` bg, kicker labels, Inter Tight numbers, no accent strips
- **Department budget rows** — JetBrains Mono for amounts, `COLOURS.AMBER` for 80% threshold progress bar
- **`page.tsx` company picker cards** — 14px radius, hairline border, no top accent strip, no hover shadow
- **`page.tsx` bulk upload + budget sections** — matching card treatment, pill buttons

---

## 2026-07-05 — Restyle Operations Dashboard to Genspark design system

**Files changed:** `app/dashboard/DashboardView.tsx`, `app/dashboard/MonthlyTargets.tsx`

### What changed (visual only — no logic, queries, or data flows touched)

- **62 hardcoded hex values replaced** with `COLOURS.*` tokens from `SharedUI.tsx`
- **Good Stock hero card** — dark ink-900 background, 44px Inter Tight number, matches mobile design spec
- **5 compact KPI cards** — 26px Inter Tight numbers, uppercase kicker labels (10.5px), hairline-border cards, no top-accent strip
- **Card treatment** — borderRadius 14px (RADII.CARD), 24px padding, hairline borders, no shadows
- **Section titles** — `SectionTitle` component from SharedUI (Inter Tight 22px, w600, no border-left bar)
- **Tab strip** — pill tabstrip replacing solid navy pill buttons
- **Alert banner** — Genspark pattern: soft background, 30×30 rounded icon mark with triangle/check SVG, COLOURS tokens
- **Status badges** — `StatusBadge` component (soft background + matching text colour) replacing solid colour + white text
- **JetBrains Mono** — all table body numbers, percentages, dates, bar labels use `var(--font-mono)`
- **Breakage rate rows** — 3-column layout with ultra-thin bar + threshold marker at 1.5%
- **MonthlyTargets** — COLOURS tokens, pill buttons, TRACK progress bars, kicker labels
- **Build:** `npm run build` clean — 0 TypeScript errors

---

## 2026-07-05 — Remove legacy /executive page

- `app/executive/page.tsx` deleted — its functionality was fully merged into `app/home/page.tsx` in earlier sessions.
- `app/executive/EscalationTrafficLights.tsx` moved to `app/lib/EscalationTrafficLights.tsx` (git rename, no history loss). Updated to use COLOURS tokens and Genspark type scale.
- `next.config.ts`: permanent 308 redirect added — `/executive` → `/home`. Bookmarks, old email links, and muscle memory all continue to work.
- `app/api/notifications/digest/route.ts`: email link for admins updated `/executive` → `/home`.
- `app/api/reports/weekly/route.ts`: weekly report link updated `/executive` → `/home`.
- `app/home/page.tsx`: import path updated to `app/lib/EscalationTrafficLights`.
- BLUEPRINT.md updated: folder removed from file tree, route entry updated, notification flow updated.

---

## 2026-07-05 — Pass 3: font fix, colour sweep, number scale

### Font fix (`app/layout.tsx`)
- `Inter_Tight` was loaded without an explicit `weight` array — `next/font/google` defaults to weight 400 only. Weight 600 was not downloaded, causing all display numbers to fall back to system bold (blocky appearance). Fixed: `weight: ["400", "500", "600", "700"]` added to both Inter and Inter Tight.

### Colour sweep (`app/executive/page.tsx` — 91 hardcoded hex → 0)
- All old hex values replaced with COLOURS token references: `#16a34a`/`#059669` → GREEN, `#dc2626` → RED, `#d97706` → AMBER, `#2563eb` → BLUE, `#1e293b` → NAVY, `#e2e8f0`/`#f1f5f9` → HAIRLINE, `#f8fafc` → CANVAS, `#fef2f2` → DANGER_SOFT, `#fffbeb` → WARNING_SOFT.
- Destructure at top of file expanded to include all tokens.
- JSX props fixed: bare `color=GREEN` → `color={GREEN}` etc. (sed stripped quotes; Python regex wrapped with braces).
- Chart legend names cleaned: "Produced (solid green)" → "Produced" etc.
- Company Comparison bars: 18px height, 70% opacity, tabular-nums figures.
- `app/home/page.tsx` was already clean (0 hardcoded hex).

### Number scale calibration (`app/home/page.tsx`)
- Rule: only Good Stock hero (60px) and 6 ops KPI cards (44px) get full display size. Everything else secondary.
- `summaryCard` (Cash Available / Money In / Money Out): 36px → 28px.
- `Mini` component (Receivables totals): 32px → 24px.
- Monthly Receipts/Payments fallback card: 32px → 24px.
- "No plan set" sub-label: `BLUE` → `SLATE` (quiet, not a CTA).

---

## 2026-07-05 — Genspark deep restyle: sidebar + executive dashboard (second pass)

### Sidebar (`app/lib/SidebarLayout.tsx`, `app/lib/pageRegistry.ts`)
- Group structure overhauled: OVERVIEW → FINANCE → DEPARTMENTS → OPERATIONS → SETTINGS → PREFERENCES (bottom)
- "Tasks & Meetings" and "Command Centre" groups eliminated; tasks/calendar/meetings moved to OPERATIONS; profile/minutes stay in OVERVIEW
- Brand area: NAVY square "U" mark + "Unze Group" / "Operations" sub-label (replaced logo image). Image import removed.
- Nav items: 13px Inter, active = NAVY background + white text — no blue left-bar. Hover = `var(--sidebar-hover-bg)`
- Group labels: 10px / 500 weight / 0.12em letter-spacing / uppercase SLATE kickers
- User card: gradient round avatar (blue gradient), 13px/600 name, 11px SLATE role label
- Dark Mode moved into PREFERENCES group (nav item inside scroll area)
- Collapse + Sign Out moved below user card as small tertiary controls

### Executive Dashboard — greeting & hero (`app/home/page.tsx`)
- Greeting header: Inter Tight 44px/600, "Good morning, [name]." — full period. Metadata line: date + role chip below
- Good Stock hero: dark NAVY card, 60px Inter Tight number (44px mobile), white text, footer with "pairs · all plants combined"

### Executive Dashboard — KPI numbers (all pages)
- Card component: 44px Inter Tight numbers (was 22px), -0.02em tracking, 24px padding
- KPICard component: 44px numbers, 24px padding
- Mini component: 32px numbers
- CompanyFinancePanel.summaryCard: 36px numbers
- Bank Facilities figures: 36px per metric (utilisation %, available, seized)
- Investment tiles: 28px (4-tile grid, 2-col on mobile)
- Monthly receipts/payments fallback: 32px
- All tracking updated to -0.02em (was -0.015em)
- SectionTitle (SharedUI): bumped 20px → 22px

### Executive Dashboard — section-specific changes
- **Attention banner chips**: soft chips (coloured text on SOFT bg — DANGER_SOFT/WARNING_SOFT) — no longer white-on-solid
- **Cash Flow Waterfall**: 160px bar area (was 118px), 24px padding, muted bars (55% opacity)
- **Company Comparison**: 18px bar height (was 14px), kicker labels, muted bars (70% opacity)
- **Bank Facilities**: hero layout per bank — kicker name, 36px utilisation/available/seized figures, hairline progress bar
- **Department Scorecard**: editorial rows — left 8px status dot, owner sub-label, right soft chip (SOFT bg + saturated text); no execCard border-top accent
- **Task Load chart**: 220px min height (was 180px), 46px per row (was 38px), muted bars, sober palette

---

## 2026-07-05 — Genspark design system foundation installed

- `app/lib/SharedUI.tsx` — full rewrite of design tokens and shared components to match Genspark design system v1. All exports preserved (backward-compatible). Key changes:
  - COLOURS: NAVY `#1e293b` → Ink 900 `#0F1720`, GREEN `#16a34a` → `#0F7B5F`, AMBER `#d97706` → `#B4791F`, RED `#dc2626` → `#B3261E`, BLUE `#2563eb` → Accent `#3B4CCA`. PURPLE and TEAL remapped to Accent and Success respectively.
  - New tokens: CANVAS, CARD, CARD_ALT, HAIRLINE, TRACK, INK_700, INK_400, INK_300, SUCCESS_SOFT, WARNING_SOFT, DANGER_SOFT.
  - New exports: `cardStyle`, `cardAltStyle` — base card containers.
  - RADII: CARD 12px → 14px. PILL/BUTTON now `999px`. New XS (6px), SM (10px), LG (20px).
  - SHADOWS: CARD now `none` per design spec. Other shadows updated to use `rgba(15,23,32,…)`.
  - `StatusBadge` / `PriorityBadge`: coloured-text chip on soft background (was white text on solid colour).
  - `SectionTitle`: Inter Tight 20px/600, no border-left accent.
  - `tableHeaderStyle`: uppercase label style, card-alt background.
  - `labelStyle`: uppercase kicker style.
  - `primaryButtonStyle`: pill radius, 13px.
- `app/layout.tsx` — three `next/font/google` fonts added (Inter, Inter Tight, JetBrains Mono). CSS variables `--font-display`, `--font-sans`, `--font-mono` injected on `<html>`. No npm install required — `next/font` is built into Next.js. Source Sans 3 retained for backward compatibility.
- `designs/DESIGN_MAP.md` — permanent reference mapping all 23 Genspark HTML design files to their corresponding code files.
- `BLUEPRINT.md` — Design System section fully rewritten to reflect new tokens, type scale, and component table.
- No individual page files changed — foundation only.

---

## 2026-07-03 (session continued 4) — Meetings sort order fix

- `app/meetings/page.tsx` — when grouped by department, month groups were sorted oldest-first (a→z). Fixed to newest-first (b→a), matching the date-grouped view.

---

## 2026-07-03 (session continued 3) — Custom DateInput component, all date pickers replaced

**What changed:**
- Built `app/lib/DateInput.tsx` — custom text input that shows and accepts DD/MM/YYYY, auto-inserts slashes as you type, validates on blur with red border, and calls onChange with YYYY-MM-DD so all DB code is unchanged.
- Root cause: Safari ignores `lang="en-GB"` for native `<input type="date">` and always shows MM/DD/YYYY regardless. The custom component bypasses this entirely.
- Replaced all 29 native date inputs across 14 files: tasks, receivables, PA dashboard, home page, executive page, daily entry, receivables section, calendar, meetings, my-minutes, finance, opening balances, stock manage, investments, HR/Audit/Taxation department dashboards.
- Rule added to CLAUDE.md: never use `<input type="date">` again — always use `<DateInput>` from `app/lib/DateInput.tsx`.

---

## 2026-07-03 (session continued 2) — DD/MM/YYYY date pickers fixed globally

**Root cause identified and fixed:**
- All `<input type="date">` fields were showing MM/DD/YYYY because the root HTML element had `lang="en"` (American English). Changed to `lang="en-GB"` in `app/layout.tsx`. One line, fixes every date picker across the entire app — tasks, receivables, finance, stock, production, meetings, calendar, investments.

---

## 2026-07-03 (session continued) — Data retention + UX tidying

**What changed:**
- **90-day window anchored to selected date** (`home/page.tsx`, `executive/page.tsx`) — when viewing a past date, the ops entry query window now extends 90 days before *that date*, not before today. Means you can view any date in history without the production/dispatch context being cut off.
- **Daily entry PO dropdown** (`production/ProductionForm.tsx`) — replaced stacked PO selection buttons with a compact `<select>` dropdown. Tidier, especially when multiple POs exist.
- All data is retained indefinitely in the database. No automatic deletion anywhere.

---

## 2026-07-03 — Historical date selector: investments, cash, and date format enforcement

**What changed:**

- **Investment portfolio now respects selected date** — when changing the date on the CEO home page, the portfolio value shown is calculated using the price recorded in `price_history` on or before that date (most recent price available). Previously it always showed today's value regardless of the date selected.
- **Cash positions now respect selected date** — `daily_cash_position` now filtered `<= selectedDate` so the finance section shows the cash balance as it stood on the selected day.
- **Cash plan and budget month** now derived from `selectedDate` (not today) — plan context matches the month being viewed.
- **DD/MM/YYYY date format enforced globally** — fixed 6 locations where raw `YYYY-MM-DD` database strings were rendered directly (attention items, investment price date, search results meeting dates, and two email API routes). Rule added permanently to `CLAUDE.md` and `dateUtils.ts`.

**Performance improvements (from previous session):**
- `app/home/page.tsx`: sessionStorage cache (2-min TTL, per date key), 90-day floor on unbounded ops queries, explicit column lists, parallelised dept health checks
- `app/dashboard/DashboardView.tsx`: 90-day floor, explicit column lists, task limit 200
- `app/executive/page.tsx`: same 90-day floor + column trims
- `app/pa/page.tsx`: explicit column lists, meeting query trimmed
- `app/lib/AuthWrapper.tsx`: global search cache — fetch once per session, filter in memory
- `supabase/053_performance_indexes.sql`: 13 DB indexes applied (entry_date, status, assigned_to_email, company_id, position_date, etc.)

**Database changes:** Migration 053 (performance indexes) — applied manually.

---

## 2026-07-02 (session 2) — Bug fixes: edit permissions, receivables, Gmail inbox

**Bugs fixed:**
- Ops Managers (Asif, Usman, Yahya) couldn't delete production/dispatch/breakage entries — `canDelete` was hardcoded to Nadeem only; `ProductionForm` also wasn't fetching `department` so `canAccessDailyEntry` always failed for ops managers
- `canEditReceivables` was missing `isAdminTier` — CEO/Admin couldn't edit or delete receivables
- Finance inbox scanner was still trying `khuram1901@gmail.com` (token deleted) causing silent failures every run

**New:**
- Inline Edit + Delete on every receivables bill card — Edit button opens form to amend customer, amount, dates, refs, bill type, notes; Delete with confirmation prompt
- `/api/finance/setup-gmail-filter` — one-shot route to create `cockpit-cash` Gmail label + filter on k.saleem@unzegroup.com automatically
- Gmail filter auto-labels incoming emails with "Cash Flow", "Bank Position", or "cash sheet" in subject + attachment

**Database changes:**
- Migration 051: expand DELETE RLS on production_entries/dispatch_entries/breakage_entries from Nadeem-only to `is_ops_manager()` (all 4 Ops Managers)

---

## 2026-07-02 — Features 1-2, 7-9, Google OAuth fix, edit permissions

**Features built:**
- Feature 1: PO Delivery Forecast — estimated completion date + daily rate on stock summary + stock page
- Feature 2: Authority Letter Expiry Tracker — migration 049 (expiry_date), amber/red badges, warning banner, dashboard alerts
- Feature 7: Contractor Performance Tracker — new API route + performance cards on manage page
- Feature 8: WhatsApp Dispatch Notification — auto-email to Ops Managers with pre-filled WhatsApp button on every dispatch
- Feature 9: Monthly PO Progress Report — cron route `/api/reports/monthly-po`, runs 1st of each month, per-plant/PO email to Ops Managers + Admin

**Edit permissions for Ops team:**
- PATCH routes added for authority-letters, contractors, dispatch-records, production-allocations
- Edit Letters / Edit Dispatches / Edit Contractor UI added to `/stock/manage`
- All four Ops Managers (asif, usman, yahya, nadeem @unze.co.uk) can amend mistakes

**Google OAuth fix:**
- Root cause: `GOOGLE_REDIRECT_URI` was blank on Vercel production
- Fixed: set to `https://unze-cockpit.vercel.app/api/google/callback`
- Fixed: refresh_token overwrite bug in both callback routes
- Consolidated to single account: k.saleem@unzegroup.com for calendar + Gmail + notifications + backup
- Migration 050: deleted old khuram1901@gmail.com token from DB

**Database changes:**
- Migration 049: `alter table authority_letters add column if not exists expiry_date date`
- Migration 050: `delete from google_oauth_tokens where user_email = 'khuram1901@gmail.com'`

---

## 2026-07-01 00:00 — Initial blueprint created

**Files changed:**
- `BLUEPRINT.md` — created from scratch (initial run of blueprint-keeper agent)
- `CHANGELOG.md` — created from scratch

**Database changes:**
- All tables documented; last migrations applied were 048 (purchase_orders, production_allocations, contractors, po_contractors, authority_letters, dispatch_records) and 049 (authority_letters.expiry_date column)

**Behaviour changes (most recent, as of initial blueprint):**

Stock system (built 2026-07-01):
- Plant → PO → Contractor → Authority Letter → Dispatch Record hierarchy fully operational
- `/stock` page: collapsible tree view for all Ops + Admin users
- `/stock/manage` page: create POs, contractors, authority letters for Ops Managers + Admin
- `/production` daily entry now includes PO card picker (production allocation) and authority letter number lookup (dispatch)
- Dispatch dual-write: `dispatch_entries` (legacy) + `dispatch_records` (stock system) — both writes permanent
- "Stock by Customer PO" section added to Ops Dashboard
- Sidebar: "Operations Dept" page removed; "Stock" and "Manage POs" added

Operations (built 2026-06-29):
- Task ownership enforced — `assigned_by_email` column added; protected tasks (created by Admin/CEO/PA) restrict assignee edit/delete
- Due date required on all tasks
- Receivables kanban with HTML5 drag-and-drop
- `canEditReceivables` restricted to Ops dept only (Finance managers view-only)
- 9 receivable stages re-seeded; `bill_type` column added (Normal, Sales Tax, Retention)
- Overflow fix: `overflowX: hidden` removed from SidebarLayout and all `<main>` tags
- 49 upgrades across security, database, performance, UI, and new features (see memory/blueprint-complete.md for full list)

Permission model (migration 027):
- `is_admin_or_exec()` now aliases `is_admin_tier()` — Executive/PA no longer gets admin-tier DB access
- `is_privileged()` created for operational tables (tasks, members) that PA should access
- Finance/receivables/OAuth RLS explicitly excludes Executive role

**Decisions:**
- "General" renamed "Executive Office" everywhere — banned from codebase
- Inline styles (not Tailwind) established as the permanent styling approach
- `isAdminTier` vs `canEditFinance` distinction documented and enforced
- Dual-write for dispatch locked in permanently
- PA (Executive role) financial exclusion enforced at permission, RLS, and UI levels

---

---

## 2026-07-04 — Performance optimisation (DB-side calculations)

**Goal:** Move data calculations out of the browser and into Supabase (Postgres). Pages now receive small pre-aggregated results instead of large raw datasets.

**Files changed:**
- `supabase/054_portfolio_summary_rpc.sql` — NEW migration (applied)
- `supabase/055_plant_kpi_rpc.sql` — NEW migration (applied)
- `supabase/056_receivables_summary_rpc.sql` — NEW migration (applied)
- `app/investments/page.tsx` — date selector added; RPC replaces raw fetch
- `app/home/page.tsx` — plant KPIs, investments, receivables, dept health all use RPCs/COUNTs
- `app/executive/page.tsx` — plant KPIs and investments use RPCs; 15-query → 9-query load
- `app/dashboard/DashboardView.tsx` — plant KPIs use RPC; stock tab uses single request for all plants

**Database changes:**
- Migration 054: `get_portfolio_summary_as_of(as_of date)` — DISTINCT ON price_history + holdings aggregate; replaces two-table JS fetch
- Migration 055: `get_plant_kpis(as_of_date, month_start, month_end)` — replaces 7 raw 90-day table fetches; returns one row per active plant with opening balances, cumulative totals, on-date totals, MTD totals, entered_on_date
- Migration 056: Three receivables RPCs — `get_receivable_rag_by_customer()`, `get_receivable_aging_totals()`, `get_receivable_aging_by_customer()` — replace full select("*") + JS aggregation loops

**Behaviour changes:**
- Investments page: date selector (DateInput) lets CEO view portfolio as of any past date; "Back to today" button + blue historical banner
- Home page plant summary: closing stock, breakage, entered-today indicators unchanged — same numbers, now computed in Postgres
- Receivables section: RAG totals, aging buckets, customer groupings unchanged — verified PKR 171,995,700 across all three RPCs matches
- Ops/Finance Manager briefing: task open/overdue counts from COUNT queries (zero rows downloaded)
- Stock tab on Ops Dashboard: single HTTP request for all plants instead of one per plant
- Monthly production/dispatch/breakage arrays kept for daily ops chart (per-day breakdown) and quarterly escalation checks

**Performance impact:**
- Home page: ~15 queries → ~9 queries; raw row downloads reduced from thousands to tens
- Executive page: ~15 queries → ~9 queries; 7 raw 90-day dumps eliminated
- Ops Dashboard: ~11 queries → ~6 queries; stock tab N-requests → 1
- Receivables: 2 full-table fetches → 3 RPC calls returning ~10 rows each

**Verification:** All RPC outputs cross-checked against raw table data — all matched. No data loss.

