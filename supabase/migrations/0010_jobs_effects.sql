-- 0010_jobs_effects.sql
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

-- Runs for scheduled games whose ends_at + finalizeAfterEndHours has passed:
--  * approved non-host players with attendance 'unknown' → 'no_show_unverified' + yellow card
--    (reason no_show, disputable for disputeWindowHours);
--  * a late canceller whose spot was taken by a replacement who checked in → provisional card
--    voided (overturned, void_reason 'refilled'), late cancel not counted;
--  * game → completed. Returns the number of no-show cards issued.
create function public.process_no_shows() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  cfg public.trust_config := public.st_config();
  t timestamptz := public.st_now();
  g record;
  p record;
  card public.sanctions;
  n int := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('st:process_no_shows')) then return 0; end if;
  for g in select x.* from public.games x
           where x.status = 'scheduled' and x.ends_at + cfg.finalize_after_end_hours * interval '1 hour' <= t
           order by x.ends_at
           for update skip locked
  loop
    for p in select gp.user_id from public.game_participants gp
             where gp.game_id = g.id and gp.status = 'approved' and gp.attendance = 'unknown' and gp.user_id <> g.host_id
    loop
      update public.game_participants gp set attendance = 'no_show_unverified'
      where gp.game_id = g.id and gp.user_id = p.user_id;
      perform public.st_issue_sanction(p.user_id, 'yellow_card', 'no_show', jsonb_build_object('gameTitle', g.title),
        cfg.yellow_card_lifetime_days * interval '1 day', cfg.dispute_window_hours * interval '1 hour',
        g.id, '{}', 'no_show:' || g.id::text || ':' || p.user_id::text);
      n := n + 1;
    end loop;

    for p in select c.user_id from public.game_participants c
             where c.game_id = g.id and c.status = 'cancelled' and c.late_cancel and not c.late_cancel_refilled
               and exists (select 1 from public.game_participants r
                           where r.game_id = g.id and r.replaces_user_id = c.user_id
                             and r.status = 'approved' and r.attendance = 'verified')
    loop
      select * into card from public.sanctions s
      where s.dedupe_key = 'late_cancel:' || g.id::text || ':' || p.user_id::text and s.status <> 'overturned';
      if card.id is not null then
        perform public.st_overturn_sanction(card.id, 'refilled');
      else
        update public.game_participants gp set late_cancel_refilled = true where gp.game_id = g.id and gp.user_id = p.user_id;
      end if;
    end loop;

    update public.games x set status = 'completed' where x.id = g.id;
    for p in select gp.user_id from public.game_participants gp
             where gp.game_id = g.id and (gp.status = 'approved' or gp.late_cancel) loop
      perform public.st_recompute_reliability(p.user_id);
    end loop;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Sanction lifecycle: auto-overturn stale disputes, escalate matured cards, expire
-- ---------------------------------------------------------------------------

-- TRUST-023: an eligible dispute undecided after disputeAutoVoidDays is overturned by the system.
create function public.auto_overturn_stale_disputes() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  cfg public.trust_config := public.st_config();
  t timestamptz := public.st_now();
  a record;
  n int := 0;
begin
  for a in select x.* from public.appeals x
           where x.status = 'open' and x.auto_void_eligible
             and x.created_at <= t - cfg.dispute_auto_void_days * interval '1 day'
           for update skip locked
  loop
    perform public.st_overturn_sanction(a.sanction_id, 'dispute_timeout');
    update public.appeals x set status = 'overturned', decided_at = t, decision_note = 'auto_overturned_no_decision'
    where x.id = a.id;
    update public.review_queue q set status = 'resolved', resolution = 'overturn', resolved_at = t,
                                     decision_note = 'auto_overturned_no_decision'
    where q.appeal_id = a.id and q.status <> 'resolved';
    perform public.st_notify(a.user_id, 'appeal_decided', jsonb_build_object('decision', 'auto_overturned'),
                             null, a.sanction_id, 'appeal_decided:' || a.id::text);
    perform public.st_audit('appeal.auto_overturned', a.user_id, jsonb_build_object('appealId', a.id), null);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Escalation ladder for every yellow card whose dispute window closed without a dispute.
create function public.escalate_matured_cards() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  c record;
  n int := 0;
