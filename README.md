# Sport Talent

Global, location-based sports super-app — **Web + Android + iOS** from one Expo (React Native) codebase, backed by Supabase (Postgres + PostGIS).

- **Status & next steps: [`docs/STATUS.md`](docs/STATUS.md)**
- Product spec: [`docs/prd-v5.md`](docs/prd-v5.md) (source v4: [`docs/prd-v4-source.md`](docs/prd-v4-source.md))
- Research: [`docs/research/findings.md`](docs/research/findings.md)
- Architecture: [`docs/architecture.md`](docs/architecture.md) · Design system: [`docs/design-system.md`](docs/design-system.md) · QA: [`docs/qa-strategy.md`](docs/qa-strategy.md) · Compliance: [`docs/compliance.md`](docs/compliance.md)

## Layout
```
apps/mobile-web     Expo Router app (iOS, Android, Web)
packages/domain     Pure TS business logic: trust engine, check-in, squad balancing, moderation policy
packages/i18n       12 languages (13 locale folders), RTL helpers, key checks
packages/ui         Design tokens and primitives
packages/payments   Payment provider port (Stripe + fake)
supabase/           Migrations, RLS, RPCs, Edge Functions, SQL tests (pglite + PostGIS)
docs/               PRD, architecture, ADRs, design system, QA, compliance
```

## Commands
```
npm install
npm run typecheck   # all workspaces
npm run lint
npm test            # vitest: domain, i18n, payments, functions, SQL (pglite)
npm run i18n:check  # locale completeness / ICU / plurals
npm run web:export  # static web build
npm run e2e         # Playwright against the web build (mock data)
npm run verify      # all of the above
```
