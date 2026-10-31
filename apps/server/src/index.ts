import { DurableObject } from 'cloudflare:workers';
import { act, brass, createMatch, randomSeed, replay, type Match } from '@brass/engine';
import {
  BOT_NAMES,
  CODE_ALPHABET,
  TURN_LIMITS,
  CODE_LENGTH,
  REACTIONS,
  normalizeCode,
  type ClientMessage,
  type CreateGameRequest,
  type GameSnapshot,
  type GameStatus,
  type JoinGameRequest,
  type LeaveGameRequest,
  type PushRegisterRequest,
  type LobbyInfo,
  type PublicSeat,
  type SeatSetup,
  type SeatTicket,
  type ServerMessage,
} from '@brass/protocol';
import { isPushSub, sendPush, vapidPublicKey, b64url, type PushMessage, type PushSub, type VapidKey } from './push.ts';

/*
 * The online game server: a Worker that routes requests, and one Durable
 * Object per game holding its seed, move log and seats. Every move is checked
 * with the rules engine before it's kept and sent to everyone connected.
 */

export interface Env {
  GAMES: DurableObjectNamespace<GameRoom>;
  /** The VAPID key pair for notifications, as a JWK (a secret: `wrangler secret put VAPID_KEY`). */
  VAPID_KEY?: string;
}

/** Who the push services can contact about this server's notifications. */
const PUSH_SUBJECT = 'https://brass-server.chauzer-reed.workers.dev';
const vapidKey = (env: Env): VapidKey | null => (env.VAPID_KEY ? (JSON.parse(env.VAPID_KEY) as VapidKey) : null);

type BrassMatch = Match<brass.BrassConfig, brass.BrassState, brass.BrassAction>;

/** A seat as stored: the secret token is what proves a phone sits there. */
type StoredSeat =
  | { kind: 'human'; name: string | null; token: string | null; push?: PushSub[] }
  | { kind: 'bot'; difficulty: brass.BotDifficulty; name: string };

interface StoredGame {
  code: string;
  playerCount: brass.PlayerCount;
  status: GameStatus;
  seed: number;
  log: BrassMatch['log'];
  seats: StoredSeat[];
  createdAt: number;
  leftBy?: number;
  /** Whoever made the game (missing in older games: the first person's seat). */
  host?: number;
  /** The most a turn may take, in seconds. */
  turnLimit?: number;
  /** When the current player's turn began (ms). */
  turnStartedAt?: number;
  /** The rematch, once someone asked: its code, each seat's token there, and who asked. */
  rematch?: { code: string; tokens: (string | null)[]; by: number };
}

/** A rematch as handed to its new room: the same seats (with fresh tokens), turn limit and players' phones. */
interface RematchSetup {
  playerCount: brass.PlayerCount;
  seats: StoredSeat[];
  host: number;
  turnLimit?: number;
}

/** The fewest milliseconds between one phone's reactions. */
const REACTION_GAP_MS = 1500;

const MAX_NAME = 24;
const cleanName = (name: unknown) => (typeof name === 'string' ? name.trim().slice(0, MAX_NAME) : '');
const configFor = (playerCount: brass.PlayerCount): brass.BrassConfig => ({ playerCount, components: brass.BIRMINGHAM_COMPONENTS });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
const fail = (message: string, status = 400) => json({ error: message }, status);

/** The host's seat (older games, from before there was one: the first person's). */
const hostOf = (game: StoredGame) => game.host ?? game.seats.findIndex((s) => s.kind === 'human');

