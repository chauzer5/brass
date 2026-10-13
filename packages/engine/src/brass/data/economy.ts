/*
 * Markets, money and the Progress Track (rulebook v2018.11, pp.4–8).
 */

export interface MarketDef {
  /** Prices of the market spaces, cheapest first; each price has 2 spaces. */
  prices: readonly number[];
  /** Cubes placed at setup, filling the most expensive spaces first. */
  initialCubes: number;
  /** Price per cube once the market is empty (rulebook p.8). */
  emptyPrice: number;
}

/**
 * Coal Market: £1–£7, two spaces each. The £8 printed above it is the
 * empty-market price, not a space. Setup leaves 1 of the £1 spaces open (p.4).
 */
export const COAL_MARKET: MarketDef = {
  prices: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7],
  initialCubes: 13,
  emptyPrice: 8,
};

/**
 * Iron Market: £1–£5, two spaces each; £6 is the empty-market price.
 * Setup leaves both £1 spaces open (p.4).
 */
export const IRON_MARKET: MarketDef = {
  prices: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5],
  initialCubes: 8,
  emptyPrice: 6,
};

export const STARTING_MONEY = 17;
export const HAND_SIZE = 8;
export const LOAN_AMOUNT = 30;
export const LOAN_INCOME_LEVELS = 3;
export const MIN_INCOME_LEVEL_FOR_LOAN = -10;
export const MAX_INCOME_LEVEL = 30;

export const CANAL_LINK_COST = 3;
export const RAIL_LINK_COST = 5;
export const DOUBLE_RAIL_LINK_COST = 15;

/** Progress Track space where the Income Marker starts (p.5): income level 0. */
export const STARTING_INCOME_SPACE = 10;

/**
 * Income level shown for each Progress Track space 0–99 (read from the board
 * on pp.4–5). Spaces 0–10 are levels −10…0 (one space each); levels 1–10
 * span 2 spaces, 11–20 span 3, 21–29 span 4, and level 30 spans 97–99.
 */
export const INCOME_LEVEL_BY_SPACE: readonly number[] = (() => {
  const out: number[] = [];
  for (let level = -10; level <= 0; level++) out.push(level);
  const spansFor = (level: number) => (level <= 10 ? 2 : level <= 20 ? 3 : level <= 29 ? 4 : 3);
  for (let level = 1; level <= 30; level++) {
    for (let i = 0; i < spansFor(level); i++) out.push(level);
  }
  return out;
})();

export const MAX_PROGRESS_SPACE = INCOME_LEVEL_BY_SPACE.length - 1;

export function incomeLevel(space: number): number {
  return INCOME_LEVEL_BY_SPACE[Math.max(0, Math.min(MAX_PROGRESS_SPACE, space))]!;
}

/** The highest space of a given income level (used when taking a loan, p.11). */
export function highestSpaceOfLevel(level: number): number {
  return INCOME_LEVEL_BY_SPACE.lastIndexOf(level);
}

/** Rounds per era by player count (p.6). */
export const ROUNDS_PER_ERA = { 2: 10, 3: 9, 4: 8 } as const;
