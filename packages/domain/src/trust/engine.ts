/**
 * The trust engine reducer:
 * `applyTrustEvent(state, event, config, now) → { state, effects }`.
 *
 * `TrustState` is a snapshot of everything the rules need about one **subject
 * user** (the event's user / report target / rated host / venue creator),
 * loaded by the adapter. The reducer is pure and idempotent: replaying an event
 * yields the same state and no new effects (sanctions and review items are keyed
 * by `dedupeKey`, and the state records what was already applied).
 *
 * New sanctions/review items appear in the returned state with ids from
 * `deriveSanctionId` / `deriveReviewItemId`; adapters must insert them with those
 * ids so later `causedBy` / `sanctionId` references resolve.
 */
import {
  DEFAULT_TRUST_CONFIG,
  StError,
  type Appeal,
  type Effect,
  type EpochMs,
  type GameId,
  type NewSanction,
  type ReviewQueueItem,
  type Sanction,
  type SanctionId,
  type SanctionKind,
  type TrustConfig,
  type UserId,
  type UserReport,
} from '../types';
import { isLateCancel } from '../games/windows';
import { DAY_MS, HOUR_MS, toEpochMs } from '../time';
import { evaluateChatBlocks, type ChatBlockRecord } from './chat';
import { AUTO_VOID_LOOKBACK_DAYS, AUTO_VOID_MAX_DISPUTES, DISPUTE_AUTO_VOID_DAYS } from './constants';
import { evaluateEscalation } from './escalation';
import type { DomainTrustEvent } from './events';
import { evaluateHostReliability, type HostRatingRecord } from './host';
import { evaluateReports, type GameAttendanceRecord, type OverturnRecord, type ReporterProfile } from './reports';
import {
  buildModeratorPermanentBan,
  buildReviewItem,
  buildSystemSanction,
  canDispute,
  isInForce,
  isProjectedKind,
  issueEffects,
  materializeReviewItem,
  materializeSanction,
  projectionEffect,
} from './sanctions';
import { evaluateVenueReports, isConfirmedFake, type VenueTrustRecord } from './venues';

/** A deposit settlement already applied (idempotency for `SettleDeposit`). */
export interface DepositSettlementRecord {
  gameId: GameId;
  outcome: 'release' | 'forfeit';
}

/** A late cancel awaiting finalisation (see `LateCancelFinalized`). */
export interface PendingLateCancel {
  gameId: GameId;
  startsAt: string;
  cancelledAt: string;
}

/** Snapshot of one subject user's trust data. Every list defaults to empty. */
export interface TrustState {
  userId: UserId;
  sanctions: readonly Sanction[];
  appeals: readonly Appeal[];
  chatBlocks: readonly ChatBlockRecord[];
  /** Reports about the user. */
  reports: readonly UserReport[];
  reporterProfiles: readonly ReporterProfile[];
  /** Participations in games named by the reports (co-attendance checks). */
  attendance: readonly GameAttendanceRecord[];
  hostRatings: readonly HostRatingRecord[];
  reviewItems: readonly ReviewQueueItem[];
  /** Venues relevant to the event (reported venue; venues the user created). */
  venues: readonly VenueTrustRecord[];
  overturns: readonly OverturnRecord[];
  depositSettlements: readonly DepositSettlementRecord[];
  pendingLateCancels: readonly PendingLateCancel[];
}

export interface TrustResult {
  state: TrustState;
  effects: Effect[];
}

/** Builds a state with every list empty, overridden by `partial` (e.g. a golden case's `state`). */
export function createTrustState(userId: UserId, partial: Partial<Omit<TrustState, 'userId'>> = {}): TrustState {
  return {
    userId,
    sanctions: [],
    appeals: [],
    chatBlocks: [],
    reports: [],
    reporterProfiles: [],
    attendance: [],
    hostRatings: [],
    reviewItems: [],
    venues: [],
    overturns: [],
    depositSettlements: [],
    pendingLateCancels: [],
    ...partial,
  };
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K] };

