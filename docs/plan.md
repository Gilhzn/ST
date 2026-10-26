# Sport Talent: Execution Plan (PRD v4.0 → v5 + Core MVP)

## Context
- **Starting point:** the repo `Gilhzn/ST` is empty. Branch `ccr-139e1734-ezsqwi` has no commits.
- **Input:** a Hebrew PRD v4.0 for a global sports super-app (map, games, trust engine, chat, media, marketplace, 12 languages).
- **Ask:** an in-depth spec built on internet research, then implementation by a team of expert agents (Orchestrator, Architect, UI/UX, Web/Full-stack, QA, plus others as needed). Cheaper models where quality doesn't suffer.

**User decisions:**
- Stack: Expo (React Native + Expo Router) + Supabase.
- One codebase for a full web app, Android and iOS. Web is first-class.
- This round: docs + core MVP.
- Spec changes for store and law compliance are allowed (goal unchanged, mechanism changed).
- Global launch from day one: all 12 languages and every payment method.

**Research findings (3 web research agents + architect):**
- **No-show deterrence that works.**
  - Only Playtomic (4.7M players, €29M revenue) has a hard deterrent: prepayment, and a no-show becomes a debt that blocks the account.
  - Event data: paid events average about 17% no-shows vs. about 28% for free events (PheedLoop).
  - So an optional deposit is a key addition.
- **GPS geofencing.**
  - A 30–50m OS geofence isn't reliable on iOS or Android. The real floor is about 100–150m, with 2–6 minute latency.
  - Google Play is likely to reject background location used for "attendance".
  - Answer: two-stage check-in (wake-up geofence → precise foreground GPS) with QR, host and peer fallbacks.
- **Uploading the contact book is blocked by policy.** Apple 5.1.2(iv) forbids building a database from Contacts. Hashing doesn't protect phone numbers (they're trivially reversible). Replacement: peer confirmation from verified attendees, invite links, and an OS contact picker.
- **Hidden shadowbans and "zero human intervention" conflict with:**
  - DSA Art.17 (statement of reasons for a visibility restriction);
  - GDPR Art.22(3) (right to human intervention);
  - Apple 1.2 and Google UGC (expect report/block plus timely handling).
  - Answer: automate temporary measures only. Permanent ones go through human review. Every sanction gets a reason, expiry and appeal.
- **Moderation, translation and video vendors.**
  - Perspective API shuts down at the end of 2026. Moderation uses OpenAI omni-moderation plus Claude `claude-haiku-5-5` in a layered pipeline.
  - DeepL added Hebrew in 2025. Google Translate covers all 12 languages.
  - Video: Cloudflare Stream (deferred).
- **Verified in this container:**
  - pglite + pglite-postgis are on npm, so PostGIS SQL tests can run in-process.
  - Docker isn't running (`supabase start` won't run here).
  - Expo SDK 58 and MapLibre RN 11.5 are current.
- **Market:** Strava Pro converts about 2% at $79.99/year. Booking commissions and payments are the proven revenue. WhatsApp groups are the real competitor, so we add "import a WhatsApp group".

## Product improvements entering PRD v5 (on top of v4)
1. **Optional deposit:** a Stripe manual-capture hold. A no-show forfeits it to the host or a shared pot. A late cancel produces a yellow card.
2. **Waitlist** with automatic promotion and a push notification.
3. **Reliability score %**, visible on the profile and when applying to a game. A skill rating (Glicko) is a later phase, unlocked by reliability.
4. **Compliance-adjusted Trust Engine:**
   - two-stage check-in plus QR, host and peer fallbacks;
   - yellow card that can be disputed for 48h;
   - 2 cards → 7-day ban, 3 cards → 30-day ban, permanent only after human review;
   - 3 independent (non-colluding) reporters → temporary visibility restriction for 72h + review queue + notification with reasons and appeal.
