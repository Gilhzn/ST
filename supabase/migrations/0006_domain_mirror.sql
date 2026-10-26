-- 0006_domain_mirror.sql
-- Pure SQL mirrors of the @st/domain rules (packages/domain/src). Each `dm_*` function takes the
-- same camelCase JSON input as its TS counterpart and returns the same output (including Effect[]),
-- so RPCs can (1) build the input from rows, (2) call the mirror, (3) apply the effects with
-- st_apply_effects(). supabase/tests/golden.test.ts runs packages/domain/test/golden/*.json
-- through these functions: TS ≡ SQL parity.
--
-- Conventions: timestamps in JSON are ISO strings (dm_iso / dm_ts); string ordering uses
-- COLLATE "C" (= JS code-unit order); durations are milliseconds.

-- ---------------------------------------------------------------------------
-- Primitives
-- ---------------------------------------------------------------------------
create function public.dm_iso(p_t timestamptz) returns text
language sql immutable parallel safe set search_path = ''
as $$ select to_char(p_t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

create function public.dm_ts(p text) returns timestamptz
language sql immutable parallel safe set search_path = ''
as $$ select case when p is null or p = '' then null else p::timestamptz end $$;

create function public.dm_ms(p_ms numeric) returns interval
language sql immutable parallel safe set search_path = ''
as $$ select p_ms * interval '1 millisecond' $$;

-- stableUuid (src/crypto/uuid.ts): SHA-256(utf8(key))[0..16], version nibble 8, variant 10.
create function public.dm_stable_uuid(p_key text) returns uuid
language plpgsql immutable parallel safe set search_path = ''
as $$
declare
  h bytea := extensions.digest(convert_to(p_key, 'UTF8'), 'sha256');
  x text := encode(h, 'hex');
begin
  return (substr(x, 1, 8) || '-' || substr(x, 9, 4) || '-'
          || lpad(to_hex((get_byte(h, 6) & 15) | 128), 2, '0') || substr(x, 15, 2) || '-'
          || lpad(to_hex((get_byte(h, 8) & 63) | 128), 2, '0') || substr(x, 19, 2) || '-'
          || substr(x, 21, 12))::uuid;
end $$;

create function public.dm_sanction_id(p_dedupe text) returns uuid
language sql immutable parallel safe set search_path = ''
as $$ select public.dm_stable_uuid('sanction:' || p_dedupe) $$;

create function public.dm_review_id(p_dedupe text) returns uuid
language sql immutable parallel safe set search_path = ''
as $$ select public.dm_stable_uuid('review:' || p_dedupe) $$;

-- trust_config with camelCase overrides (golden `config`), like resolveTrustConfig().
create function public.st_config_merge(p_overrides jsonb) returns public.trust_config
language sql stable security definer set search_path = ''
as $$
  select jsonb_populate_record(public.st_config(),
           coalesce((select jsonb_object_agg(lower(regexp_replace(e.key, '([A-Z]|[0-9]+)', '_\1', 'g')), e.value)
                     from jsonb_each(coalesce(p_overrides, '{}'::jsonb)) e), '{}'::jsonb))
$$;

-- In force (IN_FORCE_STATUSES and not past expiresAt) for a camelCase Sanction.
create function public.dm_in_force(s jsonb, p_now timestamptz) returns boolean
language sql immutable set search_path = ''
as $$
  select s ->> 'status' in ('active', 'disputed', 'upheld')
     and (s ->> 'expiresAt' is null or public.dm_ts(s ->> 'expiresAt') > p_now)
$$;

-- A sanctions row as the camelCase Sanction shape.
create function public.st_sanction_json(s public.sanctions) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'userId', s.user_id, 'kind', s.kind, 'reasonCode', s.reason_code, 'statementKey', s.statement_key,
    'statementParams', s.statement_params, 'startsAt', public.dm_iso(s.starts_at), 'expiresAt', public.dm_iso(s.expires_at),
    'disputeUntil', public.dm_iso(s.dispute_until), 'status', s.status, 'gameId', s.game_id,
    'causedBy', to_jsonb(s.caused_by), 'dedupeKey', s.dedupe_key, 'decidedBy', s.decided_by,
    'appealPath', case when s.dispute_until is not null then 'dispute' else 'appeal' end,
    'overturnedAt', public.dm_iso(s.overturned_at), 'createdAt', public.dm_iso(s.created_at))
$$;

create function public.st_user_sanctions_json(p_uid uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(public.st_sanction_json(s) order by s.starts_at, s.id), '[]'::jsonb)
  from public.sanctions s where s.user_id = p_uid
$$;

-- ---------------------------------------------------------------------------
-- Builders (trust/sanctions.ts)
-- ---------------------------------------------------------------------------
create function public.dm_system_sanction(
  p_kind text, p_user uuid, p_reason text, p_params jsonb, p_duration_ms numeric, p_dispute_ms numeric,
  p_game uuid, p_caused_by jsonb, p_dedupe text, p_now timestamptz, p_decided_by text default 'system')
returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare dispute_until text;
begin
  if p_kind = 'permanent_ban' then raise exception 'The system never issues permanent bans'; end if;
  if p_duration_ms is null or p_duration_ms <= 0 then raise exception 'System sanctions must have a finite positive duration'; end if;
  dispute_until := case when coalesce(p_dispute_ms, 0) > 0 then public.dm_iso(p_now + public.dm_ms(p_dispute_ms)) end;
  return jsonb_build_object(
    'kind', p_kind, 'userId', p_user, 'reasonCode', p_reason, 'statementKey', 'sanctions.reason.' || p_reason,
    'statementParams', coalesce(p_params, '{}'::jsonb)
                       || jsonb_build_object('appealPath', case when dispute_until is not null then 'dispute' else 'appeal' end),
    'startsAt', public.dm_iso(p_now), 'expiresAt', public.dm_iso(p_now + public.dm_ms(p_duration_ms)),
    'disputeUntil', dispute_until, 'gameId', p_game, 'causedBy', coalesce(p_caused_by, '[]'::jsonb),
    'dedupeKey', p_dedupe, 'decidedBy', coalesce(p_decided_by, 'system'));
end $$;

create function public.dm_moderator_permanent_ban(p_user uuid, p_dedupe text, p_now timestamptz, p_caused_by jsonb)
returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'kind', 'permanent_ban', 'userId', p_user, 'reasonCode', 'moderator_decision',
    'statementKey', 'sanctions.reason.moderator_decision', 'statementParams', jsonb_build_object('appealPath', 'appeal'),
    'startsAt', public.dm_iso(p_now), 'expiresAt', null, 'disputeUntil', null, 'gameId', null,
    'causedBy', coalesce(p_caused_by, '[]'::jsonb), 'dedupeKey', p_dedupe, 'decidedBy', 'moderator')
$$;

-- issueEffects(): IssueSanction, projection (restriction kinds), Notify with the statement of reasons.
create function public.dm_issue_effects(s jsonb) returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_array(jsonb_build_object('type', 'IssueSanction', 'sanction', s))
         || case when s ->> 'kind' = 'permanent_ban'
                 then jsonb_build_array(jsonb_build_object('type', 'BanAccount', 'userId', s -> 'userId'))
                 else '[]'::jsonb end
         || case when s ->> 'kind' in ('join_ban', 'chat_mute', 'visibility_restriction', 'host_suspension')
                      and s ->> 'expiresAt' is not null
                 then jsonb_build_array(jsonb_build_object(
                        'type', case s ->> 'kind' when 'join_ban' then 'BanJoins' when 'chat_mute' then 'MuteChat'
                                                  when 'visibility_restriction' then 'RestrictVisibility' else 'SuspendHost' end,
                        'userId', s -> 'userId', 'until', s -> 'expiresAt'))
                 else '[]'::jsonb end
         || jsonb_build_array(jsonb_build_object(
              'type', 'Notify', 'userId', s -> 'userId',
              'kind', case s ->> 'kind' when 'visibility_restriction' then 'visibility_restricted'
                                        when 'chat_mute' then 'chat_muted' else 'sanction_issued' end,
              'params', jsonb_build_object(
                'sanctionKind', s -> 'kind', 'reasonCode', s -> 'reasonCode', 'statementKey', s -> 'statementKey',
                'expiresAt', coalesce(s ->> 'expiresAt', ''), 'disputeUntil', coalesce(s ->> 'disputeUntil', ''),
                'appealPath', case when s ->> 'disputeUntil' is not null then 'dispute' else 'appeal' end),
              'gameId', s -> 'gameId', 'sanctionDedupeKey', s -> 'dedupeKey'))
$$;

-- buildReviewItem(): dueBy = now + REVIEW_SLA_HOURS[priority] (high 24, normal 48, low 72).
create function public.dm_review_item(
  p_kind text, p_priority text, p_dedupe text, p_subject uuid, p_venue uuid, p_game uuid, p_sanction uuid,
  p_appeal uuid, p_report_ids jsonb, p_evidence jsonb, p_now timestamptz)
returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'kind', p_kind, 'priority', p_priority, 'subjectUserId', p_subject, 'venueId', p_venue, 'gameId', p_game,
    'sanctionId', p_sanction, 'appealId', p_appeal, 'reportIds', coalesce(p_report_ids, '[]'::jsonb),
    'evidence', coalesce(p_evidence, '{}'::jsonb),
    'dueBy', public.dm_iso(p_now + case p_priority when 'high' then interval '24 hours' when 'normal' then interval '48 hours'
                                                   else interval '72 hours' end),
    'dedupeKey', p_dedupe)
$$;

create function public.dm_enqueue(p_item jsonb) returns jsonb
language sql immutable set search_path = ''
as $$ select jsonb_build_object('type', 'EnqueueReview', 'item', p_item) $$;

create function public.dm_notify(p_user uuid, p_kind text, p_params jsonb, p_game uuid, p_sanction_dedupe text) returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object('type', 'Notify', 'userId', p_user, 'kind', p_kind, 'params', coalesce(p_params, '{}'::jsonb),
                            'gameId', p_game, 'sanctionDedupeKey', p_sanction_dedupe)
$$;

-- Yellow card for late_cancel / no_show (engine.issueYellowCard).
create function public.dm_yellow_card(p_user uuid, p_reason text, p_game uuid, p_params jsonb, p_now timestamptz,
                                      p_cfg public.trust_config)
returns jsonb
language sql immutable set search_path = ''
as $$
  select public.dm_issue_effects(public.dm_system_sanction(
    'yellow_card', p_user, p_reason, coalesce(p_params, '{}'::jsonb) || jsonb_build_object('disputeHours', p_cfg.dispute_window_hours),
    p_cfg.yellow_card_lifetime_days * 86400000, p_cfg.dispute_window_hours * 3600000, p_game, '[]'::jsonb,
    p_reason || ':' || p_game::text || ':' || p_user::text, p_now))
$$;

-- ---------------------------------------------------------------------------
-- Game windows (games/windows.ts)
-- ---------------------------------------------------------------------------
create function public.dm_game_windows(p_starts timestamptz, p_ends timestamptz, p_now timestamptz, p_cfg public.trust_config)
returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'checkInOpensAt', public.dm_iso(p_starts - p_cfg.check_in_opens_minutes_before_start * interval '1 minute'),
    'resultWindowClosesAt', public.dm_iso(p_ends + p_cfg.result_window_hours * interval '1 hour'),
    'chatExpiresAt', public.dm_iso(p_ends + p_cfg.chat_ttl_hours_after_end * interval '1 hour'),
    'checkInOpen', p_now >= p_starts - p_cfg.check_in_opens_minutes_before_start * interval '1 minute' and p_now <= p_ends,
    'canSubmitResult', p_now >= p_ends and p_now <= p_ends + p_cfg.result_window_hours * interval '1 hour',
    'chatOpen', p_now < p_ends + p_cfg.chat_ttl_hours_after_end * interval '1 hour')
$$;

create function public.dm_check_in_open(p_starts timestamptz, p_ends timestamptz, p_now timestamptz, p_cfg public.trust_config)
returns boolean
language sql immutable set search_path = ''
as $$ select (public.dm_game_windows(p_starts, p_ends, p_now, p_cfg) ->> 'checkInOpen')::boolean $$;

-- ---------------------------------------------------------------------------
-- QR (checkin/qr.ts): token = step || '.' || left(hex(HMAC_SHA256(utf8(secret), gameId|step)), 32)
-- ---------------------------------------------------------------------------
create function public.dm_qr_mac(p_secret text, p_game uuid, p_step bigint) returns text
language sql immutable set search_path = ''
as $$
  select left(encode(extensions.hmac(convert_to(p_game::text || '|' || p_step::text, 'UTF8'),
                                     convert_to(p_secret, 'UTF8'), 'sha256'), 'hex'), 32)
$$;

create function public.dm_qr_step(p_now timestamptz, p_cfg public.trust_config) returns bigint
language sql immutable set search_path = ''
as $$ select floor(extract(epoch from p_now) * 1000 / (p_cfg.qr_step_seconds * 1000))::bigint $$;

create function public.dm_qr_token(p_secret text, p_game uuid, p_now timestamptz, p_cfg public.trust_config) returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object('token', s.step::text || '.' || public.dm_qr_mac(p_secret, p_game, s.step), 'step', s.step,
                            'expiresAt', public.dm_iso(to_timestamp((s.step + 1) * p_cfg.qr_step_seconds)))
  from (select public.dm_qr_step(p_now, p_cfg) as step) s
$$;

create function public.dm_verify_qr(p_token text, p_secret text, p_game uuid, p_now timestamptz, p_cfg public.trust_config,
                                    p_window jsonb default null)
returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  m text[];
  step bigint;
  invalid jsonb := jsonb_build_object('outcome', 'rejected', 'method', 'qr', 'reason', 'invalid_qr',
                                      'fallbacks', jsonb_build_array('qr', 'peer', 'host'), 'signals', '[]'::jsonb);
begin
  if p_window is not null and jsonb_typeof(p_window) = 'object'
     and not public.dm_check_in_open(public.dm_ts(p_window ->> 'startsAt'), public.dm_ts(p_window ->> 'endsAt'), p_now, p_cfg) then
    return jsonb_build_object('outcome', 'rejected', 'method', 'qr', 'reason', 'outside_window', 'fallbacks', '[]'::jsonb,
                              'signals', '[]'::jsonb);
  end if;
  m := regexp_match(btrim(coalesce(p_token, '')), '^(\d{1,15})\.([0-9a-f]+)$');
  if m is null or p_secret is null then return invalid; end if;
  step := m[1]::bigint;
  if m[2] <> public.dm_qr_mac(p_secret, p_game, step) then return invalid; end if;
  if abs(step - public.dm_qr_step(p_now, p_cfg)) > p_cfg.qr_allowed_drift_steps then
    return jsonb_set(invalid, '{reason}', '"expired_qr"');
  end if;
  return jsonb_build_object('outcome', 'verified', 'method', 'qr', 'distanceM', null, 'signals', '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Reliability (trust/reliability.ts)
-- ---------------------------------------------------------------------------
create function public.dm_reliability(p_parts jsonb, p_sanctions jsonb, p_now timestamptz, p_cfg public.trust_config)
returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  since timestamptz := p_now - p_cfg.reliability_window_days * interval '1 day';
  v int; n int; l int; c int;
  score numeric;
  restricted boolean; has_card boolean; is_new boolean;
  st text;
begin
  select count(*) filter (where p ->> 'status' = 'approved' and coalesce((p ->> 'gameHappened')::boolean, true)
                             and public.dm_ts(p ->> 'endsAt') > since and public.dm_ts(p ->> 'endsAt') <= p_now
                             and p ->> 'attendance' = 'verified'),
         count(*) filter (where p ->> 'status' = 'approved' and coalesce((p ->> 'gameHappened')::boolean, true)
                             and public.dm_ts(p ->> 'endsAt') > since and public.dm_ts(p ->> 'endsAt') <= p_now
                             and p ->> 'attendance' = 'no_show_unverified'),
         count(*) filter (where p ->> 'status' = 'cancelled' and coalesce((p ->> 'lateCancel')::boolean, false)
                             and not coalesce((p ->> 'lateCancelRefilled')::boolean, false)
                             and public.dm_ts(p ->> 'cancelledAt') > since and public.dm_ts(p ->> 'cancelledAt') <= p_now)
    into v, n, l
  from jsonb_array_elements(coalesce(p_parts, '[]'::jsonb)) p;
  c := v + n + l;
  score := (v + p_cfg.reliability_prior) / (v + n + p_cfg.reliability_late_cancel_weight * l + p_cfg.reliability_prior);
  select coalesce(bool_or(s ->> 'kind' <> 'yellow_card'), false), coalesce(bool_or(s ->> 'kind' = 'yellow_card'), false)
    into restricted, has_card
  from jsonb_array_elements(coalesce(p_sanctions, '[]'::jsonb)) s
  where public.dm_in_force(s, p_now);
  is_new := c < p_cfg.reliability_min_games;
  st := case when restricted then 'red' when is_new then 'new' when score < p_cfg.reliability_red_below then 'red'
             when not has_card and score >= p_cfg.reliability_green_min then 'green' else 'yellow' end;
  return jsonb_build_object('score', case when is_new then null else round(score, 4) end, 'status', st,
                            'verifiedCount', v, 'commitmentCount', c, 'lateCancelCount', l, 'noShowCount', n,
                            'computedAt', public.dm_iso(p_now));
end $$;

-- ---------------------------------------------------------------------------
-- Escalation (trust/escalation.ts)
-- ---------------------------------------------------------------------------
create function public.dm_escalation(p_sanctions jsonb, p_now timestamptz, p_cfg public.trust_config) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  cards jsonb;
  n int;
  trig jsonb;
  is_long boolean;
  reason text;
  days numeric;
  ban jsonb;
  effects jsonb;
begin
  select coalesce(jsonb_agg(s order by public.dm_ts(s ->> 'startsAt'), (s ->> 'id') collate "C"), '[]'::jsonb) into cards
  from jsonb_array_elements(coalesce(p_sanctions, '[]'::jsonb)) s
  where s ->> 'kind' = 'yellow_card' and public.dm_in_force(s, p_now)
    and (s ->> 'status' = 'upheld'
         or (s ->> 'status' = 'active' and (s ->> 'disputeUntil' is null or p_now > public.dm_ts(s ->> 'disputeUntil'))));
  n := jsonb_array_length(cards);
  select c into trig from jsonb_array_elements(cards) with ordinality as x(c, i)
  where not exists (
    select 1 from jsonb_array_elements(coalesce(p_sanctions, '[]'::jsonb)) e
    where e ->> 'reasonCode' in ('escalation_two_cards', 'escalation_three_cards')
      and (e -> 'causedBy') ? (c ->> 'id'))
  order by i desc limit 1;
  if trig is null or n < p_cfg.join_ban_short_at_cards then
    return jsonb_build_object('activeCards', n, 'level', 'none', 'effects', '[]'::jsonb);
  end if;
  is_long := n >= p_cfg.join_ban_long_at_cards;
  reason := case when is_long then 'escalation_three_cards' else 'escalation_two_cards' end;
  days := case when is_long then p_cfg.join_ban_long_days else p_cfg.join_ban_short_days end;
  ban := public.dm_system_sanction('join_ban', (trig ->> 'userId')::uuid, reason, jsonb_build_object('cards', n, 'days', days),
           days * 86400000, null, nullif(trig ->> 'gameId', '')::uuid,
           (select jsonb_agg(c -> 'id') from jsonb_array_elements(cards) c),
           reason || ':' || (trig ->> 'userId') || ':' || (trig ->> 'id'), p_now);
  effects := public.dm_issue_effects(ban);
  if n >= p_cfg.review_at_cards then
    effects := effects || jsonb_build_array(public.dm_enqueue(public.dm_review_item(
      'permanent_ban_candidate', 'high', 'permanent_ban_candidate:' || (trig ->> 'userId') || ':' || (trig ->> 'id'),
      (trig ->> 'userId')::uuid, null, nullif(trig ->> 'gameId', '')::uuid, (trig ->> 'id')::uuid, null, '[]'::jsonb,
      jsonb_build_object('activeCards', n, 'triggerReason', trig -> 'reasonCode'), p_now)));
  end if;
  return jsonb_build_object('activeCards', n,
                            'level', case when n >= p_cfg.review_at_cards then 'review' when is_long then 'join_ban_long'
                                          else 'join_ban_short' end,
                            'effects', effects);
end $$;

-- ---------------------------------------------------------------------------
-- Venue reports (trust/venues.ts)
-- ---------------------------------------------------------------------------
create function public.dm_venue_reports(p_venue jsonb, p_now timestamptz, p_cfg public.trust_config) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  vid text := p_venue ->> 'venueId';
  creator text := p_venue ->> 'createdBy';
  since timestamptz := coalesce(public.dm_ts(p_venue ->> 'lastReviewedAt'), '-infinity'::timestamptz);
  firsts jsonb;
  reporter_ids jsonb;
  n int;
  reasons jsonb;
  first jsonb;
  effects jsonb;
begin
  with counted as (
    select r, row_number() over (order by public.dm_ts(r ->> 'createdAt'), (r ->> 'id') collate "C") as ord
    from jsonb_array_elements(coalesce(p_venue -> 'reports', '[]'::jsonb)) r
    where r ->> 'venueId' = vid and (r ->> 'reporterId') is distinct from creator
      and public.dm_ts(r ->> 'createdAt') > since and public.dm_ts(r ->> 'createdAt') <= p_now
  ), firstby as (
    select distinct on (r ->> 'reporterId') r, ord from counted order by r ->> 'reporterId', ord
  )
  select coalesce(jsonb_agg(r order by ord), '[]'::jsonb),
         coalesce(jsonb_agg(r -> 'reporterId' order by (r ->> 'reporterId') collate "C"), '[]'::jsonb)
    into firsts, reporter_ids from firstby;
  n := jsonb_array_length(reporter_ids);
  if p_venue ->> 'status' <> 'active' or n < p_cfg.venue_reports_to_hide then
    return jsonb_build_object('hide', false, 'reporterIds', reporter_ids, 'effects', '[]'::jsonb);
  end if;
  select jsonb_object_agg(k, cnt) into reasons
  from (select r ->> 'reason' as k, count(*) as cnt from jsonb_array_elements(firsts) r group by 1) z;
  first := firsts -> 0;
  effects := jsonb_build_array(
    jsonb_build_object('type', 'SetVenueStatus', 'venueId', vid, 'status', 'hidden_pending_review'),
    public.dm_enqueue(public.dm_review_item('venue_reports', 'normal', 'venue_reports:' || vid || ':' || (first ->> 'id'),
      nullif(creator, '')::uuid, vid::uuid, null, null, null, '[]'::jsonb,
      jsonb_build_object('reporters', n) || reasons, p_now)));
  if creator is not null then
    effects := effects || jsonb_build_array(public.dm_notify(creator::uuid, 'venue_hidden',
      jsonb_build_object('venueId', vid, 'reporters', n), null, null));
  end if;
  return jsonb_build_object('hide', true, 'reporterIds', reporter_ids, 'effects', effects);
end $$;

-- isConfirmedFake(): > half of the distinct non-creator reporters (latest report each) chose no_venue_here.
create function public.dm_is_confirmed_fake(p_venue jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  with last_by as (
    select distinct on (r ->> 'reporterId') r
    from jsonb_array_elements(coalesce(p_venue -> 'reports', '[]'::jsonb)) with ordinality as x(r, i)
    where (r ->> 'reporterId') is distinct from (p_venue ->> 'createdBy')
    order by r ->> 'reporterId', i desc
  )
  select count(*) > 0 and count(*) filter (where r ->> 'reason' = 'no_venue_here') * 2 > count(*) from last_by
$$;

-- ---------------------------------------------------------------------------
-- Host reliability (trust/host.ts)
-- ---------------------------------------------------------------------------
create function public.dm_host_reliability(p_input jsonb, p_now timestamptz, p_cfg public.trust_config) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  host text := p_input ->> 'hostId';
  own jsonb;
  consumed timestamptz;
  ratings jsonb;
  cnt int;
  total numeric;
  avg_r numeric;
  fake text;
  low boolean;
  last jsonb;
  reason text;
  dedupe text;
  params jsonb;
  s jsonb;
  days numeric := p_cfg.host_suspension_days;
begin
  select coalesce(jsonb_agg(x), '[]'::jsonb) into own from jsonb_array_elements(coalesce(p_input -> 'sanctions', '[]'::jsonb)) x
  where x ->> 'userId' = host;
  select max(public.dm_ts(x ->> 'startsAt')) into consumed from jsonb_array_elements(own) x where x ->> 'reasonCode' = 'low_host_rating';
  consumed := coalesce(consumed, '-infinity'::timestamptz);
  with valid as (
    select r, (r ->> 'gameId') || ':' || (r ->> 'raterId') as k, public.dm_ts(r ->> 'at') as at
    from jsonb_array_elements(coalesce(p_input -> 'ratings', '[]'::jsonb)) r
    where r ->> 'hostId' = host and r ->> 'raterId' <> host
      and public.dm_ts(r ->> 'at') > consumed and public.dm_ts(r ->> 'at') <= p_now
      and public.dm_ts(r ->> 'at') > p_now - p_cfg.host_rating_lookback_days * interval '1 day'
  ), uniq as (
    select distinct on (k) r, k, at from valid order by k, at desc
  )
  select coalesce(jsonb_agg(r order by at, k collate "C"), '[]'::jsonb), count(*), coalesce(sum((r ->> 'stars')::numeric), 0)
    into ratings, cnt, total from uniq;
  avg_r := case when cnt > 0 then round(total / cnt, 2) end;
  select v into fake from jsonb_array_elements_text(coalesce(p_input -> 'confirmedFakeVenueIds', '[]'::jsonb)) v
  where not exists (select 1 from jsonb_array_elements(own) x where x ->> 'dedupeKey' = 'fake_venue:' || host || ':' || v)
  order by v collate "C" limit 1;
  low := cnt >= p_cfg.host_low_rating_min_count and total <= p_cfg.host_low_rating_max * cnt;
  if fake is null and not low then
    return jsonb_build_object('outcome', 'none', 'reasonCode', null, 'ratingCount', cnt, 'averageRating', avg_r, 'effects', '[]'::jsonb);
  end if;
  if exists (select 1 from jsonb_array_elements(own) x where x ->> 'kind' = 'host_suspension' and public.dm_in_force(x, p_now)) then
    return jsonb_build_object('outcome', 'already_suspended', 'reasonCode', null, 'ratingCount', cnt, 'averageRating', avg_r,
                              'effects', '[]'::jsonb);
  end if;
  reason := case when fake is not null then 'fake_venue' else 'low_host_rating' end;
  last := ratings -> (jsonb_array_length(ratings) - 1);
  dedupe := case when fake is not null then 'fake_venue:' || host || ':' || fake
                 else 'low_host_rating:' || host || ':' || coalesce((last ->> 'gameId') || ':' || (last ->> 'raterId'), '') end;
  params := case when fake is not null then jsonb_build_object('venueId', fake, 'days', days)
                 else jsonb_build_object('average', coalesce(avg_r, 0), 'ratings', cnt, 'days', days) end;
  s := public.dm_system_sanction('host_suspension', host::uuid, reason, params, days * 86400000, null, null, '[]'::jsonb, dedupe, p_now);
  return jsonb_build_object('outcome', 'suspend', 'reasonCode', reason, 'ratingCount', cnt, 'averageRating', avg_r,
    'effects', public.dm_issue_effects(s) || jsonb_build_array(public.dm_enqueue(public.dm_review_item(
      'host_reliability', 'normal', dedupe, host::uuid, fake::uuid, null, public.dm_sanction_id(dedupe), null, '[]'::jsonb,
      jsonb_build_object('reason', reason, 'ratingCount', cnt, 'averageRating', avg_r), p_now))));
end $$;

-- ---------------------------------------------------------------------------
-- Peer check-in (checkin/peer.ts); max 6 confirmations per confirmer
-- ---------------------------------------------------------------------------
create function public.dm_verify_peer(p_input jsonb, p_now timestamptz, p_cfg public.trust_config) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  t text := p_input ->> 'targetUserId';
  q int; recip int; blk int;
  target jsonb;
  reason text;
begin
  with conf as (
    select c, i from jsonb_array_elements(coalesce(p_input -> 'confirmations', '[]'::jsonb)) with ordinality as x(c, i)
  ), firsts as (  -- de-duplicate pairs, keep chronological order
    select distinct on (c ->> 'confirmerId', c ->> 'targetId') c, i from conf order by c ->> 'confirmerId', c ->> 'targetId', i
  ), numbered as (
    select c, row_number() over (partition by c ->> 'confirmerId' order by i) as n from firsts
  ), confirmers as (
    select distinct c ->> 'confirmerId' as cid from numbered where c ->> 'targetId' = t and n <= 6
  ), blocked as (
    select case when b ->> 'blockerId' = t then b ->> 'blockedId' else b ->> 'blockerId' end as uid
    from jsonb_array_elements(coalesce(p_input -> 'blocks', '[]'::jsonb)) b
    where b ->> 'blockerId' = t or b ->> 'blockedId' = t
  ), judged as (
    select cf.cid, p,
           cf.cid in (select uid from blocked) as is_blocked,
           exists (select 1 from conf where c ->> 'confirmerId' = t and c ->> 'targetId' = cf.cid) as reciprocal
    from confirmers cf
    left join lateral (select p from jsonb_array_elements(coalesce(p_input -> 'participants', '[]'::jsonb)) p
                       where p ->> 'userId' = cf.cid limit 1) pp on true
    where cf.cid <> t and p ->> 'status' = 'approved' and p ->> 'attendance' = 'verified'
  )
  select count(*) filter (where p ->> 'checkInMethod' in ('gps', 'qr') and not is_blocked),
         count(*) filter (where p ->> 'checkInMethod' = 'peer' and reciprocal and not is_blocked),
         count(*) filter (where p ->> 'checkInMethod' in ('gps', 'qr') and is_blocked)
    into q, recip, blk
  from judged;
  select p into target from jsonb_array_elements(coalesce(p_input -> 'participants', '[]'::jsonb)) p where p ->> 'userId' = t limit 1;
  if p_input -> 'window' is not null and jsonb_typeof(p_input -> 'window') = 'object'
     and not public.dm_check_in_open(public.dm_ts(p_input #>> '{window,startsAt}'), public.dm_ts(p_input #>> '{window,endsAt}'), p_now, p_cfg) then
    reason := 'outside_window';
  elsif target is null or target ->> 'status' <> 'approved' then
    reason := 'not_participant';
  elsif target ->> 'attendance' = 'verified' then
    reason := 'already_checked_in';
  elsif q >= p_cfg.peer_min_confirmations then
    return jsonb_build_object('confirmations', q,
      'verdict', jsonb_build_object('outcome', 'verified', 'method', 'peer', 'distanceM', null, 'signals', '[]'::jsonb));
  elsif q + recip >= p_cfg.peer_min_confirmations then
    reason := 'reciprocal_only';
  elsif q + recip + blk >= p_cfg.peer_min_confirmations then
    reason := 'blocked_pair';
  else
    reason := 'insufficient_peers';
  end if;
  return jsonb_build_object('confirmations', q, 'verdict', jsonb_build_object(
    'outcome', 'rejected', 'method', 'peer', 'reason', reason,
    'fallbacks', case when reason in ('outside_window', 'not_participant', 'already_checked_in') then '[]'::jsonb
                      else jsonb_build_array('qr', 'host') end,
    'signals', '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Toxicity reports (trust/reports.ts)
-- ---------------------------------------------------------------------------
create function public.dm_evaluate_reports(p_reports jsonb, p_profiles jsonb, p_now timestamptz, p_cfg public.trust_config,
                                           p_context jsonb default '{}'::jsonb)
returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  ctx jsonb := coalesce(p_context, '{}'::jsonb);
  target text;
  consumed timestamptz;
  win_start timestamptz := p_now - p_cfg.toxicity_window_days * interval '1 day';
  r jsonb;
  p jsonb;
  mine jsonb;
  theirs jsonb;
  excl text;
  qual_ids text[] := '{}';
  excl_ids text[] := '{}';
  counted jsonb := '[]'::jsonb;
  effects jsonb := '[]'::jsonb;
  qualifying jsonb;
  n int;
  indep int := 0;
  win_start_c timestamptz := '-infinity';
  ts timestamptz;
  reasons text[] := '{}';
  games int;
  only_game text;
  team_set jsonb;
  target_team jsonb;
  first_id text;
  evidence jsonb;
  collusion boolean;
  restriction jsonb;
  outcome text := 'none';
  counted_ids jsonb;
begin
  select x into r from jsonb_array_elements(coalesce(p_reports, '[]'::jsonb)) x
  order by public.dm_ts(x ->> 'createdAt') desc, (x ->> 'id') collate "C" desc limit 1;
  if r is null then
    return jsonb_build_object('outcome', 'none', 'targetUserId', null, 'qualifyingReporterIds', '[]'::jsonb,
                              'countedReportIds', '[]'::jsonb, 'effects', '[]'::jsonb);
  end if;
  target := r ->> 'targetUserId';
  select max(public.dm_ts(s ->> 'startsAt')) into consumed from jsonb_array_elements(coalesce(ctx -> 'sanctions', '[]'::jsonb)) s
  where s ->> 'userId' = target and s ->> 'reasonCode' = 'toxicity_reports';
  consumed := coalesce(consumed, '-infinity'::timestamptz);

  for r in select x from jsonb_array_elements(coalesce(p_reports, '[]'::jsonb)) x
           where x ->> 'targetUserId' = target
             and public.dm_ts(x ->> 'createdAt') > win_start and public.dm_ts(x ->> 'createdAt') <= p_now
             and public.dm_ts(x ->> 'createdAt') > consumed
           order by public.dm_ts(x ->> 'createdAt'), (x ->> 'id') collate "C"
  loop
    select x into p from jsonb_array_elements(coalesce(p_profiles, '[]'::jsonb)) x where x ->> 'id' = r ->> 'reporterId' limit 1;
    select x into mine from jsonb_array_elements(coalesce(ctx -> 'attendance', '[]'::jsonb)) x
      where x ->> 'gameId' = r ->> 'gameId' and x ->> 'userId' = r ->> 'reporterId' limit 1;
    select x into theirs from jsonb_array_elements(coalesce(ctx -> 'attendance', '[]'::jsonb)) x
      where x ->> 'gameId' = r ->> 'gameId' and x ->> 'userId' = target limit 1;
    excl := case
      when r ->> 'reporterId' = target then 'self'
      when p is null then 'unknown_profile'
      when p ->> 'reliabilityStatus' = 'red' then 'red_status'
      when coalesce((p ->> 'reportsLast7d')::int, 0) > 10 then 'spamming'
      when coalesce((p ->> 'reportsResolved')::int, 0) >= 5
           and coalesce((p ->> 'reportsUpheld')::numeric, 0) < p_cfg.reporter_min_accuracy * (p ->> 'reportsResolved')::int then 'low_accuracy'
      when public.dm_ts(r ->> 'createdAt') - public.dm_ts(p ->> 'createdAt') < p_cfg.min_reporter_account_age_days * interval '1 day' then 'account_too_new'
      when r ->> 'gameId' is null then 'not_co_attendee'
      when theirs ->> 'status' = 'approved' and mine ->> 'status' = 'approved'
           and (mine ->> 'attendance' = 'verified' or r ->> 'messageId' is not null) then null
      else 'not_co_attendee' end;
    if excl is null then
      if not (r ->> 'reporterId' = any (qual_ids)) then qual_ids := qual_ids || (r ->> 'reporterId'); end if;
      excl_ids := array_remove(excl_ids, r ->> 'reporterId');
      counted := counted || jsonb_build_array(r);
    elsif not (r ->> 'reporterId' = any (qual_ids)) and not (r ->> 'reporterId' = any (excl_ids)) then
      excl_ids := excl_ids || (r ->> 'reporterId');
    end if;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(u) order by u collate "C"), '[]'::jsonb) into qualifying from unnest(qual_ids) u;
  select coalesce(jsonb_agg(c -> 'id'), '[]'::jsonb) into counted_ids from jsonb_array_elements(counted) c;
  n := cardinality(qual_ids);
  -- independentCount(): greedy window cover of the qualifying reporters' account creation times.
  for ts in select public.dm_ts(x ->> 'createdAt') from jsonb_array_elements(coalesce(p_profiles, '[]'::jsonb)) x
            where x ->> 'id' = any (qual_ids) order by 1 loop
    if ts - win_start_c > p_cfg.collusion_creation_window_hours * interval '1 hour' then
      indep := indep + 1;
      win_start_c := ts;
    end if;
  end loop;

  -- Severe categories (TRUST-045): each counted report → high-priority review due in 1 h.
  for r in select c from jsonb_array_elements(counted) c where c ->> 'category' = 'violence' loop
    effects := effects || jsonb_build_array(public.dm_enqueue(jsonb_set(
      public.dm_review_item('toxicity_reports', 'high', 'severe_report:' || (r ->> 'id'), target::uuid, null,
        nullif(r ->> 'gameId', '')::uuid, null, null, jsonb_build_array(r -> 'id'),
        jsonb_build_object('category', r -> 'category', 'severe', true), p_now),
      '{dueBy}', to_jsonb(public.dm_iso(p_now + interval '1 hour')))));
  end loop;

  if n < p_cfg.toxicity_reporters then
    return jsonb_build_object('outcome', 'none', 'targetUserId', target, 'qualifyingReporterIds', qualifying,
                              'countedReportIds', counted_ids, 'independentReporters', indep, 'effects', effects);
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(ctx -> 'sanctions', '[]'::jsonb)) s
             where s ->> 'userId' = target and s ->> 'reasonCode' = 'toxicity_reports'
               and s ->> 'kind' = 'visibility_restriction' and public.dm_in_force(s, p_now)) then
    return jsonb_build_object('outcome', 'already_restricted', 'targetUserId', target, 'qualifyingReporterIds', qualifying,
                              'countedReportIds', counted_ids, 'independentReporters', indep, 'effects', effects);
  end if;

  if indep < p_cfg.toxicity_reporters then reasons := reasons || 'creation_window'::text; end if;
  select count(distinct c ->> 'gameId') into games from jsonb_array_elements(counted) c;
  only_game := counted #>> '{0,gameId}';
  if games = 1 and only_game is not null then
    select coalesce(jsonb_agg(distinct coalesce(a -> 'team', 'null'::jsonb)), '[]'::jsonb) into team_set
    from unnest(qual_ids) u
    left join lateral (select x from jsonb_array_elements(coalesce(ctx -> 'attendance', '[]'::jsonb)) x
                       where x ->> 'gameId' = only_game and x ->> 'userId' = u limit 1) z(a) on true;
    select coalesce(x -> 'team', 'null'::jsonb) into target_team from jsonb_array_elements(coalesce(ctx -> 'attendance', '[]'::jsonb)) x
      where x ->> 'gameId' = only_game and x ->> 'userId' = target limit 1;
    target_team := coalesce(target_team, 'null'::jsonb);
    if jsonb_array_length(team_set) = 1 and team_set -> 0 <> 'null'::jsonb and target_team <> 'null'::jsonb
       and target_team <> team_set -> 0 then
      reasons := reasons || 'rival_team'::text;
    end if;
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(ctx -> 'overturns', '[]'::jsonb)) o
             where public.dm_ts(o ->> 'at') > p_now - p_cfg.post_overturn_protection_days * interval '1 day'
               and o ->> 'sanctionId' in (select s ->> 'id' from jsonb_array_elements(coalesce(ctx -> 'sanctions', '[]'::jsonb)) s
                                          where s ->> 'userId' = target and s ->> 'reasonCode' = 'toxicity_reports')) then
    reasons := reasons || 'overturn_protection'::text;
  end if;

  first_id := counted #>> '{0,id}';
  collusion := exists (select 1 from unnest(reasons) x where x <> 'overturn_protection');
  evidence := jsonb_build_object('reporters', n, 'independentReporters', indep, 'windowDays', p_cfg.toxicity_window_days,
                                 'excludedReporters', cardinality(excl_ids), 'collusionSuspected', collusion,
                                 'reviewReasons', array_to_string(reasons, ','));
  if cardinality(reasons) > 0 then
    effects := effects || jsonb_build_array(public.dm_enqueue(public.dm_review_item(
      case when collusion then 'collusion_suspected' else 'toxicity_reports' end, 'normal',
      case when collusion then 'collusion_suspected' else 'protected_reports' end || ':' || target || ':' || first_id,
      target::uuid, null, null, null, null, counted_ids, evidence, p_now)));
    outcome := 'review_only';
  else
    restriction := public.dm_system_sanction('visibility_restriction', target::uuid, 'toxicity_reports',
      jsonb_build_object('reporters', n, 'windowDays', p_cfg.toxicity_window_days, 'hours', p_cfg.visibility_restriction_hours),
      p_cfg.visibility_restriction_hours * 3600000, null, null, '[]'::jsonb,
      'toxicity_reports:' || target || ':' || first_id, p_now);
    effects := effects || public.dm_issue_effects(restriction) || jsonb_build_array(public.dm_enqueue(public.dm_review_item(
      'toxicity_reports', 'normal', 'toxicity_reports:' || target || ':' || first_id, target::uuid, null, null,
      public.dm_sanction_id(restriction ->> 'dedupeKey'), null, counted_ids, evidence, p_now)));
    outcome := 'restrict';
  end if;
  return jsonb_build_object('outcome', outcome, 'targetUserId', target, 'qualifyingReporterIds', qualifying,
                            'countedReportIds', counted_ids, 'independentReporters', indep,
                            'reviewReasons', to_jsonb(reasons), 'effects', effects);
end $$;

-- ---------------------------------------------------------------------------
-- Waitlist offers (games/waitlist.ts)
-- ---------------------------------------------------------------------------
create function public.dm_waitlist(p_input jsonb, p_now timestamptz, p_cfg public.trust_config) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  g jsonb := p_input -> 'game';
  start_t timestamptz := public.dm_ts(g ->> 'startsAt');
  lead interval;
  mode text;
  spots int;
  active int;
  accept_by timestamptz;
  offers jsonb := '[]'::jsonb;
  effects jsonb := '[]'::jsonb;
  w record;
begin
  lead := start_t - p_now;
  mode := case when g ->> 'status' <> 'scheduled' or lead <= interval '0' then 'closed'
               when lead < p_cfg.waitlist_flash_fill_hours * interval '1 hour' then 'flash'
               when lead <= p_cfg.waitlist_long_threshold_hours * interval '1 hour' then 'short'
               else 'standard' end;
  select greatest(0, (g ->> 'capacity')::int - count(*) filter (where p ->> 'status' = 'approved')) into spots
  from jsonb_array_elements(coalesce(p_input -> 'participants', '[]'::jsonb)) p;
  if mode = 'closed' or spots = 0 then
    return jsonb_build_object('mode', mode, 'freeSpots', spots, 'offers', offers, 'effects', effects);
  end if;
  with q as (
    select p ->> 'userId' as uid,
           row_number() over (order by case when coalesce(p_input -> 'regularIds', '[]'::jsonb) ? (p ->> 'userId') then 0 else 1 end,
                                       coalesce((p ->> 'waitlistRank')::bigint, 9007199254740991),
                                       public.dm_ts(p ->> 'requestedAt'), (p ->> 'userId') collate "C") as ord
    from jsonb_array_elements(coalesce(p_input -> 'participants', '[]'::jsonb)) p where p ->> 'status' = 'waitlisted'
  ), o as (
    select x from jsonb_array_elements(coalesce(p_input -> 'offers', '[]'::jsonb)) x where x ->> 'userId' in (select uid from q)
  )
  select count(distinct x ->> 'userId') filter (where public.dm_ts(x ->> 'acceptBy') > p_now) into active from o;
  if mode = 'flash' then
    accept_by := start_t;
  else
    accept_by := least(p_now + case when mode = 'standard' then p_cfg.waitlist_confirm_long_minutes
                                    else p_cfg.waitlist_confirm_short_minutes end * interval '1 minute', start_t);
  end if;
  for w in
    with q as (
      select p ->> 'userId' as uid,
             row_number() over (order by case when coalesce(p_input -> 'regularIds', '[]'::jsonb) ? (p ->> 'userId') then 0 else 1 end,
                                         coalesce((p ->> 'waitlistRank')::bigint, 9007199254740991),
                                         public.dm_ts(p ->> 'requestedAt'), (p ->> 'userId') collate "C") as ord
      from jsonb_array_elements(coalesce(p_input -> 'participants', '[]'::jsonb)) p where p ->> 'status' = 'waitlisted'
    ), o as (
      select x from jsonb_array_elements(coalesce(p_input -> 'offers', '[]'::jsonb)) x where x ->> 'userId' in (select uid from q)
    )
    select q.uid from q
    where case when mode = 'flash'
               then not exists (select 1 from o where x ->> 'userId' = q.uid and public.dm_ts(x ->> 'acceptBy') > p_now)
               else not exists (select 1 from o where x ->> 'userId' = q.uid) end
    order by q.ord
    limit case when mode = 'flash' then null else greatest(0, spots - active) end
  loop
    offers := offers || jsonb_build_array(jsonb_build_object('userId', w.uid, 'offeredAt', public.dm_iso(p_now),
                                                             'acceptBy', public.dm_iso(accept_by), 'mode', mode));
    effects := effects || jsonb_build_array(public.dm_notify(w.uid::uuid, 'waitlist_offer',
      jsonb_build_object('offer', 1, 'mode', mode, 'acceptBy', public.dm_iso(accept_by)), (g ->> 'id')::uuid, null));
  end loop;
  return jsonb_build_object('mode', mode, 'freeSpots', spots, 'offers', offers, 'effects', effects);
end $$;

-- ---------------------------------------------------------------------------
-- Attendance finalisation (trust/attendance.ts), at endsAt + finalizeAfterEndHours
-- ---------------------------------------------------------------------------
create function public.dm_process_no_shows(p_input jsonb, p_now timestamptz, p_cfg public.trust_config) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  g jsonb := p_input -> 'game';
  gid text := g ->> 'id';
  verified int;
  threshold int;
  happened boolean;
  effects jsonb := '[]'::jsonb;
  events jsonb := '[]'::jsonb;
  p jsonb;
  refilled boolean;
begin
  select count(*) into verified from jsonb_array_elements(coalesce(p_input -> 'participants', '[]'::jsonb)) x
  where x ->> 'status' = 'approved' and x ->> 'attendance' = 'verified';
  if g ->> 'status' = 'cancelled' or p_now < public.dm_ts(g ->> 'endsAt') + p_cfg.finalize_after_end_hours * interval '1 hour' then
    return jsonb_build_object('finalized', false, 'gameHappened', null, 'verifiedCount', verified,
                              'effects', effects, 'events', events);
  end if;
  threshold := greatest(2, ceil(coalesce((p_input ->> 'minPlayers')::numeric, 0) / 2)::int);
  happened := verified >= threshold;
  if not happened then
    for p in select x from jsonb_array_elements(coalesce(p_input -> 'participants', '[]'::jsonb)) x
             where x ->> 'status' = 'approved' order by (x ->> 'userId') collate "C" loop
      if p ->> 'attendance' = 'unknown' then
        effects := effects || jsonb_build_array(jsonb_build_object('type', 'SetAttendance', 'gameId', gid, 'userId', p -> 'userId',
                                                                   'attendance', 'excused'));
      end if;
      effects := effects || jsonb_build_array(jsonb_build_object('type', 'SettleDeposit', 'gameId', gid, 'userId', p -> 'userId',
                                                                 'outcome', 'release'));
    end loop;
    for p in select x from jsonb_array_elements(coalesce(p_input -> 'participants', '[]'::jsonb)) x
             where x ->> 'status' = 'cancelled' and coalesce((x ->> 'lateCancel')::boolean, false) and x ->> 'cancelledAt' is not null
             order by (x ->> 'userId') collate "C" loop
      effects := effects || jsonb_build_array(jsonb_build_object('type', 'SettleDeposit', 'gameId', gid, 'userId', p -> 'userId',
                                                                 'outcome', 'release'));
    end loop;
    effects := effects || jsonb_build_array(public.dm_enqueue(public.dm_review_item('host_reliability', 'normal',
      'game_not_happened:' || gid, (g ->> 'hostId')::uuid, null, gid::uuid, null, null, '[]'::jsonb,
      jsonb_build_object('reason', 'game_not_happened', 'verifiedCount', verified, 'threshold', threshold), p_now)));
    return jsonb_build_object('finalized', true, 'gameHappened', false, 'verifiedCount', verified,
                              'effects', effects, 'events', events);
  end if;
  for p in select x from jsonb_array_elements(coalesce(p_input -> 'participants', '[]'::jsonb)) x
           where x ->> 'status' = 'approved' and x ->> 'userId' <> g ->> 'hostId' order by (x ->> 'userId') collate "C" loop
    if p ->> 'attendance' = 'unknown' then
      effects := effects || jsonb_build_array(jsonb_build_object('type', 'SetAttendance', 'gameId', gid, 'userId', p -> 'userId',
                                                                 'attendance', 'no_show_unverified'));
    end if;
    events := events || jsonb_build_array(jsonb_build_object('type', 'AttendanceFinalized', 'gameId', gid, 'userId', p -> 'userId',
      'attendance', case when p ->> 'attendance' = 'unknown' then 'no_show_unverified' else p ->> 'attendance' end,
      'endsAt', g -> 'endsAt'));
  end loop;
  for p in select x from jsonb_array_elements(coalesce(p_input -> 'participants', '[]'::jsonb)) x
           where x ->> 'status' = 'cancelled' and coalesce((x ->> 'lateCancel')::boolean, false) and x ->> 'cancelledAt' is not null
           order by (x ->> 'userId') collate "C" loop
    select exists (
      select 1 from jsonb_array_elements(coalesce(p_input -> 'refills', '[]'::jsonb)) rf
      join lateral (select x from jsonb_array_elements(p_input -> 'participants') x
                    where x ->> 'userId' = rf ->> 'replacementUserId' limit 1) rep(x) on true
      where rf ->> 'cancelledUserId' = p ->> 'userId'
        and public.dm_ts(rf ->> 'promotedAt') >= public.dm_ts(p ->> 'cancelledAt')
        and public.dm_ts(rf ->> 'promotedAt') < public.dm_ts(g ->> 'startsAt')
        and rep.x ->> 'status' = 'approved' and rep.x ->> 'attendance' = 'verified') into refilled;
    events := events || jsonb_build_array(jsonb_build_object('type', 'LateCancelFinalized', 'gameId', gid, 'userId', p -> 'userId',
      'startsAt', g -> 'startsAt', 'cancelledAt', p -> 'cancelledAt', 'refilled', refilled));
  end loop;
  return jsonb_build_object('finalized', true, 'gameHappened', true, 'verifiedCount', verified, 'effects', effects, 'events', events);
end $$;

-- Engine handlers for the finalisation events (engine.ts: AttendanceFinalized / LateCancelFinalized).
create function public.dm_finalization_effects(p_event jsonb, p_now timestamptz, p_cfg public.trust_config) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  u uuid := (p_event ->> 'userId')::uuid;
  g uuid := (p_event ->> 'gameId')::uuid;
  starts timestamptz := public.dm_ts(p_event ->> 'startsAt');
  cancelled timestamptz := public.dm_ts(p_event ->> 'cancelledAt');
begin
  if p_event ->> 'type' = 'AttendanceFinalized' then
    if p_event ->> 'attendance' = 'no_show_unverified' then
      return public.dm_yellow_card(u, 'no_show', g, '{}'::jsonb, p_now, p_cfg);
    elsif p_event ->> 'attendance' in ('verified', 'excused') then
      return jsonb_build_array(jsonb_build_object('type', 'SettleDeposit', 'gameId', g, 'userId', u, 'outcome', 'release'));
    end if;
    return '[]'::jsonb;
  elsif p_event ->> 'type' = 'LateCancelFinalized' then
    if not (starts - cancelled < p_cfg.late_cancel_window_hours * interval '1 hour') then return '[]'::jsonb; end if;
    if (p_event ->> 'refilled')::boolean then
      return jsonb_build_array(
        jsonb_build_object('type', 'SettleDeposit', 'gameId', g, 'userId', u, 'outcome', 'release'),
        jsonb_build_object('type', 'Audit', 'action', 'late_cancel.refilled', 'subjectUserId', u, 'data', jsonb_build_object('gameId', g)));
    end if;
    return public.dm_yellow_card(u, 'late_cancel', g,
      jsonb_build_object('windowHours', p_cfg.late_cancel_window_hours,
                         'minutesBeforeStart', round(extract(epoch from starts - cancelled) / 60)::int), p_now, p_cfg);
  end if;
  return '[]'::jsonb;
end $$;
