import { describe, expect, it } from 'vitest';
import { act, createMatch, createRng, replay, type Match } from '../../src/index.ts';
import {
  brassGame,
  candidateActions,
  currentPlayer,
  incomeLevel,
  perform,
  ROUNDS_PER_ERA,
  type BrassAction,
  type BrassConfig,
  type BrassState,
  type BuiltTile,
  type PlayerCount,
} from '../../src/brass/index.ts';
import { TEST_COMPONENTS, giveHand, ind, loc, makeTurn, newGame } from './fixtures.ts';

const rng = createRng(0);
const run = (s: BrassState, p: number, a: BrassAction) => perform(s, p, a, rng);
const illegal = (s: BrassState, p: number, a: BrassAction) => brassGame.validate(s, p, a);
const tile = (owner: number, industry: BuiltTile['industry'], level: number, cubes = 0, flipped = false): BuiltTile => ({
  owner,
  industry,
  level,
  cubes,
  flipped,
});

/** A 2-player game where player 0 acts in round 2 of the given era. */
function game(era: 'canal' | 'rail' = 'canal'): BrassState {
  const s = newGame(2);
  makeTurn(s, 0, era);
  return s;
}

describe('setup (rulebook pp.4–5)', () => {
  it('deals £17, income 0, 8 cards and a face-down discard', () => {
    const s = newGame(2);
    for (const p of s.players) {
      expect(p.money).toBe(17);
      expect(incomeLevel(p.incomeSpace)).toBe(0);
      expect(p.hand).toHaveLength(8);
      expect(p.faceDownDiscard).not.toBeNull();
    }
  });

  it('places no Merchant tiles in Warrington or Nottingham with 2 players', () => {
    const s = newGame(2);
    for (const m of s.merchants) {
      const placed = m.location !== 'warrington' && m.location !== 'nottingham';
      expect(m.tile !== null, m.location).toBe(placed);
    }
  });

  it('puts beer beside every non-blank Merchant tile', () => {
    for (const m of newGame(4).merchants) expect(m.beer).toBe(!!m.tile && m.tile.industries.length > 0);
  });

  it('removes blue and teal Location cards with 2 players, teal with 3', () => {
    const towns = (n: PlayerCount) =>
      new Set(
        Object.values(newGame(n).cards).flatMap((c) => (c.kind === 'location' ? [c.location] : [])),
      );
    expect(towns(2).has('stoke')).toBe(false); // blue
    expect(towns(3).has('stoke')).toBe(true);
    expect(towns(3).has('derby')).toBe(false); // teal
    expect(towns(4).has('derby')).toBe(true);
  });
});

describe('turns (rulebook p.6)', () => {
  it('gives each player 1 action in the first round, then refills their hand', () => {
    const s = newGame(2);
    const [first, second] = s.turnOrder as [number, number];
    run(s, first, { type: 'pass', card: s.players[first]!.hand[0]! });
    expect(currentPlayer(s)).toBe(second);
    expect(s.players[first]!.hand).toHaveLength(8);
  });

  it('gives 2 actions per turn after the first round', () => {
    const s = game();
    const [a, b] = giveHand(s, 0, [ind('coal'), ind('coal')]);
    run(s, 0, { type: 'pass', card: a! });
    expect(currentPlayer(s)).toBe(0);
    run(s, 0, { type: 'pass', card: b! });
    expect(currentPlayer(s)).toBe(1);
  });

  it('orders the next round by money spent; ties keep their order', () => {
    const s = newGame(3);
    const [a, b, c] = s.turnOrder as [number, number, number];
    run(s, a, { type: 'pass', card: s.players[a]!.hand[0]! });
    run(s, b, { type: 'pass', card: s.players[b]!.hand[0]! });
    s.players[a]!.spent = 10;
    s.players[c]!.spent = 10;
    run(s, c, { type: 'pass', card: s.players[c]!.hand[0]! });
    expect(s.turnOrder).toEqual([b, a, c]);
    expect(s.players.every((p) => p.spent === 0)).toBe(true);
  });

  it('pays income at the end of the round', () => {
    const s = newGame(2);
    const [a, b] = s.turnOrder as [number, number];
    s.players[b]!.incomeSpace = 15; // level 3
    run(s, a, { type: 'pass', card: s.players[a]!.hand[0]! });
    run(s, b, { type: 'pass', card: s.players[b]!.hand[0]! });
    expect(s.players[b]!.money).toBe(20);
    expect(s.players[a]!.money).toBe(17);
  });
});

