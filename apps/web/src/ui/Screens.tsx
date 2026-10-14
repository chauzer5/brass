import { brass, type Outcome } from '@brass/engine';
import { useEffect, useRef, useState } from 'react';
import { HUMAN, type Seat } from '../game/useGame.ts';
import { GameCard } from './HandTray.tsx';
import { IncomeTrack } from './IncomeTrack.tsx';
import { PlayerMat } from './PlayerMat.tsx';
import type { LogEntry, RecapItem } from '../game/recap.ts';
import { useTheme, type ThemeSetting } from '../settings.ts';

const DIFFICULTY_LABEL: Record<brass.BotDifficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

export function NewGame({
  onStart,
  onResume,
}: {
  onStart: (names: string[], seats: Seat[]) => void;
  onResume?: (() => void) | undefined;
}) {
  const [count, setCount] = useState(2);
  const [names, setNames] = useState(['Player 1', 'Player 2', 'Player 3', 'Player 4']);
  const [seats, setSeats] = useState<Seat[]>([HUMAN, HUMAN, HUMAN, HUMAN]);
  const [showSettings, setShowSettings] = useState(false);
  if (showSettings) return <Settings onClose={() => setShowSettings(false)} />;

  const setSeat = (i: number, seat: Seat) => {
    setSeats((ss) => ss.map((s, j) => (j === i ? seat : s)));
    // Default names follow the seat: "Player 2" becomes "Bot 2" and back, but a typed name is kept.
    setNames((ns) =>
      ns.map((n, j) => {
        if (j !== i) return n;
        if (seat.kind === 'bot' && n === `Player ${i + 1}`) return `Bot ${i + 1}`;
        if (seat.kind === 'human' && n === `Bot ${i + 1}`) return `Player ${i + 1}`;
        return n;
      }),
    );
  };
  const chosen = seats.slice(0, count);
  const humans = chosen.filter((s) => s.kind === 'human').length;
  // At least one player is human. Dropping seats could leave only bots: then the first seat becomes human again.
  const changeCount = (n: number) => {
    setCount(n);
    if (!seats.slice(0, n).some((s) => s.kind === 'human')) setSeat(0, HUMAN);
  };

  return (
    <div className="screen">
      <div className="screen-card">
        <img src="/icon.svg" alt="" className="menu-logo" />
        <h1 className="menu-title">Brass: Birmingham</h1>
        <p className="muted">
          {humans === 1
              ? 'You against the bots.'
              : 'Pass the device between players; bots take their turns on their own.'}
        </p>
        {onResume && (
          <button className="confirm" onClick={onResume}>
            Resume saved game
          </button>
        )}
        <h3>Players</h3>
        <div className="segmented" role="radiogroup" aria-label="Number of players">
          {[2, 3, 4].map((n) => (
            <button key={n} role="radio" aria-checked={count === n} className={count === n ? 'selected' : ''} onClick={() => changeCount(n)}>
              {n}
            </button>
          ))}
        </div>
        <div className="name-list">
          {names.slice(0, count).map((name, i) => {
            const seat = seats[i]!;
            return (
              <div key={i} className="seat">
                <div className="name-row">
                  <span className={`dot owner-${i}`} aria-hidden />
                  <input
                    value={name}
                    aria-label={`Player ${i + 1} name`}
                    onChange={(e) => setNames((ns) => ns.map((n, j) => (j === i ? e.target.value : n)))}
                  />
                  <span className="seat-kind" role="radiogroup" aria-label={`Player ${i + 1}: human or bot`}>
                    {(['human', 'bot'] as const).map((kind) => (
                      <button
                        key={kind}
                        role="radio"
                        aria-checked={seat.kind === kind}
                        className={seat.kind === kind ? 'selected' : ''}
                        disabled={kind === 'bot' && seat.kind === 'human' && humans === 1}
                        title={kind === 'bot' && seat.kind === 'human' && humans === 1 ? 'At least one player must be human' : undefined}
                        onClick={() => setSeat(i, kind === 'human' ? HUMAN : { kind: 'bot', difficulty: 'normal' })}
                      >
                        {kind === 'human' ? 'Human' : 'Bot'}
                      </button>
                    ))}
                  </span>
                </div>
                {seat.kind === 'bot' && (
                  <div className="seat-difficulty" role="radiogroup" aria-label={`${name} difficulty`}>
                    {(['easy', 'normal', 'hard'] as const).map((d) => {
                      const ready = brass.AVAILABLE_DIFFICULTIES.includes(d);
                      return (
                        <button
                          key={d}
                          role="radio"
                          aria-checked={seat.difficulty === d}
                          className={seat.difficulty === d ? 'selected' : ''}
                          disabled={!ready}
                          title={ready ? undefined : 'Coming soon'}
                          onClick={() => setSeat(i, { kind: 'bot', difficulty: d })}
                        >
                          {DIFFICULTY_LABEL[d]}
                          {!ready && <small>soon</small>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button
          className="confirm"
          onClick={() => onStart(names.slice(0, count).map((n, i) => n.trim() || `Player ${i + 1}`), chosen)}
        >
          Start new game
        </button>
        <button className="secondary" onClick={() => setShowSettings(true)}>
          Settings
        </button>
      </div>
    </div>
  );
}

const THEME_OPTIONS: { value: ThemeSetting; label: string }[] = [
  { value: 'system', label: 'Match phone' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function Settings({ onClose, inGame = false }: { onClose: () => void; inGame?: boolean }) {
  const { theme, setTheme } = useTheme();
  return (
    // In a game it sits over the table; from the main menu it's a page of its own.
    <div className={inGame ? 'overlay' : 'screen'} onClick={inGame ? onClose : undefined}>
      <div className="screen-card" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <button className="close" onClick={onClose} aria-label={inGame ? 'Back to the game' : 'Back to menu'}>
            ‹
          </button>
          <h2>Settings</h2>
        </div>
        <h3>Appearance</h3>
        <div className="segmented" role="radiogroup" aria-label="Appearance">
          {THEME_OPTIONS.map((o) => (
            <button
              key={o.value}
              role="radio"
              aria-checked={theme === o.value}
              className={theme === o.value ? 'selected' : ''}
              onClick={() => setTheme(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="muted">"Match phone" follows your phone's light or dark setting.</p>
        <button className="confirm" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

export function PlayerStrip({
  view,
  names,
  active,
  onSelect,
}: {
  view: brass.BrassView;
  names: string[];
  active: number | null;
  /** Tapping a player shows their mat. */
  onSelect: (id: number) => void;
}) {
  // When the chips don't all fit, the strip scrolls; keep the player taking their turn in view.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const chip = stripRef.current?.querySelector<HTMLElement>('.player-chip.active');
    chip?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [active]);
  return (
    <div className="player-strip" ref={stripRef}>
      {view.turnOrder.map((id) => {
        const p = view.players[id]!;
        const income = brass.incomeLevel(p.incomeSpace);
        return (
          <button
            key={id}
            className={`player-chip owner-${id} ${id === active ? 'active' : ''}`}
            aria-label={`${names[id]}: £${p.money}, income ${income}, ${p.vp} VP. Show board`}
            onClick={() => onSelect(id)}
          >
            <span className="player-name">{names[id]}</span>
            <span className="player-stats">
              <span>£{p.money}</span>
              <span>
                {income >= 0 ? '+' : ''}
                {income}
              </span>
              <span>{p.vp} VP</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Another player's mat, in a sheet over the table. Mats are public, as at the real table. */
export function MatSheet({
  player,
  players,
  name,
  era,
  onClose,
}: {
  player: brass.PlayerView;
  /** Everyone, for the income track. */
  players: readonly brass.PlayerView[];
  name: string;
  era: brass.Era;
  onClose: () => void;
}) {
  const income = brass.incomeLevel(player.incomeSpace);
  return (
    <div className="overlay mat-overlay" onClick={onClose}>
      <div className="screen-card mat-sheet" role="dialog" aria-label={`${name}'s board`} onClick={(e) => e.stopPropagation()}>
        <div className="mat-sheet-header">
          <span className={`dot owner-${player.id}`} aria-hidden />
          <h2>{name}</h2>
          <span className="muted">
            £{player.money} · {income >= 0 ? '+' : ''}
            {income} · {player.vp} VP · {player.handSize} cards
          </span>
          <button className="close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <IncomeTrack players={players} focus={player.id} />
        <PlayerMat player={player} era={era} />
      </div>
    </div>
  );
}

export function Handoff({
  name,
  names,
  recap,
  onReady,
}: {
  name: string;
  names: readonly string[];
  /** What the other players did since this player's last turn. */
  recap: readonly RecapItem[];
  onReady: () => void;
}) {
  return (
    <div className="overlay">
      <div className="screen-card handoff">
        <h2>{name}'s turn</h2>
        {recap.length > 0 && (
          <section className="recap">
            <h3>Since your last turn</h3>
            <ol>
              {recap.map((r, i) => (
                <li key={i}>
                  <span className={`dot owner-${r.player}`} aria-hidden />
                  <span>
                    <strong>{names[r.player]}</strong> {r.text}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
        <p className="muted">Pass the device to {name}, then tap to see your hand.</p>
        <button className="confirm" onClick={onReady} autoFocus>
          I'm {name}
        </button>
      </div>
    </div>
  );
}

/**
 * The end of an era (rulebook p.7): what each player scored from Link tiles and
 * flipped Industry tiles. After the Rail Era this is the end of the game, with
 * the final ranking and both eras' scoring.
 */
export function EraSummary({
  view,
  names,
  outcome,
  onContinue,
  onNewGame,
}: {
  view: brass.BrassView;
  names: readonly string[];
  /** Set when the game is over. */
  outcome: Outcome | null;
  /** End of the Canal Era: carry on into the Rail Era. Game over: look at the final board. */
  onContinue: () => void;
  onNewGame: () => void;
}) {
  const final = outcome !== null;
  const eras = view.eraScores;
  const latest = eras.at(-1);
  if (!latest) return null;
  // Final ranking (ties broken by income, then money); otherwise by VP so far.
  const order = final
    ? outcome.ranking.map((r) => ({ id: r.player, rank: r.rank }))
    : [...view.players]
        .sort((a, b) => b.vp - a.vp)
        .map((p, i, all) => ({ id: p.id, rank: 1 + all.findIndex((o) => o.vp === p.vp) }));
  const tied = final && new Set(order.map((o) => view.players[o.id]!.vp)).size < order.length;
  const shownEras = final ? eras : [latest];
  const other = (id: number) => view.players[id]!.vp - eras.reduce((sum, e) => sum + e.players[id]!.after - e.players[id]!.before, 0);
  const eraLabel = (era: brass.Era) => (era === 'canal' ? 'Canal Era' : 'Rail Era');
  return (
    <div className="overlay">
      <div className="screen-card era-summary">
        <h2>{final ? `${names[order[0]!.id]} wins!` : 'End of the Canal Era'}</h2>
        <p className="muted">
          {final
            ? 'Final scores, with what each era scored.'
            : 'Link tiles and flipped Industry tiles have scored. Links come off the board, Level I tiles are removed, and everyone draws a new hand.'}
        </p>
        <ol className="era-table">
          {order.map(({ id, rank }) => {
            const p = view.players[id]!;
            return (
              <li key={id} className={final && rank === 1 ? 'winner' : ''}>
                <div className="era-player">
                  <span className="era-rank">{rank}</span>
                  <span className={`dot owner-${id}`} aria-hidden />
                  <span className="era-name">{names[id]}</span>
                  <span className="era-total">{p.vp} VP</span>
                </div>
                {shownEras.map((e) => {
                  const sc = e.players[id]!;
                  return (
                    <div key={e.era} className="era-line">
                      {final && <span className="era-which">{e.era === 'canal' ? 'Canal' : 'Rail'}</span>}
                      <span>
                        Links <strong>{sc.linkVP}</strong> <span className="muted">({sc.links})</span>
                      </span>
                      <span>
                        Tiles <strong>{sc.tileVP}</strong> <span className="muted">({sc.tiles})</span>
                      </span>
                      <span className="era-gain">+{sc.after - sc.before}</span>
                    </div>
                  );
                })}
                {/* VPs from outside era scoring: Merchant beer bonuses, less any lost to income shortfalls. */}
                {final && other(id) !== 0 && (
                  <div className="era-line">
                    <span className="era-which">Other</span>
                    <span className="muted">Merchant bonuses{other(id) < 0 ? ' and income shortfalls' : ''}</span>
                    <span className="era-gain">
                      {other(id) > 0 ? '+' : ''}
                      {other(id)}
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {tied && <p className="muted era-note">Tied VPs are broken by income, then money.</p>}
        {!final && <p className="muted era-note">{eraLabel('rail')}: only rail links from now on, and Canal-only tiles can no longer be built.</p>}
        {final ? (
          <div className="era-buttons">
            <button className="secondary" onClick={onContinue}>
              View the board
            </button>
            <button className="confirm" onClick={onNewGame}>
              New game
            </button>
          </div>
        ) : (
          <button className="confirm" onClick={onContinue} autoFocus>
            Start the Rail Era
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Every player's discard pile, newest card first. Discards are face up, so
 * anyone may look; the face-down card each player discarded at setup is only
 * mentioned in a note.
 */
export function DiscardSheet({
  view,
  names,
  onClose,
}: {
  view: brass.BrassView;
  names: readonly string[];
  onClose: () => void;
}) {
  return (
    <div className="overlay mat-overlay" onClick={onClose}>
      <div className="screen-card discard-sheet" role="dialog" aria-label="Discard piles" onClick={(e) => e.stopPropagation()}>
        <div className="mat-sheet-header">
          <h2>Discards</h2>
          <span className="muted">Deck: {view.deckSize} cards left</span>
          <button className="close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {view.turnOrder.map((id) => {
          const p = view.players[id]!;
          const count = p.discard.length;
          return (
            <section key={id} className="discard-player">
              <h3>
                <span className={`dot owner-${id}`} aria-hidden /> {names[id]}
                <span className="muted"> · {count} card{count === 1 ? '' : 's'}</span>
              </h3>
              {count === 0 ? (
                <p className="muted">Nothing discarded yet.</p>
              ) : (
                <div className="discard-cards">
                  {[...p.discard].reverse().map((cardId) => (
                    <GameCard key={cardId} card={view.cards[cardId]} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
        {view.players.some((p) => p.hasFaceDownDiscard) && (
          <p className="discard-note">
            Each player also has 1 card discarded face down at setup. It stays hidden and is shuffled back in for the
            Rail Era.
          </p>
        )}
      </div>
    </div>
  );
}

/** Everything that's happened, newest first, grouped by era and round. */
export function GameLogSheet({
  entries,
  names,
  onClose,
}: {
  entries: readonly LogEntry[];
  names: readonly string[];
  onClose: () => void;
}) {
  // Group consecutive entries by era and round, newest round first.
  const groups: { title: string; items: LogEntry[] }[] = [];
  for (const e of entries) {
    const title = `${e.era === 'canal' ? 'Canal' : 'Rail'} Era · Round ${e.round}`;
    const last = groups.at(-1);
    if (last && last.title === title) last.items.push(e);
    else groups.push({ title, items: [e] });
  }
  groups.reverse();
  return (
    <div className="overlay mat-overlay" onClick={onClose}>
      <div className="screen-card log-sheet" role="dialog" aria-label="Game log" onClick={(e) => e.stopPropagation()}>
        <div className="mat-sheet-header">
          <h2>Game log</h2>
          <span className="muted">{entries.length} actions</span>
          <button className="close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {groups.length === 0 ? (
          <p className="muted">Nothing has happened yet.</p>
        ) : (
          groups.map((g, i) => (
            <section key={i} className="recap log-group">
              <h3>{g.title}</h3>
              <ol>
                {[...g.items].reverse().map((r, j) => (
                  <li key={j}>
                    <span className={`dot owner-${r.player}`} aria-hidden />
                    <span>
                      <strong>{names[r.player]}</strong> {r.text}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
