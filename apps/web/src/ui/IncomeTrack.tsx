import { brass } from '@brass/engine';
import { useLayoutEffect, useRef } from 'react';

/** Width of one Progress Track space, and the gap between income levels. */
const SPACE_W = 12;
const LEVEL_GAP = 3;
const TRACK_Y = 22;
const TRACK_H = 14;

/** Each income level and the spaces it spans, in track order. */
const LEVELS: { level: number; first: number; last: number }[] = (() => {
  const out: { level: number; first: number; last: number }[] = [];
  brass.INCOME_LEVEL_BY_SPACE.forEach((level, space) => {
    const prev = out.at(-1);
    if (prev && prev.level === level) prev.last = space;
    else out.push({ level, first: space, last: space });
  });
  return out;
})();

/** Left edge of a space: spaces sit side by side, with a gap between levels. */
const spaceX = (space: number) => space * SPACE_W + (brass.incomeLevel(space) + 10) * LEVEL_GAP;
const WIDTH = spaceX(brass.MAX_PROGRESS_SPACE) + SPACE_W;

/** Shading bands: negative income, then the 2-, 3- and 4-space stretches of the track. */
const band = (level: number) => (level < 0 ? 'neg' : level === 0 ? 'zero' : level <= 10 ? 'b1' : level <= 20 ? 'b2' : 'b3');

/**
 * The income track: every Progress Track space grouped into its income level,
 * with each player's marker. `preview` shows a ghost marker for where the
 * focused player would end up (e.g. after a loan). Scrolls to the focused player.
 */
export function IncomeTrack({
  players,
  focus,
  preview,
}: {
  players: readonly brass.PlayerView[];
  /** The player to centre on and draw larger. */
  focus: number;
  /** A space to show a ghost of the focused player's marker on. */
  preview?: number | undefined;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const from = players[focus]!.incomeSpace;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // Centre on the player (and their preview, when there is one).
    const a = spaceX(from);
    const b = preview === undefined ? a : spaceX(preview);
    el.scrollLeft = (a + b) / 2 + SPACE_W / 2 - el.clientWidth / 2;
  }, [from, preview]);

  // Players sharing a space stack upwards.
  const stacked = new Map<number, number>();
  const markers = players.map((p) => {
    const n = stacked.get(p.incomeSpace) ?? 0;
    stacked.set(p.incomeSpace, n + 1);
    return { id: p.id, space: p.incomeSpace, stack: n };
  });

  const markerY = TRACK_Y + TRACK_H / 2;
  return (
    <div className="income-track" ref={scroller}>
      <svg width={WIDTH} height={TRACK_Y + TRACK_H + 14} aria-label="Income track">
        {LEVELS.map(({ level, first, last }) => {
          const x = spaceX(first);
          const w = spaceX(last) + SPACE_W - x;
          return (
            <g key={level} className={`income-level ${band(level)}`}>
              <text x={x + w / 2} y={TRACK_Y - 6} className="income-level-label">
                {level > 0 ? `+${level}` : level}
              </text>
              <rect x={x} y={TRACK_Y} width={w} height={TRACK_H} rx={3} className="income-level-bg" />
              {/* Dividers between the spaces within a level. */}
              {Array.from({ length: last - first }, (_, i) => (
                <line key={i} x1={x + (i + 1) * SPACE_W} x2={x + (i + 1) * SPACE_W} y1={TRACK_Y + 3} y2={TRACK_Y + TRACK_H - 3} className="income-space-tick" />
              ))}
            </g>
          );
        })}
        {preview !== undefined && preview !== from && (
          <g className={`income-preview owner-${focus}`}>
            <path
              d={`M${spaceX(from) + SPACE_W / 2} ${TRACK_Y + TRACK_H + 3} Q${(spaceX(from) + spaceX(preview)) / 2 + SPACE_W / 2} ${TRACK_Y + TRACK_H + 12} ${spaceX(preview) + SPACE_W / 2} ${TRACK_Y + TRACK_H + 3}`}
              className="income-preview-arrow"
            />
            <circle cx={spaceX(preview) + SPACE_W / 2} cy={markerY} r={6.5} className="income-ghost" />
          </g>
        )}
        {markers.map(({ id, space, stack }) => (
          <circle
            key={id}
            cx={spaceX(space) + SPACE_W / 2}
            cy={markerY - stack * 7}
            r={id === focus ? 6.5 : 5}
            className={`income-marker owner-${id} ${id === focus ? 'focus' : ''}`}
          >
            <title>{`Income ${brass.incomeLevel(space) >= 0 ? '+' : ''}${brass.incomeLevel(space)} (space ${space})`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
