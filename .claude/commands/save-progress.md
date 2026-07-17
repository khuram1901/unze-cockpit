---
description: Save session progress to memory — records all changes, decisions, and rules from this session
---

You are a meticulous record-keeper for the Unze Dashboard (PulseDesk) project.
Your job is to review what was done in this session and ensure the project's
persistent memory is complete and up-to-date.

## Memory location

All memory files live at:
`/Users/jamesbond/.claude/projects/-Users-jamesbond-Documents-Apps-Unze-Dashboard/memory/`

The index is `MEMORY.md` in that directory.

## What to do

1. **Read the current state** — read `MEMORY.md` and skim existing memory files
   to understand what's already recorded.

2. **Review what happened this session** — run these commands:
   - `git log --oneline -15` to see recent commits
   - `git diff HEAD~5 --stat` to see which files changed
   - Read the blueprint at `memory/blueprint-complete.md` for the master reference

3. **Identify what's new or changed** — look for:
   - New features shipped (pages, components, API routes)
   - Permission or access control changes
   - Data model changes (new tables, new columns, new scoping rules)
   - Business logic decisions (thresholds, RAG rules, status flows)
   - User feedback or preferences expressed
   - Architecture decisions made
   - Bug fixes that reveal important constraints
   - Company/finance scoping changes

4. **Update or create memory files** as needed. Each memory file uses this format:

   ```markdown
   ---
   name: short-kebab-case-slug
   description: "one-line summary — specific enough to judge relevance"
   metadata:
     type: user | feedback | project | reference
   ---

   Content here. For feedback/project types, structure as:
   - Rule/fact first
   - **Why:** the motivation
   - **How to apply:** when/where this matters

   Related: [[other-memory-name]]
   ```

   Memory types:
   - **user** — who the user is, their role, preferences, expertise
   - **feedback** — corrections or confirmations about how to work ("do this", "don't do that")
   - **project** — ongoing work, goals, decisions, shipped features, business rules
   - **reference** — pointers to external systems (Linear, Slack, Grafana, etc.)

5. **Update the blueprint** (`blueprint-complete.md`) if any permission gates,
   page behaviors, data scoping rules, or role logic changed. The blueprint is
   the MASTER reference — it must stay current.

6. **Update MEMORY.md** index — add pointers for any new memory files. Keep
   entries under 150 chars, organized by section. Never exceed 200 lines.

## What NOT to save

- Code patterns derivable from reading current files
- Git history (use `git log` instead)
- Debugging details or temporary state
- Anything already in CLAUDE.md
- Ephemeral task details only useful in this session

## Rules

- Never duplicate — check if a memory exists before creating a new one
- Update existing memories rather than creating near-duplicates
- Convert relative dates to absolute (e.g., "yesterday" → "2026-06-27")
- Link related memories with [[name]] syntax
- Keep MEMORY.md concise — one line per entry, organized by section
- The blueprint is the most important file — always verify it's current

Report what you saved/updated when done.
