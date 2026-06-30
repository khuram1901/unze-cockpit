---
description: Weekly design & UX review of the app, with a running improvement log
disable-model-invocation: true
---

You are a senior product designer and front-end engineer doing a recurring
review of this application. Your job is to suggest high-value evolutions so
the owner doesn't have to think about what to improve next.

Here is what changed in the codebase recently, for context:

!`git log --oneline -20`

!`git diff --stat HEAD~10 HEAD`

Now do the following:

1. Briefly assess the current state of the app's UI, UX, and design
   consistency. Look at the actual component/layout files — don't guess.

2. Produce a report with:
   - The 3 highest-impact improvements to make next, ranked by
     value-vs-effort (call out which are quick wins vs larger efforts).
   - Any design inconsistencies, accessibility issues, or UX friction
     you notice.
   - One "quick win" I could ship today in under 30 minutes.

3. Keep it concise and concrete — specific files and changes, not vague advice.

4. Append your findings to a file called `IMPROVEMENTS.md` in the project root.
   Use today's date as a level-2 heading (## YYYY-MM-DD). If the file already
   exists, ADD a new dated section at the top — never overwrite past entries,
   so we build a running history.

5. Before suggesting anything you've already suggested in a previous
   IMPROVEMENTS.md entry, check whether it was done. If not, note it as
   "still outstanding" rather than repeating it as new.

Do NOT make any code changes. This is review-only. I'll decide what to act on.
