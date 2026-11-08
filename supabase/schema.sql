-- Pict-Portal: persistent room messages (chat + game control channels).
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Live traffic goes through Realtime Broadcast and Presence, which need no
-- tables. This table only backs the history that late joiners receive, the
-- equivalent of Portal's persistent channel history.

create table if not exists public.room_messages (
  seq        bigint generated always as identity primary key,
  id         text        not null unique,
  channel    text        not null,            -- e.g. "game:ABCDE", "chat:ABCDE"
  sender_id  text        not null,
  content    jsonb       not null,
  created_at timestamptz not null default now()
);

create index if not exists room_messages_channel_seq_idx
  on public.room_messages (channel, seq);

alter table public.room_messages enable row level security;

-- Anonymous visitors (the anon key) may read history and append messages.
-- No update or delete policies: rows are append-only from the browser.
drop policy if exists "anon can read room messages" on public.room_messages;
create policy "anon can read room messages"
  on public.room_messages for select
  to anon
  using (true);

drop policy if exists "anon can append room messages" on public.room_messages;
create policy "anon can append room messages"
  on public.room_messages for insert
  to anon
  with check (true);

-- Saved AI doodles (see src/lib/drawCache.ts): up to a few per word and
-- difficulty, reused so the AI doesn't spend Gemini tokens drawing the same
-- word every time. Only the server touches this table, with the service-role
-- key (which bypasses RLS), so there are deliberately NO anon policies: the
-- browser can neither read nor plant drawings.
create table if not exists public.ai_drawings (
  id         bigint generated always as identity primary key,
  word_key   text        not null,             -- lowercase, no accents
  difficulty text        not null check (difficulty in ('easy', 'normal', 'hard')),
  strokes    jsonb       not null check (jsonb_typeof(strokes) = 'array'),
  created_at timestamptz not null default now()
);

create index if not exists ai_drawings_word_idx
  on public.ai_drawings (word_key, difficulty);

alter table public.ai_drawings enable row level security;
