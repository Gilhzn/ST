/**
 * Generates `test/golden/*.json` (TS ≡ SQL parity cases).
 *
 * Expectations are written here from the spec (docs/plan.md, PRD v5 module 1),
 * independently of `src/` (only `node:crypto` is used, for derived ids and QR MACs),
 * so a regression in `src/` cannot silently rewrite its own expectations.
 * Run: `node --experimental-strip-types packages/domain/scripts/build-golden.ts`
 */
import { createHash, createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
interface GoldenCase {
  name: string;
  kind: string;
  description?: string;
  input: Json;
  config?: Record<string, number>;
  now: string;
  expected: Json;
  targets?: ('ts' | 'sql')[];
  tags?: string[];
}

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'golden');
const H = 3_600_000;
const D = 24 * H;
const T = Date.parse('2026-03-01T18:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const U = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const SUBJECT = U(1);
const HOST = U(0xff);
const G = (n: number) => `00000000-0000-4000-8000-0000000a${n.toString(16).padStart(4, '0')}`;
const VENUE = '00000000-0000-4000-8000-00000000beef';

function stableUuid(key: string): string {
  const b = createHash('sha256').update(key, 'utf8').digest().subarray(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x80;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const x = b.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
const sid = (dedupeKey: string) => stableUuid(`sanction:${dedupeKey}`);
const rid = (dedupeKey: string) => stableUuid(`review:${dedupeKey}`);

// ---------------------------------------------------------------- builders (spec as data)

type Params = Record<string, string | number>;
type NewSanctionJ = Record<string, Json>;

function sanction(o: {
  kind: string;
  userId: string;
  reasonCode: string;
  params: Params;
  now: number;
  durationMs: number | null;
  disputeMs?: number;
  gameId?: string | null;
  causedBy?: string[];
  dedupeKey: string;
  decidedBy?: 'system' | 'moderator';
}): NewSanctionJ {
  const disputeUntil = o.disputeMs ? iso(o.now + o.disputeMs) : null;
  return {
    kind: o.kind,
    userId: o.userId,
    reasonCode: o.reasonCode,
    statementKey: `sanctions.reason.${o.reasonCode}`,
    statementParams: { ...o.params, appealPath: disputeUntil ? 'dispute' : 'appeal' },
    startsAt: iso(o.now),
    expiresAt: o.durationMs === null ? null : iso(o.now + o.durationMs),
    disputeUntil,
    gameId: o.gameId ?? null,
    causedBy: o.causedBy ?? [],
    dedupeKey: o.dedupeKey,
    decidedBy: o.decidedBy ?? 'system',
  };
}

const NOTIFY_KIND: Record<string, string> = { visibility_restriction: 'visibility_restricted', chat_mute: 'chat_muted' };
const PROJECTION: Record<string, string> = {
  join_ban: 'BanJoins',
  chat_mute: 'MuteChat',
  visibility_restriction: 'RestrictVisibility',
  host_suspension: 'SuspendHost',
};

function issue(s: NewSanctionJ): Json[] {
  const f = (k: string): Json => s[k] as Json;
  const out: Json[] = [{ type: 'IssueSanction', sanction: s }];
  const proj = PROJECTION[f('kind') as string];
  if (f('kind') === 'permanent_ban') out.push({ type: 'BanAccount', userId: f('userId') });
  else if (proj) out.push({ type: proj, userId: f('userId'), until: f('expiresAt') });
  out.push({
    type: 'Notify',
    userId: f('userId'),
    kind: NOTIFY_KIND[f('kind') as string] ?? 'sanction_issued',
    params: {
      sanctionKind: f('kind'),
      reasonCode: f('reasonCode'),
      statementKey: f('statementKey'),
      expiresAt: f('expiresAt') ?? '',
      disputeUntil: f('disputeUntil') ?? '',
      appealPath: f('disputeUntil') ? 'dispute' : 'appeal',
    },
    gameId: f('gameId'),
    sanctionDedupeKey: f('dedupeKey'),
  });
  return out;
}

const SLA: Record<string, number> = { high: 24, normal: 48, low: 72 };
function review(o: {
  kind: string;
  priority: 'high' | 'normal' | 'low';
  dedupeKey: string;
  now: number;
  subjectUserId?: string | null;
  venueId?: string | null;
  gameId?: string | null;
  sanctionId?: string | null;
  appealId?: string | null;
  reportIds?: string[];
  evidence?: Record<string, Json>;
  dueBy?: string;
}): Json {
  return {
    type: 'EnqueueReview',
    item: {
      kind: o.kind,
      priority: o.priority,
      subjectUserId: o.subjectUserId ?? null,
      venueId: o.venueId ?? null,
      gameId: o.gameId ?? null,
      sanctionId: o.sanctionId ?? null,
      appealId: o.appealId ?? null,
      reportIds: o.reportIds ?? [],
      evidence: o.evidence ?? {},
      dueBy: o.dueBy ?? iso(o.now + SLA[o.priority]! * H),
      dedupeKey: o.dedupeKey,
    },
  };
}

/** A stored yellow-card row for state fixtures. */
function cardRow(o: { n: number; issuedAt: number; status?: string; reasonCode?: string; userId?: string }): Json {
  const reasonCode = o.reasonCode ?? 'no_show';
  const userId = o.userId ?? SUBJECT;
  const dedupeKey = `${reasonCode}:${G(o.n)}:${userId}`;
  return {
    id: sid(dedupeKey),
    userId,
    kind: 'yellow_card',
    reasonCode,
    statementKey: `sanctions.reason.${reasonCode}`,
    statementParams: { disputeHours: 48, appealPath: 'dispute' },
    startsAt: iso(o.issuedAt),
    expiresAt: iso(o.issuedAt + 30 * D),
    disputeUntil: iso(o.issuedAt + 48 * H),
    status: o.status ?? 'active',
    gameId: G(o.n),
    causedBy: [],
    dedupeKey,
    decidedBy: 'system',
    createdAt: iso(o.issuedAt),
  };
}
const cardId = (n: number, reasonCode = 'no_show', userId = SUBJECT) => sid(`${reasonCode}:${G(n)}:${userId}`);
const settled = (ns: number[]) => ns.map((n) => ({ gameId: G(n), outcome: 'forfeit' }));

function yellow(reasonCode: string, gameId: string, now: number, params: Params): NewSanctionJ {
  return sanction({
    kind: 'yellow_card',
    userId: SUBJECT,
    reasonCode,
    params: { ...params, disputeHours: 48 },
    now,
    durationMs: 30 * D,
    disputeMs: 48 * H,
    gameId,
    dedupeKey: `${reasonCode}:${gameId}:${SUBJECT}`,
  });
}

const cases: Record<string, GoldenCase[]> = {};
function add(c: GoldenCase): void {
  (cases[c.kind] ??= []).push(c);
}

// ---------------------------------------------------------------- trust.applyEvent: late cancel

{
  const kind = 'trust.applyEvent';
  const startsAt = iso(T);
  const now = T + 4 * H;
  const lcf = (cancelledAt: number, refilled: boolean) => ({
    type: 'LateCancelFinalized',
    gameId: G(1),
    userId: SUBJECT,
    startsAt,
    cancelledAt: iso(cancelledAt),
    refilled,
  });
  add({
    name: 'late-cancel.90min-before.not-refilled.issues-yellow',
    kind,
    description: 'TRUST-020(b): cancel 90 min before start, spot not refilled → disputable yellow card at finalisation',
    input: { state: { userId: SUBJECT }, event: lcf(T - 90 * 60_000, false) },
    now: iso(now),
    expected: { effects: issue(yellow('late_cancel', G(1), now, { windowHours: 2, minutesBeforeStart: 90 })) },
    tags: ['prd-v5:TRUST-020'],
  });
  add({
    name: 'late-cancel.exactly-2h-before.no-card',
    kind,
    input: { state: { userId: SUBJECT }, event: lcf(T - 2 * H, false) },
    now: iso(now),
    expected: { effects: [] },
    tags: ['boundary'],
  });
  add({
    name: 'late-cancel.2h-minus-1ms.issues-yellow',
    kind,
    input: { state: { userId: SUBJECT }, event: lcf(T - 2 * H + 1, false) },
    now: iso(now),
    expected: { effects: issue(yellow('late_cancel', G(1), now, { windowHours: 2, minutesBeforeStart: 120 })) },
    tags: ['boundary'],
  });
  add({
    name: 'late-cancel.after-start.issues-yellow',
    kind,
    input: { state: { userId: SUBJECT }, event: lcf(T + 10 * 60_000, false) },
    now: iso(now),
    expected: { effects: issue(yellow('late_cancel', G(1), now, { windowHours: 2, minutesBeforeStart: -10 })) },
    tags: ['boundary'],
  });
  add({
    name: 'late-cancel.refilled-and-replacement-checked-in.no-card',
    kind,
    description: 'TRUST-021: the spot was refilled from the waitlist before the start → no card, deposit released',
    input: { state: { userId: SUBJECT }, event: lcf(T - 90 * 60_000, true) },
    now: iso(now),
    expected: {
      effects: [
        { type: 'SettleDeposit', gameId: G(1), userId: SUBJECT, outcome: 'release' },
        { type: 'Audit', action: 'late_cancel.refilled', subjectUserId: SUBJECT, data: { gameId: G(1) } },
      ],
    },
    tags: ['prd-v5:TRUST-021'],
  });
  add({
    name: 'late-cancel.config-6h-window.3h-before.issues-yellow',
    kind,
    input: { state: { userId: SUBJECT }, event: lcf(T - 3 * H, false) },
    config: { lateCancelWindowHours: 6 },
    now: iso(now),
    expected: { effects: issue(yellow('late_cancel', G(1), now, { windowHours: 6, minutesBeforeStart: 180 })) },
    tags: ['config'],
  });
  add({
    name: 'late-cancel.already-issued.idempotent',
    kind,
    input: {
      state: { userId: SUBJECT, sanctions: [cardRow({ n: 1, issuedAt: now, reasonCode: 'late_cancel' })] },
      event: lcf(T - 90 * 60_000, false),
    },
    now: iso(now),
    expected: { effects: [] },
    tags: ['idempotency'],
  });
  const pc = (cancelledAt: number) => ({ type: 'ParticipationCancelled', gameId: G(1), userId: SUBJECT, startsAt, cancelledAt: iso(cancelledAt) });
  add({
    name: 'participation-cancelled.timely.releases-deposit',
    kind,
    input: { state: { userId: SUBJECT }, event: pc(T - 2 * H) },
    now: iso(T - 2 * H),
    expected: { effects: [{ type: 'SettleDeposit', gameId: G(1), userId: SUBJECT, outcome: 'release' }] },
    tags: ['boundary'],
  });
  add({
    name: 'participation-cancelled.late.decided-at-finalisation',
    kind,
    description: 'TRUST-021: no card at cancel time; LateCancelFinalized decides',
    input: { state: { userId: SUBJECT }, event: pc(T - H) },
    now: iso(T - H),
    expected: { effects: [] },
  });
}

// ---------------------------------------------------------------- trust.applyEvent: no-show, deposits

{
  const kind = 'trust.applyEvent';
  const now = T + 4 * H;
  add({
    name: 'no-show.issues-yellow-with-48h-dispute-window',
    kind,
    input: { state: { userId: SUBJECT }, event: { type: 'AttendanceFinalized', gameId: G(1), userId: SUBJECT, attendance: 'no_show_unverified', endsAt: iso(T + 2 * H) } },
    now: iso(now),
    expected: { effects: issue(yellow('no_show', G(1), now, {})) },
    tags: ['prd-v5:TRUST-020'],
  });
  add({
    name: 'attendance.verified.releases-deposit',
    kind,
    input: { state: { userId: SUBJECT }, event: { type: 'AttendanceFinalized', gameId: G(1), userId: SUBJECT, attendance: 'verified', endsAt: iso(T + 2 * H) } },
    now: iso(now),
    expected: { effects: [{ type: 'SettleDeposit', gameId: G(1), userId: SUBJECT, outcome: 'release' }] },
  });
  const issuedAt = T;
  const tick = (at: number) => ({ type: 'Tick', at: iso(at) });
  add({
    name: 'deposit.no-capture-inside-dispute-window',
    kind,
    input: { state: { userId: SUBJECT, sanctions: [cardRow({ n: 1, issuedAt })] }, event: tick(issuedAt + 48 * H) },
    now: iso(issuedAt + 48 * H),
    expected: { effects: [] },
    tags: ['boundary', 'prd-v5:TRUST-061'],
  });
  add({
    name: 'deposit.capture-after-dispute-window',
    kind,
    input: { state: { userId: SUBJECT, sanctions: [cardRow({ n: 1, issuedAt })] }, event: tick(issuedAt + 48 * H + 1) },
    now: iso(issuedAt + 48 * H + 1),
    expected: { effects: [{ type: 'SettleDeposit', gameId: G(1), userId: SUBJECT, outcome: 'forfeit' }] },
    tags: ['boundary', 'prd-v5:TRUST-061'],
  });
  add({
    name: 'deposit.no-capture-while-disputed',
    kind,
    input: { state: { userId: SUBJECT, sanctions: [cardRow({ n: 1, issuedAt, status: 'disputed' })] }, event: tick(issuedAt + 72 * H) },
    now: iso(issuedAt + 72 * H),
    expected: { effects: [] },
    tags: ['prd-v5:TRUST-061'],
  });
  add({
    name: 'deposit.late-cancel-card.capture-after-window',
    kind,
    input: { state: { userId: SUBJECT, sanctions: [cardRow({ n: 1, issuedAt, reasonCode: 'late_cancel' })] }, event: tick(issuedAt + 49 * H) },
    now: iso(issuedAt + 49 * H),
    expected: { effects: [{ type: 'SettleDeposit', gameId: G(1), userId: SUBJECT, outcome: 'forfeit' }] },
  });
  add({
    name: 'expire.tick.marks-expired',
    kind,
    input: { state: { userId: SUBJECT, sanctions: [cardRow({ n: 1, issuedAt: T - 30 * D })], depositSettlements: settled([1]) }, event: tick(T) },
    now: iso(T),
    expected: { effects: [{ type: 'SetSanctionStatus', sanctionId: cardId(1), status: 'expired' }] },
    tags: ['boundary'],
  });
}

// ---------------------------------------------------------------- trust.applyEvent: escalation

{
  const kind = 'trust.applyEvent';
  const tick = { type: 'Tick', at: iso(T) };
  const st = (cards: { n: number; daysAgo: number; status?: string }[], extra: Record<string, Json> = {}) => ({
    userId: SUBJECT,
    sanctions: cards.map((c) => cardRow({ n: c.n, issuedAt: T - c.daysAgo * D, status: c.status })),
    depositSettlements: settled(cards.map((c) => c.n)),
    ...extra,
  });
  const ban = (n: number, ids: string[], triggerN: number) => {
    const long = n >= 3;
    const reasonCode = long ? 'escalation_three_cards' : 'escalation_two_cards';
    const days = long ? 30 : 7;
    return sanction({
      kind: 'join_ban',
      userId: SUBJECT,
      reasonCode,
      params: { cards: n, days },
      now: T,
      durationMs: days * D,
      gameId: G(triggerN),
      causedBy: ids,
      dedupeKey: `${reasonCode}:${SUBJECT}:${cardId(triggerN)}`,
    });
  };
  add({
    name: 'escalation.2-cards.join-ban-7d',
    kind,
    input: { state: st([{ n: 1, daysAgo: 10 }, { n: 2, daysAgo: 3 }]), event: tick },
    now: iso(T),
    expected: { effects: issue(ban(2, [cardId(1), cardId(2)], 2)) },
    tags: ['prd-v5:TRUST-025'],
  });
  add({
    name: 'escalation.2-cards.second-still-disputable.none',
    kind,
    description: 'TRUST-022: a card inside its 48h dispute window does not count yet',
    input: { state: st([{ n: 1, daysAgo: 10 }, { n: 2, daysAgo: 1.5 }]), event: tick },
    now: iso(T),
    expected: { effects: [] },
    tags: ['boundary'],
  });
  add({
    name: 'escalation.2-cards.second-disputed.none',
    kind,
    input: { state: st([{ n: 1, daysAgo: 10 }, { n: 2, daysAgo: 3, status: 'disputed' }]), event: tick },
    now: iso(T),
    expected: { effects: [] },
  });
  add({
    name: 'escalation.2-cards.second-upheld-inside-window.join-ban-7d',
    kind,
    input: { state: st([{ n: 1, daysAgo: 10 }, { n: 2, daysAgo: 1, status: 'upheld' }]), event: tick },
    now: iso(T),
    expected: { effects: issue(ban(2, [cardId(1), cardId(2)], 2)) },
  });
  add({
    name: 'escalation.1-card.none',
    kind,
    input: { state: st([{ n: 1, daysAgo: 10 }]), event: tick },
    now: iso(T),
    expected: { effects: [] },
  });
  add({
    name: 'escalation.2-cards.first-expired.none',
    kind,
    input: { state: st([{ n: 1, daysAgo: 30 }, { n: 2, daysAgo: 3 }]), event: tick },
    now: iso(T),
    expected: { effects: [{ type: 'SetSanctionStatus', sanctionId: cardId(1), status: 'expired' }] },
    tags: ['boundary'],
  });
  add({
    name: 'escalation.3-cards.join-ban-30d',
    kind,
    input: { state: st([{ n: 1, daysAgo: 12 }, { n: 2, daysAgo: 10 }, { n: 3, daysAgo: 3 }]), event: tick },
    now: iso(T),
    expected: { effects: issue(ban(3, [cardId(1), cardId(2), cardId(3)], 3)) },
    tags: ['prd-v5:TRUST-025'],
  });
  const four = [{ n: 1, daysAgo: 14 }, { n: 2, daysAgo: 12 }, { n: 3, daysAgo: 10 }, { n: 4, daysAgo: 3 }];
  add({
    name: 'escalation.4-cards.join-ban-30d-and-review-never-permanent',
    kind,
    description: 'AC-TRUST-025b: 30-day ban + high-priority review; no permanent ban without a moderator',
    input: { state: st(four), event: tick },
    now: iso(T),
    expected: {
      effects: [
        ...issue(ban(4, four.map((c) => cardId(c.n)), 4)),
        review({
          kind: 'permanent_ban_candidate',
          priority: 'high',
          dedupeKey: `permanent_ban_candidate:${SUBJECT}:${cardId(4)}`,
          now: T,
          subjectUserId: SUBJECT,
          gameId: G(4),
          sanctionId: cardId(4),
          evidence: { activeCards: 4, triggerReason: 'no_show' },
        }),
      ],
    },
    tags: ['prd-v5:TRUST-025'],
  });
  const banRow = {
    id: sid(`escalation_two_cards:${SUBJECT}:${cardId(2)}`),
    userId: SUBJECT,
    kind: 'join_ban',
    reasonCode: 'escalation_two_cards',
    statementKey: 'sanctions.reason.escalation_two_cards',
    statementParams: { cards: 2, days: 7, appealPath: 'appeal' },
    startsAt: iso(T - 8 * D),
    expiresAt: iso(T - D),
    disputeUntil: null,
    status: 'expired',
    gameId: G(2),
    causedBy: [cardId(1), cardId(2)],
    dedupeKey: `escalation_two_cards:${SUBJECT}:${cardId(2)}`,
    decidedBy: 'system',
    createdAt: iso(T - 8 * D),
  };
  const s2 = st([{ n: 1, daysAgo: 12 }, { n: 2, daysAgo: 10 }]);
  add({
    name: 'escalation.cards-already-escalated.no-retrigger',
    kind,
    input: { state: { ...s2, sanctions: [...(s2.sanctions as Json[]), banRow] }, event: tick },
    now: iso(T),
    expected: { effects: [] },
    tags: ['idempotency'],
  });
}

// ---------------------------------------------------------------- trust.applyEvent: disputes, auto-void

{
  const kind = 'trust.applyEvent';
  const issuedAt = T - D;
  const appeal = (createdAt: number, id = U(0xa1), sanctionId = cardId(1), status = 'open') => ({
    id,
    sanctionId,
    userId: SUBJECT,
    text: 'family emergency',
    isDispute: true,
    status,
    decidedBy: null,
    decisionNote: null,
    decidedAt: null,
    createdAt: iso(createdAt),
  });
  add({
    name: 'appeal-filed.inside-dispute-window.disputes-card',
    kind,
    input: { state: { userId: SUBJECT, sanctions: [cardRow({ n: 1, issuedAt })] }, event: { type: 'AppealFiled', appeal: appeal(T) } },
    now: iso(T),
    expected: {
      effects: [
        { type: 'SetSanctionStatus', sanctionId: cardId(1), status: 'disputed' },
        review({
          kind: 'sanction_dispute',
          priority: 'normal',
          dedupeKey: `sanction_dispute:${U(0xa1)}`,
          now: T,
          subjectUserId: SUBJECT,
          gameId: G(1),
          sanctionId: cardId(1),
          appealId: U(0xa1),
          evidence: { sanctionKind: 'yellow_card', reasonCode: 'no_show' },
        }),
      ],
    },
    tags: ['prd-v5:TRUST-022'],
  });
  add({
    name: 'appeal-filed.after-dispute-window.appeal-only',
    kind,
    input: { state: { userId: SUBJECT, sanctions: [cardRow({ n: 1, issuedAt: T - 3 * D })] }, event: { type: 'AppealFiled', appeal: appeal(T) } },
    now: iso(T),
    expected: {
      effects: [
        review({
          kind: 'appeal',
          priority: 'low',
          dedupeKey: `appeal:${U(0xa1)}`,
          now: T,
          subjectUserId: SUBJECT,
          gameId: G(1),
          sanctionId: cardId(1),
          appealId: U(0xa1),
          evidence: { sanctionKind: 'yellow_card', reasonCode: 'no_show' },
        }),
      ],
    },
    tags: ['boundary'],
  });
  const disputed = cardRow({ n: 1, issuedAt, status: 'disputed' });
  const filed = T;
  const voidAt = filed + 7 * D;
  add({
    name: 'dispute.undecided-7d.auto-voided',
    kind,
    description: 'TRUST-023: fairness by default — undecided dispute voids the card after 7 days',
    input: { state: { userId: SUBJECT, sanctions: [disputed], appeals: [appeal(filed)] }, event: { type: 'Tick', at: iso(voidAt) } },
    now: iso(voidAt),
    expected: {
      effects: [
        { type: 'SetSanctionStatus', sanctionId: cardId(1), status: 'overturned' },
        { type: 'SetAttendance', gameId: G(1), userId: SUBJECT, attendance: 'excused' },
        { type: 'SettleDeposit', gameId: G(1), userId: SUBJECT, outcome: 'release' },
        {
          type: 'Notify',
          userId: SUBJECT,
          kind: 'appeal_decided',
          params: { decision: 'auto_void', sanctionKind: 'yellow_card', reasonCode: 'no_show', statementKey: 'sanctions.reason.no_show' },
          gameId: G(1),
          sanctionDedupeKey: `no_show:${G(1)}:${SUBJECT}`,
        },
        { type: 'Audit', action: 'sanction.auto_voided', subjectUserId: SUBJECT, data: { sanctionId: cardId(1), appealId: U(0xa1), days: 7 } },
      ],
    },
    tags: ['boundary', 'prd-v5:TRUST-023'],
  });
  add({
    name: 'dispute.undecided-7d-minus-1ms.not-voided',
    kind,
    input: { state: { userId: SUBJECT, sanctions: [disputed], appeals: [appeal(filed)], depositSettlements: settled([1]) }, event: { type: 'Tick', at: iso(voidAt - 1) } },
    now: iso(voidAt - 1),
    expected: { effects: [] },
    tags: ['boundary'],
  });
  add({
    name: 'dispute.fourth-in-90d.no-auto-void',
    kind,
    input: {
      state: {
        userId: SUBJECT,
        sanctions: [disputed],
        appeals: [1, 2, 3].map((i) => appeal(filed - i * 10 * D, U(0xb0 + i), U(0xc0 + i), 'upheld')).concat([appeal(filed)]),
      },
      event: { type: 'Tick', at: iso(voidAt + D) },
    },
    now: iso(voidAt + D),
    expected: { effects: [] },
    tags: ['prd-v5:TRUST-023'],
  });
}

// ---------------------------------------------------------------- trust.applyEvent: chat blocks

{
  const kind = 'trust.applyEvent';
  const ev = { type: 'ChatMessageBlocked', gameId: G(1), userId: SUBJECT, at: iso(T), categories: ['harassment'] };
  const prior = (hs: number[]) => hs.map((h) => ({ gameId: G(1), at: iso(T - h * H) }));
  const key = `${SUBJECT}:${G(1)}:${iso(T)}`;
  const card = sanction({
    kind: 'yellow_card',
    userId: SUBJECT,
    reasonCode: 'chat_blocks',
    params: { blocks: 3, windowDays: 7 },
    now: T,
    durationMs: 30 * D,
    disputeMs: 48 * H,
    gameId: G(1),
    dedupeKey: `chat_blocks:${key}`,
  });
  const mute = sanction({
    kind: 'chat_mute',
    userId: SUBJECT,
    reasonCode: 'chat_blocks',
    params: { hours: 24, blocks: 3 },
    now: T,
    durationMs: 24 * H,
    gameId: G(1),
    causedBy: [sid(`chat_blocks:${key}`)],
    dedupeKey: `chat_mute:${key}`,
  });
  add({
    name: 'chat-blocks.third-in-7d.yellow-and-24h-mute',
    kind,
    input: { state: { userId: SUBJECT, chatBlocks: prior([100, 50]) }, event: ev },
    now: iso(T),
    expected: { effects: [...issue(card), ...issue(mute)] },
    tags: ['prd-v5:CHAT-021'],
  });
  add({
    name: 'chat-blocks.first-outside-7d.none',
    kind,
    input: { state: { userId: SUBJECT, chatBlocks: prior([7 * 24, 50]) }, event: ev },
    now: iso(T),
    expected: { effects: [] },
    tags: ['boundary'],
  });
}

// ---------------------------------------------------------------- trust.applyEvent: moderator decisions

{
  const kind = 'trust.applyEvent';
  const card = cardRow({ n: 1, issuedAt: T - 3 * D, status: 'disputed' });
  const banKey = `escalation_two_cards:${SUBJECT}:${cardId(1)}`;
  const banRow = {
    id: sid(banKey),
    userId: SUBJECT,
    kind: 'join_ban',
    reasonCode: 'escalation_two_cards',
    statementKey: 'sanctions.reason.escalation_two_cards',
    statementParams: { cards: 2, days: 7, appealPath: 'appeal' },
    startsAt: iso(T - D),
    expiresAt: iso(T + 6 * D),
    disputeUntil: null,
    status: 'active',
    gameId: G(1),
    causedBy: [cardId(2), cardId(1)],
    dedupeKey: banKey,
    decidedBy: 'system',
    createdAt: iso(T - D),
  };
  const itemKey = `sanction_dispute:${U(0xa1)}`;
  const item = (kindR: string, dedupeKey: string, extra: Record<string, Json> = {}) => ({
    id: rid(dedupeKey),
    kind: kindR,
    status: 'open',
    priority: 'normal',
    subjectUserId: SUBJECT,
    venueId: null,
    gameId: G(1),
    sanctionId: cardId(1),
    appealId: U(0xa1),
    reportIds: [],
    evidence: {},
    dueBy: iso(T + D),
    dedupeKey,
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: iso(T - D),
    ...extra,
  });
  const decided = (itemId: string, decision: string) => ({ type: 'ModeratorDecided', itemId, decision, moderatorId: U(0x900), at: iso(T), note: null });
  add({
    name: 'moderator.overturn.cascades-to-escalation-ban',
    kind,
    input: { state: { userId: SUBJECT, sanctions: [card, banRow], reviewItems: [item('sanction_dispute', itemKey)] }, event: decided(rid(itemKey), 'overturn') },
    now: iso(T),
    expected: {
      effects: [
        { type: 'SetSanctionStatus', sanctionId: cardId(1), status: 'overturned' },
        { type: 'SetSanctionStatus', sanctionId: sid(banKey), status: 'overturned' },
        { type: 'LiftRestrictions', userId: SUBJECT, kinds: ['join_ban'] },
        { type: 'SetAttendance', gameId: G(1), userId: SUBJECT, attendance: 'excused' },
        { type: 'SettleDeposit', gameId: G(1), userId: SUBJECT, outcome: 'release' },
        {
          type: 'Notify',
          userId: SUBJECT,
          kind: 'appeal_decided',
          params: { decision: 'overturn', sanctionKind: 'yellow_card', reasonCode: 'no_show', statementKey: 'sanctions.reason.no_show' },
          gameId: G(1),
          sanctionDedupeKey: `no_show:${G(1)}:${SUBJECT}`,
        },
        { type: 'Audit', action: 'moderator.decision', subjectUserId: SUBJECT, data: { itemId: rid(itemKey), kind: 'sanction_dispute', decision: 'overturn', moderatorId: U(0x900), note: null } },
      ],
    },
    tags: ['cascade'],
  });
  const pbKey = `permanent_ban_candidate:${SUBJECT}:${cardId(4)}`;
  const pbItem = item('permanent_ban_candidate', pbKey, { priority: 'high', sanctionId: cardId(4), appealId: null });
  add({
    name: 'moderator.permanent-ban.only-by-human',
    kind,
    input: { state: { userId: SUBJECT, reviewItems: [pbItem] }, event: decided(rid(pbKey), 'permanent_ban') },
    now: iso(T),
    expected: {
      effects: [
        ...issue(
          sanction({
            kind: 'permanent_ban',
            userId: SUBJECT,
            reasonCode: 'moderator_decision',
            params: {},
            now: T,
            durationMs: null,
            causedBy: [cardId(4)],
            dedupeKey: `permanent_ban:${rid(pbKey)}`,
            decidedBy: 'moderator',
          }),
        ),
        { type: 'Audit', action: 'moderator.decision', subjectUserId: SUBJECT, data: { itemId: rid(pbKey), kind: 'permanent_ban_candidate', decision: 'permanent_ban', moderatorId: U(0x900), note: null } },
      ],
    },
  });
}

// ---------------------------------------------------------------- trust.processNoShows

{
  const kind = 'trust.processNoShows';
  const game = { id: G(1), hostId: HOST, startsAt: iso(T), endsAt: iso(T + 90 * 60_000), status: 'scheduled' };
  const finalizeAt = T + 90 * 60_000 + 2 * H;
  const p = (userId: string, attendance: string, extra: Record<string, Json> = {}) => ({ userId, status: 'approved', attendance, lateCancel: false, cancelledAt: null, ...extra });
  add({
    name: 'no-shows.game-happened.unverified-become-no-show',
    kind,
    input: { game, participants: [p(HOST, 'unknown'), p(U(2), 'verified'), p(U(3), 'verified'), p(SUBJECT, 'unknown')] },
    now: iso(finalizeAt),
    expected: {
      finalized: true,
      gameHappened: true,
      effects: [{ type: 'SetAttendance', gameId: G(1), userId: SUBJECT, attendance: 'no_show_unverified' }],
      events: [
        { type: 'AttendanceFinalized', gameId: G(1), userId: SUBJECT, attendance: 'no_show_unverified', endsAt: game.endsAt },
        { type: 'AttendanceFinalized', gameId: G(1), userId: U(2), attendance: 'verified', endsAt: game.endsAt },
        { type: 'AttendanceFinalized', gameId: G(1), userId: U(3), attendance: 'verified', endsAt: game.endsAt },
      ],
    },
    tags: ['prd-v5:TRUST-010'],
  });
  add({
    name: 'no-shows.before-finalisation.nothing',
    kind,
    input: { game, participants: [p(U(2), 'verified'), p(U(3), 'verified'), p(SUBJECT, 'unknown')] },
    now: iso(finalizeAt - 1),
    expected: { finalized: false, gameHappened: null, effects: [], events: [] },
    tags: ['boundary'],
  });
  add({
    name: 'no-shows.game-not-happened.no-cards',
    kind,
    description: 'AC-TRUST-011: one verified player of 10 → nobody gets a card, deposits released, host reviewed',
    input: { game, participants: [p(U(2), 'verified'), p(SUBJECT, 'unknown')], minPlayers: 10 },
    now: iso(finalizeAt),
    expected: {
      finalized: true,
      gameHappened: false,
      effects: [
        { type: 'SetAttendance', gameId: G(1), userId: SUBJECT, attendance: 'excused' },
        { type: 'SettleDeposit', gameId: G(1), userId: SUBJECT, outcome: 'release' },
        { type: 'SettleDeposit', gameId: G(1), userId: U(2), outcome: 'release' },
        review({
          kind: 'host_reliability',
          priority: 'normal',
          dedupeKey: `game_not_happened:${G(1)}`,
          now: finalizeAt,
          subjectUserId: HOST,
          gameId: G(1),
          evidence: { reason: 'game_not_happened', verifiedCount: 1, threshold: 5 },
        }),
      ],
      events: [],
    },
    tags: ['prd-v5:TRUST-011'],
  });
  const late = { userId: SUBJECT, status: 'cancelled', attendance: 'unknown', lateCancel: true, cancelledAt: iso(T - 90 * 60_000) };
  for (const [name, replacement, promotedAt, refilled] of [
    ['refilled-before-start-and-checked-in', 'verified', T - H, true],
    ['refilled-but-replacement-no-show', 'unknown', T - H, false],
    ['refilled-only-after-start', 'verified', T + 60_000, false],
  ] as const) {
    add({
      name: `no-shows.late-cancel.${name}`,
      kind,
      input: {
        game,
        participants: [p(U(2), 'verified'), p(U(3), 'verified'), late, p(U(4), replacement)],
        refills: [{ cancelledUserId: SUBJECT, replacementUserId: U(4), promotedAt: iso(promotedAt) }],
      },
      now: iso(finalizeAt),
      expected: {
        finalized: true,
        gameHappened: true,
        effects: replacement === 'unknown' ? [{ type: 'SetAttendance', gameId: G(1), userId: U(4), attendance: 'no_show_unverified' }] : [],
        events: [
          { type: 'AttendanceFinalized', gameId: G(1), userId: U(2), attendance: 'verified', endsAt: game.endsAt },
          { type: 'AttendanceFinalized', gameId: G(1), userId: U(3), attendance: 'verified', endsAt: game.endsAt },
          {
            type: 'AttendanceFinalized',
            gameId: G(1),
            userId: U(4),
            attendance: replacement === 'unknown' ? 'no_show_unverified' : 'verified',
            endsAt: game.endsAt,
          },
          { type: 'LateCancelFinalized', gameId: G(1), userId: SUBJECT, startsAt: game.startsAt, cancelledAt: late.cancelledAt, refilled },
        ],
      },
      tags: ['prd-v5:TRUST-021'],
    });
  }
}

// ---------------------------------------------------------------- trust.evaluateReports

{
  const kind = 'trust.evaluateReports';
  const prof = (n: number, createdDaysAgo: number, extra: Record<string, Json> = {}) => ({
    id: U(n),
    createdAt: iso(T - createdDaysAgo * D),
    reliabilityStatus: 'green',
    reportsLast7d: 1,
    ...extra,
  });
  const rep = (n: number, reporter: number, hoursAgo: number, extra: Record<string, Json> = {}) => ({
    id: U(0x100 + n),
    reporterId: U(reporter),
    targetUserId: SUBJECT,
    category: 'harassment',
    gameId: G(1),
    messageId: null,
    note: null,
    createdAt: iso(T - hoursAgo * H),
    ...extra,
  });
  /** A participation in G(1) and G(2): GPS-verified, not the host (overridable). */
  const att = (n: number, extra: Record<string, Json> = {}) =>
    [G(1), G(2)].map((gameId) => ({ gameId, userId: U(n), status: 'approved', attendance: 'verified', checkInMethod: 'gps', isHost: false, team: null, ...extra }));
  // Reports span two games: all reports from one game are review-only (single_game).
  const reports = [rep(1, 2, 20), rep(2, 3, 10, { gameId: G(2) }), rep(3, 4, 1)];
  const profiles = [prof(2, 30), prof(3, 60), prof(4, 90)];
  const attendance = [...att(1), ...att(2), ...att(3), ...att(4)];
  const reportIds = reports.map((r) => r.id);
  const key = `toxicity_reports:${SUBJECT}:${reportIds[0]}`;
  const evidence = (o: { independent: number; collusion: boolean; reasons: string; excluded?: number; reporters?: number }) => ({
    reporters: o.reporters ?? 3,
    independentReporters: o.independent,
    windowDays: 14,
    excludedReporters: o.excluded ?? 0,
    collusionSuspected: o.collusion,
    reviewReasons: o.reasons,
  });
  const restriction = sanction({
    kind: 'visibility_restriction',
    userId: SUBJECT,
    reasonCode: 'toxicity_reports',
    params: { reporters: 3, windowDays: 14, hours: 72 },
    now: T,
    durationMs: 72 * H,
    dedupeKey: key,
  });
  add({
    name: 'reports.3-qualified-independent.restrict-72h',
    kind,
    description: 'AC-TRUST-043',
    input: { reports, reporterProfiles: profiles, context: { attendance } },
    now: iso(T),
    expected: {
      outcome: 'restrict',
      qualifyingReporterIds: [U(2), U(3), U(4)],
      effects: [
        ...issue(restriction),
        review({
          kind: 'toxicity_reports',
          priority: 'normal',
          dedupeKey: key,
          now: T,
          subjectUserId: SUBJECT,
          sanctionId: sid(key),
          reportIds,
          evidence: evidence({ independent: 3, collusion: false, reasons: '' }),
        }),
      ],
    },
    tags: ['prd-v5:TRUST-043'],
  });
  const collusionReview = (reasons: string, independent: number) =>
    review({
      kind: 'collusion_suspected',
      priority: 'normal',
      dedupeKey: `collusion_suspected:${SUBJECT}:${reportIds[0]}`,
      now: T,
      subjectUserId: SUBJECT,
      reportIds,
      evidence: evidence({ independent, collusion: true, reasons }),
    });
  add({
    name: 'reports.two-reporters-created-within-48h.review-only',
    kind,
    description: 'AC-TRUST-042: collusion suspected → queue only, no restriction, no notice',
    input: { reports, reporterProfiles: [prof(2, 30), prof(3, 31.9), prof(4, 90)], context: { attendance } },
    now: iso(T),
    expected: { outcome: 'review_only', qualifyingReporterIds: [U(2), U(3), U(4)], effects: [collusionReview('creation_window', 2)] },
    tags: ['prd-v5:TRUST-042', 'boundary'],
  });
  add({
    name: 'reports.reporters-created-just-over-48h-apart.restrict',
    kind,
    input: { reports, reporterProfiles: [prof(2, 30), prof(3, 32.001), prof(4, 90)], context: { attendance } },
    now: iso(T),
    expected: {
      outcome: 'restrict',
      qualifyingReporterIds: [U(2), U(3), U(4)],
      effects: [
        ...issue(restriction),
        review({
          kind: 'toxicity_reports',
          priority: 'normal',
          dedupeKey: key,
          now: T,
          subjectUserId: SUBJECT,
          sanctionId: sid(key),
          reportIds,
          evidence: evidence({ independent: 3, collusion: false, reasons: '' }),
        }),
      ],
    },
    tags: ['boundary'],
  });
  add({
    name: 'reports.all-from-one-game.review-only',
    kind,
    description: 'Security fix: one game\'s players (e.g. a rival team) cannot restrict alone',
    input: { reports: reports.map((r) => ({ ...r, gameId: G(1) })), reporterProfiles: profiles, context: { attendance } },
    now: iso(T),
    expected: { outcome: 'review_only', qualifyingReporterIds: [U(2), U(3), U(4)], effects: [collusionReview('single_game', 3)] },
    tags: ['security', 'prd-v5:TRUST-042'],
  });
  const viaQr = [...att(1), ...att(2, { checkInMethod: 'qr' }), ...att(3, { checkInMethod: 'host' }), ...att(4, { checkInMethod: 'qr' })];
  add({
    name: 'reports.no-gps-verified-reporter.review-only',
    kind,
    description: 'Security fix: at least one counted reporter must be GPS-verified at the game and not its host',
    input: { reports, reporterProfiles: profiles, context: { attendance: viaQr } },
    now: iso(T),
    expected: { outcome: 'review_only', qualifyingReporterIds: [U(2), U(3), U(4)], effects: [collusionReview('no_gps_anchor', 3)] },
    tags: ['security'],
  });
  add({
    name: 'reports.only-gps-reporter-is-host.review-only',
    kind,
    input: { reports, reporterProfiles: profiles, context: { attendance: [...att(1), ...att(2, { isHost: true }), ...att(3, { checkInMethod: 'qr' }), ...att(4, { checkInMethod: 'qr' })] } },
    now: iso(T),
    expected: { outcome: 'review_only', qualifyingReporterIds: [U(2), U(3), U(4)], effects: [collusionReview('no_gps_anchor', 3)] },
    tags: ['security'],
  });
  add({
    name: 'reports.reporter-not-checked-in-at-game.does-not-count',
    kind,
    description: 'PRD v5 TRUST-041: reporters count only if checked in at the same game as the subject',
    input: { reports, reporterProfiles: profiles, context: { attendance: [...att(1), ...att(2), ...att(3), ...att(4, { attendance: 'no_show_unverified', checkInMethod: null })] } },
    now: iso(T),
    expected: { outcome: 'none', qualifyingReporterIds: [U(2), U(3)], effects: [] },
    tags: ['prd-v5:TRUST-041'],
  });
  add({
    name: 'reports.account-6d-old-at-report-time.does-not-count',
    kind,
    input: { reports, reporterProfiles: [prof(2, 30), prof(3, 60), prof(4, 7 - 0.01)], context: { attendance } },
    now: iso(T),
    expected: { outcome: 'none', qualifyingReporterIds: [U(2), U(3)], effects: [] },
    tags: ['boundary'],
  });
  add({
    name: 'reports.red-and-spamming-reporters.do-not-count',
    kind,
    input: { reports, reporterProfiles: [prof(2, 30, { reliabilityStatus: 'red' }), prof(3, 60, { reportsLast7d: 11 }), prof(4, 90)], context: { attendance } },
    now: iso(T),
    expected: { outcome: 'none', qualifyingReporterIds: [U(4)], effects: [] },
  });
  add({
    name: 'reports.oldest-outside-14d.none',
    kind,
    input: { reports: [rep(1, 2, 14 * 24), rep(2, 3, 10), rep(3, 4, 1)], reporterProfiles: profiles, context: { attendance } },
    now: iso(T),
    expected: { outcome: 'none', qualifyingReporterIds: [U(3), U(4)], effects: [] },
    tags: ['boundary'],
  });
  const overturnedKey = `toxicity_reports:${SUBJECT}:${U(0x1ff)}`;
  const overturned = {
    id: sid(overturnedKey),
    userId: SUBJECT,
    kind: 'visibility_restriction',
    reasonCode: 'toxicity_reports',
    statementKey: 'sanctions.reason.toxicity_reports',
    statementParams: { reporters: 3, windowDays: 14, hours: 72, appealPath: 'appeal' },
    startsAt: iso(T - 5 * D),
    expiresAt: iso(T - 2 * D),
    disputeUntil: null,
    status: 'overturned',
    gameId: null,
    causedBy: [],
    dedupeKey: overturnedKey,
    decidedBy: 'system',
    createdAt: iso(T - 5 * D),
  };
  add({
    name: 'reports.within-14d-of-overturn.review-only',
    kind,
    description: 'PRD v5 TRUST-048: after an overturned restriction, new report-based restrictions are review-only for 14 days',
    input: { reports, reporterProfiles: profiles, context: { attendance, sanctions: [overturned], overturns: [{ sanctionId: sid(overturnedKey), at: iso(T - 4 * D) }] } },
    now: iso(T),
    expected: {
      outcome: 'review_only',
      qualifyingReporterIds: [U(2), U(3), U(4)],
      effects: [
        review({
          kind: 'toxicity_reports',
          priority: 'normal',
          dedupeKey: `protected_reports:${SUBJECT}:${reportIds[0]}`,
          now: T,
          subjectUserId: SUBJECT,
          reportIds,
          evidence: evidence({ independent: 3, collusion: false, reasons: 'overturn_protection' }),
        }),
      ],
    },
    tags: ['prd-v5:TRUST-048'],
  });
}

// ---------------------------------------------------------------- trust.venueReports

{
  const kind = 'trust.venueReports';
  const vr = (n: number, reporter: number, reason = 'no_venue_here') => ({
    id: U(0x200 + n),
    venueId: VENUE,
    reporterId: U(reporter),
    reason,
    note: null,
    createdAt: iso(T - (10 - n) * H),
  });
  const vprof = (n: number, createdDaysAgo = 30, extra: Record<string, Json> = {}) => ({
    id: U(n),
    createdAt: iso(T - createdDaysAgo * D),
    reliabilityStatus: 'green',
    reportsLast7d: 0,
    ...extra,
  });
  const vprofiles = [vprof(2), vprof(3), vprof(4), vprof(0xff)];
  const venue = (reports: Json[], extra: Record<string, Json> = {}) => ({ venueId: VENUE, status: 'active', createdBy: HOST, lastReviewedAt: null, reports, ...extra });
  add({
    name: 'venue.3-distinct-reporters.auto-hide',
    kind,
    input: { reporterProfiles: vprofiles, venue: venue([vr(1, 2), vr(2, 3, 'closed'), vr(3, 4)]) },
    now: iso(T),
    expected: {
      hide: true,
      effects: [
        { type: 'SetVenueStatus', venueId: VENUE, status: 'hidden_pending_review' },
        review({
          kind: 'venue_reports',
          priority: 'normal',
          dedupeKey: `venue_reports:${VENUE}:${U(0x201)}`,
          now: T,
          subjectUserId: HOST,
          venueId: VENUE,
          evidence: { reporters: 3, no_venue_here: 2, closed: 1 },
        }),
        { type: 'Notify', userId: HOST, kind: 'venue_hidden', params: { venueId: VENUE, reporters: 3 }, gameId: null, sanctionDedupeKey: null },
      ],
    },
    tags: ['boundary'],
  });
  add({ name: 'venue.2-reporters.stays-active', kind, input: { reporterProfiles: vprofiles, venue: venue([vr(1, 2), vr(2, 3)]) }, now: iso(T), expected: { hide: false, effects: [] }, tags: ['boundary'] });
  add({ name: 'venue.same-reporter-twice.not-distinct', kind, input: { reporterProfiles: vprofiles, venue: venue([vr(1, 2), vr(2, 3), vr(3, 3)]) }, now: iso(T), expected: { hide: false, effects: [] } });
  add({ name: 'venue.creator-report-excluded', kind, input: { reporterProfiles: vprofiles, venue: venue([vr(1, 2), vr(2, 3), vr(3, 0xff)]) }, now: iso(T), expected: { hide: false, effects: [] } });
  add({
    name: 'venue.reports-before-last-review-consumed',
    kind,
    input: { reporterProfiles: vprofiles, venue: venue([vr(1, 2), vr(2, 3), vr(3, 4)], { lastReviewedAt: iso(T - 7.5 * H) }) },
    now: iso(T),
    expected: { hide: false, effects: [] },
  });
  const three = venue([vr(1, 2), vr(2, 3), vr(3, 4)]);
  add({
    name: 'venue.reporter-account-too-new.stays-active',
    kind,
    description: 'Security fix: venue reporters must qualify like user reporters (account ≥ 7 days old at report time)',
    input: { reporterProfiles: [vprof(2), vprof(3), vprof(4, 7)], venue: three },
    now: iso(T),
    expected: { hide: false, effects: [] },
    tags: ['security', 'boundary'],
  });
  add({
    name: 'venue.red-reporter.stays-active',
    kind,
    input: { reporterProfiles: [vprof(2), vprof(3), vprof(4, 30, { reliabilityStatus: 'red' })], venue: three },
    now: iso(T),
    expected: { hide: false, effects: [] },
    tags: ['security'],
  });
  add({
    name: 'venue.unknown-reporter-profile.stays-active',
    kind,
    input: { reporterProfiles: [vprof(2), vprof(3)], venue: three },
    now: iso(T),
    expected: { hide: false, effects: [] },
    tags: ['security'],
  });
}

// ---------------------------------------------------------------- trust.hostReliability

{
  const kind = 'trust.hostReliability';
  const rating = (n: number, stars: number) => ({ hostId: HOST, gameId: G(n), raterId: U(0x300 + n), stars, at: iso(T - n * D) });
  const run = (name: string, stars: number[], expected: Json, tags: string[] = []) =>
    add({ name, kind, input: { hostId: HOST, ratings: stars.map((s, i) => rating(i + 1, s)), confirmedFakeVenueIds: [], sanctions: [] }, now: iso(T), expected, tags });
  const key = `low_host_rating:${HOST}:${G(1)}:${U(0x301)}`;
  run('host.avg-2.0-over-5.suspend', [2, 2, 1, 3, 2], {
    outcome: 'suspend',
    reasonCode: 'low_host_rating',
    effects: [
      ...issue(
        sanction({
          kind: 'host_suspension',
          userId: HOST,
          reasonCode: 'low_host_rating',
          params: { average: 2, ratings: 5, days: 14 },
          now: T,
          durationMs: 14 * D,
          dedupeKey: key,
        }),
      ),
      review({
        kind: 'host_reliability',
        priority: 'normal',
        dedupeKey: key,
        now: T,
        subjectUserId: HOST,
        sanctionId: sid(key),
        evidence: { reason: 'low_host_rating', ratingCount: 5, averageRating: 2, lateGameCancellations: 0 },
      }),
    ],
  }, ['boundary']);
  run('host.avg-2.2-over-5.none', [2, 2, 2, 3, 2], { outcome: 'none', reasonCode: null, effects: [] }, ['boundary']);
  run('host.avg-1.0-over-4.none', [1, 1, 1, 1], { outcome: 'none', reasonCode: null, effects: [] }, ['boundary']);
}

// ---------------------------------------------------------------- trust.hostGameCancelled

{
  const kind = 'trust.hostGameCancelled';
  const now = T - 90 * 60_000;
  const game = (n: number) => ({ id: G(n), hostId: HOST, startsAt: iso(T) });
  const hostCard = (n: number, issuedAt: number, minutesBeforeStart: number): NewSanctionJ =>
    sanction({
      kind: 'yellow_card',
      userId: HOST,
      reasonCode: 'late_cancel',
      params: { role: 'host', windowHours: 2, minutesBeforeStart, disputeHours: 48 },
      now: issuedAt,
      durationMs: 30 * D,
      disputeMs: 48 * H,
      gameId: G(n),
      dedupeKey: `host_late_cancel:${G(n)}:${HOST}`,
    });
  const row = (c: NewSanctionJ): Json => ({ ...c, id: sid(c.dedupeKey as string), status: 'active', appealPath: 'dispute', overturnedAt: null, createdAt: c.startsAt as string });
  add({
    name: 'host-cancel.90min-before.host-yellow',
    kind,
    description: 'Security fix (GAME-047): a host cancelling their own game < 2h before start gets a disputable late_cancel card',
    input: { state: { userId: HOST }, game: game(1), cancelledAt: iso(now) },
    now: iso(now),
    expected: { effects: issue(hostCard(1, now, 90)) },
    tags: ['security', 'prd-v5:GAME-047'],
  });
  add({
    name: 'host-cancel.exactly-2h-before.no-card',
    kind,
    input: { state: { userId: HOST }, game: game(1), cancelledAt: iso(T - 2 * H) },
    now: iso(T - 2 * H),
    expected: { effects: [] },
    tags: ['boundary'],
  });
  const prior = hostCard(2, now - 10 * D, 30);
  const second = hostCard(1, now, 90);
  const key = `host_late_cancellations:${HOST}:${sid(second.dedupeKey as string)}`;
  add({
    name: 'host-cancel.second-in-30d.host-suspension',
    kind,
    description: 'TRUST-051(c): 2 late game cancellations in 30 days → host suspension + review, caused by the cards',
    input: { state: { userId: HOST, sanctions: [row(prior)] }, game: game(1), cancelledAt: iso(now) },
    now: iso(now),
    expected: {
      effects: [
        ...issue(second),
        ...issue(
          sanction({
            kind: 'host_suspension',
            userId: HOST,
            reasonCode: 'late_cancel',
            params: { cancellations: 2, windowDays: 30, days: 14 },
            now,
            durationMs: 14 * D,
            causedBy: [sid(prior.dedupeKey as string), sid(second.dedupeKey as string)],
            dedupeKey: key,
          }),
        ),
        review({
          kind: 'host_reliability',
          priority: 'normal',
          dedupeKey: key,
          now,
          subjectUserId: HOST,
          sanctionId: sid(key),
          evidence: { reason: 'late_cancel', ratingCount: 0, averageRating: null, lateGameCancellations: 2 },
        }),
      ],
    },
    tags: ['security', 'prd-v5:TRUST-051'],
  });
  add({
    name: 'host-cancel.previous-over-30d-ago.card-only',
    kind,
    input: { state: { userId: HOST, sanctions: [row(hostCard(2, now - 30 * D, 30))] }, game: game(1), cancelledAt: iso(now) },
    now: iso(now),
    expected: { effects: issue(hostCard(1, now, 90)) },
    tags: ['boundary'],
  });
  add({
    name: 'host-cancel.already-carded.idempotent',
    kind,
    input: { state: { userId: HOST, sanctions: [row(hostCard(1, now, 90))] }, game: game(1), cancelledAt: iso(now) },
    now: iso(now),
    expected: { effects: [] },
    tags: ['idempotency'],
  });
}

// ---------------------------------------------------------------- trust.reliability

{
  const kind = 'trust.reliability';
  const p = (attendance: string, n: number) => ({ gameId: G(n), status: 'approved', attendance, lateCancel: false, cancelledAt: null, endsAt: iso(T - n * D) });
  const late = (n: number) => ({ gameId: G(n), status: 'cancelled', attendance: 'unknown', lateCancel: true, cancelledAt: iso(T - n * D), endsAt: iso(T - n * D) });
  const snap = (score: number | null, status: string, v: number, c: number, l: number, ns: number) => ({
    score,
    status,
    verifiedCount: v,
    commitmentCount: c,
    lateCancelCount: l,
    noShowCount: ns,
    computedAt: iso(T),
  });
  add({ name: 'reliability.2-games.new', kind, input: { participations: [p('verified', 1), p('verified', 2)], sanctions: [] }, now: iso(T), expected: snap(null, 'new', 2, 2, 0, 0), tags: ['boundary'] });
  add({
    name: 'reliability.10-verified.green',
    kind,
    input: { participations: Array.from({ length: 10 }, (_, i) => p('verified', i + 1)), sanctions: [] },
    now: iso(T),
    expected: snap(1, 'green', 10, 10, 0, 0),
  });
  add({
    name: 'reliability.mixed-with-late-cancel.yellow',
    kind,
    description: '(2+3)/(2+1+0.5+3) = 0.7692',
    input: { participations: [p('verified', 1), p('verified', 2), p('no_show_unverified', 3), late(4)], sanctions: [] },
    now: iso(T),
    expected: snap(0.7692, 'yellow', 2, 4, 1, 1),
  });
  add({
    name: 'reliability.mostly-no-shows.red',
    kind,
    description: '(1+3)/(1+6+3) = 0.4',
    input: { participations: [p('verified', 1), ...[2, 3, 4, 5, 6, 7].map((n) => p('no_show_unverified', n))], sanctions: [] },
    now: iso(T),
    expected: snap(0.4, 'red', 1, 7, 0, 6),
  });
  add({
    name: 'reliability.outside-90d.ignored',
    kind,
    input: { participations: [p('verified', 1), p('verified', 2), p('no_show_unverified', 90)], sanctions: [] },
    now: iso(T),
    expected: snap(null, 'new', 2, 2, 0, 0),
    tags: ['boundary'],
  });
}

// ---------------------------------------------------------------- games.windows

{
  const kind = 'games.windows';
  const game = { startsAt: iso(T), endsAt: iso(T + 90 * 60_000) };
  const end = T + 90 * 60_000;
  const at = (name: string, now: number, o: { checkInOpen: boolean; canSubmitResult: boolean; chatOpen: boolean }, tags = ['boundary']) =>
    add({
      name,
      kind,
      input: { game },
      now: iso(now),
      expected: {
        checkInOpensAt: iso(T - 30 * 60_000),
        resultWindowClosesAt: iso(end + 2 * H),
        chatExpiresAt: iso(end + 3 * H),
        ...o,
      },
      tags,
    });
  at('window.check-in.opens-at-start-minus-30m', T - 30 * 60_000, { checkInOpen: true, canSubmitResult: false, chatOpen: true });
  at('window.check-in.closed-1ms-before', T - 30 * 60_000 - 1, { checkInOpen: false, canSubmitResult: false, chatOpen: true });
  at('window.result.opens-at-end', end, { checkInOpen: true, canSubmitResult: true, chatOpen: true });
  at('window.result.before-end-rejected', end - 1, { checkInOpen: true, canSubmitResult: false, chatOpen: true });
  at('window.result.end-plus-2h-accepted', end + 2 * H, { checkInOpen: false, canSubmitResult: true, chatOpen: true });
  at('window.result.end-plus-2h-plus-1ms-rejected', end + 2 * H + 1, { checkInOpen: false, canSubmitResult: false, chatOpen: true });
  at('window.chat-ttl.open-until-end-plus-3h', end + 3 * H - 1, { checkInOpen: false, canSubmitResult: false, chatOpen: true });
  at('window.chat-ttl.expired-at-end-plus-3h', end + 3 * H, { checkInOpen: false, canSubmitResult: false, chatOpen: false });
}

// ---------------------------------------------------------------- games.waitlist

{
  const kind = 'games.waitlist';
  const game = { id: G(1), capacity: 2, status: 'scheduled', startsAt: iso(T) };
  const wl = (n: number, rank: number) => ({ userId: U(n), status: 'waitlisted', waitlistRank: rank, requestedAt: iso(T - (20 - n) * H) });
  const participants = [{ userId: HOST, status: 'approved', waitlistRank: null, requestedAt: iso(T - 30 * H) }, wl(2, 1), wl(3, 2), wl(4, 3)];
  const notify = (n: number, mode: string, acceptBy: number) => ({
    type: 'Notify',
    userId: U(n),
    kind: 'waitlist_offer',
    params: { offer: 1, mode, acceptBy: iso(acceptBy) },
    gameId: G(1),
    sanctionDedupeKey: null,
  });
  const plan = (now: number, mode: string, offers: [number, number][]) => ({
    mode,
    freeSpots: 1,
    offers: offers.map(([n, by]) => ({ userId: U(n), offeredAt: iso(now), acceptBy: iso(by), mode })),
    effects: offers.map(([n, by]) => notify(n, mode, by)),
  });
  const now10 = T - 10 * H;
  add({ name: 'waitlist.10h-before.standard-2h-offer', kind, input: { game, participants }, now: iso(now10), expected: plan(now10, 'standard', [[2, now10 + 2 * H]]), tags: ['prd-v5:GAME-045'] });
  const now6 = T - 6 * H;
  add({ name: 'waitlist.6h-before.short-20min-offer', kind, input: { game, participants }, now: iso(now6), expected: plan(now6, 'short', [[2, now6 + 20 * 60_000]]), tags: ['boundary'] });
  const now40 = T - 40 * 60_000;
  add({
    name: 'waitlist.40min-before.flash-fill-notifies-all',
    kind,
    description: 'AC-GAME-045b',
    input: { game, participants },
    now: iso(now40),
    expected: plan(now40, 'flash', [[2, T], [3, T], [4, T]]),
    tags: ['prd-v5:GAME-045'],
  });
  add({
    name: 'waitlist.regulars-first',
    kind,
    input: { game, participants, regularIds: [U(4)] },
    now: iso(now10),
    expected: plan(now10, 'standard', [[4, now10 + 2 * H]]),
    tags: ['prd-v5:GAME-044'],
  });
  add({
    name: 'waitlist.expired-offer-moves-to-next',
    kind,
    input: { game, participants, offers: [{ userId: U(2), offeredAt: iso(now10), acceptBy: iso(now10 + 2 * H), mode: 'standard' }] },
    now: iso(now10 + 2 * H),
    expected: plan(now10 + 2 * H, 'standard', [[3, now10 + 4 * H]]),
  });
  add({ name: 'waitlist.at-start.closed', kind, input: { game, participants }, now: iso(T), expected: { mode: 'closed', freeSpots: 1, offers: [], effects: [] }, tags: ['boundary'] });
}

// ---------------------------------------------------------------- checkin.verifyQr / checkin.qrToken

{
  const secret = 'golden-qr-secret';
  const gameId = G(1);
  const now = Date.parse('2026-03-01T18:00:10.000Z');
  const stepMs = 20_000; // qrStepSeconds = 20
  const step = Math.floor(now / stepMs);
  const token = (s: number) => `${s}.${createHmac('sha256', secret).update(`${gameId}|${s}`).digest('hex').slice(0, 32)}`;
  add({
    name: 'qr.token.wire-format',
    kind: 'checkin.qrToken',
    input: { qrSecret: secret, gameId },
    now: iso(now),
    description: 'expiresAt = end of the last step that still accepts the token (current + 1 past-only drift step)',
    expected: { token: token(step), step, expiresAt: iso((step + 2) * stepMs) },
  });
  const verified = { outcome: 'verified', method: 'qr', distanceM: null, signals: [] };
  const rejected = (reason: string) => ({ outcome: 'rejected', method: 'qr', reason, fallbacks: ['qr', 'peer', 'host'], signals: [] });
  // Past-only drift: the token of the current or the previous step is accepted; a future step never is.
  for (const [d, exp] of [[-1, verified], [0, verified], [1, rejected('invalid_qr')], [-2, rejected('expired_qr')], [2, rejected('invalid_qr')]] as const) {
    add({
      name: `qr.step-drift-${d < 0 ? 'minus' : 'plus'}-${Math.abs(d)}`,
      kind: 'checkin.verifyQr',
      input: { token: token(step + d), qrSecret: secret, gameId },
      now: iso(now),
      expected: exp,
      tags: ['boundary', 'security'],
    });
  }
  add({
    name: 'qr.host-scans-own-code.not-host',
    kind: 'checkin.verifyQr',
    description: 'Security fix: the host displays the code and cannot QR-verify themself',
    input: { token: token(step), qrSecret: secret, gameId, scanner: { userId: HOST, hostId: HOST } },
    now: iso(now),
    expected: { outcome: 'rejected', method: 'qr', reason: 'not_host', fallbacks: ['gps', 'peer'], signals: [] },
    tags: ['security'],
  });
  add({
    name: 'qr.player-scan.verified',
    kind: 'checkin.verifyQr',
    input: { token: token(step), qrSecret: secret, gameId, scanner: { userId: SUBJECT, hostId: HOST } },
    now: iso(now),
    expected: verified,
  });
  add({ name: 'qr.wrong-secret.invalid', kind: 'checkin.verifyQr', input: { token: token(step), qrSecret: 'rotated', gameId }, now: iso(now), expected: rejected('invalid_qr') });
}

// ---------------------------------------------------------------- checkin.verifyPeer

{
  const kind = 'checkin.verifyPeer';
  const P = (n: number, method: string | null, attendance = 'verified') => ({ userId: U(n), status: 'approved', attendance, checkInMethod: method });
  const participants = [P(1, null, 'unknown'), P(2, 'gps'), P(3, 'gps'), P(4, 'peer'), P(5, 'qr')];
  const c = (from: number, to: number) => ({ confirmerId: U(from), targetId: U(to) });
  const rej = (reason: string, confirmations: number) => ({
    confirmations,
    verdict: { outcome: 'rejected', method: 'peer', reason, fallbacks: ['qr', 'host'], signals: [] },
  });
  add({
    name: 'peer.two-gps-confirmers.verified',
    kind,
    input: { targetUserId: SUBJECT, participants, confirmations: [c(2, 1), c(3, 1)], blocks: [] },
    now: iso(T),
    expected: { confirmations: 2, verdict: { outcome: 'verified', method: 'peer', distanceM: null, signals: [] } },
  });
  add({ name: 'peer.one-confirmer.insufficient', kind, input: { targetUserId: SUBJECT, participants, confirmations: [c(2, 1)], blocks: [] }, now: iso(T), expected: rej('insufficient_peers', 1), tags: ['boundary'] });
  add({ name: 'peer.reciprocal-only', kind, input: { targetUserId: SUBJECT, participants, confirmations: [c(2, 1), c(4, 1), c(1, 4)], blocks: [] }, now: iso(T), expected: rej('reciprocal_only', 1) });
  add({
    name: 'peer.qr-verified-confirmer-not-anchor',
    kind,
    description: 'Security fix: only GPS-verified attendees anchor peer check-ins (a QR can be relayed off-site)',
    input: { targetUserId: SUBJECT, participants, confirmations: [c(2, 1), c(5, 1)], blocks: [] },
    now: iso(T),
    expected: rej('insufficient_peers', 1),
    tags: ['security'],
  });
  add({
    name: 'peer.blocked-pair-excluded',
    kind,
    input: { targetUserId: SUBJECT, participants, confirmations: [c(2, 1), c(3, 1)], blocks: [{ blockerId: SUBJECT, blockedId: U(3) }] },
    now: iso(T),
    expected: rej('blocked_pair', 1),
  });
}

// ================================================================ Phase 1.5 (contract v3)
// Times below are written from the spec: a series at 20:00 Europe/London is
// 19:00Z during BST and 20:00Z after 2026-10-25; Asia/Jerusalem is +3 until
// 2026-10-25 and +2 after.

const SERIES = '00000000-0000-4000-8000-00000000c001';
const occKey = (rev: number, date: string, sid = SERIES) => `${sid}:${rev}:${date}`;
const occGameId = (key: string) => stableUuid(`occurrence:${key}`);
const LONDON = { lat: 51.5, lng: -0.12 };

function seriesFx(o: Record<string, Json> = {}): Record<string, Json> {
  return {
    id: SERIES,
    hostId: HOST,
    sport: 'football',
    title: 'Tuesday 5-a-side',
    notes: null,
    visibility: 'public',
    venueId: null,
    location: LONDON,
    approxLocation: LONDON,
    hideExactLocation: false,
    capacity: 3,
    minPlayers: 2,
    depositMinor: 0,
    currency: 'GBP',
    depositForfeitTo: 'host',
    womenOnly: false,
    teamCount: 2,
    recurrence: 'weekly',
    weekday: 2,
    startTime: '20:00',
    timeZone: 'Europe/London',
    durationMinutes: 60,
    anchorDate: '2026-10-06',
    endDate: null,
    horizonWeeks: 4,
    rosterPriorityHours: 24,
    autoJoinReconfirmHours: 48,
    skippedDates: [],
    scheduleRevision: 0,
    status: 'active',
    inviteToken: 'tok',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...o,
  };
}

function occFx(o: { date: string; startsAt: string; now: number; rev?: number; durationMin?: number; priorityH?: number; sid?: string }): Record<string, Json> {
  const start = Date.parse(o.startsAt);
  const opens = Math.min(start, o.now);
  const key = occKey(o.rev ?? 0, o.date, o.sid);
  return {
    seriesId: o.sid ?? SERIES,
    occurrenceKey: key,
    slotDate: o.date,
    scheduleRevision: o.rev ?? 0,
    gameId: occGameId(key),
    startsAt: o.startsAt,
    endsAt: iso(start + (o.durationMin ?? 60) * 60_000),
    opensAt: iso(opens),
    priorityUntil: iso(Math.min(opens + (o.priorityH ?? 24) * H, start)),
    reconfirmAt: iso(start - 48 * H),
    releaseAt: iso(start - 24 * H),
    status: 'scheduled',
    overridden: false,
  };
}

const TEMPLATE_FIELDS = ['sport', 'title', 'notes', 'visibility', 'venueId', 'location', 'hideExactLocation', 'capacity', 'minPlayers', 'depositMinor', 'currency', 'depositForfeitTo', 'womenOnly', 'teamCount'];
function createEff(series: Record<string, Json>, occ: Record<string, Json>): Json {
  const game: Record<string, Json> = { id: occ.gameId as string, seriesId: series.id as string, hostId: series.hostId as string, approxLocation: series.approxLocation as Json, startsAt: occ.startsAt as string, endsAt: occ.endsAt as string };
  for (const f of TEMPLATE_FIELDS) game[f] = series[f] as Json;
  return { type: 'CreateOccurrence', occurrence: occ, game, dedupeKey: `occurrence:${occ.occurrenceKey as string}` };
}
const autoJoinEff = (occ: Record<string, Json>, userId: string, joinedAs: string): Json => ({
  type: 'AutoJoin', gameId: occ.gameId as string, seriesId: SERIES, userId, joinedAs, dedupeKey: `autojoin:${occ.gameId as string}:${userId}`,
});
function rosterFx(userId: string, o: Record<string, Json> = {}): Record<string, Json> {
  return { seriesId: SERIES, userId, status: 'regular', alwaysIn: true, joinedVia: 'invite_link', consecutiveMisses: 0, leaveOfferedAt: null, joinedAt: `2026-09-0${userId.slice(-1)}T10:00:00.000Z`, leftAt: null, ...o };
}

// ---------------------------------------------------------------- series.occurrences
{
  const kind = 'series.occurrences';
  const now = Date.parse('2026-10-06T12:00:00.000Z');
  const s = seriesFx();
  const london = [
    occFx({ date: '2026-10-06', startsAt: '2026-10-06T19:00:00.000Z', now }),
    occFx({ date: '2026-10-13', startsAt: '2026-10-13T19:00:00.000Z', now }),
    occFx({ date: '2026-10-20', startsAt: '2026-10-20T19:00:00.000Z', now }),
    occFx({ date: '2026-10-27', startsAt: '2026-10-27T20:00:00.000Z', now }),
  ];
  add({
    name: 'london.weekly.4-week-horizon.dst-autumn',
    kind,
    description: 'Local 20:00 stays 20:00 across the BST→GMT change on 2026-10-25; slot 2026-11-03 is beyond now + 4 weeks',
    input: { series: s, existing: [], roster: [] },
    now: iso(now),
    expected: { occurrences: london, effects: london.map((o) => createEff(s, o)) },
    tags: ['dst', 'prd-v5:GAME-010'],
  });
  const j = seriesFx({ timeZone: 'Asia/Jerusalem', recurrence: 'biweekly', anchorDate: '2026-10-13', rosterPriorityHours: 6 });
  const jNow = Date.parse('2026-10-12T00:00:00.000Z');
  const jer = [
    occFx({ date: '2026-10-13', startsAt: '2026-10-13T17:00:00.000Z', now: jNow, priorityH: 6 }),
    occFx({ date: '2026-10-27', startsAt: '2026-10-27T18:00:00.000Z', now: jNow, priorityH: 6 }),
  ];
  add({
    name: 'jerusalem.biweekly.dst-autumn.priority-6h',
    kind,
    input: { series: j, existing: [], roster: [] },
    now: iso(jNow),
    expected: { occurrences: jer, effects: jer.map((o) => createEff(j, o)) },
    tags: ['dst'],
  });
  const steadyNow = Date.parse('2026-10-06T21:00:00.000Z');
  const nov3 = occFx({ date: '2026-11-03', startsAt: '2026-11-03T20:00:00.000Z', now: steadyNow });
  add({
    name: 'steady-state.only-the-new-slot',
    kind,
    input: { series: s, existing: london, roster: [] },
    now: iso(steadyNow),
    expected: { occurrences: [nov3], effects: [createEff(s, nov3)] },
  });
  const sk = seriesFx({ skippedDates: ['2026-10-20'], endDate: '2026-10-27' });
  const other = { ...occFx({ date: '2026-10-13', startsAt: '2026-10-13T19:00:00.000Z', now, rev: 7 }) };
  add({
    name: 'skipped-ended-and-other-revision-duplicates-excluded',
    kind,
    input: { series: sk, existing: [other], roster: [] },
    now: iso(now),
    expected: { occurrences: [london[0]!, london[3]!], effects: [createEff(sk, london[0]!), createEff(sk, london[3]!)] },
  });
  add({ name: 'paused.nothing', kind, input: { series: seriesFx({ status: 'paused' }), existing: [], roster: [] }, now: iso(now), expected: { occurrences: [], effects: [] } });
  const capped = seriesFx({ capacity: 2 });
  const lateNow = Date.parse('2026-10-14T21:00:00.000Z');
  const existing = [
    occFx({ date: '2026-10-13', startsAt: '2026-10-13T19:00:00.000Z', now: lateNow }),
    occFx({ date: '2026-10-20', startsAt: '2026-10-20T19:00:00.000Z', now: lateNow }),
    occFx({ date: '2026-10-27', startsAt: '2026-10-27T20:00:00.000Z', now: lateNow }),
    occFx({ date: '2026-11-03', startsAt: '2026-11-03T20:00:00.000Z', now: lateNow }),
  ];
  const nov10 = occFx({ date: '2026-11-10', startsAt: '2026-11-10T20:00:00.000Z', now: lateNow });
  add({
    name: 'always-in.seniority.host-seat.waitlist-overflow',
    kind,
    description: 'capacity 2 = host + 1 seat; U1 (oldest) approved, U3 waitlisted; U2 ineligible, U4 not always-in, U5 only invited',
    input: {
      series: capped,
      existing,
      roster: [rosterFx(U(3)), rosterFx(U(1)), rosterFx(U(2)), rosterFx(U(4), { alwaysIn: false }), rosterFx(U(5), { status: 'invited' }), rosterFx(HOST)],
      ineligibleUserIds: [U(2)],
    },
    now: iso(lateNow),
    expected: { occurrences: [nov10], effects: [createEff(capped, nov10), autoJoinEff(nov10, U(1), 'approved'), autoJoinEff(nov10, U(3), 'waitlisted')] },
    tags: ['prd-v5:GAME-010'],
  });
  add({
    name: 'always-in.skipped-when-generated-after-reconfirm-time',
    kind,
    input: { series: s, existing: [], roster: [rosterFx(U(1))] },
    now: iso(now),
    expected: {
      occurrences: london,
      effects: [createEff(s, london[0]!), ...london.slice(1).flatMap((o) => [createEff(s, o), autoJoinEff(o, U(1), 'approved')])],
    },
  });
}

// ---------------------------------------------------------------- series.autoJoins
{
  const kind = 'series.autoJoins';
  const occ = occFx({ date: '2026-10-27', startsAt: '2026-10-27T20:00:00.000Z', now: Date.parse('2026-09-29T20:00:00.000Z') });
  const gid = occ.gameId as string;
  const rec = (userId: string, o: Record<string, Json> = {}) => ({ gameId: gid, seriesId: SERIES, userId, joinedAs: 'approved', reconfirmRequestedAt: null, reconfirmedAt: null, releasedAt: null, ...o });
  const series = { id: SERIES, title: 'Tuesday 5-a-side' };
  const notify = (userId: string, kind15: string, params: Params, gameId: string | null, dedupe: string) => ({ type: 'Notify15', userId, kind: kind15, params, gameId, seriesId: SERIES, dedupeKey: dedupe });
  const autoJoins = [rec(U(2)), rec(U(1), { reconfirmRequestedAt: '2026-10-25T20:00:00.000Z' }), rec(U(3)), rec(U(4), { reconfirmedAt: '2026-10-25T21:00:00.000Z' }), rec(U(5), { releasedAt: '2026-10-25T21:00:00.000Z' })];
  const roster = [rosterFx(U(1), { consecutiveMisses: 2 }), rosterFx(U(2)), rosterFx(U(4))];
  add({ name: 'before-t-48h.nothing', kind, input: { series, occurrence: occ, autoJoins, roster }, now: '2026-10-25T19:59:59.999Z', expected: { effects: [] } });
  const reconf = (u: string) => [
    { type: 'RequestReconfirm', gameId: gid, userId: u, deadline: occ.releaseAt as string, dedupeKey: `reconfirm:${gid}:${u}` },
    notify(u, 'series_reconfirm', { seriesTitle: 'Tuesday 5-a-side', startsAt: occ.startsAt as string, deadline: occ.releaseAt as string }, gid, `notify:series_reconfirm:${gid}:${u}`),
  ];
  add({
    name: 't-48h.requests-each-unasked-held-auto-join-once',
    kind,
    input: { series, occurrence: occ, autoJoins, roster },
    now: '2026-10-25T20:00:00.000Z',
    expected: { effects: [...reconf(U(2)), ...reconf(U(3))] },
    tags: ['prd-v5:GAME-010'],
  });
  const release = (u: string) => [
    { type: 'ReleaseAutoJoin', gameId: gid, userId: u, dedupeKey: `release:${gid}:${u}` },
    notify(u, 'series_auto_released', { seriesTitle: 'Tuesday 5-a-side', startsAt: occ.startsAt as string }, gid, `notify:series_auto_released:${gid}:${u}`),
  ];
  const relNow = '2026-10-26T20:00:00.000Z';
  add({
    name: 't-24h.release-unconfirmed.third-miss-offers-leave.no-card',
    kind,
    description: 'U1 was asked and misses for the 3rd time → leave offer (GAME-011); U2/U3 were never asked → released without a miss',
    input: { series, occurrence: occ, autoJoins, roster },
    now: relNow,
    expected: {
      effects: [
        ...release(U(1)),
        { type: 'UpdateRosterMember', seriesId: SERIES, userId: U(1), patch: { consecutiveMisses: 3, leaveOfferedAt: relNow }, dedupeKey: `roster-miss:${SERIES}:${U(1)}:${gid}` },
        notify(U(1), 'roster_leave_offer', { seriesTitle: 'Tuesday 5-a-side', misses: 3 }, null, `notify:roster_leave_offer:${SERIES}:${U(1)}:${gid}`),
        ...release(U(2)),
        ...release(U(3)),
      ],
    },
    tags: ['prd-v5:GAME-011'],
  });
  add({ name: 'after-start.nothing', kind, input: { series, occurrence: occ, autoJoins, roster }, now: occ.startsAt as string, expected: { effects: [] } });
}

// ---------------------------------------------------------------- series.joinWindow
{
  const kind = 'series.joinWindow';
  const opens = Date.parse('2026-09-29T20:00:00.000Z');
  const occ = occFx({ date: '2026-10-27', startsAt: '2026-10-27T20:00:00.000Z', now: opens });
  const roster = [rosterFx(U(1)), rosterFx(U(2), { status: 'left' }), rosterFx(U(3), { status: 'invited' })];
  const base = { series: { hostId: HOST }, occurrence: occ, roster };
  const no = { ok: false, error: 'game_not_open' };
  const prio = { ok: false, error: 'roster_priority' };
  const cases: [string, string, number, Json][] = [
    ['before-open', U(1), opens - 1, no],
    ['priority.regular-joins', U(1), opens, { ok: true, value: 'roster_only' }],
    ['priority.host', HOST, opens, { ok: true, value: 'roster_only' }],
    ['priority.left-member-waits', U(2), opens + 23 * H, prio],
    ['priority.invited-not-yet-regular-waits', U(3), opens, prio],
    ['priority.public-waits-24h', U(9), opens + 24 * H - 1, prio],
    ['open.public-after-24h', U(9), opens + 24 * H, { ok: true, value: 'open' }],
    ['closed.at-start', U(1), Date.parse(occ.startsAt as string), no],
  ];
  for (const [name, userId, now, expected] of cases) add({ name, kind, input: { ...base, userId }, now: iso(now), expected, tags: ['prd-v5:AC-GAME-010'] });
}

// ---------------------------------------------------------------- rating.* (independent Glicko-2)

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
/** Glicko outputs are compared at 6 decimals on both sides (README). */
function round6deep(v: Json): Json {
  if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v * 1e6) / 1e6;
  if (Array.isArray(v)) return v.map(round6deep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round6deep(x)]));
  return v;
}

