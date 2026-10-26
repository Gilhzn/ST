# ADR 0003: Trust Engine as a pure domain package

- Status: Accepted (2026-10)

## Context
Check-in verification, sanctions, escalation, reliability, moderation outcomes and squad balancing are the core of the product and the most likely source of disputes. They run in three places: Postgres RPCs (transactional rules), Edge Functions (rules needing vendors or secrets) and the InMemory adapter (e2e). Duplicated, untested logic would drift and produce unfair sanctions.

## Decision
- `packages/domain` is pure TypeScript with zero dependencies: no I/O, no clock, seeded RNG only.
- Engine functions have the shape `(state, event, config: TrustConfig, now: EpochMs) => { state, effects: Effect[] }`. Effects (`IssueSanction`, `EnqueueReview`, `Notify`, `MuteChat`, ...) are defined in `types.ts` and applied by adapters, idempotently (`dedupeKey`).
- All thresholds live in `TrustConfig` (`DEFAULT_TRUST_CONFIG`, mirrored in the `trust_config` table).
- Rules that must be transactional are also implemented in SQL; shared golden cases (`packages/domain/test/golden/*.json`) run against both TS (vitest) and SQL (pglite) to keep them identical.
- Coverage gate ≥ 95% lines / 90% branches with property tests (fast-check).

## Consequences
- + Rules are testable in milliseconds and explainable (inputs → effects).
- + Same code in app, InMemory adapter and Edge Functions (bundled with esbuild).
- − Two implementations for transactional rules; golden parity is mandatory for every change.
- − Adapters must faithfully apply effects in order inside one transaction (`apply_effects`).
