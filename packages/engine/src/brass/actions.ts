import type { PlayerId } from '../kernel.ts';
import type { Rng } from '../rng.ts';
import {
  CANAL_LINK_COST,
  DOUBLE_RAIL_LINK_COST,
  HAND_SIZE,
  LOAN_AMOUNT,
  LOAN_INCOME_LEVELS,
  MIN_INCOME_LEVEL_FOR_LOAN,
  RAIL_LINK_COST,
  highestSpaceOfLevel,
  incomeLevel,
} from './data/economy.ts';
import { BREWERY_BEER, INDUSTRY_TILES } from './data/industries.ts';
import { LOCATION_BY_ID, MERCHANTS, type LocationId } from './data/map.ts';
import { LINK_BY_ID, connectedToMarket, hasTilesOnBoard, isConnected, network, tilesAt } from './graph.ts';
import {
  advanceIncome,
  consumeBeer,
  consumeCoal,
  consumeIron,
  fail,
  flip,
  locationName,
  pay,
  player,
  sellToMarket,
  tileDef,
  type BeerSource,
  type CubeSource,
} from './resources.ts';
import {
  actionsThisTurn,
  currentPlayer,
  slotKey,
  type BrassState,
  type CardId,
  type PlayerState,
  type SlotKey,
} from './state.ts';
import type { Industry } from './types.ts';

export interface Sale {
  location: LocationId;
  slot: number;
  /** Index into `state.merchants`. */
  merchant: number;
  /** One source per beer the tile needs; omitted = chosen automatically. */
  beer?: BeerSource[];
  /**
   * Gloucester's Develop bonus (rulebook p.10): the industry to develop, or
   * `null` to decline. Omitted = the first industry that can be developed.
   */
  develop?: Industry | null;
}

export type BrassAction =
  | {
      type: 'build';
      card: CardId;
      industry: Industry;
      location: LocationId;
      slot: number;
      coal?: CubeSource[];
      iron?: CubeSource[];
    }
  /** 1 link, or 2 rail links in the Rail Era. `coal` has one source per rail link. */
  | { type: 'network'; card: CardId; links: string[]; coal?: CubeSource[]; beer?: BeerSource }
  | { type: 'develop'; card: CardId; industries: Industry[]; iron?: CubeSource[] }
  | { type: 'sell'; card: CardId; sales: Sale[] }
  | { type: 'loan'; card: CardId }
  /** The card for the action plus 2 more (rulebook p.11). */
  | { type: 'scout'; cards: CardId[] }
  | { type: 'pass'; card: CardId }
  /** Remove an Industry tile to cover an income shortfall (rulebook p.6). */
  | { type: 'removeTile'; location: LocationId; slot: number };

const SELLABLE: readonly Industry[] = ['cotton', 'manufacturer', 'pottery'];

function isWild(state: BrassState, id: CardId): boolean {
  const kind = state.cards[id]?.kind;
  return kind === 'wildLocation' || kind === 'wildIndustry';
}

/** Every action discards a card; Wild cards go back to their draw areas (rulebook p.6). */
function discard(state: BrassState, p: PlayerState, id: CardId): void {
  const i = p.hand.indexOf(id);
  if (i < 0) fail('That card is not in your hand');
  p.hand.splice(i, 1);
  const card = state.cards[id]!;
  if (card.kind === 'wildLocation') state.wildLocations.push(id);
  else if (card.kind === 'wildIndustry') state.wildIndustries.push(id);
  else p.discard.push(id);
}

/** Lowest-level tile left on the mat for an industry, as a 1-based level. */
export function lowestLevel(p: PlayerState, industry: Industry): number | null {
  const i = p.mat[industry].findIndex((n) => n > 0);
  return i < 0 ? null : i + 1;
}

function takeFromMat(p: PlayerState, industry: Industry): number {
  const level = lowestLevel(p, industry) ?? fail(`You have no ${industry} tiles left`);
  p.mat[industry][level - 1]! -= 1;
  return level;
}

