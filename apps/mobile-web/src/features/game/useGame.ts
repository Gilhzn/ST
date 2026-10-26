/** Game + participants for the game sub-screens, with a stable `refresh` and optional polling. */
import { useCallback, useEffect } from 'react';

import { useData } from '@/data/DataProvider';
import { useAsync } from '@/hooks/useAsync';

export function useGame(gameId: string, options: { participants?: boolean; pollMs?: number } = {}) {
  const port = useData();
  const game = useAsync(() => port.getGame(gameId), [port, gameId]);
  const participants = useAsync(() => port.listParticipants(gameId), [port, gameId], options.participants !== false && !!game.data);
  const reloadGame = game.reload;
  const reloadParticipants = participants.reload;
  const withParticipants = options.participants !== false;
  const refresh = useCallback(async () => {
    await Promise.all([reloadGame(), withParticipants ? reloadParticipants() : Promise.resolve()]);
  }, [reloadGame, reloadParticipants, withParticipants]);

  useEffect(() => {
    if (!options.pollMs) return;
    const id = setInterval(() => void refresh(), options.pollMs);
    return () => clearInterval(id);
  }, [options.pollMs, refresh]);

  return { game, participants, refresh };
}
