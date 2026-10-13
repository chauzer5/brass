import type { BannerColor, Industry, PlayerCount } from '../types.ts';
import type { TownId } from './map.ts';

/*
 * Cards and Merchant tiles. Their contents aren't printed in the rulebook, so
 * the game takes them as a `Components` input. Setup removes every card and
 * Merchant tile whose player count is greater than the number of players
 * (rulebook p.4).
 */

export type CardSpec =
  | { kind: 'location'; location: TownId; minPlayers: PlayerCount }
  /** Builds any industry shown on the card; some cards show more than one icon. */
  | { kind: 'industry'; industries: readonly Industry[]; minPlayers: PlayerCount };

export interface MerchantTileSpec {
  /** Industries this Merchant buys; empty for a blank tile. */
  industries: readonly Industry[];
  minPlayers: PlayerCount;
}

export interface Components {
  cards: readonly CardSpec[];
  merchantTiles: readonly MerchantTileSpec[];
}

/**
 * Fewest players for each banner colour's Location cards (rulebook p.4):
 * blue and teal cards are removed with 2 players, teal with 3. Individual
 * cards can need more (one Uttoxeter card is 4-player only); see `cards.ts`.
 */
export const LOCATION_CARD_MIN_PLAYERS: Readonly<Record<BannerColor, PlayerCount>> = {
  blue: 3,
  teal: 4,
  red: 2,
  yellow: 2,
  purple: 2,
};

/** Wild Location and Wild Industry cards (rulebook p.1: 4 of each). */
export const WILD_CARDS_PER_KIND = 4;

/** Link tiles per player (rulebook p.1: 14 per colour). */
export const LINK_TILES_PER_PLAYER = 14;
