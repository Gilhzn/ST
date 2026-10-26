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
| Compliance | Register for Apple, Play, GDPR, DSA, Israel Amendment 13, CCPA, COPPA, UK OSA; retention; 15 counsel-review flags | `docs/compliance.md` |
| Architecture | Architecture doc, 6 ADRs, shared contract v2 | `docs/architecture.md`, `docs/adr/`, `packages/domain/src/types.ts` |
| Design | Design system: tokens, RTL, accessibility, 19 screen specs | `docs/design-system.md`, `packages/ui` |
| Domain | Trust engine, check-in (GPS, QR, host, peer), squad balancing, waitlist and flash fill, moderation policy. 286 tests, 100% line coverage, 100 golden cases | `packages/domain` |
| Database | Postgres and PostGIS schema, RLS on every table, SECURITY DEFINER RPCs, trust jobs, retention purges, Realtime auth. 517 tests; 100/100 golden parity with the TS domain | `supabase/migrations`, `supabase/tests` |
| Edge Functions | Moderated chat (blocklist, OpenAI omni-moderation, Claude), translation, check-in verify, trust, deposits, webhooks, push, account deletion | `supabase/functions` |
| Payments | Provider port: Stripe (cards, Apple Pay, Google Pay, local methods), a local PSP slot (e.g. Bit), Fake provider; deposit policy | `packages/payments` |
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
3. Set the function env vars: OPENAI, ANTHROPIC, GOOGLE_TRANSLATE, DEEPL, STRIPE, EXPO. See `supabase/functions/README.md`.
4. Set the app env `EXPO_PUBLIC_SUPABASE_URL` / `ANON_KEY` / `MAP_STYLE_URL` (MapTiler, Stadia or OpenFreeMap).
5. Have native speakers review all 12 non-English locales, legal text first (`packages/i18n/locales/REVIEW.md`).
6. Have counsel review the 15 flagged items (`docs/compliance.md` §12).

## Decisions needed from the product owner
1. **UK minimum age:** 16+ with under-18 protections, or 18+?
2. **Payments entity:** Stripe does not onboard Israeli companies. Choose between a foreign entity (US/EU) with Stripe, or a local PSP (e.g. PayPlus/Meshulam) for Israel.
3. **Second seed city:** London or Madrid.

## Next round (proposed)
- EAS development builds plus a Maestro smoke test on real devices; Supabase staging deploy; live provider integration tests.
- Phase 1.5 and 2 from `docs/deferred-phases.md`:
  - Post-Match Vault
  - recurring games
  - Glicko rating
  - trainers marketplace (Stripe Connect)
  - Pro subscription
- Security review #2 after the live deploy, plus a load test (map with 2,000 pins, Realtime fan-out).