type GP = { r: number; rd: number; sigma: number };
const Q = 173.7178;
function g2(p: GP, opp: { r: number; rd: number; s: number }[], tau: number, cap = 350): GP {
  if (opp.length === 0) return { r: p.r, rd: Math.min(cap, Q * Math.sqrt((p.rd / Q) ** 2 + p.sigma ** 2)), sigma: p.sigma };
  const mu = (p.r - 1500) / Q;
  const ph = p.rd / Q;
  const gg = (x: number) => 1 / Math.sqrt(1 + (3 * x * x) / Math.PI ** 2);
  const terms = opp.map((o) => {
    const gj = gg(o.rd / Q);
    const e = 1 / (1 + Math.exp(-gj * (mu - (o.r - 1500) / Q)));
    return { gj, e, s: o.s };
  });
  const v = 1 / terms.reduce((a, t) => a + t.gj ** 2 * t.e * (1 - t.e), 0);
  const sum = terms.reduce((a, t) => a + t.gj * (t.s - t.e), 0);
  const dl = v * sum;
  const a = Math.log(p.sigma ** 2);
  const f = (x: number) => (Math.exp(x) * (dl ** 2 - ph ** 2 - v - Math.exp(x))) / (2 * (ph ** 2 + v + Math.exp(x)) ** 2) - (x - a) / tau ** 2;
  let A = a;
  let B = dl ** 2 > ph ** 2 + v ? Math.log(dl ** 2 - ph ** 2 - v) : NaN;
  if (Number.isNaN(B)) {
    let k = 1;
    while (f(a - k * tau) < 0) k += 1;
    B = a - k * tau;
  }
  let fa = f(A);
  let fb = f(B);
  while (Math.abs(B - A) > 1e-6) {
    const C = A + ((A - B) * fa) / (fb - fa);
    const fc = f(C);
    if (fc * fb <= 0) [A, fa] = [B, fb];
    else fa /= 2;
    [B, fb] = [C, fc];
  }
  const sg = Math.exp(A / 2);
  const phNew = 1 / Math.sqrt(1 / (ph ** 2 + sg ** 2) + 1 / v);
  return { r: Q * (mu + phNew ** 2 * sum) + 1500, rd: Math.min(cap, Q * phNew), sigma: sg };
}
const lvl = (r: number) => Math.round(Math.min(7, Math.max(0, (r - 900) / 200)) * 10) / 10;

