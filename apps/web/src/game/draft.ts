import { brass } from '@brass/engine';

/*
 * The action a player is putting together, one tap at a time. Legal moves
 * from the engine decide what can be tapped; the finished action is checked
 * with the engine's `validate` before it can be confirmed.
 */

export type ActionKind = 'build' | 'network' | 'develop' | 'sell' | 'loan' | 'scout' | 'pass';

export const ACTION_KINDS: readonly ActionKind[] = ['build', 'network', 'develop', 'sell', 'loan', 'scout', 'pass'];

export interface Draft {
  kind: ActionKind | null;
  card: brass.CardId | null;
  industry: brass.Industry | null;
  slot: { location: brass.LocationId; slot: number } | null;
  links: string[];
  industries: brass.Industry[];
  sales: brass.Sale[];
  scoutCards: brass.CardId[];
}

export const EMPTY_DRAFT: Draft = {
  kind: null,
  card: null,
  industry: null,
  slot: null,
  links: [],
  industries: [],
  sales: [],
  scoutCards: [],
};

type Cards = Record<brass.CardId, brass.Card>;

const sig = (cards: Cards, id: brass.CardId) => (cards[id] ? brass.cardSignature(cards[id]) : id);

/** Legal moves of this kind usable with the chosen card (or an identical one). */
function withCard(cards: Cards, legal: readonly brass.BrassAction[], kind: ActionKind, card: brass.CardId | null) {
  return legal.filter((a) => a.type === kind && 'card' in a && (card === null || sig(cards, a.card) === sig(cards, card)));
}

export function availableKinds(legal: readonly brass.BrassAction[]): Set<ActionKind> {
  return new Set(legal.map((a) => a.type).filter((t): t is ActionKind => t !== 'removeTile'));
}

/** Hand cards that can be used for an action of this kind. */
export function usableCards(cards: Cards, hand: readonly brass.CardId[], legal: readonly brass.BrassAction[], kind: ActionKind) {
  if (kind === 'scout') return new Set(legal.some((a) => a.type === 'scout') ? hand : []);
  const sigs = new Set(withCard(cards, legal, kind, null).map((a) => sig(cards, (a as { card: string }).card)));
  return new Set(hand.filter((id) => sigs.has(sig(cards, id))));
}

export function buildIndustries(cards: Cards, legal: readonly brass.BrassAction[], card: brass.CardId): brass.Industry[] {
  const set = new Set(
    withCard(cards, legal, 'build', card).map((a) => (a as Extract<brass.BrassAction, { type: 'build' }>).industry),
  );
  return brass.INDUSTRIES.filter((i) => set.has(i));
}

export function buildSlots(cards: Cards, legal: readonly brass.BrassAction[], d: Draft): brass.SlotKey[] {
  if (d.kind !== 'build' || !d.card || !d.industry) return [];
  return withCard(cards, legal, 'build', d.card)
    .map((a) => a as Extract<brass.BrassAction, { type: 'build' }>)
    .filter((a) => a.industry === d.industry)
    .map((a) => brass.slotKey(a.location, a.slot));
}

/** Links that can be placed next: the first link, or the second rail link. */
export function networkLinks(cards: Cards, legal: readonly brass.BrassAction[], d: Draft): string[] {
  if (d.kind !== 'network' || !d.card) return [];
  const moves = withCard(cards, legal, 'network', d.card).map((a) => a as Extract<brass.BrassAction, { type: 'network' }>);
  if (d.links.length === 0) return [...new Set(moves.map((a) => a.links[0]!))];
  if (d.links.length === 1) {
    return [...new Set(moves.filter((a) => a.links.length === 2 && a.links[0] === d.links[0]).map((a) => a.links[1]!))];
  }
  return [];
}

export function developIndustries(cards: Cards, legal: readonly brass.BrassAction[], d: Draft): brass.Industry[] {
  if (d.kind !== 'develop' || !d.card) return [];
  const moves = withCard(cards, legal, 'develop', d.card).map((a) => a as Extract<brass.BrassAction, { type: 'develop' }>);
  const prefix = d.industries;
  const next = moves
    .filter((a) => a.industries.length === prefix.length + 1 && prefix.every((ind, i) => a.industries[i] === ind))
    .map((a) => a.industries[prefix.length]!);
  // Develop pairs are listed in one order; offer either order.
  const reversed = prefix.length === 1 ? moves.filter((a) => a.industries.length === 2 && a.industries[1] === prefix[0]).map((a) => a.industries[0]!) : [];
  const set = new Set([...next, ...reversed]);
  return brass.INDUSTRIES.filter((i) => set.has(i));
}

/** Tiles that can be sold, with the Merchants each can be sold to. */
export function sellOptions(cards: Cards, legal: readonly brass.BrassAction[], d: Draft): Map<brass.SlotKey, number[]> {
  const out = new Map<brass.SlotKey, number[]>();
  if (d.kind !== 'sell' || !d.card) return out;
  for (const a of withCard(cards, legal, 'sell', d.card)) {
    const sale = (a as Extract<brass.BrassAction, { type: 'sell' }>).sales;
    if (sale.length !== 1) continue;
    const key = brass.slotKey(sale[0]!.location, sale[0]!.slot);
    out.set(key, [...(out.get(key) ?? []), sale[0]!.merchant]);
  }
  return out;
}

/** The complete action described by the draft, if every choice has been made. */
export function compose(d: Draft): brass.BrassAction | null {
  switch (d.kind) {
    case 'build':
      return d.card && d.industry && d.slot ? { type: 'build', card: d.card, industry: d.industry, ...d.slot } : null;
    case 'network':
      return d.card && d.links.length > 0 ? { type: 'network', card: d.card, links: d.links } : null;
    case 'develop':
      return d.card && d.industries.length > 0 ? { type: 'develop', card: d.card, industries: d.industries } : null;
    case 'sell':
      return d.card && d.sales.length > 0 ? { type: 'sell', card: d.card, sales: d.sales } : null;
    case 'loan':
    case 'pass':
      return d.card ? { type: d.kind, card: d.card } : null;
    case 'scout':
      return d.scoutCards.length === 3 ? { type: 'scout', cards: d.scoutCards } : null;
    default:
      return null;
  }
}

export interface Highlights {
  slots: Set<brass.SlotKey>;
  links: Set<string>;
  selectedSlots: Set<brass.SlotKey>;
  selectedLinks: Set<string>;
}

export function highlights(state: brass.BrassView, player: number, legal: readonly brass.BrassAction[], d: Draft): Highlights {
  const cards = state.cards;
  const h: Highlights = { slots: new Set(), links: new Set(), selectedSlots: new Set(), selectedLinks: new Set(d.links) };

  if (state.phase.kind === 'shortfall') {
    for (const a of legal) if (a.type === 'removeTile') h.slots.add(brass.slotKey(a.location, a.slot));
    return h;
  }
  if (d.kind === 'build') {
    buildSlots(cards, legal, d).forEach((k) => h.slots.add(k));
    if (d.slot) h.selectedSlots.add(brass.slotKey(d.slot.location, d.slot.slot));
  }
  if (d.kind === 'network') networkLinks(cards, legal, d).forEach((l) => h.links.add(l));
  if (d.kind === 'sell') {
    for (const k of sellOptions(cards, legal, d).keys()) h.slots.add(k);
    for (const s of d.sales) h.selectedSlots.add(brass.slotKey(s.location, s.slot));
  }
  void player;
  return h;
}
