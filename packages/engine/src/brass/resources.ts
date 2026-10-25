import type { PlayerId } from '../kernel.ts';
import { COAL_MARKET, IRON_MARKET, MAX_PROGRESS_SPACE, type MarketDef } from './data/economy.ts';
import { INDUSTRY_TILES } from './data/industries.ts';
import { LOCATION_BY_ID, type LocationId } from './data/map.ts';
import { connectedToMarket, distances, isConnected } from './graph.ts';
import { parseSlotKey, type BrassState, type BuiltTile, type PlayerState, type SlotKey } from './state.ts';

/** Thrown for an illegal action; the message is shown to the player. */
export class RuleError extends Error {}

export function fail(message: string): never {
  throw new RuleError(message);
}

/** Where a coal or iron cube comes from: a tile on the board, or the market. */
export type CubeSource = SlotKey | 'market';

/** Where a beer barrel comes from: a Brewery tile, or the Merchant being sold to. */
export type BeerSource = SlotKey | 'merchant';

export function player(state: BrassState, id: PlayerId): PlayerState {
  return state.players[id] ?? fail(`No player ${id}`);
}

export function tileDef(tile: Pick<BuiltTile, 'industry' | 'level'>) {
  return INDUSTRY_TILES[tile.industry][tile.level - 1]!;
}

/** Spending money places it on the Character tile, which sets turn order (rulebook p.6). */
export function spend(p: PlayerState, amount: number): void {
  if (p.money < amount) fail(`Not enough money: need £${amount}, have £${p.money}`);
  p.money -= amount;
  p.spent += amount;
}

/**
 * Pays for everything an action costs at once (the tile or link, and any coal or iron bought from the
 * markets), so a shortfall is reported as the whole bill rather than whichever part ran out last.
 */
export function pay(p: PlayerState, parts: readonly (readonly [what: string, amount: number])[]): void {
  const due = parts.filter(([, amount]) => amount > 0);
  const total = due.reduce((sum, [, amount]) => sum + amount, 0);
  if (p.money < total && due.length > 1) {
    fail(`Not enough money: ${due.map(([what, amount]) => `£${amount} ${what}`).join(' + ')} = £${total}, and you have £${p.money}`);
  }
  spend(p, total);
}

export function advanceIncome(p: PlayerState, spaces: number): void {
  // Income level can't go above 30 (rulebook p.8): the track ends at level 30.
  p.incomeSpace = Math.min(MAX_PROGRESS_SPACE, p.incomeSpace + spaces);
}

export function flip(state: BrassState, key: SlotKey): void {
  const tile = state.tiles[key]!;
  tile.flipped = true;
  advanceIncome(player(state, tile.owner), tileDef(tile).income);
}

/** Removes one cube from a tile; Coal Mines, Iron Works and Breweries flip when emptied (rulebook p.8). */
function takeCube(state: BrassState, key: SlotKey): void {
  const tile = state.tiles[key]!;
  tile.cubes -= 1;
  if (tile.cubes === 0) flip(state, key);
}

type MarketKind = 'coal' | 'iron';

const MARKETS: Record<MarketKind, { def: MarketDef; field: 'coalMarket' | 'ironMarket' }> = {
  coal: { def: COAL_MARKET, field: 'coalMarket' },
  iron: { def: IRON_MARKET, field: 'ironMarket' },
};

/** Price of the next cube bought: the cheapest filled space, or the empty-market price. */
export function marketBuyPrice(state: BrassState, kind: MarketKind): number {
  const { def, field } = MARKETS[kind];
  const cubes = state[field];
  return cubes > 0 ? def.prices[def.prices.length - cubes]! : def.emptyPrice;
}

function buyFromMarket(state: BrassState, kind: MarketKind): number {
  const price = marketBuyPrice(state, kind);
  const { field } = MARKETS[kind];
  if (state[field] > 0) state[field] -= 1;
  return price;
}

/**
 * Moves one cube into the most expensive empty market space and returns its
 * price, or `null` if the market is full (rulebook p.9).
 */
export function sellToMarket(state: BrassState, kind: MarketKind): number | null {
  const { def, field } = MARKETS[kind];
  const cubes = state[field];
  if (cubes >= def.prices.length) return null;
  state[field] = cubes + 1;
  return def.prices[def.prices.length - cubes - 1]!;
}

