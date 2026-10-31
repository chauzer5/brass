import type { Bot, BotInput } from '../bot.ts';
import type { PlayerId } from '../kernel.ts';
import { createRng, type Rng } from '../rng.ts';
import type { BrassAction } from './actions.ts';
import { incomeLevel, ROUNDS_PER_ERA } from './data/economy.ts';
import { INDUSTRY_TILES } from './data/industries.ts';
import { LOCATION_BY_ID, MERCHANTS } from './data/map.ts';
import { brassGame, candidateActions, type BrassView } from './game.ts';
import { LINK_BY_ID, network } from './graph.ts';
import { RuleError } from './resources.ts';
import { actionsThisTurn, cloneState, currentPlayer, parseSlotKey, type BrassState, type Card, type CardId, type SlotKey } from './state.ts';
import { INDUSTRIES, type Industry } from './types.ts';

/*
 * A rules-of-thumb opponent. It sees only what a human in its seat would see
 * (its view and its legal actions). To judge a move it plays the move on a
 * stand-in game rebuilt from that view, with placeholder cards for anything
 * hidden (other hands, the deck), and scores the result with a hand-tuned
 * evaluation: VPs banked and on the way, income, money, network reach and the
 * quality of the tiles left to build. It looks at both actions of a turn
 * together, then adds a little noise so games vary.
 */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/** Difficulties with a bot behind them (all of them, now). */
export const AVAILABLE_DIFFICULTIES: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

/** The evaluation's hand-tuned numbers, in VPs (or VPs per unit). */
export interface Weights {
  /** A £1 is worth this many VPs; less in the last rounds, when there's little left to spend it on. */
  money: number;
  moneyLate: number;
  /** Negative income is weighed this many times over: when the money runs out it costs tiles or VPs. */
  negativeIncome: number;
  /** Chance an unflipped tile flips before the era ends: a sellable tile with / without a buyer in reach… */
  flipSellable: number;
  flipSellableNoBuyer: number;
  /** …a brewery (when there's something to sell with its beer), and a coal mine or iron works. */
  flipBrewery: number;
  flipCubes: number;
  /** Each link icon at a link's ends, and a little for owning the link at all. */
  linkIcon: number;
  linkBase: number;
  /** Places in the network, and Merchants reachable through anyone's links. */
  reach: number;
  merchantReach: number;
  /** The next tile of each industry: its VPs and link icons. */
  nextTile: number;
  /** A Wild card in hand. */
  wild: number;
  /**
   * Money the bot could still spend: about this much per round left (0: no
   * limit). Money beyond it counts a quarter, so a late loan isn't free VPs.
   */
  spendPerRound: number;
  /**
   * Extra worth of the first £20 in hand while there are rounds left to use it: with no money, no action
   * but a Loan or a Pass is possible, so being broke costs far more than the pounds themselves.
   */
  liquidity: number;
  /**
   * Money is only worth something while there are actions left to spend it: about this much per action
   * still to come (0: no limit). Beyond that it counts a tenth. Replaces `spendPerRound` when set.
   */
  spendPerAction: number;
  /**
   * An unflipped tile's chance to flip shrinks as the era's actions run out: full with this many of the
   * bot's own actions left in the era, scaled down below it (0: always full).
   */
  flipHorizon: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  money: 0.12,
  moneyLate: 0.04,
  negativeIncome: 2,
  flipSellable: 0.6,
  flipSellableNoBuyer: 0.25,
  flipBrewery: 0.45,
  flipCubes: 0.55,
  linkIcon: 0.9,
  linkBase: 0.3,
  reach: 0.25,
  merchantReach: 0.8,
  nextTile: 0.08,
  wild: 0.6,
  spendPerRound: 0,
  liquidity: 0,
  spendPerAction: 0,
  flipHorizon: 0,
};

