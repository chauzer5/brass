import { brass } from '@brass/engine';
import type { LobbyInfo } from '@brass/protocol';
import { useEffect, useMemo, useState } from 'react';
import { deleteLocalGame, loadLocal, savedLocalGames, type Seat } from '../game/useGame.ts';
import { forgetTicket, lobbyInfo, savedTickets, type SavedTicket } from '../online/client.ts';
import { CreateGame, PushPrompt, seatName, statusLabel } from '../online/OnlineScreens.tsx';
import { MatchSetup } from './Screens.tsx';

type Mode = 'local' | 'online';
const MODE_KEY = 'brass:new-mode:v1';

/**
 * Starting a game: on this device (pass it round, or play the bots) or online (friends on their own
 * phones). The last choice is remembered. (Joining a friend's online game is on the main menu.)
 */
export function NewGameFlow({
  onBack,
  onStartLocal,
  onCreatedOnline,
}: {
  onBack: () => void;
  onStartLocal: (names: string[], seats: Seat[]) => void;
  onCreatedOnline: (ticket: SavedTicket) => void;
}) {
  const [mode, setModeState] = useState<Mode>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === 'online' ? 'online' : 'local';
    } catch {
      return 'local';
    }
  });
  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // Just not remembered.
    }
  };
  const header = (
    <>
      <div className="panel-header">
        <button className="close" onClick={onBack} aria-label="Back to menu">
          ‹
        </button>
        <h2>New game</h2>
      </div>
      <div className="segmented mode-switch" role="radiogroup" aria-label="Where to play">
        {(
          [
            ['local', 'On this device'],
            ['online', 'Online'],
          ] as const
        ).map(([m, label]) => (
          <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'selected' : ''} onClick={() => setMode(m)}>
            <span className={`game-kind-icon ${m}`} aria-hidden>
              {m === 'local' ? <DeviceIcon /> : <GlobeIcon />}
            </span>
            {label}
          </button>
        ))}
      </div>
    </>
  );
  return mode === 'local' ? (
    <MatchSetup key="local" header={header} onStart={onStartLocal} />
  ) : (
    <CreateGame key="online" header={header} onCreated={onCreatedOnline} />
  );
}

/** One row of the games list. */
type Row =
  | { kind: 'local'; id: string; at: number; players: string; status: string; yours: boolean; finished: boolean }
  | { kind: 'online'; ticket: SavedTicket; at: number };

