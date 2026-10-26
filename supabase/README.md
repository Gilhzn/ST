# Sport Talent — Supabase (Postgres + PostGIS)

Owner: DB Engineer. Contract: `packages/domain/src/types.ts` (enum values are identical in SQL; columns are
snake_case). Rules mirror `@st/domain` and are pinned by the golden cases in `packages/domain/test/golden`.

## Layout

| Path | What |
|---|---|
| `migrations/0001_extensions_helpers.sql` | `postgis`/`pgcrypto` in `extensions`, all enums, `st_now()`, `st_raise()`, `st_point()`, ~500 m `st_approx_point()` |
| `0002_identity.sql` | `sports` (seeded, mirrors `SPORT_POSITIONS`/`VENUE_RATING_ATTRIBUTES`), `profiles`, `profile_private`, `user_sports`, `push_tokens`, `blocks`, `app_roles`, `public_profiles` view |
| `0003_venues.sql` | `venues` (geography GiST), `venue_views`, `venue_ratings` (per-sport attribute validation trigger + aggregate), `venue_reports` |
| `0004_games.sql` | `games` (exact `geog` + `approx_geog`, `qr_secret`, `invite_token`), `game_participants`, `waitlist_offers`, `game_invite_access`, `checkins`, `peer_confirmations`, `game_results`, `host_ratings`, `game_views` / `participant_views` |
| `0005_trust.sql` | `trust_config` (single row), `sanctions`, `appeals`, `user_reports`, `review_queue`, `audit_log`; projections, reliability, escalation, overturn cascade, derived ids |
| `0006_domain_mirror.sql` | Pure `dm_*` SQL mirrors of `@st/domain` (same JSON in → same output/Effect[] out) |
| `0007_chat.sql` | `chat_messages` (`expires_at = ends_at + 3h`), `moderation_retained` (90 d, legal hold), `message_translations` |
| `0008_payments_notifications.sql` | `notifications`, `payments`, `payment_customers`, `payment_events` |
| `0009_rpcs_games.sql` / `0010_rpcs_trust.sql` | Client RPCs |
| `0011_jobs_effects.sql` | Job functions, deposit due-lists, retention purges, `apply_effects` |
| `0090_rls_grants.sql` | RLS on every table, policies, table/column/function grants (keep last before cron) |
| `9000_cron.sql` | `pg_cron` schedules, guarded (no-op where `pg_cron` is unavailable) |
| `seed.sql` | Demo hosts, venues and upcoming games in Tel Aviv, London, Madrid, São Paulo, Tokyo, New York, Mumbai, Paris |
| `config.toml` | CLI config: project `sport-talent`, phone OTP via Twilio (`env(...)` secrets) |
| `tests/*.test.ts` | pglite SQL tests (harness by QA: `tests/harness.ts`) |

Portability: written for Supabase Postgres 15/17 and PGlite 18 (no `uuidv7`, `gen_random_uuid()`, explicit
types, `set search_path = ''` in every function). Time: every rule reads `public.st_now()` (`st.now` GUC in tests).

## Security model

- **Deny by default.** RLS is enabled on every table. `0090` revokes Supabase's broad default grants from
  `anon`/`authenticated` (tables, sequences, functions — including the PUBLIC function default) and grants back
  only what clients need. `service_role` (Edge Functions, jobs) has full access and BYPASSRLS.
- **Writes go through RPCs.** Clients can directly write only: own `profiles` display columns
  (`display_name, avatar_url, bio, locale, country_code` — column grants; trust columns are never granted),
  own `profile_private.gender`, own `user_sports` (validated), own `blocks`, delete own `push_tokens`,
  own `notifications.read_at`. Everything else (games, participants, trust, chat, payments) is written by
  SECURITY DEFINER RPCs or the service role.
- **Secrets and location.** `games.qr_secret`, `games.invite_token`, `games.geog`, `games.venue_id` are not
  granted to clients at all. Clients read games through `game_views` / `nearby_games`, which expose the exact
  pin and venue only to the host, approved participants and moderators when `hide_exact_location`; everyone
  else gets `approx_lat/approx_lng` (deterministic ~500 m grid cell centre). The radius filter **and** the
  distance of hidden games use the approximate point, so distances cannot be used to trilaterate.
- **Visibility.** `st_can_see_game`: host, participant, moderator, or public/invited games of a host who is not
  blocked with the viewer and not hidden (visibility-restricted, banned or deleted). Restricted users still
  see results; their own games and profile are hidden from others.
- **Chat**: readable by approved participants before `expires_at`, not retracted, blocked senders hidden.
  Writes only by `send-message` (service role).
