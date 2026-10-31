import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/index.ts';
import {
  actionsThisTurn,
  brassGame,
  incomeLevel,
  perform,
  type BrassAction,
  type BrassState,
  type BuiltTile,
  type Industry,
} from '../../src/brass/index.ts';
import { giveHand, ind, loc, makeTurn, newGame } from './fixtures.ts';

/*
 * Rule-by-rule checks against the rulebook (v2018.11), for the edge cases
 * rules.test.ts doesn't cover. Grouped by rulebook page.
 */

const rng = createRng(0);
const run = (s: BrassState, p: number, a: BrassAction) => perform(s, p, a, rng);
const illegal = (s: BrassState, p: number, a: BrassAction) => brassGame.validate(s, p, a);
const tile = (owner: number, industry: Industry, level: number, cubes = 0, flipped = false): BuiltTile => ({
  owner,
  industry,
  level,
  cubes,
  flipped,
});
const matLeft = (s: BrassState, p: number, industry: Industry) => s.players[p]!.mat[industry].reduce((a, b) => a + b, 0);

/** A game where player 0 acts in round 2 of the given era. */
function game(era: 'canal' | 'rail' = 'canal', players: 2 | 3 | 4 = 2): BrassState {
  const s = newGame(players);
  makeTurn(s, 0, era);
  return s;
}

describe('end of round (rulebook p.6)', () => {
  it('shrinks the hand once the Draw Deck is exhausted', () => {
    const s = game();
    s.deck = [];
    const [a, b] = s.players[0]!.hand;
    run(s, 0, { type: 'pass', card: a! });
    run(s, 0, { type: 'pass', card: b! });
    expect(s.players[0]!.hand).toHaveLength(6);
  });

  it('counts market coal as money spent, but not a loan', () => {
    const s = game();
    const [c, l] = giveHand(s, 0, [loc('birmingham'), ind('coal')]);
    s.links['birmingham~oxford'] = 1;
    s.players[0]!.mat.manufacturer = [0, 0, 1, 1, 2, 1, 1, 2]; // Manufacturer III: 2 coal
    s.coalMarket = 1;
    s.players[0]!.money = 30;
    run(s, 0, { type: 'build', card: c!, industry: 'manufacturer', location: 'birmingham', slot: 1 });
    // The last cube costs £7, then the empty market sells at £8 (p.8).
    expect(s.players[0]!.money).toBe(30 - 12 - 7 - 8);
    expect(s.players[0]!.spent).toBe(27);
    expect(s.coalMarket).toBe(0);
    run(s, 0, { type: 'loan', card: l! });
    expect(s.players[0]!.spent).toBe(27);
  });

  function lastTurn() {
    const s = newGame(2);
    const [a, b] = s.turnOrder as [number, number];
    run(s, a, { type: 'pass', card: s.players[a]!.hand[0]! });
    s.players[b]!.incomeSpace = 5; // level -5
    s.players[b]!.money = 2; // 3 short
    return { s, b, pass: () => run(s, b, { type: 'pass', card: s.players[b]!.hand[0]! }) };
  }

  it('keeps asking for tiles until the shortfall is covered', () => {
    const { s, b, pass } = lastTurn();
    s.tiles['stafford#1'] = tile(b, 'pottery', 2); // costs £0: worth nothing
    s.tiles['worcester#0'] = tile(b, 'cotton', 1); // worth £6
    pass();
    run(s, b, { type: 'removeTile', location: 'stafford', slot: 1 });
    expect(s.phase.kind).toBe('shortfall');
    run(s, b, { type: 'removeTile', location: 'worcester', slot: 0 });
    expect(s.phase.kind).toBe('actions');
    expect(s.players[b]!.money).toBe(3);
  });

  it('loses VPs for what is still short after the last tile is removed', () => {
    const { s, b, pass } = lastTurn();
    s.tiles['stafford#1'] = tile(b, 'pottery', 2);
    s.players[b]!.vp = 10;
    pass();
    run(s, b, { type: 'removeTile', location: 'stafford', slot: 1 });
    expect(s.players[b]!.vp).toBe(7);
    expect(s.phase.kind).toBe('actions');
  });

  it('only lets the player remove their own tiles', () => {
    const { s, b, pass } = lastTurn();
    s.tiles['stafford#1'] = tile(b, 'pottery', 2);
    s.tiles['worcester#0'] = tile(1 - b, 'cotton', 1);
    pass();
    expect(illegal(s, b, { type: 'removeTile', location: 'worcester', slot: 0 })).toMatch(/your own/);
  });
});

