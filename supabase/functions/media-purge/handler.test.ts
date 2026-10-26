import { describe, expect, it } from 'vitest';
import { FakeVideoProvider, MemoryStorage } from '../_test/media-fakes';
import { INTERNAL_SECRET, body, memoryLogger, post, uuid } from '../_test/helpers';
import { handle, type MediaPurgeDeps } from './handler';

const GAME = uuid(1);
const ALICE = uuid(10);
const MEDIA = uuid(500);
const OTHER = uuid(501);

function setup() {
  const storage = new MemoryStorage();
  const video = new FakeVideoProvider();
  storage.put('media', `originals/${GAME}/${ALICE}/${MEDIA}.jpg`, new Uint8Array(1));
  storage.put('media', `media/${GAME}/${MEDIA}/display.jpg`, new Uint8Array(1));
  storage.put('media', `media/${GAME}/${MEDIA}/thumb.jpg`, new Uint8Array(1));
  storage.put('media', `media/${GAME}/${OTHER}/display.jpg`, new Uint8Array(1));
  storage.put('media', `quarantine/${MEDIA}/original.jpg`, new Uint8Array(1));
  const deps: MediaPurgeDeps = { internalSecrets: [INTERNAL_SECRET], storage, bucket: 'media', video, log: memoryLogger() };
  const call = (b: unknown, token = INTERNAL_SECRET) => handle(post('media-purge', b, { token }), deps);
  return { storage, video, deps, call };
}

describe('media-purge', () => {
  it('internal only', async () => {
    const { call } = setup();
    expect((await call({ mediaId: MEDIA, paths: [] }, 'user')).status).toBe(401);
  });

  it('deletes the item’s original, display copy and everything under its prefix, plus the Stream asset; idempotent', async () => {
    const { call, storage, video } = setup();
    const payload = { mediaId: MEDIA, paths: [`originals/${GAME}/${ALICE}/${MEDIA}.jpg`, `media/${GAME}/${MEDIA}/display.jpg`], prefix: `media/${GAME}/${MEDIA}/`, playbackRef: 'stream:abc' };
    expect(await body(await call(payload))).toEqual({ removed: 3, video: 'removed' });
    expect([...storage.objects.keys()].sort()).toEqual([`media/media/${GAME}/${OTHER}/display.jpg`, `media/quarantine/${MEDIA}/original.jpg`]);
    expect(video.removed).toEqual(['abc']);
    expect((await call(payload)).status).toBe(200);
  });

  it('refuses paths outside the item (other items, legal-hold evidence, traversal)', async () => {
    const { call, storage } = setup();
    for (const bad of [`quarantine/${MEDIA}/original.jpg`, `media/${GAME}/${OTHER}/display.jpg`, `media/${GAME}/${MEDIA}/../${OTHER}/x`, `avatars/${MEDIA}.jpg`]) {
      expect((await call({ mediaId: MEDIA, paths: [bad] })).status).toBe(400);
    }
    expect((await call({ mediaId: MEDIA, paths: [], prefix: `media/${GAME}/${OTHER}/` })).status).toBe(400);
    expect((await call({ mediaId: MEDIA, paths: [], prefix: 'quarantine/' })).status).toBe(400);
    expect(storage.objects.size).toBe(5);
  });
});
