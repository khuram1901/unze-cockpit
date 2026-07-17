-- Migration 121: Only Admin-tier can assign Admin/Executive roles to a member
--
-- Found during the 15 Jul 2026 full-app audit while looking at
-- /api/members/invite: that route doesn't actually write the `members`
-- row at all (it only creates the Supabase Auth account and sends the
-- welcome email) — the real insert/update happens directly from the
-- browser (MembersManager.tsx's addMember()/updateMember()), protected
-- only by RLS. The existing `members_insert`/`members_update` policies
-- (via can_manage_members_rls(), which is just is_privileged()) already
-- correctly require Admin-tier OR Executive — but neither policy checks
-- WHICH role is being assigned. The app's own `assignableRoles()` in
-- lib/permissions.ts says an Executive should only ever be able to
-- assign "Manager" or "Member" — that restriction only lived in the
-- client-side dropdown. An Executive (PA) could bypass it entirely by
-- calling supabase.from("members").insert/update({ role: "Admin", ... })
-- directly, self-escalating or escalating anyone else to Admin.
--
-- This adds the missing check at the database level, mirroring
-- assignableRoles() exactly: Admin-tier can assign any role; Executive
-- can only assign Manager/Member; everyone else can't assign any role
-- (already blocked by can_manage_members_rls() before this even runs).
--
-- Apply via Supabase SQL Editor, after 120.

begin;

create or replace function public.can_assign_member_role(target_role text)
returns boolean as $$
begin
  if public.is_admin_tier() then return true; end if;
  if public.is_privileged() then return target_role in ('Manager', 'Member'); end if;
  return false;
end;
$$ language plpgsql stable security definer set search_path = public;

drop policy if exists members_insert on public.members;
create policy members_insert on public.members
  for insert
  with check (public.can_manage_members_rls() and public.can_assign_member_role(role));

drop policy if exists members_update on public.members;
create policy members_update on public.members
  for update
  using (public.can_manage_members_rls())
  with check (public.can_assign_member_role(role));

commit;
