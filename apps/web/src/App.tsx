import { brass } from '@brass/engine';
import { useEffect, useMemo, useState } from 'react';
import { Board } from './board/Board.tsx';
import { EMPTY_DRAFT, availableKinds, developIndustries, highlights, usableCards, type Draft } from './game/draft.ts';
import { canUndo, useGame, type Game } from './game/useGame.ts';
import { ActionRail } from './ui/ActionRail.tsx';
import { HandTray, type TrayTab } from './ui/HandTray.tsx';
import { PlayerMat } from './ui/PlayerMat.tsx';
import { GameOver, Handoff, MatSheet, NewGame, PlayerStrip } from './ui/Screens.tsx';
import { StepPanel, pickCard, tapMatRow, tapSlot } from './ui/TurnPanel.tsx';

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
  const [tucked, setTucked] = useState(false);
  const [trayTab, setTrayTab] = useState<TrayTab>('hand');
  /** Another player whose mat is open in a sheet. */
  const [matFor, setMatFor] = useState<number | null>(null);

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
  const hand = p?.hand ?? [];
  const usable = draft.kind ? usableCards(view.cards, hand, legal, draft.kind) : null;
  const selectedCards = new Set(draft.kind === 'scout' ? draft.scoutCards : draft.card ? [draft.card] : []);
  const showControls = player !== null && !hidden;
  // Develop, once its card is chosen, is played by tapping industries on the mat.
  const developing = draft.kind === 'develop' && draft.card !== null;
  const developable = useMemo(() => new Set(developIndustries(view.cards, legal, draft)), [view.cards, legal, draft]);
  // Building with a town card: jump the map to that town.
  const focusCard = draft.kind === 'build' && draft.card ? view.cards[draft.card] : undefined;
  const buildFocus = focusCard?.kind === 'location' ? { location: focusCard.location, key: draft.card! } : null;
  // Double-tapping a town card with no action chosen also shows that town.
  const [peek, setPeek] = useState<{ location: brass.LocationId; key: string } | null>(null);
  const peekAt = (id: brass.CardId) => {
    const card = view.cards[id];
    if (draft.kind || card?.kind !== 'location') return;
    setPeek({ location: card.location, key: `${id}:${Date.now()}` });
  };

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={onMenu} aria-label="Menu">
          Brass ☰
        </button>
        <span className="topbar-status">
          {state.era === 'canal' ? 'Canal' : 'Rail'} · Round {state.round}
          {state.phase.kind === 'actions' && player !== null && (
            <>
              {' '}
              · Action {state.actionsTaken + 1}/{actionsThisTurn}
            </>
          )}
        </span>
      </header>
      <PlayerStrip
        view={view}
        names={names}
        active={player}
        onSelect={(id) => {
          // Your own mat lives in the tray; anyone else's opens in a sheet.
          if (id === player && showControls) {
            setTrayTab('mat');
            setTucked(false);
          } else setMatFor(id);
        }}
      />
      <main className="board-area">
        <Board
          state={view}
          names={names}
          highlights={hidden ? undefined : lit}
          onSlot={(location, slot) => {
            if (state.phase.kind === 'shortfall') submit({ type: 'removeTile', location, slot });
            else setDraft((d) => tapSlot(d, location, slot, view, legal));
          }}
          onLink={(id) => setDraft((d) => ({ ...d, links: [...d.links, id] }))}
          focus={buildFocus ?? peek}
        />
        {showControls && state.phase.kind === 'actions' && (
          <ActionRail
            available={availableKinds(legal)}
            selected={draft.kind}
            onSelect={(kind) => {
              setDraft(kind ? { ...EMPTY_DRAFT, kind } : EMPTY_DRAFT);
              setMessage(null);
              if (kind) {
                setTucked(false);
                setTrayTab('hand');
              }
            }}
            canUndo={canUndo(match)}
            onUndo={undoLast}
          />
        )}
        {showControls && (
          <HandTray
            cards={view.cards}
            hand={hand}
            usable={usable}
            selected={selectedCards}
            onPick={(id) => {
              if (!draft.kind) return;
              const next = pickCard(draft, id);
              setDraft(next);
              // Develop is played on the mat: once the card is chosen, show it.
              if (next.kind === 'develop' && next.card) setTrayTab('mat');
            }}
            onDoubleTap={peekAt}
            tucked={tucked}
            onTuckedChange={setTucked}
            tab={trayTab}
            onTabChange={setTrayTab}
            mat={
              developing ? (
                <PlayerMat
                  player={p!}
                  era={state.era}
                  picks={draft.industries}
                  selectable={developable}
                  onRow={(ind) => setDraft((d) => tapMatRow(d, ind, developable))}
                  onUnpick={(i) => setDraft((d) => ({ ...d, industries: d.industries.filter((_, j) => j !== i) }))}
                />
              ) : (
                <PlayerMat player={p!} era={state.era} />
              )
            }
            panelOnMat={developing}
            header={
              <>
                Deck {view.deckSize} · Coal £{coalPrice} · Iron £{ironPrice}
              </>
            }
          >
            {message && <p className="error">{message}</p>}
            <StepPanel
              view={view}
              player={player}
              legal={legal}
              draft={draft}
              setDraft={setDraft}
              validate={(a) => brass.brassGame.validate(state, player, a)}
              onPlay={submit}
            />
          </HandTray>
        )}
      </main>
      {matFor !== null && (
        <MatSheet
          player={view.players[matFor]!}
          name={names[matFor]!}
          era={state.era}
          onClose={() => setMatFor(null)}
        />
      )}
      {hidden && player !== null && <Handoff name={names[player]!} onReady={() => setRevealedFor(player)} />}
      {outcome && <GameOver outcome={outcome} names={names} onNewGame={onNewGame} />}
    </div>
  );
}
