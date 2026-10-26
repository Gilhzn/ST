-- 0091_realtime.sql
-- Realtime Authorization for chat broadcasts (security H6). Private channel topic `game:<uuid>`:
-- approved participants (host included) may receive until the chat expires (ends_at + chatTtl).
-- No INSERT policy: only the service role (send-message Edge Function) broadcasts.
-- Also disable "Allow public access" for channels in the Realtime settings (README).

-- Caller-relative check used by the policy.
create function public.st_realtime_can_read(p_topic text) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare g public.games;
begin
  if auth.uid() is null or p_topic is null or p_topic !~ '^game:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  select * into g from public.games x where x.id = substr(p_topic, 6)::uuid;
  return g.id is not null
     and public.st_is_approved(g.id, auth.uid())
     and public.st_now() < g.ends_at + (public.st_config()).chat_ttl_hours_after_end * interval '1 hour';
end $$;
revoke execute on function public.st_realtime_can_read(text) from public, anon;
grant execute on function public.st_realtime_can_read(text) to authenticated, service_role;

do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages not present (e.g. PGlite): skipping Realtime policies';
    return;
  end if;
  execute 'alter table realtime.messages enable row level security';
  execute 'drop policy if exists st_game_chat_receive on realtime.messages';
  execute $p$
    create policy st_game_chat_receive on realtime.messages for select to authenticated
      using (realtime.messages.extension = 'broadcast' and public.st_realtime_can_read(realtime.topic()))
  $p$;
end $$;
