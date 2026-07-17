-- Migration 105: whatsapp_auto_remind flag on tasks.
--
-- Same honest limitation as the finalised mockup flagged: this only
-- captures intent. There is no automatic sender yet — every WhatsApp
-- reminder today (and after this migration) is still a manual
-- click-to-open link. Actually firing a message by itself the moment a
-- task goes overdue needs the WhatsApp Business API setup (Meta account,
-- access token, approved template) that is still sitting on Khuram's side
-- — see the pending WhatsApp send-digest/webhook work. This column just
-- means the toggle has somewhere real to save to, wired the moment that
-- API access exists.
--
-- Apply via Supabase SQL Editor, after 098-104.

begin;

alter table public.tasks add column if not exists whatsapp_auto_remind boolean not null default false;

commit;
