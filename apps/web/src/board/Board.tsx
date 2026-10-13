import { brass } from '@brass/engine';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import type { Highlights } from '../game/draft.ts';
import { INDUSTRY_NAME, roman } from '../game/labels.ts';
import { IndustryIcon } from '../ui/icons.tsx';

/**
 * Board canvas: an SVG in map coordinates (0–1000), wrapped in pinch-zoom/pan.
 * Every location and link is its own element so it can be tapped and
 * highlighted.
 */
export const BOARD_SIZE = 1000;

const SLOT = 36;
const GAP = 5;

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

/** Grid of a town's spaces: one row for up to 2, otherwise 2 columns (a 2×2 grid for 3–4). */
function slotLayout(count: number) {
  const cols = count <= 2 ? count : 2;
  const rows = Math.ceil(count / cols);
  return { cols, rows, width: cols * SLOT + (cols - 1) * GAP, height: rows * SLOT + (rows - 1) * GAP };
}

function slotPosition(i: number, count: number) {
  const { cols, width } = slotLayout(count);
  const row = Math.floor(i / cols);
  const col = i % cols;
  // A lone space on the last row is centred under the ones above.
  const inRow = Math.min(cols, count - row * cols);
  const rowWidth = inRow * SLOT + (inRow - 1) * GAP;
  return { x: (width - rowWidth) / 2 + col * (SLOT + GAP), y: row * (SLOT + GAP) };
}