{
  const kind = 'rating.glicko2';
  add({
    name: 'glickman-2012-worked-example',
    kind,
    description: 'Paper: r′ ≈ 1464.06, RD′ ≈ 151.52, σ′ ≈ 0.05999 (numbers rounded to 6 decimals on both sides)',
    input: { player: { r: 1500, rd: 200, sigma: 0.06 }, results: [{ opponent: { r: 1400, rd: 30 }, score: 1 }, { opponent: { r: 1550, rd: 100 }, score: 0 }, { opponent: { r: 1700, rd: 300 }, score: 0 }], tau: 0.5 },
    now: iso(T),
    expected: round6deep(g2({ r: 1500, rd: 200, sigma: 0.06 }, [{ r: 1400, rd: 30, s: 1 }, { r: 1550, rd: 100, s: 0 }, { r: 1700, rd: 300, s: 0 }], 0.5, Infinity)),
    tags: ['prd-v5:GLK-007'],
  });
  add({
    name: 'idle-period.rd-grows.capped-350',
    kind,
    input: { player: { r: 1700, rd: 349.9, sigma: 0.06 }, results: [], tau: 0.5, maxRd: 350 },
    now: iso(T),
    expected: { r: 1700, rd: 350, sigma: 0.06 },
  });
  add({
    name: 'draw-between-equals.r-unchanged',
    kind,
    input: { player: { r: 1620, rd: 80, sigma: 0.06 }, results: [{ opponent: { r: 1620, rd: 80 }, score: 0.5 }], tau: 0.5 },
    now: iso(T),
    expected: round6deep(g2({ r: 1620, rd: 80, sigma: 0.06 }, [{ r: 1620, rd: 80, s: 0.5 }], 0.5, Infinity)),
  });
}