/** Working copy + effect sink that keeps the state in sync with emitted effects. */
class Ctx {
  readonly st: Mutable<TrustState>;
  readonly effects: Effect[] = [];
  constructor(
    state: TrustState,
    readonly config: TrustConfig,
    readonly now: EpochMs,
  ) {
    const s = createTrustState(state.userId, state);
    this.st = {
      userId: s.userId,
      sanctions: [...s.sanctions],
      appeals: [...s.appeals],
      chatBlocks: [...s.chatBlocks],
      reports: [...s.reports],
      reporterProfiles: [...s.reporterProfiles],
      attendance: [...s.attendance],
      hostRatings: [...s.hostRatings],
      reviewItems: [...s.reviewItems],
      venues: [...s.venues],
      overturns: [...s.overturns],
      depositSettlements: [...s.depositSettlements],
      pendingLateCancels: [...s.pendingLateCancels],
    };
  }

  hasSanction(key: string): boolean {
    return this.st.sanctions.some((s) => s.dedupeKey === key);
  }

  /** Emits effects, dropping duplicates of sanctions / review items already in state. */
  emit(effects: readonly Effect[]): void {
    const dupSanctions = new Set<string>();
    for (const e of effects) {
      if (e.type === 'IssueSanction' && this.hasSanction(e.sanction.dedupeKey)) dupSanctions.add(e.sanction.dedupeKey);
    }
    for (const e of effects) {
      if (e.type === 'IssueSanction') {
        if (dupSanctions.has(e.sanction.dedupeKey)) continue;
        this.st.sanctions.push(materializeSanction(e.sanction, this.now));
      } else if (e.type === 'Notify' && e.sanctionDedupeKey !== null && dupSanctions.has(e.sanctionDedupeKey)) {
        continue;
      } else if (e.type === 'EnqueueReview') {
        if (this.st.reviewItems.some((r) => r.dedupeKey === e.item.dedupeKey)) continue;
        this.st.reviewItems.push(materializeReviewItem(e.item, this.now));
      } else if (e.type === 'SetSanctionStatus') {
        const i = this.st.sanctions.findIndex((s) => s.id === e.sanctionId);
        const cur = this.st.sanctions[i];
        if (!cur || cur.status === e.status) continue;
        this.st.sanctions[i] = { ...cur, status: e.status };
      } else if (e.type === 'SetVenueStatus') {
        this.st.venues = this.st.venues.map((v) => (v.venueId === e.venueId ? { ...v, status: e.status } : v));
      } else if (e.type === 'SettleDeposit') {
        const last = this.lastSettlement(e.gameId);
        if (last === e.outcome) continue;
        this.st.depositSettlements.push({ gameId: e.gameId, outcome: e.outcome });
      }
      this.effects.push(e);
    }
  }

  lastSettlement(gameId: GameId): 'release' | 'forfeit' | undefined {
    for (let i = this.st.depositSettlements.length - 1; i >= 0; i--) {
      const s = this.st.depositSettlements[i] as DepositSettlementRecord;
      if (s.gameId === gameId) return s.outcome;
    }
    return undefined;
  }

  result(): TrustResult {
    return { state: this.st, effects: this.effects };
  }
}

function assertSubject(state: TrustState, userId: UserId, what: string): void {
  if (state.userId !== userId) {
    throw new StError('validation', `TrustState is for ${state.userId}, but the ${what} is about ${userId}`);
  }
}

const DEPOSIT_REASONS = new Set(['no_show', 'late_cancel']);

/** Issues a yellow card (escalation happens later, once the card is settled). */
function issueYellowCard(
  ctx: Ctx,
  args: { reasonCode: 'late_cancel' | 'no_show'; gameId: GameId; statementParams: Readonly<Record<string, string | number>> },
): void {
  const { config, now } = ctx;
  const card: NewSanction = buildSystemSanction(
    {
      kind: 'yellow_card',
      userId: ctx.st.userId,
      reasonCode: args.reasonCode,
      statementParams: { ...args.statementParams, disputeHours: config.disputeWindowHours },
      durationMs: config.yellowCardLifetimeDays * DAY_MS,
      disputeMs: config.disputeWindowHours * HOUR_MS,
      gameId: args.gameId,
      dedupeKey: `${args.reasonCode}:${args.gameId}:${ctx.st.userId}`,
    },
    now,
  );
  ctx.emit(issueEffects(card));
}

