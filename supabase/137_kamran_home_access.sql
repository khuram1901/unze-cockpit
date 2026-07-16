-- 137: Kamran needs can_view_executive_dashboard = true now that /home is
-- his real dashboard
--
-- Part of retiring the separate /ceo-kamran page (16 Jul 2026) in favour of
-- everyone landing on the same /home, scoped by company. His
-- can_view_executive_dashboard override has been false since the
-- sync_member_permissions trigger bug (fixed in migration 135) reset it —
-- harmless while he had his own dedicated page that didn't check this flag,
-- but would lock him out of everything once /ceo-kamran is gone and /home
-- is the only dashboard. Operations/PA dashboard stay off, per Khuram's
-- 16 Jul confirmation that Kamran shouldn't see UTPL operations data.

update member_permissions set
  can_view_executive_dashboard = true,
  updated_at = now()
where member_id = (select id from members where email = 'kamran@unze.co.uk');