/** "3 minutes", "1 hour", "1 day". */
function limitText(seconds: number): string {
  const [n, unit] = seconds % 86400 === 0 ? [seconds / 86400, 'day'] : seconds % 3600 === 0 ? [seconds / 3600, 'hour'] : [Math.round(seconds / 60), 'minute'];
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const parts = url.pathname.split('/').filter(Boolean);
    // GET /api/push-key: the key phones subscribe to notifications with.
    if (parts[0] === 'api' && parts[1] === 'push-key') {
      const key = vapidKey(env);
      return key ? json({ key: b64url(vapidPublicKey(key)) }) : fail('Notifications are not set up', 404);
    }
    if (parts[0] !== 'api' || parts[1] !== 'games') return fail('Not found', 404);

    // POST /api/games: a new game, with a fresh code.
    if (parts.length === 2 && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as CreateGameRequest | null;
      if (!body) return fail('Bad request');
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newCode();
        const res = await env.GAMES.get(env.GAMES.idFromName(code)).create(code, body);
        if (res !== 'taken') return 'error' in res ? fail(res.error) : json(res);
      }
      return fail('Could not find a free game code', 503);
    }

    const code = normalizeCode(parts[2] ?? '');
    if (code.length !== CODE_LENGTH) return fail('No such game', 404);
    const room = env.GAMES.get(env.GAMES.idFromName(code));

    // GET /api/games/CODE: who's in, before joining.
    if (parts.length === 3 && request.method === 'GET') {
      const info = await room.info();
      return info ? json(info) : fail('No such game', 404);
    }
    // POST /api/games/CODE/join: take a free seat.
    if (parts[3] === 'join' && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as JoinGameRequest | null;
      if (!body) return fail('Bad request');
      const res = await room.join(body);
      return 'error' in res ? fail(res.error, res.status) : json(res);
    }
    // POST /api/games/CODE/leave: leave the game (see LeaveGameRequest).
    if (parts[3] === 'leave' && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as LeaveGameRequest | null;
      if (!body) return fail('Bad request');
      const res = await room.leave(body);
      return 'error' in res ? fail(res.error, res.status) : json(res);
    }
    // POST /api/games/CODE/push: notifications for this phone in this game.
    if (parts[3] === 'push' && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as PushRegisterRequest | null;
      if (!body || !isPushSub(body.subscription)) return fail('Bad request');
      const res = await room.registerPush(body);
      return 'error' in res ? fail(res.error, res.status) : json(res);
    }
    // GET /api/games/CODE/ws?token=…: the live connection.
    if (parts[3] === 'ws' && request.headers.get('Upgrade') === 'websocket') return room.fetch(request);
    return fail('Not found', 404);
  },
};

export class GameRoom extends DurableObject<Env> {
  private game: StoredGame | null = null;
  private match: BrassMatch | null = null;

  private async load(): Promise<StoredGame | null> {
    this.game ??= (await this.ctx.storage.get<StoredGame>('game')) ?? null;
    return this.game;
  }

  private async save(game: StoredGame) {
    this.game = game;
    await this.ctx.storage.put('game', game);
  }

  /** The game so far, replayed from its seed and moves (kept in memory while the room is awake). */
  private matchOf(game: StoredGame): BrassMatch {
    if (this.match && this.match.log.length === game.log.length && this.match.seed === game.seed) return this.match;
    const r = replay(brass.brassGame, configFor(game.playerCount), game.seed, game.log);
    if (!r.ok) throw new Error(`Stored game ${game.code} doesn't replay: ${r.error}`);
    this.match = r.value;
    return this.match;
  }

  private publicSeats(game: StoredGame): PublicSeat[] {
    return game.seats.map((s, i) =>
      s.kind === 'bot'
        ? { kind: 'bot', difficulty: s.difficulty, name: s.name }
        : { kind: 'human', name: s.name, online: this.ctx.getWebSockets(String(i)).some((ws) => ws.readyState === WebSocket.OPEN) },
    );
  }

  async create(code: string, req: CreateGameRequest): Promise<SeatTicket | { error: string } | 'taken'> {
    if (await this.load()) return 'taken';
    const seats = req.seats;
    if (!Array.isArray(seats) || seats.length < 2 || seats.length > 4) return { error: 'A game has 2 to 4 players' };
    const first = seats.findIndex((s) => s.kind === 'human');
    if (first < 0) return { error: 'At least one player must be human' };
    // Against only bots there's nobody to play online with.
    if (seats.filter((s) => s.kind === 'human').length < 2) return { error: 'An online game needs at least one friend' };
    const name = cleanName(req.name);
    if (!name) return { error: 'Enter your name' };
    let bots = 0;
    const token = crypto.randomUUID();
    const stored: StoredSeat[] = seats.map((s: SeatSetup, i) => {
      if (s.kind === 'bot') {
        const difficulty = brass.AVAILABLE_DIFFICULTIES.includes(s.difficulty) ? s.difficulty : 'normal';
        return { kind: 'bot', difficulty, name: BOT_NAMES[bots++ % BOT_NAMES.length]! };
      }
      return i === first ? { kind: 'human', name, token } : { kind: 'human', name: null, token: null };
    });
    const humansLeft = stored.some((s) => s.kind === 'human' && !s.token);
    const turnLimit = typeof req.turnLimit === 'number' && TURN_LIMITS.includes(req.turnLimit) ? req.turnLimit : undefined;
    const game: StoredGame = {
      code,
      playerCount: seats.length as brass.PlayerCount,
      // With nobody else to wait for, the game starts straight away.
      status: humansLeft ? 'lobby' : 'playing',
      seed: randomSeed(),
      log: [],
      seats: stored,
      createdAt: Date.now(),
      host: first,
      ...(turnLimit && { turnLimit }),
    };
    if (game.status === 'playing') game.turnStartedAt = Date.now();
    await this.save(game);
    await this.scheduleTimeout(game);
    return { code, seat: first, token };
  }

