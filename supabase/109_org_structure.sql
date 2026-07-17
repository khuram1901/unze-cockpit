-- Migration 109: Org structure — manager_id + is_director
--
-- Part of building the reporting-line feature Khuram asked for: Submitted
-- tasks auto-routing to a person's HOD, HOD overdue alerts, and an org
-- chart. Prerequisite research this session found the existing
-- `manager_name` column was a free-typed text field, never once populated
-- (0 of 15 members) and with no UI anywhere to set it — dead weight, not a
-- workflow waiting to be turned on. Replacing it with a proper
-- self-referencing link.
--
-- Apply via Supabase SQL Editor.

begin;

-- A real link to another member's account (not a typed name — avoids the
-- exact ambiguity risk that caused the task-assignment bugs fixed earlier
-- this session, e.g. the two people named "Nadeem" already in the system).
-- Nullable: not everyone has a manager yet (e.g. Khuram and Kamran, at the
-- top of the chain, have none).
alter table public.members
  add column if not exists manager_id uuid references public.members(id) on delete set null;

create index if not exists members_manager_id_idx on public.members (manager_id);

-- Second organisational tier above HOD, per Khuram: Team member -> HOD ->
-- Director -> Khuram/Kamran. A person can be both is_hod and is_director
-- if they head their own department AND oversee other HODs; the two flags
-- are independent, not mutually exclusive.
alter table public.members
  add column if not exists is_director boolean not null default false;

-- manager_name was added at some point but never wired to any UI and never
-- populated — confirmed via a live query (0 of 15 rows) and a full-codebase
-- search (zero references outside the schema). Safe to drop; manager_id is
-- its intended replacement, built properly this time.
alter table public.members
  drop column if exists manager_name;

commit;
