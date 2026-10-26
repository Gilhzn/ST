-- 0104_network.sql (Phase 1.5, contract v3)
-- Played-with (auto-derived from co-verified attendance, GAME-032), mutual friendships and the
-- privacy of "friends' upcoming games", mirroring packages/domain/src/network. One `connections`
-- row per unordered pair (user_a < user_b) carries both the played-with counters and the friend
-- state machine (none → requested → accepted; decline/cancel/remove clear it). Blocks override
-- everything: a blocked pair has no visible connection, cannot (re)request, and creating a block
-- deletes the friendship. Friend requests require having played together (anti-spam).

create type public.friend_status as enum ('requested', 'accepted');
create type public.upcoming_games_audience as enum ('friends', 'nobody');

create table public.connections (
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  games_together int not null default 0 check (games_together >= 0),
  last_played_at timestamptz,
  friend_status public.friend_status,
  friend_requested_by uuid references public.profiles (id) on delete cascade,
  friend_requested_at timestamptz,
  friend_accepted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b),
  check ((friend_status is null) = (friend_requested_by is null)),
  check (friend_requested_by is null or friend_requested_by in (user_a, user_b)),
  check ((friend_status = 'accepted') = (friend_accepted_at is not null))
);
create index connections_b_idx on public.connections (user_b);

create table public.network_privacy (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  upcoming_games_visible_to public.upcoming_games_audience not null default 'friends',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function public.st_played_with(p_x uuid, p_y uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.connections c
                 where c.user_a = least(p_x, p_y) and c.user_b = greatest(p_x, p_y) and c.games_together > 0)
     and not public.st_is_blocked(p_x, p_y)
$$;

create function public.st_are_friends(p_x uuid, p_y uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.connections c
                 where c.user_a = least(p_x, p_y) and c.user_b = greatest(p_x, p_y) and c.friend_status = 'accepted')
     and not public.st_is_blocked(p_x, p_y)
$$;

-- friendState() from the viewer's side.
create function public.st_friend_state(c public.connections, p_viewer uuid) returns text
language sql immutable set search_path = ''
as $$
  select case when c.friend_status is null then 'none' when c.friend_status = 'accepted' then 'friends'
              when c.friend_requested_by = p_viewer then 'outgoing' else 'incoming' end
$$;

-- ConnectionView for the viewer.
create function public.st_connection_view(c public.connections, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'user', jsonb_build_object('id', p.id, 'displayName', p.display_name, 'avatarUrl', p.avatar_url,
                               'reliabilityScore', p.reliability_score, 'reliabilityStatus', p.reliability_status,
                               'verifiedHost', p.verified_host, 'memberSince', public.dm_iso(p.created_at)),
    'playedWith', c.games_together > 0, 'gamesTogether', c.games_together, 'lastPlayedAt', public.dm_iso(c.last_played_at),
    'friend', public.st_friend_state(c, p_viewer))
  from public.profiles p
  where p.id = case when c.user_a = p_viewer then c.user_b else c.user_a end
$$;

-- ---------------------------------------------------------------------------
-- Job: played-with (derivePlayedWith)
-- ---------------------------------------------------------------------------

-- Recomputes played-with for every pair from verified attendance at games that ended within
-- playedWithLookbackDays (now − lookback ≤ endsAt ≤ now), blocked pairs excluded. Idempotent;
-- pairs that fell out of the window keep their friend state with games_together 0; empty rows are
-- dropped. Returns the number of pairs with games together.
create function public.derive_played_with() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  p15 public.phase15_config := public.st_p15();
  n int;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('st:derive_played_with')) then return 0; end if;
  create temp table _st_pairs on commit drop as
    with att as (
      select distinct gp.game_id, gp.user_id, g.ends_at
      from public.game_participants gp join public.games g on g.id = gp.game_id
      join public.profiles p on p.id = gp.user_id and p.deleted_at is null
      where gp.attendance = 'verified'
        and g.ends_at >= t - p15.played_with_lookback_days * interval '24 hours' and g.ends_at <= t
    )
    select a.user_id as ua, b.user_id as ub, count(*)::int as n, max(a.ends_at) as last
    from att a join att b on a.game_id = b.game_id and a.user_id < b.user_id
    where not public.st_is_blocked(a.user_id, b.user_id)
    group by a.user_id, b.user_id;
  update public.connections c set games_together = 0, last_played_at = null, updated_at = t
  where c.games_together > 0 and not exists (select 1 from _st_pairs p where p.ua = c.user_a and p.ub = c.user_b);
  insert into public.connections as c (user_a, user_b, games_together, last_played_at, updated_at)
  select p.ua, p.ub, p.n, p.last, t from _st_pairs p
  on conflict (user_a, user_b) do update
    set games_together = excluded.games_together, last_played_at = excluded.last_played_at, updated_at = excluded.updated_at
    where c.games_together is distinct from excluded.games_together or c.last_played_at is distinct from excluded.last_played_at;
  delete from public.connections c where c.games_together = 0 and c.friend_status is null;
  select count(*) into n from _st_pairs;
  drop table _st_pairs;
  return n;