{
  const kind = 'rating.glickoPeriod';
  const PERIOD = '2026-W45';
  const now = Date.parse('2026-11-08T23:00:00.000Z');
  const game = (id: string, teams: string[][], scores: number[]) => ({ gameId: G(Number.parseInt(id, 10)), sport: 'football', formatFamily: 'small_sided', endsAt: '2026-11-03T21:00:00.000Z', teams, teamScores: scores });
  const init: GP = { r: 1500, rd: 350, sigma: 0.06 };
  const comp = (ps: GP[]) => ({ r: ps.reduce((a, p) => a + p.r, 0) / ps.length, rd: Math.sqrt(ps.reduce((a, p) => a + p.rd ** 2, 0) / ps.length) });
  const row = (userId: string, p: GP, games: number, lastPeriod: string | null) => ({ userId, sport: 'football', formatFamily: 'small_sided', ...p, games, provisional: true, level: lvl(p.r), lastPeriod, updatedAt: '2026-10-01T00:00:00.000Z' });
  const upd = (userId: string, before: GP, after: GP, gamesAdded: number, frozen = false) => ({ userId, sport: 'football', formatFamily: 'small_sided', period: PERIOD, before, after, gamesAdded, frozen, dedupeKey: `rating:${userId}:football:small_sided:${PERIOD}` });
  const newRow = (userId: string, p: GP, games: number, provisional: boolean) => ({ userId, sport: 'football', formatFamily: 'small_sided', ...p, games, provisional, level: lvl(p.r), lastPeriod: PERIOD, updatedAt: iso(now) });

  // 2v2, fresh players, 3–1 (margin ignored)
  const c = comp([init, init]);
  const win = g2(init, [{ ...c, s: 1 }], 0.5);
  const loss = g2(init, [{ ...c, s: 0 }], 0.5);
  add({
    name: 'fresh-2v2.win-loss.margin-ignored',
    kind,
    input: { period: PERIOD, games: [game('1', [[U(1), U(2)], [U(3), U(4)]], [3, 1])], ratings: [], reliability: {} },
    now: iso(now),
    expected: round6deep({
      updates: [upd(U(1), init, win, 1), upd(U(2), init, win, 1), upd(U(3), init, loss, 1), upd(U(4), init, loss, 1)],
      ratings: [newRow(U(1), win, 1, true), newRow(U(2), win, 1, true), newRow(U(3), loss, 1, true), newRow(U(4), loss, 1, true)],
    } as Json),
    tags: ['prd-v5:GLK-002'],
  });

  // AC-GLK-004: frozen U3 (reliability 0.65) unchanged; U1 rated against U3's fixed rating
  const frozen: GP = { r: 1700, rd: 80, sigma: 0.06 };
  const u1 = g2(init, [{ ...frozen, s: 1 }], 0.5);
  add({
    name: 'frozen-below-70pct.unchanged.opponent-uses-fixed-rating',
    kind,
    input: { period: PERIOD, games: [game('2', [[U(1)], [U(3)]], [1, 0])], ratings: [row(U(3), frozen, 30, '2026-W44')], reliability: { [U(3)]: 0.65, [U(1)]: 0.9 } },
    now: iso(now),
    expected: round6deep({ updates: [upd(U(1), init, u1, 1), upd(U(3), frozen, frozen, 0, true)], ratings: [newRow(U(1), u1, 1, true)] } as Json),
    tags: ['prd-v5:AC-GLK-004'],
  });

  // Idempotency + lazy idle inflation: U1 already has W45; U2 last rated W40 (4 idle weeks)
  const p1: GP = { r: 1600, rd: 60, sigma: 0.06 };
  const p2: GP = { r: 1600, rd: 60, sigma: 0.06 };
  const p2start: GP = { ...p2, rd: Math.min(350, Q * Math.sqrt((60 / Q) ** 2 + 4 * 0.06 ** 2)) };
  const u2 = g2(p2start, [{ ...p1, s: 1 }], 0.5);
  add({
    name: 'idempotent-skip.and-idle-weeks-inflate-rd',
    kind,
    input: { period: PERIOD, games: [game('3', [[U(1)], [U(2)]], [0, 2])], ratings: [row(U(1), p1, 12, PERIOD), row(U(2), p2, 12, '2026-W40')], reliability: { [U(1)]: 0.9, [U(2)]: 0.9 } },
    now: iso(now),
    expected: round6deep({ updates: [upd(U(2), p2, u2, 1)], ratings: [newRow(U(2), u2, 13, u2.rd >= 100)] } as Json),
  });

  // Display gate: reliability 0.85, ≥ 10 games and RD < 100 → not provisional
  const vet: GP = { r: 1800, rd: 70, sigma: 0.06 };
  const opp: GP = { r: 1750, rd: 70, sigma: 0.06 };
  const vAfter = g2(vet, [{ ...opp, s: 0.5 }], 0.5);
  const oAfter = g2(opp, [{ ...vet, s: 0.5 }], 0.5);
  add({
    name: 'display-gate.not-provisional-at-80pct-10-games-rd-under-100',
    kind,
    input: { period: PERIOD, games: [game('4', [[U(5)], [U(6)]], [1, 1])], ratings: [row(U(5), vet, 9, '2026-W44'), row(U(6), opp, 20, '2026-W44')], reliability: { [U(5)]: 0.85, [U(6)]: 0.79 } },
    now: iso(now),
    expected: round6deep({ updates: [upd(U(5), vet, vAfter, 1), upd(U(6), opp, oAfter, 1)], ratings: [newRow(U(5), vAfter, 10, false), newRow(U(6), oAfter, 21, true)] } as Json),
    tags: ['prd-v5:GLK-004'],
  });
}