function settle(ctx: Ctx, gameId: GameId | null, outcome: 'release' | 'forfeit'): void {
  if (gameId === null) return;
  ctx.emit([{ type: 'SettleDeposit', gameId, userId: ctx.st.userId, outcome }]);
}

/** Recomputes projections for `kinds` after some sanctions stopped being in force. */
function reproject(ctx: Ctx, kinds: readonly SanctionKind[]): void {
  if (kinds.length === 0) return;
  const effects: Effect[] = [{ type: 'LiftRestrictions', userId: ctx.st.userId, kinds: [...kinds] }];
  for (const kind of kinds) {
    if (!isProjectedKind(kind)) continue;
    const remaining = ctx.st.sanctions.filter((s) => s.kind === kind && isInForce(s, ctx.now) && s.expiresAt !== null);
    const until = remaining.map((s) => s.expiresAt as string).sort().pop();
    if (until) effects.push(projectionEffect(kind, ctx.st.userId, until));
  }
  ctx.emit(effects);
}

/** Overturns a sanction and, transitively, every sanction listing it in `causedBy`. Returns the overturned ids. */
function overturnCascade(ctx: Ctx, rootId: SanctionId, at: string): SanctionId[] {
  const ids: SanctionId[] = [rootId];
  for (let grew = true; grew; ) {
    grew = false;
    for (const s of ctx.st.sanctions) {
      if (!ids.includes(s.id) && s.causedBy.some((c) => ids.includes(c))) {
        ids.push(s.id);
        grew = true;
      }
    }
  }
  const touched = ctx.st.sanctions.filter((s) => ids.includes(s.id) && s.status !== 'overturned');
  ctx.emit(touched.map((s) => ({ type: 'SetSanctionStatus', sanctionId: s.id, status: 'overturned' }) as Effect));
  for (const s of touched) ctx.st.overturns.push({ sanctionId: s.id, at });
  const kinds = [...new Set(touched.filter((s) => s.kind !== 'yellow_card').map((s) => s.kind))];
  reproject(ctx, kinds);
  for (const s of touched) {
    if (s.kind !== 'yellow_card' || !DEPOSIT_REASONS.has(s.reasonCode) || s.gameId === null) continue;
    if (s.reasonCode === 'no_show') {
      ctx.emit([{ type: 'SetAttendance', gameId: s.gameId, userId: s.userId, attendance: 'excused' }]);
    }
    settle(ctx, s.gameId, 'release');
  }
  return touched.map((s) => s.id);
}

function decisionNotice(
  ctx: Ctx,
  sanction: Sanction,
  decision: string,
  appealId: string | null,
): Effect {
  return {
    type: 'Notify',
    userId: ctx.st.userId,
    kind: appealId ? 'appeal_decided' : 'sanction_decided',
    params: { decision, sanctionKind: sanction.kind, reasonCode: sanction.reasonCode, statementKey: sanction.statementKey },
    gameId: sanction.gameId,
    sanctionDedupeKey: sanction.dedupeKey,
  };
}

function runEscalation(ctx: Ctx): void {
  ctx.emit(evaluateEscalation(ctx.st.sanctions, ctx.now, ctx.config).effects);
}

