-- 0010_rpcs_trust.sql
-- Client RPCs for reports, blocks, appeals, moderation, push tokens and account deletion.

-- ---------------------------------------------------------------------------
-- Toxicity reports → visibility restriction (TRUST-041/042/043/048)
-- ---------------------------------------------------------------------------

-- Evaluate reports about p_target with the domain mirror dm_evaluate_reports() (trust/reports.ts)
-- and apply its effects. Inputs are built from rows: the target's reports, the reporters' profiles
-- (account age, status, reports in the last 7 days, resolved/upheld counts), attendance in the
-- reported games, the target's sanctions and their overturn times. Returns the outcome.
create function public.st_evaluate_toxicity(p_target uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  res jsonb;
begin
  res := public.dm_evaluate_reports(
    (select coalesce(jsonb_agg(jsonb_build_object(
              'id', r.id, 'reporterId', r.reporter_id, 'targetUserId', r.target_user_id, 'category', r.category,
              'gameId', r.game_id, 'messageId', r.message_id, 'note', null, 'createdAt', public.dm_iso(r.created_at))), '[]'::jsonb)
     from public.user_reports r where r.target_user_id = p_target and r.reporter_id is not null),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'id', p.id, 'createdAt', public.dm_iso(p.created_at), 'reliabilityStatus', p.reliability_status,
              'reportsLast7d', (select count(*) from public.user_reports x where x.reporter_id = p.id and x.created_at > t - interval '7 days'
                                  and x.created_at <= t),
              'reportsResolved', (select count(*) from public.user_reports x where x.reporter_id = p.id and x.outcome is not null),
              'reportsUpheld', (select count(*) from public.user_reports x where x.reporter_id = p.id and x.outcome = 'founded'))), '[]'::jsonb)
     from public.profiles p
     where p.deleted_at is null and not p.permanently_banned
       and p.id in (select r.reporter_id from public.user_reports r where r.target_user_id = p_target)),
    t, public.st_config(),
    jsonb_build_object(
      'attendance', (select coalesce(jsonb_agg(jsonb_build_object('gameId', gp.game_id, 'userId', gp.user_id, 'status', gp.status,
                                                                  'attendance', gp.attendance, 'checkInMethod', gp.check_in_method,
                                                                  'isHost', gp.user_id = g.host_id, 'team', gp.team)), '[]'::jsonb)
                     from public.game_participants gp join public.games g on g.id = gp.game_id
                     where gp.game_id in (select r.game_id from public.user_reports r where r.target_user_id = p_target)),
      'sanctions', public.st_user_sanctions_json(p_target),
      'overturns', (select coalesce(jsonb_agg(jsonb_build_object('sanctionId', s.id, 'at', public.dm_iso(s.overturned_at))), '[]'::jsonb)
                    from public.sanctions s where s.user_id = p_target and s.overturned_at is not null)));
  perform public.st_apply_effects(res -> 'effects');
  return res ->> 'outcome';
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
  perform public.st_evaluate_toxicity(p_target_user_id);
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

-- Dispute (status active and within disputeUntil → the sanction becomes disputed) or appeal (later;
-- DSA Art. 20, within 6 months). A human decides; an undecided dispute is auto-voided after
-- disputeAutoVoidDays for the user's first disputeAutoVoidMaxPer90Days disputes (TRUST-023).
create function public.file_appeal(p_sanction_id uuid, p_text text) returns public.appeals
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  t timestamptz := public.st_now();
  s public.sanctions;
  a public.appeals;
begin
  select * into s from public.sanctions x where x.id = p_sanction_id and x.user_id = uid for update;
  if s.id is null then perform public.st_raise('not_found'); end if;
  if s.status = 'overturned' then perform public.st_raise('conflict', 'already overturned'); end if;
  if t > s.created_at + interval '180 days' then perform public.st_raise('dispute_window_closed'); end if;
  if exists (select 1 from public.appeals x where x.sanction_id = s.id and x.status = 'open') then
    perform public.st_raise('conflict', 'appeal open');
  end if;
  if p_text is null or char_length(btrim(p_text)) not between 1 and 2000 then perform public.st_raise('validation', 'text'); end if;
  insert into public.appeals (sanction_id, user_id, text, is_dispute, created_at)
  values (s.id, uid, btrim(p_text), s.status = 'active' and s.dispute_until is not null and t <= s.dispute_until, t)
  returning * into a;
  perform public.st_on_appeal_filed(a.id);
  select * into a from public.appeals x where x.id = a.id;
  return a;
