import { brass } from '@brass/engine';
import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import type { CSSProperties } from 'react';
import { IndustryIcon } from './icons.tsx';

const CARD_WIDTH = 70;
const CARD_GAP = 6;
/** Narrowest strip of a card left showing when the hand overlaps; below this the hand wraps to 2 rows. */
const MIN_PEEK = 50;
/** Vertical distance between the two rows of cards. */
const ROW_STEP = 104;
const ONE_ROW_HEIGHT = 116;
/** How far the bar must be dragged (px) to count as a drag rather than a tap. */
const DRAG_THRESHOLD = 12;

/**
 * Card labels with soft hyphens (\u00AD), so long names break neatly inside
 * the strip of a card that shows when cards overlap.
 */
const TOWN_LABEL: Partial<Record<brass.LocationId, string>> = {
  birmingham: 'Birming\u00ADham',
  'burton': 'Burton-on-Trent',
  cannock: 'Can\u00ADnock',
  coalbrookdale: 'Coal\u00ADbrook\u00ADdale',
  coventry: 'Coven\u00ADtry',
  kidderminster: 'Kidder\u00ADminster',
  nuneaton: 'Nun\u00ADeaton',
  redditch: 'Red\u00ADditch',
  stafford: 'Staf\u00ADford',
  stoke: 'Stoke-on-Trent',
  tamworth: 'Tam\u00ADworth',
  uttoxeter: 'Uttox\u00ADeter',
  wolverhampton: 'Wolver\u00ADhamp\u00ADton',
  worcester: 'Wor\u00ADcester',
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
  tucked,
  onTuckedChange,
  header,
  children,
}: {
  cards: Record<brass.CardId, brass.Card>;
  hand: readonly brass.CardId[];
  usable: Set<brass.CardId> | null;
  selected: Set<brass.CardId>;
  onPick: (id: brass.CardId) => void;
  tucked: boolean;
  onTuckedChange: (tucked: boolean) => void;
  header: ReactNode;
  children?: ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  return (
    <section
      className="hand-tray"
      data-tucked={tucked}
      data-dragging={drag !== null}
      style={follow ? { transform: `translateY(${follow}px)` } : undefined}
    >
      <div
        className="tray-bar"
        role="button"
        tabIndex={0}
        aria-expanded={!tucked}
        aria-label={tucked ? 'Show hand' : 'Hide hand'}
        onPointerDown={onBarDown}
        onPointerMove={onBarMove}
        onPointerUp={onBarUp}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onTuckedChange(!tucked);
          }
        }}
      >
        <span className="tray-grip" aria-hidden />
        <span className="tray-tab">
          <span className="tray-chevron" aria-hidden>
            {tucked ? '▴' : '▾'}
          </span>
          Hand ({n})
        </span>
        <span className="tray-info">{header}</span>
      </div>
      {children && <div className="tray-panel">{children}</div>}
      <div
        className="hand-row"
        ref={rowRef}
        style={
          {
            height: tucked ? 0 : ONE_ROW_HEIGHT + (rows - 1) * ROW_STEP,
            '--peek': `${Math.min(step, CARD_WIDTH)}px`,
          } as CSSProperties
        }
      >
        <div className="hand-row-inner">
        {hand.map((id, i) => {
          const isSelected = selected.has(id);
          const disabled = !usable || !usable.has(id);
          const row = Math.floor(i / perRow);
          const col = i % perRow;
          const rowEnd = col === perRow - 1 || i === n - 1;
          // Centre each row; the last row may hold fewer cards.
          const inRow = Math.min(perRow, n - row * perRow);
          const offset = Math.max(0, (width - ((inRow - 1) * step + CARD_WIDTH)) / 2);
          return (
            <button
              key={id}
              className={`hand-card ${isSelected ? 'selected' : ''} ${usable && disabled ? 'unusable' : ''} ${rowEnd ? 'row-end' : ''}`}
              style={{ left: offset + col * step, top: 16 + row * ROW_STEP, zIndex: isSelected ? 50 : i }}
              disabled={disabled}
              aria-pressed={isSelected}
              onClick={() => onPick(id)}
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
