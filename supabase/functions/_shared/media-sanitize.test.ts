import { describe, expect, it } from 'vitest';
import { JPEG_WITH_GPS, PNG_WITH_TEXT, PROGRESSIVE_JPEG_WITH_GPS, WEBP_WITH_EXIF } from '../_test/media-fixtures';
import {
  MediaFormatError,
  assertWellFormedImage,
  crc32,
  exifOrientation,
  parseJpeg,
  parsePng,
  parseWebp,
  sniffImage,
  stripImageMetadata,
  stripJpegMetadata,
  stripPngMetadata,
} from './media-sanitize';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const cat = (...parts: (Uint8Array | number[])[]): Uint8Array => {
  const arrs = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};
const seg = (marker: number, payload: Uint8Array): Uint8Array => cat([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff], payload);
const contains = (hay: Uint8Array, needle: Uint8Array | number[] | string): boolean => Buffer.from(hay).includes(Buffer.from(typeof needle === 'string' ? enc(needle) : Uint8Array.from(needle)));

/** Little-endian EXIF: IFD0 {Make, Orientation=8, GPS pointer} → GPS IFD {LatRef 'N', Lat rationals}. */
function craftedExifLE(): Uint8Array {
  const t = new Uint8Array(120);
  const dv = new DataView(t.buffer);
  t.set(enc('II'), 0);
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, 3, true); // 3 entries
  // Make (ASCII, 4 bytes inline "Leak")
  dv.setUint16(10, 0x010f, true); dv.setUint16(12, 2, true); dv.setUint32(14, 4, true); t.set(enc('Leak'), 18);
  // Orientation SHORT 8
  dv.setUint16(22, 0x0112, true); dv.setUint16(24, 3, true); dv.setUint32(26, 1, true); dv.setUint16(30, 8, true);
  // GPS IFD pointer → 50
  dv.setUint16(34, 0x8825, true); dv.setUint16(36, 4, true); dv.setUint32(38, 1, true); dv.setUint32(42, 50, true);
  dv.setUint32(46, 0, true);
  // GPS IFD at 50: 2 entries
  dv.setUint16(50, 2, true);
  dv.setUint16(52, 1, true); dv.setUint16(54, 2, true); dv.setUint32(56, 2, true); t.set(enc('N\0'), 60);
  dv.setUint16(64, 2, true); dv.setUint16(66, 5, true); dv.setUint32(68, 3, true); dv.setUint32(72, 80, true);
  dv.setUint32(76, 0, true);
  // 3 rationals: 32/1, 5/1, 7777/1000 (a recognisable latitude)
  [32, 1, 5, 1, 7777, 1000].forEach((v, k) => dv.setUint32(80 + k * 4, v, true));
  return cat(enc('Exif\0\0'), t);
}

/** A structurally complete JPEG built byte by byte (no real pixels needed for container tests). */
function craftedJpeg(opts: { metadata?: boolean } = {}): { bytes: Uint8Array; scan: Uint8Array } {
  const meta = opts.metadata ?? true;
  const sof0 = Uint8Array.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0]); // 1×1, 1 component
  const dqt = cat([0], new Uint8Array(64).fill(1));
  const dht = cat([0x00], new Uint8Array(16).fill(0), []);
  dht[1] = 1; // one code of length 1
  const dhtFull = cat(dht, [0]);
  const sos = Uint8Array.from([1, 1, 0, 0, 63, 0]);
  // Entropy data with stuffing (FF00), a restart marker (FFD0) and fill bytes before EOI.
  const scan = Uint8Array.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0x78]);
  const bytes = cat(
    [0xff, 0xd8],
    seg(0xe0, cat(enc('JFIF\0'), [1, 1, 0, 0, 1, 0, 1, 0, 0])),
    ...(meta
      ? [
          seg(0xe1, craftedExifLE()),
          seg(0xe1, enc('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta GPSLatitude="32,5.12N"/>')),
          seg(0xe2, cat(enc('ICC_PROFILE\0'), [1, 1], enc('fake-icc'))),
          seg(0xe2, cat(enc('MPF\0'), enc('II*\0'))),
          seg(0xed, enc('Photoshop 3.0\0IPTC city=Tel Aviv')),
          seg(0xfe, enc('shot at home, 12 Herzl St')),
        ]
      : []),
    seg(0xdb, dqt),
    seg(0xc0, sof0),
    seg(0xc4, dhtFull),
    seg(0xda, sos),
    scan,
    [0xff, 0xff, 0xd9],
    // MPF secondary image / vendor trailer after EOI, with its own EXIF.
    ...(meta ? [[0xff, 0xd8], seg(0xe1, craftedExifLE()), [0xff, 0xd9]] : []),
  );
  return { bytes, scan };
}