describe('build (rulebook pp.9–10)', () => {
  it('builds with a Location card anywhere, paying the tile cost', () => {
    const s = game();
    const [c] = giveHand(s, 0, [loc('worcester'), ind('coal')]);
    run(s, 0, { type: 'build', card: c!, industry: 'cotton', location: 'worcester', slot: 0 });
    expect(s.tiles['worcester#0']).toEqual(tile(0, 'cotton', 1));
    expect(s.players[0]!.money).toBe(5);
    expect(s.players[0]!.spent).toBe(12);
  });

  it('must use a space showing only that industry if one is free', () => {
    const s = game();
    const [c] = giveHand(s, 0, [loc('kidderminster'), ind('coal')]);
    expect(illegal(s, 0, { type: 'build', card: c!, industry: 'cotton', location: 'kidderminster', slot: 0 })).toMatch(
      /only the cotton icon/,
    );
    expect(illegal(s, 0, { type: 'build', card: c!, industry: 'cotton', location: 'kidderminster', slot: 1 })).toBeNull();
  });

  it('allows only 1 of your tiles per location in the Canal Era, but more in the Rail Era', () => {
    const s = game();
    s.tiles['kidderminster#1'] = tile(0, 'cotton', 1);
    const [c] = giveHand(s, 0, [loc('kidderminster'), ind('coal')]);
    const action: BrassAction = { type: 'build', card: c!, industry: 'coal', location: 'kidderminster', slot: 0 };
    expect(illegal(s, 0, action)).toMatch(/only 1 tile per location/);
    s.era = 'rail';
    s.players[0]!.mat.coal[0] = 0; // level 1 can't be built in the Rail Era
    expect(illegal(s, 0, action)).toBeNull();
  });

  it('needs the location in your network to build with an Industry card', () => {
    const s = game();
    s.tiles['dudley#0'] = tile(0, 'coal', 1, 0, true);
    const [c] = giveHand(s, 0, [ind('cotton'), ind('coal')]);
    const action: BrassAction = { type: 'build', card: c!, industry: 'cotton', location: 'worcester', slot: 0 };
    expect(illegal(s, 0, action)).toMatch(/not part of your network/);
    s.links['kidderminster~worcester~farm-brewery-south'] = 0;
    expect(illegal(s, 0, action)).toBeNull();
  });

  it('lets a player with nothing on the board use an Industry card anywhere', () => {
    const s = game();
    const [c] = giveHand(s, 0, [ind('cotton'), ind('coal')]);
    expect(illegal(s, 0, { type: 'build', card: c!, industry: 'cotton', location: 'worcester', slot: 0 })).toBeNull();
  });

  it('builds at a Farm Brewery only with a Brewery or Wild Industry card', () => {
    const s = game();
    const [wl, br] = giveHand(s, 0, ['wildLocation', ind('brewery')]);
    const at = { industry: 'brewery', location: 'farm-brewery-north', slot: 0 } as const;
    expect(illegal(s, 0, { type: 'build', card: wl!, ...at })).toMatch(/Farm Brewery/);
    expect(illegal(s, 0, { type: 'build', card: br!, ...at })).toBeNull();
  });

  it('refuses tiles marked for the other era', () => {
    const s = game('rail');
    const [c] = giveHand(s, 0, [loc('worcester'), ind('coal')]);
    expect(illegal(s, 0, { type: 'build', card: c!, industry: 'cotton', location: 'worcester', slot: 0 })).toMatch(
      /Rail Era/,
    );
  });

  it('sells a new Coal Mine’s coal to the market when connected to a Merchant', () => {
    const s = game();
    s.links['warrington~stoke'] = 1;
    s.links['stoke~leek'] = 1;
    const [c] = giveHand(s, 0, [loc('leek'), ind('coal')]);
    run(s, 0, { type: 'build', card: c!, industry: 'coal', location: 'leek', slot: 1 });
    // The market has one empty £1 space, so 1 of the 2 coal is sold.
    expect(s.coalMarket).toBe(14);
    expect(s.tiles['leek#1']).toMatchObject({ cubes: 1, flipped: false });
    expect(s.players[0]!.money).toBe(17 - 5 + 1);
  });

  it('always sells a new Iron Works’ iron, and buys coal from the market when connected', () => {
    const s = game();
    const [c] = giveHand(s, 0, [loc('dudley'), ind('coal')]);
    const action: BrassAction = { type: 'build', card: c!, industry: 'iron', location: 'dudley', slot: 1 };
    expect(illegal(s, 0, action)).toMatch(/No connected coal/);

    s.links['kidderminster~dudley'] = 1;
    s.links['kidderminster~coalbrookdale'] = 1;
    s.links['coalbrookdale~shrewsbury'] = 1;
    run(s, 0, action);
    expect(s.coalMarket).toBe(12);
    expect(s.ironMarket).toBe(10);
    expect(s.tiles['dudley#1']).toMatchObject({ cubes: 2, flipped: false });
    expect(s.players[0]!.money).toBe(17 - 5 - 1 + 2);
    expect(s.players[0]!.spent).toBe(6);
  });

  it('takes coal from the closest connected Coal Mine', () => {
    const s = game();
    s.tiles['cannock#1'] = tile(1, 'coal', 1, 2);
    s.tiles['wolverhampton#1'] = tile(1, 'coal', 1, 2);
    s.tiles['dudley#0'] = tile(1, 'coal', 1, 2);
    s.links['cannock~walsall'] = 1;
    s.links['wolverhampton~walsall'] = 1;
    s.links['wolverhampton~dudley'] = 1;
    const [c] = giveHand(s, 0, [loc('walsall'), ind('coal')]);
    const base = { type: 'build', card: c!, industry: 'manufacturer', location: 'walsall', slot: 1 } as const;
    expect(illegal(s, 0, { ...base, coal: ['dudley#0'] })).toMatch(/closest/);
    run(s, 0, { ...base, coal: ['wolverhampton#1'] });
    expect(s.tiles['wolverhampton#1']!.cubes).toBe(1);
    expect(s.tiles['cannock#1']!.cubes).toBe(2);
  });

  it('flips a Coal Mine when its last coal is used, raising its owner’s income', () => {
    const s = game();
    s.tiles['cannock#1'] = tile(1, 'coal', 1, 1);
    s.links['cannock~walsall'] = 1;
    const [c] = giveHand(s, 0, [loc('walsall'), ind('coal')]);
    run(s, 0, { type: 'build', card: c!, industry: 'manufacturer', location: 'walsall', slot: 1 });
    expect(s.tiles['cannock#1']!.flipped).toBe(true);
    expect(s.players[1]!.incomeSpace).toBe(14);
  });

  it('overbuilds an opponent’s Coal Mine only when no coal is left anywhere', () => {
    const s = game();
    s.tiles['cannock#1'] = tile(1, 'coal', 1, 0, true);
    s.players[0]!.mat.coal[0] = 0;
    const [c] = giveHand(s, 0, [loc('cannock'), ind('coal')]);
    const action: BrassAction = { type: 'build', card: c!, industry: 'coal', location: 'cannock', slot: 1 };
    expect(illegal(s, 0, action)).toMatch(/no coal left/);
    s.coalMarket = 0;
    run(s, 0, action);
    expect(s.tiles['cannock#1']).toEqual(tile(0, 'coal', 2, 3));
  });

  it('always lets you overbuild your own tile, even with an empty space in that town', () => {
    const s = game();
    s.tiles['worcester#0'] = tile(0, 'cotton', 1, 0, true);
    s.players[0]!.mat.cotton[0] = 0;
    const [c] = giveHand(s, 0, [loc('worcester'), ind('coal')]);
    // Cotton II needs coal: give it a connected mine.
    s.tiles['kidderminster#0'] = tile(1, 'coal', 2, 1);
    s.links['kidderminster~worcester~farm-brewery-south'] = 1;
    run(s, 0, { type: 'build', card: c!, industry: 'cotton', location: 'worcester', slot: 0 });
    expect(s.tiles['worcester#0']).toEqual(tile(0, 'cotton', 2));
    expect(s.tiles['worcester#1']).toBeUndefined();
  });

  it('only overbuilds with a higher level of the same industry', () => {
    const s = game();
    s.tiles['worcester#0'] = tile(0, 'cotton', 1, 0, true);
    const [c] = giveHand(s, 0, [loc('worcester'), ind('coal')]);
    expect(illegal(s, 0, { type: 'build', card: c!, industry: 'cotton', location: 'worcester', slot: 0 })).toMatch(
      /higher-level/,
    );
  });

  it('overbuilds an opponent’s Iron Works only when no iron is left on any tile or in the market', () => {
    const s = game();
    s.tiles['dudley#1'] = tile(1, 'iron', 1, 0, true);
    s.tiles['coalbrookdale#1'] = tile(1, 'iron', 1, 1);
    s.ironMarket = 0;
    s.players[0]!.mat.iron[0] = 0;
    s.tiles['dudley#0'] = tile(1, 'coal', 1, 2);
    const [c] = giveHand(s, 0, [loc('dudley'), ind('coal')]);
    const action: BrassAction = { type: 'build', card: c!, industry: 'iron', location: 'dudley', slot: 1 };
    expect(illegal(s, 0, action)).toMatch(/no iron left/);
    s.tiles['coalbrookdale#1']!.cubes = 0;
    expect(illegal(s, 0, action)).toBeNull();
  });

  it('never overbuilds an opponent’s other industries', () => {
    const s = game();
    s.tiles['worcester#0'] = tile(1, 'cotton', 1, 0, true);
    s.tiles['worcester#1'] = tile(1, 'cotton', 1, 0, true);
    s.players[0]!.mat.cotton[0] = 0;
    const [c] = giveHand(s, 0, [loc('worcester'), ind('coal')]);
    expect(illegal(s, 0, { type: 'build', card: c!, industry: 'cotton', location: 'worcester', slot: 0 })).toMatch(
      /opponent/,
    );
  });
});

