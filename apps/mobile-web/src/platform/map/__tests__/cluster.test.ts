import { describe, expect, it } from 'vitest';

import { buildClusterIndex } from '../cluster';
import type { MapPoint } from '../Map.types';

const SPORTS = ['football', 'basketball', 'tennis', 'padel', 'running', 'volleyball'] as const;

function points(n: number): MapPoint[] {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, (_, i) => ({
    id: `g-${i}`,
    kind: 'game' as const,
    sport: SPORTS[i % SPORTS.length]!,
    location: { lat: 32.0779 + (rnd() - 0.5) * 0.2, lng: 34.7745 + (rnd() - 0.5) * 0.2 },
    state: 'default' as const,
    label: `game ${i}`,
  }));
}

describe('cluster index (web/native marker budget)', () => {
  it('keeps 2,000 games in a city to a small number of mounted markers at city zooms', () => {
    const index = buildClusterIndex(points(2000));
    // Every game is accounted for, clustered or not.
    const all = index.query([-180, -85, 180, 85], 10);
    expect(all.reduce((n, it) => n + (it.type === 'cluster' ? it.count : 1), 0)).toBe(2000);
    // What the web map mounts: a phone viewport (412×850 px) padded by half a screen each side.
    for (const z of [10, 11, 12, 13, 14]) {
      const degPerPx = 360 / (512 * 2 ** z);
      const halfW = 412 * degPerPx;
      const halfH = 850 * degPerPx * Math.cos((32.08 * Math.PI) / 180);
      const items = index.query([34.7745 - halfW, 32.0779 - halfH, 34.7745 + halfW, 32.0779 + halfH], z);
      expect(items.length, `zoom ${z}`).toBeLessThan(250);
    }
  });

  it('clusters carry at most three distinct sports and an expansion zoom', () => {
    const index = buildClusterIndex(points(500));
    const clusters = index.query([34.6, 31.9, 34.9, 32.3], 11).filter((i) => i.type === 'cluster');
    expect(clusters.length).toBeGreaterThan(0);
    for (const c of clusters) {
      if (c.type !== 'cluster') continue;
      expect(c.sports.length).toBeLessThanOrEqual(3);
      expect(new Set(c.sports).size).toBe(c.sports.length);
      expect(c.expansionZoom).toBeGreaterThan(11);
    }
  });
});
