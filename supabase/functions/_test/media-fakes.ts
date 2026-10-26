/** In-memory fakes for the Media Vault ports (tests only; never deployed). */
import { StError } from '@st/domain';
import type {
  CsamMatch,
  CsamReportInput,
  CsamReportResult,
  CsamReporter,
  CsamScanner,
  ImageModerationResult,
  ImageModerator,
  Rendition,
  RenditionProvider,
  VideoProvider,
  VideoStatus,
} from '#shared/media-providers';
import { assertObjectKey, type SignedUpload, type StorageClient } from '#shared/storage';

/** In-memory storage (tests and local development). */
export class MemoryStorage implements StorageClient {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  readonly signedUploads: { bucket: string; path: string }[] = [];
  readonly calls: string[] = [];

  key(bucket: string, path: string): string {
    return `${bucket}/${assertObjectKey(path)}`;
  }
  put(bucket: string, path: string, bytes: Uint8Array, contentType = 'application/octet-stream'): void {
    this.objects.set(this.key(bucket, path), { bytes, contentType });
  }
  get(bucket: string, path: string): Uint8Array | null {
    return this.objects.get(this.key(bucket, path))?.bytes ?? null;
  }
  createSignedUploadUrl(bucket: string, path: string): Promise<SignedUpload> {
    this.calls.push(`sign-upload:${bucket}/${path}`);
    this.signedUploads.push({ bucket, path: assertObjectKey(path) });
    return Promise.resolve({ signedUrl: `https://storage.test/upload/${bucket}/${path}?token=t-${this.signedUploads.length}`, token: `t-${this.signedUploads.length}`, path });
  }
  createSignedUrl(bucket: string, path: string, expiresInS: number): Promise<string> {
    this.calls.push(`sign:${bucket}/${path}`);
    if (!this.objects.has(this.key(bucket, path))) return Promise.reject(new StError('not_found', 'object not found'));
    return Promise.resolve(`https://storage.test/object/${bucket}/${assertObjectKey(path)}?expires=${expiresInS}`);
  }
  download(bucket: string, path: string, maxBytes: number): Promise<Uint8Array | null> {
    this.calls.push(`download:${bucket}/${path}`);
    const o = this.objects.get(this.key(bucket, path));
    if (o && o.bytes.byteLength > maxBytes) return Promise.reject(new StError('validation', 'object too large'));
    return Promise.resolve(o ? o.bytes : null);
  }
  upload(bucket: string, path: string, bytes: Uint8Array, contentType: string, options: { upsert?: boolean } = {}): Promise<void> {
    this.calls.push(`upload:${bucket}/${path}`);
    if (!options.upsert && this.objects.has(this.key(bucket, path))) return Promise.reject(new StError('conflict', 'object exists'));
    this.put(bucket, path, bytes, contentType);
    return Promise.resolve();
  }
  copy(from: { bucket: string; path: string }, to: { bucket: string; path: string }): Promise<void> {
    this.calls.push(`copy:${from.bucket}/${from.path}->${to.bucket}/${to.path}`);
    const o = this.objects.get(this.key(from.bucket, from.path));
    if (!o) return Promise.reject(new StError('not_found', 'object not found'));
    if (!this.objects.has(this.key(to.bucket, to.path))) this.objects.set(this.key(to.bucket, to.path), o);
    return Promise.resolve();
  }
  list(bucket: string, prefix: string, limit: number): Promise<string[]> {
    const folder = `${bucket}/${prefix.replace(/\/+$/, '')}/`;
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(folder) && !k.slice(folder.length).includes('/'));
    return Promise.resolve(keys.slice(0, limit).map((k) => k.slice(bucket.length + 1)));
  }
  remove(bucket: string, paths: readonly string[]): Promise<void> {
    for (const p of paths) {
      this.calls.push(`remove:${bucket}/${p}`);
      this.objects.delete(this.key(bucket, p));
    }
    return Promise.resolve();
  }
}

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

