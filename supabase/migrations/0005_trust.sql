-- 0005_trust.sql
-- Trust configuration, sanctions, appeals, user reports, review queue, audit log and the
-- transactional trust rules (projection, reliability, escalation).

-- ---------------------------------------------------------------------------
-- trust_config: single row, snake_case mirror of DEFAULT_TRUST_CONFIG (types.ts)
-- ---------------------------------------------------------------------------
create table public.trust_config (
  id boolean primary key default true check (id),
  late_cancel_window_hours numeric not null default 2,
  dispute_window_hours numeric not null default 48,
  yellow_card_lifetime_days numeric not null default 30,
  join_ban_short_at_cards int not null default 2,
  join_ban_short_days numeric not null default 7,
  join_ban_long_at_cards int not null default 3,
  join_ban_long_days numeric not null default 30,
  review_at_cards int not null default 4,
  toxicity_reporters int not null default 3,
  toxicity_window_days numeric not null default 14,
  min_reporter_account_age_days numeric not null default 7,
  collusion_creation_window_hours numeric not null default 48,
  visibility_restriction_hours numeric not null default 72,
  chat_blocks_for_card int not null default 3,
  chat_blocks_window_days numeric not null default 7,
  chat_mute_hours numeric not null default 24,
  moderation_timeout_ms int not null default 1500,
  host_low_rating_max numeric not null default 2,
  host_low_rating_min_count int not null default 5,
  host_suspension_days numeric not null default 14,
  venue_reports_to_hide int not null default 3,
  wake_geofence_radius_m numeric not null default 150,
  gps_max_accuracy_m numeric not null default 25,
  gps_base_radius_m numeric not null default 50,
  gps_min_samples int not null default 2,
  gps_min_sample_spacing_seconds numeric not null default 5,
  gps_sample_window_seconds numeric not null default 60,
  gps_max_spread_m numeric not null default 30,
  gps_max_speed_kmh numeric not null default 250,
  check_in_opens_minutes_before_start numeric not null default 30,
  qr_step_seconds int not null default 20 check (qr_step_seconds > 0),
  qr_allowed_drift_steps int not null default 1 check (qr_allowed_drift_steps between 0 and 10),
  peer_min_confirmations int not null default 2,
  result_window_hours numeric not null default 2,
  chat_ttl_hours_after_end numeric not null default 3,
  moderation_retention_days numeric not null default 90,
  deposit_hold_lead_hours numeric not null default 24,
  reliability_window_days numeric not null default 90,
  reliability_green_min numeric not null default 0.85,
  reliability_red_below numeric not null default 0.6,
  reliability_prior numeric not null default 3,
  reliability_late_cancel_weight numeric not null default 0.5,
  reliability_min_games int not null default 3,
  -- PRD v5 additions (TRUST-021/023/041/048/050/051, GAME-045, compliance §4). Mirror these in
  -- TrustConfig when the contract adds them.
  dispute_auto_void_days numeric not null default 7,
  dispute_auto_void_max_per_90_days int not null default 3,
  post_overturn_protection_days numeric not null default 14,
  finalize_after_end_hours numeric not null default 2,
  waitlist_long_threshold_hours numeric not null default 6,
  waitlist_confirm_long_minutes numeric not null default 120,
  waitlist_confirm_short_minutes numeric not null default 20,
  waitlist_flash_fill_hours numeric not null default 1,
  reporter_min_accuracy numeric not null default 0.3,
  reporter_accuracy_min_reports int not null default 5,
  host_rating_window_hours numeric not null default 48,
  host_rating_lookback_days numeric not null default 90,
  location_samples_retention_days numeric not null default 30,
  qr_secret_retention_hours numeric not null default 24,
  user_report_retention_days numeric not null default 365,
  audit_log_retention_days numeric not null default 730,
  sanction_retention_after_deletion_days numeric not null default 730,
  updated_at timestamptz not null default now(),
  check (join_ban_short_at_cards < join_ban_long_at_cards and join_ban_long_at_cards < review_at_cards)
);
insert into public.trust_config (id) values (true);

create function public.st_config() returns public.trust_config
language sql stable security definer set search_path = ''
as $$ select c from public.trust_config c where c.id $$;

-- camelCase JSON (TrustConfig shape) for Edge Functions and golden tests.
create function public.trust_config_json() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_object_agg(
           lower(substr(x.camel, 1, 1)) || substr(x.camel, 2),
           x.value)
  from public.trust_config c,
       lateral jsonb_each(to_jsonb(c) - 'id' - 'updated_at') e,
       lateral (select replace(initcap(replace(e.key, '_', ' ')), ' ', '') as camel, e.value) x
  where c.id
