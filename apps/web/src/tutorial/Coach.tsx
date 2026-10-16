import { brass } from '@brass/engine';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BrassMatch } from '../game/useGame.ts';
import { STEPS, TUTOR, YOU, type Frame, type Step } from './script.ts';

/** Pause before each of the tutor's moves, so they can be followed. */
const TUTOR_PAUSE_MS = 1300;

export interface CoachState {
  step: Step;
  index: number;
  /** Moves you may make now: null when it isn't a "do" step (no moves at all). */
  allow: ((action: brass.BrassAction, state: brass.BrassState) => boolean) | null;
  /** Bots play both seats, quickly. */
  autoplay: boolean;
  /** The step is waiting for Next. */
  canContinue: boolean;
  next: () => void;
  frame: { box: Frame; key: string } | null;
}

/**
 * Runs the tutorial's steps against the game: plays the tutor's scripted
 * moves, moves on when you make the move a step asks for, and turns on
 * fast-forward when the script says.
 */
export function useCoach({
  enabled,
  match,
  playBot,
  busy,
  summaryOpen,
}: {
  enabled: boolean;
  match: BrassMatch;
  playBot: (player: number, action: brass.BrassAction, at: number) => void;
  /** An animation is playing: the tutor waits. */
  busy: boolean;
  summaryOpen: boolean;
}): CoachState | null {
  const [index, setIndex] = useState(0);
  const step = STEPS[Math.min(index, STEPS.length - 1)]!;
  // Where the game was when this step began, and how many of the tutor's moves it has played.
  const startedAt = useRef(match.log.length);
  const [tutorPlayed, setTutorPlayed] = useState(0);
  useLayoutEffect(() => {
    startedAt.current = match.log.length;
    setTutorPlayed(0);
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = () => setIndex((i) => Math.min(i + 1, STEPS.length - 1));

  const state = match.state;
  const active = brass.currentPlayer(state);

  // A "do" step is done once you've made its move.
  useEffect(() => {
    if (!enabled || step.kind !== 'do') return;
    const mine = match.log.slice(startedAt.current).some((e) => e.player === YOU);
    if (mine) next();
  }, [enabled, step, match.log.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // The tutor plays its moves one at a time, with a pause before each.
  useEffect(() => {
    if (!enabled || step.kind !== 'tutor' || busy) return;
    if (tutorPlayed >= step.moves.length || active !== TUTOR) return;
    const at = match.log.length;
    const t = window.setTimeout(() => {
      const pick = step.moves[tutorPlayed]!;
      const action = brass.brassGame.legalActions(state, TUTOR).find((a) => pick(a, state));
      if (!action) {
        console.error(`Tutorial: no tutor move for "${step.title}"`);
        return;
      }
      playBot(TUTOR, action, at);
      setTutorPlayed((n) => n + 1);
    }, TUTOR_PAUSE_MS);
    return () => clearTimeout(t);
  }, [enabled, step, tutorPlayed, active, busy, match.log.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fast-forward ends when the era's scoring comes up; the summary step ends when it's closed.
  useEffect(() => {
    if (!enabled) return;
    if (step.kind === 'fastForward' && summaryOpen) next();
    if (step.kind === 'summary' && !summaryOpen) next();
  }, [enabled, step, summaryOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled) return null;
  const tutorDone = step.kind === 'tutor' && tutorPlayed >= step.moves.length && !busy;
  const frame = 'frame' in step && step.frame ? { box: step.frame, key: `coach-${index}` } : null;
  return {
    step,
    index,
    allow: step.kind === 'do' && active === YOU ? step.allow : null,
    autoplay: step.kind === 'fastForward',
    canContinue: step.kind === 'info' || tutorDone,
    next,
    frame,
  };
}

/**
 * The coach's card: the step's explanation, Next when it waits for you, and
 * (at the end) the way out. Whatever the step points at gets a pulsing ring.
 */
export function Coach({
  coach,
  onExit,
  onKeepPlaying,
}: {
  coach: CoachState;
  onExit: () => void;
  onKeepPlaying: () => void;
}) {
  const { step, index, canContinue, next } = coach;
  const [folded, setFolded] = useState(false);
  useEffect(() => setFolded(false), [index]);

  // Point at the step's target.
  const point = 'point' in step ? step.point : undefined;
  useEffect(() => {
    if (!point) return;
    const els = [...document.querySelectorAll(point)];
    els.forEach((el) => el.classList.add('coach-target'));
    return () => els.forEach((el) => el.classList.remove('coach-target'));
  }, [point, index]);

  // The card sits above the hand when it's at the bottom: track where the hand's tray starts.
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    const tray = document.querySelector('.hand-tray');
    const set = () => {
      // (On a big screen the hand is a sidebar beside the map, not over its bottom.)
      const top = tray && !tray.classList.contains('wide') ? tray.getBoundingClientRect().top : window.innerHeight;
      root.setProperty('--tray-h', `${Math.max(0, window.innerHeight - top)}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    if (tray) ro.observe(tray);
    window.addEventListener('resize', set);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', set);
      root.removeProperty('--tray-h');
    };
  }, []);

  // Overlays (like the era's scoring) leave room for the card above them, when it's at the top.
  const card = useRef<HTMLDivElement>(null);
  // (Minimized, the card always sits just above the hand, whatever the step's place.)
  const top = step.place === 'top' && !folded;
  useLayoutEffect(() => {
    const el = card.current;
    const root = document.documentElement.style;
    if (!el || !top) return;
    const set = () => root.setProperty('--coach-h', `${el.offsetHeight + 12}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.removeProperty('--coach-h');
    };
  }, [top]);

  const total = STEPS.length;
  return (
    <div ref={card} className={`coach place-${step.place} ${folded ? 'folded' : ''}`} role="dialog" aria-label="Tutorial" aria-live="polite">
      <div className="coach-head">
        <span className="coach-count">
          {index + 1}/{total}
        </span>
        <h2>{step.title}</h2>
        <button className="coach-fold" onClick={() => setFolded((f) => !f)} aria-label={folded ? 'Show the tutorial' : 'Hide the tutorial'}>
          {folded ? '+' : '−'}
        </button>
      </div>
      {!folded && (
        <>
          <p>{step.text}</p>
          <div className="coach-actions">
            {step.kind === 'finish' ? (
              <>
                <button className="secondary" onClick={onExit}>
                  Main menu
                </button>
                <button className="confirm" onClick={onKeepPlaying}>
                  Keep playing
                </button>
              </>
            ) : (
              <>
                <button className="link-button coach-exit" onClick={onExit}>
                  Exit tutorial
                </button>
                {canContinue && (
                  <button className="confirm coach-next" onClick={next} autoFocus>
                    Next
                  </button>
                )}
                {step.kind === 'tutor' && !canContinue && <span className="muted coach-wait">Richard is playing…</span>}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