  /** A rematch: everyone already seated, waiting in the lobby for whoever asked to start it. */
  async createRematch(code: string, setup: RematchSetup): Promise<'ok' | 'taken'> {
    if (await this.load()) return 'taken';
    const game: StoredGame = {
      code,
      playerCount: setup.playerCount,
      status: 'lobby',
      seed: randomSeed(),
      log: [],
      seats: setup.seats,
      createdAt: Date.now(),
      host: setup.host,
      ...(setup.turnLimit && { turnLimit: setup.turnLimit }),
    };
    await this.save(game);
    return 'ok';
  }

  /** Makes this game's rematch (once), and tells everyone. */
  private async rematch(game: StoredGame, by: number) {
    if (!game.rematch) {
      const tokens = game.seats.map((s) => (s.kind === 'human' && s.token ? crypto.randomUUID() : null));
      const seats: StoredSeat[] = game.seats.map((s, i) =>
        s.kind === 'bot' ? s : { kind: 'human', name: s.name, token: tokens[i]!, ...(s.push && { push: s.push }) },
      );
      const setup: RematchSetup = { playerCount: game.playerCount, seats, host: by, ...(game.turnLimit && { turnLimit: game.turnLimit }) };
      for (let attempt = 0; attempt < 5 && !game.rematch; attempt++) {
        const code = newCode();
        if ((await this.env.GAMES.get(this.env.GAMES.idFromName(code)).createRematch(code, setup)) === 'ok') game.rematch = { code, tokens, by };
      }
      if (!game.rematch) return;
      await this.save(game);
      const who = this.nameOf(game, by);
      for (const ws of this.ctx.getWebSockets()) {
        if (Number(this.ctx.getTags(ws)[0]) !== by) this.send(ws, { t: 'notice', message: `${who} wants a rematch!` });
      }
      this.notify(game, this.humans(game, by), () => ({ title: 'Rematch?', body: `${who} wants a rematch of game ${game.code}.` }));
    }
    this.broadcast(game);
  }

  async info(): Promise<LobbyInfo | null> {
    const game = await this.load();
    if (!game) return null;
    const match = this.matchOf(game);
    const finished = !!brass.brassGame.outcome(match.state);
    return {
      code: game.code,
      status: game.status,
      seats: this.publicSeats(game),
      current: game.status === 'playing' && !finished ? brass.currentPlayer(match.state) : null,
      finished,
      leftBy: game.leftBy ?? null,
    };
  }

  /** When the current turn runs out, if it can: only a person's turn, in a game with a turn limit, still going. */
  private deadline(game: StoredGame): number | null {
    if (game.status !== 'playing' || !game.turnLimit || game.turnStartedAt === undefined) return null;
    const state = this.matchOf(game).state;
    if (brass.brassGame.outcome(state)) return null;
    const current = brass.currentPlayer(state);
    if (current === null || game.seats[current]?.kind !== 'human') return null;
    return game.turnStartedAt + game.turnLimit * 1000;
  }

  /** Wakes the room when the turn runs out (replacing any earlier wake-up). */
  private async scheduleTimeout(game: StoredGame) {
    const at = this.deadline(game);
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }

