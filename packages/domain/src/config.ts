import { DEFAULT_TRUST_CONFIG, type TrustConfig } from './types';

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
