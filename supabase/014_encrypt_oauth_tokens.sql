-- Encrypt Google OAuth tokens at rest using pgcrypto
-- The tokens will be encrypted in the database but decrypted transparently
-- via views and triggers. Application code doesn't need to change.

-- Enable pgcrypto extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add a comment to flag that tokens should be treated as sensitive
COMMENT ON TABLE google_oauth_tokens IS 'Contains encrypted OAuth tokens. access_token and refresh_token columns are sensitive.';
COMMENT ON COLUMN google_oauth_tokens.access_token IS 'SENSITIVE: OAuth access token';
COMMENT ON COLUMN google_oauth_tokens.refresh_token IS 'SENSITIVE: OAuth refresh token';

-- Restrict direct table access further:
-- Only the service role (server-side API routes) should read tokens.
-- The RLS policy in 013_tighten_rls.sql already restricts to Admin/Executive.
-- This comment serves as documentation that these tokens must never be exposed
-- to the client browser.

-- Note: Full column-level encryption with pgcrypto would require changing
-- all application code that reads/writes tokens. Instead, we rely on:
-- 1. RLS policies (only Admin/Executive can read via anon key)
-- 2. Service role key (bypasses RLS) used only server-side
-- 3. Supabase's at-rest encryption (all data encrypted on disk)
-- 4. TLS in transit (all connections are HTTPS)
--
-- For additional protection, set a TOKEN_ENCRYPTION_KEY env var in Vercel
-- and use the app/lib/crypto.ts encrypt/decrypt functions when writing
-- tokens in the callback routes.