describe('end of era (rulebook p.7)', () => {
  function finalRound(era: 'canal' | 'rail') {
    const s = newGame(2);
    s.era = era;
    s.round = 5;
    s.deck = [];
    for (const p of s.players) p.hand = p.hand.slice(0, 1);
    const finish = () => {
      for (const id of [...s.turnOrder]) run(s, id, { type: 'pass', card: s.players[id]!.hand[0]! });
    };
    return { s, finish };
  }

  it('pays income at the end of the last round of the Canal Era', () => {
    const { s, finish } = finalRound('canal');
    s.players[1]!.incomeSpace = 15; // level 3
    finish();
    expect(s.players[1]!.money).toBe(20);
  });

  it('refills beer beside non-blank Merchant tiles only', () => {
    const { s, finish } = finalRound('canal');
    s.merchants[0] = { location: 'shrewsbury', tile: { industries: ['cotton'] }, beer: false };
    s.merchants[1] = { location: 'gloucester', tile: { industries: [] }, beer: false };
    finish();
    expect(s.merchants[0]!.beer).toBe(true);
    expect(s.merchants[1]!.beer).toBe(false);
  });

  it('removes level 1 tiles of every industry, flipped or not, and keeps higher levels with their cubes', () => {
    const { s, finish } = finalRound('canal');
    s.tiles['stafford#1'] = tile(0, 'pottery', 1);
    s.tiles['cannock#1'] = tile(1, 'coal', 2, 3);
    finish();
    expect(s.tiles['stafford#1']).toBeUndefined();
    expect(s.tiles['cannock#1']).toEqual(tile(1, 'coal', 2, 3));
  });

  it('starts the Rail Era with 2 actions per turn from round 1', () => {
    const { s, finish } = finalRound('canal');
    finish();
    expect(s.era).toBe('rail');
    expect(actionsThisTurn(s)).toBe(2);
  });

  it("scores a Merchant's link icons even when no Merchant tile was placed there", () => {
    // Warrington has no Merchant tile with 2 players, but its banner is printed on the board.
    const { s, finish } = finalRound('canal');
    s.links['warrington~stoke'] = 0;
    finish();
    expect(s.players[0]!.vp).toBe(2);
  });

  it('scores the Kidderminster–Worcester link for the Farm Brewery too', () => {
    const { s, finish } = finalRound('canal');
    s.links['kidderminster~worcester~farm-brewery-south'] = 0;
    s.tiles['farm-brewery-south#0'] = tile(1, 'brewery', 2, 0, true); // 2 link icons
    s.tiles['worcester#0'] = tile(1, 'cotton', 2, 0, true); // 2 link icons
    finish();
    expect(s.players[0]!.vp).toBe(4);
  });

  it('breaks ties by income, then money; still-tied players share a rank', () => {
    const s = newGame(3);
    s.phase = { kind: 'gameOver' };
    for (const p of s.players) p.vp = 10;
    s.players[0]!.money = 5;
    s.players[1]!.money = 9;
    s.players[2]!.money = 9;
    const ranks = Object.fromEntries(brassGame.outcome(s)!.ranking.map((r) => [r.player, r.rank]));
    expect(ranks).toEqual({ 0: 3, 1: 1, 2: 1 });
  });
});

describe('flipping and income (rulebook p.8)', () => {
  it('cannot raise income above level 30', () => {
    const s = game();
    s.players[0]!.incomeSpace = 97;
    s.tiles['kidderminster#1'] = tile(0, 'cotton', 1);
    s.links['kidderminster~coalbrookdale'] = 1;
    s.links['coalbrookdale~shrewsbury'] = 1;
    s.merchants[0] = { location: 'shrewsbury', tile: { industries: ['cotton'] }, beer: true };
    const [c] = giveHand(s, 0, [ind('coal'), ind('coal')]);
    run(s, 0, { type: 'sell', card: c!, sales: [{ location: 'kidderminster', slot: 1, merchant: 0 }] });
    expect(s.players[0]!.incomeSpace).toBe(99);
    expect(incomeLevel(s.players[0]!.incomeSpace)).toBe(30);
  });
});