- **Views** are `security_barrier` definer views with explicit `auth.uid()` row filters
  (`public_profiles`, `game_views`, `participant_views`) or `security_invoker` (`venue_views`).
- **Helpers granted to clients are caller-relative** (`st_my_blocked(other)`, `st_am_moderator()`,
  `st_my_game_visible(game)`, …) so nobody can probe block/role relations between arbitrary users.
- **Compliance CHECKs.** `sanctions_permanent_ban_by_moderator` (permanent ban ⇒ `expires_at is null` and
  `decided_by = 'moderator'`), every other kind has an expiry, dispute windows only on yellow cards, statement
  key = `sanctions.reason.<reason_code>`. `apply_effects` refuses `permanent_ban`; only `moderator_decide` issues one.
- **Deterministic ids.** `sanctions.id = stableUuid('sanction:'||dedupe_key)`, `review_queue.id =
  stableUuid('review:'||dedupe_key)` (trigger), matching `@st/domain` so effects can reference rows before insert.
  Unique `dedupe_key` on both tables makes every path idempotent.

## RPC catalog (all SECURITY DEFINER, errors `ST:<ErrorCode>`)

| RPC | Who | Notes |
|---|---|---|
| `create_profile(name, locale, birth_year, birth_month, gender?, country?, avatar?, bio?)` | authenticated | 16+ gate (`age_restricted`), copies phone from `auth.users` |
| `nearby_venues(lat, lng, radius_km, sports[])` | authenticated | radius ∈ {1,2,5,10,30,50} (`invalid_radius`), ≤ 3 sports (`too_many_sports`), active only, by distance |
| `nearby_games(lat, lng, radius_km, sports[], from?, to?, include_full?)` | authenticated | same validation; ≤ 60-day range; ordered by `starts_at`, distance (DataPort contract) |
| `create_venue`, `rate_venue(venue, sport, overall, attributes)`, `report_venue(venue, reason, note?)` | authenticated | per-sport attributes; `already_reported`; 3 distinct reporters → hidden + review |
| `create_game(...)`, `cancel_game(game)` | authenticated / host | `host_suspended`, join-banned/restricted users cannot create public games, venue must be active |
| `resolve_invite(token)` | authenticated | grants visibility of a private game |
| `request_join(game, position?, invite_token?)` | authenticated | `account_banned`, `join_banned`, `blocked`, `not_found`, `game_not_open`, `women_only`, `conflict`; deposit → request hidden until payment secured |
| `decide_join(game, user, 'approve'\|'reject')` | host | approved while room, else waitlisted; `payment_required` |
| `remove_participant(game, user)`, `save_teams(game, {user: team})` | host | removal frees the spot → waitlist offers |
| `cancel_participation(game)` | participant | late cancel (< 2 h) is decided at finalisation; returns `{participant, sanction: null}` |
| `accept_waitlist_offer(game)` | waitlisted | GAME-045 offers; flash fill < 1 h; `not_found`/`outside_window`/`game_full`/`game_not_open` |
| `submit_result(game, scores[])` | approved | `ends_at … ends_at + 2h` (`outside_window`), one score per team |
| `rate_host(game, stars)` | verified attendee | within 48 h; low average → host suspension + review |
| `get_qr_token(game)`, `rotate_qr(game)` | host | wire format `step.hex32` (domain) |
| `submit_checkin(game, 'qr'\|'host', token?, target?)` | participant / host | returns a `CheckInVerdict`; host marks others until `ends_at + 2h`, never self |
| `peer_confirm(game, target)` | verified attendee | GPS/QR-verified confirmers, max 6 each, blocked pairs excluded, reciprocal-only rejected |
| `report_user(target, category, game?, message?, note?)` | authenticated | rate limited; reported message copied to retention; evaluation below |
| `block_user`, `unblock_user`, `register_push_token(token, platform)` | authenticated | |
| `file_appeal(sanction, text)` | sanction owner | dispute inside `dispute_until` (→ `disputed`), else appeal (≤ 6 months, `dispute_window_closed`) |
| `moderator_decide(item, decision, note?)` | `app_roles` moderator/admin | uphold / overturn (cascade over `caused_by`) / lift / permanent_ban / remove|restore venue; audited |
| `delete_my_account()` | authenticated | idempotent; cancels future participations (no card), cancels hosted games, erases private data, tombstones the profile; sanctions/reports/audit/payments kept pseudonymised |
| `trust_config_json()` | authenticated | thresholds as camelCase `TrustConfig` |
| `record_checkin_verdict(game, user, verdict)` | **service** | GPS verdict from `checkin-verify` |
| `apply_effects(effects jsonb)` | **service** | applies domain `Effect[]` in order, idempotent |
| `due_deposit_holds()`, `due_deposit_settlements()` | **service** | what the payments functions should do next |

