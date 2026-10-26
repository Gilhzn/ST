import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Effect, MediaStatus, Phase15Effect } from '@st/domain';
import { parseJpeg } from '#shared/media-sanitize';
import { JPEG_WITH_GPS } from '../_test/media-fixtures';
import { FakeCsamReporter, FakeCsamScanner, FakeImageModerator, FakeVideoProvider, MemoryStorage, fakeRenditions } from '../_test/media-fakes';
import { INTERNAL_SECRET, allowAll, body, fakeAuth, memoryLogger, mutableClock, post, uuid } from '../_test/helpers';
import { handle, type FinalizeMediaInput, type MediaProcessDeps, type MediaProcessResult, type MediaProcessStore, type MediaRecord } from './handler';

const NOW = Date.parse('2026-11-10T20:30:00.000Z');
const GAME = uuid(1);
const ALICE = uuid(10);
const BOB = uuid(11);
const PHOTO_ID = uuid(500);
const VIDEO_ID = uuid(501);
const BUCKET = 'media';
const HOLD = 'media-legal-hold';
const contains = (hay: Uint8Array, s: string) => Buffer.from(hay).includes(Buffer.from(s));

class MediaDb implements MediaProcessStore {
  items = new Map<string, MediaRecord>();
  finalized: FinalizeMediaInput[] = [];
  effects: (Effect | Phase15Effect)[] = [];
  loadMedia = async (id: string) => {
    const it = this.items.get(id);
    return it ? { ...it } : null;
  };
  finalizeMedia = async (input: FinalizeMediaInput): Promise<MediaStatus> => {
    this.finalized.push(input);
    const it = this.items.get(input.mediaId)!;
    if (it.status === 'processing') it.status = input.status;
    return it.status;
  };
  applyEffects = async (e: readonly (Effect | Phase15Effect)[]) => {
    this.effects.push(...e);
  };
}

function setup(opts: { csam?: boolean; moderator?: boolean; video?: boolean } = {}) {
  const db = new MediaDb();
  const storage = new MemoryStorage();
  const csam = new FakeCsamScanner();
  const reporter = new FakeCsamReporter();
  const moderator = new FakeImageModerator();
  const video = new FakeVideoProvider();
  const log = memoryLogger();
  db.items.set(PHOTO_ID, { id: PHOTO_ID, gameId: GAME, uploaderId: ALICE, kind: 'photo', status: 'processing', mimeType: 'image/jpeg', sizeBytes: JPEG_WITH_GPS.length, durationSeconds: null, storagePath: `originals/${GAME}/${ALICE}/${PHOTO_ID}.jpg`, createdAt: '2026-11-10T20:20:00.000Z' });
  db.items.set(VIDEO_ID, { id: VIDEO_ID, gameId: GAME, uploaderId: ALICE, kind: 'video', status: 'processing', mimeType: 'video/mp4', sizeBytes: 9_000_000, durationSeconds: 42, storagePath: `originals/${GAME}/${ALICE}/${VIDEO_ID}.mp4`, createdAt: '2026-11-10T20:20:00.000Z' });
  storage.put(BUCKET, `originals/${GAME}/${ALICE}/${PHOTO_ID}.jpg`, JPEG_WITH_GPS, 'image/jpeg');
  const deps: MediaProcessDeps = {
    internalSecrets: [INTERNAL_SECRET],
    auth: fakeAuth({ 'tok-alice': ALICE, 'tok-bob': BOB }),
    store: db,
    storage,
    bucket: BUCKET,
    quarantineBucket: HOLD,
    csam: opts.csam === false ? null : csam,
    reporter,
    moderator: opts.moderator === false ? null : moderator,
    renditions: fakeRenditions,
    video: opts.video === false ? null : video,
    vendorTimeoutMs: 200,
    rateLimiter: allowAll,
    clock: mutableClock(NOW),
    log,
    cors: { allowedOrigins: [] },
  };
  const asUser = (b: unknown, token = 'tok-alice') => handle(post('media-process', b, { token }), deps);
  const asInternal = (b: unknown) => handle(post('media-process', b, { token: INTERNAL_SECRET }), deps);
  return { db, storage, csam, reporter, moderator, video, log, deps, asUser, asInternal };
}