describe('consuming coal (rulebook p.8)', () => {
  /** Player 0 builds Manufacturer III (2 coal) in Walsall. */
  function walsall() {
    const s = game();
    s.players[0]!.mat.manufacturer = [0, 0, 1, 1, 2, 1, 1, 2];
    s.links['cannock~walsall'] = 1;
    s.links['wolverhampton~walsall'] = 1;
    s.links['wolverhampton~dudley'] = 1;
    const [c] = giveHand(s, 0, [loc('walsall'), ind('coal')]);
    const action: BrassAction = { type: 'build', card: c!, industry: 'manufacturer', location: 'walsall', slot: 0 };
    return { s, action };
  }

  it('moves on to the next closest Coal Mine when the closest runs out', () => {
    const { s, action } = walsall();
    s.tiles['cannock#1'] = tile(1, 'coal', 2, 1);
    s.tiles['dudley#0'] = tile(1, 'coal', 2, 2);
    run(s, 0, action);
    expect(s.tiles['cannock#1']!.flipped).toBe(true);
    expect(s.tiles['dudley#0']!.cubes).toBe(1);
    expect(s.players[0]!.money).toBe(5);
    expect(s.coalMarket).toBe(13);
  });

  it('cannot buy the rest from the market without a connection to a Merchant', () => {
    const { s, action } = walsall();
    s.tiles['cannock#1'] = tile(1, 'coal', 2, 1);
    expect(illegal(s, 0, action)).toMatch(/No connected coal/);
  });

  it('never uses an unconnected Coal Mine', () => {
    const { s, action } = walsall();
    s.tiles['kidderminster#0'] = tile(0, 'coal', 2, 3);
    expect(illegal(s, 0, action)).toMatch(/No connected coal/);
  });

  it('buys market coal through a Merchant with no Merchant tile (Warrington, 2 players)', () => {
    const s = game();
    expect(s.merchants.find((m) => m.location === 'warrington')!.tile).toBeNull();
    s.links['warrington~stoke'] = 1;
    s.links['stoke~leek'] = 1;
    const [c] = giveHand(s, 0, [loc('leek'), ind('coal')]);
    run(s, 0, { type: 'build', card: c!, industry: 'manufacturer', location: 'leek', slot: 0 });
    expect(s.coalMarket).toBe(12);
    expect(s.players[0]!.money).toBe(17 - 8 - 1);
  });
});

describe('consuming iron (rulebook p.8)', () => {
  it("takes iron from any Iron Works, connected or not, for free, flipping it when emptied", () => {
    const s = game();
    s.tiles['coalbrookdale#1'] = tile(1, 'iron', 1, 1);
    const [c] = giveHand(s, 0, [loc('burton'), ind('coal')]);
    run(s, 0, { type: 'build', card: c!, industry: 'brewery', location: 'burton', slot: 1 });
    expect(s.players[0]!.money).toBe(12);
    expect(s.ironMarket).toBe(8);
    expect(s.tiles['coalbrookdale#1']!.flipped).toBe(true);
    expect(s.players[1]!.incomeSpace).toBe(13);
  });

  it('buys iron at £6 once the Iron Market is empty', () => {
    const s = game();
    s.ironMarket = 0;
    const [c] = giveHand(s, 0, [ind('coal'), ind('coal')]);
    run(s, 0, { type: 'develop', card: c!, industries: ['coal'] });
    expect(s.players[0]!.money).toBe(11);
  });
});

