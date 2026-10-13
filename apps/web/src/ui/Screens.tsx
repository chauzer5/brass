import { brass, type Outcome } from '@brass/engine';
import { useState } from 'react';
import { PlayerMat } from './PlayerMat.tsx';
import { useTheme, type ThemeSetting } from '../settings.ts';

export function NewGame({ onStart, onResume }: { onStart: (names: string[]) => void; onResume?: (() => void) | undefined }) {
  const [count, setCount] = useState(2);
  const [names, setNames] = useState(['Player 1', 'Player 2', 'Player 3', 'Player 4']);
  const [showSettings, setShowSettings] = useState(false);
  if (showSettings) return <Settings onClose={() => setShowSettings(false)} />;
  return (
    <div className="screen">
      <div className="screen-card">
        <h1>Brass: Birmingham</h1>
        <p className="muted">Pass-and-play on one device. Bot opponents are coming next.</p>
        {onResume && (
          <button className="confirm" onClick={onResume}>
            Resume saved game
          </button>
        )}
        <h3>Players</h3>
        <div className="segmented" role="radiogroup" aria-label="Number of players">
          {[2, 3, 4].map((n) => (
            <button key={n} role="radio" aria-checked={count === n} className={count === n ? 'selected' : ''} onClick={() => setCount(n)}>
              {n}
            </button>
          ))}
        </div>
        <div className="name-list">
          {names.slice(0, count).map((name, i) => (
            <label key={i} className="name-row">
              <span className={`dot owner-${i}`} aria-hidden />
              <input
                value={name}
                aria-label={`Player ${i + 1} name`}
                onChange={(e) => setNames((ns) => ns.map((n, j) => (j === i ? e.target.value : n)))}
              />
            </label>
          ))}
        </div>
        <button className="confirm" onClick={() => onStart(names.slice(0, count).map((n, i) => n.trim() || `Player ${i + 1}`))}>
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

export function Settings({ onClose }: { onClose: () => void }) {
  const { theme, setTheme } = useTheme();
  return (
    <div className="screen">
      <div className="screen-card">
        <div className="panel-header">
          <button className="close" onClick={onClose} aria-label="Back to menu">
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
  return (
    <div className="player-strip">
      {view.turnOrder.map((id) => {
        const p = view.players[id]!;
        return (
          <button
            key={id}
            className={`player-chip ${id === active ? 'active' : ''}`}
            aria-label={`${names[id]}: show board`}
            onClick={() => onSelect(id)}
          >
            <span className={`dot owner-${id}`} aria-hidden />
            <span className="player-name">{names[id]}</span>
            <span className="player-stats">
              £{p.money} · {brass.incomeLevel(p.incomeSpace) >= 0 ? '+' : ''}
              {brass.incomeLevel(p.incomeSpace)} · {p.vp} VP
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
  name,
  era,
  onClose,
}: {
  player: brass.PlayerView;
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
        <PlayerMat player={player} era={era} />
      </div>
    </div>
  );
}

export function Handoff({ name, onReady }: { name: string; onReady: () => void }) {
  return (
    <div className="overlay">
      <div className="screen-card">
        <h2>{name}'s turn</h2>
        <p className="muted">Pass the device to {name}, then tap to see your hand.</p>
        <button className="confirm" onClick={onReady} autoFocus>
          I'm {name}
        </button>
      </div>
    </div>
  );
}

export function GameOver({ outcome, names, onNewGame }: { outcome: Outcome; names: string[]; onNewGame: () => void }) {
  return (
    <div className="overlay">
      <div className="screen-card">
        <h2>Game over</h2>
        <ol className="ranking">
          {outcome.ranking.map((r) => (
            <li key={r.player}>
              <span className={`dot owner-${r.player}`} aria-hidden /> {r.rank}. {names[r.player]} — {r.score} VP
            </li>
          ))}
        </ol>
        <button className="confirm" onClick={onNewGame}>
          New game
        </button>
      </div>
    </div>
  );
}