$$;

-- ---------------------------------------------------------------------------
-- sanctions
-- ---------------------------------------------------------------------------
create table public.sanctions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  kind public.sanction_kind not null,
  reason_code public.sanction_reason_code not null,
  statement_key text not null,
  statement_params jsonb not null default '{}'::jsonb check (jsonb_typeof(statement_params) = 'object'),
  starts_at timestamptz not null,
  expires_at timestamptz,
  dispute_until timestamptz,
  status public.sanction_status not null default 'active',
  decided_by public.sanction_decider not null default 'system',
  game_id uuid references public.games (id) on delete set null,
  caused_by uuid[] not null default '{}',
  dedupe_key text not null unique check (char_length(dedupe_key) between 1 and 300),
  -- Why a sanction stopped applying without a moderator: 'refilled' (TRUST-021, late-cancel spot
  -- refilled) or 'dispute_timeout' (TRUST-023, undecided dispute auto-overturned). Status is then
  -- 'overturned' (types.ts SanctionStatus has no separate 'voided_refilled').
  void_reason text check (void_reason is null or void_reason in ('refilled', 'dispute_timeout')),
  -- When the sanction was overturned (TRUST-048 protection window).
  overturned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Compliance (GDPR 22(3), DSA 17): only a human may issue an indefinite measure.
  constraint sanctions_permanent_ban_by_moderator
    check (kind <> 'permanent_ban' or (expires_at is null and decided_by = 'moderator')),
  constraint sanctions_temporary_have_expiry check (kind = 'permanent_ban' or expires_at is not null),
  constraint sanctions_dispute_only_cards check (dispute_until is null or kind = 'yellow_card'),
  constraint sanctions_statement_key check (statement_key = 'sanctions.reason.' || reason_code::text),
  constraint sanctions_expiry_after_start check (expires_at is null or expires_at > starts_at)
);
create index sanctions_user_idx on public.sanctions (user_id, kind, status);
create index sanctions_expiry_idx on public.sanctions (expires_at) where status in ('active', 'disputed', 'upheld');
create index sanctions_caused_by_gin on public.sanctions using gin (caused_by);
create trigger sanctions_touch before update on public.sanctions
  for each row execute function public.st_touch_updated_at();

