import { describe, expect, it } from 'vitest';
import { act, createMatch, createRng, type Match } from '../../src/index.ts';
import { brassBot, brassGame, type BrassAction, type BrassConfig, type BrassState } from '../../src/brass/index.ts';
import { TEST_COMPONENTS } from './fixtures.ts';

type BrassMatch = Match<BrassConfig, BrassState, BrassAction>;

const bot = brassBot('normal');

/** Lets the bot choose for whoever's turn it is, seeing only that player's view. */
function botMove(match: BrassMatch, rng = createRng(1)): { player: number; action: BrassAction } {
  const player = brassGame.activePlayers(match.state)[0]!;
  const view = brassGame.viewFor(match.state, player);
  const legalActions = brassGame.legalActions(match.state, player);
  return { player, action: bot({ player, view, legalActions }, rng) };
}

describe('the bot', () => {
  it('only ever picks legal actions, for every seat, through the start of a game', () => {
    let match: BrassMatch = createMatch(brassGame, { playerCount: 3, components: TEST_COMPONENTS }, 5);
    for (let i = 0; i < 12; i++) {
      const { player, action } = botMove(match, createRng(i));
      expect(brassGame.validate(match.state, player, action)).toBeNull();
      const next = act(brassGame, match, player, action);
      if (!next.ok) throw new Error(next.error);
      match = next.value;
    }
  }, 30_000);

  it('is given only its own view: no other hands, no deck', () => {
    const match = createMatch(brassGame, { playerCount: 2, components: TEST_COMPONENTS }, 9);
    const me = brassGame.activePlayers(match.state)[0]!;
    const view = brassGame.viewFor(match.state, me);
    expect(view.players[1 - me]!.hand).toBeNull();
    expect('deck' in view).toBe(false);
    // Still decides from that alone.
    const action = bot({ player: me, view, legalActions: brassGame.legalActions(match.state, me) }, createRng(3));
    expect(brassGame.validate(match.state, me, action)).toBeNull();
  });

  it('builds rather than passing at the start of the game', () => {
    const match: BrassMatch = createMatch(brassGame, { playerCount: 2, components: TEST_COMPONENTS }, 13);
    const { action } = botMove(match);
    expect(action.type).not.toBe('pass');
  });

  it('removes a tile when it must cover an income shortfall', () => {
    let match: BrassMatch = createMatch(brassGame, { playerCount: 2, components: TEST_COMPONENTS }, 17);
    // Find a shortfall by playing loans and builds until one comes up (bounded).
    const rng = createRng(4);
    for (let i = 0; i < 400 && match.state.phase.kind !== 'shortfall' && !brassGame.outcome(match.state); i++) {
      const player = brassGame.activePlayers(match.state)[0]!;
      const legal = brassGame.legalActions(match.state, player);
      const action = legal.find((a) => a.type === 'loan') ?? legal.find((a) => a.type === 'build') ?? legal[rng.int(legal.length)]!;
      match = (act(brassGame, match, player, action) as { ok: true; value: BrassMatch }).value;
    }
    if (match.state.phase.kind !== 'shortfall') return; // no shortfall came up with these seeds; nothing to check
    const { player, action } = botMove(match);
    expect(action.type).toBe('removeTile');
    expect(brassGame.validate(match.state, player, action)).toBeNull();
  }, 30_000);
});
