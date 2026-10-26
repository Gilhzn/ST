/**
 * Web media picker for the Media Vault: a hidden `<input type="file">` (photos and short videos).
 * Reads the file as a data URL for the preview (the InMemory adapter keeps it as the published
 * image) and keeps the `File` for the signed direct upload. Videos report their duration from
 * the browser's metadata so the 60 s limit is checked before uploading.
 */
import type { PickResult } from './pick.types';

export type { PickResult };

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}

function videoDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => resolve(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => resolve(null);
    v.src = url;
  });
}

export function pickMedia(): Promise<PickResult> {
  if (typeof document === 'undefined') return Promise.resolve({ status: 'unavailable' });
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm';
    input.setAttribute('data-testid', 'gallery.file');
    input.style.display = 'none';
    let settled = false;
    const done = (r: PickResult) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(r);
    };
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return done({ status: 'cancelled' });
      const uri = await readAsDataUrl(file).catch(() => '');
      const kind = file.type.startsWith('video/') ? 'video' : 'photo';
      const durationSeconds = kind === 'video' ? await videoDuration(uri) : null;
      done({ status: 'picked', file: { uri, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size, kind, durationSeconds, blob: file } });
    });
    input.addEventListener('cancel', () => done({ status: 'cancelled' }));
    document.body.appendChild(input);
    input.click();
  });
}
