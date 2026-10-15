import type { GameDefinition, Outcome, PlayerId } from '../kernel.ts';
import { createRng } from '../rng.ts';
import { perform, lowestLevel, type BrassAction, type Sale } from './actions.ts';
import { incomeLevel } from './data/economy.ts';
import { INDUSTRY_TILES } from './data/industries.ts';
import { LINKS, LOCATIONS } from './data/map.ts';
import { hasTilesOnBoard, isConnected, network } from './graph.ts';
import { RuleError } from './resources.ts';
import {
  cloneState,
  currentPlayer,
  parseSlotKey,
  setup,
  type BrassConfig,
  type BrassState,
  type Card,
  type CardId,
  type PlayerState,
  type SlotKey,
} from './state.ts';
import { INDUSTRIES, type Industry } from './types.ts';

export interface PlayerView extends Omit<PlayerState, 'hand' | 'faceDownDiscard'> {
  /** Only visible to the player themselves. */
  hand: CardId[] | null;
  handSize: number;
  hasFaceDownDiscard: boolean;
}

export interface BrassView extends Omit<BrassState, 'deck' | 'players' | 'cards'> {
  you: PlayerId | null;
  deckSize: number;
  players: PlayerView[];
  /** Definitions of the cards this viewer can see (own hand and all discards). */
  cards: Record<CardId, Card>;
}

function viewFor(state: BrassState, you: PlayerId | null): BrassView {
  const visible = new Set<CardId>();
  const players = state.players.map((p): PlayerView => {
    const { hand, faceDownDiscard, ...rest } = p;
    const own = p.id === you;
    if (own) hand.forEach((c) => visible.add(c));
    p.discard.forEach((c) => visible.add(c));
    return {
      ...structuredClone(rest),
      hand: own ? [...hand] : null,
      handSize: hand.length,
      hasFaceDownDiscard: faceDownDiscard !== null,
    };
  });
  const { deck, cards, ...rest } = state;
  return {
    ...structuredClone(rest),
    you,
    deckSize: deck.length,
    players,
    cards: Object.fromEntries([...visible].map((id) => [id, cards[id]!])),
  };
}

function validate(state: BrassState, player: PlayerId, action: BrassAction): string | null {
  try {
    perform(cloneState(state), player, action, createRng(0));
    return null;
  } catch (err) {
    if (err instanceof RuleError) return err.message;
    throw err;
  }
}

/** One card per distinct card type in hand, so equivalent actions aren't listed twice. */
/** Identifies cards that are interchangeable (same kind, location or industries). */
export function cardSignature(card: Card): string {
  const { id: _, ...spec } = card;
  return JSON.stringify(spec);
}

function distinctCards(state: BrassState, hand: readonly CardId[]): CardId[] {
  const seen = new Map<string, CardId>();
  for (const id of hand) {
    const sig = cardSignature(state.cards[id]!);
    if (!seen.has(sig)) seen.set(sig, id);
  }
  return [...seen.values()];
}

function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  return items.flatMap((x, i) => combinations(items.slice(i + 1), k - 1).map((rest) => [x, ...rest]));
}

/**
 * Candidate actions. Resource sources (which mine, which brewery) are left to
 * the automatic choice, so this lists every distinct *kind* of move but not
 * every way of paying for it. Candidates are filtered through `validate`.
 */