{
  const kind = 'rating.gameEligibility';
  const ok = { sport: 'football', startsAt: '2026-11-01T19:00:00.000Z', teamScores: [3, 2], resultStatus: 'confirmed', approvedCount: 10, verifiedCount: 7, teamsPublishedAt: '2026-11-01T18:55:00.000Z', teams: [[U(1)], [U(2)]] };
  const cases: [string, Record<string, Json>, Json][] = [
    ['eligible.7-of-10-verified', {}, { eligible: true, reason: null }],
    ['ac-glk-003.6-of-10-verified', { verifiedCount: 6, resultStatus: 'pending' }, { eligible: false, reason: 'too_few_verified' }],
    ['running.unrated', { sport: 'running' }, { eligible: false, reason: 'unrated_sport' }],
    ['no-result', { teamScores: null }, { eligible: false, reason: 'no_result' }],
    ['teams-published-after-kickoff', { teamsPublishedAt: '2026-11-01T19:00:00.001Z' }, { eligible: false, reason: 'teams_not_published' }],
    ['teams-never-published', { teamsPublishedAt: null }, { eligible: false, reason: 'teams_not_published' }],
    ['one-side', { teams: [[U(1)]], teamScores: [1] }, { eligible: false, reason: 'not_two_sides' }],
    ['disputed', { resultStatus: 'disputed' }, { eligible: false, reason: 'result_disputed' }],
    ['not-yet-confirmed', { resultStatus: 'pending' }, { eligible: false, reason: 'result_not_confirmed' }],
  ];
  for (const [name, o, expected] of cases) add({ name, kind, input: { ...ok, ...o }, now: iso(T), expected, tags: ['prd-v5:GLK-003'] });
}