describe('consuming beer (rulebook p.8)', () => {
  function sale() {
    const s = game();
    s.tiles['kidderminster#1'] = tile(0, 'cotton', 1);
    s.links['kidderminster~coalbrookdale'] = 1;
    s.links['coalbrookdale~shrewsbury'] = 1;
    s.merchants[0] = { location: 'shrewsbury', tile: { industries: ['cotton'] }, beer: false };
    const [c] = giveHand(s, 0, [ind('coal'), ind('coal')]);
    const action: BrassAction = { type: 'sell', card: c!, sales: [{ location: 'kidderminster', slot: 1, merchant: 0 }] };
    return { s, action };
  }

  it('uses your own Brewery even when it is not connected', () => {
    const { s, action } = sale();
    s.tiles['burton#1'] = tile(0, 'brewery', 1, 1);
    run(s, 0, action);
    expect(s.tiles['burton#1']!.flipped).toBe(true);
    expect(s.players[0]!.incomeSpace).toBe(10 + 5 + 4);
  });

  it("uses an opponent's Brewery only when connected to the tile being sold", () => {
    const { s, action } = sale();
    s.tiles['burton#1'] = tile(1, 'brewery', 1, 1);
    expect(illegal(s, 0, action)).toMatch(/No beer/);
    const sales = (action as Extract<BrassAction, { type: 'sell' }>).sales;
    expect(illegal(s, 0, { ...action, sales: [{ ...sales[0]!, beer: ['burton#1'] }] } as BrassAction)).toMatch(
      /must be connected/,
    );
    s.tiles['coalbrookdale#0'] = tile(1, 'brewery', 1, 1);
    run(s, 0, action);
    expect(s.tiles['coalbrookdale#0']!.flipped).toBe(true);
    expect(s.players[1]!.incomeSpace).toBe(14);
  });
});

