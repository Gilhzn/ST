import { describe, expect, it } from 'vitest';
import { StError, type MediaUploadIntent, type MediaUploadRequest } from '@st/domain';
import { MemoryStorage } from '../_test/media-fakes';
import { allowAll, body, fakeAuth, memoryLogger, mutableClock, post, uuid } from '../_test/helpers';
import { handle, withRejectReason, type MediaUploadDeps, type UploadIntentRow } from './handler';

const NOW = Date.parse('2026-11-10T19:00:00.000Z');
const GAME = uuid(1);
const ALICE = uuid(10);
const MEDIA = uuid(500);

function setup() {
  const storage = new MemoryStorage();
  const calls: { token: string; request: MediaUploadRequest }[] = [];
  let failWith: StError | null = null;
  const log = memoryLogger();
  const deps: MediaUploadDeps = {
    auth: fakeAuth({ 'tok-alice': ALICE }),
    store: {
      createUploadIntent: async (token, request): Promise<UploadIntentRow> => {
        calls.push({ token, request });
        if (failWith) throw failWith;
        return { mediaId: MEDIA, storagePath: `originals/${GAME}/${ALICE}/${MEDIA}.jpg`, maxBytes: 20 * 1024 * 1024, expiresAt: '2026-11-10T23:00:00.000Z' };
      },
    },
    storage,
    bucket: 'media',
    rateLimiter: allowAll,
    clock: mutableClock(NOW),
    log,
    cors: { allowedOrigins: ['https://app.test'] },
  };
  const send = (b: Record<string, unknown>, token = 'tok-alice') => handle(post('media-upload', b, { token, headers: { origin: 'https://app.test' } }), deps);
  return { deps, storage, calls, log, send, fail: (e: StError | null) => { failWith = e; } };
}

const PHOTO = { gameId: GAME, kind: 'photo', mimeType: 'image/jpeg', sizeBytes: 2_000_000 };

describe('media-upload', () => {
  it('requires a signed-in user', async () => {
    const { send, calls } = setup();
    expect((await send(PHOTO, 'bad')).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('happy path: RPC as the caller, then a signed single-use upload URL for the allocated key', async () => {
    const { send, calls, storage, log } = setup();
    const res = await send(PHOTO);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.test');
    const intent = await body<MediaUploadIntent>(res);
    expect(intent).toEqual({
      mediaId: MEDIA,
      uploadUrl: `https://storage.test/upload/media/originals/${GAME}/${ALICE}/${MEDIA}.jpg?token=t-1`,
      method: 'PUT',
      headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false' },
      expiresAt: '2026-11-10T21:00:00.000Z', // signed URLs live 2 h, earlier than the RPC's expiry
      maxBytes: 20 * 1024 * 1024,
    });
    expect(calls).toEqual([{ token: 'tok-alice', request: { gameId: GAME, kind: 'photo', mimeType: 'image/jpeg', sizeBytes: 2_000_000, durationSeconds: null } }]);
    expect(storage.signedUploads).toEqual([{ bucket: 'media', path: `originals/${GAME}/${ALICE}/${MEDIA}.jpg` }]);
    expect(JSON.stringify(log.records)).not.toContain('token=');
  });

  it('passes window / attendee / cap rejections through with the reject reason', async () => {
    const { send, fail, storage } = setup();
    fail(new StError('outside_window', 'ST:outside_window: window_closed'));
    const closed = await send(PHOTO);
    expect(closed.status).toBe(409);
    expect(await body(closed)).toEqual({ code: 'outside_window', details: { reason: 'window_closed' } });
    fail(new StError('forbidden', 'ST:forbidden: not_verified_attendee'));
    expect(await body(await send(PHOTO))).toEqual({ code: 'forbidden', details: { reason: 'not_verified_attendee' } });
    fail(new StError('rate_limited', 'ST:rate_limited: user_cap_reached'));
    const cap = await send(PHOTO);
    expect(cap.status).toBe(429);
    expect(await body(cap)).toEqual({ code: 'rate_limited', details: { reason: 'user_cap_reached' } });
    fail(new StError('validation', 'ST:validation'));
    expect(await body(await send(PHOTO))).toEqual({ code: 'validation' });
    expect(storage.signedUploads).toHaveLength(0);
  });

  it('validates the request shape before calling the database', async () => {
    const { send, calls } = setup();
    expect(await body(await send({ ...PHOTO, mimeType: 'image/heic' }))).toEqual({ code: 'validation', details: { field: 'mimeType', reason: 'unsupported_type' } });
    expect(await body(await send({ ...PHOTO, mimeType: 'image/svg+xml' }))).toMatchObject({ details: { reason: 'unsupported_type' } });
    expect((await send({ ...PHOTO, kind: 'audio' })).status).toBe(400);
    expect((await send({ ...PHOTO, sizeBytes: 1.5 })).status).toBe(400);
    expect((await send({ ...PHOTO, sizeBytes: 0 })).status).toBe(400);
    expect((await send({ ...PHOTO, gameId: 'x' })).status).toBe(400);
    expect((await send({ gameId: GAME, kind: 'video', mimeType: 'video/mp4', sizeBytes: 10 })).status).toBe(400); // duration required
    expect(calls).toHaveLength(0);
    expect((await send({ gameId: GAME, kind: 'video', mimeType: 'video/mp4', sizeBytes: 10, durationSeconds: 30 })).status).toBe(200);
    expect(calls[0]?.request).toMatchObject({ kind: 'video', durationSeconds: 30 });
  });

  it('withRejectReason keeps existing details and ignores unknown words', () => {
    const e = withRejectReason(new StError('validation', 'ST:validation: too_large', { field: 'sizeBytes' })) as StError;
    expect(e.details).toEqual({ field: 'sizeBytes', reason: 'too_large' });
    expect((withRejectReason(new StError('validation', 'ST:validation: something_else')) as StError).details).toBeUndefined();
  });
});
