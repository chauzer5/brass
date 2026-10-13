import type { Industry, PlayerCount } from '../types.ts';
import type { CardSpec } from './components.ts';
import type { TownId } from './map.ts';

/*
 * The Draw Deck, from the "Card Distribution" player aid. Each row gives the
 * total number of that card in a 2-, 3- and 4-player game; the extra cards in
 * a larger game are the ones marked with that player count.
 */

type Counts = readonly [two: number, three: number, four: number];

const LOCATION_COUNTS: Readonly<Record<TownId, Counts>> = {
  // Teal
  belper: [0, 0, 2],
  derby: [0, 0, 3],
  // Blue
  leek: [0, 2, 2],
  stoke: [0, 3, 3],
  stone: [0, 2, 2],
  uttoxeter: [0, 1, 2],
  // Red
  stafford: [2, 2, 2],
  burton: [2, 2, 2],
  cannock: [2, 2, 2],
  tamworth: [1, 1, 1],
  walsall: [1, 1, 1],
  // Yellow
  coalbrookdale: [3, 3, 3],
  dudley: [2, 2, 2],
  kidderminster: [2, 2, 2],
  wolverhampton: [2, 2, 2],
  worcester: [2, 2, 2],
  // Purple
  birmingham: [3, 3, 3],
  coventry: [3, 3, 3],
  nuneaton: [1, 1, 1],
  redditch: [1, 1, 1],
};

/** Industry cards; "Man. Goods / Cotton Mill" is one card showing both icons. */
const INDUSTRY_COUNTS: readonly { industries: readonly Industry[]; counts: Counts }[] = [
  { industries: ['iron'], counts: [4, 4, 4] },
  { industries: ['coal'], counts: [2, 2, 3] },
  { industries: ['manufacturer', 'cotton'], counts: [0, 6, 8] },
  { industries: ['pottery'], counts: [2, 2, 3] },
  { industries: ['brewery'], counts: [5, 5, 5] },
];

const PLAYER_COUNTS: readonly PlayerCount[] = [2, 3, 4];

/** Splits cumulative counts into cards marked with each player count. */
function expand<T>(counts: Counts, make: (minPlayers: PlayerCount) => T): T[] {
  return PLAYER_COUNTS.flatMap((n, i) => {
    const added = counts[i]! - (i === 0 ? 0 : counts[i - 1]!);
    return Array.from({ length: added }, () => make(n));
  });
}

export const BIRMINGHAM_CARDS: readonly CardSpec[] = [
  ...(Object.entries(LOCATION_COUNTS) as [TownId, Counts][]).flatMap(([location, counts]) =>
    expand(counts, (minPlayers): CardSpec => ({ kind: 'location', location, minPlayers })),
  ),
  ...INDUSTRY_COUNTS.flatMap(({ industries, counts }) =>
    expand(counts, (minPlayers): CardSpec => ({ kind: 'industry', industries, minPlayers })),
  ),
];
