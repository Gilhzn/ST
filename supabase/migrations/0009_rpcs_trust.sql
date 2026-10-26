-- 0009_rpcs_trust.sql
-- Client RPCs for reports, blocks, appeals, moderation, push tokens and account deletion.

-- ---------------------------------------------------------------------------
-- Toxicity reports → visibility restriction (TRUST-041/042/043/048)
-- ---------------------------------------------------------------------------

-- Evaluate reports against p_target after p_trigger_report was filed.
-- Qualifying report: within toxicityWindowDays and after the last report-based restriction; the
-- reporter's account is ≥ minReporterAccountAgeDays old, not red, not banned/deleted, has report
-- accuracy ≥ reporterMinAccuracy once reporterAccuracyMinReports reports were decided, and was a
-- verified attendee of the reported game (or a member of its chat when reporting a message) in
-- which the subject was an approved participant. One report per distinct reporter.
-- ≥ toxicityReporters qualifying reporters →
--   collusion suspected (any two reporter accounts created within collusionCreationWindowHours, or
--   all reporters from one team of one game opposing the subject) → review only;
--   subject protected (a report-based restriction overturned within postOverturnProtectionDays)
--   → review only;
--   otherwise → visibility_restriction for visibilityRestrictionHours + high-priority review +
--   notification with the statement of reasons (st_issue_sanction).
create function public.st_evaluate_toxicity(p_target uuid, p_trigger_report uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  cfg public.trust_config := public.st_config();
  t timestamptz := public.st_now();
  since timestamptz;
  n int;
  ids uuid[];
  min_gap interval;
  n_games int;
  one_team boolean;
  protected boolean;
  s public.sanctions;
  ev jsonb;
begin
  select max(s2.created_at) into since from public.sanctions s2
  where s2.user_id = p_target and s2.kind = 'visibility_restriction' and s2.reason_code = 'toxicity_reports';
  since := greatest(t - cfg.toxicity_window_days * interval '1 day', coalesce(since, '-infinity'::timestamptz));

  with reps as (
    select distinct on (r.reporter_id) r.id as report_id, r.reporter_id, r.game_id, p.created_at as acct,
           rp.team as rteam, sp.team as steam
    from public.user_reports r
    join public.profiles p on p.id = r.reporter_id
    join public.game_participants rp on rp.game_id = r.game_id and rp.user_id = r.reporter_id
    join public.game_participants sp on sp.game_id = r.game_id and sp.user_id = r.target_user_id
    where r.target_user_id = p_target
      and r.created_at > since and r.created_at <= t
      and p.deleted_at is null and not p.permanently_banned and p.reliability_status <> 'red'
      and p.created_at <= t - cfg.min_reporter_account_age_days * interval '1 day'
      and rp.status = 'approved' and (rp.attendance = 'verified' or r.message_id is not null)
      and sp.status = 'approved'
      and (select count(*) filter (where x.outcome is not null) < cfg.reporter_accuracy_min_reports
               or count(*) filter (where x.outcome = 'founded')::numeric
                  / nullif(count(*) filter (where x.outcome is not null), 0) >= cfg.reporter_min_accuracy
           from public.user_reports x where x.reporter_id = r.reporter_id)
    order by r.reporter_id, r.created_at
  )
  select count(*), array_agg(reps.report_id order by reps.report_id), count(distinct reps.game_id),
         count(distinct reps.rteam) = 1 and bool_and(reps.rteam is not null and reps.rteam is distinct from reps.steam),
         (select min(b.acct - a2.acct) from reps a2 join reps b on b.reporter_id <> a2.reporter_id and b.acct >= a2.acct)
    into n, ids, n_games, one_team, min_gap
  from reps;
  if n < cfg.toxicity_reporters then
    return 'below_threshold';
  end if;

  protected := exists (select 1 from public.sanctions s2
                       where s2.user_id = p_target and s2.kind = 'visibility_restriction' and s2.status = 'overturned'
                         and s2.reason_code = 'toxicity_reports'
                         and s2.updated_at > t - cfg.post_overturn_protection_days * interval '1 day');
  ev := jsonb_build_object('reporters', n, 'games', n_games, 'protected', protected,
                           'minAccountGapHours', round(extract(epoch from min_gap) / 3600.0, 2));

  if min_gap <= cfg.collusion_creation_window_hours * interval '1 hour' or (n_games = 1 and one_team) then
    perform public.st_enqueue_review('collusion_suspected', 'collusion_suspected:' || p_target::text || ':' || p_trigger_report::text,
      p_target, 'normal', ev || jsonb_build_object('collusionSuspected', true), ids, null, null, null, null);
    return 'collusion_suspected';
  end if;
  if protected then
    perform public.st_enqueue_review('toxicity_reports', 'toxicity_reports:' || p_target::text || ':' || p_trigger_report::text,
      p_target, 'normal', ev, ids, null, null, null, null);
    return 'protected';
  end if;
  if exists (select 1 from public.sanctions s2 where s2.user_id = p_target and s2.kind = 'visibility_restriction'
             and public.st_sanction_in_force(s2, t)) then
    return 'already_restricted';
  end if;
  s := public.st_issue_sanction(p_target, 'visibility_restriction', 'toxicity_reports',
         jsonb_build_object('reporters', n, 'hours', cfg.visibility_restriction_hours, 'automated', true),
         cfg.visibility_restriction_hours * interval '1 hour', null, null, '{}',
         'toxicity_reports:' || p_target::text || ':' || p_trigger_report::text);
  perform public.st_enqueue_review('toxicity_reports', 'toxicity_reports:' || p_target::text || ':' || p_trigger_report::text,
    p_target, 'high', ev, ids, null, null, s.id, null);
  return 'restricted';
end $$;

create function public.report_user(
  p_target_user_id uuid, p_category public.user_report_category, p_game_id uuid default null,
  p_message_id uuid default null, p_note text default null)
returns public.user_reports
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles := public.st_active_profile();
  t timestamptz := public.st_now();
  cfg public.trust_config := public.st_config();
  m public.chat_messages;
  v_game uuid := p_game_id;
  r public.user_reports;
begin
  if p_target_user_id is null or p_target_user_id = me.id then perform public.st_raise('validation', 'target'); end if;
  if not exists (select 1 from public.profiles p where p.id = p_target_user_id and p.deleted_at is null) then
    perform public.st_raise('not_found');
  end if;
  perform public.st_rate_limit(
    (select count(*) from public.user_reports x where x.reporter_id = me.id and x.created_at > t - interval '24 hours'), 10);
  if p_message_id is not null then
    select * into m from public.chat_messages x where x.id = p_message_id;
    if m.id is null or m.sender_id <> p_target_user_id or not public.st_can_read_chat(m.game_id, me.id) then
      perform public.st_raise('validation', 'message');
    end if;
    v_game := m.game_id;
  end if;
  if v_game is not null and not public.st_can_see_game(v_game, me.id) then
    perform public.st_raise('validation', 'game');
  end if;
  if exists (select 1 from public.user_reports x
             where x.reporter_id = me.id and x.target_user_id = p_target_user_id
               and x.game_id is not distinct from v_game and x.message_id is not distinct from p_message_id
               and x.created_at > t - interval '24 hours') then
    perform public.st_raise('already_reported');
  end if;
  insert into public.user_reports (reporter_id, target_user_id, category, game_id, message_id, note, created_at)
  values (me.id, p_target_user_id, p_category, v_game, p_message_id, p_note, t)
  returning * into r;
  if m.id is not null then
    insert into public.moderation_retained (message_id, game_id, sender_id, body, reason, report_id, retained_at, expires_at)
    values (m.id, m.game_id, m.sender_id, m.body, 'reported', r.id, t, t + cfg.moderation_retention_days * interval '1 day')
    on conflict (message_id, reason) where message_id is not null do nothing;
  end if;
  perform public.st_evaluate_toxicity(p_target_user_id, r.id);
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Blocks
-- ---------------------------------------------------------------------------
create function public.block_user(p_user_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare me public.profiles := public.st_active_profile();
begin
  if p_user_id is null or p_user_id = me.id then perform public.st_raise('validation'); end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then perform public.st_raise('not_found'); end if;
  insert into public.blocks (blocker_id, blocked_id, created_at) values (me.id, p_user_id, public.st_now())
  on conflict do nothing;
end $$;

create function public.unblock_user(p_user_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.blocks b where b.blocker_id = public.st_uid() and b.blocked_id = p_user_id;
end $$;

-- ---------------------------------------------------------------------------
-- Appeals (TRUST-022/023, DSA Art. 20: internal complaints for 6 months)
-- ---------------------------------------------------------------------------
create function public.file_appeal(p_sanction_id uuid, p_text text) returns public.appeals
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  t timestamptz := public.st_now();
  cfg public.trust_config := public.st_config();
  s public.sanctions;
  a public.appeals;
  disp boolean;
  prior int;
begin
  select * into s from public.sanctions x where x.id = p_sanction_id and x.user_id = uid for update;
  if s.id is null then perform public.st_raise('not_found'); end if;
  if s.status = 'overturned' then perform public.st_raise('conflict', 'already overturned'); end if;
  if t > s.created_at + interval '180 days' then perform public.st_raise('dispute_window_closed'); end if;
  if exists (select 1 from public.appeals x where x.sanction_id = s.id and x.status = 'open') then
    perform public.st_raise('conflict', 'appeal open');
  end if;
  if p_text is null or char_length(btrim(p_text)) not between 1 and 2000 then perform public.st_raise('validation', 'text'); end if;
  disp := s.dispute_until is not null and t <= s.dispute_until;
  select count(*) into prior from public.appeals x where x.user_id = uid and x.created_at > t - interval '90 days';
  insert into public.appeals (sanction_id, user_id, text, is_dispute, auto_void_eligible, created_at)
  values (s.id, uid, btrim(p_text), disp,
          disp and s.kind = 'yellow_card' and prior < cfg.dispute_auto_void_max_per_90_days, t)
  returning * into a;
  if disp and s.status = 'active' then
    update public.sanctions x set status = 'disputed' where x.id = s.id;
  end if;
  perform public.st_enqueue_review(case when disp then 'sanction_dispute'::public.review_kind else 'appeal'::public.review_kind end,
    'appeal:' || a.id::text, uid, 'normal', jsonb_build_object('sanctionKind', s.kind, 'reasonCode', s.reason_code),
    '{}', null, s.game_id, s.id, a.id);
  perform public.st_audit('appeal.filed', uid, jsonb_build_object('appealId', a.id, 'sanctionId', s.id, 'isDispute', disp));
  return a;
end $$;

-- ---------------------------------------------------------------------------
-- Moderation (humans only; app_roles)
-- ---------------------------------------------------------------------------
create function public.st_set_report_outcome(p_report_ids uuid[], p_outcome text) returns void
language sql security definer set search_path = ''
as $$ update public.user_reports r set outcome = p_outcome where r.id = any (coalesce(p_report_ids, '{}')) $$;

create function public.moderator_decide(p_item_id uuid, p_decision public.moderator_decision, p_note text default null)
returns public.review_queue
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  t timestamptz := public.st_now();
  cfg public.trust_config := public.st_config();
  it public.review_queue;
  s public.sanctions;
  a public.appeals;
  v public.venues;
  lift_kind public.sanction_kind;
  x record;
  hs public.sanctions;
begin
  if not public.st_is_moderator(uid) then perform public.st_raise('forbidden'); end if;
  select * into it from public.review_queue q where q.id = p_item_id for update;
  if it.id is null then perform public.st_raise('not_found'); end if;
  if it.status = 'resolved' then perform public.st_raise('conflict', 'already resolved'); end if;
  if it.sanction_id is not null then select * into s from public.sanctions q where q.id = it.sanction_id for update; end if;
  if it.appeal_id is not null then select * into a from public.appeals q where q.id = it.appeal_id for update; end if;

  if p_decision = 'dismiss' then
    if it.kind in ('sanction_dispute', 'appeal') then
      perform public.st_raise('validation', 'appeals must be upheld or overturned');
    end if;
    perform public.st_set_report_outcome(it.report_ids, 'unfounded');
  elsif p_decision = 'uphold' then
    if s.id is null then perform public.st_raise('validation', 'no sanction'); end if;
    if s.status in ('active', 'disputed') then
      update public.sanctions q set status = 'upheld' where q.id = s.id;
    end if;
    perform public.st_set_report_outcome(it.report_ids, 'founded');
    if s.kind = 'yellow_card' then perform public.st_escalate(s.id); end if;
    perform public.st_notify(s.user_id, 'sanction_decided', jsonb_build_object('decision', 'uphold', 'kind', s.kind),
                             s.game_id, s.id, 'decided:' || it.id::text);
  elsif p_decision = 'overturn' then
    if s.id is null then perform public.st_raise('validation', 'no sanction'); end if;
    perform public.st_overturn_sanction(s.id);
    perform public.st_set_report_outcome(it.report_ids, 'unfounded');
  elsif p_decision = 'lift_restriction' then
    lift_kind := case it.kind when 'toxicity_reports' then 'visibility_restriction'::public.sanction_kind
                              when 'collusion_suspected' then 'visibility_restriction'::public.sanction_kind
                              when 'host_reliability' then 'host_suspension'::public.sanction_kind
                              when 'permanent_ban_candidate' then 'join_ban'::public.sanction_kind end;
    if lift_kind is null or it.subject_user_id is null then perform public.st_raise('validation', 'nothing to lift'); end if;
    for x in select q.id from public.sanctions q where q.user_id = it.subject_user_id and q.kind = lift_kind
             and public.st_sanction_in_force(q, t) loop
      perform public.st_overturn_sanction(x.id);
    end loop;
    perform public.st_set_report_outcome(it.report_ids, 'unfounded');
  elsif p_decision = 'permanent_ban' then
    if it.subject_user_id is null then perform public.st_raise('validation', 'no subject'); end if;
    perform public.st_issue_sanction(it.subject_user_id, 'permanent_ban', 'moderator_decision',
      jsonb_build_object('reviewItemId', it.id), null, null, it.game_id,
      case when it.sanction_id is null then '{}'::uuid[] else array[it.sanction_id] end,
      'permanent_ban:' || it.id::text, 'moderator');
    perform public.st_set_report_outcome(it.report_ids, 'founded');
  elsif p_decision in ('remove_venue', 'restore_venue') then
    if it.venue_id is null then perform public.st_raise('validation', 'no venue'); end if;
    select * into v from public.venues q where q.id = it.venue_id for update;
    update public.venues q set status = case when p_decision = 'remove_venue' then 'removed'::public.venue_status
                                             else 'active'::public.venue_status end
    where q.id = v.id;
    if p_decision = 'remove_venue' and v.created_by is not null then
      -- Confirmed fake venue → temporary host suspension + review (TRUST-051a).
      hs := public.st_issue_sanction(v.created_by, 'host_suspension', 'fake_venue',
              jsonb_build_object('venueName', v.name, 'days', cfg.host_suspension_days),
              cfg.host_suspension_days * interval '1 day', null, null, '{}', 'fake_venue:' || v.id::text);
      perform public.st_enqueue_review('host_reliability', 'host_reliability:' || hs.dedupe_key, v.created_by, 'normal',
        jsonb_build_object('venueId', v.id::text), '{}', v.id, null, hs.id, null);
    end if;
  end if;

  if a.id is not null and a.status = 'open' then
    update public.appeals q set
      status = case p_decision when 'overturn' then 'overturned'::public.appeal_status
                               when 'lift_restriction' then 'overturned'::public.appeal_status
                               else 'upheld'::public.appeal_status end,
      decided_by = uid, decision_note = p_note, decided_at = t
    where q.id = a.id;
    perform public.st_notify(a.user_id, 'appeal_decided', jsonb_build_object('decision', p_decision),
                             s.game_id, s.id, 'appeal_decided:' || a.id::text);
  end if;
  update public.review_queue q set status = 'resolved', resolution = p_decision, resolved_by = uid, resolved_at = t,
                                   decision_note = p_note
  where q.id = it.id
  returning * into it;
  perform public.st_audit('moderator.decide', it.subject_user_id,
    jsonb_build_object('itemId', it.id, 'kind', it.kind, 'decision', p_decision, 'sanctionId', it.sanction_id), uid);
  return it;
end $$;

-- ---------------------------------------------------------------------------
-- Push tokens (idempotent per token; a token moving to another account is reassigned)
-- ---------------------------------------------------------------------------
create function public.register_push_token(p_token text, p_platform public.push_platform) returns void
language plpgsql security definer set search_path = ''
as $$
declare me public.profiles := public.st_active_profile();
begin
  insert into public.push_tokens (user_id, token, platform, created_at, last_seen_at)
  values (me.id, p_token, p_platform, public.st_now(), public.st_now())
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform,
                                    last_seen_at = excluded.last_seen_at;
end $$;

-- ---------------------------------------------------------------------------
-- Account deletion (Apple 5.1.1(v), Google Play; compliance §8). Idempotent.
-- Personal data erased; profile becomes a pseudonymous tombstone so sanctions, reports, audit
-- and payment records stay linked (kept per retention table). The Edge Function `delete-account`
-- calls this with the user's JWT, releases deposits through the PSP and then deletes auth.users.
-- ---------------------------------------------------------------------------
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  t timestamptz := public.st_now();
  p public.profiles;
  r record;
begin
  select * into p from public.profiles x where x.id = uid for update;
  if p.id is null or p.deleted_at is not null then return; end if;

  -- Hosted upcoming games are cancelled (participants notified; deposits released by settle_deposits).
  for r in select g.id, g.title from public.games g where g.host_id = uid and g.status = 'scheduled' and g.ends_at > t loop
    update public.games g set status = 'cancelled', cancelled_at = t where g.id = r.id;
    perform public.st_notify(gp.user_id, 'game_cancelled', jsonb_build_object('gameTitle', r.title), r.id, null,
                             'game_cancelled:' || r.id::text || ':' || gp.user_id::text)
    from public.game_participants gp
    where gp.game_id = r.id and gp.user_id <> uid and gp.status in ('requested', 'approved', 'waitlisted');
  end loop;
  -- Removed from all future games and waitlists with no card (even within the late window).
  for r in select gp.game_id, gp.status from public.game_participants gp join public.games g on g.id = gp.game_id
           where gp.user_id = uid and gp.status in ('requested', 'approved', 'waitlisted')
             and g.status = 'scheduled' and g.ends_at > t loop
    update public.game_participants gp set status = 'cancelled', cancelled_at = t, late_cancel = false,
           waitlisted_at = null, offer_expires_at = null, offer_is_flash = false, team = null
    where gp.game_id = r.game_id and gp.user_id = uid;
    if r.status = 'approved' then perform public.st_promote_waitlist(r.game_id); end if;
  end loop;
  -- Open appeals are closed.
  update public.appeals a set status = 'withdrawn', decided_at = t where a.user_id = uid and a.status = 'open';
  update public.review_queue q set status = 'resolved', resolution = 'dismiss', resolved_at = t,
                                   decision_note = 'account_deleted'
  where q.status <> 'resolved' and q.kind in ('appeal', 'sanction_dispute') and q.subject_user_id = uid;

  -- Reported messages are already in moderation_retained; everything else is removed now.
  delete from public.chat_messages m where m.sender_id = uid;
  delete from public.profile_private x where x.user_id = uid;
  delete from public.push_tokens x where x.user_id = uid;
  delete from public.user_sports x where x.user_id = uid;
  delete from public.venue_ratings x where x.user_id = uid;
  delete from public.blocks x where x.blocker_id = uid or x.blocked_id = uid;
  delete from public.notifications x where x.user_id = uid;
  delete from public.game_invite_access x where x.user_id = uid;
  delete from public.app_roles x where x.user_id = uid;
  update public.venues v set created_by = null where v.created_by = uid;

  update public.profiles x set display_name = 'Deleted user', avatar_url = null, bio = null, country_code = null,
         locale = 'en', verified_host = false, deleted_at = t
  where x.id = uid;
  perform public.st_audit('account.deleted', uid, '{}'::jsonb, uid);
end $$;
