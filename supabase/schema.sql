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