/** Removes the lowest tile of an industry for Develop; tiles with a lightbulb can't be (rulebook p.11). */
function developOne(p: PlayerState, industry: Industry): void {
  const level = lowestLevel(p, industry) ?? fail(`You have no ${industry} tiles left to develop`);
  if (INDUSTRY_TILES[industry][level - 1]!.cannotDevelop) {
    fail(`This ${industry} tile can't be developed; it must be built`);
  }
  p.mat[industry][level - 1]! -= 1;
}

function build(state: BrassState, p: PlayerState, a: Extract<BrassAction, { type: 'build' }>): void {
  const card = state.cards[a.card];
  discard(state, p, a.card);

  const loc = LOCATION_BY_ID[a.location] ?? fail('Unknown location');
  if (loc.kind === 'merchant') fail('You cannot build at a Merchant');
  const slot = loc.slots[a.slot] ?? fail('Unknown space');
  if (!slot.includes(a.industry)) fail(`That space doesn't show the ${a.industry} icon`);

  const level = lowestLevel(p, a.industry) ?? fail(`You have no ${a.industry} tiles left`);
  const def = INDUSTRY_TILES[a.industry][level - 1]!;
  if (def.canalOnly && state.era === 'rail') fail('This tile may not be built in the Rail Era; develop it first');
  if (def.railOnly && state.era === 'canal') fail('This tile may not be built in the Canal Era');

  // Card (rulebook p.9).
  const noTiles = !hasTilesOnBoard(state, p.id);
  const inNetwork = network(state, p.id).has(a.location);
  switch (card?.kind) {
    case 'location':
      if (card.location !== a.location) fail(`That card only builds in ${locationName(card.location)}`);
      break;
    case 'wildLocation':
      if (loc.kind !== 'town') fail('A Wild Location card cannot build at a Farm Brewery');
      break;
    case 'industry':
      if (!card.industries.includes(a.industry)) fail(`That card doesn't build ${a.industry}`);
      if (!inNetwork && !noTiles) fail(`${locationName(a.location)} is not part of your network`);
      break;
    case 'wildIndustry':
      if (!inNetwork && !noTiles) fail(`${locationName(a.location)} is not part of your network`);
      break;
    default:
      fail('Unknown card');
  }

  const key = slotKey(a.location, a.slot);
  const existing = state.tiles[key];
  const othersHere = tilesAt(state, a.location).filter(([k, t]) => k !== key && t.owner === p.id);

  // Canal Era: at most 1 of your Industry tiles per location (rulebook p.10).
  if (state.era === 'canal' && othersHere.length > 0) fail('In the Canal Era you may have only 1 tile per location');

  if (existing) {
    // Overbuilding (rulebook p.10).
    if (noTiles && card?.kind !== 'location' && card?.kind !== 'wildLocation') {
      fail('That space is already developed');
    }
    if (existing.industry !== a.industry) fail('You can only overbuild a tile of the same industry');
    if (level <= existing.level) fail('You can only overbuild with a higher-level tile');
    if (existing.owner !== p.id) {
      if (a.industry !== 'coal' && a.industry !== 'iron') fail("You can only overbuild an opponent's Coal Mine or Iron Works");
      const market = a.industry === 'coal' ? state.coalMarket : state.ironMarket;
      const onBoard = Object.values(state.tiles).some((t) => t?.industry === a.industry && t.cubes > 0);
      if (market > 0 || onBoard) fail(`There must be no ${a.industry} left on the board or in the market`);
    }
    delete state.tiles[key];
  } else {
    // Prefer a space showing only this industry's icon (rulebook p.9).
    const free = loc.slots
      .map((s, i) => ({ s, i }))
      .filter(({ i }) => !state.tiles[slotKey(a.location, i)]);
    const dedicated = free.some(({ s }) => s.length === 1 && s[0] === a.industry);
    if (dedicated && slot.length > 1) fail(`Use the space showing only the ${a.industry} icon`);
  }

  takeFromMat(p, a.industry);
  const coalCost = consumeCoal(state, [a.location], def.coal, a.coal);
  const ironCost = consumeIron(state, def.iron, a.iron);
  pay(p, [
    ['for the tile', def.cost],
    ['for coal', coalCost],
    ['for iron', ironCost],
  ]);

  const cubes =
    a.industry === 'coal' || a.industry === 'iron'
      ? def.produces
      : a.industry === 'brewery'
        ? BREWERY_BEER[state.era]
        : 0;
  state.tiles[key] = { owner: p.id, industry: a.industry, level, flipped: false, cubes };

  // Coal Mines connected to a Merchant, and all Iron Works, sell to their market (rulebook p.9).
  if ((a.industry === 'coal' && connectedToMarket(state, [a.location])) || a.industry === 'iron') {
    const kind = a.industry;
    const tile = state.tiles[key]!;
    while (tile.cubes > 0) {
      const price = sellToMarket(state, kind);
      if (price === null) break;
      p.money += price;
      tile.cubes -= 1;
    }
    if (tile.cubes === 0) flip(state, key);
  }
}

