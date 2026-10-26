# Sport Talent — QA Strategy

Owner: QA Lead. Status: v1 (M1d). Scope: core MVP (web, Android, iOS from one Expo codebase + Supabase).
This document says **what** we test, **where** each risk is covered, **how** to run it, and **when** a change may ship.
Ground truth for behaviour: `docs/prd-v5.md`, `docs/plan.md` (Trust Engine, Database, Verification), `packages/domain/src/types.ts`.

---

## 1. Quality goals

| # | Goal | Measured by |
|---|---|---|
| Q1 | **Nobody is sanctioned wrongly by automation.** No yellow card, ban or visibility restriction without the documented trigger; every sanction has reason, expiry, dispute/appeal path. | Golden cases (TS ≡ SQL), property tests, sanction tamper tests, 0 open S1/S2 in trust |
| Q2 | **Private data stays private.** RLS denies every cross-user read/write not explicitly allowed; exact location hidden until approval; phone/birth date never leave `profile_private`. | RLS deny matrix (100% tables × roles × verbs), adversarial review sign-off |
| Q3 | **Core loop works on all three platforms**: find game → join → check in → play → result. | Playwright critical flows (web), Maestro flows (native, EAS) |
| Q4 | **Global from day one**: 13 locale folders, RTL correct for he/ar, plural rules correct. | i18n checker, RTL e2e + screenshots, pseudo-locale run |
| Q5 | **Accessible**: WCAG 2.1 AA on web; TalkBack/VoiceOver usable on native. | axe (0 serious/critical), manual SR pass per release |
| Q6 | **Fast on low-end hardware**. | Budgets in §9 enforced in CI |
| Q7 | **Store and law compliant**: in-app deletion, report/block everywhere, no background location for attendance, 16+ gate. | Release checklist §11 |

---

## 2. Risk-based test matrix

Likelihood (L) and impact (I) on 1–3; risk = L×I. Risk ≥ 6 needs automated coverage at **two** layers.

