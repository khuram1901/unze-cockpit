-- Migration 150: remove can_view_exceptions from member_permissions
-- The standalone Exceptions page has been deleted (18/07/2026).
-- Exception alerting is now handled by the notification bell
-- ("Needs explanation" count) and the Tasks page filter pill.
-- No separate page or permission is needed.

alter table member_permissions
  drop column if exists can_view_exceptions;