end $$;

-- AppealFiled handling (engine): a dispute (canDispute) moves the sanction to disputed; a review item
-- is enqueued (sanction_dispute normal / appeal low); auto-void eligibility is recorded.
create function public.st_on_appeal_filed(p_appeal_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  cfg public.trust_config := public.st_config();
  a public.appeals;
  s public.sanctions;
  disp boolean;
  prior int;
begin
  select * into a from public.appeals x where x.id = p_appeal_id for update;
  select * into s from public.sanctions x where x.id = a.sanction_id for update;
  if a.id is null or s.id is null or a.status <> 'open' then return; end if;
  disp := a.is_dispute and s.status = 'active' and s.dispute_until is not null and t <= s.dispute_until;
  select count(*) into prior from public.appeals x
  where x.user_id = a.user_id and x.is_dispute and x.id <> a.id
    and x.created_at > a.created_at - interval '90 days' and x.created_at <= a.created_at;
  update public.appeals x set is_dispute = disp,
         auto_void_eligible = disp and prior + 1 <= cfg.dispute_auto_void_max_per_90_days
  where x.id = a.id;
  if disp then
    perform public.st_apply_effects(jsonb_build_array(
      jsonb_build_object('type', 'SetSanctionStatus', 'sanctionId', s.id, 'status', 'disputed')));
  end if;
  perform public.st_apply_effects(jsonb_build_array(public.dm_enqueue(public.dm_review_item(
    case when disp then 'sanction_dispute' else 'appeal' end, case when disp then 'normal' else 'low' end,
    case when disp then 'sanction_dispute:' else 'appeal:' end || a.id::text, a.user_id, null, s.game_id, s.id, a.id,
    '[]'::jsonb, jsonb_build_object('sanctionKind', s.kind, 'reasonCode', s.reason_code), t))));
  perform public.st_audit('appeal.filed', a.user_id, jsonb_build_object('appealId', a.id, 'sanctionId', s.id, 'isDispute', disp));
end $$;

-- ---------------------------------------------------------------------------
-- Moderation (humans only; app_roles)
-- ---------------------------------------------------------------------------
create function public.st_set_report_outcome(p_report_ids uuid[], p_outcome text) returns void
language sql security definer set search_path = ''
as $$ update public.user_reports r set outcome = p_outcome where r.id = any (coalesce(p_report_ids, '{}')) $$;

-- Human decision on a review item (engine onModeratorDecided). Moderators/admins only (app_roles).
--  permanent_ban          → moderator permanent ban of the subject (the only path to one);
--  venue items            → remove_venue (+ host reliability when confirmed fake) / restore_venue|dismiss;
--  collusion_suspected    → uphold issues a moderator visibility restriction;
--  sanction items         → overturn|lift_restriction cascades via caused_by; uphold (or dismiss of an
--                           appeal/dispute) upholds and re-runs escalation.
-- Every decision is audited; reporter accuracy is updated (founded / unfounded).
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
  upheld boolean := false;
  overturned boolean := false;
begin
  if not public.st_is_moderator(uid) then perform public.st_raise('forbidden'); end if;
  select * into it from public.review_queue q where q.id = p_item_id for update;
  if it.id is null then perform public.st_raise('not_found'); end if;
  if it.status = 'resolved' then perform public.st_raise('conflict', 'already resolved'); end if;
  if it.sanction_id is not null then select * into s from public.sanctions q where q.id = it.sanction_id for update; end if;
  if it.appeal_id is not null then select * into a from public.appeals q where q.id = it.appeal_id for update; end if;

  if p_decision = 'permanent_ban' then
    if it.subject_user_id is null then perform public.st_raise('validation', 'no subject'); end if;
    perform public.st_apply_effects(public.dm_issue_effects(public.dm_moderator_permanent_ban(
      it.subject_user_id, 'permanent_ban:' || it.id::text, t,
      case when it.sanction_id is null then '[]'::jsonb else jsonb_build_array(it.sanction_id) end)));
    perform public.st_set_report_outcome(it.report_ids, 'founded');
  elsif it.kind = 'venue_reports' and it.venue_id is not null then
    select * into v from public.venues q where q.id = it.venue_id for update;
    if p_decision = 'remove_venue' then
      update public.venues q set status = 'removed' where q.id = v.id;
      if v.created_by is not null then perform public.st_evaluate_host(v.created_by); end if;
    elsif p_decision in ('restore_venue', 'dismiss') then
      update public.venues q set status = 'active', last_reviewed_at = t where q.id = v.id;
    else
      perform public.st_raise('validation', 'decision does not apply to venue reports');
    end if;
  elsif it.kind = 'collusion_suspected' and p_decision = 'uphold' and it.subject_user_id is not null then
    perform public.st_apply_effects(public.dm_issue_effects(public.dm_system_sanction(
      'visibility_restriction', it.subject_user_id, 'toxicity_reports',
      jsonb_build_object('hours', cfg.visibility_restriction_hours, 'reporters', cardinality(it.report_ids)),
      cfg.visibility_restriction_hours * 3600000, null, null, '[]'::jsonb, 'moderator_restriction:' || it.id::text, t,
      'moderator')));
    perform public.st_set_report_outcome(it.report_ids, 'founded');
  elsif s.id is not null and p_decision in ('overturn', 'lift_restriction') then
    perform public.st_overturn_sanction(s.id);
    overturned := true;
    perform public.st_set_report_outcome(it.report_ids, 'unfounded');
    perform public.st_apply_effects(jsonb_build_array(public.dm_notify(s.user_id,
      case when it.appeal_id is not null then 'appeal_decided' else 'sanction_decided' end,
      jsonb_build_object('decision', 'overturn', 'sanctionKind', s.kind, 'reasonCode', s.reason_code, 'statementKey', s.statement_key),
      s.game_id, s.dedupe_key)));
  elsif s.id is not null and (p_decision = 'uphold' or (p_decision = 'dismiss' and it.kind in ('sanction_dispute', 'appeal'))) then
    if s.status in ('active', 'disputed') then
      update public.sanctions q set status = 'upheld' where q.id = s.id;
    end if;
    upheld := true;
    perform public.st_set_report_outcome(it.report_ids, 'founded');
    perform public.st_apply_effects(jsonb_build_array(public.dm_notify(s.user_id,
      case when it.appeal_id is not null then 'appeal_decided' else 'sanction_decided' end,
      jsonb_build_object('decision', 'uphold', 'sanctionKind', s.kind, 'reasonCode', s.reason_code, 'statementKey', s.statement_key),
      s.game_id, s.dedupe_key)));
    perform public.st_run_escalation(s.user_id);
  elsif p_decision = 'dismiss' then
    perform public.st_set_report_outcome(it.report_ids, 'unfounded');
  else
    perform public.st_raise('validation', 'decision does not apply to this item');
  end if;

  if a.id is not null and a.status = 'open' then
    update public.appeals q set
      status = case when overturned then 'overturned'::public.appeal_status else 'upheld'::public.appeal_status end,
      decided_by = uid, decision_note = p_note, decided_at = t
    where q.id = a.id;
  end if;
  update public.review_queue q set status = 'resolved', resolution = p_decision, resolved_by = uid, resolved_at = t,
                                   decision_note = p_note
  where q.id = it.id
  returning * into it;
  perform public.st_audit('moderator.decision', it.subject_user_id,
    jsonb_build_object('itemId', it.id, 'kind', it.kind, 'decision', p_decision, 'moderatorId', uid, 'note', p_note), uid);
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

create function public.st_record_phone_hmac(p_uid uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  h text;
  ids uuid[];
  until timestamptz;
begin
  select public.st_phone_hmac(pp.phone) into h from public.profile_private pp where pp.user_id = p_uid;
  if h is null then return; end if;
  select array_agg(s.id order by s.id), max(coalesce(s.expires_at, 'infinity'::timestamptz)) into ids, until
  from public.sanctions s
  where s.user_id = p_uid and s.kind <> 'yellow_card' and public.st_sanction_in_force(s, t);
  if ids is null then return; end if;
  insert into public.sanction_phone_hmac as x (hmac, sanction_ids, until, created_at) values (h, ids, until, t)
  on conflict (hmac) do update
    set sanction_ids = array(select distinct unnest(x.sanction_ids || excluded.sanction_ids)),
        until = greatest(x.until, excluded.until);
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
           waitlisted_at = null, team = null
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
  -- Security H5: deletion is always allowed (GDPR Art. 17), but restrictions in force follow the
  -- phone number (keyed HMAC, no plaintext) until they expire.
  perform public.st_record_phone_hmac(uid);
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
