import type { PlayerId } from '../kernel.ts';
import type { Rng } from '../rng.ts';
import type { CardSpec, Components } from './data/components.ts';
import { LINK_TILES_PER_PLAYER, WILD_CARDS_PER_KIND } from './data/components.ts';
import { COAL_MARKET, HAND_SIZE, IRON_MARKET, STARTING_INCOME_SPACE, STARTING_MONEY } from './data/economy.ts';
import { INDUSTRY_TILES } from './data/industries.ts';
import { MERCHANTS, type LocationId, type MerchantId } from './data/map.ts';
import { INDUSTRIES, type Era, type Industry, type PlayerCount } from './types.ts';

export type CardId = string;

export type Card =
  | (CardSpec & { id: CardId })
  | { id: CardId; kind: 'wildLocation' }
  | { id: CardId; kind: 'wildIndustry' };

/** Identifies one build space: `${location}#${index}`. */
export type SlotKey = `${LocationId}#${number}`;

export const slotKey = (location: LocationId, index: number): SlotKey => `${location}#${index}`;

export function parseSlotKey(key: SlotKey): { location: LocationId; index: number } {
  const i = key.lastIndexOf('#');
  return { location: key.slice(0, i) as LocationId, index: Number(key.slice(i + 1)) };
}

export interface BuiltTile {
  owner: PlayerId;
  industry: Industry;
  level: number;
  flipped: boolean;
  /** Coal, iron or beer currently on the tile. */
  cubes: number;
}

export interface MerchantSpace {
  location: MerchantId;
  /** Industries bought here; `null` if no tile was placed (player count). */
  tile: { industries: readonly Industry[] } | null;
  beer: boolean;
}

export interface PlayerState {
  id: PlayerId;
  money: number;
  /** Position of the Income Marker on the Progress Track. */
  incomeSpace: number;
  vp: number;
  hand: CardId[];
  /** Face-up discards, oldest first. */
  discard: CardId[];
  /** The face-down card drawn at setup (rulebook p.5), hidden from opponents. */
  faceDownDiscard: CardId | null;
  /** Money placed on the Character tile this round (rulebook p.6). */
  spent: number;
  /** Tiles still on the Player Mat: remaining count per level (index 0 = level 1). */
  mat: Record<Industry, number[]>;
  linksInSupply: number;
}

export type Phase =
  | { kind: 'actions' }
  /** A player must remove Industry tiles to cover negative income (rulebook p.6). */
  | { kind: 'shortfall'; queue: { player: PlayerId; owed: number }[] }
  | { kind: 'gameOver' };

export interface BrassState {
  playerCount: PlayerCount;
  cards: Record<CardId, Card>;
  era: Era;
  /** Round within the current era, starting at 1. */
  round: number;
  turnOrder: PlayerId[];
  /** Index into `turnOrder` of the player taking their turn. */
  turnIndex: number;
  actionsTaken: number;
  phase: Phase;
  players: PlayerState[];
  deck: CardId[];
  wildLocations: CardId[];
  wildIndustries: CardId[];
  /** Built Industry tiles by space. Empty spaces are absent. */
  tiles: Partial<Record<SlotKey, BuiltTile>>;
  /** Link tile owners by link id. Undeveloped lines are absent. */
  links: Record<string, PlayerId>;
  coalMarket: number;
  ironMarket: number;
  merchants: MerchantSpace[];
}

export interface BrassConfig {
  playerCount: PlayerCount;
  components: Components;
}

function freshMat(): Record<Industry, number[]> {
  return Object.fromEntries(INDUSTRIES.map((ind) => [ind, INDUSTRY_TILES[ind].map((t) => t.count)])) as Record<
    Industry,
    number[]
  >;
}

/** Board and player area setup (rulebook pp.4–5). */
export function setup({ playerCount, components }: BrassConfig, rng: Rng): BrassState {
  const cards: Record<CardId, Card> = {};
  const deckIds: CardId[] = [];
  components.cards
    .filter((c) => c.minPlayers <= playerCount)
    .forEach((c, i) => {
      const id = `c${i}`;
      cards[id] = { ...c, id };
      deckIds.push(id);
    });

  const wildLocations: CardId[] = [];
  const wildIndustries: CardId[] = [];
  for (let i = 0; i < WILD_CARDS_PER_KIND; i++) {
    cards[`wl${i}`] = { id: `wl${i}`, kind: 'wildLocation' };
    cards[`wi${i}`] = { id: `wi${i}`, kind: 'wildIndustry' };
    wildLocations.push(`wl${i}`);
    wildIndustries.push(`wi${i}`);
  }

  // Merchant tiles go face up on the spaces for this player count.
  const tiles = rng.shuffle(components.merchantTiles.filter((t) => t.minPlayers <= playerCount));
  const merchants: MerchantSpace[] = [];
  for (const m of MERCHANTS) {
    for (let s = 0; s < m.spaces; s++) {
      const tile = m.minPlayers <= playerCount ? (tiles.pop() ?? null) : null;
      if (m.minPlayers <= playerCount && !tile) {
        throw new Error(`Not enough Merchant tiles for ${playerCount} players`);
      }
      merchants.push({
        location: m.id,
        tile: tile && { industries: tile.industries },
        beer: !!tile && tile.industries.length > 0,
      });
    }
  }
  if (tiles.length > 0) throw new Error(`Too many Merchant tiles for ${playerCount} players`);

  const deck = rng.shuffle(deckIds);
  const players: PlayerState[] = [];
  for (let id = 0; id < playerCount; id++) {
    players.push({
      id,
      money: STARTING_MONEY,
      incomeSpace: STARTING_INCOME_SPACE,
      vp: 0,
      hand: deck.splice(0, HAND_SIZE),
      discard: [],
      faceDownDiscard: deck.shift() ?? null,
      spent: 0,
      mat: freshMat(),
      linksInSupply: LINK_TILES_PER_PLAYER,
    });
  }

  return {
    playerCount,
    cards,
    era: 'canal',
    round: 1,
    turnOrder: rng.shuffle(players.map((p) => p.id)),
    turnIndex: 0,
    actionsTaken: 0,
    phase: { kind: 'actions' },
    players,
    deck,
    wildLocations,
    wildIndustries,
    tiles: {},
    links: {},
    coalMarket: COAL_MARKET.initialCubes,
    ironMarket: IRON_MARKET.initialCubes,
    merchants,
  };
}

export function currentPlayer(state: BrassState): PlayerId | null {
  switch (state.phase.kind) {
    case 'actions':
      return state.turnOrder[state.turnIndex] ?? null;
    case 'shortfall':
      return state.phase.queue[0]?.player ?? null;
    case 'gameOver':
      return null;
  }
}

/** Actions per turn: 1 in the first round of the Canal Era, otherwise 2 (rulebook p.6). */
export function actionsThisTurn(state: BrassState): number {
  return state.era === 'canal' && state.round === 1 ? 1 : 2;
}
