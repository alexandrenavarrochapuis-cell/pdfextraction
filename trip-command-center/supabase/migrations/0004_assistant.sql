-- AI assistant: country briefs, trip plans, and a private calendar feed.

-- Secret token in the calendar feed URL. Rotating it revokes old links.
alter table public.profiles add column calendar_token text unique;

create table public.country_briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  country_code text not null,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  payload jsonb,
  error text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, country_code)
);

create table public.trip_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  request jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.country_briefs enable row level security;
alter table public.trip_plans enable row level security;

create policy "own country briefs" on public.country_briefs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "own trip plans" on public.trip_plans
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
