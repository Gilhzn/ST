/**
 * Adapter selection.
 *
 * - `EXPO_PUBLIC_DATA=mock` → InMemoryAdapter (e2e, demo, offline development).
 * - `EXPO_PUBLIC_DATA=supabase` → SupabaseAdapter (needs URL + anon key).
 * - unset → Supabase when `EXPO_PUBLIC_SUPABASE_URL` is configured, otherwise mock.
 *
 * `process.env.EXPO_PUBLIC_*` must be referenced literally so Metro inlines it.
 */
import type { DataPort } from './DataPort';
import { InMemoryAdapter } from './InMemoryAdapter';
import { SupabaseAdapter } from './SupabaseAdapter';

export type DataMode = 'mock' | 'supabase';

export function resolveDataMode(): DataMode {
  const explicit = process.env.EXPO_PUBLIC_DATA;
  if (explicit === 'mock' || explicit === 'supabase') return explicit;
  return process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ? 'supabase' : 'mock';
}

export function createDataPort(mode: DataMode = resolveDataMode()): DataPort {
  if (mode === 'supabase') {
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    if (url && anonKey) return new SupabaseAdapter({ url, anonKey });
    if (__DEV__) console.warn('EXPO_PUBLIC_DATA=supabase but Supabase URL/key are missing; using mock data.');
  }
  const latency = Number(process.env.EXPO_PUBLIC_MOCK_LATENCY_MS ?? 0);
  return new InMemoryAdapter({ latencyMs: Number.isFinite(latency) ? latency : 0 });
}

export type { DataPort } from './DataPort';
export { DataProvider, useData, useDataMode } from './DataProvider';