| Module | Key risks | L | I | Risk | Unit / property (vitest + fast-check) | SQL (pglite harness) | Function handler | E2E (Playwright web) | Native (Maestro) | Manual / exploratory |
|---|---|---|---|---|---|---|---|---|---|---|
| **Trust engine** (cards, escalation, reports, host reliability, reliability %) | Wrong sanction; double sanction on retry; collusion ring bans a user; sanction never expires; GDPR 22(3)/DSA 17 violation (no reasons/appeal) | 3 | 3 | 9 | Every transition of the card lifecycle; escalation 2→7d, 3→30d, 4+→queue only; `permanent_ban` never emitted by system; idempotency (same event twice = same state); properties: monotone in cards, expiry always set, `decidedBy='system'` ⇒ kind ≠ permanent_ban | Golden parity via RPCs/`trust-evaluate`; sanctions writable only by definer RPC/service_role; `expire_sanctions` job; pseudonymised sanctions survive deletion | `trust-evaluate` with fake clock & fake DB | E2E-09 sanction screen shows reason, expiry, dispute | sanctions screen | Moderator review of 20 random auto-sanctions per week in beta |
| **Check-in** (GPS, QR, host, peer) | False "no-show" → yellow card; GPS spoof accepted; QR replay; peer collusion; web user without GPS can't check in | 3 | 3 | 9 | `verifyGps` boundaries (window −30m/end, 5s spacing, accuracy 25m, distance 50+acc, spread 30m, 250 km/h); spoof signals never sanction alone; `verifyQr` ±1 step, wrong game, wrong secret; `verifyPeer` ≥2, reciprocal-only, blocked pairs | `checkins` insert only via RPC; `qr_secret` never readable by non-host; peer confirmations need verified confirmer | `checkin-verify` handler: malformed body, clock skew | E2E-06 QR check-in (web) | GPS two-stage + geofence wake-up, QR scan with camera | Field test at 3 real venues (urban canyon, indoor, open park) |
| **Squad balancing** | Uneven teams; GK on same team; non-determinism breaks "reshuffle" | 2 | 2 | 4 | Properties: every player exactly once; sizes ±1; cost ≤ plain snake draft; deterministic per seed; scarce positions spread; perf < 5 ms n=40 | — | — | E2E-07 teams screen | — | — |
| **RLS / security** | Data leak across users; privilege escalation via RPC; tampering trust columns; invite-token enumeration | 3 | 3 | 9 | — | Deny matrix (§7.1) for every table; RPC auth checks; `security definer` functions have `set search_path = ''` and check `auth.uid()` | Functions use service key only server-side; JWT verified | E2E-11 private game invisible without invite | — | Adversarial review (M4b), external pentest before GA |
| **Chat moderation** | Toxic message delivered; provider outage blocks all chat; false-positive storms in he/ar; chat readable after expiry | 3 | 2 | 6 | `decide` block/nudge/allow table; 3 blocks/7d ⇒ card + 24h mute; client blocklist normalisation (case, diacritics, homoglyphs) | Chat readable only by approved participants before `expires_at`; writes only via `send-message`; `purge_expired_messages`, 90-day retention | `send-message`: fake OpenAI/Anthropic; 1.5 s timeout ⇒ allow-pending + recheck; both fail; one fails; malformed responses | E2E-08 chat send + nudge + report | chat on device | Multilingual red-team set (≥50 msgs per launch language) |
| **i18n / RTL** | Missing keys; broken ICU crashes screen; wrong plural in ar/ru; mirrored icons wrong; bidi garbling of names/phones | 3 | 2 | 6 | Checker (§6); `rtl.ts` | — | localized push/notification payloads | RTL project (he-IL), `dir=rtl`, screenshots he/ar | RTL restart flow (`I18nManager.forceRTL` + reload) | Native-speaker review of machine-translated locales ("requires native review" flag) |
| **Payments / deposit** | Double charge; hold not released; hold expired (~7d) before capture; webhook replay; wrong currency minor units | 2 | 3 | 6 | `packages/payments` with FakeProvider: state machine, idempotency keys, minor-unit math (JPY 0-dec, KWD 3-dec) | `payments.idempotency_key` unique; only service_role writes | `create-deposit`, `payments-webhook`: signature check, replay, out-of-order events | E2E-05 join paid game with mock provider | Apple Pay/Google Pay sandbox | Stripe test-mode run per release; local PSP (Bit) sandbox |
| **Account deletion** | Data left behind; sanctions laundered by re-registering; deletion fails silently | 2 | 3 | 6 | — | `delete_my_account` anonymises profile, removes private data, keeps pseudonymised sanctions; FK cascade audit | `delete-account` (auth user removal, storage, push tokens) | E2E-12 delete account from settings | in-app deletion on both stores | Web deletion link works logged out (Play requirement) |
| **Accessibility** | Unlabelled controls; focus traps in sheets; contrast; touch targets < 44/48 | 2 | 2 | 4 | UI primitives have role/label props required by type | — | — | axe on every critical-flow screen | TalkBack/VoiceOver pass | Manual SR pass per release |
| **Map / discovery** | Slow with many pins; wrong radius; location required to use app (Apple 5.1.2(i)) | 2 | 2 | 4 | radius set {1,2,5,10,30,50}, ≤3 sports | `nearby_venues`/`nearby_games` ST_DWithin correctness, hidden venues excluded, private games excluded | — | E2E-03 filters; map works with location denied | map on low-end Android | — |
| **Games / waitlist** | Over-capacity; waitlist not promoted; late-cancel card wrong | 3 | 2 | 6 | window rules, promotion order | `request_join`/`decide_join`/`cancel_participation` concurrency (two joins for last seat), auto-promotion, late-cancel card | push-dispatch on promotion | E2E-04 create & join | — | — |

---

## 3. Test pyramid and tooling

```
            ▲   Manual / exploratory / native-speaker / field GPS   (per release)
           ▲▲▲  Native e2e: Maestro on EAS builds                    (nightly + release)
         ▲▲▲▲▲  Web e2e: Playwright on static export (mock data)     (every PR, ~2 min)
      ▲▲▲▲▲▲▲▲  Handler tests: Edge Functions with fakes (vitest)    (every PR)
   ▲▲▲▲▲▲▲▲▲▲▲  SQL tests: pglite + PostGIS + Supabase shims          (every PR)
▲▲▲▲▲▲▲▲▲▲▲▲▲▲  Unit + property: vitest + fast-check (domain, i18n, payments)
```

