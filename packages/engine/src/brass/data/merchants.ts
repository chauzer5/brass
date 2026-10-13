import type { Components, MerchantTileSpec } from './components.ts';
import { BIRMINGHAM_CARDS } from './cards.ts';

/**
 * The 9 Merchant tiles. Setup shuffles the ones for the player count and
 * places one on each Merchant space for that count (rulebook p.4).
 */
export const BIRMINGHAM_MERCHANT_TILES: readonly MerchantTileSpec[] = [
  { industries: ['cotton'], minPlayers: 2 },
  { industries: ['manufacturer'], minPlayers: 2 },
  { industries: ['cotton', 'manufacturer', 'pottery'], minPlayers: 2 },
  { industries: [], minPlayers: 2 },
  { industries: [], minPlayers: 2 },
  { industries: ['pottery'], minPlayers: 3 },
  { industries: [], minPlayers: 3 },
  { industries: ['cotton'], minPlayers: 4 },
  { industries: ['manufacturer'], minPlayers: 4 },
];

export const BIRMINGHAM_COMPONENTS: Components = {
  cards: BIRMINGHAM_CARDS,
  merchantTiles: BIRMINGHAM_MERCHANT_TILES,
};
