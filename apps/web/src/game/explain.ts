import { brass } from '@brass/engine';
import { INDUSTRY_NAME } from './labels.ts';

/** The engine names industries by id ("manufacturer"); swap in their proper names where a sentence means the industry. */
function prettify(reason: string): string {
  return reason
    .replace(/the (\w+) icon/g, (m, id: string) => (id in INDUSTRY_NAME ? `the ${INDUSTRY_NAME[id as brass.Industry]} icon` : m))
    .replace(/no (\w+) tiles left/g, (m, id: string) => (id in INDUSTRY_NAME ? `no ${INDUSTRY_NAME[id as brass.Industry]} tiles left` : m))
    .replace(/doesn't build (\w+)$/, (m, id: string) => {
      if (!(id in INDUSTRY_NAME)) return m;
      const name = INDUSTRY_NAME[id as brass.Industry];
      return `can't build ${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name}`;
    });
}

/** Reasons that only say the chosen card is for something else. */
const aboutTheCard = (reason: string) => reason.startsWith('That card') || reason.startsWith('A Wild Location card');

/**
 * Why the player can't build on a space with the chosen card, in plain words,
 * straight from the rules engine; null if they can. For a space that takes
 * two industries, a reason that's only "your card is for the other one" is
 * dropped in favour of the reason that actually stops the build.
 */
export function explainBuild(
  state: brass.BrassState,
  player: number,
  card: brass.CardId,
  location: brass.LocationId,
  slot: number,
): string | null {
  const loc = brass.LOCATION_BY_ID[location];
  if (loc.kind === 'merchant') return null;
  const reasons = loc.slots[slot]!.map((industry) => ({
    industry,
    reason: brass.brassGame.validate(state, player, { type: 'build', card, industry, location, slot }),
  }));
  if (reasons.some((r) => r.reason === null)) return null;
  const blocking = reasons.filter((r) => !aboutTheCard(r.reason!));
  const shown = blocking.length > 0 ? blocking : reasons.slice(0, 1);
  const unique = [...new Map(shown.map((r) => [prettify(r.reason!), r.industry])).entries()];
  if (unique.length === 1) return unique[0]![0];
  return unique.map(([reason, industry]) => `${INDUSTRY_NAME[industry]}: ${reason}`).join('\n');
}

/**
 * Why the player can't build on a space with any card in their hand: the
 * first reason that isn't just about a card (not in your network, no coal…),
 * else that no card fits.
 */
export function explainBuildAny(
  state: brass.BrassState,
  player: number,
  hand: readonly brass.CardId[],
  location: brass.LocationId,
  slot: number,
): string | null {
  if (brass.LOCATION_BY_ID[location].kind === 'merchant') return null;
  const seen = new Set<string>();
  const reasons: string[] = [];
  for (const card of hand) {
    const def = state.cards[card];
    const key = def ? brass.cardSignature(def) : card;
    if (seen.has(key)) continue;
    seen.add(key);
    const reason = explainBuild(state, player, card, location, slot);
    if (reason === null) return null;
    reasons.push(reason);
  }
  return reasons.find((r) => !aboutTheCard(r)) ?? 'None of your cards can build here.';
}