| Layer | Tool | Location | Command |
|---|---|---|---|
| Unit / property | vitest 5, fast-check 4 | `packages/*/test/**`, `packages/*/src/**/*.test.ts` | `npx vitest run --project @st/domain` (all: `npm test`) |
| Coverage gate | @vitest/coverage-v8 | root `vitest.config.ts` | `npm run test:coverage` — domain ≥ 95% lines / 90% branches |
| SQL | PGlite 0.5 + pglite-postgis (in-process WASM Postgres 18 + PostGIS 3.6) | `supabase/tests/**/*.test.ts`, harness `supabase/tests/harness.ts` | `npx vitest run --project @st/supabase` or `npm run sql:test` |
| Edge Functions | vitest, fakes injected via `handle(req, deps)` | `supabase/functions/**/*.test.ts` | same project as SQL |
| i18n | `packages/i18n` check script | `packages/i18n/scripts/check-keys.*` | `npm run i18n:check` |
| Web e2e | Playwright 1.63 + @axe-core/playwright | `apps/mobile-web/e2e/**` | `cd apps/mobile-web && EXPO_PUBLIC_DATA=mock npx expo export --platform web --output-dir dist && npx playwright test` |
| Native e2e | Maestro + EAS Build | `apps/mobile-web/.maestro/**` (future) | `maestro test .maestro` against an EAS dev/preview build |

**Determinism rules (all layers)**
- No wall clock in logic: domain functions take `now: EpochMs`; SQL time-dependent code reads `coalesce(nullif(current_setting('st.now', true), '')::timestamptz, now())` so the harness can set `{ now }`; e2e uses a fixed `timezoneId` and the mock adapter's clock.
- Randomness only through the seeded RNG in `packages/domain`; fast-check failures print the seed — paste it into a regression test.
- No network in unit/SQL/handler tests. All vendors (OpenAI, Anthropic, Translate, Stripe, push) are fakes.

### 3.1 SQL test harness (PGlite) — verified in spike M1d

`supabase/tests/harness.ts` boots PGlite with `postgis` + `pgcrypto` (both in schema `extensions`), installs Supabase shims, applies `supabase/migrations/*.sql` in lexical order and snapshots seeded rows.

```ts
const db = await createHarness();           // per test file (beforeAll)
const alice = await db.createUser({ phone: "+972500000001", createdAt: "2026-01-01T00:00:00Z" });
await db.asUser(alice, (tx) => tx.query("select * from games"), { now: "2026-03-01T18:00:00Z" });
await db.asAnon((tx) => tx.query("..."));    // role anon
await db.asService((tx) => tx.query("...")); // role service_role (BYPASSRLS)
await db.asRole("authenticated", { sub: alice, app_metadata: { role: "moderator" } }, fn);
await db.query("insert ...");                // superuser fixture seeding (bypasses RLS)
await db.reset();                            // afterEach: truncate all app tables, restore migration-seeded rows (~60 ms)
await db.close();
```

Shims: roles `anon`, `authenticated`, `service_role` (NOLOGIN, `service_role` BYPASSRLS), `authenticator`; `auth.users` (id, phone, email, raw_*_meta_data, created_at, …); `auth.uid()`, `auth.jwt()`, `auth.role()` identical to Supabase's definitions; Supabase-style default privileges on schema `public` (RLS is the gate, not GRANTs); `search_path = "$user", public, extensions`.

Each role callback runs in a transaction: `set_config('request.jwt.claims', …, true)` + `SET LOCAL ROLE`. Throwing rolls back; `{ rollback: true }` always rolls back.

