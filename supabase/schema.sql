-- Run this in the Supabase SQL editor (Dashboard -> SQL -> New query).

create extension if not exists "pgcrypto";

-- One row per connected LinkedIn member (this tool is single-user but supports more).
create table if not exists linkedin_accounts (
  id uuid primary key default gen_random_uuid(),
  member_urn text unique not null,          -- urn:li:person:xxxx
  name text,
  picture text,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  refresh_expires_at timestamptz,
  created_at timestamptz default now()
);

-- Scheduled / published posts.
create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references linkedin_accounts(id) on delete cascade,
  body text not null,
  first_comment text,
  scheduled_at timestamptz not null,
  status text not null default 'scheduled', -- scheduled | publishing | published | failed
  post_urn text,
  comment_urn text,
  error text,
  created_at timestamptz default now(),
  published_at timestamptz,
  updated_at timestamptz default now()
);

-- Lease timestamp so a crashed publish (status stuck on 'publishing') can be retried.
alter table posts add column if not exists updated_at timestamptz default now();

-- Media attached to a post (uploaded to Supabase Storage, pushed to LinkedIn at publish time).
create table if not exists media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references posts(id) on delete cascade,
  type text not null,                       -- image | video | document
  path text not null,                       -- storage path inside the 'media' bucket
  url text not null,                        -- public URL
  title text,                               -- document (PDF) title shown on LinkedIn
  sort_order int default 0,
  created_at timestamptz default now()
);

-- If the media table already exists from a previous setup, add the column:
alter table media add column if not exists title text;

create index if not exists posts_status_sched_idx on posts(status, scheduled_at);
create index if not exists media_post_idx on media(post_id);

-- The anon key ships in the browser. With RLS off, that key can read every LinkedIn token.
-- No policies: anon and authenticated are denied. The server uses the service role, which bypasses RLS.
alter table linkedin_accounts enable row level security;
alter table posts enable row level security;
alter table media enable row level security;

-- Private bucket. Publishing downloads the bytes with the service role.
-- Browser uploads use a signed upload URL (no insert policy required) and previews use signed read URLs.
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do update set public = false;

drop policy if exists "media signed uploads" on storage.objects;
