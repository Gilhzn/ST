-- 0102_ratings.sql (Phase 1.5, contract v3)
-- Result confirmation (GAME-071), peer attribute ratings (RATE-001..005) and Glicko-2 skill ratings
-- (GLK-001..007). The dm_* functions are exact mirrors of packages/domain/src/rating (same camelCase
-- JSON in → same JSON out; Glicko math in double precision, parity ≤ 1e-6, pinned by
-- tests/ratings.test.ts against the TS functions and the rating.* golden cases).
--
-- RATE-005 / privacy: ratings are never used for sanctions (no trust function reads these tables;
-- pinned by a catalog test) and never readable publicly. A player reads their own detailed
-- ratings; a host gets only a 1–5 band per participant of their game (game_skill_bands).

create type public.format_family as enum
  ('small_sided', 'full_sided', 'half_court', 'full_court', 'singles', 'doubles', 'pairs', 'teams');
create type public.result_verdict as enum ('confirm', 'dispute');

-- PLAYER_RATING_ATTRIBUTES (types.ts): peer-rated player attributes per sport (every sport has `overall`).
alter table public.sports add column player_rating_attributes text[] not null default '{overall}';
update public.sports s set player_rating_attributes = x.attrs
from (values
  ('football', array['speed', 'ball_control', 'passing', 'defence', 'overall']),
  ('basketball', array['shooting', 'handling', 'defence', 'athleticism', 'overall']),
  ('tennis', array['serve', 'groundstrokes', 'net_play', 'movement', 'overall']),
  ('padel', array['serve', 'volley', 'walls', 'positioning', 'overall']),
  ('running', array['pace', 'endurance', 'overall']),
  ('volleyball', array['serve', 'passing', 'attack', 'defence', 'overall'])
) as x(id, attrs)
where s.id = x.id;

-- GLK-003: teams published before kickoff (save_teams stamps it).
alter table public.games add column teams_published_at timestamptz;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- GAME-071: a verified participant's verdict (one row per user; may change until the window closes).
create table public.result_confirmations (
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  verdict public.result_verdict not null,
  created_at timestamptz not null default now(),
  primary key (game_id, user_id)
);

-- RATE-001: one rater's scores for one co-player in one game.
create table public.peer_ratings (
  game_id uuid not null references public.games (id) on delete cascade,
  rater_id uuid not null references public.profiles (id) on delete cascade,
  ratee_id uuid not null references public.profiles (id) on delete cascade,
  sport text not null references public.sports (id),
  scores jsonb not null check (jsonb_typeof(scores) = 'object' and scores <> '{}'::jsonb),
  created_at timestamptz not null default now(),
  primary key (game_id, rater_id, ratee_id),
  check (rater_id <> ratee_id)
);
create index peer_ratings_ratee_idx on public.peer_ratings (ratee_id, sport, created_at);
create index peer_ratings_rater_idx on public.peer_ratings (rater_id, sport, created_at);

-- GLK-001: one Glicko-2 row per user, sport and format family.
create table public.skill_ratings (
  user_id uuid not null references public.profiles (id) on delete cascade,
  sport text not null references public.sports (id),
  format_family public.format_family not null,
  r double precision not null,
  rd double precision not null check (rd > 0),
  sigma double precision not null check (sigma > 0),
  games int not null default 0 check (games >= 0),
  last_period text check (last_period is null or last_period ~ '^([0-9]{4}-W[0-9]{2}|P[0-9]+--?[0-9]+)$'),
  updated_at timestamptz not null default now(),
  primary key (user_id, sport, format_family)
);

