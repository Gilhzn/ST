/** Minimal input validators. Each throws `StError('validation', …, { field })`. */
import { StError, isLocale, type Locale } from '@st/domain';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(field: string, reason: string): never {
  throw new StError('validation', `${field}: ${reason}`, { field });
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function uuidField(obj: Record<string, unknown>, field: string): string {
  const v = obj[field];
  if (!isUuid(v)) fail(field, 'must be a UUID');
  return v.toLowerCase();
}

export function stringField(obj: Record<string, unknown>, field: string, opts: { min?: number; max: number; optional?: false }): string;
export function stringField(obj: Record<string, unknown>, field: string, opts: { min?: number; max: number; optional: true }): string | null;
export function stringField(
  obj: Record<string, unknown>,
  field: string,
  opts: { min?: number; max: number; optional?: boolean },
): string | null {
  const v = obj[field];
  if (v === undefined || v === null) {
    if (opts.optional) return null;
    fail(field, 'required');
  }
  if (typeof v !== 'string') fail(field, 'must be a string');
  if (v.length < (opts.min ?? 1) || v.length > opts.max) fail(field, `length must be ${opts.min ?? 1}..${opts.max}`);
  return v;
}

export function booleanField(obj: Record<string, unknown>, field: string, fallback: boolean): boolean {
  const v = obj[field];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'boolean') fail(field, 'must be a boolean');
  return v;
}

export function finiteNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(field, `must be a number in ${min}..${max}`);
  return value;
}

export function localeField(obj: Record<string, unknown>, field: string): Locale | null {
  const v = obj[field];
  if (v === undefined || v === null) return null;
  if (!isLocale(v)) fail(field, 'unsupported locale');
  return v;
}

export function arrayField(obj: Record<string, unknown>, field: string, maxItems: number): unknown[] {
  const v = obj[field];
  if (!Array.isArray(v)) fail(field, 'must be an array');
  if (v.length > maxItems) fail(field, `at most ${maxItems} items`);
  return v;
}

export function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field, 'must be an object');
  return value as Record<string, unknown>;
}
