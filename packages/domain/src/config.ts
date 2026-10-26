import { DEFAULT_PHASE15_CONFIG, DEFAULT_TRUST_CONFIG, type Phase15Config, type TrustConfig } from './types';

/**
 * Merges a partial config (e.g. the `config` of a golden case, or a row of
 * `trust_config` with some columns missing) over {@link DEFAULT_TRUST_CONFIG}.
 * `undefined` values are ignored.
 */
export function resolveTrustConfig(overrides?: Partial<TrustConfig> | null): TrustConfig {
  const out: TrustConfig = { ...DEFAULT_TRUST_CONFIG };
  if (!overrides) return out;
  for (const key of Object.keys(overrides) as (keyof TrustConfig)[]) {
    const value = overrides[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Merges a partial config over {@link DEFAULT_PHASE15_CONFIG} (same rules as {@link resolveTrustConfig}). */
export function resolvePhase15Config(overrides?: Partial<Phase15Config> | null): Phase15Config {
  const out: Phase15Config = { ...DEFAULT_PHASE15_CONFIG };
  if (!overrides) return out;
  for (const key of Object.keys(DEFAULT_PHASE15_CONFIG) as (keyof Phase15Config)[]) {
    const value = overrides[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Trust and Phase 1.5 thresholds together; the Phase 1.5 modules take this so
 * that rules spanning both (e.g. a skip inside the late-cancel window) read one
 * object. Adapters merge the `trust_config` and `phase15_config` rows.
 */
export type DomainConfig = TrustConfig & Phase15Config;

export const DEFAULT_DOMAIN_CONFIG: Readonly<DomainConfig> = Object.freeze({ ...DEFAULT_TRUST_CONFIG, ...DEFAULT_PHASE15_CONFIG });

/** Resolves a partial mix of trust and Phase 1.5 overrides (unknown keys are ignored). */
export function resolveDomainConfig(overrides?: Partial<DomainConfig> | null): DomainConfig {
  const trust = resolveTrustConfig(null);
  for (const key of Object.keys(trust) as (keyof TrustConfig)[]) {
    const value = overrides?.[key];
    if (value !== undefined) trust[key] = value;
  }
  return { ...trust, ...resolvePhase15Config(overrides) };
}
