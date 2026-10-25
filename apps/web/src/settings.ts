import { useCallback, useState } from 'react';

export type ThemeSetting = 'system' | 'light' | 'dark';

const THEME_KEY = 'brass:theme';

export function loadTheme(): ThemeSetting {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Sets `data-theme` on <html>; with no attribute the CSS follows the phone's setting. */
export function applyTheme(theme: ThemeSetting): void {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeSetting>(loadTheme);
  const setTheme = useCallback((next: ThemeSetting) => {
    setThemeState(next);
    applyTheme(next);
    try {
      if (next === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage unavailable: the choice lasts until the app is closed.
    }
  }, []);
  return { theme, setTheme };
}

/** A choice kept on this device, from a fixed set of values (the first is the default). */
function storedChoice<T extends string>(key: string, values: readonly T[]) {
  const load = (): T => {
    try {
      const v = localStorage.getItem(key);
      return values.includes(v as T) ? (v as T) : values[0]!;
    } catch {
      return values[0]!;
    }
  };
  const save = (value: T) => {
    try {
      if (value === values[0]) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // Storage unavailable: the choice lasts until the app is closed.
    }
  };
  return { load, save };
}

// ---- Animations ----

export type MotionSetting = 'system' | 'full' | 'reduced';
const motion = storedChoice<MotionSetting>('brass:motion', ['system', 'full', 'reduced']);
const deviceReduces = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Sets `data-motion="reduced"` on <html> when animations should be cut down: chosen here, or (on
 * "Match device") the phone's own setting. The stylesheet's reduced-motion rules hang off it.
 */
export function applyMotion(setting: MotionSetting = motion.load()): void {
  const reduced = setting === 'reduced' || (setting === 'system' && deviceReduces());
  if (reduced) document.documentElement.dataset.motion = 'reduced';
  else delete document.documentElement.dataset.motion;
}

/** Whether animations are cut down right now (for the ones run from code). */
export const reducedMotion = () => document.documentElement.dataset.motion === 'reduced';

applyMotion();
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => applyMotion());

export function useMotion() {
  const [value, setValue] = useState<MotionSetting>(motion.load);
  const set = useCallback((next: MotionSetting) => {
    setValue(next);
    motion.save(next);
    applyMotion(next);
  }, []);
  return [value, set] as const;
}

// ---- Bot speed ----

export type BotSpeed = 'normal' | 'fast' | 'instant';
const botSpeed = storedChoice<BotSpeed>('brass:bot-speed', ['normal', 'fast', 'instant']);

/** How long a bot waits before its move lands, so its turn can be followed. */
export function botPauseMs(): number {
  return { normal: 900, fast: 350, instant: 0 }[botSpeed.load()];
}

export function useBotSpeed() {
  const [value, setValue] = useState<BotSpeed>(botSpeed.load);
  const set = useCallback((next: BotSpeed) => {
    setValue(next);
    botSpeed.save(next);
  }, []);
  return [value, set] as const;
}
