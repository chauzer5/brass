import { act, brass, replay, type Match } from '@brass/engine';
import { INDUSTRY_NAME, linkName, locationName, roman } from './labels.ts';

type BrassMatch = Match<brass.BrassConfig, brass.BrassState, brass.BrassAction>;

/** One thing another player did, in words, with where it happened on the map. */
export interface RecapItem {
  player: number;
  text: string;
  /** Spaces built on or sold from, to point out on the map. */
  slots: brass.SlotKey[];
  links: string[];
}

const join = (parts: string[]) => (parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`);

/** Describes one action, comparing the state just before and after it. */
function describe(before: brass.BrassState, after: brass.BrassState, player: number, a: brass.BrassAction): RecapItem {
  const item = (text: string, slots: brass.SlotKey[] = [], links: string[] = []): RecapItem => ({ player, text, slots, links });
  switch (a.type) {
    case 'build': {
      const key = brass.slotKey(a.location, a.slot);
      const level = brass.lowestLevel(before.players[player]!, a.industry) ?? 1;
      const replaced = before.tiles[key];
      let text = `${replaced ? 'overbuilt with' : 'built'} ${INDUSTRY_NAME[a.industry]} ${roman(level)} in ${locationName(a.location)}`;
      // A new Coal Mine or Iron Works may sell straight to its market.
      if (a.industry === 'coal' || a.industry === 'iron') {
        const field = a.industry === 'coal' ? 'coalMarket' : 'ironMarket';
        const sold = after[field] - before[field];
        if (sold > 0) text += ` and sold ${sold} ${a.industry} to the market`;
      }
      return item(text, [key]);
    }
    case 'network': {
      const kind = before.era === 'canal' ? 'canal' : a.links.length > 1 ? 'rail links' : 'rail link';
      return item(`built ${before.era === 'canal' ? 'a canal' : kind} ${join(a.links.map(linkName))}`, [], a.links);
    }
    case 'develop':
      return item(`developed ${join(a.industries.map((ind) => INDUSTRY_NAME[ind]))}`);
    case 'sell': {
      const parts = a.sales.map((s) => {
        const tile = before.tiles[brass.slotKey(s.location, s.slot)];
        const what = tile ? `${INDUSTRY_NAME[tile.industry]} ${roman(tile.level)}` : 'a tile';
        return `${what} in ${locationName(s.location)} to ${locationName(before.merchants[s.merchant]!.location)}`;
      });
      return item(`sold ${join(parts)}`, a.sales.map((s) => brass.slotKey(s.location, s.slot)));
    }
    case 'loan':
      return item(`took a loan (+£${brass.LOAN_AMOUNT})`);
    case 'scout':
      return item('scouted for Wild cards');
    case 'pass':
      return item('passed');
    case 'removeTile':
      return item(`removed a tile in ${locationName(a.location)} to cover their income`);
  }
}

/**
 * What the other players did since `viewer` last acted (or since the start, on
 * their first turn), oldest first. Replays the log once from that point.
 */
export function recapSince(match: BrassMatch, viewer: number): RecapItem[] {
  const log = match.log;
  let start = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i]!.player === viewer) {
      start = i + 1;
      break;
    }
  }
  if (start >= log.length) return [];
  const prefix = replay(brass.brassGame, match.config, match.seed, log.slice(0, start));
  if (!prefix.ok) return [];
  let m = prefix.value;
  const out: RecapItem[] = [];
  for (const entry of log.slice(start)) {
    const next = act(brass.brassGame, m, entry.player, entry.action);
    if (!next.ok) break;
    if (entry.player !== viewer) out.push(describe(m.state, next.value.state, entry.player, entry.action));
    m = next.value;
  }
  return out;
}
