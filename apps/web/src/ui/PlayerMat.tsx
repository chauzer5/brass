import { brass } from '@brass/engine';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { INDUSTRY_NAME, roman } from '../game/labels.ts';
import { IndustryIcon } from './icons.tsx';

/** Small resource glyphs, drawn to match the cubes and barrels on the board. */
function Glyph({ kind }: { kind: 'coal' | 'iron' | 'beer' | 'link' }) {
  return (
    <svg className={`glyph glyph-${kind}`} viewBox="0 0 12 12" width={11} height={11} aria-hidden>
      {kind === 'beer' ? (
        <>
          <rect x={2} y={1} width={8} height={10} rx={3} />
          <path d="M2 4.5h8M2 7.5h8" className="glyph-band" />
        </>
      ) : kind === 'link' ? (
        <>
          <path d="M2.5 9.5 9.5 2.5" className="glyph-line" />
          <circle cx={2.5} cy={9.5} r={2} />
          <circle cx={9.5} cy={2.5} r={2} />
        </>
      ) : (
        <rect x={1.5} y={1.5} width={9} height={9} rx={1.5} />
      )}
    </svg>
  );
}

/** What a tile costs to build, and what it's worth once flipped. */
export function TileStats({ tile }: { tile: brass.TileLevel }) {
  return (
    <span className="tile-stats">
      <span className="tile-cost">
        £{tile.cost}
        {tile.coal > 0 && (
          <span className="stat">
            <Glyph kind="coal" />
            {tile.coal}
          </span>
        )}
        {tile.iron > 0 && (
          <span className="stat">
            <Glyph kind="iron" />
            {tile.iron}
          </span>
        )}
        {tile.beer > 0 && (
          <span className="stat" title="Beer to sell">
            sell <Glyph kind="beer" />
            {tile.beer}
          </span>
        )}
      </span>
      <span className="tile-reward">
        {tile.vp} VP · +{tile.income}
        <span className="stat" title="Link VPs">
          <Glyph kind="link" />
          {tile.linkVP}
        </span>
      </span>
    </span>
  );
}

/**
 * Tiles left per level once `take` tiles are removed from the lowest levels
 * up (as Develop removes them), and how many go from each level.
 */
function afterRemoving(left: readonly number[], take: number) {
  const remaining = [...left];
  const removed = left.map(() => 0);
  for (let i = 0; i < remaining.length && take > 0; i++) {
    const n = Math.min(remaining[i]!, take);
    remaining[i]! -= n;
    removed[i]! += n;
    take -= n;
  }
  return { remaining, removed };
}

/** A note when the next tile can't be built in this era. */
function eraNote(tile: brass.TileLevel, era: brass.Era): string | null {
  if (tile.canalOnly && era === 'rail') return 'Canal Era only: develop it';
  if (tile.railOnly && era === 'canal') return 'Rail Era only';
  return null;
}

/** A mouse (or trackpad) can hover: levels show their tile when pointed at, rather than held. */
const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/** Holding a level box this long shows that level's tile in place of the next one. */
const HOLD_MS = 250;
/** A finger that moves further than this (px) before the hold kicks in is a scroll, not a hold. */
const HOLD_SLOP = 10;

type Inspect = { industry: brass.Industry; level: number };

/** The level box under a point on screen, if any. */
function levelAt(x: number, y: number): Inspect | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-level]');
  return el ? { industry: el.dataset.industry as brass.Industry, level: Number(el.dataset.level) } : null;
}

/**
 * Hold a level box to see that level's tile; slide to look along the row or
 * across rows, like fanning through the hand. The release isn't a tap.
 */
function useInspect() {
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const hold = useRef<{ x: number; y: number; timer: number } | null>(null);
  const swallowClick = useRef(false);
  const end = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
    setInspect(null);
  };
  const handlers = {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      swallowClick.current = false;
      const start = levelAt(e.clientX, e.clientY);
      // A mouse sees levels on hover (below), so a click is just a click.
      if (!start || e.button !== 0 || e.pointerType === 'mouse') return;
      const target = e.currentTarget;
      const { pointerId } = e;
      const timer = window.setTimeout(() => {
        target.setPointerCapture(pointerId);
        swallowClick.current = true;
        setInspect(start);
        navigator.vibrate?.(8);
      }, HOLD_MS);
      hold.current = { x: e.clientX, y: e.clientY, timer };
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      // With a mouse, the level under the pointer shows its tile.
      if (e.pointerType === 'mouse') {
        const at = levelAt(e.clientX, e.clientY);
        if (at?.industry !== inspect?.industry || at?.level !== inspect?.level) setInspect(at);
        return;
      }
      const h = hold.current;
      if (!h) return;
      if (!inspect) {
        if (Math.hypot(e.clientX - h.x, e.clientY - h.y) > HOLD_SLOP) end();
        return;
      }
      const at = levelAt(e.clientX, e.clientY);
      if (at && (at.industry !== inspect.industry || at.level !== inspect.level)) {
        setInspect(at);
        navigator.vibrate?.(4);
      }
    },
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => e.pointerType !== 'mouse' && end(),
    onPointerCancel: end,
    onPointerLeave: (e: PointerEvent<HTMLDivElement>) => e.pointerType === 'mouse' && end(),
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
    onClickCapture: (e: { stopPropagation: () => void }) => {
      // The release that ends a hold shouldn't also pick a row.
      if (swallowClick.current) {
        swallowClick.current = false;
        e.stopPropagation();
      }
    },
  };
  return { inspect, handlers };
}

/**
 * A player's mat: for each industry, the tiles left at each level (the next
 * one to build is outlined) and the stats of that next tile. Holding a
 * level shows that level's stats instead.
 */