export function candidateActions(state: BrassState, player: PlayerId): BrassAction[] {
  const p = state.players[player]!;
  if (state.phase.kind === 'shortfall') {
    return (Object.entries(state.tiles) as [SlotKey, { owner: PlayerId }][])
      .filter(([, t]) => t.owner === player)
      .map(([key]) => ({ type: 'removeTile', ...slotOf(key) }));
  }

  const cards = distinctCards(state, p.hand);
  const out: BrassAction[] = [];
  const net = network(state, player);
  const noTiles = !hasTilesOnBoard(state, player);

  for (const card of cards) {
    out.push({ type: 'loan', card }, { type: 'pass', card });

    // Build.
    const c = state.cards[card]!;
    for (const industry of INDUSTRIES) {
      if (lowestLevel(p, industry) === null) continue;
      if (c.kind === 'industry' && !c.industries.includes(industry)) continue;
      for (const loc of LOCATIONS) {
        if (loc.kind === 'merchant') continue;
        if (c.kind === 'location' && c.location !== loc.id) continue;
        if ((c.kind === 'industry' || c.kind === 'wildIndustry') && !noTiles && !net.has(loc.id)) continue;
        loc.slots.forEach((slot, i) => {
          if (slot.includes(industry)) out.push({ type: 'build', card, industry, location: loc.id, slot: i });
        });
      }
    }

    // Develop.
    for (const industries of [...INDUSTRIES.map((i) => [i]), ...combinationsWithRepeat(INDUSTRIES, 2)]) {
      out.push({ type: 'develop', card, industries });
    }

    // Network.
    const free = LINKS.filter((l) => state.links[l.id] === undefined && (state.era === 'canal' ? l.canal : l.rail));
    const adjacent = free.filter((l) => noTiles || l.ends.some((e) => net.has(e)));
    for (const first of adjacent) {
      out.push({ type: 'network', card, links: [first.id] });
      if (state.era !== 'rail') continue;
      for (const second of free) {
        if (second.id === first.id) continue;
        if (!second.ends.some((e) => net.has(e) || first.ends.includes(e))) continue;
        out.push({ type: 'network', card, links: [first.id, second.id] });
      }
    }

    // Sell: every subset of sellable tiles, each to an automatically chosen Merchant,
    // plus every single tile to every Merchant (the choice decides the beer bonus).
    const sellable = (Object.entries(state.tiles) as [SlotKey, NonNullable<BrassState['tiles'][SlotKey]>][])
      .filter(([, t]) => t.owner === player && !t.flipped && ['cotton', 'manufacturer', 'pottery'].includes(t.industry))
      .slice(0, 6);
    const merchantsFor = ([key, t]: (typeof sellable)[number]) =>
      state.merchants
        .map((m, i) => ({ m, i }))
        .filter(({ m }) => m.tile?.industries.includes(t.industry) && isConnected(state, [slotOf(key).location], m.location));
    for (const tile of sellable) {
      for (const { i } of merchantsFor(tile)) out.push({ type: 'sell', card, sales: [{ ...slotOf(tile[0]), merchant: i }] });
    }
    for (let k = 2; k <= sellable.length; k++) {
      for (const subset of combinations(sellable, k)) {
        const sales: Sale[] = [];
        for (const tile of subset) {
          const options = merchantsFor(tile);
          // Each barrel serves only the tile beside it: prefer one with beer that no earlier sale here has claimed.
          const claimed = new Set(sales.map((s) => s.merchant));
          const pick = options.find(({ m, i }) => m.beer && !claimed.has(i)) ?? options.find(({ i }) => !claimed.has(i)) ?? options[0];
          if (!pick) break;
          sales.push({ ...slotOf(tile[0]), merchant: pick.i });
        }
        if (sales.length === subset.length) out.push({ type: 'sell', card, sales });
      }
    }
  }

  // Scout.
  if (p.hand.length >= 3) {
    const seen = new Set<string>();
    for (const trio of combinations(p.hand, 3)) {
      const sig = trio.map((id) => JSON.stringify({ ...state.cards[id], id: undefined })).sort().join('|');
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push({ type: 'scout', cards: trio });
    }
  }
  return out;
}

function combinationsWithRepeat<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  return items.flatMap((x, i) => combinationsWithRepeat(items.slice(i), k - 1).map((rest) => [x, ...rest]));
}

function slotOf(key: SlotKey) {
  const { location, index } = parseSlotKey(key);
  return { location, slot: index };
}

function outcome(state: BrassState): Outcome | null {
  if (state.phase.kind !== 'gameOver') return null;
  // Most VPs; ties broken by income level, then money (rulebook p.7).
  const key = (p: PlayerState) => [p.vp, incomeLevel(p.incomeSpace), p.money] as const;
  const cmp = (a: PlayerState, b: PlayerState) => {
    const [ka, kb] = [key(a), key(b)];
    for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return kb[i]! - ka[i]!;
    return 0;
  };
  const sorted = [...state.players].sort(cmp);
  return {
    ranking: sorted.map((p) => ({
      player: p.id,
      score: p.vp,
      rank: 1 + sorted.findIndex((o) => cmp(o, p) === 0),
    })),
  };
}

export const brassGame: GameDefinition<BrassConfig, BrassState, BrassAction, BrassView> = {
  name: 'brass-birmingham',
  setup,
  activePlayers: (state) => {
    const p = currentPlayer(state);
    return p === null ? [] : [p];
  },
  legalActions: (state, player) =>
    currentPlayer(state) === player ? candidateActions(state, player).filter((a) => validate(state, player, a) === null) : [],
  validate,
  apply: (state, player, action, rng) => {
    perform(state, player, action, rng);
    return state;
  },
  viewFor,
  outcome,
};

/** Tile stats for a level, re-exported for UIs. */
export const tileStats = (industry: Industry, level: number) => INDUSTRY_TILES[industry][level - 1]!;
