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
| `0090_rls_grants.sql` | RLS on every table, policies, table/column/function grants |
| `0091_realtime.sql` | Realtime Authorization policy on `realtime.messages` (guarded: skipped where Realtime is absent) |
| `0100_series.sql` | Phase 1.5: `phase15_config` (≡ `DEFAULT_PHASE15_CONFIG`), Phase 1.5 notification kinds, `game_series`, `series_occurrences`, `series_roster`, `series_auto_joins`, `invite_joins`, `games.series_id/time_zone`, `series_views`; series RPCs and jobs; `request_join` / `nearby_games` / `st_can_see_game` / `st_promote_waitlist` extended for the roster window and regulars |
| `0101_invites.sql` | `get_invite_preview` (anon), `rotate_invite_link`, `migration_stats` / `series_migration_stats` |
| `0102_ratings.sql` | `result_confirmations`, `peer_ratings`, `skill_ratings`, `rating_periods`, `rating_updates`, `game_rating_status`, `sports.player_rating_attributes`, `games.teams_published_at`; Glicko-2 / peer mirrors (`dm_glicko2_update`, `dm_process_rating_period`, `dm_aggregate_peer_ratings`, …), rating RPCs and `run_rating_period` |
| `0103_media_vault.sql` | `media_items`, `media_tags`, `media_reports`; upload intents, finalisation, consent tagging, galleries, reports, retention, deletion |
| `0104_network.sql` | `connections` (played-with + friend state, one row per pair), `network_privacy`; friend RPCs, `derive_played_with`, `friends_upcoming_games`; blocks delete friendships |
| `0105_account_phase15.sql` | `delete_my_account` covers Phase 1.5 data; `purge_phase15_retention` |
| `0106_domain_mirror_phase15.sql` | `dm_*` mirrors of `series`, `vault`, `network` (golden `series.*`, `vault.*`, `network.*`) |
| `0107_phase15_effects_jobs.sql` | `account_review_holds` (CSAM hold), `apply_effects` + Phase 1.5 effects, `create_game(…, p_time_zone)`, `retry_stuck_media`, `run_series_jobs` / `run_rating_jobs` |
| `0190_phase15_rls_grants.sql` / `0191_storage_media.sql` | RLS + grants for every Phase 1.5 table; Storage bucket `media` and object policies (guarded: skipped without the `storage` schema) |
| `9000_cron.sql` | `pg_cron` schedules, guarded (no-op where `pg_cron` is unavailable) |
| `9001_cron_phase15.sql` | Phase 1.5 schedules (series jobs, rating periods, media retry, played-with, retention) |
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

## Security hardening (adversarial review round)

- **Late cancels stick (H1).** A cancelled row with a pending late cancel cannot be re-opened by `request_join`
  (`conflict`), and `cancel_participation` keeps `late_cancel` once set.
- **Check-in (H2).** The host can never QR-verify themself (`not_host`). QR tokens rotate every 20 s and are accepted
  for the current and the previous step only (future steps `invalid_qr`, older `expired_qr`), so a relayed screenshot
  lives ≤ 40 s. Only **GPS-verified** attendees anchor peer check-ins (`peer_confirm` and `dm_verify_peer`).
- **Report brigading (H3).** Reports all from one game → review only (`single_game`); at least one reporter must be
  GPS-verified at the reported game and not its host (`no_gps_anchor`), else review only.
- **Women-only (H4).** `profile_private.gender` can change once per 90 days (clock starts at onboarding; the service
  role may override); women-only games need a female host; `hide_exact_location` defaults to true for women-only and
  private games.
