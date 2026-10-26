/**
 * Executes every case in test/golden/*.json against the pure functions.
 * The same files are executed against SQL by supabase/tests (see golden/README.md).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applyHostGameCancellation,
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
  resolveDomainConfig,
  resultWindow,
  verifyPeer,
  verifyQr,
  aggregatePeerRatings,
  applyMediaVerdict,
  checkMediaUpload,
  checkOccurrenceJoinWindow,
  derivePlayedWith,
  filterFriendsUpcomingGames,
  friendTransition,
  gameRatingEligibility,
  glicko2Update,
  peerRatingEligibility,
  planSeriesOccurrences,
  processAutoJoins,
  processRatingPeriod,
  requestMediaVisibility,
  summarizeResultConfirmations,
  type DomainConfig,
} from '../src';
import { assertSanctionInvariants } from './helpers';

interface GoldenCase {
  name: string;
  kind: string;
  description?: string;
  input: Record<string, never>;
  config?: Partial<DomainConfig>;
  now: string;
  expected: unknown;
  targets?: ('ts' | 'sql')[];
  tags?: string[];
}

type Runner = (input: never, config: DomainConfig, now: number) => unknown;

/** Floats in Glicko outputs are compared at 6 decimals on both sides (README). */
const round6deep = (v: unknown): unknown =>
  typeof v === 'number'
    ? Number.isInteger(v) ? v : Math.round(v * 1e6) / 1e6
    : Array.isArray(v)
      ? v.map(round6deep)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round6deep(x)]))
        : v;

/* eslint-disable @typescript-eslint/no-explicit-any */
const RUNNERS: Record<string, Runner> = {
  'trust.applyEvent': (i: any, c, now) => ({
    effects: applyTrustEvent(createTrustState(i.state.userId, i.state), i.event, c, now).effects,
  }),
  'trust.processNoShows': (i: any, c, now) => {
    const r = processNoShows(i, now, c);
    return { finalized: r.finalized, gameHappened: r.gameHappened, effects: r.effects, events: r.events };
  },
  'trust.evaluateReports': (i: any, c, now) => {
    const r = evaluateReports(i.reports, i.reporterProfiles, now, c, i.context ?? {});
    return { outcome: r.outcome, qualifyingReporterIds: r.qualifyingReporterIds, effects: r.effects };
  },
  'trust.venueReports': (i: any, c, now) => {
    const r = evaluateVenueReports(i.venue, i.reporterProfiles, now, c);
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
  'games.waitlist': (i: any, c, now) => promoteFromWaitlist(i, now, c),
  'checkin.qrToken': (i: any, c, now) => generateQrToken(i.qrSecret, i.gameId, now, c),
  'checkin.verifyQr': (i: any, c, now) => verifyQr(i.token, i.qrSecret, i.gameId, now, c, i.window, i.scanner),
  'trust.hostGameCancelled': (i: any, c, now) => ({
    effects: applyHostGameCancellation(createTrustState(i.state.userId, i.state), { game: i.game, cancelledAt: i.cancelledAt }, c, now).effects,
  }),
  'checkin.verifyPeer': (i: any, c, now) => verifyPeer(i, now, c),
  // Phase 1.5 (contract v3)
  'series.occurrences': (i: any, c, now) => planSeriesOccurrences(i, c, now),
  'series.autoJoins': (i: any, c, now) => processAutoJoins(i, c, now),
  'series.joinWindow': (i: any, _c, now) => checkOccurrenceJoinWindow(i.series, i.occurrence, i.roster, i.userId, now),
  'rating.glicko2': (i: any) => round6deep(glicko2Update(i.player, i.results, i.tau, i.maxRd ?? Infinity)),
  'rating.glickoPeriod': (i: any, c, now) => round6deep(processRatingPeriod(i, c, now)),
  'rating.gameEligibility': (i: any, c) => gameRatingEligibility(i, c),
  'rating.resultConfirmation': (i: any) => summarizeResultConfirmations(i, i.viewerId),
  'rating.peerEligibility': (i: any, c, now) => peerRatingEligibility(i, c, now),
  'rating.peerAggregate': (i: any, c) => aggregatePeerRatings(i, c),
  'vault.upload': (i: any, c, now) => checkMediaUpload(i, c, now),
  'vault.visibility': (i: any, _c, now) => requestMediaVisibility(i.item, i.tags, i.requested, i.actorId, now),
  'vault.verdict': (i: any, _c, now) => {
    const r = applyMediaVerdict(i.item, i.tags, i.verdict, now);
    return { item: r.item, effects: r.effects };
  },
  'network.playedWith': (i: any, c, now) => derivePlayedWith(i.attendance, i.blocks, c, now),
  'network.friend': (i: any, _c, now) => friendTransition(i.connection, i.actor, i.other, i.action, i.blocks, now),
  'network.friendsGames': (i: any, _c, now) => filterFriendsUpcomingGames(i.viewerId, i.candidates, i.connections, i.privacy, i.blocks, now),
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
      const out = (RUNNERS[kind] as Runner)(c.input as never, resolveDomainConfig(c.config), Date.parse(c.now));
      expect(out).toEqual(c.expected);
      const effects = (out as { effects?: unknown }).effects;
      if (Array.isArray(effects)) assertSanctionInvariants(effects);
    });
  });
}