5. **Host safety:** women-only games, the exact location hidden until a request is approved, verified hosts.
6. **Recurring games**, a WhatsApp invite link with a preview, and a weather alert (later phase).
7. **Age 16+** at launch. Livestreaming 18+ (later phase). In-app account deletion. Report/block everywhere.
8. **Go-to-market:** global from day one in the product, with one or two seed cities and sports for liquidity, plus game-fill KPIs.

## Agent team and models
**Orchestrator: this session (Opus)**
- Manages milestones and merges branches.
- Ownership map in `docs/agents.md`: each path has one owner, each agent works in its own worktree.

| Role | Model | Responsibility |
|---|---|---|
| Architect | Opus | architecture.md, ADRs, `packages/domain/src/types.ts`, DataPort |
| Security/Compliance | Opus | PRD v5, compliance.md (DSA/GDPR/Amendment 13/CCPA/COPPA/Apple/Play), RLS review |
| UI/UX Expert | Opus | design-system.md, `packages/ui` tokens/primitives, RTL rules, screen flows |
| Core/Trust Dev | Opus | `packages/domain` (trust, check-in, squad, moderation) |
| DB Engineer | Opus | migrations, RLS, RPCs, SQL tests, golden parity |
| App Dev (complex) | Opus | shell, auth, map, check-in/chat/teams/sanctions screens |
| Full-stack (Functions/Payments) | Opus | Edge Functions, `packages/payments` |
| App Dev (boilerplate) | Sonnet | profile, settings, legal and list screens |
| Localization ×3 | Sonnet | 13 locale folders (zh-Hans and zh-Hant separate) after the en freeze |
| QA Writer | Sonnet | Playwright e2e, extra unit tests |
| QA Adversarial + Security | Opus | RLS bypass, sanction abuse, collusion, GPS spoofing |
| Mechanical | Haiku | scaffolding, lint/format fixes |

## Monorepo layout (npm workspaces + Turborepo)
- **`apps/mobile-web`:** Expo SDK 58 with Expo Router and a dev-client.
  - Routes: `(auth)` for phone/otp/age-gate/onboarding; `(tabs)` for map/games/profile/settings; `game/[id]/{index,chat,checkin,teams,result}`; `invite/[token]`; `sanctions/[id]`; `legal/*`.
  - `src/platform/map/Map.native.tsx|Map.web.tsx` (maplibre-gl on web) and `geofence.native.ts|.web.ts`.
  - `src/data/DataPort.ts` + SupabaseAdapter + InMemoryAdapter (`EXPO_PUBLIC_DATA=mock` for e2e).
- **`packages/domain`:** pure TS with zero dependencies. Contains geo, checkin, trust, squad, moderation, games (waitlist/windows), a seeded rng, and `test/golden/*.json`.
- **`packages/i18n`:** i18next + i18next-icu, `locales/{13}/{namespaces}.json`, rtl.ts, check-keys script.
- **`packages/ui`:** tokens, theme (dark/light), Noto fonts per script, primitives (Button, Chip, Sheet, PinBadge, StatusDot, BidiText), and an eslint rule enforcing logical styles only.
- **`packages/payments`:** a PaymentProvider port with StripeProvider (cards, Apple Pay, Google Pay and local methods via the Payment Element) and FakeProvider.
  - The adapter interface also allows a local PSP; documented in an ADR. Stripe doesn't open merchant accounts for Israeli companies, so add an adapter such as PayPlus/Meshulam with Bit support.
- **`supabase/`:** migrations, seed, functions (`send-message`, `translate-message`, `checkin-verify`, `trust-evaluate`, `create-deposit`, `payments-webhook`, `delete-account`, `push-dispatch`), and tests (pglite harness + pgTAP).
  - Each function is a pure `handle(req, deps)`. Domain logic is bundled with esbuild into `_shared/domain.mjs`.
- **`docs/`:** prd-v5.md (Hebrew + English summary), architecture.md, design-system.md, qa-strategy.md, compliance.md, agents.md, adr/, deferred-phases.md.

