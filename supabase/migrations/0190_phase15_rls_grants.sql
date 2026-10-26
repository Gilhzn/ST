-- 0190_phase15_rls_grants.sql (Phase 1.5; runs after every Phase 1.5 schema/function migration)
-- Same model as 0090: RLS on every new table (deny by default), no client writes at all (every
-- write goes through a SECURITY DEFINER RPC or the service role), least-privilege column grants
-- (exact locations, invite tokens, original object keys, verdicts and legal-hold flags are never
-- granted), caller-relative helpers only, and explicit EXECUTE grants.

-- ---------------------------------------------------------------------------
-- RLS on, privileges from nothing
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['phase15_config', 'game_series', 'series_occurrences', 'series_roster', 'series_auto_joins',
                           'invite_joins', 'result_confirmations', 'peer_ratings', 'skill_ratings', 'rating_periods',
                           'rating_updates', 'game_rating_status', 'media_items', 'media_tags', 'media_reports',
                           'connections', 'network_privacy', 'account_review_holds'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
revoke all on public.series_views from anon, authenticated, public;
grant select on public.series_views to service_role;

-- Functions: 0090's default privileges already create every later function without client
-- EXECUTE; repeated defensively for PUBLIC and anon (the exact authenticated allow-list is pinned by
-- rls.test.ts). anon gets back st_now and get_invite_preview only.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.st_now() to anon;
grant execute on all functions in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Series
-- ---------------------------------------------------------------------------
-- Thresholds are public by design (like trust_config).
grant select on public.phase15_config to authenticated;
create policy phase15_config_read on public.phase15_config for select to authenticated using (true);

-- Exact pin, venue (masked in series_views), invite token are not granted.
grant select (id, host_id, sport, title, notes, visibility, approx_geog, hide_exact_location, capacity, min_players,
              deposit_minor, currency, deposit_forfeit_to, women_only, team_count, recurrence, weekday, start_time, time_zone,
              duration_minutes, anchor_date, end_date, horizon_weeks, roster_priority_hours, auto_join_reconfirm_hours,
              skipped_dates, schedule_revision, status, ended_at, created_at, updated_at)
  on public.game_series to authenticated;
create policy game_series_read on public.game_series for select to authenticated using (public.st_my_series_visible(id));
grant select on public.series_views to authenticated;

grant select on public.series_occurrences to authenticated;
create policy series_occurrences_read on public.series_occurrences for select to authenticated
  using (public.st_my_series_visible(series_id));

-- Own row; the host sees the roster; regulars see regulars (blocked/hidden users excluded).
grant select on public.series_roster to authenticated;
create policy series_roster_read on public.series_roster for select to authenticated
  using (user_id = auth.uid()
         or public.st_am_series_host(series_id)
         or public.st_am_moderator()
         or (public.st_am_regular(series_id) and status = 'regular'
             and not public.st_my_blocked(user_id) and not public.st_hidden_from_me(user_id)));

grant select on public.series_auto_joins to authenticated;
create policy series_auto_joins_read on public.series_auto_joins for select to authenticated
  using (user_id = auth.uid() or public.st_am_series_host(series_id));

grant select on public.invite_joins to authenticated;
create policy invite_joins_read on public.invite_joins for select to authenticated
  using (user_id = auth.uid()
         or (kind = 'game' and public.st_am_host(game_id))
         or (kind = 'series' and public.st_am_series_host(series_id)));

-- ---------------------------------------------------------------------------
-- Ratings (never public; RATE-004/005, GLK-004)
-- ---------------------------------------------------------------------------
grant select on public.result_confirmations to authenticated;
create policy result_confirmations_read_own on public.result_confirmations for select to authenticated using (user_id = auth.uid());

-- Raw peer ratings: the rater's own submissions only (the ratee sees an aggregate, never who rated).
grant select on public.peer_ratings to authenticated;
create policy peer_ratings_read_own on public.peer_ratings for select to authenticated using (rater_id = auth.uid());

grant select on public.skill_ratings to authenticated;
create policy skill_ratings_read_own on public.skill_ratings for select to authenticated using (user_id = auth.uid());

grant select on public.rating_updates to authenticated;
create policy rating_updates_read_own on public.rating_updates for select to authenticated using (user_id = auth.uid());

grant select on public.game_rating_status to authenticated;
create policy game_rating_status_read on public.game_rating_status for select to authenticated
  using (public.st_my_game_visible(game_id));

-- rating_periods, account_review_holds: service role only.

-- ---------------------------------------------------------------------------
-- Media Vault
-- ---------------------------------------------------------------------------
-- Original object keys, verdicts, legal hold and moderation flags are not granted.
grant select (id, game_id, venue_id, uploader_id, kind, status, visibility, public_opt_in, mime_type, size_bytes,
              duration_seconds, published_path, thumbnail_path, playback_ref, created_at, published_at, expires_at, removed_at)
  on public.media_items to authenticated;
create policy media_items_read on public.media_items for select to authenticated using (public.st_my_media_visible(id));

-- Tags: invisible to others until accepted (VAULT-005).
grant select on public.media_tags to authenticated;
create policy media_tags_read on public.media_tags for select to authenticated
  using (user_id = auth.uid()
         or public.st_am_media_uploader(media_id)
         or (status = 'accepted' and public.st_my_media_visible(media_id)
             and not public.st_my_blocked(user_id) and not public.st_hidden_from_me(user_id)));

grant select on public.media_reports to authenticated;
create policy media_reports_read on public.media_reports for select to authenticated
  using (reporter_id = auth.uid() or public.st_am_moderator());

-- ---------------------------------------------------------------------------
-- Network
-- ---------------------------------------------------------------------------
grant select on public.connections to authenticated;
create policy connections_read on public.connections for select to authenticated
  using ((user_a = auth.uid() and not public.st_my_blocked(user_b))
         or (user_b = auth.uid() and not public.st_my_blocked(user_a)));

grant select on public.network_privacy to authenticated;
create policy network_privacy_read_own on public.network_privacy for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Function EXECUTE grants
-- ---------------------------------------------------------------------------
-- Policy/view helpers (caller-relative only) and pure formatting used inside series_views.
grant execute on function
  public.st_my_series_visible(uuid), public.st_my_series_exact(uuid), public.st_am_series_host(uuid), public.st_am_regular(uuid),
  public.st_my_media_visible(uuid), public.st_am_media_uploader(uuid), public.st_hhmm(time)
  to authenticated;

-- Anon: the invite rich preview only (safe public fields; see 0101).
grant execute on function public.get_invite_preview(text) to anon, authenticated;

-- Client RPCs (each checks auth.uid() itself).
grant execute on function
  public.create_game(text, text, public.game_visibility, uuid, double precision, double precision, boolean, int,
                     timestamptz, timestamptz, int, text, boolean, int, text, public.deposit_forfeit_target, int, text),
  public.phase15_config_json(),
  public.create_series(jsonb),
  public.update_series(uuid, text, text, jsonb),
  public.end_series(uuid),
  public.skip_occurrence(uuid, text),
  public.join_roster(text),
  public.resolve_series_invite(text),
  public.invite_to_roster(uuid, uuid),
  public.accept_roster_invite(uuid),
  public.remove_from_roster(uuid, uuid),
  public.leave_roster(uuid),
  public.set_always_in(uuid, boolean),
  public.reconfirm_auto_join(uuid, boolean),
  public.rotate_invite_link(text, uuid),
  public.migration_stats(text, uuid),
  public.series_migration_stats(uuid),
  public.confirm_result(uuid, public.result_verdict),
  public.result_confirmation(uuid),
  public.game_rating_status(uuid),
  public.rating_eligibility(uuid),
  public.submit_peer_ratings(uuid, jsonb),
  public.my_peer_summary(text),
  public.game_skill_bands(uuid),
  public.my_skill_ratings(),
  public.create_upload_intent(uuid, public.media_kind, text, bigint, numeric),
  public.tag_user(uuid, uuid[]),
  public.respond_tag(uuid, boolean),
  public.untag(uuid, boolean, uuid),
  public.set_visibility(uuid, public.media_visibility),
  public.delete_media(uuid),
  public.report_media(uuid, public.media_report_reason, text),
  public.moderate_media(uuid, text, text),
  public.game_gallery(uuid),
  public.venue_vault(uuid, timestamptz, timestamptz),
  public.my_tag_requests(),
  public.request_friend(uuid),
  public.respond_friend(uuid, boolean),
  public.remove_friend(uuid),
  public.list_network(text),
  public.get_network_privacy(),
  public.set_network_privacy(public.upcoming_games_audience),
  public.friends_upcoming_games()
  to authenticated;

-- Service role only (Edge Functions / pg_cron): generate_occurrences, always_in_autojoin,
-- run_rating_period, finalize_media, purge_media, derive_played_with, purge_phase15_retention and
-- every st_*/dm_* internal (granted to service_role by the loop above).
