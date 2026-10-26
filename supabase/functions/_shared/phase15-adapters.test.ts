import { describe, expect, it } from 'vitest';
import { createPushDispatcher } from './functions-client';
import { createCloudflareStream, createOmniImageModerator, createPhotoDnaScanner, imageVerdict, storageTransformRenditions } from './media-providers';
import { rowToInvitePreview } from './phase15-store';
import { assertObjectKey, createSupabaseStorage } from './storage';
import { mediaEnv, ogBaseUrl, pushDispatcher, trustedProxyHops } from './wiring-phase15';

type Call = { url: string; init: RequestInit };
function fakeFetch(responder: (url: string, init: RequestInit) => Response): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return responder(url, init);
  }) as typeof fetch;
  return { fetch: f, calls };
}
const jsonRes = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const signal = new AbortController().signal;

describe('storage client', () => {
  it('signs uploads, downloads with a size cap, copies idempotently and rejects unsafe keys', async () => {
    const { fetch, calls } = fakeFetch((url, init) => {
      if (url.includes('/object/upload/sign/')) return jsonRes({ url: '/object/upload/sign/media/originals/a.jpg?token=tok123' });
      if (url.includes('/object/sign/')) return jsonRes({ signedURL: '/object/sign/media/originals/v?token=s' });
      if (url.includes('/object/authenticated/media/missing')) return jsonRes({ statusCode: '404', error: 'not_found' }, 400);
      if (url.includes('/object/authenticated/')) return new Response(new Uint8Array(10), { headers: { 'content-length': '10' } });
      if (url.endsWith('/object/copy')) return jsonRes({ statusCode: '409', error: 'Duplicate' }, 400);
      if (init.method === 'DELETE') return jsonRes([]);
      return jsonRes({});
    });
    const s = createSupabaseStorage({ url: 'https://ref.supabase.co/', serviceKey: 'svc', fetch });
    expect(await s.createSignedUploadUrl('media', 'originals/a.jpg')).toEqual({ signedUrl: 'https://ref.supabase.co/storage/v1/object/upload/sign/media/originals/a.jpg?token=tok123', token: 'tok123', path: 'originals/a.jpg' });
    expect(await s.createSignedUrl('media', 'originals/v', 60)).toBe('https://ref.supabase.co/storage/v1/object/sign/media/originals/v?token=s');
    expect((await s.download('media', 'originals/a.jpg', 100))?.length).toBe(10);
    await expect(s.download('media', 'originals/a.jpg', 5)).rejects.toMatchObject({ code: 'validation' });
    expect(await s.download('media', 'missing', 100)).toBeNull();
    await s.copy({ bucket: 'media', path: 'originals/a.jpg' }, { bucket: 'hold', path: 'quarantine/x/original.jpg' }); // 409 = already preserved
    await s.upload('media', 'media/g/x/display.jpg', new Uint8Array(3), 'image/jpeg', { upsert: true });
    await s.remove('media', ['originals/a.jpg']);
    expect(calls.find((c) => c.url.endsWith('/object/media/media/g/x/display.jpg'))!.init.headers).toMatchObject({ 'x-upsert': 'true', authorization: 'Bearer svc' });
    expect(JSON.parse(String(calls.find((c) => c.url.endsWith('/object/copy'))!.init.body))).toEqual({ bucketId: 'media', sourceKey: 'originals/a.jpg', destinationBucket: 'hold', destinationKey: 'quarantine/x/original.jpg' });
    for (const bad of ['../x', '/abs', 'a//b', 'a/./b', 'a b', '']) expect(() => assertObjectKey(bad)).toThrow();
  });
});

