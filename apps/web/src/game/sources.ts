import { brass } from '@brass/engine';

/*
 * Where an action's coal, iron and beer come from. The engine picks sources
 * automatically when none are given; when the rules leave a real choice (two
 * Coal Mines equally close, any Iron Works, own or an opponent's beer), the
 * player can pick instead. Every option offered is checked with the engine's
 * own `validate`, so the UI never has to restate the rules.
 */

export type ResourceKind = 'coal' | 'iron' | 'beer';

/** One cube or barrel an action consumes. */
export interface Need {
  /** Stable within an action: "coal0", "iron1", "beer0" (network) or "sale1beer0" (selling). */
  id: string;
  kind: ResourceKind;
  /** Which sale this beer is for, when selling. */
  sale?: number;
  /** Valid sources, in the order the engine would pick automatically; the first is the default. */
  options: string[];
}

/** Sources chosen so far, by need id. Missing = the engine's automatic choice. */
export type Picks = Readonly<Record<string, string>>;

type Action = brass.BrassAction;

const unflipped = (state: brass.BrassState, industry: brass.Industry) =>
  (Object.entries(state.tiles) as [brass.SlotKey, brass.BuiltTile][])
    .filter(([, t]) => t.industry === industry && !t.flipped && t.cubes > 0)
    .map(([k]) => k)
    .sort();

/**
 * Candidate sources in the engine's automatic order, so the first valid one is
 * exactly what it would pick: tiles by key then the market for coal and iron;
 * for beer the Merchant's barrel, then own Breweries, then opponents'.
 */
function candidates(state: brass.BrassState, player: number, kind: ResourceKind, selling: boolean): string[] {
  if (kind === 'coal') return [...unflipped(state, 'coal'), 'market'];
  if (kind === 'iron') return [...unflipped(state, 'iron'), 'market'];
  const breweries = unflipped(state, 'brewery');
  const own = breweries.filter((k) => state.tiles[k]!.owner === player);
  const other = breweries.filter((k) => state.tiles[k]!.owner !== player);
  return [...(selling ? ['merchant'] : []), ...own, ...other];
}

/** Coal, iron and beer the action consumes, in the order the engine consumes them. */
function needsOf(state: brass.BrassState, player: number, a: Action): Omit<Need, 'options'>[] {
  const out: Omit<Need, 'options'>[] = [];
  const add = (kind: ResourceKind, n: number, prefix = '', sale?: number) => {
    for (let i = 0; i < n; i++) out.push({ id: `${prefix}${kind}${i}`, kind, ...(sale !== undefined && { sale }) });
  };
  const me = state.players[player]!;
  switch (a.type) {
    case 'build': {
      const level = brass.lowestLevel(me, a.industry);
      if (level === null) break;
      const def = brass.tileStats(a.industry, level);
      add('coal', def.coal);
      add('iron', def.iron);
      break;
    }
    case 'network':
      if (state.era === 'rail') {
        add('coal', a.links.length);
        if (a.links.length === 2) add('beer', 1);
      }
      break;
    case 'develop':
      add('iron', a.industries.length);
      break;
    case 'sell':
      a.sales.forEach((s, i) => {
        const tile = state.tiles[brass.slotKey(s.location, s.slot)];
        if (tile) add('beer', brass.tileStats(tile.industry, tile.level).beer, `sale${i}`, i);
      });
      break;
  }
  return out;
}

/** The action with the given picks filled in (gaps left to the engine). */
export function withPicks(state: brass.BrassState, player: number, a: Action, picks: Picks): Action {
  const needs = needsOf(state, player, a);
  const list = (kind: ResourceKind, sale?: number) =>
    needs.filter((n) => n.kind === kind && n.sale === sale).map((n) => picks[n.id]) as never;
  const any = (kind: ResourceKind, sale?: number) => needs.some((n) => n.kind === kind && n.sale === sale && picks[n.id] !== undefined);
  switch (a.type) {
    case 'build':
      return { ...a, ...(any('coal') && { coal: list('coal') }), ...(any('iron') && { iron: list('iron') }) };
    case 'network': {
      const beer = picks['beer0'];
      return { ...a, ...(any('coal') && { coal: list('coal') }), ...(beer !== undefined && { beer: beer as brass.BeerSource }) };
    }
    case 'develop':
      return { ...a, ...(any('iron') && { iron: list('iron') }) };
    case 'sell':
      return { ...a, sales: a.sales.map((s, i) => ({ ...s, ...(any('beer', i) && { beer: list('beer', i) }) })) };
    default:
      return a;
  }
}

/**
 * Every cube and barrel the action needs, each with its valid sources given
 * the picks before it. Picks that are no longer valid are ignored.
 */
export function sourceNeeds(state: brass.BrassState, player: number, a: Action, picks: Picks): Need[] {
  const needs = needsOf(state, player, a);
  const settled: Record<string, string> = {};
  return needs.map((need) => {
    const options = candidates(state, player, need.kind, a.type === 'sell').filter(
      (c) => brass.brassGame.validate(state, player, withPicks(state, player, a, { ...settled, [need.id]: c })) === null,
    );
    const pick = picks[need.id];
    if (pick !== undefined && options.includes(pick)) settled[need.id] = pick;
    else if (options[0] !== undefined) settled[need.id] = options[0];
    return { ...need, options };
  });
}

/** The source each need will actually use: the player's pick, or the default. */
export function chosenSource(need: Need, picks: Picks): string | undefined {
  const pick = picks[need.id];
  return pick !== undefined && need.options.includes(pick) ? pick : need.options[0];
}

/** Needs that are a real choice (more than one valid source). */
export const choosable = (needs: readonly Need[]) => needs.filter((n) => n.options.length > 1);

/** Gloucester's bonus (rulebook p.10): develop one tile when its beer is used. Which industries could be developed? */
export function gloucesterOptions(state: brass.BrassState, player: number, a: Extract<Action, { type: 'sell' }>, sale: number): brass.Industry[] {
  return brass.INDUSTRIES.filter(
    (industry) =>
      brass.brassGame.validate(state, player, { ...a, sales: a.sales.map((s, i) => (i === sale ? { ...s, develop: industry } : s)) }) === null,
  );
}