**Empirical results (spike, `supabase/tests/harness.spike.test.ts`, 21 tests green):**
- `SET LOCAL ROLE authenticated|anon` from the PGlite superuser **enforces RLS** (USING and WITH CHECK), and GRANT/REVOKE on tables and functions is enforced.
- `service_role` BYPASSRLS works; SECURITY DEFINER functions owned by `postgres` bypass RLS and still see the caller's `auth.uid()`; SECURITY INVOKER functions are filtered.
- PostGIS 3.6.2: geography, `ST_DWithin`, `ST_Project`, GiST index all work.
- Boot: ~13 s cold (initdb + `CREATE EXTENSION postgis`), **~3 s** from the on-disk snapshot cache (`node_modules/.cache/st-pglite/<hash>.tar`, keyed by pglite versions + shims + migration contents; disable with `ST_PGLITE_CACHE=0`). `asUser` round trip ≈ 2 ms.

**Known PGlite limitations (for migration authors):**
- Engine is **Postgres 18.6**, Supabase runs 15/17. Do not rely on PG18-only features: write `GENERATED ALWAYS AS (...) STORED` explicitly (PG18 defaults to VIRTUAL), don't use `uuidv7()`, `OLD/NEW` in `RETURNING`, etc.
- Available extensions: plpgsql, postgis (+raster/topology/tiger), pgcrypto. **`pg_cron` is not available** — guard scheduling with `if exists (select 1 from pg_extension where extname = 'pg_cron')` and test job bodies by calling the job functions directly. `btree_gist` etc. exist in `@electric-sql/pglite/contrib` and can be added to the harness on request.
- Single connection: no real concurrency. Race tests (two joins for the last seat) must be expressed as sequential calls + the constraint/lock logic asserted; true concurrency is verified on a real Supabase branch DB (staging) before release.
- `now()` is frozen per transaction and can't be faked → use the `st.now` convention.
- `LISTEN/NOTIFY`, Realtime, Storage, `auth.*` internals beyond the shim are not present. Realtime authorisation is tested via the RLS policies it reuses.
- Superuser `postgres` bypasses RLS. Supabase's `postgres` role is also BYPASSRLS, so behaviour matches, but never write tests that assert RLS via `db.query()`.

**Fallback (not needed — spike passed):** `SQL_TESTS=pg` reserved for a native PG16 + PostGIS run (initdb into a temp dir, `pg_ctl` on a random port) or pgTAP via `supabase test db` where Docker is available. The harness currently throws a clear error if set.

### 3.2 Golden cases (TS ≡ SQL parity)

Location: `packages/domain/test/golden/<kind>.json` (one file per kind, an array of cases). Consumed by
`packages/domain/test/golden.test.ts` (calls the pure function) and `supabase/tests/golden.test.ts` (calls the RPC / SQL function through the harness). A case runs on both sides unless `targets` restricts it. A failing parity case is S1.

