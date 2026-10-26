-- 0105_account_phase15.sql (Phase 1.5)
-- Account deletion covers the Phase 1.5 data (GDPR Art. 17; VAULT-007): hosted series end, roster
-- and auto-join rows, invite joins, result verdicts, peer and skill ratings, media (own items
-- removed and purged; tags on others' items removed with a veto), connections and network privacy.
-- delete_my_account() is redefined with the MVP body unchanged plus st_phase15_delete_account().

create function public.st_phase15_delete_account(p_uid uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare t timestamptz := public.st_now();
begin
  -- Hosted series end (their upcoming occurrences are cancelled by delete_my_account's game loop).
  update public.game_series s set status = 'ended', ended_at = t, invite_token = null where s.host_id = p_uid and s.status <> 'ended';
  delete from public.series_auto_joins x where x.user_id = p_uid;
  delete from public.series_roster x where x.user_id = p_uid;
  delete from public.invite_joins x where x.user_id = p_uid;
  -- Ratings are personal data of both sides; never used for sanctions (RATE-005), so nothing to keep.
  delete from public.result_confirmations x where x.user_id = p_uid;
  delete from public.peer_ratings x where x.rater_id = p_uid or x.ratee_id = p_uid;
  delete from public.rating_updates x where x.user_id = p_uid;
  delete from public.skill_ratings x where x.user_id = p_uid;
  perform public.st_media_delete_account(p_uid);
  perform public.st_network_delete_account(p_uid);
end $$;

create or replace function public.delete_my_account() returns void
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
  -- Phase 1.5 data (series, ratings, media, network).
  perform public.st_phase15_delete_account(uid);
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

-- Retention additions (compliance §4): series invite tokens of ended series are dropped after the
-- QR/invite retention period; stale auto-join bookkeeping of past occurrences after 90 days.
create function public.purge_phase15_retention() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  cfg public.trust_config := public.st_config();
  n_tok int;
  n_aj int;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('st:purge_phase15_retention')) then return '{}'::jsonb; end if;
  with u as (
    update public.game_series s set invite_token = null
    where s.status = 'ended' and s.invite_token is not null
      and s.ended_at <= t - cfg.qr_secret_retention_hours * interval '1 hour'
    returning 1)
  select count(*) into n_tok from u;
  with d as (
    delete from public.series_auto_joins aj using public.games g
    where g.id = aj.game_id and g.ends_at <= t - interval '90 days'
    returning 1)
  select count(*) into n_aj from d;
  return jsonb_build_object('seriesTokens', n_tok, 'autoJoins', n_aj, 'media', public.purge_media());
end $$;
