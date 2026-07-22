-- Migration 189: Fix Khizar's email casing in members table
-- Root cause: Supabase Auth always returns emails in lowercase.
-- AuthWrapper queries members with .eq("email", user.email), which is
-- case-sensitive. Khizar's row had "Khizar@baranh.pk" (capital K), so the
-- query never matched → userCtx stayed null → sidebar showed only Home.
--
-- Also normalise ALL member emails to lowercase to prevent recurrence.

UPDATE members
SET email = lower(email)
WHERE email != lower(email);