## Database (summary)
**Tables**
- Profiles: `profiles` (reliability_score/status, chat_muted_until, host_suspended_until) and `profile_private` (phone, birth year/month).
- Sports: `sports` (positions, rating_attributes) and `user_sports`.
- Users: `push_tokens` and `blocks`.
- Venues:
  - `venues`: geography with a GIST index; status active/hidden_pending_review/removed.
  - `venue_ratings`: attributes per sport, validated by a trigger.
  - `venue_reports`: unique per reporter; the third report hides the venue and adds a review item.
- Games:
  - `games`: geog, visibility, capacity, deposit, invite_token, qr_secret.
  - `game_participants`: requested/approved/waitlisted/…, team, attendance.
  - `checkins`, `peer_confirmations`, `game_results` (window enforced by CHECK), `host_ratings`.
- Trust:
  - `trust_config`;
  - `sanctions`: kind, reason_code, statement_of_reasons, expires_at, dispute_until, status;
  - `appeals`, `user_reports`, `review_queue`, `app_roles`, `audit_log`.
- Chat: `chat_messages` (expires_at = end + 3h), `moderation_retained` (90 days), `message_translations`, `notifications`.
- Payments: `payments` (idempotency_key).

**RLS**
- On for every table.
- Trust columns can only be written through SECURITY DEFINER RPCs or service_role.
- `public_profiles` view.
- Private games are visible only to participants, or through an invite token.
- Chat is readable only by approved participants before expiry. Writes go only through `send-message`.

**RPCs**
- Map: `nearby_venues` / `nearby_games` (ST_DWithin; radius in {1,2,5,10,30,50}; at most 3 sports).
- Games: `create_game`, `request_join`, `decide_join`, `cancel_participation`, `submit_result`.
- Venues and trust: `report_venue`, `rate_venue`, `report_user`, `rotate_qr`, `file_appeal`, `moderator_decide`.
- Account: `delete_my_account` anonymises and keeps pseudonymised sanctions.

**Scheduled jobs (pg_cron, guarded):** `process_no_shows`, `expire_sanctions`, `purge_expired_messages`, `purge_retained`.

## Trust Engine and algorithms (pure functions `(state, event, config, now) → {state, effects[]}`)
**`verifyGps`**
- Window: starts_at − 30m to ends_at.
- 2–3 samples at least 5s apart, each with accuracy ≤ 25m.
- Distance ≤ 50 + accuracy, with sample spread < 30m.
- A mock location or a speed above 250 km/h routes to a fallback; it never triggers a sanction by itself.

**Fallbacks**
- `verifyQr`: HMAC(qr_secret, gameId‖⌊t/30s⌋), ±1 step. Works on web.
- `verifyHost`.
- `verifyPeer`: at least 2 verified attendees, not a reciprocal-only pair, blocked pairs excluded.

**Yellow card and escalation**
- Card lifecycle: issued → disputable (48h) → disputed → upheld/overturned → expired (30 days).
- Escalation: 2 → join_ban 7 days, 3 → 30 days, 4+ → review_queue (permanent ban only by a human).

**Reports and host reliability**
- `evaluateReports`: 3 distinct reporters in 14 days.
  - A qualifying reporter has an account at least 7 days old and isn't red/spamming.
  - Collusion (accounts created within the same 48h) → queue only.
  - Outcome: 72h restriction + queue + notification with reasons and appeal.
- Host: a confirmed fake venue, or an average rating ≤ 2 across 5+ ratings → host_suspension + review.

**Chat moderation**
- Pipeline: client blocklist → `send-message` runs omni-moderation and Haiku in parallel with a 1.5s timeout.
- Outcome: block, nudge or allow. On provider failure → allow-pending plus an async recheck.
- 3 blocks in 7 days → yellow card + 24h mute.

**Reliability %**
- Formula: (verified + 3) / (commitments + 3) over 90 days. A late cancel counts as 0.5. Fewer than 3 games → "New".
- Status: green = no yellow card and ≥ 85%; red = a ban or < 60%; otherwise yellow.

