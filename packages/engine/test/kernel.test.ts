import { describe, expect, it } from 'vitest';
import { act, createMatch, createRng, randomBot, replay, undo, type Match } from '../src/index.ts';
import { highCard, type HighCardAction, type HighCardConfig, type HighCardState, type HighCardView } from './fixtures/highCard.ts';

type HCMatch = Match<HighCardConfig, HighCardState, HighCardAction>;
const config: HighCardConfig = { players: 3, handSize: 4 };

function playOut(seed: number, botSeed: number): HCMatch {
  const bot = randomBot<HighCardView, HighCardAction>();
  const rng = createRng(botSeed);
  let match = createMatch(highCard, config, seed);
  while (!highCard.outcome(match.state)) {
    const player = highCard.activePlayers(match.state)[0]!;
    const action = bot(
      { player, view: highCard.viewFor(match.state, player), legalActions: highCard.legalActions(match.state, player) },
      rng,
    );
    const next = act(highCard, match, player, action);
    if (!next.ok) throw new Error(next.error);
    match = next.value;
  }
  return match;
}

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(Array.from({ length: 5 }, () => b.next()));
  });

  it('resumes from a saved state', () => {
    const a = createRng(7);
    a.next();
    const resumed = createRng(a.state());
    expect(resumed.next()).toBe(a.next());
  });

  it('shuffles without mutating the input', () => {
    const input = [1, 2, 3, 4, 5];
    const out = createRng(1).shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
    expect([...out].sort()).toEqual(input);
  });
});

describe('kernel', () => {
  it('produces the same setup for the same seed', () => {
    expect(createMatch(highCard, config, 123).state).toEqual(createMatch(highCard, config, 123).state);
    expect(createMatch(highCard, config, 123).state).not.toEqual(createMatch(highCard, config, 124).state);
  });

  it('rejects out-of-turn and illegal actions without changing the match', () => {
    const match = createMatch(highCard, config, 1);
    const before = structuredClone(match);
    const card = match.state.hands[1]![0]!;

    expect(act(highCard, match, 1, { type: 'play', card })).toEqual({
      ok: false,
      error: "It is not player 1's turn",
    });
    expect(act(highCard, match, 0, { type: 'play', card }).ok).toBe(false);
    expect(match).toEqual(before);
  });

  it('never mutates the previous match when applying an action', () => {
    const match = createMatch(highCard, config, 1);
    const before = structuredClone(match);
    const card = match.state.hands[0]![0]!;
    const next = act(highCard, match, 0, { type: 'play', card });
    expect(next.ok).toBe(true);
    expect(match).toEqual(before);
  });

  it('replays an action log to the identical match', () => {
    const played = playOut(99, 5);
    const replayed = replay(highCard, played.config, played.seed, played.log);
    expect(replayed).toEqual({ ok: true, value: played });
  });

  it('round-trips through JSON (save/load, network)', () => {
    const played = playOut(3, 4);
    expect(JSON.parse(JSON.stringify(played))).toEqual(played);
  });

  it('undoes by replaying the log', () => {
    const played = playOut(8, 8);
    const undone = undo(highCard, played, 2);
    expect(undone.ok && undone.value.log).toEqual(played.log.slice(0, -2));
  });

  it('refuses actions after the game ends', () => {
    const played = playOut(10, 10);
    expect(highCard.outcome(played.state)).not.toBeNull();
    expect(act(highCard, played, 0, { type: 'play', card: 1 })).toEqual({ ok: false, error: 'The game is over' });
  });

  it('hides other players’ hands in views', () => {
    const match = createMatch(highCard, config, 1);
    const view = highCard.viewFor(match.state, 0);
    expect(view.hand).toEqual(match.state.hands[0]);
    expect(JSON.stringify(view)).not.toContain(JSON.stringify(match.state.hands[1]));
    expect(highCard.viewFor(match.state, null).hand).toBeNull();
  });
});
