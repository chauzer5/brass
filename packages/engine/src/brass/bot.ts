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
import { currentPlayer, parseSlotKey, type BrassState, type Card, type CardId, type SlotKey } from './state.ts';
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

/** Difficulties with a bot behind them; the others are listed but not yet available. */
export const AVAILABLE_DIFFICULTIES: readonly BotDifficulty[] = ['normal'];

interface Settings {
  /** Random spread added to each first action's score, in VPs. */
  noise: number;
  /** How many of the best first actions get their follow-up action searched. */
  breadth: number;
}

const SETTINGS: Record<BotDifficulty, Settings> = {
  easy: { noise: 4, breadth: 4 },
  normal: { noise: 0.6, breadth: 10 },
  hard: { noise: 0.2, breadth: 20 },
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
export function evaluate(state: BrassState, me: PlayerId): number {
  const p = state.players[me]!;
  const rounds = roundsLeft(state);
  const late = state.era === 'rail' && rounds <= 2;
  // Money is worth less as the game runs out of chances to spend it.
  const moneyWeight = late ? 0.04 : 0.12;
  let v = p.vp;

  // Income: paid every remaining round. Negative income is worse than it looks: when the money runs out
  // it costs tiles (or VPs), so it's weighed double, and a shortfall coming at the end of this round is
  // charged now.
  const income = incomeLevel(p.incomeSpace);
  v += income * Math.max(0, rounds - 1) * moneyWeight * (income < 0 ? 2 : 1);
  v += p.money * moneyWeight;
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
      flip = buyer ? 0.6 : 0.25;
    } else if (tile.industry === 'brewery') {
      // Breweries flip when their beer is drunk by sales: only likely if someone has tiles to sell.
      flip = sellables.length === 0 ? 0.12 : tile.cubes <= 1 ? 0.45 : 0.3;
    } else {
      // Coal and iron flip when their cubes are used: likelier with fewer left.
      flip = tile.cubes <= 1 ? 0.55 : 0.35;
    }
    if (late) flip *= 0.5;
    v += (def.vp * scorings + def.income * Math.max(0, rounds - 2) * moneyWeight) * flip;
    v += tile.cubes * (tile.industry === 'brewery' ? (mySellables > 0 ? 0.5 : 0.05) : 0.12);
  }

  // Links: score at the end of the era for the icons at both ends (which may still grow).
  for (const [id, owner] of Object.entries(state.links)) {
    if (owner !== me) continue;
    v += LINK_BY_ID[id]!.ends.reduce((s, end) => s + linkIcons(state, end), 0) * 0.9 + 0.3;
  }

  // Reach: more places to build, and Merchants to sell to.
  v += net.size * 0.25 + merchantsInReach * 0.8;

  // The tiles left to build: the next of each industry, if it can still be built this era.
  for (const industry of INDUSTRIES) {
    const level = p.mat[industry].findIndex((n) => n > 0);
    if (level < 0) continue;
    const def = INDUSTRY_TILES[industry][level]!;
    if (def.canalOnly && state.era === 'rail') {
      v -= 1.5;
      continue;
    }
    v += (def.vp + def.linkVP) * 0.08;
  }

  // Wild cards make every build possible.
  v += p.hand.filter((id) => state.cards[id]?.kind === 'wildLocation' || state.cards[id]?.kind === 'wildIndustry').length * 0.6;
  return v;
}

// ---- Search ----

/** Plays an action on a copy of the state (the RNG only matters for era-end shuffles of placeholder cards). */
function after(state: BrassState, me: PlayerId, action: BrassAction, rng: Rng): BrassState {
  return brassGame.apply(structuredClone(state), me, action, rng);
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

/** Candidate moves worth trying: one Scout stands for all of them (which cards go doesn't change the position's value). */
function candidates(state: BrassState, me: PlayerId): BrassAction[] {
  let scouted = false;
  return candidateActions(state, me).filter((a) => {
    if (a.type !== 'scout') return true;
    if (scouted) return false;
    scouted = true;
    return true;
  });
}

/** The best follow-up: the bot's second action this turn, if it still has one. */
function bestFollowUp(state: BrassState, me: PlayerId, rng: Rng): number {
  if (currentPlayer(state) !== me || state.phase.kind !== 'actions') return evaluate(state, me);
  let best = -Infinity;
  for (const a of candidates(state, me)) {
    const s = tryAfter(state, me, a, rng);
    if (s) best = Math.max(best, evaluate(s, me) - (MILD_PENALTY[a.type] ?? 0));
  }
  return best === -Infinity ? evaluate(state, me) : best;
}

/** Scouting draws Wild cards; passing does nothing. Both are fine, but shouldn't win ties against doing something. */
const MILD_PENALTY: Partial<Record<BrassAction['type'], number>> = { pass: 1.5, scout: 0.4 };

/** The Brass bot at a given difficulty. */
export function brassBot(difficulty: BotDifficulty = 'normal'): Bot<BrassView, BrassAction> {
  const { noise, breadth } = SETTINGS[difficulty];
  return ({ player, view, legalActions }: BotInput<BrassView, BrassAction>, rng: Rng): BrassAction => {
    if (legalActions.length === 0) throw new Error('The bot was asked to act with no legal actions');
    if (legalActions.length === 1) return legalActions[0]!;
    const state = determinize(view);
    const sim = createRng(rng.int(2 ** 31));
    // One step: how good is the position right after each action?
    const first = legalActions.map((action) => {
      const s = after(state, player, action, sim);
      return { action, state: s, score: evaluate(s, player) - (MILD_PENALTY[action.type] ?? 0) };
    });
    first.sort((a, b) => b.score - a.score);
    // Two steps for the most promising: the best second action of the turn after each.
    const searched = first.slice(0, breadth).map((f) => ({
      ...f,
      score: bestFollowUp(f.state, player, sim) - (MILD_PENALTY[f.action.type] ?? 0) + (rng.next() * 2 - 1) * noise,
    }));
    searched.sort((a, b) => b.score - a.score);
    return searched[0]!.action;
  };
}
