import { brass } from '@brass/engine';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  EMPTY_DRAFT,
  buildIndustries,
  buildSlots,
  compose,
  developIndustries,
  networkLinks,
  sellOptions,
  type Draft,
} from '../game/draft.ts';
import { INDUSTRY_NAME, cardName, linkName, merchantName, roman, slotName } from '../game/labels.ts';
import { ACTION_LABEL } from './ActionRail.tsx';
import { ActionIcon } from './icons.tsx';

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
      {draft.kind === 'develop' && draft.card && (
        <Step title="Choose 1 or 2 tiles to remove from your mat">
          <div className="chips">
            {draft.industries.map((ind, i) => (
              <button
                key={i}
                className="chip selected"
                onClick={() => setDraft((d) => ({ ...d, industries: d.industries.filter((_, j) => j !== i) }))}
              >
                {INDUSTRY_NAME[ind]} ✕
              </button>
            ))}
            {draft.industries.length < 2 &&
              developIndustries(cards, legal, draft).map((ind) => (
                <button key={ind} className="chip" onClick={() => setDraft((d) => ({ ...d, industries: [...d.industries, ind] }))}>
                  + {INDUSTRY_NAME[ind]} {lowest(me, ind)}
                </button>
              ))}
          </div>
        </Step>
      )}
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
  const industries = buildIndustries(view.cards, legal, draft.card!);
  const slots = buildSlots(view.cards, legal, draft);
  const tile = draft.industry ? brass.tileStats(draft.industry, me.mat[draft.industry].findIndex((n) => n > 0) + 1) : null;
  return (
    <>
      <Step title="Choose an industry">
        <div className="chips">
          {industries.map((ind) => (
            <button
              key={ind}
              className={`chip ${draft.industry === ind ? 'selected' : ''}`}
              onClick={() => setDraft((d) => ({ ...d, industry: ind, slot: null }))}
            >
              {INDUSTRY_NAME[ind]} {lowest(me, ind)}
            </button>
          ))}
        </div>
        {tile && (
          <p className="muted">
            Costs £{tile.cost}
            {tile.coal ? `, ${tile.coal} coal` : ''}
            {tile.iron ? `, ${tile.iron} iron` : ''}. Flipped: {tile.vp} VP, +{tile.income} income.
          </p>
        )}
      </Step>
      {draft.industry && (
        <Step title="Choose where (or tap the board)">
          <div className="chips">
            {slots.map((key) => {
              const { location, index } = brass.parseSlotKey(key);
              const selected = draft.slot?.location === location && draft.slot.slot === index;
              return (
                <button
                  key={key}
                  className={`chip ${selected ? 'selected' : ''}`}
                  onClick={() => setDraft((d) => ({ ...d, slot: { location, slot: index } }))}
                >
                  {slotName(location, index)}
                  {view.tiles[key] ? ' (overbuild)' : ''}
                </button>
              );
            })}
          </div>
        </Step>
      )}
    </>
  );
}

function NetworkSteps({ view, legal, draft, setDraft }: StepProps) {
  const options = networkLinks(view.cards, legal, draft);
  const rail = view.era === 'rail';
  return (
    <Step
      title={
        draft.links.length === 0
          ? `Choose a ${rail ? 'rail' : 'canal'} link (or tap the board)`
          : rail && draft.links.length === 1
            ? 'Add a second rail link (£15 total and 1 beer), or confirm just this one'
            : 'Link chosen'
      }
    >
      <div className="chips">
        {draft.links.map((id) => (
          <button
            key={id}
            className="chip selected"
            onClick={() => setDraft((d) => ({ ...d, links: d.links.slice(0, d.links.indexOf(id)) }))}
          >
            {linkName(id)} ✕
          </button>
        ))}
        {options.map((id) => (
          <button key={id} className="chip" onClick={() => setDraft((d) => ({ ...d, links: [...d.links, id] }))}>
            {linkName(id)}
          </button>
        ))}
      </div>
    </Step>
  );
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
  if (draft.kind === 'build') return { ...draft, slot: { location, slot } };
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