describe('media vendor adapters', () => {
  it('PhotoDNA: posts bytes with the subscription key; maps IsMatch and fails on bad status', async () => {
    const { fetch, calls } = fakeFetch(() => jsonRes({ Status: { Code: 3000 }, IsMatch: true, MatchDetails: { MatchFlags: [{ MatchId: 42 }] } }));
    const scanner = createPhotoDnaScanner({ apiKey: 'k', fetch });
    expect(await scanner.match({ bytes: new Uint8Array(4), mimeType: 'image/jpeg' }, signal)).toEqual({ matched: true, matchId: '42', source: 'photodna' });
    expect(calls[0]!.init.headers).toMatchObject({ 'Ocp-Apim-Subscription-Key': 'k', 'content-type': 'image/jpeg' });
    const bad = createPhotoDnaScanner({ apiKey: 'k', fetch: fakeFetch(() => jsonRes({ Status: { Code: 3208 } })).fetch });
    await expect(bad.match({ bytes: new Uint8Array(1), mimeType: 'image/png' }, signal)).rejects.toThrow();
  });

  it('omni image moderation: data URL input, thresholds tuned for sports photos', async () => {
    const { fetch, calls } = fakeFetch(() => jsonRes({ results: [{ category_scores: { sexual: 0.7, violence: 0.8 } }] }));
    const m = createOmniImageModerator({ apiKey: 'k', fetch });
    expect(await m.classify({ bytes: Uint8Array.from([1, 2, 3]), mimeType: 'image/png' }, signal)).toEqual({ decision: 'block', categories: ['sexual'], minorsSignal: false });
    const sent = JSON.parse(String(calls[0]!.init.body));
    expect(sent).toEqual({ model: 'omni-moderation-latest', input: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } }] });
    expect(imageVerdict({ category_scores: { violence: 0.85 } }).decision).toBe('allow'); // a hard tackle
    expect(imageVerdict({ category_scores: { 'sexual/minors': 0.15 } })).toEqual({ decision: 'block', categories: ['sexual_minors'], minorsSignal: true });
  });

  it('Cloudflare Stream: ingest is idempotent by media id; status and frames', async () => {
    const uid = 'a'.repeat(32);
    let existing: unknown[] = [];
    const { fetch, calls } = fakeFetch((url, init) => {
      if (url.includes('?search=')) return jsonRes({ success: true, result: existing });
      if (url.endsWith('/stream/copy')) return jsonRes({ success: true, result: { uid } });
      if (url.endsWith('/token')) return jsonRes({ success: true, result: { token: 'sig' } });
      if (url.includes('thumbnails')) return new Response(Uint8Array.from([0xff, 0xd8]));
      if (init.method === 'DELETE') return new Response(null, { status: 404 });
      return jsonRes({ success: true, result: { uid, readyToStream: true, status: { state: 'ready' }, duration: 12.5 } });
    });
    const v = createCloudflareStream({ accountId: 'acc', apiToken: 't', customerCode: 'cust', fetch });
    expect(await v.ingest('m1', 'https://signed')).toBe(uid);
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ url: 'https://signed', meta: { name: 'm1' }, requireSignedURLs: true });
    existing = [{ uid: 'b'.repeat(32), meta: { name: 'm1' } }];
    expect(await v.ingest('m1', 'https://signed')).toBe('b'.repeat(32));
    expect(await v.status(uid)).toEqual({ state: 'ready', durationSeconds: 12.5, playbackRef: uid });
    const frames = await v.sampleFrames(uid, 10, 2);
    expect(frames).toHaveLength(2);
    expect(calls.filter((c) => c.url.includes('thumbnails')).map((c) => c.url)).toEqual([
      'https://customer-cust.cloudflarestream.com/sig/thumbnails/thumbnail.jpg?time=2.5s&height=720',
      'https://customer-cust.cloudflarestream.com/sig/thumbnails/thumbnail.jpg?time=7.5s&height=720',
    ]);
    await v.remove(uid);
    await expect(v.status('../evil')).rejects.toThrow();
  });

  it('renditions are on-the-fly transforms of the sanitised object', async () => {
    expect(await storageTransformRenditions.render({ bytes: new Uint8Array(0), mimeType: 'image/jpeg', sanitizedPath: 'media/g/m/display.jpg', renditionPrefix: 'media/g/m' })).toEqual([
      { name: 'thumb', maxWidth: 320, path: 'media/g/m/display.jpg', bytes: null, contentType: 'image/jpeg' },
      { name: 'medium', maxWidth: 1280, path: 'media/g/m/display.jpg', bytes: null, contentType: 'image/jpeg' },
    ]);
  });
});

