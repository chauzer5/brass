import { createRng, type Rng } from './rng.ts';

/**
 * The game kernel: a small, rules-agnostic harness that every game definition
 * (Brass, or a test fixture) plugs into. It owns the things every caller needs
 * to agree on: deterministic randomness, the action log, legality checks and
 * per-player views. The UI, the bot worker and a future multiplayer server
 * all talk to a match only through these functions.
 */

export type PlayerId = number;

export interface GameDefinition<Config, State, Action, View> {
  readonly name: string;

  /** Builds the initial state. All shuffling must go through `rng`. */
  setup(config: Config, rng: Rng): State;

  /** Players allowed to act right now (empty once the game is over). */
  activePlayers(state: State): readonly PlayerId[];

  /**
   * Every action `player` may take now. Used to drive the UI (what to
   * highlight) and bots. Must agree with `validate`.
   */
  legalActions(state: State, player: PlayerId): Action[];

  /** `null` if `action` is legal for `player`, otherwise a human-readable reason. */
  validate(state: State, player: PlayerId, action: Action): string | null;

  /**
   * Applies a validated action. Receives a private copy of the state, so it
   * may mutate and return it.
   */
  apply(state: State, player: PlayerId, action: Action, rng: Rng): State;

  /**
   * What `player` is allowed to see (`null` = spectator). Hidden information
   * (other hands, deck order) must be stripped here: in multiplayer this is
   * the only thing that ever leaves the server.
   */
  viewFor(state: State, player: PlayerId | null): View;

  /** Final result once the game has ended, otherwise `null`. */
  outcome(state: State): Outcome | null;
}

export interface Outcome {
  /** Players in finishing order; ties share a rank. */
  ranking: { player: PlayerId; rank: number; score: number }[];
}

export interface LoggedAction<Action> {
  player: PlayerId;
  action: Action;
}

/** Everything needed to persist, resume or replay a match. Plain JSON. */
export interface Match<Config, State, Action> {
  config: Config;
  seed: number;
  rngState: number;
  state: State;
  log: LoggedAction<Action>[];
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

type AnyDefinition<C, S, A> = GameDefinition<C, S, A, unknown>;

export function createMatch<C, S, A>(
  def: AnyDefinition<C, S, A>,
  config: C,
  seed: number,
): Match<C, S, A> {
  const rng = createRng(seed);
  const state = def.setup(config, rng);
  return { config, seed, rngState: rng.state(), state, log: [] };
}

/** Validates and applies one action. Never mutates `match`. */
export function act<C, S, A>(
  def: AnyDefinition<C, S, A>,
  match: Match<C, S, A>,
  player: PlayerId,
  action: A,
): Result<Match<C, S, A>> {
  if (def.outcome(match.state)) {
    return { ok: false, error: 'The game is over' };
  }
  if (!def.activePlayers(match.state).includes(player)) {
    return { ok: false, error: `It is not player ${player}'s turn` };
  }
  const reason = def.validate(match.state, player, action);
  if (reason !== null) {
    return { ok: false, error: reason };
  }

  const rng = createRng(match.rngState);
  const state = def.apply(structuredClone(match.state), player, structuredClone(action), rng);
  return {
    ok: true,
    value: {
      ...match,
      rngState: rng.state(),
      state,
      log: [...match.log, { player, action }],
    },
  };
}

/**
 * Rebuilds a match from its config, seed and action log. Used for loading
 * saves, undo (replay all but the last N actions) and reproducing bugs.
 */
export function replay<C, S, A>(
  def: AnyDefinition<C, S, A>,
  config: C,
  seed: number,
  log: readonly LoggedAction<A>[],
): Result<Match<C, S, A>> {
  let match = createMatch(def, config, seed);
  for (const [i, entry] of log.entries()) {
    const next = act(def, match, entry.player, entry.action);
    if (!next.ok) {
      return { ok: false, error: `Action #${i} is illegal on replay: ${next.error}` };
    }
    match = next.value;
  }
  return { ok: true, value: match };
}

/** Undo by replaying everything except the last `count` actions. */
export function undo<C, S, A>(
  def: AnyDefinition<C, S, A>,
  match: Match<C, S, A>,
  count = 1,
): Result<Match<C, S, A>> {
  return replay(def, match.config, match.seed, match.log.slice(0, Math.max(0, match.log.length - count)));
}
