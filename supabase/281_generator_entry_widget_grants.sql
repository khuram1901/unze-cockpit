-- Grant admin_ops.generators_entry widget access to generator entry users
-- Applied: 2026-10-18
-- FK: member_widget_overrides.member_id → members.id (NOT auth.users)
-- ROLLBACK: DELETE FROM member_widget_overrides WHERE widget_key = 'admin_ops.generators_entry';

INSERT INTO member_widget_overrides (member_id, widget_key, visible)
SELECT m.id, 'admin_ops.generators_entry', true
FROM members m
WHERE m.email IN (
  'k.saleem@unzegroup.com',
  'akhlaq@unze.co.uk',
  'sunaina@unze.co.uk',
  'admin.officer@unze.co.uk',
  'admin.manager@unze.co.uk'
)
ON CONFLICT (member_id, widget_key) DO UPDATE SET visible = true, updated_at = now();
