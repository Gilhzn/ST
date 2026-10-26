import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  approximateLocation,
  bboxAround,
  bboxContains,
  centroid,
  haversineMeters,
  isValidLatLng,
  isWithinRadius,
  maxPairwiseDistanceMeters,
  normalizeLng,
  offsetMeters,
  speedKmh,
  type LatLng,
} from '../src';

const latLng = (maxLat = 85): fc.Arbitrary<LatLng> =>
  fc.record({
    lat: fc.double({ min: -maxLat, max: maxLat, noNaN: true }),
    lng: fc.double({ min: -180, max: 180, noNaN: true }),
  });

describe('haversineMeters', () => {
  it('known distances', () => {
    const london = { lat: 51.5074, lng: -0.1278 };
    const paris = { lat: 48.8566, lng: 2.3522 };
    expect(haversineMeters(london, paris) / 1000).toBeCloseTo(343.56, 0);
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111_195, -1);
    expect(haversineMeters({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 })).toBeCloseTo(22_239, -1);
    expect(haversineMeters(london, london)).toBe(0);
  });
  it('is symmetric, non-negative and satisfies the triangle inequality', () => {
    fc.assert(
      fc.property(latLng(90), latLng(90), latLng(90), (a, b, c) => {
        const ab = haversineMeters(a, b);
        expect(ab).toBeGreaterThanOrEqual(0);
        expect(Math.abs(ab - haversineMeters(b, a))).toBeLessThan(1e-6);
        // Haversine loses ~0.1 m of precision near antipodal points (asin close to 1), hence the 1 m slack.
        expect(ab).toBeLessThanOrEqual(haversineMeters(a, c) + haversineMeters(c, b) + 1);
        expect(ab).toBeLessThanOrEqual(Math.PI * 6_371_008.8 + 1);
      }),
    );
  });
  it('isWithinRadius is inclusive', () => {
    const a = { lat: 32.08, lng: 34.78 };
    const b = offsetMeters(a, 100, 0);
    const d = haversineMeters(a, b);
    expect(isWithinRadius(a, b, d)).toBe(true);
    expect(isWithinRadius(a, b, d - 0.01)).toBe(false);
  });
});

describe('offsetMeters', () => {
  it('moves by roughly the requested distance', () => {
    fc.assert(
      fc.property(latLng(80), fc.double({ min: -2000, max: 2000, noNaN: true }), fc.double({ min: -2000, max: 2000, noNaN: true }), (p, n, e) => {
        const q = offsetMeters(p, n, e);
        expect(Math.abs(haversineMeters(p, q) - Math.hypot(n, e))).toBeLessThan(Math.max(0.5, Math.hypot(n, e) * 0.005));
      }),
    );
  });
});

describe('bboxAround', () => {
  it('contains every point within the radius', () => {
    fc.assert(
      fc.property(
        latLng(80),
        fc.constantFrom(1, 2, 5, 10, 30, 50),
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        (c, km, f, theta) => {
          const box = bboxAround(c, km);
          const r = km * 1000 * f;
          const p = offsetMeters(c, r * Math.cos(theta), r * Math.sin(theta));
          expect(bboxContains(box, p)).toBe(true);
        },
      ),
    );
  });
  it('handles the antimeridian and the poles', () => {
    const box = bboxAround({ lat: 0, lng: 179.99 }, 10);
    expect(box.west).toBeGreaterThan(box.east);
    expect(bboxContains(box, { lat: 0, lng: -179.99 })).toBe(true);
    expect(bboxContains(box, { lat: 0, lng: 0 })).toBe(false);
    expect(bboxContains(box, { lat: 5, lng: 179.99 })).toBe(false);
    const polar = bboxAround({ lat: 89.99, lng: 10 }, 5);
    expect(polar).toMatchObject({ west: -180, east: 180, north: 90 });
    const south = bboxAround({ lat: -89.99, lng: 10 }, 5);
    expect(south.south).toBe(-90);
    expect(bboxAround({ lat: 89.6, lng: 0 }, 50).west).toBe(-180);
    expect(bboxAround({ lat: 89.5, lng: 0 }, 50).west).toBeCloseTo(-64.07, 1);
    expect(() => bboxAround({ lat: 0, lng: 0 }, -1)).toThrow(RangeError);
    const plain = bboxAround({ lat: 32, lng: 34 }, 1);
    expect(plain.west).toBeLessThan(plain.east);
    expect(bboxContains(plain, { lat: 32, lng: 35 })).toBe(false);
  });
});

describe('speedKmh', () => {
  it('computes direction-agnostic speed with optional slack', () => {
    const a = { lat: 0, lng: 0, timestamp: 0 };
    const b = { ...offsetMeters(a, 1000, 0), timestamp: 3_600_000 };
    expect(speedKmh(a, b)).toBeCloseTo(1, 2);
    expect(speedKmh(b, a)).toBeCloseTo(1, 2);
    expect(speedKmh(a, b, 2000)).toBe(0);
    expect(speedKmh(a, { ...a })).toBe(0);
    expect(speedKmh(a, { ...b, timestamp: 0 })).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('misc helpers', () => {
  it('normalizeLng wraps into [-180, 180)', () => {
    expect(normalizeLng(190)).toBe(-170);
    expect(normalizeLng(-190)).toBe(170);
    expect(normalizeLng(180)).toBe(-180);
    expect(normalizeLng(34.5)).toBe(34.5);
  });
  it('isValidLatLng', () => {
    expect(isValidLatLng({ lat: 0, lng: 0 })).toBe(true);
    expect(isValidLatLng({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: 0, lng: Number.NaN })).toBe(false);
  });
  it('maxPairwiseDistanceMeters and centroid', () => {
    const a = { lat: 10, lng: 179.9 };
    const b = { lat: 10, lng: -179.9 };
    expect(maxPairwiseDistanceMeters([a])).toBe(0);
    expect(maxPairwiseDistanceMeters([a, b, a])).toBeCloseTo(haversineMeters(a, b), 6);
    const c = centroid([a, b]);
    expect(c).not.toBeNull();
    expect(Math.abs(Math.abs(c!.lng) - 180)).toBeLessThan(1e-6);
    expect(centroid([])).toBeNull();
  });
  it('approximateLocation snaps to a ~500 m grid deterministically', () => {
    fc.assert(
      fc.property(latLng(80), (p) => {
        const q = approximateLocation(p);
        expect(haversineMeters(p, q)).toBeLessThan(500);
        expect(approximateLocation(q)).toEqual(approximateLocation(q));
      }),
    );
    const p = { lat: 32.0853, lng: 34.7818 };
    expect(approximateLocation(offsetMeters(p, 20, 20))).toEqual(approximateLocation(p));
  });
});