export interface BotSettings {
  /** Random spread added to each first action's score, in VPs. */
  noise: number;
  /** How many of the best first actions get their follow-up action searched. */
  breadth: number;
  /** Chance of playing a reasonable but not best move: a random one of the `slack` best. */
  slip?: number;
  slack?: number;
  /**
   * How much the opponents' positions count against the bot's own: 0 plays
   * only for itself; 1 weighs the strongest opponent's gain as its own loss.
   */
  rivalry?: number;
  /**
   * Look a turn further for the best few plans: the others are assumed to pass (their moves can't be
   * known), then the bot's next turn is searched too (its `breadth` best first actions), so a move that
   * sets up the next turn (a build to sell, a link to a Merchant) is seen for what it leads to.
   */
  lookahead?: { plans: number; breadth: number };
  /**
   * Roughly how long a move may take (ms): past half of it no more first moves get their follow-ups
   * searched (beyond the best 5), and past all of it the lookahead stops (best plans first). A slow
   * phone searches less rather than keeping everyone waiting.
   */
  budgetMs?: number;
  weights?: Partial<Weights>;
}

/*
 * Tested head to head (2 players, 40 games a step): Hard beats Normal (shown as Medium) by 15+ VP a game.
 * Each move once rather than once per card made the old Hard's 20-move search really 20 moves (+21 VP
 * over it), and searching 40 with a lookahead over 8 plans added 7.5 more (+4 in 4-player games).
 * Its edge comes from looking a turn further for its best plans, searching many distinct first moves, valuing money only while there are actions to spend it, and
 * weighing what its moves give the leading opponent. Normal and Easy look at fewer moves (Easy often
 * plays a decent move instead of the best, never an idle pass). All three value cash in hand when
 * nearly broke (liquidity), so none sits passing with no money rather than borrowing.
 */
const SETTINGS: Record<BotDifficulty, BotSettings> = {
  easy: { noise: 5, breadth: 2, slip: 0.5, slack: 8, weights: { liquidity: 0.3, spendPerRound: 15 } },
  normal: { noise: 0.6, breadth: 10, weights: { liquidity: 0.3, spendPerRound: 15 } },
  hard: {
    noise: 0.2,
    rivalry: 0.5,
    breadth: 40,
    lookahead: { plans: 8, breadth: 6 },
    budgetMs: 1500,
    weights: { liquidity: 0.15, spendPerAction: 10, flipHorizon: 4 },
  },
};

// ---- A stand-in game from what the bot can see ----

/**
 * A full game state consistent with the bot's view. Cards it can't see (other
 * hands, the deck, face-down discards) become placeholder Location cards, so
 * rules that move cards around still work, and nothing hidden leaks into its
 * choices.
 */
function determinize(view: BrassView): BrassState {
  const cards: Record<CardId, Card> = { ...view.cards };
  let n = 0;
  const unknown = () => {
    const id = `?${n++}`;
    cards[id] = { id, kind: 'location', location: 'birmingham', minPlayers: 2 } as Card;
    return id;
  };
  for (const id of view.wildLocations) cards[id] = { id, kind: 'wildLocation' };
  for (const id of view.wildIndustries) cards[id] = { id, kind: 'wildIndustry' };
  const players = view.players.map(({ handSize, hasFaceDownDiscard, hand, ...p }) => ({
    ...structuredClone(p),
    hand: hand ? [...hand] : Array.from({ length: handSize }, unknown),
    faceDownDiscard: hasFaceDownDiscard ? unknown() : null,
  }));
  const { you: _you, deckSize, players: _players, cards: _cards, ...rest } = view;
  return { ...structuredClone(rest), players, cards, deck: Array.from({ length: deckSize }, unknown) };
}

// ---- Evaluation ----

/** The actions `me` still has in this era, counting what's left of the current turn (none once they've played this round). */
function actionsLeftInEra(state: BrassState, me: PlayerId): number {
  if (state.phase.kind === 'gameOver') return 0;
  const later = (ROUNDS_PER_ERA[state.playerCount] - state.round) * 2;
  const position = state.turnOrder.indexOf(me);
  const now =
    position > state.turnIndex ? actionsThisTurn(state) : position === state.turnIndex && state.phase.kind === 'actions' ? actionsThisTurn(state) - state.actionsTaken : 0;
  return later + now;
}