describe('media-sanitize: JPEG', () => {
  it('real JPEG: EXIF/GPS, XMP and COM are removed, pixels and orientation are kept', () => {
    expect(contains(JPEG_WITH_GPS, 'SecretCam')).toBe(true);
    expect(contains(JPEG_WITH_GPS, 'GPSLatitude')).toBe(true);
    const r = stripImageMetadata(JPEG_WITH_GPS);
    expect(r.format).toBe('jpeg');
    expect(r.removed).toEqual(['APP1', 'APP1', 'COM']);
    expect(r.orientation).toBe(6);
    for (const leak of ['SecretCam', 'ModelX', 'GPSLatitude', 'xmpmeta', 'secret comment']) expect(contains(r.bytes, leak)).toBe(false);
    // The only APP1 left is the minimal orientation block: no GPS IFD pointer (0x8825) anywhere in it.
    const { segments } = parseJpeg(r.bytes);
    const app1 = segments.filter((s) => s.marker === 0xe1);
    expect(app1).toHaveLength(1);
    expect(app1[0]!.payload.length).toBe(32);
    expect(exifOrientation(app1[0]!.payload)).toBe(6);
    expect(contains(app1[0]!.payload, [0x88, 0x25])).toBe(false);
    // Scan data is byte-identical (decoding is unchanged; verified against Pillow when the fixture was made).
    const scanOf = (b: Uint8Array) => parseJpeg(b).segments.find((s) => s.marker === 0xda)!.scan!;
    expect(Buffer.from(scanOf(r.bytes)).equals(Buffer.from(scanOf(JPEG_WITH_GPS)))).toBe(true);
    expect(segments.map((s) => s.marker)).toEqual(parseJpeg(JPEG_WITH_GPS).segments.map((s) => s.marker).filter((m) => m !== 0xe1 && m !== 0xfe).toSpliced(1, 0, 0xe1));
  });

  it('progressive JPEG: every scan is preserved', () => {
    const before = parseJpeg(PROGRESSIVE_JPEG_WITH_GPS).segments.filter((s) => s.marker === 0xda);
    expect(before.length).toBeGreaterThan(1);
    const r = stripJpegMetadata(PROGRESSIVE_JPEG_WITH_GPS);
    const after = parseJpeg(r.bytes).segments.filter((s) => s.marker === 0xda);
    expect(after.map((s) => Buffer.from(s.scan!).toString('hex'))).toEqual(before.map((s) => Buffer.from(s.scan!).toString('hex')));
    expect(contains(r.bytes, 'SecretCam')).toBe(false);
  });

  it('crafted JPEG: little-endian GPS EXIF, XMP, MPF, IPTC, COM and the post-EOI trailer are removed', () => {
    const { bytes, scan } = craftedJpeg();
    const r = stripJpegMetadata(bytes);
    expect(r.removed).toEqual(['APP1', 'APP1', 'APP2', 'APP13', 'COM', 'trailer']);
    expect(r.orientation).toBe(8);
    for (const leak of ['Leak', 'GPSLatitude', 'Tel Aviv', 'Herzl', 'MPF']) expect(contains(r.bytes, leak)).toBe(false);
    // 7777/1000 latitude seconds rational is gone (little-endian 0x1E61).
    expect(contains(r.bytes, [0x61, 0x1e, 0, 0, 0xe8, 0x03])).toBe(false);
    // Structure: SOI, APP0, APP1(orientation), APP2(ICC), DQT, SOF0, DHT, SOS+scan, EOI, nothing after.
    const parsed = parseJpeg(r.bytes);
    expect(parsed.trailingBytes).toBe(0);
    expect(parsed.segments.map((s) => s.marker)).toEqual([0xe0, 0xe1, 0xe2, 0xdb, 0xc0, 0xc4, 0xda]);
    expect(contains(r.bytes, 'ICC_PROFILE')).toBe(true);
    const sos = parsed.segments.find((s) => s.marker === 0xda)!;
    expect(Buffer.from(sos.scan!).equals(Buffer.from(scan))).toBe(true);
    expect([...r.bytes.slice(-2)]).toEqual([0xff, 0xd9]);
  });

  it('is idempotent', () => {
    const once = stripImageMetadata(JPEG_WITH_GPS).bytes;
    const twice = stripImageMetadata(once);
    expect(Buffer.from(twice.bytes).equals(Buffer.from(once))).toBe(true);
    expect(twice.removed).toEqual(['APP1']); // the minimal orientation block is re-emitted identically
  });

  it('no EXIF → no EXIF block is added; a clean file is returned unchanged', () => {
    const { bytes } = craftedJpeg({ metadata: false });
    const r = stripJpegMetadata(bytes);
    expect(r.orientation).toBeNull();
    expect(r.removed).toEqual([]);
    expect(parseJpeg(r.bytes).segments.some((s) => s.marker === 0xe1)).toBe(false);
    // Only the fill byte before EOI is normalised away.
    expect(r.bytes.length).toBe(bytes.length - 1);
  });

  it('rejects malformed input instead of passing it through', () => {
    const { bytes } = craftedJpeg();
    expect(() => stripJpegMetadata(bytes.subarray(0, 40))).toThrow(MediaFormatError);
    expect(() => stripJpegMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toThrow(/without frame or scan/);
    const badLen = bytes.slice();
    badLen[5] = 0xff; // APP0 length beyond the file
    expect(() => stripJpegMetadata(badLen)).toThrow(MediaFormatError);
    expect(() => stripImageMetadata(enc('GIF89a....'))).toThrow(/unsupported/);
  });
});

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const head = new Uint8Array(8);
  new DataView(head.buffer).setUint32(0, data.length);
  head.set(enc(type), 4);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(cat(enc(type), data)));
  return cat(head, data, crc);
}

