-- Sprint 3.2: Google OAuth token storage
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS google_oauth_tokens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email text NOT NULL UNIQUE,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expiry timestamptz,
  scopes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
