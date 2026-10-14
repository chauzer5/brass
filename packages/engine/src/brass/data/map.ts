import type { BannerColor, Industry, PlayerCount, Point } from '../types.ts';

/*
 * Board data, transcribed from the board printed in the rulebook
 * (Rulebook v2018.11, pp.4–5). Rule references are noted inline.
 */

export type TownId =
  | 'belper'
  | 'birmingham'
  | 'burton'
  | 'cannock'
  | 'coalbrookdale'
  | 'coventry'
  | 'derby'
  | 'dudley'
  | 'kidderminster'
  | 'leek'
  | 'nuneaton'
  | 'redditch'
  | 'stafford'
  | 'stoke'
  | 'stone'
  | 'tamworth'
  | 'uttoxeter'
  | 'walsall'
  | 'wolverhampton'
  | 'worcester';

/** The 2 unnamed Farm Brewery locations (rulebook p.9). */
export type FarmBreweryId = 'farm-brewery-north' | 'farm-brewery-south';

export type MerchantId = 'warrington' | 'nottingham' | 'shrewsbury' | 'oxford' | 'gloucester';

export type LocationId = TownId | FarmBreweryId | MerchantId;

/**
 * One build space. Lists the industries it accepts: one entry for a
 * single-icon space, two for a shared space (rulebook p.9, Build step 2).
 */
export type Slot = readonly Industry[];

export interface TownDef {
  kind: 'town';
  id: TownId;
  name: string;
  color: BannerColor;
  slots: readonly Slot[];
  pos: Point;
}

export interface FarmBreweryDef {
  kind: 'farmBrewery';
  id: FarmBreweryId;
  slots: readonly Slot[];
  pos: Point;
}

/** The bonus received when consuming a Merchant's beer while selling (rulebook p.10). */
export type MerchantBeerBonus =
  | { type: 'develop' }
  | { type: 'income'; spaces: number }
  | { type: 'vp'; amount: number }
  | { type: 'money'; amount: number };

export interface MerchantDef {
  kind: 'merchant';
  id: MerchantId;
  name: string;
  /** Merchant tile spaces (each with a beer barrel space beside it). */
  spaces: number;
  /** Fewest players for which Merchant tiles are placed here (rulebook p.4). */
  minPlayers: PlayerCount;
  /** Link icons printed on the merchant banner, counted when scoring adjacent links. */
  linkVP: number;
  beerBonus: MerchantBeerBonus;
  pos: Point;
}

export type LocationDef = TownDef | FarmBreweryDef | MerchantDef;

const town = (
  id: TownId,
  name: string,
  color: BannerColor,
  slots: Slot[],
  pos: Point,
): TownDef => ({ kind: 'town', id, name, color, slots, pos });

export const TOWNS: readonly TownDef[] = [
  // Blue
  town('leek', 'Leek', 'blue', [['cotton', 'manufacturer'], ['cotton', 'coal']], { x: 538, y: 95 }),
  town('stoke', 'Stoke-on-Trent', 'blue', [['cotton', 'manufacturer'], ['pottery', 'iron'], ['manufacturer']], { x: 395, y: 160 }),
  town('stone', 'Stone', 'blue', [['cotton', 'brewery'], ['manufacturer', 'coal']], { x: 312, y: 262 }),
  town('uttoxeter', 'Uttoxeter', 'blue', [['manufacturer', 'brewery'], ['cotton', 'brewery']], { x: 560, y: 245 }),
  // Teal
  town('belper', 'Belper', 'teal', [['cotton', 'manufacturer'], ['coal'], ['pottery']], { x: 725, y: 90 }),
  town('derby', 'Derby', 'teal', [['cotton', 'brewery'], ['cotton', 'manufacturer'], ['iron']], { x: 750, y: 240 }),
  // Red
  town('stafford', 'Stafford', 'red', [['manufacturer', 'brewery'], ['pottery']], { x: 400, y: 345 }),
  town('burton', 'Burton-on-Trent', 'red', [['manufacturer', 'coal'], ['brewery']], { x: 680, y: 362 }),
  town('cannock', 'Cannock', 'red', [['manufacturer', 'coal'], ['coal']], { x: 485, y: 440 }),
  town('tamworth', 'Tamworth', 'red', [['cotton', 'coal'], ['cotton', 'coal']], { x: 698, y: 490 }),
  town('walsall', 'Walsall', 'red', [['iron', 'manufacturer'], ['manufacturer', 'brewery']], { x: 535, y: 552 }),
  // Yellow
  town('coalbrookdale', 'Coalbrookdale', 'yellow', [['iron', 'brewery'], ['iron'], ['coal']], { x: 245, y: 575 }),
  town('wolverhampton', 'Wolverhampton', 'yellow', [['manufacturer'], ['manufacturer', 'coal']], { x: 378, y: 552 }),
  town('dudley', 'Dudley', 'yellow', [['coal'], ['iron']], { x: 420, y: 655 }),
  town('kidderminster', 'Kidderminster', 'yellow', [['cotton', 'coal'], ['cotton']], { x: 362, y: 745 }),
  town('worcester', 'Worcester', 'yellow', [['cotton'], ['cotton']], { x: 375, y: 875 }),
  // Purple
  town('nuneaton', 'Nuneaton', 'purple', [['manufacturer', 'brewery'], ['cotton', 'coal']], { x: 785, y: 585 }),
  town('birmingham', 'Birmingham', 'purple', [['cotton', 'manufacturer'], ['manufacturer'], ['iron'], ['manufacturer']], { x: 630, y: 660 }),
  town('coventry', 'Coventry', 'purple', [['pottery'], ['manufacturer', 'coal'], ['iron', 'manufacturer']], { x: 805, y: 685 }),
  town('redditch', 'Redditch', 'purple', [['manufacturer', 'coal'], ['iron']], { x: 590, y: 795 }),
];

