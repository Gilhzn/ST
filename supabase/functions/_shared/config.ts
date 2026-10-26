/** Trust configuration loaded from `trust_config` (via `trust_config_json()`), cached per isolate. */
import { DEFAULT_TRUST_CONFIG, resolveTrustConfig, type TrustConfig } from '@st/domain';
import type { Logger } from '#shared/log';
import type { Clock } from '#shared/runtime';

export interface ConfigSource {
  get(): Promise<TrustConfig>;
}

export function staticConfig(config: TrustConfig = DEFAULT_TRUST_CONFIG): ConfigSource {
  return { get: () => Promise.resolve(config) };
}

/** `load` returns the camelCase JSON object; failures fall back to the last good value or the defaults. */
export function cachedConfig(load: () => Promise<unknown>, clock: Clock, log: Logger, ttlMs = 60_000): ConfigSource {
  let cache: { at: number; value: TrustConfig } | null = null;
  return {
    async get() {
      const now = clock.now();
      if (cache && now - cache.at < ttlMs) return cache.value;
      try {
        const raw = await load();
        const partial = raw && typeof raw === 'object' ? (raw as Partial<TrustConfig>) : {};
        const numeric: Partial<TrustConfig> = {};
        for (const [k, v] of Object.entries(partial)) {
          if (k in DEFAULT_TRUST_CONFIG && typeof v === 'number' && Number.isFinite(v)) (numeric as Record<string, number>)[k] = v;
        }
        cache = { at: now, value: resolveTrustConfig(numeric) };
      } catch (error) {
        log.warn('config.load_failed', { error });
        if (!cache) return DEFAULT_TRUST_CONFIG;
      }
      return (cache ?? { value: DEFAULT_TRUST_CONFIG }).value;
    },
  };
}
