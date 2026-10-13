import { useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import { ACTION_KINDS, type ActionKind } from '../game/draft.ts';
import { ActionIcon } from './icons.tsx';

export const ACTION_LABEL: Record<ActionKind, { name: string; hint: string }> = {
  build: { name: 'Build', hint: 'Place an industry' },
  network: { name: 'Network', hint: 'Place a canal or rail link' },
  develop: { name: 'Develop', hint: 'Remove tiles from your mat' },
  sell: { name: 'Sell', hint: 'Flip cotton, goods or pottery' },
  loan: { name: 'Loan', hint: '£30, −3 income levels' },
  scout: { name: 'Scout', hint: 'Discard 3 for 2 Wild cards' },
  pass: { name: 'Pass', hint: 'Discard a card' },
};

/** What each action does, shown when a rail button is hovered or held. */
const ACTION_HELP: Record<ActionKind | 'undo', string> = {
  build:
    'Discard a card to place your lowest tile of an industry. A Location card builds in that town; an Industry card builds that industry anywhere in your network. Pay its cost plus any coal and iron.',
  network:
    'Discard any card to place a link next to your network. Canal Era: 1 canal for £3. Rail Era: 1 rail for £5 + 1 coal, or 2 rails for £15 + 2 coal + 1 beer.',
  develop:
    'Discard any card to remove 1 or 2 of the lowest tiles from your board, paying 1 iron each, so you can build higher levels. Tiles with a lightbulb can\'t be removed.',
  sell: 'Discard any card to flip cotton mills, manufacturers or potteries connected to a Merchant that buys them, using the beer each needs. Flipped tiles raise your income and score VPs.',
  loan: 'Discard any card to take £30 and drop your income by 3 levels. Not allowed if it would take your income below −10.',
  scout: 'Discard 3 cards to take a Wild Location and a Wild Industry card. Not allowed while you hold a Wild card.',
  pass: 'Discard a card and do nothing.',
  undo: 'Take back your last action.',
};

/** Holding a button this long (touch) shows its description instead of choosing it. */
const HOLD_MS = 400;
const HOLD_SLOP = 10;

/** A slim column of action buttons floating over the edge of the board. */
export function ActionRail({
  available,
  selected,
  onSelect,
  canUndo,
  onUndo,
}: {
  available: Set<ActionKind>;
  selected: ActionKind | null;
  onSelect: (kind: ActionKind | null) => void;
  canUndo: boolean;
  onUndo: () => void;
}) {
  // The description bubble: hover with a mouse, or press and hold on a touchscreen.
  const [tip, setTip] = useState<{ kind: ActionKind | 'undo'; at: CSSProperties } | null>(null);
  const hold = useRef<{ x: number; y: number; timer: number } | null>(null);
  const swallowClick = useRef(false);
  const navRef = useRef<HTMLElement>(null);

  // Line the bubble up with the button, growing away from the nearer end of the rail so it stays on screen.
  const place = (kind: ActionKind | 'undo', el: HTMLElement) => {
    const railHeight = navRef.current?.offsetHeight ?? 0;
    const upper = el.offsetTop + el.offsetHeight / 2 < railHeight / 2;
    setTip({ kind, at: upper ? { top: el.offsetTop } : { bottom: railHeight - el.offsetTop - el.offsetHeight } });
  };
  const endHold = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  };
  const tipHandlers = (kind: ActionKind | 'undo') => ({
    onPointerEnter: (e: PointerEvent<HTMLButtonElement>) => {
      if (e.pointerType === 'mouse') place(kind, e.currentTarget);
    },
    onPointerLeave: (e: PointerEvent<HTMLButtonElement>) => {
      if (e.pointerType === 'mouse') setTip(null);
    },
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      swallowClick.current = false;
      if (e.pointerType === 'mouse') return;
      const el = e.currentTarget;
      const timer = window.setTimeout(() => {
        swallowClick.current = true;
        place(kind, el);
        navigator.vibrate?.(8);
      }, HOLD_MS);
      hold.current = { x: e.clientX, y: e.clientY, timer };
    },
    onPointerMove: (e: PointerEvent<HTMLButtonElement>) => {
      const h = hold.current;
      if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > HOLD_SLOP) endHold();
    },
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) => {
      endHold();
      if (e.pointerType !== 'mouse') setTip(null);
    },
    onPointerCancel: () => {
      endHold();
      setTip(null);
    },
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
  });

  return (
    <nav
      className="action-rail"
      aria-label="Actions"
      ref={navRef}
      onClickCapture={(e) => {
        // The release that ends a hold only closes the description.
        if (swallowClick.current) {
          swallowClick.current = false;
          e.stopPropagation();
          e.preventDefault();
        }
      }}
    >
      {ACTION_KINDS.map((k) => {
        const disabled = !available.has(k);
        return (
          <button
            key={k}
            className={`rail-button ${selected === k ? 'selected' : ''}`}
            // Not `disabled`: unavailable actions should still show their description.
            aria-disabled={disabled}
            aria-pressed={selected === k}
            aria-describedby={tip?.kind === k ? 'rail-tip' : undefined}
            onClick={() => {
              if (!disabled) onSelect(selected === k ? null : k);
            }}
            {...tipHandlers(k)}
          >
            <ActionIcon kind={k} />
            <span className="rail-label">{ACTION_LABEL[k].name}</span>
          </button>
        );
      })}
      {canUndo && (
        <button
          className="rail-button undo"
          aria-describedby={tip?.kind === 'undo' ? 'rail-tip' : undefined}
          onClick={onUndo}
          {...tipHandlers('undo')}
        >
          <ActionIcon kind="undo" />
          <span className="rail-label">Undo</span>
        </button>
      )}
      {tip && (
        <div id="rail-tip" role="tooltip" className="rail-tip" style={tip.at}>
          <strong>{tip.kind === 'undo' ? 'Undo' : ACTION_LABEL[tip.kind].name}</strong>
          {tip.kind !== 'undo' && !available.has(tip.kind) && <span className="rail-tip-off"> · not available now</span>}
          <p>{ACTION_HELP[tip.kind]}</p>
        </div>
      )}
    </nav>
  );
}