- **Ban evasion (H5) — compliance note.** Account deletion is never blocked (GDPR Art. 17, Apple 5.1.1(v)). When a
  deleted account still has restrictions in force (join ban, mute, restriction, host suspension, permanent ban), a
  keyed **HMAC-SHA256 of the E.164 phone** (key: Vault secret `st_phone_hmac_key`; tests use the `st.phone_hmac_key`
  setting) is stored in `sanction_phone_hmac` with the sanction ids and the latest expiry — no plaintext phone. It is
  service-role only, used only to re-issue the remaining periods when the same phone registers again
  (`create_profile`, with a notice and statement of reasons), and purged by `purge_retention` when the restrictions
  expire. Lawful basis: legitimate interest in preventing abuse (GDPR Art. 6(1)(f)), data minimised to a keyed hash and
  limited to the sanction period; documented in docs/compliance.md §4/§8 ("HMAC of the phone kept only while a
  sanction record is retained"). Configure: `select vault.create_secret('<random 32+ bytes>', 'st_phone_hmac_key');`.
- **Realtime (H6).** `realtime.messages` SELECT for authenticated users only on topic `game:<uuid>` when the caller is
  an approved participant and the chat has not expired; **no INSERT policy**, so only the service role broadcasts.
  In the dashboard, Realtime → Settings: **disable "Allow public access"** (private channels only).
- **Results (M1)** are submitted by the host only. **Venue reports (M2)** count only qualified reporters (account
  ≥ `min_reporter_account_age_days` when reporting, not red). **Deposits (M4)** must match `deposit_tiers`
  (≈ $2/5/10/20 per currency) and always forfeit to the pot. **Host late game cancellation (M6)** issues the host a
  disputable `late_cancel` card (`host_late_cancel:<game>:<host>`, never a deposit card); 2 in 30 days → host suspension.
- **L1** clients get only caller-relative helpers (`st_hidden_from_me`). **L2** `st_now()` honours `st.now` only when
  `st.test_mode = 'on'` (the harness sets both). **L5** no removals after the start; `rotate_qr` only until `ends_at`.

## RPC catalog (all SECURITY DEFINER, errors `ST:<ErrorCode>`)

| RPC | Who | Notes |
|---|---|---|
| `create_profile(name, locale, birth_year, birth_month, gender?, country?, avatar?, bio?)` | authenticated | 18+ gate (`age_restricted`; minimum from `trust_config.min_age_years`, default 18), copies phone from `auth.users` |
| `nearby_venues(lat, lng, radius_km, sports[])` | authenticated | radius ∈ {1,2,5,10,30,50} (`invalid_radius`), ≤ 3 sports (`too_many_sports`), active only, by distance |
| `nearby_games(lat, lng, radius_km, sports[], from?, to?, include_full?)` | authenticated | same validation; ≤ 60-day range; ordered by `starts_at`, distance (DataPort contract) |
| `create_venue`, `rate_venue(venue, sport, overall, attributes)`, `report_venue(venue, reason, note?)` | authenticated | per-sport attributes; `already_reported`; 3 distinct reporters → hidden + review |
| `create_game(..., p_min_players = 2)`, `cancel_game(game)` | authenticated / host | `min_players` 2..capacity, `host_suspended`, join-banned/restricted users cannot create public games, venue must be active |
| `resolve_invite(token)` | authenticated | grants visibility of a private game |
| `request_join(game, position?, invite_token?)` | authenticated | `account_banned`, `join_banned`, `blocked`, `not_found`, `game_not_open`, `women_only`, `conflict`; deposit → request hidden until payment secured |
| `decide_join(game, user, 'approve'\|'reject')` | host | approved while room, else waitlisted; `payment_required` |
| `remove_participant(game, user)`, `save_teams(game, {user: team})` | host | removal frees the spot → waitlist offers |
| `cancel_participation(game)` | participant | late cancel (< 2 h) is decided at finalisation; returns `{participant, sanction: null}` |
| `accept_waitlist_offer(game)` | waitlisted | GAME-045 offers; flash fill < 1 h; `not_found`/`outside_window`/`game_full`/`game_not_open` |
| `submit_result(game, scores[])` | host | `ends_at … ends_at + 2h` (`outside_window`), one score per team |
| `rate_host(game, stars)` | verified attendee | within 48 h; low average → host suspension + review |
| `get_qr_token(game)`, `rotate_qr(game)` | host | wire format `step.hex32`, 20 s steps, current + previous accepted |
| `submit_checkin(game, 'qr'\|'host', token?, target?)` | participant / host | returns a `CheckInVerdict`; host marks others until `ends_at + 2h`, never self |
| `peer_confirm(game, target)` | GPS-verified attendee | GPS-verified confirmers only, max 6 each, blocked pairs excluded, reciprocal-only rejected |
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

## Phase 1.5 (contract v3)

Security model additions (same rules as above: deny by default, writes only through definer RPCs, caller-relative
helpers only — the exact `authenticated` EXECUTE allow-list is pinned in `rls.test.ts`):

- **Series / roster (GAME-010/011).** Occurrences are generated by `dm_plan_series_occurrences` (≡ `planSeriesOccurrences`):
  slots starting in `(now, now + 4 weeks]`, wall-clock time in the series' IANA zone (`st_local_to_utc`: DST gaps shift
  forward, overlaps take the earlier instant, ≡ `zonedTimeToEpoch`), game id `stableUuid('occurrence:' + key)`. Nothing is
  generated while the host is deleted/banned/suspended. **Roster-only window:** `request_join` raises `ST:roster_priority`
  for non-regulars until `priority_until = min(opensAt + rosterPriorityHours, startsAt)`, also with the occurrence's own
  invite token; `nearby_games` hides the occurrence from them meanwhile. Regulars see private occurrences and are offered
  waitlist spots first. "Always in" auto-joins skip deposit series (the player must save a payment method).
