-- Road trips in your own car, personal and meeting stops, saved places.

alter table public.segments drop constraint segments_type_check;
alter table public.segments add constraint segments_type_check
  check (type in ('flight', 'hotel', 'car', 'train', 'event', 'other', 'drive', 'stop'));

-- Saved places: home, family, friends, office. Geocoded once when saved.
create table public.places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  kind text not null default 'other' check (kind in ('home', 'family', 'friend', 'office', 'other')),
  address text not null,
  city text,
  country text,
  lat double precision,
  lng double precision,
  tz text,
  created_at timestamptz not null default now()
);

create index places_user_idx on public.places (user_id);

alter table public.places enable row level security;

create policy "own places" on public.places
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
