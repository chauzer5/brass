import { brass } from '@brass/engine';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  EMPTY_DRAFT,
  buildIndustriesAt,
  buildSlots,
  chooseBuildSlot,
  compose,
  developIndustries,
  networkLinks,
  offersSecondLink,
  sellOptions,
  type Draft,
} from '../game/draft.ts';
import { INDUSTRY_NAME, cardName, linkName, locationName, roman, slotName } from '../game/labels.ts';
import { ACTION_LABEL } from './ActionRail.tsx';
import { ActionIcon, IndustryIcon } from './icons.tsx';
import { IncomeTrack } from './IncomeTrack.tsx';
import type { RecapItem } from '../game/recap.ts';
import { TileStats } from './PlayerMat.tsx';
import { choosable, chosenSource, gloucesterOptions, sourceNeeds, withPicks, type Need, type ResourceKind } from '../game/sources.ts';

interface StepPanelProps {
  view: brass.BrassView;
  player: number;
  legal: readonly brass.BrassAction[];
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  validate: (action: brass.BrassAction) => string | null;
  onPlay: (action: brass.BrassAction) => void;
  /** The full game state, for working out coal/iron/beer sources and Gloucester's bonus. */
  full: brass.BrassState;
  /** Names of players, for naming whose tile a source is. */
  names: readonly string[];
  /** What the others did since this player's last turn, shown until they pick an action. */
  recap?: readonly RecapItem[];
}

/**
 * The choices left for the action being put together, and Confirm. Actions
 * are picked from the rail and cards from the hand; this panel holds the rest.
 */