- **Invite preview (anon).** `get_invite_preview(token)` returns only InvitePreview fields (sport, title, schedule, local
  time zone, spots, capacity, women-only flag, host display name). No coordinates ever; `areaLabel` (venue name) only for
  public games whose location is not hidden and not women-only; never phone numbers or participants.
- **Ratings.** Never readable publicly: the rater reads their own raw ratings, the ratee only an aggregate
  (`my_peer_summary`), the host only a 1–5 band (`game_skill_bands`). RATE-005: no trust function reads a rating table
  (catalog test). Glicko math in `double precision`, ≡ TS to 1e-6 (golden + fuzz).
- **Media Vault.** Original object keys, verdicts and legal-hold flags are not granted. `venue_public` requires the
  uploader's opt-in, no blocking tag (requested, declined, or removed with a veto — a veto is permanent), and a public,
  non-women-only game with a venue. HEIC/HEIF are refused (the pipeline cannot sanitise them). CSAM: `finalize_media`
  blocks with legal hold; `RestrictAccountPendingReview` (via `apply_effects`) is a durable hold (`account_review_holds`)
  on joins/visibility/chat/hosting/uploads that survives projection recomputes until a moderator dismisses the
  `media_csam` review. Media rejects are raised as `ST:<code>: <MediaRejectReason>`.
- **Network.** Friend requests need a played-with history; blocks hide the pair and delete the friendship;
  friends' games come from `game_views` (location masked per viewer), public games only, `network_privacy` respected.

RPC catalogue (Phase 1.5, all SECURITY DEFINER):

| RPC | Who | Notes |
|---|---|---|
| `create_series(GameSeriesCreateInput jsonb)` | authenticated | validation per `Phase15Config`; `host_suspended`, `join_banned`, `women_only`; generates the first horizon |
| `update_series(series, 'this'\|'following', occurrence_key, patch jsonb)` / `end_series(series)` / `skip_occurrence(series, key)` | host | schedule change = reschedule (revision + 1); `outside_window` inside the late window with players; skip/end inside it = host late cancel (M6) |
| `join_roster(token)` / `resolve_series_invite(token)` | authenticated | link joiners become regulars (`invite_joins`); `conflict`, `blocked`, `women_only`, `forbidden` (removed) |
| `invite_to_roster` / `remove_from_roster` (host), `accept_roster_invite` / `leave_roster` / `set_always_in` / `reconfirm_auto_join` | authenticated | invites need played-with; `set_always_in` regulars only (`forbidden`) |
| `get_invite_preview(token)` | **anon** | see above |
| `rotate_invite_link(kind, id)` / `migration_stats(kind, id)` / `series_migration_stats(series)` | host | |
| `confirm_result` / `result_confirmation` / `game_rating_status` | verified participant / viewer | GAME-071 majority; GLK-003 label |
| `rating_eligibility` / `submit_peer_ratings` / `my_peer_summary` / `game_skill_bands` / `my_skill_ratings` | authenticated | RATE-002 gates → `forbidden` (reasons in detail), `outside_window`, `validation` |
| `create_upload_intent` / `tag_user` / `respond_tag` / `untag` / `set_visibility` / `delete_media` / `report_media` / `game_gallery` / `venue_vault` / `my_tag_requests` | authenticated | `moderate_media` for moderators |
| `request_friend` / `respond_friend` / `remove_friend` / `list_network` / `get_network_privacy` / `set_network_privacy` / `friends_upcoming_games` | authenticated | |
| `finalize_media`, `apply_effects` | **service** | pipeline verdicts; Phase 1.5 effects `RestrictAccountPendingReview`, `Notify15`, `PreserveMediaEvidence` |

Jobs (service role / pg_cron, idempotent, advisory-locked): `generate_occurrences`, `always_in_autojoin` (T−48h
reconfirm, T−24h release without a card, GAME-011 leave offer), `run_rating_period` (weekly ISO periods, ≥ 48 h after
the period), `derive_played_with`, `purge_media` (12 months, stale uploads 24 h), `retry_stuck_media`,
`purge_phase15_retention`; `run_series_jobs` / `run_rating_jobs` go through the `series-jobs` / `rating-period` Edge
Functions when dispatch is configured. Removed media objects are deleted by the `media-purge` Edge Function (`st_dispatch`).

