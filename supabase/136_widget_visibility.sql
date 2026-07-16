-- 136: Widget-level visibility overrides
--
-- Page-level toggles (member_permissions.can_view_executive_dashboard,
-- can_view_operations_dashboard, etc.) control whether someone can reach a
-- whole page. This table goes one level deeper: individual sections/widgets
-- *within* a page — the cash flow waterfall, investments card, department
-- scorecard, and so on — that Khuram can turn on or off per person,
-- independent of whether that person can see the page at all.
--
-- Sparse by design: one row per (member, widget) only when Khuram has set
-- a non-default value for that person. No row = use the widget's built-in
-- default (see app/lib/widgetRegistry.ts). This avoids member_permissions
-- growing a new column every time a widget gets instrumented.

create table if not exists public.member_widget_overrides (
  member_id uuid not null references public.members(id) on delete cascade,
  widget_key text not null,
  visible boolean not null,
  updated_at timestamptz not null default now(),
  primary key (member_id, widget_key)
);

alter table public.member_widget_overrides enable row level security;

-- Mirrors member_permissions' RLS shape: only admin-tier (Admin/CEO) can
-- read or write rows directly via RLS. A member's own client never queries
-- this table directly — self-reads go through /api/me/widgets, which uses
-- the service-role key and checks auth.requireAuth() itself, exactly like
-- /api/me/permissions already does for member_permissions.
create policy member_widget_overrides_admin on public.member_widget_overrides
  for all using (is_admin_tier()) with check (is_admin_tier());
