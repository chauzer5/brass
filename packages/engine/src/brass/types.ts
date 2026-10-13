export type Industry = 'cotton' | 'manufacturer' | 'pottery' | 'coal' | 'iron' | 'brewery';

export const INDUSTRIES: readonly Industry[] = ['cotton', 'manufacturer', 'pottery', 'coal', 'iron', 'brewery'];

export type Era = 'canal' | 'rail';

export type PlayerCount = 2 | 3 | 4;

/** Location banner colours. They decide which Location cards are in the deck (rulebook p.4). */
export type BannerColor = 'blue' | 'teal' | 'red' | 'yellow' | 'purple';

/** Board position in map units (0–1000 on both axes), for rendering only. */
export interface Point {
  x: number;
  y: number;
}