-- Processed rating periods (job bookkeeping; service role only).
create table public.rating_periods (
  period text primary key,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  games_rated int not null default 0,
  games_not_rated int not null default 0,
  updates int not null default 0,
  processed_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

-- Audit of every update (RatingUpdate), idempotent by dedupe key.
create table public.rating_updates (
  dedupe_key text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  sport text not null references public.sports (id),
  format_family public.format_family not null,
  period text not null,
  r_before double precision not null,
  rd_before double precision not null,
  sigma_before double precision not null,
  r_after double precision not null,
  rd_after double precision not null,
  sigma_after double precision not null,
  games_added int not null,
  frozen boolean not null,
  created_at timestamptz not null default now()
);
create index rating_updates_user_idx on public.rating_updates (user_id, period);

-- GLK-003 outcome per considered game ("Not rated: too few verified players").
create table public.game_rating_status (
  game_id uuid primary key references public.games (id) on delete cascade,
  period text not null,
  eligible boolean not null,
  reason text check (reason is null or reason in ('no_result', 'result_not_confirmed', 'result_disputed', 'too_few_verified',
                                                  'teams_not_published', 'not_two_sides', 'unrated_sport')),
  format_family public.format_family,
  computed_at timestamptz not null default now(),
  check (eligible = (reason is null))
);

-- ---------------------------------------------------------------------------
-- Pure mirrors: Glicko-2 (rating/glicko2.ts)
-- ---------------------------------------------------------------------------
create function public.dm_round_half_up(p_x double precision, p_digits int) returns double precision
language sql immutable parallel safe set search_path = ''
as $$ select floor(p_x * (10::double precision ^ p_digits) + 0.5) / (10::double precision ^ p_digits) $$;

-- Math.exp without Postgres' underflow error (JS returns 0).
create function public.dm_exp(p_x double precision) returns double precision
language sql immutable parallel safe set search_path = ''
as $$ select case when p_x < -745 then 0::double precision else exp(p_x) end $$;

create function public.dm_glicko2_g(p_phi double precision) returns double precision
language sql immutable parallel safe set search_path = ''
as $$ select 1 / sqrt(1 + (3 * p_phi * p_phi) / (pi() * pi())) $$;

create function public.dm_glicko2_f(p_x double precision, p_a double precision, p_d2 double precision, p_p2 double precision,
                                    p_v double precision, p_tau double precision) returns double precision
language sql immutable parallel safe set search_path = ''
as $$
  select (public.dm_exp(p_x) * (p_d2 - p_p2 - p_v - public.dm_exp(p_x)))
           / (2 * (p_p2 + p_v + public.dm_exp(p_x)) * (p_p2 + p_v + public.dm_exp(p_x)))
         - (p_x - p_a) / (p_tau * p_tau)
$$;

-- Step 5: σ' by the Illinois algorithm (ε = 1e-6, ≤ 1000 iterations).
create function public.dm_glicko2_volatility(p_phi double precision, p_sigma double precision, p_v double precision,
                                             p_delta double precision, p_tau double precision) returns double precision
language plpgsql immutable parallel safe set search_path = ''
as $$
declare
  a double precision := ln(p_sigma * p_sigma);
  d2 double precision := p_delta * p_delta;
  p2 double precision := p_phi * p_phi;
  aa double precision := a;
  bb double precision;
  cc double precision;
  fa double precision;
  fb double precision;
  fc double precision;
  k int := 1;
  i int := 0;
begin
  if d2 > p2 + p_v then
    bb := ln(d2 - p2 - p_v);
  else
    while public.dm_glicko2_f(a - k * p_tau, a, d2, p2, p_v, p_tau) < 0 loop
      k := k + 1;
    end loop;
    bb := a - k * p_tau;
  end if;
  fa := public.dm_glicko2_f(aa, a, d2, p2, p_v, p_tau);
  fb := public.dm_glicko2_f(bb, a, d2, p2, p_v, p_tau);
  while i < 1000 and abs(bb - aa) > 0.000001 loop
    cc := aa + ((aa - bb) * fa) / (fb - fa);
    fc := public.dm_glicko2_f(cc, a, d2, p2, p_v, p_tau);
    if fc * fb <= 0 then
      aa := bb;
      fa := fb;
    else
      fa := fa / 2;
    end if;
    bb := cc;
    fb := fc;
    i := i + 1;
  end loop;
  return exp(aa / 2);
end $$;

-- inflateRd(): √(φ² + n·σ²) on the Glicko scale, capped at p_max_rd.
create function public.dm_inflate_rd(p_player jsonb, p_periods int, p_max_rd double precision) returns double precision
language sql immutable parallel safe set search_path = ''
as $$
  select case when p_periods <= 0 then (p_player ->> 'rd')::double precision
              else least(p_max_rd, sqrt(((p_player ->> 'rd')::double precision / 173.7178) ^ 2
                                        + p_periods * ((p_player ->> 'sigma')::double precision) ^ 2) * 173.7178) end
$$;

-- glicko2Update(player {r, rd, sigma}, results [{opponent {r, rd}, score}], tau, maxRd) → {r, rd, sigma}.
create function public.dm_glicko2_update(p_player jsonb, p_results jsonb, p_tau double precision,
                                         p_max_rd double precision default 'Infinity') returns jsonb
language plpgsql immutable parallel safe set search_path = ''
as $$
declare
  s constant double precision := 173.7178;
  mu double precision := ((p_player ->> 'r')::double precision - 1500) / s;
  phi double precision := (p_player ->> 'rd')::double precision / s;
  sig double precision := (p_player ->> 'sigma')::double precision;
  v_inv double precision := 0;
  total double precision := 0;
  res jsonb;
  mu_j double precision;
  g_j double precision;
  e double precision;
  v double precision;
  sigma_new double precision;
  phi_star double precision;
  phi_new double precision;
begin
  if p_results is null or jsonb_array_length(p_results) = 0 then
    return jsonb_build_object('r', (p_player ->> 'r')::double precision, 'rd', public.dm_inflate_rd(p_player, 1, p_max_rd), 'sigma', sig);
  end if;
  for res in select x from jsonb_array_elements(p_results) x loop
    mu_j := ((res #>> '{opponent,r}')::double precision - 1500) / s;
    g_j := public.dm_glicko2_g((res #>> '{opponent,rd}')::double precision / s);
    e := 1 / (1 + public.dm_exp(-g_j * (mu - mu_j)));
    v_inv := v_inv + g_j * g_j * e * (1 - e);
    total := total + g_j * ((res ->> 'score')::double precision - e);
  end loop;
  v := 1 / v_inv;
  sigma_new := public.dm_glicko2_volatility(phi, sig, v, v * total, p_tau);
  phi_star := sqrt(phi * phi + sigma_new * sigma_new);
  phi_new := 1 / sqrt(1 / (phi_star * phi_star) + 1 / v);
  return jsonb_build_object('r', s * (mu + phi_new * phi_new * total) + 1500, 'rd', least(p_max_rd, s * phi_new), 'sigma', sigma_new);
end $$;

-- teamComposite(): mean r, RMS RD, mean σ.
create function public.dm_team_composite(p_members jsonb) returns jsonb
language sql immutable parallel safe set search_path = ''
as $$
  select jsonb_build_object('r', avg((m ->> 'r')::double precision),
                            'rd', sqrt(avg(((m ->> 'rd')::double precision) ^ 2)),
                            'sigma', avg((m ->> 'sigma')::double precision))
  from jsonb_array_elements(p_members) m
$$;

create function public.dm_glicko_level(p_r double precision) returns double precision
language sql immutable parallel safe set search_path = ''
as $$ select public.dm_round_half_up(least(7, greatest(0, (p_r - 900) / 200)), 1) $$;

create function public.dm_is_provisional(p_games int, p_rd double precision, p_reliability double precision,
                                         p15 public.phase15_config) returns boolean
language sql immutable parallel safe set search_path = ''
as $$
  select not (p_reliability is not null and p_reliability >= p15.glicko_display_min_reliability
              and p_games >= p15.glicko_display_min_games and p_rd < p15.glicko_display_max_rd)
$$;

create function public.dm_is_frozen(p_reliability double precision, p15 public.phase15_config) returns boolean
language sql immutable parallel safe set search_path = ''
as $$ select p_reliability is not null and p_reliability < p15.glicko_freeze_below_reliability $$;

-- formatFamilyFor(sport, playersPerSide); null for unrated sports (running).
create function public.dm_format_family(p_sport text, p_per_side int) returns public.format_family
language sql immutable parallel safe set search_path = ''
as $$
  select case p_sport
           when 'football' then case when p_per_side <= 7 then 'small_sided' else 'full_sided' end
           when 'basketball' then case when p_per_side <= 3 then 'half_court' else 'full_court' end
           when 'tennis' then case when p_per_side <= 1 then 'singles' else 'doubles' end
           when 'padel' then case when p_per_side <= 1 then 'singles' else 'doubles' end
           when 'volleyball' then case when p_per_side <= 2 then 'pairs' else 'teams' end
         end::public.format_family
$$;

-- Rating periods: index from the Monday 1970-01-05T00:00Z origin; key = ISO week `YYYY-Www` for
-- 7-day periods, else `P<days>-<index>`.
create function public.dm_rating_period_index(p_at timestamptz, p_days int default 7) returns int
language sql immutable parallel safe set search_path = ''
as $$ select floor(extract(epoch from p_at - timestamptz '1970-01-05T00:00:00Z') / (p_days * 86400))::int $$;

create function public.dm_rating_period_start(p_index int, p_days int default 7) returns timestamptz
language sql immutable parallel safe set search_path = ''
as $$ select timestamptz '1970-01-05T00:00:00Z' + (p_index::bigint * p_days * 24) * interval '1 hour' $$;

create function public.dm_rating_period_key(p_index int, p_days int default 7) returns text
language sql immutable parallel safe set search_path = ''
as $$
  select case when p_days = 7 then to_char(public.dm_rating_period_start(p_index, 7) at time zone 'UTC', 'IYYY-"W"IW')
              else 'P' || p_days::text || '-' || p_index::text end
$$;

create function public.dm_parse_rating_period_key(p_key text, p_days int default 7) returns int
language plpgsql immutable parallel safe set search_path = ''
as $$
declare
  m text[];
  jan4 date;
  monday date;
begin
  if p_days = 7 then
    m := regexp_match(p_key, '^([0-9]{4})-W([0-9]{2})$');
    if m is null then raise exception 'Invalid period key: %', p_key; end if;
    jan4 := make_date(m[1]::int, 1, 4);
    monday := jan4 - (extract(isodow from jan4)::int - 1);
    return round(((monday + (m[2]::int - 1) * 7) - date '1970-01-05') / 7.0)::int;
  end if;
  m := regexp_match(p_key, '^P([0-9]+)-(-?[0-9]+)$');
  if m is null or m[1]::int <> p_days then raise exception 'Invalid period key: %', p_key; end if;
  return m[2]::int;
end $$;

-- processRatingPeriod(RatingPeriodInput) → { updates: RatingUpdate[], ratings: SkillRating[] }.
-- Groups by sport|family (code-unit order); all games of the period use the ratings at the start
-- of the period (idle periods inflate RD); frozen players keep their row and still count for
-- opponents; players already processed for this period (lastPeriod ≥ period) are skipped.
create function public.dm_process_rating_period(p_input jsonb, p15 public.phase15_config, p_now timestamptz) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  days int := p15.glicko_rating_period_days;
  period text := p_input ->> 'period';
  pidx int := public.dm_parse_rating_period_key(p_input ->> 'period', p15.glicko_rating_period_days);
  init jsonb := jsonb_build_object('r', p15.glicko_initial_rating::double precision, 'rd', p15.glicko_initial_rd::double precision,
                                   'sigma', p15.glicko_initial_sigma::double precision);
  max_rd double precision := p15.glicko_initial_rd::double precision;
  grp record;
  gm jsonb;
  team jsonb;
  u text;
  i int;
  j int;
  row_ jsonb;
  last int;
  start jsonb;
  skip jsonb;
  results jsonb;
  played jsonb;
  composites jsonb;
  members jsonb;
  diff double precision;
  stored jsonb;
  rel jsonb;
  after jsonb;
  n_games int;
  dedupe text;
  updates jsonb := '[]'::jsonb;
  ratings jsonb := '[]'::jsonb;
  rows_ jsonb := '{}'::jsonb;
begin
  select coalesce(jsonb_object_agg((x ->> 'sport') || '|' || (x ->> 'formatFamily') || '|' || (x ->> 'userId'), x), '{}'::jsonb)
    into rows_ from jsonb_array_elements(coalesce(p_input -> 'ratings', '[]'::jsonb)) x;
  for grp in
    select (x ->> 'sport') as sport, (x ->> 'formatFamily') as fam,
           jsonb_agg(x order by o) as games
    from jsonb_array_elements(coalesce(p_input -> 'games', '[]'::jsonb)) with ordinality as t(x, o)
    group by 1, 2
    order by ((x ->> 'sport') || '|' || (x ->> 'formatFamily')) collate "C"
  loop
    start := '{}'::jsonb;
    skip := '{}'::jsonb;
    results := '{}'::jsonb;
    played := '{}'::jsonb;
    -- Start-of-period params of every player of the group (paramsOf).
    for u in select distinct m #>> '{}' from jsonb_array_elements(grp.games) g, jsonb_array_elements(g -> 'teams') tm,
                    jsonb_array_elements(tm) m loop
      row_ := rows_ -> (grp.sport || '|' || grp.fam || '|' || u);
      if row_ is null then
        start := start || jsonb_build_object(u, init);
      else
        last := case when row_ ->> 'lastPeriod' is null then null else public.dm_parse_rating_period_key(row_ ->> 'lastPeriod', days) end;
        if last is not null and last >= pidx then skip := skip || jsonb_build_object(u, true); end if;
        start := start || jsonb_build_object(u, jsonb_build_object(
          'r', (row_ ->> 'r')::double precision,
          'rd', public.dm_inflate_rd(row_, case when last is null then 0 else pidx - last - 1 end, max_rd),
          'sigma', (row_ ->> 'sigma')::double precision));
      end if;
    end loop;
    for gm in select x from jsonb_array_elements(grp.games) x loop
      if jsonb_array_length(gm -> 'teams') <> jsonb_array_length(gm -> 'teamScores') then
        raise exception 'teams/scores mismatch in %', gm ->> 'gameId';
      end if;
      composites := '[]'::jsonb;
      for team in select x from jsonb_array_elements(gm -> 'teams') x loop
        select coalesce(jsonb_agg(start -> (m #>> '{}') order by o), '[]'::jsonb) into members
        from jsonb_array_elements(team) with ordinality as t(m, o);
        if jsonb_array_length(members) = 0 then raise exception 'empty team'; end if;
        composites := composites || jsonb_build_array(public.dm_team_composite(members));
      end loop;
      for i in 0 .. jsonb_array_length(gm -> 'teams') - 1 loop
        for u in select m #>> '{}' from jsonb_array_elements(gm -> 'teams' -> i) m loop
          played := played || jsonb_build_object(u, coalesce((played ->> u)::int, 0) + 1);
          for j in 0 .. jsonb_array_length(gm -> 'teams') - 1 loop
            continue when j = i;
            diff := (gm -> 'teamScores' ->> i)::double precision - (gm -> 'teamScores' ->> j)::double precision;
            results := results || jsonb_build_object(u, coalesce(results -> u, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
              'opponent', composites -> j, 'score', case when diff > 0 then 1 when diff < 0 then 0 else 0.5 end)));
          end loop;
        end loop;
      end loop;
    end loop;
    for u in select k from jsonb_object_keys(results) k order by k collate "C" loop
      continue when skip ? u;
      row_ := rows_ -> (grp.sport || '|' || grp.fam || '|' || u);
      stored := case when row_ is null then init
                     else jsonb_build_object('r', (row_ ->> 'r')::double precision, 'rd', (row_ ->> 'rd')::double precision,
                                             'sigma', (row_ ->> 'sigma')::double precision) end;
      rel := p_input -> 'reliability' -> u;
      dedupe := 'rating:' || u || ':' || grp.sport || ':' || grp.fam || ':' || period;
      if public.dm_is_frozen(case when rel is null or jsonb_typeof(rel) = 'null' then null else (rel #>> '{}')::double precision end, p15) then
        updates := updates || jsonb_build_array(jsonb_build_object(
          'userId', u, 'sport', grp.sport, 'formatFamily', grp.fam, 'period', period, 'before', stored, 'after', stored,
          'gamesAdded', 0, 'frozen', true, 'dedupeKey', dedupe));
        continue;
      end if;
      after := public.dm_glicko2_update(start -> u, results -> u, p15.glicko_tau::double precision, max_rd);
      n_games := coalesce((row_ ->> 'games')::int, 0) + (played ->> u)::int;
      updates := updates || jsonb_build_array(jsonb_build_object(
        'userId', u, 'sport', grp.sport, 'formatFamily', grp.fam, 'period', period, 'before', stored, 'after', after,
        'gamesAdded', (played ->> u)::int, 'frozen', false, 'dedupeKey', dedupe));
      ratings := ratings || jsonb_build_array(jsonb_build_object(
        'userId', u, 'sport', grp.sport, 'formatFamily', grp.fam,
        'r', after -> 'r', 'rd', after -> 'rd', 'sigma', after -> 'sigma', 'games', n_games,
        'provisional', public.dm_is_provisional(n_games, (after ->> 'rd')::double precision,
                                                case when rel is null or jsonb_typeof(rel) = 'null' then null else (rel #>> '{}')::double precision end, p15),
        'level', public.dm_glicko_level((after ->> 'r')::double precision),
        'lastPeriod', period, 'updatedAt', public.dm_iso(p_now)));
    end loop;
  end loop;
  return jsonb_build_object('updates', updates, 'ratings', ratings);
end $$;

-- currentSkillRating(row, reliability, now): RD inflated for idle periods; provisional and level.
create function public.dm_current_skill_rating(p_row jsonb, p_reliability double precision, p15 public.phase15_config,
                                               p_now timestamptz) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  days int := p15.glicko_rating_period_days;
  idle int := case when p_row ->> 'lastPeriod' is null then 0
                   else public.dm_rating_period_index(p_now, days) - public.dm_parse_rating_period_key(p_row ->> 'lastPeriod', days) - 1 end;
  rd double precision := public.dm_inflate_rd(p_row, idle, p15.glicko_initial_rd::double precision);
begin
  return p_row || jsonb_build_object('rd', rd,
    'provisional', public.dm_is_provisional((p_row ->> 'games')::int, rd, p_reliability, p15),
    'level', public.dm_glicko_level((p_row ->> 'r')::double precision));
end $$;

-- ---------------------------------------------------------------------------
-- Pure mirrors: result confirmation and game eligibility (rating/result.ts)
-- ---------------------------------------------------------------------------

-- summarizeResultConfirmations(input, viewerId?) → ResultConfirmationSummary.
create function public.dm_result_summary(p_input jsonb, p_viewer text default null) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  verified jsonb := coalesce(p_input -> 'verifiedUserIds', '[]'::jsonb);
  n int;
  latest jsonb := '{}'::jsonb;
  c jsonb;
  confirms int := 0;
  disputes int := 0;
  k text;
begin
  select count(distinct x #>> '{}') into n from jsonb_array_elements(verified) x;
  for c in select x from jsonb_array_elements(coalesce(p_input -> 'confirmations', '[]'::jsonb)) x loop
    continue when not (verified @> jsonb_build_array(c ->> 'userId'));
    if latest -> (c ->> 'userId') is null or (c ->> 'createdAt') collate "C" >= (latest #>> array[c ->> 'userId', 'createdAt']) collate "C" then
      latest := latest || jsonb_build_object(c ->> 'userId', c);
    end if;
  end loop;
  if verified @> jsonb_build_array(p_input ->> 'submittedBy') and latest -> (p_input ->> 'submittedBy') is null then
    latest := latest || jsonb_build_object(p_input ->> 'submittedBy', jsonb_build_object('verdict', 'confirm'));
  end if;
  for k in select jsonb_object_keys(latest) loop
    if latest #>> array[k, 'verdict'] = 'confirm' then confirms := confirms + 1; else disputes := disputes + 1; end if;
  end loop;
  return jsonb_build_object('gameId', p_input ->> 'gameId',
    'status', case when disputes * 2 > n then 'disputed' when confirms * 2 > n then 'confirmed' else 'pending' end,
    'confirms', confirms, 'disputes', disputes, 'verifiedCount', n,
    'myVerdict', case when p_viewer is null then null else latest #>> array[p_viewer, 'verdict'] end);
end $$;

-- gameRatingEligibility(GameRatingInput) → GameRatingEligibility (first failing check wins).
create function public.dm_game_rating_eligibility(p_input jsonb, p15 public.phase15_config) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  approved int := (p_input ->> 'approvedCount')::int;
  verified int := (p_input ->> 'verifiedCount')::int;
  teams jsonb := coalesce(p_input -> 'teams', '[]'::jsonb);
  reason text;
begin
  reason := case
    when public.dm_format_family(p_input ->> 'sport', 1) is null then 'unrated_sport'
    when p_input -> 'teamScores' is null or jsonb_typeof(p_input -> 'teamScores') = 'null' then 'no_result'
    when approved <= 0 or verified::double precision / approved < p15.glicko_min_verified_ratio then 'too_few_verified'
    when p_input ->> 'teamsPublishedAt' is null or public.dm_ts(p_input ->> 'teamsPublishedAt') > public.dm_ts(p_input ->> 'startsAt')
      then 'teams_not_published'
    when jsonb_array_length(teams) < 2 or exists (select 1 from jsonb_array_elements(teams) t where jsonb_array_length(t) = 0)
         or jsonb_array_length(p_input -> 'teamScores') <> jsonb_array_length(teams) then 'not_two_sides'
    when p_input ->> 'resultStatus' = 'disputed' then 'result_disputed'
    when p_input ->> 'resultStatus' <> 'confirmed' then 'result_not_confirmed'
  end;
  return jsonb_build_object('eligible', reason is null, 'reason', reason);
end $$;

-- ---------------------------------------------------------------------------
-- Pure mirrors: peer ratings (rating/peer.ts)
-- ---------------------------------------------------------------------------

-- peerRatingEligibility(PeerEligibilityInput, now) → RatingEligibility.
create function public.dm_peer_rating_eligibility(p_input jsonb, p15 public.phase15_config, p_now timestamptz) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  rater jsonb := p_input -> 'rater';
  me text := p_input #>> '{rater,userId}';
  ends timestamptz := public.dm_ts(p_input #>> '{game,endsAt}');
  closes timestamptz := public.dm_ts(p_input #>> '{game,endsAt}') + p15.peer_rating_window_hours * interval '1 hour';
  reasons text[] := '{}';
  remaining int;
  can boolean;
  rateable jsonb;
begin
  if not coalesce((rater ->> 'verifiedInGame')::boolean, false) then reasons := array_append(reasons, 'not_verified'); end if;
  if rater -> 'reliability' is null or jsonb_typeof(rater -> 'reliability') = 'null'
     or (rater ->> 'reliability')::double precision < p15.peer_rater_min_reliability then
    reasons := array_append(reasons, 'low_reliability');
  end if;
  if (rater ->> 'verifiedGamesInSport')::int < p15.peer_rater_min_verified_games then reasons := array_append(reasons, 'too_few_games'); end if;
  if coalesce((rater ->> 'hasActiveSanction')::boolean, false) then reasons := array_append(reasons, 'active_sanction'); end if;
  if p_now < ends then reasons := array_append(reasons, 'window_not_open'); end if;
  if p_now > closes then reasons := array_append(reasons, 'window_closed'); end if;
  remaining := greatest(0, p15.peer_rating_max_ratees - jsonb_array_length(coalesce(p_input -> 'alreadyRated', '[]'::jsonb)));
  can := cardinality(reasons) = 0 and remaining > 0;
  select coalesce(jsonb_agg(u order by u collate "C"), '[]'::jsonb) into rateable
  from (select distinct x #>> '{}' as u from jsonb_array_elements(coalesce(p_input -> 'verifiedUserIds', '[]'::jsonb)) x) v
  where can and v.u <> me
    and not exists (select 1 from jsonb_array_elements(coalesce(p_input -> 'blocks', '[]'::jsonb)) b
                    where (b ->> 'blockerId' = me and b ->> 'blockedId' = v.u) or (b ->> 'blockedId' = me and b ->> 'blockerId' = v.u))
    and not (coalesce(p_input -> 'alreadyRated', '[]'::jsonb) @> jsonb_build_array(v.u));
  return jsonb_build_object('canRate', can, 'reasons', to_jsonb(reasons),
    'verifiedGamesInSport', (rater ->> 'verifiedGamesInSport')::int, 'requiredGames', p15.peer_rater_min_verified_games,
    'windowClosesAt', public.dm_iso(closes), 'remainingRatees', remaining, 'rateableUserIds', rateable);
end $$;

-- validatePeerRatings(eligibility, sport, inputs) → Result<true, ErrorCode> as {ok, value|error}.
create function public.dm_validate_peer_ratings(p_elig jsonb, p_sport text, p_inputs jsonb) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  allowed text[];
  i jsonb;
  e record;
begin
  if p_elig -> 'reasons' ? 'window_closed' or p_elig -> 'reasons' ? 'window_not_open' then
    return jsonb_build_object('ok', false, 'error', 'outside_window');
  end if;
  if not (p_elig ->> 'canRate')::boolean then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_inputs is null or jsonb_typeof(p_inputs) <> 'array' or jsonb_array_length(p_inputs) = 0
     or jsonb_array_length(p_inputs) > (p_elig ->> 'remainingRatees')::int then
    return jsonb_build_object('ok', false, 'error', 'validation');
  end if;
  if (select count(distinct x ->> 'rateeId') from jsonb_array_elements(p_inputs) x) <> jsonb_array_length(p_inputs) then
    return jsonb_build_object('ok', false, 'error', 'validation');
  end if;
  select s.player_rating_attributes into allowed from public.sports s where s.id = p_sport;
  for i in select x from jsonb_array_elements(p_inputs) x loop
    if not coalesce(p_elig -> 'rateableUserIds' @> jsonb_build_array(i ->> 'rateeId'), false) then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;
    if i -> 'scores' is null or jsonb_typeof(i -> 'scores') <> 'object' or i -> 'scores' = '{}'::jsonb then
      return jsonb_build_object('ok', false, 'error', 'validation');
    end if;
    for e in select * from jsonb_each(i -> 'scores') loop
      if not (e.key = any (coalesce(allowed, '{}'))) or jsonb_typeof(e.value) <> 'number'
         or (e.value #>> '{}') !~ '^[1-5]$' then
        return jsonb_build_object('ok', false, 'error', 'validation');
      end if;
    end loop;
  end loop;
  return jsonb_build_object('ok', true, 'value', true);
end $$;

-- selfPriorFrom(selfSkill, attributes {speed, control, overall}) → SelfPrior.
create function public.dm_self_prior(p_self_skill int, p_attributes jsonb) returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object('selfSkill', p_self_skill, 'attributes', coalesce((
    select jsonb_object_agg(m.k, (coalesce(p_attributes, '{}'::jsonb) ->> m.src)::double precision)
    from (values ('overall', 'overall'), ('speed', 'speed'), ('pace', 'speed'), ('athleticism', 'speed'), ('movement', 'speed'),
                 ('ball_control', 'control'), ('handling', 'control')) m(k, src)
    where coalesce(p_attributes, '{}'::jsonb) ->> m.src is not null), '{}'::jsonb))
$$;

create function public.dm_all_max(p_scores jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select exists (select 1 from jsonb_each(p_scores)) and not exists (
    select 1 from jsonb_each(p_scores) e where jsonb_typeof(e.value) <> 'number' or (e.value #>> '{}')::double precision <> 5)
$$;

-- peerRatingWeights(input) → number[] aligned with input.received (RATE-003).
create function public.dm_peer_rating_weights(p_input jsonb, p15 public.phase15_config) returns jsonb
language sql immutable set search_path = ''
as $$
  with rec as (
    select x, o, public.dm_ts(x ->> 'createdAt') as t
    from jsonb_array_elements(coalesce(p_input -> 'received', '[]'::jsonb)) with ordinality as a(x, o)
  )
  select coalesce(jsonb_agg(w.weight order by r.o), '[]'::jsonb)
  from rec r
  cross join lateral (
    select (p15.peer_pair_decay_factor::double precision ^ greatest(0, (
              select count(*) from rec q
              where q.x ->> 'raterId' = r.x ->> 'raterId' and q.t <= r.t
                and q.t > r.t - p15.peer_pair_decay_window_days * interval '24 hours'
                and (q.t < r.t or q.o <= r.o)) - p15.peer_pair_decay_after))
           * case when public.dm_all_max(r.x -> 'scores') and exists (
                    select 1 from jsonb_array_elements(coalesce(p_input -> 'given', '[]'::jsonb)) g
                    where g ->> 'rateeId' = r.x ->> 'raterId' and public.dm_all_max(g -> 'scores')
                      and abs(extract(epoch from public.dm_ts(g ->> 'createdAt') - r.t))
                          <= p15.peer_pair_decay_window_days * 86400)
                  then p15.peer_reciprocal_weight::double precision else 1 end as weight
  ) w
$$;

-- aggregatePeerRatings(PeerAggregateInput) → PeerSkillSummary (RATE-004): per attribute, weighted
-- samples (decay × reciprocity), one-pass trimming beyond peerOutlierSigma weighted SDs, then the
-- Bayesian mean with the self prior (weight peerSelfPriorWeight); means/weights rounded to 4 dp.
create function public.dm_aggregate_peer_ratings(p_input jsonb, p15 public.phase15_config) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  weights jsonb := public.dm_peer_rating_weights(p_input, p15);
  attrs text[];
  attr text;
  prior double precision;
  ew double precision;
  total double precision;
  used int;
  kept_raters text[];
  out_attrs jsonb := '{}'::jsonb;
  raters text[] := '{}';
  overall double precision;
  w0 double precision := p15.peer_self_prior_weight::double precision;
  sig double precision := p15.peer_outlier_sigma::double precision;
begin
  select s.player_rating_attributes into attrs from public.sports s where s.id = p_input ->> 'sport';
  foreach attr in array coalesce(attrs, '{}') loop
    prior := coalesce((p_input #>> array['self', 'attributes', attr])::double precision, (p_input #>> '{self,selfSkill}')::double precision);
    with smp as (
      select (r.x -> 'scores' ->> attr)::double precision as x, (weights ->> (r.o - 1)::int)::double precision as w,
             r.x ->> 'raterId' as rater
      from jsonb_array_elements(coalesce(p_input -> 'received', '[]'::jsonb)) with ordinality as r(x, o)
      where r.x -> 'scores' ->> attr is not null and (weights ->> (r.o - 1)::int)::double precision > 0
    ), m as (
      select sum(smp.w) as wt, sum(smp.w * smp.x) / nullif(sum(smp.w), 0) as mean from smp
    ), d as (
      select sqrt(sum(smp.w * (smp.x - m.mean) ^ 2) / m.wt) as sd from smp, m group by m.wt
    ), kept as (
      select smp.* from smp cross join m left join d on true
      where d.sd is null or not (d.sd > 0) or abs(smp.x - m.mean) <= sig * d.sd + 1e-12
    )
    select coalesce(sum(kept.w), 0), coalesce(sum(kept.w * kept.x), 0), count(*), coalesce(array_agg(kept.rater), '{}')
      into ew, total, used, kept_raters
    from kept;
    raters := raters || kept_raters;
    out_attrs := out_attrs || jsonb_build_object(attr, jsonb_build_object(
      'mean', public.dm_round_half_up((w0 * prior + total) / (w0 + ew), 4),
      'evidenceWeight', public.dm_round_half_up(ew, 4), 'ratingsUsed', used));
  end loop;
  overall := (out_attrs #>> '{overall,mean}')::double precision;
  return jsonb_build_object('userId', p_input ->> 'userId', 'sport', p_input ->> 'sport', 'attributes', out_attrs,
    'band', least(5, greatest(1, floor(overall + 0.5)))::int,
    'raterCount', (select count(distinct x) from unnest(raters) x));
end $$;

-- ---------------------------------------------------------------------------
-- Row builders (DB → mirror input)
-- ---------------------------------------------------------------------------

-- Verified attendees of a game (the GAME-071 electorate and RATE-001 co-players).
create function public.st_verified_ids(p_game_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(gp.user_id order by gp.user_id::text collate "C"), '[]'::jsonb)
  from public.game_participants gp
  where gp.game_id = p_game_id and gp.status = 'approved' and gp.attendance = 'verified'
$$;

create function public.st_result_summary(p_game_id uuid, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select public.dm_result_summary(jsonb_build_object(
      'gameId', gr.game_id, 'submittedBy', gr.submitted_by, 'verifiedUserIds', public.st_verified_ids(gr.game_id),
      'confirmations', (select coalesce(jsonb_agg(jsonb_build_object('gameId', c.game_id, 'userId', c.user_id, 'verdict', c.verdict,
                                                                    'createdAt', public.dm_iso(c.created_at))
                                                  order by c.created_at, c.user_id), '[]'::jsonb)
                        from public.result_confirmations c where c.game_id = gr.game_id)),
    p_viewer::text)
  from public.game_results gr where gr.game_id = p_game_id
$$;

-- Players per side of the planned format: ⌈capacity / team_count⌉ (GLK-001 format family).
create function public.st_game_format_family(g public.games) returns public.format_family
language sql immutable set search_path = ''
as $$ select public.dm_format_family(g.sport, ceil(g.capacity::numeric / greatest(g.team_count, 1))::int) $$;

-- Verified players per side (team index order) as published.
create function public.st_game_teams(p_game_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(t.members order by t.team), '[]'::jsonb)
  from (
    select s.team, coalesce((select jsonb_agg(gp.user_id order by gp.user_id::text collate "C") from public.game_participants gp
                             where gp.game_id = g.id and gp.team = s.team and gp.status = 'approved'
                               and gp.attendance = 'verified'), '[]'::jsonb) as members
    from public.games g cross join lateral generate_series(0, g.team_count - 1) s(team)
    where g.id = p_game_id
  ) t
$$;

-- GLK-003 for a stored game.
create function public.st_game_rating_eligibility(p_game_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select public.dm_game_rating_eligibility(jsonb_build_object(
      'sport', g.sport, 'startsAt', public.dm_iso(g.starts_at),
      'teamScores', (select to_jsonb(gr.team_scores) from public.game_results gr where gr.game_id = g.id),
      'resultStatus', coalesce(public.st_result_summary(g.id, null) ->> 'status', 'pending'),
      'approvedCount', (select count(*) from public.game_participants gp where gp.game_id = g.id and gp.status = 'approved'),
      'verifiedCount', (select count(*) from public.game_participants gp where gp.game_id = g.id and gp.status = 'approved'
                          and gp.attendance = 'verified'),
      'teamsPublishedAt', public.dm_iso(g.teams_published_at),
      'teams', public.st_game_teams(g.id)), public.st_p15())
  from public.games g where g.id = p_game_id
$$;

-- RaterContext + PeerEligibilityInput for (game, rater).
create function public.st_peer_eligibility(p_game_id uuid, p_uid uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select public.dm_peer_rating_eligibility(jsonb_build_object(
      'game', jsonb_build_object('endsAt', public.dm_iso(g.ends_at)),
      'rater', jsonb_build_object(
        'userId', p_uid,
        'reliability', (select p.reliability_score from public.profiles p where p.id = p_uid),
        'verifiedGamesInSport', (select count(*) from public.game_participants gp join public.games x on x.id = gp.game_id
                                 where gp.user_id = p_uid and x.sport = g.sport and gp.status = 'approved'
                                   and gp.attendance = 'verified'),
        'hasActiveSanction', exists (select 1 from public.sanctions s where s.user_id = p_uid and public.st_sanction_in_force(s, p_now)),
        'verifiedInGame', exists (select 1 from public.game_participants gp where gp.game_id = g.id and gp.user_id = p_uid
                                    and gp.status = 'approved' and gp.attendance = 'verified')),
      'verifiedUserIds', public.st_verified_ids(g.id),
      'blocks', (select coalesce(jsonb_agg(jsonb_build_object('blockerId', b.blocker_id, 'blockedId', b.blocked_id)), '[]'::jsonb)
                 from public.blocks b where b.blocker_id = p_uid or b.blocked_id = p_uid),
      'alreadyRated', (select coalesce(jsonb_agg(pr.ratee_id), '[]'::jsonb) from public.peer_ratings pr
                       where pr.game_id = g.id and pr.rater_id = p_uid)),
    public.st_p15(), p_now)
  from public.games g where g.id = p_game_id
$$;

-- PeerAggregateInput for (user, sport) from rows.
create function public.st_peer_summary(p_uid uuid, p_sport text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select public.dm_aggregate_peer_ratings(jsonb_build_object(
      'userId', p_uid, 'sport', p_sport,
      'self', public.dm_self_prior(coalesce(us.self_skill, 3), us.attributes),
      'received', (select coalesce(jsonb_agg(jsonb_build_object('gameId', pr.game_id, 'sport', pr.sport, 'raterId', pr.rater_id,
                                                               'rateeId', pr.ratee_id, 'scores', pr.scores,
                                                               'createdAt', public.dm_iso(pr.created_at))
                                             order by pr.created_at, pr.game_id, pr.rater_id), '[]'::jsonb)
                   from public.peer_ratings pr
                   where pr.ratee_id = p_uid and pr.sport = p_sport
                     and not exists (select 1 from public.profiles p where p.id = pr.rater_id and p.deleted_at is not null)),
      'given', (select coalesce(jsonb_agg(jsonb_build_object('gameId', pr.game_id, 'sport', pr.sport, 'raterId', pr.rater_id,
                                                            'rateeId', pr.ratee_id, 'scores', pr.scores,
                                                            'createdAt', public.dm_iso(pr.created_at))
                                          order by pr.created_at, pr.game_id, pr.ratee_id), '[]'::jsonb)
                from public.peer_ratings pr where pr.rater_id = p_uid and pr.sport = p_sport)),
    public.st_p15())
  from (select 1) one
  left join public.user_sports us on us.user_id = p_uid and us.sport = p_sport
$$;

-- ---------------------------------------------------------------------------
-- Client RPCs
-- ---------------------------------------------------------------------------

-- save_teams stamps teams_published_at (GLK-003 "teams published before kickoff").
create or replace function public.save_teams(p_game_id uuid, p_assignments jsonb)
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
  update public.games x set teams_published_at = public.st_now() where x.id = g.id;
  return query select * from public.participant_views pv where pv.game_id = g.id order by pv.requested_at, pv.user_id;
end $$;

-- confirmResult (GAME-071): verified participants confirm or dispute the submitted result, once
-- per user (changeable until endsAt + peerRatingWindowHours). Returns ResultConfirmationSummary.
create function public.confirm_result(p_game_id uuid, p_verdict public.result_verdict) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  t timestamptz := public.st_now();
  g public.games;
begin
  if p_verdict is null then perform public.st_raise('validation'); end if;
  select * into g from public.games x where x.id = p_game_id;
  if g.id is null or not public.st_can_see_game(g.id, uid) then perform public.st_raise('not_found'); end if;
  if not exists (select 1 from public.game_results gr where gr.game_id = g.id) then perform public.st_raise('not_found', 'no result'); end if;
  if not exists (select 1 from public.game_participants gp where gp.game_id = g.id and gp.user_id = uid
                   and gp.status = 'approved' and gp.attendance = 'verified') then
    perform public.st_raise('forbidden', 'not a verified participant');
  end if;
  if t < g.ends_at or t > g.ends_at + (public.st_p15()).peer_rating_window_hours * interval '1 hour' then
    perform public.st_raise('outside_window');
  end if;
  insert into public.result_confirmations as c (game_id, user_id, verdict, created_at) values (g.id, uid, p_verdict, t)
  on conflict (game_id, user_id) do update set verdict = excluded.verdict, created_at = excluded.created_at;
  return public.st_result_summary(g.id, uid);
end $$;

-- getResultConfirmation: summary for anyone who can see the game, or null without a result.
create function public.result_confirmation(p_game_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := public.st_uid();
begin
  if not public.st_can_see_game(p_game_id, uid) then return null; end if;
  return public.st_result_summary(p_game_id, uid);
end $$;

-- getGameRatingStatus (GLK-003): the stored outcome once the period ran, else the live check.
create function public.game_rating_status(p_game_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  s public.game_rating_status;
begin
  if not public.st_can_see_game(p_game_id, uid) then perform public.st_raise('not_found'); end if;
  select * into s from public.game_rating_status x where x.game_id = p_game_id;
  if s.game_id is not null then return jsonb_build_object('eligible', s.eligible, 'reason', s.reason); end if;
  return public.st_game_rating_eligibility(p_game_id);
end $$;

-- getRatingEligibility (RATE-001/002, AC-RATE-002).
create function public.rating_eligibility(p_game_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := public.st_uid();
begin
  if not public.st_can_see_game(p_game_id, uid) then perform public.st_raise('not_found'); end if;
  return public.st_peer_eligibility(p_game_id, uid, public.st_now());
end $$;

-- submitPeerRatings: rejects forbidden (gates: not verified, reliability < 80 %, < 5 verified games
-- in the sport, active sanction; or a ratee not rateable: self, blocked pair, not verified, already
-- rated), outside_window (before endsAt or after endsAt + 48h), validation (> remaining ratees,
-- duplicates, unknown attribute, score not 1–5). Ineligibility reasons are in the error detail.
create function public.submit_peer_ratings(p_game_id uuid, p_ratings jsonb) returns setof public.peer_ratings
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles := public.st_active_profile();
  t timestamptz := public.st_now();
  g public.games;
  elig jsonb;
  res jsonb;
  i jsonb;
begin
  select * into g from public.games x where x.id = p_game_id;
  if g.id is null or not public.st_can_see_game(g.id, me.id) then perform public.st_raise('not_found'); end if;
  if g.status = 'cancelled' then perform public.st_raise('game_not_open'); end if;
  elig := public.st_peer_eligibility(g.id, me.id, t);
  res := public.dm_validate_peer_ratings(elig, g.sport, p_ratings);
  if not (res ->> 'ok')::boolean then
    perform public.st_raise(res ->> 'error', (select string_agg(x, ',') from jsonb_array_elements_text(elig -> 'reasons') x));
  end if;
  for i in select x from jsonb_array_elements(p_ratings) x loop
    insert into public.peer_ratings (game_id, rater_id, ratee_id, sport, scores, created_at)
    values (g.id, me.id, (i ->> 'rateeId')::uuid, g.sport, i -> 'scores', t);
  end loop;
  return query select * from public.peer_ratings pr where pr.game_id = g.id and pr.rater_id = me.id
               order by pr.created_at, pr.ratee_id;
end $$;

-- getMyPeerSummary (RATE-004): private to the player; null without received ratings.
create function public.my_peer_summary(p_sport text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := public.st_uid();
begin
  if not exists (select 1 from public.peer_ratings pr where pr.ratee_id = uid and pr.sport = p_sport) then return null; end if;
  return public.st_peer_summary(uid, p_sport);
end $$;

-- getSkillBands: host only; 1–5 band per approved participant (never the detail, never public).
create function public.game_skill_bands(p_game_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  g public.games;
begin
  select * into g from public.games x where x.id = p_game_id;
  if g.id is null then perform public.st_raise('not_found'); end if;
  if g.host_id <> uid then perform public.st_raise('forbidden'); end if;
  return (select coalesce(jsonb_object_agg(gp.user_id, (public.st_peer_summary(gp.user_id, g.sport) ->> 'band')::int), '{}'::jsonb)
          from public.game_participants gp
          where gp.game_id = g.id and gp.status = 'approved'
            and (exists (select 1 from public.user_sports us where us.user_id = gp.user_id and us.sport = g.sport)
                 or exists (select 1 from public.peer_ratings pr where pr.ratee_id = gp.user_id and pr.sport = g.sport)));
end $$;

-- listMySkillRatings: the caller's ratings as of now (currentSkillRating), plus `frozen` (GLK-004
-- "Improve reliability to 70 % to earn rating").
create function public.my_skill_ratings() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  p15 public.phase15_config := public.st_p15();
  rel double precision;
begin
  select p.reliability_score into rel from public.profiles p where p.id = uid;
  return (select coalesce(jsonb_agg(public.dm_current_skill_rating(jsonb_build_object(
              'userId', s.user_id, 'sport', s.sport, 'formatFamily', s.format_family, 'r', s.r, 'rd', s.rd, 'sigma', s.sigma,
              'games', s.games, 'lastPeriod', s.last_period, 'updatedAt', public.dm_iso(s.updated_at)), rel, p15, public.st_now())
            || jsonb_build_object('frozen', public.dm_is_frozen(rel, p15))
            order by s.sport, s.format_family), '[]'::jsonb)
          from public.skill_ratings s where s.user_id = uid);
end $$;

-- ---------------------------------------------------------------------------
-- Job: run_rating_period() (GLK-001..004)
-- ---------------------------------------------------------------------------

-- Processes every weekly period that ended at least peerRatingWindowHours ago (the GAME-071
-- confirmation window) and was not processed yet, oldest first (at most 8 per run). Considers
-- finalised games (completed, happened) that ended inside the period; records the GLK-003 outcome
-- of each in game_rating_status; applies processRatingPeriod to the eligible ones (frozen players
-- keep their rating and count for opponents). Idempotent. Returns the number of rating updates.
create function public.run_rating_period() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  p15 public.phase15_config := public.st_p15();
  days int := p15.glicko_rating_period_days;
  last_done int;
  idx int;
  pstart timestamptz;
  pend timestamptz;
  pkey text;
  g public.games;
  elig jsonb;
  rated jsonb;
  res jsonb;
  x jsonb;
  n int := 0;
  n_rated int;
  n_not int;
  runs int := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('st:run_rating_period')) then return 0; end if;
  select max(public.dm_parse_rating_period_key(rp.period, days)) into last_done from public.rating_periods rp;
  idx := coalesce(last_done + 1,
                  public.dm_rating_period_index(coalesce((select min(x.ends_at) from public.games x where x.status = 'completed'), t), days));
  loop
    pstart := public.dm_rating_period_start(idx, days);
    pend := public.dm_rating_period_start(idx + 1, days);
    exit when pend + p15.peer_rating_window_hours * interval '1 hour' > t or runs >= 8;
    pkey := public.dm_rating_period_key(idx, days);
    rated := '[]'::jsonb;
    n_rated := 0;
    n_not := 0;
    for g in select x.* from public.games x
             where x.status = 'completed' and coalesce(x.happened, false) and x.ends_at >= pstart and x.ends_at < pend
               and not exists (select 1 from public.game_rating_status s where s.game_id = x.id)
             order by x.ends_at, x.id loop
      elig := public.st_game_rating_eligibility(g.id);
      insert into public.game_rating_status (game_id, period, eligible, reason, format_family, computed_at)
      values (g.id, pkey, (elig ->> 'eligible')::boolean, elig ->> 'reason', public.st_game_format_family(g), t);
      if (elig ->> 'eligible')::boolean then
        n_rated := n_rated + 1;
        rated := rated || jsonb_build_array(jsonb_build_object(
          'gameId', g.id, 'sport', g.sport, 'formatFamily', public.st_game_format_family(g), 'endsAt', public.dm_iso(g.ends_at),
          'teams', public.st_game_teams(g.id),
          'teamScores', (select to_jsonb(gr.team_scores) from public.game_results gr where gr.game_id = g.id)));
      else
        n_not := n_not + 1;
      end if;
    end loop;
    if jsonb_array_length(rated) > 0 then
      res := public.dm_process_rating_period(jsonb_build_object(
          'period', pkey, 'games', rated,
          'ratings', (select coalesce(jsonb_agg(jsonb_build_object('userId', s.user_id, 'sport', s.sport, 'formatFamily', s.format_family,
                                                                   'r', s.r, 'rd', s.rd, 'sigma', s.sigma, 'games', s.games,
                                                                   'lastPeriod', s.last_period)), '[]'::jsonb)
                      from public.skill_ratings s
                      where s.user_id in (select (u #>> '{}')::uuid from jsonb_array_elements(rated) gg,
                                            jsonb_array_elements(gg -> 'teams') tm, jsonb_array_elements(tm) u)),
          'reliability', (select coalesce(jsonb_object_agg(p.id, p.reliability_score), '{}'::jsonb) from public.profiles p
                          where p.id in (select (u #>> '{}')::uuid from jsonb_array_elements(rated) gg,
                                           jsonb_array_elements(gg -> 'teams') tm, jsonb_array_elements(tm) u))),
        p15, t);
      for x in select y from jsonb_array_elements(res -> 'ratings') y loop
        insert into public.skill_ratings as s (user_id, sport, format_family, r, rd, sigma, games, last_period, updated_at)
        values ((x ->> 'userId')::uuid, x ->> 'sport', (x ->> 'formatFamily')::public.format_family, (x ->> 'r')::double precision,
                (x ->> 'rd')::double precision, (x ->> 'sigma')::double precision, (x ->> 'games')::int, x ->> 'lastPeriod', t)
        on conflict (user_id, sport, format_family) do update
          set r = excluded.r, rd = excluded.rd, sigma = excluded.sigma, games = excluded.games,
              last_period = excluded.last_period, updated_at = excluded.updated_at;
      end loop;
      for x in select y from jsonb_array_elements(res -> 'updates') y loop
        insert into public.rating_updates (dedupe_key, user_id, sport, format_family, period, r_before, rd_before, sigma_before,
                                           r_after, rd_after, sigma_after, games_added, frozen, created_at)
        values (x ->> 'dedupeKey', (x ->> 'userId')::uuid, x ->> 'sport', (x ->> 'formatFamily')::public.format_family, x ->> 'period',
                (x #>> '{before,r}')::double precision, (x #>> '{before,rd}')::double precision, (x #>> '{before,sigma}')::double precision,
                (x #>> '{after,r}')::double precision, (x #>> '{after,rd}')::double precision, (x #>> '{after,sigma}')::double precision,
                (x ->> 'gamesAdded')::int, (x ->> 'frozen')::boolean, t)
        on conflict (dedupe_key) do nothing;
        n := n + 1;
      end loop;
    end if;
    insert into public.rating_periods (period, starts_at, ends_at, games_rated, games_not_rated, updates, processed_at)
    values (pkey, pstart, pend, n_rated, n_not, coalesce(jsonb_array_length(res -> 'updates'), 0), t)
    on conflict (period) do nothing;
    res := null;
    idx := idx + 1;
    runs := runs + 1;
  end loop;
  return n;
end $$;