end $$;

-- onBlockCreated(): a block deletes any friendship or pending request between the pair.
create function public.st_blocks_unfriend() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.connections c set friend_status = null, friend_requested_by = null, friend_requested_at = null,
         friend_accepted_at = null, updated_at = public.st_now()
  where c.user_a = least(new.blocker_id, new.blocked_id) and c.user_b = greatest(new.blocker_id, new.blocked_id)
    and c.friend_status is not null;
  return null;
end $$;
create trigger blocks_unfriend after insert on public.blocks
  for each row execute function public.st_blocks_unfriend();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Friend state machine (friendTransition). Locks the pair row; returns the caller's ConnectionView.
create function public.st_friend_transition(p_other uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles := public.st_active_profile();
  t timestamptz := public.st_now();
  c public.connections;
  st text;
  a uuid;
  b uuid;
  blocked boolean;
begin
  if p_other is null or p_other = me.id then perform public.st_raise('validation'); end if;
  if not exists (select 1 from public.profiles p where p.id = p_other and p.deleted_at is null) then
    perform public.st_raise('not_found');
  end if;
  a := least(me.id, p_other);
  b := greatest(me.id, p_other);
  insert into public.connections (user_a, user_b, updated_at) values (a, b, t) on conflict do nothing;
  select * into c from public.connections x where x.user_a = a and x.user_b = b for update;
  st := public.st_friend_state(c, me.id);
  blocked := public.st_is_blocked(me.id, p_other);
  if p_action in ('request', 'accept') and blocked then perform public.st_raise('blocked'); end if;
  if p_action = 'request' then
    if st in ('friends', 'outgoing') then perform public.st_raise('conflict'); end if;
    if st = 'none' then
      if c.games_together < 1 then perform public.st_raise('forbidden', 'not played together'); end if;
      -- Security review #2 M2: the rate limit counts an append-only source (audit_log), so cancelling
      -- requests does not refill it; and a declined/cancelled pair cools down for 30 days.
      perform public.st_rate_limit(
        (select count(*) from public.audit_log x where x.subject_user_id = me.id and x.action = 'friend.requested'
           and x.at > t - interval '24 hours'), 30);
      if exists (select 1 from public.audit_log x
                 where x.action in ('friend.declined', 'friend.cancelled') and x.data ->> 'pair' = a::text || ':' || b::text
                   and x.at > t - interval '30 days'
                   and x.subject_user_id in (a, b)) then
        perform public.st_raise('rate_limited', 'cooldown');
      end if;
      update public.connections x set friend_status = 'requested', friend_requested_by = me.id, friend_requested_at = t,
             friend_accepted_at = null, updated_at = t
      where x.user_a = a and x.user_b = b returning * into c;
      perform public.st_audit('friend.requested', me.id, jsonb_build_object('pair', a::text || ':' || b::text), me.id);
      -- One notice per pair per day (no per-request timestamp in the dedupe key).
      perform public.st_notify(p_other, 'friend_request', jsonb_build_object('userId', me.id), null, null,
                               'notify:friend_request:' || a::text || ':' || b::text || ':' || to_char(t at time zone 'UTC', 'YYYY-MM-DD'));
      return public.st_connection_view(c, me.id);
    end if;
    p_action := 'accept'; -- mutual intent: an incoming request is accepted instead
  end if;
  if p_action = 'accept' then
    if st <> 'incoming' then perform public.st_raise('not_found'); end if;
    update public.connections x set friend_status = 'accepted', friend_accepted_at = t, updated_at = t
    where x.user_a = a and x.user_b = b returning * into c;
    perform public.st_notify(p_other, 'friend_accepted', jsonb_build_object('userId', me.id), null, null,
                             'notify:friend_accepted:' || a::text || ':' || b::text || ':' || to_char(t at time zone 'UTC', 'YYYY-MM-DD'));
    return public.st_connection_view(c, me.id);
  end if;
  if (p_action = 'decline' and st <> 'incoming') or (p_action = 'cancel' and st <> 'outgoing')
     or (p_action = 'remove' and st <> 'friends') or p_action not in ('decline', 'cancel', 'remove') then
    perform public.st_raise('not_found');
  end if;
  update public.connections x set friend_status = null, friend_requested_by = null, friend_requested_at = null,
         friend_accepted_at = null, updated_at = t
  where x.user_a = a and x.user_b = b returning * into c;
  if p_action in ('decline', 'cancel') then
    perform public.st_audit('friend.' || case when p_action = 'decline' then 'declined' else 'cancelled' end, me.id,
                            jsonb_build_object('pair', a::text || ':' || b::text), me.id);
  end if;
  return public.st_connection_view(c, me.id);
end $$;

-- requestFriend: rejects blocked, conflict (outgoing or friends), forbidden (never played together),
-- rate_limited (30 requests/24 h from audit_log; 30-day cooldown for a pair after a decline or a
-- cancel); an incoming request is accepted instead of duplicating.
create function public.request_friend(p_user_id uuid) returns jsonb
language sql security definer set search_path = ''
as $$ select public.st_friend_transition(p_user_id, 'request') $$;

-- respondFriendRequest: accept or decline an incoming request (not_found otherwise).
create function public.respond_friend(p_user_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if p_accept is null then perform public.st_raise('validation'); end if;
  return public.st_friend_transition(p_user_id, case when p_accept then 'accept' else 'decline' end);
end $$;

-- removeFriend: removes a friendship or withdraws an outgoing request; played-with stays.
create function public.remove_friend(p_user_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  c public.connections;
  st text;
begin
  select * into c from public.connections x where x.user_a = least(uid, p_user_id) and x.user_b = greatest(uid, p_user_id);
  st := case when c.user_a is null then 'none' else public.st_friend_state(c, uid) end;
  perform public.st_friend_transition(p_user_id, case st when 'outgoing' then 'cancel' else 'remove' end);
end $$;

-- listConnections: the caller's connections, blocked pairs and hidden users excluded, most recent
-- first. Filter: 'all' | 'friends' | 'played_with' | 'requests' (incoming).
create function public.list_network(p_filter text default 'all') returns setof jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := public.st_uid();
begin
  if p_filter is null or p_filter not in ('all', 'friends', 'played_with', 'requests') then perform public.st_raise('validation'); end if;
  return query
    select public.st_connection_view(c, uid)
    from public.connections c
    cross join lateral (select case when c.user_a = uid then c.user_b else c.user_a end as other) o
    where (c.user_a = uid or c.user_b = uid)
      and (c.games_together > 0 or c.friend_status is not null)
      and not public.st_is_blocked(uid, o.other)
      and not public.st_is_hidden_user(o.other)
      and case p_filter
            when 'friends' then c.friend_status = 'accepted'
            when 'played_with' then c.games_together > 0
            when 'requests' then c.friend_status = 'requested' and c.friend_requested_by <> uid
            else true end
    order by greatest(c.last_played_at, c.friend_accepted_at, c.friend_requested_at) desc nulls last, o.other
    limit 1000;
end $$;

-- getNetworkPrivacy / setNetworkPrivacy (default: friends).
create function public.get_network_privacy() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('userId', auth.uid(),
    'upcomingGamesVisibleTo', coalesce((select n.upcoming_games_visible_to from public.network_privacy n where n.user_id = auth.uid()),
                                       'friends'::public.upcoming_games_audience),
    'updatedAt', public.dm_iso(coalesce((select n.updated_at from public.network_privacy n where n.user_id = auth.uid()), public.st_now())))
  where auth.uid() is not null
$$;

create function public.set_network_privacy(p_audience public.upcoming_games_audience) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare me public.profiles := public.st_active_profile();
begin
  if p_audience is null then perform public.st_raise('validation'); end if;
  insert into public.network_privacy as n (user_id, upcoming_games_visible_to, updated_at) values (me.id, p_audience, public.st_now())
  on conflict (user_id) do update set upcoming_games_visible_to = excluded.upcoming_games_visible_to, updated_at = excluded.updated_at;
  return public.get_network_privacy();
end $$;

-- listFriendsUpcomingGames (filterFriendsUpcomingGames): games where an accepted friend whose
-- audience is `friends` is the host or an approved participant; the game is public, scheduled, not
-- started and visible to the caller; no block between the caller and the friend or the host. The
-- game comes from game_views, so exact location (women-only, hidden) stays masked per viewer; a
-- private game never appears. Sorted by start, game id, friend.
create function public.friends_upcoming_games() returns setof jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  t timestamptz := public.st_now();
begin
  return query
    with friends as (
      select case when c.user_a = uid then c.user_b else c.user_a end as fid
      from public.connections c
      where (c.user_a = uid or c.user_b = uid) and c.friend_status = 'accepted'
    )
    select jsonb_build_object(
             'friend', jsonb_build_object('id', p.id, 'displayName', p.display_name, 'avatarUrl', p.avatar_url,
                                          'reliabilityScore', p.reliability_score, 'reliabilityStatus', p.reliability_status,
                                          'verifiedHost', p.verified_host, 'memberSince', public.dm_iso(p.created_at)),
             'game', to_jsonb(gv) - 'invite_token')
    from friends f
    join public.profiles p on p.id = f.fid and p.deleted_at is null
    join public.game_participants gp on gp.user_id = f.fid and gp.status = 'approved'
    join public.games g on g.id = gp.game_id
    join public.game_views gv on gv.id = g.id
    where coalesce((select n.upcoming_games_visible_to from public.network_privacy n where n.user_id = f.fid), 'friends') = 'friends'
      and not public.st_is_blocked(uid, f.fid) and not public.st_is_blocked(uid, g.host_id)
      and not public.st_is_hidden_user(f.fid)
      and g.visibility = 'public' and g.status = 'scheduled' and g.starts_at > t
      and (g.series_id is null or not public.st_roster_priority_blocks(g.id, uid, t))
    order by g.starts_at, g.id::text collate "C", f.fid::text collate "C"
    limit 500;
end $$;

-- Account deletion: connections and privacy rows go.
create function public.st_network_delete_account(p_uid uuid) returns void
language sql security definer set search_path = ''
as $$
  delete from public.connections c where c.user_a = p_uid or c.user_b = p_uid;
  delete from public.network_privacy n where n.user_id = p_uid;
$$;
