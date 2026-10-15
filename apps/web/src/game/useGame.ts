import { act, brass, createMatch, randomSeed, replay, undo, type Match } from '@brass/engine';
import { useCallback, useEffect, useState } from 'react';
import { TUTORIAL_NAMES, TUTORIAL_PRESET, TUTORIAL_SEED } from '../tutorial/script.ts';

export type BrassMatch = Match<brass.BrassConfig, brass.BrassState, brass.BrassAction>;

/** Who plays a seat: a person at the device, or a bot at some difficulty. */
export type Seat = { kind: 'human' } | { kind: 'bot'; difficulty: brass.BotDifficulty };

export const HUMAN: Seat = { kind: 'human' };

export interface Game {
  match: BrassMatch;
  names: string[];
  seats: Seat[];
  /** Started from the tutorial's fixed setup (kept when the tutorial game is played on). */
  preset?: 'tutorial';
  /** The tutorial in progress: never saved, so it doesn't replace a saved game. */
  tutorial?: boolean;
}

const STORAGE_KEY = 'brass:game:v1';

interface Saved {
  playerCount: brass.PlayerCount;
  seed: number;
  log: BrassMatch['log'];
  names: string[];
  /** Missing in saves from before bots: everyone is human. */
  seats?: Seat[];
  preset?: 'tutorial';
}

const configFor = (playerCount: brass.PlayerCount, preset?: 'tutorial'): brass.BrassConfig => ({
  playerCount,
  components: brass.BIRMINGHAM_COMPONENTS,
  ...(preset === 'tutorial' && { preset: TUTORIAL_PRESET }),
});

/** Saves are only the seed and the action log; the match is rebuilt by replaying it. */
function load(): Game | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved;
    const result = replay(brass.brassGame, configFor(saved.playerCount, saved.preset), saved.seed, saved.log);
    if (!result.ok) return null;
    const game: Game = { match: result.value, names: saved.names, seats: saved.seats ?? saved.names.map(() => HUMAN) };
    if (saved.preset) game.preset = saved.preset;
    return game;
  } catch {
    return null;
  }
}

function save(game: Game | null): void {
  if (game?.tutorial) return;
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
      seats: game.seats,
      ...(game.preset && { preset: game.preset }),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Storage can be unavailable (private mode); the game still works, it just isn't saved.
  }
}

export function useGame() {
  const [game, setGame] = useState<Game | null>(load);

  useEffect(() => save(game), [game]);

  const start = useCallback((names: string[], seats: Seat[]) => {
    const playerCount = names.length as brass.PlayerCount;
    setGame({ match: createMatch(brass.brassGame, configFor(playerCount), randomSeed()), names, seats });
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

  /**
   * Plays a bot's move, if the game is still where the bot saw it (`at` = log length): a move worked out
   * in the background must not land on a game that has moved on (undo, a new game).
   */
  const playBot = useCallback((player: number, action: brass.BrassAction, at: number) => {
    setGame((g) => {
      if (!g || g.match.log.length !== at) return g;
      const result = act(brass.brassGame, g.match, player, action);
      if (!result.ok) {
        console.error('Bot move rejected:', result.error);
        return g;
      }
      return { ...g, match: result.value };
    });
  }, []);

  const undoLast = useCallback(() => {
    if (!game) return;
    const result = undo(brass.brassGame, game.match);
    if (result.ok) setGame({ ...game, match: result.value });
  }, [game]);

  const quit = useCallback(() => setGame(null), []);

  /** The tutorial: you against Bot Richard, from its fixed setup. Whatever game was saved stays saved. */
  const startTutorial = useCallback(() => {
    setGame({
      match: createMatch(brass.brassGame, configFor(2, 'tutorial'), TUTORIAL_SEED),
      names: [...TUTORIAL_NAMES],
      seats: [HUMAN, { kind: 'bot', difficulty: 'normal' }],
      preset: 'tutorial',
      tutorial: true,
    });
  }, []);

  /** Leaves the tutorial, back to the game that was saved before it (if any). */
  const exitTutorial = useCallback(() => setGame(load()), []);

  /** Carries on the tutorial game as an ordinary game (it replaces any saved one). */
  const keepPlaying = useCallback(() => setGame((g) => (g ? { ...g, tutorial: false } : g)), []);

  return { game, start, play, playBot, undoLast, quit, startTutorial, exitTutorial, keepPlaying };
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