Rules: `now` is ISO-8601 UTC (TS converts with `Date.parse`; SQL sets `st.now`). `config` is a **partial** `TrustConfig` merged over defaults. All ids are UUID strings so SQL can use them verbatim. Inputs and expectations use the camelCase TS shapes from `types.ts`; the SQL runner maps them.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://sport-talent.dev/schemas/golden-case.json",
  "type": "array",
  "items": {
    "type": "object",
    "required": ["name", "kind", "input", "now", "expected"],
    "additionalProperties": false,
    "properties": {
      "name": { "type": "string", "pattern": "^[a-z0-9][a-z0-9_.-]*$", "description": "Unique within the kind; used as the test title" },
      "kind": {
        "enum": [
          "checkin.verifyGps", "checkin.verifyQr", "checkin.verifyPeer",
          "trust.applyEvent", "trust.evaluateReports", "trust.hostReliability",
          "trust.reliability", "moderation.decide", "games.waitlist", "squad.balance"
        ]
      },
      "description": { "type": "string" },
      "input": { "description": "Kind-specific: e.g. { state, event } for trust.applyEvent, { game, samples } for checkin.verifyGps" },
      "config": { "type": "object", "description": "Partial TrustConfig overrides" },
      "now": { "type": "string", "format": "date-time" },
      "expected": { "description": "Exact expected output (deep-equal) e.g. { state, effects } or a CheckInVerdict" },
      "targets": { "type": "array", "items": { "enum": ["ts", "sql"] }, "default": ["ts", "sql"] },
      "tags": { "type": "array", "items": { "type": "string" }, "description": "e.g. boundary, regression, prd-v5:4.3" }
    }
  }
}
```

Example (`trust.applyEvent.json`):

```json
[{
  "name": "late-cancel.inside-window.issues-yellow",
  "kind": "trust.applyEvent",
  "input": {
    "state": { "userId": "00000000-0000-4000-8000-000000000001", "activeCards": 0, "sanctions": [] },
    "event": { "type": "ParticipationCancelled", "gameId": "00000000-0000-4000-8000-0000000000aa",
               "userId": "00000000-0000-4000-8000-000000000001",
               "startsAt": "2026-03-01T18:00:00.000Z", "cancelledAt": "2026-03-01T15:00:00.000Z" }
  },
  "config": { "lateCancelWindowHours": 6 },
  "now": "2026-03-01T15:00:00.000Z",
  "expected": { "effects": [{ "type": "IssueSanction", "kind": "yellow_card", "reasonCode": "late_cancel",
                              "expiresAt": "2026-03-31T15:00:00.000Z", "disputeUntil": "2026-03-03T15:00:00.000Z" }] },
  "tags": ["boundary"]
}]
```

Minimum golden set before M3: every boundary in plan.md "Trust Engine" (value at, just inside, just outside each threshold), ≥ 60 cases total.

### 3.3 Edge Function handler tests

Each function exports `handle(req: Request, deps: Deps): Promise<Response>`. Tests inject fakes: `FakeModeration` (scripted verdicts, latency, throw), `FakeLlm`, `FakeTranslate`, `FakePayments` (from `packages/payments`), `FakeDb` (or the pglite harness for integration), `FakeClock`.
Required cases per function: auth missing/invalid (401), wrong method (405), malformed JSON (400), happy path, idempotent retry, each dependency timing out and throwing. For `send-message`: both providers allow / one blocks / both time out at 1.5 s → `allow_pending` + recheck enqueued / malformed provider JSON. For `payments-webhook`: bad signature, replayed event id, out-of-order `captured` before `authorized`.

---

## 4. Unit and property testing (domain)

Property catalogue (fast-check, ≥ 200 runs each, seeds logged):
- **Squad:** each player assigned exactly once; |size_i − size_j| ≤ 1; cost(result) ≤ cost(snakeDraft); same seed ⇒ same teams; different seed may differ; scarce positions (GK) split across teams when count ≥ teams.
- **Trust:** applying the same event twice yields the same state (idempotent); card count never decreases without expiry/overturn; system never emits `permanent_ban`; every emitted sanction has `expiresAt` (except moderator permanent) and a statement key.
- **Reliability:** result ∈ [0,1]; adding a verified attendance never lowers it; < 3 games ⇒ `new`.
- **GPS:** translating all samples and the pin by the same vector doesn't change the verdict (outside polar regions); adding a mock flag never produces a sanction effect.
- **QR:** token valid for steps t−1..t+1 only; any single-bit change to secret/gameId invalidates.
- **Reports:** removing a colluding reporter never increases severity; < 3 qualifying reporters never restricts.

---

## 5. Security testing

### 5.1 RLS deny matrix
Generated test: for every table in `public` × role {anon, authenticated-stranger, authenticated-owner, participant, host, moderator, service_role} × verb {select, insert, update, delete} the expected result is declared in `supabase/tests/rls-matrix.ts` (allow / deny / filtered). A new table without a matrix row fails the build (the test enumerates `pg_tables` and diff-checks). Also asserted: `relrowsecurity = true` on every public table; no policy uses `using (true)` for write verbs; views are `security_invoker`.

### 5.2 Privilege escalation via RPC
For every `security definer` function: `search_path` pinned (`proconfig` contains `search_path=`), `auth.uid()` checked, EXECUTE revoked from `anon` unless intended, arguments that name another user are authorised (e.g. `decide_join` only by host, `moderator_decide` only with `app_roles` row). Attempt calls as stranger, banned user, expired-session (no `sub`).

### 5.3 Sanction tampering
As the sanctioned user: update/delete own `sanctions`, `profiles.reliability_*`, `chat_muted_until`, `host_suspended_until` → denied/0 rows. File appeal after window → rejected. Appeal twice → one. Delete-and-recreate account with same phone → pseudonymised sanctions re-linked (phone hash/pepper), ban persists.

### 5.4 GPS spoof scenarios
Golden + handler cases: mock flag; teleport (2 samples 10 km apart in 5 s); perfect zero-spread samples with accuracy 1 m (synthetic); samples outside window; clock skew (sample timestamps in the future vs server now); replayed samples from another game. Expected: rejected with fallback offered, signal recorded, **no sanction effect**.

### 5.5 Collusion
Report rings: 3 reporters created within 48 h → queue only, no restriction. Reporter < 7 days old → not qualifying. Reciprocal peer confirmations only → `reciprocal_only`. Blocked pair confirmations ignored. Same device/IP heuristics (when added) are signals, not sanctions.

### 5.6 Other
Invite token: 128-bit, not enumerable, private game invisible via `nearby_games`; exact location of women-only/private games hidden before approval (column-level via view); chat after `expires_at` unreadable; secrets never in client bundle (grep the web export for `service_role`, `sk_live`, `sk_test`); dependency audit (`npm audit --omit=dev`, high = S2).

---

## 6. i18n checks (`npm run i18n:check`)
1. **Key parity:** every locale has exactly the keys of `en` per namespace (missing = error, extra = error).
2. **ICU parse:** every value parses with the ICU MessageFormat parser used by i18next-icu.
3. **Placeholder parity:** set of `{var}` / `{count, plural, …}` arguments identical to `en`.
4. **CLDR plural categories:** each plural message contains exactly the categories CLDR requires for the locale (ar: zero/one/two/few/many/other; ru/uk: one/few/many/other; he: one/two/other; ja/zh/ko: other only). `other` always present.
5. **No empty strings**, no leading/trailing whitespace, no untranslated `en` copies in non-en locales above a 5% threshold (warn).
6. **Pseudo-locale** `en-XA` (accented + 35% longer + brackets) generated at build: Playwright run on critical screens asserts no truncation (`scrollWidth ≤ clientWidth` on labelled text) and no un-externalised strings (any visible ASCII-only text that isn't bracketed fails).
7. Legal/compliance strings carry a `requiresNativeReview` marker until reviewed.

## 7. Web e2e (Playwright)

Runs on the static export (`expo export --platform web`) served by `serve -s` with `EXPO_PUBLIC_DATA=mock` (InMemoryAdapter, seeded fixtures, fake clock) and a local blank map style (no tile network). Projects: `chromium-desktop`, `mobile-pixel7`, `rtl-he` (Pixel 7, he-IL); `rtl-ar` added when ar ships. Geolocation is granted and fixed (Dizengoff Sq.).

**Selectors:** `testID` on RN components (rendered as `data-testid` by react-native-web), naming `screen.element[.qualifier]`, e.g. `auth.phone.input`. Prefer `getByRole` + accessible name; use test IDs for non-semantic targets (map pins, sheets).

| ID | Flow | Key test IDs | Assertions |
|---|---|---|---|
| SMK-01 | App boots, SPA deep link | `#root` | 2xx, content rendered, 0 console errors |
| E2E-01 | Phone → OTP (mock code `000000`) | `auth.phone.input`, `auth.phone.submit`, `auth.otp.input` | lands on age gate |
| E2E-02 | Age gate 16+ (block 15, allow 16) | `auth.age.year`, `auth.age.month`, `auth.age.submit`, `auth.age.blocked` | under-16 blocked with explanation |
| E2E-03 | Map filters: radius, ≤3 sports, location denied fallback | `map.filter.radius`, `map.filter.sport.<id>`, `map.pin.<id>`, `map.list.toggle` | pin count matches fixture; 4th sport disabled; map usable with geolocation denied |
| E2E-04 | Create game & join (approval, waitlist promotion) | `game.create.*`, `game.join`, `game.participants.<uid>`, `game.waitlist.position` | capacity respected; promotion shows |
| E2E-05 | Join game with deposit (mock provider) | `payment.deposit.confirm` | hold created, status shown |
| E2E-06 | QR check-in (host shows QR, player enters/scans token) | `checkin.qr.show`, `checkin.qr.input`, `checkin.status` | verified; expired token rejected with fallback |
| E2E-07 | Teams: balance & reshuffle | `teams.balance`, `teams.reshuffle`, `teams.team.<n>` | sizes ±1, reshuffle changes assignment |
| E2E-08 | Chat send, nudge, block, report message | `chat.input`, `chat.send`, `chat.nudge`, `chat.message.<id>.report` | blocked text not shown to others; nudge copy shown |
| E2E-09 | Sanction screen: reason, expiry, dispute | `sanctions.item.<id>`, `sanctions.dispute` | statement of reasons rendered; dispute within 48h only |
| E2E-10 | Report & block user | `profile.report`, `profile.block` | blocked user's games/messages hidden |
| E2E-11 | Private game via invite link | `invite.accept` | invisible without token, visible with |
| E2E-12 | Delete account | `settings.delete`, `settings.delete.confirm` | signed out, re-login creates fresh profile |