Jobs (service role / pg_cron, advisory-locked, idempotent): `process_no_shows` (finalisation at `ends_at + 2h`:
no-show and late-cancel cards, refill voiding, game-not-happened), `expire_sanctions` (auto-void undecided
disputes after 7 d, expire, escalation 2 → 7 d ban, 3 → 30 d, ≥ 4 → 30 d + review, never permanent),
`expire_waitlist_offers`, `place_deposit_holds`, `settle_deposits` (capture only after an undisputed 48 h
window), `purge_expired_messages`, `purge_retained`, `recheck_pending_messages`, `purge_retention`
(location-derived data 30 d, QR secrets/invite tokens at end + 24 h, reporter pseudonymised after 12 months,
audit 2 years, trust rows of deleted accounts after 2 years). Edge Function targets for `st_dispatch` (pg_net):
`payments-hold`, `payments-settle`, `moderation-recheck`.

Toxicity reports (`report_user` → `dm_evaluate_reports`): 3 distinct qualifying reporters in 14 days (account
≥ 7 days old at report time, not red, ≤ 10 reports in 7 days, accuracy ≥ 30 % after 5 resolved, verified
co-attendee of the reported game or member of its chat) → 72 h visibility restriction + review + notice with the
statement of reasons. Collusion (fewer independent reporters than the threshold by 48 h creation windows, or a
rival team of one game) → review only; within 14 days of an overturned restriction → review only.

## TrustConfig columns not yet in the contract

`trust_config` adds PRD v5 thresholds with defaults (mirrored by `packages/domain/src/trust/constants.ts`):
`dispute_auto_void_days` 7, `dispute_auto_void_max_per_90_days` 3, `post_overturn_protection_days` 14,
`finalize_after_end_hours` 2, `waitlist_long_threshold_hours` 6, `waitlist_confirm_long_minutes` 120,
`waitlist_confirm_short_minutes` 20, `waitlist_flash_fill_hours` 1, `reporter_min_accuracy` 0.3,
`reporter_accuracy_min_reports` 5, `host_rating_window_hours` 48, `host_rating_lookback_days` 90,
`location_samples_retention_days` 30, `qr_secret_retention_hours` 24, `user_report_retention_days` 365,
`audit_log_retention_days` 730, `sanction_retention_after_deletion_days` 730.

## Tests

```sh
npx vitest run --project @st/supabase      # pglite + PostGIS, Docker-free (~2 min)
npx tsc -p supabase/tsconfig.json
```

- `rls.test.ts`: RLS/privilege matrix for every table and view × {anon, stranger, owner, host, moderator,
  service}; write attempts; catalog invariants (RLS on, pinned `search_path`, no anon EXECUTE, service-only RPCs).
- `games.test.ts`, `map_venues.test.ts`, `checkin.test.ts`, `trust.test.ts`, `chat_account.test.ts`,
  `seed.test.ts`: every RPC rule and error code, waitlist offers / flash fill, late cancel + refill, no-show job,
  escalation ladder, appeals and auto-void, report evaluation incl. collusion, chat purge + retention, QR ±1 step
  (HMAC computed independently with `node:crypto`), approximate location, deposits, account deletion, retention.
- `golden.test.ts`: TS ≡ SQL parity over `packages/domain/test/golden/*.json`. Pure kinds run through the `dm_*`
  mirrors; `trust.applyEvent` seeds the state into tables, runs the real job/RPC and checks the database against
  the expected effects. `ChatMessageBlocked` cases are skipped (that rule runs only in `send-message`).

## Deploy

```sh
supabase link --project-ref <ref>
supabase db push                     # applies migrations in order (forward-only)
supabase secrets set SUPABASE_AUTH_SMS_TWILIO_ACCOUNT_SID=… SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN=… SUPABASE_AUTH_SMS_TWILIO_MESSAGE_SERVICE_SID=…
# Job → Edge Function dispatch (optional, needs pg_net):
#   alter database postgres set st.functions_url = 'https://<ref>.functions.supabase.co';
#   select vault.create_secret('<service key>', 'st_functions_key');
```

Enable `pg_cron` (and `pg_net`) in the dashboard before pushing so `9000_cron.sql` schedules the jobs; if it is
pushed first, re-run its body after enabling. `supabase db reset` (local) also loads `seed.sql`; production never
runs the seed. Grant moderators with the service role: `insert into app_roles (user_id, role) values (…, 'moderator')`.
