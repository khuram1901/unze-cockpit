-- Phase 4 hardening: the 11 new RPCs (migrations 224-226) are called only
-- from API routes via the service role — nothing client-side. Revoke
-- execute from anon/authenticated so they can't be called from PostgREST
-- without signing in. (The security advisor flags ~190 older functions the
-- same way — that wider cleanup is out of Phase 4 scope.)
-- Applied via Supabase MCP 30/08/2026.
do $$
declare fn text;
begin
  foreach fn in array array[
    'get_po_letter_totals(uuid, uuid)',
    'get_letter_dispatched_totals(uuid, uuid)',
    'close_po_if_fully_dispatched(uuid)',
    'get_entry_allocation_totals(uuid, uuid)',
    'get_po_produced_totals(uuid, uuid, uuid)',
    'get_plant_authority_letters(uuid)',
    'get_authority_letter_lookup(text, uuid)',
    'get_folderit_overview(text[])',
    'get_ifpl_pnl_line_sums(date, text[])',
    'get_rest_pnl_line_sums(text, date, text[])',
    'get_utpl_pnl_line_sums(uuid, date, text[])'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
  end loop;
end $$;
