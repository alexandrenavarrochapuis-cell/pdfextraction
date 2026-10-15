-- Family travelers, boarding passes, and an encrypted passport and ID vault.

create table public.travelers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  relation text not null default 'other' check (relation in ('self', 'spouse', 'child', 'parent', 'other')),
  -- Extra spellings as airlines print them, e.g. NAVARRO/ALEXANDRE MR
  name_variants text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.boarding_passes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  segment_id uuid references public.segments (id) on delete set null,
  traveler_id uuid references public.travelers (id) on delete set null,
  passenger_name text,
  kind text not null check (kind in ('wallet', 'pdf', 'image', 'barcode')),
  storage_path text, -- object in the private boarding-passes bucket
  content_type text,
  barcode_message text,
  barcode_format text, -- qrcode | pdf417 | azteccode | code128
  carrier text,
  flight_number text,
  flight_date date,
  origin text,
  destination text,
  seat text,
  boarding_group text,
  boarding_time text,
  gate text,
  source_email_id uuid references public.raw_emails (id) on delete set null,
  created_at timestamptz not null default now()
);

create index boarding_passes_segment_idx on public.boarding_passes (segment_id);

-- Vault: numbers, notes and scans are encrypted in the browser with a key
-- derived from a passphrase only the owner knows (PBKDF2 + AES-GCM). The
-- server stores ciphertext; it cannot read passport numbers or scans.
-- Kind, issuing country and expiry stay in clear so expiry warnings work.
create table public.travel_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  traveler_id uuid references public.travelers (id) on delete cascade,
  kind text not null check (kind in ('passport', 'national_id', 'drivers_license', 'trusted_traveler', 'visa', 'other')),
  label text,
  issuing_country text,
  expires_on date,
  ciphertext text,
  iv text,
  scan_path text,
  scan_iv text,
  scan_type text,
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column vault_salt text,
  add column vault_check text,
  add column vault_check_iv text;

alter table public.travelers enable row level security;
alter table public.boarding_passes enable row level security;
alter table public.travel_documents enable row level security;

create policy "own travelers" on public.travelers
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "own boarding passes" on public.boarding_passes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "own travel documents" on public.travel_documents
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Private buckets. The app reads and writes them server-side after checking
-- ownership through RLS, so no storage policies are granted to clients.
insert into storage.buckets (id, name, public)
values ('boarding-passes', 'boarding-passes', false), ('vault', 'vault', false)
on conflict (id) do nothing;
