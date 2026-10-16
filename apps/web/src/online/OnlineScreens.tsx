import { brass } from '@brass/engine';
import { CODE_LENGTH, TURN_LIMITS, normalizeCode, type GameSnapshot, type LobbyInfo, type PublicSeat, type SeatSetup } from '@brass/protocol';
import { useEffect, useMemo, useState } from 'react';
import { Table } from '../App.tsx';
import type { Game, Seat } from '../game/useGame.ts';
import { DIFFICULTY_LABEL } from '../ui/Screens.tsx';
import {
  createGame,
  enablePush,
  forgetTicket,
  pushState,
  registerPush,
  type PushState,
  joinGame,
  joinLink,
  leaveGame,
  lobbyInfo,
  markIntroSeen,
  saveName,
  saveTicket,
  savedName,
  savedTickets,
  useOnlineGame,
  type SavedTicket,
} from './client.ts';

type Page = { kind: 'home' } | { kind: 'create' } | { kind: 'join'; code: string } | { kind: 'game'; ticket: SavedTicket };

/**
 * Playing online: the games this phone is in, making a new one, joining one
 * with its code (or link), and the games themselves.
 */
export function Online({ join, onBack }: { join?: string | undefined; onBack: () => void }) {
  const [page, setPage] = useState<Page>(() => {
    if (!join) return { kind: 'home' };
    // A link to a game this phone is already in opens it.
    const mine = savedTickets().find((t) => t.code === join);
    return mine ? { kind: 'game', ticket: mine } : { kind: 'join', code: join };
  });
  const home = () => setPage({ kind: 'home' });
  const open = (ticket: SavedTicket) => setPage({ kind: 'game', ticket });

  if (page.kind === 'create') return <CreateGame onBack={home} onCreated={open} />;
  if (page.kind === 'join') return <JoinGame initialCode={page.code} onBack={home} onJoined={open} />;
  if (page.kind === 'game') return <OnlineGame key={page.ticket.code} ticket={page.ticket} onBack={home} />;
  return <OnlineHome onBack={onBack} onCreate={() => setPage({ kind: 'create' })} onJoin={() => setPage({ kind: 'join', code: '' })} onOpen={open} />;
}

// ---- The games this phone is in ----

