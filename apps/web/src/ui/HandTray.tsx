import { brass } from '@brass/engine';
import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import type { CSSProperties } from 'react';
import { IndustryIcon } from './icons.tsx';

const CARD_WIDTH = 70;
const CARD_GAP = 6;
/** Narrowest strip of a card left showing when the hand overlaps; below this the hand wraps to 2 rows. */
const MIN_PEEK = 38;
/** Below this strip width, card text shrinks a little to fit. */
const TIGHT_PEEK = 50;
/** Vertical distance between the two rows of cards. */
const ROW_STEP = 100;
/** Room above the first row for a chosen card to lift into. */
const CARD_TOP = 11;
const ONE_ROW_HEIGHT = 110;
/** How far the bar must be dragged (px) to count as a drag rather than a tap. */
const DRAG_THRESHOLD = 12;
/** Two taps on the same card within this many ms count as a double-tap. */
const DOUBLE_TAP_MS = 350;
/** Holding a finger on the hand this long lifts the card under it for a closer look. */
const HOLD_MS = 300;
/** A finger that moves further than this (px) before the hold kicks in is a swipe, not a hold. */
const HOLD_SLOP = 10;

/**
 * Card labels with soft hyphens (\u00AD), so long names break neatly inside
 * the strip of a card that shows when cards overlap.
 */
const SH = '\u00AD';
const TOWN_LABEL: Partial<Record<brass.LocationId, string>> = {
  belper: `Bel${SH}per`,
  birmingham: `Birm${SH}ing${SH}ham`,
  burton: `Bur${SH}ton-on-Trent`,
  cannock: `Can${SH}nock`,
  coalbrookdale: `Coal${SH}brook${SH}dale`,
  coventry: `Cov${SH}en${SH}try`,
  dudley: `Dud${SH}ley`,
  kidderminster: `Kid${SH}der${SH}min${SH}ster`,
  nuneaton: `Nun${SH}eaton`,
  redditch: `Red${SH}ditch`,
  stafford: `Staf${SH}ford`,
  stoke: 'Stoke-on-Trent',
  tamworth: `Tam${SH}worth`,
  uttoxeter: `Utt${SH}ox${SH}eter`,
  walsall: `Wal${SH}sall`,
  wolverhampton: `Wol${SH}ver${SH}hamp${SH}ton`,
  worcester: `Wor${SH}ces${SH}ter`,
};

const INDUSTRY_LABEL: Record<brass.Industry, string> = {
  cotton: 'Cotton',
  manufacturer: 'Goods',
  pottery: 'Pottery',
  coal: 'Coal',
  iron: 'Iron',
  brewery: 'Brew\u00ADery',
};

const townLabel = (id: brass.LocationId) => TOWN_LABEL[id] ?? brass.TOWNS.find((t) => t.id === id)!.name;

export type TrayTab = 'hand' | 'mat';

/** Cards that just joined the hand and should fly in from the deck. `key` changes for each batch. */
export interface Arriving {
  ids: ReadonlySet<brass.CardId>;
  key: string;
}

/** How cards fly in from the deck. */
const DEAL_MS = 560;
const DEAL_STAGGER = 110;

/** One card from the hand, drawn like the physical card. */
export function GameCard({ card }: { card: brass.Card | undefined }) {
  if (!card) return <div className="game-card back" />;
  switch (card.kind) {
    case 'location': {
      const town = brass.TOWNS.find((t) => t.id === card.location)!;
      return (
        <div className={`game-card location banner-bg-${town.color}`}>
          <span className="card-kind">Location</span>
          <span className="card-title">{townLabel(card.location)}</span>
          <span className="card-icons">
            {[...new Set(town.slots.flat())].map((ind) => (
              <IndustryIcon key={ind} industry={ind} size={14} />
            ))}
          </span>
        </div>
      );
    }
    case 'industry':
      return (
        <div className="game-card industry">
          <span className="card-kind">Industry</span>
          <span className="card-icons big">
            {card.industries.map((ind) => (
              <IndustryIcon key={ind} industry={ind} size={card.industries.length > 1 ? 22 : 30} />
            ))}
          </span>
          <span className="card-title">{card.industries.map((i) => INDUSTRY_LABEL[i]).join(' / ')}</span>
        </div>
      );
    case 'wildLocation':
      return (
        <div className="game-card wild">
          <span className="card-kind">Wild</span>
          <span className="card-wild-mark">✦</span>
          <span className="card-title">Any town</span>
        </div>
      );
    case 'wildIndustry':
      return (
        <div className="game-card wild">
          <span className="card-kind">Wild</span>
          <span className="card-wild-mark">✦</span>
          <span className="card-title">Any industry</span>
        </div>
      );
  }
}

/**
 * The hand: cards along the bottom. They overlap like a fanned hand when
 * there isn't room for all of them, and wrap onto a second row rather than
 * overlapping so much that their names can't be read. The chosen card lifts out.
 * The whole tray (with whatever sits above it) tucks away to show the board.
 */
