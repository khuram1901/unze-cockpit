---
name: refactor-safety
description: "Use for refactoring, reorganizing files, simplifying components, extracting functions, or changing architecture while preserving behavior."
---

# Refactor Safety Skill

Use this skill when refactoring code.

## Rules

1. Preserve behavior unless the user explicitly asks to change it.
2. Use Graphify first to identify dependencies and affected areas.
3. Avoid large rewrites.
4. Prefer small, reversible refactors.
5. Keep public APIs stable unless approved.
6. Do not rename files, exports, routes, or database fields without checking references.
7. After refactoring, review:
   - imports
   - tests
   - types
   - routes
   - data flow
   - permissions
8. Explain what stayed the same and what changed internally.
