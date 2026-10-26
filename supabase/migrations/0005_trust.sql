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
  host_suspension_days numeric not null default 30,
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
  qr_step_seconds int not null default 30 check (qr_step_seconds > 0),
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
  -- Set once a yellow card has been evaluated by the escalation ladder (after its dispute window
  -- closed undisputed, or when upheld).
  escalated_at timestamptz,
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

-- Pure reliability formula (mirror of the domain function; used by golden parity tests).
-- Returns the ReliabilitySnapshot shape in camelCase.
create function public.st_reliability_snapshot(
  p_verified int, p_no_show int, p_late_cancel int, p_has_active_card boolean, p_has_join_ban boolean,
  p_cfg public.trust_config, p_now timestamptz)
returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  commitments int := p_verified + p_no_show + p_late_cancel;
  weighted numeric := p_verified + p_no_show + p_late_cancel * p_cfg.reliability_late_cancel_weight;
  score numeric;
  st public.reliability_status;
begin
  score := (p_verified + p_cfg.reliability_prior) / (weighted + p_cfg.reliability_prior);
  if p_has_join_ban then
    st := 'red';
  elsif commitments < p_cfg.reliability_min_games then
    st := 'new';
  elsif score < p_cfg.reliability_red_below then
    st := 'red';
  elsif not p_has_active_card and score >= p_cfg.reliability_green_min then
    st := 'green';
  else
    st := 'yellow';
  end if;
  return jsonb_build_object(
    'score', case when commitments < p_cfg.reliability_min_games then null else round(score, 5) end,
    'status', st,
    'verifiedCount', p_verified,
    'commitmentCount', commitments,
    'lateCancelCount', p_late_cancel,
    'noShowCount', p_no_show,
    'computedAt', to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

create function public.st_recompute_reliability(p_uid uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  cfg public.trust_config := public.st_config();
  t timestamptz := public.st_now();
  since timestamptz;
  v_verified int; v_no_show int; v_late int; v_card boolean; v_ban boolean;
  snap jsonb;
begin
  since := t - cfg.reliability_window_days * interval '1 day';
  select count(*) filter (where gp.attendance = 'verified'),
         count(*) filter (where gp.attendance = 'no_show_unverified')
    into v_verified, v_no_show
  from public.game_participants gp join public.games g on g.id = gp.game_id
  where gp.user_id = p_uid and gp.status = 'approved' and g.status <> 'cancelled'
    and g.ends_at <= t and g.ends_at > since;
  select count(*) into v_late from public.game_participants gp
  where gp.user_id = p_uid and gp.late_cancel and not gp.late_cancel_refilled
    and gp.cancelled_at > since and gp.cancelled_at <= t;
  select exists (select 1 from public.sanctions s
                 where s.user_id = p_uid and s.kind = 'yellow_card' and public.st_sanction_in_force(s, t)),
         exists (select 1 from public.sanctions s
                 where s.user_id = p_uid and s.kind in ('join_ban', 'permanent_ban') and public.st_sanction_in_force(s, t))
    into v_card, v_ban;
  snap := public.st_reliability_snapshot(v_verified, v_no_show, v_late, v_card, v_ban, cfg, t);
  update public.profiles p set
    reliability_score = (snap ->> 'score')::numeric,
    reliability_status = (snap ->> 'status')::public.reliability_status,
    reliability_verified_count = v_verified,
    reliability_commitment_count = (snap ->> 'commitmentCount')::int,
    reliability_late_cancel_count = v_late,
    reliability_no_show_count = v_no_show,
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
          public.st_now() + case p_priority when 'high' then interval '24 hours' when 'normal' then interval '72 hours'
                                            else interval '7 days' end,
          p_dedupe, public.st_now())
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  if v_id is null then
    select r.id into v_id from public.review_queue r where r.dedupe_key = p_dedupe;
  end if;
  return v_id;
end $$;

-- Issue a sanction idempotently (dedupe key), project it onto profiles, notify the user with the
-- statement of reasons and recompute reliability. Escalation runs in the sanctions trigger.
create function public.st_issue_sanction(
  p_user uuid, p_kind public.sanction_kind, p_reason public.sanction_reason_code, p_params jsonb,
  p_duration interval, p_dispute interval, p_game uuid, p_caused_by uuid[], p_dedupe text,
  p_decided_by public.sanction_decider default 'system')
returns public.sanctions
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  s public.sanctions;
begin
  insert into public.sanctions (user_id, kind, reason_code, statement_key, statement_params, starts_at, expires_at,
                                dispute_until, decided_by, game_id, caused_by, dedupe_key, created_at)
  values (p_user, p_kind, p_reason, 'sanctions.reason.' || p_reason::text, coalesce(p_params, '{}'::jsonb), t,
          case when p_duration is null then null else t + p_duration end,
          case when p_dispute is null then null else t + p_dispute end,
          p_decided_by, p_game, coalesce(p_caused_by, '{}'), p_dedupe, t)
  on conflict (dedupe_key) do nothing
  returning * into s;
  if s.id is null then
    select * into s from public.sanctions x where x.dedupe_key = p_dedupe;
    return s;
  end if;
  perform public.st_notify(
    p_user,
    case p_kind when 'visibility_restriction' then 'visibility_restricted'::public.notification_kind
                when 'chat_mute' then 'chat_muted'::public.notification_kind
                else 'sanction_issued'::public.notification_kind end,
    jsonb_build_object('kind', p_kind, 'reasonCode', p_reason, 'statementKey', s.statement_key,
                       'expiresAt', coalesce(to_char(s.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '')),
    p_game, s.id, 'sanction:' || s.id::text);
  perform public.st_audit('sanction.issued', p_user,
    jsonb_build_object('sanctionId', s.id, 'kind', p_kind, 'reasonCode', p_reason, 'dedupeKey', p_dedupe));
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
    update public.game_participants gp set status = 'cancelled', cancelled_at = t, offer_expires_at = null,
           waitlisted_at = null
    from public.games g
    where g.id = gp.game_id and gp.user_id = new.user_id and gp.status in ('requested', 'waitlisted')
      and g.status = 'scheduled' and g.starts_at > t;
  end if;
  perform public.st_recompute_reliability(new.user_id);
  return null;
end $$;

-- Escalation ladder (TRUST-025), evaluated when a yellow card matures: its dispute window closed
-- without a dispute, or a moderator upheld it. Disputed cards do not count until decided (TRUST-022).
-- 2 counted cards → join_ban short; 3 → join_ban long; ≥ reviewAtCards → join_ban long + review
-- (permanent ban only by a human). Idempotent via dedupe keys derived from the maturing card.
create function public.st_escalate(p_card_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  cfg public.trust_config := public.st_config();
  t timestamptz := public.st_now();
  c public.sanctions;
  n int;
  cards uuid[];
begin
  update public.sanctions s set escalated_at = t
  where s.id = p_card_id and s.kind = 'yellow_card' and s.escalated_at is null
    and (s.status = 'upheld' or (s.status = 'active' and (s.dispute_until is null or s.dispute_until <= t)))
    and public.st_sanction_in_force(s, t)
  returning * into c;
  if c.id is null then return; end if;

  select count(*), array_agg(s.id order by s.created_at, s.id) into n, cards
  from public.sanctions s
  where s.user_id = c.user_id and s.kind = 'yellow_card' and public.st_sanction_in_force(s, t)
    and s.escalated_at is not null  -- matured cards processed so far (incl. this one), in order
    and s.status in ('active', 'upheld');

  if n >= cfg.join_ban_long_at_cards then
    perform public.st_issue_sanction(c.user_id, 'join_ban', 'escalation_three_cards',
      jsonb_build_object('cards', n, 'days', cfg.join_ban_long_days),
      cfg.join_ban_long_days * interval '1 day', null, c.game_id, cards,
      'escalation_three_cards:' || c.dedupe_key);
  elsif n >= cfg.join_ban_short_at_cards then
    perform public.st_issue_sanction(c.user_id, 'join_ban', 'escalation_two_cards',
      jsonb_build_object('cards', n, 'days', cfg.join_ban_short_days),
      cfg.join_ban_short_days * interval '1 day', null, c.game_id, cards,
      'escalation_two_cards:' || c.dedupe_key);
  end if;
  if n >= cfg.review_at_cards then
    -- Never an automatic permanent ban: a human decides (GDPR 22(3)).
    perform public.st_enqueue_review('permanent_ban_candidate', 'permanent_ban_candidate:' || c.dedupe_key,
      c.user_id, 'high', jsonb_build_object('activeCards', n), '{}', null, c.game_id, c.id, null);
  end if;
end $$;

create trigger sanctions_after_insert after insert on public.sanctions
  for each row execute function public.st_sanctions_after_insert();

-- Overturn a sanction and, recursively, every sanction listing it in caused_by. Recomputes
-- projections and reliability; excuses a no-show. Returns the number of sanctions overturned.
create function public.st_overturn_sanction(p_id uuid, p_void_reason text default null) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  ids uuid[];
  r record;
begin
  with recursive chain(id) as (
    select p_id
    union
    select s.id from public.sanctions s join chain c on c.id = any (s.caused_by)
  )
  select array_agg(id) into ids from chain;

  for r in update public.sanctions s set status = 'overturned',
                  void_reason = case when s.id = p_id then p_void_reason else s.void_reason end
           where s.id = any (ids) and s.status <> 'overturned'
           returning s.id, s.user_id, s.kind, s.reason_code, s.game_id
  loop
    if r.reason_code = 'no_show' and r.game_id is not null then
      update public.game_participants gp set attendance = 'excused'
      where gp.game_id = r.game_id and gp.user_id = r.user_id and gp.attendance = 'no_show_unverified';
    elsif r.reason_code = 'late_cancel' and r.game_id is not null then
      update public.game_participants gp
         set late_cancel_refilled = gp.late_cancel_refilled or p_void_reason = 'refilled',
             late_cancel = gp.late_cancel and p_void_reason is not distinct from 'refilled'
      where gp.game_id = r.game_id and gp.user_id = r.user_id and gp.late_cancel;
    end if;
    perform public.st_notify(r.user_id, 'sanction_decided',
      jsonb_build_object('decision', case when r.id = p_id and p_void_reason = 'refilled' then 'voided_refilled'
                                          when r.id = p_id and p_void_reason = 'dispute_timeout' then 'auto_overturned'
                                          else 'overturn' end,
                         'kind', r.kind), r.game_id, r.id, 'overturned:' || r.id::text);
  end loop;

  for r in select distinct s.user_id from public.sanctions s where s.id = any (ids) loop
    perform public.st_recompute_projections(r.user_id);
    perform public.st_recompute_reliability(r.user_id);
  end loop;
  return coalesce(cardinality(ids), 0);
end $$;