{
  const kind = 'rating.resultConfirmation';
  const conf = (userId: string, verdict: string, at = '2026-11-01T21:00:00.000Z') => ({ gameId: G(1), userId, verdict, createdAt: at });
  const verified = [U(1), U(2), U(3), U(4)];
  const sum = (status: string, confirms: number, disputes: number, myVerdict: string | null) => ({ gameId: G(1), status, confirms, disputes, verifiedCount: 4, myVerdict });
  add({ name: 'pending.half-is-not-a-majority', kind, input: { gameId: G(1), submittedBy: U(1), verifiedUserIds: verified, confirmations: [conf(U(2), 'confirm')], viewerId: U(2) }, now: iso(T), expected: sum('pending', 2, 0, 'confirm'), tags: ['prd-v5:GAME-071'] });
  add({ name: 'confirmed.submitter-counts', kind, input: { gameId: G(1), submittedBy: U(1), verifiedUserIds: verified, confirmations: [conf(U(2), 'confirm'), conf(U(3), 'confirm')] }, now: iso(T), expected: sum('confirmed', 3, 0, null) });
  add({
    name: 'disputed.latest-verdict-wins.outsiders-ignored',
    kind,
    input: { gameId: G(1), submittedBy: HOST, verifiedUserIds: verified, confirmations: [conf(U(2), 'dispute'), conf(U(3), 'dispute'), conf(U(4), 'confirm', '2026-11-01T20:30:00.000Z'), conf(U(4), 'dispute'), conf(U(9), 'confirm')], viewerId: U(9) },
    now: iso(T),
    expected: sum('disputed', 0, 3, null),
  });
}

