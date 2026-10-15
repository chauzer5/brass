import { describe, expect, it } from 'vitest';
import { createMatch, replay } from '../../src/index.ts';
import { BIRMINGHAM_COMPONENTS, brassGame, type BrassConfig } from '../../src/brass/index.ts';

const config: BrassConfig = {
  playerCount: 2,
  components: BIRMINGHAM_COMPONENTS,
  preset: {
    firstPlayer: 1,
    hands: [[{ location: 'worcester' }, { industries: ['iron'] }], [{ location: 'coalbrookdale' }]],
    merchants: { gloucester: [['cotton'], []], oxford: [['cotton', 'manufacturer', 'pottery'], []] },
  },
};

describe('setup presets', () => {
  it('deals the chosen cards, sets who goes first and places the chosen Merchant tiles', () => {
    for (const seed of [1, 2, 3, 99]) {
      const { state } = createMatch(brassGame, config, seed);
      const kinds = (p: number) => state.players[p]!.hand.map((id) => state.cards[id]!);
      expect(kinds(0).some((c) => c.kind === 'location' && c.location === 'worcester')).toBe(true);
      expect(kinds(0).some((c) => c.kind === 'industry' && c.industries.join() === 'iron')).toBe(true);
      expect(kinds(1).some((c) => c.kind === 'location' && c.location === 'coalbrookdale')).toBe(true);
      expect(state.players.every((p) => p.hand.length === 8)).toBe(true);
      expect(state.turnOrder).toEqual([1, 0]);
      const at = (m: string) => state.merchants.filter((x) => x.location === m).map((x) => x.tile?.industries.join('+'));
      expect(at('gloucester')).toEqual(['cotton', '']);
      expect(at('oxford')).toEqual(['cotton+manufacturer+pottery', '']);
      // Every card is still dealt exactly once.
      const all = [...state.deck, ...state.players.flatMap((p) => [...p.hand, p.faceDownDiscard!])];
      expect(new Set(all).size).toBe(all.length);
    }
  });

  it('is deterministic, so a preset game replays from its seed and log', () => {
    const a = createMatch(brassGame, config, 42);
    const b = replay(brassGame, config, 42, []);
    expect(b.ok && JSON.stringify(b.value.state)).toBe(JSON.stringify(a.state));
  });
});
