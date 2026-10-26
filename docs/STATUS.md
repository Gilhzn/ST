# Sport Talent: Project Status (end of round 1)

**`npm run verify`: GREEN**
- typecheck: 6/6 workspaces
- eslint: clean
- vitest: 64 files, 1,148 passed, 2 skipped
- i18n:check: 13 locales
- web export: OK
- Playwright: 67 passed (desktop, Pixel 7, Hebrew RTL)

## Delivered

| Area | What | Where |
|---|---|---|
| Research | Market, technology and compliance findings, and the v4 → v5 redesign table | `docs/research/findings.md` |
| Product | PRD v5 in Hebrew with an English exec summary: KPIs, personas, requirement IDs, acceptance criteria, roadmap | `docs/prd-v5.md` |
| Compliance | Register for Apple, Play, GDPR, DSA, Israel Amendment 13, CCPA, UK OSA (COPPA largely out of scope at 18+); retention; counsel-review flags | `docs/compliance.md` |
| Architecture | Architecture doc, 6 ADRs, shared contract v2 | `docs/architecture.md`, `docs/adr/`, `packages/domain/src/types.ts` |
| Design | Design system: tokens, RTL, accessibility, 19 screen specs | `docs/design-system.md`, `packages/ui` |
| Domain | Trust engine, check-in (GPS, QR, host, peer), squad balancing, waitlist and flash fill, moderation policy. 286 tests, 100% line coverage, 100 golden cases | `packages/domain` |
| Database | Postgres and PostGIS schema, RLS on every table, SECURITY DEFINER RPCs, trust jobs, retention purges, Realtime auth. 517 tests; 100/100 golden parity with the TS domain | `supabase/migrations`, `supabase/tests` |
| Edge Functions | Moderated chat (blocklist, OpenAI omni-moderation, Claude), translation, check-in verify, trust, deposits, webhooks, push, account deletion | `supabase/functions` |
| Payments | Provider port: Stripe as the single global processor (cards, Apple Pay, Google Pay, local methods, Israel included), a local PSP interface stub (Bit / Israeli PSP, deferred), Fake provider; deposit policy | `packages/payments` |
| i18n | 12 languages in 13 locale folders, ICU plurals, RTL, formatters, key and plural checks, app key guard | `packages/i18n` |
| App | One Expo Router codebase for Web, iOS and Android. Screens: auth with OTP and age gate, map, create game, game details, check-in, host QR, teams, results, chat, sanctions and appeals, inbox, profile, settings, account deletion. Data via InMemory (demo) or Supabase | `apps/mobile-web` |
| QA and security | QA strategy, pglite harness, e2e. Adversarial review #1 found 17 issues; all fixed with regression tests | `docs/qa-strategy.md`, `docs/security-review-1.md` |

## Not yet verified in this environment
- **Native iOS and Android builds:** need EAS and a device matrix. Native map, location, geofence, push and the RTL restart flow are written but untested.
- **Live Supabase, Edge Functions on real Deno, and real providers** (Stripe, OpenAI, Anthropic, Google Translate, Expo Push). The Supabase CLI, Deno and Docker are not available here.
- **Concurrency:** pglite runs on a single connection, so this needs a staging Postgres smoke test.

## Deployment prerequisites
1. Create a Supabase project and run `supabase db push`. Enable `pg_cron`/`pg_net`, then set `st.functions_url` and the Vault secrets:
   - `st_phone_hmac_key`, **required** for ban-evasion protection;
   - the internal functions secret.
2. In Realtime settings, **disable public channels**.
3. **Incorporate the foreign entity (US/EU/UK) and open the Stripe account** (live keys, Connect-ready, statement descriptor). Register for VAT as needed (UK VAT, EU OSS, Israeli VAT on digital services). See ADR 0006.
4. Set the function env vars: OPENAI, ANTHROPIC, GOOGLE_TRANSLATE, DEEPL, STRIPE, EXPO. See `supabase/functions/README.md`.
5. Set the app env `EXPO_PUBLIC_SUPABASE_URL` / `ANON_KEY` / `MAP_STYLE_URL` (MapTiler, Stadia or OpenFreeMap).
6. Have native speakers review all 12 non-English locales, legal text first (`packages/i18n/locales/REVIEW.md`).
7. Have counsel review the flagged items (`docs/compliance.md` §12), including age-assurance strength for the UK, the UK Online Safety Act children's-access assessment, and UK GDPR/ICO registration before the London launch.
8. Verify the 18+ minimum end to end: `trust_config.min_age_years` default 18 (migration `0005_trust.sql`, used by `create_profile`), `TrustConfig.minAgeYears` / `MIN_AGE_YEARS` in `packages/domain`, age-gate copy in all 13 locales, and the under-18 e2e and SQL tests. Native speakers should re-review the changed legal and auth strings.

## Decided (owner)
1. **Minimum age is 18+ worldwide** (was 16+). No 16-17 protections track; live streaming is no longer a special 18+ case. UK OSA children's-access assessment still required (conclusion: not likely to be accessed by children, given age assurance). Counsel to review age-assurance strength (self-declared birth month/year plus 24h soft lock; stronger assurance for the UK). Config: `trust_config.min_age_years` (default 18), `TrustConfig.minAgeYears` / `MIN_AGE_YEARS`.
2. **Payments:** incorporate a foreign entity (US/EU/UK) and use Stripe as the single global processor, Israeli users included. Bit and the Israeli local PSP (`LocalPspProvider`) stay an interface stub, deferred to a later phase (ADR 0006).
3. **Seed cities:** Tel Aviv first, then London (PRD go-to-market and KPIs updated).

## Decisions needed from the product owner
None open from round 1. New items for counsel and the accountant are listed in ADR 0006 and `docs/compliance.md` §12.

## Next round (proposed)
- Incorporate the entity, open the Stripe account, and run live Stripe sandbox-to-live checks (deposits, holds, webhooks, Israeli cards and Apple/Google Pay via Stripe).
- Re-run `npm run verify` after the 18+ change and confirm the under-18 e2e and SQL tests (see prerequisite 8).
- London launch preparation (venue partnerships, UK GDPR/ICO registration, OSA assessment).
- EAS development builds plus a Maestro smoke test on real devices; Supabase staging deploy; live provider integration tests.
- Phase 1.5 and 2 from `docs/deferred-phases.md`:
  - Post-Match Vault
  - recurring games
  - Glicko rating
  - trainers marketplace (Stripe Connect)
  - Pro subscription
- Security review #2 after the live deploy, plus a load test (map with 2,000 pins, Realtime fan-out).