describe('build (rulebook pp.9–10)', () => {
  it('builds with a Location card outside your network', () => {
    const s = game();
    s.tiles['dudley#0'] = tile(0, 'coal', 1, 0, true);
    const [c] = giveHand(s, 0, [loc('worcester'), ind('coal')]);
    expect(illegal(s, 0, { type: 'build', card: c!, industry: 'cotton', location: 'worcester', slot: 0 })).toBeNull();
  });

  it('builds with a Wild Location card in any town, even one without Location cards (p.9 note)', () => {
    const s = game();
    s.tiles['dudley#0'] = tile(0, 'coal', 1, 0, true);
    const [wl] = giveHand(s, 0, ['wildLocation', ind('coal')]);
    run(s, 0, { type: 'build', card: wl!, industry: 'cotton', location: 'stoke', slot: 0 });
    expect(s.tiles['stoke#0']).toEqual(tile(0, 'cotton', 1));
    // Wild cards go back to their draw area, not the discard pile (p.6).
    expect(s.wildLocations).toContain(wl);
    expect(s.players[0]!.discard).not.toContain(wl);
  });

  it('needs the location in your network for a Wild Industry card', () => {
    const s = game();
    s.tiles['dudley#0'] = tile(0, 'coal', 1, 0, true);
    const [wi] = giveHand(s, 0, ['wildIndustry', ind('coal')]);
    const action: BrassAction = { type: 'build', card: wi!, industry: 'cotton', location: 'worcester', slot: 0 };
    expect(illegal(s, 0, action)).toMatch(/not part of your network/);
    s.links['kidderminster~worcester~farm-brewery-south'] = 0;
    expect(illegal(s, 0, action)).toBeNull();
  });

  it('only places a tile on a space showing its icon', () => {
    const s = game();
    const [c] = giveHand(s, 0, [loc('worcester'), ind('coal')]);
    expect(illegal(s, 0, { type: 'build', card: c!, industry: 'coal', location: 'worcester', slot: 0 })).toMatch(
      /doesn't show the coal icon/,
    );
  });

  it('may build in a location where opponents have tiles during the Canal Era', () => {
    const s = game();
    s.tiles['worcester#0'] = tile(1, 'cotton', 1);
    const [c] = giveHand(s, 0, [loc('worcester'), ind('coal')]);
    expect(illegal(s, 0, { type: 'build', card: c!, industry: 'cotton', location: 'worcester', slot: 1 })).toBeNull();
  });

  it('may not build rail-only tiles (Pottery V) in the Canal Era', () => {
    const s = game();
    s.players[0]!.mat.pottery = [0, 0, 0, 0, 1];
    const [c] = giveHand(s, 0, [loc('stafford'), ind('coal')]);
    expect(illegal(s, 0, { type: 'build', card: c!, industry: 'pottery', location: 'stafford', slot: 1 })).toMatch(
      /Canal Era/,
    );
  });

  it('may build Pottery I in the Rail Era, unlike other level 1 tiles (p.12)', () => {
    const s = game('rail');
    s.players[0]!.money = 30;
    const [c] = giveHand(s, 0, [loc('stafford'), ind('coal')]);
    expect(illegal(s, 0, { type: 'build', card: c!, industry: 'pottery', location: 'stafford', slot: 1 })).toBeNull();
  });

  it('puts 1 beer on a Brewery in the Canal Era and 2 in the Rail Era', () => {
    for (const era of ['canal', 'rail'] as const) {
      const s = game(era);
      s.players[0]!.mat.brewery = [0, 2, 2, 1];
      const [c] = giveHand(s, 0, [loc('burton'), ind('coal')]);
      run(s, 0, { type: 'build', card: c!, industry: 'brewery', location: 'burton', slot: 1 });
      expect(s.tiles['burton#1']!.cubes, era).toBe(era === 'canal' ? 1 : 2);
    }
  });

  it('keeps all the coal of a Coal Mine not connected to a Merchant', () => {
    const s = game();
    const [c] = giveHand(s, 0, [loc('cannock'), ind('coal')]);
    run(s, 0, { type: 'build', card: c!, industry: 'coal', location: 'cannock', slot: 1 });
    expect(s.tiles['cannock#1']).toEqual(tile(0, 'coal', 1, 2));
    expect(s.coalMarket).toBe(13);
  });

  it('flips an Iron Works whose iron all sells to the market, collecting its price and income', () => {
    const s = game();
    s.ironMarket = 4; // 6 empty spaces: £3, £3, £2, £2, £1, £1
    s.tiles['dudley#0'] = tile(1, 'coal', 2, 1);
    const [c] = giveHand(s, 0, [loc('dudley'), ind('coal')]);
    run(s, 0, { type: 'build', card: c!, industry: 'iron', location: 'dudley', slot: 1 });
    expect(s.ironMarket).toBe(8);
    expect(s.tiles['dudley#1']).toMatchObject({ cubes: 0, flipped: true });
    expect(s.players[0]!.money).toBe(17 - 5 + 3 + 3 + 2 + 2);
    expect(s.players[0]!.incomeSpace).toBe(13);
  });

  it('builds at a Farm Brewery with a Brewery card only when it is in your network (or first build)', () => {
    const s = game();
    s.tiles['cannock#0'] = tile(0, 'manufacturer', 1);
    const [br, lc] = giveHand(s, 0, [ind('brewery'), loc('cannock')]);
    const at = { industry: 'brewery', location: 'farm-brewery-north', slot: 0 } as const;
    expect(illegal(s, 0, { type: 'build', card: br!, ...at })).toMatch(/not part of your network/);
    expect(illegal(s, 0, { type: 'build', card: lc!, ...at })).toMatch(/only builds in Cannock/);
    s.links['cannock~farm-brewery-north'] = 0;
    expect(illegal(s, 0, { type: 'build', card: br!, ...at })).toBeNull();
  });

  it('puts the southern Farm Brewery in the network of the Kidderminster–Worcester link', () => {
    const s = game();
    s.links['kidderminster~worcester~farm-brewery-south'] = 0;
    const [br] = giveHand(s, 0, [ind('brewery'), ind('coal')]);
    expect(
      illegal(s, 0, { type: 'build', card: br!, industry: 'brewery', location: 'farm-brewery-south', slot: 0 }),
    ).toBeNull();
  });
});

