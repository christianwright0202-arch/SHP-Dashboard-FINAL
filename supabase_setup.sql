-- Run this once in your Supabase project:
-- Left sidebar > SQL Editor > New query > paste this > Run.

create table if not exists dashboard (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);

-- This dashboard is for personal use behind a password, so we allow the
-- app's key to read/write this one table directly.
alter table dashboard disable row level security;
