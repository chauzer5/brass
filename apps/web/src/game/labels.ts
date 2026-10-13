import { brass } from '@brass/engine';

export const INDUSTRY_NAME: Record<brass.Industry, string> = {
  cotton: 'Cotton Mill',
  manufacturer: 'Manufacturer',
  pottery: 'Pottery',
  coal: 'Coal Mine',
  iron: 'Iron Works',
  brewery: 'Brewery',
};

export const INDUSTRY_SHORT: Record<brass.Industry, string> = {
  cotton: 'Co',
  manufacturer: 'Mf',
  pottery: 'Po',
  coal: 'Cl',
  iron: 'Ir',
  brewery: 'Br',
};

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
export const roman = (level: number) => ROMAN[level - 1] ?? String(level);

export function locationName(id: brass.LocationId): string {
  const loc = brass.LOCATION_BY_ID[id];
  if (loc.kind !== 'farmBrewery') return loc.name;
  return id === 'farm-brewery-north' ? 'Farm Brewery (Cannock)' : 'Farm Brewery (Kidderminster)';
}

export function linkName(id: string): string {
  const link = brass.LINKS.find((l) => l.id === id);
  return link ? link.ends.map(locationName).join(' – ') : id;
}

export function cardName(card: brass.Card | undefined): string {
  if (!card) return 'Card';
  switch (card.kind) {
    case 'location':
      return locationName(card.location);
    case 'industry':
      return card.industries.map((i) => INDUSTRY_NAME[i]).join(' / ');
    case 'wildLocation':
      return 'Wild Location';
    case 'wildIndustry':
      return 'Wild Industry';
  }
}

export function slotName(location: brass.LocationId, slot: number): string {
  const loc = brass.LOCATION_BY_ID[location];
  if (loc.kind === 'merchant') return locationName(location);
  const icons = loc.slots[slot]!.map((i) => INDUSTRY_SHORT[i]).join('/');
  return loc.slots.length > 1 ? `${locationName(location)} · ${icons} space` : locationName(location);
}

export function merchantName(state: { merchants: brass.MerchantSpace[] }, index: number): string {
  const m = state.merchants[index]!;
  const goods = m.tile?.industries.map((i) => INDUSTRY_SHORT[i]).join('/') ?? '';
  return `${locationName(m.location)}${goods ? ` (${goods})` : ''}${m.beer ? ' 🍺' : ''}`;
}

export const PLAYER_COLORS = ['purple', 'gold', 'red', 'teal'] as const;