describe('overbuilding (rulebook p.10)', () => {
  it('returns the cubes on your own overbuilt tile to the supply', () => {
    const s = game();
    s.tiles['cannock#1'] = tile(0, 'coal', 1, 2);
    s.players[0]!.mat.coal[0] = 0;
    const [c] = giveHand(s, 0, [loc('cannock'), ind('coal')]);
    run(s, 0, { type: 'build', card: c!, industry: 'coal', location: 'cannock', slot: 1 });
    expect(s.tiles['cannock#1']).toEqual(tile(0, 'coal', 2, 3));
  });

  it("is blocked by coal on any tile, even your own unconnected one, when overbuilding an opponent's mine", () => {
    const s = game();
    s.tiles['cannock#1'] = tile(1, 'coal', 1, 0, true);
    s.tiles['dudley#0'] = tile(0, 'coal', 2, 1);
    s.coalMarket = 0;
    s.players[0]!.mat.coal[0] = 0;
    const [c] = giveHand(s, 0, [loc('cannock'), ind('coal')]);
    const action: BrassAction = { type: 'build', card: c!, industry: 'coal', location: 'cannock', slot: 1 };
    expect(illegal(s, 0, action)).toMatch(/no coal left/);
    s.tiles['dudley#0']!.cubes = 0;
    expect(illegal(s, 0, action)).toBeNull();
  });

  it('cannot overbuild with an Industry card when you have nothing on the board', () => {
    const s = game();
    s.tiles['cannock#1'] = tile(1, 'coal', 1, 0, true);
    s.coalMarket = 0;
    s.players[0]!.mat.coal[0] = 0;
    const [c, l] = giveHand(s, 0, [ind('coal'), loc('cannock')]);
    const at = { industry: 'coal', location: 'cannock', slot: 1 } as const;
    expect(illegal(s, 0, { type: 'build', card: c!, ...at })).toMatch(/already developed/);
    expect(illegal(s, 0, { type: 'build', card: l!, ...at })).toBeNull();
  });

  it('allows only 1 of your tiles per location in the Canal Era, even when overbuilding', () => {
    const s = game();
    s.tiles['cannock#1'] = tile(1, 'coal', 1, 0, true);
    s.tiles['cannock#0'] = tile(0, 'manufacturer', 1);
    s.coalMarket = 0;
    s.players[0]!.mat.coal[0] = 0;
    const [c] = giveHand(s, 0, [loc('cannock'), ind('coal')]);
    expect(illegal(s, 0, { type: 'build', card: c!, industry: 'coal', location: 'cannock', slot: 1 })).toMatch(
      /only 1 tile per location/,
    );
  });
});

