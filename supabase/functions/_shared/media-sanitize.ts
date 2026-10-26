/**
 * Pure-TS image metadata removal for the Media Vault pre-publication pipeline
 * (VAULT-003: "EXIF and GPS strip" before anything is published).
 *
 * Dependency-free and runtime-agnostic (Deno, Node). It rewrites the container
 * only: pixel data (JPEG entropy-coded scans, PNG IDAT, WebP VP8/VP8L) is copied
 * byte for byte, so the result decodes exactly like the original.
 *
 * - JPEG: keeps the segments a decoder needs (DQT, SOFn, DHT, DRI, SOS + scans,
 *   APP0/JFIF, APP2/ICC_PROFILE, APP14/Adobe) and drops APP1 (EXIF, XMP),
 *   APP3..APP13, APP15, COM and everything after EOI (MPF secondary images and
 *   vendor trailers, which carry their own EXIF). The EXIF Orientation is the
 *   only value kept, re-emitted as a minimal one-entry EXIF block, so photos
 *   taken in portrait still display upright.
 * - PNG: allow-list of rendering chunks; drops tEXt, zTXt, iTXt, eXIf, tIME and
 *   unknown ancillary chunks; validates every CRC; rejects unknown critical chunks.
 * - WebP: drops EXIF and XMP chunks and clears the matching VP8X flags.
 *
 * Anything malformed throws {@link MediaFormatError}: the pipeline then blocks the
 * item instead of publishing bytes it could not sanitise.
 */

export type ImageFormat = 'jpeg' | 'png' | 'webp';

export class MediaFormatError extends Error {
  override readonly name = 'MediaFormatError';
}

export interface StripResult {
  format: ImageFormat;
  bytes: Uint8Array;
  /** Names of removed segments/chunks (e.g. `APP1`, `COM`, `tEXt`, `trailer`), for audit counts. */
  removed: string[];
  /** EXIF orientation (1..8) carried over, or `null`. */
  orientation: number | null;
}

const fail = (msg: string): never => {
  throw new MediaFormatError(msg);
};

/** Detects the container from magic bytes (the declared MIME type is not trusted). */
export function sniffImage(b: Uint8Array): ImageFormat | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && PNG_SIG.every((v, i) => b[i] === v)) return 'png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  return null;
}

