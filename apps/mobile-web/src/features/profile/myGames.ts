/** Grouping for the Games tab (design §12.1). Pure, so it is easy to test. */
import type { GameDetail } from '@st/domain';

export type GamesSegment = 'upcoming' | 'hosting' | 'past';

/** A game is "over" once it has ended or was cancelled/completed. */
export function isOver(game: Pick<GameDetail, 'endsAt' | 'status'>, now: number): boolean {
  return game.status !== 'scheduled' || Date.parse(game.endsAt) <= now;
}

export function splitMyGames(games: readonly GameDetail[], now: number): Record<GamesSegment, GameDetail[]> {
  const upcoming = games.filter((g) => !isOver(g, now)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = games.filter((g) => isOver(g, now)).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  return { upcoming, hosting: upcoming.filter((g) => g.isHost), past };
}

export type MyGameState = 'hosting' | 'going' | 'waitlisted' | 'requested' | 'cancelled' | 'checkedIn' | 'noShow' | null;

/** The single most useful status tag for a game in the list. */
export function myGameState(game: GameDetail, now: number): MyGameState {
  if (game.status === 'cancelled') return 'cancelled';
  const p = game.myParticipation;
  if (isOver(game, now)) {
    if (p?.attendance === 'verified') return 'checkedIn';
    if (p?.attendance === 'no_show_unverified') return 'noShow';
    return null;
  }
  if (game.isHost) return 'hosting';
  if (p?.status === 'approved') return 'going';
  if (p?.status === 'waitlisted') return 'waitlisted';
  if (p?.status === 'requested') return 'requested';
  return null;
}
