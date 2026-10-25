/** How many rulebook pages there are in public/rulebook/, or null when there are none (see vite.config.ts). */
declare const __RULEBOOK__: number | null;
/** This build: the commit it was made from (null if unknown) and when (ms; see vite.config.ts). */
declare const __VERSION__: { commit: string | null; builtAt: number };
