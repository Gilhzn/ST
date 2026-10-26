-- 0090_rls_grants.sql (runs after every schema/function migration; keep it last before 9000_cron)
-- Row level security on every table (deny by default), least-privilege table/column grants and
-- function EXECUTE grants. Supabase grants ALL to anon/authenticated by default and relies on RLS;
-- we additionally revoke everything and grant back only what clients need, so trust columns,
-- secrets and exact locations are protected by both privileges and policies.

-- ---------------------------------------------------------------------------
-- RLS on, everywhere
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p')
             and not exists (select 1 from pg_catalog.pg_depend d where d.objid = c.oid and d.deptype = 'e')
  loop
    execute format('alter table public.%I enable row level security', r.relname);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges: start from nothing
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
-- Future objects created by migrations are not exposed until granted explicitly.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
-- Per-schema defaults cannot remove PUBLIC's built-in EXECUTE; this global one does (for the
-- migration role).
alter default privileges revoke execute on functions from public;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
grant select on public.sports to anon, authenticated;
create policy sports_read on public.sports for select to anon, authenticated using (true);

grant select on public.trust_config to authenticated;
-- Thresholds are public by design (Trust Charter, DSA Art. 14).
create policy trust_config_read on public.trust_config for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url, bio, locale, country_code) on public.profiles to authenticated;
create policy profiles_read_own on public.profiles for select to authenticated
  using (id = auth.uid() or public.st_am_moderator());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid() and deleted_at is null) with check (id = auth.uid() and deleted_at is null);

grant select on public.public_profiles to authenticated;

grant select on public.profile_private to authenticated;
grant update (gender) on public.profile_private to authenticated;
create policy profile_private_read_own on public.profile_private for select to authenticated using (user_id = auth.uid());
create policy profile_private_update_own on public.profile_private for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.user_sports to authenticated;
create policy user_sports_read on public.user_sports for select to authenticated
  using (user_id = auth.uid() or (not public.st_my_blocked(user_id) and not public.st_is_hidden_user(user_id)));
create policy user_sports_insert_own on public.user_sports for insert to authenticated with check (user_id = auth.uid());
create policy user_sports_update_own on public.user_sports for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy user_sports_delete_own on public.user_sports for delete to authenticated using (user_id = auth.uid());

grant select, delete on public.push_tokens to authenticated;
create policy push_tokens_read_own on public.push_tokens for select to authenticated using (user_id = auth.uid());
create policy push_tokens_delete_own on public.push_tokens for delete to authenticated using (user_id = auth.uid());

grant select, insert, delete on public.blocks to authenticated;
create policy blocks_read_own on public.blocks for select to authenticated using (blocker_id = auth.uid());
create policy blocks_insert_own on public.blocks for insert to authenticated
  with check (blocker_id = auth.uid() and blocked_id <> auth.uid());
create policy blocks_delete_own on public.blocks for delete to authenticated using (blocker_id = auth.uid());

grant select on public.app_roles to authenticated;
create policy app_roles_read on public.app_roles for select to authenticated
  using (user_id = auth.uid() or public.st_am_moderator());

-- ---------------------------------------------------------------------------
-- Venues
-- ---------------------------------------------------------------------------
grant select on public.venues to authenticated;
grant select on public.venue_views to authenticated;
create policy venues_read on public.venues for select to authenticated
  using (status = 'active' or created_by = auth.uid() or public.st_am_moderator());

grant select on public.venue_ratings to authenticated;
create policy venue_ratings_read on public.venue_ratings for select to authenticated
  using (user_id = auth.uid() or not public.st_my_blocked(user_id));

grant select on public.venue_reports to authenticated;
create policy venue_reports_read on public.venue_reports for select to authenticated
  using (reporter_id = auth.uid() or public.st_am_moderator());

-- ---------------------------------------------------------------------------
-- Games (exact location, venue, invite token and QR secret are not granted at all; clients read
-- them per viewer through game_views / nearby_games / get_qr_token)
-- ---------------------------------------------------------------------------
grant select (id, host_id, sport, title, notes, visibility, approx_geog, hide_exact_location, capacity, starts_at,
              ends_at, deposit_minor, currency, deposit_forfeit_to, women_only, status, team_count, cancelled_at,
              created_at, updated_at)
  on public.games to authenticated;
create policy games_read on public.games for select to authenticated using (public.st_my_game_visible(id));
grant select on public.game_views to authenticated;

grant select on public.game_participants to authenticated;
create policy game_participants_read on public.game_participants for select to authenticated
  using (
    user_id = auth.uid()
    or public.st_am_moderator()
    or (public.st_am_host(game_id) and (payment_ready or status <> 'requested'))
    or (public.st_am_approved(game_id) and status in ('approved', 'waitlisted')
        and not public.st_my_blocked(user_id) and not public.st_is_hidden_user(user_id)));
grant select on public.participant_views to authenticated;

grant select on public.waitlist_offers to authenticated;
create policy waitlist_offers_read on public.waitlist_offers for select to authenticated
  using (user_id = auth.uid() or public.st_am_host(game_id));