function onTick(ctx: Ctx): void {
  const { now } = ctx;
  // 1. TRUST-023: undecided disputes void the card after DISPUTE_AUTO_VOID_DAYS (first N disputes in 90 days only).
  const disputes = ctx.st.appeals
    .filter((a) => a.isDispute)
    .sort((a, b) => toEpochMs(a.createdAt) - toEpochMs(b.createdAt) || (a.id < b.id ? -1 : 1));
  for (const appeal of disputes) {
    if (appeal.status !== 'open' || toEpochMs(appeal.createdAt) + DISPUTE_AUTO_VOID_DAYS * DAY_MS > now) continue;
    const sanction = ctx.st.sanctions.find((s) => s.id === appeal.sanctionId);
    if (!sanction || sanction.status !== 'disputed') continue;
    const created = toEpochMs(appeal.createdAt);
    const priorDisputes = disputes.filter(
      (d) => toEpochMs(d.createdAt) <= created && toEpochMs(d.createdAt) > created - AUTO_VOID_LOOKBACK_DAYS * DAY_MS,
    );
    if (priorDisputes.length > AUTO_VOID_MAX_DISPUTES) continue;
    overturnCascade(ctx, sanction.id, new Date(now).toISOString());
    ctx.emit([
      decisionNotice(ctx, sanction, 'auto_void', appeal.id),
      {
        type: 'Audit',
        action: 'sanction.auto_voided',
        subjectUserId: ctx.st.userId,
        data: { sanctionId: sanction.id, appealId: appeal.id, days: DISPUTE_AUTO_VOID_DAYS },
      },
    ]);
  }
  // 2. Expire sanctions past expiresAt (disputed ones wait for a decision).
  ctx.emit(
    ctx.st.sanctions
      .filter((s) => (s.status === 'active' || s.status === 'upheld') && s.expiresAt !== null && toEpochMs(s.expiresAt) <= now)
      .map((s) => ({ type: 'SetSanctionStatus', sanctionId: s.id, status: 'expired' }) as Effect),
  );
  // 3. Escalation for cards whose dispute window closed undisputed.
  runEscalation(ctx);
  // 4. TRUST-061(4): capture deposits only after the dispute window closed without a dispute.
  for (const s of ctx.st.sanctions) {
    if (s.kind !== 'yellow_card' || !DEPOSIT_REASONS.has(s.reasonCode) || s.status !== 'active') continue;
    if (s.disputeUntil === null || now <= toEpochMs(s.disputeUntil) || ctx.lastSettlement(s.gameId ?? '') !== undefined) continue;
    settle(ctx, s.gameId, 'forfeit');
  }
}

function onModeratorDecided(ctx: Ctx, e: Extract<DomainTrustEvent, { type: 'ModeratorDecided' }>): void {
  const item = ctx.st.reviewItems.find((r) => r.id === e.itemId);
  if (!item) return;
  const sanction = item.sanctionId ? ctx.st.sanctions.find((s) => s.id === item.sanctionId) : undefined;
  const { decision } = e;
  if (decision === 'permanent_ban') {
    const subject = item.subjectUserId ?? ctx.st.userId;
    assertSubject(ctx.st, subject, 'review item');
    ctx.emit(issueEffects(buildModeratorPermanentBan(subject, `permanent_ban:${item.id}`, ctx.now, item.sanctionId ? [item.sanctionId] : [])));
  } else if (item.kind === 'venue_reports' && item.venueId) {
    const venue = ctx.st.venues.find((v) => v.venueId === item.venueId);
    if (decision === 'remove_venue') {
      ctx.emit([{ type: 'SetVenueStatus', venueId: item.venueId, status: 'removed' }]);
      if (venue && venue.createdBy === ctx.st.userId && isConfirmedFake(venue)) runHostReliability(ctx);
    } else if (decision === 'restore_venue' || decision === 'dismiss') {
      ctx.emit([{ type: 'SetVenueStatus', venueId: item.venueId, status: 'active' }]);
      if (venue) {
        ctx.st.venues = ctx.st.venues.map((v) => (v.venueId === item.venueId ? { ...v, lastReviewedAt: e.at } : v));
      }
    }
  } else if (item.kind === 'collusion_suspected' && decision === 'uphold' && item.subjectUserId) {
    assertSubject(ctx.st, item.subjectUserId, 'review item');
    ctx.emit(
      issueEffects(
        buildSystemSanction(
          {
            kind: 'visibility_restriction',
            userId: item.subjectUserId,
            reasonCode: 'toxicity_reports',
            statementParams: { hours: ctx.config.visibilityRestrictionHours, reporters: item.reportIds.length },
            durationMs: ctx.config.visibilityRestrictionHours * HOUR_MS,
            dedupeKey: `moderator_restriction:${item.id}`,
            decidedBy: 'moderator',
          },
          ctx.now,
        ),
      ),
    );
  } else if (sanction && (decision === 'overturn' || decision === 'lift_restriction')) {
    overturnCascade(ctx, sanction.id, e.at);
    ctx.emit([decisionNotice(ctx, sanction, 'overturn', item.appealId)]);
  } else if (sanction && (decision === 'uphold' || (decision === 'dismiss' && (item.kind === 'sanction_dispute' || item.kind === 'appeal')))) {
    if (sanction.status === 'active' || sanction.status === 'disputed') {
      ctx.emit([{ type: 'SetSanctionStatus', sanctionId: sanction.id, status: 'upheld' }]);
    }
    if (sanction.kind === 'yellow_card' && DEPOSIT_REASONS.has(sanction.reasonCode) && ctx.lastSettlement(sanction.gameId ?? '') === undefined) {
      settle(ctx, sanction.gameId, 'forfeit');
    }
    ctx.emit([decisionNotice(ctx, sanction, 'uphold', item.appealId)]);
    runEscalation(ctx);
  }
  ctx.emit([
    {
      type: 'Audit',
      action: 'moderator.decision',
      subjectUserId: item.subjectUserId,
      data: { itemId: item.id, kind: item.kind, decision, moderatorId: e.moderatorId, note: e.note },
    },
  ]);
}