function networkAction(state: BrassState, p: PlayerState, a: Extract<BrassAction, { type: 'network' }>): void {
  discard(state, p, a.card);
  const n = a.links.length;
  if (state.era === 'canal' && n !== 1) fail('In the Canal Era you may build only 1 canal link');
  if (state.era === 'rail' && (n < 1 || n > 2)) fail('Build 1 or 2 rail links');
  if (p.linksInSupply < n) fail('You have no Link tiles left');
  if (a.coal && a.coal.length !== (state.era === 'rail' ? n : 0)) fail('Choose one coal source per rail link');

  const linkCost = state.era === 'canal' ? CANAL_LINK_COST : n === 1 ? RAIL_LINK_COST : DOUBLE_RAIL_LINK_COST;
  let coalCost = 0;

  a.links.forEach((id, i) => {
    const link = LINK_BY_ID[id] ?? fail('Unknown link');
    if (state.links[id] !== undefined) fail('That line already has a Link tile');
    if (state.era === 'canal' && !link.canal) fail('That line is rail only');
    if (state.era === 'rail' && !link.rail) fail('That line is canal only');
    const net = network(state, p.id);
    if (hasTilesOnBoard(state, p.id) && !link.ends.some((e) => net.has(e))) {
      fail('A link must be adjacent to your network');
    }
    state.links[id] = p.id;
    p.linksInSupply -= 1;
    // Each rail link is connected to coal after it is placed (rulebook p.11).
    if (state.era === 'rail') {
      coalCost += consumeCoal(state, link.ends, 1, a.coal && [a.coal[i]!]);
    }
  });
  pay(p, [
    [n === 1 ? 'for the link' : 'for the links', linkCost],
    ['for coal', coalCost],
  ]);

  if (n === 2) {
    // The beer must come from a Brewery, not a Merchant (rulebook p.11).
    if (a.beer === 'merchant') fail('Merchant beer can only be used when selling');
    consumeBeer(state, p.id, LINK_BY_ID[a.links[1]!]!.ends, null, a.beer);
  } else if (a.beer !== undefined) {
    fail('Beer is only consumed when building 2 rail links');
  }
}

function develop(state: BrassState, p: PlayerState, a: Extract<BrassAction, { type: 'develop' }>): void {
  discard(state, p, a.card);
  if (a.industries.length < 1 || a.industries.length > 2) fail('Develop removes 1 or 2 tiles');
  if (a.iron && a.iron.length !== a.industries.length) fail('Choose one iron source per tile');
  let ironCost = 0;
  a.industries.forEach((industry, i) => {
    developOne(p, industry);
    ironCost += consumeIron(state, 1, a.iron && [a.iron[i]!]);
  });
  pay(p, [['for iron', ironCost]]);
}

