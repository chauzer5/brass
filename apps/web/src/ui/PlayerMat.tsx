import { brass } from '@brass/engine';
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

const nextLevel = (p: brass.PlayerView, industry: brass.Industry) => {
  const i = p.mat[industry].findIndex((n) => n > 0);
  return i < 0 ? null : i + 1;
};

/** A note when the next tile can't be built in this era. */
function eraNote(tile: brass.TileLevel, era: brass.Era): string | null {
  if (tile.canalOnly && era === 'rail') return 'Canal Era only: develop it';
  if (tile.railOnly && era === 'canal') return 'Rail Era only';
  return null;
}

/**
 * A player's mat: for each industry, the tiles left at each level (the next
 * one to build is outlined) and the stats of that next tile.
 */
export function PlayerMat({ player, era }: { player: brass.PlayerView; era: brass.Era }) {
  return (
    <div className="player-mat">
      {brass.INDUSTRIES.map((industry) => {
        const levels = brass.INDUSTRY_TILES[industry];
        const next = nextLevel(player, industry);
        const tile = next ? levels[next - 1]! : null;
        const note = tile && eraNote(tile, era);
        return (
          <div key={industry} className="mat-row">
            <span className="mat-icon" title={INDUSTRY_NAME[industry]}>
              <IndustryIcon industry={industry} size={22} />
            </span>
            <span className="mat-track">
              {levels.map((def) => {
                const left = player.mat[industry][def.level - 1] ?? 0;
                return (
                  <span
                    key={def.level}
                    className={`mat-level ${left === 0 ? 'gone' : ''} ${def.level === next ? 'next' : ''} ${
                      def.canalOnly ? 'canal-only' : def.railOnly ? 'rail-only' : ''
                    }`}
                    title={`${INDUSTRY_NAME[industry]} ${roman(def.level)}: ${left} of ${def.count} left`}
                  >
                    {roman(def.level)}
                    <span className="mat-pips">
                      {Array.from({ length: def.count }, (_, i) => (
                        <span key={i} className={i < left ? 'pip' : 'pip used'} />
                      ))}
                    </span>
                    {def.cannotDevelop && <span className="mat-bulb" title="Can't be developed" />}
                  </span>
                );
              })}
            </span>
            <span className="mat-next">
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
        <span className="mat-legend">
          <span className="legend-swatch canal-only" /> Canal only
          <span className="legend-swatch rail-only" /> Rail only
          <span className="mat-bulb inline" /> Can't develop
        </span>
      </p>
    </div>
  );
}