  /** The turn ran out: the player passes (with a random card) for whatever is left of their turn. */
  override async alarm() {
    const game = await this.load();
    if (!game) return;
    const at = this.deadline(game);
    if (at === null) return;
    if (Date.now() < at) {
      await this.ctx.storage.setAlarm(at);
      return;
    }
    let match = this.matchOf(game);
    const player = brass.currentPlayer(match.state)!;
    // Each action left this turn is a Pass (or, when they must sell tiles to cover a debt, a random one).
    for (let i = 0; i < 8; i++) {
      const legal = brass.brassGame.legalActions(match.state, player);
      const passes = legal.filter((a) => a.type === 'pass');
      const options = passes.length > 0 ? passes : legal;
      const r = act(brass.brassGame, match, player, options[Math.floor(Math.random() * options.length)]!);
      if (!r.ok) break;
      match = r.value;
      const s = match.state;
      if (brass.brassGame.outcome(s) || brass.currentPlayer(s) !== player || (s.phase.kind === 'actions' && s.actionsTaken === 0)) break;
    }
    this.match = match;
    game.log = match.log;
    game.turnStartedAt = Date.now();
    await this.save(game);
    await this.scheduleTimeout(game);
    this.broadcast(game);
    const name = this.nameOf(game, player);
    for (const ws of this.ctx.getWebSockets()) {
      const you = Number(this.ctx.getTags(ws)[0]);
      this.send(ws, { t: 'notice', message: you === player ? 'You ran out of time, so you passed.' : `${name} ran out of time, so they passed.` });
    }
    this.notify(game, [player], () => ({ title: 'Your turn ran out', body: `You passed in game ${game.code}.` }));
    this.afterMove(game, player);
  }

  async leave(req: LeaveGameRequest): Promise<{ ok: true } | { error: string; status: number }> {
    const game = await this.load();
    if (!game) return { ok: true };
    const seat = game.seats.findIndex((s) => s.kind === 'human' && !!s.token && s.token === req.token);
    if (seat < 0) return { error: 'Not a player in this game', status: 403 };
    const finished = !!brass.brassGame.outcome(this.matchOf(game).state);
    if (finished || game.status === 'cancelled') return { ok: true };
    if (game.status === 'lobby') {
      // The seat is free again; with nobody left waiting, the game is called off.
      game.seats[seat] = { kind: 'human', name: null, token: null };
      const seated = game.seats.findIndex((s) => s.kind === 'human' && !!s.token);
      if (seated < 0) game.status = 'cancelled';
      // The host leaving hands the game (and starting it) to the next person in it.
      else if (hostOf(game) === seat) game.host = seated;
    } else {
      game.status = 'cancelled';
      game.leftBy = seat;
    }
    await this.save(game);
    await this.scheduleTimeout(game);
    for (const ws of this.ctx.getWebSockets(String(seat))) ws.close(4000, 'Left the game');
    this.broadcast(game);
    if (game.status === 'cancelled' && game.leftBy !== undefined) this.notifyCancelled(game);
    return { ok: true };
  }

  async registerPush(req: PushRegisterRequest): Promise<{ ok: true } | { error: string; status: number }> {
    const game = await this.load();
    if (!game) return { error: 'No such game', status: 404 };
    const seat = game.seats.find((s) => s.kind === 'human' && !!s.token && s.token === req.token);
    if (!seat || seat.kind !== 'human') return { error: 'Not a player in this game', status: 403 };
    // A few phones at most per seat (the latest kept); the same phone again just replaces itself.
    seat.push = [req.subscription, ...(seat.push ?? []).filter((p) => p.endpoint !== req.subscription.endpoint)].slice(0, 3);
    await this.save(game);
    return { ok: true };
  }

  // ---- Notifications ----

  /** Whether a player has the game on screen right now (then they don't need telling). */
  private looking(seat: number): boolean {
    return this.ctx
      .getWebSockets(String(seat))
      .some((ws) => ws.readyState === WebSocket.OPEN && (ws.deserializeAttachment() as { visible?: boolean } | null)?.visible !== false);
  }

  /** Notifies each of these seats that isn't looking (in the background: nothing waits for it). */
  private notify(game: StoredGame, seats: number[], message: (seat: number) => Omit<PushMessage, 'tag' | 'url'>) {
    const key = vapidKey(this.env);
    if (!key) return;
    const sends = seats.flatMap((i) => {
      const seat = game.seats[i];
      if (seat?.kind !== 'human' || !seat.push?.length || this.looking(i)) return [];
      const m: PushMessage = { ...message(i), tag: `brass-${game.code}`, url: `/?join=${game.code}` };
      return seat.push.map(async (sub) => ({ seat, sub, alive: await sendPush(sub, m, key, PUSH_SUBJECT).catch(() => true) }));
    });
    if (sends.length === 0) return;
    this.ctx.waitUntil(
      Promise.all(sends).then(async (results) => {
        // Forget subscriptions the push service says are gone.
        const dead = results.filter((r) => !r.alive);
        if (dead.length === 0) return;
        for (const { seat, sub } of dead) seat.push = (seat.push ?? []).filter((p) => p.endpoint !== sub.endpoint);
        await this.save(game);
      }),
    );
  }