/** Matches images whose bytes contain a registered marker (stands in for a perceptual-hash list). */
export class FakeCsamScanner implements CsamScanner {
  readonly name = 'fake-hash';
  readonly markers = new Set<string>();
  readonly scanned: Uint8Array[] = [];
  fail = false;
  /** Match every image (simplest way to simulate a known hash). */
  matchAll = false;
  match(image: { bytes: Uint8Array }): Promise<CsamMatch> {
    this.scanned.push(image.bytes);
    if (this.fail) return Promise.reject(new Error('vendor down'));
    const h = hex(image.bytes);
    const matched = this.matchAll || [...this.markers].some((m) => h.includes(hex(new TextEncoder().encode(m))));
    return Promise.resolve({ matched, matchId: matched ? 'match-001' : null, source: this.name });
  }
}

export class FakeCsamReporter implements CsamReporter {
  readonly reports = new Map<string, CsamReportInput>();
  calls = 0;
  /** Fail the next N calls. */
  failNext = 0;
  report(input: CsamReportInput, key: string): Promise<CsamReportResult> {
    this.calls++;
    if (this.failNext > 0) {
      this.failNext--;
      return Promise.reject(new StError('unavailable', 'reporting endpoint down'));
    }
    if (!this.reports.has(key)) this.reports.set(key, input);
    return Promise.resolve({ status: 'filed', reportId: `report-${key}` });
  }
}

/** Blocks images containing a registered marker string. */
export class FakeImageModerator implements ImageModerator {
  readonly name = 'fake-vision';
  readonly rules: { marker: string; result: ImageModerationResult }[] = [];
  readonly seen: Uint8Array[] = [];
  fail = false;
  classify(image: { bytes: Uint8Array }): Promise<ImageModerationResult> {
    this.seen.push(image.bytes);
    if (this.fail) return Promise.reject(new Error('vendor down'));
    const h = hex(image.bytes);
    const rule = this.rules.find((r) => h.includes(hex(new TextEncoder().encode(r.marker))));
    return Promise.resolve(rule ? rule.result : { decision: 'allow', categories: [], minorsSignal: false });
  }
}

/** Produces a tiny stored thumbnail (so the upload path is exercised) and an on-the-fly medium variant. */
export const fakeRenditions: RenditionProvider = {
  render: ({ sanitizedPath, renditionPrefix, mimeType }): Promise<Rendition[]> =>
    Promise.resolve([
      { name: 'thumb', maxWidth: 320, path: `${renditionPrefix}/thumb.jpg`, bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), contentType: 'image/jpeg' },
      { name: 'medium', maxWidth: 1280, path: sanitizedPath, bytes: null, contentType: mimeType },
    ]),
};

export class FakeVideoProvider implements VideoProvider {
  readonly name = 'fake-stream';
  readonly assets = new Map<string, { mediaId: string; sourceUrl: string; status: VideoStatus; frames: Uint8Array[] }>();
  readonly removed: string[] = [];
  ingests = 0;
  /** Status assigned to newly ingested videos. */
  nextStatus: VideoStatus = { state: 'ready', durationSeconds: 42, playbackRef: '' };
  nextFrames: Uint8Array[] = [Uint8Array.from([1, 2, 3]), Uint8Array.from([4, 5, 6])];
  ingest(mediaId: string, sourceUrl: string): Promise<string> {
    this.ingests++;
    const ref = `stream-${mediaId}`;
    if (!this.assets.has(ref)) {
      const status = this.nextStatus.state === 'ready' ? { ...this.nextStatus, playbackRef: ref } : this.nextStatus;
      this.assets.set(ref, { mediaId, sourceUrl, status, frames: this.nextFrames });
    }
    return Promise.resolve(ref);
  }
  status(ref: string): Promise<VideoStatus> {
    const a = this.assets.get(ref);
    return a ? Promise.resolve(a.status) : Promise.reject(new Error('unknown asset'));
  }
  sampleFrames(ref: string, _duration: number, count: number): Promise<Uint8Array[]> {
    return Promise.resolve((this.assets.get(ref)?.frames ?? []).slice(0, count));
  }
  remove(ref: string): Promise<void> {
    this.removed.push(ref);
    this.assets.delete(ref);
    return Promise.resolve();
  }
}
