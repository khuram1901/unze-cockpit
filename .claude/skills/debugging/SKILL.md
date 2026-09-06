---
name: debugging
description: "Use for errors, broken builds, failed tests, regressions, console errors, unexpected behavior, and bug investigation."
---

# Debugging Skill

Use this skill when the user reports an error, broken behavior, failed build, failed test, console error, or regression.

## Process

1. Identify the exact symptom.
2. Read the actual error message or logs if available.
3. Use Graphify first if the bug relates to project code, architecture, data flow, or file relationships.
4. Locate the smallest relevant area of code.
5. Form a hypothesis.
6. Make the smallest safe fix.
7. Run or suggest the relevant verification:
   - typecheck
   - lint
   - tests
   - local browser check
   - build
8. Explain:
   - root cause
   - fix made
   - files touched
   - what to test next

Do not guess. Do not make broad rewrites unless the user explicitly asks.
