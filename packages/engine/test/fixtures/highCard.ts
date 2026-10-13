import type { GameDefinition, PlayerId } from '../../src/index.ts';

/**
 * A tiny hidden-information game used only to exercise the kernel: each
 * player is dealt cards from a shuffled deck and takes turns playing one;
 * highest total wins. Hands are private.
 */
export interface HighCardConfig {
  players: number;
  handSize: number;
}

export interface HighCardState {
  deck: number[];
  hands: number[][];
  scores: number[];
  turn: PlayerId;
}

export type HighCardAction = { type: 'play'; card: number };

export interface HighCardView {
  you: PlayerId | null;
  hand: number[] | null;
  handSizes: number[];
  deckSize: number;
  scores: number[];
  turn: PlayerId;
}

const finished = (s: HighCardState) => s.hands.every((h) => h.length === 0);

export const highCard: GameDefinition<HighCardConfig, HighCardState, HighCardAction, HighCardView> = {
  name: 'high-card',

  setup({ players, handSize }, rng) {
    const deck = rng.shuffle(Array.from({ length: 20 }, (_, i) => i + 1));
    const hands = Array.from({ length: players }, () => deck.splice(0, handSize));
    return { deck, hands, scores: Array<number>(players).fill(0), turn: 0 };
  },

  activePlayers: (s) => (finished(s) ? [] : [s.turn]),

  legalActions: (s, p) => (s.hands[p] ?? []).map((card) => ({ type: 'play', card })),

  validate(s, p, a) {
    return s.hands[p]?.includes(a.card) ? null : `Card ${a.card} is not in your hand`;
  },

  apply(s, p, a) {
    const hand = s.hands[p]!;
    hand.splice(hand.indexOf(a.card), 1);
    s.scores[p]! += a.card;
    s.turn = (p + 1) % s.hands.length;
    return s;
  },

  viewFor: (s, p) => ({
    you: p,
    hand: p === null ? null : [...s.hands[p]!],
    handSizes: s.hands.map((h) => h.length),
    deckSize: s.deck.length,
    scores: [...s.scores],
    turn: s.turn,
  }),

  outcome(s) {
    if (!finished(s)) return null;
    const sorted = s.scores.map((score, player) => ({ player, score })).sort((a, b) => b.score - a.score);
    return {
      ranking: sorted.map((r) => ({ ...r, rank: 1 + sorted.findIndex((o) => o.score === r.score) })),
    };
  },
};