function runHostReliability(ctx: Ctx): void {
  const userId = ctx.st.userId;
  const confirmedFakeVenueIds = ctx.st.venues
    .filter((v) => v.createdBy === userId && v.status === 'removed' && isConfirmedFake(v))
    .map((v) => v.venueId);
  const res = evaluateHostReliability(
    { hostId: userId, ratings: ctx.st.hostRatings, confirmedFakeVenueIds, sanctions: ctx.st.sanctions },
    ctx.now,
    ctx.config,
  );
  ctx.emit(res.effects);
}

/**
 * Applies one event. Throws `StError('validation')` when the event is about a
 * different user than `state.userId`.
 */
export function applyTrustEvent(
  state: TrustState,
  event: DomainTrustEvent,
  config: TrustConfig = DEFAULT_TRUST_CONFIG,
  now: EpochMs,
): TrustResult {
  const ctx = new Ctx(state, config, now);
  const st = ctx.st;
  switch (event.type) {
    case 'ParticipationCancelled': {
      assertSubject(state, event.userId, 'cancellation');
      if (!isLateCancel(event.startsAt, event.cancelledAt, config)) {
        settle(ctx, event.gameId, 'release');
      } else if (!st.pendingLateCancels.some((p) => p.gameId === event.gameId)) {
        // TRUST-021: decided at finalisation (LateCancelFinalized), so a refilled spot never yields a card.
        st.pendingLateCancels.push({ gameId: event.gameId, startsAt: event.startsAt, cancelledAt: event.cancelledAt });
      }
      break;
    }
    case 'LateCancelFinalized': {
      assertSubject(state, event.userId, 'cancellation');
      st.pendingLateCancels = st.pendingLateCancels.filter((p) => p.gameId !== event.gameId);
      if (!isLateCancel(event.startsAt, event.cancelledAt, config)) break;
      if (event.refilled) {
        if (ctx.lastSettlement(event.gameId) === 'release') break; // already processed
        settle(ctx, event.gameId, 'release');
        ctx.emit([{ type: 'Audit', action: 'late_cancel.refilled', subjectUserId: st.userId, data: { gameId: event.gameId } }]);
        break;
      }
      const minutesBefore = Math.round((toEpochMs(event.startsAt) - toEpochMs(event.cancelledAt)) / 60_000);
      issueYellowCard(ctx, {
        reasonCode: 'late_cancel',
        gameId: event.gameId,
        statementParams: { windowHours: config.lateCancelWindowHours, minutesBeforeStart: minutesBefore },
      });
      break;
    }
    case 'AttendanceFinalized': {
      assertSubject(state, event.userId, 'attendance');
      if (event.attendance === 'no_show_unverified') {
        issueYellowCard(ctx, { reasonCode: 'no_show', gameId: event.gameId, statementParams: {} });
      } else if (event.attendance === 'verified' || event.attendance === 'excused') {
        settle(ctx, event.gameId, 'release');
      }
      break;
    }
    case 'ChatMessageBlocked': {
      assertSubject(state, event.userId, 'chat block');
      if (!st.chatBlocks.some((b) => b.gameId === event.gameId && b.at === event.at)) {
        st.chatBlocks.push({ gameId: event.gameId, at: event.at });
      }
      ctx.emit(evaluateChatBlocks(st.userId, st.chatBlocks, st.sanctions, now, config).effects);
      break;
    }
    case 'UserReported': {
      assertSubject(state, event.report.targetUserId, 'report');
      if (!st.reports.some((r) => r.id === event.report.id)) st.reports.push(event.report);
      const res = evaluateReports(st.reports, st.reporterProfiles, now, config, {
        sanctions: st.sanctions,
        attendance: st.attendance,
        overturns: st.overturns,
      });
      ctx.emit(res.effects);
      break;
    }
    case 'VenueReported': {
      const venue = st.venues.find((v) => v.venueId === event.report.venueId);
      if (!venue) throw new StError('validation', `Venue ${event.report.venueId} is not in the TrustState`);
      const reports = venue.reports.some((r) => r.id === event.report.id) ? venue.reports : [...venue.reports, event.report];
      const updated = { ...venue, reports };
      st.venues = st.venues.map((v) => (v.venueId === venue.venueId ? updated : v));
      ctx.emit(evaluateVenueReports(updated, now, config).effects);
      break;
    }
    case 'HostRated': {
      assertSubject(state, event.hostId, 'host rating');
      const rating: HostRatingRecord = { hostId: event.hostId, gameId: event.gameId, raterId: event.raterId, stars: event.stars, at: event.at };
      if (!st.hostRatings.some((r) => r.gameId === rating.gameId && r.raterId === rating.raterId)) st.hostRatings.push(rating);
      runHostReliability(ctx);
      break;
    }
    case 'AppealFiled': {
      const { appeal } = event;
      assertSubject(state, appeal.userId, 'appeal');
      if (st.appeals.some((a) => a.id === appeal.id)) break;
      st.appeals.push(appeal);
      const sanction = st.sanctions.find((s) => s.id === appeal.sanctionId);
      if (!sanction || appeal.status !== 'open') break;
      const dispute = appeal.isDispute && canDispute(sanction, now);
      if (dispute) ctx.emit([{ type: 'SetSanctionStatus', sanctionId: sanction.id, status: 'disputed' }]);
      ctx.emit([
        {
          type: 'EnqueueReview',
          item: buildReviewItem(
            {
              kind: dispute ? 'sanction_dispute' : 'appeal',
              priority: dispute ? 'normal' : 'low',
              dedupeKey: `${dispute ? 'sanction_dispute' : 'appeal'}:${appeal.id}`,
              subjectUserId: st.userId,
              gameId: sanction.gameId,
              sanctionId: sanction.id,
              appealId: appeal.id,
              evidence: { sanctionKind: sanction.kind, reasonCode: sanction.reasonCode },
            },
            now,
          ),
        },
      ]);
      break;
    }
    case 'ModeratorDecided':
      onModeratorDecided(ctx, event);
      break;
    case 'Tick':
      onTick(ctx);
      break;
  }
  return ctx.result();
}

/** Applies events in order (each with the state produced by the previous one). */
export function applyTrustEvents(
  state: TrustState,
  events: readonly { event: DomainTrustEvent; now: EpochMs }[],
  config: TrustConfig = DEFAULT_TRUST_CONFIG,
): TrustResult {
  let cur = state;
  const effects: Effect[] = [];
  for (const { event, now } of events) {
    const r = applyTrustEvent(cur, event, config, now);
    cur = r.state;
    effects.push(...r.effects);
  }
  return { state: cur, effects };
}
