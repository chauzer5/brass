import { brass, type Outcome } from '@brass/engine';
import { useState } from 'react';
import { PLAYER_COLORS } from '../game/labels.ts';

export function NewGame({ onStart, onResume }: { onStart: (names: string[]) => void; onResume?: (() => void) | undefined }) {
  const [count, setCount] = useState(2);
  const [names, setNames] = useState(['Player 1', 'Player 2', 'Player 3', 'Player 4']);
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
      </div>
    </div>
  );
}

export function PlayerStrip({ view, names, active }: { view: brass.BrassView; names: string[]; active: number | null }) {
  return (
    <div className="player-strip">
      {view.turnOrder.map((id) => {
        const p = view.players[id]!;
        return (
          <div key={id} className={`player-chip ${id === active ? 'active' : ''}`} title={`${PLAYER_COLORS[id]}`}>
            <span className={`dot owner-${id}`} aria-hidden />
            <span className="player-name">{names[id]}</span>
            <span className="player-stats">
              £{p.money} · {brass.incomeLevel(p.incomeSpace) >= 0 ? '+' : ''}
              {brass.incomeLevel(p.incomeSpace)} · {p.vp} VP
            </span>
          </div>
        );
      })}
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