/** Rounds left in the game, counting the current one: how long income keeps paying. */
function roundsLeft(state: BrassState): number {
  const perEra = ROUNDS_PER_ERA[state.playerCount];
  return state.era === 'canal' ? perEra - state.round + 1 + perEra : perEra - state.round + 1;
}

const SELLABLE: readonly Industry[] = ['cotton', 'manufacturer', 'pottery'];

/** Link icons a location would score for links into it at the end of the era (flipped tiles and Merchant banners). */
function linkIcons(state: BrassState, location: string): number {
  const loc = LOCATION_BY_ID[location as keyof typeof LOCATION_BY_ID];
  let icons = loc.kind === 'merchant' ? loc.linkVP : 0;
  for (const [key, tile] of Object.entries(state.tiles) as [SlotKey, BrassState['tiles'][SlotKey]][]) {
    if (tile?.flipped && parseSlotKey(key).location === location) icons += INDUSTRY_TILES[tile.industry][tile.level - 1]!.linkVP;
  }
  return icons;
}

/** Groups of places joined by built links (union-find): two places are connected when they're in the same group. */
function linkGroups(state: BrassState): (location: string) => string {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const id of Object.keys(state.links)) {
    const [a, ...rest] = LINK_BY_ID[id]!.ends;
    for (const b of rest) {
      const ra = find(a!);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    }
  }
  return find;
}

/**
 * How good the position is for `me`, in VPs. VPs already scored count fully;
 * VPs that will be scored at the end of the era (flipped tiles, links) count
 * nearly fully; unflipped tiles count by how likely they are to flip; income
 * counts for the rounds it will still pay; money counts a little.
 */
