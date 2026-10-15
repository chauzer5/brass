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
  /** Selling: a tapped tile waiting for the player to tap which Merchant to sell it to. */
  pendingSale: { location: brass.LocationId; slot: number } | null;
  scoutCards: brass.CardId[];
  /** Chosen coal/iron/beer sources, by need id (see sources.ts); the rest are automatic. */
  picks: Record<string, string>;
  /** The need the map is picking a source for, when there's more than one choice. */
  activeNeed: string | null;
}

export const EMPTY_DRAFT: Draft = {
  kind: null,
  card: null,
  industry: null,
  slot: null,
  links: [],
  industries: [],
  sales: [],
  pendingSale: null,
  scoutCards: [],
  picks: {},
  activeNeed: null,
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

/**
 * Hand cards that can be used for the action being put together. Building on
 * a space chosen before the card: the cards that can build there.
 */
export function usableCards(cards: Cards, hand: readonly brass.CardId[], legal: readonly brass.BrassAction[], d: Draft) {
  if (!d.kind) return new Set<brass.CardId>();
  if (d.kind === 'scout') return new Set(legal.some((a) => a.type === 'scout') ? hand : []);
  let moves = withCard(cards, legal, d.kind, null);
  if (d.kind === 'build' && d.slot) {
    const key = brass.slotKey(d.slot.location, d.slot.slot);
    moves = moves.filter((a) => a.type === 'build' && brass.slotKey(a.location, a.slot) === key);
  }
  const sigs = new Set(moves.map((a) => sig(cards, (a as { card: string }).card)));
  return new Set(hand.filter((id) => sigs.has(sig(cards, id))));
}

/** Legal builds with the chosen card, or with any card while none is chosen (the space can be picked first). */
function buildMoves(cards: Cards, legal: readonly brass.BrassAction[], d: Draft) {
  if (d.kind !== 'build') return [];
  return withCard(cards, legal, 'build', d.card).map((a) => a as Extract<brass.BrassAction, { type: 'build' }>);
}

/** Every space the chosen card (or, with none chosen yet, any card) can build on, with any industry. */
export function buildSlots(cards: Cards, legal: readonly brass.BrassAction[], d: Draft): brass.SlotKey[] {
  return [...new Set(buildMoves(cards, legal, d).map((a) => brass.slotKey(a.location, a.slot)))];
}

/** Industries that can be built on one space with the chosen card. */
export function buildIndustriesAt(cards: Cards, legal: readonly brass.BrassAction[], d: Draft, key: brass.SlotKey): brass.Industry[] {
  const set = new Set(
    buildMoves(cards, legal, d)
      .filter((a) => brass.slotKey(a.location, a.slot) === key)
      .map((a) => a.industry),
  );
  return brass.INDUSTRIES.filter((i) => set.has(i));
}

/**
 * Chooses the space to build on (tapping it again takes it back). If only one
 * industry can go there it is chosen too; otherwise the player picks between
 * them next.
 */
export function chooseBuildSlot(
  cards: Cards,
  legal: readonly brass.BrassAction[],
  d: Draft,
  location: brass.LocationId,
  slot: number,
): Draft {
  if (d.slot?.location === location && d.slot.slot === slot) return { ...d, slot: null, industry: null, picks: {}, activeNeed: null };
  const options = buildIndustriesAt(cards, legal, d, brass.slotKey(location, slot));
  if (options.length === 0) return d;
  const industry = options.length === 1 ? options[0]! : d.industry && options.includes(d.industry) ? d.industry : null;
  return { ...d, slot: { location, slot }, industry, picks: {}, activeNeed: null };
}

/**
 * Chooses the card to build with. A space already chosen is kept if the card
 * can build there (it always can when the space came first); tapping the
 * chosen card again puts it back and keeps the space.
 */
export function chooseBuildCard(cards: Cards, legal: readonly brass.BrassAction[], d: Draft, card: brass.CardId): Draft {
  const next: Draft = { ...d, card: d.card === card ? null : card, picks: {}, activeNeed: null };
  if (!d.slot) return next;
  const options = buildIndustriesAt(cards, legal, next, brass.slotKey(d.slot.location, d.slot.slot));
  if (options.length === 0) return { ...next, slot: null, industry: null };
  const industry = options.length === 1 ? options[0]! : d.industry && options.includes(d.industry) ? d.industry : null;
  return { ...next, industry };
}

/**
 * Links that can be placed next: the first link, or the second rail link. Any
 * card can be used to network, so they're offered before a card is chosen too.
 */
export function networkLinks(cards: Cards, legal: readonly brass.BrassAction[], d: Draft): string[] {
  if (d.kind !== 'network') return [];
  const moves = withCard(cards, legal, 'network', d.card).map((a) => a as Extract<brass.BrassAction, { type: 'network' }>);
  const firsts = [...new Set(moves.map((a) => a.links[0]!))];
  if (d.links.length === 0) return firsts;
  if (d.links.length === 1) {
    const seconds = [...new Set(moves.filter((a) => a.links.length === 2 && a.links[0] === d.links[0]).map((a) => a.links[1]!))];
    // No second link possible (always so in the Canal Era): the other lines stay lit, and tapping one swaps the choice.
    return seconds.length > 0 ? seconds : firsts.filter((l) => l !== d.links[0]);
  }
  return [];
}

/** Whether `networkLinks` is offering second links (rather than swaps for the first). */
export function offersSecondLink(cards: Cards, legal: readonly brass.BrassAction[], d: Draft): boolean {
  if (d.kind !== 'network' || d.links.length !== 1) return false;
  return withCard(cards, legal, 'network', d.card).some((a) => a.type === 'network' && a.links.length === 2 && a.links[0] === d.links[0]);
}

/** Tapping a line on the map while networking: unpick a chosen link, add a second, or swap the first. */
export function tapLink(cards: Cards, legal: readonly brass.BrassAction[], d: Draft, id: string): Draft {
  const i = d.links.indexOf(id);
  if (i >= 0) return { ...d, links: d.links.slice(0, i) };
  if (offersSecondLink(cards, legal, d)) return { ...d, links: [...d.links, id] };
  return { ...d, links: [id] };
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

/**
 * Tiles that can be sold, with the Merchants each can be sold to. Any card
 * can sell, so they're offered before a card is chosen too.
 */
export function sellOptions(cards: Cards, legal: readonly brass.BrassAction[], d: Draft): Map<brass.SlotKey, number[]> {
  const out = new Map<brass.SlotKey, number[]>();
  if (d.kind !== 'sell') return out;
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
  /** Tiles that can supply the coal, iron or beer being chosen, and the one chosen. */
  sources?: Set<brass.SlotKey>;
  selectedSource?: brass.SlotKey | null;
  /** The market, when it can supply the cube being chosen; `selected` when it's the choice. */
  market?: { kind: 'coal' | 'iron'; selected: boolean } | null;
  /** Merchants to tap: to sell a tile to, or for their beer; and the chosen one. */
  merchants?: Set<brass.LocationId>;
  selectedMerchant?: brass.LocationId | null;
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
