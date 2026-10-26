-- 0101_invites.sql (Phase 1.5, contract v3)
-- Link-based WhatsApp migration (PRD §5.4, GAME-030/031): the anon-callable rich preview, link
-- rotation and the host's migration stats. Joins through links are recorded in invite_joins by
-- request_join (game link) and join_roster (series link), see 0100.

-- InvitePreview (types.ts) for a game or series invite token, or null (unknown, rotated, expired,
-- cancelled/ended, or the host is deleted/banned/visibility-restricted). Callable by anon (the
-- invite-preview Edge Function renders OpenGraph from it), so it returns only public, safe fields:
-- sport, title, schedule (weekday/local time/zone, next start), capacity and spots left, the
-- women-only flag and the host's display name. Never coordinates, venue/address of a hidden,
-- private or women-only game, phone numbers or participant identities. `areaLabel` is the venue
-- name only for public games whose exact location is not hidden.
create function public.get_invite_preview(p_token text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  g public.games;
  s public.game_series;
  nxt public.games;
  host_name text;
  label text;
  hidden boolean;
  appr int;
begin
  if p_token is null or char_length(p_token) not between 16 and 64 or p_token !~ '^[0-9a-f]+$' then
    return null;
  end if;
  select * into g from public.games x where x.invite_token = p_token;
  if g.id is null then
    select * into s from public.game_series x where x.invite_token = p_token;
    if s.id is null then return null; end if;
  end if;
  if public.st_is_hidden_user(coalesce(g.host_id, s.host_id)) then return null; end if;
  select p.display_name into host_name from public.profiles p where p.id = coalesce(g.host_id, s.host_id);

  if g.id is not null then
    if g.status <> 'scheduled' or g.ends_at <= t then return null; end if;
    if g.series_id is not null then
      select * into s from public.game_series x where x.id = g.series_id;
    end if;
    hidden := g.hide_exact_location or g.visibility = 'private' or g.women_only;
    if not hidden and g.venue_id is not null then
      select v.name into label from public.venues v where v.id = g.venue_id and v.status = 'active';
    end if;
    select count(*) into appr from public.game_participants gp where gp.game_id = g.id and gp.status = 'approved';
    return jsonb_build_object(
      'sport', g.sport, 'title', g.title, 'startsAt', public.dm_iso(g.starts_at),
      'timeZone', coalesce(s.time_zone, g.time_zone), 'recurrence', s.recurrence, 'weekday', s.weekday,
      'localStartTime', case when s.id is not null then public.st_hhmm(s.start_time) end,
      'areaLabel', label, 'spotsLeft', greatest(0, g.capacity - appr), 'capacity', g.capacity,
      'womenOnly', g.women_only, 'hostDisplayName', host_name, 'ogImageUrl', null);
  end if;

  if s.status = 'ended' then return null; end if;
  select x.* into nxt from public.games x
  join public.series_occurrences o on o.game_id = x.id and o.status = 'scheduled'
  where x.series_id = s.id and x.status = 'scheduled' and x.starts_at > t
  order by x.starts_at limit 1;
  hidden := s.hide_exact_location or s.visibility = 'private' or s.women_only;
  if not hidden and s.venue_id is not null then
    select v.name into label from public.venues v where v.id = s.venue_id and v.status = 'active';
  end if;
  if nxt.id is not null then
    select count(*) into appr from public.game_participants gp where gp.game_id = nxt.id and gp.status = 'approved';
  end if;
  return jsonb_build_object(
    'sport', s.sport, 'title', s.title, 'startsAt', public.dm_iso(nxt.starts_at),
    'timeZone', s.time_zone, 'recurrence', s.recurrence, 'weekday', s.weekday,
    'localStartTime', public.st_hhmm(s.start_time), 'areaLabel', label,
    'spotsLeft', case when nxt.id is not null then greatest(0, nxt.capacity - appr) end, 'capacity', s.capacity,
    'womenOnly', s.women_only, 'hostDisplayName', host_name, 'ogImageUrl', null);
end $$;

-- rotateInviteLink: host only. Old links stop working at once. Returns the new token.
create function public.rotate_invite_link(p_kind text, p_id uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles := public.st_active_profile();
  t timestamptz := public.st_now();
  tok text := encode(extensions.gen_random_bytes(18), 'hex');
  host uuid;
  ok boolean;
begin
  if p_kind = 'game' then
    select x.host_id, x.status = 'scheduled' and x.ends_at > t into host, ok from public.games x where x.id = p_id;
  elsif p_kind = 'series' then
    select x.host_id, x.status <> 'ended' into host, ok from public.game_series x where x.id = p_id;
  else
    perform public.st_raise('validation', 'kind');
  end if;
  if host is null then perform public.st_raise('not_found'); end if;
  if host <> me.id then perform public.st_raise('forbidden'); end if;
  if not ok then perform public.st_raise('game_not_open'); end if;
  perform public.st_rate_limit(
    (select count(*) from public.audit_log a where a.actor_id = me.id and a.action = 'invite.rotated' and a.at > t - interval '1 hour'), 20);
  if p_kind = 'game' then
    update public.games x set invite_token = tok, invite_rotated_at = t where x.id = p_id;
  else
    update public.game_series x set invite_token = tok, invite_rotated_at = t where x.id = p_id;
  end if;
  perform public.st_audit('invite.rotated', me.id, jsonb_build_object('kind', p_kind, 'id', p_id), me.id);
  return tok;
end $$;

-- MigrationStats (PRD §5.4 step 5) for a game or series the caller hosts.
create function public.migration_stats(p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  me public.profiles := public.st_active_profile();
  host uuid;
  joined int;
  active int;
  roster int := 0;
  total int;
  first_at timestamptz;
  last_at timestamptz;
begin
  if p_kind = 'game' then
    select x.host_id into host from public.games x where x.id = p_id;
  elsif p_kind = 'series' then
    select x.host_id into host from public.game_series x where x.id = p_id;
  else
    perform public.st_raise('validation', 'kind');
  end if;
  if host is null then perform public.st_raise('not_found'); end if;
  if host <> me.id then perform public.st_raise('forbidden'); end if;
  if p_kind = 'game' then
    select count(*), min(j.created_at), max(j.created_at),
           count(*) filter (where exists (select 1 from public.game_participants gp
                                          where gp.game_id = p_id and gp.user_id = j.user_id and gp.attendance = 'verified'))
      into joined, first_at, last_at, active
    from public.invite_joins j where j.kind = 'game' and j.game_id = p_id;
    select count(*) into total from public.game_participants gp
    where gp.game_id = p_id and gp.user_id <> host and gp.status = 'approved';
  else
    select count(*), min(j.created_at), max(j.created_at),
           count(*) filter (where exists (select 1 from public.game_participants gp join public.games g on g.id = gp.game_id
                                          where g.series_id = p_id and gp.user_id = j.user_id and gp.attendance = 'verified'
                                            and g.starts_at >= j.created_at))
      into joined, first_at, last_at, active
    from public.invite_joins j where j.kind = 'series' and j.series_id = p_id;
    select count(*) into roster from public.series_roster r where r.series_id = p_id and r.status = 'regular';
    total := roster;
  end if;
  return jsonb_build_object(
    'target', case when p_kind = 'game' then jsonb_build_object('kind', 'game', 'gameId', p_id)
                   else jsonb_build_object('kind', 'series', 'seriesId', p_id) end,
    'joinedFromLink', joined, 'activeFromLink', active, 'rosterSize', roster, 'totalMembers', total,
    'firstJoinAt', public.dm_iso(first_at), 'lastJoinAt', public.dm_iso(last_at));
end $$;

-- The series form used by the host dashboard (task naming).
create function public.series_migration_stats(p_series_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$ select public.migration_stats('series', p_series_id) $$;
