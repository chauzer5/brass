import { describe, expect, it } from 'vitest';
import {
  COAL_MARKET,
  FARM_BREWERIES,
  INCOME_LEVEL_BY_SPACE,
  INDUSTRIES,
  INDUSTRY_TILES,
  INDUSTRY_TILE_TOTALS,
  IRON_MARKET,
  LINKS,
  LOCATION_BY_ID,
  LOCATIONS,
  MERCHANTS,
  STARTING_INCOME_SPACE,
  TOWNS,
  highestSpaceOfLevel,
  incomeLevel,
  type LocationId,
} from '../../src/brass/index.ts';

describe('map', () => {
  it('has 20 towns, 2 farm breweries and 5 merchants with unique ids', () => {
    expect(TOWNS).toHaveLength(20);
    expect(FARM_BREWERIES).toHaveLength(2);
    expect(MERCHANTS).toHaveLength(5);
    expect(new Set(LOCATIONS.map((l) => l.id)).size).toBe(LOCATIONS.length);
  });

  it('only links known locations, with no duplicate lines', () => {
    for (const l of LINKS) {
      for (const end of l.ends) expect(LOCATION_BY_ID[end], `${l.id}: ${end}`).toBeDefined();
      expect(l.canal || l.rail).toBe(true);
    }
    expect(new Set(LINKS.map((l) => [...l.ends].sort().join('~'))).size).toBe(LINKS.length);
  });

  it('connects every location', () => {
    const adj = new Map<LocationId, LocationId[]>();
    for (const l of LINKS) for (const a of l.ends) adj.set(a, [...(adj.get(a) ?? []), ...l.ends]);
    const seen = new Set<LocationId>(['birmingham']);
    const queue: LocationId[] = ['birmingham'];
    while (queue.length) for (const n of adj.get(queue.pop()!) ?? []) if (!seen.has(n)) (seen.add(n), queue.push(n));
    expect([...seen].sort()).toEqual(LOCATIONS.map((l) => l.id).sort());
  });

  it('places merchant tiles on 5 / 7 / 9 spaces for 2 / 3 / 4 players (rulebook p.4)', () => {
    const spaces = (n: number) => MERCHANTS.filter((m) => m.minPlayers <= n).reduce((s, m) => s + m.spaces, 0);
    expect([spaces(2), spaces(3), spaces(4)]).toEqual([5, 7, 9]);
  });

  it('gives each farm brewery a single brewery space (rulebook p.9)', () => {
    for (const f of FARM_BREWERIES) expect(f.slots).toEqual([['brewery']]);
  });

  it('connects the southern farm brewery through the Kidderminster–Worcester line (rulebook p.9)', () => {
    const line = LINKS.find((l) => l.ends.includes('farm-brewery-south'));
    expect([...line!.ends].sort()).toEqual(['farm-brewery-south', 'kidderminster', 'worcester']);
  });
});

describe('industry tiles', () => {
  it('matches the per-player totals in the component list (rulebook p.1)', () => {
    for (const ind of INDUSTRIES) {
      expect(INDUSTRY_TILES[ind].reduce((s, t) => s + t.count, 0), ind).toBe(INDUSTRY_TILE_TOTALS[ind]);
    }
  });

  it('marks level 1 tiles canal-only, except Pottery (rulebook p.12)', () => {
    for (const ind of INDUSTRIES) {
      expect(INDUSTRY_TILES[ind][0]!.canalOnly, ind).toBe(ind !== 'pottery');
    }
  });

  it('never marks a tile both canal-only and rail-only', () => {
    for (const ind of INDUSTRIES) for (const t of INDUSTRY_TILES[ind]) expect(t.canalOnly && t.railOnly).toBe(false);
  });
});

describe('markets', () => {
  it('starts with the most expensive spaces filled (rulebook p.4)', () => {
    expect(COAL_MARKET.prices.length - COAL_MARKET.initialCubes).toBe(1);
    expect(IRON_MARKET.prices.length - IRON_MARKET.initialCubes).toBe(2);
  });
});

describe('progress track', () => {
  it('covers spaces 0–99 and starts at income level 0', () => {
    expect(INCOME_LEVEL_BY_SPACE).toHaveLength(100);
    expect(incomeLevel(STARTING_INCOME_SPACE)).toBe(0);
    expect(incomeLevel(0)).toBe(-10);
    expect(incomeLevel(99)).toBe(30);
  });

  it('reads the levels printed on the board', () => {
    expect([11, 12, 13].map(incomeLevel)).toEqual([1, 1, 2]);
    expect([30, 31, 33, 34].map(incomeLevel)).toEqual([10, 11, 11, 12]);
    expect([60, 61, 64, 65].map(incomeLevel)).toEqual([20, 21, 21, 22]);
    expect([96, 97].map(incomeLevel)).toEqual([29, 30]);
  });

  it('finds the highest space of a level, for loans (rulebook p.11)', () => {
    expect(highestSpaceOfLevel(0)).toBe(10);
    expect(highestSpaceOfLevel(1)).toBe(12);
    expect(highestSpaceOfLevel(11)).toBe(33);
  });
});

describe('tile data provenance', () => {
  it('has every industry tile field confirmed against the physical components', () => {
    for (const ind of INDUSTRIES) for (const t of INDUSTRY_TILES[ind]) expect(t.unverified, `${ind} ${t.level}`).toEqual([]);
  });
});
