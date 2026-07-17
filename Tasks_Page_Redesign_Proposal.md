# Tasks page redesign — design proposal (Quire-inspired)

This is a design-only document. Nothing here has been built yet — it's for you to react to before I write a single line of code, exactly as you asked.

## Where the current page already stands

Your `/tasks` page is not a blank slate — it already does several things Quire is known for. It has five switchable views (by department, by week, by month, by quarter, and a due-date timeline), an overdue-tasks banner, CSV import/export, and a WhatsApp reminder button per task. On top of that it has something Quire doesn't: a built-in accountability workflow. When someone can't complete a task on time, it forces them into a "Waiting Reply" state where they must submit a written explanation, a corrective action, and an expected recovery date before it can be closed — and only a reviewer (you, or whoever you delegate) can accept or reopen it. That workflow is the heart of how you manage by exception, and nothing in Quire replaces it — it should stay exactly as it is.

What the page is missing, compared with Quire, falls into three buckets: breaking a task into steps, seeing work as a visual board instead of a list, and small speed conveniences. Below is my recommendation for each one, always with the trade-off spelled out, so you can pick rather than have me pick for you.

## Recommended — worth building

**Subtasks (one level of checklist items under a task).** Quire allows subtasks nested infinitely deep. I'd recommend capping it at one level — a task with a flat checklist of steps underneath it — rather than true unlimited nesting. The reason: unlimited nesting is genuinely useful for large creative/engineering teams breaking work into hundreds of pieces, but for a CEO-oversight tool where each task already has a single accountable owner and a due date, one level covers the real case ("this task has 5 steps, 3 are done") without the added UI and database complexity of a recursive tree that has to be built, expanded, collapsed, and reordered at any depth.

**A board (Kanban) view**, alongside your existing five views — cards move across Not Started / In Progress / Waiting Reply / Completed columns. Low cost to add, since the status field already exists and drives your current colour-coding; it's mostly a new way to arrange data you already have. The mockup above shows roughly how this would look, including a subtask progress bar on the card.

**Tags**, separate from department/project. Right now a task belongs to exactly one department. Tags let you mark something as, say, "Board-level" or "Audit follow-up" across departments without changing who owns it. Small addition — one join table.

**Quick-add shorthand** when creating a task (type the task, then `@Nadeem` to assign, `#Finance` for department, a date shorthand for due date) instead of filling every dropdown. Pure convenience, moderate effort, biggest win if you or your PA create tasks often through the day.

**Moving the page's number-crunching into the database.** This isn't optional and isn't really about Quire — it's the house rule (all aggregation must happen in Postgres, never in JavaScript). The current page currently does its department/weekly/monthly/quarterly grouping in the browser, which was fine when the task list was small but is exactly the pattern we've been fixing everywhere else. Any rebuild of this page should replace that with a proper RPC, the same way we did for guarantees and dividends.

## Optional — only if you're excited about it

**Task dependencies** ("this can't start until that finishes") — genuinely useful for multi-step recovery plans, but adds real complexity to due-date and status logic. I'd only build this if you can picture using it regularly.

**A dedicated calendar view** (drag a task onto a day). Quire has one; you already have the due-date timeline, which does a similar job in a lighter way. I'd treat this as a "nice to have later" rather than part of the first rebuild.

**Multiple assignees per task.** Quire supports this; your current model deliberately has one accountable owner per task, which matches how you've described wanting single-throat-to-choke accountability. I'd keep it single-owner unless you specifically want shared ownership on some tasks.

**Structured comments instead of the running notes field.** Right now notes are just a timestamped log appended to one field. A proper comment thread (with @mentions) is a bigger, cleaner version of the same idea — worth doing eventually, not urgent.

**Favourites/follow, multi-select batch actions, keyboard shortcuts.** All genuinely nice power-user polish. Worth adding once the core rebuild is settled and you know how the team actually uses the new page day to day.

## Recommended to skip

Quire also has a long list of features I don't think are worth building here, mostly because they solve problems that come with large teams and open collaboration, not a small leadership team managing by exception: unlimited-depth nesting, a full custom-fields builder (if you need a new field, that's a quick ask, not something the team needs to configure themselves), a live time-tracking timer (you already log minutes manually, which is enough), per-task documents/wiki pages, Sublists and Task Bundles, email-to-task, and the Slack/Teams/Zapier/GitHub/mobile-app/Siri integrations. Several of those also carry an ongoing cost or a new paid service, which the project rules ask me to flag before adding. I'd also skip Quire's public "share with clients" link entirely — it doesn't fit a dashboard with financial data and role-based access controls built in from day one.

## What I'd need from you

Have a look at the board/tree mockup above, then tell me, in plain terms: yes to subtasks and board view, yes/no to tags and quick-add, and whether any of the "optional" items jump out at you. Once you've picked, I'll turn this into an actual implementation plan (including the database migration for subtasks and the RPC rebuild) before writing any code.
