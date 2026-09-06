---
name: code-review
description: "Use before finalizing code changes. Reviews diffs for correctness, regressions, security issues, test coverage, type errors, and unintended side effects."
---

# Code Review Skill

Use this skill before presenting code changes as complete.

## Review checklist

1. Confirm the change solves the actual user request.
2. Check whether unrelated files were modified.
3. Check for broken imports, type errors, lint errors, and obvious runtime errors.
4. Check for duplicated logic or unnecessary complexity.
5. Check whether existing architecture and naming conventions were followed.
6. Check whether tests should be added or updated.
7. Check whether documentation or CLAUDE.md should be updated.
8. Check for security/privacy issues:
   - leaked secrets
   - unsafe auth checks
   - missing permission checks
   - user data exposure
   - unsafe file handling
9. Summarize:
   - what changed
   - why it changed
   - risk level
   - what the user should test next

Prefer small, targeted changes. Do not rewrite unrelated code.
