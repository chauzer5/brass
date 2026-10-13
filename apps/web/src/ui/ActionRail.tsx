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
  return (
    <nav className="action-rail" aria-label="Actions">
      {ACTION_KINDS.map((k) => (
        <button
          key={k}
          className={`rail-button ${selected === k ? 'selected' : ''}`}
          disabled={!available.has(k)}
          aria-pressed={selected === k}
          title={`${ACTION_LABEL[k].name}: ${ACTION_LABEL[k].hint}`}
          onClick={() => onSelect(selected === k ? null : k)}
        >
          <ActionIcon kind={k} />
          <span className="rail-label">{ACTION_LABEL[k].name}</span>
        </button>
      ))}
      {canUndo && (
        <button className="rail-button undo" title="Undo your last action" onClick={onUndo}>
          <ActionIcon kind="undo" />
          <span className="rail-label">Undo</span>
        </button>
      )}
    </nav>
  );
}
