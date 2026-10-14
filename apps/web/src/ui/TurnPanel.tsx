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
import { INDUSTRY_NAME, cardName, linkName, merchantName, roman, slotName } from '../game/labels.ts';
import { ACTION_LABEL } from './ActionRail.tsx';
import { ActionIcon, IndustryIcon } from './icons.tsx';
import { IncomeTrack } from './IncomeTrack.tsx';
import { TileStats } from './PlayerMat.tsx';

interface StepPanelProps {
  view: brass.BrassView;
  player: number;
  legal: readonly brass.BrassAction[];
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  validate: (action: brass.BrassAction) => string | null;
  onPlay: (action: brass.BrassAction) => void;
}

/**
 * The choices left for the action being put together, and Confirm. Actions
 * are picked from the rail and cards from the hand; this panel holds the rest.
 */
export function StepPanel({ view, player, legal, draft, setDraft, validate, onPlay }: StepPanelProps) {
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
    return <p className="hint">Choose an action from the side of the board.</p>;
  }

  const action = compose(draft);
  const error = action ? validate(action) : null;
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

      {action && (
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

function SellSteps({ view, legal, draft, setDraft }: StepProps) {
  const options = sellOptions(view.cards, legal, draft);
  const selected = new Map(draft.sales.map((s) => [brass.slotKey(s.location, s.slot), s]));
  const toggle = (key: brass.SlotKey) =>
    setDraft((d) => {
      if (selected.has(key)) return { ...d, sales: d.sales.filter((s) => brass.slotKey(s.location, s.slot) !== key) };
      const { location, index } = brass.parseSlotKey(key);
      const merchants = options.get(key) ?? [];
      const merchant = merchants.find((m) => view.merchants[m]!.beer) ?? merchants[0]!;
      return { ...d, sales: [...d.sales, { location, slot: index, merchant }] };
    });
  return (
    <Step title="Choose tiles to sell (or tap the board)">
      <div className="sell-list">
        {[...options.keys()].map((key) => {
          const { location, index } = brass.parseSlotKey(key);
          const sale = selected.get(key);
          const tile = view.tiles[key]!;
          return (
            <div key={key} className="sell-row">
              <button className={`chip ${sale ? 'selected' : ''}`} onClick={() => toggle(key)}>
                {INDUSTRY_NAME[tile.industry]} {roman(tile.level)} · {slotName(location, index)}
              </button>
              {sale && (options.get(key)?.length ?? 0) > 1 && (
                <div className="chips sub">
                  {options.get(key)!.map((m) => (
                    <button
                      key={m}
                      className={`chip small ${sale.merchant === m ? 'selected' : ''}`}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          sales: d.sales.map((s) => (brass.slotKey(s.location, s.slot) === key ? { ...s, merchant: m } : s)),
                        }))
                      }
                    >
                      to {merchantName(view, m)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Step>
  );
}

/** Applies a tap on the board to the draft. */
export function tapSlot(draft: Draft, location: brass.LocationId, slot: number, view: brass.BrassView, legal: readonly brass.BrassAction[]): Draft {
  if (draft.kind === 'build') return chooseBuildSlot(view.cards, legal, draft, location, slot);
  if (draft.kind === 'sell') {
    const key = brass.slotKey(location, slot);
    if (draft.sales.some((s) => brass.slotKey(s.location, s.slot) === key)) {
      return { ...draft, sales: draft.sales.filter((s) => brass.slotKey(s.location, s.slot) !== key) };
    }
    const merchants = sellOptions(view.cards, legal, draft).get(key) ?? [];
    const merchant = merchants.find((m) => view.merchants[m]!.beer) ?? merchants[0];
    return merchant === undefined ? draft : { ...draft, sales: [...draft.sales, { location, slot, merchant }] };
  }
  return draft;
}