export function HandTray({
  cards,
  hand,
  usable,
  selected,
  onPick,
  onDoubleTap,
  tucked,
  onTuckedChange,
  header,
  tab,
  onTabChange,
  mat,
  panelOnMat = false,
  arriving,
  children,
}: {
  cards: Record<brass.CardId, brass.Card>;
  hand: readonly brass.CardId[];
  usable: Set<brass.CardId> | null;
  selected: Set<brass.CardId>;
  onPick: (id: brass.CardId) => void;
  /** A second tap on the same card within a moment. */
  onDoubleTap?: (id: brass.CardId) => void;
  tucked: boolean;
  onTuckedChange: (tucked: boolean) => void;
  header: ReactNode;
  /** Which side of the tray shows: the hand, or the player's own mat. */
  tab: TrayTab;
  onTabChange: (tab: TrayTab) => void;
  mat: ReactNode;
  /** Also show the step panel above the mat (for actions played on the mat, like Develop). */
  panelOnMat?: boolean;
  arriving?: Arriving | null | undefined;
  children?: ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    // Measure now, so the first paint already has the cards in place.
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // New cards fly from the deck pile on the map (or the board's top-left corner if it's out of view) into place.
  const innerCards = useRef<HTMLDivElement>(null);
  const [dealing, setDealing] = useState(false);
  useLayoutEffect(() => {
    const row = innerCards.current;
    if (!arriving || !row || width === 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const deck = document.querySelector('[data-pile="deck"]')?.getBoundingClientRect();
    const area = document.querySelector('.board-area')?.getBoundingClientRect();
    const fromX = deck && area ? Math.min(Math.max(deck.left + deck.width / 2, area.left), area.right) : 0;
    const fromY = deck && area ? Math.min(Math.max(deck.top + deck.height / 2, area.top), area.bottom) : 0;
    const cards = [...row.querySelectorAll<HTMLElement>('[data-card]')].filter((el) => arriving.ids.has(el.dataset.card!));
    if (cards.length === 0) return;
    setDealing(true);
    const runs = cards.map((el, i) => {
      const r = el.getBoundingClientRect();
      const dx = fromX - (r.left + r.width / 2);
      const dy = fromY - (r.top + r.height / 2);
      return el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(0.45) rotate(-14deg)`, opacity: 0.2, zIndex: 80 },
          { transform: `translate(${dx * 0.35}px, ${dy * 0.35 - 30}px) scale(0.9) rotate(-4deg)`, opacity: 1, zIndex: 80, offset: 0.6 },
          { transform: 'none', opacity: 1, zIndex: 80 },
        ],
        { duration: DEAL_MS, delay: i * DEAL_STAGGER, easing: 'cubic-bezier(0.25, 0.7, 0.3, 1)', fill: 'backwards' },
      );
    });
    let done = false;
    Promise.allSettled(runs.map((a) => a.finished)).then(() => {
      if (!done) setDealing(false);
    });
    return () => {
      done = true;
      runs.forEach((a) => a.cancel());
      setDealing(false);
    };
  }, [arriving?.key, width > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastTap = useRef<{ id: brass.CardId; at: number } | null>(null);
  const tapCard = (id: brass.CardId) => {
    const now = Date.now();
    const prev = lastTap.current;
    lastTap.current = { id, at: now };
    if (prev && prev.id === id && now - prev.at < DOUBLE_TAP_MS) {
      lastTap.current = null;
      onDoubleTap?.(id);
    }
    onPick(id);
  };

  // Hold a finger on the hand to lift the card under it, then slide to fan
  // through the others. Letting go puts the card back without choosing it.
  const [peek, setPeek] = useState<number | null>(null);
  const hold = useRef<{ x: number; y: number; timer: number } | null>(null);
  const swallowClick = useRef(false);
  const innerRef = useRef<HTMLDivElement>(null);

  // Tap the bar to toggle; drag it down to tuck the hand away or up to show it.
  const [drag, setDrag] = useState<{ startY: number; dy: number } | null>(null);
  const onBarDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ startY: e.clientY, dy: 0 });
  };
  const onBarMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag) setDrag({ ...drag, dy: e.clientY - drag.startY });
  };
  const onBarUp = () => {
    if (!drag) return;
    const { dy } = drag;
    setDrag(null);
    if (Math.abs(dy) < DRAG_THRESHOLD) onTuckedChange(!tucked);
    else onTuckedChange(dy > 0);
  };
  // While dragging, the tray follows the finger a little in the allowed direction.
  const follow = drag ? (tucked ? Math.max(-60, Math.min(0, drag.dy)) : Math.max(0, Math.min(120, drag.dy))) : 0;

  const n = hand.length;
  const stepFor = (perRow: number) => (perRow > 1 ? (width - CARD_WIDTH) / (perRow - 1) : CARD_WIDTH);
  const rows = stepFor(n) >= MIN_PEEK ? 1 : 2;
  const perRow = Math.ceil(n / rows);
  const step = Math.min(CARD_WIDTH + CARD_GAP, stepFor(perRow));
  // Each row is centred; the last row may hold fewer cards.
  const rowCount = (row: number) => Math.min(perRow, n - row * perRow);
  const rowOffset = (row: number) => Math.max(0, (width - ((rowCount(row) - 1) * step + CARD_WIDTH)) / 2);

  /** The card whose visible strip is under a point on screen. */
  const cardAt = (x: number, y: number) => {
    const rect = innerRef.current!.getBoundingClientRect();
    const row = rows > 1 && y - rect.top >= CARD_TOP + ROW_STEP ? 1 : 0;
    const col = Math.floor((x - rect.left - rowOffset(row)) / step);
    return row * perRow + Math.max(0, Math.min(rowCount(row) - 1, col));
  };

  const endHold = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
    setPeek(null);
  };
  const onHandDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    swallowClick.current = false;
    const { clientX: x, clientY: y, pointerId } = e;
    const target = e.currentTarget;
    const timer = window.setTimeout(() => {
      target.setPointerCapture(pointerId);
      swallowClick.current = true;
      setPeek(cardAt(x, y));
      navigator.vibrate?.(8);
    }, HOLD_MS);
    hold.current = { x, y, timer };
  };
  const onHandMove = (e: PointerEvent<HTMLDivElement>) => {
    const h = hold.current;
    if (!h) return;
    if (peek === null) {
      if (Math.hypot(e.clientX - h.x, e.clientY - h.y) > HOLD_SLOP) endHold();
      return;
    }
    const i = cardAt(e.clientX, e.clientY);
    if (i !== peek) {
      setPeek(i);
      navigator.vibrate?.(4);
    }
  };

  return (
    <section
      className="hand-tray"
      data-tucked={tucked}
      data-dragging={drag !== null}
      style={follow ? { transform: `translateY(${follow}px)` } : undefined}
    >
      <div
        className="tray-bar"
        onPointerDown={onBarDown}
        onPointerMove={onBarMove}
        onPointerUp={onBarUp}
        onPointerCancel={() => setDrag(null)}
      >
        <span className="tray-grip" aria-hidden />
        <span className="tray-tabs" role="tablist">
          {(['hand', 'mat'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              className="tray-tab"
              aria-selected={tab === t}
              // The tabs sit on the bar, so keep their taps from toggling or dragging it.
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                onTabChange(t);
                if (tucked) onTuckedChange(false);
              }}
            >
              {t === 'hand' ? `Hand (${n})` : 'Board'}
            </button>
          ))}
        </span>
        <span className="tray-info">{header}</span>
      </div>
      {(tab === 'hand' || panelOnMat) && children && <div className="tray-panel">{children}</div>}
      {tab === 'mat' && <div className="tray-mat">{mat}</div>}
      <div
        hidden={tab !== 'hand'}
        className={`hand-row ${step < TIGHT_PEEK ? 'tight' : ''}`}
        data-peeking={peek !== null || dealing}
        ref={rowRef}
        style={
          {
            height: tucked ? 0 : ONE_ROW_HEIGHT + (rows - 1) * ROW_STEP,
            '--peek': `${Math.min(step, CARD_WIDTH)}px`,
          } as CSSProperties
        }
      >
        <div
          className="hand-row-inner"
          ref={(el) => {
            innerRef.current = el;
            innerCards.current = el;
          }}
          onPointerDown={onHandDown}
          onPointerMove={onHandMove}
          onPointerUp={endHold}
          onPointerCancel={endHold}
          onContextMenu={(e) => e.preventDefault()}
          onClickCapture={(e) => {
            // The release that ends a hold isn't a tap.
            if (swallowClick.current) {
              swallowClick.current = false;
              e.stopPropagation();
            }
          }}
        >
        {hand.map((id, i) => {
          const isSelected = selected.has(id);
          // With no action chosen, cards can still be tapped (double-tap shows a town on the map).
          const disabled = usable !== null && !usable.has(id);
          const row = Math.floor(i / perRow);
          const col = i % perRow;
          const rowEnd = col === perRow - 1 || i === n - 1;
          const peeked = peek === i;
          return (
            <button
              key={id}
              data-card={id}
              className={`hand-card ${isSelected ? 'selected' : ''} ${usable && disabled ? 'unusable' : ''} ${rowEnd ? 'row-end' : ''} ${peeked ? 'peeked' : ''}`}
              style={{ left: rowOffset(row) + col * step, top: CARD_TOP + row * ROW_STEP, zIndex: peeked ? 60 : isSelected ? 50 : i }}
              // Not `disabled`: a disabled button swallows the pointer events that start a hold.
              aria-disabled={disabled}
              aria-pressed={isSelected}
              onClick={() => {
                if (!disabled) tapCard(id);
              }}
            >
              <GameCard card={cards[id]} />
            </button>
          );
        })}
        </div>
      </div>
    </section>
  );
}
