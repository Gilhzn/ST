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

## Update (M3, contract v2)
- **Every engine input is a contract `TrustEvent`.** `LateCancelFinalized` joined the union (it was domain-local); `DomainTrustEvent` is now a deprecated alias.
- **Late cancels and escalation are decided at finalisation, not at the triggering action.** `ParticipationCancelled` only records a pending late cancel; `processNoShows` at `endsAt + finalizeAfterEndHours` emits `LateCancelFinalized`, which issues the card unless the spot was refilled by a player who checked in. Escalation counts only *settled* cards (dispute window closed, or upheld) and runs on `Tick` / moderator uphold.
- **Deterministic ids.** `sanction.id = stableUuid('sanction:' + dedupeKey)` and `reviewItem.id = stableUuid('review:' + dedupeKey)`, identical in TS and SQL, so effects can reference rows before they exist and re-applying effects is a no-op.
- **Config is data.** All tunable thresholds, including the 17 PRD v5 additions (dispute auto-void, overturn protection, reporter accuracy, waitlist windows, retention), are `TrustConfig` fields whose defaults equal the `trust_config` column defaults; fixed rule constants stay in `trust/constants.ts`.
- Permanent bans are projected by an explicit `BanAccount` effect, like the other restrictions.
