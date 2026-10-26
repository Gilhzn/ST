-- 0100_series.sql (Phase 1.5, contract v3)
-- Recurring series, occurrences, rosters, "always in" auto-joins and the roster priority window
-- (PRD GAME-010/011, GAME-044). Also: phase15_config (DEFAULT_PHASE15_CONFIG parity), the Phase 1.5
-- notification kinds, and the MVP functions that series change (request_join priority window,
-- nearby_games hiding during the window, st_can_see_game for regulars, waitlist regulars first).
--
-- Time: a series is scheduled in its IANA time zone (`time_zone`). Each slot is a local date +
-- local start time converted with timezone(<IANA>, timestamp) (st_local_to_utc), so occurrences keep
-- their wall-clock time across DST; durations are absolute. A start time that does not exist on a
-- DST-forward day is shifted forward by the gap; an ambiguous (fall-back) time takes the first
-- (daylight) instant.

-- ---------------------------------------------------------------------------
-- Enums (values identical to types.ts v3 unions)
-- ---------------------------------------------------------------------------
create type public.series_recurrence as enum ('weekly', 'biweekly');
create type public.series_status as enum ('active', 'paused', 'ended');
create type public.roster_status as enum ('regular', 'invited', 'left');
create type public.roster_join_source as enum ('invite_link', 'host', 'played_with');
create type public.occurrence_status as enum ('scheduled', 'skipped', 'cancelled');

-- Phase15NotificationKind (types.ts). Used only inside plpgsql bodies (evaluated at run time, after
-- this migration committed).
alter type public.notification_kind add value if not exists 'roster_added';
alter type public.notification_kind add value if not exists 'series_reconfirm';
alter type public.notification_kind add value if not exists 'series_auto_released';
alter type public.notification_kind add value if not exists 'roster_leave_offer';
alter type public.notification_kind add value if not exists 'occurrence_skipped';
alter type public.notification_kind add value if not exists 'occurrence_updated';
alter type public.notification_kind add value if not exists 'occurrence_rescheduled';
alter type public.notification_kind add value if not exists 'peer_rating_open';
alter type public.notification_kind add value if not exists 'friend_request';
alter type public.notification_kind add value if not exists 'friend_accepted';
alter type public.notification_kind add value if not exists 'media_tag_request';
alter type public.notification_kind add value if not exists 'media_blocked';

-- ---------------------------------------------------------------------------
-- phase15_config: single row, snake_case mirror of DEFAULT_PHASE15_CONFIG (types.ts v3).
-- schema.test.ts pins phase15_config_json() ≡ DEFAULT_PHASE15_CONFIG key for key.
-- ---------------------------------------------------------------------------
create table public.phase15_config (
  id boolean primary key default true check (id),
  series_horizon_weeks int not null default 4 check (series_horizon_weeks between 1 and 12),
  roster_priority_hours_default numeric not null default 24,
  roster_priority_hours_min numeric not null default 6,
  roster_priority_hours_max numeric not null default 72,
  auto_join_reconfirm_hours numeric not null default 48,
  auto_join_release_hours numeric not null default 24,
  roster_misses_before_leave_offer int not null default 3,
  series_min_duration_minutes int not null default 30,
  series_max_duration_minutes int not null default 240,
  glicko_initial_rating numeric not null default 1500,
  glicko_initial_rd numeric not null default 350,
  glicko_initial_sigma numeric not null default 0.06,
  glicko_tau numeric not null default 0.5,
  glicko_rating_period_days int not null default 7,
  glicko_min_verified_ratio numeric not null default 0.7,
  glicko_freeze_below_reliability numeric not null default 0.7,
  glicko_display_min_reliability numeric not null default 0.8,
  glicko_display_min_games int not null default 10,
  glicko_display_max_rd numeric not null default 100,
  peer_rating_window_hours numeric not null default 48,
  peer_rating_max_ratees int not null default 5,
  peer_rater_min_reliability numeric not null default 0.8,
  peer_rater_min_verified_games int not null default 5,
  peer_pair_decay_after int not null default 3,
  peer_pair_decay_window_days numeric not null default 30,
  peer_pair_decay_factor numeric not null default 0.5,
  peer_reciprocal_weight numeric not null default 0.5,
  peer_outlier_sigma numeric not null default 2,
  peer_self_prior_weight numeric not null default 3,
  media_upload_after_end_hours numeric not null default 2,
  media_photo_max_mb numeric not null default 20,
  media_video_max_mb numeric not null default 200,
  media_video_max_seconds numeric not null default 60,
  media_max_items_per_user_per_game int not null default 30,
  media_retention_months int not null default 12,
  played_with_lookback_days numeric not null default 365,
  updated_at timestamptz not null default now(),
  check (roster_priority_hours_min <= roster_priority_hours_default
         and roster_priority_hours_default <= roster_priority_hours_max),
  check (auto_join_release_hours < auto_join_reconfirm_hours),
  check (series_min_duration_minutes < series_max_duration_minutes)
);
insert into public.phase15_config (id) values (true);

create function public.st_p15() returns public.phase15_config
language sql stable security definer set search_path = ''
as $$ select c from public.phase15_config c where c.id $$;

-- camelCase JSON (Phase15Config shape), same mechanical mapping as trust_config_json().
create function public.phase15_config_json() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_object_agg(lower(substr(x.camel, 1, 1)) || substr(x.camel, 2), x.value)
  from public.phase15_config c,
       lateral jsonb_each(to_jsonb(c) - 'id' - 'updated_at') e,
       lateral (select replace(initcap(replace(e.key, '_', ' ')), ' ', '') as camel, e.value) x
  where c.id
$$;

