import { brass } from '@brass/engine';
import { useEffect, useMemo, useState } from 'react';
import { Board } from './board/Board.tsx';
import { EMPTY_DRAFT, highlights, type Draft } from './game/draft.ts';
import { canUndo, useGame, type Game } from './game/useGame.ts';
import { BottomSheet } from './layout/BottomSheet.tsx';
import { GameOver, Handoff, NewGame, PlayerStrip } from './ui/Screens.tsx';
import { TurnPanel, tapSlot } from './ui/TurnPanel.tsx';

export function App() {
  const { game, start, play, undoLast, quit } = useGame();
  const [showSetup, setShowSetup] = useState(!game);

  if (!game || showSetup) {
    return (
      <NewGame
        onStart={(names) => {
          start(names);
          setShowSetup(false);
        }}
        onResume={game && !brass.brassGame.outcome(game.match.state) ? () => setShowSetup(false) : undefined}
      />
    );
  }
  return (
    <Table
      game={game}
      play={play}
      undoLast={undoLast}
      onMenu={() => setShowSetup(true)}
      onNewGame={() => {
        quit();
        setShowSetup(true);
      }}
    />
  );
}

function Table({
  game,
  play,
  undoLast,
  onMenu,
  onNewGame,
}: {
  game: Game;
  play: (player: number, action: brass.BrassAction) => string | null;
  undoLast: () => void;
  onMenu: () => void;
  onNewGame: () => void;
}) {
  const { match, names } = game;
  const state = match.state;
  const player = brass.currentPlayer(state);
  const outcome = brass.brassGame.outcome(state);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [revealedFor, setRevealedFor] = useState<number | null>(names.length === 1 ? player : null);
  const [message, setMessage] = useState<string | null>(null);

  // A new player (or a new phase) starts with a fresh draft.
  useEffect(() => setDraft(EMPTY_DRAFT), [player, state.phase.kind, match.log.length]);

  const viewer = player ?? 0;
  const view = useMemo(() => brass.brassGame.viewFor(state, viewer), [state, viewer]);
  const legal = useMemo(() => (player === null ? [] : brass.brassGame.legalActions(state, player)), [state, player]);
  const lit = useMemo(() => highlights(view, viewer, legal, draft), [view, viewer, legal, draft]);

  const hidden = player !== null && revealedFor !== player;

  const submit = (action: brass.BrassAction) => {
    if (player === null) return;
    const error = play(player, action);
    setMessage(error);
    if (!error) setDraft(EMPTY_DRAFT);
  };

  const p = player === null ? null : view.players[player]!;
  const actionsThisTurn = brass.actionsThisTurn(state);
  const coalPrice = state.coalMarket > 0 ? brass.COAL_MARKET.prices[brass.COAL_MARKET.prices.length - state.coalMarket] : brass.COAL_MARKET.emptyPrice;
  const ironPrice = state.ironMarket > 0 ? brass.IRON_MARKET.prices[brass.IRON_MARKET.prices.length - state.ironMarket] : brass.IRON_MARKET.emptyPrice;

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={onMenu} aria-label="Menu">
          Brass ☰
        </button>
        <span className="topbar-status">
          {state.era === 'canal' ? 'Canal' : 'Rail'} Era · Round {state.round}
        </span>
      </header>
      <PlayerStrip view={view} names={names} active={player} />
      <main className="board-area">
        <Board
          state={view}
          highlights={hidden ? undefined : lit}
          onSlot={(location, slot) => {
            if (state.phase.kind === 'shortfall') submit({ type: 'removeTile', location, slot });
            else setDraft((d) => tapSlot(d, location, slot, view, legal));
          }}
          onLink={(id) => setDraft((d) => ({ ...d, links: [...d.links, id] }))}
        />
      </main>
      <BottomSheet
        title={
          p && player !== null ? (
            <>
              {names[player]} · £{p.money}
              {state.phase.kind === 'actions' && (
                <span className="muted">
                  {' '}
                  · action {state.actionsTaken + 1} of {actionsThisTurn}
                </span>
              )}
            </>
          ) : (
            'Game over'
          )
        }
      >
        {message && <p className="error">{message}</p>}
        {player !== null && !hidden && (
          <TurnPanel
            view={view}
            player={player}
            legal={legal}
            draft={draft}
            setDraft={setDraft}
            validate={(a) => brass.brassGame.validate(state, player, a)}
            onPlay={submit}
            canUndo={canUndo(match)}
            onUndo={undoLast}
          />
        )}
        <p className="market-row muted">
          Coal market {state.coalMarket} (next £{coalPrice}) · Iron market {state.ironMarket} (next £{ironPrice}) · Deck{' '}
          {view.deckSize}
        </p>
      </BottomSheet>
      {hidden && player !== null && <Handoff name={names[player]!} onReady={() => setRevealedFor(player)} />}
      {outcome && <GameOver outcome={outcome} names={names} onNewGame={onNewGame} />}
    </div>
  );
}
