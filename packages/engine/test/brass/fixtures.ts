import { createRng } from '../../src/index.ts';
import {
  LOCATION_CARD_MIN_PLAYERS,
  TOWNS,
  setup,
  type BrassState,
  type CardId,
  type CardSpec,
  type Components,
  type PlayerCount,
  type TownId,
} from '../../src/brass/index.ts';

/**
 * STAND-IN components for tests only. The real card list and Merchant tiles
 * aren't in the rulebook yet; these just have the right shape and the right
 * number of Merchant tiles per player count (5 / 7 / 9).
 */
export const TEST_COMPONENTS: Components = {
  cards: [
    ...TOWNS.flatMap((t): CardSpec[] => [
      { kind: 'location', location: t.id, minPlayers: LOCATION_CARD_MIN_PLAYERS[t.color] },
      { kind: 'location', location: t.id, minPlayers: LOCATION_CARD_MIN_PLAYERS[t.color] },
    ]),
    ...(['cotton', 'manufacturer', 'pottery', 'coal', 'iron', 'brewery'] as const).flatMap((ind): CardSpec[] =>
      [2, 3, 4].map((n) => ({ kind: 'industry', industries: [ind], minPlayers: n as PlayerCount })),
    ),
  ],
  merchantTiles: [
    { industries: ['cotton'], minPlayers: 2 },
    { industries: ['manufacturer'], minPlayers: 2 },
    { industries: ['pottery'], minPlayers: 2 },
    { industries: ['cotton', 'manufacturer', 'pottery'], minPlayers: 2 },
    { industries: [], minPlayers: 2 },
    { industries: ['manufacturer'], minPlayers: 3 },
    { industries: ['cotton'], minPlayers: 3 },
    { industries: ['pottery'], minPlayers: 4 },
    { industries: [], minPlayers: 4 },
  ],
};

export function newGame(playerCount: PlayerCount = 2, seed = 1): BrassState {
  return setup({ playerCount, components: TEST_COMPONENTS }, createRng(seed));
}

let extra = 0;

/** Gives a player exactly these cards (replacing their hand) and returns their ids. */
export function giveHand(state: BrassState, player: number, specs: (CardSpec | 'wildLocation' | 'wildIndustry')[]): CardId[] {
  const ids = specs.map((spec) => {
    const id = `t${extra++}`;
    state.cards[id] = typeof spec === 'string' ? { id, kind: spec } : { ...spec, id };
    return id;
  });
  state.players[player]!.hand = ids;
  return ids;
}

/** Makes `player` the one to act, with a fresh turn in a round after the first. */
export function makeTurn(state: BrassState, player: number, era: 'canal' | 'rail' = 'canal'): void {
  state.era = era;
  state.round = 2;
  state.turnOrder = [player, ...state.turnOrder.filter((p) => p !== player)];
  state.turnIndex = 0;
  state.actionsTaken = 0;
}

export const loc = (location: TownId): CardSpec => ({ kind: 'location', location, minPlayers: 2 });
export const ind = (...industries: ('cotton' | 'manufacturer' | 'pottery' | 'coal' | 'iron' | 'brewery')[]): CardSpec => ({
  kind: 'industry',
  industries,
  minPlayers: 2,
});