**RTL (he, ar):** `html[dir=rtl]` and `lang` asserted (SMK-02); full-page screenshots of map, game detail, chat, sanctions per RTL locale (`toHaveScreenshot`, 1% tolerance, baselines committed per project); directional icons (back chevron) mirrored; numbers/phones isolated (FSI/PDI) — assert a Latin name inside Hebrew text renders in order via `innerText`.

**Accessibility:** `@axe-core/playwright` on each critical-flow screen with tags `wcag2a, wcag2aa, wcag21aa`; gate: 0 `serious`/`critical`; `moderate` tracked. Keyboard-only path for E2E-01..04 (Tab order, visible focus, Escape closes sheets).

## 8. Native testing plan (cannot run in this container)

- **Builds:** EAS `development` (dev-client) and `preview` profiles per PR label `native`, `production` per release. Build must succeed for Android and iOS.
- **Maestro flows** (`.maestro/*.yaml`) mirror E2E-01, -03, -04, -06 (camera QR scan via injected image on Android emulator), -08, -12, plus native-only: two-stage check-in (mock location provider on Android; GPX simulation on iOS simulator), permission denial paths (location, camera, notifications), RTL restart flow (switch to he → app reloads with `I18nManager.isRTL`), push open deep link, background/foreground resume.
- **Device matrix:**