-- phase15_config with camelCase overrides (golden `config`).
create function public.st_p15_merge(p_overrides jsonb) returns public.phase15_config
language sql stable security definer set search_path = ''
as $$
  select jsonb_populate_record(public.st_p15(),
           coalesce((select jsonb_object_agg(lower(regexp_replace(e.key, '([A-Z]|[0-9]+)', '_\1', 'g')), e.value)
                     from jsonb_each(coalesce(p_overrides, '{}'::jsonb)) e), '{}'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- Time helpers
-- ---------------------------------------------------------------------------

-- Valid IANA zone name (pg_timezone_names; abbreviations and POSIX strings are refused).
create function public.st_is_iana_tz(p_tz text) returns boolean
language sql stable set search_path = ''
as $$
  select p_tz is not null and p_tz ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$|^UTC$'
     and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_tz)
$$;

-- Local wall-clock (date + time in an IANA zone) → instant. Postgres resolves a DST gap by shifting
-- forward by the gap and an ambiguous (repeated) time to the later, standard-time instant; the
-- contract takes the earlier (daylight) instant for ambiguous times, so we check whether the
-- instant one hour (the DST delta) earlier maps to the same wall-clock time.
create function public.st_local_to_utc(p_date date, p_time time, p_tz text) returns timestamptz
language plpgsql stable set search_path = ''
as $$
declare
  l timestamp := p_date + p_time;
  a timestamptz := l at time zone p_tz;
  d interval;
begin
  -- DST deltas are 30 min (Lord Howe) to 2 h; probe the common ones from the largest down.
  foreach d in array array[interval '2 hours', interval '1 hour', interval '30 minutes'] loop
    if ((a - d) at time zone p_tz) = l then
      return a - d;
    end if;
  end loop;
  return a;
end $$;

create function public.st_hhmm(p_time time) returns text
language sql immutable set search_path = ''
as $$ select to_char(p_time, 'HH24:MI') $$;

-- ---------------------------------------------------------------------------
-- game_series
-- ---------------------------------------------------------------------------
create table public.game_series (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles (id),
  sport text not null references public.sports (id),
  title text not null check (char_length(title) between 1 and 80),
  notes text check (notes is null or char_length(notes) <= 1000),
  visibility public.game_visibility not null default 'public',
  venue_id uuid references public.venues (id) on delete set null,
  -- Exact pin; never granted to clients (series_views masks it like game_views).
  geog extensions.geography(Point, 4326) not null,
  approx_geog extensions.geography(Point, 4326) not null,
  hide_exact_location boolean not null default false,
  capacity int not null check (capacity between 2 and 200),
  min_players int not null default 2 check (min_players >= 2),
  deposit_minor int not null default 0 check (deposit_minor >= 0),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  deposit_forfeit_to public.deposit_forfeit_target not null default 'pot',
  women_only boolean not null default false,
  team_count int not null default 2 check (team_count between 1 and 16),
  -- Schedule (SeriesSchedule)
  recurrence public.series_recurrence not null default 'weekly',
  weekday smallint not null check (weekday between 1 and 7), -- ISO: 1 = Monday … 7 = Sunday
  start_time time(0) not null,
  time_zone text not null,
  duration_minutes int not null check (duration_minutes between 1 and 1440),
  anchor_date date not null,
  end_date date,
  horizon_weeks int not null default 4 check (horizon_weeks between 1 and 12),
  roster_priority_hours numeric not null default 24,
  auto_join_reconfirm_hours numeric not null default 48 check (auto_join_reconfirm_hours between 1 and 168),
  skipped_dates date[] not null default '{}',
  schedule_revision int not null default 0 check (schedule_revision >= 0),
  status public.series_status not null default 'active',
  -- Series invite link (GAME-030); rotated by the host. Not granted to clients (host reads it via series_views).
  invite_token text unique default encode(extensions.gen_random_bytes(18), 'hex'),
  invite_rotated_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (extract(isodow from anchor_date) = weekday),
  check (end_date is null or end_date >= anchor_date),
  check (team_count <= capacity),
  check (min_players <= capacity)
);
create index game_series_host_idx on public.game_series (host_id);
create index game_series_active_idx on public.game_series (status) where status = 'active';
create trigger game_series_touch before update on public.game_series
  for each row execute function public.st_touch_updated_at();

create function public.st_series_geo() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.venue_id is not null and (tg_op = 'INSERT' or new.venue_id is distinct from old.venue_id) then
    select ve.geog into new.geog from public.venues ve where ve.id = new.venue_id;
  end if;
  new.approx_geog := public.st_approx_point(new.geog);
  return new;
end $$;
create trigger game_series_geo before insert or update of geog, venue_id on public.game_series
  for each row execute function public.st_series_geo();

-- Games materialised from a series.
alter table public.games add column series_id uuid references public.game_series (id) on delete set null;
alter table public.games add column invite_rotated_at timestamptz;
create index games_series_idx on public.games (series_id, starts_at) where series_id is not null;

-- ---------------------------------------------------------------------------
-- series_occurrences (SeriesOccurrence). occurrence_key = `${seriesId}:${revision}:${slotDate}`,
-- game_id = stableUuid('occurrence:' || key). A skipped slot that was never generated has a row
-- with status 'skipped' and no games row.
-- ---------------------------------------------------------------------------
create table public.series_occurrences (
  occurrence_key text primary key check (char_length(occurrence_key) <= 100),
  series_id uuid not null references public.game_series (id) on delete cascade,
  slot_date date not null,
  schedule_revision int not null,
  game_id uuid not null unique,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  opens_at timestamptz not null,
  priority_until timestamptz not null,
  reconfirm_at timestamptz not null,
  release_at timestamptz not null,
  status public.occurrence_status not null default 'scheduled',
  cancel_reason text check (cancel_reason is null or cancel_reason in ('skipped', 'rescheduled', 'series_ended', 'cancelled')),
  overridden boolean not null default false,
  created_at timestamptz not null default now(),
  check (occurrence_key = series_id::text || ':' || schedule_revision::text || ':' || to_char(slot_date, 'YYYY-MM-DD')),
  check (ends_at > starts_at and priority_until <= starts_at and opens_at <= priority_until)
);
create index series_occurrences_series_idx on public.series_occurrences (series_id, starts_at);
create unique index series_occurrences_one_live_slot on public.series_occurrences (series_id, slot_date)
  where status = 'scheduled';
create index series_occurrences_due_idx on public.series_occurrences (reconfirm_at, release_at) where status = 'scheduled';

-- ---------------------------------------------------------------------------
-- series_roster (RosterMember)
-- ---------------------------------------------------------------------------
create table public.series_roster (
  series_id uuid not null references public.game_series (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status public.roster_status not null default 'regular',
  always_in boolean not null default false,
  joined_via public.roster_join_source not null,
  consecutive_misses int not null default 0 check (consecutive_misses >= 0),
  leave_offered_at timestamptz,
  last_missed_at timestamptz,
  invited_by uuid references public.profiles (id) on delete set null,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  -- Removed by the host (cannot rejoin through the link).
  removed_by_host boolean not null default false,
  primary key (series_id, user_id),
  check (status <> 'left' or not always_in)
);
create index series_roster_user_idx on public.series_roster (user_id);

-- AutoJoinRecord: "always in" members auto-joined to an occurrence.
create table public.series_auto_joins (
  game_id uuid not null references public.games (id) on delete cascade,
  series_id uuid not null references public.game_series (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_as text not null check (joined_as in ('approved', 'waitlisted')),
  joined_at timestamptz not null default now(),
  reconfirm_requested_at timestamptz,
  reconfirmed_at timestamptz,
  released_at timestamptz,
  primary key (game_id, user_id)
);
create index series_auto_joins_user_idx on public.series_auto_joins (user_id);

-- Joins through an invite link (PRD §5.4 step 5: the host sees how many moved). One row per
-- (target, user); `kind` = InviteTarget.kind.
create table public.invite_joins (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('game', 'series')),
  game_id uuid references public.games (id) on delete cascade,
  series_id uuid references public.game_series (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((kind = 'game') = (game_id is not null) and (kind = 'series') = (series_id is not null))
);
create unique index invite_joins_game_uq on public.invite_joins (game_id, user_id) where kind = 'game';
create unique index invite_joins_series_uq on public.invite_joins (series_id, user_id) where kind = 'series';
create index invite_joins_user_idx on public.invite_joins (user_id);

-- ---------------------------------------------------------------------------
-- Visibility helpers
-- ---------------------------------------------------------------------------
create function public.st_is_regular(p_series_id uuid, p_uid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_series_id is not null and p_uid is not null and exists (
    select 1 from public.series_roster r where r.series_id = p_series_id and r.user_id = p_uid and r.status = 'regular')
$$;

create function public.st_can_see_series(p_series_id uuid, p_viewer uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_viewer is not null and exists (
    select 1 from public.game_series s
    where s.id = p_series_id
      and (
        s.host_id = p_viewer
        or public.st_is_moderator(p_viewer)
        or exists (select 1 from public.series_roster r where r.series_id = s.id and r.user_id = p_viewer
                     and r.status in ('regular', 'invited'))
        or (s.visibility = 'public' and not public.st_is_blocked(s.host_id, p_viewer)
            and not public.st_is_hidden_user(s.host_id))
      ))
$$;

create function public.st_can_see_series_exact(p_series_id uuid, p_viewer uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_viewer is not null and exists (
    select 1 from public.game_series s
    where s.id = p_series_id
      and (not s.hide_exact_location or s.host_id = p_viewer or public.st_is_moderator(p_viewer)
           or public.st_is_regular(s.id, p_viewer)))
$$;

-- Caller-relative wrappers (granted to clients for policies/views).
create function public.st_my_series_visible(p_series_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select public.st_can_see_series(p_series_id, auth.uid()) $$;

create function public.st_my_series_exact(p_series_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select public.st_can_see_series_exact(p_series_id, auth.uid()) $$;

create function public.st_am_series_host(p_series_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select auth.uid() is not null and exists (select 1 from public.game_series s where s.id = p_series_id and s.host_id = auth.uid()) $$;

create function public.st_am_regular(p_series_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select public.st_is_regular(p_series_id, auth.uid()) $$;

-- True while the occurrence `p_game_id` is inside its roster-only window and `p_uid` is neither the
-- host nor a regular (GAME-010).
create function public.st_roster_priority_blocks(p_game_id uuid, p_uid uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.series_occurrences o join public.game_series s on s.id = o.series_id
    where o.game_id = p_game_id and o.status = 'scheduled' and p_at < o.priority_until
      and s.host_id is distinct from p_uid
      and not public.st_is_regular(s.id, p_uid))
$$;

-- The series as the viewer may see it (GameSeries). Exact location, venue and invite token masked.
create view public.series_views with (security_barrier = true) as
  select s.id,
         s.host_id,
         s.sport,
         s.title,
         s.notes,
         s.visibility,
         case when x.exact then s.venue_id end as venue_id,
         case when x.exact then extensions.st_y(s.geog::extensions.geometry) end as lat,
         case when x.exact then extensions.st_x(s.geog::extensions.geometry) end as lng,
         extensions.st_y(s.approx_geog::extensions.geometry) as approx_lat,
         extensions.st_x(s.approx_geog::extensions.geometry) as approx_lng,
         s.hide_exact_location,
         s.capacity,
         s.min_players,
         s.deposit_minor,
         s.currency,
         s.deposit_forfeit_to,
         s.women_only,
         s.team_count,
         s.recurrence,
         s.weekday,
         public.st_hhmm(s.start_time) as start_time,
         s.time_zone,
         s.duration_minutes,
         s.anchor_date,
         s.end_date,
         s.horizon_weeks,
         s.roster_priority_hours,
         s.auto_join_reconfirm_hours,
         s.skipped_dates,
         s.schedule_revision,
         s.status,
         case when s.host_id = auth.uid() then s.invite_token end as invite_token,
         s.created_at,
         s.updated_at,
         (select count(*)::int from public.series_roster r where r.series_id = s.id and r.status = 'regular') as roster_count,
         (s.host_id = auth.uid()) as is_host,
         (select r.status from public.series_roster r where r.series_id = s.id and r.user_id = auth.uid()) as my_roster_status,
         coalesce((select r.always_in from public.series_roster r where r.series_id = s.id and r.user_id = auth.uid()), false)
           as my_always_in
  from public.game_series s
  cross join lateral (select public.st_my_series_exact(s.id) as exact) x
  where public.st_my_series_visible(s.id);

-- ---------------------------------------------------------------------------
-- MVP functions extended for series
-- ---------------------------------------------------------------------------

-- Regulars of a series see its (private) occurrences (same blocking/hidden rules as invites).
create or replace function public.st_can_see_game(p_game_id uuid, p_viewer uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_viewer is not null and exists (
    select 1 from public.games g
    where g.id = p_game_id
      and (
        g.host_id = p_viewer
        or public.st_is_moderator(p_viewer)
        or exists (select 1 from public.game_participants gp
                   where gp.game_id = g.id and gp.user_id = p_viewer
                     and gp.status in ('requested', 'approved', 'waitlisted'))
        or (
          not public.st_is_blocked(g.host_id, p_viewer)
          and not public.st_is_hidden_user(g.host_id)
          and (g.visibility = 'public'
               or exists (select 1 from public.game_invite_access ia where ia.game_id = g.id and ia.user_id = p_viewer)
               or public.st_is_regular(g.series_id, p_viewer))
        )
      ))
$$;

-- game_views gains series_id and the roster-only deadline (columns appended).
create or replace view public.game_views with (security_barrier = true) as
  select g.id,
         g.host_id,
         g.sport,
         g.title,
         g.notes,
         g.visibility,
         case when x.exact then g.venue_id end as venue_id,
         case when x.exact then extensions.st_y(g.geog::extensions.geometry) end as lat,
         case when x.exact then extensions.st_x(g.geog::extensions.geometry) end as lng,
         extensions.st_y(g.approx_geog::extensions.geometry) as approx_lat,
         extensions.st_x(g.approx_geog::extensions.geometry) as approx_lng,
         g.hide_exact_location,
         g.capacity,
         g.starts_at,
         g.ends_at,
         g.deposit_minor,
         g.currency,
         g.deposit_forfeit_to,
         g.women_only,
         g.status,
         g.team_count,
         case when g.host_id = auth.uid() then g.invite_token end as invite_token,
         g.created_at,
         (select count(*)::int from public.game_participants gp where gp.game_id = g.id and gp.status = 'approved') as approved_count,
         (select count(*)::int from public.game_participants gp where gp.game_id = g.id and gp.status = 'waitlisted') as waitlist_count,
         (g.host_id = auth.uid()) as is_host,
         g.min_players,
         g.series_id,
         (select o.priority_until from public.series_occurrences o where o.game_id = g.id and o.status = 'scheduled') as priority_until
  from public.games g
  cross join lateral (select public.st_my_exact(g.id) as exact) x
  where public.st_my_game_visible(g.id);

-- Waitlist offers: regulars of the series first (GAME-044; dm_waitlist `regularIds`).
create or replace function public.st_promote_waitlist(p_game_id uuid) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  g public.games;
  plan jsonb;
  o jsonb;
begin
  select * into g from public.games x where x.id = p_game_id for update;
  if g.id is null then return 0; end if;
  plan := public.dm_waitlist(jsonb_build_object(
      'game', jsonb_build_object('id', g.id, 'capacity', g.capacity, 'status', g.status, 'startsAt', public.dm_iso(g.starts_at)),
      'participants', (select coalesce(jsonb_agg(jsonb_build_object(
                          'userId', pv.user_id, 'status', pv.status, 'waitlistRank', pv.rank,
                          'requestedAt', public.dm_iso(pv.requested_at))), '[]'::jsonb)
                       from (select gp.*, case when gp.status = 'waitlisted' then
                               row_number() over (partition by gp.status = 'waitlisted' order by gp.waitlisted_at, gp.user_id) end as rank
                             from public.game_participants gp where gp.game_id = g.id) pv),
      'offers', (select coalesce(jsonb_agg(jsonb_build_object('userId', o.user_id, 'offeredAt', public.dm_iso(o.offered_at),
                                                              'acceptBy', public.dm_iso(o.accept_by), 'mode', o.mode)
                                           order by o.offered_at), '[]'::jsonb)
                 from public.waitlist_offers o where o.game_id = g.id),
      'regularIds', (select coalesce(jsonb_agg(r.user_id order by r.user_id), '[]'::jsonb)
                     from public.series_roster r where g.series_id is not null and r.series_id = g.series_id
                       and r.status = 'regular')),
    t, public.st_config());
  if (plan ->> 'freeSpots')::int = 0 then
    delete from public.waitlist_offers o where o.game_id = g.id; -- the round ends when the game is full
  end if;
  for o in select x from jsonb_array_elements(plan -> 'offers') x loop
    insert into public.waitlist_offers (game_id, user_id, offered_at, accept_by, mode)
    values (g.id, (o ->> 'userId')::uuid, public.dm_ts(o ->> 'offeredAt'), public.dm_ts(o ->> 'acceptBy'), o ->> 'mode')
    on conflict (game_id, user_id) do update set offered_at = excluded.offered_at, accept_by = excluded.accept_by, mode = excluded.mode;
  end loop;
  perform public.st_apply_effects(plan -> 'effects');
  return jsonb_array_length(plan -> 'offers');
end $$;

-- request_join + GAME-010 roster priority window (`roster_priority` for non-regulars until
-- opensAt + rosterPriorityHours) + invite-link join tracking (PRD §5.4).
create or replace function public.request_join(p_game_id uuid, p_position text default null, p_invite_token text default null)
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
  via_link boolean;
begin
  if me.join_banned_until > t then
    perform public.st_raise('join_banned');
  end if;
  select * into g from public.games x where x.id = p_game_id;
  if g.id is null then perform public.st_raise('not_found'); end if;
  if public.st_is_blocked(g.host_id, me.id) then perform public.st_raise('blocked'); end if;
  via_link := p_invite_token is not null and g.invite_token is not null and p_invite_token = g.invite_token;
  if not public.st_can_see_game(g.id, me.id) then
    if g.visibility = 'private' and via_link and not public.st_is_hidden_user(g.host_id) then
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
  -- GAME-010: only regulars may join during the roster-only window (map and link open afterwards).
  if g.series_id is not null and public.st_roster_priority_blocks(g.id, me.id, t) then
    perform public.st_raise('roster_priority');
  end if;
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
    -- Security H1: re-requesting would erase a pending late cancel (and its card at finalisation).
    if existing.status = 'cancelled' and existing.late_cancel then perform public.st_raise('conflict', 'late cancel pending'); end if;
  end if;

  ready := g.deposit_minor = 0;
  if not ready then
    insert into public.payments (user_id, game_id, purpose, amount_minor, currency, status, deposit_state, idempotency_key)
    values (me.id, g.id, 'deposit', g.deposit_minor, g.currency, 'requires_payment_method', 'setup',
            'deposit:' || g.id::text || ':' || me.id::text || ':setup')
    on conflict (idempotency_key) do nothing;
    select (pm.step = 'setup' and pm.status = 'succeeded')
           or (pm.step = 'charge' and pm.deposit_state = 'held')
           or (pm.step = 'hold' and pm.deposit_state = 'held') into ready
    from public.payments pm where pm.idempotency_key = 'deposit:' || g.id::text || ':' || me.id::text || ':setup';
    ready := coalesce(ready, false);
  end if;

  insert into public.game_participants as gp (game_id, user_id, status, position, payment_ready, requested_at)
  values (g.id, me.id, 'requested', p_position, ready, t)
  on conflict (game_id, user_id) do update
    set status = 'requested', position = excluded.position, payment_ready = excluded.payment_ready,
        requested_at = excluded.requested_at, decided_at = null, waitlisted_at = null, team = null;

  if via_link then
    insert into public.invite_joins (kind, game_id, user_id, created_at) values ('game', g.id, me.id, t)
    on conflict do nothing;
  end if;
  if ready then
    perform public.st_notify(g.host_id, 'join_requested', jsonb_build_object('gameTitle', g.title), g.id, null,
                             'join_requested:' || g.id::text || ':' || me.id::text || ':' || extract(epoch from t)::text);
  end if;
  return public.st_participant_view(g.id, me.id);
end $$;

-- Map query: occurrences inside their roster-only window are listed only for the host and regulars
-- (AC-GAME-010: "then the game appears on the map for the public").
create or replace function public.nearby_games(
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
  t timestamptz := public.st_now();
  center extensions.geography := public.st_point(p_lat, p_lng);
  v_from timestamptz := coalesce(p_from, t);
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
        and (g.series_id is null or not public.st_roster_priority_blocks(g.id, uid, t))
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

-- A cancelled occurrence game (cancel_game, account deletion, …) marks its occurrence cancelled.
create function public.st_games_series_cancel() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.series_id is not null and new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.series_occurrences o set status = 'cancelled', cancel_reason = coalesce(o.cancel_reason, 'cancelled')
    where o.game_id = new.id and o.status = 'scheduled';
  end if;
  return null;
end $$;
create trigger games_series_cancel after update of status on public.games
  for each row execute function public.st_games_series_cancel();

-- ---------------------------------------------------------------------------
-- Slots and generation
-- ---------------------------------------------------------------------------

-- Slot dates of a series in [p_from, p_to]: anchor + k·(7|14) days, k ≥ 0, ≤ end_date.
create function public.st_series_slots(p_anchor date, p_recurrence public.series_recurrence, p_end date, p_from date, p_to date)
returns setof date
language sql immutable set search_path = ''
as $$
  select p_anchor + k * c.step
  from (select case when p_recurrence = 'biweekly' then 14 else 7 end as step) c,
       generate_series(greatest(0, ceil((p_from - p_anchor)::numeric / c.step)::int),
                       floor((p_to - p_anchor)::numeric / c.step)::int) k
  where p_to >= p_anchor and p_anchor + k * c.step <= coalesce(p_end, 'infinity'::date)
  order by 1
$$;

-- Planned occurrence times for a slot generated at p_now (SeriesOccurrence derived fields,
-- series/occurrences.ts buildOccurrence).
create function public.st_occurrence_times(s public.game_series, p_slot date, p_cfg public.phase15_config,
                                           p_now timestamptz, out starts_at timestamptz, out ends_at timestamptz, out opens_at timestamptz,
                                           out priority_until timestamptz, out reconfirm_at timestamptz,
                                           out release_at timestamptz)
language plpgsql stable set search_path = ''
as $$
begin
  starts_at := public.st_local_to_utc(p_slot, s.start_time, s.time_zone);
  ends_at := starts_at + s.duration_minutes * interval '1 minute';
  -- buildOccurrence(): opensAt = min(startsAt, max(startsAt − horizon, now)).
  opens_at := least(starts_at, greatest(starts_at - s.horizon_weeks * interval '168 hours', p_now));
  priority_until := least(opens_at + s.roster_priority_hours * interval '1 hour', starts_at);
  reconfirm_at := starts_at - s.auto_join_reconfirm_hours * interval '1 hour';
  release_at := starts_at - p_cfg.auto_join_release_hours * interval '1 hour';
end $$;

create function public.st_occurrence_key(p_series uuid, p_revision int, p_slot date) returns text
language sql immutable set search_path = ''
as $$ select p_series::text || ':' || p_revision::text || ':' || to_char(p_slot, 'YYYY-MM-DD') $$;

-- May `p_uid` be auto-joined to game `g` (same gates as request_join, without the window)?
create function public.st_autojoin_eligible(g public.games, p_uid uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles p
                 where p.id = p_uid and p.deleted_at is null and not p.permanently_banned
                   and coalesce(p.join_banned_until <= p_at, true)
                   and (g.visibility = 'private' or coalesce(p.visibility_restricted_until <= p_at, true)))
     and not public.st_is_blocked(g.host_id, p_uid)
     and not exists (select 1 from public.game_participants gp
                     where gp.game_id = g.id and gp.status = 'approved' and public.st_is_blocked(gp.user_id, p_uid))
     and (not g.women_only or exists (select 1 from public.profile_private pp where pp.user_id = p_uid and pp.gender = 'female'))
$$;

-- Auto-join one "always in" regular to an occurrence: approved while there is room, else
-- waitlisted. Deposit occurrences are skipped (a deposit needs the player's own payment step).
-- Returns 'approved' | 'waitlisted' | null.
create function public.st_series_autojoin(p_game_id uuid, p_uid uuid, p_at timestamptz) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  g public.games;
  n int;
  st public.participant_status;
begin
  select * into g from public.games x where x.id = p_game_id for update;
  if g.id is null or g.series_id is null or g.status <> 'scheduled' or g.starts_at <= p_at or g.deposit_minor > 0
     or g.host_id = p_uid or not public.st_autojoin_eligible(g, p_uid, p_at)
     or exists (select 1 from public.game_participants gp where gp.game_id = g.id and gp.user_id = p_uid) then
    return null;
  end if;
  select count(*) into n from public.game_participants gp where gp.game_id = g.id and gp.status = 'approved';
  st := case when n < g.capacity then 'approved' else 'waitlisted' end;
  insert into public.game_participants (game_id, user_id, status, requested_at, decided_at, waitlisted_at)
  values (g.id, p_uid, st, p_at, p_at, case when st = 'waitlisted' then p_at end);
  insert into public.series_auto_joins (game_id, series_id, user_id, joined_as, joined_at)
  values (g.id, g.series_id, p_uid, st::text, p_at)
  on conflict do nothing;
  return st::text;
end $$;

-- Materialise due occurrences of one series (opensAt ≤ now < startsAt, inside the horizon), with
-- the host approved and "always in" regulars auto-joined. Idempotent (deterministic keys/ids).
-- Nothing is generated while the series is not active, the host is deleted/banned/suspended (or,
-- for public series, join-banned or visibility-restricted), or the venue is no longer active.
-- Returns the number of games created.
create function public.st_series_generate(p_series_id uuid, p_now timestamptz) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  cfg public.phase15_config := public.st_p15();
  s public.game_series;
  h public.profiles;
  d date;
  tm record;
  k text;
  gid uuid;
  m record;
  n int := 0;
begin
  select * into s from public.game_series x where x.id = p_series_id for update;
  if s.id is null or s.status <> 'active' then return 0; end if;
  select * into h from public.profiles x where x.id = s.host_id;
  if h.id is null or h.deleted_at is not null or h.permanently_banned or coalesce(h.host_suspended_until > p_now, false)
     or (s.visibility = 'public' and (coalesce(h.join_banned_until > p_now, false)
                                      or coalesce(h.visibility_restricted_until > p_now, false))) then
    return 0;
  end if;
  if s.venue_id is not null and not exists (select 1 from public.venues v where v.id = s.venue_id and v.status = 'active') then
    return 0;
  end if;
  for d in select x from public.st_series_slots(s.anchor_date, s.recurrence, s.end_date,
                                                (p_now at time zone s.time_zone)::date - 1,
                                                ((p_now + s.horizon_weeks * interval '168 hours') at time zone s.time_zone)::date + 1) x
  loop
    continue when d = any (s.skipped_dates);
    select * into tm from public.st_occurrence_times(s, d, cfg, p_now);
    -- planSeriesOccurrences(): slots starting in (now, now + horizon].
    continue when tm.starts_at <= p_now or tm.starts_at > p_now + s.horizon_weeks * interval '168 hours';
    k := public.st_occurrence_key(s.id, s.schedule_revision, d);
    continue when exists (select 1 from public.series_occurrences o where o.occurrence_key = k)
               or exists (select 1 from public.series_occurrences o
                          where o.series_id = s.id and o.slot_date = d and o.status = 'scheduled');
    gid := public.dm_stable_uuid('occurrence:' || k);
    insert into public.games (id, host_id, sport, title, notes, visibility, venue_id, geog, approx_geog, hide_exact_location,
                              capacity, min_players, starts_at, ends_at, deposit_minor, currency, deposit_forfeit_to,
                              women_only, team_count, series_id, created_at)
    values (gid, s.host_id, s.sport, s.title, s.notes, s.visibility, s.venue_id, s.geog, s.geog, s.hide_exact_location,
            s.capacity, s.min_players, tm.starts_at, tm.ends_at, s.deposit_minor, s.currency, s.deposit_forfeit_to,
            s.women_only, s.team_count, s.id, p_now);
    insert into public.game_participants (game_id, user_id, status, requested_at, decided_at)
    values (gid, s.host_id, 'approved', p_now, p_now);
    insert into public.series_occurrences (occurrence_key, series_id, slot_date, schedule_revision, game_id, starts_at, ends_at,
                                           opens_at, priority_until, reconfirm_at, release_at, status, created_at)
    values (k, s.id, d, s.schedule_revision, gid, tm.starts_at, tm.ends_at, tm.opens_at, tm.priority_until,
            tm.reconfirm_at, tm.release_at, 'scheduled', p_now);
    -- "Always in" regulars in seniority order, only while there is time to reconfirm.
    if p_now < tm.reconfirm_at then
      for m in select r.user_id from public.series_roster r
               where r.series_id = s.id and r.status = 'regular' and r.always_in and r.user_id <> s.host_id
               order by r.joined_at, r.user_id::text collate "C" loop
        perform public.st_series_autojoin(gid, m.user_id, p_now);
      end loop;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Job: keep the rolling horizon for every active series. Advisory-locked, idempotent.
create function public.generate_occurrences() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  s record;
  n int := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('st:generate_occurrences')) then return 0; end if;
  for s in select x.id from public.game_series x where x.status = 'active' order by x.created_at, x.id loop
    n := n + public.st_series_generate(s.id, t);
  end loop;
  return n;
end $$;

-- Job: "always in" cycle (series/roster.ts processAutoJoins), per scheduled occurrence with
-- reconfirmAt ≤ now < startsAt: before releaseAt every held (not released, not reconfirmed)
-- auto-join gets one reconfirmation request (series_reconfirm, deadline releaseAt); from releaseAt
-- every auto-join still held is released (no card, waitlist offered) and notified. A released member
-- who had been asked counts a miss; reaching rosterMissesBeforeLeaveOffer consecutive misses sends
-- one roster_leave_offer (GAME-011, no card). Auto-joins whose player already left the game are
-- closed silently. Verified attendance at a later occurrence resets the streak. Returns the number
-- of requests plus releases.
create function public.always_in_autojoin() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  cfg public.phase15_config := public.st_p15();
  t timestamptz := public.st_now();
  a record;
  n int := 0;
  rm public.series_roster;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('st:always_in_autojoin')) then return 0; end if;
  update public.series_auto_joins aj set released_at = t
  where aj.released_at is null and aj.reconfirmed_at is null
    and not exists (select 1 from public.game_participants gp where gp.game_id = aj.game_id and gp.user_id = aj.user_id
                      and gp.status in ('approved', 'waitlisted'));
  update public.series_roster r set consecutive_misses = 0
  where r.consecutive_misses > 0 and exists (
    select 1 from public.game_participants gp join public.games g on g.id = gp.game_id
    where g.series_id = r.series_id and gp.user_id = r.user_id and gp.attendance = 'verified'
      and g.starts_at > coalesce(r.last_missed_at, '-infinity'::timestamptz));
  for a in select aj.*, o.starts_at, o.release_at, s.title, (t >= o.release_at) as releasing
           from public.series_auto_joins aj
           join public.series_occurrences o on o.game_id = aj.game_id and o.status = 'scheduled'
           join public.game_series s on s.id = aj.series_id
           where aj.released_at is null and aj.reconfirmed_at is null
             and o.reconfirm_at <= t and t < o.starts_at
             and (t >= o.release_at or aj.reconfirm_requested_at is null)
           order by o.starts_at, aj.game_id, aj.user_id::text collate "C"
           for update of aj skip locked
  loop
    if not a.releasing then
      update public.series_auto_joins x set reconfirm_requested_at = t where x.game_id = a.game_id and x.user_id = a.user_id;
      perform public.st_notify(a.user_id, 'series_reconfirm',
        jsonb_build_object('seriesTitle', a.title, 'startsAt', public.dm_iso(a.starts_at), 'deadline', public.dm_iso(a.release_at)),
        a.game_id, null, 'notify:series_reconfirm:' || a.game_id::text || ':' || a.user_id::text);
      n := n + 1;
      continue;
    end if;
    perform public.st_release_autojoin(a.game_id, a.user_id, t);
    perform public.st_notify(a.user_id, 'series_auto_released',
      jsonb_build_object('seriesTitle', a.title, 'startsAt', public.dm_iso(a.starts_at)),
      a.game_id, null, 'notify:series_auto_released:' || a.game_id::text || ':' || a.user_id::text);
    n := n + 1;
    continue when a.reconfirm_requested_at is null; -- never asked (job outage): no miss
    update public.series_roster r set consecutive_misses = r.consecutive_misses + 1, last_missed_at = t
    where r.series_id = a.series_id and r.user_id = a.user_id
    returning * into rm;
    if rm.series_id is not null and rm.consecutive_misses >= cfg.roster_misses_before_leave_offer and rm.leave_offered_at is null then
      update public.series_roster r set leave_offered_at = t where r.series_id = rm.series_id and r.user_id = rm.user_id;
      perform public.st_notify(a.user_id, 'roster_leave_offer',
        jsonb_build_object('seriesTitle', a.title, 'misses', rm.consecutive_misses), null, null,
        'notify:roster_leave_offer:' || a.series_id::text || ':' || a.user_id::text || ':' || a.game_id::text);
    end if;
  end loop;
  return n;
end $$;

-- Release an auto-joined participation without a card (status cancelled, never late) and offer
-- the spot to the waitlist.
create function public.st_release_autojoin(p_game_id uuid, p_uid uuid, p_at timestamptz) returns void
language plpgsql security definer set search_path = ''
as $$
declare prev public.participant_status;
begin
  select gp.status into prev from public.game_participants gp where gp.game_id = p_game_id and gp.user_id = p_uid for update;
  update public.game_participants gp
     set status = 'cancelled', cancelled_at = p_at, late_cancel = false, waitlisted_at = null, team = null
  where gp.game_id = p_game_id and gp.user_id = p_uid and gp.status in ('approved', 'waitlisted', 'requested');
  update public.series_auto_joins aj set released_at = p_at where aj.game_id = p_game_id and aj.user_id = p_uid;
  if prev = 'approved' then perform public.st_promote_waitlist(p_game_id); end if;
end $$;

-- ---------------------------------------------------------------------------
-- Series RPCs (all SECURITY DEFINER; errors ST:<ErrorCode>)
-- ---------------------------------------------------------------------------

-- Validates a template/schedule (shared by create and edits). Raises ST:validation.
create function public.st_validate_series(s public.game_series, p_cfg public.phase15_config) returns void
language plpgsql stable set search_path = ''
as $$
begin
  if not public.st_is_iana_tz(s.time_zone) then perform public.st_raise('validation', 'time zone'); end if;
  if s.duration_minutes is null or s.duration_minutes not between p_cfg.series_min_duration_minutes and p_cfg.series_max_duration_minutes then
    perform public.st_raise('validation', 'duration');
  end if;
  if s.roster_priority_hours is null
     or s.roster_priority_hours not between p_cfg.roster_priority_hours_min and p_cfg.roster_priority_hours_max then
    perform public.st_raise('validation', 'roster priority hours');
  end if;
  if s.auto_join_reconfirm_hours is null or s.auto_join_reconfirm_hours <= p_cfg.auto_join_release_hours
     or s.auto_join_reconfirm_hours > 168 then
    perform public.st_raise('validation', 'reconfirm hours');
  end if;
  if s.capacity is null or s.capacity not between 2 and 200 or s.team_count is null or s.team_count < 1
     or s.team_count > s.capacity or s.min_players is null or s.min_players < 2 or s.min_players > s.capacity then
    perform public.st_raise('validation', 'capacity/team count/min players');
  end if;
  if s.title is null or char_length(btrim(s.title)) not between 1 and 80 then perform public.st_raise('validation', 'title'); end if;
  if s.notes is not null and char_length(s.notes) > 1000 then perform public.st_raise('validation', 'notes'); end if;
  if s.weekday is null or s.weekday not between 1 and 7 or s.start_time is null then
    perform public.st_raise('validation', 'schedule');
  end if;
  if s.end_date is not null and s.end_date < s.anchor_date then perform public.st_raise('validation', 'end date'); end if;
  if coalesce(s.deposit_minor, 0) < 0 or s.currency is null or s.currency !~ '^[A-Z]{3}$' then
    perform public.st_raise('validation', 'deposit');
  end if;
  if coalesce(s.deposit_minor, 0) > 0 and not exists (
       select 1 from public.deposit_tiers d where d.currency = s.currency and d.amount_minor = s.deposit_minor) then
    perform public.st_raise('validation', 'deposit tier');
  end if;
end $$;

-- The first `p_weekday` (ISO) on or after `p_date`.
create function public.st_next_weekday(p_date date, p_weekday int) returns date
language sql immutable set search_path = ''
as $$ select p_date + ((p_weekday - extract(isodow from p_date)::int + 7) % 7) $$;

create function public.st_jtime(p jsonb, k text) returns time
language plpgsql immutable set search_path = ''
as $$
begin
  if p ->> k is null then return null; end if;
  if p ->> k !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then perform public.st_raise('validation', k); end if;
  return (p ->> k)::time;
end $$;

create function public.st_jdate(p jsonb, k text) returns date
language plpgsql immutable set search_path = ''
as $$
begin
  if p ->> k is null then return null; end if;
  if p ->> k !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then perform public.st_raise('validation', k); end if;
  begin
    return (p ->> k)::date;
  exception when others then
    perform public.st_raise('validation', k);
  end;
end $$;

-- Strict integer from JSON (ST:validation otherwise).
create function public.st_jint(p jsonb, k text) returns int
language plpgsql immutable set search_path = ''
as $$
begin
  if p -> k is null or jsonb_typeof(p -> k) = 'null' then return null; end if;
  if jsonb_typeof(p -> k) <> 'number' or (p ->> k) !~ '^-?[0-9]+$' then perform public.st_raise('validation', k); end if;
  return (p ->> k)::int;
end $$;

-- createSeries(GameSeriesCreateInput) — camelCase JSON. The host is on the roster implicitly (and
-- approved in each occurrence); the first horizon of occurrences is generated immediately.
create function public.create_series(p_input jsonb) returns public.series_views
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles := public.st_active_profile();
  t timestamptz := public.st_now();
  cfg public.phase15_config := public.st_p15();
  v public.venues;
  s public.game_series;
  start_d date;
  r public.series_views;
  allowed text[] := array['sport', 'title', 'notes', 'visibility', 'venueId', 'location', 'hideExactLocation', 'capacity',
                          'minPlayers', 'depositMinor', 'currency', 'depositForfeitTo', 'womenOnly', 'teamCount',
                          'startDate', 'endDate', 'rosterPriorityHours', 'autoJoinReconfirmHours', 'recurrence', 'weekday',
                          'startTime', 'timeZone', 'durationMinutes'];
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then perform public.st_raise('validation'); end if;
  if exists (select 1 from jsonb_object_keys(p_input) k where k <> all (allowed)) then
    perform public.st_raise('validation', 'unknown field');
  end if;
  if me.host_suspended_until > t then perform public.st_raise('host_suspended'); end if;
  s.visibility := coalesce((p_input ->> 'visibility')::public.game_visibility, 'public');
  if s.visibility = 'public' and me.join_banned_until > t then perform public.st_raise('join_banned'); end if;
  if s.visibility = 'public' and me.visibility_restricted_until > t then
    perform public.st_raise('forbidden', 'visibility_restricted');
  end if;
  perform public.st_rate_limit(
    (select count(*) from public.game_series x where x.host_id = me.id and x.created_at > t - interval '24 hours'), 5);
  if (select count(*) from public.game_series x where x.host_id = me.id and x.status <> 'ended') >= 20 then
    perform public.st_raise('rate_limited', 'too many series');
  end if;
  s.sport := p_input ->> 'sport';
  if not exists (select 1 from public.sports x where x.id = s.sport) then perform public.st_raise('validation', 'unknown sport'); end if;
  s.venue_id := nullif(p_input ->> 'venueId', '')::uuid;
  if s.venue_id is not null then
    select * into v from public.venues x where x.id = s.venue_id;
    if v.id is null or v.status <> 'active' then perform public.st_raise('validation', 'venue not active'); end if;
    if not (s.sport = any (v.sports)) then perform public.st_raise('validation', 'sport not offered at venue'); end if;
    s.geog := v.geog;
  else
    s.geog := public.st_point((p_input #>> '{location,lat}')::double precision, (p_input #>> '{location,lng}')::double precision);
  end if;
  s.id := gen_random_uuid();
  s.host_id := me.id;
  s.title := btrim(p_input ->> 'title');
  s.notes := p_input ->> 'notes';
  s.women_only := coalesce((p_input ->> 'womenOnly')::boolean, false);
  -- Security H4: women-only needs a female host; hidden by default for women-only and private.
  if s.women_only and not exists (select 1 from public.profile_private pp where pp.user_id = me.id and pp.gender = 'female') then
    perform public.st_raise('women_only');
  end if;
  s.hide_exact_location := coalesce((p_input ->> 'hideExactLocation')::boolean, s.women_only or s.visibility = 'private');
  s.capacity := public.st_jint(p_input, 'capacity');
  s.min_players := coalesce(public.st_jint(p_input, 'minPlayers'), 2);
  s.team_count := coalesce(public.st_jint(p_input, 'teamCount'), 2);
  s.deposit_minor := coalesce(public.st_jint(p_input, 'depositMinor'), 0);
  s.currency := coalesce(p_input ->> 'currency', 'EUR');
  s.deposit_forfeit_to := 'pot'; -- Security M4: forfeits go to the pot in the MVP.
  s.recurrence := coalesce((p_input ->> 'recurrence')::public.series_recurrence, 'weekly');
  s.weekday := public.st_jint(p_input, 'weekday');
  s.start_time := public.st_jtime(p_input, 'startTime');
  s.time_zone := p_input ->> 'timeZone';
  s.duration_minutes := public.st_jint(p_input, 'durationMinutes');
  start_d := public.st_jdate(p_input, 'startDate');
  if start_d is null or s.weekday is null or s.weekday not between 1 and 7 then perform public.st_raise('validation', 'schedule'); end if;
  if not public.st_is_iana_tz(s.time_zone) then perform public.st_raise('validation', 'time zone'); end if;
  if start_d < (t at time zone s.time_zone)::date or start_d > (t at time zone s.time_zone)::date + 180 then
    perform public.st_raise('validation', 'start date');
  end if;
  s.anchor_date := public.st_next_weekday(start_d, s.weekday);
  s.end_date := public.st_jdate(p_input, 'endDate');
  s.horizon_weeks := cfg.series_horizon_weeks;
  s.roster_priority_hours := coalesce((p_input ->> 'rosterPriorityHours')::numeric, cfg.roster_priority_hours_default);
  s.auto_join_reconfirm_hours := coalesce((p_input ->> 'autoJoinReconfirmHours')::numeric, cfg.auto_join_reconfirm_hours);
  s.skipped_dates := '{}';
  s.schedule_revision := 0;
  s.status := 'active';
  perform public.st_validate_series(s, cfg);

  insert into public.game_series (id, host_id, sport, title, notes, visibility, venue_id, geog, approx_geog, hide_exact_location,
                                  capacity, min_players, deposit_minor, currency, deposit_forfeit_to, women_only, team_count,
                                  recurrence, weekday, start_time, time_zone, duration_minutes, anchor_date, end_date,
                                  horizon_weeks, roster_priority_hours, auto_join_reconfirm_hours, status, created_at, updated_at)
  values (s.id, s.host_id, s.sport, s.title, s.notes, s.visibility, s.venue_id, s.geog, s.geog, s.hide_exact_location,
          s.capacity, s.min_players, s.deposit_minor, s.currency, s.deposit_forfeit_to, s.women_only, s.team_count,
          s.recurrence, s.weekday, s.start_time, s.time_zone, s.duration_minutes, s.anchor_date, s.end_date,
          s.horizon_weeks, s.roster_priority_hours, s.auto_join_reconfirm_hours, 'active', t, t);
  perform public.st_series_generate(s.id, t);
  perform public.st_audit('series.created', me.id, jsonb_build_object('seriesId', s.id), me.id);
  select * into r from public.series_views x where x.id = s.id;
  return r;
end $$;

-- Cancel one generated occurrence (CancelOccurrence): the game is cancelled; with participants
-- inside lateCancelWindowHours this is a host late game cancellation (security M6 / TRUST-051(c),
-- dm_host_game_cancellation). Participants get occurrence_rescheduled (reschedule) or
-- occurrence_skipped (skip, series end).
create function public.st_cancel_occurrence(p_key text, p_reason text, p_at timestamptz) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.series_occurrences;
  g public.games;
  hc jsonb;
  had boolean;
begin
  select * into o from public.series_occurrences x where x.occurrence_key = p_key for update;
  if o.occurrence_key is null or o.status <> 'scheduled' then return; end if;
  select * into g from public.games x where x.id = o.game_id for update;
  if g.id is not null and g.status = 'scheduled' then
    had := public.st_has_participants(g.id);
    perform public.st_notify_occurrence(g.id,
      case when p_reason = 'rescheduled' then 'occurrence_rescheduled' else 'occurrence_skipped' end,
      jsonb_build_object('seriesTitle', g.title, 'startsAt', public.dm_iso(g.starts_at), 'reason', p_reason), p_reason);
    update public.games x set status = 'cancelled', cancelled_at = p_at where x.id = g.id;
    if had then
      hc := public.dm_host_game_cancellation(
        jsonb_build_object('id', g.id, 'hostId', g.host_id, 'startsAt', public.dm_iso(g.starts_at)), p_at, p_at, public.st_config());
      if (hc ->> 'late')::boolean then
        perform public.st_apply_effects(hc -> 'effects');
        perform public.st_evaluate_host(g.host_id);
      end if;
    end if;
  end if;
  update public.series_occurrences x
     set status = case when p_reason = 'skipped' then 'skipped'::public.occurrence_status else 'cancelled'::public.occurrence_status end,
         cancel_reason = p_reason
  where x.occurrence_key = p_key;
end $$;

-- Host-owned series row for update, or ST:not_found / ST:forbidden.
create function public.st_host_series(p_series_id uuid) returns public.game_series
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles := public.st_active_profile();
  s public.game_series;
begin
  select * into s from public.game_series x where x.id = p_series_id for update;
  if s.id is null or not public.st_can_see_series(s.id, me.id) then perform public.st_raise('not_found'); end if;
  if s.host_id <> me.id then perform public.st_raise('forbidden'); end if;
  return s;
end $$;

-- Approved or waitlisted participants other than the host (SeriesChangeInput.participants).
create function public.st_has_participants(p_game_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.game_participants gp join public.games g on g.id = gp.game_id
                 where gp.game_id = p_game_id and gp.user_id <> g.host_id and gp.status in ('approved', 'waitlisted'))
$$;

-- skipOccurrence (series/edit.ts skipOccurrence): a generated occurrence is cancelled (`skipped`;
-- host late-cancel rule inside the window); a future slot not yet generated is only recorded in
-- skipped_dates (the returned row is the planned occurrence, not stored). Rejects not_found
-- (unknown key or not a slot), conflict (already skipped/cancelled), outside_window (started).
create function public.skip_occurrence(p_series_id uuid, p_occurrence_key text) returns public.series_occurrences
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  cfg public.phase15_config := public.st_p15();
  s public.game_series := public.st_host_series(p_series_id);
  o public.series_occurrences;
  slot date;
  rev int;
  tm record;
begin
  select * into o from public.series_occurrences x where x.occurrence_key = p_occurrence_key and x.series_id = s.id for update;
  if o.occurrence_key is not null then
    if o.status <> 'scheduled' then perform public.st_raise('conflict', 'not scheduled'); end if;
    if o.starts_at <= t then perform public.st_raise('outside_window', 'started'); end if;
    perform public.st_cancel_occurrence(o.occurrence_key, 'skipped', t);
    slot := o.slot_date;
  else
    if p_occurrence_key is null or p_occurrence_key !~ ('^' || s.id::text || ':[0-9]+:[0-9]{4}-[0-9]{2}-[0-9]{2}$') then
      perform public.st_raise('not_found', 'occurrence key');
    end if;
    rev := split_part(p_occurrence_key, ':', 2)::int;
    begin
      slot := split_part(p_occurrence_key, ':', 3)::date;
    exception when others then
      perform public.st_raise('not_found', 'occurrence key');
    end;
    if rev <> s.schedule_revision or not exists (
         select 1 from public.st_series_slots(s.anchor_date, s.recurrence, s.end_date, slot, slot)) then
      perform public.st_raise('not_found', 'no such slot');
    end if;
    if slot = any (s.skipped_dates) then perform public.st_raise('conflict', 'already skipped'); end if;
    select * into tm from public.st_occurrence_times(s, slot, cfg, t);
    if tm.starts_at <= t then perform public.st_raise('outside_window', 'started'); end if;
    o := row(p_occurrence_key, s.id, slot, rev, public.dm_stable_uuid('occurrence:' || p_occurrence_key), tm.starts_at,
             tm.ends_at, tm.opens_at, tm.priority_until, tm.reconfirm_at, tm.release_at, 'skipped', 'skipped', false, t)::public.series_occurrences;
  end if;
  update public.game_series x set skipped_dates = array(select distinct d from unnest(x.skipped_dates || slot) d order by 1)
  where x.id = s.id;
  if o.status = 'scheduled' then
    select * into o from public.series_occurrences x where x.occurrence_key = p_occurrence_key;
  end if;
  return o;
end $$;

-- Re-derives the window columns of an occurrence (series/occurrences.ts retimeOccurrence).
create function public.st_retime_occurrence(p_key text, p_starts timestamptz, p_ends timestamptz, s public.game_series,
                                            p_cfg public.phase15_config) returns void
language sql security definer set search_path = ''
as $$
  update public.series_occurrences y
     set starts_at = p_starts, ends_at = p_ends,
         opens_at = least(y.opens_at, p_starts),
         priority_until = least(least(y.opens_at, p_starts) + s.roster_priority_hours * interval '1 hour', p_starts),
         reconfirm_at = p_starts - s.auto_join_reconfirm_hours * interval '1 hour',
         release_at = p_starts - p_cfg.auto_join_release_hours * interval '1 hour'
  where y.occurrence_key = p_key
$$;

create function public.st_notify_occurrence(p_game_id uuid, p_kind text, p_params jsonb, p_tag text) returns void
language sql security definer set search_path = ''
as $$
  select public.st_notify(gp.user_id, p_kind::public.notification_kind, p_params, p_game_id, null,
                          'notify:' || p_kind || ':' || p_game_id::text || ':' || gp.user_id::text || ':' || p_tag)
  from public.game_participants gp join public.games g on g.id = gp.game_id
  where gp.game_id = p_game_id and gp.user_id <> g.host_id and gp.status in ('approved', 'waitlisted')
$$;

-- editSeries(SeriesEdit) (series/edit.ts editSeries). scope 'this': one occurrence
-- (OccurrencePatch, marked overridden; moving it is refused with outside_window when it has
-- participants and the old or new start is inside lateCancelWindowHours). 'following': the template
-- from the pivot on (SeriesPatch); a schedule change (recurrence, weekday, startTime, timeZone,
-- durationMinutes) is a reschedule: revision + 1, anchor re-based on the pivot slot, later
-- occurrences cancelled (`rescheduled`) and regenerated (refused inside the late window when the
-- pivot has participants). Rejects not_found (pivot), conflict (pivot not scheduled / series
-- ended), outside_window (pivot started), validation.
create function public.update_series(p_series_id uuid, p_scope text, p_occurrence_key text, p_patch jsonb)
returns public.series_views
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  cfg public.phase15_config := public.st_p15();
  tcfg public.trust_config := public.st_config();
  s public.game_series := public.st_host_series(p_series_id);
  ns public.game_series;
  o public.series_occurrences;
  g public.games;
  x record;
  v public.venues;
  new_start timestamptz;
  new_end timestamptz;
  dur numeric;
  sched_change boolean;
  moved boolean := false;
  retimed boolean := false;
  located boolean := false;
  template_changed boolean;
  n_appr int;
  r public.series_views;
  this_keys text[] := array['title', 'notes', 'capacity', 'minPlayers', 'venueId', 'location', 'hideExactLocation',
                            'startsAt', 'durationMinutes'];
  template_keys text[] := array['title', 'notes', 'visibility', 'venueId', 'location', 'hideExactLocation', 'capacity',
                                'minPlayers', 'depositMinor', 'currency', 'depositForfeitTo', 'teamCount'];
  following_keys text[] := template_keys || array['recurrence', 'weekday', 'startTime', 'timeZone', 'durationMinutes',
                                                  'rosterPriorityHours', 'autoJoinReconfirmHours', 'endDate'];
begin
  if p_scope is null or p_scope not in ('this', 'following') then perform public.st_raise('validation', 'scope'); end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then perform public.st_raise('validation', 'patch'); end if;
  if s.status = 'ended' then perform public.st_raise('conflict', 'series ended'); end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k
             where k <> all (case when p_scope = 'this' then this_keys else following_keys end)) then
    perform public.st_raise('validation', 'field not editable');
  end if;
  select * into o from public.series_occurrences y where y.occurrence_key = p_occurrence_key and y.series_id = s.id for update;
  if o.occurrence_key is null then perform public.st_raise('not_found', 'occurrence'); end if;
  if o.status <> 'scheduled' then perform public.st_raise('conflict', 'occurrence not scheduled'); end if;
  if o.starts_at <= t then perform public.st_raise('outside_window', 'started'); end if;

  if p_scope = 'this' then
    select * into g from public.games y where y.id = o.game_id for update;
    select count(*) into n_appr from public.game_participants gp where gp.game_id = g.id and gp.status = 'approved';
    new_start := g.starts_at;
    if p_patch ? 'startsAt' then
      begin
        new_start := (p_patch ->> 'startsAt')::timestamptz;
      exception when others then
        perform public.st_raise('validation', 'startsAt');
      end;
      if new_start is null then perform public.st_raise('validation', 'startsAt'); end if;
    end if;
    dur := coalesce(public.st_jint(p_patch, 'durationMinutes'), extract(epoch from g.ends_at - g.starts_at) / 60);
    if p_patch ? 'durationMinutes' and dur not between cfg.series_min_duration_minutes and cfg.series_max_duration_minutes then
      perform public.st_raise('validation', 'durationMinutes');
    end if;
    new_end := new_start + dur * interval '1 minute';
    moved := new_start <> g.starts_at;
    retimed := moved or p_patch ? 'durationMinutes';
    if moved then
      if new_start <= t or new_start > t + interval '180 days' then perform public.st_raise('validation', 'startsAt'); end if;
      if public.st_has_participants(g.id)
         and (g.starts_at - t < tcfg.late_cancel_window_hours * interval '1 hour'
              or new_start - t < tcfg.late_cancel_window_hours * interval '1 hour') then
        perform public.st_raise('outside_window', 'inside late-cancel window');
      end if;
    end if;
    if p_patch ? 'venueId' or p_patch ? 'location' then
      located := true;
      if nullif(p_patch ->> 'venueId', '') is not null then
        select * into v from public.venues y where y.id = (p_patch ->> 'venueId')::uuid;
        if v.id is null or v.status <> 'active' or not (g.sport = any (v.sports)) then
          perform public.st_raise('validation', 'venueId');
        end if;
      elsif p_patch -> 'location' is null or jsonb_typeof(p_patch -> 'location') <> 'object' then
        perform public.st_raise('validation', 'location');
      end if;
    end if;
    if p_patch ? 'title' then g.title := btrim(p_patch ->> 'title'); end if;
    if p_patch ? 'notes' then g.notes := p_patch ->> 'notes'; end if;
    g.capacity := coalesce(public.st_jint(p_patch, 'capacity'), g.capacity);
    g.min_players := coalesce(public.st_jint(p_patch, 'minPlayers'), g.min_players);
    g.hide_exact_location := coalesce((p_patch ->> 'hideExactLocation')::boolean, g.hide_exact_location);
    if g.title is null or char_length(g.title) not between 1 and 80 then perform public.st_raise('validation', 'title'); end if;
    if g.notes is not null and char_length(g.notes) > 1000 then perform public.st_raise('validation', 'notes'); end if;
    if g.capacity not between 2 and 200 or g.team_count > g.capacity then perform public.st_raise('validation', 'capacity'); end if;
    if g.capacity < n_appr then perform public.st_raise('validation', 'capacity below approved players'); end if;
    if g.min_players < 2 or g.min_players > g.capacity then perform public.st_raise('validation', 'minPlayers'); end if;
    update public.games y set title = g.title, notes = g.notes, capacity = g.capacity, min_players = g.min_players,
           hide_exact_location = g.hide_exact_location,
           starts_at = new_start, ends_at = new_end,
           venue_id = case when located then nullif(p_patch ->> 'venueId', '')::uuid else y.venue_id end,
           geog = case when located and nullif(p_patch ->> 'venueId', '') is null
                       then public.st_point((p_patch #>> '{location,lat}')::double precision,
                                            (p_patch #>> '{location,lng}')::double precision)
                       else y.geog end
    where y.id = g.id;
    perform public.st_retime_occurrence(o.occurrence_key, new_start, new_end, s, cfg);
    update public.series_occurrences y set overridden = true where y.occurrence_key = o.occurrence_key;
    perform public.st_notify_occurrence(g.id, 'occurrence_updated',
      jsonb_build_object('seriesTitle', s.title, 'startsAt', public.dm_iso(new_start)), public.dm_iso(t));
    if p_patch ? 'capacity' then perform public.st_promote_waitlist(g.id); end if;
  else
    -- 'following': the template from the pivot on.
    ns := s;
    if p_patch ? 'title' then ns.title := btrim(p_patch ->> 'title'); end if;
    if p_patch ? 'notes' then ns.notes := p_patch ->> 'notes'; end if;
    ns.visibility := coalesce((p_patch ->> 'visibility')::public.game_visibility, s.visibility);
    ns.hide_exact_location := coalesce((p_patch ->> 'hideExactLocation')::boolean, s.hide_exact_location);
    ns.capacity := coalesce(public.st_jint(p_patch, 'capacity'), s.capacity);
    ns.min_players := coalesce(public.st_jint(p_patch, 'minPlayers'), s.min_players);
    ns.team_count := coalesce(public.st_jint(p_patch, 'teamCount'), s.team_count);
    ns.deposit_minor := coalesce(public.st_jint(p_patch, 'depositMinor'), s.deposit_minor);
    ns.currency := coalesce(p_patch ->> 'currency', s.currency);
    ns.recurrence := coalesce((p_patch ->> 'recurrence')::public.series_recurrence, s.recurrence);
    ns.weekday := coalesce(public.st_jint(p_patch, 'weekday'), s.weekday);
    ns.start_time := coalesce(public.st_jtime(p_patch, 'startTime'), s.start_time);
    ns.time_zone := coalesce(p_patch ->> 'timeZone', s.time_zone);
    ns.duration_minutes := coalesce(public.st_jint(p_patch, 'durationMinutes'), s.duration_minutes);
    ns.roster_priority_hours := coalesce((p_patch ->> 'rosterPriorityHours')::numeric, s.roster_priority_hours);
    ns.auto_join_reconfirm_hours := coalesce((p_patch ->> 'autoJoinReconfirmHours')::numeric, s.auto_join_reconfirm_hours);
    if p_patch ? 'endDate' then
      ns.end_date := public.st_jdate(p_patch, 'endDate');
      if ns.end_date is not null and ns.end_date < o.slot_date then perform public.st_raise('validation', 'endDate'); end if;
    end if;
    if ns.visibility = 'public' and s.visibility = 'private' and exists (
         select 1 from public.profiles p where p.id = s.host_id and (p.join_banned_until > t or p.visibility_restricted_until > t)) then
      perform public.st_raise('forbidden', 'visibility_restricted');
    end if;
    if p_patch ? 'venueId' or p_patch ? 'location' then
      located := true;
      if nullif(p_patch ->> 'venueId', '') is not null then
        select * into v from public.venues y where y.id = (p_patch ->> 'venueId')::uuid;
        if v.id is null or v.status <> 'active' or not (s.sport = any (v.sports)) then perform public.st_raise('validation', 'venueId'); end if;
        ns.venue_id := v.id;
        ns.geog := v.geog;
      else
        if p_patch -> 'location' is null or jsonb_typeof(p_patch -> 'location') <> 'object' then
          perform public.st_raise('validation', 'location');
        end if;
        ns.venue_id := null;
        ns.geog := public.st_point((p_patch #>> '{location,lat}')::double precision, (p_patch #>> '{location,lng}')::double precision);
      end if;
    end if;
    sched_change := (p_patch ? 'recurrence' and ns.recurrence <> s.recurrence) or (p_patch ? 'weekday' and ns.weekday <> s.weekday)
                    or (p_patch ? 'startTime' and ns.start_time <> s.start_time)
                    or (p_patch ? 'timeZone' and ns.time_zone <> s.time_zone)
                    or (p_patch ? 'durationMinutes' and ns.duration_minutes <> s.duration_minutes);
    template_changed := exists (select 1 from jsonb_object_keys(p_patch) k where k = any (template_keys));
    perform public.st_validate_series(ns, cfg);
    if sched_change then
      if public.st_has_participants(o.game_id) and o.starts_at - t < tcfg.late_cancel_window_hours * interval '1 hour' then
        perform public.st_raise('outside_window', 'inside late-cancel window');
      end if;
      ns.schedule_revision := s.schedule_revision + 1;
      ns.anchor_date := public.st_next_weekday(o.slot_date, ns.weekday);
    end if;
    for x in select y.* from public.series_occurrences y
             where y.series_id = s.id and y.status = 'scheduled' and y.slot_date >= o.slot_date and y.starts_at > t
             order by y.starts_at loop
      if sched_change or (ns.end_date is not null and x.slot_date > ns.end_date) then
        perform public.st_cancel_occurrence(x.occurrence_key, case when sched_change then 'rescheduled' else 'series_ended' end, t);
        continue;
      end if;
      select count(*) into n_appr from public.game_participants gp where gp.game_id = x.game_id and gp.status = 'approved';
      if ns.capacity < n_appr then perform public.st_raise('validation', 'capacity below approved players'); end if;
      update public.games y set title = ns.title, notes = ns.notes, visibility = ns.visibility, capacity = ns.capacity,
             min_players = ns.min_players, team_count = ns.team_count, hide_exact_location = ns.hide_exact_location,
             deposit_minor = ns.deposit_minor, currency = ns.currency,
             venue_id = case when located then ns.venue_id else y.venue_id end,
             geog = case when located then ns.geog else y.geog end
      where y.id = x.game_id;
      perform public.st_retime_occurrence(x.occurrence_key, x.starts_at, x.ends_at, ns, cfg);
      if template_changed then
        perform public.st_notify_occurrence(x.game_id, 'occurrence_updated',
          jsonb_build_object('seriesTitle', s.title, 'startsAt', public.dm_iso(x.starts_at)), public.dm_iso(t));
      end if;
      if ns.capacity > s.capacity then perform public.st_promote_waitlist(x.game_id); end if;
    end loop;
    update public.game_series y set title = ns.title, notes = ns.notes, visibility = ns.visibility,
           hide_exact_location = ns.hide_exact_location, capacity = ns.capacity, min_players = ns.min_players,
           team_count = ns.team_count, deposit_minor = ns.deposit_minor, currency = ns.currency,
           recurrence = ns.recurrence, weekday = ns.weekday, start_time = ns.start_time, time_zone = ns.time_zone,
           duration_minutes = ns.duration_minutes, anchor_date = ns.anchor_date, end_date = ns.end_date,
           roster_priority_hours = ns.roster_priority_hours, auto_join_reconfirm_hours = ns.auto_join_reconfirm_hours,
           schedule_revision = ns.schedule_revision, venue_id = ns.venue_id, geog = ns.geog
    where y.id = s.id;
    if sched_change then perform public.st_series_generate(s.id, t); end if;
  end if;
  perform public.st_audit('series.edited', s.host_id,
    jsonb_build_object('seriesId', s.id, 'scope', p_scope, 'occurrenceKey', p_occurrence_key), s.host_id);
  select * into r from public.series_views y where y.id = s.id;
  return r;
end $$;

-- endSeries: no more occurrences; later scheduled occurrences that have not started are cancelled
-- (`series_ended`, host late-cancel rule inside the window).
create function public.end_series(p_series_id uuid) returns public.series_views
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  s public.game_series := public.st_host_series(p_series_id);
  x record;
  r public.series_views;
begin
  if s.status = 'ended' then perform public.st_raise('conflict', 'series ended'); end if;
  for x in select y.occurrence_key from public.series_occurrences y
           where y.series_id = s.id and y.status = 'scheduled' and y.starts_at > t order by y.starts_at loop
    perform public.st_cancel_occurrence(x.occurrence_key, 'series_ended', t);
  end loop;
  update public.game_series y set status = 'ended', ended_at = t where y.id = s.id;
  select * into r from public.series_views y where y.id = s.id;
  return r;
end $$;

-- Common roster-entry gates (join through the link / accept an invite). Raises ST:<code>.
create function public.st_roster_gates(s public.game_series, me public.profiles, p_at timestamptz) returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if s.status = 'ended' then perform public.st_raise('game_not_open', 'series ended'); end if;
  if me.join_banned_until > p_at then perform public.st_raise('join_banned'); end if;
  if public.st_is_blocked(s.host_id, me.id) then perform public.st_raise('blocked'); end if;
  if public.st_is_hidden_user(s.host_id) then perform public.st_raise('not_found'); end if;
  if s.visibility = 'public' and me.visibility_restricted_until > p_at then
    perform public.st_raise('forbidden', 'visibility_restricted');
  end if;
  if s.women_only and not exists (select 1 from public.profile_private pp where pp.user_id = me.id and pp.gender = 'female') then
    perform public.st_raise('women_only');
  end if;
end $$;

-- Roster size cap (anti-abuse; ~4× the largest capacity).
create function public.st_roster_cap_check(p_series_id uuid) returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select count(*) from public.series_roster r where r.series_id = p_series_id and r.status in ('regular', 'invited')) >= 200 then
    perform public.st_raise('conflict', 'roster full');
  end if;
end $$;

-- joinSeriesViaInvite: the link adds the caller to the roster (`invite_link`, PRD §5.4 step 4) and
-- records the join for migration stats. Idempotent for current regulars.
create function public.join_roster(p_token text) returns public.series_roster
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles := public.st_active_profile();
  t timestamptz := public.st_now();
  s public.game_series;
  rm public.series_roster;
begin
  if p_token is null or char_length(p_token) not between 16 and 64 then perform public.st_raise('not_found'); end if;
  select * into s from public.game_series x where x.invite_token = p_token for update;
  if s.id is null then perform public.st_raise('not_found'); end if;
  if s.host_id = me.id then perform public.st_raise('conflict', 'host'); end if;
  perform public.st_roster_gates(s, me, t);
  select * into rm from public.series_roster r where r.series_id = s.id and r.user_id = me.id for update;
  if rm.series_id is not null and rm.removed_by_host then perform public.st_raise('forbidden', 'removed by host'); end if;
  if rm.series_id is not null and rm.status = 'regular' then perform public.st_raise('conflict', 'already a regular'); end if;
  perform public.st_roster_cap_check(s.id);
  perform public.st_rate_limit(
    (select count(*) from public.invite_joins j where j.user_id = me.id and j.created_at > t - interval '24 hours'), 30);
  insert into public.series_roster as r (series_id, user_id, status, joined_via, joined_at)
  values (s.id, me.id, 'regular', 'invite_link', t)
  on conflict (series_id, user_id) do update
    set status = 'regular', joined_via = case when r.status = 'invited' then r.joined_via else 'invite_link' end,
        joined_at = t, left_at = null, consecutive_misses = 0, leave_offered_at = null
  returning * into rm;
  insert into public.invite_joins (kind, series_id, user_id, created_at) values ('series', s.id, me.id, t) on conflict do nothing;
  perform public.st_notify(s.host_id, 'roster_added',
    jsonb_build_object('seriesTitle', s.title, 'via', 'invite_link', 'seriesId', s.id::text), null, null,
    'roster_added:' || s.id::text || ':' || me.id::text || ':' || public.dm_iso(t));
  return rm;
end $$;

-- resolveSeriesInvite: the series behind a link (masked like series_views for a non-member). Null
-- when unknown, ended, or the host is blocked/hidden.
create function public.resolve_series_invite(p_token text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  me public.profiles := public.st_active_profile();
  s public.game_series;
begin
  select * into s from public.game_series x where x.invite_token = p_token;
  if s.id is null or s.status = 'ended' or public.st_is_blocked(s.host_id, me.id) or public.st_is_hidden_user(s.host_id) then
    return null;
  end if;
  return jsonb_build_object(
    'id', s.id, 'hostId', s.host_id, 'sport', s.sport, 'title', s.title, 'visibility', s.visibility,
    'approxLocation', jsonb_build_object('lat', extensions.st_y(s.approx_geog::extensions.geometry),
                                         'lng', extensions.st_x(s.approx_geog::extensions.geometry)),
    'hideExactLocation', s.hide_exact_location, 'capacity', s.capacity, 'womenOnly', s.women_only,
    'recurrence', s.recurrence, 'weekday', s.weekday, 'startTime', public.st_hhmm(s.start_time), 'timeZone', s.time_zone,
    'durationMinutes', s.duration_minutes, 'status', s.status, 'depositMinor', s.deposit_minor, 'currency', s.currency,
    'rosterCount', (select count(*) from public.series_roster r where r.series_id = s.id and r.status = 'regular'),
    'myRosterStatus', (select r.status from public.series_roster r where r.series_id = s.id and r.user_id = me.id));
end $$;

-- inviteToRoster: host only; the invitee must have played with the host (GAME-032), blocks apply.
create function public.invite_to_roster(p_series_id uuid, p_user_id uuid) returns public.series_roster
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  s public.game_series := public.st_host_series(p_series_id);
  rm public.series_roster;
begin
  if p_user_id is null or p_user_id = s.host_id then perform public.st_raise('validation', 'user'); end if;
  if s.status = 'ended' then perform public.st_raise('game_not_open', 'series ended'); end if;
  if public.st_is_blocked(s.host_id, p_user_id) then perform public.st_raise('blocked'); end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.deleted_at is null and not p.permanently_banned) then
    perform public.st_raise('not_found');
  end if;
  if not public.st_played_with(s.host_id, p_user_id) then perform public.st_raise('forbidden', 'not played with'); end if;
  select * into rm from public.series_roster r where r.series_id = s.id and r.user_id = p_user_id for update;
  if rm.series_id is not null and rm.status in ('regular', 'invited') then perform public.st_raise('conflict'); end if;
  perform public.st_roster_cap_check(s.id);
  perform public.st_rate_limit(
    (select count(*) from public.series_roster r where r.invited_by = s.host_id and r.joined_at > t - interval '24 hours'), 50);
  insert into public.series_roster as r (series_id, user_id, status, joined_via, invited_by, joined_at)
  values (s.id, p_user_id, 'invited', 'played_with', s.host_id, t)
  on conflict (series_id, user_id) do update
    set status = 'invited', joined_via = 'played_with', invited_by = s.host_id, joined_at = t, left_at = null,
        removed_by_host = false, always_in = false
  returning * into rm;
  perform public.st_notify(p_user_id, 'roster_added',
    jsonb_build_object('seriesTitle', s.title, 'via', 'played_with', 'invited', 1, 'seriesId', s.id::text), null, null,
    'roster_invited:' || s.id::text || ':' || p_user_id::text || ':' || public.dm_iso(t));
  return rm;
end $$;

-- acceptRosterInvite: `invited` → `regular`.
create function public.accept_roster_invite(p_series_id uuid) returns public.series_roster
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles := public.st_active_profile();
  t timestamptz := public.st_now();
  s public.game_series;
  rm public.series_roster;
begin
  select * into rm from public.series_roster r where r.series_id = p_series_id and r.user_id = me.id for update;
  if rm.series_id is null or rm.status <> 'invited' then perform public.st_raise('not_found'); end if;
  select * into s from public.game_series x where x.id = p_series_id;
  perform public.st_roster_gates(s, me, t);
  update public.series_roster r set status = 'regular', joined_at = t, consecutive_misses = 0
  where r.series_id = p_series_id and r.user_id = me.id returning * into rm;
  return rm;
end $$;

-- removeFromRoster: host only (the member becomes `left` and cannot rejoin through the link).
create function public.remove_from_roster(p_series_id uuid, p_user_id uuid) returns public.series_roster
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  s public.game_series := public.st_host_series(p_series_id);
  rm public.series_roster;
begin
  if p_user_id = s.host_id then perform public.st_raise('forbidden', 'host'); end if;
  update public.series_roster r set status = 'left', always_in = false, left_at = t, removed_by_host = true
  where r.series_id = s.id and r.user_id = p_user_id and r.status <> 'left'
  returning * into rm;
  if rm.series_id is null then perform public.st_raise('not_found'); end if;
  return rm;
end $$;

-- leaveRoster: the caller leaves (no card, GAME-011). Existing participations are kept.
create function public.leave_roster(p_series_id uuid) returns public.series_roster
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  rm public.series_roster;
begin
  update public.series_roster r set status = 'left', always_in = false, left_at = public.st_now()
  where r.series_id = p_series_id and r.user_id = uid and r.status <> 'left'
  returning * into rm;
  if rm.series_id is null then perform public.st_raise('not_found'); end if;
  return rm;
end $$;

-- setAlwaysIn: regulars only. Applies to occurrences generated from now on.
create function public.set_always_in(p_series_id uuid, p_always_in boolean) returns public.series_roster
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles := public.st_active_profile();
  rm public.series_roster;
begin
  if p_always_in is null then perform public.st_raise('validation'); end if;
  update public.series_roster r set always_in = p_always_in
  where r.series_id = p_series_id and r.user_id = me.id and r.status = 'regular'
  returning * into rm;
  if rm.series_id is null then perform public.st_raise('forbidden', 'not a regular'); end if;
  return rm;
end $$;

-- reconfirmAutoJoin (series/roster.ts reconfirmAutoJoin): `true` keeps the spot, `false` releases
-- it without a card, allowed only before the late-cancel window (afterwards outside_window: use the
-- normal cancel). Either answer resets the miss streak. Rejects not_found without a held auto-join,
-- game_not_open once started or cancelled.
create function public.reconfirm_auto_join(p_game_id uuid, p_attending boolean) returns public.participant_views
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  t timestamptz := public.st_now();
  tcfg public.trust_config := public.st_config();
  aj public.series_auto_joins;
  g public.games;
begin
  if p_attending is null then perform public.st_raise('validation'); end if;
  select * into aj from public.series_auto_joins x where x.game_id = p_game_id and x.user_id = uid for update;
  if aj.game_id is null or aj.released_at is not null then perform public.st_raise('not_found'); end if;
  select * into g from public.games x where x.id = p_game_id;
  if g.status <> 'scheduled' or t >= g.starts_at then perform public.st_raise('game_not_open'); end if;
  if p_attending then
    update public.series_auto_joins x set reconfirmed_at = t where x.game_id = p_game_id and x.user_id = uid;
  else
    if g.starts_at - t < tcfg.late_cancel_window_hours * interval '1 hour' then perform public.st_raise('outside_window'); end if;
    perform public.st_release_autojoin(p_game_id, uid, t);
  end if;
  update public.series_roster r set consecutive_misses = 0
  where r.series_id = aj.series_id and r.user_id = uid and r.consecutive_misses > 0;
  return public.st_participant_view(p_game_id, uid);
end $$;
