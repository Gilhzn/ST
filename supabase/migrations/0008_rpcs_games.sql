-- 0008_rpcs_games.sql
-- Client RPCs for profiles, venues, map queries, games, joining and check-in.
-- Every function: SECURITY DEFINER, `set search_path = ''`, fully-qualified names, checks
-- auth.uid(), raises `ST:<ErrorCode>` (types.ts). EXECUTE grants are in 0011_rls_grants.sql.

-- ---------------------------------------------------------------------------
-- Shared guards
-- ---------------------------------------------------------------------------

-- The caller's live profile, or ST:unauthenticated / ST:forbidden / ST:account_banned.
create function public.st_active_profile() returns public.profiles
language plpgsql stable security definer set search_path = ''
as $$
declare p public.profiles;
begin
  select * into p from public.profiles x where x.id = public.st_uid();
  if p.id is null or p.deleted_at is not null then
    perform public.st_raise('forbidden', 'profile required');
  end if;
  if p.permanently_banned then
    perform public.st_raise('account_banned');
  end if;
  return p;
end $$;

create function public.st_iso(p_t timestamptz) returns text
language sql immutable set search_path = ''
as $$ select to_char(p_t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

-- Simple per-user rate limit over a table/time column (counts rows in the trailing window).
create function public.st_rate_limit(p_count bigint, p_max int) returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if p_count >= p_max then perform public.st_raise('rate_limited'); end if;
end $$;

create function public.st_validate_map_query(p_radius_km numeric, p_sports text[]) returns void
language plpgsql stable set search_path = ''
as $$
begin
  if p_radius_km is null or p_radius_km not in (1, 2, 5, 10, 30, 50) then
    perform public.st_raise('invalid_radius');
  end if;
  if cardinality(coalesce(p_sports, '{}')) > 3 then
    perform public.st_raise('too_many_sports');
  end if;
  if exists (select 1 from unnest(coalesce(p_sports, '{}')) s where s not in (select id from public.sports)) then
    perform public.st_raise('validation', 'unknown sport');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

-- Onboarding with the 16+ age gate (birth year/month only). Phone is copied from auth.users.
create function public.create_profile(
  p_display_name text, p_locale public.locale_code, p_birth_year int, p_birth_month int,
  p_gender public.gender default 'undisclosed', p_country_code text default null,
  p_avatar_url text default null, p_bio text default null)
returns public.profiles
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  t timestamptz := public.st_now();
  months int;
  p public.profiles;
  au record;
begin
  if exists (select 1 from public.profiles x where x.id = uid) then
    perform public.st_raise('conflict', 'profile exists');
  end if;
  if p_birth_year is null or p_birth_month is null or p_birth_month not between 1 and 12 or p_birth_year < 1900 then
    perform public.st_raise('validation', 'birth date');
  end if;
  -- Completed months of age, assuming the latest possible birthday in the birth month (conservative).
  months := (extract(year from t at time zone 'UTC')::int * 12 + extract(month from t at time zone 'UTC')::int)
            - (p_birth_year * 12 + p_birth_month) - 1;
  if months < 16 * 12 then
    perform public.st_raise('age_restricted');
  end if;
  if p_display_name is null or char_length(btrim(p_display_name)) not between 1 and 40 then
    perform public.st_raise('validation', 'display name');
  end if;
  select u.phone, u.created_at into au from auth.users u where u.id = uid;
  insert into public.profiles (id, display_name, locale, country_code, avatar_url, bio, created_at, reliability_computed_at)
  values (uid, btrim(p_display_name), p_locale, upper(p_country_code), p_avatar_url, p_bio, coalesce(au.created_at, t), t)
  returning * into p;
  insert into public.profile_private (user_id, phone, birth_year, birth_month, gender)
  values (uid, case when au.phone is null or au.phone = '' then null
                    when left(au.phone, 1) = '+' then au.phone else '+' || au.phone end,
          p_birth_year, p_birth_month, coalesce(p_gender, 'undisclosed'));
  return p;
end $$;

-- ---------------------------------------------------------------------------
-- Venues
-- ---------------------------------------------------------------------------

create function public.create_venue(
  p_name text, p_lat double precision, p_lng double precision, p_sports text[],
  p_address text default null, p_country_code text default null)
returns public.venue_views
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles := public.st_active_profile();
  t timestamptz := public.st_now();
  v_id uuid;
  r public.venue_views;
begin
  perform public.st_rate_limit(
    (select count(*) from public.venues v where v.created_by = me.id and v.created_at > t - interval '24 hours'), 10);
  if p_sports is null or cardinality(p_sports) = 0 then
    perform public.st_raise('validation', 'sports required');
  end if;
  insert into public.venues (name, geog, address, country_code, sports, created_by, created_at)
  values (btrim(p_name), public.st_point(p_lat, p_lng), p_address, upper(p_country_code), p_sports, me.id, t)
  returning id into v_id;
  select * into r from public.venue_views v where v.id = v_id;
  return r;
end $$;

create function public.nearby_venues(
  p_lat double precision, p_lng double precision, p_radius_km numeric, p_sports text[] default '{}')
returns table (
  id uuid, name text, lat double precision, lng double precision, address text, country_code text,
  sports text[], status public.venue_status, rating_avg numeric, rating_count int, created_by uuid,
  created_at timestamptz, distance_m double precision)
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  center extensions.geography := public.st_point(p_lat, p_lng);
begin
  perform public.st_validate_map_query(p_radius_km, p_sports);
  return query
    select v.id, v.name, extensions.st_y(v.geog::extensions.geometry), extensions.st_x(v.geog::extensions.geometry),
           v.address, v.country_code, v.sports, v.status, v.rating_avg, v.rating_count, v.created_by, v.created_at,
           extensions.st_distance(v.geog, center) as distance_m
    from public.venues v
    where v.status = 'active'
      and extensions.st_dwithin(v.geog, center, p_radius_km * 1000)
      and (cardinality(coalesce(p_sports, '{}')) = 0 or v.sports && p_sports)
    order by distance_m, v.id
    limit 500;
end $$;

create function public.rate_venue(
  p_venue_id uuid, p_sport text, p_overall int, p_attributes jsonb default '{}'::jsonb)
returns public.venue_ratings
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles := public.st_active_profile();
  t timestamptz := public.st_now();
  r public.venue_ratings;
begin
  if not exists (select 1 from public.venues v where v.id = p_venue_id and v.status = 'active') then
    perform public.st_raise('not_found');
  end if;
  if p_overall is null or p_overall not between 1 and 5 then
    perform public.st_raise('validation', 'overall must be 1..5');
  end if;
  insert into public.venue_ratings as vr (venue_id, user_id, sport, overall, attributes, created_at, updated_at)
  values (p_venue_id, me.id, p_sport, p_overall, coalesce(p_attributes, '{}'::jsonb), t, t)
  on conflict (venue_id, user_id, sport) do update
    set overall = excluded.overall, attributes = excluded.attributes
  returning * into r;
  return r;
end $$;

-- Waze-style report. Unique per reporter; the Nth distinct report (venueReportsToHide) since the
-- last moderator review hides the venue pending review and queues it.
create function public.report_venue(
  p_venue_id uuid, p_reason public.venue_report_reason, p_note text default null)
returns public.venue_reports
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles := public.st_active_profile();
  t timestamptz := public.st_now();
  cfg public.trust_config := public.st_config();
  v public.venues;
  r public.venue_reports;
  since timestamptz;
  n int;
begin
  select * into v from public.venues x where x.id = p_venue_id for update;
  if v.id is null or v.status = 'removed' then
    perform public.st_raise('not_found');
  end if;
  if exists (select 1 from public.venue_reports x where x.venue_id = p_venue_id and x.reporter_id = me.id) then
    perform public.st_raise('already_reported');
  end if;
  perform public.st_rate_limit(
    (select count(*) from public.venue_reports x where x.reporter_id = me.id and x.created_at > t - interval '24 hours'), 20);
  insert into public.venue_reports (venue_id, reporter_id, reason, note, created_at)
  values (p_venue_id, me.id, p_reason, p_note, t)
  returning * into r;

  select max(q.resolved_at) into since from public.review_queue q
  where q.venue_id = p_venue_id and q.kind = 'venue_reports' and q.status = 'resolved';
  select count(distinct x.reporter_id) into n from public.venue_reports x
  where x.venue_id = p_venue_id and x.created_at > coalesce(since, '-infinity'::timestamptz);

  if v.status = 'active' and n >= cfg.venue_reports_to_hide then
    update public.venues x set status = 'hidden_pending_review' where x.id = p_venue_id;
    perform public.st_enqueue_review('venue_reports', 'venue_reports:' || p_venue_id::text || ':' || r.id::text,
      v.created_by, 'normal', jsonb_build_object('reports', n), '{}', p_venue_id, null, null, null);
    if v.created_by is not null then
      perform public.st_notify(v.created_by, 'venue_hidden', jsonb_build_object('venueName', v.name), null, null,
                               'venue_hidden:' || r.id::text);
    end if;
    perform public.st_audit('venue.auto_hidden', v.created_by, jsonb_build_object('venueId', p_venue_id, 'reports', n));
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Games: create / cancel / map
-- ---------------------------------------------------------------------------

create function public.create_game(
  p_sport text, p_title text, p_visibility public.game_visibility, p_venue_id uuid,
  p_lat double precision, p_lng double precision, p_hide_exact_location boolean, p_capacity int,
  p_starts_at timestamptz, p_ends_at timestamptz, p_deposit_minor int default 0, p_currency text default 'EUR',
  p_women_only boolean default false, p_team_count int default 2, p_notes text default null,
  p_deposit_forfeit_to public.deposit_forfeit_target default 'pot')
returns public.game_views
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles := public.st_active_profile();
  t timestamptz := public.st_now();
  v public.venues;
  pos extensions.geography;
  g_id uuid;
  r public.game_views;
begin
  if me.host_suspended_until > t then
    perform public.st_raise('host_suspended');
  end if;
  -- TRUST-026 / TRUST-043: join-banned or visibility-restricted users may not create public games.
  if p_visibility = 'public' and me.join_banned_until > t then
    perform public.st_raise('join_banned');
  end if;
  if p_visibility = 'public' and me.visibility_restricted_until > t then
    perform public.st_raise('forbidden', 'visibility_restricted');
  end if;
  perform public.st_rate_limit(
    (select count(*) from public.games g where g.host_id = me.id and g.created_at > t - interval '24 hours'), 20);
  if not exists (select 1 from public.sports s where s.id = p_sport) then
    perform public.st_raise('validation', 'unknown sport');
  end if;
  if p_venue_id is not null then
    select * into v from public.venues x where x.id = p_venue_id;
    if v.id is null or v.status <> 'active' then
      perform public.st_raise('validation', 'venue not active');
    end if;
    if not (p_sport = any (v.sports)) then
      perform public.st_raise('validation', 'sport not offered at venue');
    end if;
    pos := v.geog;
  else
    pos := public.st_point(p_lat, p_lng);
  end if;
  if p_starts_at is null or p_ends_at is null or p_starts_at <= t or p_ends_at <= p_starts_at
     or p_ends_at - p_starts_at > interval '24 hours' or p_starts_at > t + interval '180 days' then
    perform public.st_raise('validation', 'invalid time range');
  end if;
  if p_capacity is null or p_capacity not between 2 and 200
     or p_team_count is null or p_team_count < 1 or p_team_count > p_capacity then
    perform public.st_raise('validation', 'capacity/team count');
  end if;
  if coalesce(p_deposit_minor, 0) < 0 or p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    perform public.st_raise('validation', 'deposit');
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 80 then
    perform public.st_raise('validation', 'title');
  end if;

  insert into public.games (host_id, sport, title, notes, visibility, venue_id, geog, approx_geog, hide_exact_location,
                            capacity, starts_at, ends_at, deposit_minor, currency, deposit_forfeit_to, women_only,
                            team_count, created_at)
  values (me.id, p_sport, btrim(p_title), p_notes, p_visibility, p_venue_id, pos, pos, coalesce(p_hide_exact_location, false),
          p_capacity, p_starts_at, p_ends_at, coalesce(p_deposit_minor, 0), p_currency,
          coalesce(p_deposit_forfeit_to, 'pot'), coalesce(p_women_only, false), p_team_count, t)
  returning id into g_id;
  -- The host is an approved participant and counts toward capacity.
  insert into public.game_participants (game_id, user_id, status, requested_at, decided_at)
  values (g_id, me.id, 'approved', t, t);
  select * into r from public.game_views x where x.id = g_id;
  return r;
end $$;

create function public.cancel_game(p_game_id uuid) returns public.game_views
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  t timestamptz := public.st_now();
  g public.games;
  r public.game_views;
  p record;
begin
  select * into g from public.games x where x.id = p_game_id for update;
  if g.id is null or not public.st_can_see_game(g.id) then perform public.st_raise('not_found'); end if;
  if g.host_id <> uid then perform public.st_raise('forbidden'); end if;
  if g.status <> 'scheduled' or g.ends_at <= t then perform public.st_raise('game_not_open'); end if;
  update public.games x set status = 'cancelled', cancelled_at = t where x.id = g.id;
  for p in select gp.user_id from public.game_participants gp
           where gp.game_id = g.id and gp.user_id <> g.host_id and gp.status in ('requested', 'approved', 'waitlisted')
  loop
    perform public.st_notify(p.user_id, 'game_cancelled', jsonb_build_object('gameTitle', g.title), g.id, null,
                             'game_cancelled:' || g.id::text || ':' || p.user_id::text);
  end loop;
  -- Deposits are released by settle_deposits() (game cancelled → release).
  select * into r from public.game_views x where x.id = g.id;
  return r;
end $$;

-- Map query. Validates radius/sports; hides games of blocked and visibility-restricted hosts
-- (st_can_see_game). For viewers who may not see the exact pin, both the radius filter and the
-- distance use the ~500 m approximate point, so distances cannot be used to trilaterate.
create function public.nearby_games(
  p_lat double precision, p_lng double precision, p_radius_km numeric, p_sports text[] default '{}',
  p_from timestamptz default null, p_to timestamptz default null, p_include_full boolean default true)
returns table (
  id uuid, host_id uuid, sport text, title text, notes text, visibility public.game_visibility, venue_id uuid,
  lat double precision, lng double precision, approx_lat double precision, approx_lng double precision,
  hide_exact_location boolean, capacity int, starts_at timestamptz, ends_at timestamptz, deposit_minor int,
  currency text, deposit_forfeit_to public.deposit_forfeit_target, women_only boolean, status public.game_status,
  team_count int, invite_token text, created_at timestamptz, approved_count int, waitlist_count int,
  is_host boolean, distance_m double precision)
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  center extensions.geography := public.st_point(p_lat, p_lng);
  v_from timestamptz := coalesce(p_from, public.st_now());
  v_to timestamptz;
begin
  perform public.st_validate_map_query(p_radius_km, p_sports);
  v_to := coalesce(p_to, v_from + interval '14 days');
  if v_to <= v_from or v_to - v_from > interval '60 days' then
    perform public.st_raise('validation', 'time range');
  end if;
  return query
    with cand as (
      select g.*, public.st_can_see_exact(g.id, uid) as exact
      from public.games g
      where extensions.st_dwithin(g.approx_geog, center, p_radius_km * 1000 + 600)
        and g.status = 'scheduled'
        and g.starts_at >= v_from and g.starts_at < v_to
        and (cardinality(coalesce(p_sports, '{}')) = 0 or g.sport = any (p_sports))
        and public.st_can_see_game(g.id, uid)
    ), measured as (
      select c.*,
             extensions.st_distance(case when c.exact then c.geog else c.approx_geog end, center) as dist,
             (select count(*)::int from public.game_participants gp where gp.game_id = c.id and gp.status = 'approved') as n_appr,
             (select count(*)::int from public.game_participants gp where gp.game_id = c.id and gp.status = 'waitlisted') as n_wait
      from cand c
    )
    select m.id, m.host_id, m.sport, m.title, m.notes, m.visibility,
           case when m.exact then m.venue_id end,
           case when m.exact then extensions.st_y(m.geog::extensions.geometry) end,
           case when m.exact then extensions.st_x(m.geog::extensions.geometry) end,
           extensions.st_y(m.approx_geog::extensions.geometry), extensions.st_x(m.approx_geog::extensions.geometry),
           m.hide_exact_location, m.capacity, m.starts_at, m.ends_at, m.deposit_minor, m.currency, m.deposit_forfeit_to,
           m.women_only, m.status, m.team_count,
           case when m.host_id = uid then m.invite_token end,
           m.created_at, m.n_appr, m.n_wait, m.host_id = uid, m.dist
    from measured m
    where m.dist <= p_radius_km * 1000
      and (coalesce(p_include_full, true) or m.n_appr < m.capacity)
    order by m.starts_at, m.dist, m.id
    limit 500;
end $$;

-- Opening an invite link grants visibility of a private game (location stays hidden until approval).
create function public.resolve_invite(p_token text) returns public.game_views
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles := public.st_active_profile();
  g public.games;
  r public.game_views;
begin
  select * into g from public.games x where x.invite_token = p_token;
  if g.id is null or public.st_is_blocked(g.host_id, me.id) or public.st_is_hidden_user(g.host_id) then
    return null;
  end if;
  insert into public.game_invite_access (game_id, user_id) values (g.id, me.id) on conflict do nothing;
  select * into r from public.game_views x where x.id = g.id;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Joining
-- ---------------------------------------------------------------------------

create function public.st_participant_view(p_game_id uuid, p_user_id uuid) returns public.participant_views
language plpgsql stable security definer set search_path = ''
as $$
declare r public.participant_views;
begin
  select * into r from public.participant_views v where v.game_id = p_game_id and v.user_id = p_user_id;
  return r;
end $$;

-- Waitlist offers (GAME-045). When spots free up: more than waitlistLongThresholdHours before
-- start the next players in FIFO order get an offer valid waitlistConfirmLongMinutes; closer to
-- start waitlistConfirmShortMinutes; within waitlistFlashFillHours every waitlisted player gets a
-- flash offer and the first to accept wins (accept_waitlist_offer). Unanswered non-flash offers
-- expire in expire_waitlist_offers() and pass to the next in line. Returns offers made.
create function public.st_promote_waitlist(p_game_id uuid) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  cfg public.trust_config := public.st_config();
  g public.games;
  free int;
  flash boolean;
  win interval;
  w record;
  n int := 0;
begin
  select * into g from public.games x where x.id = p_game_id for update;
  if g.id is null or g.status <> 'scheduled' or g.ends_at <= t then return 0; end if;
  select g.capacity
         - count(*) filter (where gp.status = 'approved')
         - count(*) filter (where gp.status = 'waitlisted' and gp.offer_expires_at > t and not gp.offer_is_flash)
    into free
  from public.game_participants gp where gp.game_id = g.id;
  if free <= 0 then return 0; end if;
  flash := t >= g.starts_at - cfg.waitlist_flash_fill_hours * interval '1 hour';
  win := case when g.starts_at - t > cfg.waitlist_long_threshold_hours * interval '1 hour'
              then cfg.waitlist_confirm_long_minutes * interval '1 minute'
              else cfg.waitlist_confirm_short_minutes * interval '1 minute' end;
  for w in select gp.user_id from public.game_participants gp
           where gp.game_id = g.id and gp.status = 'waitlisted'
             and (gp.offer_expires_at is null or gp.offer_expires_at <= t)
           order by gp.waitlisted_at, gp.user_id
           limit case when flash then null else free end
  loop
    update public.game_participants gp
       set offer_expires_at = case when flash then g.ends_at else least(t + win, g.ends_at) end,
           offer_is_flash = flash
    where gp.game_id = g.id and gp.user_id = w.user_id;
    perform public.st_notify(w.user_id, 'waitlist_promoted',
      jsonb_build_object('gameTitle', g.title, 'flash', flash,
                         'offerExpiresAt', public.st_iso(case when flash then g.ends_at else least(t + win, g.ends_at) end)),
      g.id, null, 'offer:' || g.id::text || ':' || w.user_id::text || ':' || extract(epoch from t)::text);
    n := n + 1;
  end loop;
  return n;
end $$;

-- The earliest late canceller whose spot has not been taken yet (TRUST-021 refill linkage).
create function public.st_next_refill_target(p_game_id uuid) returns uuid
language sql stable security definer set search_path = ''
as $$
  select c.user_id from public.game_participants c
  where c.game_id = p_game_id and c.status = 'cancelled' and c.late_cancel and not c.late_cancel_refilled
    and not exists (select 1 from public.game_participants r where r.game_id = p_game_id and r.replaces_user_id = c.user_id)
  order by c.cancelled_at, c.user_id
  limit 1
$$;

-- Accept a waitlist offer. Transactional lock on the game row: with flash fill the first to accept
-- wins and the others get ST:game_full (they stay on the waitlist).
create function public.accept_waitlist_offer(p_game_id uuid) returns public.participant_views
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  t timestamptz := public.st_now();
  g public.games;
  pt public.game_participants;
  n_appr int;
  w record;
begin
  select * into g from public.games x where x.id = p_game_id for update;
  if g.id is null then perform public.st_raise('not_found'); end if;
  select * into pt from public.game_participants gp where gp.game_id = g.id and gp.user_id = uid for update;
  if pt.game_id is null or pt.status <> 'waitlisted' or pt.offer_expires_at is null or pt.offer_expires_at <= t then
    perform public.st_raise('conflict', 'no active offer');
  end if;
  if g.status <> 'scheduled' or g.ends_at <= t then perform public.st_raise('game_not_open'); end if;
  select count(*) into n_appr from public.game_participants gp where gp.game_id = g.id and gp.status = 'approved';
  if n_appr >= g.capacity then
    update public.game_participants gp set offer_expires_at = null, offer_is_flash = false
    where gp.game_id = g.id and gp.user_id = uid;
    perform public.st_raise('game_full');
  end if;
  update public.game_participants gp
     set status = 'approved', decided_at = t, waitlisted_at = null, offer_expires_at = null, offer_is_flash = false,
         replaces_user_id = public.st_next_refill_target(g.id)
  where gp.game_id = g.id and gp.user_id = uid;
  if n_appr + 1 >= g.capacity then
    -- Spot taken: withdraw outstanding flash offers ("you are still on the list").
    for w in update public.game_participants gp set offer_expires_at = null, offer_is_flash = false
             where gp.game_id = g.id and gp.status = 'waitlisted' and gp.offer_expires_at is not null
             returning gp.user_id
    loop
      perform public.st_notify(w.user_id, 'join_waitlisted', jsonb_build_object('gameTitle', g.title, 'spotTaken', true),
                               g.id, null, 'spot_taken:' || g.id::text || ':' || w.user_id::text || ':' || extract(epoch from t)::text);
    end loop;
  end if;
  return public.st_participant_view(g.id, uid);
end $$;

create function public.request_join(p_game_id uuid, p_position text default null, p_invite_token text default null)
returns public.participant_views
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles := public.st_active_profile();
  t timestamptz := public.st_now();
  g public.games;
  existing public.game_participants;
  v_gender public.gender;
  ready boolean;
begin
  if me.join_banned_until > t then
    perform public.st_raise('join_banned');
  end if;
  select * into g from public.games x where x.id = p_game_id;
  if g.id is null then perform public.st_raise('not_found'); end if;
  if public.st_is_blocked(g.host_id, me.id) then perform public.st_raise('blocked'); end if;
  if not public.st_can_see_game(g.id, me.id) then
    if g.visibility = 'private' and p_invite_token is not null and p_invite_token = g.invite_token
       and not public.st_is_hidden_user(g.host_id) then
      insert into public.game_invite_access (game_id, user_id) values (g.id, me.id) on conflict do nothing;
    else
      perform public.st_raise('not_found');
    end if;
  end if;
  if g.host_id = me.id then perform public.st_raise('conflict', 'host is already in the game'); end if;
  if exists (select 1 from public.game_participants gp
             where gp.game_id = g.id and gp.status = 'approved' and public.st_is_blocked(gp.user_id, me.id)) then
    perform public.st_raise('blocked');
  end if;
  if g.status <> 'scheduled' or g.starts_at <= t then perform public.st_raise('game_not_open'); end if;
  -- TRUST-043: a visibility-restricted user cannot request to join public games.
  if g.visibility = 'public' and me.visibility_restricted_until > t then
    perform public.st_raise('forbidden', 'visibility_restricted');
  end if;
  if g.women_only then
    select pp.gender into v_gender from public.profile_private pp where pp.user_id = me.id;
    if v_gender is distinct from 'female' then perform public.st_raise('women_only'); end if;
  end if;
  if p_position is not null and not exists (select 1 from public.sports s where s.id = g.sport and p_position = any (s.positions)) then
    perform public.st_raise('validation', 'position');
  end if;

  select * into existing from public.game_participants gp where gp.game_id = g.id and gp.user_id = me.id for update;
  if existing.game_id is not null then
    if existing.status in ('requested', 'approved', 'waitlisted') then perform public.st_raise('conflict'); end if;
    if existing.status in ('rejected', 'removed') then perform public.st_raise('forbidden'); end if;
  end if;

  ready := g.deposit_minor = 0;
  if not ready then
    insert into public.payments (user_id, game_id, purpose, amount_minor, currency, status, deposit_state, idempotency_key)
    values (me.id, g.id, 'deposit', g.deposit_minor, g.currency, 'requires_payment_method', 'setup',
            'deposit:' || g.id::text || ':' || me.id::text || ':setup')
    on conflict (idempotency_key) do nothing;
    select pm.status = 'succeeded' and pm.deposit_state = 'setup' into ready
    from public.payments pm where pm.idempotency_key = 'deposit:' || g.id::text || ':' || me.id::text || ':setup';
    ready := coalesce(ready, false);
  end if;

  insert into public.game_participants as gp (game_id, user_id, status, position, payment_ready, requested_at)
  values (g.id, me.id, 'requested', p_position, ready, t)
  on conflict (game_id, user_id) do update
    set status = 'requested', position = excluded.position, payment_ready = excluded.payment_ready,
        requested_at = excluded.requested_at, decided_at = null, waitlisted_at = null, team = null;

  if ready then
    perform public.st_notify(g.host_id, 'join_requested', jsonb_build_object('gameTitle', g.title), g.id, null,
                             'join_requested:' || g.id::text || ':' || me.id::text || ':' || extract(epoch from t)::text);
  end if;
  return public.st_participant_view(g.id, me.id);
end $$;

create function public.decide_join(p_game_id uuid, p_user_id uuid, p_decision text)
returns public.participant_views
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  t timestamptz := public.st_now();
  g public.games;
  pt public.game_participants;
  n_appr int;
  new_status public.participant_status;
begin
  if p_decision is null or p_decision not in ('approve', 'reject') then perform public.st_raise('validation', 'decision'); end if;
  select * into g from public.games x where x.id = p_game_id for update;
  if g.id is null then perform public.st_raise('not_found'); end if;
  if g.host_id <> uid then perform public.st_raise('forbidden'); end if;
  if g.status <> 'scheduled' or g.ends_at <= t then perform public.st_raise('game_not_open'); end if;
  select * into pt from public.game_participants gp where gp.game_id = g.id and gp.user_id = p_user_id for update;
  if pt.game_id is null then perform public.st_raise('not_found'); end if;
  if pt.status <> 'requested' then perform public.st_raise('conflict'); end if;
  if not pt.payment_ready then perform public.st_raise('payment_required'); end if;

  if p_decision = 'reject' then
    new_status := 'rejected';
  else
    select count(*) into n_appr from public.game_participants gp
    where gp.game_id = g.id
      and (gp.status = 'approved' or (gp.status = 'waitlisted' and gp.offer_expires_at > t and not gp.offer_is_flash));
    -- Approving when full (or when free spots are already offered to the waitlist) waitlists.
    new_status := case when n_appr < g.capacity
                        and not exists (select 1 from public.game_participants w where w.game_id = g.id and w.status = 'waitlisted'
                                          and w.offer_expires_at > t)
                       then 'approved' else 'waitlisted' end;
  end if;
  update public.game_participants gp set status = new_status, decided_at = t,
         waitlisted_at = case when new_status = 'waitlisted' then t end,
         replaces_user_id = case when new_status = 'approved' then public.st_next_refill_target(g.id) end
  where gp.game_id = g.id and gp.user_id = p_user_id;
  perform public.st_notify(p_user_id,
    case new_status when 'approved' then 'join_approved'::public.notification_kind
                    when 'waitlisted' then 'join_waitlisted'::public.notification_kind
                    else 'join_rejected'::public.notification_kind end,
    jsonb_build_object('gameTitle', g.title), g.id, null,
    'decide:' || g.id::text || ':' || p_user_id::text || ':' || extract(epoch from t)::text);
  if new_status = 'waitlisted' then
    perform public.st_promote_waitlist(g.id);
  end if;
  return public.st_participant_view(g.id, p_user_id);
end $$;

create function public.remove_participant(p_game_id uuid, p_user_id uuid)
returns public.participant_views
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  t timestamptz := public.st_now();
  g public.games;
  pt public.game_participants;
begin
  select * into g from public.games x where x.id = p_game_id for update;
  if g.id is null then perform public.st_raise('not_found'); end if;
  if g.host_id <> uid then perform public.st_raise('forbidden'); end if;
  if p_user_id = g.host_id then perform public.st_raise('validation', 'host cannot be removed'); end if;
  select * into pt from public.game_participants gp where gp.game_id = g.id and gp.user_id = p_user_id for update;
  if pt.game_id is null then perform public.st_raise('not_found'); end if;
  if pt.status not in ('requested', 'approved', 'waitlisted') then perform public.st_raise('conflict'); end if;
  update public.game_participants gp
     set status = 'removed', decided_at = t, waitlisted_at = null, team = null, offer_expires_at = null, offer_is_flash = false
  where gp.game_id = g.id and gp.user_id = p_user_id;
  perform public.st_notify(p_user_id, 'participant_removed', jsonb_build_object('gameTitle', g.title), g.id, null,
                           'removed:' || g.id::text || ':' || p_user_id::text);
  perform public.st_promote_waitlist(g.id);
  return public.st_participant_view(g.id, p_user_id);
end $$;

-- Withdraw. A cancel by an approved player within lateCancelWindowHours of start is a late cancel:
-- a provisional yellow card (statement key sanctions.reason.late_cancel), disputable for
-- disputeWindowHours. It is voided at closure (process_no_shows) if the spot was refilled and the
-- replacement checked in (TRUST-021). The deposit is not released for an unrefilled late cancel.
create function public.cancel_participation(p_game_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  t timestamptz := public.st_now();
  cfg public.trust_config := public.st_config();
  g public.games;
  pt public.game_participants;
  late boolean;
  s public.sanctions;
begin
  select * into g from public.games x where x.id = p_game_id for update;
  if g.id is null then perform public.st_raise('not_found'); end if;
  select * into pt from public.game_participants gp where gp.game_id = g.id and gp.user_id = uid for update;
  if pt.game_id is null then perform public.st_raise('not_found'); end if;
  if g.host_id = uid then perform public.st_raise('conflict', 'host must cancel the game'); end if;
  if pt.status not in ('requested', 'approved', 'waitlisted') then perform public.st_raise('conflict'); end if;
  if g.status <> 'scheduled' or g.ends_at <= t then perform public.st_raise('game_not_open'); end if;

  late := pt.status = 'approved' and t > g.starts_at - cfg.late_cancel_window_hours * interval '1 hour';
  update public.game_participants gp
     set status = 'cancelled', cancelled_at = t, late_cancel = late, late_cancel_refilled = false, team = null,
         waitlisted_at = null, offer_expires_at = null, offer_is_flash = false
  where gp.game_id = g.id and gp.user_id = uid;

  if late then
    s := public.st_issue_sanction(uid, 'yellow_card', 'late_cancel',
           jsonb_build_object('gameTitle', g.title, 'hours', cfg.late_cancel_window_hours),
           cfg.yellow_card_lifetime_days * interval '1 day', cfg.dispute_window_hours * interval '1 hour',
           g.id, '{}', 'late_cancel:' || g.id::text || ':' || uid::text);
  end if;
  perform public.st_promote_waitlist(g.id);
  perform public.st_recompute_reliability(uid);
  return jsonb_build_object(
    'participant', to_jsonb(public.st_participant_view(g.id, uid)),
    'sanction', case when s.id is null then null else to_jsonb(s) end);
end $$;

-- Host saves team assignments {userId: teamIndex}; approved players not listed become unassigned.
create function public.save_teams(p_game_id uuid, p_assignments jsonb)
returns setof public.participant_views
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  g public.games;
  k text;
  v jsonb;
begin
  select * into g from public.games x where x.id = p_game_id for update;
  if g.id is null then perform public.st_raise('not_found'); end if;
  if g.host_id <> uid then perform public.st_raise('forbidden'); end if;
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'object' then perform public.st_raise('validation'); end if;
  for k, v in select * from jsonb_each(p_assignments) loop
    if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]+$' or (v #>> '{}')::int >= g.team_count then
      perform public.st_raise('validation', 'team index');
    end if;
    if k !~ '^[0-9a-fA-F-]{36}$' or not exists (select 1 from public.game_participants gp
                   where gp.game_id = g.id and gp.user_id = k::uuid and gp.status = 'approved') then
      perform public.st_raise('validation', 'not an approved participant');
    end if;
  end loop;
  update public.game_participants gp
     set team = (p_assignments ->> gp.user_id::text)::int
  where gp.game_id = g.id and gp.status = 'approved';
  return query select * from public.participant_views pv where pv.game_id = g.id order by pv.requested_at, pv.user_id;
end $$;

create function public.submit_result(p_game_id uuid, p_team_scores int[]) returns public.game_results
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  t timestamptz := public.st_now();
  cfg public.trust_config := public.st_config();
  g public.games;
  r public.game_results;
begin
  select * into g from public.games x where x.id = p_game_id;
  if g.id is null or not public.st_can_see_game(g.id, uid) then perform public.st_raise('not_found'); end if;
  if not public.st_is_approved(g.id, uid) then perform public.st_raise('forbidden'); end if;
  if g.status = 'cancelled' then perform public.st_raise('game_not_open'); end if;
  if t < g.ends_at or t > g.ends_at + cfg.result_window_hours * interval '1 hour' then
    perform public.st_raise('outside_window');
  end if;
  if p_team_scores is null or cardinality(p_team_scores) <> g.team_count or not (0 <= all (p_team_scores))
     or array_position(p_team_scores, null) is not null then
    perform public.st_raise('validation', 'team scores');
  end if;
  insert into public.game_results as gr (game_id, team_scores, submitted_by, submitted_at, game_ends_at)
  values (g.id, p_team_scores, uid, t, g.ends_at)
  on conflict (game_id) do update set team_scores = excluded.team_scores, submitted_by = excluded.submitted_by,
                                      submitted_at = excluded.submitted_at
  returning * into r;
  return r;
end $$;

-- Verified attendees rate the host once, within hostRatingWindowHours after the game (TRUST-050).
-- Low average over enough recent ratings → temporary host suspension + review (never permanent).
create function public.rate_host(p_game_id uuid, p_stars int) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  t timestamptz := public.st_now();
  g public.games;
begin
  select * into g from public.games x where x.id = p_game_id;
  if g.id is null then perform public.st_raise('not_found'); end if;
  if g.host_id = uid or not exists (select 1 from public.game_participants gp where gp.game_id = g.id and gp.user_id = uid
                                       and gp.status = 'approved' and gp.attendance = 'verified') then
    perform public.st_raise('forbidden');
  end if;
  if t < g.ends_at or t > g.ends_at + (public.st_config()).host_rating_window_hours * interval '1 hour' then
    perform public.st_raise('outside_window');
  end if;
  if p_stars is null or p_stars not between 1 and 5 then perform public.st_raise('validation'); end if;
  insert into public.host_ratings (game_id, rater_id, host_id, stars, created_at)
  values (g.id, uid, g.host_id, p_stars, t)
  on conflict do nothing;
  if not found then perform public.st_raise('conflict'); end if;
  perform public.st_evaluate_host(g.host_id);
end $$;

create function public.st_evaluate_host(p_host uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  cfg public.trust_config := public.st_config();
  t timestamptz := public.st_now();
  n int;
  avg_stars numeric;
  s public.sanctions;
begin
  select count(*), avg(hr.stars) into n, avg_stars from public.host_ratings hr
  where hr.host_id = p_host and hr.created_at > t - cfg.host_rating_lookback_days * interval '1 day';
  if n >= cfg.host_low_rating_min_count and avg_stars <= cfg.host_low_rating_max
     and not exists (select 1 from public.sanctions x where x.user_id = p_host and x.kind = 'host_suspension'
                     and public.st_sanction_in_force(x, t)) then
    s := public.st_issue_sanction(p_host, 'host_suspension', 'low_host_rating',
           jsonb_build_object('average', round(avg_stars, 2), 'ratings', n, 'days', cfg.host_suspension_days),
           cfg.host_suspension_days * interval '1 day', null, null, '{}',
           'low_host_rating:' || p_host::text || ':' || n::text);
    perform public.st_enqueue_review('host_reliability', 'host_reliability:' || s.dedupe_key, p_host, 'normal',
      jsonb_build_object('average', round(avg_stars, 2), 'ratings', n), '{}', null, null, s.id, null);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Check-in: QR (HMAC-SHA256 over `${gameId}|${step}` keyed with games.qr_secret), host, peer
-- ---------------------------------------------------------------------------

create function public.st_qr_hmac(p_secret bytea, p_game_id uuid, p_step bigint) returns text
language sql immutable set search_path = ''
as $$ select encode(extensions.hmac(convert_to(p_game_id::text || '|' || p_step::text, 'UTF8'), p_secret, 'sha256'), 'hex') $$;

create function public.st_qr_step(p_t timestamptz, p_step_seconds int) returns bigint
language sql immutable set search_path = ''
as $$ select floor(extract(epoch from p_t) / p_step_seconds)::bigint $$;

-- 'ok' | 'invalid_qr' | 'expired_qr'. Accepts the current step ± qrAllowedDriftSteps; a token
-- valid for a step up to 20 steps away is reported as expired (useful UX), anything else invalid.
create function public.st_verify_qr_token(p_secret bytea, p_game_id uuid, p_token text, p_now timestamptz,
                                          p_cfg public.trust_config)
returns text
language plpgsql stable set search_path = ''
as $$
declare
  cur bigint := public.st_qr_step(p_now, p_cfg.qr_step_seconds);
  tok text := lower(btrim(coalesce(p_token, '')));
  d int;
begin
  if tok !~ '^[0-9a-f]{64}$' then return 'invalid_qr'; end if;
  for d in -p_cfg.qr_allowed_drift_steps .. p_cfg.qr_allowed_drift_steps loop
    if public.st_qr_hmac(p_secret, p_game_id, cur + d) = tok then return 'ok'; end if;
  end loop;
  for d in -20 .. 20 loop
    if abs(d) > p_cfg.qr_allowed_drift_steps and public.st_qr_hmac(p_secret, p_game_id, cur + d) = tok then
      return 'expired_qr';
    end if;
  end loop;
  return 'invalid_qr';
end $$;

create function public.get_qr_token(p_game_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  cfg public.trust_config := public.st_config();
  g public.games;
  step bigint;
begin
  select * into g from public.games x where x.id = p_game_id;
  if g.id is null then perform public.st_raise('not_found'); end if;
  if g.host_id <> uid then perform public.st_raise('forbidden'); end if;
  if g.qr_secret is null then perform public.st_raise('game_not_open', 'qr secret purged'); end if;
  step := public.st_qr_step(public.st_now(), cfg.qr_step_seconds);
  return jsonb_build_object(
    'token', public.st_qr_hmac(g.qr_secret, g.id, step),
    'step', step,
    'expiresAt', public.st_iso(to_timestamp((step + 1) * cfg.qr_step_seconds)));
end $$;

create function public.rotate_qr(p_game_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := public.st_uid();
begin
  if not exists (select 1 from public.games g where g.id = p_game_id) then perform public.st_raise('not_found'); end if;
  if not public.st_is_host(p_game_id, uid) then perform public.st_raise('forbidden'); end if;
  update public.games g set qr_secret = extensions.gen_random_bytes(32) where g.id = p_game_id;
  return public.get_qr_token(p_game_id);
end $$;

create function public.st_verdict_rejected(p_method public.checkin_method, p_reason public.checkin_reject_reason,
                                           p_fallbacks text[], p_signals text[] default '{}')
returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object('outcome', 'rejected', 'method', p_method, 'reason', p_reason,
                            'fallbacks', to_jsonb(coalesce(p_fallbacks, '{}')), 'signals', to_jsonb(coalesce(p_signals, '{}')))
$$;

create function public.st_verdict_verified(p_method public.checkin_method, p_distance numeric default null,
                                           p_signals text[] default '{}')
returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object('outcome', 'verified', 'method', p_method, 'distanceM', p_distance,
                            'signals', to_jsonb(coalesce(p_signals, '{}')))
$$;

-- Record a verdict for (game, user): log the attempt and mark attendance on success. Enforces
-- participant / already-checked-in / window rules regardless of the caller's verdict.
create function public.st_record_checkin(p_game_id uuid, p_user_id uuid, p_verdict jsonb, p_submitted_by uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  cfg public.trust_config := public.st_config();
  g public.games;
  pt public.game_participants;
  m public.checkin_method := (p_verdict ->> 'method')::public.checkin_method;
  verdict jsonb := p_verdict;
  sigs public.spoof_signal[];
begin
  select * into g from public.games x where x.id = p_game_id;
  select * into pt from public.game_participants gp where gp.game_id = p_game_id and gp.user_id = p_user_id for update;
  if pt.game_id is null or pt.status <> 'approved' then
    verdict := public.st_verdict_rejected(m, 'not_participant', '{}');
  elsif pt.attendance = 'verified' then
    verdict := public.st_verdict_rejected(m, 'already_checked_in', '{}');
  elsif g.status <> 'scheduled' or t < g.starts_at - cfg.check_in_opens_minutes_before_start * interval '1 minute' or t > g.ends_at then
    verdict := public.st_verdict_rejected(m, 'outside_window', '{}');
  end if;
  select coalesce(array_agg(x::public.spoof_signal), '{}') into sigs
  from jsonb_array_elements_text(coalesce(p_verdict -> 'signals', '[]'::jsonb)) x;
  if pt.game_id is not null then
    insert into public.checkins (game_id, user_id, method, outcome, reason, distance_m, signals, submitted_by, created_at)
    values (p_game_id, p_user_id, m, verdict ->> 'outcome', (verdict ->> 'reason')::public.checkin_reject_reason,
            (verdict ->> 'distanceM')::numeric, sigs, p_submitted_by, t);
  end if;
  if verdict ->> 'outcome' = 'verified' then
    update public.game_participants gp set attendance = 'verified', check_in_method = m, checked_in_at = t
    where gp.game_id = p_game_id and gp.user_id = p_user_id;
  end if;
  return verdict;
end $$;

-- Client check-in for QR and host methods (GPS goes through the checkin-verify Edge Function,
-- which records via record_checkin_verdict). Rejections are returned, never thrown.
create function public.submit_checkin(p_game_id uuid, p_method public.checkin_method, p_token text default null,
                                      p_target_user_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  t timestamptz := public.st_now();
  cfg public.trust_config := public.st_config();
  g public.games;
  target uuid;
  qr text;
begin
  if p_method not in ('qr', 'host') then
    perform public.st_raise('validation', 'use checkin-verify for gps and peer_confirm for peer');
  end if;
  select * into g from public.games x where x.id = p_game_id;
  if g.id is null or not public.st_can_see_game(g.id, uid) then perform public.st_raise('not_found'); end if;
  perform public.st_rate_limit(
    (select count(*) from public.checkins c where c.game_id = g.id and c.submitted_by = uid
       and c.outcome = 'rejected' and c.created_at > t - interval '10 minutes'), 20);

  if p_method = 'host' then
    if g.host_id <> uid then
      return public.st_verdict_rejected('host', 'not_host', array['qr', 'peer']);
    end if;
    target := p_target_user_id;
    if target is null or target = g.host_id then perform public.st_raise('validation', 'target'); end if;
    return public.st_record_checkin(g.id, target, public.st_verdict_verified('host'), uid);
  end if;

  -- QR: verify before recording so a bad token does not reveal participant state.
  qr := public.st_verify_qr_token(g.qr_secret, g.id, p_token, t, cfg);
  if qr <> 'ok' then
    if exists (select 1 from public.game_participants gp where gp.game_id = g.id and gp.user_id = uid) then
      insert into public.checkins (game_id, user_id, method, outcome, reason, submitted_by, created_at)
      values (g.id, uid, 'qr', 'rejected', qr::public.checkin_reject_reason, uid, t);
    end if;
    return public.st_verdict_rejected('qr', qr::public.checkin_reject_reason, array['host', 'peer']);
  end if;
  return public.st_record_checkin(g.id, uid, public.st_verdict_verified('qr'), uid);
end $$;

-- Service role (checkin-verify Edge Function): record a GPS/QR/host verdict computed by the domain.
create function public.record_checkin_verdict(p_game_id uuid, p_user_id uuid, p_verdict jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if p_verdict is null or p_verdict ->> 'outcome' not in ('verified', 'rejected')
     or p_verdict ->> 'method' not in ('gps', 'qr', 'host', 'peer')
     or (p_verdict ->> 'outcome' = 'rejected' and p_verdict ->> 'reason' is null) then
    perform public.st_raise('validation', 'verdict');
  end if;
  if not exists (select 1 from public.games g where g.id = p_game_id) then perform public.st_raise('not_found'); end if;
  return public.st_record_checkin(p_game_id, p_user_id, p_verdict, null);
end $$;

-- A verified attendee vouches for a target. Target becomes verified with ≥ peerMinConfirmations
-- qualifying confirmers (verified, not in a blocked pair with the target), unless all of them are
-- reciprocal (the target also confirmed them).
create function public.peer_confirm(p_game_id uuid, p_target_user_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  t timestamptz := public.st_now();
  cfg public.trust_config := public.st_config();
  g public.games;
  tgt public.game_participants;
  q int;
  q_nonrecip int;
  verdict jsonb;
begin
  select * into g from public.games x where x.id = p_game_id;
  if g.id is null or not public.st_can_see_game(g.id, uid) then perform public.st_raise('not_found'); end if;
  if p_target_user_id is null or p_target_user_id = uid then perform public.st_raise('validation', 'target'); end if;
  if not exists (select 1 from public.game_participants gp where gp.game_id = g.id and gp.user_id = uid
                   and gp.status = 'approved' and gp.attendance = 'verified') then
    perform public.st_raise('forbidden', 'confirmer must be a verified attendee');
  end if;
  if g.status <> 'scheduled' or t < g.starts_at - cfg.check_in_opens_minutes_before_start * interval '1 minute' or t > g.ends_at then
    perform public.st_raise('outside_window');
  end if;
  select * into tgt from public.game_participants gp where gp.game_id = g.id and gp.user_id = p_target_user_id;
  if tgt.game_id is null or tgt.status <> 'approved' then
    return jsonb_build_object('confirmations', 0, 'verdict', public.st_verdict_rejected('peer', 'not_participant', '{}'));
  end if;
  if public.st_is_blocked(uid, p_target_user_id) then
    return jsonb_build_object('confirmations', 0, 'verdict', public.st_verdict_rejected('peer', 'blocked_pair', array['qr', 'host']));
  end if;
  insert into public.peer_confirmations (game_id, confirmer_id, target_id, created_at)
  values (g.id, uid, p_target_user_id, t) on conflict do nothing;

  select count(*), count(*) filter (where not exists (
           select 1 from public.peer_confirmations back
           where back.game_id = pc.game_id and back.confirmer_id = pc.target_id and back.target_id = pc.confirmer_id))
    into q, q_nonrecip
  from public.peer_confirmations pc
  join public.game_participants cp on cp.game_id = pc.game_id and cp.user_id = pc.confirmer_id
  where pc.game_id = g.id and pc.target_id = p_target_user_id
    and cp.status = 'approved' and cp.attendance = 'verified'
    and not public.st_is_blocked(pc.confirmer_id, pc.target_id);

  if tgt.attendance = 'verified' then
    verdict := public.st_verdict_verified(coalesce(tgt.check_in_method, 'peer'));
  elsif q < cfg.peer_min_confirmations then
    verdict := public.st_verdict_rejected('peer', 'insufficient_peers', array['qr', 'host']);
  elsif q_nonrecip = 0 then
    verdict := public.st_verdict_rejected('peer', 'reciprocal_only', array['qr', 'host']);
  else
    verdict := public.st_record_checkin(g.id, p_target_user_id, public.st_verdict_verified('peer'), uid);
  end if;
  return jsonb_build_object('confirmations', q, 'verdict', verdict);
end $$;
