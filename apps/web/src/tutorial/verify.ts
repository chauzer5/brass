// Plays the tutorial script through the engine: every step's move must be legal, on the right player's turn.
// Run: node --experimental-strip-types --no-warnings apps/web/src/tutorial/verify.ts
import { act, brass, createMatch, createRng } from '@brass/engine';
import { STEPS, TUTORIAL_SEED, TUTOR, YOU, tutorialConfig } from './script.ts';

let m = createMatch(brass.brassGame, tutorialConfig(), TUTORIAL_SEED);
const say = (...x: unknown[]) => console.log(...x);
const who = () => brass.currentPlayer(m.state);
const name = (c: string) => JSON.stringify(m.state.cards[c]);
say('your hand:', m.state.players[YOU]!.hand.map(name).join(' '));
say('tutor hand:', m.state.players[TUTOR]!.hand.map(name).join(' '));
say('merchants:', m.state.merchants.map((x) => `${x.location}:${x.tile?.industries.join('+') ?? '-'}${x.beer ? '(beer)' : ''}`).join(' '));
const play = (p: number, a: brass.BrassAction) => {
  const r = act(brass.brassGame, m, p, a);
  if (!r.ok) throw new Error(r.error);
  m = r.value;
};
const tiles = () =>
  Object.entries(m.state.tiles)
    .map(([k, t]) => `${k}:P${t!.owner}${t!.industry[0]}${t!.level}${t!.flipped ? 'F' : ''}${t!.cubes ? '×' + t!.cubes : ''}`)
    .join(' ');
const status = () =>
  m.state.players.map((p, i) => `P${i} £${p.money} inc ${brass.incomeLevel(p.incomeSpace)} vp ${p.vp}`).join(' | ') +
  ` | ${m.state.era} r${m.state.round} next P${who()} | coal mkt ${m.state.coalMarket} iron mkt ${m.state.ironMarket} | ${tiles()}`;
for (const [i, step] of STEPS.entries()) {
  if (step.kind === 'do') {
    if (who() !== YOU) throw new Error(`step ${i} (${step.title}): it's player ${who()}'s turn, not yours`);
    const legal = brass.brassGame.legalActions(m.state, YOU).filter((a) => step.allow(a, m.state) && (!step.require || step.require.match(a, m.state)));
    if (legal.length === 0) throw new Error(`step ${i} (${step.title}): no allowed move`);
    play(YOU, legal[0]!);
    say(`#${i} you: ${step.title} -> ${JSON.stringify(legal[0])} (${legal.length} allowed) :: ${status()}`);
  } else if (step.kind === 'tutor') {
    for (const pick of step.moves) {
      if (who() !== TUTOR) throw new Error(`step ${i} (${step.title}): it's player ${who()}'s turn, not the tutor's`);
      const a = brass.brassGame.legalActions(m.state, TUTOR).find((x) => pick(x, m.state));
      if (!a) throw new Error(`step ${i} (${step.title}): tutor has no matching move`);
      play(TUTOR, a);
      say(`#${i} tutor: ${JSON.stringify(a)} :: ${status()}`);
    }
  } else if (step.kind === 'fastForward') {
    const bot = brass.brassBot('normal');
    const rng = createRng(5);
    const eras = m.state.eraScores.length;
    while (m.state.eraScores.length === eras) {
      const p = who()!;
      play(p, bot({ player: p, view: brass.brassGame.viewFor(m.state, p), legalActions: brass.brassGame.legalActions(m.state, p) }, rng));
    }
    say(`#${i} fast-forward done :: ${status()}`, JSON.stringify(m.state.eraScores[0]));
  } else say(`#${i} ${step.kind}: ${step.title}`);
}
say('ok');
