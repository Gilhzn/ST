/**
 * Applies `Phase15Effect`s from the pure domain modules to the in-memory tables
 * (the mock's `st_apply_effects`). Shared by the seed and the InMemoryAdapter so
 * both build series, rosters and friendships exactly the way the rules say.
 * Media effects are applied by the adapter from the returned item/tag state;
 * storage, evidence and review effects have no in-memory counterpart.
 */
import type {
  EpochMs,
  GameId,
  IsoDateTime,
  NotificationParams,
  OccurrenceGameSnapshot,
  Participant,
  Phase15Effect,
  Phase15NotificationKind,
  RosterMember,
  UserId,
} from '@st/domain';

import { toIso } from './domain';
import type { MockGame, MockState } from './state';

export interface EffectContext {
  now: EpochMs;
  notify: (userId: UserId, kind: Phase15NotificationKind, params: NotificationParams, gameId: GameId | null) => void;
  /** A participant left an approved seat (offer it to the waitlist). */
  onSeatFreed?: (gameId: GameId) => void;
}

export function participantRow(gameId: GameId, userId: UserId, status: Participant['status'], at: IsoDateTime, waitlistRank: number | null = null): Participant {
  return {
    gameId,
    userId,
    status,
    attendance: 'unknown',
    team: null,
    position: null,
    waitlistRank,
    lateCancel: false,
    lateCancelRefilled: false,
    offeredAt: null,
    offerExpiresAt: null,
    offerMode: null,
    paymentReady: true,
    checkInMethod: null,
    checkedInAt: null,
    requestedAt: at,
    decidedAt: at,
    cancelledAt: null,
  };
}

/** The `games` row of a generated occurrence (host approved, like `create_game`). */
export function occurrenceToGame(snapshot: OccurrenceGameSnapshot, createdAt: IsoDateTime): MockGame {
  return {
    id: snapshot.id,
    seriesId: snapshot.seriesId,
    hostId: snapshot.hostId,
    sport: snapshot.sport,
    title: snapshot.title,
    notes: snapshot.notes,
    visibility: snapshot.visibility,
    venueId: snapshot.venueId,
    location: snapshot.location ?? snapshot.approxLocation,
    approxLocation: snapshot.approxLocation,
    hideExactLocation: snapshot.hideExactLocation,
    capacity: snapshot.capacity,
    minPlayers: snapshot.minPlayers,
    startsAt: snapshot.startsAt,
    endsAt: snapshot.endsAt,
    depositMinor: snapshot.depositMinor,
    currency: snapshot.currency,
    depositForfeitTo: snapshot.depositForfeitTo,
    womenOnly: snapshot.womenOnly,
    status: 'scheduled',
    teamCount: snapshot.teamCount,
    inviteToken: `inv-${snapshot.id.slice(0, 13)}`,
    createdAt,
    qrSecret: `qr-secret-${snapshot.id}`,
  };
}

const rosterKey = (seriesId: string, userId: string) => `${seriesId}|${userId}`;

export function applyPhase15Effects(state: MockState, effects: readonly Phase15Effect[], ctx: EffectContext): void {
  const at = toIso(ctx.now);
  for (const e of effects) {
    switch (e.type) {
      case 'CreateOccurrence': {
        if (state.occurrences.has(e.occurrence.occurrenceKey)) break;
        state.occurrences.set(e.occurrence.occurrenceKey, { ...e.occurrence });
        if (!state.games.has(e.game.id)) {
          state.games.set(e.game.id, occurrenceToGame(e.game, at));
          state.participants.set(`${e.game.id}|${e.game.hostId}`, participantRow(e.game.id, e.game.hostId, 'approved', at));
        }
        break;
      }
      case 'UpdateOccurrence': {
        state.occurrences.set(e.occurrenceKey, { ...e.occurrence });
        const g = state.games.get(e.gameId);
        if (g) {
          const { location, ...rest } = e.patch;
          Object.assign(g, rest);
          if (location) g.location = location;
        }
        break;
      }
      case 'CancelOccurrence': {
        const o = state.occurrences.get(e.occurrenceKey);
        if (o) state.occurrences.set(e.occurrenceKey, { ...o, status: e.reason === 'skipped' ? 'skipped' : 'cancelled' });
        const g = state.games.get(e.gameId);
        if (g && g.status === 'scheduled') g.status = 'cancelled';
        break;
      }
      case 'AutoJoin': {
        const key = `${e.gameId}|${e.userId}`;
        if (state.autoJoins.has(key)) break;
        const existing = state.participants.get(key);
        if (!existing || existing.status === 'cancelled' || existing.status === 'rejected') {
          const rank =
            e.joinedAs === 'waitlisted' ? [...state.participants.values()].filter((p) => p.gameId === e.gameId && p.status === 'waitlisted').length + 1 : null;
          state.participants.set(key, participantRow(e.gameId, e.userId, e.joinedAs, at, rank));
        }
        state.autoJoins.set(key, {
          gameId: e.gameId,
          seriesId: e.seriesId,
          userId: e.userId,
          joinedAs: e.joinedAs,
          reconfirmRequestedAt: null,
          reconfirmedAt: null,
          releasedAt: null,
        });
        break;
      }
      case 'RequestReconfirm': {
        const r = state.autoJoins.get(`${e.gameId}|${e.userId}`);
        if (r && !r.reconfirmRequestedAt) r.reconfirmRequestedAt = at;
        break;
      }
      case 'ReleaseAutoJoin': {
        const key = `${e.gameId}|${e.userId}`;
        const r = state.autoJoins.get(key);
        if (r && !r.releasedAt) r.releasedAt = at;
        const p = state.participants.get(key);
        if (p && (p.status === 'approved' || p.status === 'waitlisted')) {
          const wasApproved = p.status === 'approved';
          p.status = 'cancelled';
          p.cancelledAt = at;
          p.waitlistRank = null;
          if (wasApproved) ctx.onSeatFreed?.(e.gameId);
        }
        break;
      }
      case 'UpdateRosterMember': {
        const key = rosterKey(e.seriesId, e.userId);
        const prev = state.roster.get(key);
        state.roster.set(key, { ...(prev ?? ({} as RosterMember)), ...e.patch, seriesId: e.seriesId, userId: e.userId } as RosterMember);
        break;
      }
      case 'UpdateSeries': {
        const s = state.series.get(e.seriesId);
        if (s) Object.assign(s, e.patch);
        break;
      }
      case 'UpsertConnection': {
        const c = e.connection;
        state.friendships.set(`${c.userA}|${c.userB}`, {
          userA: c.userA,
          userB: c.userB,
          friendStatus: c.friendStatus,
          friendRequestedBy: c.friendRequestedBy,
          friendRequestedAt: c.friendRequestedAt,
          friendAcceptedAt: c.friendAcceptedAt,
        });
        break;
      }
      case 'DeleteFriendship':
        state.friendships.delete(`${e.userA}|${e.userB}`);
        break;
      case 'Notify15':
        ctx.notify(e.userId, e.kind, e.params, e.gameId);
        break;
      default:
        // Media status/visibility/tags are applied from the returned state; storage, evidence,
        // account holds, reviews and audit rows live server side only.
        break;
    }
  }
}
