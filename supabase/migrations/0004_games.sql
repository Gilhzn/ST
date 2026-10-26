-- 0004_games.sql
-- Games, participants, invite access, check-ins, peer confirmations, results and host ratings.

create table public.games (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles (id),
  sport text not null references public.sports (id),
  title text not null check (char_length(title) between 1 and 80),
  notes text check (notes is null or char_length(notes) <= 1000),
  visibility public.game_visibility not null default 'public',
  venue_id uuid references public.venues (id) on delete set null,
  -- Exact pin (copied from the venue when venue_id is set). Never selectable by clients directly;
  -- exposed through game_views / nearby_games only to the host and approved participants when hidden.
  geog extensions.geography(Point, 4326) not null,
  -- ~500 m grid cell centre, maintained by trigger; what non-approved viewers see.
  approx_geog extensions.geography(Point, 4326) not null,
  hide_exact_location boolean not null default false,
  capacity int not null check (capacity between 2 and 200),
  -- Game.minPlayers (GAME-001); TRUST-011: the game happened with ≥ max(2, ⌈min_players/2⌉) verified.
  min_players int not null default 2 check (min_players >= 2),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  deposit_minor int not null default 0 check (deposit_minor >= 0 and deposit_minor <= 100000000),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  deposit_forfeit_to public.deposit_forfeit_target not null default 'pot',
  women_only boolean not null default false,
  status public.game_status not null default 'scheduled',
  team_count int not null default 2 check (team_count between 1 and 16),
  -- Purged (null) qrSecretRetentionHours after ends_at (compliance retention table).
  invite_token text unique default encode(extensions.gen_random_bytes(18), 'hex'),
  -- HMAC key (used as utf8 text, domain wire format) for rotating QR tokens. No client grant on
  -- this column, ever (not even the host).
  qr_secret text default encode(extensions.gen_random_bytes(32), 'hex'),
  -- TRUST-011: set at attendance finalisation (≥ 2 verified players); null until then.
  happened boolean,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '24 hours'),
  check (team_count <= capacity),
  check (min_players <= capacity)
);
create index games_geog_gist on public.games using gist (geog);
create index games_approx_geog_gist on public.games using gist (approx_geog);
create index games_starts_idx on public.games (starts_at);
create index games_host_idx on public.games (host_id);
create index games_ends_status_idx on public.games (ends_at) where status = 'scheduled';
create trigger games_touch before update on public.games
  for each row execute function public.st_touch_updated_at();

create function public.st_games_geo() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.venue_id is not null and (tg_op = 'INSERT' or new.venue_id is distinct from old.venue_id) then
    select ve.geog into new.geog from public.venues ve where ve.id = new.venue_id;
  end if;
  new.approx_geog := public.st_approx_point(new.geog);
  return new;
end $$;
create trigger games_geo before insert or update of geog, venue_id on public.games
  for each row execute function public.st_games_geo();

-- ---------------------------------------------------------------------------
-- game_participants
-- ---------------------------------------------------------------------------
create table public.game_participants (
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  status public.participant_status not null default 'requested',
  attendance public.attendance_status not null default 'unknown',
  team int check (team is null or team >= 0),
  position text,
  late_cancel boolean not null default false,
  -- TRUST-021: the late-cancelled spot was refilled and the replacement checked in → card voided,
  -- late cancel not counted in reliability.
  late_cancel_refilled boolean not null default false,
  -- The late canceller whose spot this participant took (set on approval/offer acceptance; the
  -- refill time is decided_at).
  replaces_user_id uuid,
  -- False while a required deposit payment method is not yet saved (request hidden from host).
  payment_ready boolean not null default true,
  check_in_method public.checkin_method,
  checked_in_at timestamptz,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  waitlisted_at timestamptz,
  cancelled_at timestamptz,
  primary key (game_id, user_id),
  check ((attendance = 'verified') = (check_in_method is not null and checked_in_at is not null))
);
create index game_participants_user_idx on public.game_participants (user_id);
create index game_participants_waitlist_idx on public.game_participants (game_id, waitlisted_at) where status = 'waitlisted';

-- GAME-045 waitlist offers of the current round (games/waitlist.ts WaitlistOffer). A player offered
-- once is not offered again in the round (unless flash fill); the round ends when the game is full.
create table public.waitlist_offers (
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  offered_at timestamptz not null,
  accept_by timestamptz not null,
  mode text not null check (mode in ('standard', 'short', 'flash')),
  primary key (game_id, user_id)
);

-- Private-game visibility granted by opening an invite link (resolve_invite).
create table public.game_invite_access (
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (game_id, user_id)
);

-- ---------------------------------------------------------------------------
-- checkins (every verification attempt; raw GPS samples are never stored)
-- ---------------------------------------------------------------------------
create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  method public.checkin_method not null,
  outcome text not null check (outcome in ('verified', 'rejected')),
  reason public.checkin_reject_reason,
  distance_m numeric(10, 2),
  signals public.spoof_signal[] not null default '{}',
  submitted_by uuid,
  created_at timestamptz not null default now(),
  check ((outcome = 'rejected') = (reason is not null))
);
create index checkins_game_user_idx on public.checkins (game_id, user_id);

