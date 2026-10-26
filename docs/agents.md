# Agent Team & File Ownership

The Orchestrator (main session) owns root configs, `package.json`/lockfile, git and merges.
**Rules for every agent:** edit ONLY paths you own; do NOT run `npm install`/`npx expo install` (request deps in your final report); do NOT commit or push; run the checks for your area before finishing.

| Agent | Model | Owns |
|---|---|---|
| Orchestrator | Opus | `/package.json`, lockfile, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `vitest.config.ts`, `docs/agents.md`, `docs/plan.md`, `README.md` |
| Architect | Opus | `docs/architecture.md`, `docs/adr/**`, `packages/domain/src/types.ts`, `apps/mobile-web/src/data/DataPort.ts` |
| Product & Compliance | Opus | `docs/prd-v5.md`, `docs/compliance.md`, `docs/deferred-phases.md` |
| UI/UX Expert | Opus | `docs/design-system.md`, `packages/ui/**` |
| QA Lead | Opus | `docs/qa-strategy.md`, `supabase/tests/harness.ts` (spike) , `apps/mobile-web/e2e/**`, `apps/mobile-web/playwright.config.ts` |
| Core/Trust Dev | Opus | `packages/domain/**` (except `types.ts`) |
| DB Engineer | Opus | `supabase/migrations/**`, `supabase/seed.sql`, `supabase/config.toml`, `supabase/tests/**` (except harness after spike) |
| Full-stack (Functions/Payments) | Opus | `supabase/functions/**`, `packages/payments/**` |
| App Dev (complex) | Opus | `apps/mobile-web/src/app/**` shell, map, game flows; `apps/mobile-web/src/platform/**`, `src/data/*Adapter*` |
| App Dev (boilerplate) | Sonnet | profile/settings/legal screens (assigned per wave) |
| Localization | Sonnet | `packages/i18n/**` (en is source; other locales after en freeze) |
| Adversarial QA/Security | Opus | review only → findings; fixes routed to owners |
| Mechanical | Haiku | lint/format fixes on request |