/** The first industry Gloucester's bonus can develop, for the automatic choice. */
function firstDevelopable(p: PlayerState): Industry | null {
  for (const ind of ['cotton', 'manufacturer', 'pottery', 'coal', 'iron', 'brewery'] as const) {
    const level = lowestLevel(p, ind);
    if (level !== null && !INDUSTRY_TILES[ind][level - 1]!.cannotDevelop) return ind;
  }
  return null;
}

function sell(state: BrassState, p: PlayerState, a: Extract<BrassAction, { type: 'sell' }>): void {
  discard(state, p, a.card);
  if (a.sales.length === 0) fail('Choose at least one tile to sell');

  for (const sale of a.sales) {
    const key = slotKey(sale.location, sale.slot);
    const tile = state.tiles[key];
    if (!tile || tile.owner !== p.id) fail('You can only sell your own tiles');
    if (!SELLABLE.includes(tile.industry)) fail('Only Cotton Mills, Manufacturers and Potteries are sold');
    if (tile.flipped) fail('That tile has already been sold');

    const merchant = state.merchants[sale.merchant] ?? fail('Unknown Merchant');
    if (!merchant.tile?.industries.includes(tile.industry)) fail(`That Merchant doesn't buy ${tile.industry}`);
    if (!isConnected(state, [sale.location], merchant.location)) {
      fail(`${locationName(sale.location)} is not connected to ${locationName(merchant.location)}`);
    }

    const def = tileDef(tile);
    if (sale.beer && sale.beer.length !== def.beer) fail(`This tile needs ${def.beer} beer`);
    let usedMerchant = false;
    for (let i = 0; i < def.beer; i++) {
      usedMerchant = consumeBeer(state, p.id, [sale.location], sale.merchant, sale.beer?.[i]).usedMerchant || usedMerchant;
    }
    if (usedMerchant) merchantBonus(p, merchant.location, sale.develop);

    flip(state, key);
  }
}

/** Merchant beer bonuses (rulebook p.10). */
function merchantBonus(p: PlayerState, location: LocationId, develop: Industry | null | undefined): void {
  const bonus = MERCHANTS.find((m) => m.id === location)!.beerBonus;
  switch (bonus.type) {
    case 'develop': {
      const industry = develop === undefined ? firstDevelopable(p) : develop;
      if (industry !== null) developOne(p, industry);
      break;
    }
    case 'income':
      advanceIncome(p, bonus.spaces);
      break;
    case 'vp':
      p.vp += bonus.amount;
      break;
    case 'money':
      p.money += bonus.amount;
      break;
  }
}

function loan(state: BrassState, p: PlayerState, a: Extract<BrassAction, { type: 'loan' }>): void {
  discard(state, p, a.card);
  const level = incomeLevel(p.incomeSpace) - LOAN_INCOME_LEVELS;
  if (level < MIN_INCOME_LEVEL_FOR_LOAN) fail('A loan may not take your income level below -10');
  p.incomeSpace = highestSpaceOfLevel(level);
  p.money += LOAN_AMOUNT;
}

function scout(state: BrassState, p: PlayerState, a: Extract<BrassAction, { type: 'scout' }>): void {
  if (p.hand.some((id) => isWild(state, id))) fail('You may not scout while holding a Wild card');
  if (a.cards.length !== 3 || new Set(a.cards).size !== 3) fail('Scouting discards 3 different cards');
  for (const id of a.cards) discard(state, p, id);
  const wl = state.wildLocations.pop() ?? fail('No Wild Location cards left');
  const wi = state.wildIndustries.pop() ?? fail('No Wild Industry cards left');
  p.hand.push(wl, wi);
}

/** Applies one action, mutating `state`. Throws `RuleError` if it is illegal. */
export function perform(state: BrassState, playerId: PlayerId, a: BrassAction, rng: Rng): void {
  if (currentPlayer(state) !== playerId) fail('It is not your turn');
  const p = player(state, playerId);

  if (state.phase.kind === 'shortfall') {
    if (a.type !== 'removeTile') fail('You must remove Industry tiles to pay your shortfall');
    removeTileForShortfall(state, p, a, rng);
    return;
  }
  if (state.phase.kind !== 'actions') fail('The game is over');

  performActionOnly(state, p, a);

  state.actionsTaken += 1;
  if (state.actionsTaken >= actionsThisTurn(state) || p.hand.length === 0) endTurn(state, p, rng);
}

