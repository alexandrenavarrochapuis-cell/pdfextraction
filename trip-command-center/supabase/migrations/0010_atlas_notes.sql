-- What Atlas remembers about the family between conversations: loyalty
-- programs, preferences, habits. Short notes it writes when asked to
-- remember something, and that it reads at the start of every chat.

create table public.atlas_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  note text not null check (char_length(note) between 1 and 500),
  created_at timestamptz not null default now()
);

create index atlas_notes_user_idx on public.atlas_notes (user_id, created_at);

alter table public.atlas_notes enable row level security;

create policy "own atlas notes" on public.atlas_notes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
