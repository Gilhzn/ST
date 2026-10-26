import { describe, expect, it } from 'vitest';
import { memoryLogger, redact } from '#shared/log';

describe('logger', () => {
  it('redacts content-bearing keys and truncates strings', () => {
    const log = memoryLogger();
    log.info('evt', { body: 'secret message', nested: { text: 'x', clientSecret: 'cs', ok: 1 }, long: 'a'.repeat(500), error: Object.assign(new Error('msg with body'), { code: 'E1' }) });
    const r = log.records[0] as Record<string, unknown>;
    expect(r['body']).toBe('[redacted]');
    expect(r['nested']).toEqual({ text: '[redacted]', clientSecret: '[redacted]', ok: 1 });
    expect(String(r['long']).length).toBeLessThan(210);
    expect(r['error']).toEqual({ name: 'Error', code: 'E1' });
    expect(JSON.stringify(r)).not.toContain('secret message');
  });
  it('child loggers keep base fields', () => {
    const log = memoryLogger();
    log.child({ fn: 'x' }).warn('w');
    expect(log.records[0]).toMatchObject({ fn: 'x', level: 'warn', event: 'w' });
    expect(redact(null)).toBeNull();
  });
});