-- ---------------------------------------------------------------------------
-- peer_confirmations
-- ---------------------------------------------------------------------------
create table public.peer_confirmations (
  game_id uuid not null references public.games (id) on delete cascade,
  confirmer_id uuid not null references public.profiles (id),
  target_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (game_id, confirmer_id, target_id),
  check (confirmer_id <> target_id)
);
create index peer_confirmations_target_idx on public.peer_confirmations (game_id, target_id);

-- ---------------------------------------------------------------------------
-- game_results: window [ends_at, ends_at + resultWindowHours] is enforced by submit_result
-- (configurable); the CHECK pins the lower bound and a hard upper bound.
-- ---------------------------------------------------------------------------
create table public.game_results (
  game_id uuid primary key references public.games (id) on delete cascade,
  team_scores int[] not null check (cardinality(team_scores) between 1 and 16 and 0 <= all (team_scores)),
  submitted_by uuid not null references public.profiles (id),
  submitted_at timestamptz not null,
  game_ends_at timestamptz not null,
  check (submitted_at >= game_ends_at and submitted_at <= game_ends_at + interval '48 hours')
);

-- ---------------------------------------------------------------------------
-- host_ratings
-- ---------------------------------------------------------------------------
create table public.host_ratings (
  game_id uuid not null references public.games (id) on delete cascade,
  rater_id uuid not null references public.profiles (id),
  host_id uuid not null references public.profiles (id),
  stars smallint not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (game_id, rater_id),
  check (rater_id <> host_id)
);
create index host_ratings_host_idx on public.host_ratings (host_id);

-- ---------------------------------------------------------------------------
-- Visibility helpers
-- ---------------------------------------------------------------------------

-- May the viewer see this game at all (row level)?
create function public.st_can_see_game(p_game_id uuid, p_viewer uuid default auth.uid()) returns boolean
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
               or exists (select 1 from public.game_invite_access ia where ia.game_id = g.id and ia.user_id = p_viewer))
        )
      ))
$$;

-- May the viewer see the exact location (host, approved participant, moderator)?
create function public.st_can_see_exact(p_game_id uuid, p_viewer uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_viewer is not null and exists (
    select 1 from public.games g
    where g.id = p_game_id
      and (not g.hide_exact_location
           or g.host_id = p_viewer
           or public.st_is_moderator(p_viewer)
           or exists (select 1 from public.game_participants gp
                      where gp.game_id = g.id and gp.user_id = p_viewer and gp.status = 'approved')))
$$;

create function public.st_is_host(p_game_id uuid, p_uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.games g where g.id = p_game_id and g.host_id = p_uid) $$;

create function public.st_is_approved(p_game_id uuid, p_uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.game_participants gp
                 where gp.game_id = p_game_id and gp.user_id = p_uid and gp.status = 'approved')
$$;

-- Caller-relative wrappers granted to clients (see 0002).
create function public.st_my_game_visible(p_game_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select public.st_can_see_game(p_game_id, auth.uid()) $$;

create function public.st_my_exact(p_game_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select public.st_can_see_exact(p_game_id, auth.uid()) $$;

create function public.st_am_host(p_game_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select public.st_is_host(p_game_id, auth.uid()) $$;

create function public.st_am_approved(p_game_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select public.st_is_approved(p_game_id, auth.uid()) $$;

-- The game as the current viewer may see it (types.ts Game/GameSummary). Definer view with an
-- explicit row filter; exact location, venue and invite token are masked per viewer.
create view public.game_views with (security_barrier = true) as
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
         g.min_players
  from public.games g
  cross join lateral (select public.st_my_exact(g.id) as exact) x
  where public.st_my_game_visible(g.id);

-- Participants with 1-based waitlist rank (types.ts Participant). Row filter mirrors the
-- game_participants RLS policy.
create view public.participant_views with (security_barrier = true) as
  select gp.game_id,
         gp.user_id,
         gp.status,
         gp.attendance,
         gp.team,
         gp.position,
         case when gp.status = 'waitlisted' then
           (select count(*)::int from public.game_participants w
             where w.game_id = gp.game_id and w.status = 'waitlisted'
               and (w.waitlisted_at, w.user_id) <= (gp.waitlisted_at, gp.user_id))
         end as waitlist_rank,
         gp.late_cancel,
         gp.late_cancel_refilled,
         (select o.accept_by from public.waitlist_offers o
           where o.game_id = gp.game_id and o.user_id = gp.user_id and gp.status = 'waitlisted'
             and o.accept_by > public.st_now()) as offer_expires_at,
         (select o.mode from public.waitlist_offers o
           where o.game_id = gp.game_id and o.user_id = gp.user_id and gp.status = 'waitlisted'
             and o.accept_by > public.st_now()) as offer_mode,
         gp.payment_ready,
         gp.check_in_method,
         gp.checked_in_at,
         gp.requested_at,
         gp.decided_at,
         gp.cancelled_at,
         (select o.offered_at from public.waitlist_offers o
           where o.game_id = gp.game_id and o.user_id = gp.user_id and gp.status = 'waitlisted'
             and o.accept_by > public.st_now()) as offered_at
  from public.game_participants gp
  where auth.uid() is not null
    and (
      gp.user_id = auth.uid()
      or public.st_am_moderator()
      or (public.st_am_host(gp.game_id) and (gp.payment_ready or gp.status <> 'requested'))
      or (public.st_am_approved(gp.game_id)
          and gp.status in ('approved', 'waitlisted')
          and not public.st_my_blocked(gp.user_id)
          and not public.st_hidden_from_me(gp.user_id))
    );