grant select on public.game_invite_access to authenticated;
create policy game_invite_access_read_own on public.game_invite_access for select to authenticated using (user_id = auth.uid());

grant select on public.checkins to authenticated;
create policy checkins_read on public.checkins for select to authenticated
  using (user_id = auth.uid() or public.st_am_host(game_id) or public.st_am_moderator());

grant select on public.peer_confirmations to authenticated;
create policy peer_confirmations_read on public.peer_confirmations for select to authenticated
  using (confirmer_id = auth.uid() or target_id = auth.uid() or public.st_am_host(game_id));

grant select on public.game_results to authenticated;
create policy game_results_read on public.game_results for select to authenticated using (public.st_my_game_visible(game_id));

-- Raw host ratings are visible to their author only (prevents retaliation); hosts see aggregates.
grant select on public.host_ratings to authenticated;
create policy host_ratings_read on public.host_ratings for select to authenticated
  using (rater_id = auth.uid() or public.st_am_moderator());

-- ---------------------------------------------------------------------------
-- Trust (read-only for clients; all writes through definer RPCs / service role)
-- ---------------------------------------------------------------------------
grant select on public.sanctions to authenticated;
create policy sanctions_read on public.sanctions for select to authenticated
  using (user_id = auth.uid() or public.st_am_moderator());

grant select on public.appeals to authenticated;
create policy appeals_read on public.appeals for select to authenticated
  using (user_id = auth.uid() or public.st_am_moderator());

-- Reporter identity is never visible to the reported user.
grant select on public.user_reports to authenticated;
create policy user_reports_read on public.user_reports for select to authenticated
  using (reporter_id = auth.uid() or public.st_am_moderator());

grant select on public.review_queue to authenticated;
create policy review_queue_read on public.review_queue for select to authenticated using (public.st_am_moderator());

grant select on public.audit_log to authenticated;
create policy audit_log_read on public.audit_log for select to authenticated using (public.st_am_moderator());

-- ---------------------------------------------------------------------------
-- Chat (writes only by the send-message Edge Function with the service role)
-- ---------------------------------------------------------------------------
grant select on public.chat_messages to authenticated;
create policy chat_messages_read on public.chat_messages for select to authenticated
  using (public.st_my_chat(game_id) and expires_at > public.st_now() and not public.st_my_blocked(sender_id));

grant select on public.message_translations to authenticated;
create policy message_translations_read on public.message_translations for select to authenticated
  using (exists (select 1 from public.chat_messages m where m.id = message_id));

-- moderation_retained: no client access at all (service role / moderator tooling only).

-- ---------------------------------------------------------------------------
-- Notifications and payments
-- ---------------------------------------------------------------------------
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_read_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select on public.payments to authenticated;
create policy payments_read_own on public.payments for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Function EXECUTE grants
-- ---------------------------------------------------------------------------
-- Policy/view helpers (caller-relative only).
grant execute on function
  public.st_now(), public.st_am_moderator(), public.st_my_blocked(uuid), public.st_is_hidden_user(uuid),
  public.st_my_game_visible(uuid), public.st_my_exact(uuid), public.st_am_host(uuid), public.st_am_approved(uuid),
  public.st_my_chat(uuid)
  to authenticated;
grant execute on function public.st_now() to anon;
-- Raising ST:<code> from invoker triggers on client-writable tables (e.g. user_sports validation).
grant execute on function public.st_raise(text, text) to authenticated;

-- Client RPCs (each checks auth.uid() itself).
grant execute on function
  public.create_profile(text, public.locale_code, int, int, public.gender, text, text, text),
  public.create_venue(text, double precision, double precision, text[], text, text),
  public.nearby_venues(double precision, double precision, numeric, text[]),
  public.rate_venue(uuid, text, int, jsonb),
  public.report_venue(uuid, public.venue_report_reason, text),
  public.create_game(text, text, public.game_visibility, uuid, double precision, double precision, boolean, int,
                     timestamptz, timestamptz, int, text, boolean, int, text, public.deposit_forfeit_target),
  public.cancel_game(uuid),
  public.nearby_games(double precision, double precision, numeric, text[], timestamptz, timestamptz, boolean),
  public.resolve_invite(text),
  public.request_join(uuid, text, text),
  public.decide_join(uuid, uuid, text),
  public.remove_participant(uuid, uuid),
  public.cancel_participation(uuid),
  public.accept_waitlist_offer(uuid),
  public.save_teams(uuid, jsonb),
  public.submit_result(uuid, int[]),
  public.rate_host(uuid, int),
  public.get_qr_token(uuid),
  public.rotate_qr(uuid),
  public.submit_checkin(uuid, public.checkin_method, text, uuid),
  public.peer_confirm(uuid, uuid),
  public.report_user(uuid, public.user_report_category, uuid, uuid, text),
  public.block_user(uuid),
  public.unblock_user(uuid),
  public.file_appeal(uuid, text),
  public.moderator_decide(uuid, public.moderator_decision, text),
  public.register_push_token(text, public.push_platform),
  public.delete_my_account(),
  public.trust_config_json()
  to authenticated;

-- Service role only (Edge Functions and pg_cron run as privileged roles).
grant execute on all functions in schema public to service_role;
