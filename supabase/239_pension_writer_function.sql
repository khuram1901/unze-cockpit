-- ============================================================
-- 239: Narrow write path for the fetch-pension-prices workflow
-- ============================================================
-- Problem: the GitHub Actions workflow (fetch-pension-prices.yml) used
-- SUPABASE_SERVICE_ROLE_KEY to upsert into pension_fund_prices.
-- If the Actions runner or the secret is ever compromised, the attacker
-- has unrestricted read/write access to the entire database.
--
-- Solution: a SECURITY DEFINER function that is the ONLY write path for
-- price ingestion. It accepts a caller-supplied secret which must match
-- the app.pension_writer_secret setting stored in the database. The workflow
-- now uses the ANON key + this function; the service role key is no longer
-- needed in GitHub Actions at all.
--
-- Setup (one-time, after running this migration):
--   1. Generate a secret:  openssl rand -hex 32
--   2. In Supabase Dashboard → Database → Extensions → pg_settings  OR
--      via psql: ALTER DATABASE postgres SET app.pension_writer_secret = '<secret>';
--      (or use Supabase's "Database Settings" → "Custom database config")
--   3. Add that same value as GitHub secret PENSION_WRITER_SECRET.
--   4. Remove the SUPABASE_SERVICE_ROLE_KEY secret from the workflow
--      (keep it in the repo for other uses, but remove from this workflow).
-- ============================================================

-- Grant anon the ability to call this RPC via the REST API.
-- The function itself enforces the secret — anon has no other access.
create or replace function ingest_pension_price(
  p_isin        text,
  p_price       numeric,
  p_price_date  date,
  p_source      text,
  p_secret      text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
begin
  -- Read the expected secret from the database configuration.
  -- If not set, reject immediately rather than silently accepting.
  v_expected := current_setting('app.pension_writer_secret', true);
  if v_expected is null or v_expected = '' then
    raise exception 'pension writer secret not configured on the database server'
      using errcode = 'insufficient_privilege';
  end if;

  -- Constant-time comparison to prevent timing-based secret inference.
  -- pg_crypto's hmac() is used as a side-channel-resistant equality check.
  if encode(hmac(p_secret, v_expected, 'sha256'), 'hex')
       != encode(hmac(v_expected, v_expected, 'sha256'), 'hex') then
    raise exception 'invalid pension writer secret'
      using errcode = 'insufficient_privilege';
  end if;

  -- Validate inputs before writing.
  if p_isin is null or length(trim(p_isin)) < 12 then
    raise exception 'invalid ISIN: %', p_isin;
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'invalid price: %', p_price;
  end if;
  if p_price_date is null or p_price_date > current_date then
    raise exception 'invalid price_date: %', p_price_date;
  end if;

  -- Upsert exactly one row. The function cannot touch any other table.
  -- Column name is price_gbp (not price) — matches the pension_fund_prices DDL.
  insert into public.pension_fund_prices (isin, price_gbp, price_date, source)
  values (p_isin, p_price, p_price_date, coalesce(p_source, 'unknown'))
  on conflict (isin, price_date)
  do update set
    price_gbp = excluded.price_gbp,
    source    = excluded.source;
end;
$$;

-- pgcrypto is already installed in the extensions schema on this project.
-- create extension if not exists pgcrypto schema extensions; -- idempotent if needed

-- Allow the anon role to call this function via the REST API.
-- The secret parameter ensures only the authorised workflow can write data.
grant execute on function ingest_pension_price(text, numeric, date, text, text) to anon;

-- Revoke from other roles to be explicit.
revoke execute on function ingest_pension_price(text, numeric, date, text, text) from public;
grant  execute on function ingest_pension_price(text, numeric, date, text, text) to anon;

comment on function ingest_pension_price is
  'Narrow write path for the fetch-pension-prices GitHub Actions workflow. '
  'Accepts a pre-shared secret (app.pension_writer_secret) to authenticate '
  'the caller without needing the service role key. See migration 239.';