  private nameOf(game: StoredGame, seat: number): string {
    const s = game.seats[seat];
    return s?.name ?? `Player ${seat + 1}`;
  }

  private humans(game: StoredGame, except?: number): number[] {
    return game.seats.flatMap((s, i) => (s.kind === 'human' && s.token && i !== except ? [i] : []));
  }

  /** After a turn ends: tells the next player it's theirs, or everyone that the game is over. */
  private afterMove(game: StoredGame, mover: number) {
    const state = this.matchOf(game).state;
    const outcome = brass.brassGame.outcome(state);
    if (outcome) {
      const winners = outcome.ranking.filter((r) => r.rank === 1).map((r) => this.nameOf(game, r.player));
      this.notify(game, this.humans(game), () => ({ title: 'Game over', body: `${winners.join(' and ')} won game ${game.code}.` }));
      return;
    }
    const current = brass.currentPlayer(state);
    if (current === null || game.seats[current]?.kind !== 'human') return;
    const limit = game.turnLimit ? ` You have ${limitText(game.turnLimit)}.` : '';
    this.notify(game, [current], () => ({ title: 'Your turn in Brass', body: `${this.nameOf(game, mover)} played in game ${game.code}.${limit}` }));
  }

  private notifyCancelled(game: StoredGame) {
    const who = this.nameOf(game, game.leftBy!);
    this.notify(game, this.humans(game, game.leftBy), () => ({ title: 'Game cancelled', body: `${who} left, so game ${game.code} has been cancelled.` }));
  }

  async join(req: JoinGameRequest): Promise<SeatTicket | { error: string; status: number }> {
    const game = await this.load();
    if (!game) return { error: 'No such game', status: 404 };
    const seat = game.seats[req.seat];
    if (!seat || seat.kind !== 'human') return { error: 'That seat is not for a player', status: 400 };
    if (seat.token) return { error: 'That seat is taken', status: 409 };
    const name = cleanName(req.name);
    if (!name) return { error: 'Enter your name', status: 400 };
    const token = crypto.randomUUID();
    game.seats[req.seat] = { kind: 'human', name, token };
    await this.save(game);
    this.broadcast(game);
    const waiting = game.seats.filter((s) => s.kind === 'human' && !s.token).length;
    this.notify(game, this.humans(game, req.seat), () => ({
      title: `${name} joined`,
      body: waiting > 0 ? `Game ${game.code}: waiting for ${waiting} more.` : `Game ${game.code} is ready to start.`,
    }));
    return { code: game.code, seat: req.seat, token };
  }