/** Icons for an empty space: one large icon, or two smaller ones for a shared space. */
function SlotIcons({ slot }: { slot: brass.Slot }) {
  if (slot.length === 1) return <IndustryIcon industry={slot[0]!} size={24} x={(SLOT - 24) / 2} y={(SLOT - 24) / 2} />;
  return (
    <>
      <IndustryIcon industry={slot[0]!} size={17} x={2} y={2} />
      <path d={`M ${SLOT - 9} 9 L 9 ${SLOT - 9}`} className="slot-divider" />
      <IndustryIcon industry={slot[1]!} size={17} x={SLOT - 19} y={SLOT - 19} />
    </>
  );
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
  const { width, height } = slotLayout(slots.length);
  return (
    <g transform={`translate(${x - width / 2} ${y - height / 2})`}>
      {slots.map((slot, i) => {
        const key = brass.slotKey(location, i);
        const tile = tiles[key];
        const lit = highlights.slots.has(key);
        const selected = highlights.selectedSlots.has(key);
        const cls = ['slot', tile ? `owner-${tile.owner}` : '', tile?.flipped ? 'flipped' : '', lit ? 'lit' : '', selected ? 'selected' : '']
          .filter(Boolean)
          .join(' ');
        const pos = slotPosition(i, slots.length);
        return (
          <g
            key={i}
            transform={`translate(${pos.x} ${pos.y})`}
            className={lit ? 'tappable' : undefined}
            onClick={lit ? () => onSlot?.(location, i) : undefined}
          >
            <title>{tile ? `${INDUSTRY_NAME[tile.industry]} ${roman(tile.level)}` : slot.map((ind) => INDUSTRY_NAME[ind]).join(' or ')}</title>
            {/* Generous invisible hit area for fingers. */}
            {lit && <rect x={-6} y={-6} width={SLOT + 12} height={SLOT + 12} className="hit" />}
            <rect width={SLOT} height={SLOT} rx={4} className={cls} />
            {tile ? (
              <g className="tile-face">
                <IndustryIcon industry={tile.industry} size={20} x={(SLOT - 20) / 2} y={3} />
                <text x={SLOT / 2} y={SLOT - 7} className="tile-level">
                  {roman(tile.level)}
                </text>
                {tile.cubes > 0 && (
                  <g transform={`translate(${SLOT - 4} 4)`}>
                    <circle r={7} className={`cube cube-${tile.industry}`} />
                    <text className="cube-count">{tile.cubes}</text>
                  </g>
                )}
              </g>
            ) : (
              <g className="slot-icons">
                <SlotIcons slot={slot} />
              </g>
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
    <TransformWrapper minScale={1} maxScale={6} doubleClick={{ mode: 'zoomIn' }}>
      <TransformComponent wrapperClass="board-viewport" contentClass="board-content">
        <svg
          className="board-svg"
          viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`}
          // Pin the map to the top: the hand covers the bottom of the screen.
          preserveAspectRatio="xMidYMin meet"
          role="img"
          aria-label="Game board"
        >
          <defs>
            <pattern id="awning-stripes" width="12" height="12" patternUnits="userSpaceOnUse">
              <rect width="6" height="12" fill="var(--stall-stripe)" />
              <rect x="6" width="6" height="12" fill="var(--token)" />
            </pattern>
          </defs>
          <rect width={BOARD_SIZE} height={BOARD_SIZE} className="board-bg" />
          <image href="/board-bg.webp" width={BOARD_SIZE} height={BOARD_SIZE} preserveAspectRatio="xMidYMid slice" />
          {/* Softens the art so links, spaces and labels stay readable on top of it. */}
          <rect width={BOARD_SIZE} height={BOARD_SIZE} className="board-wash" />

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
                    <text
                      x={loc.pos.x}
                      y={loc.pos.y + slotLayout(loc.slots.length).height / 2 + 13}
                      className={`location-name banner-${loc.color}`}
                    >
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

const BONUS_LABEL = (bonus: brass.MerchantBeerBonus): string => {
  switch (bonus.type) {
    case 'develop':
      return 'Develop';
    case 'income':
      return `+${bonus.spaces} income`;
    case 'vp':
      return `+${bonus.amount} VP`;
    case 'money':
      return `+£${bonus.amount}`;
  }
};

const TOKEN_R = 16;
/** Horizontal room per merchant tile: its token plus the beer barrel beside it. */
const SPACE_WIDTH = 58;

/** A merchant tile: a round trade token showing the goods it buys. */
function TradeToken({ cx, cy, industries }: { cx: number; cy: number; industries: readonly brass.Industry[] | null }) {
  const icons = industries ?? [];
  const size = icons.length === 1 ? 21 : 13;
  // One icon centred; three in a small triangle.
  const spots =
    icons.length === 1
      ? [[0, 0]]
      : [
          [0, -6],
          [-6.5, 5],
          [6.5, 5],
        ];
  return (
    <g className={`trade-token ${icons.length === 0 ? 'blank' : ''}`}>
      <circle cx={cx} cy={cy} r={TOKEN_R} />
      {icons.map((ind, i) => (
        <IndustryIcon
          key={ind}
          industry={ind}
          size={size}
          x={cx + spots[i]![0]! - size / 2}
          y={cy + spots[i]![1]! - size / 2}
        />
      ))}
    </g>
  );
}

/**
 * A merchant drawn as a market stall: a striped awning over the name, a trade
 * token per merchant tile (the goods it buys), a barrel beside each token
 * that still has beer, and the beer bonus on a tag below.
 */
function MerchantMarker({ loc, spaces }: { loc: brass.MerchantDef; spaces: brass.MerchantSpace[] }) {
  const open = spaces.some((s) => s.tile !== null);
  const n = loc.spaces;
  const width = Math.max(92, n * SPACE_WIDTH + 16);
  const { x, y } = loc.pos;
  const left = x - width / 2;
  const top = y - 30;
  const awning = 10;
  const scallops = Math.round(width / 12);
  const scallopW = width / scallops;
  const tokensY = y + 10;
  return (
    <g className={`merchant-stall ${open ? '' : 'closed'}`}>
      <title>
        {open
          ? `${loc.name} merchant. Selling here with its beer gives: ${BONUS_LABEL(loc.beerBonus)}`
          : `${loc.name} merchant (not used with this many players)`}
      </title>
      {/* Stall body */}
      <rect x={left} y={top + awning - 2} width={width} height={56} rx={5} className="stall-body" />
      {/* Striped awning with a scalloped edge */}
      <g clipPath={`url(#awning-${loc.id})`}>
        <rect x={left - 2} y={top - 2} width={width + 4} height={awning + 8} className="stall-awning" />
      </g>
      <clipPath id={`awning-${loc.id}`}>
        <rect x={left - 2} y={top - 2} width={width + 4} height={awning + 2} rx={4} />
        {Array.from({ length: scallops }, (_, i) => (
          <circle key={i} cx={left + scallopW * (i + 0.5)} cy={top + awning} r={scallopW / 2} />
        ))}
      </clipPath>
      <text x={x} y={top + awning + 8} className="stall-name">
        {loc.name}
      </text>
      {open ? (
        <>
          {spaces.map((space, i) => {
            const cx = x - ((n - 1) * SPACE_WIDTH) / 2 + i * SPACE_WIDTH - 8;
            return (
              <g key={i}>
                <TradeToken cx={cx} cy={tokensY} industries={space.tile?.industries ?? null} />
                <g className={`stall-beer ${space.beer ? '' : 'empty'}`}>
                  <IndustryIcon industry="brewery" size={17} x={cx + TOKEN_R + 2} y={tokensY - 8.5} />
                </g>
              </g>
            );
          })}
          <g className="stall-bonus">
            <rect x={x - 42} y={top + 66} width={84} height={20} rx={10} />
            <IndustryIcon industry="brewery" size={13} x={x - 36} y={top + 69.5} />
            <text x={x + 6} y={top + 76}>
              {BONUS_LABEL(loc.beerBonus)}
            </text>
          </g>
        </>
      ) : (
        <text x={x} y={tokensY} className="stall-closed">
          closed
        </text>
      )}
    </g>
  );
}