/** Strips metadata from a JPEG, PNG or WebP image. Throws {@link MediaFormatError}. */
export function stripImageMetadata(bytes: Uint8Array): StripResult {
  switch (sniffImage(bytes)) {
    case 'jpeg':
      return stripJpegMetadata(bytes);
    case 'png':
      return stripPngMetadata(bytes);
    case 'webp':
      return stripWebpMetadata(bytes);
    default:
      return fail('unsupported image format');
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function ascii(b: Uint8Array, at: number, len: number): string {
  let s = '';
  for (let i = at; i < at + len && i < b.length; i++) s += String.fromCharCode(b[i] as number);
  return s;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const u16be = (b: Uint8Array, i: number): number => ((b[i] as number) << 8) | (b[i + 1] as number);
const u32be = (b: Uint8Array, i: number): number => (((b[i] as number) << 24) | ((b[i + 1] as number) << 16) | ((b[i + 2] as number) << 8) | (b[i + 3] as number)) >>> 0;
const u32le = (b: Uint8Array, i: number): number => ((b[i] as number) | ((b[i + 1] as number) << 8) | ((b[i + 2] as number) << 16) | ((b[i + 3] as number) << 24)) >>> 0;

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP14 = 0xee;
const COM = 0xfe;

export interface JpegSegment {
  marker: number;
  /** Payload without marker and length bytes (empty for standalone markers). */
  payload: Uint8Array;
  /** For SOS: the entropy-coded data that follows the header (byte-stuffed, RST markers included). */
  scan?: Uint8Array;
}

/** Marker name for logs/tests (`APP1`, `SOF0`, `DHT`, …). */
export function jpegMarkerName(m: number): string {
  if (m >= 0xe0 && m <= 0xef) return `APP${m - 0xe0}`;
  if (m >= 0xd0 && m <= 0xd7) return `RST${m - 0xd0}`;
  const named: Record<number, string> = { 0xd8: 'SOI', 0xd9: 'EOI', 0xda: 'SOS', 0xdb: 'DQT', 0xc4: 'DHT', 0xdd: 'DRI', 0xfe: 'COM', 0xcc: 'DAC', 0xdc: 'DNL' };
  if (named[m]) return named[m] as string;
  if (m >= 0xc0 && m <= 0xcf) return `SOF${m - 0xc0}`;
  return `0x${m.toString(16)}`;
}

/**
 * Parses a JPEG into segments up to EOI. Returns the segments and the number of
 * bytes after EOI. Throws {@link MediaFormatError} when the structure is broken
 * (truncated segment, missing SOF/SOS/EOI, bad marker).
 */
export function parseJpeg(b: Uint8Array): { segments: JpegSegment[]; trailingBytes: number } {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== SOI) fail('not a JPEG (missing SOI)');
  const segments: JpegSegment[] = [];
  const n = b.length;
  let i = 2;
  let sawSof = false;
  let sawSos = false;
  for (;;) {
    if (i >= n) fail('truncated JPEG (no EOI)');
    if (b[i] !== 0xff) fail('expected a JPEG marker');
    while (i < n && b[i] === 0xff) i++; // fill bytes
    if (i >= n) fail('truncated JPEG marker');
    const marker = b[i] as number;
    i++;
    if (marker === 0x00) fail('stuffed byte outside a scan');
    if (marker === EOI) {
      if (!sawSof || !sawSos) fail('JPEG without frame or scan');
      return { segments, trailingBytes: n - i };
    }
    if (marker === SOI) fail('nested SOI');
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      segments.push({ marker, payload: new Uint8Array(0) });
      continue;
    }
    if (i + 2 > n) fail('truncated JPEG segment length');
    const len = u16be(b, i);
    if (len < 2 || i + len > n) fail(`bad ${jpegMarkerName(marker)} length`);
    const payload = b.subarray(i + 2, i + len);
    i += len;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) sawSof = true;
    if (marker !== SOS) {
      segments.push({ marker, payload });
      continue;
    }
    if (!sawSof) fail('SOS before SOF');
    sawSos = true;
    // Entropy-coded data: runs until a marker other than FF00 (stuffing) and RSTn.
    const start = i;
    for (;;) {
      if (i + 1 >= n) fail('truncated JPEG scan');
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < n && b[j] === 0xff) j++; // fill bytes inside a scan
      if (j >= n) fail('truncated JPEG scan');
      const next = b[j] as number;
      if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
        i = j + 1;
        continue;
      }
      break; // i points at the FF of the next marker
    }
    segments.push({ marker, payload, scan: b.subarray(start, i) });
  }
}

function isIccApp2(p: Uint8Array): boolean {
  return ascii(p, 0, 12) === 'ICC_PROFILE\0';
}

