-- 0106_domain_mirror_phase15.sql (Phase 1.5, contract v3)
-- Pure SQL mirrors of packages/domain/src/{series,vault,network} (same camelCase JSON in → same
-- JSON out, effects in order), pinned by the series.* / vault.* / network.* golden cases. The
-- series generation and auto-join jobs (0100), create_upload_intent / set_visibility (0103) and the
-- friend RPCs (0104) run these same rules. The rating mirrors live in 0102.

-- ---------------------------------------------------------------------------
-- Series (series/schedule.ts, occurrences.ts, roster.ts)
-- ---------------------------------------------------------------------------

-- slotDatesInRange(): slot dates whose start lies in (p_from, p_to], widened by a local day each side.
create function public.dm_slot_dates_in_range(p_series jsonb, p_from timestamptz, p_to timestamptz) returns setof date
language sql stable set search_path = ''
as $$
  select d
  from public.st_series_slots(
         (p_series ->> 'anchorDate')::date, (p_series ->> 'recurrence')::public.series_recurrence,
         nullif(p_series ->> 'endDate', '')::date,
         (p_from at time zone (p_series ->> 'timeZone'))::date - 1,
         (p_to at time zone (p_series ->> 'timeZone'))::date + 1) d
  where public.st_local_to_utc(d, (p_series ->> 'startTime')::time, p_series ->> 'timeZone') > p_from
    and public.st_local_to_utc(d, (p_series ->> 'startTime')::time, p_series ->> 'timeZone') <= p_to
  order by d
$$;

