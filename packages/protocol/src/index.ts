import type { LoggedAction, brass } from '@brass/engine';

/*
 * What the online game server and the app say to each other. A game is
 * created over HTTP; then each player's phone keeps a WebSocket open to it,
 * sends its moves, and is sent the whole game whenever it changes. The server
 * checks every move with the same rules engine the app uses.
 */

export type Difficulty = brass.BotDifficulty;

/** A seat as the game is set up: a person (who joins with a code), or a bot. */
export type SeatSetup = { kind: 'human' } | { kind: 'bot'; difficulty: Difficulty };

/** A seat as everyone sees it. */
export type PublicSeat =
  | { kind: 'human'; name: string | null; online: boolean }
  | { kind: 'bot'; difficulty: Difficulty; name: string };

/** A game is cancelled when a player leaves it part-way through. */
export type GameStatus = 'lobby' | 'playing' | 'cancelled';

/** The game as the server sends it to each player. */
export interface GameSnapshot {
  code: string;
  playerCount: brass.PlayerCount;
  status: GameStatus;
  seats: PublicSeat[];
  /** The seed and moves so far: the app replays them to get the game. */
  seed: number;
  log: LoggedAction<brass.BrassAction>[];
  /** Which seat this phone plays. */
  you: number;
  /** Who left, cancelling the game. */
  leftBy: number | null;
  /** The seat of whoever made the game: only they can start it. */
  host: number;
  /** The most a turn may take, in seconds (null: no limit). A turn that runs out is passed automatically. */
  turnLimit: number | null;
  /** When the current turn runs out (ms since 1970, server time), if it can. */
  turnDeadline: number | null;
  /** The server's clock when this was sent, to count down against. */
  now: number;
}

/** The turn-time choices offered when making a game, in seconds (null: no limit). */
export const TURN_LIMITS: readonly (number | null)[] = [null, 3 * 60, 10 * 60, 60 * 60, 24 * 60 * 60];

// ---- HTTP ----

export interface CreateGameRequest {
  seats: SeatSetup[];
  /** The creator's name: they take the first human seat. */
  name: string;
  /** The most a turn may take, in seconds: one of TURN_LIMITS (missing: no limit). */
  turnLimit?: number | null;
}

/** Joining (or creating) gives back the seat taken and its secret token, kept on the phone. */
export interface SeatTicket {
  code: string;
  seat: number;
  token: string;
}

export interface JoinGameRequest {
  seat: number;
  name: string;
}

/** What anyone with the code can see before joining: who's in, and which seats are free. */
export interface LobbyInfo {
  code: string;
  status: GameStatus;
  seats: PublicSeat[];
  /** Whose turn it is (null in the lobby, or once the game is over). */
  current: number | null;
  finished: boolean;
  /** Who left, cancelling the game. */
  leftBy: number | null;
}

/**
 * Leaving: before the game starts, the seat is freed for someone else; part-way through, the game is
 * cancelled for everyone; once it's over, nothing changes (the phone just forgets it).
 */
export interface LeaveGameRequest {
  token: string;
}

/** Signing this phone up for notifications in a game (its turn, the game starting, ending or being cancelled). */
export interface PushRegisterRequest {
  token: string;
  /** PushSubscription.toJSON() */
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
}

// ---- WebSocket ----

export type ClientMessage =
  /** Start the game (its host, once every human seat is taken). */
  | { t: 'start' }
  /**
   * A move, for this phone's seat or for a bot seat. `at` is the log length it was made at: a move
   * made on a game that has since moved on is refused, so bots played by two phones at once don't both
   * land.
   */
  | { t: 'act'; at: number; player: number; action: brass.BrassAction }
  /** Whether the app is on screen: notifications are only sent to players who aren't looking. */
  | { t: 'visible'; visible: boolean };

export type ServerMessage =
  | { t: 'state'; game: GameSnapshot }
  | { t: 'error'; message: string }
  /** Something everyone should know (e.g. a turn that ran out and was passed). */
  | { t: 'notice'; message: string };

/** Game codes: 5 letters and digits that can't be confused (no 0/O, 1/I/L). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

export const normalizeCode = (code: string) =>
  code
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH);

/** Bots are named after the players on the front of the Brass rulebook. */
export const BOT_NAMES = ['Bot Richard', 'Bot George', 'Bot Eleanor'];
