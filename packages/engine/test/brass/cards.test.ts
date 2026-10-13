import { describe, expect, it } from 'vitest';
import {
  BIRMINGHAM_CARDS,
  HAND_SIZE,
  LOCATION_CARD_MIN_PLAYERS,
  ROUNDS_PER_ERA,
  TOWNS,
  type PlayerCount,
} from '../../src/brass/index.ts';

const deckFor = (n: PlayerCount) => BIRMINGHAM_CARDS.filter((c) => c.minPlayers <= n);

describe('Birmingham cards (Card Distribution player aid)', () => {
  it('has 64 cards in total (rulebook p.1)', () => {
    expect(BIRMINGHAM_CARDS).toHaveLength(64);
  });

  it.each([
    [2, 40],
    [3, 54],
    [4, 64],
  ] as const)('has %i-player deck of %i cards', (n, size) => {
    expect(deckFor(n)).toHaveLength(size);
  });

  it.each([2, 3, 4] as const)('gives the printed number of rounds per era with %i players', (n) => {
    const perPlayer = deckFor(n).length / n;
    // Canal Era: 1 face-down discard, 1 action in round 1, then 2 per round.
    expect(1 + 1 + 2 * (ROUNDS_PER_ERA[n] - 1)).toBe(perPlayer);
    // Rail Era: every card is reshuffled; 2 actions every round.
    expect(2 * ROUNDS_PER_ERA[n]).toBe(perPlayer);
    expect(perPlayer).toBeGreaterThanOrEqual(HAND_SIZE);
  });

  it('agrees with the banner colours: no blue/teal with 2 players, no teal with 3 (rulebook p.4)', () => {
    for (const card of BIRMINGHAM_CARDS) {
      if (card.kind !== 'location') continue;
      const color = TOWNS.find((t) => t.id === card.location)!.color;
      expect(card.minPlayers, card.location).toBeGreaterThanOrEqual(LOCATION_CARD_MIN_PLAYERS[color]);
    }
  });
});
