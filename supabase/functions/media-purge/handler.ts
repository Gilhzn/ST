/**
 * media-purge: deletes the stored objects of a removed media item. Internal only:
 * dispatched by `st_remove_media` (deletion by the uploader or a moderator,
 * retention expiry in `purge_media`, account deletion; VAULT-007).
 *
 * POST { mediaId, paths: string[], prefix?: 'media/<game>/<id>/', playbackRef?: 'stream:<uid>' | null }
 * → { removed, video }
 *
 * Only `originals/…` and `media/…` keys are accepted, never `quarantine/…`:
 * legal-hold evidence is not dispatched here and could not be deleted by a
 * crafted payload either. Idempotent (missing objects are ignored).
 */
import { StError } from '@st/domain';
import { requireInternalCaller } from '#shared/auth';
import { json, readJson, route } from '#shared/http';
import type { Logger } from '#shared/log';
import type { VideoProvider } from '#shared/media-providers';
import { assertObjectKey, type StorageClient } from '#shared/storage';
import { arrayField, uuidField } from '#shared/validate';

export interface MediaPurgeDeps {
  internalSecrets: readonly string[];
  storage: StorageClient;
  bucket: string;
  video: VideoProvider | null;
  log: Logger;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PREFIX_RE = new RegExp(`^media/${UUID}/${UUID}/$`, 'i');

function purgeablePath(raw: unknown, mediaId: string): string {
  if (typeof raw !== 'string') throw new StError('validation', 'paths must be strings', { field: 'paths' });
  const p = assertObjectKey(raw);
  // Only this item's objects: originals/<game>/<uploader>/<id>.<ext> or media/<game>/<id>/…
  const ok = (p.startsWith('originals/') && p.includes(mediaId)) || (p.startsWith('media/') && p.split('/')[2] === mediaId);
  if (!ok) throw new StError('validation', 'path outside the media item', { field: 'paths' });
  return p;
}

export async function handle(req: Request, deps: MediaPurgeDeps): Promise<Response> {
  return route(req, deps.log, { methods: ['POST'] }, async () => {
    requireInternalCaller(req, deps.internalSecrets);
    const input = await readJson(req, 16 * 1024);
    const mediaId = uuidField(input, 'mediaId');
    const paths = arrayField(input, 'paths', 10).map((p) => purgeablePath(p, mediaId));
    const prefix = input['prefix'];
    if (prefix !== undefined && prefix !== null) {
      if (typeof prefix !== 'string' || !PREFIX_RE.test(prefix) || prefix.split('/')[2] !== mediaId) throw new StError('validation', 'invalid prefix', { field: 'prefix' });
      paths.push(...(await deps.storage.list(deps.bucket, prefix, 100)));
    }
    const unique = [...new Set(paths)];
    await deps.storage.remove(deps.bucket, unique);

    let video: 'removed' | 'skipped' | null = null;
    const ref = input['playbackRef'];
    if (typeof ref === 'string' && ref.startsWith('stream:')) {
      if (deps.video) {
        await deps.video.remove(ref.slice('stream:'.length));
        video = 'removed';
      } else {
        video = 'skipped';
        deps.log.warn('media_purge.video_unconfigured', { mediaId });
      }
    }
    deps.log.info('media_purge.done', { mediaId, removed: unique.length, video });
    return json({ removed: unique.length, video });
  });
}
