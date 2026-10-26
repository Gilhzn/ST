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
  if (proj) out.push({ type: proj, userId: f('userId'), until: f('expiresAt') });
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
  const att = (n: number, extra: Record<string, Json> = {}) => ({ gameId: G(1), userId: U(n), status: 'approved', attendance: 'verified', team: null, ...extra });
  const reports = [rep(1, 2, 20), rep(2, 3, 10), rep(3, 4, 1)];
  const profiles = [prof(2, 30), prof(3, 60), prof(4, 90)];
  const attendance = [att(1), att(2), att(3), att(4)];
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
    name: 'reports.rival-team-brigading.review-only',
    kind,
    input: {
      reports,
      reporterProfiles: profiles,
      context: { attendance: [att(1, { team: 0 }), att(2, { team: 1 }), att(3, { team: 1 }), att(4, { team: 1 })] },
    },
    now: iso(T),
    expected: { outcome: 'review_only', qualifyingReporterIds: [U(2), U(3), U(4)], effects: [collusionReview('rival_team', 3)] },
    tags: ['prd-v5:TRUST-042'],
  });
  add({
    name: 'reports.reporter-not-checked-in-at-game.does-not-count',
    kind,
    description: 'PRD v5 TRUST-041: reporters count only if checked in at the same game as the subject',
    input: { reports, reporterProfiles: profiles, context: { attendance: [att(1), att(2), att(3), att(4, { attendance: 'no_show_unverified' })] } },
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
  const venue = (reports: Json[], extra: Record<string, Json> = {}) => ({ venueId: VENUE, status: 'active', createdBy: HOST, lastReviewedAt: null, reports, ...extra });
  add({
    name: 'venue.3-distinct-reporters.auto-hide',
    kind,
    input: { venue: venue([vr(1, 2), vr(2, 3, 'closed'), vr(3, 4)]) },
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
  add({ name: 'venue.2-reporters.stays-active', kind, input: { venue: venue([vr(1, 2), vr(2, 3)]) }, now: iso(T), expected: { hide: false, effects: [] }, tags: ['boundary'] });
  add({ name: 'venue.same-reporter-twice.not-distinct', kind, input: { venue: venue([vr(1, 2), vr(2, 3), vr(3, 3)]) }, now: iso(T), expected: { hide: false, effects: [] } });
  add({ name: 'venue.creator-report-excluded', kind, input: { venue: venue([vr(1, 2), vr(2, 3), vr(3, 0xff)]) }, now: iso(T), expected: { hide: false, effects: [] } });
  add({
    name: 'venue.reports-before-last-review-consumed',
    kind,
    input: { venue: venue([vr(1, 2), vr(2, 3), vr(3, 4)], { lastReviewedAt: iso(T - 7.5 * H) }) },
    now: iso(T),
    expected: { hide: false, effects: [] },
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
          params: { average: 2, ratings: 5, days: 30 },
          now: T,
          durationMs: 30 * D,
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
        evidence: { reason: 'low_host_rating', ratingCount: 5, averageRating: 2 },
      }),
    ],
  }, ['boundary']);
  run('host.avg-2.2-over-5.none', [2, 2, 2, 3, 2], { outcome: 'none', reasonCode: null, effects: [] }, ['boundary']);
  run('host.avg-1.0-over-4.none', [1, 1, 1, 1], { outcome: 'none', reasonCode: null, effects: [] }, ['boundary']);
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
    kind: 'waitlist_promoted',
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
  const step = Math.floor(now / 30_000);
  const token = (s: number) => `${s}.${createHmac('sha256', secret).update(`${gameId}|${s}`).digest('hex').slice(0, 32)}`;
  add({
    name: 'qr.token.wire-format',
    kind: 'checkin.qrToken',
    input: { qrSecret: secret, gameId },
    now: iso(now),
    expected: { token: token(step), step, expiresAt: iso((step + 1) * 30_000) },
  });
  const verified = { outcome: 'verified', method: 'qr', distanceM: null, signals: [] };
  const rejected = (reason: string) => ({ outcome: 'rejected', method: 'qr', reason, fallbacks: ['qr', 'peer', 'host'], signals: [] });
  for (const [d, exp] of [[-1, verified], [0, verified], [1, verified], [-2, rejected('expired_qr')], [2, rejected('expired_qr')]] as const) {
    add({ name: `qr.step-drift-${d < 0 ? 'minus' : 'plus'}-${Math.abs(d)}`, kind: 'checkin.verifyQr', input: { token: token(step + d), qrSecret: secret, gameId }, now: iso(now), expected: exp, tags: ['boundary'] });
  }
  add({ name: 'qr.wrong-secret.invalid', kind: 'checkin.verifyQr', input: { token: token(step), qrSecret: 'rotated', gameId }, now: iso(now), expected: rejected('invalid_qr') });
}

// ---------------------------------------------------------------- checkin.verifyPeer

{
  const kind = 'checkin.verifyPeer';
  const P = (n: number, method: string | null, attendance = 'verified') => ({ userId: U(n), status: 'approved', attendance, checkInMethod: method });
  const participants = [P(1, null, 'unknown'), P(2, 'gps'), P(3, 'qr'), P(4, 'peer')];
  const c = (from: number, to: number) => ({ confirmerId: U(from), targetId: U(to) });
  const rej = (reason: string, confirmations: number) => ({
    confirmations,
    verdict: { outcome: 'rejected', method: 'peer', reason, fallbacks: ['qr', 'host'], signals: [] },
  });
  add({
    name: 'peer.two-gps-qr-confirmers.verified',
    kind,
    input: { targetUserId: SUBJECT, participants, confirmations: [c(2, 1), c(3, 1)], blocks: [] },
    now: iso(T),
    expected: { confirmations: 2, verdict: { outcome: 'verified', method: 'peer', distanceM: null, signals: [] } },
  });
  add({ name: 'peer.one-confirmer.insufficient', kind, input: { targetUserId: SUBJECT, participants, confirmations: [c(2, 1)], blocks: [] }, now: iso(T), expected: rej('insufficient_peers', 1), tags: ['boundary'] });
  add({ name: 'peer.reciprocal-only', kind, input: { targetUserId: SUBJECT, participants, confirmations: [c(2, 1), c(4, 1), c(1, 4)], blocks: [] }, now: iso(T), expected: rej('reciprocal_only', 1) });
  add({
    name: 'peer.blocked-pair-excluded',
    kind,
    input: { targetUserId: SUBJECT, participants, confirmations: [c(2, 1), c(3, 1)], blocks: [{ blockerId: SUBJECT, blockedId: U(3) }] },
    now: iso(T),
    expected: rej('blocked_pair', 1),
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
