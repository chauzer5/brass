import { brass } from '@brass/engine';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
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
  state?: Pick<brass.BrassView, 'tiles' | 'links' | 'merchants' | 'coalMarket' | 'ironMarket' | 'players' | 'turnOrder' | 'turnIndex' | 'phase' | 'deckSize' | 'era'>;
  /** Player names, for the turn order panel. */
  names?: readonly string[] | undefined;
  /** Tapping the discard pile. */
  onDiscards?: (() => void) | undefined;
  /** A sale to the coal or iron market to animate. */
  sale?: MarketSale | null | undefined;
  /** Holding a space that isn't lit asks why it can't be used; null means there's nothing to say. */
  explainSlot?: ((location: brass.LocationId, slot: number) => string | null) | undefined;
  highlights?: Highlights | undefined;
  onSlot?: (location: brass.LocationId, slot: number) => void;
  onLink?: (id: string) => void;
  /** Tapping the coal or iron market, when it's lit as a source. */
  onMarket?: ((kind: 'coal' | 'iron') => void) | undefined;
  /** Tapping a lit Merchant: to sell to it, or for its beer. */
  onMerchant?: ((location: brass.LocationId) => void) | undefined;
  /**
   * Pan and zoom to this location. `key` re-triggers the move when the same
   * location is asked for again (e.g. a different card for the same town).
   */
  focus?: { location: brass.LocationId; key: string } | null | undefined;
  /** Pan and zoom to fit a box of the map (in map units); `key` re-triggers it. */
  frame?: { box: MapBox; key: string } | null | undefined;
  /** Whether the action rail is over the board's right edge (the map can then be dragged out from under it). */
  rail?: boolean;
}

/** Holding a space this long explains why it can't be built on; moving further than the slop is a pan instead. */
const HOLD_MS = 400;
const HOLD_SLOP = 10;

/** How far to zoom in on a focused location. */
const FOCUS_SCALE = 2.6;
/** The map never zooms out past this (matches the TransformWrapper). */
const MIN_SCALE = 1;
/** Width of the action rail floating over the board's right edge. */
const RAIL_WIDTH = 76;

function linkPath(ends: readonly brass.LocationId[]): string {
  const [a, b, c] = ends.map((id) => brass.LOCATION_BY_ID[id].pos);
  if (!c) return `M ${a!.x} ${a!.y} L ${b!.x} ${b!.y}`;
  // The 3-way line: Kidderminster–Worcester with a spur to the farm brewery.
  const mx = (a!.x + b!.x) / 2;
  const my = (a!.y + b!.y) / 2;
  return `M ${a!.x} ${a!.y} L ${b!.x} ${b!.y} M ${mx} ${my} L ${c.x} ${c.y}`;
}

/** The box a location takes up on the map, relative to its position (spaces, ribbon, or merchant stall). */
function footprint(id: brass.LocationId) {
  const loc = brass.LOCATION_BY_ID[id];
  const pad = 6;
  if (loc.kind === 'merchant') {
    const width = Math.max(92, loc.spaces * SPACE_WIDTH + 16);
    return { left: -width / 2 - pad, right: width / 2 + pad, top: -30 - pad, bottom: 52 + pad };
  }
  const { width, height } = slotLayout(loc.slots.length);
  // Towns have a name ribbon below their spaces.
  const below = loc.kind === 'town' ? height / 2 + 22 : height / 2;
  return { left: -width / 2 - pad, right: width / 2 + pad, top: -height / 2 - pad, bottom: below + pad };
}

/**
 * Where a link's token sits: the middle of the longest stretch of the line
 * that isn't under either end's spaces, so it never covers a town.
 */
function tokenSpot(ends: readonly brass.LocationId[]): { x: number; y: number } {
  const [a, b] = ends.slice(0, 2).map((id) => ({ pos: brass.LOCATION_BY_ID[id].pos, box: footprint(id) }));
  const inside = (p: { x: number; y: number }, e: typeof a) =>
    p.x > e!.pos.x + e!.box.left && p.x < e!.pos.x + e!.box.right && p.y > e!.pos.y + e!.box.top && p.y < e!.pos.y + e!.box.bottom;
  const at = (t: number) => ({ x: a!.pos.x + (b!.pos.x - a!.pos.x) * t, y: a!.pos.y + (b!.pos.y - a!.pos.y) * t });
  let best = { from: 0.5, to: 0.5 };
  let start: number | null = null;
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    const clear = !inside(at(t), a) && !inside(at(t), b);
    if (clear && start === null) start = t;
    if ((!clear || i === 100) && start !== null) {
      const end = clear ? t : (i - 1) / 100;
      if (end - start > best.to - best.from) best = { from: start, to: end };
      start = null;
    }
  }
  return at((best.from + best.to) / 2);
}

