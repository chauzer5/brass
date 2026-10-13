import type { PlayerId } from './kernel.ts';
import type { Rng } from './rng.ts';

/**
 * A bot sees exactly what a human in its seat would see (its `View`) plus the
 * list of legal actions, never the full state. That keeps bots honest about
 * hidden information and lets the same bot run client-side or on a server.
 */
export interface BotInput<View, Action> {
  player: PlayerId;
  view: View;
  legalActions: readonly Action[];
}

export type Bot<View, Action> = (input: BotInput<View, Action>, rng: Rng) => Action;

/** Baseline opponent: picks uniformly among legal actions. */
export function randomBot<View, Action>(): Bot<View, Action> {
  return ({ legalActions }, rng) => {
    if (legalActions.length === 0) {
      throw new Error('randomBot was asked to act with no legal actions');
    }
    return legalActions[rng.int(legalActions.length)]!;
  };
}
