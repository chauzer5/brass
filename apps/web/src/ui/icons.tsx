import type { brass } from '@brass/engine';
import type { ReactElement } from 'react';
import type { ActionKind } from '../game/draft.ts';

/*
 * Small line icons drawn on a 24×24 grid with `currentColor`, so they follow
 * the button's text colour in light and dark mode.
 */

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export function ActionIcon({ kind, size = 24 }: { kind: ActionKind | 'undo'; size?: number }) {
  return (
    <svg {...svgProps} width={size} height={size}>
      {ACTION_PATHS[kind]}
    </svg>
  );
}

const ACTION_PATHS: Record<ActionKind | 'undo', ReactElement> = {
  // A factory going up: sawtooth roof with a chimney.
  build: (
    <>
      <path d="M3 21V11l5 3v-3l5 3v-3l5 3V5h3v16Z" />
      <path d="M7 21v-3h3v3M14 18h3" />
    </>
  ),
  // Two towns joined by a rail line with sleepers.
  network: (
    <>
      <circle cx="5" cy="18" r="2.5" />
      <circle cx="19" cy="6" r="2.5" />
      <path d="M7 16 17 8" />
      <path d="M9.2 12.6l1.8 2.2M11.6 10.7l1.8 2.2M14 8.8l1.8 2.2" />
    </>
  ),
  // A tile lifted off the mat with an up arrow.
  develop: (
    <>
      <rect x="4" y="13" width="16" height="7" rx="1.5" />
      <path d="M12 3v8M8.5 6.5 12 3l3.5 3.5" />
    </>
  ),
  // A crate with a coin.
  sell: (
    <>
      <path d="M3 9h12v11H3zM3 13h12M7 9v4M11 9v4" />
      <circle cx="18" cy="7" r="3.5" />
      <path d="M18 5.5v3" />
    </>
  ),
  // A money bag marked with a pound sign.
  loan: (
    <>
      <path d="M9 3h6l-2 3h-2Z" />
      <path d="M10 6C5 9 4 13 4 16a5 5 0 0 0 5 5h6a5 5 0 0 0 5-5c0-3-1-7-6-10" />
      <path d="M13.8 12.2a1.9 1.9 0 0 0-3.4 1.1V18M9 15.5h3.5M9 18h5" />
    </>
  ),
  // A spyglass.
  scout: (
    <>
      <path d="M3 15 15 5l3 3.6L6 18.6Z" />
      <path d="M15 5l2-1.7 3 3.6-2 1.7" />
      <path d="M9 17l-1 4M10 16.3l3 4.2" />
    </>
  ),
  // Skip forward.
  pass: (
    <>
      <path d="M5 5l9 7-9 7Z" />
      <path d="M18 5v14" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </>
  ),
};

export function IndustryIcon({
  industry,
  size = 20,
  x,
  y,
}: {
  industry: brass.Industry;
  size?: number;
  /** Position, when drawn inside another SVG. */
  x?: number;
  y?: number;
}) {
  return (
    <svg {...svgProps} width={size} height={size} {...(x !== undefined ? { x } : {})} {...(y !== undefined ? { y } : {})}>
      {INDUSTRY_PATHS[industry]}
    </svg>
  );
}

const INDUSTRY_PATHS: Record<brass.Industry, ReactElement> = {
  // Mill with a sawtooth roof and windows.
  cotton: (
    <>
      <path d="M3 20V10l4-3v3l4-3v3l4-3v3h3V4h2v16Z" />
      <path d="M6 14h2M10 14h2M14 14h2" />
    </>
  ),
  // Wooden crate.
  manufacturer: (
    <>
      <rect x="4" y="6" width="16" height="13" rx="1" />
      <path d="M4 10h16M4 15h16M8 6v13M16 6v13" />
    </>
  ),
  // Bottle kiln.
  pottery: (
    <>
      <path d="M10 3h4v3c3 2 5 6 5 10v4H5v-4c0-4 2-8 5-10Z" />
      <path d="M10 20v-3h4v3" />
    </>
  ),
  // Mine cart full of coal.
  coal: (
    <>
      <path d="M3 10h18l-2 7H5Z" />
      <circle cx="8" cy="19.5" r="1.5" />
      <circle cx="16" cy="19.5" r="1.5" />
      <path d="M6 10c0-3 3-4 4-2 1-3 5-3 5 0 2-1 4 0 3 2" />
    </>
  ),
  // Beam pump engine.
  iron: (
    <>
      <path d="M3 20h18M6 20v-6h4v6M15 20V8" />
      <path d="M4 8l14-3M18 5v6" />
      <circle cx="8" cy="11" r="2" />
    </>
  ),
  // Barrel.
  brewery: (
    <>
      <path d="M7 3h10c1.5 3 1.5 15 0 18H7C5.5 18 5.5 6 7 3Z" />
      <path d="M6 8h12M6 16h12" />
    </>
  ),
};
