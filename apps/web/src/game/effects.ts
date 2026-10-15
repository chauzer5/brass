import { brass } from '@brass/engine';

/*
 * What a move did, broken into the steps it happened in, for animating them in
 * order: the action itself (cubes and beer used, goods sold), then the end of
 * the round it may have closed (income, the new turn order), then the end of
 * the era (scoring, and what's cleared off the board).
 */

/** A place on the map something flies from or to. */
export type Spot =
  | { slot: { location: brass.LocationId; slot: number } }
  | { market: { kind: 'coal' | 'iron'; space: number } }
  | { merchant: { location: brass.LocationId; space: number } }
  | { link: string };

/** Coal, iron and beer an action used, flying from where they were to where they're used. */
export interface CubeScene {
  id: string;
  flights: { from: Spot; to: Spot; kind: 'coal' | 'iron' | 'beer' }[];
  /** Coal Mines, Iron Works and Breweries the action emptied: they turn over when their last cube arrives. */
  flips: brass.SlotKey[];
}

/** Tiles sold to Merchants in one Sell action. */
export interface GoodsSale {
  id: string;
  sales: {
    location: brass.LocationId;
    slot: number;
    industry: brass.Industry;
    merchant: { location: brass.LocationId; space: number };
    beers: ({ merchant: { location: brass.LocationId; space: number } } | { brewery: { location: brass.LocationId; slot: number } })[];
  }[];
  /** Breweries emptied by the beer drunk: they turn over too. */
  flips: brass.SlotKey[];
}

/** The end of an era: everything that scores, then what comes off the board. */
export interface EraScene {
  id: string;
  /** The board just before scoring. */
  board: brass.BrassState;
  links: { id: string; owner: number; vp: number }[];
  tiles: { key: brass.SlotKey; owner: number; vp: number }[];
  /** Cleared after scoring (the Canal Era only): every link, and Level I tiles. */
  leaving: { links: string[]; tiles: brass.SlotKey[] };
}

export interface Effects {
  cubes: CubeScene | null;
  goods: GoodsSale | null;
  /** Money each player got (or paid) at the end of the round this move closed. */
  income: number[] | null;
  era: EraScene | null;
}

const NONE: Effects = { cubes: null, goods: null, income: null, era: null };

const spaceOf = (state: brass.BrassState, m: number) =>
  state.merchants.slice(0, m).filter((x) => x.location === state.merchants[m]!.location).length;

/** Cubes taken off tiles and the markets between two states, by kind. */
function cubesUsed(before: brass.BrassState, after: brass.BrassState) {
  const from: Record<'coal' | 'iron' | 'beer', Spot[]> = { coal: [], iron: [], beer: [] };
  const flips: brass.SlotKey[] = [];
  for (const [key, tile] of Object.entries(before.tiles) as [brass.SlotKey, brass.BuiltTile][]) {
    const kind = tile.industry === 'brewery' ? 'beer' : tile.industry === 'coal' || tile.industry === 'iron' ? tile.industry : null;
    if (!kind) continue;
    const now = after.tiles[key];
    const used = tile.cubes - (now?.cubes ?? 0);
    const { location, index } = brass.parseSlotKey(key);
    for (let i = 0; i < used; i++) from[kind].push({ slot: { location, slot: index } });
    if (used > 0 && now?.flipped && !tile.flipped) flips.push(key);
  }
  // The market sells its cheapest cubes first: the filled spaces nearest the empty ones.
  for (const kind of ['coal', 'iron'] as const) {
    const field = kind === 'coal' ? 'coalMarket' : 'ironMarket';
    const n = (kind === 'coal' ? brass.COAL_MARKET : brass.IRON_MARKET).prices.length;
    for (let i = 0; i < before[field] - after[field]; i++) from[kind].push({ market: { kind, space: n - before[field] + i } });
  }
  return { from, flips };
}

