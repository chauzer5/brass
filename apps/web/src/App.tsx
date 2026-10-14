import { brass } from '@brass/engine';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Board, MARKET_BOX, saleDuration, type MarketSale } from './board/Board.tsx';
import { EMPTY_DRAFT, availableKinds, compose, developIndustries, highlights, tapLink, usableCards, type Draft } from './game/draft.ts';
import { explainBuild } from './game/explain.ts';
import { canUndo, useGame, type Game } from './game/useGame.ts';
import { ActionRail } from './ui/ActionRail.tsx';
import { HandTray, type Arriving, type TrayTab } from './ui/HandTray.tsx';
import { IncomeTrack } from './ui/IncomeTrack.tsx';
import { PlayerMat } from './ui/PlayerMat.tsx';
import { DiscardSheet, GameOver, Handoff, MatSheet, NewGame, PlayerStrip } from './ui/Screens.tsx';
import { StepPanel, pickCard, tapMatRow, tapMerchant, tapSlot } from './ui/TurnPanel.tsx';
import { choosable, chosenSource, sourceNeeds } from './game/sources.ts';
import { recapSince } from './game/recap.ts';

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
  const [showDiscards, setShowDiscards] = useState(false);

  // A new player (or a new phase) starts with a fresh draft.
  useEffect(() => setDraft(EMPTY_DRAFT), [player, state.phase.kind, match.log.length]);

  const viewer = player ?? 0;
  const view = useMemo(() => brass.brassGame.viewFor(state, viewer), [state, viewer]);
  const legal = useMemo(() => (player === null ? [] : brass.brassGame.legalActions(state, player)), [state, player]);
  // Coal, iron and beer the action needs, and the one whose source the map is choosing.
  const base = compose(draft);
  const baseKey = JSON.stringify(base && base.type === 'sell' ? { ...base, sales: base.sales.map(({ develop: _, ...s }) => s) } : base);
  const needs = useMemo(
    () => (base && player !== null && state.phase.kind === 'actions' ? sourceNeeds(state, player, base, draft.picks) : []),
    [state, player, baseKey, draft.picks], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const choices = choosable(needs);
  const activeNeed = draft.pendingSale ? undefined : (choices.find((n) => n.id === draft.activeNeed) ?? choices[0]);
  // A different action underneath (another space, link or tile) starts its sources afresh.
  useEffect(() => {
    setDraft((d) => (Object.keys(d.picks).length > 0 || d.activeNeed ? { ...d, picks: {}, activeNeed: null } : d));
  }, [baseKey]);

  const lit = useMemo(() => {
    const h = highlights(view, viewer, legal, draft);
    if (draft.kind === 'sell' && draft.pendingSale) {
      // Selling a tile: light the Merchant towns that buy it.
      const key = brass.slotKey(draft.pendingSale.location, draft.pendingSale.slot);
      const spaces = legal.flatMap((a) =>
        a.type === 'sell' && a.sales.length === 1 && brass.slotKey(a.sales[0]!.location, a.sales[0]!.slot) === key ? [a.sales[0]!.merchant] : [],
      );
      h.merchants = new Set(spaces.map((m) => view.merchants[m]!.location));
      h.selectedSlots.add(key);
    } else if (activeNeed) {
      const chosen = chosenSource(activeNeed, draft.picks);
      h.sources = new Set(activeNeed.options.filter((o): o is brass.SlotKey => o !== 'market' && o !== 'merchant'));
      h.selectedSource = chosen !== 'market' && chosen !== 'merchant' ? (chosen as brass.SlotKey) : null;
      if (activeNeed.options.includes('market') && activeNeed.kind !== 'beer') h.market = { kind: activeNeed.kind, selected: chosen === 'market' };
      const sale = activeNeed.sale !== undefined ? draft.sales[activeNeed.sale] : undefined;
      if (sale && activeNeed.options.includes('merchant')) {
        const location = view.merchants[sale.merchant]!.location;
        h.merchants = new Set([location]);
        h.selectedMerchant = chosen === 'merchant' ? location : null;
      }
    }
    return h;
  }, [view, viewer, legal, draft, activeNeed]);

  // When the map is choosing a source, frame the spot being built on (or sold from, or linked) with every option.
  const sourceFrame = useMemo(() => {
    if (!activeNeed || !base) return null;
    const pts = activeNeed.options
      .filter((o) => o !== 'market' && o !== 'merchant')
      .map((k) => brass.LOCATION_BY_ID[brass.parseSlotKey(k as brass.SlotKey).location].pos);
    if (base.type === 'build') pts.push(brass.LOCATION_BY_ID[base.location].pos);
    if (base.type === 'network') for (const id of base.links) for (const end of brass.LINKS.find((l) => l.id === id)!.ends) pts.push(brass.LOCATION_BY_ID[end].pos);
    if (base.type === 'sell' && activeNeed.sale !== undefined) {
      const sale = base.sales[activeNeed.sale]!;
      pts.push(brass.LOCATION_BY_ID[sale.location].pos, brass.LOCATION_BY_ID[view.merchants[sale.merchant]!.location].pos);
    }
    if (activeNeed.options.includes('market')) pts.push({ x: MARKET_BOX.x0, y: MARKET_BOX.y0 }, { x: MARKET_BOX.x1, y: MARKET_BOX.y1 });
    if (pts.length === 0) return null;
    const pad = 45;
    return {
      key: `${activeNeed.id}|${baseKey}`,
      box: {
        x0: Math.min(...pts.map((p) => p.x)) - pad,
        y0: Math.min(...pts.map((p) => p.y)) - pad,
        x1: Math.max(...pts.map((p) => p.x)) + pad,
        y1: Math.max(...pts.map((p) => p.y)) + pad,
      },
    };
  }, [activeNeed?.id, baseKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Picks a source for the active need, then moves on to the next choice, if any. */
  const pickSource = (source: string) => {
    if (!activeNeed || !activeNeed.options.includes(source)) return false;
    const next = choices[choices.indexOf(activeNeed) + 1];
    setDraft((d) => ({ ...d, picks: { ...d.picks, [activeNeed.id]: source }, activeNeed: next?.id ?? activeNeed.id }));
    return true;
  };

  const hidden = player !== null && revealedFor !== player;

  // What the others did since this player's last turn: listed on the handoff screen, then glowing on the map
  // until this player starts an action.
  const recap = useMemo(
    () => (hidden && player !== null ? recapSince(match, player) : []),
    [hidden, player, match.log.length], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [recent, setRecent] = useState<{ slots: Set<brass.SlotKey>; links: Set<string>; at: number } | null>(null);
  const showRecent = recent && recent.at === match.log.length && !draft.kind && !hidden;
  const shown = useMemo(
    () => (showRecent ? { ...lit, recentSlots: recent!.slots, recentLinks: recent!.links } : lit),
    [lit, showRecent, recent],
  );


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
  // A new Coal Mine or Iron Works that sold cubes to its market: animate them flying there.
  const [sale, setSale] = useState<MarketSale | null>(null);
  const before = useRef({ state, length: match.log.length });
  useLayoutEffect(() => {
    const prev = before.current;
    before.current = { state, length: match.log.length };
    if (match.log.length !== prev.length + 1) return;
    const last = match.log.at(-1)!.action;
    if (last.type !== 'build' || (last.industry !== 'coal' && last.industry !== 'iron')) return;
    const kind = last.industry;
    const field = kind === 'coal' ? 'coalMarket' : 'ironMarket';
    // Building one of these only ever adds to its own market, filling the most expensive empty spaces first.
    const sold = state[field] - prev.state[field];
    if (sold <= 0) return;
    const n = (kind === 'coal' ? brass.COAL_MARKET : brass.IRON_MARKET).prices.length;
    const spaces = Array.from({ length: sold }, (_, i) => n - prev.state[field] - 1 - i);
    setSale({ id: String(match.log.length), kind, location: last.location, slot: last.slot, spaces });
  }, [match.log.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sale) return;
    const t = window.setTimeout(() => setSale(null), saleDuration(sale) + 100);
    return () => clearTimeout(t);
  }, [sale]);

  // Cards new to a player's hand since they last saw it fly in from the deck: the deal, the
  // end-of-turn draw (seen when the player next takes the device), and Wild cards from scouting.
  const [arriving, setArriving] = useState<Arriving | null>(null);
  const seenHands = useRef(new Map<number, Set<brass.CardId>>());
  const seenLength = useRef(match.log.length);
  useLayoutEffect(() => {
    const undone = match.log.length < seenLength.current;
    seenLength.current = match.log.length;
    if (!showControls || player === null) return;
    const seen = seenHands.current.get(player);
    seenHands.current.set(player, new Set(hand));
    // Undo puts cards back; they didn't come from the deck.
    if (undone || tucked || trayTab !== 'hand') return;
    const fresh = hand.filter((id) => !seen?.has(id));
    if (fresh.length > 0) setArriving({ ids: new Set(fresh), key: `${player}:${match.log.length}:${fresh.join()}` });
  }, [showControls, player, hand.join(), match.log.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <img src="/icon.svg" alt="" className="brand-logo" />
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
          sale={sale}
          explainSlot={
            showControls && state.phase.kind === 'actions' && draft.kind === 'build' && draft.card
              ? (location, slot) => explainBuild(state, player!, draft.card!, location, slot)
              : undefined
          }
          onDiscards={() => setShowDiscards(true)}
          highlights={hidden ? undefined : shown}
          onSlot={(location, slot) => {
            if (state.phase.kind === 'shortfall') submit({ type: 'removeTile', location, slot });
            else {
              // A lit source (and not also a space being built on or sold) sets where the cube or barrel comes from.
              const key = brass.slotKey(location, slot);
              if (!lit.slots.has(key) && lit.sources?.has(key) && pickSource(key)) return;
              setDraft((d) => tapSlot(d, location, slot, view, legal));
            }
          }}
          onMarket={() => pickSource('market')}
          onMerchant={(location) => {
            if (draft.pendingSale) setDraft((d) => tapMerchant(d, location, view, legal));
            else pickSource('merchant');
          }}
          onLink={(id) => setDraft((d) => tapLink(view.cards, legal, d, id))}
          frame={hidden ? null : sourceFrame}
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
            arriving={arriving}
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
              <>
              <div className="tray-income">
                <h3>Income</h3>
                <IncomeTrack players={view.players} focus={player!} />
              </div>
              {developing ? (
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
              )}
              </>
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
              full={state}
              names={names}
              onPlay={submit}
            />
          </HandTray>
        )}
      </main>
      {showDiscards && <DiscardSheet view={view} names={names} onClose={() => setShowDiscards(false)} />}
      {matFor !== null && (
        <MatSheet
          player={view.players[matFor]!}
          players={view.players}
          name={names[matFor]!}
          era={state.era}
          onClose={() => setMatFor(null)}
        />
      )}
      {/* The next player's screen waits for a sale animation to finish, so whoever built sees it. */}
      {hidden && player !== null && !sale && (
        <Handoff
          name={names[player]!}
          names={names}
          recap={recap}
          onReady={() => {
            setRevealedFor(player);
            setRecent({
              slots: new Set(recap.flatMap((r) => r.slots)),
              links: new Set(recap.flatMap((r) => r.links)),
              at: match.log.length,
            });
          }}
        />
      )}
      {outcome && <GameOver outcome={outcome} names={names} onNewGame={onNewGame} />}
    </div>
  );
}
