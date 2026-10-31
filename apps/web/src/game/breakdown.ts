import { act, createMatch, type Match } from '@brass/engine';
import { brass } from '@brass/engine';

/*
 * The end-of-game breakdown: how each player's points, income and money went
 * round by round, where their points came from, and what they did. Worked out
 * by replaying the game's moves from its seed.
 */

type BrassMatch = Match<brass.BrassConfig, brass.BrassState, brass.BrassAction>;

/** Where everyone stood at one point in the game. */
export interface Checkpoint {
  /** "Start", "C3" (Canal Era, after round 3), "R10". */
  label: string;
  era: brass.Era;
  /** The round just finished (0: the start). */
  round: number;
  vp: number[];
  income: number[];
  money: number[];
}

/** One player's points, by where they came from. */
export interface PointSources {
  canalLinks: number;
  canalTiles: number;
  railLinks: number;
  railTiles: number;
  /** Tile points by industry, both eras together (only when the game recorded it). */
  tilesByIndustry: Partial<Record<brass.Industry, number>> | null;
  /** Merchant beer bonuses. */
  merchants: number;
  /** Lost to income shortfalls (zero or less). */
  shortfalls: number;
  total: number;
}

export interface MoveCounts {
  builds: number;
  links: number;
  sold: number;
  developed: number;
  loans: number;
  scouts: number;
  passes: number;
}

export interface Breakdown {
  checkpoints: Checkpoint[];
  sources: PointSources[];
  moves: MoveCounts[];
}

const snapshot = (s: brass.BrassState, label: string, round: number): Checkpoint => ({
  label,
  era: s.era,
  round,
  vp: s.players.map((p) => p.vp),
  income: s.players.map((p) => brass.incomeLevel(p.incomeSpace)),
  money: s.players.map((p) => p.money),
});

export function breakdown(match: BrassMatch): Breakdown {
  let m: BrassMatch = createMatch(brass.brassGame, match.config, match.seed);
  const n = m.state.players.length;
  const checkpoints: Checkpoint[] = [snapshot(m.state, 'Start', 0)];
  const merchants = Array<number>(n).fill(0);
  const shortfalls = Array<number>(n).fill(0);
  const moves: MoveCounts[] = Array.from({ length: n }, () => ({ builds: 0, links: 0, sold: 0, developed: 0, loans: 0, scouts: 0, passes: 0 }));

  for (const entry of match.log) {
    const prev = m.state;
    const r = act(brass.brassGame, m, entry.player, entry.action);
    if (!r.ok) break;
    m = r.value;
    const next = m.state;

    const a = entry.action;
    const c = moves[entry.player]!;
    if (a.type === 'build') c.builds++;
    else if (a.type === 'network') c.links += a.links.length;
    else if (a.type === 'sell') c.sold += a.sales.length;
    else if (a.type === 'develop') c.developed += a.industries.length;
    else if (a.type === 'loan') c.loans++;
    else if (a.type === 'scout') c.scouts++;
    else if (a.type === 'pass') c.passes++;

    // Points that didn't come from an era's scoring: Merchant bonuses (up) and income shortfalls (down).
    const scored = next.eraScores.slice(prev.eraScores.length);
    for (let id = 0; id < n; id++) {
      const fromScoring = scored.reduce((sum, e) => sum + e.players[id]!.after - e.players[id]!.before, 0);
      const other = next.players[id]!.vp - prev.players[id]!.vp - fromScoring;
      if (other > 0) merchants[id]! += other;
      else shortfalls[id]! += other;
    }

    // A round (or the game) ended: where everyone stands.
    const ended = next.round !== prev.round || next.era !== prev.era || (!!brass.brassGame.outcome(next) && !brass.brassGame.outcome(prev));
    if (ended) {
      const label = `${prev.era === 'canal' ? 'C' : 'R'}${prev.round}`;
      checkpoints.push({ ...snapshot(next, label, prev.round), era: prev.era });
    }
  }

  const final = m.state;
  const sources = final.players.map((p, id): PointSources => {
    const era = (e: brass.Era) => final.eraScores.find((s) => s.era === e)?.players[id];
    const canal = era('canal');
    const rail = era('rail');
    const byIndustry = final.eraScores.every((e) => e.players[id]!.tileVPByIndustry)
      ? final.eraScores.reduce<Partial<Record<brass.Industry, number>>>((acc, e) => {
          for (const [ind, vp] of Object.entries(e.players[id]!.tileVPByIndustry!) as [brass.Industry, number][]) acc[ind] = (acc[ind] ?? 0) + vp;
          return acc;
        }, {})
      : null;
    return {
      canalLinks: canal?.linkVP ?? 0,
      canalTiles: canal?.tileVP ?? 0,
      railLinks: rail?.linkVP ?? 0,
      railTiles: rail?.tileVP ?? 0,
      tilesByIndustry: byIndustry,
      merchants: merchants[id]!,
      shortfalls: shortfalls[id]!,
      total: p.vp,
    };
  });
  return { checkpoints, sources, moves };
}