{
  const kind = 'rating.peerEligibility';
  const END = '2026-11-01T20:00:00.000Z';
  const base = {
    game: { endsAt: END },
    rater: { userId: U(1), reliability: 0.85, verifiedGamesInSport: 5, hasActiveSanction: false, verifiedInGame: true },
    verifiedUserIds: [U(1), U(3), U(2), U(4)],
    blocks: [{ blockerId: U(4), blockedId: U(1) }],
    alreadyRated: [U(3)],
  };
  const out = (o: Record<string, Json>) => ({ canRate: true, reasons: [], verifiedGamesInSport: 5, requiredGames: 5, windowClosesAt: '2026-11-03T20:00:00.000Z', remainingRatees: 4, rateableUserIds: [U(2)], ...o });
  add({ name: 'eligible.excludes-self-blocked-rated', kind, input: base, now: '2026-11-01T21:00:00.000Z', expected: out({}), tags: ['prd-v5:RATE-002'] });
  add({ name: 'ac-rate-002.three-verified-games', kind, input: { ...base, rater: { ...base.rater, verifiedGamesInSport: 3 } }, now: '2026-11-01T21:00:00.000Z', expected: out({ canRate: false, reasons: ['too_few_games'], verifiedGamesInSport: 3, rateableUserIds: [] }), tags: ['prd-v5:AC-RATE-002'] });
  add({ name: 'new-rater.low-reliability', kind, input: { ...base, rater: { ...base.rater, reliability: null } }, now: '2026-11-01T21:00:00.000Z', expected: out({ canRate: false, reasons: ['low_reliability'], rateableUserIds: [] }) });
  add({ name: 'window.closes-48h-after-end', kind, input: base, now: '2026-11-03T20:00:00.001Z', expected: out({ canRate: false, reasons: ['window_closed'], rateableUserIds: [] }), tags: ['boundary'] });
  add({ name: 'window.inclusive-at-48h', kind, input: base, now: '2026-11-03T20:00:00.000Z', expected: out({}), tags: ['boundary'] });
}

{
  const kind = 'rating.peerAggregate';
  const END = Date.parse('2026-11-01T20:00:00.000Z');
  let n = 0;
  const pr = (raterId: string, rateeId: string, scores: Record<string, number>, daysAgo = 1) => ({ gameId: G(100 + n++), sport: 'football', raterId, rateeId, scores, createdAt: iso(END - daysAgo * D) });
  const self = { selfSkill: 3, attributes: { overall: 4, speed: 2 } };
  const attr = (mean: number, evidenceWeight = 0, ratingsUsed = 0) => ({ mean: r4(mean), evidenceWeight: r4(evidenceWeight), ratingsUsed });
  const summary = (attrs: Record<string, Json>, band: number, raterCount: number) => ({
    userId: U(1), sport: 'football',
    attributes: { speed: attr(2), ball_control: attr(3), passing: attr(3), defence: attr(3), overall: attr(4), ...attrs },
    band, raterCount,
  });
  add({ name: 'no-ratings.self-prior', kind, input: { userId: U(1), sport: 'football', self, received: [], given: [] }, now: iso(END), expected: summary({}, 4, 0), tags: ['prd-v5:RATE-004'] });
  add({
    name: 'bayesian-mean.prior-weight-3',
    kind,
    input: { userId: U(1), sport: 'football', self: { selfSkill: 3 }, received: [pr(U(2), U(1), { overall: 5, passing: 2 }), pr(U(3), U(1), { overall: 5 }), pr(U(4), U(1), { overall: 4 })], given: [] },
    now: iso(END),
    expected: summary({ speed: attr(3), overall: attr((9 + 14) / 6, 3, 3), passing: attr((9 + 2) / 4, 1, 1) }, 4, 3),
    tags: ['prd-v5:RATE-004'],
  });
  add({
    name: 'pair-decay.after-3-in-30-days',
    kind,
    input: { userId: U(1), sport: 'football', self: { selfSkill: 3 }, received: [10, 8, 6, 4, 2].map((d) => pr(U(2), U(1), { overall: 5 }, d)), given: [] },
    now: iso(END),
    expected: summary({ speed: attr(3), overall: attr((9 + 5 * 3.75) / 6.75, 3.75, 5) }, 4, 1),
    tags: ['prd-v5:RATE-003'],
  });
  add({
    name: 'reciprocal-all-max.down-weighted',
    kind,
    input: { userId: U(1), sport: 'football', self: { selfSkill: 3 }, received: [pr(U(2), U(1), { overall: 5 }), pr(U(3), U(1), { overall: 3 })], given: [pr(U(1), U(2), { overall: 5 })] },
    now: iso(END),
    expected: summary({ speed: attr(3), overall: attr((9 + 2.5 + 3) / 4.5, 1.5, 2) }, 3, 2),
    tags: ['prd-v5:RATE-003'],
  });
  add({
    name: 'outlier-beyond-2-sigma.trimmed',
    kind,
    input: { userId: U(1), sport: 'football', self: { selfSkill: 3 }, received: [...[2, 3, 4, 5, 6, 7, 8, 9].map((u) => pr(U(u), U(1), { overall: 4 })), pr(U(10), U(1), { overall: 1 })], given: [] },
    now: iso(END),
    expected: summary({ speed: attr(3), overall: attr((9 + 32) / 11, 8, 8) }, 4, 8),
    tags: ['prd-v5:RATE-003'],
  });
}

// ---------------------------------------------------------------- vault.*
const MiB = 1024 * 1024;
{
  const kind = 'vault.upload';
  const game = { startsAt: '2026-11-01T18:00:00.000Z', endsAt: '2026-11-01T20:00:00.000Z' };
  const photo = { gameId: G(1), kind: 'photo', mimeType: 'image/jpeg', sizeBytes: 5 * MiB };
  const video = { gameId: G(1), kind: 'video', mimeType: 'video/mp4', sizeBytes: 100 * MiB, durationSeconds: 30 };
  const base = { game, verifiedAttendee: true, request: photo, existingCount: 0 };
  const okP = { ok: true, value: { maxBytes: 20 * MiB } };
  const fail = (e: string) => ({ ok: false, error: e });
  const cases: [string, Record<string, Json>, string, Json][] = [
    ['photo.ok-at-end', {}, game.endsAt, okP],
    ['ac-vault-001.locked-2h-after.22-05', {}, '2026-11-01T22:05:00.000Z', fail('window_closed')],
    ['window.inclusive-at-end-plus-2h', {}, '2026-11-01T22:00:00.000Z', okP],
    ['window.before-start', {}, '2026-11-01T17:59:59.999Z', fail('window_not_open')],
    ['not-a-verified-attendee', { verifiedAttendee: false }, game.endsAt, fail('not_verified_attendee')],
    ['photo.over-20mb', { request: { ...photo, sizeBytes: 20 * MiB + 1 } }, game.endsAt, fail('too_large')],
    ['photo.gif-unsupported', { request: { ...photo, mimeType: 'image/gif' } }, game.endsAt, fail('unsupported_type')],
    ['video.ok', { request: video }, game.endsAt, { ok: true, value: { maxBytes: 200 * MiB } }],
    ['video.61s-too-long', { request: { ...video, durationSeconds: 61 } }, game.endsAt, fail('too_long')],
    ['video.over-200mb', { request: { ...video, sizeBytes: 200 * MiB + 1 } }, game.endsAt, fail('too_large')],
    ['cap.30-per-user-per-game', { existingCount: 30 }, game.endsAt, fail('user_cap_reached')],
    ['cap.29-still-ok', { existingCount: 29 }, game.endsAt, okP],
  ];
  for (const [name, o, now, expected] of cases) add({ name, kind, input: { ...base, ...o }, now, expected, tags: ['prd-v5:VAULT-001'] });
}

