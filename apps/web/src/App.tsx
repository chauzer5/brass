import { brass } from '@brass/engine';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Board, MARKET_BOX, cubesDuration, eraDuration, goodsDuration, saleDuration, type MarketSale } from './board/Board.tsx';
import { effectsOf, type CubeScene, type EraScene, type GoodsSale } from './game/effects.ts';
import { EMPTY_DRAFT, availableKinds, compose, developIndustries, highlights, tapLink, usableCards, type Draft } from './game/draft.ts';
import { explainBuild, explainBuildAny } from './game/explain.ts';
import { canUndo, useGame, type Game } from './game/useGame.ts';
import { ActionRail } from './ui/ActionRail.tsx';
import { HandTray, type Arriving, type TrayTab } from './ui/HandTray.tsx';
import { IncomeTrack } from './ui/IncomeTrack.tsx';
import { PlayerMat } from './ui/PlayerMat.tsx';
import { Rulebook } from './ui/Rulebook.tsx';
import { DiscardSheet, EraSummary, FirstPlayer, GameLogSheet, Handoff, Settings, MatSheet, NewGame, PlayerStrip } from './ui/Screens.tsx';
import { StepPanel, pickCard, tapMatRow, tapMerchant, tapSlot } from './ui/TurnPanel.tsx';
import { choosable, chosenSource, gloucesterBonus, sourceNeeds } from './game/sources.ts';
import { gameLog, recapSince, type RecapItem } from './game/recap.ts';
import { runBot } from './bot/runBot.ts';
import { Coach, useCoach } from './tutorial/Coach.tsx';

/** Looking over a finished game: the whole map. */
const WHOLE_MAP = { box: { x0: 0, y0: 0, x1: 1000, y1: 1000 }, key: 'whole-map' };

/** Pause before each bot action, so people can see what's happening. */
const BOT_PAUSE_MS = 900;
/** The tutorial's fast-forward. */
const FAST_BOT_PAUSE_MS = 120;

export function App() {
  const { game, start, play, playBot, undoLast, quit, startTutorial, exitTutorial, keepPlaying, introDone } = useGame();
  const [showSetup, setShowSetup] = useState(!game);

  if (!game || showSetup) {
    return (
      <NewGame
        onStart={(names, seats) => {
          start(names, seats);
          setShowSetup(false);
        }}
        onResume={game && !brass.brassGame.outcome(game.match.state) ? () => setShowSetup(false) : undefined}
        onTutorial={() => {
          startTutorial();
          setShowSetup(false);
        }}
      />
    );
  }
  return (
    <Table
      game={game}
      play={play}
      playBot={playBot}
      undoLast={undoLast}
      onMenu={() => setShowSetup(true)}
      onNewGame={() => {
        quit();
        setShowSetup(true);
      }}
      onExitTutorial={() => {
        exitTutorial();
        setShowSetup(true);
      }}
      onKeepPlaying={keepPlaying}
      onIntroDone={introDone}
    />
  );
}