describe('push dispatcher', () => {
  it('calls push-dispatch with the service key; non-2xx → unavailable', async () => {
    const { fetch, calls } = fakeFetch(() => jsonRes({ notifications: 2, sent: 1, failed: 1 }));
    const p = createPushDispatcher({ url: 'https://ref.supabase.co', serviceKey: 'svc', fetch });
    expect(await p.dispatch(['a', 'b'])).toEqual({ notifications: 2, sent: 1, failed: 1 });
    expect(calls[0]!.url).toBe('https://ref.supabase.co/functions/v1/push-dispatch');
    expect(await p.dispatch([])).toEqual({ notifications: 0, sent: 0, failed: 0 });
    const down = createPushDispatcher({ url: 'https://x', serviceKey: 's', fetch: fakeFetch(() => jsonRes({}, 500)).fetch });
    await expect(down.dispatch(['a'])).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('phase15 wiring and row mapping', () => {
  const env = (vars: Record<string, string>) => ({ get: (k: string) => ({ SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', SUPABASE_ANON_KEY: 'anon', ...vars })[k] });

  it('fails closed without vendor keys; validates buckets and OG_BASE_URL', () => {
    const none = mediaEnv(env({}));
    expect(none).toMatchObject({ bucket: 'media', quarantineBucket: 'media', csam: null, moderator: null, video: null });
    const all = mediaEnv(env({ MEDIA_BUCKET: 'vault', MEDIA_QUARANTINE_BUCKET: 'hold', CSAM_PROVIDER_KEY: 'k', OPENAI_API_KEY: 'o', CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_STREAM_TOKEN: 't', CLOUDFLARE_STREAM_CUSTOMER_CODE: 'c' }));
    expect(all.csam?.name).toBe('photodna');
    expect(all.moderator?.name).toBe('omni');
    expect(all.video?.name).toBe('cloudflare-stream');
    expect(all.quarantineBucket).toBe('hold');
    expect(() => mediaEnv(env({ MEDIA_BUCKET: '../x' }))).toThrow();
    expect(ogBaseUrl(env({ OG_BASE_URL: 'https://app.test/web/?x=1' }))).toBe('https://app.test/web');
    expect(() => ogBaseUrl(env({ OG_BASE_URL: 'http://app.test' }))).toThrow();
    expect(() => ogBaseUrl(env({}))).toThrow();
    expect(pushDispatcher(env({ PUSH_VIA_WEBHOOK: '1' }))).toBeNull();
    expect(pushDispatcher(env({}))).not.toBeNull();
    expect(trustedProxyHops(env({}))).toBe(1);
    expect(trustedProxyHops(env({ TRUSTED_PROXY_HOPS: '2' }))).toBe(2);
    expect(() => trustedProxyHops(env({ TRUSTED_PROXY_HOPS: '0' }))).toThrow();
  });

  it('maps get_invite_preview defensively', () => {
    expect(rowToInvitePreview(null)).toBeNull();
    expect(rowToInvitePreview({ sport: 'chess', title: 'x' })).toBeNull();
    expect(rowToInvitePreview({ sport: 'padel', title: 'Padel', weekday: 9, recurrence: 'daily', spotsLeft: 2, capacity: 4, hostDisplayName: null })).toMatchObject({ weekday: null, recurrence: null, spotsLeft: 2, hostDisplayName: '' });
  });
});
