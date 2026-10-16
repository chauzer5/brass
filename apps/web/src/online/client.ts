import { act, brass, replay } from '@brass/engine';
import type {
  ClientMessage,
  CreateGameRequest,
  GameSnapshot,
  JoinGameRequest,
  LobbyInfo,
  SeatTicket,
  ServerMessage,
} from '@brass/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrassMatch } from '../game/useGame.ts';

/** The deployed game server (Cloudflare). */
const LIVE_SERVER = 'https://brass-server.chauzer-reed.workers.dev';

/** The game server: VITE_SERVER_URL if set at build time; on this computer or the local network, the local one (`wrangler dev`). */
export const SERVER_URL: string =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  (/^(localhost|127\.|192\.168\.|10\.)/.test(location.hostname) ? `${location.protocol}//${location.hostname}:8787` : LIVE_SERVER);

async function request<T>(path: string, init?: { method: string; body: unknown }): Promise<T> {
  const res = await fetch(
    `${SERVER_URL}/api/games${path}`,
    init ? { method: init.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) } : {},
  );
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `The server said ${res.status}`);
  return data;
}

export const createGame = (body: CreateGameRequest) => request<SeatTicket>('', { method: 'POST', body });
export const lobbyInfo = (code: string) => request<LobbyInfo>(`/${code}`);
export const joinGame = (code: string, body: JoinGameRequest) => request<SeatTicket>(`/${code}/join`, { method: 'POST', body });

// ---- The games this phone is in ----

const TICKETS_KEY = 'brass:online:v1';

export interface SavedTicket extends SeatTicket {
  joinedAt: number;
  /** The draw for who goes first has been shown on this phone. */
  introSeen?: boolean;
}

export function savedTickets(): SavedTicket[] {
  try {
    return (JSON.parse(localStorage.getItem(TICKETS_KEY) ?? '[]') as SavedTicket[]).sort((a, b) => b.joinedAt - a.joinedAt);
  } catch {
    return [];
  }
}

function storeTickets(tickets: SavedTicket[]) {
  try {
    localStorage.setItem(TICKETS_KEY, JSON.stringify(tickets));
  } catch {
    // Without storage the game still plays; it just won't be in the list next time.
  }
}

export function saveTicket(ticket: SeatTicket): SavedTicket {
  const saved = { ...ticket, joinedAt: Date.now() };
  storeTickets([saved, ...savedTickets().filter((t) => t.code !== ticket.code)]);
  return saved;
}

export function markIntroSeen(code: string) {
  storeTickets(savedTickets().map((t) => (t.code === code ? { ...t, introSeen: true } : t)));
}

export function forgetTicket(code: string) {
  storeTickets(savedTickets().filter((t) => t.code !== code));
}

const NAME_KEY = 'brass:online:name';

/** The name last used online, offered again next time. */
export function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name.trim());
  } catch {
    // Just not remembered.
  }
}

/** The link that opens the app on a game's join page. */
export const joinLink = (code: string) => `${location.origin}/?join=${code}`;

// ---- A live game ----

export type Connection = 'connecting' | 'open' | 'offline';

const configFor = (playerCount: brass.PlayerCount): brass.BrassConfig => ({ playerCount, components: brass.BIRMINGHAM_COMPONENTS });

/** Waits before reconnecting: quickly at first, then less often. */
const RETRY_MS = [500, 1000, 2000, 4000, 8000, 15000];

/**
 * One online game: the WebSocket (reconnecting whenever it drops or the app
 * comes back to the foreground), the game as the server last sent it, and the
 * match replayed from it. Moves are applied here straight away (checked with
 * the same engine) and sent; the server's copy wins if they ever differ.
 */
export function useOnlineGame(ticket: SeatTicket) {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [match, setMatch] = useState<BrassMatch | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [error, setError] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const matchRef = useRef<BrassMatch | null>(null);
  matchRef.current = match;

  useEffect(() => {
    let closed = false;
    let attempt = 0;
    let retry = 0;
    const connect = () => {
      if (closed) return;
      setConnection('connecting');
      const url = `${SERVER_URL.replace(/^http/, 'ws')}/api/games/${ticket.code}/ws?token=${encodeURIComponent(ticket.token)}`;
      const socket = new WebSocket(url);
      ws.current = socket;
      socket.onopen = () => {
        attempt = 0;
        setConnection('open');
      };
      socket.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as ServerMessage;
        if (msg.t === 'error') {
          setError(msg.message);
          return;
        }
        const game = msg.game;
        setSnapshot(game);
        // Replay only when the server's moves differ from what's on screen (usually just our own move echoed back).
        const current = matchRef.current;
        const same =
          current &&
          current.seed === game.seed &&
          current.log.length === game.log.length &&
          JSON.stringify(current.log.at(-1)) === JSON.stringify(game.log.at(-1));
        if (same) return;
        const r = replay(brass.brassGame, configFor(game.playerCount), game.seed, game.log);
        if (r.ok) setMatch(r.value);
        else setError(`This game can't be shown: ${r.error}`);
      };
      socket.onclose = () => {
        if (ws.current === socket) ws.current = null;
        if (closed) return;
        setConnection('offline');
        retry = window.setTimeout(connect, RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]);
      };
    };
    connect();
    // Phones drop sockets in the background: reconnect straight away when the app comes back.
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || ws.current) return;
      clearTimeout(retry);
      attempt = 0;
      connect();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      closed = true;
      clearTimeout(retry);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      ws.current?.close();
    };
  }, [ticket.code, ticket.token]);

  const send = useCallback((msg: ClientMessage) => {
    const socket = ws.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(msg));
    return true;
  }, []);

  /** Plays a move: shown at once if it's legal here, then sent. Returns an error message, or null. */
  const play = useCallback(
    (player: number, action: brass.BrassAction): string | null => {
      const current = matchRef.current;
      if (!current) return 'The game is still loading';
      const r = act(brass.brassGame, current, player, action);
      if (!r.ok) return r.error;
      if (!send({ t: 'act', at: current.log.length, player, action })) return "You're offline: the move wasn't sent";
      setMatch(r.value);
      return null;
    },
    [send],
  );

  /** A bot's move, worked out on this phone: dropped if the game has moved on (another phone played it first). */
  const playBot = useCallback(
    (player: number, action: brass.BrassAction, at: number) => {
      const current = matchRef.current;
      if (!current || current.log.length !== at) return;
      const r = act(brass.brassGame, current, player, action);
      if (!r.ok || !send({ t: 'act', at, player, action })) return;
      setMatch(r.value);
    },
    [send],
  );

  const start = useCallback(() => send({ t: 'start' }), [send]);

  return { snapshot, match, connection, error, clearError: () => setError(null), play, playBot, start };
}
