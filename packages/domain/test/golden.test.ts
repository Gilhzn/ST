/**
 * Executes every case in test/golden/*.json against the pure functions.
 * The same files are executed against SQL by supabase/tests (see golden/README.md).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applyTrustEvent,
  canSubmitResult,
  chatExpiresAt,
  checkInWindow,
  computeReliability,
  createTrustState,
  evaluateHostReliability,
  evaluateReports,
  evaluateVenueReports,
  generateQrToken,
  isChatOpen,
  isCheckInOpen,
  processNoShows,
  promoteFromWaitlist,
  resolveTrustConfig,
  resultWindow,
  verifyPeer,
  verifyQr,
  type TrustConfig,
} from '../src';
import { assertSanctionInvariants } from './helpers';

interface GoldenCase {
  name: string;
  kind: string;
  description?: string;
  input: Record<string, never>;
  config?: Partial<TrustConfig>;
  now: string;
  expected: unknown;
  targets?: ('ts' | 'sql')[];
  tags?: string[];
}

type Runner = (input: never, config: TrustConfig, now: number) => unknown;

/* eslint-disable @typescript-eslint/no-explicit-any */
const RUNNERS: Record<string, Runner> = {
  'trust.applyEvent': (i: any, c, now) => ({
    effects: applyTrustEvent(createTrustState(i.state.userId, i.state), i.event, c, now).effects,
  }),
  'trust.processNoShows': (i: any, _c, now) => {
    const r = processNoShows(i, now);
    return { finalized: r.finalized, gameHappened: r.gameHappened, effects: r.effects, events: r.events };
  },
  'trust.evaluateReports': (i: any, c, now) => {
    const r = evaluateReports(i.reports, i.reporterProfiles, now, c, i.context ?? {});
    return { outcome: r.outcome, qualifyingReporterIds: r.qualifyingReporterIds, effects: r.effects };
  },
  'trust.venueReports': (i: any, c, now) => {
    const r = evaluateVenueReports(i.venue, now, c);
    return { hide: r.hide, effects: r.effects };
  },
  'trust.hostReliability': (i: any, c, now) => {
    const r = evaluateHostReliability(i, now, c);
    return { outcome: r.outcome, reasonCode: r.reasonCode, effects: r.effects };
  },
  'trust.reliability': (i: any, c, now) => computeReliability(i.participations, i.sanctions, now, c),
  'games.windows': (i: any, c, now) => ({
    checkInOpensAt: checkInWindow(i.game, c).opensAt,
    resultWindowClosesAt: resultWindow(i.game, c).closesAt,
    chatExpiresAt: chatExpiresAt(i.game, c),
    checkInOpen: isCheckInOpen(i.game, now, c),
    canSubmitResult: canSubmitResult(i.game, now, c),
    chatOpen: isChatOpen(i.game, now, c),
  }),
  'games.waitlist': (i: any, _c, now) => promoteFromWaitlist(i, now),
  'checkin.qrToken': (i: any, c, now) => generateQrToken(i.qrSecret, i.gameId, now, c),
  'checkin.verifyQr': (i: any, c, now) => verifyQr(i.token, i.qrSecret, i.gameId, now, c, i.window),
  'checkin.verifyPeer': (i: any, c, now) => verifyPeer(i, now, c),
};
/* eslint-enable @typescript-eslint/no-explicit-any */

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'golden');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
const all: GoldenCase[] = files.flatMap((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as GoldenCase[]);

describe('golden cases: schema', () => {
  it('has at least 60 cases and every file holds one kind', () => {
    expect(all.length).toBeGreaterThanOrEqual(60);
    for (const f of files) {
      const list = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as GoldenCase[];
      expect(new Set(list.map((c) => c.kind))).toEqual(new Set([f.replace(/\.json$/, '')]));
    }
  });
  it('cases are well formed', () => {
    const seen = new Set<string>();
    for (const c of all) {
      const allowed = new Set(['name', 'kind', 'description', 'input', 'config', 'now', 'expected', 'targets', 'tags']);
      expect(Object.keys(c).filter((k) => !allowed.has(k)), c.name).toEqual([]);
      expect(c.name).toMatch(/^[a-z0-9][a-z0-9_.-]*$/);
      expect(seen.has(`${c.kind}/${c.name}`), c.name).toBe(false);
      seen.add(`${c.kind}/${c.name}`);
      expect(new Date(Date.parse(c.now)).toISOString()).toBe(c.now);
      expect(RUNNERS[c.kind], c.kind).toBeDefined();
    }
  });
});

for (const kind of Object.keys(RUNNERS)) {
  const list = all.filter((c) => c.kind === kind && (c.targets ?? ['ts', 'sql']).includes('ts'));
  describe(`golden: ${kind}`, () => {
    it.each(list.map((c) => [c.name, c] as const))('%s', (_name, c) => {
      const out = (RUNNERS[kind] as Runner)(c.input as never, resolveTrustConfig(c.config), Date.parse(c.now));
      expect(out).toEqual(c.expected);
      const effects = (out as { effects?: unknown }).effects;
      if (Array.isArray(effects)) assertSanctionInvariants(effects);
    });
  });
}
