import type { PlayerId } from '../kernel.ts';
import { LINKS, LOCATIONS, MERCHANTS, type LinkDef, type LocationId } from './data/map.ts';
import { parseSlotKey, type BrassState, type SlotKey } from './state.ts';

export const LINK_BY_ID: Readonly<Record<string, LinkDef>> = Object.fromEntries(LINKS.map((l) => [l.id, l]));

const MERCHANT_IDS = new Set<LocationId>(MERCHANTS.map((m) => m.id));

/**
 * Link-tile distance from `from` to every location reachable over built links
 * (owned by any player). Used for "connected" (rulebook p.8) and "closest
 * Coal Mine" (fewest Link tiles distant).
 */
export function distances(state: BrassState, from: readonly LocationId[]): Map<LocationId, number> {
  const dist = new Map<LocationId, number>(from.map((l) => [l, 0]));
  const queue = [...from];
  const built = LINKS.filter((l) => state.links[l.id] !== undefined);
  while (queue.length) {
    const loc = queue.shift()!;
    const d = dist.get(loc)!;
    for (const link of built) {
      if (!link.ends.includes(loc)) continue;
      for (const next of link.ends) {
        if (!dist.has(next)) {
          dist.set(next, d + 1);
          queue.push(next);
        }
      }
    }
  }
  return dist;
}

export function isConnected(state: BrassState, a: readonly LocationId[], b: LocationId): boolean {
  return distances(state, a).has(b);
}

/** Connected to any Merchant location, i.e. a market icon (rulebook p.8). */
export function connectedToMarket(state: BrassState, from: readonly LocationId[]): boolean {
  const dist = distances(state, from);
  return [...MERCHANT_IDS].some((m) => dist.has(m));
}

export function tilesAt(state: BrassState, location: LocationId) {
  return (Object.entries(state.tiles) as [SlotKey, NonNullable<BrassState['tiles'][SlotKey]>][]).filter(
    ([key]) => parseSlotKey(key).location === location,
  );
}

export function hasTilesOnBoard(state: BrassState, player: PlayerId): boolean {
  return (
    Object.values(state.tiles).some((t) => t?.owner === player) ||
    Object.values(state.links).some((owner) => owner === player)
  );
}

/**
 * Locations in a player's network: those with one of their Industry tiles,
 * or adjacent to one of their Link tiles (rulebook p.8).
 */
export function network(state: BrassState, player: PlayerId): Set<LocationId> {
  const out = new Set<LocationId>();
  for (const [key, tile] of Object.entries(state.tiles) as [SlotKey, { owner: PlayerId }][]) {
    if (tile.owner === player) out.add(parseSlotKey(key).location);
  }
  for (const [id, owner] of Object.entries(state.links)) {
    if (owner === player) for (const end of LINK_BY_ID[id]!.ends) out.add(end);
  }
  return out;
}

export const ALL_LOCATION_IDS: readonly LocationId[] = LOCATIONS.map((l) => l.id);
