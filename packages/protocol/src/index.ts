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

export type GameStatus = 'lobby' | 'playing';

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
}

// ---- HTTP ----

export interface CreateGameRequest {
  seats: SeatSetup[];
  /** The creator's name: they take the first human seat. */
  name: string;
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
}

// ---- WebSocket ----

export type ClientMessage =
  /** Start the game (any seated player, once every human seat is taken). */
  | { t: 'start' }
  /**
   * A move, for this phone's seat or for a bot seat. `at` is the log length it was made at: a move
   * made on a game that has since moved on is refused, so bots played by two phones at once don't both
   * land.
   */
  | { t: 'act'; at: number; player: number; action: brass.BrassAction };

export type ServerMessage =
  | { t: 'state'; game: GameSnapshot }
  | { t: 'error'; message: string };

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