const mediaFx = (o: Record<string, Json> = {}) => ({
  id: 'm1', gameId: G(1), venueId: VENUE, uploaderId: U(1), kind: 'photo', status: 'published', visibility: 'participants', publicOptIn: false,
  mimeType: 'image/jpeg', sizeBytes: MiB, durationSeconds: null, storagePath: 'media/m1.jpg', createdAt: '2026-11-01T20:00:00.000Z',
  publishedAt: '2026-11-01T20:00:00.000Z', expiresAt: '2027-11-01T20:00:00.000Z', removedAt: null, ...o,
});
const tagFx = (userId: string, status: string, vetoPublic = false) => ({ mediaId: 'm1', userId, taggedBy: U(1), status, vetoPublic, createdAt: '2026-11-01T20:00:00.000Z', decidedAt: null });

{
  const kind = 'vault.visibility';
  const now = '2026-11-01T21:00:00.000Z';
  const visEff = (v: string) => ({ type: 'SetMediaVisibility', mediaId: 'm1', visibility: v, dedupeKey: `media-visibility:m1:${v}:${now}` });
  add({
    name: 'ac-vault-004.two-of-three-accepted.stays-participants',
    kind,
    input: { item: mediaFx(), tags: [tagFx(U(2), 'accepted'), tagFx(U(3), 'accepted'), tagFx(U(4), 'requested')], requested: 'venue_public', actorId: U(1) },
    now,
    expected: { ok: true, value: { item: mediaFx({ publicOptIn: true }), tags: [tagFx(U(2), 'accepted'), tagFx(U(3), 'accepted'), tagFx(U(4), 'requested')], effects: [], pendingUserIds: [U(4)] } },
    tags: ['prd-v5:AC-VAULT-004'],
  });
  add({
    name: 'all-accepted.promoted',
    kind,
    input: { item: mediaFx(), tags: [tagFx(U(2), 'accepted'), tagFx(U(3), 'removed')], requested: 'venue_public', actorId: U(1) },
    now,
    expected: { ok: true, value: { item: mediaFx({ publicOptIn: true, visibility: 'venue_public' }), tags: [tagFx(U(2), 'accepted'), tagFx(U(3), 'removed')], effects: [visEff('venue_public')], pendingUserIds: [] } },
  });
  add({
    name: 'veto.declined-or-removed-from-public.blocks',
    kind,
    input: { item: mediaFx(), tags: [tagFx(U(2), 'declined', true), tagFx(U(3), 'removed', true)], requested: 'venue_public', actorId: U(1) },
    now,
    expected: { ok: true, value: { item: mediaFx({ publicOptIn: true }), tags: [tagFx(U(2), 'declined', true), tagFx(U(3), 'removed', true)], effects: [], pendingUserIds: [U(2), U(3)] } },
    tags: ['prd-v5:VAULT-005'],
  });
  add({
    name: 'opt-out.demoted',
    kind,
    input: { item: mediaFx({ publicOptIn: true, visibility: 'venue_public' }), tags: [], requested: 'participants', actorId: U(1) },
    now,
    expected: { ok: true, value: { item: mediaFx(), tags: [], effects: [visEff('participants')], pendingUserIds: [] } },
  });
  add({ name: 'not-uploader', kind, input: { item: mediaFx(), tags: [], requested: 'venue_public', actorId: U(2) }, now, expected: { ok: false, error: 'not_uploader' } });
  add({ name: 'blocked-item', kind, input: { item: mediaFx({ status: 'blocked' }), tags: [], requested: 'venue_public', actorId: U(1) }, now, expected: { ok: false, error: 'not_published' } });
}

{
  const kind = 'vault.verdict';
  const now = '2026-11-01T21:00:00.000Z';
  const verdict = (decision: string) => ({ decision, categories: [], exifStripped: true, csamHashMatch: decision === 'csam', source: decision === 'csam' ? 'hash' : 'vision', reasonKey: null });
  const processing = mediaFx({ status: 'processing', publishedAt: null, publicOptIn: true });
  add({
    name: 'publish.opted-in-no-tags.venue-public',
    kind,
    input: { item: processing, tags: [], verdict: verdict('publish') },
    now,
    expected: {
      item: mediaFx({ status: 'published', publishedAt: now, publicOptIn: true, visibility: 'venue_public' }),
      effects: [
        { type: 'SetMediaStatus', mediaId: 'm1', status: 'published', dedupeKey: 'media-status:m1:published' },
        { type: 'SetMediaVisibility', mediaId: 'm1', visibility: 'venue_public', dedupeKey: `media-visibility:m1:venue_public:${now}` },
      ],
    },
  });
  add({
    name: 'block.policy.notifies-uploader',
    kind,
    input: { item: processing, tags: [], verdict: verdict('block') },
    now,
    expected: {
      item: mediaFx({ status: 'blocked', publishedAt: null, publicOptIn: true }),
      effects: [
        { type: 'SetMediaStatus', mediaId: 'm1', status: 'blocked', dedupeKey: 'media-status:m1:blocked' },
        { type: 'Notify15', userId: U(1), kind: 'media_blocked', params: { mediaId: 'm1', reasonKey: 'media.blocked.policy' }, gameId: G(1), seriesId: null, dedupeKey: 'notify:media_blocked:m1' },
      ],
    },
  });
  add({
    name: 'ac-vault-003.csam.block-preserve-restrict-review',
    kind,
    input: { item: processing, tags: [], verdict: verdict('csam') },
    now,
    expected: {
      item: mediaFx({ status: 'blocked', publishedAt: null, publicOptIn: true }),
      effects: [
        { type: 'SetMediaStatus', mediaId: 'm1', status: 'blocked', dedupeKey: 'media-status:m1:blocked' },
        { type: 'PreserveMediaEvidence', mediaId: 'm1', uploaderId: U(1), dedupeKey: 'preserve:m1' },
        { type: 'RestrictAccountPendingReview', userId: U(1), reason: 'csam_match', dedupeKey: 'restrict:media_csam:m1' },
        {
          type: 'EnqueueReview',
          item: { kind: 'media_csam', priority: 'high', subjectUserId: U(1), venueId: VENUE, gameId: G(1), sanctionId: null, appealId: null, reportIds: [], evidence: { mediaId: 'm1', csamHashMatch: true, source: 'hash' }, dueBy: '2026-11-01T22:00:00.000Z', dedupeKey: 'media_csam:m1' },
        },
        { type: 'Audit', action: 'media.csam_blocked', subjectUserId: U(1), data: { mediaId: 'm1', gameId: G(1) } },
      ],
    },
    tags: ['prd-v5:AC-VAULT-003'],
  });
}

// ---------------------------------------------------------------- network.*
{
  const kind = 'network.playedWith';
  const now = Date.parse('2026-11-01T12:00:00.000Z');
  const ago = (d: number) => iso(now - d * D);
  const a = (gameId: string, userId: string, verified: boolean, endsAt: string) => ({ gameId, userId, verified, endsAt });
  add({
    name: 'co-verified.365-days.blocks-excluded',
    kind,
    input: {
      attendance: [
        a('g1', U(1), true, ago(10)), a('g1', U(2), true, ago(10)), a('g1', U(3), false, ago(10)), a('g1', U(4), true, ago(10)),
        a('g2', U(2), true, ago(3)), a('g2', U(1), true, ago(3)),
        a('g3', U(1), true, ago(366)), a('g3', U(3), true, ago(366)),
        a('g4', U(1), true, ago(365)), a('g4', U(5), true, ago(365)),
      ],
      blocks: [{ blockerId: U(4), blockedId: U(2) }],
    },
    now: iso(now),
    expected: [
      { userA: U(1), userB: U(2), gamesTogether: 2, lastPlayedAt: ago(3) },
      { userA: U(1), userB: U(4), gamesTogether: 1, lastPlayedAt: ago(10) },
      { userA: U(1), userB: U(5), gamesTogether: 1, lastPlayedAt: ago(365) },
    ],
    tags: ['prd-v5:GAME-032'],
  });
}

{
  const kind = 'network.friend';
  const now = '2026-11-01T12:00:00.000Z';
  const conn = (o: Record<string, Json> = {}) => ({ userA: U(1), userB: U(2), gamesTogether: 2, lastPlayedAt: '2026-10-30T20:00:00.000Z', friendStatus: null, friendRequestedBy: null, friendRequestedAt: null, friendAcceptedAt: null, ...o });
  const requested = conn({ friendStatus: 'requested', friendRequestedBy: U(1), friendRequestedAt: '2026-10-31T00:00:00.000Z' });
  const upsert = (c: Json, action: string) => ({ type: 'UpsertConnection', connection: c, dedupeKey: `connection:${U(1)}:${U(2)}:${action}:${now}` });
  const notify = (userId: string, k: string, actor: string) => ({ type: 'Notify15', userId, kind: k, params: { userId: actor }, gameId: null, seriesId: null, dedupeKey: `notify:${k}:${U(1)}:${U(2)}:${now}` });
  const reqd = conn({ friendStatus: 'requested', friendRequestedBy: U(2), friendRequestedAt: now, friendAcceptedAt: null });
  add({ name: 'request.after-playing-together', kind, input: { connection: conn(), actor: U(2), other: U(1), action: 'request', blocks: [] }, now, expected: { ok: true, value: { connection: reqd, effects: [upsert(reqd, 'request'), notify(U(1), 'friend_request', U(2))] } } });
  const acc = { ...requested, friendStatus: 'accepted', friendAcceptedAt: now };
  add({ name: 'accept.incoming', kind, input: { connection: requested, actor: U(2), other: U(1), action: 'accept', blocks: [] }, now, expected: { ok: true, value: { connection: acc, effects: [upsert(acc, 'accept'), notify(U(1), 'friend_accepted', U(2))] } } });
  add({ name: 'mutual-request.auto-accepts', kind, input: { connection: requested, actor: U(2), other: U(1), action: 'request', blocks: [] }, now, expected: { ok: true, value: { connection: acc, effects: [upsert(acc, 'request'), notify(U(1), 'friend_accepted', U(2))] } } });
  const cleared = conn();
  add({ name: 'decline.clears', kind, input: { connection: requested, actor: U(2), other: U(1), action: 'decline', blocks: [] }, now, expected: { ok: true, value: { connection: cleared, effects: [{ type: 'DeleteFriendship', userA: U(1), userB: U(2), dedupeKey: `unfriend:${U(1)}:${U(2)}:decline:${now}` }] } } });
  add({ name: 'blocked.cannot-request', kind, input: { connection: conn(), actor: U(1), other: U(2), action: 'request', blocks: [{ blockerId: U(2), blockedId: U(1) }] }, now, expected: { ok: false, error: 'blocked' }, tags: ['blocks-override'] });
  add({ name: 'blocked.cannot-accept', kind, input: { connection: requested, actor: U(2), other: U(1), action: 'accept', blocks: [{ blockerId: U(1), blockedId: U(2) }] }, now, expected: { ok: false, error: 'blocked' }, tags: ['blocks-override'] });
  add({ name: 'never-played.forbidden', kind, input: { connection: null, actor: U(1), other: U(3), action: 'request', blocks: [] }, now, expected: { ok: false, error: 'forbidden' } });
  add({ name: 'duplicate-request.conflict', kind, input: { connection: requested, actor: U(1), other: U(2), action: 'request', blocks: [] }, now, expected: { ok: false, error: 'conflict' } });
}

{
  const kind = 'network.friendsGames';
  const now = Date.parse('2026-11-01T12:00:00.000Z');
  const inDays = (d: number) => iso(now + d * D);
  const friend = (a: string, b: string, status = 'accepted') => ({ ...(a < b ? { userA: a, userB: b } : { userA: b, userB: a }), gamesTogether: 1, lastPlayedAt: null, friendStatus: status, friendRequestedBy: a, friendRequestedAt: null, friendAcceptedAt: null });
  const cand = (ownerId: string, id: string, o: Record<string, Json> = {}) => ({ ownerId, game: { id, hostId: HOST, visibility: 'public', status: 'scheduled', startsAt: inDays(2), ...o } });
  const candidates = [
    cand(U(2), 'g2', { startsAt: inDays(3) }),
    cand(U(3), 'g3'),
    cand(U(4), 'g4'),
    cand(U(2), 'g1'),
    cand(U(2), 'g5', { visibility: 'private' }),
    cand(U(2), 'g6', { startsAt: inDays(-1) }),
    cand(U(2), 'g7', { status: 'cancelled' }),
    cand(U(2), 'g8', { hostId: U(8) }),
  ];
  add({
    name: 'friends-only.privacy.blocks.public-upcoming',
    kind,
    description: 'U3 shares with nobody, U4 is only requested, U8 (host of g8) blocked the viewer',
    input: {
      viewerId: U(1),
      candidates,
      connections: [friend(U(1), U(2)), friend(U(3), U(1)), friend(U(1), U(4), 'requested')],
      privacy: { [U(3)]: { upcomingGamesVisibleTo: 'nobody' } },
      blocks: [{ blockerId: U(8), blockedId: U(1) }],
    },
    now: iso(now),
    expected: [cand(U(2), 'g1'), cand(U(2), 'g2', { startsAt: inDays(3) })],
  });
  add({
    name: 'blocked-friend.hidden',
    kind,
    input: { viewerId: U(1), candidates, connections: [friend(U(1), U(2))], privacy: {}, blocks: [{ blockerId: U(1), blockedId: U(2) }] },
    now: iso(now),
    expected: [],
    tags: ['blocks-override'],
  });
}

// ---------------------------------------------------------------- write

mkdirSync(OUT, { recursive: true });
let total = 0;
for (const [kind, list] of Object.entries(cases)) {
  const names = new Set<string>();
  for (const c of list) {
    if (names.has(c.name)) throw new Error(`duplicate golden name ${kind}/${c.name}`);
    names.add(c.name);
  }
  writeFileSync(join(OUT, `${kind}.json`), `${JSON.stringify(list, null, 2)}\n`);
  total += list.length;
}
console.log(`wrote ${total} golden cases in ${Object.keys(cases).length} files to ${OUT}`);
