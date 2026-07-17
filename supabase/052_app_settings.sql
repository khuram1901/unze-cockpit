-- Generic key/value store for app configuration (Drive folder IDs, etc.)
create table if not exists app_settings (
  key   text primary key,
  value text not null,
  updated_at timestamptz default now()
);

-- Only service role (API routes) can read/write — no direct client access
alter table app_settings enable row level security;
create policy "service only" on app_settings for all using (false);