**Squad balancing**
1. Fill scarce positions first (e.g. goalkeepers).
2. Snake draft with a seeded RNG.
3. Simulated annealing (3000 swaps). Cost = rating-difference² + 10·position deficit + 100·size imbalance.
4. Runs in under 5ms for n ≤ 40. Reshuffling uses a new seed.

**Parity:** shared golden cases run against both TS (vitest) and SQL (pglite through the RPCs).

## Milestones (dependencies → agent)
| # | Milestone | Agent | Depends on |
|---|---|---|---|
| M0 | Root config, initial commit, agents.md | Orchestrator + Haiku | — |
| M1 (parallel) | a. Architecture/contracts | Architect | M0 |
| | b. PRD v5 + compliance | Compliance | M0 |
| | c. Design system + `packages/ui` | UI/UX | M0 |
| | d. QA strategy + pglite RLS/SET ROLE spike, first | QA + DB | M0 |
| M2 (parallel) | a. domain + tests | Core | M1a |
| | b. migrations/RLS/RPC/SQL tests | DB | M1a, M1d |
| | c. i18n runtime + RTL restart flow + en strings | Localization | M1c |
| | d. App shell/auth/map | App Opus | M1a, M1c |
| M3 | a. Boilerplate screens | App Sonnet | M2d |
| | b. Check-in/chat/teams/sanctions screens | App Opus | M2a, M2b, M2d |
| | c. Functions + payments | Full-stack | M2a, M2b |
| | d. 13 locales after the en freeze | 3× Localization | M3a, M3b |
| M4 | a. e2e | QA Sonnet | M3 |
| | b. Adversarial review | QA + Security Opus | M3 |
| | c. Fix loop | owners + Haiku | M4b |
| M5 | Final docs, deferred-phases.md, release checklist, push to `ccr-139e1734-ezsqwi` | Architect + Orchestrator | M4 |

**Deferred (docs only):** media vault with a 2h upload window, reels, live streaming/GoPro (Cloudflare Stream/LiveKit), trainer marketplace (Stripe Connect; Apple 3.1.3(d)), nutrition and coupons, geo ads (coarse location + opt-in), Pro (RevenueCat), boost, tournaments, Glicko rating, weather.

## Verification (`npm run verify`)
1. `tsc -b` + eslint, including the logical-styles rule.
2. vitest + fast-check on domain, with coverage ≥ 95% lines / 90% branches.
   - Squad properties: every player assigned once, team sizes within ±1, no worse than a plain snake draft, deterministic per seed.
3. SQL tests via pglite-postgis with Supabase shims (roles, auth.uid). They cover:
   - RLS allow/deny for every table;
   - RPC rules, venue auto-hide, waitlist promotion, the late-cancel card;
   - golden parity.
   - Fallbacks if pglite doesn't support something: `SQL_TESTS=pg` (local PG16 + postgis via apt) or pgTAP when Docker is available.
4. vitest on Edge Function handlers with fake OpenAI, Anthropic and Translate clients (timeouts, fallback).
5. i18n check-keys: same keys as en, ICU parses, matching placeholders, CLDR plural categories (ar has 6), no empty strings.
6. `expo export --platform web`, then Playwright on dist with the mock adapter and a local blank map style.
   - Flows: OTP → age gate → map filters → create/join → QR check-in → chat → report → delete account.
   - he/ar screenshots with `dir=rtl` asserted, plus axe for accessibility.
7. Native (EAS build) can't be tested in this container; documented in qa-strategy.md.
8. Commit at the end of each milestone, then `git push -u origin ccr-139e1734-ezsqwi`. No PR unless asked.

## Key risks
- **pglite may not support RLS.** It's a spike first, with PG16/pgTAP as the fallback.
- **Native not verifiable here.** Thin platform layer; logic lives in domain.
- **Machine-translated locales and legal text.** Marked "requires native review".
- **Stripe holds expire after about 7 days.** Create the hold at T−24h, with a SetupIntent when joining.
- **Conflicts between agents.** One owner per path, worktrees after M0.
