import { brass } from '@brass/engine';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import type { Highlights } from '../game/draft.ts';
import { INDUSTRY_SHORT, roman } from '../game/labels.ts';

/**
 * Board canvas: an SVG in map coordinates (0–1000), wrapped in pinch-zoom/pan.
 * Every location and link is its own element so it can be tapped and
 * highlighted.
 */
export const BOARD_SIZE = 1000;

const SLOT = 30;
const GAP = 4;

const NO_HIGHLIGHTS: Highlights = { slots: new Set(), links: new Set(), selectedSlots: new Set(), selectedLinks: new Set() };

interface BoardProps {
  state?: Pick<brass.BrassView, 'tiles' | 'links' | 'merchants'>;
  highlights?: Highlights | undefined;
  onSlot?: (location: brass.LocationId, slot: number) => void;
  onLink?: (id: string) => void;
}

function linkPath(ends: readonly brass.LocationId[]): string {
  const [a, b, c] = ends.map((id) => brass.LOCATION_BY_ID[id].pos);
  if (!c) return `M ${a!.x} ${a!.y} L ${b!.x} ${b!.y}`;
  // The 3-way line: Kidderminster–Worcester with a spur to the farm brewery.
  const mx = (a!.x + b!.x) / 2;
  const my = (a!.y + b!.y) / 2;
  return `M ${a!.x} ${a!.y} L ${b!.x} ${b!.y} M ${mx} ${my} L ${c.x} ${c.y}`;
}

function Slots({
  location,
  slots,
  x,
  y,
  tiles,
  highlights,
  onSlot,
}: {
  location: brass.LocationId;
  slots: readonly brass.Slot[];
  x: number;
  y: number;
  tiles: brass.BrassView['tiles'];
  highlights: Highlights;
  onSlot: BoardProps['onSlot'];
}) {
  const width = slots.length * SLOT + (slots.length - 1) * GAP;
  return (
    <g transform={`translate(${x - width / 2} ${y - SLOT / 2})`}>
      {slots.map((slot, i) => {
        const key = brass.slotKey(location, i);
        const tile = tiles[key];
        const lit = highlights.slots.has(key);
        const selected = highlights.selectedSlots.has(key);
        const cls = ['slot', tile ? `owner-${tile.owner}` : '', tile?.flipped ? 'flipped' : '', lit ? 'lit' : '', selected ? 'selected' : '']
          .filter(Boolean)
          .join(' ');
        return (
          <g
            key={i}
            transform={`translate(${i * (SLOT + GAP)} 0)`}
            className={lit ? 'tappable' : undefined}
            onClick={lit ? () => onSlot?.(location, i) : undefined}
          >
            {/* Generous invisible hit area for fingers. */}
            {lit && <rect x={-6} y={-6} width={SLOT + 12} height={SLOT + 12} className="hit" />}
            <rect width={SLOT} height={SLOT} rx={4} className={cls} />
            {tile ? (
              <>
                <text x={SLOT / 2} y={SLOT / 2 - 5} className="tile-label">
                  {INDUSTRY_SHORT[tile.industry]}
                </text>
                <text x={SLOT / 2} y={SLOT / 2 + 7} className="tile-level">
                  {roman(tile.level)}
                </text>
                {tile.cubes > 0 && (
                  <g transform={`translate(${SLOT - 4} 4)`}>
                    <circle r={6} className={`cube cube-${tile.industry}`} />
                    <text className="cube-count">{tile.cubes}</text>
                  </g>
                )}
              </>
            ) : (
              <text x={SLOT / 2} y={SLOT / 2} className="slot-label">
                {slot.map((ind) => INDUSTRY_SHORT[ind]).join('/')}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

export function Board({ state, highlights = NO_HIGHLIGHTS, onSlot, onLink }: BoardProps) {
  const tiles = state?.tiles ?? {};
  const links = state?.links ?? {};
  return (
    <TransformWrapper minScale={1} maxScale={6} doubleClick={{ mode: 'zoomIn' }} centerOnInit>
      <TransformComponent wrapperClass="board-viewport" contentClass="board-content">
        <svg className="board-svg" viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`} role="img" aria-label="Game board">
          <rect width={BOARD_SIZE} height={BOARD_SIZE} className="board-bg" />

          {brass.LINKS.map((l) => {
            const owner = links[l.id];
            const lit = highlights.links.has(l.id);
            const selected = highlights.selectedLinks.has(l.id);
            const d = linkPath(l.ends);
            return (
              <g
                key={l.id}
                data-link={l.id}
                className={lit ? 'tappable' : undefined}
                onClick={lit ? () => onLink?.(l.id) : undefined}
              >
                {l.canal && <path d={d} className="link link-canal" />}
                {l.rail && <path d={d} className={l.canal ? 'link link-rail link-both' : 'link link-rail'} />}
                {owner !== undefined && <path d={d} className={`link link-owned owner-${owner}`} />}
                {(lit || selected) && <path d={d} className={selected ? 'link link-selected' : 'link link-lit'} />}
                {lit && <path d={d} className="link link-hit" />}
              </g>
            );
          })}

          {brass.LOCATIONS.map((loc) => (
            <g key={loc.id} data-location={loc.id}>
              {loc.kind === 'merchant' ? (
                <MerchantMarker loc={loc} spaces={state?.merchants.filter((m) => m.location === loc.id) ?? []} />
              ) : (
                <>
                  <Slots
                    location={loc.id}
                    slots={loc.slots}
                    x={loc.pos.x}
                    y={loc.pos.y}
                    tiles={tiles}
                    highlights={highlights}
                    onSlot={onSlot}
                  />
                  {loc.kind === 'town' && (
                    <text x={loc.pos.x} y={loc.pos.y + SLOT / 2 + 12} className={`location-name banner-${loc.color}`}>
                      {loc.name}
                    </text>
                  )}
                </>
              )}
            </g>
          ))}
        </svg>
      </TransformComponent>
    </TransformWrapper>
  );
}

function MerchantMarker({ loc, spaces }: { loc: brass.MerchantDef; spaces: brass.MerchantSpace[] }) {
  const goods = spaces
    .map((s) => (s.tile ? (s.tile.industries.length ? s.tile.industries.map((i) => INDUSTRY_SHORT[i]).join('/') : '—') : null))
    .filter((g) => g !== null);
  const beer = spaces.filter((s) => s.beer).length;
  return (
    <g>
      <rect x={loc.pos.x - 52} y={loc.pos.y - 20} width={104} height={40} rx={6} className="merchant" />
      <text x={loc.pos.x} y={loc.pos.y - 7} className="location-name">
        {loc.name}
      </text>
      <text x={loc.pos.x} y={loc.pos.y + 9} className="merchant-goods">
        {goods.length ? goods.join(' · ') : 'no merchants'}
        {beer > 0 ? ` · ${'🍺'.repeat(beer)}` : ''}
      </text>
    </g>
  );
}