export const FARM_BREWERIES: readonly FarmBreweryDef[] = [
  { kind: 'farmBrewery', id: 'farm-brewery-north', slots: [['brewery']], pos: { x: 305, y: 432 } },
  { kind: 'farmBrewery', id: 'farm-brewery-south', slots: [['brewery']], pos: { x: 290, y: 828 } },
];

export const MERCHANTS: readonly MerchantDef[] = [
  { kind: 'merchant', id: 'shrewsbury', name: 'Shrewsbury', spaces: 1, minPlayers: 2, linkVP: 2, beerBonus: { type: 'vp', amount: 4 }, pos: { x: 100, y: 555 } },
  { kind: 'merchant', id: 'gloucester', name: 'Gloucester', spaces: 2, minPlayers: 2, linkVP: 2, beerBonus: { type: 'develop' }, pos: { x: 560, y: 935 } },
  { kind: 'merchant', id: 'oxford', name: 'Oxford', spaces: 2, minPlayers: 2, linkVP: 2, beerBonus: { type: 'income', spaces: 2 }, pos: { x: 790, y: 840 } },
  { kind: 'merchant', id: 'warrington', name: 'Warrington', spaces: 2, minPlayers: 3, linkVP: 2, beerBonus: { type: 'money', amount: 5 }, pos: { x: 220, y: 62 } },
  { kind: 'merchant', id: 'nottingham', name: 'Nottingham', spaces: 2, minPlayers: 4, linkVP: 2, beerBonus: { type: 'vp', amount: 3 }, pos: { x: 905, y: 95 } },
];

export const LOCATIONS: readonly LocationDef[] = [...TOWNS, ...FARM_BREWERIES, ...MERCHANTS];

export const LOCATION_BY_ID: Readonly<Record<LocationId, LocationDef>> = Object.fromEntries(
  LOCATIONS.map((l) => [l.id, l]),
) as Record<LocationId, LocationDef>;

/**
 * A line on the board. `canal`/`rail` say which Link tiles may be built on
 * it: lines drawn as water and track allow both; track only is rail-only;
 * water only is canal-only.
 */
export interface LinkDef {
  id: string;
  /**
   * Locations this line connects. Usually 2. The Kidderminster–Worcester
   * line also connects both towns to the southern Farm Brewery (rulebook p.9).
   */
  ends: readonly LocationId[];
  canal: boolean;
  rail: boolean;
}

const BOTH = { canal: true, rail: true } as const;
const RAIL = { canal: false, rail: true } as const;
const CANAL = { canal: true, rail: false } as const;

const link = (ends: LocationId[], kind: { canal: boolean; rail: boolean }): LinkDef => ({
  id: ends.join('~'),
  ends,
  ...kind,
});

export const LINKS: readonly LinkDef[] = [
  link(['warrington', 'stoke'], BOTH),
  link(['stoke', 'leek'], BOTH),
  link(['stoke', 'stone'], BOTH),
  link(['leek', 'belper'], RAIL),
  link(['belper', 'derby'], BOTH),
  link(['derby', 'nottingham'], BOTH),
  link(['derby', 'uttoxeter'], RAIL),
  link(['derby', 'burton'], BOTH),
  link(['stone', 'uttoxeter'], RAIL),
  link(['stone', 'stafford'], BOTH),
  link(['stone', 'burton'], BOTH),
  link(['stafford', 'cannock'], BOTH),
  link(['cannock', 'farm-brewery-north'], BOTH),
  link(['cannock', 'burton'], RAIL),
  link(['cannock', 'wolverhampton'], BOTH),
  link(['cannock', 'walsall'], BOTH),
  link(['burton', 'walsall'], CANAL),
  link(['burton', 'tamworth'], BOTH),
  link(['tamworth', 'walsall'], RAIL),
  link(['tamworth', 'birmingham'], BOTH),
  link(['tamworth', 'nuneaton'], BOTH),
  link(['nuneaton', 'birmingham'], RAIL),
  link(['nuneaton', 'coventry'], RAIL),
  link(['coventry', 'birmingham'], BOTH),
  link(['birmingham', 'oxford'], BOTH),
  link(['birmingham', 'walsall'], BOTH),
  link(['birmingham', 'dudley'], BOTH),
  link(['birmingham', 'redditch'], RAIL),
  link(['birmingham', 'worcester'], BOTH),
  link(['redditch', 'oxford'], BOTH),
  link(['redditch', 'gloucester'], BOTH),
  link(['worcester', 'gloucester'], BOTH),
  link(['kidderminster', 'worcester', 'farm-brewery-south'], BOTH),
  link(['kidderminster', 'dudley'], BOTH),
  link(['kidderminster', 'coalbrookdale'], BOTH),
  link(['coalbrookdale', 'shrewsbury'], BOTH),
  link(['coalbrookdale', 'wolverhampton'], BOTH),
  link(['wolverhampton', 'dudley'], BOTH),
  link(['wolverhampton', 'walsall'], BOTH),
];
