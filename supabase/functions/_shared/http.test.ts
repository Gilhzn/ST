import { describe, expect, it } from 'vitest';
import { StError } from '@st/domain';
import { HTTP_STATUS, corsHeaders, parseStCode, readJson, route, toErrorResponse } from '#shared/http';
import { memoryLogger } from '#shared/log';

const req = (init: RequestInit & { url?: string } = {}) => new Request(init.url ?? 'https://x.test/f', init);

describe('http helpers', () => {
  it('parses ST:<code> from Postgres messages', () => {
    expect(parseStCode('ST:chat_muted')).toBe('chat_muted');
    expect(parseStCode('ERROR: ST:validation: field')).toBe('validation');
    expect(parseStCode('ST:not_a_code')).toBeNull();
    expect(parseStCode(null)).toBeNull();
  });

  it('maps every error code to a status', () => {
    expect(HTTP_STATUS.unauthenticated).toBe(401);
    expect(HTTP_STATUS.rate_limited).toBe(429);
    expect(HTTP_STATUS.payment_required).toBe(402);
  });

  it('only reflects allow-listed origins', () => {
    const r = req({ headers: { origin: 'https://app.test' } });
    expect(corsHeaders(r, { allowedOrigins: ['https://app.test'] })['access-control-allow-origin']).toBe('https://app.test');
    expect(corsHeaders(r, { allowedOrigins: ['https://other.test'] })).toEqual({});
    expect(corsHeaders(r, { allowedOrigins: '*' })['access-control-allow-origin']).toBe('*');
  });

  it('answers preflight, rejects wrong methods and maps thrown errors', async () => {
    const log = memoryLogger();
    const cors = { allowedOrigins: ['https://app.test'] as const };
    const pre = await route(req({ method: 'OPTIONS', headers: { origin: 'https://app.test' } }), log, { cors }, () => Promise.resolve(new Response('no')));
    expect(pre.status).toBe(204);
    const get = await route(req({ method: 'GET' }), log, {}, () => Promise.resolve(new Response('no')));
    expect(get.status).toBe(405);
    const err = await route(req({ method: 'POST' }), log, {}, () => Promise.reject(new StError('chat_muted', 'x', { mutedUntil: 't' })));
    expect(err.status).toBe(403);
    expect(await err.json()).toEqual({ code: 'chat_muted', details: { mutedUntil: 't' } });
    const crash = await route(req({ method: 'POST' }), log, {}, () => Promise.reject(new TypeError('boom secret body')));
    expect(crash.status).toBe(500);
    expect(await crash.json()).toEqual({ code: 'unknown' });
    expect(JSON.stringify(log.records)).not.toContain('secret body');
  });

  it('readJson enforces content type, size and object shape', async () => {
    const mk = (body: string, type = 'application/json') => req({ method: 'POST', headers: { 'content-type': type }, body });
    await expect(readJson(mk('{"a":1}'))).resolves.toEqual({ a: 1 });
    await expect(readJson(mk('{"a":1}', 'text/plain'))).rejects.toMatchObject({ code: 'validation' });
    await expect(readJson(mk('{bad'))).rejects.toThrow(/malformed/);
    await expect(readJson(mk('[1]'))).rejects.toThrow(/object/);
    await expect(readJson(mk(JSON.stringify({ x: 'y'.repeat(100) })), 50)).rejects.toThrow(/too large/);
  });

  it('5xx StErrors are logged, 4xx are not', () => {
    const log = memoryLogger();
    toErrorResponse(new StError('validation'), log);
    expect(log.records).toHaveLength(0);
    toErrorResponse(new StError('unavailable'), log);
    expect(log.records[0]?.event).toBe('request.failed');
  });
});