/**
 * Just what an action itself does (building, selling, …), without the end of
 * the turn, round or era it may bring: for showing those steps one at a time.
 */
export function performAction(state: BrassState, playerId: PlayerId, a: BrassAction): void {
  if (a.type === 'removeTile') {
    delete state.tiles[slotKey(a.location, a.slot)];
    return;
  }
  performActionOnly(state, player(state, playerId), a);
}

function performActionOnly(state: BrassState, p: PlayerState, a: BrassAction): void {
  switch (a.type) {
    case 'build':
      build(state, p, a);
      break;
    case 'network':
      networkAction(state, p, a);
      break;
    case 'develop':
      develop(state, p, a);
      break;
    case 'sell':
      sell(state, p, a);
      break;
    case 'loan':
      loan(state, p, a);
      break;
    case 'scout':
      scout(state, p, a);
      break;
    case 'pass':
      discard(state, p, a.card);
      break;
    case 'removeTile':
      fail('There is no shortfall to pay');
  }
}

/** Refill the Hand to 8 from the Draw Deck, then pass to the next player (rulebook p.6). */
function endTurn(state: BrassState, p: PlayerState, rng: Rng): void {
  while (p.hand.length < HAND_SIZE && state.deck.length > 0) p.hand.push(state.deck.shift()!);
  state.actionsTaken = 0;
  state.turnIndex += 1;
  skipEmptyHands(state, rng);
}

/**
 * Skips players with no cards. With the real deck this never happens: every
 * action, Scout included (3 discarded, 2 Wilds back), costs one card, and the
 * deck runs out at the end of a round, so all hands empty in the same round
 * (rulebook p.6). This only guards against malformed component data.
 */
function skipEmptyHands(state: BrassState, rng: Rng): void {
  while (state.turnIndex < state.turnOrder.length && player(state, state.turnOrder[state.turnIndex]!).hand.length === 0) {
    state.turnIndex += 1;
  }
  if (state.turnIndex >= state.turnOrder.length) endRound(state, rng);
}

const eraIsOver = (state: BrassState) => state.players.every((p) => p.hand.length === 0);

/** End of round (rulebook p.6): turn order, then income. */
function endRound(state: BrassState, rng: Rng): void {
  // Least money spent goes first; ties keep their relative order.
  state.turnOrder = [...state.turnOrder].sort((a, b) => player(state, a).spent - player(state, b).spent);
  for (const p of state.players) p.spent = 0;

  // Income is not collected at the end of the final round of the game.
  const finalRound = state.era === 'rail' && eraIsOver(state);
  const queue: { player: PlayerId; owed: number }[] = [];
  if (!finalRound) {
    for (const id of state.turnOrder) {
      const p = player(state, id);
      const income = incomeLevel(p.incomeSpace);
      if (income >= 0) {
        p.money += income;
        continue;
      }
      const owed = -income;
      if (p.money >= owed) {
        p.money -= owed;
        continue;
      }
      const short = owed - p.money;
      p.money = 0;
      if (Object.values(state.tiles).some((t) => t?.owner === id)) queue.push({ player: id, owed: short });
      else p.vp = Math.max(0, p.vp - short);
    }
  }

  if (queue.length > 0) {
    state.phase = { kind: 'shortfall', queue };
    return;
  }
  afterIncome(state, rng);
}

/**
 * Shortfall (rulebook p.6): remove Industry tiles, each worth half its cost
 * rounded down, until the shortfall is covered; any excess is kept. With no
 * tiles left, lose 1 VP per £1 still short.
 */