function OnlineHome({
  onBack,
  onCreate,
  onJoin,
  onOpen,
}: {
  onBack: () => void;
  onCreate: () => void;
  onJoin: () => void;
  onOpen: (ticket: SavedTicket) => void;
}) {
  const [tickets, setTickets] = useState(savedTickets);
  // Each game's state, fetched when the list opens (null: couldn't be reached; missing: still loading).
  const [infos, setInfos] = useState<Record<string, LobbyInfo | null>>({});
  useEffect(() => {
    let cancelled = false;
    for (const t of tickets) {
      lobbyInfo(t.code)
        .then((info) => !cancelled && setInfos((m) => ({ ...m, [t.code]: info })))
        .catch(() => !cancelled && setInfos((m) => ({ ...m, [t.code]: null })));
    }
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const forget = (code: string) => {
    forgetTicket(code);
    setTickets(savedTickets());
  };

  return (
    <div className="screen">
      <div className="screen-card">
        <div className="panel-header">
          <button className="close" onClick={onBack} aria-label="Back to menu">
            ‹
          </button>
          <h2>Play online</h2>
        </div>
        <p className="muted">Play with friends on their own phones. Start a game and send them its code, or join theirs.</p>
        <div className="online-actions">
          <button className="confirm" onClick={onCreate}>
            Create game
          </button>
          <button className="secondary" onClick={onJoin}>
            Join with code
          </button>
        </div>
        <PushPrompt />
        {tickets.length > 0 && (
          <>
            <h3>Your games</h3>
            <ul className="online-games">
              {tickets.map((t) => {
                const info = infos[t.code];
                const label = statusLabel(info, t.seat);
                return (
                  <li key={t.code} className={label.yours ? 'yours' : ''}>
                    <button className="online-game" onClick={() => onOpen(t)}>
                      <span className="online-game-code">{t.code}</span>
                      <span className="online-game-players">
                        {info ? info.seats.map((s, i) => seatName(s, i)).join(', ') : info === null ? 'Not found' : 'Loading…'}
                      </span>
                      <span className="online-game-status">{label.text}</span>
                    </button>
                    {(info === null || info?.finished || info?.status === 'cancelled') && (
                      <button className="close online-forget" onClick={() => forget(t.code)} aria-label={`Remove game ${t.code}`}>
                        ×
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function statusLabel(info: LobbyInfo | null | undefined, you: number): { text: string; yours: boolean } {
  if (info === undefined) return { text: '', yours: false };
  if (info === null) return { text: '', yours: false };
  if (info.status === 'cancelled') return { text: 'Cancelled', yours: false };
  if (info.finished) return { text: 'Finished', yours: false };
  if (info.status === 'lobby') {
    const free = info.seats.filter((s) => s.kind === 'human' && !s.name).length;
    return { text: free > 0 ? `Waiting for ${free} more` : 'Ready to start', yours: free === 0 };
  }
  if (info.current === you) return { text: 'Your turn', yours: true };
  return { text: info.current !== null ? `${seatName(info.seats[info.current]!, info.current)}'s turn` : '', yours: false };
}

const seatName = (s: PublicSeat, i: number) => (s.kind === 'bot' ? s.name : (s.name ?? `Player ${i + 1}`));

// ---- Making a game ----

type OtherSeat = { kind: 'friend' } | { kind: 'bot'; difficulty: brass.BotDifficulty };

function CreateGame({ onBack, onCreated }: { onBack: () => void; onCreated: (ticket: SavedTicket) => void }) {
  const [name, setName] = useState(savedName);
  const [count, setCount] = useState(2);
  const [others, setOthers] = useState<OtherSeat[]>([{ kind: 'friend' }, { kind: 'friend' }, { kind: 'friend' }]);
  const [turnLimit, setTurnLimit] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setOther = (i: number, seat: OtherSeat) => setOthers((os) => os.map((s, j) => (j === i ? seat : s)));

  const create = async () => {
    if (!name.trim()) {
      setError('Enter your name');
      return;
    }
    setBusy(true);
    setError(null);
    const seats: SeatSetup[] = [
      { kind: 'human' },
      ...others.slice(0, count - 1).map((s): SeatSetup => (s.kind === 'bot' ? s : { kind: 'human' })),
    ];
    try {
      saveName(name);
      onCreated(saveTicket(await createGame({ seats, name: name.trim(), turnLimit })));
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <div className="screen-card">
        <div className="panel-header">
          <button className="close" onClick={onBack} aria-label="Back">
            ‹
          </button>
          <h2>Create game</h2>
        </div>
        <h3>Your name</h3>
        <div className="name-row">
          <span className="dot owner-0" aria-hidden />
          <input value={name} maxLength={24} aria-label="Your name" placeholder="Your name" onChange={(e) => setName(e.target.value)} />
        </div>
        <h3>Players</h3>
        <div className="segmented" role="radiogroup" aria-label="Number of players">
          {[2, 3, 4].map((n) => (
            <button key={n} role="radio" aria-checked={count === n} className={count === n ? 'selected' : ''} onClick={() => setCount(n)}>
              {n}
            </button>
          ))}
        </div>
        <div className="name-list">
          {others.slice(0, count - 1).map((seat, i) => (
            <div key={i} className="seat">
              <div className="name-row">
                <span className={`dot owner-${i + 1}`} aria-hidden />
                <span className="bot-name">{seat.kind === 'bot' ? `Bot (${DIFFICULTY_LABEL[seat.difficulty]})` : 'A friend'}</span>
                <span className="seat-kind" role="radiogroup" aria-label={`Player ${i + 2}: friend or bot`}>
                  {(['friend', 'bot'] as const).map((kind) => (
                    <button
                      key={kind}
                      role="radio"
                      aria-checked={seat.kind === kind}
                      className={seat.kind === kind ? 'selected' : ''}
                      onClick={() => setOther(i, kind === 'friend' ? { kind } : { kind, difficulty: 'normal' })}
                    >
                      {kind === 'friend' ? 'Friend' : 'Bot'}
                    </button>
                  ))}
                </span>
              </div>
              {seat.kind === 'bot' && (
                <div className="seat-difficulty" role="radiogroup" aria-label={`Player ${i + 2} difficulty`}>
                  {brass.AVAILABLE_DIFFICULTIES.map((d) => (
                    <button
                      key={d}
                      role="radio"
                      aria-checked={seat.difficulty === d}
                      className={seat.difficulty === d ? 'selected' : ''}
                      onClick={() => setOther(i, { kind: 'bot', difficulty: d })}
                    >
                      {DIFFICULTY_LABEL[d]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <h3>Max turn time</h3>
        <div className="segmented turn-limits" role="radiogroup" aria-label="Max turn time">
          {TURN_LIMITS.map((t) => (
            <button key={t ?? 0} role="radio" aria-checked={turnLimit === t} className={turnLimit === t ? 'selected' : ''} onClick={() => setTurnLimit(t)}>
              {t === null ? 'None' : limitLabel(t)}
            </button>
          ))}
        </div>
        <p className="muted setup-note">
          {turnLimit === null
            ? 'Turns can take as long as they need.'
            : `A player who takes longer than ${limitLabel(turnLimit)} over a turn ends the game for everyone.`}
        </p>
        {error && <p className="error">{error}</p>}
        <button className="confirm" onClick={create} disabled={busy}>
          {busy ? 'Creating…' : 'Create game'}
        </button>
        <p className="muted setup-note">Bots take their turns on their own; friends join with the game's code.</p>
      </div>
    </div>
  );
}

// ---- Joining a game ----

function JoinGame({ initialCode, onBack, onJoined }: { initialCode: string; onBack: () => void; onJoined: (ticket: SavedTicket) => void }) {
  const [code, setCode] = useState(initialCode);
  const [info, setInfo] = useState<LobbyInfo | null>(null);
  const [name, setName] = useState(savedName);
  const [seat, setSeat] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A full code looks the game up straight away.
  useEffect(() => {
    setInfo(null);
    setError(null);
    if (code.length !== CODE_LENGTH) return;
    // Already in it: open it.
    const mine = savedTickets().find((t) => t.code === code);
    if (mine) {
      onJoined(mine);
      return;
    }
    let cancelled = false;
    lobbyInfo(code)
      .then((i) => {
        if (cancelled) return;
        setInfo(i);
        setSeat(i.seats.findIndex((s) => s.kind === 'human' && !s.name));
      })
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  const free = info?.seats.flatMap((s, i) => (s.kind === 'human' && !s.name ? [i] : [])) ?? [];

  const join = async () => {
    if (seat === null || seat < 0) return;
    if (!name.trim()) {
      setError('Enter your name');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      saveName(name);
      onJoined(saveTicket(await joinGame(code, { seat, name: name.trim() })));
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
      // Someone may have just taken the seat: look again.
      lobbyInfo(code).then(setInfo, () => {});
    }
  };

  return (
    <div className="screen">
      <div className="screen-card">
        <div className="panel-header">
          <button className="close" onClick={onBack} aria-label="Back">
            ‹
          </button>
          <h2>Join game</h2>
        </div>
        {inIosBrowser && (
          <p className="notice app-notice">
            <strong>Have Brass on your home screen?</strong> Open it and tap Play online → Join with code. A game joined here, in the
            browser, won't show up in the app.
          </p>
        )}
        <h3>Game code</h3>
        <input
          className="code-input"
          value={code}
          aria-label="Game code"
          placeholder="ABCDE"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          autoFocus={!initialCode}
          onChange={(e) => setCode(normalizeCode(e.target.value))}
        />
        {info && (
          <>
            <h3>Players</h3>
            <div className="name-list">
              {info.seats.map((s, i) => {
                const open = s.kind === 'human' && !s.name;
                return (
                  <button
                    key={i}
                    className={`lobby-seat ${open ? 'open' : ''} ${seat === i ? 'selected' : ''}`}
                    disabled={!open}
                    onClick={() => setSeat(i)}
                  >
                    <span className={`dot owner-${i}`} aria-hidden />
                    <span className="lobby-seat-name">{open ? (seat === i ? 'You' : 'Free seat') : seatName(s, i)}</span>
                    {s.kind === 'bot' && <span className="muted">{DIFFICULTY_LABEL[s.difficulty]} bot</span>}
                  </button>
                );
              })}
            </div>
            {free.length === 0 ? (
              <p className="muted">This game is full.</p>
            ) : (
              <>
                <h3>Your name</h3>
                <input
                  className="name-input"
                  value={name}
                  maxLength={24}
                  aria-label="Your name"
                  placeholder="Your name"
                  onChange={(e) => setName(e.target.value)}
                />
              </>
            )}
          </>
        )}
        {error && <p className="error">{error}</p>}
        {info && free.length > 0 && (
          <button className="confirm" onClick={join} disabled={busy || seat === null || seat < 0}>
            {busy ? 'Joining…' : 'Join game'}
          </button>
        )}
      </div>
    </div>
  );
}

// ---- A game ----

function OnlineGame({ ticket, onBack }: { ticket: SavedTicket; onBack: () => void }) {
  const { snapshot, match, connection, error, clearError, play, playBot, start } = useOnlineGame(ticket);
  const [introSeen, setIntroSeen] = useState(!!ticket.introSeen);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Notifications for this game, if they're on (it's safe to sign up again each time).
  useEffect(() => void registerPush(ticket), [ticket]);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  // The server's complaints fade after a moment.
  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(clearError, 4000);
    return () => clearTimeout(t);
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  const game = useMemo<Game | null>(() => {
    if (!snapshot || !match) return null;
    const seats = snapshot.seats.map(
      (s, i): Seat => (s.kind === 'bot' ? { kind: 'bot', difficulty: s.difficulty } : i === snapshot.you ? { kind: 'human' } : { kind: 'remote' }),
    );
    return { match, names: snapshot.seats.map(seatName), seats, introSeen };
  }, [snapshot, match, introSeen]);

  /** Leaves for good: the server is told (freeing the seat, or cancelling the game), then this phone forgets it. */
  const leave = async () => {
    setLeaving(true);
    setLeaveError(null);
    try {
      await leaveGame(ticket.code, ticket.token);
      forgetTicket(ticket.code);
      onBack();
    } catch (e) {
      setLeaveError(errorText(e));
      setLeaving(false);
    }
  };
  /** A cancelled game: nothing more to do with it. */
  const dismiss = () => {
    forgetTicket(ticket.code);
    onBack();
  };

  if (!snapshot || !game) {
    return (
      <div className="screen">
        <div className="screen-card">
          <div className="panel-header">
            <button className="close" onClick={onBack} aria-label="Back">
              ‹
            </button>
            <h2>Game {ticket.code}</h2>
          </div>
          <p className="muted">{connection === 'offline' ? "Can't reach the game. Trying again…" : 'Connecting…'}</p>
        </div>
      </div>
    );
  }

  if (snapshot.status === 'lobby') {
    return (
      <Lobby
        turnLimit={snapshot.turnLimit}
        code={snapshot.code}
        seats={snapshot.seats}
        you={snapshot.you}
        onStart={start}
        onBack={onBack}
        onLeave={leave}
        error={leaveError ?? error}
      />
    );
  }

  const cancelled = snapshot.status === 'cancelled';
  const finished = !!brass.brassGame.outcome(game.match.state);
  // Bots' turns are worked out by one phone: the first player who's online.
  const runsBots = !cancelled && snapshot.seats.findIndex((s) => s.kind === 'human' && s.online) === snapshot.you;
  return (
    <>
      <Table
        game={game}
        play={play}
        playBot={playBot}
        onMenu={onBack}
        menuLabel="Online games"
        onNewGame={onBack}
        onExitTutorial={onBack}
        onKeepPlaying={() => {}}
        onIntroDone={() => {
          markIntroSeen(ticket.code);
          setIntroSeen(true);
        }}
        runsBots={runsBots && connection === 'open'}
        status={
          <span className="online-status">
            {!cancelled && <TurnClock snapshot={snapshot} />}
            <ConnectionStatus connection={connection} seats={snapshot.seats} you={snapshot.you} />
          </span>
        }
        extraMenu={cancelled ? [] : [[finished ? 'Remove game' : 'Leave game', () => setConfirmLeave(true)]]}
      />
      {error && !cancelled && (
        <div className="online-toast error" role="alert" onClick={clearError}>
          {error}
        </div>
      )}
      {confirmLeave && !cancelled && (
        <div className="overlay online-modal" onClick={() => !leaving && setConfirmLeave(false)}>
          <div className="screen-card" role="alertdialog" aria-label="Leave the game" onClick={(e) => e.stopPropagation()}>
            {finished ? (
              <>
                <h2>Remove this game?</h2>
                <p className="muted">It's over, so it just leaves your list of games.</p>
              </>
            ) : (
              <>
                <h2>Leave the game?</h2>
                <p className="muted">The game will be cancelled for everyone. This can't be undone.</p>
              </>
            )}
            {leaveError && <p className="error">{leaveError}</p>}
            <div className="online-actions">
              <button className="secondary" onClick={() => setConfirmLeave(false)} disabled={leaving}>
                Stay
              </button>
              <button className="confirm danger" onClick={leave} disabled={leaving}>
                {leaving ? 'Leaving…' : finished ? 'Remove' : 'Leave game'}
              </button>
            </div>
          </div>
        </div>
      )}
      {cancelled && (
        <div className="overlay online-modal">
          <div className="screen-card" role="alertdialog" aria-label="Game cancelled">
            <h2>Game cancelled</h2>
            <p>
              {snapshot.leftBy !== null && snapshot.seats[snapshot.leftBy]
                ? `${seatName(snapshot.seats[snapshot.leftBy]!, snapshot.leftBy)} ${snapshot.cancelReason === 'timeout' ? 'ran out of time' : 'left the game'}, so it's been cancelled.`
                : 'This game was called off.'}
            </p>
            <button className="confirm" onClick={dismiss}>
              Back to online games
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Turning on notifications (your turn, a game starting or ending). Shown until they're on; on an iPhone in
 * Safari, where they can't be, it says how to get them.
 */
function PushPrompt() {
  const [state, setState] = useState<PushState>(pushState);
  const [busy, setBusy] = useState(false);
  if (state === 'granted') return null;
  if (state === 'unsupported') {
    return inIosBrowser ? (
      <p className="notice app-notice">
        To be notified when it's your turn, add Brass to your Home Screen (Share → Add to Home Screen) and play from there.
      </p>
    ) : null;
  }
  if (state === 'denied') return <p className="muted setup-note">Notifications are blocked for Brass in your phone's settings.</p>;
  return (
    <div className="notice app-notice push-prompt">
      <span>Get a notification when it's your turn.</span>
      <button
        className="confirm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setState(await enablePush().catch(() => pushState()));
          setBusy(false);
        }}
      >
        Turn on
      </button>
    </div>
  );
}

/** "3 min", "1 hour", "1 day". */
function limitLabel(seconds: number): string {
  if (seconds % 86400 === 0) return seconds === 86400 ? '1 day' : `${seconds / 86400} days`;
  if (seconds % 3600 === 0) return seconds === 3600 ? '1 hour' : `${seconds / 3600} hours`;
  return `${Math.round(seconds / 60)} min`;
}

/** Time left in the current turn, counting down; red near the end. Hidden with no limit (or on a bot's turn). */
function TurnClock({ snapshot }: { snapshot: GameSnapshot }) {
  // The server's clock, as this phone's: their difference, measured when the game was sent.
  const offset = useMemo(() => snapshot.now - Date.now(), [snapshot]);
  const [, tick] = useState(0);
  const deadline = snapshot.turnDeadline;
  useEffect(() => {
    if (deadline === null) return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [deadline]);
  if (deadline === null || snapshot.turnLimit === null) return null;
  const left = Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000));
  const urgent = left <= Math.min(60, snapshot.turnLimit * 0.2);
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const text = h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(left % 60).padStart(2, '0')}`;
  return (
    <span className={`turn-clock ${urgent ? 'urgent' : ''}`} title="Time left this turn" aria-label={`${text} left this turn`}>
      ⏱ {text}
    </span>
  );
}

/** The top bar's dot: green when connected; who else is away, if anyone. */
function ConnectionStatus({ connection, seats, you }: { connection: string; seats: PublicSeat[]; you: number }) {
  const away = seats.flatMap((s, i) => (s.kind === 'human' && i !== you && !s.online ? [seatName(s, i)] : []));
  // Kept short: the top bar is narrow on a phone (who's away is in the tooltip).
  const text = connection !== 'open' ? 'Reconnecting…' : away.length > 0 ? `${away.length} away` : 'Online';
  const title = connection === 'open' && away.length > 0 ? `${away.join(', ')} away` : text;
  return (
    <span className={`connection ${connection === 'open' ? 'open' : 'down'}`} title={title}>
      <span className="connection-dot" aria-hidden />
      {text !== 'Online' && <span className="connection-text">{text}</span>}
    </span>
  );
}

/** Before the game starts: the code to share, who's in, and Start once everyone is. */
function Lobby({
  turnLimit,
  code,
  seats,
  you,
  onStart,
  onBack,
  onLeave,
  error,
}: {
  turnLimit: number | null;
  code: string;
  seats: PublicSeat[];
  you: number;
  onStart: () => void;
  onBack: () => void;
  /** Gives up the seat for good. */
  onLeave: () => void;
  error: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const waiting = seats.filter((s) => s.kind === 'human' && !s.name).length;
  const url = joinLink(code);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Nothing more to try: the code is on screen.
    }
  };
  const share = () => navigator.share({ title: 'Brass', text: `Join my game of Brass (code ${code}):`, url }).catch(() => {});

  return (
    <div className="screen">
      <div className="screen-card">
        <div className="panel-header">
          <button className="close" onClick={onBack} aria-label="Back">
            ‹
          </button>
          <h2>Waiting for players</h2>
        </div>
        <p className="muted">Send your friends this code, or the link.</p>
        <div className="lobby-code" aria-label={`Game code ${code.split('').join(' ')}`}>
          {code}
        </div>
        <div className="online-actions">
          <button className="secondary" onClick={copy}>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
          {'share' in navigator && (
            <button className="secondary" onClick={share}>
              Share…
            </button>
          )}
        </div>
        <h3>Players</h3>
        <div className="name-list">
          {seats.map((s, i) => (
            <div key={i} className="lobby-seat">
              <span className={`dot owner-${i}`} aria-hidden />
              <span className="lobby-seat-name">
                {s.kind === 'bot' ? s.name : (s.name ?? 'Waiting…')}
                {i === you && ' (you)'}
              </span>
              {s.kind === 'bot' ? (
                <span className="muted">{DIFFICULTY_LABEL[s.difficulty]} bot</span>
              ) : (
                s.name && <span className={`presence ${s.online ? 'on' : ''}`} title={s.online ? 'Online' : 'Away'} />
              )}
            </div>
          ))}
        </div>
        {turnLimit !== null && <p className="muted">Max turn time: {limitLabel(turnLimit)}</p>}
        <PushPrompt />
        {error && <p className="error">{error}</p>}
        <button className="confirm" onClick={onStart} disabled={waiting > 0}>
          {waiting > 0 ? `Waiting for ${waiting} more` : 'Start game'}
        </button>
        <button className="link-button lobby-leave" onClick={onLeave}>
          Leave game
        </button>
      </div>
    </div>
  );
}

/**
 * Opened in Safari on an iPhone or iPad, not the home-screen app. Links there always open in the browser,
 * and the browser keeps its games apart from the app's.
 */
const inIosBrowser =
  (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)) &&
  !(navigator as { standalone?: boolean }).standalone &&
  !matchMedia('(display-mode: standalone)').matches;

const errorText = (e: unknown) =>
  e instanceof TypeError ? "Can't reach the game server. Check your connection." : e instanceof Error ? e.message : String(e);
