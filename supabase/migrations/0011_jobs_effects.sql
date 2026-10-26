-- 0011_jobs_effects.sql
-- Scheduled job functions (idempotent, advisory-locked), deposit due-lists, retention purges and
-- the service-role-only apply_effects(jsonb) used by Edge Functions to apply domain Effect[].

-- ---------------------------------------------------------------------------
-- Dispatch to Edge Functions through pg_net when available (no-op otherwise, e.g. in tests).
-- Configure with: alter database postgres set st.functions_url = 'https://<ref>.functions.supabase.co';
-- and a Vault secret named 'st_functions_key' holding the service key.
-- ---------------------------------------------------------------------------
create function public.st_dispatch(p_function text, p_payload jsonb) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  base text := nullif(current_setting('st.functions_url', true), '');
  key text;
begin
  if base is null or not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_net') then
    return false;
  end if;
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = ''st_functions_key''' into key;
  exception when others then
    key := null;
  end;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using base || '/' || p_function, p_payload,
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || coalesce(key, ''));
  return true;
exception when others then
  raise warning 'st_dispatch(%) failed: %', p_function, sqlerrm;
  return false;
end $$;

-- ---------------------------------------------------------------------------
-- Game closure: no-shows and refilled late cancels (TRUST-020/021)
-- ---------------------------------------------------------------------------

-- Attendance finalisation (TRUST-010/011/020/021) via dm_process_no_shows() + the engine's
-- finalisation handlers (dm_finalization_effects), for scheduled games whose
-- ends_at + finalizeAfterEndHours has passed:
--  * game happened (≥ 2 verified) → unknown approved non-host players become no-shows with a
--    disputable yellow card; verified/excused → deposit release; each late cancel → yellow card,
--    unless the spot was refilled before the start by a replacement who checked in (release);
--  * game did not happen → no cards, undetermined attendance excused, deposits released, host review;
--  * game → completed (happened recorded). Returns the number of yellow cards issued.
create function public.process_no_shows() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  cfg public.trust_config := public.st_config();
  t timestamptz := public.st_now();
  g record;
  res jsonb;
  ev jsonb;
  fx jsonb;
  n int := 0;
  p record;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('st:process_no_shows')) then return 0; end if;
  for g in select x.* from public.games x
           where x.status = 'scheduled' and x.ends_at + cfg.finalize_after_end_hours * interval '1 hour' <= t
           order by x.ends_at
           for update skip locked
  loop
    res := public.dm_process_no_shows(jsonb_build_object(
        'game', jsonb_build_object('id', g.id, 'hostId', g.host_id, 'startsAt', public.dm_iso(g.starts_at),
                                   'endsAt', public.dm_iso(g.ends_at), 'status', g.status),
        'minPlayers', g.min_players,
        'participants', (select coalesce(jsonb_agg(jsonb_build_object('userId', gp.user_id, 'status', gp.status,
                                   'attendance', gp.attendance, 'lateCancel', gp.late_cancel,
                                   'cancelledAt', public.dm_iso(gp.cancelled_at))), '[]'::jsonb)
                         from public.game_participants gp where gp.game_id = g.id),
        'refills', (select coalesce(jsonb_agg(jsonb_build_object('cancelledUserId', gp.replaces_user_id,
                                   'replacementUserId', gp.user_id, 'promotedAt', public.dm_iso(gp.decided_at))), '[]'::jsonb)
                    from public.game_participants gp where gp.game_id = g.id and gp.replaces_user_id is not null)),
      t, cfg);
    if not (res ->> 'finalized')::boolean then continue; end if;
    perform public.st_apply_effects(res -> 'effects');
    for ev in select x from jsonb_array_elements(res -> 'events') x loop
      n := n + public.st_apply_finalization_event(ev);
    end loop;
    update public.games x set status = 'completed', happened = (res ->> 'gameHappened')::boolean where x.id = g.id;
    for p in select gp.user_id from public.game_participants gp
             where gp.game_id = g.id and (gp.status = 'approved' or gp.late_cancel) loop
      perform public.st_recompute_reliability(p.user_id);
    end loop;
  end loop;
  return n;
end $$;

-- Applies one finalisation event (AttendanceFinalized / LateCancelFinalized) with the engine handler
-- dm_finalization_effects(). Idempotent (dedupe keys). Returns the number of cards in the effects.
create function public.st_apply_finalization_event(p_event jsonb) returns int
language plpgsql security definer set search_path = ''
as $$
declare fx jsonb := public.dm_finalization_effects(p_event, public.st_now(), public.st_config());
begin
  if p_event ->> 'type' = 'LateCancelFinalized' and (p_event ->> 'refilled')::boolean then
    update public.game_participants gp set late_cancel_refilled = true
    where gp.game_id = (p_event ->> 'gameId')::uuid and gp.user_id = (p_event ->> 'userId')::uuid;
  end if;
  perform public.st_apply_effects(fx);
  return (select count(*) from jsonb_array_elements(fx) e where e ->> 'type' = 'IssueSanction');
end $$;

-- ---------------------------------------------------------------------------
-- Sanction lifecycle: auto-overturn stale disputes, escalate matured cards, expire
-- ---------------------------------------------------------------------------

-- TRUST-023: a disputed card whose dispute stayed undecided for disputeAutoVoidDays is overturned by
-- the system (only the user's first disputeAutoVoidMaxPer90Days disputes are eligible).
create function public.auto_overturn_stale_disputes() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  cfg public.trust_config := public.st_config();
  t timestamptz := public.st_now();
  a record;
  n int := 0;
begin
  for a in select x.*, s.kind, s.reason_code, s.statement_key, s.game_id, s.dedupe_key
           from public.appeals x join public.sanctions s on s.id = x.sanction_id
           where x.status = 'open' and x.is_dispute and s.status = 'disputed'
             and x.created_at + cfg.dispute_auto_void_days * interval '1 day' <= t
             -- only the user's first N disputes within 90 days (this one included) auto-void
             and (select count(*) from public.appeals d
                  where d.user_id = x.user_id and d.is_dispute and d.created_at <= x.created_at
                    and d.created_at > x.created_at - interval '90 days') <= cfg.dispute_auto_void_max_per_90_days
           order by x.created_at, x.id
           for update of x skip locked
  loop
    perform public.st_overturn_sanction(a.sanction_id, 'dispute_timeout');
    update public.appeals x set status = 'overturned', decided_at = t, decision_note = 'auto_void' where x.id = a.id;
    update public.review_queue q set status = 'resolved', resolution = 'overturn', resolved_at = t, decision_note = 'auto_void'
    where q.appeal_id = a.id and q.status <> 'resolved';
    perform public.st_apply_effects(jsonb_build_array(
      public.dm_notify(a.user_id, 'appeal_decided',
        jsonb_build_object('decision', 'auto_void', 'sanctionKind', a.kind, 'reasonCode', a.reason_code, 'statementKey', a.statement_key),
        a.game_id, a.dedupe_key),
      jsonb_build_object('type', 'Audit', 'action', 'sanction.auto_voided', 'subjectUserId', a.user_id,
        'data', jsonb_build_object('sanctionId', a.sanction_id, 'appealId', a.id, 'days', cfg.dispute_auto_void_days))));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Escalation for every user with a settled, uncovered yellow card (dispute window closed undisputed).
create function public.escalate_matured_cards() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  u record;
  n int := 0;
begin
  for u in select distinct s.user_id from public.sanctions s
           where s.kind = 'yellow_card' and public.st_sanction_in_force(s, t)
             and (s.status = 'upheld' or (s.status = 'active' and s.dispute_until < t))
             and not exists (select 1 from public.sanctions e
                             where e.user_id = s.user_id and e.reason_code in ('escalation_two_cards', 'escalation_three_cards')
                               and s.id = any (e.caused_by))
  loop
    perform public.st_run_escalation(u.user_id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Tick: auto-void stale disputes, expire active/upheld sanctions past expires_at (disputed ones wait
-- for a decision), run escalation, refresh projections. Returns the number expired.
create function public.expire_sanctions() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  u record;
  n int;
  uids uuid[];
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('st:expire_sanctions')) then return 0; end if;
  perform public.auto_overturn_stale_disputes();
  with ex as (
    update public.sanctions s set status = 'expired'
    where s.status in ('active', 'upheld') and s.expires_at is not null and s.expires_at <= t
    returning s.user_id
  )
  select count(*), coalesce(array_agg(distinct ex.user_id), '{}') into n, uids from ex;
  perform public.escalate_matured_cards();
  for u in select p.id from public.profiles p
           where p.id = any (uids)
              or p.join_banned_until <= t or p.chat_muted_until <= t or p.visibility_restricted_until <= t
              or p.host_suspended_until <= t
  loop
    perform public.st_recompute_projections(u.id);
    perform public.st_recompute_reliability(u.id);
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Waitlist offers
-- ---------------------------------------------------------------------------

-- Offer pass for every scheduled game with a waitlist: unanswered offers have expired (they stay in
-- the round, so the next player is offered), games entering the flash-fill window get flash offers.
-- Returns the number of new offers.
create function public.expire_waitlist_offers() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  g record;
  n int := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('st:expire_waitlist_offers')) then return 0; end if;
  for g in select distinct x.id from public.games x join public.game_participants gp on gp.game_id = x.id
           where x.status = 'scheduled' and x.starts_at > t and gp.status = 'waitlisted' loop
    n := n + public.st_promote_waitlist(g.id);
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Deposits (TRUST-061): holds at T−depositHoldLeadHours; capture only after the card's dispute
-- window closed without a dispute; release on attendance, excuse, refill, cancel or overturn.
-- The payments-webhook Edge Function is the only path that advances payments.status/deposit_state.
-- ---------------------------------------------------------------------------
create function public.due_deposit_holds()
returns table (payment_id uuid, user_id uuid, game_id uuid, amount_minor int, currency text,
               provider public.payment_provider_id, provider_ref text)
language sql stable security definer set search_path = ''
as $$
  select pm.id, pm.user_id, pm.game_id, pm.amount_minor, pm.currency, pm.provider, pm.provider_ref
  from public.payments pm
  join public.games g on g.id = pm.game_id
  join public.game_participants gp on gp.game_id = pm.game_id and gp.user_id = pm.user_id
  where pm.step = 'setup' and pm.deposit_state = 'setup' and pm.status = 'succeeded' and pm.settlement_requested is null
    and gp.status = 'approved' and g.status = 'scheduled'
    and public.st_now() >= g.starts_at - (public.st_config()).deposit_hold_lead_hours * interval '1 hour'
    and public.st_now() < g.ends_at
    and (pm.hold_requested_at is null or pm.hold_requested_at < public.st_now() - interval '15 minutes')
$$;

create function public.place_deposit_holds() returns int
language plpgsql security definer set search_path = ''
as $$
declare r record; n int := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('st:place_deposit_holds')) then return 0; end if;
  for r in select * from public.due_deposit_holds() loop
    update public.payments pm set hold_requested_at = public.st_now() where pm.id = r.payment_id;
    perform public.st_dispatch('payments-hold', to_jsonb(r));
    n := n + 1;
  end loop;
  return n;
end $$;

create function public.due_deposit_settlements()
returns table (payment_id uuid, user_id uuid, game_id uuid, outcome text)
language sql stable security definer set search_path = ''
as $$
  select x.id, x.user_id, x.game_id, x.outcome
  from (
    select pm.id, pm.user_id, pm.game_id,
           coalesce(pm.settlement_requested,
             case
               when g.status = 'cancelled' or gp.game_id is null
                 or gp.status in ('rejected', 'removed')
                 or (gp.status in ('requested', 'waitlisted') and g.starts_at <= public.st_now())
                 or (gp.status = 'cancelled' and (not gp.late_cancel or gp.late_cancel_refilled))
                 or gp.attendance in ('verified', 'excused')
                 or g.happened = false
                 or c.status = 'overturned'
                 then 'release'
               -- TRUST-061(4): capture only after the card's dispute window closed without a dispute.
               when g.status = 'completed' and c.id is not null
                 and (c.status = 'upheld' or (c.status in ('active', 'expired') and c.dispute_until < public.st_now()))
                 then 'forfeit'
             end) as outcome
    from public.payments pm
    join public.games g on g.id = pm.game_id
    left join public.game_participants gp on gp.game_id = pm.game_id and gp.user_id = pm.user_id
    left join lateral (
      select s.* from public.sanctions s
      where s.user_id = pm.user_id and s.game_id = pm.game_id and s.reason_code in ('no_show', 'late_cancel')
        and s.dedupe_key not like 'host\_late\_cancel:%' -- a host's own card never settles a deposit
      order by s.created_at desc limit 1
    ) c on true
    where pm.deposit_state in ('setup', 'held') and pm.settlement_dispatched_at is null
  ) x
  where x.outcome is not null
$$;

create function public.settle_deposits() returns int
language plpgsql security definer set search_path = ''
as $$
declare r record; n int := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('st:settle_deposits')) then return 0; end if;
  for r in select * from public.due_deposit_settlements() loop
    update public.payments pm set settlement_requested = r.outcome,
           settlement_requested_at = coalesce(pm.settlement_requested_at, public.st_now()),
           settlement_dispatched_at = public.st_now()
    where pm.id = r.payment_id;
    perform public.st_dispatch('payments-settle', to_jsonb(r));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Chat retention and moderation re-check
-- ---------------------------------------------------------------------------

-- Hard-deletes chat past expires_at; reported messages are copied to moderation_retained first.
create function public.purge_expired_messages() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  cfg public.trust_config := public.st_config();
  t timestamptz := public.st_now();
  n int;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('st:purge_expired_messages')) then return 0; end if;
  insert into public.moderation_retained (message_id, game_id, sender_id, body, reason, report_id, retained_at, expires_at)
  select distinct on (m.id) m.id, m.game_id, m.sender_id, m.body, 'reported', r.id, t,
         t + cfg.moderation_retention_days * interval '1 day'
  from public.chat_messages m join public.user_reports r on r.message_id = m.id
  where m.expires_at <= t
  order by m.id, r.created_at
  on conflict (message_id, reason) where message_id is not null do nothing;
  with d as (delete from public.chat_messages m where m.expires_at <= t returning 1)
  select count(*) into n from d;
  return n;
end $$;

create function public.purge_retained() returns int
language plpgsql security definer set search_path = ''
as $$
declare n int;
begin
  with d as (delete from public.moderation_retained r where r.expires_at <= public.st_now() and not r.legal_hold returning 1)
  select count(*) into n from d;
  return n;
end $$;

-- Pending (provider timeout) messages are re-checked by the moderation Edge Function.
create function public.recheck_pending_messages() returns int
language plpgsql security definer set search_path = ''
as $$
declare ids uuid[];
begin
  select array_agg(m.id) into ids from public.chat_messages m
  where m.moderation = 'pending' and m.retracted_at is null and m.expires_at > public.st_now()
    and m.created_at <= public.st_now() - interval '30 seconds';
  if ids is null then return 0; end if;
  perform public.st_dispatch('moderation-recheck', jsonb_build_object('messageIds', to_jsonb(ids)));
  return cardinality(ids);
end $$;

-- ---------------------------------------------------------------------------
-- Retention table (docs/compliance.md §4). Returns counts per category.
-- ---------------------------------------------------------------------------
create function public.purge_retention() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  cfg public.trust_config := public.st_config();
  t timestamptz := public.st_now();
  n_loc int; n_qr int; n_rep int; n_aud int; n_del int;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('st:purge_retention')) then return '{}'::jsonb; end if;
  -- Location-derived data and integrity signals: 30 days (outcome/method kept).
  with u as (
    update public.checkins c set distance_m = null, signals = '{}'
    where c.created_at <= t - cfg.location_samples_retention_days * interval '1 day'
      and (c.distance_m is not null or cardinality(c.signals) > 0)
    returning 1)
  select count(*) into n_loc from u;
  -- QR secrets and invite tokens: game end + 24h.
  with u as (
    update public.games g set qr_secret = null, invite_token = null
    where g.ends_at <= t - cfg.qr_secret_retention_hours * interval '1 hour'
      and (g.qr_secret is not null or g.invite_token is not null)
    returning 1)
  select count(*) into n_qr from u;
  -- User reports: reporter pseudonymised after 12 months.
  with u as (
    update public.user_reports r set reporter_id = null, note = null
    where r.created_at <= t - cfg.user_report_retention_days * interval '1 day' and r.reporter_id is not null
    returning 1)
  select count(*) into n_rep from u;
  -- Ban-evasion phone HMACs (security H5): only while the restrictions they carry are in force.
  delete from public.sanction_phone_hmac x where x.until <= t;
  -- Audit log: 2 years.
  with d as (delete from public.audit_log a where a.at <= t - cfg.audit_log_retention_days * interval '1 day' returning 1)
  select count(*) into n_aud from d;
  -- Sanctions/appeals of deleted accounts: account life + 2 years.
  with gone as (
    select p.id from public.profiles p
    where p.deleted_at is not null and p.deleted_at <= t - cfg.sanction_retention_after_deletion_days * interval '1 day'
  ), rq as (
    delete from public.review_queue q where q.subject_user_id in (select id from gone)
       or q.sanction_id in (select s.id from public.sanctions s where s.user_id in (select id from gone))
    returning 1
  ), ap as (
    delete from public.appeals a where a.user_id in (select id from gone) returning 1
  )
  select count(*) into n_del from (select 1 from rq union all select 1 from ap) z;
  delete from public.sanctions s where s.user_id in (
    select p.id from public.profiles p
    where p.deleted_at is not null and p.deleted_at <= t - cfg.sanction_retention_after_deletion_days * interval '1 day');
  return jsonb_build_object('locationSignals', n_loc, 'gameSecrets', n_qr, 'reportsPseudonymised', n_rep,
                            'auditDeleted', n_aud, 'deletedAccountTrustRows', n_del);
end $$;

-- ---------------------------------------------------------------------------
-- apply_effects(jsonb): service role only. Applies a domain Effect[] (types.ts) in order, in the
-- caller's transaction. Every effect is idempotent (dedupe keys, greatest(), state checks).
-- ---------------------------------------------------------------------------
create function public.st_ts(p jsonb) returns timestamptz
language sql immutable set search_path = ''
as $$ select case when p is null or jsonb_typeof(p) = 'null' then null else (p #>> '{}')::timestamptz end $$;

-- Internal applier (definer; not granted to clients). RPCs and jobs apply mirror effects with it.
create function public.st_apply_effects(p_effects jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  e jsonb;
  s jsonb;
  i jsonb;
  ty text;
  n int := 0;
  sid uuid;
  uid uuid;
  k text;
  x record;
  m public.checkin_method;
  dup_keys text[] := '{}';
  inserted int;
begin
  if p_effects is null or jsonb_typeof(p_effects) <> 'array' then perform public.st_raise('validation', 'effects must be an array'); end if;
  for e in select value from jsonb_array_elements(p_effects) loop
    ty := e ->> 'type';
    uid := nullif(e ->> 'userId', '')::uuid;
    if ty = 'IssueSanction' then
      s := e -> 'sanction';
      insert into public.sanctions (user_id, kind, reason_code, statement_key, statement_params, starts_at, expires_at,
                                    dispute_until, decided_by, game_id, caused_by, dedupe_key, created_at)
      values ((s ->> 'userId')::uuid, (s ->> 'kind')::public.sanction_kind, (s ->> 'reasonCode')::public.sanction_reason_code,
              coalesce(s ->> 'statementKey', 'sanctions.reason.' || (s ->> 'reasonCode')),
              coalesce(s -> 'statementParams', '{}'::jsonb), coalesce(public.st_ts(s -> 'startsAt'), public.st_now()),
              public.st_ts(s -> 'expiresAt'), public.st_ts(s -> 'disputeUntil'),
              coalesce(s ->> 'decidedBy', 'system')::public.sanction_decider, nullif(s ->> 'gameId', '')::uuid,
              coalesce((select array_agg(c::uuid) from jsonb_array_elements_text(coalesce(s -> 'causedBy', '[]'::jsonb)) c), '{}'),
              s ->> 'dedupeKey', public.st_now())
      on conflict (dedupe_key) do nothing;
      get diagnostics inserted = row_count;
      -- Like the engine: a duplicate sanction's notice is not sent again.
      if inserted = 0 then dup_keys := dup_keys || (s ->> 'dedupeKey'); end if;
    elsif ty = 'SetSanctionStatus' then
      sid := (e ->> 'sanctionId')::uuid;
      -- The engine emits the whole overturn cascade explicitly, so this is a plain status change.
      update public.sanctions q set status = (e ->> 'status')::public.sanction_status,
             overturned_at = case when e ->> 'status' = 'overturned' then public.st_now() else q.overturned_at end
      where q.id = sid and q.status <> 'overturned' and q.status::text <> e ->> 'status'
      returning q.user_id into uid;
      if uid is not null then
        perform public.st_recompute_projections(uid);
        perform public.st_recompute_reliability(uid);
      end if;
    elsif ty = 'EnqueueReview' then
      i := e -> 'item';
      insert into public.review_queue (kind, priority, subject_user_id, venue_id, game_id, sanction_id, appeal_id,
                                       report_ids, evidence, due_by, dedupe_key, created_at)
      values ((i ->> 'kind')::public.review_kind, coalesce(i ->> 'priority', 'normal')::public.review_priority,
              nullif(i ->> 'subjectUserId', '')::uuid, nullif(i ->> 'venueId', '')::uuid, nullif(i ->> 'gameId', '')::uuid,
              nullif(i ->> 'sanctionId', '')::uuid, nullif(i ->> 'appealId', '')::uuid,
              coalesce((select array_agg(c::uuid) from jsonb_array_elements_text(coalesce(i -> 'reportIds', '[]'::jsonb)) c), '{}'),
              coalesce(i -> 'evidence', '{}'::jsonb), coalesce(public.st_ts(i -> 'dueBy'), public.st_now() + interval '72 hours'),
              i ->> 'dedupeKey', public.st_now())
      on conflict (dedupe_key) do nothing;
    elsif ty = 'Notify' and e ->> 'sanctionDedupeKey' = any (dup_keys) then
      null;
    elsif ty = 'Notify' then
      select q.id into sid from public.sanctions q where q.dedupe_key = e ->> 'sanctionDedupeKey';
      perform public.st_notify(uid, (e ->> 'kind')::public.notification_kind, coalesce(e -> 'params', '{}'::jsonb),
                               nullif(e ->> 'gameId', '')::uuid, sid, 'fx:' || md5(e::text));
    elsif ty = 'UpdateReliability' then
      update public.profiles p set
        reliability_score = (e #>> '{reliability,score}')::numeric,
        reliability_status = (e #>> '{reliability,status}')::public.reliability_status,
        reliability_verified_count = (e #>> '{reliability,verifiedCount}')::int,
        reliability_commitment_count = (e #>> '{reliability,commitmentCount}')::int,
        reliability_late_cancel_count = (e #>> '{reliability,lateCancelCount}')::int,
        reliability_no_show_count = (e #>> '{reliability,noShowCount}')::int,
        reliability_computed_at = coalesce(public.st_ts(e #> '{reliability,computedAt}'), public.st_now())
      where p.id = uid;
    elsif ty in ('MuteChat', 'BanJoins', 'RestrictVisibility', 'SuspendHost') then
      update public.profiles p set
        chat_muted_until = case when ty = 'MuteChat' then greatest(p.chat_muted_until, public.st_ts(e -> 'until')) else p.chat_muted_until end,
        join_banned_until = case when ty = 'BanJoins' then greatest(p.join_banned_until, public.st_ts(e -> 'until')) else p.join_banned_until end,
        visibility_restricted_until = case when ty = 'RestrictVisibility'
          then greatest(p.visibility_restricted_until, public.st_ts(e -> 'until')) else p.visibility_restricted_until end,
        host_suspended_until = case when ty = 'SuspendHost' then greatest(p.host_suspended_until, public.st_ts(e -> 'until')) else p.host_suspended_until end
      where p.id = uid;
    elsif ty = 'BanAccount' then
      -- Projection of a moderator's permanent ban (the sanctions insert trigger sets it too).
      update public.profiles p set permanently_banned = true where p.id = uid;
    elsif ty = 'LiftRestrictions' then
      -- Clears the projections; the engine re-projects remaining in-force sanctions right after.
      update public.profiles p set
        join_banned_until = case when e -> 'kinds' ? 'join_ban' then null else p.join_banned_until end,
        chat_muted_until = case when e -> 'kinds' ? 'chat_mute' then null else p.chat_muted_until end,
        visibility_restricted_until = case when e -> 'kinds' ? 'visibility_restriction' then null else p.visibility_restricted_until end,
        host_suspended_until = case when e -> 'kinds' ? 'host_suspension' then null else p.host_suspended_until end,
        permanently_banned = case when e -> 'kinds' ? 'permanent_ban' then false else p.permanently_banned end
      where p.id = uid;
    elsif ty = 'SetVenueStatus' then
      update public.venues v set status = (e ->> 'status')::public.venue_status where v.id = (e ->> 'venueId')::uuid;
    elsif ty = 'SetAttendance' then
      if e ->> 'attendance' = 'verified' then
        select c.method into m from public.checkins c
        where c.game_id = (e ->> 'gameId')::uuid and c.user_id = uid and c.outcome = 'verified'
        order by c.created_at desc limit 1;
        update public.game_participants gp
           set attendance = 'verified', check_in_method = coalesce(gp.check_in_method, m, 'host'),
               checked_in_at = coalesce(gp.checked_in_at, public.st_now())
        where gp.game_id = (e ->> 'gameId')::uuid and gp.user_id = uid;
      else
        update public.game_participants gp
           set attendance = (e ->> 'attendance')::public.attendance_status, check_in_method = null, checked_in_at = null
        where gp.game_id = (e ->> 'gameId')::uuid and gp.user_id = uid;
      end if;
      perform public.st_recompute_reliability(uid);
    elsif ty = 'PromoteWaitlist' then
      update public.game_participants gp
         set status = 'approved', decided_at = public.st_now(), waitlisted_at = null,
             replaces_user_id = public.st_next_refill_target(gp.game_id)
      where gp.game_id = (e ->> 'gameId')::uuid and gp.user_id = uid and gp.status = 'waitlisted'
        and (select count(*) from public.game_participants a where a.game_id = gp.game_id and a.status = 'approved')
            < (select g.capacity from public.games g where g.id = gp.game_id);
    elsif ty = 'SettleDeposit' then
      if e ->> 'outcome' not in ('release', 'forfeit') then perform public.st_raise('validation', 'outcome'); end if;
      update public.payments pm set settlement_requested = e ->> 'outcome', settlement_requested_at = public.st_now()
      where pm.game_id = (e ->> 'gameId')::uuid and pm.user_id = uid and pm.deposit_state in ('setup', 'held')
        and pm.settlement_requested is null;
    elsif ty = 'Audit' then
      perform public.st_audit(e ->> 'action', nullif(e ->> 'subjectUserId', '')::uuid, coalesce(e -> 'data', '{}'::jsonb), null);
    else
      perform public.st_raise('validation', 'unknown effect type ' || coalesce(ty, 'null'));
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('applied', n);
end $$;

-- Service-role entry point for Edge Functions (Effect[] from @st/domain). Refuses permanent bans:
-- those are issued only by a human through moderator_decide.
create function public.apply_effects(p_effects jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if p_effects is null or jsonb_typeof(p_effects) <> 'array' then perform public.st_raise('validation', 'effects must be an array'); end if;
  if exists (select 1 from jsonb_array_elements(p_effects) e
             where (e ->> 'type' = 'IssueSanction' and e #>> '{sanction,kind}' = 'permanent_ban')
                or e ->> 'type' = 'BanAccount') then
    perform public.st_raise('forbidden', 'permanent_ban is moderator-only (moderator_decide)');
  end if;
  return public.st_apply_effects(p_effects);
end $$;