-- buildOccurrence(series, slotDate, now) → SeriesOccurrence.
create function public.dm_build_occurrence(p_series jsonb, p_slot date, p15 public.phase15_config, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  starts timestamptz := public.st_local_to_utc(p_slot, (p_series ->> 'startTime')::time, p_series ->> 'timeZone');
  opens timestamptz;
  k text := (p_series ->> 'id') || ':' || (p_series ->> 'scheduleRevision') || ':' || to_char(p_slot, 'YYYY-MM-DD');
begin
  opens := least(starts, greatest(starts - (p_series ->> 'horizonWeeks')::int * interval '168 hours', p_now));
  return jsonb_build_object(
    'seriesId', p_series ->> 'id', 'occurrenceKey', k, 'slotDate', to_char(p_slot, 'YYYY-MM-DD'),
    'scheduleRevision', (p_series -> 'scheduleRevision'), 'gameId', public.dm_stable_uuid('occurrence:' || k),
    'startsAt', public.dm_iso(starts),
    'endsAt', public.dm_iso(starts + (p_series ->> 'durationMinutes')::numeric * interval '1 minute'),
    'opensAt', public.dm_iso(opens),
    'priorityUntil', public.dm_iso(least(opens + (p_series ->> 'rosterPriorityHours')::numeric * interval '1 hour', starts)),
    'reconfirmAt', public.dm_iso(starts - (p_series ->> 'autoJoinReconfirmHours')::numeric * interval '1 hour'),
    'releaseAt', public.dm_iso(starts - p15.auto_join_release_hours * interval '1 hour'),
    'status', 'scheduled', 'overridden', false);
end $$;

-- planSeriesOccurrences(SeriesPlanInput, now) → SeriesPlan { occurrences, effects }.
create function public.dm_plan_series_occurrences(p_input jsonb, p15 public.phase15_config, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  s jsonb := p_input -> 'series';
  rev jsonb := p_input -> 'series' -> 'scheduleRevision';
  horizon_end timestamptz := p_now + (p_input #>> '{series,horizonWeeks}')::int * interval '168 hours';
  d date;
  occ jsonb;
  occs jsonb := '[]'::jsonb;
  effects jsonb := '[]'::jsonb;
  m record;
  seats int;
begin
  if s ->> 'status' <> 'active' then return jsonb_build_object('occurrences', occs, 'effects', effects); end if;
  for d in select x from public.dm_slot_dates_in_range(s, p_now, horizon_end) x loop
    continue when exists (select 1 from jsonb_array_elements(coalesce(p_input -> 'existing', '[]'::jsonb)) e
                          where e ->> 'slotDate' = to_char(d, 'YYYY-MM-DD')
                            and (e -> 'scheduleRevision' = rev or e ->> 'status' = 'scheduled'))
               or coalesce(s -> 'skippedDates', '[]'::jsonb) @> jsonb_build_array(to_char(d, 'YYYY-MM-DD'));
    occ := public.dm_build_occurrence(s, d, p15, p_now);
    occs := occs || jsonb_build_array(occ);
    effects := effects || jsonb_build_array(jsonb_build_object(
      'type', 'CreateOccurrence', 'occurrence', occ,
      'game', jsonb_build_object(
        'id', occ ->> 'gameId', 'seriesId', s ->> 'id', 'hostId', s ->> 'hostId', 'sport', s -> 'sport', 'title', s -> 'title',
        'notes', s -> 'notes', 'visibility', s -> 'visibility', 'venueId', s -> 'venueId', 'location', s -> 'location',
        'approxLocation', s -> 'approxLocation', 'hideExactLocation', s -> 'hideExactLocation', 'capacity', s -> 'capacity',
        'minPlayers', s -> 'minPlayers', 'depositMinor', s -> 'depositMinor', 'currency', s -> 'currency',
        'depositForfeitTo', s -> 'depositForfeitTo', 'womenOnly', s -> 'womenOnly', 'teamCount', s -> 'teamCount',
        'startsAt', occ -> 'startsAt', 'endsAt', occ -> 'endsAt'),
      'dedupeKey', 'occurrence:' || (occ ->> 'occurrenceKey')));
    continue when p_now >= public.dm_ts(occ ->> 'reconfirmAt');
    seats := greatest(0, (s ->> 'capacity')::int - 1);
    for m in select r ->> 'userId' as uid
             from jsonb_array_elements(coalesce(p_input -> 'roster', '[]'::jsonb)) r
             where r ->> 'status' = 'regular' and coalesce((r ->> 'alwaysIn')::boolean, false)
               and r ->> 'userId' <> s ->> 'hostId'
               and not (coalesce(p_input -> 'ineligibleUserIds', '[]'::jsonb) @> jsonb_build_array(r ->> 'userId'))
             order by (r ->> 'joinedAt') collate "C", (r ->> 'userId') collate "C" loop
      effects := effects || jsonb_build_array(jsonb_build_object(
        'type', 'AutoJoin', 'gameId', occ ->> 'gameId', 'seriesId', s ->> 'id', 'userId', m.uid,
        'joinedAs', case when seats > 0 then 'approved' else 'waitlisted' end,
        'dedupeKey', 'autojoin:' || (occ ->> 'gameId') || ':' || m.uid));
      if seats > 0 then seats := seats - 1; end if;
    end loop;
  end loop;
  return jsonb_build_object('occurrences', occs, 'effects', effects);
end $$;

-- occurrenceJoinPhase() + checkOccurrenceJoinWindow() → Result<'roster_only' | 'open', 'game_not_open'>.
create function public.dm_occurrence_join_window(p_input jsonb, p_now timestamptz) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  o jsonb := p_input -> 'occurrence';
  phase text;
  regular boolean;
begin
  phase := case when o ->> 'status' <> 'scheduled' or p_now >= public.dm_ts(o ->> 'startsAt') then 'closed'
                when p_now < public.dm_ts(o ->> 'opensAt') then 'not_open'
                when p_now < public.dm_ts(o ->> 'priorityUntil') then 'roster_only'
                else 'open' end;
  regular := p_input ->> 'userId' = p_input #>> '{series,hostId}' or exists (
    select 1 from jsonb_array_elements(coalesce(p_input -> 'roster', '[]'::jsonb)) r
    where r ->> 'userId' = p_input ->> 'userId' and r ->> 'status' = 'regular');
  if phase in ('closed', 'not_open') or (phase = 'roster_only' and not regular) then
    return jsonb_build_object('ok', false, 'error', 'game_not_open');
  end if;
  return jsonb_build_object('ok', true, 'value', phase);
end $$;

-- processAutoJoins({ series, occurrence, autoJoins, roster }, now) → { effects }.
create function public.dm_process_auto_joins(p_input jsonb, p15 public.phase15_config, p_now timestamptz) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  o jsonb := p_input -> 'occurrence';
  sid text := p_input #>> '{series,id}';
  title jsonb := p_input #> '{series,title}';
  releasing boolean;
  r jsonb;
  m jsonb;
  misses int;
  offer boolean;
  effects jsonb := '[]'::jsonb;
begin
  if o ->> 'status' <> 'scheduled' or p_now >= public.dm_ts(o ->> 'startsAt') or p_now < public.dm_ts(o ->> 'reconfirmAt') then
    return jsonb_build_object('effects', effects);
  end if;
  releasing := p_now >= public.dm_ts(o ->> 'releaseAt');
  for r in select x from jsonb_array_elements(coalesce(p_input -> 'autoJoins', '[]'::jsonb)) x
           where coalesce(x ->> 'releasedAt', '') = '' and coalesce(x ->> 'reconfirmedAt', '') = ''
           order by (x ->> 'userId') collate "C" loop
    if not releasing then
      continue when coalesce(r ->> 'reconfirmRequestedAt', '') <> '';
      effects := effects || jsonb_build_array(
        jsonb_build_object('type', 'RequestReconfirm', 'gameId', r ->> 'gameId', 'userId', r ->> 'userId', 'deadline', o -> 'releaseAt',
                           'dedupeKey', 'reconfirm:' || (r ->> 'gameId') || ':' || (r ->> 'userId')),
        jsonb_build_object('type', 'Notify15', 'userId', r ->> 'userId', 'kind', 'series_reconfirm',
                           'params', jsonb_build_object('seriesTitle', title, 'startsAt', o -> 'startsAt', 'deadline', o -> 'releaseAt'),
                           'gameId', r ->> 'gameId', 'seriesId', sid,
                           'dedupeKey', 'notify:series_reconfirm:' || (r ->> 'gameId') || ':' || (r ->> 'userId')));
      continue;
    end if;
    effects := effects || jsonb_build_array(
      jsonb_build_object('type', 'ReleaseAutoJoin', 'gameId', r ->> 'gameId', 'userId', r ->> 'userId',
                         'dedupeKey', 'release:' || (r ->> 'gameId') || ':' || (r ->> 'userId')),
      jsonb_build_object('type', 'Notify15', 'userId', r ->> 'userId', 'kind', 'series_auto_released',
                         'params', jsonb_build_object('seriesTitle', title, 'startsAt', o -> 'startsAt'),
                         'gameId', r ->> 'gameId', 'seriesId', sid,
                         'dedupeKey', 'notify:series_auto_released:' || (r ->> 'gameId') || ':' || (r ->> 'userId')));
    select x into m from jsonb_array_elements(coalesce(p_input -> 'roster', '[]'::jsonb)) x where x ->> 'userId' = r ->> 'userId' limit 1;
    continue when m is null or coalesce(r ->> 'reconfirmRequestedAt', '') = '';
    misses := (m ->> 'consecutiveMisses')::int + 1;
    offer := misses >= p15.roster_misses_before_leave_offer and coalesce(m ->> 'leaveOfferedAt', '') = '';
    effects := effects || jsonb_build_array(jsonb_build_object(
      'type', 'UpdateRosterMember', 'seriesId', sid, 'userId', r ->> 'userId',
      'patch', case when offer then jsonb_build_object('consecutiveMisses', misses, 'leaveOfferedAt', public.dm_iso(p_now))
                    else jsonb_build_object('consecutiveMisses', misses) end,
      'dedupeKey', 'roster-miss:' || sid || ':' || (r ->> 'userId') || ':' || (r ->> 'gameId')));
    if offer then
      effects := effects || jsonb_build_array(jsonb_build_object(
        'type', 'Notify15', 'userId', r ->> 'userId', 'kind', 'roster_leave_offer',
        'params', jsonb_build_object('seriesTitle', title, 'misses', misses), 'gameId', null, 'seriesId', sid,
        'dedupeKey', 'notify:roster_leave_offer:' || sid || ':' || (r ->> 'userId') || ':' || (r ->> 'gameId')));
    end if;
  end loop;
  return jsonb_build_object('effects', effects);
end $$;

-- ---------------------------------------------------------------------------
-- Media Vault (vault/index.ts)
-- ---------------------------------------------------------------------------

-- checkMediaUpload(MediaUploadCheckInput, now) → Result<{ maxBytes }, MediaRejectReason>.
create function public.dm_check_media_upload(p_input jsonb, p15 public.phase15_config, p_now timestamptz) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  rq jsonb := p_input -> 'request';
  kind text := p_input #>> '{request,kind}';
  dur jsonb := p_input #> '{request,durationSeconds}';
  size numeric := (p_input #>> '{request,sizeBytes}')::numeric;
  max_bytes numeric;
  reason text;
begin
  max_bytes := (case when kind = 'photo' then p15.media_photo_max_mb else p15.media_video_max_mb end) * 1048576;
  reason := case
    when not coalesce((p_input ->> 'verifiedAttendee')::boolean, false) then 'not_verified_attendee'
    when p_now < public.dm_ts(p_input #>> '{game,startsAt}') then 'window_not_open'
    when p_now > public.dm_ts(p_input #>> '{game,endsAt}') + p15.media_upload_after_end_hours * interval '1 hour' then 'window_closed'
    when kind is null or kind not in ('photo', 'video') or rq ->> 'mimeType' is null
         or not (lower(rq ->> 'mimeType') = any (case kind
               when 'photo' then array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']
               else array['video/mp4', 'video/quicktime', 'video/webm'] end)) then 'unsupported_type'
    when kind = 'video' and (dur is null or jsonb_typeof(dur) <> 'number' or not ((dur #>> '{}')::numeric >= 0)) then 'unsupported_type'
    when size is null or not (size > 0) or size > max_bytes then 'too_large'
    when kind = 'video' and (dur #>> '{}')::numeric > p15.media_video_max_seconds then 'too_long'
    when (p_input ->> 'existingCount')::int >= p15.media_max_items_per_user_per_game then 'user_cap_reached'
  end;
  if reason is not null then return jsonb_build_object('ok', false, 'error', reason); end if;
  return jsonb_build_object('ok', true, 'value', jsonb_build_object('maxBytes', max_bytes));
end $$;

-- consentBlockers(tags) → sorted user ids (requested, declined, removed with a veto).
create function public.dm_consent_blockers(p_tags jsonb) returns jsonb
language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_agg(t ->> 'userId' order by (t ->> 'userId') collate "C"), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_tags, '[]'::jsonb)) t
  where t ->> 'status' in ('requested', 'declined')
     or (t ->> 'status' = 'removed' and coalesce((t ->> 'vetoPublic')::boolean, false))
$$;

-- withVisibility(): applies effectiveMediaVisibility and appends SetMediaVisibility on a change.
create function public.dm_with_media_visibility(p_item jsonb, p_tags jsonb, p_effects jsonb, p_now timestamptz) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  v text := case when coalesce((p_item ->> 'publicOptIn')::boolean, false) and p_item ->> 'status' = 'published'
                      and jsonb_array_length(public.dm_consent_blockers(p_tags)) = 0 then 'venue_public' else 'participants' end;
begin
  if v = p_item ->> 'visibility' then
    return jsonb_build_object('item', p_item, 'tags', p_tags, 'effects', p_effects);
  end if;
  return jsonb_build_object('item', p_item || jsonb_build_object('visibility', v), 'tags', p_tags,
    'effects', p_effects || jsonb_build_array(jsonb_build_object('type', 'SetMediaVisibility', 'mediaId', p_item -> 'id',
      'visibility', v, 'dedupeKey', 'media-visibility:' || (p_item ->> 'id') || ':' || v || ':' || public.dm_iso(p_now))));
end $$;

-- requestMediaVisibility({ item, tags, requested, actorId }, now).
create function public.dm_request_media_visibility(p_input jsonb, p_now timestamptz) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  item jsonb := p_input -> 'item';
  ch jsonb;
begin
  if p_input ->> 'actorId' is distinct from item ->> 'uploaderId' then return jsonb_build_object('ok', false, 'error', 'not_uploader'); end if;
  if item ->> 'status' in ('blocked', 'removed') then return jsonb_build_object('ok', false, 'error', 'not_published'); end if;
  ch := public.dm_with_media_visibility(item || jsonb_build_object('publicOptIn', p_input ->> 'requested' = 'venue_public'),
                                        coalesce(p_input -> 'tags', '[]'::jsonb), '[]'::jsonb, p_now);
  return jsonb_build_object('ok', true, 'value', ch || jsonb_build_object('pendingUserIds',
    case when p_input ->> 'requested' = 'venue_public' then public.dm_consent_blockers(p_input -> 'tags') else '[]'::jsonb end));
end $$;

-- applyMediaVerdict({ item, tags, verdict }, now) → { item, tags, effects }.
create function public.dm_apply_media_verdict(p_input jsonb, p_now timestamptz) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  item jsonb := p_input -> 'item';
  tags jsonb := coalesce(p_input -> 'tags', '[]'::jsonb);
  v jsonb := p_input -> 'verdict';
  id text := p_input #>> '{item,id}';
  effects jsonb;
begin
  if item ->> 'status' <> 'processing' then return jsonb_build_object('item', item, 'tags', tags, 'effects', '[]'::jsonb); end if;
  if v ->> 'decision' = 'publish' then
    return public.dm_with_media_visibility(item || jsonb_build_object('status', 'published', 'publishedAt', public.dm_iso(p_now)), tags,
      jsonb_build_array(jsonb_build_object('type', 'SetMediaStatus', 'mediaId', item -> 'id', 'status', 'published',
                                           'dedupeKey', 'media-status:' || id || ':published')), p_now);
  end if;
  effects := jsonb_build_array(jsonb_build_object('type', 'SetMediaStatus', 'mediaId', item -> 'id', 'status', 'blocked',
                                                  'dedupeKey', 'media-status:' || id || ':blocked'));
  if v ->> 'decision' = 'block' then
    effects := effects || jsonb_build_array(jsonb_build_object(
      'type', 'Notify15', 'userId', item -> 'uploaderId', 'kind', 'media_blocked',
      'params', jsonb_build_object('mediaId', item -> 'id', 'reasonKey', coalesce(v -> 'reasonKey', to_jsonb('media.blocked.policy'::text))),
      'gameId', item -> 'gameId', 'seriesId', null, 'dedupeKey', 'notify:media_blocked:' || id));
  else
    effects := effects || jsonb_build_array(
      jsonb_build_object('type', 'PreserveMediaEvidence', 'mediaId', item -> 'id', 'uploaderId', item -> 'uploaderId',
                         'dedupeKey', 'preserve:' || id),
      jsonb_build_object('type', 'RestrictAccountPendingReview', 'userId', item -> 'uploaderId', 'reason', 'csam_match',
                         'dedupeKey', 'restrict:media_csam:' || id),
      jsonb_build_object('type', 'EnqueueReview', 'item', jsonb_build_object(
        'kind', 'media_csam', 'priority', 'high', 'subjectUserId', item -> 'uploaderId', 'venueId', item -> 'venueId',
        'gameId', item -> 'gameId', 'sanctionId', null, 'appealId', null, 'reportIds', '[]'::jsonb,
        'evidence', jsonb_build_object('mediaId', item -> 'id', 'csamHashMatch', v -> 'csamHashMatch', 'source', v -> 'source'),
        -- SEVERE_REPORT_SLA_HOURS (trust/constants.ts) = 1
        'dueBy', public.dm_iso(p_now + interval '1 hour'), 'dedupeKey', 'media_csam:' || id)),
      jsonb_build_object('type', 'Audit', 'action', 'media.csam_blocked', 'subjectUserId', item -> 'uploaderId',
                         'data', jsonb_build_object('mediaId', item -> 'id', 'gameId', item -> 'gameId')));
  end if;
  return jsonb_build_object('item', item || jsonb_build_object('status', 'blocked', 'visibility', 'participants'), 'tags', tags,
                            'effects', effects);
end $$;

-- ---------------------------------------------------------------------------
-- Network (network/index.ts)
-- ---------------------------------------------------------------------------

-- derivePlayedWith({ attendance, blocks }, now) → PlayedWith[].
create function public.dm_derive_played_with(p_input jsonb, p15 public.phase15_config, p_now timestamptz) returns jsonb
language sql immutable set search_path = ''
as $$
  with att as (
    select a ->> 'gameId' as game, a ->> 'userId' as uid, public.dm_ts(a ->> 'endsAt') as ends,
           row_number() over (partition by a ->> 'gameId' order by o) as first_row
    from jsonb_array_elements(coalesce(p_input -> 'attendance', '[]'::jsonb)) with ordinality as x(a, o)
    where coalesce((a ->> 'verified')::boolean, false)
  ), games as (
    -- The game's end is taken from its first verified row (like the TS Map); window on that.
    select g.game, g.ends from att g where g.first_row = 1
      and g.ends >= p_now - p15.played_with_lookback_days * interval '24 hours' and g.ends <= p_now
  ), members as (
    select distinct a.game, a.uid, gm.ends from att a join games gm on gm.game = a.game
  ), pairs as (
    select x.uid as ua, y.uid as ub, count(*) as n, max(x.ends) as last
    from members x join members y on x.game = y.game and x.uid collate "C" < y.uid collate "C"
    where not exists (select 1 from jsonb_array_elements(coalesce(p_input -> 'blocks', '[]'::jsonb)) b
                      where (b ->> 'blockerId' = x.uid and b ->> 'blockedId' = y.uid)
                         or (b ->> 'blockerId' = y.uid and b ->> 'blockedId' = x.uid))
    group by x.uid, y.uid
  )
  select coalesce(jsonb_agg(jsonb_build_object('userA', ua, 'userB', ub, 'gamesTogether', n, 'lastPlayedAt', public.dm_iso(last))
                            order by ua collate "C", ub collate "C"), '[]'::jsonb)
  from pairs
$$;

-- friendTransition({ connection, actor, other, action, blocks }, now) → Result<{ connection, effects }>.
create function public.dm_friend_transition(p_input jsonb, p_now timestamptz) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  actor text := p_input ->> 'actor';
  other text := p_input ->> 'other';
  action text := p_input ->> 'action';
  at text := public.dm_iso(p_now);
  c jsonb := p_input -> 'connection';
  st text;
  blocked boolean;
  nxt jsonb;
  clear jsonb := jsonb_build_object('friendStatus', null, 'friendRequestedBy', null, 'friendRequestedAt', null, 'friendAcceptedAt', null);
begin
  if actor = other then return jsonb_build_object('ok', false, 'error', 'validation'); end if;
  if c is null or jsonb_typeof(c) = 'null' then
    c := jsonb_build_object('userA', case when actor collate "C" < other collate "C" then actor else other end,
                            'userB', case when actor collate "C" < other collate "C" then other else actor end,
                            'gamesTogether', 0, 'lastPlayedAt', null) || clear;
  end if;
  st := case when coalesce(c ->> 'friendStatus', '') = '' then 'none' when c ->> 'friendStatus' = 'accepted' then 'friends'
             when c ->> 'friendRequestedBy' = actor then 'outgoing' else 'incoming' end;
  blocked := exists (select 1 from jsonb_array_elements(coalesce(p_input -> 'blocks', '[]'::jsonb)) b
                     where (b ->> 'blockerId' = actor and b ->> 'blockedId' = other) or (b ->> 'blockerId' = other and b ->> 'blockedId' = actor));
  if action in ('request', 'accept') and blocked then return jsonb_build_object('ok', false, 'error', 'blocked'); end if;
  if action = 'request' then
    if st in ('friends', 'outgoing') then return jsonb_build_object('ok', false, 'error', 'conflict'); end if;
    if st = 'none' then
      if (c ->> 'gamesTogether')::int < 1 then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
      nxt := c || jsonb_build_object('friendStatus', 'requested', 'friendRequestedBy', actor, 'friendRequestedAt', at, 'friendAcceptedAt', null);
      return jsonb_build_object('ok', true, 'value', jsonb_build_object('connection', nxt, 'effects', jsonb_build_array(
        jsonb_build_object('type', 'UpsertConnection', 'connection', nxt,
                           'dedupeKey', 'connection:' || (nxt ->> 'userA') || ':' || (nxt ->> 'userB') || ':' || action || ':' || at),
        jsonb_build_object('type', 'Notify15', 'userId', other, 'kind', 'friend_request', 'params', jsonb_build_object('userId', actor),
                           'gameId', null, 'seriesId', null,
                           'dedupeKey', 'notify:friend_request:' || (c ->> 'userA') || ':' || (c ->> 'userB') || ':' || at))));
    end if;
  end if;
  if (action = 'request' and st = 'incoming') or (action = 'accept' and st = 'incoming') then
    nxt := c || jsonb_build_object('friendStatus', 'accepted', 'friendAcceptedAt', at);
    return jsonb_build_object('ok', true, 'value', jsonb_build_object('connection', nxt, 'effects', jsonb_build_array(
      jsonb_build_object('type', 'UpsertConnection', 'connection', nxt,
                         'dedupeKey', 'connection:' || (nxt ->> 'userA') || ':' || (nxt ->> 'userB') || ':' || action || ':' || at),
      jsonb_build_object('type', 'Notify15', 'userId', other, 'kind', 'friend_accepted', 'params', jsonb_build_object('userId', actor),
                         'gameId', null, 'seriesId', null,
                         'dedupeKey', 'notify:friend_accepted:' || (c ->> 'userA') || ':' || (c ->> 'userB') || ':' || at))));
  end if;
  if (action = 'decline' and st = 'incoming') or (action = 'cancel' and st = 'outgoing') or (action = 'remove' and st = 'friends') then
    return jsonb_build_object('ok', true, 'value', jsonb_build_object('connection', c || clear, 'effects', jsonb_build_array(
      jsonb_build_object('type', 'DeleteFriendship', 'userA', c -> 'userA', 'userB', c -> 'userB',
                         'dedupeKey', 'unfriend:' || (c ->> 'userA') || ':' || (c ->> 'userB') || ':' || action || ':' || at))));
  end if;
  return jsonb_build_object('ok', false, 'error', 'not_found');
end $$;

-- filterFriendsUpcomingGames({ viewerId, candidates, connections, privacy, blocks }, now).
create function public.dm_filter_friends_games(p_input jsonb, p_now timestamptz) returns jsonb
language sql immutable set search_path = ''
as $$
  with friends as (
    select case when c ->> 'userA' = p_input ->> 'viewerId' then c ->> 'userB' else c ->> 'userA' end as fid
    from jsonb_array_elements(coalesce(p_input -> 'connections', '[]'::jsonb)) c
    where c ->> 'friendStatus' = 'accepted' and (c ->> 'userA' = p_input ->> 'viewerId' or c ->> 'userB' = p_input ->> 'viewerId')
  ), blk as (
    select b ->> 'blockerId' as x, b ->> 'blockedId' as y from jsonb_array_elements(coalesce(p_input -> 'blocks', '[]'::jsonb)) b
  )
  select coalesce(jsonb_agg(c order by (c #>> '{game,startsAt}') collate "C", (c #>> '{game,id}') collate "C",
                            (c ->> 'ownerId') collate "C"), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_input -> 'candidates', '[]'::jsonb)) c
  where c ->> 'ownerId' in (select fid from friends)
    and coalesce(p_input #>> array['privacy', c ->> 'ownerId', 'upcomingGamesVisibleTo'], 'friends') = 'friends'
    and not exists (select 1 from blk where (x = p_input ->> 'viewerId' and y = c ->> 'ownerId') or (y = p_input ->> 'viewerId' and x = c ->> 'ownerId')
                                         or (x = p_input ->> 'viewerId' and y = c #>> '{game,hostId}') or (y = p_input ->> 'viewerId' and x = c #>> '{game,hostId}'))
    and c #>> '{game,visibility}' = 'public' and c #>> '{game,status}' = 'scheduled'
    and public.dm_ts(c #>> '{game,startsAt}') > p_now
$$;
