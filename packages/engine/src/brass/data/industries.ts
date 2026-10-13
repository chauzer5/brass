import type { Industry } from '../types.ts';

/*
 * Industry tile data, read from a photo of a physical Player Mat and
 * cross-checked against the mat and flipped tiles pictured in the rulebook
 * (v2018.11, pp.5, 7–8). Where they disagreed, the physical mat wins: the
 * rulebook's mat photo is too blurry to read some digits.
 *
 * Fields that still need checking are listed in `unverified`.
 */

export type TileField =
  | 'count'
  | 'cost'
  | 'coal'
  | 'iron'
  | 'vp'
  | 'income'
  | 'linkVP'
  | 'beer'
  | 'produces'
  | 'era';

export interface TileLevel {
  level: number;
  /** Tiles of this level per player. */
  count: number;
  cost: number;
  /** Coal consumed to build. */
  coal: number;
  /** Iron consumed to build. */
  iron: number;
  /** VPs scored when flipped. */
  vp: number;
  /** Income track spaces gained when flipped. */
  income: number;
  /** Link icons counted when scoring adjacent links. */
  linkVP: number;
  /** Beer consumed to sell (Cotton Mill, Manufacturer, Pottery). */
  beer: number;
  /**
   * Cubes placed on the tile when built (Coal Mine: coal, Iron Works: iron).
   * Breweries are handled by rule: 1 beer in the Canal Era, 2 in the Rail
   * Era (rulebook p.9).
   */
  produces: number;
  /** Blue half-circle icon on the mat: may not be built in the Rail Era (p.10). */
  canalOnly: boolean;
  /** Black/white half-circle icon on the mat: may not be built in the Canal Era (p.10). */
  railOnly: boolean;
  /** Lightbulb icon: may not be removed by Develop (p.11). */
  cannotDevelop: boolean;
  /** Fields not yet confirmed against a physical mat. */
  unverified: readonly TileField[];
}

type LevelInput = Partial<Omit<TileLevel, 'level'>> & Pick<TileLevel, 'count' | 'cost' | 'vp' | 'income' | 'linkVP'>;

const levels = (rows: LevelInput[]): TileLevel[] =>
  rows.map((r, i) => ({
    level: i + 1,
    coal: 0,
    iron: 0,
    beer: 0,
    produces: 0,
    canalOnly: false,
    railOnly: false,
    cannotDevelop: false,
    unverified: [],
    ...r,
  }));

// The number of tiles of each level is hidden by the stacks on the mat; only
// each industry's total is printed (rulebook p.1). Every count is unverified.
const C = 'count' as const;

export const INDUSTRY_TILES: Readonly<Record<Industry, readonly TileLevel[]>> = {
  cotton: levels([
    { count: 3, cost: 12, vp: 5, income: 5, linkVP: 1, beer: 1, canalOnly: true, unverified: [C] },
    { count: 2, cost: 14, coal: 1, vp: 5, income: 4, linkVP: 2, beer: 1, unverified: [C] },
    { count: 3, cost: 16, coal: 1, iron: 1, vp: 9, income: 3, linkVP: 1, beer: 1, unverified: [C] },
    { count: 3, cost: 18, coal: 1, iron: 1, vp: 12, income: 2, linkVP: 1, beer: 1, unverified: [C] },
  ]),
  manufacturer: levels([
    { count: 1, cost: 8, coal: 1, vp: 3, income: 5, linkVP: 2, beer: 1, canalOnly: true, unverified: [C] },
    { count: 2, cost: 10, iron: 1, vp: 5, income: 1, linkVP: 1, beer: 1, unverified: [C] },
    { count: 1, cost: 12, coal: 2, vp: 4, income: 4, linkVP: 0, beer: 0, unverified: [C] },
    { count: 1, cost: 8, iron: 1, vp: 3, income: 6, linkVP: 1, beer: 1, unverified: [C] },
    { count: 2, cost: 16, coal: 1, vp: 8, income: 2, linkVP: 2, beer: 2, unverified: [C] },
    { count: 1, cost: 20, vp: 7, income: 6, linkVP: 1, beer: 1, unverified: [C] },
    { count: 1, cost: 16, coal: 1, iron: 1, vp: 9, income: 4, linkVP: 1, beer: 0, unverified: [C] },
    { count: 2, cost: 20, iron: 2, vp: 11, income: 1, linkVP: 1, beer: 1, unverified: [C] },
  ]),
  pottery: levels([
    { count: 1, cost: 17, iron: 1, vp: 10, income: 5, linkVP: 1, beer: 1, cannotDevelop: true, unverified: [C] },
    { count: 1, cost: 0, coal: 1, vp: 1, income: 1, linkVP: 1, beer: 1, unverified: [C] },
    { count: 1, cost: 22, coal: 2, vp: 11, income: 5, linkVP: 1, beer: 2, cannotDevelop: true, unverified: [C] },
    { count: 1, cost: 0, coal: 1, vp: 1, income: 1, linkVP: 1, beer: 1, unverified: [C] },
    { count: 1, cost: 24, coal: 2, vp: 20, income: 5, linkVP: 1, beer: 2, railOnly: true, unverified: [C] },
  ]),
  coal: levels([
    { count: 1, cost: 5, vp: 1, income: 4, linkVP: 2, produces: 2, canalOnly: true, unverified: [C] },
    { count: 2, cost: 7, vp: 2, income: 7, linkVP: 1, produces: 3, unverified: [C] },
    { count: 2, cost: 8, iron: 1, vp: 3, income: 6, linkVP: 1, produces: 4, unverified: [C] },
    { count: 2, cost: 10, iron: 1, vp: 4, income: 5, linkVP: 1, produces: 5, unverified: [C] },
  ]),
  iron: levels([
    { count: 1, cost: 5, coal: 1, vp: 3, income: 3, linkVP: 1, produces: 4, canalOnly: true, unverified: [C] },
    { count: 1, cost: 7, coal: 1, vp: 5, income: 3, linkVP: 1, produces: 4, unverified: [C] },
    { count: 1, cost: 9, coal: 1, vp: 7, income: 2, linkVP: 1, produces: 5, unverified: [C] },
    { count: 1, cost: 12, coal: 1, vp: 9, income: 1, linkVP: 1, produces: 6, unverified: [C] },
  ]),
  brewery: levels([
    { count: 2, cost: 5, iron: 1, vp: 4, income: 4, linkVP: 2, canalOnly: true, unverified: [C] },
    { count: 2, cost: 7, iron: 1, vp: 5, income: 5, linkVP: 2, unverified: [C] },
    { count: 2, cost: 9, iron: 1, vp: 7, income: 5, linkVP: 2, unverified: [C] },
    { count: 1, cost: 9, iron: 1, vp: 10, income: 5, linkVP: 2, railOnly: true, unverified: [C] },
  ]),
};

/** Tiles per player of each industry (rulebook p.1, 180 tiles / 4 colours). */
export const INDUSTRY_TILE_TOTALS: Readonly<Record<Industry, number>> = {
  cotton: 11,
  manufacturer: 11,
  pottery: 5,
  coal: 7,
  iron: 4,
  brewery: 7,
};

/** Beer placed on a newly built Brewery (rulebook p.9). */
export const BREWERY_BEER = { canal: 1, rail: 2 } as const;