export function evaluate(state: BrassState, me: PlayerId, w: Weights = DEFAULT_WEIGHTS): number {
  const p = state.players[me]!;
  const rounds = roundsLeft(state);
  const late = state.era === 'rail' && rounds <= 2;
  // Money is worth less as the game runs out of chances to spend it.
  const moneyWeight = late ? w.moneyLate : w.money;
  let v = p.vp;

  // Income: paid every remaining round. Negative income is worse than it looks: when the money runs out
  // it costs tiles (or VPs), so it's weighed double, and a shortfall coming at the end of this round is
  // charged now.
  const income = incomeLevel(p.incomeSpace);
  v += income * Math.max(0, rounds - 1) * moneyWeight * (income < 0 ? w.negativeIncome : 1);
  const eraActions = actionsLeftInEra(state, me);
  if (w.spendPerAction > 0) {
    // Actions still to come in the game: this era's, and the whole Rail Era's after the Canal Era.
    const actions = eraActions + (state.era === 'canal' ? ROUNDS_PER_ERA[state.playerCount] * 2 : 0);
    const cap = w.spendPerAction * actions;
    v += (Math.min(p.money, cap) + Math.max(0, p.money - cap) * 0.1) * moneyWeight;
  } else {
    const cap = w.spendPerRound > 0 ? w.spendPerRound * rounds : Infinity;
    v += (Math.min(p.money, cap) + Math.max(0, p.money - cap) * 0.25) * moneyWeight;
  }
  if (rounds > 2) v += Math.min(p.money, 20) * w.liquidity;
  if (income < 0 && p.money + income < 0) v -= (-(p.money + income)) * 0.8 + 2;

  // Is there anything on the board that beer can be sold with? (Beer and breweries are only worth it then.)
  const sellables = Object.values(state.tiles).filter((t) => t && !t.flipped && SELLABLE.includes(t.industry));
  const mySellables = sellables.filter((t) => t!.owner === me).length;

  const net = network(state, me);
  // Which places are joined by links (anyone's): connected places share a group.
  const group = linkGroups(state);
  const netGroups = new Set([...net].map((l) => group(l)));
  const merchantsInReach = MERCHANTS.filter((m) => netGroups.has(group(m.id))).length;

  // Tiles on the board.
  for (const [key, tile] of Object.entries(state.tiles) as [SlotKey, NonNullable<BrassState['tiles'][SlotKey]>][]) {
    if (tile.owner !== me) continue;
    const def = INDUSTRY_TILES[tile.industry][tile.level - 1]!;
    // Level 1 tiles leave the board at the end of the canal era, after scoring.
    const survives = !(state.era === 'canal' && tile.level === 1);
    const scorings = state.era === 'canal' && survives ? 2 : 1;
    if (tile.flipped) {
      v += def.vp * scorings * 0.95;
      continue;
    }
    // Unflipped: worth what it would score, times the chance it flips before the era ends.
    let flip: number;
    if (SELLABLE.includes(tile.industry)) {
      const { location } = parseSlotKey(key);
      const buyer = state.merchants.some((m) => m.tile?.industries.includes(tile.industry) && group(m.location) === group(location));
      flip = buyer ? w.flipSellable : w.flipSellableNoBuyer;
    } else if (tile.industry === 'brewery') {
      // Breweries flip when their beer is drunk by sales: only likely if someone has tiles to sell.
      flip = sellables.length === 0 ? 0.12 : tile.cubes <= 1 ? w.flipBrewery : w.flipBrewery * 0.67;
    } else {
      // Coal and iron flip when their cubes are used: likelier with fewer left.
      flip = tile.cubes <= 1 ? w.flipCubes : w.flipCubes * 0.64;
    }
    if (late) flip *= 0.5;
    if (w.flipHorizon > 0) {
      // Flipping in time for this era's scoring gets less likely as its actions run out; a Canal Era
      // tile that stays on the board can still flip in the Rail Era, for that scoring and its income.
      const now = flip * Math.max(0.15, Math.min(1, eraActions / w.flipHorizon));
      const eventually = scorings === 2 ? Math.max(flip, now) : now;
      v += def.vp * (now + (scorings === 2 ? eventually : 0)) + def.income * Math.max(0, rounds - 2) * moneyWeight * eventually;
    } else {
      v += (def.vp * scorings + def.income * Math.max(0, rounds - 2) * moneyWeight) * flip;
    }
    v += tile.cubes * (tile.industry === 'brewery' ? (mySellables > 0 ? 0.5 : 0.05) : 0.12);
  }

  // Links: score at the end of the era for the icons at both ends (which may still grow).
  for (const [id, owner] of Object.entries(state.links)) {
    if (owner !== me) continue;
    v += LINK_BY_ID[id]!.ends.reduce((s, end) => s + linkIcons(state, end), 0) * w.linkIcon + w.linkBase;
  }

  // Reach: more places to build, and Merchants to sell to.
  v += net.size * w.reach + merchantsInReach * w.merchantReach;

  // The tiles left to build: the next of each industry, if it can still be built this era.
  for (const industry of INDUSTRIES) {
    const level = p.mat[industry].findIndex((n) => n > 0);
    if (level < 0) continue;
    const def = INDUSTRY_TILES[industry][level]!;
    if (def.canalOnly && state.era === 'rail') {
      v -= 1.5;
      continue;
    }
    v += (def.vp + def.linkVP) * w.nextTile;
  }

  // Wild cards make every build possible.
  v += p.hand.filter((id) => state.cards[id]?.kind === 'wildLocation' || state.cards[id]?.kind === 'wildIndustry').length * w.wild;
  return v;
}

// ---- Search ----

/** Plays an action on a copy of the state (the RNG only matters for era-end shuffles of placeholder cards). */
function after(state: BrassState, me: PlayerId, action: BrassAction, rng: Rng): BrassState {
  return brassGame.apply(cloneState(state), me, action, rng);
}