describe('sell (rulebook p.10)', () => {
  function base() {
    const s = game();
    s.links['kidderminster~coalbrookdale'] = 1;
    s.links['coalbrookdale~shrewsbury'] = 1;
    s.links['coalbrookdale~wolverhampton'] = 1;
    s.merchants[0] = { location: 'shrewsbury', tile: { industries: ['cotton', 'manufacturer', 'pottery'] }, beer: true };
    const [c] = giveHand(s, 0, [ind('coal'), ind('coal')]);
    return { s, c: c! };
  }

  it('sells tiles of different industries in one action, each with its own beer', () => {
    const { s, c } = base();
    s.tiles['kidderminster#1'] = tile(0, 'cotton', 1);
    s.tiles['wolverhampton#0'] = tile(0, 'manufacturer', 1);
    s.tiles['burton#1'] = tile(0, 'brewery', 1, 1);
    run(s, 0, {
      type: 'sell',
      card: c,
      sales: [
        { location: 'kidderminster', slot: 1, merchant: 0 },
        { location: 'wolverhampton', slot: 0, merchant: 0 },
      ],
    });
    expect(s.tiles['kidderminster#1']!.flipped && s.tiles['wolverhampton#0']!.flipped).toBe(true);
    expect(s.merchants[0]!.beer).toBe(false);
    expect(s.tiles['burton#1']!.flipped).toBe(true);
    // Cotton I +5, Manufacturer I +5, own Brewery I +4; Shrewsbury's bonus once.
    expect(s.players[0]!.incomeSpace).toBe(24);
    expect(s.players[0]!.vp).toBe(4);
  });

  it('refuses blank Merchants, Merchants not buying that good, unsellable industries and sold tiles', () => {
    const { s, c } = base();
    const sell = (location: 'kidderminster' | 'coalbrookdale', slot: number): BrassAction => ({
      type: 'sell',
      card: c,
      sales: [{ location, slot, merchant: 0 }],
    });
    s.tiles['kidderminster#1'] = tile(0, 'cotton', 1);
    s.merchants[0]!.tile = { industries: [] };
    expect(illegal(s, 0, sell('kidderminster', 1))).toMatch(/doesn't buy/);
    s.merchants[0]!.tile = { industries: ['manufacturer'] };
    expect(illegal(s, 0, sell('kidderminster', 1))).toMatch(/doesn't buy/);
    s.merchants[0]!.tile = { industries: ['cotton'] };
    s.tiles['kidderminster#1']!.flipped = true;
    expect(illegal(s, 0, sell('kidderminster', 1))).toMatch(/already been sold/);
    s.tiles['coalbrookdale#2'] = tile(0, 'coal', 2, 1);
    expect(illegal(s, 0, sell('coalbrookdale', 2))).toMatch(/Only Cotton Mills/);
  });

  it.each([
    ['oxford', 3, 'birmingham', 0, (s: BrassState) => expect(s.players[0]!.incomeSpace).toBe(10 + 5 + 2)],
    ['warrington', 5, 'stoke', 0, (s: BrassState) => expect(s.players[0]!.money).toBe(22)],
    ['nottingham', 7, 'derby', 0, (s: BrassState) => expect(s.players[0]!.vp).toBe(3)],
  ] as const)("gives %s's beer bonus", (merchant, index, town, slot, check) => {
    const s = game('canal', 4);
    s.tiles[`${town}#${slot}`] = tile(0, 'cotton', 1);
    s.links[`${merchant === 'oxford' ? 'birmingham~oxford' : merchant === 'warrington' ? 'warrington~stoke' : 'derby~nottingham'}`] = 1;
    s.merchants[index] = { location: merchant, tile: { industries: ['cotton'] }, beer: true };
    const [c] = giveHand(s, 0, [ind('coal'), ind('coal')]);
    run(s, 0, { type: 'sell', card: c!, sales: [{ location: town, slot, merchant: index }] });
    check(s);
  });

  it("lets Gloucester's Develop be declined, and never develops a lightbulb tile", () => {
    const s = game();
    s.tiles['worcester#0'] = tile(0, 'cotton', 1);
    s.links['worcester~gloucester'] = 1;
    s.merchants[1] = { location: 'gloucester', tile: { industries: ['cotton'] }, beer: true };
    const [c] = giveHand(s, 0, [ind('coal'), ind('coal')]);
    const sale = { location: 'worcester', slot: 0, merchant: 1 } as const;
    expect(illegal(s, 0, { type: 'sell', card: c!, sales: [{ ...sale, develop: 'pottery' }] })).toMatch(
      /can't be developed/,
    );
    const before = INDUSTRY_COUNTS(s);
    run(s, 0, { type: 'sell', card: c!, sales: [{ ...sale, develop: null }] });
    expect(INDUSTRY_COUNTS(s)).toEqual(before);
    expect(s.merchants[1]!.beer).toBe(false);
  });
});

const INDUSTRY_COUNTS = (s: BrassState) =>
  (['cotton', 'manufacturer', 'pottery', 'coal', 'iron', 'brewery'] as const).map((i) => matLeft(s, 0, i));

describe('develop, loan, scout (rulebook p.11)', () => {
  it('develops 2 different industries, taking iron from any Iron Works for free', () => {
    const s = game();
    s.tiles['coalbrookdale#1'] = tile(1, 'iron', 1, 2);
    const [c] = giveHand(s, 0, [ind('coal'), ind('coal')]);
    run(s, 0, { type: 'develop', card: c!, industries: ['cotton', 'brewery'] });
    expect(s.players[0]!.mat.cotton).toEqual([2, 2, 3, 3]);
    expect(s.players[0]!.mat.brewery).toEqual([1, 2, 2, 1]);
    expect(s.players[0]!.money).toBe(17);
    expect(s.tiles['coalbrookdale#1']!.flipped).toBe(true);
  });

  it('develops Pottery II but then stops at the lightbulb on Pottery III', () => {
    const s = game();
    s.players[0]!.mat.pottery = [0, 1, 1, 1, 1];
    const [c] = giveHand(s, 0, [ind('coal'), ind('coal')]);
    expect(illegal(s, 0, { type: 'develop', card: c!, industries: ['pottery', 'pottery'] })).toMatch(
      /can't be developed/,
    );
    expect(illegal(s, 0, { type: 'develop', card: c!, industries: ['pottery'] })).toBeNull();
  });

  it('allows a loan that takes income to exactly -10', () => {
    const s = game();
    s.players[0]!.incomeSpace = 3; // level -7
    const [c] = giveHand(s, 0, [ind('coal'), ind('coal')]);
    run(s, 0, { type: 'loan', card: c! });
    expect(incomeLevel(s.players[0]!.incomeSpace)).toBe(-10);
    expect(s.players[0]!.money).toBe(47);
  });

  it('scouts with 3 different cards only', () => {
    const s = game();
    const [a, b] = giveHand(s, 0, [ind('coal'), ind('iron'), ind('iron')]);
    expect(illegal(s, 0, { type: 'scout', cards: [a!, a!, b!] })).toMatch(/3 different/);
  });
});

describe('network (rulebook p.11)', () => {
  it('builds exactly 1 canal link, at most 2 rail links, and only on lines of the era', () => {
    const s = game();
    const [c] = giveHand(s, 0, [ind('coal'), ind('coal')]);
    expect(illegal(s, 0, { type: 'network', card: c!, links: ['wolverhampton~dudley', 'birmingham~dudley'] })).toMatch(
      /only 1 canal link/,
    );
    s.era = 'rail';
    expect(
      illegal(s, 0, { type: 'network', card: c!, links: ['wolverhampton~dudley', 'birmingham~dudley', 'kidderminster~dudley'] }),
    ).toMatch(/1 or 2/);
    expect(illegal(s, 0, { type: 'network', card: c!, links: ['burton~walsall'] })).toMatch(/canal only/);
  });

  it('lets a player with nothing on the board build a link anywhere', () => {
    const s = game();
    const [c] = giveHand(s, 0, [ind('coal'), ind('coal')]);
    expect(illegal(s, 0, { type: 'network', card: c!, links: ['stoke~leek'] })).toBeNull();
  });

  it('needs a Link tile in supply', () => {
    const s = game();
    s.players[0]!.linksInSupply = 0;
    const [c] = giveHand(s, 0, [ind('coal'), ind('coal')]);
    expect(illegal(s, 0, { type: 'network', card: c!, links: ['stoke~leek'] })).toMatch(/no Link tiles/);
  });

  it('needs coal connected to a rail link, buying it from the market through a Merchant', () => {
    const s = game('rail');
    s.tiles['birmingham#0'] = tile(0, 'cotton', 2, 0, true);
    const [c] = giveHand(s, 0, [ind('coal'), ind('coal')]);
    const action: BrassAction = { type: 'network', card: c!, links: ['birmingham~dudley'] };
    expect(illegal(s, 0, action)).toMatch(/No connected coal/);
    s.links['birmingham~oxford'] = 1;
    run(s, 0, action);
    expect(s.players[0]!.money).toBe(17 - 5 - 1);
    expect(s.coalMarket).toBe(12);
  });

  function doubleRail() {
    const s = game('rail');
    s.tiles['birmingham#0'] = tile(0, 'cotton', 2, 0, true);
    s.tiles['dudley#0'] = tile(1, 'coal', 2, 2);
    const [c] = giveHand(s, 0, [ind('coal'), ind('coal')]);
    const action: BrassAction = { type: 'network', card: c!, links: ['birmingham~dudley', 'wolverhampton~dudley'] };
    return { s, action };
  }

  it("takes a double rail's beer from an opponent's Brewery only if connected to the second link", () => {
    const { s, action } = doubleRail();
    s.tiles['walsall#1'] = tile(1, 'brewery', 2, 1);
    expect(illegal(s, 0, action)).toMatch(/No beer/);
    s.links['birmingham~walsall'] = 1;
    run(s, 0, action);
    expect(s.tiles['walsall#1']!.flipped).toBe(true);
    expect(s.players[0]!.money).toBe(2);
  });

  it("never takes a double rail's beer from a Merchant", () => {
    const { s, action } = doubleRail();
    s.tiles['walsall#1'] = tile(0, 'brewery', 2, 1);
    expect(illegal(s, 0, { ...action, beer: 'merchant' } as BrassAction)).toMatch(/only be used when selling/);
  });
});
