-- Atlas, the in-app assistant: conversations and their messages. Messages
-- keep the exact content blocks the Claude API returned (text, tool calls,
-- web search results, thinking), because each request resends the history
-- unchanged; rows are only ever appended.

create table public.atlas_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index atlas_conversations_user_idx on public.atlas_conversations (user_id, updated_at desc);

create table public.atlas_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.atlas_conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content jsonb not null,
  created_at timestamptz not null default now()
);

create index atlas_messages_conversation_idx on public.atlas_messages (conversation_id, id);
create index atlas_messages_user_idx on public.atlas_messages (user_id);

create trigger atlas_conversations_touch before update on public.atlas_conversations
  for each row execute function public.touch_updated_at();

alter table public.atlas_conversations enable row level security;
alter table public.atlas_messages enable row level security;

create policy "own atlas conversations" on public.atlas_conversations
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Append and read only: editing history would break the resent conversation.
create policy "read own atlas messages" on public.atlas_messages
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "append own atlas messages" on public.atlas_messages
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.atlas_conversations c where c.id = conversation_id and c.user_id = (select auth.uid()))
  );
