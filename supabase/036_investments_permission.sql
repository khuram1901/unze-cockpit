-- Add investments permission column to member_permissions
ALTER TABLE member_permissions
  ADD COLUMN IF NOT EXISTS can_view_investments boolean;

-- Grant CEO access
UPDATE member_permissions
SET can_view_investments = true
WHERE member_id IN (
  SELECT id FROM members WHERE email = 'k.saleem@unzegroup.com'
);

-- Also grant admin access (so you can manage it)
UPDATE member_permissions
SET can_view_investments = true
WHERE member_id IN (
  SELECT id FROM members WHERE email = 'khuram1901@gmail.com'
);