/** Plays an action if it's legal (the engine throws a RuleError otherwise): checking and playing in one go. */
function tryAfter(state: BrassState, me: PlayerId, action: BrassAction, rng: Rng): BrassState | null {
  try {
    return after(state, me, action, rng);
  } catch (err) {
    if (err instanceof RuleError) return null;
    throw err;
  }
}

/**
 * The moves worth telling apart: the same move made with different cards is one move (the evaluation
 * doesn't tell ordinary cards apart), made with an ordinary card rather than a Wild one if it can be;
 * and one Scout stands for all of them (which cards go doesn't change the position's value either).
 */
function distinctMoves(state: BrassState, actions: readonly BrassAction[]): BrassAction[] {
  const isWild = (id: CardId) => {
    const kind = state.cards[id]?.kind;
    return kind === 'wildLocation' || kind === 'wildIndustry';
  };
  const chosen = new Map<string, BrassAction>();
  for (const a of actions) {
    if (a.type === 'removeTile') {
      chosen.set(JSON.stringify(a), a);
      continue;
    }
    const { card: _card, cards: _cards, ...rest } = a as BrassAction & { card?: CardId; cards?: CardId[] };
    const key = a.type === 'scout' ? 'scout' : JSON.stringify(rest);
    const kept = chosen.get(key);
    const wild = (x: BrassAction) => ('card' in x ? isWild(x.card) : 'cards' in x ? x.cards.some(isWild) : false);
    if (!kept || (wild(kept) && !wild(a))) chosen.set(key, a);
  }
  return [...chosen.values()];
}

/** Candidate moves worth trying from a position. */
function candidates(state: BrassState, me: PlayerId): BrassAction[] {
  return distinctMoves(state, candidateActions(state, me));
}

/** A position's worth to `me`: its own value, less (by `rivalry`) the best opponent's. */
type Score = (state: BrassState) => number;
function scorer(me: PlayerId, w: Weights, rivalry: number): Score {
  if (rivalry === 0) return (state) => evaluate(state, me, w);
  return (state) => {
    let rival = -Infinity;
    for (let p = 0; p < state.players.length; p++) if (p !== me) rival = Math.max(rival, evaluate(state, p, w));
    return evaluate(state, me, w) - rivalry * rival;
  };
}

/** The best follow-up: the bot's second action this turn, if it still has one. */
function bestFollowUp(state: BrassState, me: PlayerId, rng: Rng, score: Score): { score: number; action: BrassAction | null } {
  if (currentPlayer(state) !== me || state.phase.kind !== 'actions') return { score: score(state), action: null };
  let best = -Infinity;
  let bestAction: BrassAction | null = null;
  for (const a of candidates(state, me)) {
    const s = tryAfter(state, me, a, rng);
    if (!s) continue;
    const v = score(s) - (MILD_PENALTY[a.type] ?? 0);
    if (v > best) {
      best = v;
      bestAction = a;
    }
  }
  return best === -Infinity ? { score: score(state), action: null } : { score: best, action: bestAction };
}

/**
 * The others' turns, played as passes (the bot can't know their moves), until it's `me` to act again.
 * Null when that doesn't come (the game ends, or someone must cover a shortfall).
 */
function skipToMyTurn(state: BrassState, me: PlayerId, rng: Rng): BrassState | null {
  let s = cloneState(state);
  for (let i = 0; i < 16; i++) {
    const current = currentPlayer(s);
    if (current === null || s.phase.kind !== 'actions') return null;
    if (current === me) return s;
    const card = s.players[current]!.hand[0];
    if (!card) return null;
    s = brassGame.apply(s, current, { type: 'pass', card }, rng);
  }
  return null;
}