describe('media-sanitize: PNG', () => {
  it('real PNG: tEXt, iTXt and eXIf are removed; chunks and CRCs stay valid; pixels untouched', () => {
    const r = stripPngMetadata(PNG_WITH_TEXT);
    expect(r.removed).toEqual(['tEXt', 'iTXt', 'eXIf']);
    for (const leak of ['secret png text', 'GPS 32.0853', 'SecretCam']) expect(contains(r.bytes, leak)).toBe(false);
    const after = parsePng(r.bytes);
    expect(after.chunks.map((c) => c.type)).toEqual(parsePng(PNG_WITH_TEXT).chunks.map((c) => c.type).filter((t) => !['tEXt', 'iTXt', 'eXIf'].includes(t)));
    const idat = (b: Uint8Array) => parsePng(b).chunks.filter((c) => c.type === 'IDAT').map((c) => Buffer.from(c.raw).toString('hex'));
    expect(idat(r.bytes)).toEqual(idat(PNG_WITH_TEXT));
  });

  it('crafted PNG: zTXt, tIME, private ancillary chunks and trailing data are removed', () => {
    const sig = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = pngChunk('IHDR', Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]));
    const bytes = cat(
      sig, ihdr,
      pngChunk('tIME', Uint8Array.from([7, 234, 10, 26, 12, 0, 0])),
      pngChunk('zTXt', cat(enc('Author\0\0'), [0x78, 0x9c])),
      pngChunk('prVt', enc('device-serial-123')),
      pngChunk('pHYs', new Uint8Array(9)),
      pngChunk('IDAT', Uint8Array.from([0x78, 0x9c, 0x63, 0x60, 0, 0, 0, 2, 0, 1])),
      pngChunk('IEND', new Uint8Array(0)),
      enc('trailing-gps=32.08,34.78'),
    );
    const r = stripPngMetadata(bytes);
    expect(r.removed).toEqual(['tIME', 'zTXt', 'prVt', 'trailer']);
    expect(parsePng(r.bytes).chunks.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
    expect(contains(r.bytes, 'device-serial')).toBe(false);
    expect(contains(r.bytes, 'trailing-gps')).toBe(false);
  });

  it('rejects bad CRCs, unknown critical chunks and missing IHDR', () => {
    const r = PNG_WITH_TEXT.slice();
    r[30] = (r[30] as number) ^ 0xff; // inside IHDR
    expect(() => stripPngMetadata(r)).toThrow(/CRC/);
    const sig = PNG_WITH_TEXT.subarray(0, 8);
    const ihdr = pngChunk('IHDR', Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]));
    expect(() => stripPngMetadata(cat(sig, ihdr, pngChunk('ABCD', new Uint8Array(1)), pngChunk('IEND', new Uint8Array(0))))).toThrow(/critical/);
    expect(() => stripPngMetadata(cat(sig, pngChunk('IEND', new Uint8Array(0))))).toThrow(/IHDR/);
  });
});

describe('media-sanitize: WebP', () => {
  it('drops EXIF/XMP chunks, clears VP8X flags and rewrites the RIFF size', () => {
    expect(parseWebp(WEBP_WITH_EXIF).map((c) => c.fourcc)).toContain('EXIF');
    const r = stripImageMetadata(WEBP_WITH_EXIF);
    expect(r.removed).toEqual(['EXIF']);
    expect(contains(r.bytes, 'SecretCam')).toBe(false);
    const chunks = parseWebp(r.bytes);
    expect(chunks.map((c) => c.fourcc)).not.toContain('EXIF');
    const vp8x = chunks.find((c) => c.fourcc === 'VP8X');
    if (vp8x) expect((vp8x.raw[8] as number) & 0x0c).toBe(0);
    expect(new DataView(r.bytes.buffer, r.bytes.byteOffset).getUint32(4, true)).toBe(r.bytes.length - 8);
  });
});

describe('media-sanitize: sniffing', () => {
  it('trusts magic bytes, not names', () => {
    expect(sniffImage(JPEG_WITH_GPS)).toBe('jpeg');
    expect(sniffImage(PNG_WITH_TEXT)).toBe('png');
    expect(sniffImage(WEBP_WITH_EXIF)).toBe('webp');
    expect(sniffImage(enc('<svg onload=alert(1)>'))).toBeNull();
    expect(assertWellFormedImage(stripImageMetadata(JPEG_WITH_GPS).bytes)).toBe('jpeg');
  });
});