/** Every game on this device, local and online, most recent first. */
export function GamesList({
  onBack,
  onOpenLocal,
  onOpenOnline,
  onNew,
}: {
  onBack: () => void;
  onOpenLocal: (id: string) => void;
  onOpenOnline: (ticket: SavedTicket) => void;
  onNew: () => void;
}) {
  const [version, setVersion] = useState(0);
  const rows = useMemo<Row[]>(() => {
    const local: Row[] = savedLocalGames().flatMap((saved) => {
      const game = loadLocal(saved);
      if (!game) return [];
      const state = game.match.state;
      const outcome = brass.brassGame.outcome(state);
      const current = brass.currentPlayer(state);
      const humans = game.seats.filter((s) => s.kind === 'human').length;
      const era = `${state.era === 'canal' ? 'Canal' : 'Rail'} Era · Round ${state.round}/${brass.ROUNDS_PER_ERA[state.playerCount]}`;
      const status = outcome
        ? `Finished · ${outcome.ranking
            .filter((r) => r.rank === 1)
            .map((r) => game.names[r.player])
            .join(' & ')} won`
        : current === null
          ? era
          : // Against bots, it's always you; passing a phone round, say whose turn it is.
            humans === 1
            ? `${era} · your turn`
            : `${era} · ${game.names[current]}'s turn`;
      return [{ kind: 'local', id: saved.id, at: saved.updatedAt, players: game.names.join(', '), status, yours: false, finished: !!outcome }];
    });
    const online: Row[] = savedTickets().map((ticket) => ({ kind: 'online', ticket, at: Math.max(ticket.joinedAt, ticket.viewedAt ?? 0) }));
    return [...local, ...online].sort((a, b) => b.at - a.at);
  }, [version]);

  // Online games' state, fetched when the list opens (null: couldn't be reached; missing: still loading).
  const [infos, setInfos] = useState<Record<string, LobbyInfo | null>>({});
  useEffect(() => {
    let cancelled = false;
    for (const t of savedTickets()) {
      lobbyInfo(t.code)
        .then((info) => !cancelled && setInfos((m) => ({ ...m, [t.code]: info })))
        .catch(() => !cancelled && setInfos((m) => ({ ...m, [t.code]: null })));
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // Deleting a local game asks first (it's gone for good).
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <div className="screen">
      <div className="screen-card">
        <div className="panel-header">
          <button className="close" onClick={onBack} aria-label="Back to menu">
            ‹
          </button>
          <h2>Games</h2>
        </div>
        <PushPrompt />
        {rows.length === 0 ? (
          <>
            <p className="muted">No games yet.</p>
            <button className="confirm" onClick={onNew}>
              New game
            </button>
          </>
        ) : (
          <ul className="online-games games-list">
            {rows.map((row) => {
              if (row.kind === 'local') {
                if (confirming === row.id) {
                  return (
                    <li key={row.id} className="game-row local confirming">
                      <span className="confirm-text">Delete this game?</span>
                      <button className="secondary" onClick={() => setConfirming(null)}>
                        Keep
                      </button>
                      <button
                        className="confirm danger"
                        onClick={() => {
                          deleteLocalGame(row.id);
                          setConfirming(null);
                          setVersion((v) => v + 1);
                        }}
                      >
                        Delete
                      </button>
                    </li>
                  );
                }
                return (
                  <li key={row.id} className="game-row local">
                    <button className="online-game" onClick={() => onOpenLocal(row.id)}>
                      <GameKind kind="local" />
                      <span className="online-game-status">{row.status}</span>
                      <span className="online-game-players">{row.players}</span>
                    </button>
                    <button className="close online-forget" onClick={() => setConfirming(row.id)} aria-label="Delete this game">
                      ×
                    </button>
                  </li>
                );
              }
              const t = row.ticket;
              const info = infos[t.code];
              const label = statusLabel(info, t.seat);
              return (
                <li key={t.code} className={`game-row online ${label.yours ? 'yours' : ''}`}>
                  <button className="online-game" onClick={() => onOpenOnline(t)}>
                    <GameKind kind="online" code={t.code} />
                    <span className="online-game-status">{label.text}</span>
                    <span className="online-game-players">
                      {info ? info.seats.map((s, i) => seatName(s, i)).join(', ') : info === null ? 'Not found' : 'Loading…'}
                    </span>
                  </button>
                  {(info === null || info?.finished || info?.status === 'cancelled') && (
                    <button
                      className="close online-forget"
                      onClick={() => {
                        forgetTicket(t.code);
                        setVersion((v) => v + 1);
                      }}
                      aria-label={`Remove game ${t.code}`}
                    >
                      ×
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The label at the start of a row: where the game is played. */
function GameKind({ kind, code }: { kind: Mode; code?: string }) {
  return (
    <span className={`game-kind ${kind}`}>
      <span className={`game-kind-icon ${kind}`} aria-hidden>
        {kind === 'local' ? <DeviceIcon /> : <GlobeIcon />}
      </span>
      {kind === 'local' ? 'This device' : `Online · ${code}`}
    </span>
  );
}

function DeviceIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="4" y="1.5" width="8" height="13" rx="1.8" />
      <path d="M7 12h2" strokeLinecap="round" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6.3" />
      <path d="M1.7 8h12.6M8 1.7c2 2 2 10.6 0 12.6M8 1.7c-2 2-2 10.6 0 12.6" />
    </svg>
  );
}