/** Reads the EXIF Orientation (0x0112) from an APP1 payload, or `null`. Never throws. */
export function exifOrientation(app1: Uint8Array): number | null {
  if (ascii(app1, 0, 6) !== 'Exif\0\0') return null;
  const t = app1.subarray(6);
  if (t.length < 8) return null;
  const order = ascii(t, 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const r16 = (o: number): number => (le ? (t[o] as number) | ((t[o + 1] as number) << 8) : u16be(t, o));
  const r32 = (o: number): number => (le ? u32le(t, o) : u32be(t, o));
  if (r16(2) !== 42) return null;
  const ifd = r32(4);
  if (ifd < 8 || ifd + 2 > t.length) return null;
  const count = r16(ifd);
  for (let k = 0; k < count && k < 512; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > t.length) return null;
    if (r16(e) === 0x0112 && r16(e + 2) === 3 && r32(e + 4) === 1) {
      const v = r16(e + 8);
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

/** A minimal big-endian EXIF APP1 payload holding only IFD0 Orientation. */
export function minimalExifOrientation(orientation: number): Uint8Array {
  const p = new Uint8Array(6 + 26);
  p.set([0x45, 0x78, 0x69, 0x66, 0, 0]); // "Exif\0\0"
  p.set([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8], 6); // "MM", 42, IFD0 at 8
  p.set([0x00, 0x01], 14); // one entry
  p.set([0x01, 0x12, 0x00, 0x03, 0, 0, 0, 1, (orientation >> 8) & 0xff, orientation & 0xff, 0, 0], 16);
  // next IFD offset = 0 (already zero)
  return p;
}

function encodeSegment(seg: JpegSegment): Uint8Array {
  if (seg.marker === 0x01 || (seg.marker >= 0xd0 && seg.marker <= 0xd7)) return new Uint8Array([0xff, seg.marker]);
  const len = seg.payload.length + 2;
  if (len > 0xffff) fail('segment too large');
  const head = new Uint8Array([0xff, seg.marker, (len >> 8) & 0xff, len & 0xff]);
  return seg.scan ? concat([head, seg.payload, seg.scan]) : concat([head, seg.payload]);
}

function keepJpegSegment(seg: JpegSegment): boolean {
  const m = seg.marker;
  if (m === COM) return false;
  if (m === APP0 || m === APP14) return true;
  if (m === APP2) return isIccApp2(seg.payload);
  if (m >= 0xe0 && m <= 0xef) return false; // APP1 (EXIF/XMP), APP3..APP13 (IPTC, Photoshop), APP15
  return true;
}

export function stripJpegMetadata(b: Uint8Array): StripResult {
  const { segments, trailingBytes } = parseJpeg(b);
  const removed: string[] = [];
  let orientation: number | null = null;
  const kept: JpegSegment[] = [];
  for (const seg of segments) {
    if (seg.marker === APP1 && orientation === null) orientation = exifOrientation(seg.payload);
    if (keepJpegSegment(seg)) kept.push(seg);
    else removed.push(jpegMarkerName(seg.marker));
  }
  if (trailingBytes > 0) removed.push('trailer');
  if (orientation !== null && orientation !== 1) {
    const at = kept[0]?.marker === APP0 ? 1 : 0;
    kept.splice(at, 0, { marker: APP1, payload: minimalExifOrientation(orientation) });
  } else {
    orientation = orientation === 1 ? 1 : null;
  }
  const out = concat([new Uint8Array([0xff, SOI]), ...kept.map(encodeSegment), new Uint8Array([0xff, EOI])]);
  return { format: 'jpeg', bytes: out, removed, orientation };
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** Chunks kept: critical ones plus ancillary chunks that only affect rendering. */
const PNG_KEEP = new Set([
  'IHDR', 'PLTE', 'IDAT', 'IEND',
  'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'cICP', 'mDCv', 'cLLI', 'bKGD', 'hIST', 'pHYs', 'sPLT',
  'acTL', 'fcTL', 'fdAT', // APNG
]);

let CRC_TABLE: Uint32Array | null = null;

/** CRC-32 (ISO-HDLC), as used by PNG. */
export function crc32(data: Uint8Array, crc = 0): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) c = ((CRC_TABLE[(c ^ (data[i] as number)) & 0xff] as number) ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}

export interface PngChunk {
  type: string;
  /** Raw chunk bytes: length + type + data + CRC. */
  raw: Uint8Array;
}

/** Parses and validates a PNG (signature, CRCs, IHDR first, IEND last). Throws {@link MediaFormatError}. */
export function parsePng(b: Uint8Array): { chunks: PngChunk[]; trailingBytes: number } {
  if (b.length < 8 || !PNG_SIG.every((v, i) => b[i] === v)) fail('not a PNG');
  const chunks: PngChunk[] = [];
  let i = 8;
  for (;;) {
    if (i + 12 > b.length) fail('truncated PNG chunk');
    const len = u32be(b, i);
    if (len > 0x7fffffff || i + 12 + len > b.length) fail('bad PNG chunk length');
    const type = ascii(b, i + 4, 4);
    if (!/^[A-Za-z]{4}$/.test(type)) fail('bad PNG chunk type');
    const crc = u32be(b, i + 8 + len);
    if (crc32(b.subarray(i + 4, i + 8 + len)) !== crc) fail(`bad CRC in ${type}`);
    if (chunks.length === 0 && type !== 'IHDR') fail('PNG must start with IHDR');
    chunks.push({ type, raw: b.subarray(i, i + 12 + len) });
    i += 12 + len;
    if (type === 'IEND') return { chunks, trailingBytes: b.length - i };
  }
}

export function stripPngMetadata(b: Uint8Array): StripResult {
  const { chunks, trailingBytes } = parsePng(b);
  const removed: string[] = [];
  const kept: Uint8Array[] = [new Uint8Array(PNG_SIG)];
  let idat = false;
  for (const c of chunks) {
    if (PNG_KEEP.has(c.type)) {
      if (c.type === 'IDAT') idat = true;
      kept.push(c.raw);
      continue;
    }
    // Uppercase first letter = critical: a decoder must understand it, so we cannot drop it safely.
    if (c.type.charCodeAt(0) < 0x61) fail(`unknown critical PNG chunk ${c.type}`);
    removed.push(c.type);
  }
  if (!idat) fail('PNG without image data');
  if (trailingBytes > 0) removed.push('trailer');
  return { format: 'png', bytes: concat(kept), removed, orientation: null };
}

// ---------------------------------------------------------------------------
// WebP
// ---------------------------------------------------------------------------

const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

export interface WebpChunk {
  fourcc: string;
  /** Chunk bytes including header and padding. */
  raw: Uint8Array;
}

/** Parses a WebP RIFF container. Throws {@link MediaFormatError}. */
export function parseWebp(b: Uint8Array): WebpChunk[] {
  if (b.length < 20 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') fail('not a WebP');
  const riffEnd = 8 + u32le(b, 4);
  if (riffEnd > b.length || riffEnd < 12) fail('bad RIFF size');
  const chunks: WebpChunk[] = [];
  let i = 12;
  while (i < riffEnd) {
    if (i + 8 > riffEnd) fail('truncated WebP chunk');
    const fourcc = ascii(b, i, 4);
    const size = u32le(b, i + 4);
    const total = 8 + size + (size & 1);
    if (i + 8 + size > riffEnd) fail('bad WebP chunk size');
    chunks.push({ fourcc, raw: b.subarray(i, Math.min(i + total, riffEnd)) });
    i += total;
  }
  if (!chunks.some((c) => c.fourcc === 'VP8 ' || c.fourcc === 'VP8L' || c.fourcc === 'ANMF')) fail('WebP without image data');
  return chunks;
}

export function stripWebpMetadata(b: Uint8Array): StripResult {
  const chunks = parseWebp(b);
  const removed: string[] = [];
  const kept: Uint8Array[] = [];
  for (const c of chunks) {
    if (!WEBP_KEEP.has(c.fourcc)) {
      removed.push(c.fourcc.trim());
      continue;
    }
    if (c.fourcc === 'VP8X' && c.raw.length >= 9) {
      const copy = c.raw.slice();
      copy[8] = (copy[8] as number) & ~(VP8X_EXIF | VP8X_XMP);
      kept.push(copy);
    } else {
      kept.push(c.raw);
    }
  }
  const body = concat(kept);
  const head = new Uint8Array(12);
  head.set([0x52, 0x49, 0x46, 0x46]); // RIFF
  const size = body.length + 4;
  head.set([size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >>> 24) & 0xff], 4);
  head.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  return { format: 'webp', bytes: concat([head, body]), removed, orientation: null };
}

/** Structural validation of any supported image (used before publishing). Throws {@link MediaFormatError}. */
export function assertWellFormedImage(b: Uint8Array): ImageFormat {
  const f = sniffImage(b);
  if (f === 'jpeg') parseJpeg(b);
  else if (f === 'png') parsePng(b);
  else if (f === 'webp') parseWebp(b);
  else fail('unsupported image format');
  return f as ImageFormat;
}

export const IMAGE_MIME: Readonly<Record<ImageFormat, string>> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