  /** The WebSocket: checks the seat's token, then keeps the socket (tagged with its seat) across hibernation. */
  override async fetch(request: Request): Promise<Response> {
    const game = await this.load();
    if (!game) return fail('No such game', 404);
    const token = new URL(request.url).searchParams.get('token');
    const seat = game.seats.findIndex((s) => s.kind === 'human' && !!s.token && s.token === token);
    if (seat < 0) return fail('Not a player in this game', 403);
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [String(seat)]);
    // A phone that just connected has the app open (it says when that changes).
    pair[1].serializeAttachment({ visible: true });
    // Everyone sees this player come online.
    this.broadcast(game);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    const game = await this.load();
    if (!game) return;
    const you = Number(this.ctx.getTags(ws)[0]);
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)) as ClientMessage;
    } catch {
      return this.send(ws, { t: 'error', message: 'Bad message' });
    }

    if (msg.t === 'visible') {
      ws.serializeAttachment({ ...((ws.deserializeAttachment() ?? {}) as object), visible: !!msg.visible });
      return;
    }

    if (msg.t === 'rematch') {
      if (game.status !== 'playing' || !brass.brassGame.outcome(this.matchOf(game).state)) {
        return this.send(ws, { t: 'error', message: 'A rematch can only be asked for once the game is over' });
      }
      return this.rematch(game, you);
    }

    if (msg.t === 'react') {
      if (!(REACTIONS as readonly string[]).includes(msg.reaction) || game.status === 'cancelled') return;
      // A little spacing, so nobody can flood everyone's screens.
      const attachment = (ws.deserializeAttachment() ?? {}) as { visible?: boolean; reactedAt?: number };
      if (Date.now() - (attachment.reactedAt ?? 0) < REACTION_GAP_MS) return;
      ws.serializeAttachment({ ...attachment, reactedAt: Date.now() });
      for (const other of this.ctx.getWebSockets()) this.send(other, { t: 'reaction', seat: you, reaction: msg.reaction });
      return;
    }

    if (msg.t === 'start') {
      if (game.status !== 'lobby') return this.send(ws, this.snapshotMessage(game, you));
      if (you !== hostOf(game)) return this.send(ws, { t: 'error', message: `Only ${this.nameOf(game, hostOf(game))} can start the game` });
      if (game.seats.some((s) => s.kind === 'human' && !s.token)) return this.send(ws, { t: 'error', message: 'Waiting for players' });
      game.status = 'playing';
      game.turnStartedAt = Date.now();
      await this.save(game);
      await this.scheduleTimeout(game);
      this.broadcast(game);
      const first = brass.currentPlayer(this.matchOf(game).state);
      this.notify(game, this.humans(game, you), (i) =>
        i === first
          ? { title: 'Your turn in Brass', body: `Game ${game.code} has started, and you go first.` }
          : { title: 'Game started', body: `Game ${game.code} has started.` },
      );
      return;
    }

    if (msg.t === 'act') {
      if (game.status !== 'playing') return this.send(ws, { t: 'error', message: 'The game has not started' });
      // Too late (the alarm is about to pass for them): pass now; the move itself is refused.
      const deadline = this.deadline(game);
      if (deadline !== null && Date.now() >= deadline) return this.alarm();
      // A move made on an older position (a bot played by two phones, or a late tap): resend the game.
      if (msg.at !== game.log.length) return this.send(ws, this.snapshotMessage(game, you));
      const seat = game.seats[msg.player];
      if (!seat || (msg.player !== you && seat.kind !== 'bot')) return this.send(ws, { t: 'error', message: "That isn't your seat" });
      const r = act(brass.brassGame, this.matchOf(game), msg.player, msg.action);
      if (!r.ok) {
        this.send(ws, { t: 'error', message: r.error });
        return this.send(ws, this.snapshotMessage(game, you));
      }
      const before = brass.currentPlayer(this.matchOf(game).state);
      this.match = r.value;
      game.log = r.value.log;
      // A new turn starts the clock (the same player can go twice in a row, across a round's end).
      const next = r.value.state;
      const newTurn = brass.currentPlayer(next) !== before || (next.phase.kind === 'actions' && next.actionsTaken === 0);
      if (newTurn) game.turnStartedAt = Date.now();
      await this.save(game);
      await this.scheduleTimeout(game);
      this.broadcast(game);
      if (newTurn || brass.brassGame.outcome(next)) this.afterMove(game, msg.player);
      return;
    }
  }

  override async webSocketClose(ws: WebSocket) {
    ws.close();
    const game = await this.load();
    // Everyone sees this player go offline (the closing socket no longer counts).
    if (game) this.broadcast(game, ws);
  }

  private snapshotMessage(game: StoredGame, you: number): ServerMessage {
    const snapshot: GameSnapshot = {
      code: game.code,
      playerCount: game.playerCount,
      status: game.status,
      seats: this.publicSeats(game),
      seed: game.seed,
      log: game.log,
      you,
      leftBy: game.leftBy ?? null,
      host: hostOf(game),
      turnLimit: game.turnLimit ?? null,
      turnDeadline: this.deadline(game),
      now: Date.now(),
      rematch: game.rematch?.tokens[you] ? { code: game.rematch.code, seat: you, token: game.rematch.tokens[you] } : null,
      rematchBy: game.rematch?.by ?? null,
    };
    return { t: 'state', game: snapshot };
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // A socket that's going away.
    }
  }

  private broadcast(game: StoredGame, except?: WebSocket) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      this.send(ws, this.snapshotMessage(game, Number(this.ctx.getTags(ws)[0])));
    }
  }
}