function Table({
  game,
  play,
  playBot,
  undoLast,
  onMenu,
  onNewGame,
  onExitTutorial,
  onKeepPlaying,
  onIntroDone,
}: {
  game: Game;
  play: (player: number, action: brass.BrassAction) => string | null;
  playBot: (player: number, action: brass.BrassAction, at: number) => void;
  undoLast: () => void;
  onMenu: () => void;
  onNewGame: () => void;
  onExitTutorial: () => void;
  onKeepPlaying: () => void;
  onIntroDone: () => void;
}) {
  const { match, names, seats } = game;
  const state = match.state;
  const outcome = brass.brassGame.outcome(state);
  // An era that ends while playing shows its scoring before anything else (and the game's end stays up until
  // dismissed to look at the board). Eras that ended before this game was opened aren't shown again.
  const [seenEras, setSeenEras] = useState(state.eraScores.length);
  const [resultsHidden, setResultsHidden] = useState(false);
  // Eras whose scoring has played out on the board (it plays before the summary opens).
  const [erasPlayed, setErasPlayed] = useState(state.eraScores.length);
  const scoringToPlay = state.eraScores.length > erasPlayed;
  const summaryOpen = !scoringToPlay && (outcome ? !resultsHidden : state.eraScores.length > seenEras);
  // A new Coal Mine or Iron Works selling cubes to its market (animated; see below).
  const [sale, setSale] = useState<MarketSale | null>(null);
  // Tiles sold to Merchants, cubes used to build or link, income, and an era's scoring (animated too).
  const [goods, setGoods] = useState<GoodsSale | null>(null);
  const [cubes, setCubes] = useState<CubeScene | null>(null);
  const [income, setIncome] = useState<{ id: string; amounts: number[] } | null>(null);
  const [eraScene, setEraScene] = useState<EraScene | null>(null);
  // Bots, the next player's screens and the tutorial wait for animations to finish.
  const animating = sale !== null || goods !== null || cubes !== null || scoringToPlay;
  // The tutorial's coach, when this is the tutorial.
  const coach = useCoach({ enabled: !!game.tutorial, match, playBot, busy: animating, summaryOpen });
  // Whose turn it is; `player` is that player only when it's a human at the device (bots play themselves).
  const active = brass.currentPlayer(state);
  const isBot = (id: number) => coach?.autoplay || seats[id]?.kind === 'bot';
  const humans = seats.flatMap((s, i) => (s.kind === 'human' ? [i] : []));
  const player = active !== null && !isBot(active) ? active : null;
  // With one human, their hand stays on screen through the bots' turns; with several, nobody's does.
  const soleHuman = humans.length === 1 ? humans[0]! : null;
  const handOwner = player ?? soleHuman;
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [revealedFor, setRevealedFor] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tucked, setTucked] = useState(false);
  const [trayTab, setTrayTab] = useState<TrayTab>('hand');
  /** Another player whose mat is open in a sheet. */
  const [matFor, setMatFor] = useState<number | null>(null);
  const [showDiscards, setShowDiscards] = useState(false);
  // The ☰ menu, and what it opens over the game.
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheet, setSheet] = useState<'log' | 'settings' | 'rulebook' | null>(null);
  const log = useMemo(() => (sheet === 'log' ? gameLog(match) : []), [sheet, match]);

  // Each tutorial step that asks for a move starts on the hand, with the tray open.
  const coachIndex = coach?.index;
  const coachDo = coach?.step.kind === 'do';
  useEffect(() => {
    if (!coachDo) return;
    setTrayTab('hand');
    setTucked(false);
  }, [coachIndex, coachDo]);

  // A new player (or a new phase) starts with a fresh draft.
  useEffect(() => setDraft(EMPTY_DRAFT), [player, state.phase.kind, match.log.length]);

  const viewer = handOwner ?? 0;
  const view = useMemo(() => brass.brassGame.viewFor(state, viewer), [state, viewer]);
  const allow = coach?.allow;
  const legal = useMemo(() => {
    if (player === null) return [];
    const all = brass.brassGame.legalActions(state, player);
    // In the tutorial, only the move the step teaches (none while it's explaining).
    if (!coach || state.phase.kind === 'shortfall') return all;
    return allow ? all.filter((a) => allow(a, state)) : [];
  }, [state, player, allow]); // eslint-disable-line react-hooks/exhaustive-deps
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

  // A game that hasn't started yet opens with the draw for who goes first; nothing happens until it's seen.
  // Shown once per game: leaving for the menu and coming back doesn't spin it again.
  const intro = !game.introSeen && match.log.length === 0 && !game.tutorial;

  // Pass-the-device screens are only needed between people.
  const hidden = player !== null && humans.length > 1 && revealedFor !== player;


  // What the others did since this player's last turn: listed on the handoff screen.
  const recap = useMemo(
    () => (hidden && player !== null ? recapSince(match, player) : []),
    [hidden, player, match.log.length], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Playing alone against bots there's nothing to hide: when the turn comes back, what the bots did is
  // listed on a "Your turn" screen instead.
  const [soloRecap, setSoloRecap] = useState<RecapItem[]>([]);
  const lastController = useRef<number | null>(null);
  useEffect(() => {
    if (humans.length === 1 && player !== null && lastController.current !== player && !game.tutorial) {
      const items = recapSince(match, player);
      setSoloRecap(items);
    }
    lastController.current = player;
  }, [player, match.log.length]); // eslint-disable-line react-hooks/exhaustive-deps


  const submit = (action: brass.BrassAction) => {
    if (player === null) return;
    const error = play(player, action);
    setMessage(error);
    if (error) return;
    setDraft(EMPTY_DRAFT);
    // Back to the hand (Develop and Gloucester's bonus switch to the board), so the map shows what happened.
    setTrayTab('hand');
  };

  const p = handOwner === null ? null : view.players[handOwner]!;
  const actionsThisTurn = brass.actionsThisTurn(state);
  const coalPrice = state.coalMarket > 0 ? brass.COAL_MARKET.prices[brass.COAL_MARKET.prices.length - state.coalMarket] : brass.COAL_MARKET.emptyPrice;
  const ironPrice = state.ironMarket > 0 ? brass.IRON_MARKET.prices[brass.IRON_MARKET.prices.length - state.ironMarket] : brass.IRON_MARKET.emptyPrice;
  const hand = p?.hand ?? [];
  const usable = draft.kind ? usableCards(view.cards, hand, legal, draft) : null;
  const selectedCards = new Set(draft.kind === 'scout' ? draft.scoutCards : draft.card ? [draft.card] : []);
  // Waiting on the "Your turn" screen (it holds off while a sale animation plays): no actions until it's seen.
  const showControls = player !== null && !hidden && soloRecap.length === 0 && !intro;
  // The hand (and board) tray: shown to the human in control, or to the only human while bots play.
  const showTray = handOwner !== null && !hidden;
  // Develop, once its card is chosen, is played by tapping industries on the mat.
  const developing = draft.kind === 'develop' && draft.card !== null;
  // A sale with Gloucester's beer earns a free Develop, chosen on the board too.
  const bonus = useMemo(
    () => (player !== null && !draft.pendingSale ? gloucesterBonus(state, player, base, needs, draft.picks) : null),
    [state, player, baseKey, needs, draft.picks, draft.pendingSale], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const bonusOptions = useMemo(() => new Set(bonus?.options ?? []), [bonus]);
  const setBonus = (develop: brass.Industry | null) =>
    setDraft((d) => (bonus ? { ...d, sales: d.sales.map((s, k) => (k === bonus.sale ? { ...s, develop } : s)) } : d));
  // When a bonus comes up, show the board to choose it on.
  const bonusSale = bonus?.sale ?? null;
  useEffect(() => {
    if (bonusSale !== null && bonusOptions.size > 0) setTrayTab('mat');
  }, [bonusSale]); // eslint-disable-line react-hooks/exhaustive-deps
  const developable = useMemo(() => new Set(developIndustries(view.cards, legal, draft)), [view.cards, legal, draft]);
  // Building with a town card: jump the map to that town.
  const focusCard = draft.kind === 'build' && draft.card ? view.cards[draft.card] : undefined;
  const buildFocus = focusCard?.kind === 'location' ? { location: focusCard.location, key: draft.card! } : null;
  // A new Coal Mine or Iron Works that sold cubes to its market: animate them flying there.
  const before = useRef({ state, length: match.log.length });
  useLayoutEffect(() => {
    const prev = before.current;
    before.current = { state, length: match.log.length };
    if (match.log.length !== prev.length + 1) return;
    const entry = match.log.at(-1)!;
    const last = entry.action;
    const id = String(match.log.length);
    const fx = effectsOf(prev.state, state, entry.player, last, id);
    setGoods(fx.goods);
    setCubes(fx.cubes);
    if (fx.income?.some((n) => n !== 0)) setIncome({ id, amounts: fx.income });
    if (fx.era) setEraScene(fx.era);
    else if (state.eraScores.length > erasPlayed) setErasPlayed(state.eraScores.length);
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
  useEffect(() => {
    if (!goods) return;
    const t = window.setTimeout(() => setGoods(null), goodsDuration(goods) + 100);
    return () => clearTimeout(t);
  }, [goods]);
  useEffect(() => {
    if (!cubes) return;
    const t = window.setTimeout(() => setCubes(null), cubesDuration(cubes) + 100);
    return () => clearTimeout(t);
  }, [cubes]);
  useEffect(() => {
    if (!income) return;
    const t = window.setTimeout(() => setIncome(null), 1900);
    return () => clearTimeout(t);
  }, [income]);
  // An era's scoring plays once the move's own animations have finished, then the summary opens.
  const actionPlaying = sale !== null || goods !== null || cubes !== null;
  useEffect(() => {
    if (!eraScene || actionPlaying) return;
    const t = window.setTimeout(() => {
      setEraScene(null);
      setErasPlayed(state.eraScores.length);
    }, eraDuration(eraScene) + 300);
    return () => clearTimeout(t);
  }, [eraScene, actionPlaying]); // eslint-disable-line react-hooks/exhaustive-deps
  // The board shown while an era scores is the one just before it.
  const eraBoard = useMemo(() => (eraScene ? brass.brassGame.viewFor(eraScene.board, viewer) : null), [eraScene, viewer]);
  const scoringNow = eraScene !== null && !actionPlaying;

  // Bots take their own turns: one action at a time, after a pause so the table can follow along, and not
  // while an animation or the end-of-era summary is showing.
  // (The tutorial's tutor plays scripted moves instead, except when fast-forwarding.)
  const botTurn = active !== null && isBot(active) && !outcome && !summaryOpen && !animating && !intro && (!coach || coach.autoplay);
  useEffect(() => {
    if (!botTurn || active === null) return;
    const seat = seats[active]!;
    // The tutorial's fast-forward plays your seat too.
    const difficulty = seat.kind === 'bot' ? seat.difficulty : coach?.autoplay ? 'normal' : null;
    if (!difficulty) return;
    let cancelled = false;
    const at = match.log.length;
    const input = {
      player: active,
      view: brass.brassGame.viewFor(state, active),
      legalActions: brass.brassGame.legalActions(state, active),
    };
    // The bot thinks during the pause; its move lands once both are done.
    let timer = 0;
    const pause = new Promise<void>((resolve) => {
      timer = window.setTimeout(resolve, coach?.autoplay ? FAST_BOT_PAUSE_MS : BOT_PAUSE_MS);
    });
    Promise.all([runBot(input, difficulty), pause])
      .then(([action]) => {
        if (!cancelled) playBot(active, action, at);
      })
      .catch((err) => console.error('Bot failed:', err));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [botTurn, active, match.log.length]); // eslint-disable-line react-hooks/exhaustive-deps


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
        <button className="brand" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu" aria-expanded={menuOpen} aria-haspopup="menu">
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
        payout={income}
        names={names}
        active={active}
        onSelect={(id) => {
          // Your own mat lives in the tray; anyone else's opens in a sheet.
          if (id === handOwner && showTray) {
            setTrayTab('mat');
            setTucked(false);
          } else setMatFor(id);
        }}
      />
      <main className="board-area">
        <Board
          state={eraBoard ?? view}
          names={names}
          sale={sale}
          goods={goods}
          cubes={cubes}
          era={scoringNow ? eraScene : null}
          explainSlot={
            showControls && state.phase.kind === 'actions' && draft.kind === 'build'
              ? (location, slot) =>
                  draft.card ? explainBuild(state, player!, draft.card, location, slot) : explainBuildAny(state, player!, hand, location, slot)
              : undefined
          }
          onDiscards={() => setShowDiscards(true)}
          highlights={hidden ? undefined : lit}
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
          frame={hidden ? null : outcome && resultsHidden ? WHOLE_MAP : (sourceFrame ?? coach?.frame ?? null)}
          rail={showControls && state.phase.kind === 'actions'}
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
            canUndo={!coach && canUndo(match)}
            onUndo={undoLast}
          />
        )}
        {showTray && (
          <HandTray
            cards={view.cards}
            hand={hand}
            arriving={arriving}
            usable={usable}
            selected={selectedCards}
            onPick={(id) => {
              if (!draft.kind) return;
              const next = pickCard(draft, id, view.cards, legal);
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
                <IncomeTrack players={view.players} focus={handOwner!} />
              </div>
              {bonus && bonus.options.length > 0 ? (
                <PlayerMat
                  player={p!}
                  era={state.era}
                  picks={bonus.chosen ? [bonus.chosen] : []}
                  selectable={bonusOptions}
                  // Tapping the chosen industry again takes the bonus back.
                  onRow={(ind) => setBonus(ind === bonus.chosen ? null : ind)}
                  onUnpick={() => setBonus(null)}
                />
              ) : developing ? (
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
            panelOnMat={developing || (bonus !== null && bonus.options.length > 0)}
            header={
              <>
                Deck {view.deckSize} · Coal £{coalPrice} · Iron £{ironPrice}
              </>
            }
          >
            {message && <p className="error">{message}</p>}
            {player !== null ? (
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
            ) : (
              active !== null && (
                <p className="hint bot-thinking">
                  {coach?.autoplay ? (
                    'Fast-forwarding…'
                  ) : (
                    <>
                      <span className={`dot owner-${active}`} aria-hidden /> {names[active]} is playing…
                    </>
                  )}
                </p>
              )
            )}
          </HandTray>
        )}
      </main>
      {menuOpen && (
        <>
          {/* Tapping anywhere else closes the menu. */}
          <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
          <div className="game-menu" role="menu">
            {(
              [
                coach ? (['Exit tutorial', onExitTutorial] as const) : (['Main menu', onMenu] as const),
                ['Game log', () => setSheet('log')],
                ...(__RULEBOOK__ ? ([['Rulebook', () => setSheet('rulebook')]] as const) : []),
                ['Settings', () => setSheet('settings')],
              ] as const
            ).map(([label, run]) => (
              <button
                key={label}
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  run();
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      {sheet === 'log' && <GameLogSheet entries={log} names={names} onClose={() => setSheet(null)} />}
      {sheet === 'settings' && <Settings inGame onClose={() => setSheet(null)} />}
      {sheet === 'rulebook' && __RULEBOOK__ && <Rulebook pages={__RULEBOOK__} onClose={() => setSheet(null)} />}
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
      {intro && <FirstPlayer names={names} order={state.turnOrder} onDone={onIntroDone} />}
      {hidden && player !== null && !animating && !summaryOpen && !intro && (
        <Handoff
          name={names[player]!}
          names={names}
          recap={recap}
          onReady={() => setRevealedFor(player)}
        />
      )}
      {soloRecap.length > 0 && player !== null && !animating && !summaryOpen && (
        <Handoff solo name={names[player]!} names={names} recap={soloRecap} onReady={() => setSoloRecap([])} />
      )}
      {summaryOpen && (
        <EraSummary
          view={view}
          names={names}
          outcome={outcome}
          onContinue={() => {
            setSeenEras(view.eraScores.length);
            // Only the game's end stays dismissed; the Canal Era's summary closing mustn't hide the final one.
            if (outcome) setResultsHidden(true);
          }}
          onNewGame={onNewGame}
        />
      )}
      {outcome && !summaryOpen && !scoringToPlay && (
        <button className="results-button confirm" onClick={() => setResultsHidden(false)}>
          Final scores
        </button>
      )}
      {coach && <Coach coach={coach} onExit={onExitTutorial} onKeepPlaying={onKeepPlaying} />}
    </div>
  );
}
