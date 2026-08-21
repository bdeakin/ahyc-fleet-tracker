-- Run in Supabase SQL editor to create the club vessel registry.
-- Enable Email auth in Authentication → Providers for admin login.

create table if not exists public.vessels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mmsi text not null unique,
  sail_number text,
  color text not null default '#1f6f8b',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vessels_active_idx on public.vessels (active);

alter table public.vessels enable row level security;

-- Authenticated admins can read/write the registry.
create policy "authenticated read vessels"
  on public.vessels for select
  to authenticated
  using (true);

create policy "authenticated insert vessels"
  on public.vessels for insert
  to authenticated
  with check (true);

create policy "authenticated update vessels"
  on public.vessels for update
  to authenticated
  using (true)
  with check (true);

create policy "authenticated delete vessels"
  on public.vessels for delete
  to authenticated
  using (true);

-- Service role (Pi sync) bypasses RLS by default.