New ErrorCode: `roster_priority`.

**Media object deletion requires dispatch.** `purge_media`, `st_remove_media`, account deletion and
`purge_orphan_originals` only change rows; the objects are deleted by the `media-purge` Edge Function through
`st_dispatch`, so `st.functions_url` and the Vault secret `st_functions_key` MUST be configured in production
(otherwise removed and orphaned originals stay in Storage).

### Security hardening (review #2, `security_regressions2.test.ts`)

- **H1** `RestrictAccountPendingReview` creates a durable `account_review_holds` row: it projects join ban, visibility
  restriction, chat mute **and host suspension**, survives `st_recompute_projections`, blocks uploads, and follows the
  phone through delete-and-re-register (`sanction_phone_hmac.hold_until`, re-applied by `create_profile`).
- **H2** Confirmations store the score they confirmed; only verdicts on the current score count, and `submit_result`
  with a new score resets them and asks the confirmers again.
- **M1** The venue vault requires a public, non-women-only game with a venue and a visible location; changing the game
  demotes its items. **M3** declined/vetoed tags are final (no re-request, no uploader removal).
- **M2** friend requests: limit counted from `audit_log` (append-only), 30-day pair cooldown after a decline/cancel,
  one notice per pair per day; `roster_added` once per member. **M4** `update_series`: 10 edits/24 h per host, one
  schedule change per series/24 h; rescheduled occurrences nobody joined are hard-deleted.
- **L1** `save_teams` only before kickoff. **L2** in-window occurrences are hidden from non-regulars in `game_views` and
  `series_occurrences`. **L4** no reliability ⇒ frozen in Glicko (domain + mirror). **L5** a held account gets a bare
  `ST:forbidden`; CSAM blocks send the same generic policy notice.
- **Retention** blocked non-CSAM items expire like others; never-completed intents after 24 h; orphaned originals are
  found by `purge_orphan_originals` (guarded when the storage schema is absent).

## TrustConfig parity

Every `trust_config` column is a `TrustConfig` field (contract v2) with the same default, including the PRD v5
additions (`dispute_auto_void_days` 7, `dispute_auto_void_max_per_90_days` 3, `post_overturn_protection_days` 14,
`finalize_after_end_hours` 2, `waitlist_*`, `reporter_*`, `host_rating_*`, retention periods) and
`host_suspension_days` 14 (PRD TRUST-051). camelCase ↔ snake_case is mechanical in both directions (digits form their
own segment: `disputeAutoVoidMaxPer90Days` ↔ `dispute_auto_void_max_per_90_days`); `schema.test.ts` asserts
`trust_config_json()` equals `DEFAULT_TRUST_CONFIG` key for key. Fixed rule constants (peer cap 6, spam 10/7 d,
game-happened floor 2, severe SLA 1 h) live in `packages/domain/src/trust/constants.ts` and are hard-coded here.

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
- `security_regressions.test.ts`: one test per adversarial finding (H1–H6, M1, M2, M4, M6, L1, L2, L5).
- `series.test.ts`, `ratings.test.ts`, `vault.test.ts`, `invites_network.test.ts`: Phase 1.5 RPC rules and error codes,
  DST generation (London, Jerusalem), the roster window, AC-GLK-003/004, AC-RATE-002, AC-VAULT-001/003/004/005, anon
  preview privacy, network privacy and blocks, Phase 1.5 account deletion; `schema.test.ts` pins `phase15_config` and
  the v3 enums.
- `golden.test.ts`: TS ≡ SQL parity over `packages/domain/test/golden/*.json` (Phase 1.5 kinds included; Glicko outputs
  compared at 6 decimals). Pure kinds run through the `dm_*`
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

Realtime: disable public channel access (Realtime → Settings). Vault: create `st_phone_hmac_key` (H5) and, for job
dispatch, `st_functions_key`.

Enable `pg_cron` (and `pg_net`) in the dashboard before pushing so `9000_cron.sql` schedules the jobs; if it is
pushed first, re-run its body after enabling. `supabase db reset` (local) also loads `seed.sql`; production never
runs the seed. Grant moderators with the service role: `insert into app_roles (user_id, role) values (…, 'moderator')`.
