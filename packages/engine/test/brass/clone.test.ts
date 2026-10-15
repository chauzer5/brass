import { describe, expect, it } from 'vitest';
import { act, createMatch, createRng, randomBot, type Match } from '../../src/index.ts';
import { brassGame, cloneState, type BrassAction, type BrassConfig, type BrassState } from '../../src/brass/index.ts';
import { TEST_COMPONENTS } from './fixtures.ts';

type BrassMatch = Match<BrassConfig, BrassState, BrassAction>;

describe('cloneState', () => {
  it('copies exactly, and no action on the copy changes the original, through whole games', () => {
    const bot = randomBot<unknown, BrassAction>();
    for (const [players, seed] of [[2, 3], [3, 8], [4, 21]] as const) {
      let match: BrassMatch = createMatch(brassGame, { playerCount: players, components: TEST_COMPONENTS }, seed);
      const rng = createRng(seed);
      for (let step = 0; step < 2000 && !brassGame.outcome(match.state); step++) {
        const player = brassGame.activePlayers(match.state)[0]!;
        const legal = brassGame.legalActions(match.state, player);
        const before = JSON.stringify(match.state);
        const copy = cloneState(match.state);
        expect(JSON.stringify(copy)).toBe(before);
        // Every legal action, played on a copy, leaves the original alone.
        for (const a of legal.slice(0, 15)) brassGame.apply(cloneState(match.state), player, a, createRng(step));
        expect(JSON.stringify(match.state)).toBe(before);
        const next = act(brassGame, match, player, bot({ player, view: null, legalActions: legal }, rng));
        if (!next.ok) throw new Error(next.error);
        match = next.value;
      }
      expect(brassGame.outcome(match.state)).toBeTruthy();
    }
  }, 120_000);
});