| Tier | Android | iOS |
|---|---|---|
| Low-end | Samsung Galaxy A05/A15 class (2–3 GB RAM, Android 13/14), Android Go emulator | iPhone SE (2nd gen), iOS 17 |
| Mid | Pixel 7a, Android 15 | iPhone 13, iOS 18 |
| High / latest | Pixel 9/10, Android 16 | iPhone 16/17, iOS 26 |
| Tablet (smoke) | Galaxy Tab A | iPad (10th gen), iOS 26 |

- Cloud: Maestro Cloud or Firebase Test Lab (Android) for the matrix; physical low-end Android in-house for performance.
- **Store-policy checks:** no `ACCESS_BACKGROUND_LOCATION` in the merged manifest unless the geofence wake-up ships with its declaration; `FOREGROUND_SERVICE_LOCATION` only if used; iOS `Info.plist` purpose strings localised; Sign in with Apple present if any social login; privacy manifest (`PrivacyInfo.xcprivacy`) required-reason APIs declared.
- **Native-specific risks:** geofence wake-up latency (field test), Hermes perf on low-end, MapLibre RN memory with 2,000 pins, OTA update (expo-updates) rollback.

## 9. Performance budgets (CI-enforced where possible)

| Budget | Target | How measured |
|---|---|---|
| Web initial JS (gzip, all chunks loaded for `/`) | ≤ 450 KB gzip (current template: ~2 MB raw) | script over `dist/_expo/static/js/web/*.js` in CI; fail on > budget or +10% vs main |
| Web LCP (Pixel 7 emulation, 4× CPU throttle, Fast 3G) | ≤ 2.5 s | Playwright + `PerformanceObserver` / Lighthouse CI |
| Map with 2,000 pins (supercluster) | first clustered render ≤ 500 ms; pan/zoom ≥ 50 fps desktop, ≥ 30 fps Pixel 7 emulation | Playwright perf test with mock adapter fixture of 2,000 games, `requestAnimationFrame` sampling |
| Squad balancing n = 40 | p95 < 5 ms (Node, CI runner) | vitest bench / timed property test (100 seeds) |
| `nearby_games` 10 km over 50k games | < 50 ms on staging Postgres (EXPLAIN uses GiST) | staging only (pglite not representative) |
| `send-message` p95 | < 1.8 s incl. 1.5 s moderation timeout | handler test with fake latency + staging trace |
| Cold start native (low-end Android) | TTI ≤ 3 s | Maestro + `adb shell am start -W` |