function removeTileForShortfall(
  state: BrassState,
  p: PlayerState,
  a: Extract<BrassAction, { type: 'removeTile' }>,
  rng: Rng,
): void {
  if (state.phase.kind !== 'shortfall') fail('There is no shortfall to pay');
  const key = slotKey(a.location, a.slot);
  const tile = state.tiles[key];
  if (!tile || tile.owner !== p.id) fail('You can only remove your own Industry tiles');
  delete state.tiles[key];

  const entry = state.phase.queue[0]!;
  const value = Math.floor(tileDef(tile).cost / 2);
  if (value >= entry.owed) {
    p.money += value - entry.owed;
    entry.owed = 0;
  } else {
    entry.owed -= value;
    if (!Object.values(state.tiles).some((t) => t?.owner === p.id)) {
      p.vp = Math.max(0, p.vp - entry.owed);
      entry.owed = 0;
    }
  }

  if (entry.owed === 0) state.phase.queue.shift();
  if (state.phase.queue.length === 0) {
    state.phase = { kind: 'actions' };
    afterIncome(state, rng);
  }
}

function afterIncome(state: BrassState, rng: Rng): void {
  state.phase = { kind: 'actions' };
  if (eraIsOver(state)) {
    endEra(state, rng);
    return;
  }
  state.round += 1;
  state.turnIndex = 0;
  state.actionsTaken = 0;
  skipEmptyHands(state, rng);
}

/** Link icons in a location: the Merchant's banner plus all flipped tiles there (rulebook p.7). */
export function linkIconsAt(state: BrassState, location: LocationId): number {
  const loc = LOCATION_BY_ID[location];
  const banner = loc.kind === 'merchant' ? loc.linkVP : 0;
  return banner + tilesAt(state, location).reduce((s, [, t]) => s + (t.flipped ? tileDef(t).linkVP : 0), 0);
}

/** End of era scoring and maintenance (rulebook p.7). */
function endEra(state: BrassState, rng: Rng): void {
  // Kept for the end-of-era summary.
  const score = state.players.map((p) => ({ linkVP: 0, links: 0, tileVP: 0, tiles: 0, before: p.vp, after: p.vp }));

  // 1. Score each Link tile, then remove it.
  for (const [id, owner] of Object.entries(state.links)) {
    const p = player(state, owner);
    const vp = LINK_BY_ID[id]!.ends.reduce((s, end) => s + linkIconsAt(state, end), 0);
    p.vp += vp;
    score[owner]!.linkVP += vp;
    score[owner]!.links += 1;
  }
  for (const [id, owner] of Object.entries(state.links)) {
    player(state, owner).linksInSupply += 1;
    delete state.links[id];
  }

  // 2. Score flipped Industry tiles.
  for (const tile of Object.values(state.tiles)) {
    if (!tile?.flipped) continue;
    player(state, tile.owner).vp += tileDef(tile).vp;
    score[tile.owner]!.tileVP += tileDef(tile).vp;
    score[tile.owner]!.tiles += 1;
  }
  for (const p of state.players) score[p.id]!.after = p.vp;
  state.eraScores.push({ era: state.era, players: score });

  if (state.era === 'rail') {
    state.phase = { kind: 'gameOver' };
    return;
  }

  // 3. Remove obsolete (level 1) industries from the board.
  for (const [key, tile] of Object.entries(state.tiles) as [SlotKey, { level: number }][]) {
    if (tile.level === 1) delete state.tiles[key];
  }
  // 4. Reset Merchant beer.
  for (const m of state.merchants) m.beer = !!m.tile && m.tile.industries.length > 0;
  // 5. Shuffle all Discard Piles into a new Draw Deck.
  const cards: CardId[] = [];
  for (const p of state.players) {
    cards.push(...p.discard);
    if (p.faceDownDiscard) cards.push(p.faceDownDiscard);
    p.discard = [];
    p.faceDownDiscard = null;
  }
  state.deck = rng.shuffle(cards);
  // 6. Draw new Hands.
  for (const p of state.players) p.hand = state.deck.splice(0, HAND_SIZE);

  state.era = 'rail';
  state.round = 1;
  state.turnIndex = 0;
  state.actionsTaken = 0;
}