-- ---------------------------------------------------------------------------
-- appeals
-- ---------------------------------------------------------------------------
create table public.appeals (
  id uuid primary key default gen_random_uuid(),
  sanction_id uuid not null references public.sanctions (id),
  user_id uuid not null references public.profiles (id),
  text text not null check (char_length(text) between 1 and 2000),
  is_dispute boolean not null,
  -- TRUST-023: undecided after disputeAutoVoidDays → auto-overturn, unless the user exceeded
  -- disputeAutoVoidMaxPer90Days (appeal still possible, without auto-void).
  auto_void_eligible boolean not null default false,
  status public.appeal_status not null default 'open',
  decided_by uuid,
  decision_note text check (decision_note is null or char_length(decision_note) <= 2000),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index appeals_one_open_per_sanction on public.appeals (sanction_id) where status = 'open';
create index appeals_user_idx on public.appeals (user_id);

-- ---------------------------------------------------------------------------
-- user_reports
-- ---------------------------------------------------------------------------
create table public.user_reports (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: pseudonymised after userReportRetentionDays (compliance §4).
  reporter_id uuid references public.profiles (id),
  target_user_id uuid not null references public.profiles (id),
  category public.user_report_category not null,
  game_id uuid references public.games (id) on delete set null,
  -- No FK: chat messages are purged; reported ones are copied to moderation_retained.
  message_id uuid,
  note text check (note is null or char_length(note) <= 1000),
  -- Set by moderator decisions; drives reporter accuracy (TRUST-041).
  outcome text check (outcome is null or outcome in ('founded', 'unfounded')),
  created_at timestamptz not null default now(),
  check (reporter_id <> target_user_id)
);
create index user_reports_target_idx on public.user_reports (target_user_id, created_at);
create index user_reports_reporter_idx on public.user_reports (reporter_id, created_at);

-- ---------------------------------------------------------------------------
-- review_queue
-- ---------------------------------------------------------------------------
create table public.review_queue (
  id uuid primary key default gen_random_uuid(),
  kind public.review_kind not null,
  status public.review_status not null default 'open',
  priority public.review_priority not null default 'normal',
  subject_user_id uuid references public.profiles (id),
  venue_id uuid references public.venues (id) on delete set null,
  game_id uuid references public.games (id) on delete set null,
  sanction_id uuid references public.sanctions (id),
  appeal_id uuid references public.appeals (id),
  report_ids uuid[] not null default '{}',
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  due_by timestamptz not null,
  dedupe_key text not null unique check (char_length(dedupe_key) between 1 and 300),
  resolution public.moderator_decision,
  resolved_by uuid,
  resolved_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  check ((status = 'resolved') = (resolution is not null))
);
create index review_queue_open_idx on public.review_queue (status, priority, due_by);

-- ---------------------------------------------------------------------------
-- sanction_phone_hmac (security H5): ban-evasion check across account deletion. Keyed HMAC of the
-- E.164 phone of a deleted account with restrictions still in force; kept only until they expire.
-- Service role only (no client grants).
-- ---------------------------------------------------------------------------
create table public.sanction_phone_hmac (
  hmac text primary key check (hmac ~ '^[0-9a-f]{64}$'),
  sanction_ids uuid[] not null,
  until timestamptz not null,
  created_at timestamptz not null default now()
);

-- HMAC-SHA256(key, utf8(phone)), key from Vault secret `st_phone_hmac_key`, else the
-- `st.phone_hmac_key` setting (tests). Null when no key is configured.
create function public.st_phone_hmac(p_phone text) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare k text;
begin
  if p_phone is null or p_phone = '' then return null; end if;
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = ''st_phone_hmac_key''' into k;
  exception when others then
    k := null;
  end;
  k := coalesce(nullif(k, ''), nullif(current_setting('st.phone_hmac_key', true), ''));
  if k is null then return null; end if;
  return encode(extensions.hmac(convert_to(p_phone, 'UTF8'), convert_to(k, 'UTF8'), 'sha256'), 'hex');
end $$;

-- ---------------------------------------------------------------------------
-- audit_log (append-only)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  action text not null check (char_length(action) between 1 and 100),
  subject_user_id uuid,
  data jsonb not null default '{}'::jsonb
);
create index audit_log_subject_idx on public.audit_log (subject_user_id, at);

-- ---------------------------------------------------------------------------
-- Internal trust functions (not callable by clients; see 0009 grants)
-- ---------------------------------------------------------------------------

create function public.st_audit(p_action text, p_subject uuid, p_data jsonb default '{}'::jsonb, p_actor uuid default auth.uid())
returns void
language sql security definer set search_path = ''
as $$
  insert into public.audit_log (at, actor_id, action, subject_user_id, data)
  values (public.st_now(), p_actor, p_action, p_subject, coalesce(p_data, '{}'::jsonb))
$$;

-- In force: counts for restrictions and escalation (a disputed card stays in force until decided).
create function public.st_sanction_in_force(s public.sanctions, p_at timestamptz default null) returns boolean
language sql stable set search_path = ''
as $$
  select s.status in ('active', 'disputed', 'upheld')
     and s.starts_at <= coalesce(p_at, public.st_now())
     and (s.expires_at is null or s.expires_at > coalesce(p_at, public.st_now()))
$$;

-- Rebuild profiles.*_until from in-force sanctions (used after overturn/expiry/lift).
create function public.st_recompute_projections(p_uid uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare t timestamptz := public.st_now();
begin
  update public.profiles p set
    join_banned_until = (select max(s.expires_at) from public.sanctions s
                         where s.user_id = p_uid and s.kind = 'join_ban' and public.st_sanction_in_force(s, t)),
    chat_muted_until = (select max(s.expires_at) from public.sanctions s
                        where s.user_id = p_uid and s.kind = 'chat_mute' and public.st_sanction_in_force(s, t)),
    visibility_restricted_until = (select max(s.expires_at) from public.sanctions s
                                   where s.user_id = p_uid and s.kind = 'visibility_restriction' and public.st_sanction_in_force(s, t)),
    host_suspended_until = (select max(s.expires_at) from public.sanctions s
                            where s.user_id = p_uid and s.kind = 'host_suspension' and public.st_sanction_in_force(s, t)),
    permanently_banned = exists (select 1 from public.sanctions s
                                 where s.user_id = p_uid and s.kind = 'permanent_ban' and public.st_sanction_in_force(s, t))
  where p.id = p_uid;
end $$;

-- Reliability snapshot from the user's participations and sanctions via the domain mirror
-- dm_reliability() (0006), stored on profiles.
create function public.st_recompute_reliability(p_uid uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  snap jsonb;
begin
  snap := public.dm_reliability(
    (select coalesce(jsonb_agg(jsonb_build_object(
              'gameId', gp.game_id, 'status', gp.status, 'attendance', gp.attendance, 'lateCancel', gp.late_cancel,
              'cancelledAt', public.dm_iso(gp.cancelled_at), 'endsAt', public.dm_iso(g.ends_at),
              'lateCancelRefilled', gp.late_cancel_refilled, 'gameHappened', g.happened)), '[]'::jsonb)
     from public.game_participants gp join public.games g on g.id = gp.game_id
     where gp.user_id = p_uid and g.status <> 'cancelled'),
    public.st_user_sanctions_json(p_uid), t, public.st_config());
  update public.profiles p set
    reliability_score = (snap ->> 'score')::numeric,
    reliability_status = (snap ->> 'status')::public.reliability_status,
    reliability_verified_count = (snap ->> 'verifiedCount')::int,
    reliability_commitment_count = (snap ->> 'commitmentCount')::int,
    reliability_late_cancel_count = (snap ->> 'lateCancelCount')::int,
    reliability_no_show_count = (snap ->> 'noShowCount')::int,
    reliability_computed_at = t
  where p.id = p_uid;
  return snap;
end $$;

-- Insert a notification (idempotent when a dedupe key is given).
create function public.st_notify(
  p_user uuid, p_kind public.notification_kind, p_params jsonb default '{}'::jsonb,
  p_game uuid default null, p_sanction uuid default null, p_dedupe text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications (user_id, kind, params, game_id, sanction_id, dedupe_key, created_at)
  values (p_user, p_kind, coalesce(p_params, '{}'::jsonb), p_game, p_sanction, p_dedupe, public.st_now())
  on conflict (dedupe_key) do nothing;
end $$;

-- Enqueue a review item (idempotent by dedupe key). Returns the item id (new or existing).
create function public.st_enqueue_review(
  p_kind public.review_kind, p_dedupe text, p_subject uuid default null, p_priority public.review_priority default 'normal',
  p_evidence jsonb default '{}'::jsonb, p_report_ids uuid[] default '{}', p_venue uuid default null,
  p_game uuid default null, p_sanction uuid default null, p_appeal uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  insert into public.review_queue (kind, priority, subject_user_id, venue_id, game_id, sanction_id, appeal_id,
                                   report_ids, evidence, due_by, dedupe_key, created_at)
  values (p_kind, p_priority, p_subject, p_venue, p_game, p_sanction, p_appeal, coalesce(p_report_ids, '{}'),
          coalesce(p_evidence, '{}'::jsonb),
          -- REVIEW_SLA_HOURS (trust/sanctions.ts): high 24, normal 48, low 72.
          public.st_now() + case p_priority when 'high' then interval '24 hours' when 'normal' then interval '48 hours'
                                            else interval '72 hours' end,
          p_dedupe, public.st_now())
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  if v_id is null then
    select r.id into v_id from public.review_queue r where r.dedupe_key = p_dedupe;
  end if;
  return v_id;
end $$;

-- Issue a sanction through the domain builders (dm_system_sanction / dm_moderator_permanent_ban →
-- dm_issue_effects → st_apply_effects): IssueSanction (id derived from the dedupe key, idempotent),
-- projection and the Notify carrying the statement of reasons. Returns the row.
create function public.st_issue_sanction(
  p_user uuid, p_kind public.sanction_kind, p_reason public.sanction_reason_code, p_params jsonb,
  p_duration interval, p_dispute interval, p_game uuid, p_caused_by uuid[], p_dedupe text,
  p_decided_by public.sanction_decider default 'system')
returns public.sanctions
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  sj jsonb;
  s public.sanctions;
begin
  if p_kind = 'permanent_ban' then
    if p_decided_by <> 'moderator' then perform public.st_raise('forbidden', 'permanent_ban is moderator-only'); end if;
    sj := public.dm_moderator_permanent_ban(p_user, p_dedupe, t, to_jsonb(coalesce(p_caused_by, '{}')));
  else
    sj := public.dm_system_sanction(p_kind::text, p_user, p_reason::text, p_params,
            extract(epoch from p_duration) * 1000, extract(epoch from p_dispute) * 1000, p_game,
            to_jsonb(coalesce(p_caused_by, '{}')), p_dedupe, t, p_decided_by::text);
  end if;
  perform public.st_apply_effects(public.dm_issue_effects(sj));
  select * into s from public.sanctions x where x.dedupe_key = p_dedupe;
  return s;
end $$;

-- Sanction insert trigger: projection onto profiles.*_until and reliability. Runs for every insert
-- path (RPCs, jobs and apply_effects).
create function public.st_sanctions_after_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare t timestamptz := public.st_now();
begin
  if not public.st_sanction_in_force(new, t) then
    return null;
  end if;
  -- Projection (greatest(current, until)).
  update public.profiles p set
    join_banned_until = case when new.kind = 'join_ban' then greatest(p.join_banned_until, new.expires_at) else p.join_banned_until end,
    chat_muted_until = case when new.kind = 'chat_mute' then greatest(p.chat_muted_until, new.expires_at) else p.chat_muted_until end,
    visibility_restricted_until = case when new.kind = 'visibility_restriction'
                                       then greatest(p.visibility_restricted_until, new.expires_at) else p.visibility_restricted_until end,
    host_suspended_until = case when new.kind = 'host_suspension' then greatest(p.host_suspended_until, new.expires_at) else p.host_suspended_until end,
    permanently_banned = p.permanently_banned or new.kind = 'permanent_ban'
  where p.id = new.user_id;
  -- TRUST-025: a join ban withdraws open join requests and waitlist places (approved stay).
  if new.kind in ('join_ban', 'permanent_ban') then
    update public.game_participants gp set status = 'cancelled', cancelled_at = t, waitlisted_at = null
    from public.games g
    where g.id = gp.game_id and gp.user_id = new.user_id and gp.status in ('requested', 'waitlisted')
      and g.status = 'scheduled' and g.starts_at > t;
  end if;
  perform public.st_recompute_reliability(new.user_id);
  return null;
end $$;

-- Escalation ladder (TRUST-022/025) via the domain mirror dm_escalation(): evaluated on Tick
-- (expire_sanctions) and on a moderator uphold, never at issuance. Idempotent (dedupe keys derive
-- from the newest uncovered settled card).
create function public.st_run_escalation(p_uid uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.st_apply_effects(
    public.dm_escalation(public.st_user_sanctions_json(p_uid), public.st_now(), public.st_config()) -> 'effects');
end $$;

create trigger sanctions_after_insert after insert on public.sanctions
  for each row execute function public.st_sanctions_after_insert();

-- Deterministic ids (packages/domain crypto/uuid.ts): sanction.id = stableUuid('sanction:' || dedupeKey),
-- review.id = stableUuid('review:' || dedupeKey), so effects can reference rows before insertion.
create function public.st_derive_id() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.id := case tg_table_name when 'sanctions' then public.dm_sanction_id(new.dedupe_key)
                               else public.dm_review_id(new.dedupe_key) end;
  return new;
end $$;
create trigger sanctions_derive_id before insert on public.sanctions
  for each row execute function public.st_derive_id();
create trigger review_queue_derive_id before insert on public.review_queue
  for each row execute function public.st_derive_id();

-- Overturn a sanction and, recursively, every sanction listing it in caused_by (engine
-- overturnCascade). Recomputes projections and reliability; a no-show becomes excused; deposits are
-- released by settle_deposits(). Returns the number of sanctions overturned.
create function public.st_overturn_sanction(p_id uuid, p_void_reason text default null) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  ids uuid[];
  r record;
  n int := 0;
begin
  with recursive chain(id) as (
    select p_id
    union
    select s.id from public.sanctions s join chain c on c.id = any (s.caused_by)
  )
  select array_agg(id) into ids from chain;

  for r in update public.sanctions s set status = 'overturned', overturned_at = t,
                  void_reason = case when s.id = p_id then p_void_reason else s.void_reason end
           where s.id = any (ids) and s.status <> 'overturned'
           returning s.id, s.user_id, s.kind, s.reason_code, s.game_id, s.statement_key
  loop
    n := n + 1;
    if r.reason_code = 'no_show' and r.game_id is not null then
      update public.game_participants gp set attendance = 'excused', check_in_method = null, checked_in_at = null
      where gp.game_id = r.game_id and gp.user_id = r.user_id and gp.attendance in ('no_show_unverified', 'unknown');
    end if;
  end loop;

  for r in select distinct s.user_id from public.sanctions s where s.id = any (ids) loop
    perform public.st_recompute_projections(r.user_id);
    perform public.st_recompute_reliability(r.user_id);
  end loop;
  return n;
end $$;
