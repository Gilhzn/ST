import fc from 'fast-check';
import type { Effect, NewSanction, Sanction } from '../src';
import { DAY_MS, HOUR_MS, deriveSanctionId, toIso } from '../src';

export const T0 = Date.parse('2026-03-01T18:00:00.000Z');
export const iso = (ms: number) => toIso(ms);
export { DAY_MS, HOUR_MS };

export const U1 = '00000000-0000-4000-8000-000000000001';
export const U2 = '00000000-0000-4000-8000-000000000002';
export const U3 = '00000000-0000-4000-8000-000000000003';
export const U4 = '00000000-0000-4000-8000-000000000004';
export const U5 = '00000000-0000-4000-8000-000000000005';
export const HOST = '00000000-0000-4000-8000-0000000000ff';
export const G1 = '00000000-0000-4000-8000-0000000000aa';
export const G2 = '00000000-0000-4000-8000-0000000000ab';

/** A full sanction row for state fixtures. */
export function sanctionRow(overrides: Partial<Sanction> & Pick<Sanction, 'dedupeKey'>): Sanction {
  const startsAt = overrides.startsAt ?? iso(T0);
  return {
    id: deriveSanctionId(overrides.dedupeKey),
    userId: U1,
    kind: 'yellow_card',
    reasonCode: 'no_show',
    statementKey: `sanctions.reason.${overrides.reasonCode ?? 'no_show'}`,
    statementParams: { appealPath: 'dispute' },
    startsAt,
    expiresAt: iso(Date.parse(startsAt) + 30 * DAY_MS),
    disputeUntil: iso(Date.parse(startsAt) + 48 * HOUR_MS),
    status: 'active',
    gameId: G1,
    causedBy: [],
    decidedBy: 'system',
    createdAt: startsAt,
    ...overrides,
  } as Sanction;
}

/** Asserts the compliance invariants on every emitted sanction; returns them. */
export function assertSanctionInvariants(effects: readonly Effect[]): NewSanction[] {
  const issued = effects.flatMap((e) => (e.type === 'IssueSanction' ? [e.sanction] : []));
  for (const s of issued) {
    if (s.decidedBy === 'system' && (s.kind as string) === 'permanent_ban') throw new Error('system issued permanent_ban');
    if (s.kind !== 'permanent_ban' && !s.expiresAt) throw new Error('missing expiresAt');
    if (s.statementKey !== `sanctions.reason.${s.reasonCode}`) throw new Error('bad statementKey');
    if (!s.dedupeKey) throw new Error('missing dedupeKey');
    const appeal = s.statementParams.appealPath;
    if (appeal !== 'dispute' && appeal !== 'appeal') throw new Error('missing appeal path');
    if (s.kind === 'yellow_card' && !s.disputeUntil) throw new Error('yellow card without dispute window');
  }
  for (const e of effects) {
    if (e.type === 'EnqueueReview' && !e.item.dedupeKey) throw new Error('review without dedupeKey');
  }
  return issued;
}

export const uuidArb = fc.uuid();