export function StepPanel({ view, player, legal, draft, setDraft, validate, onPlay, full, names, recap = [] }: StepPanelProps) {
  const me = view.players[player]!;
  const cards = view.cards;

  if (view.phase.kind === 'shortfall') {
    const owed = view.phase.queue[0]?.owed ?? 0;
    return (
      <div className="panel">
        <p className="notice">
          Your income is negative and you're <strong>£{owed} short</strong>. Remove Industry tiles, each worth half its
          cost, until it's covered. Tap a highlighted tile, or choose below.
        </p>
        <div className="chips">
          {legal.map((a) =>
            a.type === 'removeTile' ? (
              <button key={`${a.location}#${a.slot}`} className="chip" onClick={() => onPlay(a)}>
                {slotName(a.location, a.slot)}
              </button>
            ) : null,
          )}
        </div>
      </div>
    );
  }

  if (!draft.kind) {
    return (
      <>
        {recap.length > 0 && (
          <section className="recap tray-recap">
            <h3>Since your last turn</h3>
            <ol>
              {recap.map((r, i) => (
                <li key={i}>
                  <span className={`dot owner-${r.player}`} aria-hidden />
                  <span>
                    <strong>{names[r.player]}</strong> {r.text}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
        <p className="hint">Choose an action from the side of the board.</p>
      </>
    );
  }

  // The action with any chosen coal/iron/beer sources filled in.
  const base = compose(draft);
  const action = base ? withPicks(full, player, base, draft.picks) : null;
  const error = action ? validate(action) : null;
  const needs = base ? sourceNeeds(full, player, base, draft.picks) : [];
  const cardHint =
    draft.kind === 'scout'
      ? `Choose 3 cards to discard (${draft.scoutCards.length}/3)`
      : draft.card
        ? `Card: ${cardName(cards[draft.card])}`
        : 'Choose a card from your hand';

  return (
    <div className="panel">
      <div className="panel-header">
        <ActionIcon kind={draft.kind} size={20} />
        <h2>{ACTION_LABEL[draft.kind].name}</h2>
        <span className="panel-card-hint">{cardHint}</span>
        <button className="close" onClick={() => setDraft(EMPTY_DRAFT)} aria-label="Cancel action">
          ✕
        </button>
      </div>

      {draft.kind === 'build' && draft.card && <BuildSteps view={view} me={me} legal={legal} draft={draft} setDraft={setDraft} />}
      {draft.kind === 'network' && draft.card && (
        <NetworkSteps view={view} legal={legal} draft={draft} setDraft={setDraft} />
      )}
      {draft.kind === 'develop' && draft.card && <DevelopSteps draft={draft} />}
      {draft.kind === 'loan' && <LoanSteps view={view} player={player} />}
      {draft.kind === 'sell' && draft.card && <SellSteps view={view} legal={legal} draft={draft} setDraft={setDraft} />}

      {choosable(needs).length > 0 && !draft.pendingSale && (
        <SourcePicker view={view} full={full} player={player} names={names} needs={needs} draft={draft} setDraft={setDraft} />
      )}
      {draft.kind === 'sell' && action?.type === 'sell' && !draft.pendingSale && (
        <GloucesterBonus view={view} full={full} player={player} action={action} needs={needs} draft={draft} setDraft={setDraft} />
      )}
      {action && !draft.pendingSale && (
        <div className="confirm-row">
          {error && <p className="error">{error}</p>}
          <button className="confirm" disabled={!!error} onClick={() => onPlay(action)}>
            Confirm {ACTION_LABEL[draft.kind].name}
          </button>
        </div>
      )}
    </div>
  );
}

/** Applies a tap on a hand card to the draft. */
export function pickCard(draft: Draft, id: brass.CardId): Draft {
  if (draft.kind === 'scout') {
    const chosen = draft.scoutCards;
    if (chosen.includes(id)) return { ...draft, scoutCards: chosen.filter((c) => c !== id) };
    return chosen.length < 3 ? { ...draft, scoutCards: [...chosen, id] } : draft;
  }
  if (draft.card === id) return { ...EMPTY_DRAFT, kind: draft.kind };
  return { ...EMPTY_DRAFT, kind: draft.kind, card: id };
}

/** Of a Merchant town's spaces that buy a tile, the one to sell to: one with beer beside it, if any. */
function pickSpace(view: brass.BrassView, spaces: readonly number[]): number {
  return spaces.find((m) => view.merchants[m]!.beer) ?? spaces[0]!;
}

/** Selling: the tile waiting for a Merchant goes to the one tapped. */
export function tapMerchant(draft: Draft, location: brass.LocationId, view: brass.BrassView, legal: readonly brass.BrassAction[]): Draft {
  const pending = draft.pendingSale;
  if (draft.kind !== 'sell' || !pending) return draft;
  const spaces = (sellOptions(view.cards, legal, draft).get(brass.slotKey(pending.location, pending.slot)) ?? []).filter(
    (m) => view.merchants[m]!.location === location,
  );
  if (spaces.length === 0) return draft;
  return { ...draft, pendingSale: null, sales: [...draft.sales, { ...pending, merchant: pickSpace(view, spaces) }] };
}

function lowest(me: brass.PlayerView, industry: brass.Industry): string {
  const i = me.mat[industry].findIndex((n) => n > 0);
  return i < 0 ? '' : roman(i + 1);
}

/** Tapping an industry on the mat while developing: mark its next tile, or unmark if it can't take more. */
export function tapMatRow(d: Draft, industry: brass.Industry, addable: ReadonlySet<brass.Industry>): Draft {
  if (addable.has(industry)) return { ...d, industries: [...d.industries, industry] };
  const i = d.industries.lastIndexOf(industry);
  return i < 0 ? d : { ...d, industries: d.industries.filter((_, j) => j !== i) };
}

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/** A loan's effect, with the income track showing where every player stands and where this player would land. */
function LoanSteps({ view, player }: { view: brass.BrassView; player: number }) {
  const me = view.players[player]!;
  const level = brass.incomeLevel(me.incomeSpace);
  const after = level - brass.LOAN_INCOME_LEVELS;
  const allowed = after >= brass.MIN_INCOME_LEVEL_FOR_LOAN;
  return (
    <>
      <p className="hint">
        {allowed
          ? `+£${brass.LOAN_AMOUNT} now · income ${signed(level)} → ${signed(after)} per round`
          : `A loan would take your income below ${brass.MIN_INCOME_LEVEL_FOR_LOAN}.`}
      </p>
      <IncomeTrack players={view.players} focus={player} preview={allowed ? brass.highestSpaceOfLevel(after) : undefined} />
    </>
  );
}

/** A source's name: whose tile and where, or the market / the Merchant's beer. */
function sourceName(view: brass.BrassView, names: readonly string[], player: number, kind: ResourceKind, source: string, sale?: brass.Sale): string {
  if (source === 'market') return `${kind === 'coal' ? 'Coal' : 'Iron'} market`;
  if (source === 'merchant') return `${sale ? locationName(view.merchants[sale.merchant]!.location) : 'Merchant'}'s beer`;
  const tile = view.tiles[source as brass.SlotKey];
  const { location } = brass.parseSlotKey(source as brass.SlotKey);
  const whose = tile && tile.owner !== player ? ` (${names[tile.owner]}'s)` : '';
  return `${locationName(location)}${whose}`;
}

const NEED_LABEL: Record<ResourceKind, string> = { coal: 'Coal', iron: 'Iron', beer: 'Beer' };

/** What the map is lighting up for a need, in words: "Coal Mine or the coal market", "Brewery or the Merchant". */
function sourceKinds(need: Need): string {
  const tile = { coal: 'Coal Mine', iron: 'Iron Works', beer: 'Brewery' }[need.kind];
  if (need.options.includes('market')) return `${tile} or the ${need.kind} market`;
  if (need.options.includes('merchant')) return `${tile} or the Merchant`;
  return tile;
}

/**
 * Where coal, iron and beer come from, when the rules leave a choice. Each
 * row is one cube or barrel; tap a row, then a highlighted source on the map.
 * The rows start on the engine's automatic choice, so confirming without
 * touching them is fine.
 */
function SourcePicker({
  view,
  full,
  player,
  names,
  needs,
  draft,
  setDraft,
}: {
  view: brass.BrassView;
  full: brass.BrassState;
  player: number;
  names: readonly string[];
  needs: Need[];
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
}) {
  void full;
  const rows = choosable(needs);
  const active = rows.find((n) => n.id === draft.activeNeed) ?? rows[0]!;
  const sales = draft.kind === 'sell' ? draft.sales : [];
  // Number repeated kinds (Coal 1, Coal 2) only when there's more than one of them.
  const count = (kind: ResourceKind) => rows.filter((n) => n.kind === kind).length;
  return (
    <div className="sources">
      {rows.map((need) => {
        const sale = need.sale !== undefined ? sales[need.sale] : undefined;
        const label = `${NEED_LABEL[need.kind]}${count(need.kind) > 1 ? ` ${rows.filter((n) => n.kind === need.kind).indexOf(need) + 1}` : ''}`;
        return (
          <button
            key={need.id}
            className={`source-row ${need.id === active.id ? 'active' : ''}`}
            aria-pressed={need.id === active.id}
            onClick={() => setDraft((d) => ({ ...d, activeNeed: need.id }))}
          >
            <span className={`source-dot ${need.kind}`} aria-hidden />
            <span className="source-label">{label}</span>
            <span className="source-from">from {sourceName(view, names, player, need.kind, chosenSource(need, draft.picks)!, sale)}</span>
          </button>
        );
      })}
      <p className="hint">Tap a highlighted {sourceKinds(active)} on the map to change where it comes from.</p>
    </div>
  );
}

/** Gloucester's beer bonus: develop one tile for free. Only shown when a sale there uses its beer. */
function GloucesterBonus({
  view,
  full,
  player,
  action,
  needs,
  draft,
  setDraft,
}: {
  view: brass.BrassView;
  full: brass.BrassState;
  player: number;
  action: Extract<brass.BrassAction, { type: 'sell' }>;
  needs: Need[];
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
}) {
  const i = action.sales.findIndex(
    (s, k) =>
      view.merchants[s.merchant]!.location === 'gloucester' &&
      needs.some((n) => n.sale === k && chosenSource(n, draft.picks) === 'merchant'),
  );
  if (i < 0) return null;
  const options = gloucesterOptions(full, player, action, i);
  const current = draft.sales[i]!.develop;
  // The engine's default is the first industry it can develop.
  const chosen = current === undefined ? (options[0] ?? null) : current;
  const set = (develop: brass.Industry | null) =>
    setDraft((d) => ({ ...d, sales: d.sales.map((s, k) => (k === i ? { ...s, develop } : s)) }));
  if (options.length === 0) return <p className="hint">Gloucester's bonus: nothing can be developed right now.</p>;
  return (
    <Step title="Gloucester bonus: develop a tile for free">
      <div className="chips">
        {options.map((ind) => (
          <button key={ind} className={`chip with-icon ${chosen === ind ? 'selected' : ''}`} onClick={() => set(ind)}>
            <IndustryIcon industry={ind} size={16} />
            {INDUSTRY_NAME[ind]}
          </button>
        ))}
        <button className={`chip ${chosen === null ? 'selected' : ''}`} onClick={() => set(null)}>
          None
        </button>
      </div>
    </Step>
  );
}

/** Develop is played on the player mat, which numbers the picks; this only says what to do. */
function DevelopSteps({ draft }: { draft: Draft }) {
  const n = draft.industries.length;
  return (
    <p className="hint">
      {n === 0
        ? 'Tap an industry on your board to remove its lowest tile (up to 2).'
        : `${n} tile${n > 1 ? 's' : ''} chosen · ${n} iron. Tap a number to undo.`}
    </p>
  );
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="step">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

type StepProps = {
  view: brass.BrassView;
  legal: readonly brass.BrassAction[];
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
};

function BuildSteps({ view, me, legal, draft, setDraft }: StepProps & { me: brass.PlayerView }) {
  const slots = buildSlots(view.cards, legal, draft);
  const chosenKey = draft.slot ? brass.slotKey(draft.slot.location, draft.slot.slot) : null;
  const industries = chosenKey ? buildIndustriesAt(view.cards, legal, draft, chosenKey) : [];
  const tile = draft.industry ? brass.tileStats(draft.industry, me.mat[draft.industry].findIndex((n) => n > 0) + 1) : null;
  return (
    <>
      {!draft.slot && <p className="hint">Tap a highlighted space on the map ({slots.length} available).</p>}
      {industries.length > 1 && (
        <Step title="Which industry?">
          <div className="chips">
            {industries.map((ind) => (
              <button
                key={ind}
                className={`chip with-icon ${draft.industry === ind ? 'selected' : ''}`}
                onClick={() => setDraft((d) => ({ ...d, industry: ind }))}
              >
                <IndustryIcon industry={ind} size={18} />
                {INDUSTRY_NAME[ind]} {lowest(me, ind)}
              </button>
            ))}
          </div>
        </Step>
      )}
      {tile && draft.industry && (
        <p className="muted build-summary">
          <IndustryIcon industry={draft.industry} size={16} /> {INDUSTRY_NAME[draft.industry]} {lowest(me, draft.industry)}
          <TileStats tile={tile} />
        </p>
      )}
    </>
  );
}

/** Network is played on the map: lit lines can be tapped, and a chosen link tapped again to take it back. */
function NetworkSteps({ view, legal, draft }: StepProps) {
  const rail = view.era === 'rail';
  const kind = rail ? 'rail' : 'canal';
  const options = networkLinks(view.cards, legal, draft).length;
  const [first, second] = draft.links;
  let hint: string;
  if (!first) hint = `Tap a highlighted ${kind} line on the map (${options} available).`;
  else if (second) hint = `Links: ${linkName(first)} and ${linkName(second)}. Tap one to take it back.`;
  else if (offersSecondLink(view.cards, legal, draft))
    hint = `Link: ${linkName(first)}. Tap another highlighted line for a second rail (£15, 2 coal, 1 beer in all), or confirm just this one.`;
  else hint = `Link: ${linkName(first)}. Tap another highlighted line to change it.`;
  return <p className="hint">{hint}</p>;
}

/** Selling is played on the map: tap a lit tile, then (if more than one buys it) the Merchant to sell it to. */
function SellSteps({ view, legal, draft }: StepProps) {
  const options = sellOptions(view.cards, legal, draft);
  const left = [...options.keys()].filter((k) => !draft.sales.some((s) => brass.slotKey(s.location, s.slot) === k)).length;
  const tileName = (location: brass.LocationId, slot: number) => {
    const tile = view.tiles[brass.slotKey(location, slot)]!;
    return `${INDUSTRY_NAME[tile.industry]} ${roman(tile.level)} in ${locationName(location)}`;
  };
  if (draft.pendingSale) {
    return <p className="hint">Tap a highlighted Merchant to sell the {tileName(draft.pendingSale.location, draft.pendingSale.slot)} to.</p>;
  }
  return (
    <>
      {draft.sales.length > 0 && (
        <ul className="sale-list">
          {draft.sales.map((s) => (
            <li key={brass.slotKey(s.location, s.slot)}>
              {tileName(s.location, s.slot)} → {locationName(view.merchants[s.merchant]!.location)}
            </li>
          ))}
        </ul>
      )}
      <p className="hint">
        {draft.sales.length === 0
          ? `Tap a highlighted tile to sell it (${left} available).`
          : left > 0
            ? 'Tap another highlighted tile to sell it too, or a sold tile to take it back.'
            : 'Tap a sold tile to take it back.'}
      </p>
    </>
  );
}

/** Applies a tap on the board to the draft. */
export function tapSlot(draft: Draft, location: brass.LocationId, slot: number, view: brass.BrassView, legal: readonly brass.BrassAction[]): Draft {
  if (draft.kind === 'build') return chooseBuildSlot(view.cards, legal, draft, location, slot);
  if (draft.kind === 'sell') {
    const key = brass.slotKey(location, slot);
    if (draft.sales.some((s) => brass.slotKey(s.location, s.slot) === key)) {
      return { ...draft, sales: draft.sales.filter((s) => brass.slotKey(s.location, s.slot) !== key), pendingSale: null };
    }
    const pending = draft.pendingSale;
    if (pending && pending.location === location && pending.slot === slot) return { ...draft, pendingSale: null };
    const merchants = sellOptions(view.cards, legal, draft).get(key) ?? [];
    if (merchants.length === 0) return draft;
    // More than one Merchant town buys it: the player taps which one next.
    if (new Set(merchants.map((m) => view.merchants[m]!.location)).size > 1) return { ...draft, pendingSale: { location, slot } };
    return { ...draft, pendingSale: null, sales: [...draft.sales, { location, slot, merchant: pickSpace(view, merchants) }] };
  }
  return draft;
}