/** Token positions, worked out on first use (they depend on layout constants defined further down). */
let tokenSpots: Map<string, { x: number; y: number }> | null = null;
const spotFor = (id: string) => (tokenSpots ??= new Map(brass.LINKS.map((l) => [l.id, tokenSpot(l.ends)]))).get(id)!;
const TOKEN_W = 29;
const TOKEN_H = 22;
const TOKEN_ICON = 1.25;

/** A claimed link's piece: a boat in the Canal Era, a train in the Rail Era, in its owner's colour. */
function LinkToken({ id, owner, rail }: { id: string; owner: number; rail: boolean }) {
  const { x, y } = spotFor(id);
  return (
    <g className={`link-token owner-${owner}`} transform={`translate(${x - TOKEN_W / 2} ${y - TOKEN_H / 2})`}>
      <rect width={TOKEN_W} height={TOKEN_H} rx={5} className="link-token-bg" />
      <g
        transform={`translate(${(TOKEN_W - 16 * TOKEN_ICON) / 2} ${(TOKEN_H - 16 * TOKEN_ICON) / 2 + 0.5}) scale(${TOKEN_ICON})`}
        className="link-token-icon"
      >
        {rail ? (
          <>
            {/* Locomotive: boiler, cab, chimney and wheels. */}
            <rect x={1.5} y={6} width={9} height={5} rx={1} />
            <rect x={9.5} y={2.5} width={5} height={8.5} rx={0.8} />
            <rect x={3} y={2.5} width={2.2} height={3.5} />
            <circle cx={4} cy={13} r={1.9} />
            <circle cx={8.5} cy={13} r={1.9} />
            <circle cx={12.5} cy={13} r={1.9} />
          </>
        ) : (
          <>
            {/* Narrowboat: hull with a cabin. */}
            <path d="M0.5 9 H15.5 L13 13 H3 Z" />
            <rect x={5} y={5} width={7} height={4} rx={0.8} />
            <rect x={2.5} y={6.5} width={1.6} height={2.5} />
          </>
        )}
      </g>
    </g>
  );
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
  holdFor,
}: {
  location: brass.LocationId;
  slots: readonly brass.Slot[];
  x: number;
  y: number;
  tiles: brass.BrassView['tiles'];
  highlights: Highlights;
  onSlot: BoardProps['onSlot'];
  holdFor?: ((location: brass.LocationId, slot: number) => Record<string, (e: ReactPointerEvent) => void>) | undefined;
}) {
  const { width, height } = slotLayout(slots.length);
  return (
    <g transform={`translate(${x - width / 2} ${y - height / 2})`}>
      {slots.map((slot, i) => {
        const key = brass.slotKey(location, i);
        const tile = tiles[key];
        const lit = highlights.slots.has(key);
        const selected = highlights.selectedSlots.has(key);
        // A tile that can supply the coal, iron or beer being chosen.
        const source = highlights.sources?.has(key) ?? false;
        const sourceChosen = highlights.selectedSource === key;
        const tappable = lit || source;
        const cls = [
          'slot',
          tile ? `owner-${tile.owner}` : '',
          tile?.flipped ? 'flipped' : '',
          lit ? 'lit' : '',
          selected ? 'selected' : '',
          source ? 'source' : '',
          sourceChosen ? 'source-chosen' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const pos = slotPosition(i, slots.length);
        return (
          <g
            key={i}
            transform={`translate(${pos.x} ${pos.y})`}
            data-slot={i}
            className={tappable ? 'tappable' : undefined}
            onClick={tappable ? () => onSlot?.(location, i) : undefined}
            {...(!tappable && holdFor?.(location, i))}
          >
            <title>{tile ? `${INDUSTRY_NAME[tile.industry]} ${roman(tile.level)}` : slot.map((ind) => INDUSTRY_NAME[ind]).join(' or ')}</title>
            {/* Generous invisible hit area for fingers. */}
            {tappable && <rect x={-6} y={-6} width={SLOT + 12} height={SLOT + 12} className="hit" />}
            <rect width={SLOT} height={SLOT} rx={4} className={cls} />
            {tile ? (
              <g className={`tile-face ${tile.flipped ? 'flipped' : ''}`}>
                {/* Flipped tiles get a dark top band, like the black top half of a flipped tile. */}
                {tile.flipped && (
                  <path d={`M0 11 V4 a4 4 0 0 1 4 -4 H${SLOT - 4} a4 4 0 0 1 4 4 V11 Z`} className="tile-flip-band" />
                )}
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
            {/* A lit space that already has a tile is an overbuild: mark it, since the tile hides the highlight. */}
            {lit && tile && (
              <g className="overbuild-mark" transform={`translate(${SLOT - 7} ${SLOT - 7})`}>
                <circle r={7.5} />
                <path d="M0 4 V-3.5 M-3.2 -0.3 L0 -3.5 L3.2 -0.3" />
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}

export function Board({
  state,
  names,
  onDiscards,
  sale,
  explainSlot,
  highlights = NO_HIGHLIGHTS,
  onSlot,
  onLink,
  onMarket,
  onMerchant,
  focus,
  frame,
  rail = true,
}: BoardProps) {
  const tiles = state?.tiles ?? {};
  const links = state?.links ?? {};
  const zoom = useRef<ReactZoomPanPinchRef>(null);
  // Highlights are drawn in map units, so zoomed out they shrink to hairlines. --lit-k scales them up
  // to keep them at least as visible on screen as they are zoomed in (links grow half as much).
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomScale = useRef(1);
  const fitHighlights = () => {
    const svg = svgRef.current;
    if (!svg) return;
    // The map is drawn "meet" in the SVG's box, then zoomed.
    const pxPerUnit = (Math.min(svg.clientWidth, svg.clientHeight) / BOARD_SIZE) * zoomScale.current;
    if (!pxPerUnit) return;
    const k = Math.min(3, Math.max(1, 1 / pxPerUnit));
    svg.style.setProperty('--lit-k', k.toFixed(2));
    svg.style.setProperty('--link-k', (1 + (k - 1) / 2).toFixed(2));
  };
  useEffect(() => {
    fitHighlights();
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver(fitHighlights);
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  // Hold a space that isn't lit to see why: a bubble above the finger, gone on release.
  const [why, setWhy] = useState<{ text: string; x: number; y: number } | null>(null);
  const hold = useRef<{ x: number; y: number; timer: number } | null>(null);
  const endHold = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
    setWhy(null);
  };
  const holdFor = explainSlot
    ? (location: brass.LocationId, slot: number) => ({
        onPointerDown: (e: ReactPointerEvent) => {
          if (e.button !== 0) return;
          const { clientX: x, clientY: y } = e;
          const timer = window.setTimeout(() => {
            const text = explainSlot(location, slot);
            if (text) {
              setWhy({ text, x, y });
              navigator.vibrate?.(8);
            }
          }, HOLD_MS);
          hold.current = { x, y, timer };
        },
        onPointerMove: (e: ReactPointerEvent) => {
          const h = hold.current;
          if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > HOLD_SLOP) endHold();
        },
        onPointerUp: endHold,
        onPointerCancel: endHold,
      })
    : undefined;

  /**
   * Pans and zooms so a box of the map (in map units) sits in the middle of
   * the part of the board not covered by the rail or the hand, as large as fits
   * up to `maxScale`.
   */
  const showArea = (box: { x0: number; y0: number; x1: number; y1: number }, maxScale: number) => {
    const ref = zoom.current;
    const svg = ref?.instance.contentComponent?.querySelector('svg');
    const wrapper = ref?.instance.wrapperComponent;
    if (!ref || !svg || !wrapper) return;
    // Map units -> content pixels at scale 1 (the map is drawn "meet", pinned to the top).
    const svgW = svg.clientWidth;
    const svgH = svg.clientHeight;
    const unit = Math.min(svgW, svgH) / BOARD_SIZE;
    const offsetX = (svgW - BOARD_SIZE * unit) / 2;
    const view = wrapper.getBoundingClientRect();
    const tray = document.querySelector('.hand-tray')?.getBoundingClientRect();
    const visibleBottom = tray ? Math.min(view.bottom, tray.top) : view.bottom;
    // The tutorial's coach card covers the top of the board.
    const coach = document.querySelector('.coach')?.getBoundingClientRect();
    const visibleTop = coach ? Math.max(view.top, coach.bottom) : view.top;
    const availW = view.width - (rail ? RAIL_WIDTH : 0);
    const availH = visibleBottom - visibleTop;
    const boxW = Math.max(1, (box.x1 - box.x0) * unit);
    const boxH = Math.max(1, (box.y1 - box.y0) * unit);
    const scale = Math.max(MIN_SCALE, Math.min(maxScale, availW / boxW, availH / boxH));
    const px = offsetX + ((box.x0 + box.x1) / 2) * unit;
    const py = ((box.y0 + box.y1) / 2) * unit;
    // Never pan past the map's edges: when the box can't fit, show as much of it as the map allows.
    const content = ref.instance.contentComponent!;
    const clamp = (v: number, size: number, room: number) => Math.min(0, Math.max(room - size * scale, v));
    const x = clamp(availW / 2 - px * scale, content.offsetWidth, view.width);
    const y = clamp(visibleTop - view.top + availH / 2 - py * scale, content.offsetHeight, view.height);
    ref.setTransform(x, y, scale, 350, 'easeOut');
  };

  // Without the rail there's no room to drag into on the right: pull the map back if it's panned past its edge.
  useEffect(() => {
    if (rail) return;
    const ref = zoom.current;
    const content = ref?.instance.contentComponent;
    const wrapper = ref?.instance.wrapperComponent;
    if (!ref || !content || !wrapper) return;
    const { positionX, positionY, scale } = ref.instance.state;
    const minX = wrapper.offsetWidth - content.offsetWidth * scale;
    if (positionX < minX) ref.setTransform(minX, positionY, scale, 250, 'easeOut');
  }, [rail]);

  useEffect(() => {
    if (frame) showArea(frame.box, FOCUS_SCALE);
  }, [frame?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // A sale to the market: frame the new tile and the market together, so the cubes' whole flight is in view.
  useEffect(() => {
    if (!sale) return;
    const from = slotCenter(sale.location, sale.slot);
    const pad = 30;
    showArea(
      {
        x0: Math.min(from.x, MARKET.left) - pad,
        y0: Math.min(from.y, MARKET.top) - pad,
        x1: Math.max(from.x, MARKET.left + MARKET.width) + pad,
        y1: Math.max(from.y, marketRowY(1) + 40) + pad,
      },
      FOCUS_SCALE,
    );
  }, [sale?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Market spaces stay empty until their cube lands.
  const [landed, setLanded] = useState(0);
  useEffect(() => {
    setLanded(0);
    if (!sale) return;
    const timers = sale.spaces.map((_, i) => window.setTimeout(() => setLanded(i + 1), i * SALE_STAGGER + SALE_FLY));
    return () => timers.forEach(clearTimeout);
  }, [sale?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = sale && landed < sale.spaces.length ? { kind: sale.kind, spaces: new Set(sale.spaces.slice(landed)) } : undefined;

  useEffect(() => {
    if (!focus) return;
    const pos = brass.LOCATION_BY_ID[focus.location].pos;
    showArea({ x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y }, FOCUS_SCALE);
  }, [focus?.location, focus?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
    {why && (
      <div
        className="slot-why"
        role="tooltip"
        style={{ left: Math.min(Math.max(why.x, 128), window.innerWidth - 128), top: why.y - 28 }}
      >
        {why.text}
      </div>
    )}
    <TransformWrapper ref={zoom} minScale={MIN_SCALE} maxScale={6} doubleClick={{ mode: 'zoomIn' }} onTransform={(_, { scale }) => {
        zoomScale.current = scale;
        fitHighlights();
      }}>
      <TransformComponent wrapperClass={rail ? 'board-viewport' : 'board-viewport no-rail'} contentClass="board-content">
        <svg
          ref={svgRef}
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

          {state && (
            <Markets coal={state.coalMarket} iron={state.ironMarket} pending={pending} lit={highlights.market ?? null} onTap={onMarket} />
          )}
          {state && names && <TurnOrder state={state} names={names} />}
          {state && <Piles state={state} onDiscards={onDiscards} />}

          {/* Once a link is chosen, the other options fade so the choice stands out. */}
          <g className={highlights.selectedLinks.size > 0 ? 'links has-chosen' : 'links'}>
          {brass.LINKS.map((l) => {
            const owner = links[l.id];
            const lit = highlights.links.has(l.id);
            const selected = highlights.selectedLinks.has(l.id);
            const d = linkPath(l.ends);
            return (
              <g
                key={l.id}
                data-link={l.id}
                className={lit || selected ? 'tappable' : undefined}
                onClick={lit || selected ? () => onLink?.(l.id) : undefined}
              >
                {l.canal && <path d={d} className="link link-canal" />}
                {l.rail && <path d={d} className={l.canal ? 'link link-rail link-both' : 'link link-rail'} />}
                {owner !== undefined && <path d={d} className={`link link-owned owner-${owner}`} />}
                {/* Keep the railway visible on a claimed line, so a canal shows whether it can become a rail later. */}
                {owner !== undefined && l.rail && <path d={d} className="link link-rail link-rail-over" />}
                {(lit || selected) && <path d={d} className={selected ? 'link link-selected' : 'link link-lit'} />}
                {(lit || selected) && <path d={d} className="link link-hit" />}
              </g>
            );
          })}
          </g>

          {/* Claimed links' pieces, above every line so crossings never hide one. */}
          {Object.entries(links).map(([id, owner]) => (
            <LinkToken key={id} id={id} owner={owner} rail={state?.era === 'rail'} />
          ))}

          {brass.LOCATIONS.map((loc) => (
            <g key={loc.id} data-location={loc.id}>
              {loc.kind === 'merchant' ? (
                <MerchantMarker
                  loc={loc}
                  spaces={state?.merchants.filter((m) => m.location === loc.id) ?? []}
                  lit={highlights.merchants?.has(loc.id) ?? false}
                  chosen={highlights.selectedMerchant === loc.id}
                  onTap={onMerchant}
                />
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
                    holdFor={holdFor}
                  />
                  {loc.kind === 'town' && (
                    <TownBanner
                      name={loc.name}
                      color={loc.color}
                      x={loc.pos.x}
                      y={loc.pos.y + slotLayout(loc.slots.length).height / 2 + 13}
                    />
                  )}
                </>
              )}
            </g>
          ))}

          {/* Above everything, so the cubes fly over towns and links on their way to the market. */}
          {sale && <SaleAnimation key={sale.id} sale={sale} />}
        </svg>
      </TransformComponent>
    </TransformWrapper>
    </>
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
function MerchantMarker({
  loc,
  spaces,
  lit = false,
  chosen = false,
  onTap,
}: {
  loc: brass.MerchantDef;
  spaces: brass.MerchantSpace[];
  /** Tappable: a Merchant to sell to, or whose beer can be used. */
  lit?: boolean;
  chosen?: boolean;
  onTap?: ((location: brass.LocationId) => void) | undefined;
}) {
  const open = spaces.some((s) => s.tile !== null);
  const n = loc.spaces;
  const width = Math.max(92, n * SPACE_WIDTH + 16);
  const { x, y } = loc.pos;
  const left = x - width / 2;
  const top = y - 30;
  const awning = 10;
  const scallops = Math.round(width / 12);
  const scallopW = width / scallops;
  const tokensY = y + 14;
  return (
    <g
      className={`merchant-stall ${open ? '' : 'closed'} ${lit ? 'lit tappable' : ''} ${chosen ? 'chosen' : ''}`}
      onClick={lit ? () => onTap?.(loc.id) : undefined}
    >
      {(lit || chosen) && <rect x={left - 7} y={top - 7} width={width + 14} height={88} rx={10} className="stall-ring" />}
      <title>
        {open
          ? `${loc.name} merchant. Selling here with its beer gives: ${BONUS_LABEL(loc.beerBonus)}`
          : `${loc.name} merchant (not used with this many players)`}
      </title>
      {/* Stall body */}
      <rect x={left} y={top + awning - 2} width={width} height={60} rx={5} className="stall-body" />
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
      <text x={x} y={top + awning + 11} className="stall-name">
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
            <rect x={x - 42} y={top + 70} width={84} height={20} rx={10} />
            <IndustryIcon industry="brewery" size={13} x={x - 36} y={top + 73.5} />
            <text x={x + 6} y={top + 80}>
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

/*
 * The coal and iron markets, drawn in the empty strip down the board's right
 * edge like the printed board: a price column from £8 down to £1, two coal
 * spaces per price (£1–£7) and two iron spaces per price (£1–£5). The ∞ at
 * £8 (coal) and £6 (iron) means that once a market is empty, any number of
 * cubes can be bought at that price.
 * Markets fill from the most expensive space, so cubes are bought cheapest
 * first; the next cube to be bought is ringed.
 */
const BANNER_FONT = '700 10.5px Georgia, "Times New Roman", serif';
const BANNER_H = 15;
const widths = new Map<string, number>();
/** Width of a town name in the banner font, measured once per name. */
function bannerTextWidth(name: string): number {
  let w = widths.get(name);
  if (w === undefined) {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) ctx.font = BANNER_FONT;
    w = ctx ? ctx.measureText(name).width : name.length * 6;
    widths.set(name, w);
  }
  return w;
}

/**
 * A town's name on a ribbon in its region colour: a band across the middle,
 * with forked tails folding behind each end.
 */
function TownBanner({ name, color, x, y }: { name: string; color: string; x: number; y: number }) {
  const half = bannerTextWidth(name) / 2 + 7;
  const top = y - BANNER_H / 2;
  const tail = 9;
  const drop = 3;
  const l = x - half;
  const r = x + half;
  return (
    <g className={`town-banner ribbon-${color}`} aria-label={name}>
      {/* Tails, a little lower than the band, notched at the outer end. */}
      <path
        className="ribbon-tail"
        d={`M${l + 4},${top + drop} H${l - tail} L${l - tail + 4},${top + drop + BANNER_H / 2} L${l - tail},${top + drop + BANNER_H} H${l + 4} Z`}
      />
      <path
        className="ribbon-tail"
        d={`M${r - 4},${top + drop} H${r + tail} L${r + tail - 4},${top + drop + BANNER_H / 2} L${r + tail},${top + drop + BANNER_H} H${r - 4} Z`}
      />
      {/* The folds where the band turns under into each tail. */}
      <path className="ribbon-fold" d={`M${l},${top + BANNER_H} L${l + 4},${top + BANNER_H + drop} L${l + 4},${top + BANNER_H} Z`} />
      <path className="ribbon-fold" d={`M${r},${top + BANNER_H} L${r - 4},${top + BANNER_H + drop} L${r - 4},${top + BANNER_H} Z`} />
      <rect className="ribbon-band" x={l} y={top} width={r - l} height={BANNER_H} rx={1.5} />
      <rect className="ribbon-trim" x={l + 2} y={top + 2} width={r - l - 4} height={BANNER_H - 4} rx={1} />
      <text x={x} y={y + 0.5} className="ribbon-text">
        {name}
      </text>
    </g>
  );
}

/** The draw deck and discard piles, in the empty top-left corner of the map (as on the real board). */
const PILES = { left: 18, top: 18, card: { w: 50, h: 70 }, gap: 12, pad: 10, labelH: 18 };

function Piles({
  state,
  onDiscards,
}: {
  state: Pick<brass.BrassView, 'players' | 'deckSize'>;
  onDiscards?: (() => void) | undefined;
}) {
  // Face-up discards only; the face-down card from setup is noted in the discard sheet.
  const discards = state.players.reduce((n, p) => n + p.discard.length, 0);
  const { w, h } = PILES.card;
  const width = PILES.pad * 2 + w * 2 + PILES.gap;
  const height = PILES.pad * 2 + h + PILES.labelH;
  const deckX = PILES.left + PILES.pad;
  const discardX = deckX + w + PILES.gap;
  const y = PILES.top + PILES.pad;
  // A pile looks thicker the more cards it holds.
  const stack = (n: number) => Math.min(3, Math.ceil(n / 12));
  const pile = (x: number, n: number, kind: 'deck' | 'discard') => (
    <>
      {Array.from({ length: stack(n) }, (_, i) => (
        <rect key={i} x={x + (stack(n) - i) * 2} y={y - (stack(n) - i) * 2 + 4} width={w} height={h - 4} rx={5} className={`pile-under ${kind}`} />
      ))}
      <rect x={x} y={y} width={w} height={h} rx={5} className={n ? `pile-card ${kind}` : 'pile-empty'} data-pile={kind} />
      <text x={x + w / 2} y={y + h / 2} className={`pile-count ${kind}`}>
        {n}
      </text>
    </>
  );
  return (
    <g className="piles">
      <rect x={PILES.left} y={PILES.top} width={width} height={height} rx={10} className="market-panel" />
      <g aria-label={`Draw deck: ${state.deckSize} cards`}>
        <title>{`Draw deck: ${state.deckSize} cards`}</title>
        {pile(deckX, state.deckSize, 'deck')}
        <text x={deckX + w / 2} y={y + h + PILES.labelH / 2 + 3} className="pile-label">
          Deck
        </text>
      </g>
      <g
        className={onDiscards ? 'tappable' : undefined}
        role={onDiscards ? 'button' : undefined}
        aria-label={`Discard piles: ${discards} cards. Show them`}
        onClick={onDiscards}
      >
        <title>{`Discard piles: ${discards} cards. Tap to see them.`}</title>
        {pile(discardX, discards, 'discard')}
        <text x={discardX + w / 2} y={y + h + PILES.labelH / 2 + 3} className="pile-label">
          Discard
        </text>
      </g>
    </g>
  );
}

/**
 * The turn order panel, in the empty lower-left corner of the map (like the
 * Character tiles track on the real board). Sized to match the markets.
 */
const ORDER = { left: 22, bottom: 968, width: 142, headerH: 28, rowH: 30 };

/**
 * Money spent this round by each player, in next round's turn order: least
 * spent goes first, ties keep their current order (rulebook p.6).
 */
function TurnOrder({
  state,
  names,
}: {
  state: Pick<brass.BrassView, 'players' | 'turnOrder' | 'turnIndex' | 'phase'>;
  names: readonly string[];
}) {
  const next = [...state.turnOrder].sort((a, b) => state.players[a]!.spent - state.players[b]!.spent);
  const acting = state.phase.kind === 'actions' ? state.turnOrder[state.turnIndex] : undefined;
  const height = ORDER.headerH + next.length * ORDER.rowH + 6;
  const top = ORDER.bottom - height;
  const nameOf = (id: number) => {
    const name = names[id] ?? `Player ${id + 1}`;
    return name.length > 10 ? `${name.slice(0, 9)}…` : name;
  };
  return (
    <g className="turn-order">
      <title>Money spent this round. Least spent plays first next round; ties keep their order.</title>
      <rect x={ORDER.left} y={top} width={ORDER.width} height={height} rx={10} className="market-panel" />
      <text x={ORDER.left + 10} y={top + 16} className="turn-order-title">
        Next round · spent
      </text>
      {next.map((id, i) => {
        const y = top + ORDER.headerH + i * ORDER.rowH;
        const cy = y + ORDER.rowH / 2;
        return (
          <g key={id} className={`turn-order-row owner-${id} ${id === acting ? 'acting' : ''}`}>
            <rect x={ORDER.left + 4} y={y + 2} width={ORDER.width - 8} height={ORDER.rowH - 4} rx={6} className="turn-order-bg" />
            <circle cx={ORDER.left + 16} cy={cy} r={10} className="market-price" />
            <text x={ORDER.left + 16} y={cy} className="market-price-label">
              {i + 1}
            </text>
            <circle cx={ORDER.left + 34} cy={cy} r={5} className="turn-order-dot" />
            <text x={ORDER.left + 43} y={cy} className="turn-order-name">
              {nameOf(id)}
            </text>
            <text x={ORDER.left + ORDER.width - 10} y={cy} className="turn-order-spent">
              £{state.players[id]!.spent}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Cubes a new Coal Mine or Iron Works sold to its market, for the animation. */
export interface MarketSale {
  /** Changes for each sale, so a repeat of the same build still animates. */
  id: string;
  kind: 'coal' | 'iron';
  location: brass.LocationId;
  slot: number;
  /** Market spaces filled, in the order the cubes were sold (most expensive first). */
  spaces: number[];
}

const SALE_STAGGER = 260;
const SALE_FLY = 1150;
const SALE_COIN = 1000;
/** How long a sale's animation runs, start to finish. */
export const saleDuration = (sale: MarketSale) => (sale.spaces.length - 1) * SALE_STAGGER + SALE_FLY + SALE_COIN;

/** Centre of a town's industry space. */
function slotCenter(location: brass.LocationId, slot: number) {
  const loc = brass.LOCATION_BY_ID[location];
  const count = loc.kind === 'merchant' ? 1 : loc.slots.length;
  const { width, height } = slotLayout(count);
  const p = slotPosition(slot, count);
  return { x: loc.pos.x - width / 2 + p.x + SLOT / 2, y: loc.pos.y - height / 2 + p.y + SLOT / 2 };
}

/**
 * Cubes pop up on the new tile, fly one by one to their market spaces, and
 * each turns into a coin showing what it sold for.
 */
function SaleAnimation({ sale }: { sale: MarketSale }) {
  const from = slotCenter(sale.location, sale.slot);
  const c = MARKET.cell - 4;
  return (
    <g className="sale-anim" aria-hidden>
      {sale.spaces.map((j, i) => {
        const to = marketSpace(sale.kind, j);
        const delay = i * SALE_STAGGER;
        return (
          <g key={`${sale.id}-${j}`}>
            <g transform={`translate(${from.x} ${from.y})`}>
              <g
                className="sale-cube"
                style={
                  {
                    '--dx': `${to.x - from.x}px`,
                    '--dy': `${to.y - from.y}px`,
                    '--lift': `${-14 - i * 4}px`,
                    animationDelay: `${delay}ms`,
                    animationDuration: `${SALE_FLY}ms`,
                  } as CSSProperties
                }
              >
                <rect x={-c / 2} y={-c / 2} width={c} height={c} rx={2} className={`market-cube ${sale.kind}`} />
              </g>
            </g>
            <g transform={`translate(${to.x} ${to.y})`}>
              <g className="sale-coin" style={{ animationDelay: `${delay + SALE_FLY}ms`, animationDuration: `${SALE_COIN}ms` }}>
                <circle r={13} className="sale-coin-face" />
                <text className="sale-coin-text">£{to.price}</text>
              </g>
            </g>
          </g>
        );
      })}
    </g>
  );
}

const MARKET = { left: 852, top: 261, width: 142, rowGap: 44, firstRowY: 282, cell: 20 };
const COAL_X = [889, 913];
const IRON_X = [945, 969];

/** A rectangle of the map, in map units. */
export interface MapBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The coal and iron market panel's area on the map. */
export const MARKET_BOX: MapBox = { x0: 852, y0: 261, x1: 994, y1: 640 };

const marketRowY = (price: number) => MARKET.firstRowY + (8 - price) * MARKET.rowGap;

/** Centre of a market space, by its index into the market's prices. */
function marketSpace(kind: 'coal' | 'iron', j: number) {
  const def = kind === 'coal' ? brass.COAL_MARKET : brass.IRON_MARKET;
  const xs = kind === 'coal' ? COAL_X : IRON_X;
  return { x: xs[j % 2]!, y: marketRowY(def.prices[j]!), price: def.prices[j]! };
}

function Markets({
  coal,
  iron,
  pending,
  lit = null,
  onTap,
}: {
  coal: number;
  iron: number;
  /** The market column that can supply the cube being chosen, and whether it's the choice. */
  lit?: { kind: 'coal' | 'iron'; selected: boolean } | null;
  onTap?: ((kind: 'coal' | 'iron') => void) | undefined;
  /** Spaces whose cubes are still flying in from a sale; drawn empty until they land. */
  pending?: { kind: 'coal' | 'iron'; spaces: ReadonlySet<number> } | undefined;
}) {
  const rowY = marketRowY;
  const bottom = rowY(1) + 23;

  const spaces = (def: brass.MarketDef, cubes: number, xs: number[], kind: 'coal' | 'iron') => {
    const n = def.prices.length;
    const nextIndex = cubes > 0 ? n - cubes : -1;
    return def.prices.map((price, j) => {
      const filled = j >= n - cubes && !(pending?.kind === kind && pending.spaces.has(j));
      const x = xs[j % 2]! - MARKET.cell / 2;
      const y = rowY(price) - MARKET.cell / 2;
      return (
        <g key={`${kind}-${j}`}>
          <rect x={x} y={y} width={MARKET.cell} height={MARKET.cell} rx={3} className="market-space" />
          {filled && <rect x={x + 2} y={y + 2} width={MARKET.cell - 4} height={MARKET.cell - 4} rx={2} className={`market-cube ${kind}`} />}
          {j === nextIndex && (
            <rect x={x - 3} y={y - 3} width={MARKET.cell + 6} height={MARKET.cell + 6} rx={5} className="market-next" />
          )}
        </g>
      );
    });
  };

  // The "market empty" price: unlimited cubes at this price once the market runs out.
  const emptyPrice = (def: brass.MarketDef, xs: number[], kind: 'coal' | 'iron') => (
    <text x={(xs[0]! + xs[1]!) / 2} y={rowY(def.emptyPrice)} className={`market-infinity ${kind}`}>
      ∞
    </text>
  );

  return (
    <g className="markets" aria-label={`Coal market ${coal} cubes, iron market ${iron} cubes`}>
      <title>{`Coal market: ${coal} cubes. Iron market: ${iron} cubes. Cubes are bought from the cheapest price up; an empty market sells at £8 (coal) or £6 (iron).`}</title>
      <rect x={MARKET.left} y={MARKET.top} width={MARKET.width} height={bottom - MARKET.top + 28} rx={10} className="market-panel" />
      <rect x={IRON_X[0]! - 16} y={rowY(6) - 18} width={IRON_X[1]! - IRON_X[0]! + 32} height={rowY(1) - rowY(6) + 36} rx={6} className="market-iron-bg" />
      {[8, 7, 6, 5, 4, 3, 2, 1].map((price) => (
        <g key={price}>
          <circle cx={MARKET.left + 16} cy={rowY(price)} r={10} className="market-price" />
          <text x={MARKET.left + 16} y={rowY(price)} className="market-price-label">
            {price}
          </text>
        </g>
      ))}
      {spaces(brass.COAL_MARKET, coal, COAL_X, 'coal')}
      {spaces(brass.IRON_MARKET, iron, IRON_X, 'iron')}
      {emptyPrice(brass.COAL_MARKET, COAL_X, 'coal')}
      {emptyPrice(brass.IRON_MARKET, IRON_X, 'iron')}
      {lit && (
        <g className="tappable" onClick={() => onTap?.(lit.kind)}>
          <rect
            x={(lit.kind === 'coal' ? COAL_X : IRON_X)[0]! - 17}
            y={rowY(8) - 17}
            width={(lit.kind === 'coal' ? COAL_X : IRON_X)[1]! - (lit.kind === 'coal' ? COAL_X : IRON_X)[0]! + 34}
            height={rowY(1) - rowY(8) + 50}
            rx={7}
            className={`market-source ${lit.selected ? 'chosen' : ''}`}
          />
        </g>
      )}
      <g className="market-legend">
        <IndustryIcon industry="coal" size={22} x={(COAL_X[0]! + COAL_X[1]!) / 2 - 11} y={bottom - 6} />
        <IndustryIcon industry="iron" size={22} x={(IRON_X[0]! + IRON_X[1]!) / 2 - 11} y={bottom - 6} />
      </g>
    </g>
  );
}