describe('network (rulebook p.11)', () => {
  it('builds 1 canal link for £3 next to your network', () => {
    const s = game();
    s.tiles['dudley#0'] = tile(0, 'coal', 1, 0, true);
    const [c] = giveHand(s, 0, [ind('coal'), ind('coal')]);
    expect(illegal(s, 0, { type: 'network', card: c!, links: ['stoke~leek'] })).toMatch(/adjacent/);
    run(s, 0, { type: 'network', card: c!, links: ['wolverhampton~dudley'] });
    expect(s.links['wolverhampton~dudley']).toBe(0);
    expect(s.players[0]!.money).toBe(14);
  });

  it('refuses rail-only lines in the Canal Era', () => {
    const s = game();
    const [c] = giveHand(s, 0, [ind('coal'), ind('coal')]);
    expect(illegal(s, 0, { type: 'network', card: c!, links: ['leek~belper'] })).toMatch(/rail only/);
  });

  it('builds 2 rail links for £15, 1 coal each and 1 beer', () => {
    const s = game('rail');
    s.tiles['birmingham#0'] = tile(0, 'cotton', 2, 0, true);
    s.tiles['dudley#0'] = tile(1, 'coal', 2, 2);
    const [c] = giveHand(s, 0, [ind('coal'), ind('coal')]);
    const action: BrassAction = { type: 'network', card: c!, links: ['birmingham~dudley', 'wolverhampton~dudley'] };
    expect(illegal(s, 0, action)).toMatch(/No beer/);

    s.tiles['walsall#1'] = tile(0, 'brewery', 2, 1);
    run(s, 0, action);
    expect(s.players[0]!.money).toBe(2);
    expect(s.tiles['dudley#0']!.flipped).toBe(true);
    expect(s.tiles['walsall#1']!.flipped).toBe(true);
    expect(s.players[0]!.linksInSupply).toBe(12);
  });
});