begin
  for c in select s.id from public.sanctions s
           where s.kind = 'yellow_card' and s.status = 'active' and s.escalated_at is null
             and s.dispute_until <= t and s.expires_at > t
           order by s.created_at, s.id
  loop
    perform public.st_escalate(c.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Expire sanctions past expires_at; also runs the two functions above. Returns the number expired.
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
  perform public.escalate_matured_cards();
  with ex as (
    update public.sanctions s set status = 'expired'
    where s.status in ('active', 'disputed', 'upheld') and s.expires_at is not null and s.expires_at <= t
    returning s.user_id
  )
  select count(*), coalesce(array_agg(distinct ex.user_id), '{}') into n, uids from ex;
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

-- Expired (non-flash) offers go to the back of the line and the next players get offers; games
-- entering the flash-fill window with free spots get flash offers. Returns new offers made.
create function public.expire_waitlist_offers() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  g record;
  n int := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('st:expire_waitlist_offers')) then return 0; end if;
  update public.game_participants gp set offer_expires_at = null, offer_is_flash = false, waitlisted_at = t
  where gp.status = 'waitlisted' and gp.offer_expires_at <= t;
  for g in select distinct x.id from public.games x join public.game_participants gp on gp.game_id = x.id
           where x.status = 'scheduled' and x.ends_at > t and gp.status = 'waitlisted' loop
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
  where pm.deposit_state = 'setup' and pm.status = 'succeeded' and pm.settlement_requested is null
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
           case
             when g.status = 'cancelled' or gp.game_id is null
               or gp.status in ('rejected', 'removed')
               or (gp.status in ('requested', 'waitlisted') and g.starts_at <= public.st_now())
               or (gp.status = 'cancelled' and (not gp.late_cancel or gp.late_cancel_refilled))
               or gp.attendance in ('verified', 'excused')
               or c.status = 'overturned'
               then 'release'
             when g.status = 'completed' and c.id is not null
               and (c.status = 'upheld' or (c.status in ('active', 'expired') and c.dispute_until <= public.st_now()))
               then 'forfeit'
           end as outcome
    from public.payments pm
    join public.games g on g.id = pm.game_id
    left join public.game_participants gp on gp.game_id = pm.game_id and gp.user_id = pm.user_id
    left join lateral (
      select s.* from public.sanctions s
      where s.user_id = pm.user_id and s.game_id = pm.game_id and s.reason_code in ('no_show', 'late_cancel')
      order by s.created_at desc limit 1
    ) c on true
    where pm.deposit_state in ('setup', 'held') and pm.settlement_requested is null
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
    update public.payments pm set settlement_requested = r.outcome, settlement_requested_at = public.st_now()
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

create function public.apply_effects(p_effects jsonb) returns jsonb
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
begin
  if p_effects is null or jsonb_typeof(p_effects) <> 'array' then perform public.st_raise('validation', 'effects must be an array'); end if;
  for e in select value from jsonb_array_elements(p_effects) loop
    ty := e ->> 'type';
    uid := nullif(e ->> 'userId', '')::uuid;
    if ty = 'IssueSanction' then
      s := e -> 'sanction';
      if s ->> 'kind' = 'permanent_ban' then
        perform public.st_raise('forbidden', 'permanent_ban is moderator-only (moderator_decide)');
      end if;
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
    elsif ty = 'SetSanctionStatus' then
      sid := (e ->> 'sanctionId')::uuid;
      if e ->> 'status' = 'overturned' then
        perform public.st_overturn_sanction(sid);
      else
        update public.sanctions q set status = (e ->> 'status')::public.sanction_status
        where q.id = sid and q.status <> 'overturned' and q.status::text <> e ->> 'status'
        returning q.user_id into uid;
        if uid is not null then
          perform public.st_recompute_projections(uid);
          perform public.st_recompute_reliability(uid);
          if e ->> 'status' = 'upheld' then perform public.st_escalate(sid); end if;
        end if;
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
    elsif ty = 'LiftRestrictions' then
      for x in select q.id from public.sanctions q
               where q.user_id = uid and public.st_sanction_in_force(q)
                 and q.kind::text in (select jsonb_array_elements_text(coalesce(e -> 'kinds', '[]'::jsonb)))
      loop
        perform public.st_overturn_sanction(x.id);
      end loop;
      perform public.st_recompute_projections(uid);
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
         set status = 'approved', decided_at = public.st_now(), waitlisted_at = null, offer_expires_at = null,
             offer_is_flash = false, replaces_user_id = public.st_next_refill_target(gp.game_id)
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
