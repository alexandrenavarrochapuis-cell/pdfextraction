-- Trip Command Center, Phase 1 schema (spec section 5).
-- Additions to the spec's model, all needed for RLS or the pipeline:
--   profiles             one row per auth user: brief hour and push toggle
--   *.user_id            on every table, so RLS can key on auth.uid()
--   trips.title_locked / grouping_locked   manual rename, merge and split survive regrouping
--   segments.review_reasons                why a segment needs review
--   raw_emails.provider_email_id           Resend id, makes webhook retries idempotent
--   raw_emails.processing_status / error   received | processed | ignored | failed

create extension if not exists pgcrypto;

-- Profiles ------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  brief_hour smallint not null default 19 check (brief_hour between 0 and 23),
  push_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, lower(new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Raw emails ----------------------------------------------------------------

create table public.raw_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider_email_id text unique,
  message_id text,
  received_at timestamptz not null default now(),
  from_addr text,
  to_addrs text[],
  subject text,
  headers jsonb,
  body_text text,
  body_html text,
  attachments jsonb not null default '[]'::jsonb,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processed', 'ignored', 'failed')),
  processing_error text,
  extraction_method text check (extraction_method in ('jsonld', 'claude'))
);

create index raw_emails_user_received_idx on public.raw_emails (user_id, received_at desc);

-- Trips ---------------------------------------------------------------------

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New trip',
  title_locked boolean not null default false,
  grouping_locked boolean not null default false,
  start_at timestamptz,
  end_at timestamptz,
  primary_city text,
  status text not null default 'upcoming' check (status in ('upcoming', 'active', 'past')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index trips_user_start_idx on public.trips (user_id, start_at);

-- Segments ------------------------------------------------------------------

create table public.segments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trip_id uuid references public.trips (id) on delete set null,
  type text not null check (type in ('flight', 'hotel', 'car', 'train', 'event', 'other')),
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled', 'needs_review')),
  confirmation_code text,
  provider text,
  start_at timestamptz,
  start_tz text,
  end_at timestamptz,
  end_tz text,
  origin jsonb,
  destination jsonb,
  details jsonb not null default '{}'::jsonb,
  source_email_id uuid references public.raw_emails (id) on delete set null,
  confidence numeric(4, 3),
  review_reasons text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Dedupe key from the spec: (type, confirmation_code, start_at), per user.
create unique index segments_dedupe_idx
  on public.segments (user_id, type, confirmation_code, start_at)
  where confirmation_code is not null and start_at is not null;

create index segments_trip_idx on public.segments (trip_id);
create index segments_user_start_idx on public.segments (user_id, start_at);
create index segments_review_idx on public.segments (user_id) where status = 'needs_review';

-- Push and briefs -----------------------------------------------------------

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  keys jsonb not null,
  created_at timestamptz not null default now()
);

create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete cascade,
  for_date date not null,
  sent_at timestamptz,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  -- "Never send twice for the same date": the cron claims this row before sending.
  unique (trip_id, for_date)
);

-- updated_at ----------------------------------------------------------------

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trips_touch before update on public.trips
  for each row execute function public.touch_updated_at();
create trigger segments_touch before update on public.segments
  for each row execute function public.touch_updated_at();

-- Row level security: every table keyed to the signed-in user ----------------

alter table public.profiles enable row level security;
alter table public.raw_emails enable row level security;
alter table public.trips enable row level security;
alter table public.segments enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.briefs enable row level security;

create policy "own profile" on public.profiles
  for all to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "own raw emails" on public.raw_emails
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "own trips" on public.trips
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "own segments" on public.segments
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "own push subscriptions" on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "own briefs" on public.briefs
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Attachment storage ----------------------------------------------------------
-- Private bucket; objects live under <user_id>/<raw_email_id>/<file>.

insert into storage.buckets (id, name, public)
values ('email-attachments', 'email-attachments', false)
on conflict (id) do nothing;

create policy "read own attachments" on storage.objects
  for select to authenticated
  using (bucket_id = 'email-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