## 10. Bug severity scheme

| Sev | Definition | Examples | Response |
|---|---|---|---|
| **S1 Critical** | Security/privacy breach, wrongful sanction at scale, data loss, payment error, legal/store blocker, crash on launch | RLS leak; system issues permanent ban; double charge; deletion doesn't delete; golden parity mismatch | Stop the line; fix before any release; hotfix in prod within 24 h |
| **S2 Major** | Core loop broken for a segment, wrong single sanction, accessibility blocker on critical flow, RTL unusable screen | QR check-in fails on web; ar plural crash; axe critical on join | Must fix before release |
| **S3 Minor** | Feature degraded with workaround; cosmetic issue on a critical screen | Truncated label in de; wrong icon mirroring | Fix within 2 sprints; may ship with known-issue note |
| **S4 Trivial** | Cosmetic, non-critical screen | Spacing on legal page | Backlog |

Trust & Safety bugs are raised one level when they affect a sanction decision.

## 11. Release gates / Definition of Done

**Per change (PR) — `npm run verify` green:**
1. `tsc` + eslint (incl. logical-styles rule) — 0 errors.
2. Unit + property tests; domain coverage ≥ 95% lines / 90% branches.
3. SQL tests (harness) incl. RLS matrix and golden parity — 100% pass, no `.only`, no new skips without an issue link.
4. Handler tests for touched functions.
5. i18n check — 0 errors.
6. Web export + Playwright (all projects) — 0 failures, axe 0 serious/critical on touched screens.
7. New behaviour has tests at the layers required by §2 (risk ≥ 6 ⇒ two layers); bug fixes include a regression test that failed before the fix.
8. No secrets in bundle; no new background-location permission.

**Per release candidate:**
- All of the above on `main`; 0 open S1/S2.
- EAS builds green; Maestro suite green on the device matrix (low-end Android + iOS 17 mandatory).
- Staging Supabase: migrations applied from scratch and as upgrade; RLS matrix re-run against staging via `supabase test db` (pgTAP) or the same suite pointed at a real Postgres; concurrency smoke (parallel joins).
- Performance budgets met.
- Manual: native-speaker review signed for launch locales; screen-reader pass; field GPS test at ≥ 3 venues; Stripe/PSP sandbox run; account deletion on both stores + web link.
- Compliance checklist (`docs/compliance.md`) items ticked: statement of reasons, appeal path, report/block everywhere, 16+ gate, privacy policy, data-safety form.
- Adversarial QA sign-off (M4b) with all findings closed or accepted by owner + QA Lead.

## 12. Ownership and cadence
- QA Lead owns this strategy, the harness, Playwright config and e2e; module owners write unit/SQL/handler tests for their code (DB Engineer: `supabase/tests/**`; Core: `packages/domain/test/**`).
- Flaky test policy: a test that fails then passes on retry is quarantined within 24 h (tagged `@flaky`, issue opened) and fixed or deleted within one sprint. Retries are allowed only in CI e2e (max 2).
- Weekly: review trust-engine auto-sanctions sample, flake report, budget trends.
