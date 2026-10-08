-- Run once in the Supabase SQL editor (or as a migration).
-- Matches the fields the /api/waitlist route writes.

create table if not exists waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  first_name text,
  product_id text,
  product_name text,
  language text,
  source text,
  status text not null default 'pending',
  joined_at timestamptz not null default now()
);

-- One row per (email, product): joining again for the same product is a
-- no-op (handled gracefully by the API route's upsert + ignoreDuplicates);
-- joining for a *different* product is a new row.
create unique index if not exists waitlist_entries_email_product_idx
  on waitlist_entries (email, coalesce(product_id, ''));

-- Row Level Security: locked down by default. The API route uses the
-- service role key (server-only), which bypasses RLS entirely — these
-- policies matter only if you ever query this table from the browser
-- directly, which nothing in this app currently does.
alter table waitlist_entries enable row level security;