/** Coal and iron (and a second rail's beer) that a Build or Network used. */
function cubeScene(before: brass.BrassState, mid: brass.BrassState, action: brass.BrassAction, id: string): CubeScene | null {
  if (action.type !== 'build' && action.type !== 'network') return null;
  const { from, flips } = cubesUsed(before, mid);
  const flights: CubeScene['flights'] = [];
  if (action.type === 'build') {
    const to: Spot = { slot: { location: action.location, slot: action.slot } };
    for (const kind of ['coal', 'iron'] as const) for (const f of from[kind]) flights.push({ from: f, to, kind });
  } else {
    // A rail link's coal goes to that link; a double rail's beer to the second.
    from.coal.forEach((f, i) => flights.push({ from: f, to: { link: action.links[Math.min(i, action.links.length - 1)]! }, kind: 'coal' }));
    for (const f of from.beer) flights.push({ from: f, to: { link: action.links.at(-1)! }, kind: 'beer' });
  }
  return flights.length > 0 ? { id, flights, flips } : null;
}

/**
 * A Sell: each tile sold, the Merchant space it went to, and where its beer
 * came from (the Merchant's barrel, if that one was emptied, then the
 * Breweries that lost barrels, in the order of sale).
 */
function goodsSale(before: brass.BrassState, mid: brass.BrassState, action: brass.BrassAction, id: string): GoodsSale | null {
  if (action.type !== 'sell') return null;
  const barrels = new Set(before.merchants.flatMap((m, i) => (m.beer && !mid.merchants[i]!.beer ? [i] : [])));
  const { from, flips } = cubesUsed(before, mid);
  const breweries = from.beer.flatMap((s) => ('slot' in s ? [s.slot] : []));
  return {
    id,
    flips,
    sales: action.sales.map((s) => {
      const tile = before.tiles[brass.slotKey(s.location, s.slot)]!;
      const need = brass.INDUSTRY_TILES[tile.industry][tile.level - 1]!.beer;
      const merchant = { location: mid.merchants[s.merchant]!.location, space: spaceOf(mid, s.merchant) };
      const beers: GoodsSale['sales'][number]['beers'] = [];
      if (barrels.delete(s.merchant)) beers.push({ merchant });
      while (beers.length < need && breweries.length > 0) beers.push({ brewery: breweries.shift()! });
      return { location: s.location, slot: s.slot, industry: tile.industry, merchant, beers };
    }),
  };
}

/** What scored at the end of an era (rulebook p.7), on the board as it was just before. */
function eraScene(board: brass.BrassState, id: string): EraScene {
  const links = Object.entries(board.links)
    .map(([link, owner]) => ({
      id: link,
      owner,
      vp: brass.LINKS.find((l) => l.id === link)!.ends.reduce((s, end) => s + brass.linkIconsAt(board, end), 0),
    }))
    // Links that score nothing aren't worth a pop-up.
    .filter((l) => l.vp > 0);
  const tiles = (Object.entries(board.tiles) as [brass.SlotKey, brass.BuiltTile][])
    .filter(([, t]) => t.flipped)
    .map(([key, t]) => ({ key, owner: t.owner, vp: brass.INDUSTRY_TILES[t.industry][t.level - 1]!.vp }));
  const canal = board.era === 'canal';
  return {
    id,
    board,
    links,
    tiles,
    leaving: {
      links: canal ? Object.keys(board.links) : [],
      tiles: canal ? (Object.entries(board.tiles) as [brass.SlotKey, brass.BuiltTile][]).filter(([, t]) => t.level === 1).map(([k]) => k) : [],
    },
  };
}

/** Everything worth animating about one move, from the state before it to the state after. */
export function effectsOf(before: brass.BrassState, after: brass.BrassState, player: number, action: brass.BrassAction, id: string): Effects {
  const mid = brass.cloneState(before);
  try {
    brass.performAction(mid, player, action);
  } catch {
    return NONE;
  }
  const roundEnded = after.round !== mid.round || after.era !== mid.era || after.phase.kind !== mid.phase.kind;
  const eraEnded = after.eraScores.length > mid.eraScores.length;
  return {
    cubes: cubeScene(before, mid, action, id),
    goods: goodsSale(before, mid, action, id),
    // Income is the only money change at the end of a round (era scoring is VPs).
    income: roundEnded && action.type !== 'removeTile' ? after.players.map((p, i) => p.money - mid.players[i]!.money) : null,
    era: eraEnded ? eraScene(mid, id) : null,
  };
}
