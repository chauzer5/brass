import { act, brass, createMatch, randomSeed, replay, undo, type Match } from '@brass/engine';
import { useCallback, useEffect, useState } from 'react';
import { TUTORIAL_NAMES, TUTORIAL_PRESET, TUTORIAL_SEED } from '../tutorial/script.ts';

export type BrassMatch = Match<brass.BrassConfig, brass.BrassState, brass.BrassAction>;

/** Who plays a seat: a person at the device, a bot at some difficulty, or (online) a person on another phone. */
export type Seat = { kind: 'human' } | { kind: 'bot'; difficulty: brass.BotDifficulty } | { kind: 'remote' };

export const HUMAN: Seat = { kind: 'human' };

export interface Game {
  /** Where a local game is saved (missing for the tutorial, and online games). */
  id?: string;
  match: BrassMatch;
  names: string[];
  seats: Seat[];
  /** Started from the tutorial's fixed setup (kept when the tutorial game is played on). */
  preset?: 'tutorial';
  /** The tutorial in progress: never saved, so it doesn't replace a saved game. */
  tutorial?: boolean;
  /** The draw for who goes first has been shown (saved, so it's shown once per game). */
  introSeen?: boolean;
}

/** Before local games were a list, the one saved game lived here (moved into the list on first load). */
const OLD_KEY = 'brass:game:v1';
const GAMES_KEY = 'brass:games:v2';

interface Saved {
  playerCount: brass.PlayerCount;
  seed: number;
  log: BrassMatch['log'];
  names: string[];
  /** Missing in saves from before bots: everyone is human. */
  seats?: Seat[];
  preset?: 'tutorial';
  introSeen?: boolean;
}

/** A local game as kept on the device: the seed and the action log (the match is rebuilt by replaying it). */
export interface SavedLocal extends Saved {
  id: string;
  /** When it was last played (ms). */
  updatedAt: number;
}

const configFor = (playerCount: brass.PlayerCount, preset?: 'tutorial'): brass.BrassConfig => ({
  playerCount,
  components: brass.BIRMINGHAM_COMPONENTS,
  ...(preset === 'tutorial' && { preset: TUTORIAL_PRESET }),
});

const newId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(0, 13);

/** Every local game on this device, most recently played first. */
export function savedLocalGames(): SavedLocal[] {
  try {
    let games = JSON.parse(localStorage.getItem(GAMES_KEY) ?? '[]') as SavedLocal[];
    // The single saved game from before joins the list.
    const old = localStorage.getItem(OLD_KEY);
    if (old) {
      games = [{ ...(JSON.parse(old) as Saved), id: newId(), updatedAt: Date.now() }, ...games];
      localStorage.setItem(GAMES_KEY, JSON.stringify(games));
      localStorage.removeItem(OLD_KEY);
      setLastGame({ kind: 'local', id: games[0]!.id });
    }
    return games.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function storeGames(games: SavedLocal[]) {
  try {
    localStorage.setItem(GAMES_KEY, JSON.stringify(games));
  } catch {
    // Storage can be unavailable (private mode); the game still works, it just isn't saved.
  }
}

export function deleteLocalGame(id: string) {
  storeGames(savedLocalGames().filter((g) => g.id !== id));
}

/** Rebuilds a saved game by replaying it (null if it no longer replays). */
export function loadLocal(saved: SavedLocal): Game | null {
  const result = replay(brass.brassGame, configFor(saved.playerCount, saved.preset), saved.seed, saved.log);
  if (!result.ok) return null;
  const game: Game = { id: saved.id, match: result.value, names: saved.names, seats: saved.seats ?? saved.names.map(() => HUMAN) };
  if (saved.preset) game.preset = saved.preset;
  // Saves from before this flag: only a game nobody has moved in yet still shows the draw.
  game.introSeen = saved.introSeen ?? saved.log.length > 0;
  return game;
}

function save(game: Game | null): void {
  if (!game || game.tutorial || !game.id) return;
  const saved: SavedLocal = {
    id: game.id,
    updatedAt: Date.now(),
    playerCount: game.match.config.playerCount,
    seed: game.match.seed,
    log: game.match.log,
    names: game.names,
    seats: game.seats,
    ...(game.preset && { preset: game.preset }),
    ...(game.introSeen && { introSeen: true }),
  };
  storeGames([saved, ...savedLocalGames().filter((g) => g.id !== game.id)]);
}

// ---- The last game looked at (for "Resume current game") ----

export type GameRef = { kind: 'local'; id: string } | { kind: 'online'; code: string };
const LAST_KEY = 'brass:last:v1';

export function lastGame(): GameRef | null {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as GameRef | null;
  } catch {
    return null;
  }
}

export function setLastGame(ref: GameRef) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(ref));
  } catch {
    // Just not remembered.
  }
}

/** The local game on screen (or the tutorial), saved as it's played. */
export function useGame() {
  const [game, setGame] = useState<Game | null>(null);

  useEffect(() => save(game), [game]);

  /** Opens a saved game; false if it's gone. */
  const open = useCallback((id: string) => {
    const saved = savedLocalGames().find((g) => g.id === id);
    const loaded = saved && loadLocal(saved);
    if (!loaded) return false;
    setLastGame({ kind: 'local', id });
    setGame(loaded);
    return true;
  }, []);

  const start = useCallback((names: string[], seats: Seat[]) => {
    const playerCount = names.length as brass.PlayerCount;
    const id = newId();
    setLastGame({ kind: 'local', id });
    setGame({ id, match: createMatch(brass.brassGame, configFor(playerCount), randomSeed()), names, seats });
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

  /** Leaves the game on screen (it stays saved). */
  const close = useCallback(() => setGame(null), []);

  /** Deletes the game on screen. */
  const remove = useCallback(() => {
    setGame((g) => {
      if (g?.id) deleteLocalGame(g.id);
      return null;
    });
  }, []);

  /** The tutorial: you against Bot Richard, from its fixed setup. It isn't saved unless played on. */
  const startTutorial = useCallback(() => {
    setGame({
      match: createMatch(brass.brassGame, configFor(2, 'tutorial'), TUTORIAL_SEED),
      names: [...TUTORIAL_NAMES],
      seats: [HUMAN, { kind: 'bot', difficulty: 'normal' }],
      preset: 'tutorial',
      tutorial: true,
    });
  }, []);

  /** Carries on the tutorial game as an ordinary local game (saved from now on). */
  const keepPlaying = useCallback(() => {
    const id = newId();
    setLastGame({ kind: 'local', id });
    setGame((g) => (g ? { ...g, id, tutorial: false } : g));
  }, []);

  /** The draw for who goes first has been seen: it isn't shown again for this game. */
  const introDone = useCallback(() => setGame((g) => (g ? { ...g, introSeen: true } : g)), []);

  return { game, open, start, play, playBot, undoLast, close, remove, startTutorial, keepPlaying, introDone };
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