function tilesWithCubes(state: BrassState, industry: 'coal' | 'iron' | 'brewery') {
  return (Object.entries(state.tiles) as [SlotKey, BuiltTile][])
    .filter(([, t]) => t.industry === industry && !t.flipped && t.cubes > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Consumes `amount` coal for something at `from` (rulebook p.8): from the
 * closest connected unflipped Coal Mines first (ties are the player's
 * choice), otherwise bought from the Coal Market, which needs a connection
 * to a Merchant. Returns the money owed for market coal.
 */
export function consumeCoal(
  state: BrassState,
  from: readonly LocationId[],
  amount: number,
  choices: readonly CubeSource[] | undefined,
): number {
  if (choices && choices.length !== amount) fail(`Choose a source for each of the ${amount} coal`);
  let cost = 0;
  const dist = distances(state, from);
  for (let i = 0; i < amount; i++) {
    const mines = tilesWithCubes(state, 'coal').filter(([key]) => dist.has(parseSlotKey(key).location));
    const choice = choices?.[i];
    if (mines.length > 0) {
      const closest = Math.min(...mines.map(([key]) => dist.get(parseSlotKey(key).location)!));
      const allowed = mines.filter(([key]) => dist.get(parseSlotKey(key).location) === closest).map(([k]) => k);
      if (choice !== undefined && !allowed.includes(choice as SlotKey)) {
        fail('Coal must come from the closest connected Coal Mine');
      }
      takeCube(state, (choice as SlotKey | undefined) ?? allowed[0]!);
    } else {
      if (choice !== undefined && choice !== 'market') fail('That Coal Mine is not connected or has no coal');
      if (!connectedToMarket(state, from)) fail('No connected coal: not connected to a Coal Mine or a Merchant');
      cost += buyFromMarket(state, 'coal');
    }
  }
  return cost;
}

/**
 * Consumes `amount` iron (rulebook p.8): from any unflipped Iron Works (no
 * connection needed), otherwise bought from the Iron Market. Returns the
 * money owed for market iron.
 */
export function consumeIron(state: BrassState, amount: number, choices: readonly CubeSource[] | undefined): number {
  if (choices && choices.length !== amount) fail(`Choose a source for each of the ${amount} iron`);
  let cost = 0;
  for (let i = 0; i < amount; i++) {
    const works = tilesWithCubes(state, 'iron').map(([k]) => k);
    const choice = choices?.[i];
    if (works.length > 0) {
      if (choice !== undefined && !works.includes(choice as SlotKey)) fail('Iron must come from an Iron Works with iron');
      takeCube(state, (choice as SlotKey | undefined) ?? works[0]!);
    } else {
      if (choice !== undefined && choice !== 'market') fail('That Iron Works has no iron');
      cost += buyFromMarket(state, 'iron');
    }
  }
  return cost;
}

/**
 * Consumes one beer (rulebook p.8): from the player's own unflipped Brewery
 * (anywhere), an opponent's unflipped Brewery connected to `at`, or, when
 * selling, the barrel beside the Merchant being sold to. Returns whether the
 * Merchant's beer was used.
 */
export function consumeBeer(
  state: BrassState,
  playerId: PlayerId,
  at: readonly LocationId[],
  merchantSpace: number | null,
  choice: BeerSource | undefined,
): { usedMerchant: boolean } {
  const merchantHasBeer = merchantSpace !== null && state.merchants[merchantSpace]!.beer;
  const breweries = tilesWithCubes(state, 'brewery');
  const usable = (key: SlotKey, tile: BuiltTile) =>
    tile.owner === playerId || isConnected(state, at, parseSlotKey(key).location);

  if (choice === 'merchant' || (choice === undefined && merchantHasBeer)) {
    if (!merchantHasBeer) fail('There is no beer beside that Merchant');
    state.merchants[merchantSpace!]!.beer = false;
    return { usedMerchant: true };
  }

  if (choice !== undefined) {
    const tile = state.tiles[choice];
    if (!tile || tile.industry !== 'brewery' || tile.flipped || tile.cubes === 0) fail('That Brewery has no beer');
    if (!usable(choice, tile)) fail("An opponent's Brewery must be connected to where the beer is needed");
    takeCube(state, choice);
    return { usedMerchant: false };
  }

  const own = breweries.find(([, t]) => t.owner === playerId);
  const other = breweries.find(([k, t]) => t.owner !== playerId && usable(k, t));
  const pick = own ?? other ?? fail('No beer available');
  takeCube(state, pick[0]);
  return { usedMerchant: false };
}

export function locationName(id: LocationId): string {
  const loc = LOCATION_BY_ID[id];
  return loc.kind === 'farmBrewery' ? 'Farm Brewery' : loc.name;
}
