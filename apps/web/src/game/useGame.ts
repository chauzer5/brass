import { act, brass, createMatch, randomSeed, replay, undo, type Match } from '@brass/engine';
import { useCallback, useEffect, useState } from 'react';

export type BrassMatch = Match<brass.BrassConfig, brass.BrassState, brass.BrassAction>;

export interface Game {
  match: BrassMatch;
  names: string[];
}

const STORAGE_KEY = 'brass:game:v1';

interface Saved {
  playerCount: brass.PlayerCount;
  seed: number;
  log: BrassMatch['log'];
  names: string[];
}

const configFor = (playerCount: brass.PlayerCount): brass.BrassConfig => ({
  playerCount,
  components: brass.BIRMINGHAM_COMPONENTS,
});

/** Saves are only the seed and the action log; the match is rebuilt by replaying it. */
function load(): Game | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved;
    const result = replay(brass.brassGame, configFor(saved.playerCount), saved.seed, saved.log);
    return result.ok ? { match: result.value, names: saved.names } : null;
  } catch {
    return null;
  }
}

function save(game: Game | null): void {
  try {
    if (!game) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const saved: Saved = {
      playerCount: game.match.config.playerCount,
      seed: game.match.seed,
      log: game.match.log,
      names: game.names,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Storage can be unavailable (private mode); the game still works, it just isn't saved.
  }
}

export function useGame() {
  const [game, setGame] = useState<Game | null>(load);

  useEffect(() => save(game), [game]);

  const start = useCallback((names: string[]) => {
    const playerCount = names.length as brass.PlayerCount;
    setGame({ match: createMatch(brass.brassGame, configFor(playerCount), randomSeed()), names });
  }, []);

  /** Returns an error message, or null if the action was played. */
  const play = useCallback(
    (player: number, action: brass.BrassAction): string | null => {
      if (!game) return 'No game in progress';
      const result = act(brass.brassGame, game.match, player, action);
      if (!result.ok) return result.error;
      setGame({ ...game, match: result.value });
      return null;
    },
    [game],
  );

  const undoLast = useCallback(() => {
    if (!game) return;
    const result = undo(brass.brassGame, game.match);
    if (result.ok) setGame({ ...game, match: result.value });
  }, [game]);

  const quit = useCallback(() => setGame(null), []);

  return { game, start, play, undoLast, quit };
}

/**
 * Undo is allowed within the current player's turn: their earlier action
 * this turn, before the hand refill reveals new cards.
 */
export function canUndo(match: BrassMatch): boolean {
  const last = match.log.at(-1);
  const s = match.state;
  return !!last && s.phase.kind === 'actions' && s.actionsTaken > 0 && last.player === brass.currentPlayer(s);
}
