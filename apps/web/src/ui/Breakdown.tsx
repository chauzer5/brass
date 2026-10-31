import { brass } from '@brass/engine';
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { breakdown, type Checkpoint, type MoveCounts, type PointSources } from '../game/breakdown.ts';
import { INDUSTRY_NAME } from '../game/labels.ts';

type BrassMatch = Parameters<typeof breakdown>[0];

/**
 * After the game: points and income round by round, where each player's points came from, and what
 * they did. Opened from the final scores.
 */
export function GameBreakdown({ match, names, onClose }: { match: BrassMatch; names: readonly string[]; onClose: () => void }) {
  const data = useMemo(() => breakdown(match), [match]);
  // Players in finishing order (the order the final scores list them).
  const outcome = brass.brassGame.outcome(match.state);
  const order = outcome ? outcome.ranking.map((r) => r.player) : names.map((_, i) => i);
  return (
    <div className="overlay breakdown-overlay" onClick={onClose}>
      <div className="screen-card breakdown" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <button className="close" onClick={onClose} aria-label="Back to the final scores">
            ‹
          </button>
          <h2>Game breakdown</h2>
        </div>
        <section>
          <h3>Victory points</h3>
          <LineChart checkpoints={data.checkpoints} names={names} value={(c) => c.vp} format={(v) => `${v} VP`} label="Victory points after each round" />
        </section>
        <section>
          <h3>Income</h3>
          <LineChart
            checkpoints={data.checkpoints}
            names={names}
            value={(c) => c.income}
            format={(v) => `${v >= 0 ? '+' : '−'}£${Math.abs(v)}`}
            label="Income level after each round"
            zero
          />
        </section>
        <section>
          <h3>Where the points came from</h3>
          <SourcesTable sources={data.sources} names={names} order={order} />
        </section>
        <section>
          <h3>Moves</h3>
          <MovesTable moves={data.moves} names={names} order={order} />
        </section>
        <button className="confirm" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

const PAD = { top: 12, right: 74, bottom: 26, left: 30 };
const HEIGHT = 180;

/** A line per player across the game's rounds, labelled at its end, with a crosshair and tooltip on touch or hover. */
function LineChart({
  checkpoints,
  names,
  value,
  format,
  label,
  zero = false,
}: {
  checkpoints: Checkpoint[];
  names: readonly string[];
  value: (c: Checkpoint) => number[];
  format: (v: number) => string;
  label: string;
  /** Mark the zero line (values can go below it). */
  zero?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(340);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const [hover, setHover] = useState<number | null>(null);

  const series = names.map((_, id) => checkpoints.map((c) => value(c)[id]!));
  const all = series.flat();
  const [lo, hi] = niceRange(Math.min(0, ...all), Math.max(1, ...all));
  const ticks = niceTicks(lo, hi);
  const plotW = Math.max(60, width - PAD.left - PAD.right);
  const x = (i: number) => PAD.left + (checkpoints.length > 1 ? (i / (checkpoints.length - 1)) * plotW : 0);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo || 1)) * (HEIGHT - PAD.top - PAD.bottom);
  const last = checkpoints.length - 1;
  // Where the Rail Era starts (between the Canal Era's last round and the Rail Era's first).
  const railFrom = checkpoints.findIndex((c) => c.era === 'rail');

  // End labels, nudged apart so they don't overlap.
  const ends = series
    .map((s, id) => ({ id, v: s[last]!, y: y(s[last]!) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i]!.y = Math.max(ends[i]!.y, ends[i - 1]!.y + 14);
  const overflow = ends.length ? ends.at(-1)!.y - (HEIGHT - PAD.bottom) : 0;
  if (overflow > 0) for (const e of ends) e.y -= overflow;

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - PAD.left) / plotW) * last);
    setHover(Math.min(last, Math.max(0, i)));
  };

  const at = hover !== null ? checkpoints[hover]! : null;
  return (
    <div className="chart" ref={box}>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={label}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setHover(null)}
        style={{ touchAction: 'pan-y' }}
      >
        {/* Recessive grid and axis labels. */}
        {ticks.map((t) => (
          <g key={t}>
            <line className={`chart-grid ${zero && t === 0 ? 'zero' : ''}`} x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} />
            <text className="chart-tick" x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {/* The two eras along the bottom, split where the Rail Era begins. */}
        {railFrom > 0 && <line className="chart-era" x1={(x(railFrom - 1) + x(railFrom)) / 2} x2={(x(railFrom - 1) + x(railFrom)) / 2} y1={PAD.top} y2={HEIGHT - PAD.bottom} />}
        <text className="chart-tick" x={railFrom > 0 ? (PAD.left + (x(railFrom - 1) + x(railFrom)) / 2) / 2 : PAD.left + plotW / 2} y={HEIGHT - 8} textAnchor="middle">
          Canal Era
        </text>
        {railFrom > 0 && (
          <text className="chart-tick" x={((x(railFrom - 1) + x(railFrom)) / 2 + PAD.left + plotW) / 2} y={HEIGHT - 8} textAnchor="middle">
            Rail Era
          </text>
        )}
        {/* A line per player, in their colour. */}
        {series.map((s, id) => (
          <polyline key={id} className={`chart-line owner-${id}`} points={s.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
        ))}
        {ends.map((e) => (
          <g key={e.id}>
            <circle className={`chart-end owner-${e.id}`} cx={x(last)} cy={y(e.v)} r={4} />
            <text className="chart-label" x={x(last) + 8} y={e.y} dy="0.32em">
              {shortName(names[e.id]!)} {format(e.v)}
            </text>
          </g>
        ))}
        {/* The crosshair. */}
        {hover !== null && (
          <g>
            <line className="chart-crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={HEIGHT - PAD.bottom} />
            {series.map((s, id) => (
              <circle key={id} className={`chart-dot owner-${id}`} cx={x(hover)} cy={y(s[hover]!)} r={4.5} />
            ))}
          </g>
        )}
      </svg>
      {at && (
        <div
          className="chart-tooltip"
          // Inside the plot, beside the crosshair on whichever side has more room.
          style={x(hover!) < PAD.left + plotW / 2 ? { left: x(hover!) + 10 } : { right: width - x(hover!) + 10 }}
          role="status"
        >
          <div className="chart-tooltip-title">{checkpointName(at)}</div>
          {series
            .map((s, id) => ({ id, v: s[hover!]! }))
            .sort((a, b) => b.v - a.v)
            .map(({ id, v }) => (
              <div key={id} className="chart-tooltip-row">
                <span className={`dot owner-${id}`} aria-hidden />
                <span className="chart-tooltip-name">{names[id]}</span>
                <span className="chart-tooltip-value">{format(v)}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

const checkpointName = (c: Checkpoint) => (c.round === 0 ? 'Start' : `${c.era === 'canal' ? 'Canal' : 'Rail'} Era, round ${c.round}`);
/** Names at the line ends are kept short. */
const shortName = (name: string) => (name.length > 8 ? `${name.slice(0, 7)}…` : name);

/** A range starting and ending on round numbers. */
function niceRange(min: number, max: number): [number, number] {
  const step = niceStep((max - min) / 4);
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
}
function niceStep(raw: number): number {
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  return [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
}
function niceTicks(lo: number, hi: number): number[] {
  const step = niceStep((hi - lo) / 4);
  const out: number[] = [];
  for (let t = lo; t <= hi + 1e-9; t += step) out.push(t);
  return out;
}

/** Players as columns, in finishing order. */
function PlayerHead({ names, order }: { names: readonly string[]; order: number[] }) {
  return (
    <thead>
      <tr>
        <th />
        {order.map((id) => (
          <th key={id} scope="col">
            <span className={`dot owner-${id}`} aria-hidden />
            <span className="breakdown-name">{names[id]}</span>
          </th>
        ))}
      </tr>
    </thead>
  );
}

function SourcesTable({ sources, names, order }: { sources: PointSources[]; names: readonly string[]; order: number[] }) {
  const industries = brass.INDUSTRIES.filter((ind) => sources.some((s) => (s.tilesByIndustry?.[ind] ?? 0) > 0));
  const rows: { label: string; get: (s: PointSources) => number; sub?: boolean; total?: boolean; hideZero?: boolean }[] = [
    { label: 'Canal links', get: (s) => s.canalLinks },
    { label: 'Canal tiles', get: (s) => s.canalTiles },
    { label: 'Rail links', get: (s) => s.railLinks },
    { label: 'Rail tiles', get: (s) => s.railTiles },
    ...industries.map((ind) => ({ label: INDUSTRY_NAME[ind], get: (s: PointSources) => s.tilesByIndustry?.[ind] ?? 0, sub: true })),
    { label: 'Merchant bonuses', get: (s) => s.merchants },
    { label: 'Income shortfalls', get: (s) => s.shortfalls, hideZero: true },
    { label: 'Total', get: (s) => s.total, total: true },
  ];
  return (
    <table className="breakdown-table">
      <PlayerHead names={names} order={order} />
      <tbody>
        {rows
          .filter((r) => !r.hideZero || sources.some((s) => r.get(s) !== 0))
          .map((r, i, shown) => (
            <Fragment key={r.label}>
              {/* Both eras' tiles again, by industry. */}
              {r.sub && !shown[i - 1]?.sub && (
                <tr className="sub-head">
                  <th scope="rowgroup" colSpan={order.length + 1}>
                    Tiles by industry
                  </th>
                </tr>
              )}
              <tr className={`${r.sub ? 'sub' : ''} ${r.total ? 'total' : ''}`}>
                <th scope="row">{r.label}</th>
                {order.map((id) => {
                  const v = r.get(sources[id]!);
                  return <td key={id}>{v === 0 && !r.total ? <span className="muted">–</span> : v}</td>;
                })}
              </tr>
            </Fragment>
          ))}
      </tbody>
    </table>
  );
}

function MovesTable({ moves, names, order }: { moves: MoveCounts[]; names: readonly string[]; order: number[] }) {
  const rows: [string, keyof MoveCounts][] = [
    ['Industries built', 'builds'],
    ['Links built', 'links'],
    ['Tiles sold', 'sold'],
    ['Tiles developed', 'developed'],
    ['Loans', 'loans'],
    ['Scouts', 'scouts'],
    ['Passes', 'passes'],
  ];
  return (
    <table className="breakdown-table">
      <PlayerHead names={names} order={order} />
      <tbody>
        {rows.map(([label, key]) => (
          <tr key={key}>
            <th scope="row">{label}</th>
            {order.map((id) => (
              <td key={id}>{moves[id]![key] || <span className="muted">–</span>}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

