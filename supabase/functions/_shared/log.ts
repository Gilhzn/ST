/**
 * Structured JSON logger with redaction.
 *
 * Privacy rules (compliance §4 "Server and app logs: no bodies, no PII"):
 * - Never log message bodies, translations, tokens, secrets, phone numbers or
 *   raw GPS. Keys that look like they carry such data are replaced with
 *   `[redacted]` regardless of the caller.
 * - Long strings are truncated, errors are reduced to name + code.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogValue = string | number | boolean | null | undefined | readonly LogValue[] | { readonly [k: string]: LogValue };
export type LogFields = Readonly<Record<string, LogValue | unknown>>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export interface LogRecord {
  level: LogLevel;
  event: string;
  at: string;
  [k: string]: unknown;
}

export type LogSink = (record: LogRecord) => void;

/** Keys whose values are never written to logs. */
const REDACT_KEY = /(body|text|content|translation|prompt|token|secret|password|authorization|apikey|api_key|phone|email|lat|lng|samples|clientsecret|client_secret)/i;
const MAX_STRING = 200;

export function redact(value: unknown, key = '', depth = 0): unknown {
  if (key && REDACT_KEY.test(key)) return value === null || value === undefined ? value : '[redacted]';
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (value instanceof Error) {
    const code = (value as { code?: unknown }).code;
    return { name: value.name, ...(typeof code === 'string' ? { code } : {}) };
  }
  if (depth >= 4) return '[depth]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, '', depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redact(v, k, depth + 1);
    return out;
  }
  return String(value);
}

const consoleSink: LogSink = (r) => {
  const line = JSON.stringify(r);
  if (r.level === 'error') console.error(line);
  else if (r.level === 'warn') console.warn(line);
  else console.log(line);
};

export function createLogger(options: { sink?: LogSink; base?: LogFields; now?: () => number; minLevel?: LogLevel } = {}): Logger {
  const sink = options.sink ?? consoleSink;
  const base = options.base ?? {};
  const now = options.now ?? (() => Date.now());
  const order: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  const min = order[options.minLevel ?? 'info'];
  const write = (level: LogLevel, event: string, fields?: LogFields) => {
    if (order[level] < min) return;
    const merged = redact({ ...base, ...(fields ?? {}) }) as Record<string, unknown>;
    sink({ ...merged, level, event, at: new Date(now()).toISOString() });
  };
  return {
    debug: (e, f) => write('debug', e, f),
    info: (e, f) => write('info', e, f),
    warn: (e, f) => write('warn', e, f),
    error: (e, f) => write('error', e, f),
    child: (fields) => createLogger({ sink, base: { ...base, ...fields }, now, minLevel: options.minLevel ?? 'info' }),
  };
}

/** A logger that records into an array (tests). */
export function memoryLogger(): Logger & { records: LogRecord[] } {
  const records: LogRecord[] = [];
  const logger = createLogger({ sink: (r) => records.push(r), minLevel: 'debug' });
  return Object.assign(logger, { records });
}
