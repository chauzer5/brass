import { brass } from '@brass/engine';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';

/**
 * Board canvas: an SVG in map coordinates (0–1000), wrapped in pinch-zoom/pan.
 * Every location and link is its own element so it can be tapped and
 * highlighted once actions are wired up.
 */
export const BOARD_SIZE = 1000;

const SLOT = 30;
const GAP = 4;

const INDUSTRY_LABEL: Record<brass.Industry, string> = {
  cotton: 'Co',
  manufacturer: 'Mf',
  pottery: 'Po',
  coal: 'Cl',
  iron: 'Ir',
  brewery: 'Br',
};

function linkPath(ends: readonly brass.LocationId[]): string {
  const [a, b, c] = ends.map((id) => brass.LOCATION_BY_ID[id].pos);
  if (!c) return `M ${a!.x} ${a!.y} L ${b!.x} ${b!.y}`;
  // The 3-way line: Kidderminster–Worcester with a spur to the farm brewery.
  const mx = (a!.x + b!.x) / 2;
  const my = (a!.y + b!.y) / 2;
  return `M ${a!.x} ${a!.y} L ${b!.x} ${b!.y} M ${mx} ${my} L ${c.x} ${c.y}`;
}

function Slots({ slots, x, y }: { slots: readonly brass.Slot[]; x: number; y: number }) {
  const width = slots.length * SLOT + (slots.length - 1) * GAP;
  return (
    <g transform={`translate(${x - width / 2} ${y - SLOT / 2})`}>
      {slots.map((slot, i) => (
        <g key={i} transform={`translate(${i * (SLOT + GAP)} 0)`}>
          <rect width={SLOT} height={SLOT} rx={4} className="slot" />
          <text x={SLOT / 2} y={SLOT / 2} className="slot-label">
            {slot.map((ind) => INDUSTRY_LABEL[ind]).join('/')}
          </text>
        </g>
      ))}
    </g>
  );
}

export function Board() {
  return (
    <TransformWrapper minScale={1} maxScale={6} doubleClick={{ mode: 'zoomIn' }} centerOnInit>
      <TransformComponent wrapperClass="board-viewport" contentClass="board-content">
        <svg className="board-svg" viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`} role="img" aria-label="Game board">
          <rect width={BOARD_SIZE} height={BOARD_SIZE} className="board-bg" />

          {brass.LINKS.map((l) => (
            <g key={l.id} data-link={l.id}>
              {l.canal && <path d={linkPath(l.ends)} className="link link-canal" />}
              {l.rail && <path d={linkPath(l.ends)} className={l.canal ? 'link link-rail link-both' : 'link link-rail'} />}
            </g>
          ))}

          {brass.LOCATIONS.map((loc) => (
            <g key={loc.id} data-location={loc.id}>
              {loc.kind === 'merchant' ? (
                <>
                  <rect x={loc.pos.x - 48} y={loc.pos.y - 16} width={96} height={32} rx={6} className="merchant" />
                  <text x={loc.pos.x} y={loc.pos.y} className="location-name">
                    {loc.name}
                  </text>
                </>
              ) : (
                <>
                  <Slots slots={loc.slots} x={loc.pos.x} y={loc.pos.y} />
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
