-- 0108_security_review2.sql — Security review #2 (Phase 1.5), DB fixes to MVP functions.
-- Regression tests: supabase/tests/security_regressions2.test.ts.
--  H1  A CSAM review hold (account_review_holds) follows the phone into a re-registered account: the
--      deletion-time HMAC record carries `hold_until`, create_profile re-applies it.
--  H2  Changing a submitted result resets the result confirmations (they were given on the old
--      score) and asks the confirmers again; only verdicts on the current score count (0102).

-- ---------------------------------------------------------------------------
-- H1: holds survive delete-and-re-register
-- ---------------------------------------------------------------------------
alter table public.sanction_phone_hmac add column hold_until timestamptz;

create or replace function public.st_record_phone_hmac(p_uid uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  h text;
  ids uuid[];
  until timestamptz;
  hold timestamptz;
begin
  select public.st_phone_hmac(pp.phone) into h from public.profile_private pp where pp.user_id = p_uid;
  if h is null then return; end if;
  select array_agg(s.id order by s.id), max(coalesce(s.expires_at, 'infinity'::timestamptz)) into ids, until
  from public.sanctions s
  where s.user_id = p_uid and s.kind <> 'yellow_card' and public.st_sanction_in_force(s, t);
  select x.until into hold from public.account_review_holds x where x.user_id = p_uid and x.until > t;
  if ids is null and hold is null then return; end if;
  insert into public.sanction_phone_hmac as x (hmac, sanction_ids, until, hold_until, created_at)
  values (h, coalesce(ids, '{}'), greatest(until, hold), hold, t)
  on conflict (hmac) do update
    set sanction_ids = array(select distinct unnest(x.sanction_ids || excluded.sanction_ids)),
        until = greatest(x.until, excluded.until),
        hold_until = greatest(x.hold_until, excluded.hold_until);
end $$;

create or replace function public.st_reissue_evaded_sanctions(p_uid uuid) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  t timestamptz := public.st_now();
  h text;
  hrow public.sanction_phone_hmac;
  s public.sanctions;
  n int := 0;
begin
  select public.st_phone_hmac(pp.phone) into h from public.profile_private pp where pp.user_id = p_uid;
  if h is null then return 0; end if;
  select * into hrow from public.sanction_phone_hmac x where x.hmac = h and x.until > t;
  if hrow.hmac is null then return 0; end if;
  for s in select * from public.sanctions x
           where x.id = any (hrow.sanction_ids) and public.st_sanction_in_force(x, t) and x.kind <> 'yellow_card'
           order by x.starts_at, x.id
  loop
    perform public.st_apply_effects(public.dm_issue_effects(jsonb_build_object(
      'kind', s.kind, 'userId', p_uid, 'reasonCode', s.reason_code, 'statementKey', s.statement_key,
      'statementParams', s.statement_params || jsonb_build_object('reissued', 1),
      'startsAt', public.dm_iso(t), 'expiresAt', public.dm_iso(s.expires_at), 'disputeUntil', null,
      'gameId', null, 'causedBy', jsonb_build_array(s.id), 'dedupeKey', 'reissued:' || s.id::text || ':' || p_uid::text,
      'decidedBy', s.decided_by)));
    n := n + 1;
  end loop;
  -- A CSAM review hold in force on the deleted account is re-applied until its end (no notice: L5).
  if hrow.hold_until > t then
    insert into public.account_review_holds (user_id, reason, until, dedupe_key, created_at)
    values (p_uid, 'csam_match', hrow.hold_until, 'reissued-hold:' || p_uid::text, t)
    on conflict (user_id) do update set until = greatest(public.account_review_holds.until, excluded.until);
    perform public.st_recompute_projections(p_uid);
    n := n + 1;
  end if;
  if n > 0 then
    perform public.st_audit('sanction.reissued_after_reregistration', p_uid, jsonb_build_object('count', n), null);
  end if;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- H2: result changes reset the confirmations
-- ---------------------------------------------------------------------------
create or replace function public.submit_result(p_game_id uuid, p_team_scores int[]) returns public.game_results
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := public.st_uid();
  t timestamptz := public.st_now();
  cfg public.trust_config := public.st_config();
  g public.games;
  prev int[];
  r public.game_results;
  c record;
begin
  select * into g from public.games x where x.id = p_game_id;
  if g.id is null or not public.st_can_see_game(g.id, uid) then perform public.st_raise('not_found'); end if;
  -- Security M1: only the host records the result.
  if g.host_id <> uid then perform public.st_raise('forbidden'); end if;
  if g.status = 'cancelled' then perform public.st_raise('game_not_open'); end if;
  if t < g.ends_at or t > g.ends_at + cfg.result_window_hours * interval '1 hour' then
    perform public.st_raise('outside_window');
  end if;
  if p_team_scores is null or cardinality(p_team_scores) <> g.team_count or not (0 <= all (p_team_scores))
     or array_position(p_team_scores, null) is not null then
    perform public.st_raise('validation', 'team scores');
  end if;
  select gr.team_scores into prev from public.game_results gr where gr.game_id = g.id for update;
  insert into public.game_results as gr (game_id, team_scores, submitted_by, submitted_at, game_ends_at)
  values (g.id, p_team_scores, uid, t, g.ends_at)
  on conflict (game_id) do update set team_scores = excluded.team_scores, submitted_by = excluded.submitted_by,
                                      submitted_at = excluded.submitted_at
  returning * into r;
  -- GAME-071 / security review #2 H2: verdicts were given on the previous score; they are reset and
  -- the confirmers are asked again.
  if prev is not null and prev is distinct from p_team_scores then
    for c in select x.user_id from public.result_confirmations x where x.game_id = g.id and x.user_id <> uid loop
      perform public.st_notify(c.user_id, 'result_requested', jsonb_build_object('gameTitle', g.title, 'changed', 1), g.id, null,
                               'result_changed:' || g.id::text || ':' || c.user_id::text || ':' || extract(epoch from t)::text);
    end loop;
    delete from public.result_confirmations x where x.game_id = g.id;
    perform public.st_audit('result.changed', uid, jsonb_build_object('gameId', g.id, 'from', to_jsonb(prev), 'to', to_jsonb(p_team_scores)), uid);
  end if;
  return r;
end $$;