export function PlayerMat({
  player,
  era,
  picks,
  selectable,
  onRow,
  onUnpick,
}: {
  player: brass.PlayerView;
  era: brass.Era;
  /** While developing: the industries picked for removal, in order. Each takes that industry's lowest tile. */
  picks?: readonly brass.Industry[] | undefined;
  /** While developing: industries that can take another removal; their rows light up. */
  selectable?: ReadonlySet<brass.Industry> | undefined;
  onRow?: ((industry: brass.Industry) => void) | undefined;
  /** Undo the pick at this index of `picks`. */
  onUnpick?: ((index: number) => void) | undefined;
}) {
  const choosing = selectable !== undefined;
  const { inspect, handlers } = useInspect();
  return (
    <div className={`player-mat ${choosing ? 'choosing' : ''}`} {...handlers}>
      {brass.INDUSTRIES.map((industry) => {
        const levels = brass.INDUSTRY_TILES[industry];
        // Picks of this industry, numbered in the order they were made.
        const order = (picks ?? []).flatMap((ind, i) => (ind === industry ? [i] : []));
        const { remaining, removed } = afterRemoving(player.mat[industry], order.length);
        const nextIndex = remaining.findIndex((n) => n > 0);
        const next = nextIndex < 0 ? null : nextIndex + 1;
        const held = inspect?.industry === industry ? inspect.level : null;
        const heldTile = held ? levels[held - 1]! : null;
        const tile = next ? levels[next - 1]! : null;
        const note = tile && eraNote(tile, era);
        const lit = selectable?.has(industry) ?? false;
        const marked = removed.some((n) => n > 0);
        const tappable = onRow && (lit || marked);
        return (
          <div
            key={industry}
            className={`mat-row ${lit ? 'lit' : ''} ${marked ? 'marked' : ''} ${choosing && !lit && !marked ? 'inactive' : ''}`}
            {...(tappable && {
              role: 'button',
              tabIndex: 0,
              'aria-label': lit ? `Develop ${INDUSTRY_NAME[industry]}` : `Keep ${INDUSTRY_NAME[industry]}`,
              onClick: () => onRow(industry),
              onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onRow(industry);
                }
              },
            })}
          >
            <span className="mat-icon" title={INDUSTRY_NAME[industry]}>
              <IndustryIcon industry={industry} size={22} />
            </span>
            <span className="mat-track">
              {levels.map((def) => {
                const left = player.mat[industry][def.level - 1] ?? 0;
                const going = removed[def.level - 1] ?? 0;
                // The picks that take a tile from this level: the lowest levels go first.
                const before = removed.slice(0, def.level - 1).reduce((a, n) => a + n, 0);
                const pickHere = order.slice(before, before + going);
                return (
                  <span
                    key={def.level}
                    data-industry={industry}
                    data-level={def.level}
                    className={`mat-level ${left === 0 ? 'gone' : ''} ${going ? 'removing' : ''} ${def.level === next ? 'next' : ''} ${
                      def.level === held ? 'held' : ''
                    } ${
                      def.canalOnly ? 'canal-only' : def.railOnly ? 'rail-only' : ''
                    }`}
                    title={`${INDUSTRY_NAME[industry]} ${roman(def.level)}: ${left} of ${def.count} left`}
                  >
                    {roman(def.level)}
                    <span className="mat-pips">
                      {Array.from({ length: def.count }, (_, i) => (
                        // The lowest of a level's remaining tiles go first.
                        <span key={i} className={i >= left ? 'pip used' : i >= left - going ? 'pip going' : 'pip'} />
                      ))}
                    </span>
                    {def.cannotDevelop && <span className="mat-bulb" title="Can't be developed" />}
                    {pickHere.length > 0 && (
                      <span className="mat-picks">
                        {pickHere.map((i) => (
                          <button
                            key={i}
                            className="mat-pick"
                            aria-label={`Undo pick ${i + 1}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onUnpick?.(i);
                            }}
                          >
                            {i + 1}
                          </button>
                        ))}
                      </span>
                    )}
                  </span>
                );
              })}
            </span>
            <span className={`mat-next ${heldTile ? 'held' : ''}`}>
              {heldTile && (
                // Drawn over the next tile's stats, so the row keeps its height while sliding.
                <span className="mat-held-card">
                  <span className="mat-held-label">
                    {/* The row already says which industry; keep the label short so the card stays clear of the boxes. */}
                    Level {roman(heldTile.level)} · {player.mat[industry][heldTile.level - 1] ?? 0} of {heldTile.count} left
                  </span>
                  <TileStats tile={heldTile} />
                  {[
                    heldTile.canalOnly && 'Canal Era only',
                    heldTile.railOnly && 'Rail Era only',
                    heldTile.cannotDevelop && "Can't be developed",
                  ]
                    .filter(Boolean)
                    .map((n) => (
                      <span key={n as string} className="mat-note">
                        {n}
                      </span>
                    ))}
                </span>
              )}
              {tile ? (
                <>
                  <TileStats tile={tile} />
                  {note && <span className="mat-note">{note}</span>}
                </>
              ) : (
                <span className="muted">All built</span>
              )}
            </span>
          </div>
        );
      })}
      <p className="mat-footer">
        <span>
          <Glyph kind="link" /> {player.linksInSupply} link tiles left
        </span>
        <span>{canHover ? 'Point at a level to see its tile' : 'Hold a level to see its tile'}</span>
        <span className="mat-legend">
          <span className="legend-swatch canal-only" /> Canal only
          <span className="legend-swatch rail-only" /> Rail only
          <span className="mat-bulb inline" /> Can't develop
        </span>
      </p>
    </div>
  );
}