describe('develop, loan, scout (rulebook p.11)', () => {
  it('develops by removing the lowest tile and consuming iron', () => {
    const s = game();
    const [c] = giveHand(s, 0, [ind('coal'), ind('coal')]);
    run(s, 0, { type: 'develop', card: c!, industries: ['coal', 'coal'] });
    expect(s.players[0]!.mat.coal).toEqual([0, 1, 2, 2]);
    expect(s.ironMarket).toBe(6);
    expect(s.players[0]!.money).toBe(17 - 2 - 2);
  });

  it('cannot develop a Pottery tile with a lightbulb', () => {
    const s = game();
    const [c] = giveHand(s, 0, [ind('coal'), ind('coal')]);
    expect(illegal(s, 0, { type: 'develop', card: c!, industries: ['pottery'] })).toMatch(/can't be developed/);
  });

  it('takes a £30 loan, dropping 3 income levels to the top of the new level', () => {
    const s = game();
    const [c] = giveHand(s, 0, [ind('coal'), ind('coal')]);
    run(s, 0, { type: 'loan', card: c! });
    expect(s.players[0]!.money).toBe(47);
    expect(incomeLevel(s.players[0]!.incomeSpace)).toBe(-3);
    expect(s.players[0]!.incomeSpace).toBe(7);
  });

  it('refuses a loan that would take income below -10', () => {
    const s = game();
    s.players[0]!.incomeSpace = 2; // level -8
    const [c] = giveHand(s, 0, [ind('coal'), ind('coal')]);
    expect(illegal(s, 0, { type: 'loan', card: c! })).toMatch(/below -10/);
  });

  it('scouts 3 cards for 1 Wild Location and 1 Wild Industry, but not while holding a Wild', () => {
    const s = game();
    const hand = giveHand(s, 0, [ind('coal'), ind('coal'), ind('iron'), ind('iron')]);
    run(s, 0, { type: 'scout', cards: hand.slice(0, 3) });
    const kinds = s.players[0]!.hand.map((id) => s.cards[id]!.kind).sort();
    expect(kinds).toEqual(['industry', 'wildIndustry', 'wildLocation']);
    expect(illegal(s, 0, { type: 'scout', cards: s.players[0]!.hand })).toMatch(/Wild/);
  });
});

describe('sell (rulebook p.10)', () => {
  function sellable() {
    const s = game();
    s.tiles['kidderminster#1'] = tile(0, 'cotton', 1);
    s.merchants[0] = { location: 'shrewsbury', tile: { industries: ['cotton'] }, beer: true };
    const [c] = giveHand(s, 0, [ind('coal'), ind('coal')]);
    const action: BrassAction = { type: 'sell', card: c!, sales: [{ location: 'kidderminster', slot: 1, merchant: 0 }] };
    return { s, action };
  }

  it('needs a connection to a Merchant that buys the goods', () => {
    const { s, action } = sellable();
    expect(illegal(s, 0, action)).toMatch(/not connected/);
  });

  it('flips the tile, consumes Merchant beer and collects its bonus', () => {
    const { s, action } = sellable();
    s.links['kidderminster~coalbrookdale'] = 1;
    s.links['coalbrookdale~shrewsbury'] = 1;
    run(s, 0, action);
    expect(s.tiles['kidderminster#1']!.flipped).toBe(true);
    expect(s.players[0]!.incomeSpace).toBe(15);
    expect(s.players[0]!.vp).toBe(4); // Shrewsbury bonus
    expect(s.merchants[0]!.beer).toBe(false);
  });

  it('cannot sell without beer', () => {
    const { s, action } = sellable();
    s.links['kidderminster~coalbrookdale'] = 1;
    s.links['coalbrookdale~shrewsbury'] = 1;
    s.merchants[0]!.beer = false;
    expect(illegal(s, 0, action)).toMatch(/No beer/);
  });
});

describe('income shortfall (rulebook p.6)', () => {
  function lastTurn() {
    const s = newGame(2);
    const [a, b] = s.turnOrder as [number, number];
    run(s, a, { type: 'pass', card: s.players[a]!.hand[0]! });
    s.players[b]!.incomeSpace = 5; // level -5
    s.players[b]!.money = 2;
    return { s, b, pass: () => run(s, b, { type: 'pass', card: s.players[b]!.hand[0]! }) };
  }

  it('makes the player remove tiles worth half their cost, keeping any excess', () => {
    const { s, b, pass } = lastTurn();
    s.tiles['worcester#0'] = tile(b, 'cotton', 1);
    pass();
    expect(s.phase.kind).toBe('shortfall');
    expect(currentPlayer(s)).toBe(b);
    run(s, b, { type: 'removeTile', location: 'worcester', slot: 0 });
    expect(s.tiles['worcester#0']).toBeUndefined();
    expect(s.players[b]!.money).toBe(3); // owed 3 more; tile worth £6
    expect(s.phase.kind).toBe('actions');
  });

  it('loses 1 VP per £1 short when there are no tiles to remove', () => {
    const { s, b, pass } = lastTurn();
    s.players[b]!.vp = 10;
    pass();
    expect(s.players[b]!.vp).toBe(7);
    expect(s.players[b]!.money).toBe(0);
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

  it('scores links and flipped tiles, then clears links and level 1 tiles after the Canal Era', () => {
    const { s, finish } = finalRound('canal');
    s.links['coalbrookdale~shrewsbury'] = 0;
    s.players[0]!.linksInSupply = 13;
    s.tiles['coalbrookdale#1'] = tile(0, 'iron', 1, 0, true);
    s.tiles['coalbrookdale#2'] = tile(1, 'coal', 2, 0, true);
    finish();
    // Link: Shrewsbury 2 + Coalbrookdale (1 + 1). Tiles: Iron I = 3 VP.
    expect(s.players[0]!.vp).toBe(4 + 3);
    expect(s.players[1]!.vp).toBe(2);
    expect(s.links).toEqual({});
    expect(s.players[0]!.linksInSupply).toBe(14);
    expect(s.tiles['coalbrookdale#1']).toBeUndefined();
    expect(s.tiles['coalbrookdale#2']).toBeDefined();
    expect(s.era).toBe('rail');
    expect(s.round).toBe(1);
  });

  it('does not count unflipped tiles for link scoring', () => {
    const { s, finish } = finalRound('canal');
    s.links['coalbrookdale~shrewsbury'] = 0;
    s.tiles['coalbrookdale#2'] = tile(1, 'coal', 2, 3);
    finish();
    expect(s.players[0]!.vp).toBe(2);
  });

  it('reshuffles every discard pile, including the face-down card, into a new deck', () => {
    const { s, finish } = finalRound('canal');
    finish();
    const cards = s.deck.length + s.players.reduce((n, p) => n + p.hand.length, 0);
    expect(cards).toBe(4); // 2 players × (1 pass + 1 face-down)
    expect(s.players.every((p) => p.discard.length === 0 && p.faceDownDiscard === null)).toBe(true);
  });

  it('ends the game after the Rail Era without paying income, breaking ties by income', () => {
    const { s, finish } = finalRound('rail');
    s.players[1]!.incomeSpace = 20;
    finish();
    expect(s.phase.kind).toBe('gameOver');
    expect(s.players[1]!.money).toBe(17);
    expect(brassGame.outcome(s)!.ranking.map((r) => [r.player, r.rank])).toEqual([
      [1, 1],
      [0, 2],
    ]);
  });
});

describe('views', () => {
  it('hides opponents’ hands, face-down discards and the deck order', () => {
    const s = newGame(2);
    const view = brassGame.viewFor(s, 0);
    expect(view.players[0]!.hand).toEqual(s.players[0]!.hand);
    expect(view.players[1]!.hand).toBeNull();
    expect(view.players[1]!.handSize).toBe(8);
    expect(JSON.stringify(view)).not.toContain(`"${s.players[1]!.hand[0]}"`);
    expect(JSON.stringify(view)).not.toContain(`"${s.players[1]!.faceDownDiscard}"`);
    expect('deck' in view).toBe(false);
  });
});

describe('full games', () => {
  /** Plays a whole game, each move picked at random from the legal candidates. */
  /**
   * Plays a whole game, each move picked at random from the legal candidates,
   * recording how many turns each round of each era had.
   */
  function playOut(playerCount: PlayerCount, seed: number) {
    const config: BrassConfig = { playerCount, components: TEST_COMPONENTS };
    const pick = createRng(seed + 1000);
    const turns: Record<string, number> = {};
    let match: Match<BrassConfig, BrassState, BrassAction> = createMatch(brassGame, config, seed);
    for (let step = 0; step < 2000 && !brassGame.outcome(match.state); step++) {
      const s = match.state;
      const player = brassGame.activePlayers(s)[0]!;
      if (s.phase.kind === 'actions' && s.actionsTaken === 0) {
        const key = `${s.era} ${s.round}`;
        turns[key] = (turns[key] ?? 0) + 1;
      }
      const options = pick.shuffle(candidateActions(s, player));
      const action = options.find((a) => brassGame.validate(s, player, a) === null);
      if (!action) throw new Error(`No legal action at step ${step} (${s.era} round ${s.round})`);
      const next = act(brassGame, match, player, action);
      if (!next.ok) throw new Error(next.error);
      match = next.value;
    }
    return { match, turns };
  }

  it.each([2, 3, 4] as const)('plays a %i-player game to the end and replays it exactly', (n) => {
    const { match } = playOut(n, n);
    expect(match.state.phase.kind).toBe('gameOver');
    expect(brassGame.outcome(match.state)!.ranking).toHaveLength(n);
    expect(replay(brassGame, match.config, match.seed, match.log)).toEqual({ ok: true, value: match });
  });

  it.each([2, 3, 4] as const)(
    'gives every %i-player era the printed number of rounds, with every player taking each turn',
    (n) => {
      // Scouting discards 3 and returns 2 Wild cards, so hands never run out early.
      for (const seed of [11, 12, 13]) {
        const { turns } = playOut(n, seed);
        const expected = Object.fromEntries(
          (['canal', 'rail'] as const).flatMap((era) =>
            Array.from({ length: ROUNDS_PER_ERA[n] }, (_, i) => [`${era} ${i + 1}`, n]),
          ),
        );
        expect(turns).toEqual(expected);
      }
    },
  );
});