const objectsUnder = (s: MemoryStorage, prefix: string) => [...s.objects.keys()].filter((k) => k.startsWith(prefix));

describe('media-process: auth', () => {
  it('internal secret, or the uploader; nobody else', async () => {
    const { asUser, asInternal, deps, db } = setup();
    expect((await handle(post('media-process', { mediaId: PHOTO_ID }), deps)).status).toBe(401);
    expect((await asUser({ mediaId: PHOTO_ID }, 'forged')).status).toBe(401);
    expect((await handle(post('media-process', { mediaId: PHOTO_ID }, { token: 'too-short-secret' }), deps)).status).toBe(401);
    expect((await asUser({ mediaId: PHOTO_ID }, 'tok-bob')).status).toBe(404); // not the uploader: indistinguishable from missing
    expect((await asUser({ mediaId: uuid(999) })).status).toBe(404);
    expect(db.finalized).toHaveLength(0);
    expect((await asInternal({ mediaId: PHOTO_ID })).status).toBe(200);
  });
});

describe('media-process: photos', () => {
  it('happy path: EXIF/GPS stripped before any vendor sees it, published, original deleted', async () => {
    const { asUser, storage, db, csam, moderator, log } = setup();
    const res = await asUser({ mediaId: PHOTO_ID });
    expect(res.status).toBe(200);
    const out = await body<MediaProcessResult>(res);
    expect(out).toEqual({ mediaId: PHOTO_ID, status: 'published', reasonKey: null, idempotent: false });
    const published = storage.get(BUCKET, `media/${GAME}/${PHOTO_ID}/display.jpg`)!;
    expect(published).not.toBeNull();
    for (const leak of ['SecretCam', 'ModelX', 'GPSLatitude', 'secret comment']) expect(contains(published, leak)).toBe(false);
    expect(parseJpeg(published).segments.some((s) => s.marker === 0xda)).toBe(true);
    // Vendors received exactly the sanitised bytes.
    expect(Buffer.from(csam.scanned[0]!).equals(Buffer.from(published))).toBe(true);
    expect(Buffer.from(moderator.seen[0]!).equals(Buffer.from(published))).toBe(true);
    expect(storage.get(BUCKET, `media/${GAME}/${PHOTO_ID}/thumb.jpg`)).not.toBeNull();
    expect(storage.get(BUCKET, `originals/${GAME}/${ALICE}/${PHOTO_ID}.jpg`)).toBeNull();
    expect(db.finalized).toEqual([
      {
        mediaId: PHOTO_ID,
        status: 'published',
        verdict: { decision: 'publish', categories: [], exifStripped: true, csamHashMatch: false, source: 'combined', reasonKey: null },
        publishedPath: `media/${GAME}/${PHOTO_ID}/display.jpg`,
        thumbnailPath: `media/${GAME}/${PHOTO_ID}/thumb.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: published.length,
        durationSeconds: null,
        playbackRef: null,
      },
    ]);
    const logs = JSON.stringify(log.records);
    expect(logs).not.toContain('SecretCam');
    expect(logs).not.toContain('storage.test');
  });

  it('idempotent per media id: a second call (or a duplicate webhook) does nothing but report the status', async () => {
    const { asUser, asInternal, db, csam, moderator } = setup();
    await asUser({ mediaId: PHOTO_ID });
    const again = await body<MediaProcessResult>(await asUser({ mediaId: PHOTO_ID }));
    expect(again).toEqual({ mediaId: PHOTO_ID, status: 'published', reasonKey: null, idempotent: true });
    const hook = await body<MediaProcessResult>(await asInternal({ mediaId: PHOTO_ID }));
    expect(hook.idempotent).toBe(true);
    expect(db.finalized).toHaveLength(1);
    expect(csam.scanned).toHaveLength(1);
    expect(moderator.seen).toHaveLength(1);
  });

  it('storage webhook: processes originals/ objects of our bucket, ignores everything else', async () => {
    const { asInternal, db } = setup();
    const hook = (bucket_id: string, name: string) => asInternal({ type: 'INSERT', table: 'objects', schema: 'storage', record: { bucket_id, name } });
    expect(await body(await hook(BUCKET, `media/${GAME}/${PHOTO_ID}/display.jpg`))).toEqual({ skipped: true });
    expect(await body(await hook('avatars', `originals/${GAME}/${ALICE}/${PHOTO_ID}.jpg`))).toEqual({ skipped: true });
    expect(await body(await hook(BUCKET, `originals/${GAME}/${BOB}/${PHOTO_ID}.jpg`))).toEqual({ skipped: true }); // path mismatch
    expect(db.finalized).toHaveLength(0);
    expect(await body(await hook(BUCKET, `originals/${GAME}/${ALICE}/${PHOTO_ID}.jpg`))).toMatchObject({ mediaId: PHOTO_ID, status: 'published', decision: 'publish' });
  });

  it('moderation block: not published, original deleted, generic reason; a minors signal also queues urgent review', async () => {
    const t = setup();
    t.moderator.rules.push({ marker: 'JFIF', result: { decision: 'block', categories: ['sexual'], minorsSignal: false } });
    const out = await body<MediaProcessResult>(await t.asUser({ mediaId: PHOTO_ID }));
    expect(out).toEqual({ mediaId: PHOTO_ID, status: 'blocked', reasonKey: 'media.blocked.policy', idempotent: false });
    expect(objectsUnder(t.storage, `${BUCKET}/media/`)).toEqual([]);
    expect(t.storage.get(BUCKET, `originals/${GAME}/${ALICE}/${PHOTO_ID}.jpg`)).toBeNull();
    expect(t.db.finalized[0]).toMatchObject({ status: 'blocked', verdict: { decision: 'block', categories: ['sexual'], source: 'vision', exifStripped: true } });
    expect(t.db.effects).toEqual([]);
    expect(t.reporter.calls).toBe(0);

    const m = setup();
    m.moderator.rules.push({ marker: 'JFIF', result: { decision: 'block', categories: ['sexual_minors'], minorsSignal: true } });
    await m.asUser({ mediaId: PHOTO_ID });
    expect(m.db.effects).toEqual([expect.objectContaining({ type: 'EnqueueReview', item: expect.objectContaining({ priority: 'high', dedupeKey: `media_minors_classifier:${PHOTO_ID}`, subjectUserId: ALICE }) })]);
    expect(m.reporter.calls).toBe(0); // classifier signals go to humans; only hash matches are reported automatically
    expect(m.db.effects.some((e) => e.type === 'RestrictAccountPendingReview')).toBe(false);
  });

  it('unparseable or oversized files are blocked without reaching any vendor', async () => {
    const t = setup();
    t.storage.put(BUCKET, `originals/${GAME}/${ALICE}/${PHOTO_ID}.jpg`, new TextEncoder().encode('<svg onload=alert(1)>'));
    expect(await body(await t.asUser({ mediaId: PHOTO_ID }))).toMatchObject({ status: 'blocked', reasonKey: 'media.blocked.unsupported' });
    expect(t.csam.scanned).toHaveLength(0);
    const big = setup();
    big.deps.limits = { photoMaxBytes: 100, videoMaxSeconds: 60, videoFrames: 2 };
    expect(await body(await big.asUser({ mediaId: PHOTO_ID }))).toMatchObject({ status: 'blocked', reasonKey: 'media.blocked.too_large' });
    expect(big.csam.scanned).toHaveLength(0);
  });

  it('fails closed: vendor outage or missing configuration → 503, still processing, nothing published, original kept', async () => {
    const t = setup();
    t.csam.fail = true;
    const r = await t.asUser({ mediaId: PHOTO_ID });
    expect(r.status).toBe(503);
    expect(await body(r)).toEqual({ code: 'unavailable', details: { step: 'csam' } });
    expect(t.db.items.get(PHOTO_ID)!.status).toBe('processing');
    expect(objectsUnder(t.storage, `${BUCKET}/media/`)).toEqual([]);
    expect(t.storage.get(BUCKET, `originals/${GAME}/${ALICE}/${PHOTO_ID}.jpg`)).not.toBeNull();
    t.csam.fail = false;
    t.moderator.fail = true;
    expect((await t.asUser({ mediaId: PHOTO_ID })).status).toBe(503);
    t.moderator.fail = false;
    expect(await body(await t.asUser({ mediaId: PHOTO_ID }))).toMatchObject({ status: 'published' });

    const noVendor = setup({ csam: false });
    const nv = await noVendor.asUser({ mediaId: PHOTO_ID });
    expect(nv.status).toBe(503);
    expect(await body(nv)).toEqual({ code: 'unavailable', details: { reason: 'csam_unconfigured' } });
    expect(noVendor.db.finalized).toHaveLength(0);
  });

  it('not uploaded yet → 409, item untouched', async () => {
    const t = setup();
    t.storage.objects.clear();
    const r = await t.asUser({ mediaId: PHOTO_ID });
    expect(r.status).toBe(409);
    expect(await body(r)).toEqual({ code: 'conflict', details: { reason: 'not_uploaded' } });
  });
});

describe('media-process: CSAM hash match (AC-VAULT-003)', () => {
  it('never published; original preserved under legal hold with a manifest; report filed; account restricted; urgent review', async () => {
    const t = setup();
    t.csam.matchAll = true;
    const res = await t.asUser({ mediaId: PHOTO_ID });
    expect(res.status).toBe(200);
    const text = await res.text();
    // The uploader sees a generic policy block: no hint of a hash match.
    expect(JSON.parse(text)).toEqual({ mediaId: PHOTO_ID, status: 'blocked', reasonKey: 'media.blocked.policy', idempotent: false });
    expect(text.toLowerCase()).not.toMatch(/csam|hash|report/);

    // Never published, never moderated.
    expect(objectsUnder(t.storage, `${BUCKET}/media/`)).toEqual([]);
    expect(t.moderator.seen).toHaveLength(0);
    // Legal hold: untouched original bytes (EXIF included, as evidence) + manifest.
    const held = t.storage.get(HOLD, `quarantine/${PHOTO_ID}/original.jpg`)!;
    expect(Buffer.from(held).equals(Buffer.from(JPEG_WITH_GPS))).toBe(true);
    const manifest = JSON.parse(new TextDecoder().decode(t.storage.get(HOLD, `quarantine/${PHOTO_ID}/manifest.json`)!));
    expect(manifest).toMatchObject({ mediaId: PHOTO_ID, uploaderId: ALICE, gameId: GAME, legalHold: true, matchSource: 'fake-hash', matchId: 'match-001', sha256: createHash('sha256').update(JPEG_WITH_GPS).digest('hex') });
    // Moved: gone from the upload path.
    expect(t.storage.get(BUCKET, `originals/${GAME}/${ALICE}/${PHOTO_ID}.jpg`)).toBeNull();
    // Report filed once, keyed by media id.
    expect([...t.reporter.reports.keys()]).toEqual([PHOTO_ID]);
    expect(t.reporter.reports.get(PHOTO_ID)).toMatchObject({ uploaderId: ALICE, evidence: { bucket: HOLD, path: `quarantine/${PHOTO_ID}/original.jpg` } });
    // Account on hold pending human review (security review H1): one durable RestrictAccountPendingReview,
    // never the old time-boxed BanJoins / RestrictVisibility / MuteChat projections.
    expect(t.db.effects.map((e) => e.type)).toEqual(['PreserveMediaEvidence', 'RestrictAccountPendingReview', 'EnqueueReview', 'Audit']);
    expect(t.db.effects[0]).toEqual({ type: 'PreserveMediaEvidence', mediaId: PHOTO_ID, uploaderId: ALICE, dedupeKey: `preserve:${PHOTO_ID}` });
    expect(t.db.effects[1]).toEqual({ type: 'RestrictAccountPendingReview', userId: ALICE, reason: 'csam_match', dedupeKey: `restrict:media_csam:${PHOTO_ID}` });
    expect(t.db.effects.some((e) => ['BanJoins', 'RestrictVisibility', 'MuteChat'].includes(e.type))).toBe(false);
    expect(t.db.effects[2]).toMatchObject({ type: 'EnqueueReview', item: { kind: 'media_csam', priority: 'high', subjectUserId: ALICE, dedupeKey: `media_csam:${PHOTO_ID}`, evidence: { reason: 'csam_hash_match', reportStatus: 'filed', evidencePath: `quarantine/${PHOTO_ID}/original.jpg` } } });
    expect(t.db.finalized).toEqual([expect.objectContaining({ status: 'blocked', publishedPath: null, verdict: expect.objectContaining({ decision: 'csam', csamHashMatch: true, source: 'hash' }) })]);
    expect(JSON.stringify(t.log.records)).not.toContain(ALICE);

    // Idempotent: a retry neither re-reports nor re-finalises.
    expect(await body(await t.asInternal({ mediaId: PHOTO_ID }))).toMatchObject({ status: 'blocked', idempotent: true });
    expect(t.reporter.calls).toBe(1);
    expect(t.db.finalized).toHaveLength(1);
  });

  it('L5: to the uploader a CSAM block is indistinguishable from a policy block (status, headers, body)', async () => {
    const policy = setup();
    policy.moderator.rules.push({ marker: 'JFIF', result: { decision: 'block', categories: ['sexual'], minorsSignal: false } });
    const csam = setup();
    csam.csam.matchAll = true;
    const [a, b] = [await policy.asUser({ mediaId: PHOTO_ID }), await csam.asUser({ mediaId: PHOTO_ID })];
    expect(b.status).toBe(a.status);
    expect([...b.headers.entries()]).toEqual([...a.headers.entries()]);
    const [ta, tb] = [await a.text(), await b.text()];
    expect(tb).toBe(ta);
    expect(JSON.parse(tb)).toEqual({ mediaId: PHOTO_ID, status: 'blocked', reasonKey: 'media.blocked.policy', idempotent: false });
    // Re-asking later is identical too.
    expect(await (await csam.asUser({ mediaId: PHOTO_ID })).text()).toBe(await (await policy.asUser({ mediaId: PHOTO_ID })).text());
  });

  it('a failure mid-way leaves the item unpublished and processing; the retry completes every step once', async () => {
    const t = setup();
    t.csam.matchAll = true;
    t.reporter.failNext = 1;
    expect((await t.asInternal({ mediaId: PHOTO_ID })).status).toBe(503);
    expect(t.db.items.get(PHOTO_ID)!.status).toBe('processing');
    expect(t.db.finalized).toHaveLength(0);
    expect(t.storage.get(HOLD, `quarantine/${PHOTO_ID}/original.jpg`)).not.toBeNull();
    expect(t.storage.get(BUCKET, `originals/${GAME}/${ALICE}/${PHOTO_ID}.jpg`)).not.toBeNull(); // still there for the retry
    const out = await body<MediaProcessResult>(await t.asInternal({ mediaId: PHOTO_ID }));
    expect(out).toMatchObject({ status: 'blocked', decision: 'csam' });
    expect(t.reporter.reports.size).toBe(1);
    expect(objectsUnder(t.storage, `${HOLD}/quarantine/${PHOTO_ID}/`)).toHaveLength(2);
    expect(objectsUnder(t.storage, `${BUCKET}/media/`)).toEqual([]);
  });
});

describe('media-process: videos', () => {
  const putVideo = (s: MemoryStorage) => s.put(BUCKET, `originals/${GAME}/${ALICE}/${VIDEO_ID}.mp4`, Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]), 'video/mp4');

  it('transcoding → 202 processing; when ready, frames are matched and moderated, then published', async () => {
    const t = setup();
    putVideo(t.storage);
    t.video.nextStatus = { state: 'processing' };
    const first = await t.asUser({ mediaId: VIDEO_ID });
    expect(first.status).toBe(202);
    expect(await body(first)).toEqual({ mediaId: VIDEO_ID, status: 'processing', reasonKey: null, idempotent: false });
    expect(t.db.finalized).toHaveLength(0);
    expect(t.video.assets.get(`stream-${VIDEO_ID}`)!.sourceUrl).toContain(`originals/${GAME}/${ALICE}/${VIDEO_ID}.mp4`);

    t.video.assets.get(`stream-${VIDEO_ID}`)!.status = { state: 'ready', durationSeconds: 42.4, playbackRef: `stream-${VIDEO_ID}` };
    const done = await body<MediaProcessResult>(await t.asInternal({ mediaId: VIDEO_ID }));
    expect(done).toMatchObject({ status: 'published', decision: 'publish' });
    expect(t.video.ingests).toBe(2); // idempotent ingest (provider dedupes by media id)
    expect(t.video.assets.size).toBe(1);
    expect(t.csam.scanned).toHaveLength(2);
    expect(t.moderator.seen).toHaveLength(2);
    expect(t.db.finalized[0]).toMatchObject({ status: 'published', durationSeconds: 42, playbackRef: `stream:stream-${VIDEO_ID}`, verdict: { exifStripped: true } });
    expect(t.storage.get(BUCKET, `originals/${GAME}/${ALICE}/${VIDEO_ID}.mp4`)).toBeNull();
  });

  it('CSAM on a sampled frame: transcode removed, original under legal hold, reported, restricted', async () => {
    const t = setup();
    putVideo(t.storage);
    t.csam.matchAll = true;
    expect(await body(await t.asUser({ mediaId: VIDEO_ID }))).toEqual({ mediaId: VIDEO_ID, status: 'blocked', reasonKey: 'media.blocked.policy', idempotent: false });
    expect(t.video.removed).toEqual([`stream-${VIDEO_ID}`]);
    expect(t.storage.get(HOLD, `quarantine/${VIDEO_ID}/original.bin`)).not.toBeNull();
    expect(t.reporter.reports.get(VIDEO_ID)).toMatchObject({ sha256: null, mimeType: 'video/mp4' });
    expect(t.db.effects.map((e) => e.type)).toContain('RestrictAccountPendingReview');
    expect(t.moderator.seen).toHaveLength(0);
  });

  it('too long, transcode errors and moderation blocks are blocked and the transcode deleted', async () => {
    const long = setup();
    putVideo(long.storage);
    long.video.nextStatus = { state: 'ready', durationSeconds: 75, playbackRef: '' };
    expect(await body(await long.asUser({ mediaId: VIDEO_ID }))).toMatchObject({ status: 'blocked', reasonKey: 'media.blocked.too_long' });
    expect(long.video.removed).toHaveLength(1);

    const broken = setup();
    putVideo(broken.storage);
    broken.video.nextStatus = { state: 'error', reason: 'ERR_NON_VIDEO' };
    expect(await body(await broken.asUser({ mediaId: VIDEO_ID }))).toMatchObject({ status: 'blocked', reasonKey: 'media.blocked.unsupported' });

    const nsfw = setup();
    putVideo(nsfw.storage);
    nsfw.video.nextFrames = [new TextEncoder().encode('frame-ok'), new TextEncoder().encode('frame-gore')];
    nsfw.moderator.rules.push({ marker: 'gore', result: { decision: 'block', categories: ['violence'], minorsSignal: false } });
    expect(await body(await nsfw.asUser({ mediaId: VIDEO_ID }))).toMatchObject({ status: 'blocked', reasonKey: 'media.blocked.policy' });
    expect(nsfw.db.finalized[0]!.verdict.categories).toEqual(['violence']);
    expect(nsfw.video.removed).toHaveLength(1);
  });

  it('not uploaded → 409; no video provider → 503', async () => {
    const t = setup();
    expect((await t.asUser({ mediaId: VIDEO_ID })).status).toBe(409);
    const nv = setup({ video: false });
    putVideo(nv.storage);
    expect(await body(await nv.asUser({ mediaId: VIDEO_ID }))).toEqual({ code: 'unavailable', details: { reason: 'video_unconfigured' } });
  });
});
