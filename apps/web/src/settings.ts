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
