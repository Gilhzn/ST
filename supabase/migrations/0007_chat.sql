-- 0007_chat.sql
-- Ephemeral game chat (written only by the send-message Edge Function via service role),
-- moderation retention (90 days) and cached translations.

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  sender_id uuid not null references public.profiles (id),
  body text not null check (char_length(body) between 1 and 2000),
  lang text check (lang is null or char_length(lang) <= 35),
  client_msg_id text not null check (char_length(client_msg_id) between 1 and 100),
  moderation public.message_moderation not null default 'allow',
  retracted_at timestamptz,
  created_at timestamptz not null default now(),
  -- games.ends_at + chatTtlHoursAfterEnd, set by the trigger below.
  expires_at timestamptz not null,
  unique (sender_id, client_msg_id)
);
create index chat_messages_game_idx on public.chat_messages (game_id, created_at desc);
create index chat_messages_expires_idx on public.chat_messages (expires_at);
create index chat_messages_pending_idx on public.chat_messages (created_at) where moderation = 'pending';

create function public.st_chat_messages_expiry() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  select g.ends_at + (public.st_config()).chat_ttl_hours_after_end * interval '1 hour'
    into new.expires_at
  from public.games g where g.id = new.game_id;
  return new;
end $$;
create trigger chat_messages_expiry before insert on public.chat_messages
  for each row execute function public.st_chat_messages_expiry();

-- Blocked and reported content kept for abuse handling (moderationRetentionDays). Never readable
-- by clients; moderators read it through the review tools (service role).
create table public.moderation_retained (
  id uuid primary key default gen_random_uuid(),
  message_id uuid,
  game_id uuid,
  sender_id uuid,
  body text not null,
  reason text not null check (reason in ('blocked', 'reported')),
  categories text[] not null default '{}',
  report_id uuid,
  -- Legal hold (compliance §4/§9) suspends the purge for this record.
  legal_hold boolean not null default false,
  retained_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create unique index moderation_retained_message_reason on public.moderation_retained (message_id, reason)
  where message_id is not null;
create index moderation_retained_expires_idx on public.moderation_retained (expires_at);

create table public.message_translations (
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  target public.locale_code not null,
  text text not null check (char_length(text) <= 8000),
  provider public.translation_provider not null,
  created_at timestamptz not null default now(),
  primary key (message_id, target)
);

-- May the viewer read this game's chat? Approved participants (host included) until expiry.
create function public.st_can_read_chat(p_game_id uuid, p_uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = ''
as $$ select p_uid is not null and public.st_is_approved(p_game_id, p_uid) $$;

create function public.st_my_chat(p_game_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select public.st_can_read_chat(p_game_id, auth.uid()) $$;
