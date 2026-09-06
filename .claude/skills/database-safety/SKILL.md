---
name: database-safety
description: "Use for database schema changes, SQL, migrations, RLS, permissions, data integrity, queries, and production data risk."
---

# Database Safety Skill

Use this skill for database, schema, SQL, migrations, RLS, permissions, queries, data models, data cleanup, and production data risks.

## Rules

Before changing database-related code:

1. Identify affected tables, columns, relationships, and queries.
2. Check existing schema, migrations, models, and API usage.
3. Consider backward compatibility.
4. Avoid destructive changes unless explicitly approved.
5. Warn before suggesting:
   - dropping columns/tables
   - deleting data
   - changing primary keys
   - changing permissions
   - weakening RLS or auth checks
6. For permission-sensitive features, check:
   - read access
   - create access
   - update access
   - delete access
   - admin-only paths
   - cross-tenant/customer leakage
7. Prefer migrations that are reversible or safely staged.
8. Explain data risk clearly.
