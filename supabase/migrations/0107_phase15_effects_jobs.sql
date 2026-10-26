-- 0107_phase15_effects_jobs.sql (Phase 1.5)
--  * RestrictAccountPendingReview (VAULT-003 CSAM match): a hold, not a sanction. While it lasts the
--    account cannot join, host, chat, upload or be seen (projections), until a moderator decides the
--    media_csam review (dismiss lifts it; permanent_ban bans). apply_effects accepts it, plus
--    Notify15 and PreserveMediaEvidence, for the Edge Functions.
--  * games.time_zone for one-off games (create_game p_time_zone), used by the invite preview.
--  * Media pipeline retry for items stuck in `processing`, and dispatch wrappers so the pg_cron jobs
--    go through the series-jobs / rating-period Edge Functions (push fan-out) when configured.

alter type public.notification_kind add value if not exists 'rating_level_changed';

-- ---------------------------------------------------------------------------
-- Holds pending human review
-- ---------------------------------------------------------------------------
create table public.account_review_holds (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  reason text not null check (reason in ('csam_match')),
  until timestamptz not null,
  dedupe_key text not null unique,
  created_at timestamptz not null default now()
);

-- st_recompute_projections (0005) + an active hold extends every restriction projection.
create or replace function public.st_recompute_projections(p_uid uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  hold timestamptz := (select h.until from public.account_review_holds h where h.user_id = p_uid and h.until > t);
begin
  update public.profiles p set
    join_banned_until = nullif(greatest(
      (select max(s.expires_at) from public.sanctions s
       where s.user_id = p_uid and s.kind = 'join_ban' and public.st_sanction_in_force(s, t)), hold), null),
    chat_muted_until = greatest(
      (select max(s.expires_at) from public.sanctions s
       where s.user_id = p_uid and s.kind = 'chat_mute' and public.st_sanction_in_force(s, t)), hold),
    visibility_restricted_until = greatest(
      (select max(s.expires_at) from public.sanctions s
       where s.user_id = p_uid and s.kind = 'visibility_restriction' and public.st_sanction_in_force(s, t)), hold),
    host_suspended_until = greatest(
      (select max(s.expires_at) from public.sanctions s
       where s.user_id = p_uid and s.kind = 'host_suspension' and public.st_sanction_in_force(s, t)), hold),
    permanently_banned = exists (select 1 from public.sanctions s
                                 where s.user_id = p_uid and s.kind = 'permanent_ban' and public.st_sanction_in_force(s, t))
  where p.id = p_uid;
end $$;

-- CSAM_RESTRICTION_DAYS (media-process) = 30.
create function public.st_apply_review_hold(p_uid uuid, p_reason text, p_dedupe text) returns void
language plpgsql security definer set search_path = ''
as $$
declare t timestamptz := public.st_now();
begin
  if p_uid is null or p_reason is distinct from 'csam_match' then perform public.st_raise('validation', 'hold'); end if;
  insert into public.account_review_holds (user_id, reason, until, dedupe_key, created_at)
  values (p_uid, p_reason, t + interval '30 days', coalesce(p_dedupe, 'hold:' || p_uid::text), t)
  on conflict (user_id) do update set until = greatest(public.account_review_holds.until, excluded.until);
  perform public.st_recompute_projections(p_uid);
  perform public.st_audit('account.review_hold', p_uid, jsonb_build_object('reason', p_reason), null);
end $$;

-- A dismissed media_csam review lifts the hold (projections recomputed); audited by moderator_decide.
create function public.st_review_hold_release() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind = 'media_csam' and new.status = 'resolved' and old.status <> 'resolved'
     and new.resolution in ('dismiss', 'overturn', 'lift_restriction') and new.subject_user_id is not null then
    delete from public.account_review_holds h where h.user_id = new.subject_user_id;
    perform public.st_recompute_projections(new.subject_user_id);
  end if;
  return null;
end $$;
create trigger review_queue_hold_release after update of status on public.review_queue
  for each row execute function public.st_review_hold_release();

-- apply_effects: service-role entry for Edge Functions. MVP Effect runs go to st_apply_effects in
-- order; the Phase 1.5 effects the functions hand over are applied here, idempotently.
create or replace function public.apply_effects(p_effects jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  fx jsonb;
  run jsonb := '[]'::jsonb;
  n int := 0;
begin
  if p_effects is null or jsonb_typeof(p_effects) <> 'array' then perform public.st_raise('validation', 'effects must be an array'); end if;
  if exists (select 1 from jsonb_array_elements(p_effects) e
             where (e ->> 'type' = 'IssueSanction' and e #>> '{sanction,kind}' = 'permanent_ban')
                or e ->> 'type' = 'BanAccount') then
    perform public.st_raise('forbidden', 'permanent_ban is moderator-only (moderator_decide)');
  end if;
  for fx in select x from jsonb_array_elements(p_effects) x loop
    if fx ->> 'type' in ('RestrictAccountPendingReview', 'Notify15', 'PreserveMediaEvidence') then
      if jsonb_array_length(run) > 0 then
        n := n + (public.st_apply_effects(run) ->> 'applied')::int;
        run := '[]'::jsonb;
      end if;
      if fx ->> 'type' = 'RestrictAccountPendingReview' then
        perform public.st_apply_review_hold((fx ->> 'userId')::uuid, fx ->> 'reason', fx ->> 'dedupeKey');
      elsif fx ->> 'type' = 'Notify15' then
        perform public.st_notify((fx ->> 'userId')::uuid, (fx ->> 'kind')::public.notification_kind,
          coalesce(fx -> 'params', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('seriesId', fx -> 'seriesId')),
          nullif(fx ->> 'gameId', '')::uuid, null, fx ->> 'dedupeKey');
      else
        update public.media_items m set legal_hold = true where m.id = (fx ->> 'mediaId')::uuid;
      end if;
      n := n + 1;
    else
      run := run || jsonb_build_array(fx);
    end if;
  end loop;
  if jsonb_array_length(run) > 0 then n := n + (public.st_apply_effects(run) ->> 'applied')::int; end if;
  return jsonb_build_object('applied', n);
end $$;

-- ---------------------------------------------------------------------------
-- create_game + p_time_zone (one-off games carry their IANA zone for previews/share texts)
-- ---------------------------------------------------------------------------
drop function public.create_game(text, text, public.game_visibility, uuid, double precision, double precision, boolean, int,
                                 timestamptz, timestamptz, int, text, boolean, int, text, public.deposit_forfeit_target, int);
create function public.create_game(
  p_sport text, p_title text, p_visibility public.game_visibility, p_venue_id uuid,
  p_lat double precision, p_lng double precision, p_hide_exact_location boolean, p_capacity int,
  p_starts_at timestamptz, p_ends_at timestamptz, p_deposit_minor int default 0, p_currency text default 'EUR',
  p_women_only boolean default false, p_team_count int default 2, p_notes text default null,
  p_deposit_forfeit_to public.deposit_forfeit_target default 'pot', p_min_players int default 2,
  p_time_zone text default null)
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
  if p_time_zone is not null and not public.st_is_iana_tz(p_time_zone) then
    perform public.st_raise('validation', 'time zone');
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
  if p_min_players is null or p_min_players < 2 or p_min_players > p_capacity then
    perform public.st_raise('validation', 'min players');
  end if;
  if coalesce(p_deposit_minor, 0) < 0 or p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    perform public.st_raise('validation', 'deposit');
  end if;
  -- Security M4: deposits only from the fixed per-currency tiers (TRUST-060).
  if coalesce(p_deposit_minor, 0) > 0 and not exists (
       select 1 from public.deposit_tiers d where d.currency = p_currency and d.amount_minor = p_deposit_minor) then
    perform public.st_raise('validation', 'deposit tier');
  end if;
  -- Security H4: a women-only game needs a female host.
  if coalesce(p_women_only, false) and not exists (
       select 1 from public.profile_private pp where pp.user_id = me.id and pp.gender = 'female') then
    perform public.st_raise('women_only');
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 80 then
    perform public.st_raise('validation', 'title');
  end if;

  insert into public.games (host_id, sport, title, notes, visibility, venue_id, geog, approx_geog, hide_exact_location,
                            capacity, starts_at, ends_at, deposit_minor, currency, deposit_forfeit_to, women_only,
                            team_count, min_players, time_zone, created_at)
  values (me.id, p_sport, btrim(p_title), p_notes, p_visibility, p_venue_id, pos, pos,
          -- Security H4: hidden by default for women-only and private games.
          coalesce(p_hide_exact_location, coalesce(p_women_only, false) or p_visibility = 'private'),
          p_capacity, p_starts_at, p_ends_at, coalesce(p_deposit_minor, 0), p_currency,
          -- Security M4: forfeits go to the community pot in the MVP (host payouts are deferred).
          'pot', coalesce(p_women_only, false), p_team_count, p_min_players, p_time_zone, t)
  returning id into g_id;
  -- The host is an approved participant and counts toward capacity.
  insert into public.game_participants (game_id, user_id, status, requested_at, decided_at)
  values (g_id, me.id, 'approved', t, t);
  select * into r from public.game_views x where x.id = g_id;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Media pipeline retry and Edge Function job wrappers
-- ---------------------------------------------------------------------------
alter table public.media_items add column process_attempts int not null default 0;
alter table public.media_items add column process_dispatched_at timestamptz;

-- Re-dispatches media-process for items stuck in `processing` > 15 min (at most every 15 min, 8
-- attempts; purge_media drops uploads never completed after 24 h). Returns the number dispatched.
create function public.retry_stuck_media() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  m record;
  n int := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('st:retry_stuck_media')) then return 0; end if;
  for m in select x.id from public.media_items x
           where x.status = 'processing' and x.created_at <= t - interval '15 minutes'
             and x.created_at > t - interval '24 hours' and x.process_attempts < 8
             and (x.process_dispatched_at is null or x.process_dispatched_at <= t - interval '15 minutes')
           order by x.created_at limit 200 for update skip locked loop
    update public.media_items x set process_attempts = x.process_attempts + 1, process_dispatched_at = t where x.id = m.id;
    perform public.st_dispatch('media-process', jsonb_build_object('mediaId', m.id));
    n := n + 1;
  end loop;
  return n;
end $$;

-- pg_cron entry points: through the Edge Function wrappers when dispatch is configured (they call
-- the same SQL jobs and fan out pushes), else the SQL jobs directly (both are idempotent).
create function public.run_series_jobs() returns int
language plpgsql security definer set search_path = ''
as $$
begin
  if public.st_dispatch('series-jobs', jsonb_build_object('job', 'all')) then return 0; end if;
  return public.generate_occurrences() + public.always_in_autojoin();
end $$;

create function public.run_rating_jobs() returns int
language plpgsql security definer set search_path = ''
as $$
begin
  if public.st_dispatch('rating-period', '{}'::jsonb) then return 0; end if;
  return public.run_rating_period();
end $$;