/** The best whole turn from here: its `breadth` best first actions, each with its best follow-up. */
function bestTurn(state: BrassState, me: PlayerId, rng: Rng, score: Score, breadth: number): number {
  const first: { state: BrassState; score: number }[] = [];
  for (const a of candidates(state, me)) {
    const s = tryAfter(state, me, a, rng);
    if (s) first.push({ state: s, score: score(s) - (MILD_PENALTY[a.type] ?? 0) });
  }
  if (first.length === 0) return score(state);
  first.sort((a, b) => b.score - a.score);
  return Math.max(...first.slice(0, breadth).map((f) => bestFollowUp(f.state, me, rng, score).score));
}

/** Scouting draws Wild cards; passing does nothing. Both are fine, but shouldn't win ties against doing something. */
const MILD_PENALTY: Partial<Record<BrassAction['type'], number>> = { pass: 1.5, scout: 0.4 };

/** The Brass bot at a given difficulty (or with custom settings, for tuning). */
export function brassBot(difficulty: BotDifficulty | BotSettings = 'normal'): Bot<BrassView, BrassAction> {
  const settings = typeof difficulty === 'string' ? SETTINGS[difficulty] : difficulty;
  const { noise, breadth, slip = 0, slack = 1, rivalry = 0, lookahead, budgetMs = Infinity } = settings;
  const weights = { ...DEFAULT_WEIGHTS, ...settings.weights };
  return ({ player, view, legalActions }: BotInput<BrassView, BrassAction>, rng: Rng): BrassAction => {
    if (legalActions.length === 0) throw new Error('The bot was asked to act with no legal actions');
    if (legalActions.length === 1) return legalActions[0]!;
    const started = performance.now();
    const elapsed = () => performance.now() - started;
    const state = determinize(view);
    const sim = createRng(rng.int(2 ** 31));
    const score = scorer(player, weights, rivalry);
    // One step: how good is the position right after each action?
    const first = distinctMoves(state, legalActions).map((action) => {
      const s = after(state, player, action, sim);
      return { action, state: s, score: score(s) - (MILD_PENALTY[action.type] ?? 0) };
    });
    first.sort((a, b) => b.score - a.score);
    // Two steps for the most promising: the best second action of the turn after each.
    const search = (f: (typeof first)[number]) => {
      const follow = bestFollowUp(f.state, player, sim, score);
      return { ...f, follow: follow.action, score: follow.score - (MILD_PENALTY[f.action.type] ?? 0) + (rng.next() * 2 - 1) * noise };
    };
    const searched: ReturnType<typeof search>[] = [];
    for (const f of first.slice(0, breadth)) {
      if (searched.length >= 5 && elapsed() > budgetMs / 2) break;
      searched.push(search(f));
    }
    // A good move found only as the second action (after a pass, say) is searched as a first action too, so
    // a short list of first moves doesn't make "pass, then the good move" look like the best plan.
    const seen = new Set(searched.map((f) => JSON.stringify(f.action)));
    for (const f of [...searched]) {
      if (!f.follow) continue;
      const key = JSON.stringify(f.follow);
      if (seen.has(key)) continue;
      seen.add(key);
      const firstMove = first.find((x) => JSON.stringify(x.action) === key);
      if (firstMove) searched.push(search(firstMove));
    }
    searched.sort((a, b) => b.score - a.score);
    // A turn further for the best plans: what the position after this turn lets the bot do next turn.
    if (lookahead) {
      for (const f of searched.slice(0, lookahead.plans)) {
        if (elapsed() > budgetMs) break;
        const end = f.follow ? (tryAfter(f.state, player, f.follow, sim) ?? f.state) : f.state;
        const next = skipToMyTurn(end, player, sim);
        if (next) f.score += bestTurn(next, player, sim, score, lookahead.breadth) - score(end);
      }
      searched.sort((a, b) => b.score - a.score);
    }
    // Now and then (easier bots), a decent move instead of the best one: a mistake, never an idle pass.
    if (slip > 0 && rng.next() < slip) {
      const decent = searched.slice(0, slack).filter((f) => f.action.type !== 'pass');
      if (decent.length > 0) return decent[rng.int(decent.length)]!.action;
    }
    return searched[0]!.action;
  };
}
